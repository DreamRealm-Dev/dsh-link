#!/usr/bin/env node
/**
 * R69 (task-124): one root, one owner — the retry lease.
 *
 * What is read: the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js) only — never src. The host
 * below is this gate's own cordis-shaped stand-in; the producer's self-check is not imported.
 *
 * The fact this round adds is a LEASE: a record that says "I am the one redispatching this root until
 * <instant>". The judge is one pure function (`retryOwner`), the planner asks it, the write face writes
 * the lease before the attempt it authorises, and the fold refuses an attempt whose writer was not the
 * holder. Almost every reading below is about one of those four sentences.
 *
 * ANCHORS: this gate was written BEFORE the producer landed, so the mutation anchors are placeholders
 * (`ANCHOR:<name>`) that cannot match the artifact on purpose. The first run's R7 and the self-attack's
 * ANCHOR MISSING lines are the checklist: replace each with the artifact's real text, never delete a
 * mutant, then re-run. A mutant whose anchor is guessed rather than read proves nothing.
 *
 * Exit 0 every reading held; 1 a reading failed; 3 the artifact does not carry the surface this gate
 * reads (printed with what is missing).
 */
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(HERE), '..')
const ENTRY = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const MUTANT_MODULE = join(PROJECT, '.tmp', 'r69-attack-module.mjs')
const MUTANT_GATE = join(PROJECT, '.tmp', 'r69-attack-gate.mjs')
const DECLARED = 14
/** The readings a MODULE mutant can move (RD is the declaration reading, moved only by the gate mutant). */
const MODULE_READING_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13']

/**
 * The mutants, with their anchors, in one place: ANCHORS is derived from this table so the checklist R7
 * grades and the swaps the attack performs can never disagree.
 */
const MUTANTS = [
  // The tie-break picks the largest end instead of the smallest: two ends claiming at once both think they win.
  { name: 'tie-break-max-end', kind: 'module', from: 'const ordered = [...live].sort((left, right) => (left.end < right.end ? -1 : left.end > right.end ? 1 : 0) || left.at - right.at || left.seq - right.seq);', to: 'const ordered = [...live].sort((left, right) => (left.end > right.end ? -1 : left.end < right.end ? 1 : 0) || left.at - right.at || left.seq - right.seq);', declared: ['R7', 'R2', 'R3', 'R9', 'R10'] },
  // A lease is still alive at the boundary: now - at === untilMs counts as held.
  { name: 'lease-equality-alive', kind: 'module', from: 'const live = relevant.filter((lease) => options.now - lease.at < lease.untilMs);', to: 'const live = relevant.filter((lease) => options.now - lease.at <= lease.untilMs);', declared: ['R7', 'R1'] },
  // The planner plans without asking the owner: a lease held by another end no longer blocks.
  { name: 'planner-ignores-lease', kind: 'module', from: '    if (owner.reason === "other") {', to: '    if (false) {', declared: ['R7', 'R4', 'R10'] },
  // The mirror defect: the planner treats "mine" as a reason to stand down, so a claimed root never advances.
  { name: 'mine-also-blocks', kind: 'module', from: '    if (owner.reason === "other") {', to: '    if (owner.reason !== "unclaimed") {', declared: ['R7', 'R13', 'R5', 'R6'] },
  // The projection stops ordering the facts, so the verdict inherits arrival order.
  { name: 'projection-unsorted', kind: 'module', from: '  return rows.sort((left, right) => left.at - right.at || left.seq - right.seq);', to: '  return rows;', declared: ['R7', 'R12'] },
  // The constructor stops refusing an unusable lease, so an illegal one reaches the ledger.
  { name: 'lease-validation-dropped', kind: 'module', from: '  if (!Number.isInteger(untilMs) || untilMs <= 0) throw new TypeError("retryLeaseRecord: untilMs must be a positive integer");', to: '  if (false) throw new TypeError("retryLeaseRecord: untilMs must be a positive integer");', declared: ['R7', 'R11'] },
  // The write face writes the attempt before the lease that authorises it.
  { name: 'attempt-without-lease', kind: 'module', from: '    written.push(await log.append(retryLeaseRecord(root, options.localEnd, options.now, options.timeoutMs)));', to: '    void retryLeaseRecord(root, options.localEnd, options.now, options.timeoutMs);', declared: ['R7', 'R5', 'R6', 'R9', 'R10'] },
  // The fold stops refusing an attempt written by a non-holder.
  { name: 'fold-accepts-nonholder', kind: 'module', from: '    if (held.holder !== null && held.holder !== writer) {', to: '    if (false) {', declared: ['R7', 'R8'] },
  // A claim is not counted.
  { name: 'claimed-not-counted', kind: 'module', from: '        retryCounts.claimed += claimed.length;', to: '        retryCounts.claimed += 0;', declared: ['R7', 'R10'] },
  // Losing the re-judgement is not counted.
  { name: 'lost-not-counted', kind: 'module', from: '          if (!retryOwner(after.retryLeases, { root, localEnd: retryLocalEnd, now: Date.now() }).mine) retryCounts.lost += 1;', to: '          if (false) retryCounts.lost += 1;', declared: ['R7', 'R10'] },
  { name: 'declaration-drifts', kind: 'gate', from: 'const DECLARED = 14', to: 'const DECLARED = 99', declared: ['RD'] },
]
const ANCHORS = MUTANTS.filter((mutant) => mutant.kind === 'module').map((mutant) => ({ mutant: mutant.name, from: mutant.from }))

const argv = process.argv.slice(2)
const SELF_ATTACK = argv.includes('--self-attack')
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const dumps = (value) => JSON.stringify(value)
const flat = (text) => String(text).replace(/\s+/g, ' ').trim()
const ROUTE = '/api/dsh-link-collab/relay'
const TOKEN = 'r69-token-' + Date.now().toString(36)
const LEASE_KIND = 'task/retry-lease'

/* ------------------------------------------------ the surface this gate reads */
function surfaceProblems(mod, capability) {
  const missing = []
  if (typeof mod.retryOwner !== 'function') missing.push('retryOwner')
  if (typeof mod.redispatchPlan !== 'function') missing.push('redispatchPlan')
  if (typeof mod.appendRedispatches !== 'function') missing.push('appendRedispatches')
  const retry = capability === undefined ? undefined : capability.retry
  if (retry === undefined || retry === null) return missing.concat(['retry (the service member)'])
  if (typeof retry.run !== 'function') missing.push('retry.run')
  const counts = retry.counts
  if (counts === undefined || counts === null) missing.push('retry.counts')
  else for (const key of ['runs', 'written', 'skipped', 'failed', 'ticks', 'claimed', 'lost']) if (typeof counts[key] !== 'number') missing.push('retry.counts.' + key)
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
  const servers = []
  const freshRoot = () => { const dir = mkdtempSync(join(tmpdir(), 'r69-lease-')); roots.push(dir); return dir }
  const cleanup = async () => {
    for (const server of servers) { try { await new Promise((done) => server.close(done)) } catch { /* already closed */ } }
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
    const board = { ctx, effects, provided, root }
    boards.push(board)
    return board
  }
  /** One end mounted on its own real HTTP server, exactly as the kernel mounts it. */
  const mounted = async (label, retryConfig) => {
    const root = freshRoot()
    const board = host(root)
    // R213: a real webServer holds a TABLE of routes and this plugin registers two (the relay and, since R207,
    // the status route). A single slot made the SECOND registration replace the first, so relayTo() pushed at a
    // server whose only route was /status, both pushes failed, and R9 read as a lease defect that was really a
    // fixture that could only remember one route.
    const routes = new Map()
    const stub = { register: (value) => { routes.set(value.path, value); return () => { routes.delete(value.path) } } }
    board.ctx.inject = (names, work) => work({ get: (name) => (name === 'webServer' ? stub : undefined) })
    mod.apply(board.ctx, { relay: { token: TOKEN, path: ROUTE }, retry: retryConfig })
    const server = createServer((req, res) => {
      const route = routes.get(req.url) ?? null
      if (route !== null) { void route.handler(req, res); return }
      res.statusCode = 404
      res.end('no route')
    })
    servers.push(server)
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    return { root, board, capability: board.provided.get('linkCollab'), url: 'http://127.0.0.1:' + String(server.address().port) + ROUTE }
  }
  const capabilityOf = (board) => board.provided.get('linkCollab')
  const stopEvery = (board) => { for (const effect of board.effects) effect.dispose() }
  const settleEvery = (board) => { for (const effect of board.effects) void effect }

  const mod = await import(pathToFileURL(modulePath).href)
  const retryOwner = mod.retryOwner
  const lease = (root, end, at, untilMs, seq) => ({ root, end, at, untilMs, seq })
  const planOptions = (now, team = 'team-1', localEnd = 'end-A', timeoutMs = 1, maxAttempts = 10) => ({ team, localEnd, now, timeoutMs, maxAttempts })

  /** Seed one world with work a pass can really append: a member of the team, its capability, a stale dispatch. */
  const seedWork = async (log, team, end, now, tool = 'probe-tool') => {
    await log.append({ kind: 'member/state', actor: team, subject: end, payload: { id: end, state: 'active', name: end } })
    await log.append({ kind: 'task/state', actor: team, subject: 'task-1', payload: { id: 'task-1', state: 'in_progress', owner: end } })
    await log.append(mod.capabilityRecord(end, [tool]))
    await log.append(mod.dispatchRecord('job-1', end, tool, {}, now - 1000))
  }
  // The record is built by the artifact's own constructor: the contract puts the validation there (a
  // ControlLog.append never validates any kind), so an illegal lease must be refused before it is written.
  const writeLease = async (log, root, end, at, untilMs) => log.append(mod.retryLeaseRecord(root, end, at, untilMs))

  // R7: the mutation anchors are still present in the artifact, so the mutants below can bite.
  await check('R7', 'every mutation anchor is a real substring of the shipped artifact', async () => {
    const text = readFileSync(modulePath, 'utf8')
    const absent = ANCHORS.filter((anchor) => !text.includes(anchor.from)).map((anchor) => anchor.mutant)
    return [absent.length === 0, 'anchors=' + String(ANCHORS.length) + ' absent=' + dumps(absent)]
  })

  // R1: the four reasons and the boundary. Equality is EXPIRED: at now - at === untilMs the lease has
  // lasted exactly as long as it was granted, and the same discipline as R54's stale boundary applies.
  await check('R1', 'retryOwner names all four reasons, and a lease is expired at the equality boundary', async () => {
    const at = 1_000
    const until = 500
    const unclaimed = retryOwner([], { root: 'r', localEnd: 'end-A', now: 2_000 })
    const mine = retryOwner([lease('r', 'end-A', at, until, 1)], { root: 'r', localEnd: 'end-A', now: 1_200 })
    const other = retryOwner([lease('r', 'end-B', at, until, 1)], { root: 'r', localEnd: 'end-A', now: 1_200 })
    const expired = retryOwner([lease('r', 'end-B', at, until, 1)], { root: 'r', localEnd: 'end-A', now: 1_500 })
    const otherRoot = retryOwner([lease('other', 'end-B', at, until, 1)], { root: 'r', localEnd: 'end-A', now: 1_200 })
    return [unclaimed.reason === 'unclaimed' && unclaimed.holder === null && unclaimed.mine === false
      && mine.reason === 'mine' && mine.mine === true && mine.holder === 'end-A'
      && other.reason === 'other' && other.mine === false && other.holder === 'end-B'
      && expired.reason === 'expired' && expired.holder === null
      && otherRoot.reason === 'unclaimed',
      'unclaimed=' + dumps(unclaimed) + ' mine=' + dumps(mine) + ' other=' + dumps(other)
      + ' atBoundary=' + dumps(expired) + ' otherRoot=' + dumps(otherRoot.reason)]
  })

  // R2: the verdict may not depend on the order the records arrived in — a merged ledger holds them in
  // relay order, and two ends comparing verdicts must agree.
  await check('R2', 'the verdict is byte-identical whatever order the leases are read in', async () => {
    const batch = [
      lease('r', 'end-C', 1_000, 100, 1),
      lease('r', 'end-A', 1_050, 1_000, 4),
      lease('r', 'end-B', 1_050, 1_000, 2),
      lease('other', 'end-A', 1_000, 9_999, 3),
      lease('r', 'end-A', 900, 10, 5),
    ]
    const orders = [
      batch,
      [...batch].reverse(),
      [batch[2], batch[0], batch[4], batch[1], batch[3]],
      [batch[4], batch[3], batch[2], batch[1], batch[0]],
    ]
    const verdicts = orders.map((order) => dumps(retryOwner(order, { root: 'r', localEnd: 'end-A', now: 1_100 })))
    const same = verdicts.every((value) => value === verdicts[0])
    const winner = retryOwner(batch, { root: 'r', localEnd: 'end-A', now: 1_100 })
    return [same && winner.reason === 'mine' && winner.holder === 'end-A',
      'distinctVerdicts=' + String(new Set(verdicts).size) + ' verdict=' + verdicts[0]]
  })

  // R3: two live claims, the smallest end wins — and the pair is inside the reading: change which name is
  // smaller and the winner follows, so "the first one read" cannot pass for "the smallest one".
  await check('R3', 'two live leases: the smallest end wins, and the winner follows the comparison (paired)', async () => {
    const now = 1_200
    const first = retryOwner([lease('r', 'end-b', 1_000, 1_000, 1), lease('r', 'end-c', 1_000, 1_000, 2)], { root: 'r', localEnd: 'end-z', now })
    const second = retryOwner([lease('r', 'end-b', 1_000, 1_000, 1), lease('r', 'end-a', 1_000, 1_000, 2)], { root: 'r', localEnd: 'end-z', now })
    const ties = retryOwner([lease('r', 'end-a', 1_000, 1_000, 7), lease('r', 'end-a', 1_000, 1_000, 3)], { root: 'r', localEnd: 'end-z', now })
    return [first.holder === 'end-b' && second.holder === 'end-a' && first.holder !== second.holder && ties.holder === 'end-a',
      'b-vs-c=' + dumps(first.holder) + ' b-vs-a=' + dumps(second.holder) + ' sameEnd=' + dumps(ties.holder)]
  })

  // R4: the planner asks the owner, and a lease held by another end blocks the root by name. Paired: the
  // same world with no lease still plans, so "blocked" is this lease's doing and not an empty world.
  await check('R4', 'a live lease held by another end blocks the plan with lease-held, and the same world without one plans', async () => {
    const now = 100_000
    const control = await mounted('control', { enabled: false })
    const controlLog = capabilityOf(control.board).log
    await seedWork(controlLog, 'team-1', 'end-A', now)
    const controlPlan = mod.redispatchPlan(mod.projectTeamState(controlLog.replay()), planOptions(now))
    const blockedBoard = await mounted('blocked', { enabled: false })
    const blockedLog = capabilityOf(blockedBoard.board).log
    await seedWork(blockedLog, 'team-1', 'end-A', now)
    await writeLease(blockedLog, 'job-1', 'end-B', now - 10, 5_000)
    const blockedPlan = mod.redispatchPlan(mod.projectTeamState(blockedLog.replay()), planOptions(now))
    const reasons = blockedPlan.blocked.map((row) => row.reason)
    return [controlPlan.entries.length === 1 && !controlPlan.blocked.some((row) => row.reason === 'lease-held')
      && blockedPlan.entries.length === 0 && dumps(reasons) === dumps(['lease-held']),
      'control=' + dumps(controlPlan.entries.map((row) => row.id)) + ' blocked=' + dumps(blockedPlan.entries.length)
      + ' reasons=' + dumps(reasons)]
  })

  // R5: the lease is written BEFORE the attempt it authorises, and that order is read off the ledger's own
  // sequence numbers, not off a return value. Paired: the very same call wrote both records.
  await check('R5', 'the write face appends the lease before the attempt, in the ledger own order', async () => {
    const now = 100_000
    const end = await mounted('write', { enabled: false })
    const log = capabilityOf(end.board).log
    await seedWork(log, 'team-1', 'end-A', now)
    const returned = await mod.appendRedispatches(mod.projectTeamState(log.replay()), log, planOptions(now))
    const records = log.replay().filter((row) => row.kind === LEASE_KIND || row.kind === 'task/dispatch')
    const kinds = records.map((row) => row.kind)
    const leaseRow = records.find((row) => row.kind === LEASE_KIND)
    const attemptRow = records.find((row) => row.kind === 'task/dispatch' && String(row.subject).includes('#r'))
    const leaseSeq = leaseRow === undefined ? -1 : leaseRow.seq
    const attemptSeq = attemptRow === undefined ? -1 : attemptRow.seq
    return [returned.length === 2 && leaseSeq > 0 && attemptSeq > 0 && leaseSeq < attemptSeq
      && dumps(returned) === dumps([leaseSeq, attemptSeq]),
      'returned=' + dumps(returned) + ' kinds=' + dumps(kinds) + ' leaseSeq=' + String(leaseSeq) + ' attemptSeq=' + String(attemptSeq)]
  })

  // R6: a second call in the same world writes nothing at all — the row is already mine, and re-claiming
  // would append a lease per poll. Paired: the first call wrote, so "nothing" is a change of state.
  await check('R6', 'a second call writes nothing: the claim is idempotent (paired against the first call)', async () => {
    const now = 100_000
    const end = await mounted('idem', { enabled: false })
    const log = capabilityOf(end.board).log
    await seedWork(log, 'team-1', 'end-A', now)
    const first = await mod.appendRedispatches(mod.projectTeamState(log.replay()), log, planOptions(now))
    const afterFirst = log.replay().length
    const second = await mod.appendRedispatches(mod.projectTeamState(log.replay()), log, planOptions(now))
    const afterSecond = log.replay().length
    return [first.length === 2 && second.length === 0 && afterSecond === afterFirst,
      'first=' + dumps(first) + ' second=' + dumps(second) + ' records ' + String(afterFirst) + '->' + String(afterSecond)]
  })

  // R8: an attempt whose writer is not the holder is refused VISIBLY — it lands in refusedDispatches with
  // reason lease-mismatch, while the holder's own attempt lands in dispatches. Both halves in one reading,
  // because "nothing was accepted" would also be true of a fold that dropped everything.
  await check('R8', 'a non-holder attempt folds as refusedDispatches/lease-mismatch, the holder attempt lands', async () => {
    const now = 100_000
    const end = await mounted('fold', { enabled: false })
    const log = capabilityOf(end.board).log
    await seedWork(log, 'team-1', 'end-A', now)
    await writeLease(log, 'job-1', 'end-A', now - 10, 60_000)
    const holderAttempt = mod.dispatchRecord('job-1#r2', 'end-A', 'probe-tool', {}, now, { retryOf: 'job-1', attempt: 2 })
    const otherAttempt = mod.dispatchRecord('job-1#r3', 'end-A', 'probe-tool', {}, now, { retryOf: 'job-1', attempt: 3 })
    await log.append({ ...holderAttempt, actor: 'end-A' })
    await log.append({ ...otherAttempt, actor: 'end-B' })
    const folded = mod.projectDispatches(log.replay())
    const refused = folded.refusedDispatches.filter((row) => row.reason === 'lease-mismatch').map((row) => row.id)
    const accepted = folded.dispatches.map((row) => row.id)
    return [accepted.includes('job-1#r2') && dumps(refused) === dumps(['job-1#r3']) && !accepted.includes('job-1#r3'),
      'accepted=' + dumps(accepted) + ' leaseMismatch=' + dumps(refused)]
  })

  // R9: two real ends race for the same root over two real ledgers and a real HTTP relay. After the merge
  // exactly one end is the holder, and at most one attempt survives as a dispatch.
  await check('R9', 'two ends claiming at once end with one holder (the smallest end) and at most one attempt', async () => {
    const now = 100_000
    const a = await mounted('race-a', { enabled: false })
    const b = await mounted('race-b', { enabled: false })
    const aLog = capabilityOf(a.board).log
    const bLog = capabilityOf(b.board).log
    await seedWork(aLog, 'team-1', 'end-A', now)
    await seedWork(bLog, 'team-1', 'end-B', now)
    const aOptions = planOptions(now, 'team-1', 'end-A')
    const bOptions = planOptions(now, 'team-1', 'end-B')
    const [aWritten, bWritten] = await Promise.all([
      mod.appendRedispatches(mod.projectTeamState(aLog.replay()), aLog, aOptions),
      mod.appendRedispatches(mod.projectTeamState(bLog.replay()), bLog, bOptions),
    ])
    const pushA = await capabilityOf(a.board).relayTo({ url: b.url, token: TOKEN, as: { writer: 'end-a', instance: aLog.instance } })
    const pushB = await capabilityOf(b.board).relayTo({ url: a.url, token: TOKEN, as: { writer: 'end-b', instance: bLog.instance } })
    const merged = mod.projectTeamState(aLog.replay())
    const ownerA = mod.retryOwner(merged.retryLeases, { root: 'job-1', localEnd: 'end-X', now })
    const ownerB = mod.retryOwner(mod.projectTeamState(bLog.replay()).retryLeases, { root: 'job-1', localEnd: 'end-X', now })
    const attempts = mod.projectDispatches(aLog.replay()).dispatches.filter((row) => String(row.id).includes('#r'))
    const alive = merged.retryLeases.filter((row) => row.root === 'job-1' && now - row.at < row.untilMs)
    return [aWritten.length >= 1 && bWritten.length >= 1 && pushA.ok === true && pushB.ok === true
      && ownerA.holder === 'end-A' && ownerB.holder === 'end-A'
      && alive.length >= 2 && attempts.length <= 1,
      'aWritten=' + dumps(aWritten) + ' bWritten=' + dumps(bWritten) + ' pushes=' + dumps([pushA.ok, pushB.ok])
      + ' holders=' + dumps([ownerA.holder, ownerB.holder]) + ' aliveLeases=' + String(alive.length)
      + ' acceptedAttempts=' + dumps(attempts.map((row) => row.id))]
  })

  // R10: the counters on the service move on the real path. Both legs drive the plugin's own pass — the
  // counters live on the service and only its pass updates them, so `appendRedispatches` is called here for
  // what it is (a frozen signature returning seqs), never to move a counter.
  await check('R10', 'claimed counts a real claim, and lost counts a claim that lost the re-judgement', async () => {
    const now = 100_000
    // A minute-long lease on purpose: with a 1 ms lease the service's own claim expires before it can be
    // judged, and both counters would move for a reason the reading never meant to test.
    const winner = await mounted('counts-win', { enabled: true, everyMs: 60_000, timeoutMs: 60_000, maxAttempts: 10, team: 'team-1', localEnd: 'end-A' })
    const winnerCapability = capabilityOf(winner.board)
    await seedWork(winnerCapability.log, 'team-1', 'end-A', now)
    const beforeClaim = winnerCapability.retry.counts
    const claimedRun = await winnerCapability.retry.run()
    const afterClaim = winnerCapability.retry.counts
    stopEvery(winner.board)
    // The losing leg is the relay window made deterministic: the appender writes through the log door, so the
    // competing lease from a smaller end lands between this end's judgement (unclaimed, so it claims) and the
    // re-judgement that decides whose attempt may be written. That is exactly what a relay arriving between
    // the two folds does to a real pair of ends — and the loser must not write an attempt.
    const loser = await mounted('counts-lose', { enabled: true, everyMs: 60_000, timeoutMs: 60_000, maxAttempts: 10, team: 'team-1', localEnd: 'end-Z' })
    const loserCapability = capabilityOf(loser.board)
    const loserLog = loserCapability.log
    await seedWork(loserLog, 'team-1', 'end-Z', now)
    const realAppend = loserLog.append.bind(loserLog)
    let injected = false
    loserLog.append = async (record) => {
      if (!injected && record !== null && typeof record === 'object' && record.kind === LEASE_KIND) {
        injected = true
        // Real milliseconds: the service judges liveness with Date.now(), so a synthetic stamp would make the
        // competing lease read as expired and hand the root straight back to this end.
        await realAppend(mod.retryLeaseRecord('job-1', 'end-A', Date.now() - 10, 60_000))
      }
      return realAppend(record)
    }
    const beforeLose = loserCapability.retry.counts
    const lostRun = await loserCapability.retry.run()
    const afterLose = loserCapability.retry.counts
    const loserAttempts = loserLog.replay().filter((row) => row.kind === 'task/dispatch' && row.payload?.retryOf === 'job-1')
    const holder = mod.retryOwner(mod.projectTeamState(loserLog.replay()).retryLeases, { root: 'job-1', localEnd: 'end-Z', now: Date.now() })
    stopEvery(loser.board)
    return [injected === true && claimedRun.reason === 'ok' && afterClaim.claimed > beforeClaim.claimed && afterClaim.written > 0
      && afterClaim.lost === beforeClaim.lost
      && afterLose.claimed > beforeLose.claimed && afterLose.lost > beforeLose.lost
      && lostRun.reason === 'ok' && loserAttempts.length === 0 && holder.mine === false && holder.holder === 'end-A',
      'claimed ' + String(beforeClaim.claimed) + '->' + String(afterClaim.claimed) + ' written=' + String(afterClaim.written)
      + ' | loser claimed ' + String(beforeLose.claimed) + '->' + String(afterLose.claimed)
      + ' lost ' + String(beforeLose.lost) + '->' + String(afterLose.lost)
      + ' attempts=' + String(loserAttempts.length) + ' holder=' + dumps(holder.holder) + ' injected=' + String(injected)]
  })

  // R11: an unusable lease is refused at the write face, by name, before anything is appended. Paired: the
  // ledger is read back and is unchanged, so "it threw" is not the only thing claimed.
  await check('R11', 'an illegal untilMs and an empty end are refused by name before anything is written', async () => {
    const now = 100_000
    const end = await mounted('illegal', { enabled: false })
    const log = capabilityOf(end.board).log
    await seedWork(log, 'team-1', 'end-A', now)
    const before = log.replay().length
    const rows = []
    for (const bad of [{ end: 'end-A', untilMs: 0 }, { end: 'end-A', untilMs: 1.5 }, { end: '', untilMs: 1_000 }]) {
      try { await writeLease(log, 'job-1', bad.end, now - 10, bad.untilMs); rows.push('no-throw') }
      catch (error) { rows.push(String(error.constructor.name) + (String(error.message).includes('untilMs') || String(error.message).includes('end') ? '/named' : '/unnamed')) }
    }
    const after = log.replay().length
    return [dumps(rows) === dumps(['TypeError/named', 'TypeError/named', 'TypeError/named']) && after === before,
      'rows=' + dumps(rows) + ' records ' + String(before) + '->' + String(after)]
  })

  // R12: the projection publishes the leases as facts, ordered by (at, seq) and independent of arrival
  // order; the judgement stays in one place and is not duplicated into the projection.
  await check('R12', 'state().retryLeases publishes the facts, ordered by (at, seq) and arrival-independent', async () => {
    const now = 100_000
    const end = await mounted('project', { enabled: false })
    const log = capabilityOf(end.board).log
    await writeLease(log, 'r1', 'end-B', now - 300, 5_000)
    await writeLease(log, 'r1', 'end-A', now - 200, 5_000)
    await writeLease(log, 'r2', 'end-C', now - 100, 5_000)
    const forward = mod.projectTeamState(log.replay()).retryLeases
    const reversed = mod.projectTeamState([...log.replay()].reverse()).retryLeases
    const key = (row) => String(row.at) + '/' + String(row.seq)
    const keys = forward.map(key)
    const sorted = [...keys].sort((left, right) => {
      const [leftAt, leftSeq] = left.split('/').map(Number)
      const [rightAt, rightSeq] = right.split('/').map(Number)
      return leftAt - rightAt || leftSeq - rightSeq
    })
    return [forward.length === 3 && dumps(keys) === dumps(sorted) && dumps(forward) === dumps(reversed),
      'leases=' + dumps(forward.map((row) => row.root + '/' + row.end + '/' + key(row))) + ' oneOrder=' + String(dumps(forward) === dumps(reversed))]
  })

  // R13: a lease that is MINE does not block the plan — mine is the case that must still dispatch, and it is
  // the mirror of R4's other-end block.
  await check('R13', 'a live lease held by this end still plans the next attempt (the mirror of lease-held)', async () => {
    const now = 100_000
    const end = await mounted('mine', { enabled: false })
    const log = capabilityOf(end.board).log
    await seedWork(log, 'team-1', 'end-A', now)
    await writeLease(log, 'job-1', 'end-A', now - 10, 5_000)
    const plan = mod.redispatchPlan(mod.projectTeamState(log.replay()), planOptions(now, 'team-1', 'end-A'))
    const reasons = plan.blocked.map((row) => row.reason)
    return [plan.entries.length === 1 && !reasons.includes('lease-held'),
      'entries=' + dumps(plan.entries.map((row) => row.id)) + ' blocked=' + dumps(reasons)]
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
  const child = spawn(process.execPath, [HERE], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, R69_ATTACK_MODULE: modulePath } })
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

if (process.env.R69_ATTACK_MODULE !== undefined) {
  const readings = await runReadings(process.env.R69_ATTACK_MODULE)
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
      get: (name) => (name === 'dshHomePath' ? (...segments) => join(mkdtempSync(join(tmpdir(), 'r69-probe-')), ...segments) : undefined),
      provide: (name, value) => { provided.set(name, value) },
      effect: (body) => { const dispose = body(); return dispose },
      on: () => () => {},
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    }
    return { ctx, provided }
  })()
  try { probe.apply(probeHost.ctx, { retry: { enabled: false } }) } catch (error) { console.error('the artifact refused a minimal retry config: ' + String(error?.message ?? error)); process.exit(1) }
  const missing = surfaceProblems(probe, probeHost.provided.get('linkCollab'))
  if (missing.length > 0) {
    console.log('SKIP  verify-collab-retry-lease: the artifact does not carry the surface this gate reads: ' + dumps(missing))
    process.exit(3)
  }
  const readings = await runReadings(ENTRY)
  for (const row of readings) console.log('VERDICT ' + row.id + ' ' + String(row.ok))
  const failed = report(readings)
  process.exitCode = failed === 0 ? 0 : 1
}
