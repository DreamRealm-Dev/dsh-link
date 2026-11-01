#!/usr/bin/env node
// R73 alive-control: present - samples rootState() (dshHomePath) beside every counter sample
/**
 * R67: the retry timer in a real kernel composition that is still alive.
 *
 * R64-R66 measured the timer through `runProfile()` with the `headless` profile and no task. That profile
 * requires a task (<kernel>/packages/bundle/headless/src/index.ts:329) and hands the launcher an exit
 * request, so the app fiber is disposed a moment after `runProfile` resolves - every reading taken over
 * the following seconds was taken on an app that no longer existed. The probe's cue is in the readings
 * themselves: all eight inserted services AND a root-provided one (`dshHomePath`) become unreadable at
 * the same instant, while plain JS intervals keep firing because their cleanups are never run.
 *
 * This instrument boots the kernel's own Loader directly (`boot()` from app-boot) over a config this
 * script writes, with no app bundle that can decide the work is over. The composition therefore stays up
 * for as long as the driver wants, and the retry timer is read while it is genuinely running.
 *
 * Readings: our service published; `counts` sampled over a window; the control row's ticks in the same
 * window; the counters frozen after the root fiber is disposed.
 *
 * Usage: cd <kernel> && node --import tsx/esm <repo>/scripts/probe-kernel-live.mjs [--keep] [--window ms]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const NL = String.fromCharCode(10)
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KERNEL = resolve(process.env.DSH_LINK_KERNEL ?? join(REPO, 'core', 'deepseek-harness'))
const KEEP = process.argv.includes('--keep')
const WINDOW = Number((process.argv.includes('--window') ? process.argv[process.argv.indexOf('--window') + 1] : null) ?? '3000')
const EVERY = 40
const BOOT_TIMEOUT = 240000
const APP_BOOT = pathToFileURL(join(KERNEL, 'packages/boot/app-boot/src/index.ts')).href
const PLUGIN_DIR = join(REPO, 'plugins', 'dsh-link-collab')

if (!existsSync(join(KERNEL, 'packages/boot/app-boot/src/index.ts'))) {
  process.stderr.write('run this with the kernel checkout available; missing ' + APP_BOOT + NL)
  process.exit(2)
}

const home = mkdtempSync(join(tmpdir(), 'r67-live-'))
const rootDir = join(home, 'composition')
const marker = join(home, 'marker.jsonl')
const observations = join(home, 'observations.json')
mkdirSync(rootDir, { recursive: true })
writeFileSync(marker, '')

// A control row with the same clock, mounted the same way, so "our timer stopped" and "timers stopped"
// stay two different readings.
const control = join(rootDir, 'control-timer.mjs')
writeFileSync(control, [
  "import { appendFileSync } from 'node:fs'",
  "const NL = String.fromCharCode(10)",
  "const note = (event) => { try { appendFileSync(process.env.R67_LIVE_MARKER, JSON.stringify({ event, at: Date.now() }) + NL) } catch { /* best effort */ } }",
  "export const name = 'r67-control'",
  "export function apply(ctx) {",
  "  ctx.provide('r67Control', { tag: 'control' })",
  "  note('control-apply')",
  "  const timer = setInterval(() => note('control-tick'), " + String(EVERY) + ")",
  "  return () => { clearInterval(timer); note('control-dispose') }",
  '}',
].join(NL) + NL, 'utf8')

// The root config: the rows this composition is made of, mounted by the kernel's own Loader.
// The row's retry config is a variable: --retry '<json>' measures a schedule (backoff, jitter) in the
// same live composition instead of only offline.
const RETRY = (() => {
  const raw = process.argv.includes('--retry') ? process.argv[process.argv.indexOf('--retry') + 1] : null
  if (raw === null) return { enabled: true, everyMs: EVERY, timeoutMs: 1000, maxAttempts: 3, team: 'team-1', localEnd: 'end-A' }
  const parsed = JSON.parse(raw)
  return parsed.enabled === false || parsed.everyMs !== undefined ? parsed : { enabled: true, everyMs: EVERY, timeoutMs: 1000, maxAttempts: 3, team: 'team-1', localEnd: 'end-A', ...parsed }
})()
const SAMPLE = Number((process.argv.includes('--sample') ? process.argv[process.argv.indexOf('--sample') + 1] : null) ?? '250')
// R69: a live world can be given a ledger to decide about - a stale dispatch, and optionally a lease
// held by another end. The plan verdict is then read from the live service, not from a stand-in.
const SEED = process.argv.includes('--seed-stale')
const LEASE = process.argv.includes('--lease') ? process.argv[process.argv.indexOf('--lease') + 1] : ''
const PLUGIN_URL = pathToFileURL(join(PLUGIN_DIR, 'lib', 'index.js')).href

const rows = [
  { id: 'r67-control', name: control },
  { id: 'dsh-link-collab', name: 'dsh-link-collab', config: { logDir: 'probe', retry: RETRY } },
]
const rootConfig = join(rootDir, 'cordis.yml')
writeFileSync(rootConfig, JSON.stringify(rows, undefined, 2) + NL, 'utf8')
const nodeModules = join(rootDir, 'node_modules')
mkdirSync(nodeModules, { recursive: true })
try { symlinkSync(PLUGIN_DIR, join(nodeModules, 'dsh-link-collab'), 'junction') } catch (error) { process.stderr.write('junction failed: ' + String(error?.message ?? error) + NL) }

const driver = join(home, 'driver.mjs')
writeFileSync(driver, [
  "import { appendFileSync, writeFileSync } from 'node:fs'",
  "const NL = String.fromCharCode(10)",
  "const note = (event, extra) => { try { appendFileSync(process.env.R67_LIVE_MARKER, JSON.stringify({ event, at: Date.now(), ...(extra ?? {}) }) + NL) } catch { /* best effort */ } }",
  "const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))",
  "const main = async () => {",
  "  const boot = await import(process.env.R67_APP_BOOT_URL)",
  "  const observation = { booted: false, error: null, service: null, series: [], afterDispose: null }",
  "  let ctx = null",
  "  try { ctx = await boot.boot('r67-live', process.env.R67_ROOT_CONFIG, [], undefined, process.env.R67_BARE_BASE) } catch (error) { observation.error = String(error?.message ?? error); note('boot-failed', { message: observation.error }); writeFileSync(process.env.R67_OUT, JSON.stringify(observation, undefined, 2)); process.exit(0) }",
  "  observation.booted = true",
  "  observation.loaderPresent = ctx.get('loader') !== undefined",
  "  const held = (() => { try { return ctx.reflect.get('linkCollab', false) } catch { return undefined } })()",
  "  observation.service = { present: held !== undefined && held !== null, keys: held && typeof held === 'object' ? Object.keys(held) : [] }",
  "  observation.controlVisible = (() => { try { return ctx.reflect.get('r67Control', false) !== undefined } catch { return false } })()",
  "  const read = () => { try { return ctx.reflect.get('linkCollab', false) } catch { return undefined } }",
  "  const aliveVerdict = () => { try { return { rootAlive: ctx.reflect.get('dshHomePath', false) !== undefined } } catch { return { rootAlive: false } } }",
  "  const mod = await import(process.env.R67_PLUGIN_URL)",
  "  const seeded = []",
  "  if (process.env.R67_SEED === 'stale' && held && held.log && typeof held.log.append === 'function') {",
  "    const clock = Date.now()",
  "    await held.log.append({ kind: 'member/state', actor: 'team-1', subject: 'end-A', payload: { id: 'end-A', state: 'active', name: 'end-A' } })",
  "    await held.log.append({ kind: 'task/state', actor: 'team-1', subject: 'task-1', payload: { id: 'task-1', state: 'in_progress', owner: 'end-A', team: 'team-1' } })",
  "    await held.log.append(mod.capabilityRecord('end-A', ['probe-tool']))",
  "    await held.log.append(mod.dispatchRecord('job-1', 'end-A', 'probe-tool', {}, clock - 5000))",
  "    seeded.push('stale-job-1')",
  "  }",
  "  if (process.env.R67_LEASE !== '' && held && held.log && typeof held.log.append === 'function') {",
  "    await held.log.append({ kind: 'task/retry-lease', actor: 'team-1', subject: process.env.R67_LEASE, payload: { root: 'job-1', end: process.env.R67_LEASE, at: Date.now(), untilMs: 60000 } })",
  "    seeded.push('lease-' + process.env.R67_LEASE)",
  "  }",
  "  observation.seeded = seeded",
  "  const retry = held && held.retry",
  "  const sample = () => ({ at: Date.now(), live: read() !== undefined, rootAlive: aliveVerdict().rootAlive, idle: retry ? (retry.idle ?? null) : null, nextDelayMs: retry ? (retry.nextDelayMs ?? null) : null, controlVisible: (() => { try { return ctx.reflect.get('r67Control', false) !== undefined } catch { return false } })(), runs: retry ? retry.counts.runs : null, ticks: retry ? (retry.counts.ticks ?? null) : null, written: retry ? retry.counts.written : null, skipped: retry ? retry.counts.skipped : null, failed: retry ? retry.counts.failed : null, timerInstalled: retry ? (retry.timerInstalled ?? null) : null, lastReason: retry ? (retry.lastReason ?? null) : null })",
  "  const first = sample()",
  "  observation.series.push(first)",
  "  const steps = Math.max(4, Math.round(Number(process.env.R67_WINDOW) / Number(process.env.R67_SAMPLE)))",
  "  for (let i = 0; i < steps; i += 1) { await sleep(Number(process.env.R67_SAMPLE)); observation.series.push(sample()) }",
  "  const before = sample()",
  "  await ctx.fiber.dispose()",
  "  await sleep(300)",
  "  const after = sample()",
  "  observation.beforeDispose = before",
  "  observation.afterDispose = after",
  "  observation.frozenAfterDispose = after.ticks === before.ticks && after.runs === before.runs",
  "  observation.serviceAfterDispose = (() => { try { return ctx.reflect.get('linkCollab', false) !== undefined } catch { return false } })()",
  "  observation.plan = (() => {",
  "    if (typeof mod.redispatchPlan !== 'function' || !held || typeof held.state !== 'function') return { skipped: 'redispatchPlan not exported by this build' }",
  "    try {",
  "      const plan = mod.redispatchPlan(held.state(), { team: 'team-1', localEnd: 'end-A', now: Date.now(), timeoutMs: 500, maxAttempts: 9 })",
  "      return { entries: plan.entries.map((entry) => entry.id), blocked: plan.blocked.map((row) => row.from + ':' + row.reason) }",
  "    } catch (error) { return { error: String(error?.message ?? error) } }",
  "  })()",
  "  observation.leases = (() => {",
  "    try { const state = held.state(); return (state.retryLeases ?? []).map((lease) => lease.root + '@' + lease.end) } catch (error) { return ['error:' + String(error?.message ?? error)] }",
  "  })()",
  "  writeFileSync(process.env.R67_OUT, JSON.stringify(observation, undefined, 2))",
  "  note('driver-done')",
  "  process.exit(0)",
  "}",
  "main()",
].join(NL), 'utf8')

const env = {
  ...process.env,
  DSH_HOME: home,
  R67_LIVE_MARKER: marker,
  R67_OUT: observations,
  R67_APP_BOOT_URL: APP_BOOT,
  R67_ROOT_CONFIG: rootConfig,
  R67_BARE_BASE: pathToFileURL(rootDir + '/').href,
  R67_WINDOW: String(WINDOW),
  R67_SAMPLE: String(SAMPLE),
  R67_SEED: SEED ? 'stale' : '',
  R67_LEASE: LEASE,
  R67_PLUGIN_URL: PLUGIN_URL,
  DSH_LINK_COLLAB_TRACE_TEARDOWN: '1',
}
const run = spawnSync(process.execPath, ['--import', 'tsx/esm', driver], { cwd: KERNEL, encoding: 'utf8', timeout: BOOT_TIMEOUT, env })
const log = ((run.stdout ?? '') + (run.stderr ?? '')).trim()
const logLines = log.split(/\r?\n/)
const markerLines = existsSync(marker) ? readFileSync(marker, 'utf8').split(/\r?\n/).filter((line) => line !== '') : []
const events = markerLines.map((line) => { try { return JSON.parse(line) } catch { return { event: 'unparsed' } } })
const ticks = events.filter((event) => event.event === 'control-tick')
const mounts = logLines.filter((line) => line.includes('[dsh-link-collab] control channel ready')).length
const teardowns = logLines.filter((line) => line.includes('[dsh-link-collab] teardown')).length
const seen = existsSync(observations) ? JSON.parse(readFileSync(observations, 'utf8')) : null
const report = {
  kernel: KERNEL,
  home: KEEP ? home : '(removed)',
  driver: run.status,
  everyMs: RETRY.everyMs,
  retryConfig: RETRY,
  sampleMs: SAMPLE,
  window: WINDOW,
  mountAnnouncements: mounts,
  teardownCount: teardowns,
  control: { applied: events.filter((event) => event.event === 'control-apply').length, ticks: ticks.length, disposed: events.filter((event) => event.event === 'control-dispose').length, span: ticks.length === 0 ? null : { first: ticks[0].at, last: ticks[ticks.length - 1].at } },
  observations: seen,
  logTail: logLines.slice(-6),
}
console.log(JSON.stringify(report, undefined, 2))
if (!KEEP) rmSync(home, { recursive: true, force: true })
process.exit(seen === null ? 1 : 0)
