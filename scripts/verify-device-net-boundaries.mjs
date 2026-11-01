#!/usr/bin/env node
/**
 * R71: every threshold in this build puts the equality point on the same side of the line.
 *
 * What is read: the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js) only - never src. Four
 * thresholds decide four different questions, and each one is read at three chosen instants: one
 * millisecond before the line, exactly on it, and one millisecond after it. The pair is the point: a
 * reading that only checks "the far side is across the line" says nothing about where the line is.
 *
 * The instants are CHOSEN, not waited for: every function here takes `now` as a parameter (that is the
 * project's rule since R40), so no reading sleeps, and the same instant read twice must give the same
 * bytes. A mutant that swaps the parameter for the wall clock has to make these readings fail - that is
 * what "chosen instant" buys.
 *
 * The four thresholds:
 *   dispatch staleness  now - at >= timeoutMs   => stale        (resolveDispatch / expiredDispatches)
 *   member liveness     since >= timeoutMs      => unhealthy    (livenessOf, and routing behind it)
 *   lock ttl            since >= ttlMs          => expired      (lockHolder)
 *   retry lease (R69)   now - at <  untilMs     => alive, else expired (retryOwner)
 *
 * Exit 0 every reading held; 1 a reading failed; 2 the artifact is not built; 3 the artifact does not
 * carry the surface this gate reads (printed with what is missing) - a gate that cannot see its subject
 * is not a passing gate.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(HERE), '..')
const ENTRY = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const PAGE = join(PROJECT, 'docs', 'protocol', 'device-net-v1.md')
const CHECKER = join(PROJECT, 'scripts', 'check-protocol-page.mjs')
const MUTANT_MODULE = join(PROJECT, '.tmp', 'r71-attack-module.mjs')
const MUTANT_GATE = join(PROJECT, '.tmp', 'r71-attack-gate.mjs')
const DECLARED = 15
const MODULE_READING_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14']

/* The mutation anchors are product text, taken from the built file (each occurs exactly once). A gate
 * whose mutant no longer has a subject reports green for a product nobody is watching, so R7's anchor
 * reading names any anchor that went missing. */
const MUTANTS = [
  {
    name: 'stale-equality-excluded',
    kind: 'module',
    from: 'return { id, verdict: now - entry.at >= threshold ? "stale" : "pending" };',
    to: 'return { id, verdict: now - entry.at > threshold ? "stale" : "pending" };',
    declared: ['R1', 'R10', 'R14', 'R5', 'R6'],
  },
  {
    name: 'liveness-equality-healthy',
    kind: 'module',
    from: 'return { memberId, liveness: sinceMs >= timeoutMs ? "unhealthy" : "healthy", lastHeartbeat: last, now, timeoutMs, sinceMs };',
    to: 'return { memberId, liveness: sinceMs > timeoutMs ? "unhealthy" : "healthy", lastHeartbeat: last, now, timeoutMs, sinceMs };',
    declared: ['R10', 'R2', 'R5', 'R7', 'R9'],
  },
  {
    name: 'lock-equality-not-expired',
    kind: 'module',
    from: 'const expired = sinceMs >= options.ttlMs;',
    to: 'const expired = sinceMs > options.ttlMs;',
    declared: ['R10', 'R3', 'R5'],
  },
  {
    name: 'lease-equality-alive',
    kind: 'module',
    from: 'const live = relevant.filter((lease) => options.now - lease.at < lease.untilMs);',
    to: 'const live = relevant.filter((lease) => options.now - lease.at <= lease.untilMs);',
    declared: ['R10', 'R4', 'R5'],
  },
  {
    name: 'stale-reads-the-wall-clock',
    kind: 'module',
    from: 'return { id, verdict: now - entry.at >= threshold ? "stale" : "pending" };',
    to: 'return { id, verdict: Date.now() - entry.at >= threshold ? "stale" : "pending" };',
    declared: ['R1', 'R10', 'R5', 'R6'],
  },
  {
    name: 'routing-silent-flipped',
    kind: 'module',
    from: 'if ((livenesses.get(member) ?? "unknown") !== "healthy") return { ok: false, reason: "member-silent", path, hops: path.length - 1, loop: [] };',
    to: 'if ((livenesses.get(member) ?? "unknown") === "healthy") return { ok: false, reason: "member-silent", path, hops: path.length - 1, loop: [] };',
    declared: ['R10', 'R6', 'R7'],
  },
  {
    name: 'lease-does-not-govern-same-instant',
    kind: 'module',
    // R367: R345 bucketed the leases by root, so the call site is no longer `leases.filter(...)`. The MUTATION is the same
    // rule (the claim must cover the same instant) expressed against the code that now exists - the anchor has to be a real
    // substring of the shipped artifact or the self-attack cannot prove the judge reddens (R10 says exactly that).
    from: 'const held = retryOwner(rootLeases.filter((lease) => lease.at <= request.at), {',
    to: 'const held = retryOwner(rootLeases.filter((lease) => lease.at < request.at), {',
    declared: ['R10', 'R11', 'R13'],
  },
  {
    name: 'enforcement-applies-to-original',
    kind: 'module',
    from: 'if (request.retryOf !== void 0) {',
    to: 'if (true) {',
    declared: ['R10', 'R12', 'R14'],
  },
  {
    name: 'enforcement-never-refuses',
    kind: 'module',
    from: 'if (held.holder !== null && held.holder !== writer) {',
    to: 'if (false) {',
    declared: ['R10', 'R11', 'R13'],
  },
  {
    // R8's subject is determinism, so its mutant has to make one of the two reads differ - a module
    // mutant on a threshold cannot bite it (the two reads share the chosen instant by construction).
    name: 'read-twice-at-two-instants',
    kind: 'gate',
    from: '    const first = once()\n    const second = once()',
    to: '    const first = once()\n    const second = once() + " "',
    declared: ['R8'],
  },
  { name: 'declaration-drifts', kind: 'gate', from: 'const DECLARED = 15', to: 'const DECLARED = 99', declared: ['RD'] },
]
const ANCHORS = MUTANTS.filter((mutant) => mutant.kind === 'module').map((mutant) => ({ mutant: mutant.name, from: mutant.from }))

const flat = (text) => String(text).replace(/\s+/g, ' ').trim()
const dumps = (value) => JSON.stringify(value)

/* ------------------------------------------------------------------------------------------------
 * The chosen instants and the world they are read against.
 * ---------------------------------------------------------------------------------------------- */
const TEAM = 'team-1'
const MEMBER = 'end-A'
const OTHER = 'end-C'
const LOCAL = 'end-B'
const TOOL = 'probe-tool'
const JOB = 'job-1'
const TASK = 'task-1'
const AT = 1_700_000_000_000
const THRESHOLD = 1000

async function runReadings(modulePath) {
  const readings = []
  const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail })
  const check = async (id, name, body) => {
    try { const [ok, detail] = await body(); held(id, name, ok, detail) }
    catch (error) { held(id, name, false, 'threw: ' + String(error?.message ?? error)) }
  }
  const mod = await import(pathToFileURL(modulePath).href)

  // A record is shaped the way a real log writes one (seq, channel, at, writer, instance, originSeq,
  // kind, actor, subject, payload) - the fold reads the writer to know which end a dispatch came from,
  // so a hand-built record without one is silently not a dispatch at all.
  const rec = (seq, writer, at, record) => ({
    seq, channel: 'control', at, writer, instance: 'i-1', originSeq: seq, actor: TEAM, ...record,
  })
  const worldOf = ({ heartbeatAt = AT - THRESHOLD, dispatchAt = AT - THRESHOLD, lockAt, lease, attempt }) => {
    const records = [
      rec(1, MEMBER, heartbeatAt, { kind: 'member/state', subject: MEMBER, payload: { id: MEMBER, state: 'active', name: MEMBER } }),
      rec(2, MEMBER, heartbeatAt, mod.heartbeatRecord(MEMBER, heartbeatAt)),
      rec(3, MEMBER, heartbeatAt, mod.capabilityRecord(MEMBER, [TOOL])),
      rec(4, MEMBER, heartbeatAt, mod.hostRecord(MEMBER, MEMBER, null, heartbeatAt)),
      rec(5, LOCAL, dispatchAt, mod.dispatchRecord(JOB, MEMBER, TOOL, {}, dispatchAt)),
    ]
    if (lockAt !== undefined) {
      records.push(rec(6, MEMBER, lockAt, { kind: mod.LOCK_KIND, subject: TASK, payload: { task: TASK, holder: MEMBER, at: lockAt, team: TEAM } }))
    }
    if (lease !== undefined) {
      records.push(rec(7, lease.end, lease.at, mod.retryLeaseRecord(JOB, lease.end, lease.at, lease.untilMs)))
    }
    if (attempt !== undefined) {
      // A retry attempt names the end that wrote it through the record's actor, which is what the fold
      // compares with the lease holder (R69). Without it the record would be attributed to the team.
      const at = attempt.at ?? dispatchAt
      records.push(rec(8, attempt.by, at, { ...mod.dispatchRecord(attempt.id, MEMBER, TOOL, {}, at, { retryOf: JOB, attempt: 2 }), actor: attempt.by }))
    }
    return mod.projectTeamState(records)
  }
  const live = (state) => mod.livenessOf(state, AT, { timeoutMs: THRESHOLD }).find((row) => row.memberId === MEMBER)?.liveness ?? null
  const liveAt = (state, now) => mod.livenessOf(state, now, { timeoutMs: THRESHOLD }).find((row) => row.memberId === MEMBER)?.liveness ?? null
  const verdictAt = (state, now) => mod.resolveDispatch(state, JOB, now, { timeoutMs: THRESHOLD }).verdict
  const lockAt = (state, now) => {
    const key = (state.locks ?? [])[0]?.key
    if (key === undefined) throw new Error('the folded state carries no lock, so the ttl boundary cannot be read')
    return mod.lockHolder(state, key, now, { ttlMs: THRESHOLD })
  }

  /* Every reading below reads the three instants: the last millisecond on the near side, the line
   * itself, and the first millisecond past it. */
  const BEFORE = AT - 1
  const ON = AT

  // R1: dispatch staleness. The near side must still be pending and the line itself already stale,
  // and the two must differ - otherwise this reading is not reading a boundary at all.
  await check('R1', 'dispatch staleness: the line itself is already stale, one millisecond earlier is not', async () => {
    const state = worldOf({})
    const before = verdictAt(state, BEFORE)
    const on = verdictAt(state, ON)
    const after = verdictAt(state, ON + 1)
    const expiredOn = mod.expiredDispatches(state, ON, { timeoutMs: THRESHOLD }).includes(JOB)
    const expiredBefore = mod.expiredDispatches(state, BEFORE, { timeoutMs: THRESHOLD }).includes(JOB)
    return [before === 'pending' && on === 'stale' && after === 'stale' && before !== on && expiredOn && !expiredBefore,
      'oneBefore=' + before + ' onTheLine=' + on + ' oneAfter=' + after + ' expiredBefore=' + String(expiredBefore) + ' expiredOn=' + String(expiredOn)]
  })

  // R2: member liveness. Same three instants, read from livenessOf.
  await check('R2', 'member liveness: the beat reaching the threshold is already unhealthy', async () => {
    const state = worldOf({})
    const before = liveAt(state, BEFORE)
    const on = liveAt(state, ON)
    const after = liveAt(state, ON + 1)
    return [before === 'healthy' && on === 'unhealthy' && after === 'unhealthy' && before !== on,
      'oneBefore=' + String(before) + ' onTheLine=' + String(on) + ' oneAfter=' + String(after)]
  })

  // R3: lock ttl.
  await check('R3', 'lock ttl: the lock is expired exactly when its age reaches the ttl', async () => {
    const state = worldOf({ lockAt: AT - THRESHOLD })
    const before = lockAt(state, BEFORE)
    const on = lockAt(state, ON)
    const after = lockAt(state, ON + 1)
    return [before.expired === false && on.expired === true && after.expired === true && before.expired !== on.expired,
      'sinceMs ' + String(on.sinceMs) + ' oneBefore.expired=' + String(before.expired) + ' onTheLine.expired=' + String(on.expired) + ' oneAfter.expired=' + String(after.expired)]
  })

  // R4: the retry lease (R69). Its line is the other way round in the source - `now - at < untilMs` is
  // alive - so the equality instant must NOT be alive: expired, and the owner nobody.
  await check('R4', 'retry lease: the equality instant is already expired, one millisecond earlier is not', async () => {
    const state = worldOf({ lease: { end: OTHER, at: AT - THRESHOLD, untilMs: THRESHOLD } })
    const at = (now) => mod.retryOwner(state.retryLeases, { root: JOB, localEnd: LOCAL, now })
    const before = at(BEFORE)
    const on = at(ON)
    const after = at(ON + 1)
    return [before.reason === 'other' && before.mine === false && on.reason === 'expired' && after.reason === 'expired' && before.reason !== on.reason,
      'oneBefore=' + before.reason + '(holder ' + String(before.holder) + ') onTheLine=' + on.reason + ' oneAfter=' + after.reason]
  })

  // R5: the invariant this round is named for - all four lines put the equality point on the far side.
  // Read from the measured verdicts above, not from the source text: a consistent set of functions that
  // all moved together would still be consistent, and this reading would follow them.
  await check('R5', 'all four thresholds put the equality point on the far side of the line', async () => {
    const staleWorld = worldOf({})
    const lockWorld = worldOf({ lockAt: AT - THRESHOLD })
    const leaseWorld = worldOf({ lease: { end: OTHER, at: AT - THRESHOLD, untilMs: THRESHOLD } })
    const flags = {
      'dispatch-stale': verdictAt(staleWorld, BEFORE) === 'pending' && verdictAt(staleWorld, ON) === 'stale',
      'member-unhealthy': liveAt(staleWorld, BEFORE) === 'healthy' && liveAt(staleWorld, ON) === 'unhealthy',
      'lock-expired': lockAt(lockWorld, BEFORE).expired === false && lockAt(lockWorld, ON).expired === true,
      'lease-expired': mod.retryOwner(leaseWorld.retryLeases, { root: JOB, localEnd: LOCAL, now: BEFORE }).reason !== 'expired'
        && mod.retryOwner(leaseWorld.retryLeases, { root: JOB, localEnd: LOCAL, now: ON }).reason === 'expired',
    }
    const inconsistent = Object.entries(flags).filter(([, value]) => value !== true).map(([name]) => name)
    return [inconsistent.length === 0, 'orientations=' + dumps(flags) + ' inconsistent=' + dumps(inconsistent)]
  })

  // R6: the re-dispatch end to end, at the line itself and one millisecond before it.
  await check('R6', 'the re-dispatch plan fires on the equality instant and stays quiet one millisecond earlier', async () => {
    const plan = (now) => mod.redispatchPlan(worldOf({ heartbeatAt: AT }), { team: TEAM, localEnd: LOCAL, now, timeoutMs: THRESHOLD, maxAttempts: 5 })
    const early = plan(BEFORE)
    const on = plan(ON)
    return [early.entries.length === 0 && early.blocked.length === 0 && on.entries.length === 1 && on.entries[0].id === JOB + '#r2' && on.blocked.length === 0,
      'oneBefore entries=' + dumps(early.entries.map((entry) => entry.id)) + ' oneAfterOnTheLine entries=' + dumps(on.entries.map((entry) => entry.id))]
  })

  // R7: the liveness line is not a private reading - routing must move with it at the same instant.
  await check('R7', 'routing moves with liveness at the same instant: healthy one millisecond earlier, member-silent on the line', async () => {
    const reach = (now) => mod.assignThrough(worldOf({}), TEAM, MEMBER, LOCAL, now, { timeoutMs: THRESHOLD })
    const before = reach(BEFORE)
    const on = reach(ON)
    return [before.ok === true && on.ok === false && on.reason === 'member-silent',
      'oneBefore ok=' + String(before.ok) + ' reason=' + String(before.reason) + ' | onTheLine ok=' + String(on.ok) + ' reason=' + String(on.reason)]
  })

  // R8: chosen instants are deterministic: the same instant read twice is the same bytes.
  await check('R8', 'the same chosen instant read twice gives byte-identical verdicts', async () => {
    const once = () => {
      const state = worldOf({})
      const lockWorld = worldOf({ lockAt: AT - THRESHOLD })
      const leaseWorld = worldOf({ lease: { end: OTHER, at: AT - THRESHOLD, untilMs: THRESHOLD } })
      return dumps({
        stale: verdictAt(state, ON),
        expired: mod.expiredDispatches(state, ON, { timeoutMs: THRESHOLD }),
        liveness: liveAt(state, ON),
        lock: lockAt(lockWorld, ON).expired,
        lease: mod.retryOwner(leaseWorld.retryLeases, { root: JOB, localEnd: LOCAL, now: ON }).reason,
        reach: mod.assignThrough(state, TEAM, MEMBER, LOCAL, ON, { timeoutMs: THRESHOLD }).reason,
      })
    }
    const first = once()
    const second = once()
    return [first === second, 'first=' + first.slice(0, 200) + ' identical=' + String(first === second)]
  })

  // R9: the page must carry this boundary too: a citation row pointing at the line that holds the
  // heartbeat comparison, its consequence in prose, and the citation checker accepting the page.
  // R9: the page must carry this boundary too, and it must cite the line that DECIDES silence - not a
  // function that happens to contain it. The page's table names source lines (plugins/dsh-link-collab/
  // src/index.ts) while this gate reads the built artifact, so the citation is resolved in the file the
  // row itself names and that line must hold the comparison. Both numbers are printed side by side so
  // the two yardsticks can never be confused for each other (R71 report).
  await check('R9', 'the page cites the line that decides silence, says what it means, and the checker accepts it', async () => {
    const artifact = readFileSync(modulePath, 'utf8').split(/\r?\n/)
    const artifactLine = artifact.findIndex((line) => line.includes('sinceMs >= timeoutMs ? "unhealthy" : "healthy"')) + 1
    if (artifactLine === 0) throw new Error('the artifact no longer carries the liveness comparison this reading anchors on')
    const pageText = readFileSync(PAGE, 'utf8')
    const rows = pageText.split(/\r?\n/)
      .map((line, index) => ({ line, at: index + 1 }))
      .filter((row) => row.line.trim().startsWith('|') && row.line.includes('sinceMs >= timeoutMs'))
    const resolved = rows.map((row) => {
      const cells = row.line.split('|').slice(1, -1).map((cell) => cell.trim())
      const where = cells[1] ?? ''
      const match = /^(.*):(\d+)$/.exec(where)
      if (match === null) return { where, at: row.at, holds: false, text: '' }
      const file = join(PROJECT, match[1])
      const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []
      const text = lines[Number(match[2]) - 1] ?? ''
      return { where, at: row.at, holds: text.includes('sinceMs >= timeoutMs'), text: text.trim().slice(0, 80) }
    })
    const cited = resolved.filter((row) => row.holds)
    const prose = /没有心跳|静默|member-silent|unhealthy|silent/.test(pageText)
    const run = spawnSync(process.execPath, [CHECKER], { cwd: PROJECT, encoding: 'utf8' })
    return [cited.length > 0 && prose && run.status === 0,
      'artifactLine=' + String(artifactLine) + ' citedRows=' + dumps(resolved.map((row) => row.where + (row.holds ? '=holds' : '=NOT-ON-THE-COMPARISON')))
      + ' pageMentionsSilence=' + String(prose) + ' checkerExit=' + String(run.status) + ' citedText=' + (cited[0]?.text ?? '-')]
  })

  // R10: every mutation anchor is still a real substring of the shipped artifact.
  await check('R10', 'every mutation anchor is a real substring of the shipped artifact', async () => {
    const text = readFileSync(modulePath, 'utf8')
    const absent = ANCHORS.filter((anchor) => !text.includes(anchor.from)).map((anchor) => anchor.mutant)
    return [absent.length === 0, 'anchors=' + String(ANCHORS.length) + ' each-once=' + String(ANCHORS.every((anchor) => text.split(anchor.from).length === 2)) + ' absent=' + dumps(absent)]
  })

  // R11: the lease has a second, different comparison - not "how old is it" but "which requests does it
  // govern". It governs the requests at or after its own instant and nothing written earlier, so a lease
  // and a dispatch stamped in the same millisecond are governed, while a later lease cannot retroactively
  // refuse the work that was already dispatched. Equality sits on the near side here, which is the
  // opposite of the four thresholds above - a different question, read on its own.
  // R11 reads the SAME boundary on the thing the enforcement actually governs: an attempt. It used to
  // read it on the original dispatch, which is the subject the rule must never touch - so the reading
  // went red the moment the rule was fixed (debt 48) and would have looked like a product regression.
  await check('R11', 'a lease governs the attempts at or after its own instant, and never the ones written earlier', async () => {
    const ATTEMPT = JOB + '#r2'
    const attemptAt = AT - THRESHOLD + 1
    const later = worldOf({ lease: { end: OTHER, at: attemptAt + 1, untilMs: 10 * THRESHOLD }, attempt: { by: LOCAL, id: ATTEMPT, at: attemptAt } })
    const same = worldOf({ lease: { end: OTHER, at: attemptAt, untilMs: 10 * THRESHOLD }, attempt: { by: LOCAL, id: ATTEMPT, at: attemptAt } })
    const laterAdmitted = later.dispatches.dispatches.some((row) => row.id === ATTEMPT)
    const sameRefused = !same.dispatches.dispatches.some((row) => row.id === ATTEMPT)
      && same.dispatches.refusedDispatches.some((row) => row.id === ATTEMPT && row.reason === 'lease-mismatch')
    return [laterAdmitted && sameRefused,
      'leaseOneMsLater attemptAdmitted=' + String(laterAdmitted) + ' | leaseAtTheSameInstant refused=' + dumps(same.dispatches.refusedDispatches.map((row) => row.id + ':' + row.reason))]
  })

  // R12/R13/R14: the lease governs the attempts, and nothing else (debt 48, fixed in R71-alpha). The
  // enforcement used to run for every dispatch, so a live lease held by another end made the ORIGINAL
  // piece of work disappear from the fold - the rule erased its own subject. The three readings below
  // are one reading each on purpose: "the original survives" and "the enforcement is still there" can
  // only be told apart when both are read in the SAME world.
  await check('R12', 'a live lease held by another end leaves the original dispatch it is about exactly where it was', async () => {
    const state = worldOf({ lease: { end: OTHER, at: AT - THRESHOLD, untilMs: 10 * THRESHOLD } })
    const stands = state.dispatches.dispatches.some((row) => row.id === JOB)
    const refusedReasons = state.dispatches.refusedDispatches.filter((row) => row.id === JOB).map((row) => row.reason)
    return [stands && !refusedReasons.includes('lease-mismatch'),
      'originalStands=' + String(stands) + ' visible=' + dumps(state.dispatches.dispatches.map((row) => row.id))
      + ' refusedAs=' + dumps(refusedReasons)]
  })

  await check('R13', 'a retry attempt by an end that does not hold the lease is refused, and the same attempt is admitted when nobody holds one (paired)', async () => {
    const ATTEMPT = JOB + '#r2'
    const leased = worldOf({ lease: { end: OTHER, at: AT - THRESHOLD, untilMs: 10 * THRESHOLD }, attempt: { by: LOCAL, id: ATTEMPT } })
    const open = worldOf({ attempt: { by: LOCAL, id: ATTEMPT } })
    const refused = leased.dispatches.refusedDispatches.some((row) => row.id === ATTEMPT && row.reason === 'lease-mismatch')
    const hidden = !leased.dispatches.dispatches.some((row) => row.id === ATTEMPT)
    const admitted = open.dispatches.dispatches.some((row) => row.id === ATTEMPT)
    return [refused && hidden && admitted,
      'withLease refusedAsMismatch=' + String(refused) + ' keptOutOfDispatches=' + String(hidden)
      + ' | noLease admitted=' + String(admitted)
      + ' refusedRows=' + dumps(leased.dispatches.refusedDispatches.map((row) => row.id + ':' + row.reason))]
  })

  await check('R14', 'with another end holding the lease the plan is still refused under lease-held, and plans nothing', async () => {
    const state = worldOf({ lease: { end: OTHER, at: AT - THRESHOLD, untilMs: 10 * THRESHOLD } })
    const plan = mod.redispatchPlan(state, { team: TEAM, localEnd: LOCAL, now: AT, timeoutMs: THRESHOLD, maxAttempts: 5 })
    const held = plan.blocked.some((row) => row.from === JOB && row.reason === 'lease-held')
    return [plan.entries.length === 0 && held,
      'entries=' + dumps(plan.entries.map((entry) => entry.id)) + ' blocked=' + dumps(plan.blocked.map((row) => row.from + ':' + row.reason))]
  })

  await check('RD', 'the declared reading count matches the readings this run produced', async () => {
    return [readings.length + 1 === DECLARED, 'declared=' + String(DECLARED) + ' produced=' + String(readings.length + 1)]
  })

  return readings
}

/* ------------------------------------------------------------------------------------------------
 * Surface check: a gate that cannot see its subject reports SKIP, not PASS.
 * ---------------------------------------------------------------------------------------------- */
const REQUIRED = ['projectTeamState', 'heartbeatRecord', 'capabilityRecord', 'hostRecord', 'dispatchRecord', 'LOCK_KIND', 'livenessOf', 'lockHolder', 'assignThrough', 'resolveDispatch', 'expiredDispatches', 'retryOwner', 'retryLeaseRecord', 'redispatchPlan']
function surfaceProblems(mod) {
  return REQUIRED.filter((name) => mod[name] === undefined).map((name) => name)
}

/* ------------------------------------------------------------------------------------------------
 * --self-attack: mutate a copy of the artifact (and of this gate), and require every declared
 * reading to flip. The declared sets are compared with what actually flipped; an undeclared flip and
 * an unflipped declaration are both failures.
 * ---------------------------------------------------------------------------------------------- */
async function selfAttack() {
  if (!existsSync(ENTRY)) { console.error('the plugin is not built: ' + ENTRY); process.exit(2) }
  const shipped = readFileSync(ENTRY, 'utf8')
  const baseline = await runReadings(ENTRY)
  const baselineFailed = baseline.filter((reading) => !reading.ok).map((reading) => reading.id)
  // The baseline array already carries RD, and RD is the reading that counts itself: adding one here
  // made the guard refuse every attack on a healthy artifact (the counting is done inside RD).
  if (baselineFailed.length > 0 || baseline.length !== DECLARED) {
    console.error('self-attack cannot run: the readings do not hold on the shipped artifact (failed ' + dumps(baselineFailed) + ', seen ' + String(baseline.length) + ' of declared ' + String(DECLARED - 1) + ')')
    process.exit(1)
  }
  writeFileSync(join(PROJECT, '.tmp', 'r71-baseline.json'), JSON.stringify(baseline, undefined, 2))
  const mismatches = []
  const flippedBy = new Map()
  const anchorsMissing = []
  for (const mutant of MUTANTS) {
    if (mutant.kind === 'gate') {
      const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
      if (!source.includes(mutant.from)) { anchorsMissing.push(mutant.name); continue }
      writeFileSync(MUTANT_GATE, source.replace(mutant.from, mutant.to))
      const run = spawnSync(process.execPath, [MUTANT_GATE], { cwd: PROJECT, encoding: 'utf8', env: { ...process.env, R71_CHILD: '1' } })
      const flipped = /VERDICT (R[0-9A-Za-z]+) false/.exec(run.stdout ?? '') === null ? [] : (run.stdout ?? '').split(/\r?\n/).filter((line) => /VERDICT \S+ false/.test(line)).map((line) => /VERDICT (\S+) false/.exec(line)[1])
      const declared = [...mutant.declared].sort().join(',')
      const actual = [...new Set(flipped)].sort().join(',')
      if (declared !== actual) mismatches.push(mutant.name + ': declared [' + declared + '] flipped [' + actual + ']')
      else for (const id of new Set(flipped)) flippedBy.set(id, [...(flippedBy.get(id) ?? []), mutant.name])
      continue
    }
    if (!shipped.includes(mutant.from)) { anchorsMissing.push(mutant.name); continue }
    writeFileSync(MUTANT_MODULE, shipped.replace(mutant.from, mutant.to))
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { cwd: PROJECT, encoding: 'utf8', env: { ...process.env, R71_ATTACK_MODULE: MUTANT_MODULE } })
    const flipped = (run.stdout ?? '').split(/\r?\n/).filter((line) => /VERDICT \S+ false/.test(line)).map((line) => /VERDICT (\S+) false/.exec(line)[1])
    const declared = [...mutant.declared].sort().join(',')
    const actual = [...new Set(flipped)].sort().join(',')
    if (declared !== actual) mismatches.push(mutant.name + ': declared [' + declared + '] flipped [' + actual + ']')
    else for (const id of new Set(flipped)) flippedBy.set(id, [...(flippedBy.get(id) ?? []), mutant.name])
  }
  const uncovered = MODULE_READING_IDS.filter((id) => !flippedBy.has(id))
  console.log('coverage: ' + String(MODULE_READING_IDS.length) + ' declared module readings, ' + String(flippedBy.size) + ' flipped by at least one mutant, uncovered ' + dumps(uncovered))
  console.log('declared-set mismatches: ' + String(mismatches.length) + '; anchors missing: ' + String(anchorsMissing.length))
  for (const line of mismatches) console.log('  MISMATCH ' + line)
  for (const line of anchorsMissing) console.log('  ANCHOR-MISSING ' + line)
  rmSync(MUTANT_MODULE, { force: true })
  rmSync(MUTANT_GATE, { force: true })
  process.exitCode = mismatches.length === 0 && uncovered.length === 0 && anchorsMissing.length === 0 ? 0 : 1
}

const argv = process.argv.slice(2)
if (argv.includes('--self-attack')) { await selfAttack() } else {
  if (!existsSync(ENTRY)) { console.error('the plugin is not built: ' + ENTRY); process.exit(2) }
  const target = process.env.R71_ATTACK_MODULE ?? ENTRY
  const mod = await import(pathToFileURL(target).href)
  const missing = surfaceProblems(mod)
  if (missing.length > 0) { console.error('this artifact does not carry the surface this gate reads: ' + dumps(missing)); process.exit(3) }
  const readings = await runReadings(target)
  let failed = 0
  for (const reading of readings) {
    if (!reading.ok) failed += 1
    console.log('  ' + (reading.ok ? 'ok   ' : 'FAIL ') + ' ' + reading.id + '  ' + reading.name + '  |  ' + reading.detail)
    console.log('VERDICT ' + reading.id + ' ' + String(reading.ok))
  }
  console.log(String(readings.length - failed) + ' of ' + String(DECLARED) + ' readings held')
  process.exitCode = failed === 0 ? 0 : 1
}
