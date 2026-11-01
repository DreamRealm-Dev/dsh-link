#!/usr/bin/env node
/**
 * R43 (task-81): a writer's OWN stream is numbered by "which record of mine is this", not by the log's
 * local sequence. Before the fix, a log that had ingested three peer records numbered its own first record
 * 4, so relaying it back was refused as a gap — the second writer could never answer. Contract: the task-81
 * brief. Shape authority: plugins/dsh-link-collab/lib/index.js (the built module, never src).
 *
 * Every expected value is computed HERE, from the ledger and the relay calls: a writer's own stream must be
 * 1..n contiguous and must not inherit the local counter, an ingested record must keep the position its
 * sender gave it, and the session fold is re-derived by this gate's own reading of the R41/R42 rules. This
 * gate runs NO other gate (the suite owns that sweep), so it is a seconds-long run by construction.
 *
 *   1 a fresh own stream is 1..n, and equals the local counter only while nothing was ingested
 *   2 THE FIX: after B ingests A's three records, B's own stream still starts at 1 (its local seqs are 4,5)
 *   3 the return leg lands: A accepts B's stream (before the fix this was RELAY_GAP), at B's own positions
 *   4 both ends then fold byte-identically, and this gate's own fold names the same author and the same turns
 *   5 COUNTEREXAMPLE, first form: a stream that starts beyond what the log holds is still refused (RELAY_GAP)
 *   6 COUNTEREXAMPLE, second form: a batch with a hole inside, or a position twice, is still refused
 *   7 ingested records keep the sender's positions, and two writers never share a counter
 *   8 re-sending a stream stays idempotent (appended 0, ledger unchanged)
 *   9 a ping-pong keeps both own streams contiguous and both folds identical
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed). --self-attack mutates the BUILT
 * module (anchors are matched out of lib/index.js itself, so a refactor cannot leave one silently stale):
 * every mutant must redden exactly the set it declares, the coverage matrix is printed, and every reading
 * must be claimed by at least one mutant.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes('--self-attack')
const MODULE = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
// The contract's discipline: every log this gate opens lives under .tmp, never in the live home.
const SCRATCH = join(PROJECT, '.tmp')

const WRITER_A = 'device-a'
const WRITER_B = 'device-b'
const SESSION = 'sess-1'
const END_A = 'end-A'
const END_B = 'end-B'
const NOW = 1_800_000_000_000
const TURN_KIND = 'session/turn'

const SENTENCES = {
  1: 'a fresh writer own stream is 1..n contiguous  [task-81 R1]',
  2: 'after ingesting a peer stream the own stream STILL starts at 1 (the fix)  [task-81 R1]',
  3: 'the return leg lands: the peer accepts the own stream at its own positions  [task-81 R1]',
  4: 'both ends fold byte-identically and this gate own fold agrees  [task-81 R1]',
  5: 'COUNTEREXAMPLE: a stream starting beyond what the log holds is still refused (RELAY_GAP)  [task-81 R2]',
  6: 'COUNTEREXAMPLE: a hole inside, or a position twice, is still refused  [task-81 R2]',
  7: 'ingested records keep the sender positions; two writers never share a counter  [task-81 R1]',
  8: 're-sending a stream is idempotent  [task-81 R3]',
  9: 'a ping-pong keeps both own streams contiguous and both folds identical  [task-81 R1]',
}

// ---------------------------------------------------------------- helpers
const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === 'skip' })
  console.log('  ' + (status === true ? 'ok  ' : (status === 'skip' ? 'SKIP' : 'FAIL')) + '  ' + n + '. ' + detail)
}
const start = (n) => { console.log(''); console.log('-- ' + n + '. ' + SENTENCES[n]) }
const clip = (text, n) => { const s = String(text); return s.length > n ? s.slice(0, n) + '...' : s }
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const freshDir = () => mkdtempSync(join(SCRATCH, 'r43-stream-'))
const refusal = async (work) => { try { await work(); return 'ACCEPTED' } catch (error) { return String(error?.code ?? error?.name ?? 'ERROR') } }
const exported = (log) => log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at }))
const ownSeqs = (log) => log.ownPage(0).map((row) => row.originSeq)
const localSeqs = (log) => log.ownPage(0).map((row) => row.seq)
const marksOf = (log, writer) => log.marks().find((mark) => mark.writer === writer) ?? null
const contiguousFromOne = (seqs) => show(seqs) === show(seqs.map((_, index) => index + 1))
const batch = (log) => ({ writer: log.writer, instance: log.instance, records: exported(log) })
const taken = (batch_, drop) => ({ ...batch_, records: batch_.records.filter((row) => !drop.includes(row.seq)) })

/** This gate's own reading of the session rules (R41) and the turn rules (R42), from the records alone. */
const projection = (records) => {
  const owners = new Map()
  const turns = []
  const rejected = []
  for (const row of [...records].sort((left, right) => left.seq - right.seq)) {
    const payload = row.payload ?? {}
    const session = typeof payload.session === 'string' && payload.session !== '' ? payload.session : null
    if (row.kind === TURN_KIND) {
      const end = typeof payload.end === 'string' && payload.end !== '' ? payload.end : null
      const epoch = Number.isSafeInteger(payload.epoch) ? payload.epoch : null
      if (session === null || end === null || epoch === null || typeof payload.text !== 'string') { rejected.push({ seq: row.seq, reason: 'malformed' }); continue }
      const held = owners.get(session) ?? null
      const reason = held === null ? 'no-author' : end === held.end && epoch === held.epoch ? null : epoch <= held.epoch ? 'stale-epoch' : end !== held.end ? 'not-author' : 'unrecorded-epoch'
      if (reason !== null) rejected.push({ seq: row.seq, reason })
      else turns.push({ seq: row.seq, text: payload.text, end, epoch })
      continue
    }
    if (row.kind !== 'session/claim' && row.kind !== 'session/handoff') continue
    const by = row.kind === 'session/handoff' ? 'handoff' : 'claim'
    const end = by === 'claim' ? payload.end : payload.to
    const epoch = Number.isSafeInteger(payload.epoch) ? payload.epoch : null
    if (session === null || typeof end !== 'string' || end === '' || epoch === null || epoch < 1) continue
    const held = owners.get(session) ?? null
    if (held !== null && epoch <= held.epoch) continue
    if (by === 'handoff' && (held === null || payload.from !== held.end || epoch !== held.epoch + 1)) continue
    owners.set(session, { session, end, epoch, seq: row.seq, by })
  }
  const mine = [...owners.values()].sort((left, right) => (left.session < right.session ? -1 : left.session > right.session ? 1 : 0))
  return { owner: mine.find((row) => row.session === SESSION) ?? null, turns, rejected }
}
const digests = (mod, log) => {
  const state = mod.projectTeamState(log.replay())
  return { raw: JSON.stringify(state.sessions ?? null), turns: JSON.stringify((state.sessions?.turns ?? []).map((row) => ({ session: row.session, end: row.end, epoch: row.epoch, text: row.text, seq: row.seq }))) }
}

// ---------------------------------------------------------------- the readings (one world, run in order)
async function run(a, mod) {
  const dir = freshDir()
  const logA = a.openLog({ dir: join(dir, 'a'), writer: WRITER_A })
  const logB = a.openLog({ dir: join(dir, 'b'), writer: WRITER_B })
  const problems = {}
  const notes = {}
  const say = (n, problem) => { (problems[n] = problems[n] ?? []).push(problem) }
  const note = (n, text) => { (notes[n] = notes[n] ?? []).push(text) }
  // The module's builders take an object (turnRecord) or positional arguments (sessionClaim/Handoff):
  // these wrappers are the only place this gate calls them, with the fixture clock.
  const C = (session, end, epoch) => a.claim(session, end, epoch, NOW)
  const H = (session, from, to, epoch) => a.handoff(session, from, to, epoch, NOW)
  const T = (session, end, epoch, text) => a.turn({ session, end, epoch, text }, NOW)
  try {
    // ---------------------------------------------------------------- 1 a fresh own stream
    start(1)
    await logA.append(C(SESSION, END_A, 1))
    await logA.append(T(SESSION, END_A, 1, 'A speaks'))
    await logA.append(H(SESSION, END_A, END_B, 2))
    const aOwn = ownSeqs(logA)
    if (!contiguousFromOne(aOwn)) say(1, 'A own stream is ' + show(aOwn) + ', expected 1..n contiguous')
    if (logA.lastSeq !== 3) say(1, 'A local sequence is ' + show(logA.lastSeq) + ', expected 3')
    if (show(localSeqs(logA)) !== show(aOwn)) say(1, 'with nothing ingested the two counters should agree: own ' + show(aOwn) + ' vs local ' + show(localSeqs(logA)))
    if (logA.ownPage(0).some((row) => row.writer !== WRITER_A)) say(1, 'ownPage returned a record written by someone else')
    note(1, 'A own ' + show(aOwn) + ' local ' + show(localSeqs(logA)) + ' lastSeq ' + show(logA.lastSeq))
    console.log('      ' + notes[1].join('; '))
    record(1, (problems[1] ?? []).length === 0, (problems[1] ?? []).length === 0 ? 'a writer own stream starts at 1 and counts its own records: ' + notes[1][0] : problems[1].join(' | '))

    // ---------------------------------------------------------------- 2 the fix: own stream after ingesting
    start(2)
    const landedA = await logB.ingest(batch(logA))
    if (landedA?.appended !== 3) say(2, 'B ingested ' + show(landedA?.appended ?? null) + ' of A records, expected 3')
    if (ownSeqs(logB).length !== 0) say(2, 'B own stream is not empty before B writes: ' + show(ownSeqs(logB)))
    await logB.append(T(SESSION, END_B, 2, 'B one'))
    await logB.append(T(SESSION, END_B, 2, 'B two'))
    const bOwn = ownSeqs(logB)
    const bLocal = localSeqs(logB)
    if (!contiguousFromOne(bOwn)) say(2, 'B own stream is ' + show(bOwn) + ', expected [1,2]: a writer own numbering must not inherit the local counter (the R43 defect was ' + show(bLocal) + ')')
    if (show(bOwn) === show(bLocal)) say(2, 'B own stream equals its local sequence, so the fix is not in force')
    if (logB.lastSeq !== 5) say(2, 'B local sequence is ' + show(logB.lastSeq) + ', expected 5 (three ingested + two own)')
    note(2, 'B own ' + show(bOwn) + ' but local ' + show(bLocal) + ' (lastSeq ' + show(logB.lastSeq) + ')')
    console.log('      ' + notes[2].join('; '))
    record(2, (problems[2] ?? []).length === 0, (problems[2] ?? []).length === 0 ? 'the own stream restarts at 1 for the second writer: ' + notes[2][0] : problems[2].join(' | '))

    // ---------------------------------------------------------------- 3 the return leg lands
    start(3)
    // One call only: the relay is not idempotent-in-place for this reading (reading 8 owns re-sending).
    let returnVerdict = null
    try { returnVerdict = await logA.ingest(batch(logB)) } catch (error) { returnVerdict = String(error?.code ?? error?.message ?? error) }
    if (typeof returnVerdict === 'string') say(3, 'A refused B own stream (' + returnVerdict + '); before the R43 fix this was RELAY_GAP and the reading is exactly about it landing now')
    else {
      if (returnVerdict.appended !== 2 || returnVerdict.skipped !== 0) say(3, 'A landed ' + clip(show(returnVerdict), 90) + ', expected appended 2 / skipped 0')
      const copies = logA.replay().filter((row) => row.writer === WRITER_B)
      if (show(copies.map((row) => row.originSeq)) !== show([1, 2])) say(3, 'A stored B records at ' + show(copies.map((row) => row.originSeq)) + ', expected their own positions [1,2]')
    }
    note(3, 'A lands B own stream: ' + clip(show(returnVerdict), 90))
    console.log('      ' + notes[3].join('; '))
    record(3, (problems[3] ?? []).length === 0, (problems[3] ?? []).length === 0 ? 'the second writer own stream travels back and lands at its own positions: ' + notes[3][0] : problems[3].join(' | '))

    // ---------------------------------------------------------------- 4 both ends fold the same thing
    start(4)
    const foldA = digests(mod, logA)
    const foldB = digests(mod, logB)
    if (foldA.raw !== foldB.raw) say(4, 'the two ends fold different sessions: A ' + clip(foldA.raw, 150) + ' vs B ' + clip(foldB.raw, 150))
    const mineA = projection(logA.replay())
    const mineB = projection(logB.replay())
    if (show(mineA.turns.map((row) => row.text)) !== show(['A speaks', 'B one', 'B two'])) say(4, 'this gate own fold acquires turns ' + show(mineA.turns.map((row) => row.text)) + ', expected the three authored turns')
    if (mineA.rejected.length !== 0) say(4, 'this gate own fold rejects ' + show(mineA.rejected.map((row) => row.reason)) + ', expected none')
    if (mineA.owner === null || mineA.owner.end !== END_B || mineA.owner.epoch !== 2) say(4, 'this gate own fold names the author ' + clip(show(mineA.owner), 80) + ', expected ' + END_B + '@2')
    if (show(mineA.turns.map((row) => row.text)) !== show(mineB.turns.map((row) => row.text))) say(4, 'the two logs disagree in this gate own fold')
    const implTurns = JSON.parse(foldA.turns)
    if (implTurns.length !== 3) say(4, 'the implementation folds ' + show(implTurns.length) + ' adopted turns, expected 3')
    if (logA.replay().length !== logB.replay().length) say(4, 'the two logs hold a different number of records: ' + logA.replay().length + ' vs ' + logB.replay().length)
    note(4, 'both ends: author ' + clip(show(mineA.owner), 60) + ', turns ' + show(mineA.turns.map((row) => row.text)) + ', byte-identical ' + show(foldA.raw === foldB.raw))
    console.log('      ' + notes[4].join('; '))
    record(4, (problems[4] ?? []).length === 0, (problems[4] ?? []).length === 0 ? 'after the round trip both ends fold byte-identically and this gate own fold agrees: ' + notes[4][0] : problems[4].join(' | '))

    // ---------------------------------------------------------------- 5 counterexample: a stream that starts beyond have
    start(5)
    const dirC = freshDir()
    let logC = null
    try {
      logC = a.openLog({ dir: join(dirC, 'c'), writer: 'device-c' })
      const before = logC.replay().length
      const gapStart = await refusal(() => logC.ingest(taken(batch(logA), [1])))
      if (gapStart !== 'RELAY_GAP') say(5, 'a stream starting at 2 while the log holds none was answered ' + show(gapStart) + ', expected RELAY_GAP')
      if (logC.replay().length !== before) say(5, 'the refused gap grew the ledger: ' + before + ' -> ' + logC.replay().length)
      const single = await refusal(() => logC.ingest({ writer: WRITER_A, instance: logA.instance, records: exported(logA).filter((row) => row.seq === 3) }))
      if (single !== 'RELAY_GAP') say(5, 'a single record at position 3 with nothing held was answered ' + show(single) + ', expected RELAY_GAP')
      note(5, 'drop the first record -> ' + gapStart + '; send only position 3 -> ' + single + '; C ledger ' + before + ' -> ' + logC.replay().length)
    } finally {
      if (logC !== null) await logC.close()
      rmSync(dirC, { recursive: true, force: true })
    }
    console.log('      ' + notes[5].join('; '))
    record(5, (problems[5] ?? []).length === 0, (problems[5] ?? []).length === 0 ? 'the gap rule is intact: ' + notes[5][0] : problems[5].join(' | '))

    // ---------------------------------------------------------------- 6 counterexample: a hole inside, a position twice
    start(6)
    const dirD = freshDir()
    let logD = null
    try {
      logD = a.openLog({ dir: join(dirD, 'd'), writer: 'device-d' })
      const before = logD.replay().length
      const hole = await refusal(() => logD.ingest(taken(batch(logA), [2])))
      if (hole !== 'RELAY_HOLE') say(6, 'a batch skipping a position inside (1 and 3) was answered ' + show(hole) + ', expected RELAY_HOLE')
      if (logD.replay().length !== before) say(6, 'the refused hole grew the ledger: ' + before + ' -> ' + logD.replay().length)
      const twice = await refusal(() => logD.ingest({ writer: WRITER_A, instance: logA.instance, records: [exported(logA)[0], exported(logA)[0]] }))
      if (twice !== 'RELAY_MALFORMED') say(6, 'a batch carrying one position twice was answered ' + show(twice) + ', expected RELAY_MALFORMED')
      const notInteger = await refusal(() => logD.ingest({ writer: WRITER_A, instance: logA.instance, records: [{ seq: 1.5, kind: 'task/state', payload: { id: 'x' } }] }))
      if (notInteger !== 'RELAY_MALFORMED') say(6, 'a batch carrying a non-integer position was answered ' + show(notInteger) + ', expected RELAY_MALFORMED')
      if (logD.replay().length !== before) say(6, 'a refused batch still grew the ledger: ' + before + ' -> ' + logD.replay().length)
      note(6, 'hole -> ' + hole + '; position twice -> ' + twice + '; non-integer -> ' + notInteger + '; D ledger ' + before + ' -> ' + logD.replay().length)
    } finally {
      if (logD !== null) await logD.close()
      rmSync(dirD, { recursive: true, force: true })
    }
    console.log('      ' + notes[6].join('; '))
    record(6, (problems[6] ?? []).length === 0, (problems[6] ?? []).length === 0 ? 'the shape rules are intact: ' + notes[6][0] : problems[6].join(' | '))

    // ---------------------------------------------------------------- 7 two writers, two counters
    start(7)
    const copiesA = logB.replay().filter((row) => row.writer === WRITER_A)
    if (show(copiesA.map((row) => row.originSeq)) !== show([1, 2, 3])) say(7, 'A records as B holds them are at ' + show(copiesA.map((row) => row.originSeq)) + ', expected the sender positions [1,2,3]')
    const markA = marksOf(logB, WRITER_A)
    if (markA === null || markA.lastSeq !== 3) say(7, 'B mark for A is ' + clip(show(markA), 80) + ', expected lastSeq 3 (so an incremental relay continues at 4)')
    const markB = marksOf(logB, WRITER_B)
    if (markB === null || markB.lastSeq !== 2) say(7, 'B mark for itself is ' + clip(show(markB), 80) + ', expected lastSeq 2')
    if (show(ownSeqs(logB)) !== show([1, 2])) say(7, 'B own stream changed while ingesting: ' + show(ownSeqs(logB)))
    if (show(copiesA.map((row) => row.instance)) !== show([logA.instance, logA.instance, logA.instance])) say(7, 'A records lost their instance on the way in')
    note(7, 'B holds A at ' + show(copiesA.map((row) => row.originSeq)) + ' (mark ' + show(markA?.lastSeq ?? null) + ') and itself at ' + show(ownSeqs(logB)) + ' (mark ' + show(markB?.lastSeq ?? null) + ')')
    console.log('      ' + notes[7].join('; '))
    record(7, (problems[7] ?? []).length === 0, (problems[7] ?? []).length === 0 ? 'the two writers never share a counter and positions survive the trip: ' + notes[7][0] : problems[7].join(' | '))

    // ---------------------------------------------------------------- 8 idempotence
    start(8)
    const beforeAgain = logA.replay().length
    const again = await logA.ingest(batch(logB))
    if (again?.appended !== 0) say(8, 're-sending B own stream appended ' + show(again?.appended ?? null) + ', expected 0')
    if (again?.skipped !== 2) say(8, 're-sending B own stream skipped ' + show(again?.skipped ?? null) + ', expected 2')
    if (logA.replay().length !== beforeAgain) say(8, 'the ledger changed on a re-send: ' + beforeAgain + ' -> ' + logA.replay().length)
    note(8, 're-send -> ' + clip(show(again), 70) + '; A ledger ' + beforeAgain + ' -> ' + logA.replay().length)
    console.log('      ' + notes[8].join('; '))
    record(8, (problems[8] ?? []).length === 0, (problems[8] ?? []).length === 0 ? 'the fix did not turn a re-send into a new batch: ' + notes[8][0] : problems[8].join(' | '))

    // ---------------------------------------------------------------- 9 ping-pong
    start(9)
    // The pen goes BACK: B hands the session to A at epoch 3 (B own stream position 3), then A writes and
    // relays. Both directions of the exchange are exercised, and every turn below is authored by the end
    // that actually holds the session at that moment, so this is a legal ping-pong and not a rubber stamp.
    await logB.append(H(SESSION, END_B, END_A, 3))
    const bToA = await logA.ingest(batch(logB))
    if (bToA?.appended !== 1) say(9, 'B third record (the handoff back) landed as ' + clip(show(bToA), 70) + ', expected appended 1')
    await logA.append(T(SESSION, END_A, 3, 'A four'))
    const aToB = await logB.ingest(batch(logA))
    if (aToB?.appended !== 1) say(9, 'A fourth record landed as ' + clip(show(aToB), 70) + ', expected appended 1')
    if (!contiguousFromOne(ownSeqs(logA))) say(9, 'after the ping-pong A own stream is ' + show(ownSeqs(logA)) + ', expected 1..n')
    if (!contiguousFromOne(ownSeqs(logB))) say(9, 'after the ping-pong B own stream is ' + show(ownSeqs(logB)) + ', expected 1..n')
    const finalA = digests(mod, logA)
    const finalB = digests(mod, logB)
    if (finalA.raw !== finalB.raw) say(9, 'after the ping-pong the two ends fold differently: A ' + clip(finalA.raw, 140) + ' vs B ' + clip(finalB.raw, 140))
    const mineFinal = projection(logA.replay())
    const texts = mineFinal.turns.map((row) => row.text)
    if (show(texts) !== show(['A speaks', 'B one', 'B two', 'A four'])) say(9, 'this gate own fold acquires turns ' + show(texts) + ', expected the four turns the pen allows, in seq order')
    if (mineFinal.owner === null || mineFinal.owner.end !== END_A || mineFinal.owner.epoch !== 3) say(9, 'this gate own fold names the author ' + clip(show(mineFinal.owner), 80) + ', expected ' + END_A + '@3 after the handoff back')
    if (mineFinal.rejected.length !== 0) say(9, 'this gate own fold rejects ' + show(mineFinal.rejected) + ', expected none')
    note(9, 'A own ' + show(ownSeqs(logA)) + ', B own ' + show(ownSeqs(logB)) + ', turns ' + show(texts) + ', author ' + clip(show(mineFinal.owner?.end ?? null) + '@' + show(mineFinal.owner?.epoch ?? null), 40) + ', byte-identical ' + show(finalA.raw === finalB.raw))
    console.log('      ' + notes[9].join('; '))
    record(9, (problems[9] ?? []).length === 0, (problems[9] ?? []).length === 0 ? 'both streams stay contiguous and both folds stay identical: ' + notes[9][0] : problems[9].join(' | '))
  } finally {
    try { await logA.close() } catch { /* nothing to do */ }
    try { await logB.close() } catch { /* nothing to do */ }
    rmSync(dir, { recursive: true, force: true })
  }
  return results
}

const apiOf = (mod) => ({
  project: typeof mod?.projectTeamState === 'function' ? mod.projectTeamState : null,
  openLog: typeof mod?.openControlLog === 'function' ? mod.openControlLog : null,
  claim: typeof mod?.sessionClaim === 'function' ? mod.sessionClaim : null,
  handoff: typeof mod?.sessionHandoff === 'function' ? mod.sessionHandoff : null,
  turn: typeof mod?.turnRecord === 'function' ? mod.turnRecord : null,
})
const REQUIRED = [
  ['project', 'projectTeamState'], ['openLog', 'openControlLog'], ['claim', 'sessionClaim'], ['handoff', 'sessionHandoff'], ['turn', 'turnRecord'],
]

async function runAll(modulePath) {
  results.length = 0
  const mod = await load(modulePath)
  const a = apiOf(mod)
  const gone = REQUIRED.filter(([key]) => a[key] === null).map(([, name]) => name)
  if (gone.length > 0) {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      start(n)
      record(n, false, 'the module exposes no ' + gone.join(', ') + ' — the sentence cannot be read on this build')
    }
    return { failed: results.filter((row) => !row.ok).map((row) => row.n) }
  }
  try {
    await run(a, mod)
  } catch (error) {
    const already = new Set(results.map((row) => row.n))
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      if (already.has(n)) continue
      start(n)
      record(n, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
    }
  }
  return { failed: results.filter((row) => !row.ok).map((row) => row.n) }
}

// Anchors are matched out of the build product itself; a mutant whose anchor is missing FAILS the
// self-attack instead of quietly disappearing (R40 lost a mutant that way once).
const MUTATIONS = [
  {
    name: 'the own stream is numbered from the local sequence again (the R43 defect)',
    // First run declared [2,3,4,8,9] and observed [2,3,4,7,8,9]: reading 7 also reads B own stream, which
    // this defect numbers 4,5. The declaration was wrong, the reading was not.
    declared: [2, 3, 4, 7, 8, 9],
    edits: [{
      find: /originSeq: originSeq \?\? ownNext\(writer, instance\),/,
      replace: () => 'originSeq: originSeq ?? lastSeq,',
    }],
  },
  {
    name: 'the own counter ignores what the writer already produced',
    // Every reading: with the counter stuck at 1 the two negative controls cannot even build their fixture
    // (the own stream becomes [1,1,1]), so they redden as well. Declared [1,2,3,4,8,9] first, observed all.
    declared: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    edits: [{
      find: /return Math\.max\(mark\?\.records \?\? 0, mark\?\.lastSeq \?\? 0\) \+ 1;/,
      replace: () => 'return 1;',
    }],
  },
  {
    name: 'the own stream is off by one',
    // Every reading, for the same reason: the negative controls are built out of the stream this mutant moves.
    declared: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    edits: [{
      find: /return Math\.max\(mark\?\.records \?\? 0, mark\?\.lastSeq \?\? 0\) \+ 1;/,
      replace: () => 'return Math.max(mark?.records ?? 0, mark?.lastSeq ?? 0) + 2;',
    }],
  },
  {
    name: 'the gap rule is loosened (a stream may start beyond what the log holds)',
    declared: [5],
    edits: [{
      find: /if \(fresh\[0\]\.seq !== have \+ 1\) \{/,
      replace: () => 'if (false) {',
    }],
  },
  {
    name: 'the hole rule is loosened (a batch may skip a position)',
    declared: [6],
    edits: [{
      find: /if \(incoming\[index\]\.seq !== incoming\[index - 1\]\.seq \+ 1\) \{/,
      replace: () => 'if (false) {',
    }],
  },
  {
    name: 'the receiver shifts the sender positions by one',
    // Declared [3,7], observed [3,7,8,9]: with shifted positions the re-send of B own stream meets its own
    // record at the wrong position and is refused as RELAY_CONFLICT (reading 8), and the ping-pong inherits it.
    declared: [3, 7, 8, 9],
    edits: [{
      find: /(seqOnly \? localWriter : batch\.writer,\n\s*seqOnly \? localInstance : batch\.instance,\n\s*)row\.seq/,
      replace: (whole, head) => head + 'row.seq + 1',
    }],
  },
]

async function selfAttack() {
  const tmp = mkdtempSync(join(SCRATCH, 'r43-attack-'))
  try {
    const source = readFileSync(MODULE, 'utf8')
    const lines = []
    const anchors = []
    const rows = []
    let localised = 0
    let applied = 0
    let notApplicable = 0
    for (const mutation of MUTATIONS) {
      const id = 'M' + String(MUTATIONS.indexOf(mutation) + 1)
      let text = source
      let anchor = null
      let dead = null
      for (const edit of mutation.edits) {
        const match = edit.find.exec(text)
        if (match === null) { dead = show(edit.find); break }
        anchor = anchor === null ? match[0] : anchor + ' && ' + match[0]
        text = text.replace(edit.find, edit.replace)
      }
      if (dead !== null || text === source) {
        notApplicable += 1
        lines.push('  ' + id + ' ' + mutation.name + ' -> ANCHOR NOT FOUND in lib/index.js (' + clip(dead ?? 'the edit was a no-op', 90) + ')')
        continue
      }
      applied += 1
      anchors.push('  ' + id + ' ' + mutation.name + ' -> ' + clip(anchor.replace(/\\s+/g, ' '), 150))
      const copy = join(tmp, 'mutant-' + String(applied) + '.mjs')
      writeFileSync(copy, text)
      const seen = await runAll(copy)
      const declared = mutation.declared.slice().sort((left, right) => left - right)
      const observed = seen.failed.slice().sort((left, right) => left - right)
      const clean = show(observed) === show(declared)
      if (clean) localised += 1
      lines.push('  ' + id + ' ' + mutation.name + ' -> declared ' + show(declared) + ', observed ' + show(observed) + (clean ? '  LOCALISED' : '  MISMATCH'))
      rows.push({ id, name: mutation.name, declared, clean })
    }
    console.log('== anchors taken from the build product (' + MODULE + ') ==')
    console.log(anchors.join('\\n'))
    console.log('')
    console.log('== mutations: each mutant must redden exactly its declared set ==')
    console.log(lines.join('\\n'))
    console.log('')
    const READINGS = Object.keys(SENTENCES).map(Number)
    console.log('coverage matrix (reading -> mutants that declare it):')
    for (const n of READINGS) {
      const claimants = rows.filter((row) => row.declared.includes(n)).map((row) => row.id)
      console.log('  ' + n + ': ' + (claimants.join(', ') || 'UNCOVERED'))
    }
    const uncovered = READINGS.filter((n) => rows.every((row) => !row.declared.includes(n)))
    if (uncovered.length > 0) console.log('  UNCOVERED READINGS: ' + show(uncovered))
    const mismatched = rows.filter((row) => !row.clean).map((row) => row.id + ' ' + row.name)
    console.log('')
    console.log('mutants applied ' + String(applied) + ' of ' + String(MUTATIONS.length) + ' (anchors not found ' + String(notApplicable) + '); declared-set matches ' + String(localised) + ' of ' + String(applied) + '; uncovered readings ' + String(uncovered.length))
    if (mismatched.length > 0) console.log('mutants whose red set is not the declared one: ' + show(mismatched))
    process.exit(applied === MUTATIONS.length && localised === applied && uncovered.length === 0 ? 0 : 1)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

async function main() {
  if (!existsSync(MODULE)) { console.log('SKIP  no collab module at ' + MODULE); process.exit(3) }
  console.log('== real (this machine): ' + MODULE + ' ==')
  const { failed } = await runAll(MODULE)
  console.log('')
  console.log(String(results.length) + ' readings, ' + String(results.length - failed.length) + ' held, 0 skipped, ' + String(failed.length) + ' failed')
  if (failed.length > 0) process.exit(1)
  process.exit(0)
}

if (SELF_ATTACK) await selfAttack()
else await main()
