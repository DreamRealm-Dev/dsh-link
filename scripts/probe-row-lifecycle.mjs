#!/usr/bin/env node
// R73 alive-control: present - every sample carries the root-provided services beside the mimic services
/**
 * R67: which of our traits gets the row unloaded.
 *
 * R66 proved, in a real kernel boot, that the retry timer's single tick is not a timer problem at all:
 * the plugin's row was mounted once, its own fiber was then unloaded by the kernel within 150ms
 * (cordis fiber._unload, fiber.ts:676-681 in the stack our teardown printed), the published service was
 * withdrawn, and the sibling rows inserted by the same patch kept ticking for the whole window.
 *
 * So the question is not "why does the timer stop" but "which trait of our row gets it unloaded". This
 * instrument answers it by bisection: one boot, several rows that are copies of our row's traits added
 * one at a time, each writing a marker per tick and one when its disposer runs. A row that stops ticking
 * while the others keep going has the trait that matters; a row that writes a dispose marker was
 * unloaded.
 *
 * Traits under test, each in its own row:
 *   plain   - a bare interval in apply (the shape R64's control row already had)
 *   effect  - the interval owned by ctx.effect(() => { ...; return teardown })   [registration]
 *   provide - ctx.provide('r66Mimic', ...)                                       [publishes a service]
 *   config  - a row config object handed to apply                                [config]
 *   writes  - writes a file and a per-tick file under the DSH home                [touches disk]
 *   byname  - a package resolved by NAME through a junction, not by absolute path [module resolution]
 *   all     - every trait above at once, which is our row minus the plugin body
 * plus the real plugin row (retry enabled) and the R64 timer control row.
 *
 * Instrument, not a gate: nothing here is a judgement, it is a reading.
 *
 * Usage: cd <kernel> && node --import tsx/esm <repo>/scripts/probe-row-lifecycle.mjs [--keep] [--window ms]
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const NL = String.fromCharCode(10)
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KERNEL = resolve(process.env.DSH_LINK_KERNEL ?? join(REPO, 'core', 'deepseek-harness'))
const KEEP = process.argv.includes('--keep')
const PROFILE = 'r67lifecycle'
const WINDOW = Number((process.argv.includes('--window') ? process.argv[process.argv.indexOf('--window') + 1] : null) ?? '1800')
const BOOT_TIMEOUT = 240000
const EVERY = 25
const PLUGIN_DIR = join(REPO, 'plugins', 'dsh-link-collab')
const PROFILE_BOOT = pathToFileURL(join(KERNEL, 'apps/cli/src/profile-boot.ts')).href
const APP_BOOT = pathToFileURL(join(KERNEL, 'packages/boot/app-boot/src/index.ts')).href

if (!existsSync(join(KERNEL, 'apps/cli/src/profile-boot.ts'))) {
  process.stderr.write('run this with the kernel checkout available; missing ' + join(KERNEL, 'apps/cli/src/profile-boot.ts') + NL)
  process.exit(2)
}

const home = mkdtempSync(join(tmpdir(), 'r67-lifecycle-'))
const profileDir = join(home, 'profiles', PROFILE)
const marker = join(home, 'marker.jsonl')
const observations = join(home, 'observations.json')
writeFileSync(marker, '')

const runTsx = (scriptText, env, timeout = 180000) => {
  const file = join(home, 'step-' + String(Math.abs(scriptText.length)) + '.mjs')
  writeFileSync(file, scriptText, 'utf8')
  return spawnSync(process.execPath, ['--import', 'tsx/esm', file], { cwd: KERNEL, encoding: 'utf8', timeout, env: { ...process.env, ...env } })
}

// 1. a profile from a shipped template
const init = runTsx([
  'import { initializeProfileFromDefault } from ' + JSON.stringify(PROFILE_BOOT),
  'try {',
  '  initializeProfileFromDefault(process.env.R67_PROFILE, process.env.R67_TEMPLATE, process.env.DSH_HOME)',
  "  process.stdout.write('OK')",
  "} catch (error) { process.stdout.write('FAIL ' + String(error && error.message ? error.message : error)) }",
].join(NL), { DSH_HOME: home, R67_PROFILE: PROFILE, R67_TEMPLATE: 'headless' }, 120000)
const initText = ((init.stdout ?? '') + (init.stderr ?? '')).trim()
if (!initText.startsWith('OK')) {
  process.stderr.write('profile init failed: ' + initText.slice(0, 500) + NL)
  process.exit(2)
}

/* 2. the mimic modules. Each one is a row with exactly one more of our traits than 'plain', each writes
 *    one marker line per tick and one from its disposer. */
const HEAD = [
  "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'",
  "import { dirname, join } from 'node:path'",
  "const NL = String.fromCharCode(10)",
  "let CURRENT = null",
  "const note = (event) => { try { appendFileSync(process.env.R67_MARKER, JSON.stringify({ event, at: Date.now(), fiberState: CURRENT && CURRENT.fiber ? CURRENT.fiber.state : null, selfService: CURRENT && CURRENT.reflect ? (() => { try { return CURRENT.reflect.get(event.split('-')[0] + 'Mimic', false) !== undefined } catch { return false } })() : null }) + NL) } catch { /* best effort */ } }",
  "const ticker = (tag) => { const timer = setInterval(() => note(tag + '-tick'), " + String(EVERY) + "); return () => { clearInterval(timer); note(tag + '-dispose') } }",
  "const publish = (ctx, tag) => { CURRENT = ctx; try { ctx.provide?.(tag + 'Mimic', { tag }) } catch { /* best effort */ } }",
  "const writeSample = (tag) => { try { const dir = join(process.env.DSH_HOME, 'r67', tag); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'ledger.jsonl'), '{\"seq\":1}' + NL); writeFileSync(join(dir, '.instance'), tag) } catch { /* best effort */ } }",
].join(NL)

const modules = [
  { id: 'r66m-plain', tag: 'plain', row: { config: null }, body: ["export function apply(ctx) { publish(ctx, 'plain'); return ticker('plain') }"] },
  { id: 'r66m-effect', tag: 'effect', row: { config: null }, body: ["export function apply(ctx) { publish(ctx, 'effect'); ctx.effect?.(() => ticker('effect')) }"] },
  { id: 'r66m-provide', tag: 'provide', row: { config: null }, body: ["export function apply(ctx) { publish(ctx, 'provide'); return ticker('provide') }"] },
  { id: 'r66m-config', tag: 'config', row: { config: { logDir: 'probe' } }, body: ["export function apply(ctx, config) { publish(ctx, 'config'); note('config-seen'); return ticker('config') }"] },
  { id: 'r66m-writes', tag: 'writes', row: { config: null }, body: ["export function apply(ctx) { publish(ctx, 'writes'); writeSample('writes'); const stop = ticker('writes'); return () => { stop(); } }"] },
  {
    id: 'r66m-all', tag: 'all', row: { config: { logDir: 'probe' } },
    body: [
      "export function apply(ctx, config) {",
      "  publish(ctx, 'all')",
      "  writeSample('all')",
      "  ctx.effect?.(() => ticker('all'))",
      '}',
    ],
  },
]

const rows = []
for (const entry of modules) {
  const file = join(home, entry.tag + '.mjs')
  writeFileSync(file, [HEAD, "export const name = '" + entry.id + "'", ...entry.body].join(NL) + NL, 'utf8')
  const row = { id: entry.id, name: file }
  if (entry.row.config !== null) row.config = entry.row.config
  rows.push(row)
}

// 2b. the same traits, but resolved by PACKAGE NAME through a junction: the one trait the rows above
//     cannot express as a local module.
const mimicPkg = join(REPO, '.tmp', 'r67-mimic-pkg')
mkdirSync(mimicPkg, { recursive: true })
writeFileSync(join(mimicPkg, 'package.json'), JSON.stringify({
  name: 'r67-mimic', version: '1.0.0', type: 'module', main: 'index.mjs', exports: { '.': './index.mjs' },
}, undefined, 2) + NL, 'utf8')
writeFileSync(join(mimicPkg, 'index.mjs'), [HEAD, "export const name = 'r67-mimic'", 'export function apply(ctx) { publish(ctx, "byname"); return ticker("byname") }'].join(NL) + NL, 'utf8')
rows.push({ id: 'r67-mimic', name: 'r67-mimic' })

// 2c. the R64 timer control row and the real plugin row, so this boot can be read against R64/R65/R66
const control = join(home, 'control-timer.mjs')
writeFileSync(control, [HEAD, "export const name = 'r67-control'", 'export function apply(ctx) { publish(ctx, "control"); return ticker("control") }'].join(NL) + NL, 'utf8')
rows.push({ id: 'r67-control', name: control })
rows.push({ id: 'dsh-link-collab', name: 'dsh-link-collab', config: { logDir: 'probe', retry: { enabled: true, everyMs: 40, timeoutMs: 1000, maxAttempts: 3, team: 'team-1', localEnd: 'end-A' } } })

mkdirSync(profileDir, { recursive: true })
// How a row gets into the profile is itself a variable: a patch inserts rows into a running config,
// while the profile's own cordis.yml declares them. R67's first run inserted everything as a patch;
// this flag is what tells "our row is unloaded" apart from "rows inserted this way are unloaded".
const MODE = (process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'patch')
if (MODE === 'config') writeFileSync(join(profileDir, 'cordis.yml'), JSON.stringify(rows, undefined, 2) + NL, 'utf8')
else writeFileSync(join(profileDir, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }], undefined, 2) + NL, 'utf8')
const nodeModules = join(profileDir, 'node_modules')
mkdirSync(nodeModules, { recursive: true })
for (const link of [[PLUGIN_DIR, 'dsh-link-collab'], [mimicPkg, 'r67-mimic']]) {
  try { symlinkSync(link[0], join(nodeModules, link[1]), 'junction') } catch (error) { process.stderr.write('junction ' + link[1] + ' failed: ' + String(error?.message ?? error) + NL) }
}

/* 3. the driver: boot the profile, sample the plugin's counters every 150ms, then leave. It never
 *    disposes anything: what rows the kernel unloads must be the kernel's own doing. */
const driver = join(home, 'driver.mjs')
writeFileSync(driver, [
  "import { appendFileSync, writeFileSync } from 'node:fs'",
  "const NL = String.fromCharCode(10)",
  "const note = (event, extra) => { try { appendFileSync(process.env.R67_MARKER, JSON.stringify({ event, at: Date.now(), ...(extra ?? {}) }) + NL) } catch { /* best effort */ } }",
  "const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))",
  "const start = Date.now()",
  "let loopTicks = 0",
  "const loopTimer = setInterval(() => { loopTicks += 1 }, 20)",
  "const main = async () => {",
  "  const boot = await import(process.env.R67_PROFILE_BOOT_URL)",
  "  const appBoot = await import(process.env.R67_APP_BOOT_URL)",
  "  const observation = { boot: null, service: null, series: [], loaderKeys: null, entries: null }",
  "  let result = null",
  "  try { result = await boot.runProfile({ environment: appBoot.loadLayeredEnv('dsh'), profile: process.env.R67_PROFILE, patchFiles: [], args: [] }) } catch (error) { observation.boot = { settled: false, message: String(error?.message ?? error) }; note('boot-threw', { message: observation.boot.message }); writeFileSync(process.env.R67_OUT, JSON.stringify(observation, undefined, 2)); process.exit(0) }",
  "  observation.boot = { settled: true, message: null }",
  "  const ctx = result.ctx",
  "  const read = () => { try { return ctx.reflect.get('linkCollab', false) } catch { return undefined } }",
  "  const service = read()",
  "  observation.service = { present: service !== undefined && service !== null, keys: service && typeof service === 'object' ? Object.keys(service) : [] }",
  "  observation.loaderKeys = ctx.loader && typeof ctx.loader === 'object' ? Object.keys(ctx.loader) : null",
  "  const serviceNames = ['control', 'plain', 'effect', 'provide', 'config', 'writes', 'byname', 'all'].map((tag) => tag + 'Mimic')",
  "  const serviceState = () => { const out = {}; for (const name of serviceNames) { try { const held = ctx.reflect.get(name, false); out[name] = held !== undefined && held !== null } catch { out[name] = false } } return out }",
  "  // Cordis reads a service non-strictly even when its providing fiber is no longer active, so a false",
  "  // here means the implementation was removed from the store, not that the reader became strict.",
  "  // Root-provided services are the control: they must stay readable while the inserted rows go away.",
  "  const rootNames = ['dshHomePath', 'logger']",
  "  const rootState = () => { const out = {}; for (const name of rootNames) { try { const held = ctx.reflect.get(name, false); out[name] = held !== undefined && held !== null } catch { out[name] = false } } return out }",
  "  observation.servicesAtFirstSample = serviceState()",
  "  for (let i = 0; i < 12; i += 1) {",
  "    const retry = service && service.retry",
  "    observation.series.push({ at: Date.now() - start, loopTicks, live: read() === service, services: serviceState(), root: rootState(), runs: retry ? retry.counts.runs : null, ticks: retry ? (retry.counts.ticks ?? null) : null, timerInstalled: retry ? (retry.timerInstalled ?? null) : null, lastReason: retry ? (retry.lastReason ?? null) : null })",
  "    await sleep(" + String(Math.max(100, Math.round(WINDOW / 12))) + ")",
  "  }",
  "  const fresh = read()",
  "  observation.liveServiceIsCaptured = fresh === service",
  "  observation.liveServiceRetry = fresh && fresh.retry ? { ticks: fresh.retry.counts.ticks ?? null, runs: fresh.retry.counts.runs, timerInstalled: fresh.retry.timerInstalled ?? null } : null",
  "  const store = ctx.loader && ctx.loader.store",
  "  observation.storeType = typeof store",
  "  if (store && typeof store === 'object') { try { observation.storeKeys = Object.keys(store).slice(0, 20) } catch { /* best effort */ } }",
  "  writeFileSync(process.env.R67_OUT, JSON.stringify(observation, undefined, 2))",
  "  clearInterval(loopTimer)",
  "  note('driver-done', { loopTicks })",
  "  process.exit(0)",
  "}",
  "main()",
].join(NL), 'utf8')

const env = {
  ...process.env,
  DSH_HOME: home,
  R67_PROFILE: PROFILE,
  R67_MARKER: marker,
  R67_OUT: observations,
  R67_PROFILE_BOOT_URL: PROFILE_BOOT,
  R67_APP_BOOT_URL: APP_BOOT,
  DSH_LINK_COLLAB_TRACE_TEARDOWN: '1',
}
const run = spawnSync(process.execPath, ['--import', 'tsx/esm', driver], { cwd: KERNEL, encoding: 'utf8', timeout: BOOT_TIMEOUT, env })
const log = ((run.stdout ?? '') + (run.stderr ?? '')).trim()
const logLines = log.split(/\r?\n/)
const markerLines = existsSync(marker) ? readFileSync(marker, 'utf8').split(/\r?\n/).filter((line) => line !== '') : []

/* 4. one line per row: how many ticks it got, when the first and last landed, and whether its own
 *    disposer ever ran. A row that stops early next to rows that do not is the reading. */
const events = markerLines.map((line) => { try { return JSON.parse(line) } catch { return { event: 'unparsed', raw: line.slice(0, 80) } } })
const tags = ['control', 'plain', 'effect', 'provide', 'config', 'writes', 'byname', 'all']
const table = {}
for (const tag of tags) {
  const ticks = events.filter((event) => event.event === tag + '-tick')
  const dispose = events.filter((event) => event.event === tag + '-dispose')
  const states = [...new Set(ticks.map((event) => event.fiberState))]
  const apply = events.filter((event) => event.event === tag + '-apply' || event.event === 'timer-calibration-apply' && tag === 'control')
  table[tag] = {
    ticks: ticks.length,
    firstTick: ticks.length === 0 ? null : ticks[0].at,
    lastTick: ticks.length === 0 ? null : ticks[ticks.length - 1].at,
    disposed: dispose.length > 0,
    disposedAt: dispose.length === 0 ? null : dispose[0].at,
    fiberStates: states,
    selfServiceAtLastTick: ticks.length === 0 ? null : ticks[ticks.length - 1].selfService,
    selfServiceLostAt: (() => { const lost = ticks.find((event) => event.selfService === false); return lost === undefined ? null : lost.at })(),
    applied: apply.length > 0 || ticks.length > 0,
  }
}
const base = table.control.firstTick
for (const tag of tags) {
  const row = table[tag]
  row.firstTickAfterControl = row.firstTick === null || base === null ? null : row.firstTick - base
  row.lastTickAfterControl = row.lastTick === null || base === null ? null : row.lastTick - base
}
const mounts = logLines.filter((line) => line.includes('[dsh-link-collab] control channel ready')).length
const teardowns = logLines.filter((line) => line.includes('[dsh-link-collab] teardown')).length
const seen = existsSync(observations) ? JSON.parse(readFileSync(observations, 'utf8')) : null
const report = {
  kernel: KERNEL,
  home: KEEP ? home : '(removed)',
  driver: run.status,
  mode: MODE,
  everyMs: EVERY,
  window: WINDOW,
  mountAnnouncements: mounts,
  teardownCount: teardowns,
  rows: table,
  driverNotes: events.filter((event) => String(event.event).startsWith('driver') || event.event === 'boot-threw'),
  pluginSeries: seen === null || seen === null ? null : seen.series,
  liveServiceIsCaptured: seen === null ? null : seen.liveServiceIsCaptured,
  liveServiceRetry: seen === null ? null : seen.liveServiceRetry,
  storeType: seen === null ? null : seen.storeType,
  storeKeys: seen === null ? null : seen.storeKeys,
  logTail: logLines.slice(-8),
}
console.log(JSON.stringify(report, undefined, 2))
if (!KEEP) rmSync(home, { recursive: true, force: true })
process.exit(seen === null ? 1 : 0)
