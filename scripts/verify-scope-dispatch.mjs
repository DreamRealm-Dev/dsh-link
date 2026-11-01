#!/usr/bin/env node
/**
 * The plugin's subscription to the Session feed, measured inside a kernel that boots the whole
 * profile — not argued from the outside.
 *
 * This file has been three instruments. It began as a count taken by one listener and compared
 * against others, which was not a measurement: number and listeners could count different things,
 * and the disagreement was read as a property of the kernel. It then became a tombstone gate that
 * asserted the plugin heard NOTHING, because that was true for two rounds — a listener installed
 * with `global: true` on the right event name, in the registry the host dispatches from, that never
 * ran. The tombstone was right to fail when the plugin started recording; what it did not know was
 * that the cause was never the channel or the scope filter, but the plugin's own teardown running
 * at load (see docs/handoff/R14-subscription-lifetime.md).
 *
 * What it asserts now:
 *
 *   the feed is healthy                listeners on one context receive team/task in the same run
 *   installation order is not filtering   three listeners on one context receive the same sequence
 *   a later listener misses only the earlier events   timing, not filtering
 *   the plugin hears the feed          its recorder reports seen/recorded, and its ledger grows
 *   the plugin's hook is in that registry   the hook index names dsh-link-collab as an owner
 *   one bus, both sides obtained       plugin and probe compare the same hook registry, and both
 *                                      readings were obtained (an absent reading is not a result)
 *
 * `--self-attack` arms DSH_LINK_COLLAB_LEGACY_EFFECT (with the master switch), restoring one of
 * the two copies of the defect this round removed — the plugin-level teardown; the recorder-level
 * removed (the teardown written as the `ctx.effect` body). The gate then passes only if the three
 * plugin-side assertions flip while the three feed-side ones still hold: a gate whose failure
 * cannot be localised is not evidence that it measures what it claims.
 *
 * Run:  node scripts/verify-scope-dispatch.mjs [--self-attack]
 * Exit: 0 the asserted set held (armed: exactly the plugin-side ones flipped); 1 it did not;
 *       2 the experiment produced no report.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// opening `rmSync` removed the directory the first one had just written into, and the first run
// then reported "no surface document" — a fact about two instruments, not about the kernel. Both
// the gate and the probe therefore work in a directory nobody else can name.
const ROOT = mkdtempSync(join(PROJECT, '.tmp', 'scope-dispatch-'))
const OUT = join(ROOT, 'surface.json')
const LEDGER = join(ROOT, 'ledger')
const selfAttack = process.argv.includes('--self-attack')

rmSync(ROOT, { recursive: true, force: true })

const boot = spawnSync('node', ['scripts/probe-kernel-surface.mjs', '--out', OUT, '--timeout', '240000'], {
  cwd: PROJECT,
  encoding: 'utf8',
  env: {
    ...process.env,
    NO_COLOR: '1',
    DSH_LINK_PROBE_WIRE: LEDGER,
    // The master switch is what makes a fault flag live at all (the same file ships to production).
    ...(selfAttack ? { DSH_LINK_COLLAB_ATTACKS: '1', DSH_LINK_COLLAB_LEGACY_EFFECT: '1' } : {}),
  },
  maxBuffer: 64 * 1024 * 1024,
})

// The probe's own account of how it ended is printed either way: a run that just barely wrote the
// document and a run that did not are the same code path to a reader who only sees exit codes.
const probeTail = ((boot.stdout ?? '') + (boot.stderr ?? '')).split('\n').filter((line) => line.includes('wait ended:')).slice(-1)[0]
if (probeTail !== undefined) console.log('  probe: ' + probeTail.trim())

if (!existsSync(OUT)) {
  console.error('the experiment produced no surface document (probe exit ' + String(boot.status) + ')')
  console.error(((boot.stdout ?? '') + (boot.stderr ?? '')).split('\n').slice(-12).join('\n'))
  process.exit(2)
}

const report = JSON.parse(readFileSync(OUT, 'utf8')).wire
if (report === null || report === undefined) {
  console.error('the probe produced no wiring report')
  process.exit(2)
}

const deliveries = report.deliveries ?? []
const byTag = (tag) => deliveries.filter((row) => String(row).startsWith(tag + ':'))
const channel = report.channel ?? {}
const recorder = report.recorder ?? {}
const hookFibers = (report.hookIndex ?? []).map((row) => String(row.fiber))
const say = (name, held, detail) => {
  console.log('  ' + (held ? 'ok  ' : 'CHANGED') + '  ' + name + ' — ' + detail)
  return { name, held }
}

// Compared as sets: a permission or sandbox event can fall between two appends, so the order two
// listeners record them in is a race, while the set they receive is not.
const sameSet = (left, right) => {
  const types = (rows) => JSON.stringify(rows.map((row) => String(row).slice(String(row).indexOf(':') + 1)).sort())
  return types(left) === types(right)
}

const feedSide = [
  say('the Session feed carries team events to listeners on one context',
    deliveries.includes('a:team/task') && deliveries.includes('b:team/task') && deliveries.includes('c:team/task'),
    'team/task reached ' + ['a', 'b', 'c'].filter((tag) => deliveries.includes(tag + ':team/task')).join(', ')),
  say('three listeners on one context receive the same deliveries',
    sameSet(byTag('a'), byTag('b')) && sameSet(byTag('b'), byTag('c')),
    'a=' + JSON.stringify(byTag('a')) + ' b=' + JSON.stringify(byTag('b')) + ' c=' + JSON.stringify(byTag('c'))),
  say('a listener installed after the session misses only the earlier events',
    byTag('d').length === 1 && byTag('d')[0] === 'd:team/task',
    'd saw ' + JSON.stringify(byTag('d'))),
]

const pluginSide = [
  say('the plugin recorder hears the feed',
    Number(recorder.seen) >= 1 && Number(recorder.recorded) >= 1 && Number(recorder.failed) === 0,
    'recorder seen=' + String(recorder.seen) + ' recorded=' + String(recorder.recorded)
    + ' ignored=' + String(recorder.ignored) + ' failed=' + String(recorder.failed)),
  // The ledger lives in the plugin's own home (its first fix), and the feed is what writes into it.
  say('its ledger is created and the feed writes into it',
    report.ledgerExists === true && Number(report.records) >= 1 && Number(report.ledgerLines) >= 1,
    'ledger at ' + String(report.logDirectory) + ': exists=' + String(report.ledgerExists)
    + ' records=' + String(report.records) + ' lines=' + String(report.ledgerLines)
    + ' kinds=' + JSON.stringify(report.recordKinds)),
  // The registry is the only place a subscription can be observed from outside the plugin: the hook
  // index names each owner by its fiber and whether the hook is global.
  // A ledger nothing reads back is a file, not a board. The fold is taken through the capability,
  // so this also proves the capability exposes the projection rather than only the log.
  say('what the feed recorded folds back into a board through the capability',
    (report.stateTasks ?? []).some((row) => String(row).startsWith('wired-1/')),
    'folded tasks=' + JSON.stringify(report.stateTasks ?? null) + ' error=' + String(report.stateError ?? 'none')),
  say('the plugin owns a hook in the registry the host dispatches from',
    hookFibers.includes('dsh-link-collab'),
    'owners=' + JSON.stringify(hookFibers) + ' globalHooks=' + String((report.hookIndex ?? []).filter((row) => row.global === true).length)),
]

// Identity of the registry, not of the service: `ctx.events` hands back a fresh traceable proxy on
// every read (vendor/cordis/src/reflect.ts:141 -> utils.ts:117-125,165-173), so a service-object
// comparison is always false and measures nothing. Both sides must also have been obtained: a
// missing reading resolves to unknown, never to a difference.
const identitySide = [
  say('the plugin and the probe read the same hook registry, both readings obtained',
    channel.probeObtained === true && channel.pluginDiagnosticsObtained === true
    && channel.probeSameHooksRegistry === true && channel.pluginSameHooksRegistry === true
    && channel.pluginRootObtained === true,
    'probeObtained=' + String(channel.probeObtained) + ' pluginDiagnosticsObtained=' + String(channel.pluginDiagnosticsObtained)
    + ' probeSameHooksRegistry=' + String(channel.probeSameHooksRegistry)
    + ' pluginSameHooksRegistry=' + String(channel.pluginSameHooksRegistry)
    + ' probeHooks=' + String(channel.probeHooks) + ' pluginLiveHooks=' + String(channel.pluginLiveHooks)),
]

// Not an assertion: the callback is a bound proxy, so `String(callback)` is always
// 'function () { [native code] }'. Identifying a listener by its source text cannot succeed, so
// this reading is printed as context and never decides a verdict.
console.log('  info     callback text cannot identify a listener — reported as ' + String(report.collabHookPresent))
console.log('')

rmSync(ROOT, { recursive: true, force: true })

const results = [...feedSide, ...pluginSide, ...identitySide]
const flipped = (rows) => rows.filter((row) => !row.held)

if (selfAttack) {
  const feedFlipped = flipped(feedSide).length
  const pluginFlipped = flipped(pluginSide).length
  const identityFlipped = flipped(identitySide).length
  console.log('with the defect armed: feed-side flipped=' + String(feedFlipped)
    + ' plugin-side flipped=' + String(pluginFlipped) + '/' + String(pluginSide.length)
    + ' identity-side flipped=' + String(identityFlipped))
  if (pluginFlipped === pluginSide.length && feedFlipped === 0 && identityFlipped === 0) {
    console.log('the armed defect is caught by the plugin-side assertions alone: this gate can fail')
    process.exit(0)
  }
  console.log('the armed defect was NOT localised — this gate cannot tell what it measures')
  process.exit(1)
}

const changed = flipped(results)
if (changed.length === 0) {
  console.log('all ' + String(results.length) + ' assertions held: the feed is healthy and the plugin records from it')
  process.exit(0)
}
console.log(String(changed.length) + ' assertion(s) changed: ' + changed.map((row) => row.name).join('; '))
process.exit(1)
