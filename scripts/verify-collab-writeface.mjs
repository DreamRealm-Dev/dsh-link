#!/usr/bin/env node
/**
 * R42 (task-78): the WRITE face of cross-end continuation — not only "who may write" is queryable
 * (R41 verified that), but a writer who may not write cannot get a byte into the ledger, and a turn
 * smuggled past the guard stays visible to every reader. Contract: .tmp/r42-contract.md (section 5).
 * Shape authority: the built module plugins/dsh-link-collab/lib/index.js (never src).
 *
 * Every expected value below is computed HERE from the ledger records and the clock handed in:
 * referenceSessions() is this gate's own reading of the session rules (R41) plus the turn rules (R42
 * R1-R3), and the readings that use a REAL control log measure the ledger length before and after a
 * refused write instead of trusting the returned flag. Nothing is read back out of the implementation.
 *
 *   1 a refused write leaves no trace (R4/R5)   non-author -> appended:false, seq:null, log.replay()
 *                                              length unchanged, no turn in ownPage
 *   2 the author writes                      (R4)  appended:true, reason ok, one record added, the
 *                                              turn appears in turns with the fields it was given
 *   3 a smuggled turn is visible             (R1/R2) raw log.append() past the guard -> rejectedTurns
 *                                              with a reason, and NOT in turns
 *   4 stale-epoch                            (R1.2) the author writing an old generation is stale
 *   5 not-author                             (R1.3) a higher epoch from another end is not-author
 *   6 no-author                              (R1.1) a turn before any claim is no-author
 *   7 the coverage equation                  (R3)  turns + rejectedTurns == the ledger's session/turn
 *                                              records, in a mixed batch, one not lost
 *   8 the real dual end                      (S4)  two real control logs over the relay path: claim ->
 *                                              relay -> both folds agree; handoff -> relay -> both agree;
 *                                              then the old author cannot write and the new author can,
 *                                              and both ends fold the same adopted turns byte for byte
 *   9 anti-fork on the WRITE face            (S5.7) two ends claim the same epoch: the loser's
 *                                              appendTurn is refused (not merely mayWrite false), the
 *                                              winner's lands
 *  10 order independence                     (R1)  one batch, two arrival orders -> turns and
 *                                              rejectedTurns byte-identical
 *  11 honest counters                        (S5.9) session/turn is a readable kind: counts.unknown
 *                                              does not rise, and an unreadable kind still counts
 *  12 the other readings stay put            (S5.10) a ledger differing ONLY by turn records keeps
 *                                              tasks/members/counts/registry/liveness/teams/peers/board/locks
 *  13 regression                             (S5.11) twelve gates, with continuation 14/14, lockfail
 *                                              11/11 and board 19/19 asserted from their own summary
 *  14 the turn builder                       (S1)  turnRecord shape and its TypeErrors
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed). The default run executes all
 * sixteen readings and takes about 574s, almost all of it inside reading 13: the three gates it runs each
 * nest a sweep of their own (continuation re-runs lockfail, which re-runs nine more). --skip-regression
 * drops reading 13 for callers that own the sweep. --self-attack mutates the BUILT
 * module (anchors are matched out of lib/index.js itself, so a refactor cannot leave one silently
 * stale): every mutant must redden exactly the set it declares, the coverage matrix is printed, and
 * every reading must be claimed by at least one mutant.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes('--self-attack')
// The three regression gates nest sweeps of their own (measured: continuation 574-799s, lockfail 307s,
// board 164s; continuation re-runs lockfail and board inside itself). --skip-regression is the fast path
// for a harness that already owns the regression sweep: it drops reading 13 and says so, loudly.
const SKIP_REGRESSION = argv.includes('--skip-regression')
const MODULE = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
// The contract's discipline: every log this gate opens lives under .tmp, never in the live home.
const SCRATCH = join(PROJECT, '.tmp')
// Three gates, not twelve: the rest are verify-all.mjs's job, and a gate that spends ten minutes inside
// itself is a gate nobody runs to completion (measured: the Lead two runs of this file were cut at 600s).
const GATES = ['verify-collab-continuation.mjs', 'verify-collab-lockfail.mjs', 'verify-collab-board.mjs']
const GATE_COUNTS = { 'verify-collab-continuation.mjs': 14, 'verify-collab-lockfail.mjs': 11, 'verify-collab-board.mjs': 19 }

const TEAM = 'team-1'
const SESSION = 'sess-1'
const SESSION_TWO = 'sess-2'
const END_A = 'end-A'; const END_B = 'end-B'; const END_C = 'end-C'; const END_D = 'end-D'
const NOW = 1_800_000_000_000
const CLAIM_KIND = 'session/claim'
const HANDOFF_KIND = 'session/handoff'
const TURN_KIND = 'session/turn'
// The reason vocabulary R4 borrows from the query face; a refusal must speak it, not invent a code.
const REASONS = ['none', 'ok', 'owned-by-other', 'stale-epoch', 'silent-owner']
const TURN_REASONS = ['no-author', 'stale-epoch', 'not-author', 'unrecorded-epoch', 'malformed']

const SENTENCES = {
  1: 'a refused write leaves the ledger exactly as it was (not only appended:false)  [R4/R5, S5.1]',
  2: 'the author writes: the record lands and the fold adopts it  [R4, S5.2]',
  3: 'a turn smuggled past the guard is visible in rejectedTurns and absent from turns  [R1/R2, S5.3]',
  4: 'an old generation is stale-epoch, even from the author itself  [R1.2, S5.4]',
  5: 'a higher epoch from another end is not-author  [R1.3, S5.4]',
  6: 'a turn before any claim is no-author  [R1.1, S5.4]',
  7: 'turns + rejectedTurns covers every session/turn record in the ledger  [R3, S5.5]',
  8: 'two real logs over the relay path: one author, the old end cannot write  [S4, S5.6]',
  9: 'the losing end of a fork cannot write at all, the winning end can  [S5.7]',
  10: 'both arrival orders fold to the same turns and rejectedTurns (by seq)  [R1, S5.8]',
  11: 'folding a turn is not an unreadable record, and the counter can still move  [S5.9]',
  12: 'a ledger differing only by turn records keeps every other entity reading identical  [S5.10]',
  13: 'the three regression gates the Lead named stay green (continuation 14/14, lockfail 11/11, board 19/19)  [S5.11]',
  14: 'the turn builder produces the contract shape and refuses illegal arguments with a TypeError  [S1]',
  15: 'the author claiming a generation the ledger never took is unrecorded-epoch, on both faces  [ruling 1]',
  16: 'an unusable turn record is still visible (an address-less one names null, never the empty string), so turns + rejectedTurns covers every turn record  [ruling 2]',
}

// ---------------------------------------------------------------- small helpers
const results = []
const record = (n, status, detail) => {
  results.push({ n, ok: status === true, skip: status === 'skip' })
  console.log('  ' + (status === true ? 'ok  ' : (status === 'skip' ? 'SKIP' : 'FAIL')) + '  ' + n + '. ' + detail)
}
const start = (n) => { console.log(''); console.log('-- ' + n + '. ' + SENTENCES[n]) }
const clip = (text, n) => { const s = String(text); return s.length > n ? s.slice(0, n) + '...' : s }
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const str = (value) => (typeof value === 'string' && value !== '' ? value : null)
const load = async (p) => { try { return await import(pathToFileURL(p).href) } catch { return null } }
const api = (mod) => ({
  project: typeof mod?.projectTeamState === 'function' ? mod.projectTeamState : null,
  owner: typeof mod?.sessionOwner === 'function' ? mod.sessionOwner : null,
  cont: typeof mod?.continuations === 'function' ? mod.continuations : null,
  mayContinue: typeof mod?.mayContinue === 'function' ? mod.mayContinue : null,
  mayWrite: typeof mod?.mayWrite === 'function' ? mod.mayWrite : null,
  claim: typeof mod?.sessionClaim === 'function' ? mod.sessionClaim : null,
  handoff: typeof mod?.sessionHandoff === 'function' ? mod.sessionHandoff : null,
  turn: typeof mod?.turnRecord === 'function' ? mod.turnRecord : null,
  appendTurn: typeof mod?.appendTurn === 'function' ? mod.appendTurn : null,
  openLog: typeof mod?.openControlLog === 'function' ? mod.openControlLog : null,
  turnKind: typeof mod?.TURN_KIND === 'string' ? mod.TURN_KIND : null,
  liveness: typeof mod?.livenessOf === 'function' ? mod.livenessOf : null,
})
const FOLD_API = ['project']
const WRITE_API = ['project', 'turn', 'appendTurn', 'openLog', 'claim', 'handoff']
const missingOf = (a, keys) => keys.filter((key) => a[key] === null)
const guardFold = (n, a) => {
  const gone = missingOf(a, FOLD_API)
  if (gone.length === 0) return true
  record(n, false, 'the module exposes no ' + gone.join(', ') + ' — the sentence cannot be read on this build')
  return false
}
const guardWrite = (n, a) => {
  const gone = missingOf(a, WRITE_API)
  if (gone.length === 0) return true
  record(n, false, 'the module exposes no ' + gone.join(', ') + ' — the sentence cannot be read on this build')
  return false
}

// ---------------------------------------------------------------- deterministic ledger fixtures (contract shape)
const call = (seq, kind, subject, payload) => ({ seq, channel: 'control', writer: 'w-1', instance: 'i1', actor: TEAM, kind, ...(subject === undefined ? {} : { subject }), payload })
const claim = (seq, session, end, epoch, at) => call(seq, CLAIM_KIND, session, { session, end, epoch, at })
const handoff = (seq, session, from, to, epoch, at) => call(seq, HANDOFF_KIND, session, { session, from, to, epoch, at })
const turn = (seq, session, end, epoch, text, at) => call(seq, TURN_KIND, session, { session, end, epoch, text, at })
const turnNoSession = (seq, end, epoch, text, at) => call(seq, TURN_KIND, undefined, { end, epoch, text, at })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))
const arrival = (records, order) => order.map((seq) => records.find((item) => item.seq === seq))

// ---------------------------------------------------------------- this gate's own expectations
/** The session rules (R41) plus the turn rules (R42 R1-R3), written from the contract text. */
const referenceSessions = (records) => {
  const owners = new Map()
  const steps = []
  const refused = []
  const turns = []
  const rejectedTurns = []
  let malformed = 0
  for (const row of [...records].sort((left, right) => left.seq - right.seq)) {
    const isSession = row.kind === CLAIM_KIND || row.kind === HANDOFF_KIND
    const isTurn = row.kind === TURN_KIND
    if (!isSession && !isTurn) continue
    const payload = row.payload ?? {}
    const session = str(payload.session) ?? str(row.subject)
    if (isTurn) {
      // R1 for turns: judge against the author AS OF this record, one record at a time.
      // The four rules only close if the exact (author, epoch) match is read first: R1.2's "epoch <= the
      // epoch then" written literally would refuse the author its own turn at the epoch it holds, and R1.4
      // ("otherwise adopt") would then never fire for anyone. Reading the exact match first is the one
      // resolution under which R4's success path and S4 ("the new author writes") can both be true, and it
      // still refuses every other end at the current epoch as stale (R1.2 precedes R1.3). Reported to the Lead.
      const end = str(payload.end)
      const epoch = Number.isSafeInteger(payload.epoch) ? payload.epoch : null
      const usable = session !== null && end !== null && epoch !== null && Number.isFinite(payload.at) && typeof payload.text === 'string'
      // An unusable record is still visible (ruling 2): an address-less one names session null (never the
      // empty string) with end null and epoch 0, so the coverage equation can hold over EVERY turn record.
      if (!usable) {
        malformed += 1
        rejectedTurns.push(session === null
          ? { session: null, end: null, epoch: 0, seq: row.seq, reason: 'malformed' }
          : { session, end, epoch: epoch ?? 0, seq: row.seq, reason: 'malformed' })
        continue
      }
      // The five ruled cases (Lead, R42 rulings):
      //   no author                                -> no-author
      //   end = author, epoch = the epoch then      -> adopted
      //   epoch <= the epoch then (anyone else)     -> stale-epoch
      //   epoch > the epoch then, another end       -> not-author
      //   epoch > the epoch then, THE AUTHOR        -> unrecorded-epoch (a generation the ledger never took)
      const held = owners.get(session) ?? null
      const reason = held === null ? 'no-author' : end === held.end && epoch === held.epoch ? null : epoch <= held.epoch ? 'stale-epoch' : end !== held.end ? 'not-author' : 'unrecorded-epoch'
      if (reason !== null) rejectedTurns.push({ session, end, epoch, seq: row.seq, reason })
      else turns.push({ session, end, epoch, text: payload.text, at: payload.at, seq: row.seq })
      continue
    }
    const by = row.kind === HANDOFF_KIND ? 'handoff' : 'claim'
    const end = by === 'claim' ? str(payload.end) : str(payload.to)
    const from = by === 'handoff' ? str(payload.from) : null
    const epoch = Number.isSafeInteger(payload.epoch) ? payload.epoch : null
    const at = Number.isFinite(payload.at) ? payload.at : null
    if (session === null || end === null || epoch === null || at === null || (by === 'handoff' && from === null)) {
      malformed += 1
      refused.push(session === null
        ? { session: null, end: null, epoch: 0, seq: row.seq, reason: 'malformed', by }
        : { session, end, epoch: epoch ?? 0, seq: row.seq, reason: 'malformed', by })
      continue
    }
    const held = owners.get(session) ?? null
    if (held === null && epoch < 1) {
      malformed += 1
      refused.push({ session, end, epoch, seq: row.seq, reason: 'malformed', by })
      continue
    }
    if (held !== null && epoch <= held.epoch) { refused.push({ session, end, epoch, seq: row.seq, reason: 'stale-epoch', by }); continue }
    if (by === 'handoff') {
      if (held === null || from !== held.end) { refused.push({ session, end, epoch, seq: row.seq, reason: 'not-owner', by }); continue }
      if (epoch !== held.epoch + 1) { refused.push({ session, end, epoch, seq: row.seq, reason: 'epoch-gap', by }); continue }
    }
    const step = { session, end, epoch, at, seq: row.seq, by }
    steps.push(step)
    owners.set(session, step)
  }
  const byS = (left, right) => (left.session < right.session ? -1 : left.session > right.session ? 1 : left.seq - right.seq)
  return {
    owners: [...owners.values()].sort((left, right) => (left.session < right.session ? -1 : left.session > right.session ? 1 : 0)),
    steps,
    refused,
    malformed,
    turns: turns.sort(byS),
    rejectedTurns: rejectedTurns.sort(byS),
  }
}
const TURN_FIELDS = ['session', 'end', 'epoch', 'text', 'at', 'seq']
const REJECT_FIELDS = ['session', 'end', 'epoch', 'seq', 'reason']
const pickFrom = (row, fields) => fields.length === 0 ? null : Object.fromEntries(fields.map((field) => [field, row?.[field] ?? null]))
const pickTurns = (state) => (state?.sessions?.turns ?? []).map((row) => pickFrom(row, TURN_FIELDS))
const pickRejects = (state) => (state?.sessions?.rejectedTurns ?? []).map((row) => pickFrom(row, REJECT_FIELDS))
/** Compare the implementation's session fold with this gate's own, field by field. */
const compareTurns = (state, expected, label, problems, notes) => {
  if (state?.sessions === undefined || state?.sessions === null) { problems.push(label + ': the projection carries no sessions (S2 wiring)'); return }
  const gotTurns = (state.sessions.turns ?? []).map((row) => pickFrom(row, TURN_FIELDS))
  const gotRejects = (state.sessions.rejectedTurns ?? []).map((row) => pickFrom(row, REJECT_FIELDS))
  const wantTurns = expected.turns.map((row) => pickFrom(row, TURN_FIELDS))
  const wantRejects = expected.rejectedTurns.map((row) => pickFrom(row, REJECT_FIELDS))
  if (show(gotTurns) !== show(wantTurns)) problems.push(label + ': turns is ' + clip(show(gotTurns), 200) + ', expected ' + clip(show(wantTurns), 200))
  if (show(gotRejects) !== show(wantRejects)) problems.push(label + ': rejectedTurns is ' + clip(show(gotRejects), 200) + ', expected ' + clip(show(wantRejects), 200))
  notes.push(label + ' -> turns seqs ' + show((state.sessions.turns ?? []).map((row) => row.seq)) + ', rejected ' + show((state.sessions.rejectedTurns ?? []).map((row) => row.seq + ':' + row.reason)))
}
const stateOf = (a, records) => a.project(clone(records))

// ---------------------------------------------------------------- real control logs (all under .tmp)
const freshDir = () => mkdtempSync(join(SCRATCH, 'r42-writeface-'))
const exported = (log) => log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at }))
const ledgerTurns = (log) => log.replay().filter((row) => row.kind === TURN_KIND).length
const recorded = (log, text) => log.replay().some((row) => row.kind === TURN_KIND && row.payload?.text === text)
const authorOf = (state, session) => { const row = (state?.sessions?.owners ?? []).find((owner) => owner.session === session); return row === undefined ? null : row.end + '@' + String(row.epoch) }

// ---------------------------------------------------------------- 1 a refused write leaves no trace
async function checkOne(a, mod) {
  start(1)
  if (!guardWrite(1, a)) return
  const dir = freshDir()
  let log = null
  try {
    log = a.openLog({ dir, writer: 'device-a' })
    await log.append(a.claim(SESSION, END_A, 1, NOW))
    const before = log.replay().length
    const state = a.project(log.replay())
    const outcome = await a.appendTurn(log, state, { session: SESSION, end: END_B, epoch: 1, text: 'from the wrong end' })
    const after = log.replay().length
    const problems = []
    if (outcome?.appended !== false) problems.push('appended is ' + show(outcome?.appended ?? null) + ', expected false')
    if (outcome?.seq !== null) problems.push('seq is ' + show(outcome?.seq ?? null) + ', expected null (a refused write spends no sequence)')
    if (typeof outcome?.reason !== 'string' || !REASONS.includes(outcome.reason)) problems.push('reason is ' + show(outcome?.reason ?? null) + ', expected one of ' + show(REASONS))
    if (after !== before) problems.push('the ledger grew (' + before + ' -> ' + after + '): the refused write reached the log')
    if (ledgerTurns(log) !== 0) problems.push('the log holds ' + ledgerTurns(log) + ' turn records after a refused write')
    if (recorded(log, 'from the wrong end')) problems.push('the refused turn is in the ledger')
    if (authorOf(a.project(log.replay()), SESSION) !== END_A + '@1') problems.push('the author moved during a refused write: ' + show(authorOf(a.project(log.replay()), SESSION)))
    console.log('      ledger ' + before + ' -> ' + after + ' records; verdict ' + clip(show(outcome), 90) + '; turns in log ' + ledgerTurns(log))
    record(1, problems.length === 0, problems.length === 0 ? 'the guard refuses, and the ledger proves it: ' + before + ' records before and after, no turn in ownPage, verdict ' + show(outcome) : problems.slice(0, 3).join(' | '))
  } catch (error) {
    record(1, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
  } finally {
    if (log !== null) { try { await log.close() } catch { /* a closed log is not this reading business */ } }
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- 2 the author writes
async function checkTwo(a, mod) {
  start(2)
  if (!guardWrite(2, a)) return
  const dir = freshDir()
  let log = null
  try {
    log = a.openLog({ dir, writer: 'device-a' })
    await log.append(a.claim(SESSION, END_A, 1, NOW))
    const before = log.replay().length
    const outcome = await a.appendTurn(log, a.project(log.replay()), { session: SESSION, end: END_A, epoch: 1, text: 'the author speaks' }, { at: NOW, now: NOW })
    const after = log.replay().length
    const state = a.project(log.replay())
    const problems = []
    if (outcome?.appended !== true) problems.push('appended is ' + show(outcome?.appended ?? null) + ', expected true')
    if (outcome?.reason !== 'ok') problems.push('reason is ' + show(outcome?.reason ?? null) + ', expected ok')
    if (!Number.isInteger(outcome?.seq)) problems.push('seq is ' + show(outcome?.seq ?? null) + ', expected the sequence the record took')
    if (after !== before + 1) problems.push('the ledger holds ' + after + ' records, expected ' + (before + 1))
    const mine = referenceSessions(log.replay())
    compareTurns(state, mine, 'the written turn', problems, [])
    if (ledgerTurns(log) !== 1) problems.push('the log holds ' + ledgerTurns(log) + ' turn records, expected 1')
    const stored = log.replay().find((row) => row.kind === TURN_KIND)?.payload ?? null
    if (show(stored) !== show({ session: SESSION, end: END_A, epoch: 1, text: 'the author speaks', at: NOW })) problems.push('the stored payload is ' + clip(show(stored), 140) + ', expected the payload it was given with at=' + String(NOW))
    // The default clock: with no options the record carries a real instant, not the fixture timestamp.
    const wallStart = Date.now()
    const second = await a.appendTurn(log, a.project(log.replay()), { session: SESSION, end: END_A, epoch: 1, text: 'and again' })
    const wallAt = log.replay().filter((row) => row.kind === TURN_KIND).slice(-1)[0]?.payload?.at ?? null
    if (second?.appended !== true) problems.push('the second author turn was refused: ' + clip(show(second), 100))
    if (!Number.isFinite(wallAt) || wallAt < wallStart - 60_000 || wallAt > Date.now() + 60_000) problems.push('without options the turn carries at ' + show(wallAt) + ', expected the wall clock near ' + String(wallStart))
    console.log('      ledger ' + before + ' -> ' + after + '; verdict ' + clip(show(outcome), 80) + '; turns ' + show(pickTurns(state)))
    record(2, problems.length === 0, problems.length === 0 ? 'the author turn lands once and the fold adopts it: ' + clip(show(pickTurns(state)), 150) : problems.slice(0, 3).join(' | '))
  } catch (error) {
    record(2, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
  } finally {
    if (log !== null) { try { await log.close() } catch { /* nothing to do */ } }
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- 3 a smuggled turn is visible
async function checkThree(a, mod) {
  start(3)
  if (!guardWrite(3, a)) return
  const dir = freshDir()
  let log = null
  try {
    log = a.openLog({ dir, writer: 'device-a' })
    await log.append(a.claim(SESSION, END_A, 1, NOW))
    // The bypass: the log's own append is public, so a caller that ignores appendTurn can still write.
    await log.append(a.turn({ session: SESSION, end: END_B, epoch: 1, text: 'smuggled' }, NOW))
    const records = log.replay()
    const state = a.project(records)
    const mine = referenceSessions(records)
    const problems = []
    compareTurns(state, mine, 'the smuggled turn', problems, [])
    const admitted = (state.sessions?.turns ?? []).filter((row) => row.seq === 2)
    if (admitted.length !== 0) problems.push('the smuggled turn was ADOPTED (it is in turns): ' + clip(show(admitted), 120))
    const rejected = (state.sessions?.rejectedTurns ?? []).filter((row) => row.seq === 2)
    if (rejected.length !== 1) problems.push('the smuggled turn is not visible in rejectedTurns (found ' + rejected.length + ')')
    // R1.2 sits before R1.3, so another end at the CURRENT epoch is stale-epoch (not not-author); the
    // not-author word belongs to a HIGHER epoch from another end, which reading 5 reads.
    else if (rejected[0].reason !== 'stale-epoch') problems.push('the smuggled turn reason is ' + show(rejected[0].reason) + ', expected stale-epoch (R1.2 precedes R1.3 for a turn at the epoch the session holds)')
    if (ledgerTurns(log) !== 1) problems.push('the ledger holds ' + ledgerTurns(log) + ' turn records, expected the smuggled one to be there')
    console.log('      the bypass landed in the ledger (turns in log ' + ledgerTurns(log) + '); fold -> turns ' + show((state.sessions?.turns ?? []).map((row) => row.seq)) + ', rejectedTurns ' + clip(show(pickRejects(state)), 150))
    record(3, problems.length === 0, problems.length === 0 ? 'the smuggled turn is refused by the fold and stays visible with its reason: ' + clip(show(pickRejects(state)), 130) : problems.slice(0, 3).join(' | '))
  } catch (error) {
    record(3, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
  } finally {
    if (log !== null) { try { await log.close() } catch { /* nothing to do */ } }
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- 4/5/6 the three rejection reasons
const REASON_CASES = [
  {
    n: 4,
    name: 'stale-epoch',
    ledger: [claim(1, SESSION, END_A, 1, NOW), claim(2, SESSION, END_A, 2, NOW), turn(3, SESSION, END_A, 1, 'one generation late', NOW)],
    turnSeq: 3,
    why: 'the same end on an epoch the session has already left',
    guard: { session: SESSION, end: END_A, epoch: 1, text: 'guarded: one generation late' },
    extra: { session: SESSION, end: END_A, epoch: 3, text: 'guarded: ahead of the held epoch' },
  },
  {
    n: 5,
    name: 'not-author',
    ledger: [claim(1, SESSION, END_A, 1, NOW), turn(2, SESSION, END_B, 2, 'a higher epoch, another end', NOW)],
    turnSeq: 2,
    why: 'a higher epoch from an end that is not the author',
    guard: { session: SESSION, end: END_B, epoch: 2, text: 'guarded: another end' },
  },
  {
    n: 6,
    name: 'no-author',
    ledger: [turn(1, SESSION, END_A, 1, 'before anyone claimed', NOW)],
    turnSeq: 1,
    why: 'no author existed when the turn was written',
    guard: { session: SESSION, end: END_A, epoch: 1, text: 'guarded: before anyone claimed' },
  },
]

async function checkReason(a, mod, spec) {
  start(spec.n)
  if (!guardWrite(spec.n, a)) return
  const dir = freshDir()
  let log = null
  const problems = []
  try {
    log = a.openLog({ dir, writer: 'device-a' })
    // Every fixture record goes through the module's own builders, so the ledger holds what a real
    // writer would have written (and the fold is judged on that, not on this gate's raw objects).
    const asAppend = (row) => row.kind === TURN_KIND
      ? a.turn({ session: row.payload.session, end: row.payload.end, epoch: row.payload.epoch, text: row.payload.text }, row.payload.at)
      : row.kind === CLAIM_KIND
        ? a.claim(row.payload.session, row.payload.end, row.payload.epoch, row.payload.at)
        : a.handoff(row.payload.session, row.payload.from, row.payload.to, row.payload.epoch, row.payload.at)
    for (const row of spec.ledger) await log.append(asAppend(row))
    const records = log.replay()
    const state = a.project(records)
    const mine = referenceSessions(records)
    compareTurns(state, mine, spec.name + ' ledger', problems, [])
    const rejected = (state.sessions?.rejectedTurns ?? []).filter((row) => row.seq === spec.turnSeq)
    if (rejected.length !== 1) problems.push('the turn is not in rejectedTurns (found ' + rejected.length + ')')
    else if (rejected[0].reason !== spec.name) problems.push('the reason is ' + show(rejected[0].reason) + ', expected ' + spec.name + ' (' + spec.why + ')')
    if ((state.sessions?.turns ?? []).some((row) => row.seq === spec.turnSeq)) problems.push('the rejected turn is also in turns')
    // The same sentence on the guard side: what the guard refuses, the fold must refuse too.
    const before = log.replay().length
    const outcome = await a.appendTurn(log, a.project(log.replay()), spec.guard)
    if (outcome?.appended !== false) problems.push('appendTurn appended it anyway: ' + clip(show(outcome), 110))
    else if (typeof outcome.reason !== 'string' || !REASONS.includes(outcome.reason)) problems.push('the guard reason is ' + show(outcome.reason) + ', expected one of ' + show(REASONS))
    if (log.replay().length !== before) problems.push('the refused guard write still grew the ledger (' + before + ' -> ' + log.replay().length + ')')
    const extras = []
    if (spec.extra !== undefined) {
      // The author asking AHEAD of the epoch it actually holds: mayWrite needs both conjuncts, so this is
      // refused even though the query face answers ok for the same ask. The contract names no reason for
      // this corner, so this gate reads the refusal and PRINTS the word instead of pinning it (reported).
      const ahead = log.replay().length
      const extra = await a.appendTurn(log, a.project(log.replay()), spec.extra)
      if (extra?.appended !== false || extra?.seq !== null) problems.push('a write ahead of the held epoch was not refused: ' + clip(show(extra), 110))
      if (log.replay().length !== ahead) problems.push('that refusal grew the ledger (' + ahead + ' -> ' + log.replay().length + ')')
      extras.push('ahead of its own epoch -> ' + clip(show(extra), 90))
    }
    console.log('      folded reason ' + show(rejected[0]?.reason ?? null) + '; guard verdict ' + clip(show(outcome), 80) + '; ledger ' + before + ' -> ' + log.replay().length + (extras.length > 0 ? '; ' + extras.join('; ') : ''))
  } catch (error) {
    problems.push('the reading threw instead of answering: ' + clip(String(error?.message ?? error), 120))
  } finally {
    if (log !== null) { try { await log.close() } catch { /* nothing to do */ } }
    rmSync(dir, { recursive: true, force: true })
  }
  record(spec.n, problems.length === 0, problems.length === 0 ? 'refused as ' + spec.name + ' by the fold and by the guard, with nothing added to the ledger' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 7 the coverage equation
function checkSeven(a) {
  start(7)
  if (!guardFold(7, a)) return
  const records = [
    claim(1, SESSION, END_A, 1, NOW),
    turn(2, SESSION, END_A, 1, 'kept one', NOW),
    turn(3, SESSION, END_B, 1, 'wrong end', NOW),
    turn(4, SESSION, END_A, 1, 'old generation', NOW),
    handoff(5, SESSION, END_A, END_B, 2, NOW),
    turn(6, SESSION, END_B, 2, 'kept two', NOW),
    turn(7, SESSION, END_A, 2, 'the end that handed over', NOW),
    claim(8, SESSION_TWO, END_C, 1, NOW),
    turn(9, SESSION_TWO, END_C, 1, 'kept three', NOW),
    turn(10, SESSION_TWO, END_D, 2, 'not this session author', NOW),
    handoff(11, SESSION, END_C, END_D, 3, NOW),
    turn(12, SESSION, END_B, 3, 'after a refused handoff', NOW),
  ]
  const state = stateOf(a, records)
  const mine = referenceSessions(records)
  const problems = []
  const notes = []
  compareTurns(state, mine, 'the mixed batch', problems, notes)
  const turnRecords = records.filter((row) => row.kind === TURN_KIND)
  const turns = state.sessions?.turns ?? []
  const rejected = state.sessions?.rejectedTurns ?? []
  if (turns.length + rejected.length !== turnRecords.length) problems.push('the coverage equation fails: ' + turns.length + ' + ' + rejected.length + ' != ' + turnRecords.length + ' session/turn records in the ledger (R3)')
  for (const session of [SESSION, SESSION_TWO]) {
    const kept = turns.filter((row) => row.session === session).length
    const dropped = rejected.filter((row) => row.session === session).length
    const inLedger = turnRecords.filter((row) => (row.payload?.session ?? row.subject) === session).length
    if (kept + dropped !== inLedger) problems.push(session + ': ' + kept + ' + ' + dropped + ' != ' + inLedger + ' turn records')
    notes.push(session + ' ' + kept + ' kept / ' + dropped + ' rejected of ' + inLedger)
  }
  console.log('      ' + notes.join('; '))
  record(7, problems.length === 0, problems.length === 0 ? 'every turn record is either adopted or visibly rejected: ' + notes.join('; ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 8 the real dual end
async function checkEight(a, mod) {
  start(8)
  if (!guardWrite(8, a)) return
  const dir = freshDir()
  let logA = null; let logB = null
  const problems = []
  try {
    logA = a.openLog({ dir: join(dir, 'a'), writer: 'device-a' })
    logB = a.openLog({ dir: join(dir, 'b'), writer: 'device-b' })
    // A claims the session, then the whole batch goes over the relay path the plugin already has.
    await logA.append(a.claim(SESSION, END_A, 1, NOW))
    const relayAtoB = await logB.ingest({ writer: 'device-a', instance: logA.instance, records: exported(logA) })
    const foldA = a.project(logA.replay())
    const foldB = a.project(logB.replay())
    if (authorOf(foldB, SESSION) !== authorOf(foldA, SESSION)) problems.push('after the claim relay the two ends disagree: A ' + show(authorOf(foldA, SESSION)) + ' vs B ' + show(authorOf(foldB, SESSION)))
    if (authorOf(foldA, SESSION) !== END_A + '@1') problems.push('the author after the claim is ' + show(authorOf(foldA, SESSION)) + ', expected ' + END_A + '@1')
    if (relayAtoB?.appended !== 1) problems.push('the claim relay appended ' + show(relayAtoB?.appended ?? null) + ', expected 1')
    // The author speaks on A, and the turn travels.
    const wroteA = await a.appendTurn(logA, a.project(logA.replay()), { session: SESSION, end: END_A, epoch: 1, text: 'A speaks' })
    await logB.ingest({ writer: 'device-a', instance: logA.instance, records: exported(logA) })
    if (wroteA?.appended !== true) problems.push('the author could not write on its own end: ' + clip(show(wroteA), 100))
    // A hands the session to B, and the handoff travels.
    await logA.append(a.handoff(SESSION, END_A, END_B, 2, NOW))
    await logB.ingest({ writer: 'device-a', instance: logA.instance, records: exported(logA) })
    const foldA2 = a.project(logA.replay())
    const foldB2 = a.project(logB.replay())
    if (authorOf(foldA2, SESSION) !== END_B + '@2') problems.push('A did not adopt the handoff: ' + show(authorOf(foldA2, SESSION)))
    if (authorOf(foldB2, SESSION) !== END_B + '@2') problems.push('B did not adopt the handoff: ' + show(authorOf(foldB2, SESSION)))
    // Both ends now hold exactly A's stream, so they must derive the same adopted turns from it, byte for byte.
    const sharedA = JSON.stringify(pickTurns(foldA2))
    const sharedB = JSON.stringify(pickTurns(foldB2))
    if (sharedA !== sharedB) problems.push('the two ends fold different adopted turns from the same records: A ' + clip(sharedA, 130) + ' vs B ' + clip(sharedB, 130))
    if (sharedA === '[]') problems.push('neither end adopted a turn, so the comparison is vacuous')
    // The old author must not be able to write now, the new author must.
    const beforeStale = logA.replay().length
    const wroteOld = await a.appendTurn(logA, a.project(logA.replay()), { session: SESSION, end: END_A, epoch: 2, text: 'A after handing over' })
    if (wroteOld?.appended !== false) problems.push('the end that handed over could still write: ' + clip(show(wroteOld), 110))
    if (logA.replay().length !== beforeStale) problems.push('the refused write by the old end grew the ledger (' + beforeStale + ' -> ' + logA.replay().length + ')')
    const wroteNew = await a.appendTurn(logB, a.project(logB.replay()), { session: SESSION, end: END_B, epoch: 2, text: 'B now speaks' })
    if (wroteNew?.appended !== true) problems.push('the new author could not write: ' + clip(show(wroteNew), 110))
    // Compared on the contract's fields, so a key order in the implementation is not read as a difference.
    const foldA3 = a.project(logA.replay())
    const foldB3 = a.project(logB.replay())
    const turnsA = JSON.stringify(pickTurns(foldA3))
    const turnsB = JSON.stringify(pickTurns(foldB3))
    const mineB = JSON.stringify(referenceSessions(logB.replay()).turns.map((row) => pickFrom(row, TURN_FIELDS)))
    const mineA = JSON.stringify(referenceSessions(logA.replay()).turns.map((row) => pickFrom(row, TURN_FIELDS)))
    if (turnsB !== mineB) problems.push('end B turns differ from this gate own fold of the same records: ' + clip(turnsB, 130) + ' vs ' + clip(mineB, 130))
    if (turnsA !== mineA) problems.push('end A turns differ from this gate own fold of the same records: ' + clip(turnsA, 130) + ' vs ' + clip(mineA, 130))
    if (turnsA !== sharedA) problems.push('end A own fold changed while only B wrote: ' + clip(turnsA, 120) + ' vs ' + clip(sharedA, 120))
    if (JSON.parse(turnsB).length !== JSON.parse(turnsA).length + 1) problems.push('end B must hold exactly one more adopted turn than end A (the one B just wrote): A ' + clip(turnsA, 110) + ' vs B ' + clip(turnsB, 110))
    // The reverse leg, asserted HARD: the new author's own stream must travel back and both ends must then
    // fold the same adopted turns, byte for byte (contract S4). This gate first measured a RELAY_GAP here
    // (a log's own stream was numbered from its local sequence); the build now numbers a writer's own stream
    // by its own counter (ownNext, lib/index.js:172/187), so the leg is a sentence the gate can pin.
    const turnsBeforeReverse = JSON.stringify(pickTurns(a.project(logA.replay())))
    const landed = await logA.ingest({ writer: 'device-b', instance: logB.instance, records: exported(logB) })
    const reverse = 'landed ' + clip(show(landed), 80)
    const foldA4 = a.project(logA.replay())
    const turnsA2 = JSON.stringify(pickTurns(foldA4))
    const turnsB2 = JSON.stringify(pickTurns(a.project(logB.replay())))
    if (turnsA2 !== turnsB2) problems.push('after the reverse relay the two ends fold different turns: ' + clip(turnsA2, 130) + ' vs ' + clip(turnsB2, 130))
    if (turnsA2 === turnsBeforeReverse) problems.push('the reverse relay added nothing to end A, so the comparison would be vacuous')
    if (JSON.parse(turnsA2).length !== JSON.parse(turnsB).length) problems.push('end A should now hold the same number of adopted turns as end B: ' + clip(turnsA2, 120) + ' vs ' + clip(turnsB, 120))
    console.log('      A: author ' + show(authorOf(foldA3, SESSION)) + ', B: author ' + show(authorOf(foldB3, SESSION)) + ', turns A ' + clip(turnsA, 150) + ', turns B ' + clip(turnsB, 150))
    console.log('      old author write ' + clip(show(wroteOld), 70) + '; new author write ' + clip(show(wroteNew), 70))
    console.log('      reverse relay (B own stream back to A): ' + reverse)
  } catch (error) {
    problems.push('the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
  } finally {
    if (logA !== null) { try { await logA.close() } catch { /* nothing to do */ } }
    if (logB !== null) { try { await logB.close() } catch { /* nothing to do */ } }
    rmSync(dir, { recursive: true, force: true })
  }
  record(8, problems.length === 0, problems.length === 0 ? 'two real logs, one author: the ends agree on the author at every step, the old end cannot write, the new end can, and both fold the same turns' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 9 anti-fork on the write face
async function checkNine(a, mod) {
  start(9)
  if (!guardWrite(9, a)) return
  const dir = freshDir()
  let log = null
  const problems = []
  try {
    log = a.openLog({ dir, writer: 'device-a' })
    // Two ends declare the same epoch = current+1. The one whose record comes FIRST in seq order takes
    // the session; the fold says so, and this reading asks the WRITE face, not mayWrite.
    await log.append(a.claim(SESSION, END_A, 1, NOW))
    await log.append(a.claim(SESSION, END_B, 2, NOW))
    await log.append(a.claim(SESSION, END_A, 2, NOW))
    const records = log.replay()
    const state = a.project(records)
    const mine = referenceSessions(records)
    compareTurns(state, mine, 'the fork ledger', problems, [])
    const winner = (mine.owners.find((row) => row.session === SESSION) ?? null)
    if (winner === null) problems.push('this gate own fold found no author, so the reading cannot run')
    else {
      const winnerIsB = winner.end === END_B
      const before = log.replay().length
      const loserWrite = await a.appendTurn(log, a.project(log.replay()), { session: SESSION, end: winnerIsB ? END_A : END_B, epoch: 2, text: 'the losing end' })
      const winnerWrite = await a.appendTurn(log, a.project(log.replay()), { session: SESSION, end: winner.end, epoch: winner.epoch, text: 'the winning end' })
      if (loserWrite?.appended !== false) problems.push('the losing end wrote anyway: ' + clip(show(loserWrite), 110))
      if (winnerWrite?.appended !== true) problems.push('the winning end could not write: ' + clip(show(winnerWrite), 110))
      if (log.replay().length !== before + 1) problems.push('the ledger holds ' + log.replay().length + ' records after one allowed and one refused write, expected ' + (before + 1))
      const after = a.project(log.replay())
      const kept = (after.sessions?.turns ?? [])
      if (kept.length !== 1 || kept[0].text !== 'the winning end') problems.push('the fold kept ' + clip(show(kept), 130) + ', expected exactly the winning end turn')
      if (a.mayWrite && a.mayWrite(state, SESSION, winner.end, winner.epoch) !== true) problems.push('the query face disagrees with the write face about the winner')
      console.log('      author by seq ' + show(winner.end + '@' + String(winner.epoch)) + ' (both ends declared epoch 2); loser write ' + clip(show(loserWrite), 60) + '; winner write ' + clip(show(winnerWrite), 60) + '; kept ' + clip(show(kept.map((row) => row.text)), 60))
    }
  } catch (error) {
    problems.push('the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140))
  } finally {
    if (log !== null) { try { await log.close() } catch { /* nothing to do */ } }
    rmSync(dir, { recursive: true, force: true })
  }
  record(9, problems.length === 0, problems.length === 0 ? 'the fork is closed on the write face too: exactly the end the fold names can write, and the ledger grew by one' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 10 order independence
function checkTen(a) {
  start(10)
  if (!guardFold(10, a)) return
  const records = [
    claim(1, SESSION, END_A, 1, NOW),
    turn(2, SESSION, END_A, 1, 'kept one', NOW),
    turn(3, SESSION, END_B, 1, 'wrong end', NOW),
    handoff(4, SESSION, END_A, END_B, 2, NOW),
    turn(5, SESSION, END_B, 2, 'kept two', NOW),
    turn(6, SESSION, END_A, 2, 'the end that handed over', NOW),
    claim(7, SESSION_TWO, END_C, 1, NOW),
    turn(8, SESSION_TWO, END_C, 1, 'kept three', NOW),
  ]
  const mine = referenceSessions(records)
  const one = stateOf(a, records)
  const two = stateOf(a, arrival(records, [6, 2, 8, 4, 1, 7, 3, 5]))
  const problems = []
  const notes = []
  compareTurns(one, mine, 'seq arrival', problems, notes)
  compareTurns(two, mine, 'scrambled arrival', problems, notes)
  const left = JSON.stringify({ turns: one.sessions?.turns ?? null, rejected: one.sessions?.rejectedTurns ?? null })
  const right = JSON.stringify({ turns: two.sessions?.turns ?? null, rejected: two.sessions?.rejectedTurns ?? null })
  if (left !== right) problems.push('the two arrival orders fold different turns: ' + clip(left, 170) + ' vs ' + clip(right, 170))
  console.log('      arrival seqs [1..8] vs reverse [5,3,7,1,4,8,2,6]; ' + notes.join(' | '))
  record(10, problems.length === 0, problems.length === 0 ? 'turns and rejectedTurns are byte-identical in both arrival orders: ' + clip(show(pickTurns(one)), 130) : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 11 honest counters
function checkEleven(a) {
  start(11)
  if (!guardFold(11, a)) return
  const problems = []
  const notes = []
  const turnOnly = [claim(1, SESSION, END_A, 1, NOW), turn(2, SESSION, END_A, 1, 'only turn facts', NOW)]
  const state = stateOf(a, turnOnly)
  const empty = a.project([])
  const unknown = state.counts?.unknown ?? null
  if (unknown !== 0) problems.push('counts.unknown is ' + show(unknown) + ' for a ledger of session/turn facts (S5.9: the kind is readable)')
  if ((empty.counts?.unknown ?? null) !== 0) problems.push('counts.unknown is ' + show(empty.counts?.unknown ?? null) + ' for an empty ledger')
  const control = a.project([{ seq: 1, channel: 'control', writer: 'w', instance: 'i1', kind: 'probe/unreadable-kind', subject: 'x', payload: { id: 'x' } }])
  if ((control.counts?.unknown ?? null) !== 1) problems.push('the positive control was not counted: counts.unknown is ' + show(control.counts?.unknown ?? null) + ' for one unreadable kind, expected 1')
  if (a.turnKind !== null && a.turnKind !== TURN_KIND) problems.push('TURN_KIND is ' + show(a.turnKind) + ', expected ' + TURN_KIND)
  if (a.turnKind === null) problems.push('the module exports no TURN_KIND')
  notes.push('turn-only unknown ' + show(unknown) + ', empty unknown ' + show(empty.counts?.unknown ?? null) + ', positive control ' + show(control.counts?.unknown ?? null))
  console.log('      ' + notes.join('; '))
  record(11, problems.length === 0, problems.length === 0 ? 'a turn record is read, not counted as unknown, and the counter can still move: ' + notes.join(' | ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 12 the other readings stay put
function checkTwelve(a) {
  start(12)
  if (!guardFold(12, a)) return
  const problems = []
  const notes = []
  const turnFacts = [claim(5, SESSION, END_A, 1, NOW), turn(6, SESSION, END_A, 1, 'a turn', NOW), turn(7, SESSION, END_B, 1, 'a smuggled turn', NOW)]
  const entityKeys = ['tasks', 'members', 'registry', 'liveness', 'teams', 'peers', 'board', 'locks']
  const bases = [
    ['empty ledger', []],
    ['populated ledger', [call(1, 'member/state', END_A, { id: END_A, name: END_A, state: 'active', role: 'member' }), call(2, 'member/heartbeat', END_A, { id: END_A, at: NOW - 1_000 }), call(3, 'task/state', 'T1', { id: 'T1', state: 'in-progress', owner: END_A }), call(4, 'lock/state', 'T1', { task: 'T1', holder: END_A, at: NOW - 1_000, team: TEAM })]],
  ]
  for (const [label, base] of bases) {
    const without = a.project(clone(base))
    const added = a.project(clone([...base, ...turnFacts]))
    for (const key of entityKeys) {
      const left = JSON.stringify(without[key] ?? null)
      const right = JSON.stringify(added[key] ?? null)
      if (left !== right) problems.push(label + ': ' + key + ' moved when only turn records were added: ' + clip(left, 90) + ' vs ' + clip(right, 90))
    }
    for (const key of Object.keys(without.counts ?? {})) {
      if (key === 'folded' || key === 'unknown') continue
      if (show(without.counts[key]) !== show(added.counts[key])) problems.push(label + ': counts.' + key + ' moved: ' + show(without.counts[key]) + ' vs ' + show(added.counts[key]))
    }
    if (JSON.stringify(without.sessions) === JSON.stringify(added.sessions)) problems.push(label + ': the two sides fold identical sessions, so the fixture carries nothing for this reading to see')
    notes.push(label + ' counts ' + clip(show(added.counts), 70) + ' (folded ' + show(without.counts?.folded) + ' vs ' + show(added.counts?.folded) + ')')
  }
  console.log('      ' + notes.join('; '))
  record(12, problems.length === 0, problems.length === 0 ? 'only sessions moves; every other entity reading is byte-identical' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 13 regression
/** One gate as a child process, so three of them can run at once (each one nests a sweep of its own). */
const runGate = (gate) => new Promise((done) => {
  const started = Date.now()
  const child = spawn(process.execPath, [gate], { cwd: PROJECT })
  let text = ''
  let settled = false
  const finish = (status) => { if (!settled) { settled = true; done({ status, text, seconds: (Date.now() - started) / 1000 }) } }
  child.stdout.on('data', (chunk) => { text += String(chunk) })
  child.stderr.on('data', (chunk) => { text += String(chunk) })
  child.on('close', (code) => finish(code))
  child.on('error', (error) => { text += String(error?.message ?? error); finish(-1) })
})

async function checkThirteen(gates) {
  start(13)
  const problems = []
  const notes = []
  const paths = gates.map((gate) => (isAbsolute(gate) ? gate : join(PROJECT, 'scripts', gate)))
  for (const gatePath of paths) if (!existsSync(gatePath)) problems.push(gatePath + ' is missing')
  if (problems.length > 0) { record(13, false, problems.join(' | ')); return }
  const started = Date.now()
  const runs = await Promise.all(paths.map((gatePath) => runGate(gatePath)))
  console.log('      ' + runs.map((run, index) => paths[index].replace(/^.*[\\/]/, '') + ' ' + show(run.status) + ' in ' + run.seconds.toFixed(1) + 's').join('; ') + ' (concurrent, ' + ((Date.now() - started) / 1000).toFixed(1) + 's wall)')
  for (let index = 0; index < paths.length; index += 1) {
    const gate = paths[index].replace(/^.*[\\/]/, '')
    const run = runs[index]
    const text = String(run.text ?? '').trim()
    if (run.status !== 0) { problems.push(gate + ' exited ' + String(run.status) + ': ' + clip(text.replace(/\s+/g, ' '), 110)); continue }
    const summary = text.match(/(\d+) (?:readings|checks), (\d+) held/)
    const expected = GATE_COUNTS[gate]
    if (expected !== undefined) {
      if (summary === null) problems.push(gate + ' printed no reading count, so ' + expected + ' held cannot be checked')
      else if (Number(summary[2]) !== expected) problems.push(gate + ' held ' + summary[2] + ' of ' + summary[1] + ', expected ' + expected)
      else notes.push(gate.replace('verify-', '').replace('.mjs', '') + ' ' + summary[2] + '/' + summary[1])
    } else notes.push(gate.replace('verify-', '').replace('.mjs', '') + (summary === null ? ' ok' : ' ' + summary[2] + '/' + summary[1]))
  }
  record(13, problems.length === 0, problems.length === 0 ? notes.join(', ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 14 the turn builder
function checkFourteen(a) {
  start(14)
  const problems = []
  const notes = []
  if (a.turn === null) { record(14, false, 'the module exposes no turnRecord'); return }
  const text = 'the payload is opaque'
  const got = a.turn({ session: SESSION, end: END_A, epoch: 3, text }, NOW)
  const shape = { kind: got.kind, subject: typeof got.subject === 'string' && got.subject !== '', payload: got.payload }
  const want = { kind: TURN_KIND, subject: true, payload: { session: SESSION, end: END_A, epoch: 3, text, at: NOW } }
  if (show(shape) !== show(want)) problems.push('turnRecord is ' + show(shape) + ', expected ' + show(want))
  if (Object.keys(got).sort().join(',') !== 'kind,payload,subject') problems.push('the turn record carries keys beyond kind/subject/payload: ' + show(Object.keys(got)))
  const guards = [
    ['session empty', () => a.turn({ session: '', end: END_A, epoch: 1, text }, NOW)],
    ['end empty', () => a.turn({ session: SESSION, end: '', epoch: 1, text }, NOW)],
    ['epoch 0', () => a.turn({ session: SESSION, end: END_A, epoch: 0, text }, NOW)],
    ['epoch 1.5', () => a.turn({ session: SESSION, end: END_A, epoch: 1.5, text }, NOW)],
    ['epoch NaN', () => a.turn({ session: SESSION, end: END_A, epoch: NaN, text }, NOW)],
    ['text missing', () => a.turn({ session: SESSION, end: END_A, epoch: 1 }, NOW)],
    ['text a number', () => a.turn({ session: SESSION, end: END_A, epoch: 1, text: 7 }, NOW)],
    ['at Infinity', () => a.turn({ session: SESSION, end: END_A, epoch: 1, text }, Infinity)],
    ['at NaN', () => a.turn({ session: SESSION, end: END_A, epoch: 1, text }, NaN)],
  ]
  const seen = []
  for (const [label, run] of guards) {
    let outcome = 'returned'
    try { run() } catch (error) { outcome = error?.constructor?.name ?? 'an error' }
    if (outcome !== 'TypeError') problems.push(label + ' did not throw TypeError (got ' + outcome + ')')
    seen.push(label + '=' + (outcome === 'TypeError' ? 'TypeError' : outcome))
  }
  notes.push(guards.length + ' illegal-argument cases -> ' + seen.join(', '))
  notes.push('shape ' + clip(show(got), 110))
  console.log('      ' + notes.join('\n      '))
  record(14, problems.length === 0, problems.length === 0 ? 'the builder produces the contract shape and refuses every illegal argument with a TypeError' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 15 the author ahead of its own epoch
async function checkFifteen(a, mod) {
  start(15)
  if (!guardWrite(15, a)) return
  const dir = freshDir()
  let log = null
  const problems = []
  try {
    log = a.openLog({ dir, writer: 'device-a' })
    await log.append(a.claim(SESSION, END_A, 1, NOW))
    // Bypassed on the fold side: the author says epoch 2 while the ledger only ever recorded epoch 1.
    await log.append(a.turn({ session: SESSION, end: END_A, epoch: 2, text: 'a generation the ledger never took' }, NOW))
    const first = a.project(log.replay())
    compareTurns(first, referenceSessions(log.replay()), 'the ahead-of-epoch turn', problems, [])
    const rejected = (first.sessions?.rejectedTurns ?? []).find((row) => row.seq === 2) ?? null
    if (rejected === null) problems.push('the ahead-of-epoch turn is not visible in rejectedTurns')
    else if (rejected.reason !== 'unrecorded-epoch') problems.push('the folded reason is ' + show(rejected.reason) + ', expected unrecorded-epoch')
    if ((first.sessions?.turns ?? []).some((row) => row.seq === 2)) problems.push('the ahead-of-epoch turn was adopted')
    // The boundary, in the same reading: the same author AT the epoch it holds is adopted, so the word
    // above is not "the author was refused", it is "that generation was never recorded".
    await log.append(a.turn({ session: SESSION, end: END_A, epoch: 1, text: 'the epoch it holds' }, NOW))
    const second = a.project(log.replay())
    compareTurns(second, referenceSessions(log.replay()), 'the same author at the held epoch', problems, [])
    if (!(second.sessions?.turns ?? []).some((row) => row.seq === 3)) problems.push('the author writing at the epoch it holds was not adopted')
    // The guard side: the same ask through appendTurn, with the ledger watched.
    const before = log.replay().length
    const outcome = await a.appendTurn(log, a.project(log.replay()), { session: SESSION, end: END_A, epoch: 2, text: 'through the guard' })
    if (outcome?.appended !== false || outcome?.seq !== null) problems.push('the guard let an ahead-of-epoch turn through: ' + clip(show(outcome), 110))
    if (outcome?.reason !== 'unrecorded-epoch') problems.push('the guard reason is ' + show(outcome?.reason ?? null) + ', expected unrecorded-epoch (the ruled word for this corner)')
    if (log.replay().length !== before) problems.push('the refused write grew the ledger (' + before + ' -> ' + log.replay().length + ')')
    console.log('      folded reason ' + show(rejected?.reason ?? null) + '; adopted at the held epoch ' + show((second.sessions?.turns ?? []).some((row) => row.seq === 3)) + '; guard verdict ' + clip(show(outcome), 80))
  } catch (error) {
    problems.push('the reading threw instead of answering: ' + clip(String(error?.message ?? error), 130))
  } finally {
    if (log !== null) { try { await log.close() } catch { /* nothing to do */ } }
    rmSync(dir, { recursive: true, force: true })
  }
  record(15, problems.length === 0, problems.length === 0 ? 'a generation the ledger never took is refused on both faces with its own word, and the held epoch still writes' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 16 an unusable turn is still visible
function checkSixteen(a) {
  start(16)
  if (!guardFold(16, a)) return
  const records = [
    claim(1, SESSION, END_A, 1, NOW),
    turnNoSession(2, END_A, 1, 'no address at all', NOW),
    call(3, TURN_KIND, SESSION, { session: SESSION, end: END_A, epoch: 1 }),
    call(4, TURN_KIND, SESSION, { session: SESSION, end: END_A, epoch: 1.5, text: 'a bad epoch', at: NOW }),
    call(5, TURN_KIND, SESSION, { session: SESSION, end: END_A, epoch: 1, text: 'no at' }),
    turn(6, SESSION, END_A, 1, 'a real turn', NOW),
  ]
  const state = stateOf(a, records)
  const mine = referenceSessions(records)
  const problems = []
  const notes = []
  compareTurns(state, mine, 'four unusable turns and one real one', problems, notes)
  const turns = state.sessions?.turns ?? []
  const rejected = state.sessions?.rejectedTurns ?? []
  const turnRecords = records.filter((row) => row.kind === TURN_KIND)
  // Ruling 2: the coverage equation now holds over EVERY session/turn record, unusable ones included.
  if (turns.length + rejected.length !== turnRecords.length) problems.push('the coverage equation fails over all turn records: ' + turns.length + ' + ' + rejected.length + ' != ' + turnRecords.length)
  if (state.sessions?.malformed !== 4) problems.push('malformed is ' + show(state.sessions?.malformed) + ', expected 4 (this gate own count of unusable turn records)')
  const malformedRows = rejected.filter((row) => row.reason === 'malformed')
  if (malformedRows.length !== state.sessions?.malformed) problems.push('the invariant "every malformed turn record has a rejectedTurns row" fails: ' + malformedRows.length + ' rows for ' + show(state.sessions?.malformed) + ' records')
  const addressless = malformedRows.filter((row) => row.session === null)
  if (addressless.length !== 1) problems.push('expected exactly the address-less record to name session null, got ' + addressless.length)
  else {
    if (addressless[0].end !== null) problems.push('an address-less turn names end ' + show(addressless[0].end) + ', expected null')
    if (addressless[0].epoch !== 0) problems.push('an address-less turn names epoch ' + show(addressless[0].epoch) + ', expected 0')
  }
  for (const row of malformedRows.filter((item) => item.session !== null)) {
    if (row.end !== END_A) problems.push('a session-named unusable turn names end ' + show(row.end) + ', expected ' + END_A + ' (the address it did name)')
  }
  const epochs = malformedRows.filter((row) => row.session !== null).map((row) => row.seq + ':' + String(row.epoch)).join(', ')
  if (epochs !== '3:1, 4:0, 5:1') problems.push('the unusable rows name epochs ' + show(epochs) + ', expected 3:1 (usable epoch), 4:0 (epoch unusable -> 0), 5:1')
  if (turns.length !== 1 || turns[0].seq !== 6) problems.push('the only adopted turn should be seq 6: ' + clip(show(pickTurns(state)), 120))
  if (rejected.some((row) => row.session === '')) problems.push('a rejected turn names the empty string as its session (null means "named none")')
  console.log('      malformed ' + show(state.sessions?.malformed) + ', rejected rows ' + show(rejected.map((row) => row.seq + ':' + (row.session === null ? 'null' : row.session) + ':' + row.reason)) + ', adopted ' + show(turns.map((row) => row.seq)))
  record(16, problems.length === 0, problems.length === 0 ? 'no unusable turn is silently dropped and the equation covers every turn record (the address-less one says null, not the empty string)' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- the run
async function runAll(modulePath, gates) {
  results.length = 0
  const mod = await load(modulePath)
  const a = api(mod)
  if (mod === null) console.log('  (the module at ' + modulePath + ' could not be imported)')
  const sequence = [[1, (self) => checkOne(self, mod)], [2, (self) => checkTwo(self, mod)], [3, (self) => checkThree(self, mod)], [4, (self) => checkReason(self, mod, REASON_CASES[0])], [5, (self) => checkReason(self, mod, REASON_CASES[1])], [6, (self) => checkReason(self, mod, REASON_CASES[2])], [7, checkSeven], [8, (self) => checkEight(self, mod)], [9, (self) => checkNine(self, mod)], [10, checkTen], [11, checkEleven], [12, checkTwelve], [14, checkFourteen], [15, (self) => checkFifteen(self, mod)], [16, checkSixteen]]
  for (const [n, check] of sequence) {
    try { await check(a) } catch (error) { console.log(''); console.log('-- ' + n + '. ' + SENTENCES[n]); record(n, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140)) }
  }
  if (SKIP_REGRESSION) {
    console.log('')
    console.log('-- 13. NOT RUN: --skip-regression was passed, so the three nested gates were not re-run here')
    console.log('   (verify-all.mjs owns that sweep; the default run does execute reading 13 and takes about ten minutes)')
  } else {
    await checkThirteen(gates === undefined ? GATES : gates)
  }
  return { failed: results.filter((row) => !row.ok && !row.skip).map((row) => row.n), skipped: results.filter((row) => row.skip).map((row) => row.n) }
}

// Anchors are matched out of the build product itself; a mutant whose anchor is missing FAILS the
// self-attack instead of quietly disappearing (R40 lost a mutant that way once).
const MUTATIONS = [
  {
    name: 'the turn fold decides by arrival order, not by seq',
    declared: [10],
    edits: [{
      find: /(const text = \(value\) => typeof value === "string" && value !== "" \? value : null;\n\s*)for \(const record of \[\.\.\.records\]\.sort\(\(left, right\) => left\.seq - right\.seq\)\) \{/,
      replace: (whole, head) => head + 'for (const record of records) {',
    }],
  },
  {
    name: 'every turn is adopted whatever the author rules say',
    // Reading 8 is not in this set: neither log holds a turn that the correct rules reject, so adopting
    // everything changes nothing it can see. The first run declared 8 and observed otherwise. Reading 15
    // IS in it: its unrecorded-epoch turn gets adopted when every turn is adopted.
    declared: [3, 4, 5, 6, 7, 10, 15],
    edits: [{
      find: /function turnReason\(held, end, epoch\) \{\n\s*if \(held === null\) return "no-author";/,
      replace: () => 'function turnReason(held, end, epoch) {\n  return null;\n  if (held === null) return "no-author";',
    }],
  },
  {
    name: 'rejected turns are dropped instead of staying visible',
    // Reading 15 is in this set too: it reads a rejected row, so dropping the rejected list blinds it.
    declared: [3, 4, 5, 6, 7, 10, 15],
    edits: [{
      find: /if \(reason !== null\) rejectedTurns\.push\(\{ session: session2, end: end2, epoch: epoch2, seq: record\.seq, reason \}\);/,
      replace: () => 'if (reason !== null) { /* dropped on purpose: this is the defect */ }',
    }],
  },
  {
    name: 'the guard appends first and reports a refusal (the ledger moves anyway)',
    // Reading 15 watches the ledger across its own refused write, so it is red here as well.
    declared: [1, 4, 5, 6, 8, 9, 15],
    edits: [{
      find: /if \(!mayWrite\(state, turn\.session, turn\.end, turn\.epoch\)\) return \{ appended: false, reason: writeRefusalReason\(verdict\), seq: null \};/,
      replace: () => 'if (!mayWrite(state, turn.session, turn.end, turn.epoch)) { const spent = await log.append(record); return { appended: false, reason: writeRefusalReason(verdict), seq: spent }; }',
    }],
  },
  {
    name: 'the turn kind is unreadable again (READABLE_KINDS)',
    declared: [11],
    edits: [{
      find: /var READABLE_KINDS = \[TASK_KIND, MEMBER_KIND, CAPABILITY_KIND, HEARTBEAT_KIND, TEAM_KIND, PEER_KIND, LOCK_KIND, SESSION_KIND, HANDOFF_KIND, TURN_KIND\];/,
      replace: () => 'var READABLE_KINDS = [TASK_KIND, MEMBER_KIND, CAPABILITY_KIND, HEARTBEAT_KIND, TEAM_KIND, PEER_KIND, LOCK_KIND, SESSION_KIND, HANDOFF_KIND];',
    }],
  },
  {
    name: 'turn facts leak into the member fold (the fault of reading 12)',
    declared: [12],
    edits: [
      {
        find: /const change = record\.kind === TASK_KIND \|\| record\.kind === MEMBER_KIND \? stateOf\(record\) : null;/,
        replace: () => 'const change = record.kind === TASK_KIND || record.kind === MEMBER_KIND || record.kind === TURN_KIND ? stateOf(record) : null;',
      },
      {
        find: /if \(payload === void 0 \|\| typeof payload\.id !== "string" \|\| payload\.id === ""\) return null;/,
        replace: () => 'if (payload === void 0 || typeof payload.id !== "string" || payload.id === "") return typeof payload.session === "string" && payload.session !== "" ? { id: payload.session, team: teamOf(record), state: "open", owner: null, name: null, role: null } : null;',
      },
    ],
  },
  {
    name: 'the turn builder stops guarding text',
    declared: [14],
    edits: [{
      find: /if \(typeof turn\?\.text !== "string"\) throw new TypeError\("turnRecord: text must be a string"\);\n\s*/,
      replace: () => '',
    }],
  },
  {
    name: 'a higher epoch from another end is adopted (not-author dropped)',
    declared: [5, 7],
    edits: [{
      find: /if \(end !== held\.end\) return "not-author";/,
      replace: () => 'if (false) return "not-author";',
    }],
  },
  {
    name: 'an old generation is adopted (stale-epoch dropped)',
    declared: [3, 4, 7, 10],
    edits: [{
      find: /(if \(end === held\.end && epoch === held\.epoch\) return null;\n\s*)if \(epoch <= held\.epoch\) return "stale-epoch";\n/,
      replace: (whole, head) => head,
    }],
  },
  {
    name: 'a turn before any author is adopted (no-author dropped)',
    declared: [6],
    edits: [{
      find: /if \(held === null\) return "no-author";/,
      replace: () => 'if (held === null) return null;',
    }],
  },
  {
    name: 'an unusable turn record is counted but not visible (silently dropped)',
    declared: [16],
    edits: [{
      find: /\n\s*rejectedTurns\.push\(session2 === null \? \{ session: null, end: null, epoch: 0, seq: record\.seq, reason: "malformed" \} : \{ session: session2, end: end2, epoch: typeof rawEpoch2 === "number" && Number\.isSafeInteger\(rawEpoch2\) \? rawEpoch2 : 0, seq: record\.seq, reason: "malformed" \}\);/,
      replace: () => '',
    }],
  },
  {
    name: 'the author ahead of its epoch is adopted (unrecorded-epoch dropped)',
    declared: [7, 15],
    edits: [{
      find: /return "unrecorded-epoch";/,
      replace: () => 'return null;',
    }],
  },
  {
    name: 'the write face loses the unrecorded-epoch word',
    declared: [15],
    edits: [{
      find: /return verdict\.reason === "none" \? "none" : "unrecorded-epoch";/,
      replace: () => 'return verdict.reason === "none" ? "none" : "ok";',
    }],
  },
  {
    name: 'mayWrite is false for everyone (the author cannot write either)',
    declared: [2, 8, 9],
    edits: [{
      find: /function mayWrite\(state, session, end, epoch\) \{\n\s*const held = sessionOwner\(state, session\);\n\s*return held !== null && held\.end === end && held\.epoch === epoch;/,
      replace: () => 'function mayWrite(state, session, end, epoch) {\n  const held = sessionOwner(state, session);\n  return false;',
    }],
  },
]

async function selfAttack() {
  if (MUTATIONS.length === 0) {
    console.log('the mutation table is empty: this run has nothing to attack with, which is a failure, not a pass')
    process.exit(1)
  }
  const tmp = mkdtempSync(join(SCRATCH, 'r42-attack-'))
  try {
    const source = readFileSync(MODULE, 'utf8')
    const failing = join(tmp, 'gate-that-fails.mjs')
    writeFileSync(failing, 'process.exit(1)\n')
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
      anchors.push('  ' + id + ' ' + mutation.name + ' -> ' + clip(anchor.replace(/\s+/g, ' '), 150))
      const copy = join(tmp, 'mutant-' + String(applied) + '.mjs')
      writeFileSync(copy, text)
      const seen = await runAll(copy, [failing])
      const declared = mutation.declared.slice().sort((left, right) => left - right)
      const observed = seen.failed.filter((n) => n !== 13).sort((left, right) => left - right)
      const clean = show(observed) === show(declared)
      if (clean) localised += 1
      lines.push('  ' + id + ' ' + mutation.name + ' -> declared ' + show(declared) + ', observed ' + show(observed) + (clean ? '  LOCALISED' : '  MISMATCH'))
      rows.push({ id, name: mutation.name, declared, clean })
    }
    console.log('== anchors taken from the build product (' + MODULE + ') ==')
    console.log(anchors.join('\n'))
    console.log('')
    console.log('== mutations: each mutant must redden exactly its declared set ==')
    console.log(lines.join('\n'))
    console.log('')
    const READINGS = Object.keys(SENTENCES).map(Number)
    console.log('coverage matrix (reading -> mutants that declare it):')
    for (const n of READINGS) {
      const claimants = rows.filter((row) => row.declared.includes(n)).map((row) => row.id)
      console.log('  ' + n + ': ' + (n === 13 ? 'regression probe (synthetic failing gate)' : (claimants.join(', ') || 'UNCOVERED')))
    }
    const uncovered = READINGS.filter((n) => n !== 13 && rows.every((row) => !row.declared.includes(n)))
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
  const { failed, skipped } = await runAll(MODULE)
  console.log('')
  console.log(String(results.length) + ' readings, ' + String(results.length - failed.length - skipped.length) + ' held, ' + String(skipped.length) + ' skipped, ' + String(failed.length) + ' failed')
  if (failed.length > 0) process.exit(1)
  if (skipped.length > 0) process.exit(3)
  process.exit(0)
}

if (SELF_ATTACK) await selfAttack()
else await main()
