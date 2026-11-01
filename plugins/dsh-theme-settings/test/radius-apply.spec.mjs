/**
 * The idle debounce's seams, driven directly: the shipped applier, the shipped token writer and
 * the shipped hook reader, with only the browser and the material engine stubbed.
 *
 * Needs no page and no DSH: the module under test imports nothing, so node can run it as it is.
 *   node plugins/dsh-theme-settings/test/radius-apply.spec.mjs
 *
 * The four properties the deferred apply is worth anything for — exactly one global apply per
 * burst, none when the value did not change, cancelled and restarted by further input, and never
 * an apply while the control is still moving — are measured here on real timers, at a scaled
 * window so the suite stays quick. The shipped 3000 ms window is measured once, in check 7, and
 * its value is asserted in check 1.
 */
import {
  createRadiusApplier, lgSweep, PANEL_RADIUS_STEP, RADIUS_APPLY_IDLE_MS, writeRadiusTokens,
} from '../src/client/radius-apply.ts'

/** A stand-in for `document.documentElement` that records what an inline write did. */
const createTokenTarget = () => {
  const tokens = new Map()
  const writes = []
  return {
    writes,
    tokens,
    style: { setProperty: (name, value) => { writes.push([name, value]); tokens.set(name, value) } },
  }
}

/** A stand-in for the engine's published hook, counting the sweeps it is asked for. */
const createEngine = () => {
  let sweeps = 0
  return { host: { __lgSweep: { sweep: () => { sweeps += 1 } } }, sweeps: () => sweeps }
}

/** One applier wired to the real writers, with the counts a check needs. */
const harness = (idleMs) => {
  const target = createTokenTarget()
  const engine = createEngine()
  const sweep = lgSweep(engine.host)
  const applier = createRadiusApplier({
    applyTokens: radius => writeRadiusTokens(target, radius),
    redressSurfaces: () => sweep(),
  }, idleMs)
  return { target, engine, applier }
}

const sleep = ms => new Promise(done => setTimeout(done, ms))
/** Wait for a condition, reporting how long it took; returns the elapsed ms, or -1 on timeout. */
const until = async (predicate, timeoutMs) => {
  const started = Date.now()
  for (;;) {
    if (predicate()) return Date.now() - started
    if (Date.now() - started > timeoutMs) return -1
    await sleep(5)
  }
}

const results = []
const check = (label, ok, detail = '') => results.push({ ok, label, detail })

// ── 1) the shipped numbers, read from the module rather than restated ──────────────────────────
const target = createTokenTarget()
writeRadiusTokens(target, 24)
check('the shipped idle window is 3 s and the panel step is 6 px',
  RADIUS_APPLY_IDLE_MS === 3000 && PANEL_RADIUS_STEP === 6,
  'RADIUS_APPLY_IDLE_MS=' + RADIUS_APPLY_IDLE_MS + ' PANEL_RADIUS_STEP=' + PANEL_RADIUS_STEP)
check('one write moves both tokens (' + JSON.stringify([...target.tokens]) + ')',
  target.tokens.get('--lg-radius-window') === '24px' && target.tokens.get('--lg-radius-panel') === '30px',
  'window=' + target.tokens.get('--lg-radius-window') + ' panel=' + target.tokens.get('--lg-radius-panel'))

// ── 2) a burst while the control is still moving: nothing runs ─────────────────────────────────
const burst = harness(80)
for (const radius of [13, 14, 15, 16, 17]) { burst.applier.note(radius); await sleep(15) }
await sleep(60)
check('no apply while the control is still moving (60 ms into an 80 ms window)',
  burst.engine.sweeps() === 0 && burst.target.writes.length === 0 && burst.applier.applied() === undefined,
  'sweeps=' + burst.engine.sweeps() + ' tokenWrites=' + burst.target.writes.length)

// ── 3) exactly one global apply per burst, for the value the burst ended on ────────────────────
const settled = await until(() => burst.applier.applied() !== undefined, 1000)
await sleep(120)
check('exactly one global apply per burst, for the last value',
  settled >= 0 && burst.engine.sweeps() === 1 && burst.applier.applied() === 17
  && burst.target.writes.length === 2 && burst.target.tokens.get('--lg-radius-window') === '17px',
  'applied after ' + settled + ' ms; sweeps=' + burst.engine.sweeps() + ' tokenWrites=' + burst.target.writes.length
  + ' applied=' + burst.applier.applied())
check('a burst of 5 inputs is one global apply, not five', burst.engine.sweeps() === 1, 'sweeps=' + burst.engine.sweeps())

// ── 4) the same value again: nothing, and it stays nothing ─────────────────────────────────────
burst.applier.note(17)
const quiet = await sleep(220)
check('no apply when the value did not change (idempotence from the outside)',
  burst.engine.sweeps() === 1 && burst.target.writes.length === 2 && burst.applier.applied() === 17 && quiet === undefined,
  'sweeps=' + burst.engine.sweeps() + ' tokenWrites=' + burst.target.writes.length)

// ── 5) further input cancels and restarts the window ───────────────────────────────────────────
const restart = harness(100)
restart.applier.note(20)
await sleep(60)
const early = restart.applier.applied()
restart.applier.note(24)
await sleep(60)
const midWindow = restart.applier.applied()
const restarted = await until(() => restart.applier.applied() !== undefined, 1000)
check('further input cancels the pending apply and restarts the window',
  early === undefined && midWindow === undefined && restarted >= 0
  && restart.applier.applied() === 24 && restart.engine.sweeps() === 1
  && restart.target.writes.map(([, value]) => value).join(',') === '24px,30px',
  'at +60 ms: ' + early + ', +120 ms (60 after the second note): ' + midWindow + ', applied after the second note: '
  + restarted + ' ms; tokens=' + JSON.stringify([...restart.target.tokens]))

// ── 6) teardown drops the pending apply ────────────────────────────────────────────────────────
const torn = harness(60)
torn.applier.note(24)
torn.applier.cancel()
await sleep(150)
check('cancel() drops the pending apply', torn.engine.sweeps() === 0 && torn.target.writes.length === 0,
  'sweeps=' + torn.engine.sweeps() + ' tokenWrites=' + torn.target.writes.length)

// ── 7) the shipped 3000 ms window, measured ────────────────────────────────────────────────────
const real = harness()
const before = Date.now()
real.applier.note(24)
const measured = await until(() => real.applier.applied() !== undefined, RADIUS_APPLY_IDLE_MS + 1500)
const elapsed = Date.now() - before
check('the shipped window applies 3000 ms after the last input, not sooner',
  measured >= 0 && elapsed >= RADIUS_APPLY_IDLE_MS && elapsed <= RADIUS_APPLY_IDLE_MS + 600 && real.engine.sweeps() === 1,
  'measured ' + elapsed + ' ms from note to apply (window ' + RADIUS_APPLY_IDLE_MS + ' ms), sweeps=' + real.engine.sweeps())

// ── 8) the hook reader: the engine's sweep, or nothing ─────────────────────────────────────────
const engine = createEngine()
const read = lgSweep(engine.host)
read()
check('lgSweep() hands back the engine sweep and nothing else',
  typeof read === 'function' && engine.sweeps() === 1
  && lgSweep({}) === undefined && lgSweep(undefined) === undefined && lgSweep({ __lgSweep: {} }) === undefined,
  'engine sweeps after one call: ' + engine.sweeps() + '; no hook: ' + lgSweep({}))

// ── 9) the token writer is idempotent: a second identical apply changes no value ────────────────
const twice = createTokenTarget()
writeRadiusTokens(twice, 24)
const afterFirst = JSON.stringify([...twice.tokens])
writeRadiusTokens(twice, 24)
const afterSecond = JSON.stringify([...twice.tokens])
check('writing the same radius twice changes nothing',
  afterFirst === afterSecond && twice.writes.length === 4 && twice.tokens.size === 2,
  'state after 1st ' + afterFirst + ', after 2nd ' + afterSecond + ', ' + twice.writes.length + ' writes')

let failed = 0
for (const result of results) {
  if (result.ok) console.log('  PASS  ' + result.label + '  [' + result.detail + ']')
  else { failed += 1; console.log('  FAIL  ' + result.label + '  [' + result.detail + ']') }
}
console.log('')
console.log((results.length - failed) + '/' + results.length + ' passed — radius idle debounce')
process.exit(failed === 0 ? 0 : 1)
