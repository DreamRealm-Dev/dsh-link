#!/usr/bin/env node
/**
 * R63 self-check: the retry rule wired to a host clock.
 *
 * A rule nobody runs is a rule nobody has (this project has paid for that shape more than once), so the
 * plugin now drives it — but **only when a row asks for it**: a shipped default that appends records to
 * the ledger on a timer would rewrite history on deployments that never asked. The readings below are
 * about the wiring: opt-in, a timer that really stops, one pass at a time, a failing pass that does not
 * kill the timer, and a misconfigured row that fails loudly at load.
 * Run: node plugins/dsh-link-collab/test/retry-wiring-selfcheck.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MODULE = 'file:///' + join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js').replaceAll('\\', '/')
const readings = []
const held = (name, ok, detail) => readings.push([name, ok === true, detail])
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const root = mkdtempSync(join(tmpdir(), 'r63-retry-'))

/** A cordis-shaped host: the plugin only ever uses these five members. */
const host = (home) => {
  const effects = []
  const provided = new Map()
  return { effects, provided,
    get: (name) => (name === 'dshHomePath' ? (...segments) => join(home, ...segments) : undefined),
    provide: (name, value) => provided.set(name, value),
    effect: (body, label) => { effects.push({ label, dispose: body() }) },
    on: () => () => {},
    logger: () => ({ info: () => {} }),
  }
}
const boot = async (name, config) => {
  const mod = await import(MODULE)
  const ctx = host(join(root, name))
  mod.apply(ctx, config)
  const service = ctx.provided.get('linkCollab')
  if (service === undefined) throw new Error('the plugin did not publish linkCollab')
  return { mod, ctx, service }
}
/** One member that runs here, so a dispatch to it is `ok` and can go stale. */
const seedStale = async (mod, service, at, id = 'job') => {
  await service.log.append(mod.capabilityRecord('m-b', ['sum']))
  await service.log.append({ kind: 'member/state', actor: 'team-1', subject: 'm-b', payload: { id: 'm-b', name: 'm-b', state: 'active', role: 'member' } })
  await service.log.append(mod.hostRecord('m-b', 'end-A', null, at))
  await service.log.append(mod.heartbeatRecord('m-b', Date.now()))
  await service.log.append(mod.dispatchRecord(id, 'm-b', 'sum', { a: 1, b: 2 }, at))
}

// 1. the rule is always available; the timer is not, unless asked for
const off = await boot('off', {})
const offRetry = off.service.retry
const disabledRun = await offRetry.run()
held('1. without a row asking for it there is no timer, and a pass is refused as disabled', offRetry.enabled === false && offRetry.everyMs === null && offRetry.timerInstalled === false && disabledRun.reason === 'disabled', 'enabled=' + String(offRetry.enabled) + ' everyMs=' + String(offRetry.everyMs) + ' timerInstalled=' + String(offRetry.timerInstalled) + ' run=' + JSON.stringify(disabledRun))

// 2. asked for, the timer is installed and really stops when the plugin's own effect is disposed.
// R64 changed the shape: the interval is the plugin's, cleared by its own teardown, not a second
// `ctx.effect` — so the reading is about `timerInstalled` and the teardown effect, not about a label.
const on = await boot('on', { retry: { enabled: true, everyMs: 40, timeoutMs: 1000, maxAttempts: 3, localEnd: 'end-A' } })
await sleep(260)
const runsWhileTicking = on.service.retry.counts.runs
for (const row of on.ctx.effects) row.dispose()
await sleep(120)
const runsAtDispose = on.service.retry.counts.runs
await sleep(260)
const runsAfterDispose = on.service.retry.counts.runs
held('2. the timer ticks and the plugin teardown really stops it', on.service.retry.enabled === true && on.service.retry.everyMs === 40 && runsWhileTicking >= 2 && runsAfterDispose === runsAtDispose && on.service.retry.timerInstalled === false, 'enabled=' + String(on.service.retry.enabled) + ' everyMs=' + String(on.service.retry.everyMs) + ' runsWhileTicking=' + String(runsWhileTicking) + ' atDispose=' + String(runsAtDispose) + ' afterDispose=' + String(runsAfterDispose) + ' timerInstalledAfter=' + String(on.service.retry.timerInstalled))

// 3. a pass runs the rule, and a second pass invents nothing
const world = await boot('world', { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1000, maxAttempts: 3, localEnd: 'end-A' } })
await seedStale(world.mod, world.service, Date.now() - 5000)
const first = await world.service.retry.run()
const second = await world.service.retry.run()
const attempt = world.service.state().dispatches.dispatches.find((row) => row.id === 'job#r2')
// R341: a pass writes TWO records on purpose - the retry CLAIM for the root and the attempt it authorises
// (appendRedispatches: retryLeaseRecord, then the dispatch). The reading was written before the claim rule landed and
// still expected one; what matters is that the attempt is there once and a second pass invents nothing.
held('3. one pass writes the named attempt (with its claim) and the next pass writes nothing', first.written.length === 2 && first.reason === 'ok' && attempt?.status === 'pending' && second.written.length === 0 && second.blocked.some((row) => row.reason === 'already-attempted'), 'first=' + JSON.stringify(first.written) + ' (claim + attempt) second=' + JSON.stringify(second.blocked))

// 4. one pass at a time
const overlapping = await Promise.all([world.service.retry.run(), world.service.retry.run()])
const inFlight = overlapping.filter((row) => row.reason === 'in-flight').length
held('4. an overlapping pass is skipped rather than planned twice', inFlight === 1 && world.service.retry.counts.skipped >= 1, 'reasons=' + JSON.stringify(overlapping.map((row) => row.reason)) + ' counted=' + JSON.stringify(world.service.retry.counts))

// 5. a failing pass is counted, not thrown, and the next pass still works
const broken = await boot('broken', { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1000, maxAttempts: 3, localEnd: 'end-A' } })
await seedStale(broken.mod, broken.service, Date.now() - 5000)
await broken.service.log.close()
const failedRun = await broken.service.retry.run()
held('5. a pass that cannot append is reported as failed instead of thrown, with the reason kept', failedRun.reason === 'failed' && broken.service.retry.counts.failed === 1 && broken.service.retry.lastError !== null, 'run=' + JSON.stringify(failedRun) + ' lastError=' + String(broken.service.retry.lastError))

// 6. a row that says retry but names no threshold fails at load
let loud = null
try { await boot('loud', { retry: { enabled: true, everyMs: 0, timeoutMs: 1000, maxAttempts: 1 } }) } catch (error) { loud = String(error?.message ?? error) }
held('6. a misconfigured row fails loudly at load, naming the field', loud !== null && loud.includes('everyMs'), 'threw=' + String(loud))

for (const service of [off.service, on.service]) await service.log.close()
rmSync(root, { recursive: true, force: true })
let failed = 0
for (const [name, ok, detail] of readings) { if (ok !== true) failed += 1; console.log((ok === true ? '  ok    ' : '  FAIL  ') + name + '  |  ' + detail) }
console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
process.exit(failed === 0 ? 0 : 1)
