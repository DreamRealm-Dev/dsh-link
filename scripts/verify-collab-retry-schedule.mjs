#!/usr/bin/env node
/**
 * R68 (task-122): the retry schedule — backoff, deterministic jitter, and a self-chained timer.
 *
 * What is read: the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js) only — never src. The host
 * below is this gate's own cordis-shaped stand-in; the producer's self-check is not imported.
 *
 * The one sentence this round decides: how long to wait before the next pass. The contract makes the
 * pure function `retryDelay` the only owner of that number, so most of what follows compares the
 * artifact against the contract's own arithmetic (recomputed here from the formula, not copied from
 * the implementation), and the rest measures the timer that consumes it.
 *
 * ANCHORS: every mutation anchor below is an EXACT substring of the shipped artifact. They were WRITTEN
 * BEFORE the producer landed (this gate was authored in parallel), so the first run's R7 and the
 * self-attack's ANCHOR MISSING lines are the checklist for finishing them: replace each `from` with the
 * artifact's real text, never delete a mutant, and re-run. A mutant whose anchor is guessed rather than
 * read is a mutant that proves nothing.
 *
 * Exit 0 every reading held; 1 a reading failed; 3 the artifact does not carry the surface this gate
 * reads (printed with what is missing) — a gate that cannot see its subject is not a passing gate.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(HERE), '..')
const ENTRY = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const MUTANT_MODULE = join(PROJECT, '.tmp', 'r68-attack-module.mjs')
const MUTANT_GATE = join(PROJECT, '.tmp', 'r68-attack-gate.mjs')
const DECLARED = 14
/** The readings that a MODULE mutant can move (R6 is the declaration reading, R7 the anchor reading). */
const MODULE_READING_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13']

/**
 * The mutants, with their anchors, in one place: ANCHORS is derived from this table so the checklist R7
 * grades and the swaps the attack performs can never disagree (R66 shipped two lists and drifted).
 */
const MUTANTS = [
  // The jitter stops being deterministic: the same idle now yields different numbers.
  { name: 'jitter-random', kind: 'module', from: 'const spread = Number(BigInt(idle) * 2654435761n % 4294967296n) / 4294967296;', to: 'const spread = Math.random();', declared: ['R7', 'R3'] },
  // The cap becomes exclusive: idle large enough lands one millisecond under maxMs.
  { name: 'max-ms-exclusive', kind: 'module', from: 'const capped = maxMs === void 0 ? raw : Math.min(raw, Number(maxMs));', to: 'const capped = maxMs === void 0 ? raw : Math.min(raw, Number(maxMs) - 1);', declared: ['R7', 'R2', 'R3'] },
  // The streak never clears, so a pass that wrote is followed by an even longer wait.
  { name: 'idle-never-resets', kind: 'module', from: 'retryIdle = written.length > 0 ? 0 : retryIdle + 1;', to: 'retryIdle = retryIdle + 1;', declared: ['R7', 'R10'] },
  // Teardown stops clearing the pending chain, so the timer outlives the plugin.
  { name: 'teardown-keeps-pending', kind: 'module', from: 'clearTimeout(retryTimer);', to: 'clearTimeout(void 0);', declared: ['R7', 'R11'] },
  // The exponent uses the attempt number instead of the idle streak, so even the first delay backs off.
  { name: 'idle-as-attempt', kind: 'module', from: 'raw = everyMs * Math.pow(factor, idle);', to: 'raw = everyMs * Math.pow(factor, idle + 1);', declared: ['R7', 'R1', 'R2', 'R3', 'R9', 'R13'] },
  // factor === 1 is accepted instead of refused: the identity the contract calls illegal.
  { name: 'factor-one-accepted', kind: 'module', from: 'if (schedule.factor === void 0 || !Number.isFinite(factor) || factor <= 1) throw new TypeError("dsh-link-collab: retry.schedule.factor must be finite and greater than 1");', to: 'if (schedule.factor === void 0 || !Number.isFinite(factor) || factor < 0) throw new TypeError("dsh-link-collab: retry.schedule.factor must be finite and greater than 1");', declared: ['R7', 'R4'] },
  // maxMs below everyMs is accepted instead of refused.
  { name: 'maxms-floor-ignored', kind: 'module', from: 'if (schedule.maxMs === void 0 || !Number.isInteger(maxMs) || maxMs < everyMs) throw new TypeError("dsh-link-collab: retry.schedule.maxMs must be a positive integer of at least retry.everyMs");', to: 'if (schedule.maxMs === void 0 || !Number.isInteger(maxMs) || maxMs < 0) throw new TypeError("dsh-link-collab: retry.schedule.maxMs must be a positive integer of at least retry.everyMs");', declared: ['R7', 'R5'] },
  // Out-of-range jitter is accepted instead of refused.
  { name: 'jitter-range-ignored', kind: 'module', from: 'if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new TypeError("dsh-link-collab: retry.jitter must be within [0, 1]");', to: 'if (false) throw new TypeError("dsh-link-collab: retry.jitter must be within [0, 1]");', declared: ['R7', 'R6'] },
  // The chain re-arms with the base period, so the computed delay is never waited out.
  { name: 'chain-ignores-delay', kind: 'module', from: '    }, delayMs);', to: '    }, retryEveryMs);', declared: ['R7', 'R9'] },
  // The no-schedule path invents a factor, so "no schedule means today's shape" stops being true.
  { name: 'schedule-required', kind: 'module', from: '...retryFactor === void 0 ? {} : { factor: retryFactor },', to: 'factor: retryFactor === void 0 ? 2 : retryFactor,', declared: ['R7', 'R8'] },
  // A disabled row still installs a timer.
  { name: 'retry-on-by-default', kind: 'module', from: 'const retryEnabled = retryConfig.enabled === true;', to: 'const retryEnabled = true;', declared: ['R7', 'R12'] },
  // nextDelayMs reports a constant instead of the delay that was actually scheduled.
  { name: 'next-delay-constant', kind: 'module', from: '        return retryNextDelay;', to: '        return retryEveryMs;', declared: ['R7', 'R13'] },
  { name: 'declaration-drifts', kind: 'gate', from: 'const DECLARED = 14', to: 'const DECLARED = 99', declared: ['RD'] },
]
const ANCHORS = MUTANTS.filter((mutant) => mutant.kind === 'module').map((mutant) => ({ mutant: mutant.name, from: mutant.from }))

const argv = process.argv.slice(2)
const SELF_ATTACK = argv.includes('--self-attack')
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const dumps = (value) => JSON.stringify(value)
const flat = (text) => String(text).replace(/\s+/g, ' ').trim()
const INTERVAL = 40
const WINDOW = INTERVAL * 5

/* ------------------------------------------------ the contract's own arithmetic, recomputed here */
const frac = (idle) => ((idle * 2654435761) % 4294967296) / 4294967296
const expectedDelay = (options) => {
  const { everyMs, factor, maxMs, jitter = 0, idle } = options
  const raw = factor === undefined ? everyMs : everyMs * factor ** idle
  const capped = Math.min(raw, maxMs === undefined ? Infinity : maxMs)
  return Math.round(capped * (1 - jitter + jitter * frac(idle)))
}

/* ------------------------------------------------ the surface this gate reads */
function surfaceProblems(capability) {
  const missing = []
  const retry = capability === undefined ? undefined : capability.retry
  if (retry === undefined || retry === null) return ['retry (the service member)']
  if (typeof retry.run !== 'function') missing.push('retry.run')
  if (typeof retry.enabled !== 'boolean') missing.push('retry.enabled')
  if (typeof retry.timerInstalled !== 'boolean') missing.push('retry.timerInstalled')
  if (!('everyMs' in retry)) missing.push('retry.everyMs')
  if (!('idle' in retry)) missing.push('retry.idle')
  if (!('nextDelayMs' in retry)) missing.push('retry.nextDelayMs')
  if (!('lastReason' in retry)) missing.push('retry.lastReason')
  const counts = retry.counts
  if (counts === undefined || counts === null) missing.push('retry.counts')
  else for (const key of ['runs', 'skipped', 'failed', 'ticks']) if (typeof counts[key] !== 'number') missing.push('retry.counts.' + key)
  return missing
}

async function runReadings(modulePath) {
  const readings = []
  const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail })
  const check = async (id, name, body) => {
    try { const [ok, detail] = await body(); held(id, name, ok, detail) }
    catch (error) { held(id, name, false, 'threw: ' + String(error?.message ?? error)) }
  }
  const roots = []
  const boards = []
  const freshRoot = () => { const dir = mkdtempSync(join(tmpdir(), 'r68-sched-')); roots.push(dir); return dir }
  const cleanup = async () => {
    for (const board of boards) {
      const capability = board.provided.get('linkCollab')
      try { await capability?.log?.close?.() } catch { /* already closed */ }
    }
    for (const dir of roots) for (let attempt = 0; attempt < 3; attempt += 1) { try { rmSync(dir, { recursive: true, force: true }); break } catch { await sleep(60) } }
  }
  /** A cordis-shaped host, plus a record of every effect the artifact registered and what it published. */
  const host = (root) => {
    const effects = []
    const provided = new Map()
    const ctx = {
      get: (name) => (name === 'dshHomePath' ? (...segments) => join(root, ...segments) : undefined),
      provide: (name, value) => { provided.set(name, value) },
      effect: (body) => { const dispose = body(); effects.push({ dispose: typeof dispose === 'function' ? dispose : () => {} }); return dispose },
      on: () => () => {},
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    }
    const board = { ctx, effects, provided, failures: [] }
    boards.push(board)
    return board
  }
  /** Apply a config, capturing a construction failure instead of letting it escape. */
  const attemptApply = (board, config) => {
    try { mod.apply(board.ctx, config); return null } catch (error) { return error }
  }
  const capabilityOf = (board) => board.provided.get('linkCollab')
  const stopEvery = (board) => { for (const effect of board.effects) effect.dispose() }
  const config = (retry) => ({ retry })

  const mod = await import(pathToFileURL(modulePath).href)
  const delay = mod.retryDelay

  // R7: every mutation anchor is still present in the shipped artifact, so the mutants below can bite.
  await check('R7', 'every mutation anchor is a real substring of the shipped artifact', async () => {
    const text = readFileSync(modulePath, 'utf8')
    const absent = ANCHORS.filter((anchor) => !text.includes(anchor.from)).map((anchor) => anchor.mutant)
    return [absent.length === 0, 'anchors=' + String(ANCHORS.length) + ' absent=' + dumps(absent)]
  })

  // R1: the two ends of the pure function. idle=0 is everyMs whatever the schedule says (a factor must
  // never move the first wait), and no schedule at all is everyMs at every idle (today's shape, kept).
  await check('R1', 'retryDelay: idle=0 is everyMs with or without a schedule, and no schedule stays everyMs', async () => {
    const scheduled = delay({ everyMs: 40, factor: 3, maxMs: 1000, idle: 0 })
    const bare = delay({ everyMs: 40, idle: 0 })
    const bareLater = [1, 5, 99].map((idle) => delay({ everyMs: 40, idle }))
    return [scheduled === 40 && bare === 40 && bareLater.every((value) => value === 40),
      'scheduled=' + dumps(scheduled) + ' bare=' + dumps(bare) + ' bareLater=' + dumps(bareLater)]
  })

  // R2: no jitter means the contract's arithmetic, including the cap with the equality inside it, and a
  // monotone climb that never comes back down.
  await check('R2', 'retryDelay with jitter=0: everyMs, factor**idle, the cap inclusive, and monotone in idle', async () => {
    const world = (idle) => delay({ everyMs: 40, factor: 2, maxMs: 160, idle })
    const ladder = [0, 1, 2, 3, 4, 40, 1000].map(world)
    const capHit = ladder.slice(3)
    const monotone = ladder.every((value, index) => index === 0 || value >= ladder[index - 1])
    const formula = [0, 1, 2].map((idle) => delay({ everyMs: 40, factor: 2, maxMs: 160, idle }) === expectedDelay({ everyMs: 40, factor: 2, maxMs: 160, idle }))
    return [ladder[0] === 40 && ladder[1] === 80 && ladder[2] === 160
      && capHit.every((value) => value === 160) && monotone && formula.every(Boolean),
      'ladder=' + dumps(ladder) + ' monotone=' + String(monotone) + ' formula=' + dumps(formula)]
  })

  // R3: jitter is a deterministic fraction of the capped delay — the same idle twice is the same number
  // (both byte-identical and equal to the recomputed formula), and a positive jitter never exceeds the cap.
  await check('R3', 'retryDelay with jitter: same idle twice is byte-identical, and matches the contract formula', async () => {
    const idles = [0, 1, 2, 3, 6, 17]
    const exact = idles.map((idle) => delay({ everyMs: 40, factor: 2, maxMs: 1000, jitter: 0.37, idle }) === expectedDelay({ everyMs: 40, factor: 2, maxMs: 1000, jitter: 0.37, idle }))
    const full = idles.map((idle) => delay({ everyMs: 40, factor: 4, maxMs: 10_000, jitter: 1, idle }) === expectedDelay({ everyMs: 40, factor: 4, maxMs: 10_000, jitter: 1, idle }))
    const again = idles.map((idle) => dumps(delay({ everyMs: 40, factor: 2, maxMs: 1000, jitter: 1, idle })) === dumps(delay({ everyMs: 40, factor: 2, maxMs: 1000, jitter: 1, idle })))
    const inRange = idles.map((idle) => {
      const capped = Math.min(40 * 2 ** idle, 1000)
      const value = delay({ everyMs: 40, factor: 2, maxMs: 1000, jitter: 1, idle })
      return Number.isInteger(value) && value >= 0 && value <= capped
    })
    return [exact.every(Boolean) && full.every(Boolean) && again.every(Boolean) && inRange.every(Boolean),
      'jitter037=' + dumps(exact) + ' jitter1=' + dumps(full) + ' sameTwice=' + dumps(again) + ' inRange=' + dumps(inRange)]
  })

  // R4: factor must be finite and > 1 — 1 is the illegal identity, not a shortcut — and a config that
  // never loads publishes nothing at all (a half-built service is worse than no service).
  await check('R4', 'factor=1 (and 0.5) is refused by name at load, with nothing published', async () => {
    const rows = []
    let published = []
    for (const factor of [1, 0.5]) {
      const board = host(freshRoot())
      const error = attemptApply(board, config({ enabled: true, everyMs: 40, timeoutMs: 1000, maxAttempts: 3, schedule: { factor, maxMs: 1000 } }))
      rows.push(error === null ? 'no-throw' : String(error.constructor.name) + (String(error.message).includes('retry.schedule.factor') ? '/named' : '/unnamed'))
      published.push(board.provided.size)
    }
    return [dumps(rows) === dumps(['TypeError/named', 'TypeError/named']) && published.every((size) => size === 0),
      'factor=1,0.5 -> ' + dumps(rows) + ' published=' + dumps(published)]
  })

  // R5: maxMs must be a positive integer and at least everyMs: a cap below the base period cannot be
  // honoured by any schedule that starts at everyMs.
  await check('R5', 'maxMs below everyMs (and a non-integer) is refused by name at load, with nothing published', async () => {
    const rows = []
    let published = []
    for (const maxMs of [20, 40.5]) {
      const board = host(freshRoot())
      const error = attemptApply(board, config({ enabled: true, everyMs: 40, timeoutMs: 1000, maxAttempts: 3, schedule: { factor: 2, maxMs } }))
      rows.push(error === null ? 'no-throw' : String(error.constructor.name) + (String(error.message).includes('retry.schedule.maxMs') ? '/named' : '/unnamed'))
      published.push(board.provided.size)
    }
    return [dumps(rows) === dumps(['TypeError/named', 'TypeError/named']) && published.every((size) => size === 0),
      'maxMs=20,40.5 -> ' + dumps(rows) + ' published=' + dumps(published)]
  })

  // R6: jitter is a fraction in [0,1]; the same check refuses both edges of the closed interval.
  await check('R6', 'jitter outside [0,1] is refused by name at load, with nothing published', async () => {
    const rows = []
    let published = []
    for (const jitter of [-0.1, 1.1]) {
      const board = host(freshRoot())
      const error = attemptApply(board, config({ enabled: true, everyMs: 40, timeoutMs: 1000, maxAttempts: 3, jitter }))
      rows.push(error === null ? 'no-throw' : String(error.constructor.name) + (String(error.message).includes('retry.jitter') ? '/named' : '/unnamed'))
      published.push(board.provided.size)
    }
    return [dumps(rows) === dumps(['TypeError/named', 'TypeError/named']) && published.every((size) => size === 0),
      'jitter=-0.1,1.1 -> ' + dumps(rows) + ' published=' + dumps(published)]
  })

  // R8: no schedule configured behaves exactly like today: the timer runs, and the delay it schedules is
  // still the base period whatever the streak is.
  await check('R8', 'with no schedule the timer runs and the scheduled delay is still everyMs', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, config({ enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3 }))
    const capability = capabilityOf(board)
    const start = capability.retry.counts.ticks
    await sleep(INTERVAL + WINDOW)
    // A pass in flight has already cleared nextDelayMs, so wait for the chain to be armed again before
    // reading: the question is what the timer will wait, not what it says mid-pass.
    const armed = Date.now() + 500
    while (capability.retry.nextDelayMs === null && Date.now() < armed) await sleep(5)
    const after = { ...capability.retry, ticks: capability.retry.counts.ticks, everyMs: capability.retry.everyMs, nextDelayMs: capability.retry.nextDelayMs, idle: capability.retry.idle, timerInstalled: capability.retry.timerInstalled }
    const end = after.ticks
    stopEvery(board)
    return [end - start >= 3 && after.timerInstalled === true
      && after.everyMs === INTERVAL
      && after.nextDelayMs === INTERVAL
      && delay({ everyMs: INTERVAL, idle: 7 }) === INTERVAL,
      'ticks ' + String(start) + '->' + String(end) + ' nextDelayMs=' + dumps(after.nextDelayMs)
      + ' idle=' + dumps(after.idle) + ' installed=' + String(after.timerInstalled)]
  })

  // R9: the timer really waits the computed delay. Two worlds with the same base period and different
  // factors: the slow one must still be waiting for its second fire while the fast one has fired again
  // and again, and the gaps between the fast world's fires must grow (a chain that re-armed with the base
  // period, or with a constant, would show equal gaps).
  await check('R9', 'the self-chained timer waits the computed delay: gaps grow, and a huge factor delays the next fire', async () => {
    const fast = host(freshRoot())
    mod.apply(fast.ctx, config({ enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3, schedule: { factor: 2, maxMs: 1000 } }))
    const slow = host(freshRoot())
    mod.apply(slow.ctx, config({ enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3, schedule: { factor: 1000, maxMs: 100_000 } }))
    const fastCapability = capabilityOf(fast)
    const slowCapability = capabilityOf(slow)
    const stamps = []
    let seen = fastCapability.retry.counts.ticks
    const started = Date.now()
    stamps.push(started)
    while (Date.now() - started < 1000) {
      await sleep(5)
      const nowTicks = fastCapability.retry.counts.ticks
      if (nowTicks !== seen) { seen = nowTicks; stamps.push(Date.now()) }
      if (stamps.length >= 5) break
    }
    const gaps = stamps.slice(1).map((stamp, index) => stamp - stamps[index])
    const fastTicks = fastCapability.retry.counts.ticks
    const slowTicks = slowCapability.retry.counts.ticks
    stopEvery(fast)
    stopEvery(slow)
    return [fastTicks >= 3 && slowTicks === 1 && gaps.length >= 2
      && gaps[0] < 3 * INTERVAL && gaps[gaps.length - 1] > gaps[0],
      'fastTicks=' + String(fastTicks) + ' slowTicks=' + String(slowTicks) + ' gaps=' + dumps(gaps)]
  })

  // R10: the streak counts passes that made no progress and is cleared by one that wrote. Paired inside
  // the reading: idle above zero before the writing pass, zero after it.
  await check('R10', 'idle rises while nothing is written and returns to 0 on the pass that writes', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, config({ enabled: true, everyMs: 60_000, timeoutMs: 1, maxAttempts: 10, team: 'team-1', localEnd: 'end-A' }))
    const capability = capabilityOf(board)
    await capability.retry.run()
    await capability.retry.run()
    const before = capability.retry.idle
    const writtenBefore = capability.retry.counts.written
    // Work for the next pass: a member of the team, its capability, and a dispatch past its 1 ms deadline.
    await capability.log.append({ kind: 'member/state', actor: 'team-1', subject: 'end-A', payload: { id: 'end-A', state: 'active', name: 'end-A' } })
    await capability.log.append({ kind: 'task/state', actor: 'team-1', subject: 'task-1', payload: { id: 'task-1', state: 'in_progress', owner: 'end-A' } })
    await capability.log.append(mod.capabilityRecord('end-A', ['probe-tool']))
    await capability.log.append(mod.dispatchRecord('job-1', 'end-A', 'probe-tool', {}, Date.now() - 1000))
    const run = await capability.retry.run()
    const after = capability.retry.idle
    const writtenAfter = capability.retry.counts.written
    stopEvery(board)
    return [before >= 2 && after === 0 && run.reason === 'ok' && writtenAfter > writtenBefore,
      'idle ' + String(before) + '->' + String(after) + ' written ' + String(writtenBefore) + '->' + String(writtenAfter)
      + ' reason=' + dumps(run.reason)]
  })

  // R11: teardown clears the one that is already scheduled. Paired: this world's clock was moving before
  // the teardown, and it is frozen after it, with no timer reported as pending.
  await check('R11', 'teardown clears the pending chain: ticking before it, frozen after it (paired)', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, config({ enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3, schedule: { factor: 2, maxMs: 1000 } }))
    const capability = capabilityOf(board)
    const first = capability.retry.counts.ticks
    await sleep(INTERVAL * 4)
    const beforeStop = capability.retry.counts.ticks
    stopEvery(board)
    await sleep(INTERVAL * 8)
    const afterStop = capability.retry.counts.ticks
    return [beforeStop - first >= 1 && afterStop === beforeStop && capability.retry.timerInstalled === false,
      'ticking ' + String(first) + '->' + String(beforeStop) + ' then frozen at ' + String(afterStop)
      + ' installed=' + String(capability.retry.timerInstalled)]
  })

  // R12: a row that is switched off has no timer and no ticks.
  await check('R12', 'enabled:false means no timer and zero ticks', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, config({ enabled: false, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3, schedule: { factor: 2, maxMs: 1000 } }))
    const capability = capabilityOf(board)
    await sleep(INTERVAL * 6)
    const ticks = capability.retry.counts.ticks
    const installed = capability.retry.timerInstalled
    stopEvery(board)
    return [ticks === 0 && installed === false, 'ticks=' + String(ticks) + ' installed=' + String(installed)]
  })

  // R13: nextDelayMs is the delay that was really scheduled. With a factor of 2 and no jitter, the delay
  // scheduled after the first fire is the one for idle=1 — twice the base period — which is what the
  // number must say; a constant would read everyMs.
  await check('R13', 'nextDelayMs reports the scheduled delay for the current streak', async () => {
    const board = host(freshRoot())
    mod.apply(board.ctx, config({ enabled: true, everyMs: INTERVAL, timeoutMs: 1000, maxAttempts: 3, schedule: { factor: 2, maxMs: 1000 } }))
    const capability = capabilityOf(board)
    const first = capability.retry.nextDelayMs
    const deadline = Date.now() + 1000
    while ((capability.retry.counts.ticks < 1 || capability.retry.nextDelayMs === null) && Date.now() < deadline) await sleep(5)
    const afterOne = capability.retry.nextDelayMs
    const idle = capability.retry.idle
    stopEvery(board)
    return [first === INTERVAL && afterOne === expectedDelay({ everyMs: INTERVAL, factor: 2, maxMs: 1000, jitter: 0, idle: 1 })
      && afterOne > INTERVAL && idle >= 1,
      'first=' + dumps(first) + ' afterOneFire=' + dumps(afterOne) + ' idle=' + dumps(idle)
      + ' expected(idle=1)=' + dumps(expectedDelay({ everyMs: INTERVAL, factor: 2, maxMs: 1000, jitter: 0, idle: 1 }))]
  })

  // RD: the gate's own declaration of how many readings exist is not allowed to drift. Read last, so the
  // count it compares against is the whole set minus this one.
  await check('RD', 'the declared reading count matches the readings this run produced', async () => {
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

/* ------------------------------------------------ self-attack */
async function childVerdicts(modulePath) {
  const child = spawn(process.execPath, [HERE], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, R68_ATTACK_MODULE: modulePath } })
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
      if (!gateSource.includes(mutant.from)) { console.log('  ANCHOR MISSING  ' + mutant.name + '  |  ' + flat(mutant.from).slice(0, 90)); anchorsMissing += 1; continue }
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
    for (const id of mutant.declared) { if (!flipped.includes(id)) console.log('      kept green: ' + id + '  ' + String(result.details[id] ?? '(no detail)').slice(0, 180)) }
  }
  const uncovered = MODULE_READING_IDS.filter((id) => !coverage.has(id))
  console.log('coverage: ' + String(MODULE_READING_IDS.length) + ' declared readings, ' + String(coverage.size) + ' flipped by at least one mutant, uncovered ' + dumps(uncovered))
  console.log('declared-set mismatches: ' + String(mismatches) + '; anchors missing: ' + String(anchorsMissing))
  process.exitCode = mismatches === 0 && uncovered.length === 0 && anchorsMissing === 0 ? 0 : 1
}

if (process.env.R68_ATTACK_MODULE !== undefined) {
  const readings = await runReadings(process.env.R68_ATTACK_MODULE)
  for (const row of readings) { console.log('VERDICT ' + row.id + ' ' + String(row.ok)); console.log('DETAIL ' + row.id + ' ' + flat(row.detail)) }
  const failed = report(readings)
  process.exitCode = failed === 0 ? 0 : 1
} else if (SELF_ATTACK) {
  if (!existsSync(ENTRY)) { console.error('the plugin is not built: ' + ENTRY); process.exit(2) }
  await selfAttack()
} else {
  if (!existsSync(ENTRY)) { console.error('the plugin is not built: ' + ENTRY); process.exit(2) }
  const probe = await import(pathToFileURL(ENTRY).href)
  const probeHost = (() => {
    const provided = new Map()
    const ctx = {
      get: (name) => (name === 'dshHomePath' ? (...segments) => join(mkdtempSync(join(tmpdir(), 'r68-probe-')), ...segments) : undefined),
      provide: (name, value) => { provided.set(name, value) },
      effect: (body) => { const dispose = body(); return dispose },
      on: () => () => {},
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    }
    return { ctx, provided }
  })()
  let capability
  try { probe.apply(probeHost.ctx, { retry: { enabled: false } }) } catch (error) { console.error('the artifact refused a minimal retry config: ' + String(error?.message ?? error)); process.exit(1) }
  capability = probeHost.provided.get('linkCollab')
  const missing = surfaceProblems(capability)
  if (missing.length > 0) {
    console.log('SKIP  verify-collab-retry-schedule: the artifact does not carry the surface this gate reads: ' + dumps(missing))
    process.exit(3)
  }
  if (typeof probe.retryDelay !== 'function') {
    console.log('SKIP  verify-collab-retry-schedule: the artifact exports no retryDelay: ' + dumps(['retryDelay']))
    process.exit(3)
  }
  const readings = await runReadings(ENTRY)
  for (const row of readings) console.log('VERDICT ' + row.id + ' ' + String(row.ok))
  const failed = report(readings)
  process.exitCode = failed === 0 ? 0 : 1
}
