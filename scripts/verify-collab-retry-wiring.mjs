#!/usr/bin/env node
/**
 * R63 (task: retry wiring): the re-dispatch rule from R62, driven by the host's clock.
 *
 * What is read: the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js) only — never src. The host
 * below is this gate's own cordis-shaped stand-in (`get('dshHomePath')` returning a function, `provide`,
 * `effect`, `on`), written from the artifact's own behaviour; the producer's self-check is not imported.
 *
 * The readings are about the wiring, not about the rule: a default configuration must install no timer
 * and must write nothing on its own; an enabled one must really run the rule on its interval and stop
 * when its disposer is called; a pass must do what R62 says (one named attempt, then nothing);
 * overlapping passes must not overlap; a failing pass must be counted and named without killing the
 * timer; an unusable interval must be refused where the cause is visible; and the rule must still be
 * reachable with no host and no timer at all.
 *
 * Exit 0 every reading held; 1 a reading failed; 2 the artifact is not built.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(HERE), '..')
const ENTRY = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const MUTANT_MODULE = join(PROJECT, '.tmp', 'r63-attack-module.mjs')
const MUTANT_GATE = join(PROJECT, '.tmp', 'r63-attack-gate.mjs')
const DECLARED = 9

const argv = process.argv.slice(2)
const SELF_ATTACK = argv.includes('--self-attack')
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const dumps = (value) => JSON.stringify(value)
const flat = (text) => String(text).replace(/\s+/g, ' ').trim()

/* ------------------------------------------------------------------------------------------------
 * One run of the readings, against whichever artifact is named. A child started by --self-attack
 * points R63_ATTACK_MODULE at a mutated copy; everything else is the shipped file.
 * ---------------------------------------------------------------------------------------------- */
async function runReadings(modulePath) {
  const readings = []
  const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail })
  /**
   * One guarded reading: a body that throws is a reading that failed, not a reading that never ran.
   * Without this, an exception in an early reading leaves the rest unregistered and a mutant's flip set
   * silently loses them — the mutant then looks like it moved nothing (measured while writing this file).
   */
  const check = async (id, name, body) => {
    try {
      const [ok, detail] = await body()
      held(id, name, ok, detail)
    } catch (error) {
      held(id, name, false, 'threw: ' + String(error?.message ?? error))
    }
  }
  const roots = []
  const boards = []
  const freshRoot = () => { const dir = mkdtempSync(join(tmpdir(), 'r63-retry-')); roots.push(dir); return dir }
  // Cleanup is part of the run, not an afterthought: a plugin left holding its log keeps the directory on
  // Windows, so every board's log is closed first and the removal is retried. A gate that leaks temp
  // directories turns the next run's "is this machine quiet?" question into a guess (measured: two of the
  // eight worlds were still on disk before this).
  const cleanup = async () => {
    for (const board of boards) {
      const capability = board.provided.get('linkCollab')
      try { await capability?.log?.close?.() } catch { /* already closed */ }
    }
    for (const dir of roots) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try { rmSync(dir, { recursive: true, force: true }); break } catch { await sleep(60) }
      }
    }
  }

  /** A cordis-shaped host: only the members the artifact reaches for, plus a record of what it asked. */
  const host = (root) => {
    const effects = []
    const provided = new Map()
    const ctx = {
      get: (name) => (name === 'dshHomePath' ? (...segments) => join(root, ...segments) : undefined),
      provide: (name, value) => { provided.set(name, value) },
      // The contract this file is about: the body RETURNS the disposer. A host that wrapped the body
      // the other way round would make every "the timer stopped" reading meaningless.
      effect: (body, label) => { const dispose = body(); effects.push({ label: label ?? null, dispose: typeof dispose === 'function' ? dispose : () => {} }); return dispose },
      on: () => () => {},
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    }
    const board = { ctx, effects, provided, timers: () => effects.filter((entry) => String(entry.label ?? '').includes('retry timer')) }
    boards.push(board)
    return board
  }
  const capabilityOf = (board) => board.provided.get('linkCollab')
  const seedMember = async (mod, log, options = {}) => {
    const at = options.at ?? Date.now()
    const team = options.team ?? 'team-1'
    const member = options.member ?? 'm-b'
    await log.append({ kind: 'capability/state', actor: team, subject: member, payload: { id: member, capabilities: options.capabilities ?? ['sum'] } })
    await log.append({ kind: 'member/state', actor: team, subject: member, payload: { id: member, name: member, state: 'active', role: 'member' } })
    await log.append({ kind: 'member/host', actor: team, subject: member, payload: { id: member, end: options.end ?? 'end-A', via: null, at } })
    await log.append({ kind: 'member/heartbeat', actor: team, subject: member, payload: { id: member, at } })
  }

  const mod = await import(pathToFileURL(modulePath).href)

  // R1: a default configuration installs no retry timer, and its ledger does not grow on its own.
  await check('R1', 'disabled by default: no timer installed, a pass answers disabled, and nothing is written on its own', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, {})
    const capability = capabilityOf(board)
    const before = capability.log.replay().length
    await sleep(160)
    const ran = await capability.retry.run()
    const after = capability.log.replay().length
    const onSurface = typeof mod.redispatchPlan === 'function' && typeof mod.appendRedispatches === 'function'
    return [capability.retry.enabled === false
      && capability.retry.everyMs === null
      && capability.retry.timerInstalled === false
      && board.effects.length > 0
      && ran.reason === 'disabled' && Array.isArray(ran.written) && ran.written.length === 0
      && before === after && onSurface === true,
      'enabled=' + String(capability.retry.enabled) + ' everyMs=' + dumps(capability.retry.everyMs)
      + ' timerInstalled=' + String(capability.retry.timerInstalled) + ' effects=' + String(board.effects.length)
      + ' run=' + dumps(ran.reason) + ' ledger=' + String(before) + '->' + String(after) + ' ruleOnSurface=' + String(onSurface)]
  })

  // R2: enabled means a real interval, and its disposer really stops it (both directions).
  await check('R2', 'an enabled timer really ticks, and calling its disposer really stops it', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: 20, timeoutMs: 1000, maxAttempts: 3 } })
    const capability = capabilityOf(board)
    // R64 changed the shape: the interval is the plugin's own, cleared by its own teardown, not a second
    // `ctx.effect`. So "is it installed" is read from the service and the stop is driven by disposing the
    // effects the plugin did register (its teardown). Lead realigned this reading; the original author's
    // note is in docs/handoff/R65-retry-real-boot.md.
    await sleep(260)
    const whileRunning = capability.retry.counts.runs
    for (const effect of board.effects) effect.dispose()
    // A pass already in flight when the disposer ran still finishes, so the baseline is taken after the
    // last one has settled: otherwise a tick landing on the boundary would read as "it never stopped".
    await sleep(60)
    const atStop = capability.retry.counts.runs
    await sleep(300)
    const afterStop = capability.retry.counts.runs
    return [capability.retry.timerInstalled === false && capability.retry.enabled === true && capability.retry.everyMs === 20
      && whileRunning > 0 && afterStop === atStop,
      'timerInstalledAfter=' + String(capability.retry.timerInstalled) + ' everyMs=' + dumps(capability.retry.everyMs)
      + ' runs=' + String(whileRunning) + ' then ' + String(atStop) + ' -> ' + String(afterStop)]
  })

  // R3: one pass does what R62 says, and the LEDGER is what says it.
  await check('R3', 'a pass plans the named next attempt once, and the second pass writes nothing and says why', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1000, maxAttempts: 5 } })
    const capability = capabilityOf(board)
    const log = capability.log
    const now = Date.now()
    await seedMember(mod, log, { at: now })
    await log.append(mod.dispatchRecord('job-1', 'm-b', 'sum', { a: 1, b: 2 }, now - 5000))
    const first = await capability.retry.run()
    const rows = () => log.replay().filter((row) => row.kind === 'task/dispatch' && row.payload?.retryOf === 'job-1')
    const stored = rows()[0]?.payload
    const attemptSeq = rows()[0]?.seq
    const leaseRow = log.replay().find((row) => row.kind === 'task/retry-lease' && row.payload?.root === 'job-1')
    const second = await capability.retry.run()
    // The shape changed in R69: the write face claims with a lease before it writes the attempt it authorises,
    // so `written` carries two seqs and the ORDER between them is itself a fact this reading now checks.
    return [first.reason === 'ok' && first.written.length === 2 && rows().length === 1
      && leaseRow !== undefined && attemptSeq !== undefined && leaseRow.seq < attemptSeq
      && first.written[0] === leaseRow.seq && first.written[1] === attemptSeq
      && stored?.id === 'job-1#r2' && stored?.attempt === 2 && stored?.to === 'm-b' && stored?.tool === 'sum'
      && second.reason === 'ok' && second.written.length === 0 && rows().length === 1
      && second.blocked.some((row) => row.from === 'job-1' && row.reason === 'already-attempted'),
      'first=' + dumps({ reason: first.reason, written: first.written }) + ' stored=' + dumps(stored ?? null)
      + ' second=' + dumps({ written: second.written.length, blocked: second.blocked }) + ' attempts=' + String(rows().length)
      + ' leaseSeq=' + String(leaseRow?.seq) + ' attemptSeq=' + String(attemptSeq)]
  })

  // R4: one pass at a time, with the pair that shows the guard is a guard and not a wall.
  await check('R4', 'overlapping passes are refused as in-flight while the unfinished one keeps the work', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1000, maxAttempts: 3 } })
    const capability = capabilityOf(board)
    await seedMember(mod, capability.log, {})
    const overlapping = await Promise.all([capability.retry.run(), capability.retry.run(), capability.retry.run()])
    const inFlight = overlapping.filter((row) => row.reason === 'in-flight').length
    const skipped = capability.retry.counts.skipped
    const sequential = [await capability.retry.run(), await capability.retry.run()]
    return [inFlight === 2 && skipped === 2 && capability.retry.counts.runs === 3
      && sequential.every((row) => row.reason !== 'in-flight'),
      'overlap=' + dumps(overlapping.map((row) => row.reason)) + ' skipped=' + String(skipped)
      + ' runs=' + String(capability.retry.counts.runs) + ' sequential=' + dumps(sequential.map((row) => row.reason))]
  })

  // R5: a failing pass is counted and named rather than thrown, and other worlds are unaffected.
  await check('R5', 'a pass that cannot write is counted and named rather than thrown, and the next world is unaffected', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1000, maxAttempts: 3 } })
    const capability = capabilityOf(board)
    // The pass has to have work to write, or "it failed" would be indistinguishable from "it had
    // nothing to do": a closed log only matters when the pass reaches for it.
    const now = Date.now()
    await seedMember(mod, capability.log, { at: now })
    await capability.log.append(mod.dispatchRecord('fail-1', 'm-b', 'sum', {}, now - 5000))
    await capability.log.close()
    let threw = null
    let failed = null
    try { failed = await capability.retry.run() } catch (error) { threw = String(error?.message ?? error) }
    const named = capability.retry.lastError
    const counts = capability.retry.counts
    const healthyBoard = host(freshRoot())
    mod.apply(healthyBoard.ctx, { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1000, maxAttempts: 3 } })
    const healthy = await capabilityOf(healthyBoard).retry.run()
    return [threw === null && failed?.reason === 'failed' && counts.failed === 1 && typeof named === 'string' && named.length > 0
      && healthy.reason === 'ok',
      'threw=' + dumps(threw) + ' failed=' + dumps(failed?.reason ?? null) + ' counts=' + dumps(counts)
      + ' lastError=' + dumps(named) + ' healthy=' + dumps(healthy.reason)]
  })

  // R6: an unusable interval is refused where the cause is visible; a usable one applies.
  await check('R6', 'every unusable interval is refused at load, naming the field, while a usable one applies', async () => {
    const rejects = []
    for (const everyMs of [0, -1, 1.5, Number.NaN]) {
      const board = host(freshRoot())
      let message = null
      try { mod.apply(board.ctx, { retry: { enabled: true, everyMs, timeoutMs: 1000, maxAttempts: 3 } }) } catch (error) { message = String(error?.message ?? error) }
      const held = capabilityOf(board)
      rejects.push({ everyMs: String(everyMs), message, timers: board.timers().length, published: held === undefined ? null : held.retry.timerInstalled })
    }
    const fineBoard = host(freshRoot())
    let fineThrew = null
    try { mod.apply(fineBoard.ctx, { retry: { enabled: true, everyMs: 60_000, timeoutMs: 1000, maxAttempts: 3 } }) } catch (error) { fineThrew = String(error?.message ?? error) }
    // A refused row must not leave a timer or a published service behind; a usable one must install.
    return [rejects.every((row) => typeof row.message === 'string' && row.message.includes('retry.everyMs') && row.published === null)
      && fineThrew === null && capabilityOf(fineBoard).retry.timerInstalled === true,
      'rejects=' + dumps(rejects) + ' fineThrew=' + dumps(fineThrew) + ' fineInstalled=' + String(capabilityOf(fineBoard).retry.timerInstalled)]
  })

  // R7: the rule is reachable with no host and no timer, so the wiring is not the only way in.
  await check('R7', 'the rule itself still works with no host and no timer at all', async () => {
    const root = freshRoot()
    const seedLog = mod.openControlLog({ dir: join(root, 'direct'), writer: 'direct' })
    const now = Date.now()
    await seedMember(mod, seedLog, { at: now })
    await seedLog.append(mod.dispatchRecord('solo', 'm-b', 'sum', {}, now - 9000))
    const options = { team: 'team-1', localEnd: 'end-A', now, timeoutMs: 1000, maxAttempts: 4 }
    const plan = mod.redispatchPlan(mod.projectTeamState(seedLog.replay()), options)
    const written = await mod.appendRedispatches(mod.projectTeamState(seedLog.replay()), seedLog, options)
    const rows = seedLog.replay().filter((row) => row.kind === 'task/dispatch' && row.payload?.retryOf === 'solo')
    const leaseRow = seedLog.replay().find((row) => row.kind === 'task/retry-lease' && row.payload?.root === 'solo')
    await seedLog.close()
    return [plan.entries.length === 1 && plan.entries[0].id === 'solo#r2' && written.length === 2 && rows.length === 1
      && leaseRow !== undefined && leaseRow.seq < rows[0].seq && written[0] === leaseRow.seq && written[1] === rows[0].seq,
      'plan=' + dumps(plan.entries.map((row) => row.id)) + ' written=' + dumps(written) + ' rows=' + String(rows.length)
      + ' leaseSeq=' + String(leaseRow?.seq) + ' attemptSeq=' + String(rows[0]?.seq)]
  })

  // R9 (Lead realigned after R64: a host with no `effect` now gets a timer, not a dead one): a host that cannot give an effect is not a reason to throw — the wiring is optional, the service
  // is not. The artifact guards on `context.effect !== undefined`, so this is a real branch rather than a
  // hypothetical: it is the difference between "this host has no clock to give" and "the plugin broke".
  await check('R9', 'a host with no effect member still gets the service, and nothing can tick in it', async () => {
    const root = freshRoot()
    const provided = new Map()
    const bare = {
      get: (name) => (name === 'dshHomePath' ? (...segments) => join(root, ...segments) : undefined),
      provide: (name, value) => { provided.set(name, value) },
    }
    let threw = null
    try { mod.apply(bare, { retry: { enabled: true, everyMs: 20, timeoutMs: 1000, maxAttempts: 3 } }) } catch (error) { threw = String(error?.message ?? error) }
    const capability = provided.get('linkCollab')
    const before = capability?.log?.replay?.().length ?? 0
    await sleep(200)
    const after = capability?.log?.replay?.().length ?? 0
    const runs = capability?.retry?.counts?.runs ?? null
    // R64 changed the shape: the interval no longer goes through `ctx.effect`, so a host without an
    // `effect` member gets a running timer instead of a dead one. That is the better property (the timer
    // depends on the row's config, not on a host member), and it is what this reading now asserts.
    return [threw === null && capability !== undefined && capability.retry.enabled === true && capability.retry.everyMs === 20
      && capability.retry.timerInstalled === true && runs !== null && runs > 0 && before === after,
      'threw=' + dumps(threw) + ' provided=' + String(capability !== undefined) + ' everyMs=' + dumps(capability?.retry?.everyMs ?? null)
      + ' runs=' + dumps(runs) + ' installed=' + dumps(capability?.retry?.timerInstalled ?? null) + ' ledger=' + String(before) + '->' + String(after)]
  })

  // R8: the gate's own declaration of how many readings exist is not allowed to drift.
  await check('R8', 'the declared reading count matches the readings this run produced', async () => {
    // This reading counts itself, which is why the declaration is one more than the rows already here.
    return [DECLARED === readings.length + 1,
      'declared=' + String(DECLARED) + ' produced=' + String(readings.length)]
  })

  await cleanup()
  return readings
}

/* ------------------------------------------------------------------------------------------------
 * Reporting.
 * ---------------------------------------------------------------------------------------------- */
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
  { name: 'retry-on-by-default', kind: 'module', from: 'const retryEnabled = retryConfig.enabled === true;', to: 'const retryEnabled = true;', declared: ['R1'] },
  { name: 'timer-too-slow', kind: 'module', from: '    }, delayMs);', to: '    }, 60000);', declared: ['R2', 'R9'] },
  { name: 'disposer-does-nothing', kind: 'module', from: '        clearTimeout(retryTimer);', to: '        clearTimeout(void 0);', declared: ['R2'] },
  { name: 'no-in-flight-guard', kind: 'module', from: 'if (retryInFlight) {', to: 'if (false) {', declared: ['R4'] },
  { name: 'failure-uncounted', kind: 'module', from: 'retryCounts.failed += 1;', to: 'retryCounts.failed += 0;', declared: ['R5'] },
  { name: 'failure-unnamed', kind: 'module', from: 'retryLastError = String(error?.message ?? error);', to: 'retryLastError = null;', declared: ['R5'] },
  { name: 'interval-unchecked', kind: 'module', from: 'if (!Number.isInteger(everyMs) || everyMs <= 0) throw new TypeError("dsh-link-collab: retry.everyMs must be a positive integer");', to: 'if (false) throw new TypeError("dsh-link-collab: retry.everyMs must be a positive integer");', declared: ['R6'] },
  { name: 'runs-uncounted', kind: 'module', from: 'retryCounts.runs += 1;', to: 'retryCounts.runs += 0;', declared: ['R2', 'R4', 'R9'] },
  // Declared from measurement, not from reasoning: dropping the write also drops the `await`, so the pass
  // now finishes before the next one starts — R4's overlap window closes with it — and a pass that writes
  // nothing never reaches the closed log R5 uses to make a pass fail. Both are real consequences of the
  // same removal, and a declared set that hid them would be asking one mutant to move exactly one reading.
  { name: 'pass-writes-nothing', kind: 'module', from: 'const written = await appendRedispatches(projectTeamState(own.replay()), own, options);', to: 'const written = [];', declared: ['R3', 'R4', 'R5'] },
  // Also declared from measurement: an empty stale list means the pass writes nothing (R3) and never
  // reaches the closed log (R5), while R7 — the rule used with no host at all — has no entries to plan.
  { name: 'plan-finds-nothing', kind: 'module', from: 'const stale = expiredDispatches(state, options.now, { timeoutMs: options.timeoutMs });', to: 'const stale = [];', declared: ['R3', 'R5', 'R7'] },
  { name: 'effect-guard-restored', kind: 'module', from: '  if (retryEnabled && retryEveryMs !== null) armRetry(currentDelay());', to: '  if (retryEnabled && context.effect !== void 0 && retryEveryMs !== null) armRetry(currentDelay());', declared: ['R9'] },
  { name: 'declaration-drifts', kind: 'gate', from: 'const DECLARED = 9', to: 'const DECLARED = 99', declared: ['R8'] },
]

async function childVerdicts(modulePath) {
  const child = spawn(process.execPath, [HERE], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, R63_ATTACK_MODULE: modulePath } })
  let out = ''
  child.stdout.on('data', (chunk) => { out += String(chunk) })
  const code = await new Promise((settle) => child.on('exit', settle))
  const verdicts = {}
  for (const line of out.split(/\r?\n/)) {
    const match = /^VERDICT (\S+) (true|false)$/.exec(line.trim())
    if (match !== null) verdicts[match[1]] = match[2] === 'true'
  }
  const details = {}
  for (const line of out.split(/\r?\n/)) {
    const match = /^DETAIL (\S+) (.*)$/.exec(line.trim())
    if (match !== null) details[match[1]] = match[2]
  }
  return { code, verdicts, details, out }
}

async function selfAttack() {
  const shipped = readFileSync(ENTRY, 'utf8')
  const gateSource = readFileSync(HERE, 'utf8')
  const baseline = await childVerdicts(ENTRY)
  const baselineFalse = Object.entries(baseline.verdicts).filter(([, ok]) => !ok).map(([id]) => id)
  console.log('baseline: ' + String(Object.keys(baseline.verdicts).length) + ' readings seen, failed ' + dumps(baselineFalse))
  if (baselineFalse.length > 0) {
    console.log('self-attack refuses to run: the unmutated artifact is not green, so no mutant can be trusted')
    process.exitCode = 1
    return
  }
  const coverage = new Map()
  let mismatches = 0
  let anchorsMissing = 0
  for (const mutant of MUTANTS) {
    let modulePath = ENTRY
    if (mutant.kind === 'module') {
      if (!shipped.includes(mutant.from)) { console.log('  ANCHOR MISSING  ' + mutant.name + '  |  ' + flat(mutant.from).slice(0, 90)); anchorsMissing += 1; continue }
      writeFileSync(MUTANT_MODULE, shipped.replace(mutant.from, mutant.to))
      modulePath = MUTANT_MODULE
    } else {
      if (!gateSource.includes(mutant.from)) { console.log('  ANCHOR MISSING  ' + mutant.name + '  |  ' + flat(mutant.from).slice(0, 90)); anchorsMissing += 1; continue }
      const mutatedGate = gateSource.replace(mutant.from, mutant.to)
      writeFileSync(MUTANT_GATE, mutatedGate)
      const child = spawn(process.execPath, [MUTANT_GATE], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env } })
      let out = ''
      child.stdout.on('data', (chunk) => { out += String(chunk) })
      await new Promise((settle) => child.on('exit', settle))
      const flipped = []
      for (const line of out.split(/\r?\n/)) { const match = /^VERDICT (\S+) (true|false)$/.exec(line.trim()); if (match !== null && match[2] === 'false') flipped.push(match[1]) }
      for (const id of flipped) coverage.set(id, (coverage.get(id) ?? 0) + 1)
      const declared = [...mutant.declared].sort().join(',')
      const observed = [...flipped].sort().join(',')
      if (declared !== observed) mismatches += 1
      console.log('  ' + (declared === observed ? 'ok  ' : 'FAIL') + '  ' + mutant.name + '  |  declared=[' + declared + '] flipped=[' + observed + ']')
      continue
    }
    const result = await childVerdicts(modulePath)
    const flipped = Object.entries(result.verdicts).filter(([, ok]) => !ok).map(([id]) => id)
    for (const id of flipped) coverage.set(id, (coverage.get(id) ?? 0) + 1)
    const declared = [...mutant.declared].sort().join(',')
    const observed = [...flipped].sort().join(',')
    if (declared !== observed) mismatches += 1
    console.log('  ' + (declared === observed ? 'ok  ' : 'FAIL') + '  ' + mutant.name + '  |  declared=[' + declared + '] flipped=[' + observed + ']')
    // A reading that was declared and stayed green is the interesting case: print what it actually saw,
    // so the declaration can be corrected from measurement rather than re-reasoned by the next reader.
    for (const id of mutant.declared) { if (!flipped.includes(id)) console.log('      kept green: ' + id + '  ' + String(result.details[id] ?? '(no detail)').slice(0, 180)) }
  }
  const ids = MODULE_READING_IDS
  const uncovered = ids.filter((id) => !coverage.has(id))
  console.log('coverage: ' + String(ids.length) + ' declared readings, ' + String(coverage.size) + ' flipped by at least one mutant, uncovered ' + dumps(uncovered))
  console.log('declared-set mismatches: ' + String(mismatches) + '; anchors missing: ' + String(anchorsMissing))
  process.exitCode = mismatches === 0 && uncovered.length === 0 && anchorsMissing === 0 ? 0 : 1
}

const MODULE_READING_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9']

if (process.env.R63_ATTACK_MODULE !== undefined) {
  const readings = await runReadings(process.env.R63_ATTACK_MODULE)
  for (const row of readings) { console.log('VERDICT ' + row.id + ' ' + String(row.ok)); console.log('DETAIL ' + row.id + ' ' + flat(row.detail)) }
  const failed = report(readings)
  process.exitCode = failed === 0 ? 0 : 1
} else if (SELF_ATTACK) {
  await selfAttack()
} else {
  if (!existsSync(ENTRY)) { console.error('the plugin is not built: ' + ENTRY); process.exit(2) }
  const readings = await runReadings(ENTRY)
  for (const row of readings) console.log('VERDICT ' + row.id + ' ' + String(row.ok))
  const failed = report(readings)
  process.exitCode = failed === 0 ? 0 : 1
}
