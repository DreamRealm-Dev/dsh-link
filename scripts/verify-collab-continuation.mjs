#!/usr/bin/env node
/**
 * R41 (task-75): the cross-end continuation PROTOCOL SURFACE — "a session has exactly one author at
 * any instant". Contract: dsh-link/.tmp/r41-contract.md, whose section 5 lists the readings this gate
 * must carry. Source of truth for the shape is the built module, plugins/dsh-link-collab/lib/index.js.
 *
 * Every expected value below is computed HERE, from the ledger records and the clock handed in:
 * referenceFold() is this gate's own reading of R1-R5, expectedLiveness() is this gate's own reading of
 * the healthy/unknown/unhealthy rule (lastBeat present and now - lastBeat >= timeoutMs is unhealthy, no
 * lastBeat at all is unknown). Nothing is read back out of the implementation. Fixtures are built from
 * the contract's record shape, not from the module's builders — reading 11 then proves the builders
 * produce exactly that shape.
 *
 *   1 first claim              (R6.1, R7)  no author -> ok/none; once adopted mayWrite(author, epoch) is true
 *   2 stale epoch refused      (R1, R6.2)  epoch 2 then epoch 1 at a later seq -> the author stays epoch 2,
 *                                          the refusal stays visible, mayContinue answers stale-epoch
 *   3 another end may not grab (R6.4, R7)  without timeoutMs -> owned-by-other, and mayWrite is false even
 *                                          when the asker quotes the author's own epoch
 *   4 a silent holder          (R6.4)      heartbeat >= timeoutMs -> silent-owner; one ms inside -> no;
 *                                          a member that never beat (unknown) -> no
 *   5 explicit handoff         (R2, R7)    from the author at epoch+1 -> adopted, mayWrite moves at once,
 *                                          the old end is false; from != author -> not-owner; epoch != +1 -> epoch-gap
 *   6 anti-fork (CORE)         (R7)        two ends declare the same epoch = current+1 -> exactly one
 *                                          mayWrite true, and both ends folding the same ledger get one author
 *   7 order independence       (R1)        one batch in two arrival orders -> sessions byte-identical
 *   8 honest counters          (S4)        the two session kinds are readable kinds: counts.unknown does not rise
 *   9 the other readings       (S4)        a ledger differing ONLY by session facts keeps tasks/members/
 *                                          counts/registry/liveness/teams/peers/board/locks byte-identical
 *  10 regression               (S5.10)     eleven gates, with lockfail 11/11 and board 19/19
 *  11 record shape + guards    (S1)        sessionClaim/sessionHandoff shapes and their TypeErrors
 *  12 the audit chain          (R5, R8)    every session record is either adopted or refused, and
 *                                          continuations is the adopted chain in seq order
 *  13 malformed first record   (R3)        a session's first record below epoch 1 never becomes an author
 *  14 malformed is visible      (R5 + the 2026-06 ruling) an unusable record is refused with a reason and
 *                                          an address-less one names session: null (never ""), epoch 0,
 *                                          and every malformed record has exactly one refused row
 *
 * Exit 0 all held; 1 a reading failed; 3 an input is missing (printed). --self-attack mutates the BUILT
 * module (anchors are matched out of lib/index.js itself, so a refactor cannot leave an anchor silently
 * stale): every mutant must redden exactly the set it declares, the coverage matrix is printed, and every
 * reading must be claimed by at least one mutant.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
// R44: reading 10 runs eleven more gates, which nest sweeps of their own (measured 798.9s for this file).
// --skip-regression is the fast path for a harness that already owns the full regression sweep.
const SKIP_REGRESSION = argv.includes('--skip-regression')
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = argv.includes('--self-attack')
const MODULE = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
const GATES = ['verify-collab-lockfail.mjs', 'verify-collab-board.mjs', 'verify-collab-failover.mjs', 'verify-collab-registry.mjs', 'verify-collab-handshake.mjs', 'verify-collab-fractal.mjs', 'verify-collab-contested.mjs', 'verify-collab-multihop.mjs', 'verify-teams-log.mjs', 'verify-collab-relay.mjs', 'verify-collab-relay-http.mjs']
const GATE_COUNTS = { 'verify-collab-lockfail.mjs': 11, 'verify-collab-board.mjs': 19 }

const TEAM = 'team-1'
const SESSION = 'sess-1'
const SESSION_TWO = 'sess-2'
const END_A = 'end-A'; const END_B = 'end-B'; const END_C = 'end-C'; const END_D = 'end-D'
const NOW = 1_800_000_000_000
const TIMEOUT = 60_000
const CLAIM_KIND = 'session/claim'
const HANDOFF_KIND = 'session/handoff'

const SENTENCES = {
  1: 'no author answers ok/none, and once the claim is adopted mayWrite(author, epoch) is true  [R6.1/R7, S5.1]',
  2: 'a stale epoch is refused, the author does not move, and mayContinue says stale-epoch  [R1/R6.2, S5.2]',
  3: 'another end may not take over without timeoutMs (owned-by-other, mayWrite false)  [R6.4/R7, S5.3]',
  4: 'a silent author may be taken over at exactly timeoutMs, not one ms early, and unknown is not death  [R6.4, S5.4]',
  5: 'a handoff at epoch+1 from the author moves the pen; from != author is not-owner; epoch != +1 is epoch-gap  [R2/R7, S5.5]',
  6: 'two ends declaring the same epoch+1: exactly one mayWrite true, one author for both ends  [R7, S5.6]',
  7: 'the same batch in any arrival order folds to the same owner: the fold is by seq  [R1, S5.7]',
  8: 'folding session facts does not raise counts.unknown, and a truly unreadable kind still does  [S4, S5.8]',
  9: 'a ledger differing only by session facts keeps every other entity reading byte-identical  [S4, S5.9]',
  10: 'the eleven R41 regression gates stay green (lockfail 11/11, board 19/19)  [S5.10]',
  11: 'the two record builders produce the contract shape and throw TypeError on every illegal argument  [S1]',
  12: 'every session record is either adopted or refused, and continuations is the adopted chain in seq order  [R5/R8]',
  13: 'a session first record below epoch 1 is malformed and never becomes an author  [R3]',
  14: 'an unusable record is refused with a reason (an address-less one names null, not the empty string), and every malformed record has a refused row  [R5, ruling]',
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
  sessions: typeof mod?.projectSessions === 'function' ? mod.projectSessions : null,
  owner: typeof mod?.sessionOwner === 'function' ? mod.sessionOwner : null,
  cont: typeof mod?.continuations === 'function' ? mod.continuations : null,
  mayContinue: typeof mod?.mayContinue === 'function' ? mod.mayContinue : null,
  mayWrite: typeof mod?.mayWrite === 'function' ? mod.mayWrite : null,
  claim: typeof mod?.sessionClaim === 'function' ? mod.sessionClaim : null,
  handoff: typeof mod?.sessionHandoff === 'function' ? mod.sessionHandoff : null,
  liveness: typeof mod?.livenessOf === 'function' ? mod.livenessOf : null,
})
const CORE = ['project', 'sessions', 'owner', 'cont', 'mayContinue', 'mayWrite']
const missingCore = (a) => CORE.filter((key) => a[key] === null)
const guard = (n, a) => {
  const gone = missingCore(a)
  if (gone.length === 0) return true
  record(n, false, 'the module exposes no ' + gone.join(', ') + ' — the sentence cannot be read on this build')
  return false
}

// ---------------------------------------------------------------- the ledger fixtures (contract shape)
const call = (seq, writer, kind, session, payload) => ({ seq, channel: 'control', writer, instance: 'i1', actor: TEAM, kind, subject: session, payload })
const claim = (seq, session, end, epoch, at) => call(seq, 'w-' + end, CLAIM_KIND, session, { session, end, epoch, at })
const handoff = (seq, session, from, to, epoch, at) => call(seq, 'w-' + from, HANDOFF_KIND, session, { session, from, to, epoch, at })
const member = (seq, id) => call(seq, 'w-' + id, 'member/state', id, { id, name: id, state: 'active', role: 'member' })
const beat = (seq, id, at) => call(seq, 'w-' + id, 'member/heartbeat', id, { id, at })
const task = (seq, id, state, owner) => call(seq, 'w-1', 'task/state', id, { id, state, owner })
// Like call(), but a record may name no subject at all: that is what reading 14 is about.
const looseCall = (seq, kind, subject, payload) => ({ seq, channel: 'control', writer: 'w-1', instance: 'i1', actor: TEAM, kind, ...(subject === undefined ? {} : { subject }), payload })
const clone = (records) => records.map((item) => ({ ...item, payload: { ...item.payload } }))
const arrival = (records, order) => order.map((seq) => records.find((item) => item.seq === seq))

// ---------------------------------------------------------------- this gate's own expectations
/** R1-R5, written from the contract text. Returns what the ledger must fold to. */
const referenceFold = (records) => {
  const owners = new Map()
  const steps = []
  const refused = []
  let malformed = 0
  for (const row of [...records].sort((left, right) => left.seq - right.seq)) {
    if (row.kind !== CLAIM_KIND && row.kind !== HANDOFF_KIND) continue
    const by = row.kind === HANDOFF_KIND ? 'handoff' : 'claim'
    const payload = row.payload ?? {}
    const session = str(payload.session) ?? str(row.subject)
    const end = by === 'claim' ? str(payload.end) : str(payload.to)
    const from = by === 'handoff' ? str(payload.from) : null
    const epoch = Number.isSafeInteger(payload.epoch) ? payload.epoch : null
    const at = Number.isFinite(payload.at) ? payload.at : null
    // The ruled shape of a refused-but-unusable record: an address-less record names null (not ""),
    // an otherwise unusable record keeps the address it named and falls back to epoch 0 when it has none.
    if (session === null || end === null || epoch === null || at === null || (by === 'handoff' && from === null)) {
      malformed += 1
      refused.push(session === null
        ? { session: null, end: null, epoch: 0, seq: row.seq, reason: 'malformed', by }
        : { session, end, epoch: epoch ?? 0, seq: row.seq, reason: 'malformed', by })
      continue
    }
    const held = owners.get(session) ?? null
    if (held === null && epoch < 1) { malformed += 1; refused.push({ session, end, epoch, seq: row.seq, reason: 'malformed', by }); continue }
    if (held !== null && epoch <= held.epoch) { refused.push({ session, end, epoch, seq: row.seq, reason: 'stale-epoch', by }); continue }
    if (by === 'handoff') {
      if (held === null || from !== held.end) { refused.push({ session, end, epoch, seq: row.seq, reason: 'not-owner', by }); continue }
      if (epoch !== held.epoch + 1) { refused.push({ session, end, epoch, seq: row.seq, reason: 'epoch-gap', by }); continue }
    }
    const step = { session, end, epoch, at, seq: row.seq, by }
    steps.push(step)
    owners.set(session, step)
  }
  return { owners: [...owners.values()].sort((left, right) => (left.session < right.session ? -1 : left.session > right.session ? 1 : 0)), steps, refused, malformed }
}
/** The liveness rule from the contract's S5.4, computed from the records and the clock, not read back. */
const expectedLiveness = (records, end, now, timeoutMs) => {
  const mine = records.filter((row) => row.kind === 'member/heartbeat' && (row.payload?.id ?? row.subject) === end)
  if (mine.length === 0) return 'unknown'
  const last = [...mine].sort((left, right) => left.seq - right.seq).slice(-1)[0].payload.at
  return now - last >= timeoutMs ? 'unhealthy' : 'healthy'
}
const FIELD_SETS = {
  owner: ['session', 'end', 'epoch', 'at', 'seq', 'by'],
  step: ['session', 'end', 'epoch', 'at', 'seq', 'by'],
  refusal: ['session', 'end', 'epoch', 'seq', 'reason', 'by'],
}
const pickFrom = (row, fields) => Object.fromEntries(fields.map((field) => [field, row?.[field] ?? null]))
const pickOwner = (row) => pickFrom(row, FIELD_SETS.owner)
const pickStep = (row) => pickFrom(row, FIELD_SETS.step)
const pickRefusal = (row) => pickFrom(row, FIELD_SETS.refusal)
const pickSessions = (state) => state?.sessions === undefined || state?.sessions === null ? null : {
  owners: (state.sessions.owners ?? []).map(pickOwner),
  steps: (state.sessions.steps ?? []).map(pickStep),
  refused: (state.sessions.refused ?? []).map(pickRefusal),
  malformed: state.sessions.malformed ?? null,
}
/** Compare an implementation fold against this gate's own fold, on the contract's fields only. */
const compareFold = (state, expected, label, problems, notes) => {
  const actual = pickSessions(state)
  if (actual === null) { problems.push(label + ': the projection carries no sessions (S4 wiring)'); return }
  const want = { owners: expected.owners.map(pickOwner), steps: expected.steps.map(pickStep), refused: expected.refused.map(pickRefusal) }
  for (const key of ['owners', 'steps', 'refused']) {
    if (show(actual[key]) !== show(want[key])) problems.push(label + ': ' + key + ' is ' + clip(show(actual[key]), 220) + ', expected ' + clip(show(want[key]), 220))
  }
  if (actual.malformed !== expected.malformed) problems.push(label + ': malformed is ' + show(actual.malformed) + ', expected ' + show(expected.malformed))
  notes.push(label + ' -> owners ' + clip(show(actual.owners), 90) + ', steps seqs ' + show((state.sessions.steps ?? []).map((row) => row.seq)) + ', refused ' + show((state.sessions.refused ?? []).map((row) => row.seq + ':' + row.reason)) + ', malformed ' + show(actual.malformed))
}
const stateOf = (a, records) => a.project(clone(records))

// ---------------------------------------------------------------- 1 first claim
function checkOne(a) {
  start(1)
  if (!guard(1, a)) return
  const problems = []
  const notes = []
  const empty = stateOf(a, [member(1, END_A)])
  const held = a.owner(empty, SESSION)
  if (held !== null) problems.push('an empty session already has an author: ' + show(held))
  const first = a.mayContinue(empty, SESSION, END_A, 1, NOW, {})
  const expectedFirst = { ok: true, reason: 'none', owner: null, epoch: null }
  if (show(first) !== show(expectedFirst)) problems.push('the first-claim verdict is ' + show(first) + ', expected ' + show(expectedFirst))
  if (a.mayWrite(empty, SESSION, END_A, 1) !== false) problems.push('mayWrite is true although nobody owns the session (R7)')
  const records = [member(1, END_A), claim(2, SESSION, END_A, 1, NOW)]
  const state = stateOf(a, records)
  const mine = referenceFold(records)
  compareFold(state, mine, 'the adopted claim', problems, notes)
  const owner = a.owner(state, SESSION)
  if (show(pickOwner(owner)) !== show(pickOwner(mine.owners[0]))) problems.push('the author is ' + show(owner) + ', expected ' + show(mine.owners[0]))
  if (a.mayWrite(state, SESSION, END_A, 1) !== true) problems.push('mayWrite(author, epoch) is not true after the claim was adopted (R7)')
  if (a.mayWrite(state, SESSION, END_A, 2) !== false) problems.push('mayWrite is true for an epoch the author does not hold (R7 needs both conjuncts)')
  if (a.mayWrite(state, SESSION, END_B, 1) !== false) problems.push('mayWrite is true for an end that does not own the session')
  notes.push('no author -> ' + clip(show(first), 80) + '; after the claim -> owner ' + clip(show(pickOwner(owner)), 80) + ', mayWrite(A,1) ' + show(a.mayWrite(state, SESSION, END_A, 1)))
  console.log('      ' + notes.join(''))
  record(1, problems.length === 0, problems.length === 0 ? 'the first claim is legal and it is the author afterwards: ' + notes.join(' | ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 2 stale epoch is refused, author unmoved
function checkTwo(a) {
  start(2)
  if (!guard(2, a)) return
  const problems = []
  const notes = []
  // seq order == arrival order on purpose: this reading pins the EPOCH rule, not the seq rule.
  const records = [claim(1, SESSION, END_A, 2, NOW), claim(2, SESSION, END_B, 1, NOW)]
  const state = stateOf(a, records)
  const mine = referenceFold(records)
  compareFold(state, mine, 'epoch 2 then epoch 1', problems, notes)
  const owner = a.owner(state, SESSION)
  if (owner === null || owner.end !== END_A || owner.epoch !== 2) problems.push('the author moved to ' + show(owner) + '; the stale claim must not take the pen (R1)')
  const refused = (state.sessions?.refused ?? []).find((row) => row.seq === 2) ?? null
  if (refused === null) problems.push('the refused claim is not visible in refused (R5)')
  else if (refused.reason !== 'stale-epoch') problems.push('the refusal reason is ' + show(refused.reason) + ', expected stale-epoch')
  const stale = a.mayContinue(state, SESSION, END_B, 1, NOW, {})
  const expectedStale = { ok: false, reason: 'stale-epoch', owner: END_A, epoch: 2 }
  if (show(stale) !== show(expectedStale)) problems.push('mayContinue(epoch 1) is ' + show(stale) + ', expected ' + show(expectedStale))
  // R6 fixes the precedence: the epoch test comes before "the author continues", so the author at its own
  // epoch is stale too — it must claim epoch > 2 to keep going.
  const authorStale = a.mayContinue(state, SESSION, END_A, 2, NOW, {})
  if (authorStale.ok !== false || authorStale.reason !== 'stale-epoch') problems.push('the author asking at its own epoch got ' + show(authorStale) + ', expected stale-epoch (R6 order 2 before order 3)')
  notes.push('owner ' + clip(show(pickOwner(owner)), 80) + '; refused ' + clip(show(pickRefusal(refused)), 90) + '; mayContinue(epoch 1) ' + clip(show(stale), 80))
  console.log('      ' + notes.join(''))
  record(2, problems.length === 0, problems.length === 0 ? 'the later record does not win: ' + notes.join(' | ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 3 another end may not grab it
function checkThree(a) {
  start(3)
  if (!guard(3, a)) return
  const problems = []
  const notes = []
  const records = [member(1, END_A), beat(2, END_A, NOW - 1_000), claim(3, SESSION, END_A, 1, NOW)]
  const state = stateOf(a, records)
  const mine = referenceFold(records)
  compareFold(state, mine, 'a live author', problems, notes)
  const withoutTimeout = a.mayContinue(state, SESSION, END_B, 2, NOW, {})
  const expected = { ok: false, reason: 'owned-by-other', owner: END_A, epoch: 1 }
  if (show(withoutTimeout) !== show(expected)) problems.push('without timeoutMs the verdict is ' + show(withoutTimeout) + ', expected ' + show(expected))
  if (a.mayWrite(state, SESSION, END_B, 2) !== false) problems.push('mayWrite is true for the other end')
  if (a.mayWrite(state, SESSION, END_B, 1) !== false) problems.push('mayWrite is true for the other end quoting the author own epoch: R7 needs the owner conjunct too')
  // timeoutMs omitted entirely: either the call refuses to answer, or it answers without a takeover.
  let omitted = null
  try { omitted = a.mayContinue(state, SESSION, END_B, 2, NOW) } catch (error) { omitted = 'threw ' + (error?.name ?? 'an error') }
  if (typeof omitted === 'object' && omitted !== null && omitted.ok === true) problems.push('omitting options entirely allowed a takeover: ' + show(omitted))
  notes.push('without timeoutMs -> ' + clip(show(withoutTimeout), 80) + '; options omitted -> ' + show(omitted) + '; mayWrite(B,1) ' + show(a.mayWrite(state, SESSION, END_B, 1)))
  console.log('      ' + notes.join(''))
  record(3, problems.length === 0, problems.length === 0 ? 'no takeover without timeoutMs: ' + notes.join(' | ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 4 a silent holder may be taken over
function checkFour(a) {
  start(4)
  if (!guard(4, a)) return
  const problems = []
  const notes = []
  const cases = [
    ['five timeouts stale', NOW - 5 * TIMEOUT, 'unhealthy', { ok: true, reason: 'silent-owner', owner: END_A, epoch: 1 }],
    ['exactly one timeout', NOW - TIMEOUT, 'unhealthy', { ok: true, reason: 'silent-owner', owner: END_A, epoch: 1 }],
    ['one ms inside', NOW - TIMEOUT + 1, 'healthy', { ok: false, reason: 'owned-by-other', owner: END_A, epoch: 1 }],
  ]
  for (const [label, at, wantLiveness, want] of cases) {
    const records = [member(1, END_A), beat(2, END_A, at), claim(3, SESSION, END_A, 1, NOW)]
    const state = stateOf(a, records)
    const mine = expectedLiveness(records, END_A, NOW, TIMEOUT)
    if (mine !== wantLiveness) problems.push(label + ': this gate computes ' + mine + ' but the fixture was meant to be ' + wantLiveness)
    const seen = a.liveness ? (a.liveness(state, NOW, { timeoutMs: TIMEOUT }).find((row) => row.memberId === END_A)?.liveness ?? null) : null
    if (seen !== wantLiveness) problems.push(label + ': livenessOf says ' + show(seen) + ' while this gate computes ' + mine + ' from the same records and clock (the fixture does not sit where the reading thinks it does)')
    const verdict = a.mayContinue(state, SESSION, END_B, 2, NOW, { timeoutMs: TIMEOUT })
    if (show(verdict) !== show(want)) problems.push(label + ': the verdict is ' + show(verdict) + ', expected ' + show(want))
    if (want.ok === true && a.mayWrite(state, SESSION, END_B, 2) !== false) problems.push(label + ': mayWrite is already true for the asker before it claims (R7)')
    notes.push(label + ' (' + mine + ') -> ' + clip(show(verdict), 78))
  }
  // unknown is not death: a member that never heartbeated at all.
  const silentRecords = [member(1, END_A), claim(2, SESSION, END_A, 1, NOW)]
  const silentState = stateOf(a, silentRecords)
  const mine = expectedLiveness(silentRecords, END_A, NOW, TIMEOUT)
  if (mine !== 'unknown') problems.push('this gate computes ' + mine + ' for a member that never beat, expected unknown')
  const unknownVerdict = a.mayContinue(silentState, SESSION, END_B, 2, NOW, { timeoutMs: TIMEOUT })
  const wantUnknown = { ok: false, reason: 'owned-by-other', owner: END_A, epoch: 1 }
  if (show(unknownVerdict) !== show(wantUnknown)) problems.push('a never-beaten author answered ' + show(unknownVerdict) + ', expected ' + show(wantUnknown) + ' — unknown is not death')
  notes.push('never beat (unknown) -> ' + clip(show(unknownVerdict), 78))
  console.log('      ' + notes.join('\n      '))
  record(4, problems.length === 0, problems.length === 0 ? 'the hourglass is respected: ' + notes.length + ' cases, unknown included' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 5 explicit handoff
function checkFive(a) {
  start(5)
  if (!guard(5, a)) return
  const problems = []
  const notes = []
  const base = [claim(1, SESSION, END_A, 1, NOW)]
  const moved = [...base, handoff(2, SESSION, END_A, END_B, 2, NOW)]
  const mineMoved = referenceFold(moved)
  const stateMoved = stateOf(a, moved)
  compareFold(stateMoved, mineMoved, 'the handoff', problems, notes)
  const owner = a.owner(stateMoved, SESSION)
  if (owner === null || owner.end !== END_B || owner.epoch !== 2 || owner.by !== 'handoff') problems.push('after the handoff the author is ' + show(owner) + ', expected ' + END_B + ' at epoch 2 by handoff')
  if (a.mayWrite(stateMoved, SESSION, END_B, 2) !== true) problems.push('mayWrite is not true for the new author')
  if (a.mayWrite(stateMoved, SESSION, END_A, 1) !== false) problems.push('mayWrite is still true for the old end at its old epoch')
  if (a.mayWrite(stateMoved, SESSION, END_A, 2) !== false) problems.push('mayWrite is true for the old end at the CURRENT epoch: R7 needs the owner conjunct')
  // from is not the author -> not-owner (epoch 3 is > 2, so only the from rule can refuse this one)
  const wrongFrom = [...moved, handoff(3, SESSION, END_C, END_D, 3, NOW)]
  const stateWrongFrom = stateOf(a, wrongFrom)
  compareFold(stateWrongFrom, referenceFold(wrongFrom), 'handoff from a non-author', problems, notes)
  const refusedFrom = (stateWrongFrom.sessions?.refused ?? []).find((row) => row.seq === 3) ?? null
  if (refusedFrom === null || refusedFrom.reason !== 'not-owner') problems.push('a handoff from a non-author is ' + show(refusedFrom?.reason ?? null) + ', expected not-owner')
  if (a.owner(stateWrongFrom, SESSION)?.end !== END_B) problems.push('the not-owner handoff moved the author')
  // epoch is not +1 -> epoch-gap (epoch 4 is > 2, so R1 cannot be the reason)
  const gap = [...wrongFrom, handoff(4, SESSION, END_B, END_C, 4, NOW)]
  const stateGap = stateOf(a, gap)
  compareFold(stateGap, referenceFold(gap), 'handoff at epoch+2', problems, notes)
  const refusedGap = (stateGap.sessions?.refused ?? []).find((row) => row.seq === 4) ?? null
  if (refusedGap === null || refusedGap.reason !== 'epoch-gap') problems.push('a handoff at epoch+2 is ' + show(refusedGap?.reason ?? null) + ', expected epoch-gap')
  if (a.owner(stateGap, SESSION)?.end !== END_B) problems.push('the epoch-gap handoff moved the author')
  // The Lead froze the precedence (R41 ruling): structural usability, then a first record's epoch >= 1,
  // then STALE, then the two handoff conditions, then adoption. So a handoff that does not advance the
  // epoch is stale-epoch (epoch <= current), while epoch-gap is reserved for a handoff that advanced but
  // not by one (the +2 case above). Both halves are asserted, together they pin the ORDER, not "roughly refused".
  const same = [...gap, handoff(5, SESSION, END_B, END_C, 2, NOW)]
  const stateSame = stateOf(a, same)
  const refusedSame = (stateSame.sessions?.refused ?? []).find((row) => row.seq === 5) ?? null
  if (refusedSame === null) problems.push('a handoff at the current epoch was accepted (no refusal visible)')
  else {
    if (refusedSame.reason !== 'stale-epoch') problems.push('a handoff at the current epoch is refused as ' + show(refusedSame.reason) + ', expected stale-epoch (frozen precedence: stale comes before the handoff rules)')
    if (refusedSame.by !== 'handoff') problems.push('the refusal of a handoff carries by ' + show(refusedSame.by) + ', expected handoff')
  }
  if (a.owner(stateSame, SESSION)?.end !== END_B) problems.push('a handoff at the current epoch moved the author')
  notes.push('handoff -> owner ' + clip(show(pickOwner(owner)), 70) + '; mayWrite old(1) ' + show(a.mayWrite(stateMoved, SESSION, END_A, 1)) + ', old(current epoch) ' + show(a.mayWrite(stateMoved, SESSION, END_A, 2)) + '; not-owner ' + show(refusedFrom?.reason) + '; epoch-gap ' + show(refusedGap?.reason) + '; current-epoch refusal ' + show(refusedSame?.reason ?? null))
  console.log('      ' + notes.join(''))
  record(5, problems.length === 0, problems.length === 0 ? 'the pen moves only by handoff at epoch+1 from the author' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 6 anti-fork (core reading)
function checkSix(a) {
  start(6)
  if (!guard(6, a)) return
  const problems = []
  const notes = []
  // The author is end-A at epoch 1. Both B and C declare epoch 2 = current + 1.
  const records = [claim(1, SESSION, END_A, 1, NOW), claim(2, SESSION, END_B, 2, NOW), claim(3, SESSION, END_C, 2, NOW)]
  const mine = referenceFold(records)
  if (mine.owners.length !== 1) { record(6, false, 'this gate own fold is broken: ' + show(mine.owners)); return }
  const winner = mine.owners[0]
  const orders = [['seq order', records], ['reverse arrival', [...records].reverse()], ['scrambled arrival', arrival(records, [3, 1, 2])]]
  const digests = new Map()
  for (const [label, order] of orders) {
    const state = stateOf(a, order)
    compareFold(state, mine, 'the fork batch (' + label + ')', problems, notes)
    const owner = a.owner(state, SESSION)
    if (show(pickOwner(owner)) !== show(pickOwner(winner))) problems.push(label + ': the folded author is ' + clip(show(owner), 90) + ', expected ' + clip(show(winner), 90))
    const writes = [END_B, END_C].map((end) => [end, a.mayWrite(state, SESSION, end, 2) === true])
    const trueCount = writes.filter(([, value]) => value).length
    if (trueCount !== 1) problems.push(label + ': ' + trueCount + ' of the two ends mayWrite at epoch 2 (' + show(writes) + ') — a session must have exactly one author (R7)')
    else if (writes[0][1] !== (winner.end === END_B)) problems.push(label + ': the end with the pen is ' + show(writes) + ', expected ' + winner.end)
    digests.set(label, JSON.stringify(state.sessions))
    notes.push(label + ' -> author ' + winner.end + ', mayWrite ' + show(writes.map(([end, value]) => end + '=' + value)))
  }
  const unique = new Set(digests.values())
  if (unique.size !== 1) problems.push('the three arrival orders folded to different sessions: ' + show([...digests.keys()].map((key) => key + ' ' + clip(digests.get(key), 60))))
  console.log('      ledger: ' + clip(show(records.map((row) => ({ seq: row.seq, ...row.payload }))), 240))
  console.log('      ' + notes.join('\n      '))
  record(6, problems.length === 0, problems.length === 0 ? 'exactly one author, the same one in every arrival order, for both ends folding the same ledger (by seq)' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 7 order independence
function checkSeven(a) {
  start(7)
  if (!guard(7, a)) return
  const problems = []
  const notes = []
  const records = [
    claim(1, SESSION, END_A, 1, NOW),
    claim(2, SESSION, END_B, 2, NOW),
    handoff(3, SESSION, END_A, END_C, 3, NOW),
    handoff(4, SESSION, END_B, END_C, 3, NOW),
    claim(5, SESSION, END_A, 3, NOW),
    claim(6, SESSION_TWO, END_D, 1, NOW),
  ]
  const mine = referenceFold(records)
  const scrambled = arrival(records, [4, 6, 1, 5, 3, 2])
  const first = stateOf(a, records)
  const second = stateOf(a, scrambled)
  compareFold(first, mine, 'seq arrival', problems, notes)
  compareFold(second, mine, 'scrambled arrival', problems, notes)
  const one = JSON.stringify(first.sessions)
  const two = JSON.stringify(second.sessions)
  if (one !== two) problems.push('the two arrival orders do not project byte-identical sessions: ' + clip(one, 160) + ' vs ' + clip(two, 160))
  if (a.owner(first, SESSION)?.end !== END_C) problems.push('the author after the batch is ' + show(a.owner(first, SESSION)) + ', expected ' + END_C)
  console.log('      ledger seqs ' + show(records.map((row) => row.seq)) + ' vs reversed arrival ' + show([...scrambled].reverse().map((row) => row.seq)))
  console.log('      ' + notes.join('\n      '))
  record(7, problems.length === 0, problems.length === 0 ? 'both arrival orders fold to the same owner by seq, and the projection is byte-identical' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 8 honest counters
function checkEight(a) {
  start(8)
  if (!a.project || !a.sessions) { record(8, false, 'the module exposes no projectTeamState/projectSessions'); return }
  const problems = []
  const notes = []
  // Fixture A is session facts ONLY, so the only thing that can move the counter is the kind itself.
  const sessionOnly = [claim(1, SESSION, END_A, 1, NOW), handoff(2, SESSION, END_A, END_B, 2, NOW)]
  const withSessions = a.project(clone(sessionOnly))
  const empty = a.project([])
  const unknownWith = withSessions.counts?.unknown ?? null
  const unknownEmpty = empty.counts?.unknown ?? null
  if (unknownWith !== 0) problems.push('counts.unknown is ' + show(unknownWith) + ' for a ledger carrying only session facts (S4: both kinds are readable)')
  if (unknownEmpty !== 0) problems.push('counts.unknown is ' + show(unknownEmpty) + ' for an empty ledger')
  // Positive control without it "0 stays 0" proves nothing: a kind this build does not read must count.
  const control = a.project([{ seq: 1, channel: 'control', writer: 'w', instance: 'i1', kind: 'probe/unreadable-kind', subject: 'x', payload: { id: 'x' } }])
  const unknownControl = control.counts?.unknown ?? null
  if (unknownControl !== 1) problems.push('the positive control was not counted: counts.unknown is ' + show(unknownControl) + ' for one unreadable kind, expected 1')
  notes.push('session-only unknown ' + show(unknownWith) + ', empty unknown ' + show(unknownEmpty) + ', positive control (one unreadable kind) unknown ' + show(unknownControl))
  console.log('      ' + notes.join(''))
  record(8, problems.length === 0, problems.length === 0 ? 'folding session facts is not an unreadable record, and the counter can still move: ' + notes.join(' | ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 9 the other readings stay put
function checkNine(a) {
  start(9)
  if (!a.project || !a.sessions) { record(9, false, 'the module exposes no projectTeamState/projectSessions'); return }
  const problems = []
  const notes = []
  const sessionFacts = [claim(1, SESSION, END_A, 1, NOW), handoff(2, SESSION, END_A, END_B, 2, NOW)]
  const entityKeys = ['tasks', 'members', 'registry', 'liveness', 'teams', 'peers', 'board', 'locks']
  const bases = [
    ['empty ledger', []],
    ['populated ledger', [member(1, END_A), beat(2, END_A, NOW - 1_000), task(3, 'T1', 'in-progress', END_A), call(4, 'w-1', 'lock/state', 'T1', { task: 'T1', holder: END_A, at: NOW - 1_000, team: TEAM })]],
  ]
  for (const [label, base] of bases) {
    const without = a.project(clone(base))
    const added = a.project(clone([...base, ...sessionFacts]))
    for (const key of entityKeys) {
      const left = JSON.stringify(without[key] ?? null)
      const right = JSON.stringify(added[key] ?? null)
      if (left !== right) problems.push(label + ': ' + key + ' moved when only session facts were added: ' + clip(left, 90) + ' vs ' + clip(right, 90))
    }
    // counts: every field except the record-counting folded (and unknown, which reading 8 owns) must hold.
    const exempt = ['folded', 'unknown']
    for (const key of Object.keys(without.counts ?? {})) {
      if (exempt.includes(key)) continue
      if (show(without.counts[key]) !== show(added.counts[key])) problems.push(label + ': counts.' + key + ' moved: ' + show(without.counts[key]) + ' vs ' + show(added.counts[key]))
    }
    // Positive control for this reading itself: the two sides must really differ in sessions.
    if (JSON.stringify(without.sessions) === JSON.stringify(added.sessions)) problems.push(label + ': the two sides have identical sessions, so the fixture does not carry the session facts this reading is about')
    notes.push(label + ' -> counts ' + clip(show(added.counts), 80) + ' (folded exempt: ' + show(without.counts?.folded) + ' vs ' + show(added.counts?.folded) + ')')
    console.log('      ' + label + ' without: ' + clip(show(Object.fromEntries(entityKeys.map((key) => [key, without[key]]))), 200))
    console.log('      ' + label + ' with   : ' + clip(show(Object.fromEntries(entityKeys.map((key) => [key, added[key]]))), 200))
  }
  console.log('      ' + notes.join('\n      '))
  record(9, problems.length === 0, problems.length === 0 ? 'only sessions moves; every other entity reading is byte-identical' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 10 regression
function checkTen(gates) {
  start(10)
  const problems = []
  const notes = []
  for (const gate of gates) {
    const gatePath = isAbsolute(gate) ? gate : join(PROJECT, 'scripts', gate)
    if (!existsSync(gatePath)) { problems.push(gate + ' is missing'); continue }
    const run = spawnSync(process.execPath, [gatePath], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900_000 })
    const text = ((run.stdout ?? '') + (run.stderr ?? '')).trim()
    if (run.status !== 0) { problems.push(gate + ' exited ' + String(run.status) + ': ' + clip(text.replace(/\s+/g, ' '), 110)); continue }
    const summary = text.match(/(\d+) (?:readings|checks), (\d+) held/)
    const expected = GATE_COUNTS[gate]
    if (expected !== undefined) {
      if (summary === null) problems.push(gate + ' printed no reading count, so ' + expected + ' held cannot be checked')
      else if (Number(summary[2]) !== expected) problems.push(gate + ' held ' + summary[2] + ' of ' + summary[1] + ', expected ' + expected)
      else notes.push(gate.replace('verify-', '').replace('.mjs', '') + ' ' + summary[2] + '/' + summary[1])
    } else notes.push(gate.replace('verify-', '').replace('.mjs', '') + (summary === null ? ' ok' : ' ' + summary[2] + '/' + summary[1]))
  }
  record(10, problems.length === 0, problems.length === 0 ? notes.join(', ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 11 record builders
function checkEleven(a) {
  start(11)
  const problems = []
  const notes = []
  if (a.claim === null || a.handoff === null) { record(11, false, 'the module exposes no sessionClaim/sessionHandoff'); return }
  const shape = (row) => ({ kind: row.kind, subject: typeof row.subject === 'string' && row.subject !== '', payload: row.payload })
  const got = shape(a.claim(SESSION, END_A, 1, NOW))
  const wantClaim = { kind: CLAIM_KIND, subject: true, payload: { session: SESSION, end: END_A, epoch: 1, at: NOW } }
  if (show(got) !== show(wantClaim)) problems.push('sessionClaim(1) is ' + show(got) + ', expected ' + show(wantClaim))
  const gotHandoff = shape(a.handoff(SESSION, END_A, END_B, 2, NOW))
  const wantHandoff = { kind: HANDOFF_KIND, subject: true, payload: { session: SESSION, from: END_A, to: END_B, epoch: 2, at: NOW } }
  if (show(gotHandoff) !== show(wantHandoff)) problems.push('sessionHandoff(2) is ' + show(gotHandoff) + ', expected ' + show(wantHandoff))
  if (Object.keys(a.claim(SESSION, END_A, 1, NOW)).sort().join(',') !== 'kind,payload,subject') problems.push('the claim record carries keys beyond kind/subject/payload: ' + show(Object.keys(a.claim(SESSION, END_A, 1, NOW))))
  const guards = [
    ['claim: session empty', () => a.claim('', END_A, 1, NOW)],
    ['claim: end empty', () => a.claim(SESSION, '', 1, NOW)],
    ['claim: epoch 0', () => a.claim(SESSION, END_A, 0, NOW)],
    ['claim: epoch 1.5', () => a.claim(SESSION, END_A, 1.5, NOW)],
    ['claim: epoch 2^53+2', () => a.claim(SESSION, END_A, Number.MAX_SAFE_INTEGER + 2, NOW)],
    ['claim: epoch NaN', () => a.claim(SESSION, END_A, NaN, NOW)],
    ['claim: at Infinity', () => a.claim(SESSION, END_A, 1, Infinity)],
    ['claim: at NaN', () => a.claim(SESSION, END_A, 1, NaN)],
    ['claim: at a string', () => a.claim(SESSION, END_A, 1, '1800000000000')],
    ['handoff: session empty', () => a.handoff('', END_A, END_B, 2, NOW)],
    ['handoff: from empty', () => a.handoff(SESSION, '', END_B, 2, NOW)],
    ['handoff: to empty', () => a.handoff(SESSION, END_A, '', 2, NOW)],
    ['handoff: epoch 0', () => a.handoff(SESSION, END_A, END_B, 0, NOW)],
    ['handoff: epoch 1.5', () => a.handoff(SESSION, END_A, END_B, 1.5, NOW)],
    ['handoff: epoch NaN', () => a.handoff(SESSION, END_A, END_B, NaN, NOW)],
    ['handoff: at Infinity', () => a.handoff(SESSION, END_A, END_B, 2, Infinity)],
    ['handoff: at NaN', () => a.handoff(SESSION, END_A, END_B, 2, NaN)],
  ]
  const seen = []
  for (const [label, run] of guards) {
    let outcome = 'returned'
    try { run() } catch (error) { outcome = error?.constructor?.name ?? 'an error' }
    if (outcome !== 'TypeError') problems.push(label + ' did not throw TypeError (got ' + outcome + ')')
    seen.push(label.split(': ')[1] + '=' + (outcome === 'TypeError' ? 'TypeError' : outcome))
  }
  notes.push(guards.length + ' illegal-argument cases -> ' + seen.join(', '))
  notes.push('shapes ' + clip(show(got), 70) + ' / ' + clip(show(gotHandoff), 80))
  console.log('      ' + notes.join('\n      '))
  record(11, problems.length === 0, problems.length === 0 ? 'the builders produce the contract shape and refuse every illegal argument with a TypeError' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 12 the audit chain
function checkTwelve(a) {
  start(12)
  if (!guard(12, a)) return
  const problems = []
  const notes = []
  const records = [
    claim(1, SESSION, END_A, 1, NOW),
    claim(2, SESSION, END_B, 2, NOW),
    claim(3, SESSION, END_C, 2, NOW),
    handoff(4, SESSION, END_C, END_D, 3, NOW),
    handoff(5, SESSION, END_B, END_D, 3, NOW),
    claim(6, SESSION, END_B, 3, NOW),
  ]
  const mine = referenceFold(records)
  const state = stateOf(a, arrival(records, [5, 3, 1, 6, 4, 2]))
  compareFold(state, mine, 'the mixed batch', problems, notes)
  const sessionRows = records.filter((row) => row.kind === CLAIM_KIND || row.kind === HANDOFF_KIND)
  const steps = (state.sessions?.steps ?? []).filter((row) => row.session === SESSION)
  const refused = (state.sessions?.refused ?? []).filter((row) => row.session === SESSION)
  if (steps.length + refused.length !== sessionRows.length) problems.push('R5 visibility: ' + sessionRows.length + ' session records but ' + steps.length + ' adopted and ' + refused.length + ' refused — a record was dropped')
  const seqs = (state.sessions?.steps ?? []).map((row) => row.seq)
  if (show(seqs) !== show([...seqs].sort((left, right) => left - right))) problems.push('steps is not in seq order: ' + show(seqs))
  const refusedSeqs = (state.sessions?.refused ?? []).map((row) => row.seq)
  if (show(refusedSeqs) !== show([...refusedSeqs].sort((left, right) => left - right))) problems.push('refused is not in seq order: ' + show(refusedSeqs))
  const chain = a.cont(state, SESSION)
  const wantChain = mine.steps.filter((row) => row.session === SESSION).map(pickStep)
  if (show((chain ?? []).map(pickStep)) !== show(wantChain)) problems.push('continuations is ' + clip(show(chain), 150) + ', expected the adopted chain ' + clip(show(wantChain), 150))
  const owner = a.owner(state, SESSION)
  if (show(pickOwner(owner)) !== show(pickOwner(mine.owners.find((row) => row.session === SESSION)))) problems.push('the author is ' + clip(show(owner), 90) + ', expected ' + clip(show(mine.owners.find((row) => row.session === SESSION)), 90))
  if ((a.cont(state, 'sess-never') ?? []).length !== 0) problems.push('continuations for a session that never existed is not empty')
  notes.push('steps seqs ' + show(seqs) + ', refused ' + show((state.sessions?.refused ?? []).map((row) => row.seq + ':' + row.reason)) + ', continuations ' + show((chain ?? []).map((row) => row.seq)))
  console.log('      ' + notes.join(''))
  record(12, problems.length === 0, problems.length === 0 ? 'no record is lost: every one is either in the chain or visibly refused, in seq order' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 13 malformed first record
function checkThirteen(a) {
  start(13)
  if (!guard(13, a)) return
  const problems = []
  const notes = []
  const first = [claim(1, SESSION, END_A, 0, NOW)]
  const stateFirst = stateOf(a, first)
  if (stateFirst.sessions?.malformed !== 1) problems.push('a first record at epoch 0 counted malformed ' + show(stateFirst.sessions?.malformed) + ', expected 1')
  if (a.owner(stateFirst, SESSION) !== null) problems.push('a first record at epoch 0 became the author: ' + show(a.owner(stateFirst, SESSION)))
  if ((stateFirst.sessions?.steps ?? []).length !== 0) problems.push('a first record at epoch 0 entered steps: ' + show(stateFirst.sessions?.steps))
  const entry = (stateFirst.sessions?.refused ?? []).find((row) => row.seq === 1) ?? null
  if (entry === null || entry.reason !== 'malformed') problems.push('the malformed first record is ' + show(entry?.reason ?? null) + ' in refused, expected malformed (visible, R5 + the reason union)')
  const both = [claim(1, SESSION, END_A, 0, NOW), claim(2, SESSION, END_B, 1, NOW)]
  const stateBoth = stateOf(a, both)
  compareFold(stateBoth, referenceFold(both), 'epoch 0 then epoch 1', problems, notes)
  if (stateBoth.sessions?.malformed !== 1) problems.push('with a following legal claim, malformed is ' + show(stateBoth.sessions?.malformed) + ', expected 1')
  const owner = a.owner(stateBoth, SESSION)
  if (owner === null || owner.end !== END_B || owner.epoch !== 1) problems.push('the author after a malformed first record is ' + clip(show(owner), 90) + ', expected ' + END_B + ' at epoch 1')
  notes.push('epoch 0 alone -> malformed ' + show(stateFirst.sessions?.malformed) + ', author ' + show(a.owner(stateFirst, SESSION)) + ', refused ' + clip(show(pickRefusal(entry)), 80) + '; with a later legal claim -> author ' + clip(show(pickOwner(owner)), 70))
  console.log('      ' + notes.join(''))
  record(13, problems.length === 0, problems.length === 0 ? 'a first record below epoch 1 is counted and visible, never an author' : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- 14 malformed records stay visible
function checkFourteen(a) {
  start(14)
  if (!guard(14, a)) return
  const problems = []
  const notes = []
  // Five unusable records of five different faults, plus one legal claim that must still be adopted.
  // The Lead's ruling (R41): a refused-but-unusable record is VISIBLE in refused, and an address-less
  // one names session null (never the empty string), end null and epoch 0 — the same null != "" rule
  // this family has had since R40 (heldLocks: null is "did not look", [] is "looked, none").
  const records = [
    looseCall(1, CLAIM_KIND, undefined, { epoch: 1, at: NOW }),
    looseCall(2, CLAIM_KIND, '', { session: '', end: END_A, epoch: 1, at: NOW }),
    looseCall(3, CLAIM_KIND, SESSION, { session: SESSION, epoch: 2, at: NOW }),
    looseCall(4, CLAIM_KIND, SESSION, { session: SESSION, end: END_A, epoch: 1.5, at: NOW }),
    looseCall(5, CLAIM_KIND, SESSION, { session: SESSION, end: END_A, epoch: 3 }),
    looseCall(6, HANDOFF_KIND, SESSION, { session: SESSION, to: END_B, epoch: 3, at: NOW }),
    claim(7, SESSION, END_A, 5, NOW),
  ]
  const mine = referenceFold(records)
  const state = stateOf(a, records)
  compareFold(state, mine, 'five unusable records and one claim', problems, notes)
  const refused = state.sessions?.refused ?? []
  const unusable = records.filter((row) => row.seq !== 7)
  if (state.sessions?.malformed !== unusable.length) problems.push('malformed is ' + show(state.sessions?.malformed) + ', expected ' + show(unusable.length) + ' (my own count of unusable records)')
  const namedMalformed = refused.filter((row) => row.reason === 'malformed')
  if (namedMalformed.length !== state.sessions?.malformed) problems.push('the invariant "every malformed record has one refused row" does not hold: ' + namedMalformed.length + ' malformed rows for ' + show(state.sessions?.malformed) + ' malformed records')
  for (const row of namedMalformed) {
    if (row.by !== 'claim' && row.by !== 'handoff') problems.push('a malformed refusal carries by ' + show(row.by) + ', expected claim or handoff')
    if (row.session === '') problems.push('a malformed refusal names the empty string as its session (null is "named none", "" pretends it addressed one)')
  }
  const addressless = namedMalformed.filter((row) => row.session === null)
  if (addressless.length !== 2) problems.push('expected both address-less records (no subject, and subject was the empty string) to name session null, got ' + addressless.length + ' of ' + namedMalformed.length)
  for (const row of addressless) {
    if (row.end !== null) problems.push('an address-less refusal names end ' + show(row.end) + ', expected null')
    if (row.epoch !== 0) problems.push('an address-less refusal names epoch ' + show(row.epoch) + ', expected 0')
    if (row.reason !== 'malformed') problems.push('an address-less refusal says ' + show(row.reason))
  }
  const steps = state.sessions?.steps ?? []
  const refusedSeqs = new Set(refused.map((row) => row.seq))
  for (const row of unusable) {
    if (steps.some((step) => step.seq === row.seq)) problems.push('record ' + row.seq + ' is unusable but entered steps')
    if (!refusedSeqs.has(row.seq)) problems.push('record ' + row.seq + ' is unusable but has no refused row (silently dropped)')
  }
  if (steps.length !== 1 || steps[0]?.seq !== 7) problems.push('the one legal claim was not the only adopted step: ' + show(steps.map((row) => row.seq)))
  const owner = a.owner(state, SESSION)
  if (owner === null || owner.end !== END_A || owner.epoch !== 5) problems.push('the author is ' + clip(show(owner), 80) + ', expected ' + END_A + ' at epoch 5')
  notes.push('malformed ' + show(state.sessions?.malformed) + ', refused rows ' + show(refused.map((row) => row.seq + ':' + (row.session === null ? 'null' : row.session) + ':' + row.reason)) + ', address-less ' + show(addressless.map(pickRefusal)))
  console.log('      ' + notes.join(''))
  record(14, problems.length === 0, problems.length === 0 ? 'no unusable record is silently dropped, and an address-less one says null instead of pretending: ' + notes.join(' | ') : problems.slice(0, 3).join(' | '))
}

// ---------------------------------------------------------------- the run
async function runAll(modulePath, gates) {
  results.length = 0
  const mod = await load(modulePath)
  const a = api(mod)
  if (mod === null) console.log('  (the module at ' + modulePath + ' could not be imported)')
  const sequence = [[1, checkOne], [2, checkTwo], [3, checkThree], [4, checkFour], [5, checkFive], [6, checkSix], [7, checkSeven], [8, checkEight], [9, checkNine], [11, checkEleven], [12, checkTwelve], [13, checkThirteen], [14, checkFourteen]]
  for (const [n, check] of sequence) {
    try { check(a) } catch (error) { console.log(''); console.log('-- ' + n + '. ' + SENTENCES[n]); record(n, false, 'the reading threw instead of answering: ' + clip(String(error?.message ?? error), 140)) }
  }
  if (SKIP_REGRESSION) {
    console.log('')
    console.log('-- 10. NOT RUN: --skip-regression was passed, so the eleven R41 regression gates were not re-run here')
    console.log('   (verify-all.mjs owns that sweep; the default run does execute reading 10)')
  } else {
    checkTen(gates === undefined ? GATES : gates)
  }
  return { failed: results.filter((row) => !row.ok && !row.skip).map((row) => row.n), skipped: results.filter((row) => row.skip).map((row) => row.n) }
}

const MUTATIONS = [
  {
    name: 'the fold decides by arrival order, not by seq',
    declared: [6, 7, 12],
    edits: [{
      find: /(const text = \(value\) => typeof value === "string" && value !== "" \? value : null;\n\s*)for \(const record of \[\.\.\.records\]\.sort\(\(left, right\) => left\.seq - right\.seq\)\) \{/,
      replace: (whole, head) => head + 'for (const record of records) {',
    }],
  },
  {
    name: 'unknown (never heartbeated) counted as dead',
    declared: [4],
    edits: [{
      find: /(find\(\(reading\) => reading\.memberId === memberId\)\?\.liveness )=== "unhealthy"/,
      replace: (whole, head) => head + '!== "healthy"',
    }],
  },
  {
    name: 'a missing timeoutMs is treated as timeoutMs 0 (takeover without the option)',
    declared: [3],
    edits: [{
      find: /const silent = options\.timeoutMs !== void 0 && isQuarantined\(state, held\.end, now, \{ timeoutMs: options\.timeoutMs \}\);/,
      replace: () => 'const silent = isQuarantined(state, held.end, now, { timeoutMs: options.timeoutMs ?? 0 });',
    }],
  },
  {
    name: 'mayWrite drops the owner conjunct (anyone at the held epoch may write)',
    // First run declared [3,5,6] and observed [1,3,5,6]: reading 1 also asks mayWrite for an end that
    // does not own the session, which this mutant turns true. The declaration was wrong, the reading was not.
    declared: [1, 3, 5, 6],
    edits: [{
      find: /(return )held !== null && held\.end === end && held\.epoch === epoch;/,
      replace: (whole, head) => head + 'held !== null && held.epoch === epoch;',
    }],
  },
  {
    name: 'an epoch gap is reported as stale-epoch',
    declared: [5],
    edits: [{ find: /reason: "epoch-gap"/, replace: () => 'reason: "stale-epoch"' }],
  },
  {
    name: 'the two session kinds are unreadable again (READABLE_KINDS)',
    declared: [8],
    edits: [{
      find: /var READABLE_KINDS = \[TASK_KIND, MEMBER_KIND, CAPABILITY_KIND, HEARTBEAT_KIND, TEAM_KIND, PEER_KIND, LOCK_KIND, SESSION_KIND, HANDOFF_KIND\];/,
      replace: () => 'var READABLE_KINDS = [TASK_KIND, MEMBER_KIND, CAPABILITY_KIND, HEARTBEAT_KIND, TEAM_KIND, PEER_KIND, LOCK_KIND];',
    }],
  },
  {
    name: 'session facts leak into the member fold (the fault of reading 9)',
    declared: [9],
    edits: [
      {
        find: /const change = record\.kind === TASK_KIND \|\| record\.kind === MEMBER_KIND \? stateOf\(record\) : null;/,
        replace: () => 'const change = record.kind === TASK_KIND || record.kind === MEMBER_KIND || record.kind === SESSION_KIND || record.kind === HANDOFF_KIND ? stateOf(record) : null;',
      },
      {
        find: /if \(payload === void 0 \|\| typeof payload\.id !== "string" \|\| payload\.id === ""\) return null;/,
        replace: () => 'if (payload === void 0 || typeof payload.id !== "string" || payload.id === "") return typeof payload.session === "string" && payload.session !== "" ? { id: payload.session, team: teamOf(record), state: "open", owner: null, name: null, role: null } : null;',
      },
    ],
  },
  {
    name: 'the sessionClaim epoch guard is dropped',
    declared: [11],
    edits: [{ find: /if \(!Number\.isSafeInteger\(epoch\) \|\| epoch < 1\) throw new TypeError\("sessionClaim: epoch must be a positive safe integer"\);\n\s*/, replace: () => '' }],
  },
  {
    name: 'a first record below epoch 1 is accepted (R3 guard removed)',
    declared: [13],
    edits: [{
      find: /if \(held === null && epoch < 1\) \{\n\s*malformed \+= 1;\n\s*refused\.push\(\{ session, end, epoch, seq: record\.seq, reason: "malformed", by \}\);\n\s*continue;\n\s*\}\n\s*/,
      replace: () => '',
    }],
  },
  {
    name: 'the stale-epoch refusal is dropped (the later record wins)',
    // First run declared [2,6,7,12] and observed [2,5,6,7,12]: reading 5 pins the frozen precedence, so a
    // handoff that does not advance the epoch stops being stale-epoch and becomes epoch-gap. That is the
    // point of asserting both halves; the declaration was wrong, not the reading.
    declared: [2, 5, 6, 7, 12],
    edits: [{
      find: /if \(held !== null && epoch <= held\.epoch\) \{\n\s*refused\.push\(\{ session, end, epoch, seq: record\.seq, reason: "stale-epoch", by \}\);\n\s*continue;\n\s*\}\n\s*/,
      replace: () => '',
    }],
  },
  {
    name: 'no author answers ok:false (the first claim is refused)',
    declared: [1],
    edits: [{
      find: /if \(held === null\) return \{ ok: true, reason: "none", owner: null, epoch: null \};/,
      replace: () => 'if (held === null) return { ok: false, reason: "none", owner: null, epoch: null };',
    }],
  },
  {
    name: 'an unusable record is counted but not refused (silently dropped)',
    declared: [14],
    edits: [{
      find: /(const usable = [^\n]*;\n\s*if \(!usable\) \{\n\s*malformed \+= 1;\n\s*)refused\.push\([^\n]*\);\n(\s*continue;\n\s*\}\n\s*)/,
      replace: (whole, head, tail) => head + tail,
    }],
  },
]

async function selfAttack() {
  const tmp = mkdtempSync(join(tmpdir(), 'r41-attack-'))
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
        // A mutant whose anchor no longer exists in the build product is a gate failure, not a pass:
        // that is exactly how a refactor used to turn a mutant into NOT APPLICABLE (R40).
        notApplicable += 1
        lines.push('  ' + id + ' ' + mutation.name + ' -> ANCHOR NOT FOUND in lib/index.js (' + clip(dead ?? 'the edit was a no-op', 90) + ')')
        continue
      }
      applied += 1
      anchors.push('  ' + mutation.name + ' -> ' + clip(anchor.replace(/\s+/g, ' '), 150))
      const copy = join(tmp, 'mutant-' + String(applied) + '.mjs')
      writeFileSync(copy, text)
      const seen = await runAll(copy, [failing])
      const declared = mutation.declared.slice().sort((left, right) => left - right)
      const observed = seen.failed.filter((n) => n !== 10).sort((left, right) => left - right)
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
      console.log('  ' + n + ': ' + (n === 10 ? 'regression probe (synthetic failing gate)' : (claimants.join(', ') || 'UNCOVERED')))
    }
    const uncovered = READINGS.filter((n) => n !== 10 && rows.every((row) => !row.declared.includes(n)))
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
