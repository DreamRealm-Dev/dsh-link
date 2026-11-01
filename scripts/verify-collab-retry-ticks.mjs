#!/usr/bin/env node
/**
 * R66 (task-120): the retry timer's own counters — ticks, and what the counters add up to.
 *
 * What is read: the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js) only — never src. The host
 * below is this gate's own cordis-shaped stand-in, written from the artifact's own surface; the
 * producer's self-check is not imported and its harness is not reused.
 *
 * Why ticks are read at all: `runs` counts passes that reached an outcome, so a timer that stops firing
 * and a timer whose passes are all skipped look the same through `runs` alone. `ticks` is the fact about
 * the CLOCK; the three outcome counters are facts about the WORK. This gate keeps them apart, and then
 * asserts they add up after the timer is quiet.
 *
 * Exit 0 every reading held; 1 a reading failed; 3 an input is missing (the artifact does not carry the
 * surface this gate reads, printed with what is missing) — a gate that cannot see its subject is not a
 * passing gate.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(HERE), '..')
const ENTRY = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const MUTANT_MODULE = join(PROJECT, '.tmp', 'r66-attack-module.mjs')
const MUTANT_GATE = join(PROJECT, '.tmp', 'r66-attack-gate.mjs')
const DECLARED = 8
const MODULE_READING_IDS = ['R1', 'R2', 'R3', 'R4a', 'R4b', 'R5', 'R7']

/** The mutation anchors, in one place, so R7 can say whether they are still in the artifact. */
const ANCHORS = [
  { mutant: 'ticks-increment-removed', from: 'retryCounts.ticks += 1;' },
  { mutant: 'guard-does-not-skip', from: 'if (retryInFlight) {' },
  { mutant: 'teardown-keeps-timer', from: 'clearTimeout(retryTimer);' },
  { mutant: 'last-reason-always-ok', from: 'retryLastReason = "failed";' },
  { mutant: 'retry-on-by-default', from: 'const retryEnabled = retryConfig.enabled === true;' },
  { mutant: 'skipped-not-counted', from: 'retryCounts.skipped += 1;' },
]

const argv = process.argv.slice(2)
const SELF_ATTACK = argv.includes('--self-attack')
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const dumps = (value) => JSON.stringify(value)
const flat = (text) => String(text).replace(/\s+/g, ' ').trim()
const INTERVAL = 20
const WINDOW = INTERVAL * 5

/* ------------------------------------------------------------------------------------------------
 * The surface this gate reads. A missing member is an INPUT problem (exit 3), not a failed reading:
 * the artifact of a round that has not landed yet would otherwise look like a broken product.
 * ---------------------------------------------------------------------------------------------- */
function surfaceProblems(capability) {
  const missing = []
  const retry = capability === undefined ? undefined : capability.retry
  if (retry === undefined || retry === null) return ['retry (the service member)']
  if (typeof retry.run !== 'function') missing.push('retry.run')
  if (typeof retry.enabled !== 'boolean') missing.push('retry.enabled')
  if (typeof retry.timerInstalled !== 'boolean') missing.push('retry.timerInstalled')
  // The contract is `everyMs: number | null`: the member always exists, and it is exactly null while the
  // row is disabled (no interval, so no period). The VALUE is judged inside the worlds below, where a
  // disabled world must read null and an enabled one a positive integer — stricter than a type test here,
  // which would either refuse a correct surface or accept a wrong value.
  if (!('everyMs' in retry)) missing.push('retry.everyMs')
  if (!('lastReason' in retry)) missing.push('retry.lastReason')
  // The clock's fact lives in the counts bag and nowhere else: one fact, one name. A top-level
  // `retry.ticks` is not part of the surface this gate reads, so it is neither required nor accepted.
  const counts = retry.counts
  if (counts === undefined || counts === null) missing.push('retry.counts')
  else for (const key of ['runs', 'skipped', 'failed', 'ticks']) if (typeof counts[key] !== 'number') missing.push('retry.counts.' + key)
  return missing
}

/* ------------------------------------------------------------------------------------------------
 * One run of the readings against whichever artifact is named. A child started by --self-attack
 * points R66_ATTACK_MODULE at a mutated copy; everything else is the shipped file.
 * ---------------------------------------------------------------------------------------------- */
async function runReadings(modulePath) {
  const readings = []
  const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail })
  const check = async (id, name, body) => {
    try { const [ok, detail] = await body(); held(id, name, ok, detail) }
    catch (error) { held(id, name, false, 'threw: ' + String(error?.message ?? error)) }
  }
  const roots = []
  const boards = []
  const freshRoot = () => { const dir = mkdtempSync(join(tmpdir(), 'r66-ticks-')); roots.push(dir); return dir }
  const cleanup = async () => {
    for (const board of boards) {
      const capability = board.provided.get('linkCollab')
      try { await capability?.log?.close?.() } catch { /* already closed */ }
    }
    for (const dir of roots) for (let attempt = 0; attempt < 3; attempt += 1) { try { rmSync(dir, { recursive: true, force: true }); break } catch { await sleep(60) } }
  }
  /** A cordis-shaped host, plus a record of every effect the artifact registered. */
  const host = (root) => {
    const effects = []
    const provided = new Map()
    const ctx = {
      get: (name) => (name === 'dshHomePath' ? (...segments) => join(root, ...segments) : undefined),
      provide: (name, value) => { provided.set(name, value) },
      effect: (body, label) => { const dispose = body(); effects.push({ label: label ?? null, dispose: typeof dispose === 'function' ? dispose : () => {} }); return dispose },
      on: () => () => {},
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    }
    const board = { ctx, effects, provided }
    boards.push(board)
    return board
  }
  const capabilityOf = (board) => board.provided.get('linkCollab')
  const stopEvery = (board) => { for (const effect of board.effects) effect.dispose() }
  const counters = (capability) => ({ ...capability.retry.counts, ticks: capability.retry.counts.ticks })

  const mod = await import(pathToFileURL(modulePath).href)

  // R7: the mutation anchors are still in the artifact, so the mutants below can still bite. A gate whose
  // mutant no longer has a subject reports green for a product nobody is watching.
  await check('R7', 'every mutation anchor is still present in the shipped artifact', async () => {
    const text = readFileSync(modulePath, 'utf8')
    const absent = ANCHORS.filter((anchor) => !text.includes(anchor.from)).map((anchor) => anchor.mutant)
    return [absent.length === 0, 'anchors=' + String(ANCHORS.length) + ' absent=' + dumps(absent)]
  })

  // R1: with the clock running, ticks rise with time. Read after five intervals, so a single fire (at
  // load, or from some other trigger) cannot satisfy it. `runs` is recorded beside it and NOT judged:
  // the whole point of ticks is that they are the clock's fact, and the passes they start settle later.
  await check('R1', 'ticks rise with time while the timer is running (five intervals at least)', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3 } })
    const capability = capabilityOf(board)
    const start = { ticks: capability.retry.counts.ticks, runs: capability.retry.counts.runs }
    await sleep(INTERVAL + WINDOW)
    const end = { ticks: capability.retry.counts.ticks, runs: capability.retry.counts.runs }
    const rise = end.ticks - start.ticks
    return [rise >= 4 && capability.retry.timerInstalled === true,
      'ticks ' + String(start.ticks) + '->' + String(end.ticks) + ' (rise ' + String(rise) + ' over ' + String(WINDOW + INTERVAL) + 'ms)'
      + ' runs ' + String(start.runs) + '->' + String(end.runs) + ' installed=' + String(capability.retry.timerInstalled)]
  })

  // R2: after the plugin's teardown runs, ticks freeze — and the pair is inside the reading: the same
  // world's tick delta was rising before the teardown. A frozen clock satisfies the second half alone.
  await check('R2', 'teardown freezes ticks, while the same world was ticking before it (paired)', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3 } })
    const capability = capabilityOf(board)
    const beforeFirst = capability.retry.counts.ticks
    await sleep(INTERVAL + WINDOW)
    const beforeStop = capability.retry.counts.ticks
    stopEvery(board)
    await sleep(INTERVAL + WINDOW)
    const afterStop = capability.retry.counts.ticks
    return [beforeStop - beforeFirst >= 4 && afterStop === beforeStop && capability.retry.timerInstalled === false,
      'ticking ' + String(beforeFirst) + '->' + String(beforeStop) + ' then frozen at ' + String(afterStop)
      + ' installed=' + String(capability.retry.timerInstalled)]
  })

  // R3: with the row silent, no timer is installed and the clock has fired zero times; the control is the
  // same reading's second world, where the same script's enabled config has ticks above zero.
  await check('R3', 'enabled:false means no timer, zero ticks and everyMs null, while the enabled world ticks and names a period (control)', async () => {
    const silentBoard = host(freshRoot())
    mod.apply(silentBoard.ctx, { retry: { enabled: false, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3 } })
    const silent = capabilityOf(silentBoard)
    await sleep(INTERVAL + WINDOW)
    const loudBoard = host(freshRoot())
    mod.apply(loudBoard.ctx, { retry: { enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3 } })
    const loud = capabilityOf(loudBoard)
    await sleep(INTERVAL + WINDOW)
    return [silent.retry.counts.ticks === 0 && silent.retry.timerInstalled === false
      && silent.retry.everyMs === null
      && Number.isInteger(loud.retry.everyMs) && loud.retry.everyMs > 0
      && loud.retry.counts.ticks > 0 && loud.retry.timerInstalled === true,
      'silent ticks=' + String(silent.retry.counts.ticks) + ' installed=' + String(silent.retry.timerInstalled)
      + ' everyMs=' + dumps(silent.retry.everyMs)
      + ' | enabled ticks=' + String(loud.retry.counts.ticks) + ' installed=' + String(loud.retry.timerInstalled)
      + ' everyMs=' + dumps(loud.retry.everyMs)]
  })

  // R4a: the clock and the work add up — but only in a world NOBODY calls by hand, and only after the
  // timer is quiet and the passes it started have settled. A hand-run pass adds runs (or skipped) with no
  // tick behind it, so equality is a claim about this world and not a general identity: the frozen
  // invariant is ticks >= runs + skipped + failed, and R4b is where the difference shows.
  await check('R4a', 'in a world with no hand-run pass, ticks === runs + skipped + failed once the timer is quiet', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3 } })
    const capability = capabilityOf(board)
    await sleep(INTERVAL + WINDOW)
    stopEvery(board)
    await sleep(WINDOW)
    const counts = capability.retry.counts
    const total = counts.runs + counts.skipped + counts.failed
    return [counts.ticks > 0 && counts.ticks === total,
      'quiet ticks=' + String(counts.ticks) + ' runs=' + String(counts.runs) + ' skipped=' + String(counts.skipped)
      + ' failed=' + String(counts.failed) + ' total=' + String(total)]
  })

  // R4b: a hand-run pass moves the WORK and not the CLOCK, and the overlap is a real skip. This is the
  // discriminator R65 lacked: a timer that stopped firing and a pass that is never reached look the same
  // through runs alone, while ticks separates them. Paired inside one world: the same counters are read
  // before and after the two hand-run passes.
  await check('R4b', 'a hand-run pass raises runs and skipped while ticks stays put (both sides in one world)', async () => {
    const board = host(freshRoot())
    // A period nobody reaches during the reading: every counter movement below comes from the hand-runs.
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1000, maxAttempts: 3 } })
    const capability = capabilityOf(board)
    const before = capability.retry.counts
    const [first, second] = await Promise.all([capability.retry.run(), capability.retry.run()])
    const after = capability.retry.counts
    stopEvery(board)
    const reasons = [first.reason, second.reason]
    return [after.ticks === before.ticks
      && after.runs === before.runs + 1
      && after.skipped === before.skipped + 1
      && reasons.includes('in-flight'),
      'ticks ' + String(before.ticks) + '->' + String(after.ticks) + ' runs ' + String(before.runs) + '->' + String(after.runs)
      + ' skipped ' + String(before.skipped) + '->' + String(after.skipped) + ' reasons=' + dumps(reasons)]
  })

  // R5: lastReason names the most recent pass's outcome, and is null until one has run. Three legs in one
  // reading, so "it always returns something" cannot pass: never-run, a pass that really wrote something,
  // and a pass that really could not append.
  //
  // The third leg needs work to append, or the appender never runs and "the ledger is gone" changes
  // nothing: the world below therefore holds a member of the team, its capability, and a dispatch whose
  // (1 ms) deadline has already passed, so every pass plans a redispatch and tries to write it. Pairing is
  // inside the reading: the leg before the ledger is closed must read ok, with the written counter up.
  await check('R5', 'lastReason: null before any pass, ok after a pass that wrote, failed after the ledger is gone', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1, maxAttempts: 10, team: 'team-1', localEnd: 'end-A' } })
    const capability = capabilityOf(board)
    const beforeAny = capability.retry.lastReason
    const never = beforeAny === null || beforeAny === undefined
    // The member's team is read off the record's actor (the recorder writes the team id there), so a
    // member record without it is a member of no team — and a route to it answers not-in-team, which
    // leaves the plan with nothing to append and the third leg with nothing to fail on.
    await capability.log.append({ kind: 'member/state', actor: 'team-1', subject: 'end-A', payload: { id: 'end-A', state: 'active', name: 'end-A' } })
    await capability.log.append({ kind: 'task/state', actor: 'team-1', subject: 'task-1', payload: { id: 'task-1', state: 'in_progress', owner: 'end-A' } })
    await capability.log.append(mod.capabilityRecord('end-A', ['probe-tool']))
    await capability.log.append(mod.dispatchRecord('job-1', 'end-A', 'probe-tool', {}, Date.now() - 1000))
    const ok = await capability.retry.run()
    const afterOk = capability.retry.lastReason
    const writtenOk = capability.retry.counts.written
    await capability.log.close()
    const failed = await capability.retry.run()
    const afterFailed = capability.retry.lastReason
    const failedCount = capability.retry.counts.failed
    stopEvery(board)
    return [never && ok.reason === 'ok' && writtenOk >= 1 && afterOk === 'ok'
      && failed.reason === 'failed' && afterFailed === 'failed' && failedCount === 1,
      'beforeAny=' + dumps(beforeAny) + ' afterOk=' + dumps(afterOk) + ' writtenOk=' + String(writtenOk)
      + ' afterFailed=' + dumps(afterFailed) + ' failedCount=' + String(failedCount) + ' runs=' + dumps([ok.reason, failed.reason])]
  })

  // R6: the gate's own declaration of how many readings exist is not allowed to drift.
  await check('R6', 'the declared reading count matches the readings this run produced', async () => {
    return [DECLARED === readings.length + 1, 'declared=' + String(DECLARED) + ' produced=' + String(readings.length)]
  })

  await cleanup()
  return readings
}

const report = (readings) => {
  let failed = 0
  for (const row of readings) { if (!row.ok) failed += 1; console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + '  ' + row.name + (row.ok ? '' : '  |  ' + row.detail)) }
  console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
  return failed
}

/* ------------------------------------------------------------------------------------------------
 * Self-attack: mutate a copy, run the readings against it, and require the flipped set to be the
 * declared one, with every reading covered by at least one mutant.
 * ---------------------------------------------------------------------------------------------- */
const MUTANTS = [
  // The clock's fact is dropped: ticks never rise (R1), and the quiet-time identity loses its left side
  // (R4). R2 must stay GREEN: a clock stuck at zero is frozen after teardown as surely as before it, and a
  // mutation that hid that would be asking one mutant to move a reading it has nothing to do with.
  // The clock stops moving, so every reading that needs it to move flips: R1 (it rises), R2 (it rose before
  // the teardown), R3 (the enabled world has some), R4a (the identity's left side), and R7 (the anchor this
  // mutant consumed is gone from the mutated copy).
  { name: 'ticks-increment-removed', kind: 'module', from: 'retryCounts.ticks += 1;', to: 'retryCounts.ticks += 0;', declared: ['R7', 'R1', 'R2', 'R3', 'R4a'] },
  // The pass that overlaps is no longer skipped, so two passes are counted against one tick: the identity
  // in R4 breaks, and the overlap control (a really-present `skipped`) goes with it.
  { name: 'guard-does-not-skip', kind: 'module', from: 'if (retryInFlight) {', to: 'if (false) {', declared: ['R7', 'R4b'] },
  // Teardown stops clearing the interval: ticks keep rising after the plugin unloads (R2).
  { name: 'teardown-keeps-timer', kind: 'module', from: 'clearTimeout(retryTimer);', to: 'clearTimeout(void 0);', declared: ['R7', 'R2'] },
  // The failure is named as success (R5's third leg).
  { name: 'last-reason-always-ok', kind: 'module', from: 'retryLastReason = "failed";', to: 'retryLastReason = "ok";', declared: ['R7', 'R5'] },
  // The opt-in is dropped: the silent world starts ticking (R3).
  { name: 'retry-on-by-default', kind: 'module', from: 'const retryEnabled = retryConfig.enabled === true;', to: 'const retryEnabled = true;', declared: ['R7', 'R3'] },
  // A skipped pass is not counted, so the identity in R4 has a tick nobody accounts for.
  { name: 'skipped-not-counted', kind: 'module', from: 'retryCounts.skipped += 1;', to: 'retryCounts.skipped += 0;', declared: ['R7', 'R4b'] },
  { name: 'declaration-drifts', kind: 'gate', from: 'const DECLARED = 8', to: 'const DECLARED = 99', declared: ['R6'] },
]

async function childVerdicts(modulePath) {
  const child = spawn(process.execPath, [HERE], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, R66_ATTACK_MODULE: modulePath } })
  let out = ''
  child.stdout.on('data', (chunk) => { out += String(chunk) })
  const code = await new Promise((settle) => child.on('exit', settle))
  const verdicts = {}
  const details = {}
  for (const line of out.split(/\r?\n/)) {
    const verdict = /^VERDICT (\S+) (true|false)$/.exec(line.trim())
    if (verdict !== null) verdicts[verdict[1]] = verdict[2] === 'true'
    const detail = /^DETAIL (\S+) (.*)$/.exec(line.trim())
    if (detail !== null) details[detail[1]] = detail[2]
  }
  return { code, verdicts, details, out }
}

async function selfAttack() {
  const shipped = readFileSync(ENTRY, 'utf8')
  const gateSource = readFileSync(HERE, 'utf8')
  const baseline = await childVerdicts(ENTRY)
  const baselineFalse = Object.entries(baseline.verdicts).filter(([, ok]) => !ok).map(([id]) => id)
  console.log('baseline: ' + String(Object.keys(baseline.verdicts).length) + ' readings seen, failed ' + dumps(baselineFalse))
  if (baseline.code === 3) { console.log('self-attack cannot run: the artifact does not carry the surface this gate reads'); process.exitCode = 3; return }
  if (Object.keys(baseline.verdicts).length === 0 || baselineFalse.length > 0) {
    console.log('self-attack refuses to run: the unmutated artifact is not green, so no mutant can be trusted')
    process.exitCode = 1
    return
  }
  const coverage = new Map()
  let mismatches = 0
  let anchorsMissing = 0
  for (const mutant of MUTANTS) {
    if (mutant.kind === 'gate') {
      if (!gateSource.includes(mutant.from)) { console.log('  ANCHOR MISSING  ' + mutant.name); anchorsMissing += 1; continue }
      writeFileSync(MUTANT_GATE, gateSource.replace(mutant.from, mutant.to))
      const child = spawn(process.execPath, [MUTANT_GATE], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env } })
      let out = ''
      child.stdout.on('data', (chunk) => { out += String(chunk) })
      await new Promise((settle) => child.on('exit', settle))
      const flipped = []
      for (const line of out.split(/\r?\n/)) { const verdict = /^VERDICT (\S+) (true|false)$/.exec(line.trim()); if (verdict !== null && verdict[2] === 'false') flipped.push(verdict[1]) }
      for (const id of flipped) coverage.set(id, (coverage.get(id) ?? 0) + 1)
      const declared = [...mutant.declared].sort().join(',')
      const observed = [...flipped].sort().join(',')
      if (declared !== observed) mismatches += 1
      console.log('  ' + (declared === observed ? 'ok  ' : 'FAIL') + '  ' + mutant.name + '  |  declared=[' + declared + '] flipped=[' + observed + ']')
      continue
    }
    if (!shipped.includes(mutant.from)) { console.log('  ANCHOR MISSING  ' + mutant.name + '  |  ' + flat(mutant.from).slice(0, 90)); anchorsMissing += 1; continue }
    writeFileSync(MUTANT_MODULE, shipped.replace(mutant.from, mutant.to))
    const result = await childVerdicts(MUTANT_MODULE)
    const flipped = Object.entries(result.verdicts).filter(([, ok]) => !ok).map(([id]) => id)
    for (const id of flipped) coverage.set(id, (coverage.get(id) ?? 0) + 1)
    const declared = [...mutant.declared].sort().join(',')
    const observed = [...flipped].sort().join(',')
    if (declared !== observed) mismatches += 1
    console.log('  ' + (declared === observed ? 'ok  ' : 'FAIL') + '  ' + mutant.name + '  |  declared=[' + declared + '] flipped=[' + observed + ']')
    // A declared reading that stayed green is the interesting case: print what it actually saw, so the
    // declaration can be corrected from measurement instead of re-reasoned by the next reader.
    for (const id of mutant.declared) { if (!flipped.includes(id)) console.log('      kept green: ' + id + '  ' + String(result.details[id] ?? '(no detail)').slice(0, 180)) }
  }
  const uncovered = MODULE_READING_IDS.filter((id) => !coverage.has(id))
  console.log('coverage: ' + String(MODULE_READING_IDS.length) + ' declared readings, ' + String(coverage.size) + ' flipped by at least one mutant, uncovered ' + dumps(uncovered))
  console.log('declared-set mismatches: ' + String(mismatches) + '; anchors missing: ' + String(anchorsMissing))
  process.exitCode = mismatches === 0 && uncovered.length === 0 && anchorsMissing === 0 ? 0 : 1
}

if (process.env.R66_ATTACK_MODULE !== undefined) {
  const readings = await runReadings(process.env.R66_ATTACK_MODULE)
  for (const row of readings) { console.log('VERDICT ' + row.id + ' ' + String(row.ok)); console.log('DETAIL ' + row.id + ' ' + flat(row.detail)) }
  const failed = report(readings)
  process.exitCode = failed === 0 ? 0 : 1
} else if (SELF_ATTACK) {
  if (!existsSync(ENTRY)) { console.error('the plugin is not built: ' + ENTRY); process.exit(2) }
  await selfAttack()
} else {
  if (!existsSync(ENTRY)) { console.error('the plugin is not built: ' + ENTRY); process.exit(2) }
  // The surface is checked before any reading runs: a missing member is an input problem, and saying so
  // is the difference between "this round has not landed" and "this product is broken".
  const probe = await import(pathToFileURL(ENTRY).href)
  const probeHost = (() => {
    const provided = new Map()
    const ctx = {
      get: (name) => (name === 'dshHomePath' ? (...segments) => join(mkdtempSync(join(tmpdir(), 'r66-probe-')), ...segments) : undefined),
      provide: (name, value) => { provided.set(name, value) },
      effect: (body) => { const dispose = body(); return dispose },
      on: () => () => {},
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    }
    return { ctx, provided }
  })()
  let capability
  try { probe.apply(probeHost.ctx, { retry: { enabled: false } }) } catch (error) { console.error('the artifact refused an empty retry config: ' + String(error?.message ?? error)); process.exit(1) }
  capability = probeHost.provided.get('linkCollab')
  const missing = surfaceProblems(capability)
  if (missing.length > 0) {
    console.log('SKIP  verify-collab-retry-ticks: the artifact does not carry the surface this gate reads: ' + dumps(missing))
    process.exit(3)
  }
  const readings = await runReadings(ENTRY)
  for (const row of readings) console.log('VERDICT ' + row.id + ' ' + String(row.ok))
  const failed = report(readings)
  process.exitCode = failed === 0 ? 0 : 1
}
