#!/usr/bin/env node
// R73 alive-control: present - per-sample rootAlive plus compositionAliveMs and a verdict for readings taken past it
/**
 * R64: the retry wiring under a REAL fiber.
 *
 * R63 verified the wiring against a host object this repository wrote — a cordis-shaped stand-in. That
 * proves the plugin's own logic, and it proves nothing about the thing the wiring depends on: that the
 * kernel's `ctx.effect` really keeps the disposer our body returns, and that disposing the row's fiber
 * really stops the timer. The kernel's own rule is that a product-visible plugin needs a real-composition
 * test; this is that test, narrowed to one plugin and four readings.
 *
 * Instrument: a throwaway DSH_HOME, a profile initialized from a shipped template, a patch that inserts
 * our plugin row plus a calibration row (so "the boot never reached the mount stage" cannot be mistaken
 * for "the row was refused"), a junction so the loader can resolve the plugin by name, and a driver that
 * runs inside the kernel's module graph, reads the live service, waits, disposes the row's fiber, and
 * writes what it saw to a JSON file.
 *
 * R67's correction, which this instrument now carries: the `headless` profile requires a task
 * (packages/bundle/headless/src/index.ts:329) and hands the launcher an exit request, so the app fiber
 * is disposed a moment after `runProfile` resolves. Every reading taken after that instant describes an
 * app that no longer exists - which is exactly how "our timer ticks once" was produced. Each sample
 * therefore also reads a ROOT-provided service: while `dshHomePath` resolves, the composition is alive;
 * when it stops resolving, the readings after that point are void. For a composition that genuinely stays
 * up, use scripts/probe-kernel-live.mjs (a direct boot with no bundle that can end the work).
 *
 * Usage: cd <kernel> && node --import tsx/esm <repo>/scripts/probe-retry-boot.mjs [--keep]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const NL = String.fromCharCode(10)
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KERNEL = resolve(process.env.DSH_LINK_KERNEL ?? join(REPO, 'core', 'deepseek-harness'))
const KEEP = process.argv.includes('--keep')
const PROFILE = 'r64retry'
const BOOT_TIMEOUT = Number((process.argv.includes('--timeout') ? process.argv[process.argv.indexOf('--timeout') + 1] : null) ?? '240000')
const PLUGIN_DIR = join(REPO, 'plugins', 'dsh-link-collab')
const PROFILE_BOOT = pathToFileURL(join(KERNEL, 'apps/cli/src/profile-boot.ts')).href
const APP_BOOT = pathToFileURL(join(KERNEL, 'packages/boot/app-boot/src/index.ts')).href

if (!existsSync(join(KERNEL, 'apps/cli/src/profile-boot.ts'))) {
  process.stderr.write('run this with the kernel checkout available; missing ' + join(KERNEL, 'apps/cli/src/profile-boot.ts') + NL)
  process.exit(2)
}

const home = mkdtempSync(join(tmpdir(), 'r64-retry-boot-'))
const profileDir = join(home, 'profiles', PROFILE)
const marker = join(home, 'marker.jsonl')
const observations = join(home, 'observations.json')
writeFileSync(marker, '')

const runTsx = (script, env, timeout = 180000) => {
  const file = join(home, 'step-' + String(Math.abs(script.length)) + '.mjs')
  writeFileSync(file, script, 'utf8')
  return spawnSync(process.execPath, ['--import', 'tsx/esm', file], { cwd: KERNEL, encoding: 'utf8', timeout, env: { ...process.env, ...env } })
}

// 1. a profile from a shipped template
const init = runTsx([
  'import { initializeProfileFromDefault } from ' + JSON.stringify(PROFILE_BOOT),
  'try {',
  '  initializeProfileFromDefault(process.env.R64_PROFILE, process.env.R64_TEMPLATE, process.env.DSH_HOME)',
  "  process.stdout.write('OK')",
  "} catch (error) { process.stdout.write('FAIL ' + String(error && error.message ? error.message : error)) }",
].join(NL), { DSH_HOME: home, R64_PROFILE: PROFILE, R64_TEMPLATE: process.argv.includes('--template') ? process.argv[process.argv.indexOf('--template') + 1] : 'headless' }, 120000)
const initText = ((init.stdout ?? '') + (init.stderr ?? '')).trim()
if (!initText.startsWith('OK')) {
  process.stderr.write('profile init failed: ' + initText.slice(0, 500) + NL)
  process.exit(2)
}

// 2. the calibration row: a local module that must mount, so a silent boot is not read as a refusal
const calibration = join(home, 'calibration.mjs')
writeFileSync(calibration, [
  'export const name = R64_CALIBRATION_NAME'.replace('R64_CALIBRATION_NAME', "'r64-calibration'"),
  'export function apply(ctx, config) {',
  "  const { appendFileSync } = require('node:fs')",
].join(NL), 'utf8')
// (the calibration module is written properly below: ESM, no require)
writeFileSync(calibration, [
  "import { appendFileSync } from 'node:fs'",
  "export const name = 'r64-calibration'",
  'export function apply(ctx, config) {',
  "  appendFileSync(process.env.R64_MARKER, JSON.stringify({ event: 'calibration-apply', config: config === undefined ? null : config }) + String.fromCharCode(10))",
  "  return () => { appendFileSync(process.env.R64_MARKER, JSON.stringify({ event: 'calibration-dispose' }) + String.fromCharCode(10)) }",
  '}',
].join(NL), 'utf8')

// 2b. a second calibration module that installs its OWN interval and writes a marker per tick: this is
// the instrument that separates "our wiring is wrong" from "timers do not keep ticking in this boot".
const timerCalibration = join(home, 'calibration-timer.mjs')
writeFileSync(timerCalibration, [
  "import { appendFileSync } from 'node:fs'",
  "export const name = 'r64-calibration-timer'",
  'export function apply(ctx) {',
  "  const note = (event) => appendFileSync(process.env.R64_MARKER, JSON.stringify({ event }) + String.fromCharCode(10))",
  "  note('timer-calibration-apply')",
  "  const timer = setInterval(() => note('timer-calibration-tick'), 40)",
  "  return () => { clearInterval(timer); note('timer-calibration-dispose') }",
  '}',
].join(NL), 'utf8')

// 3. the row that inserts our plugin, and the junction that makes its name resolvable
const retryEnabled = !process.argv.includes('--no-retry')
const retry = retryEnabled
  ? { enabled: true, everyMs: 40, timeoutMs: 1000, maxAttempts: 3, team: 'team-1', localEnd: 'end-A' }
  : { enabled: false }
const rows = [
  { insert: [
    { id: 'r64-calibration', name: calibration, config: { calibration: true } },
    { id: 'r64-calibration-timer', name: timerCalibration },
    { id: 'dsh-link-collab', name: 'dsh-link-collab', config: { logDir: 'probe', retry } },
  ] },
]
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'cordis.patch.yml'), JSON.stringify(rows, undefined, 2) + NL, 'utf8')
const modules = join(profileDir, 'node_modules')
mkdirSync(modules, { recursive: true })
const target = join(modules, 'dsh-link-collab')
try { symlinkSync(PLUGIN_DIR, target, 'junction') } catch (error) { process.stderr.write('junction failed: ' + String(error?.message ?? error) + NL) }

// 4. the driver: it boots the profile, reads the service, waits, disposes the row's fiber, and records
const driver = join(home, 'driver.mjs')
writeFileSync(driver, [
  "import { appendFileSync, writeFileSync } from 'node:fs'",
  "const NL = String.fromCharCode(10)",
  "const note = (event, extra) => { try { appendFileSync(process.env.R64_MARKER, JSON.stringify({ event, at: Date.now(), ...(extra ?? {}) }) + NL) } catch { /* best effort */ } }",
  "const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))",
  "const observation = { boot: null, service: null, before: null, after: null, disposed: null, afterDispose: null, error: null }",
  "const start = Date.now()",
  "let loopTicks = 0",
  "const loopTimer = setInterval(() => { loopTicks += 1 }, 20)",
  'const main = async () => {',
  "  const boot = await import(process.env.R64_PROFILE_BOOT_URL)",
  "  const appBoot = await import(process.env.R64_APP_BOOT_URL)",
  "  let result = null",
  "  try { result = await boot.runProfile({ environment: appBoot.loadLayeredEnv('dsh'), profile: process.env.R64_PROFILE, patchFiles: [], args: [] }) } catch (error) { observation.boot = { settled: false, message: String(error?.message ?? error) }; note('boot-threw', { message: observation.boot.message }); writeFileSync(process.env.R64_OUT, JSON.stringify(observation, undefined, 2)); process.exit(0) }",
  "  observation.boot = { settled: true, message: null }",
  "  const ctx = result.ctx",
  "  const read = (name) => { try { return { present: true, value: ctx.reflect.get(name, false) } } catch (error) { return { present: false, error: String(error?.message ?? error) } } }",
  "  const held = read('linkCollab')",
  "  const service = held.present ? held.value : undefined",
  "  observation.service = { present: service !== undefined && service !== null, keys: service && typeof service === 'object' ? Object.keys(service) : [], read: held.error ?? null }",
  "  if (service && service.retry) { observation.service.retry = { enabled: service.retry.enabled, everyMs: service.retry.everyMs } }",
  "  observation.loaderShape = { type: typeof ctx.loader, keys: ctx.loader ? Object.keys(ctx.loader).slice(0, 12) : null }",
  "  const rootAlive = () => { try { return ctx.reflect.get('dshHomePath', false) !== undefined } catch { return false } }",
  "  const sample = () => {",
  "    const now = service && typeof service === 'object' ? (() => { try { return ctx.reflect.get('linkCollab', false) } catch { return undefined } })() : undefined",
  "    const retry = service && service.retry",
  "    return { at: Date.now() - start, loopTicks, rootAlive: rootAlive(), live: now === service, runs: retry ? retry.counts.runs : null, ticks: retry ? (retry.counts.ticks ?? null) : null, written: retry ? retry.counts.written : null, skipped: retry ? retry.counts.skipped : null, failed: retry ? retry.counts.failed : null, timerInstalled: retry ? (retry.timerInstalled ?? null) : null, lastReason: retry ? (retry.lastReason ?? null) : null }",
  "  }",
  "  const series = [sample()]",
  "  for (let i = 0; i < 9; i += 1) { await sleep(150); series.push(sample()) }\n",
  "  observation.series = series",
  "  observation.seriesNote = 'ticks is the interval callback entry count (R66); live says whether the service this driver captured is still the one the kernel publishes; rootAlive says whether the composition itself is still up (R67)'",
  "  const fresh = (() => { try { return ctx.reflect.get('linkCollab', false) } catch { return undefined } })()",
  "  observation.liveServiceIsCaptured = fresh === service",
  "  observation.liveServiceRetry = fresh && fresh.retry ? { enabled: fresh.retry.enabled, ticks: fresh.retry.counts.ticks ?? null, runs: fresh.retry.counts.runs, timerInstalled: fresh.retry.timerInstalled ?? null } : null",
  "  observation.entryCount = (ctx.loader && typeof ctx.loader.entries === 'function' ? ctx.loader.entries().length : null)",
  "  observation.before = service && service.retry ? { ...service.retry.counts } : null",
  "  const entries = ctx.loader && typeof ctx.loader.entries === 'function' ? ctx.loader.entries() : []",
  "  const row = entries.find((entry) => entry?.options?.name === 'dsh-link-collab')",
  "  observation.entryNames = entries.map((entry) => (entry && entry.options ? entry.options.name : null))",
  "  observation.disposed = { found: row !== undefined, hadFiber: Boolean(row && row.fiber) }",
  "  if (row && row.fiber) { await row.fiber.dispose() } else { observation.disposed.error = 'no fiber for the row' }",
  "  await sleep(180)",
  "  observation.direct = null",
  "  if (service && service.retry && typeof service.retry.run === 'function') { const direct = await service.retry.run(); observation.direct = { reason: direct.reason, written: direct.written.length, counts: { ...service.retry.counts } } }\n",
  "  observation.after = service && service.retry ? { ...service.retry.counts } : null",
  "  await sleep(260)",
  "  observation.afterDispose = service && service.retry ? { ...service.retry.counts } : null",
  "  writeFileSync(process.env.R64_OUT, JSON.stringify(observation, undefined, 2))",
  "  clearInterval(loopTimer)",
  "  note('driver-done', { loopTicks })",
  "  process.exit(0)",
  '}',
  'main()',
].join(NL), 'utf8')

const env = {
  ...process.env,
  DSH_HOME: home,
  R64_PROFILE: PROFILE,
  R64_MARKER: marker,
  R64_OUT: observations,
  DSH_LINK_COLLAB_TRACE_TEARDOWN: '1',
  R64_PROFILE_BOOT_URL: PROFILE_BOOT,
  R64_APP_BOOT_URL: APP_BOOT,
}
const run = spawnSync(process.execPath, ['--import', 'tsx/esm', driver], { cwd: KERNEL, encoding: 'utf8', timeout: BOOT_TIMEOUT, env })
const log = ((run.stdout ?? '') + (run.stderr ?? '')).trim()
const markerLines = existsSync(marker) ? readFileSync(marker, 'utf8').split(/\r?\n/).filter((line) => line !== '') : []
const seen = existsSync(observations) ? JSON.parse(readFileSync(observations, 'utf8')) : null
const logLines = log.split(/\r?\n/)
// R66: our plugin announces its mount on stdout and (behind a flag) prints a stack when its teardown
// runs. Counting those lines is what tells a stopped timer apart from a row that was mounted twice.
const mounts = logLines.filter((line) => line.includes('[dsh-link-collab] control channel ready'))
// The trace is a marker line followed by stack frames on their own lines, so take the frames with it.
const teardownLines = logLines
  .map((line, index) => (line.includes('[dsh-link-collab] teardown') ? logLines.slice(index, index + 6).join(String.fromCharCode(10)) : null))
  .filter((block) => block !== null)
  .map((block) => block.replace(/\s+/g, ' ').slice(0, 900))
const controlTicks = markerLines.filter((line) => line.includes('timer-calibration-tick')).length
// R67: a reading is only about this composition while its root services still resolve.
const sampled = seen === null ? [] : (seen.series ?? [])
const aliveUntil = (() => {
  let last = null
  for (const one of sampled) { if (one.rootAlive === true) last = one.at; else break }
  return last
})()
const report = {
  kernel: KERNEL,
  compositionAliveMs: aliveUntil,
  readingsValidAfterShutdown: sampled.length > 0 && sampled[sampled.length - 1].rootAlive !== true
    ? 'the app was disposed at or before the last sample; readings past compositionAliveMs describe no composition'
    : null,
  home: KEEP ? home : '(removed)',
  driver: run.status,
  mountAnnouncements: mounts.length,
  mountLines: mounts.map((line) => line.slice(0, 160)),
  teardownCount: teardownLines.length,
  teardownLines,
  controlTimerTicks: controlTicks,
  marker: markerLines,
  observations: seen,
  logTail: logLines.slice(-12),
}
console.log(JSON.stringify(report, undefined, 2))
if (!KEEP) rmSync(home, { recursive: true, force: true })
process.exit(seen === null ? 1 : 0)
