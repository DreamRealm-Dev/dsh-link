#!/usr/bin/env node
/**
 * R53 deliverable A: the cross-device team-dispatch gate.
 *
 * Written from .tmp/R53-contract.md (A1-A5 plus the rev1.2 frozen surface) by an author who did
 * not write the producer's code and does not import its harness. Every expected value below is a
 * literal taken from the contract; nothing is read back out of the artifact to decide the answer.
 *
 * What it reads: the SHIPPED artifact plugins/dsh-link-collab/lib/index.js only. It never reads
 * src/, never rebuilds, never writes under plugins/. A symbol the artifact does not export is a
 * FAILED reading (blocked, with the reason), never a silent skip: the coverage matrix fails when
 * any declared reading produced no verdict.
 *
 * Anchors come from the shipped artifact: the contract's reuse forms must resolve (they ship
 * today) and the rev1.2 exports must be present. A missing anchor fails the gate by design.
 *
 * Readings: R1 frozen exports, R2 reuse anchors + artifact digest, R3 normal round trip,
 * R4 unknown-id, R5 wrong-writer, R6 duplicate-result, R7 duplicate-id, R8 unknown-tool + no
 * write, R9 capability-mismatch (with its positive control), R10 order independence, R11 two real
 * child processes + reopen + relay receive, R12 route-down/member-silent, R13 appendResult writes
 * only when allowed.
 *
 * Usage:
 *   node scripts/verify-collab-team-dispatch.mjs                 run the readings
 *   node scripts/verify-collab-team-dispatch.mjs --json          also print the verdict map
 *   node scripts/verify-collab-team-dispatch.mjs --self-attack   arm one defect; require that
 *                                                               exactly the declared readings flip
 * Exit: 0 every reading held; 1 a reading failed; 2 the artifact is missing.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(SELF), '..')
const ARTIFACT = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const ATTACK = process.argv.includes('--self-attack')
const JSON_OUT = process.argv.includes('--json')

// ------------------------------------------------------------------ child mode (real process)
const childAt = process.argv.indexOf('--child')
if (childAt !== -1) {
  const role = process.argv[childAt + 1]
  const dir = process.argv[process.argv.indexOf('--dir') + 1]
  const mod = await import(pathToFileURL(ARTIFACT).href)
  const log = mod.openControlLog({ dir, writer: role })
  const at = Number(process.env.R53_CHILD_AT || '1000')
  const fact = role === 'a'
    ? { kind: 'task/dispatch', subject: 'job-1', at, payload: { id: 'job-1', to: 'b', tool: 'echo', args: { text: 'hi' }, at } }
    : { kind: 'task/result', subject: 'job-1', at: at + 1, payload: { id: 'job-1', from: 'b', ok: true, value: { echo: 'hi' }, at: at + 1 } }
  // R53_ATTACK=1 is the armed defect: the worker never answers, so exactly the readings that
  // depend on this append are the ones declared in ATTACK_READINGS.
  if (!(role === 'b' && process.env.R53_ATTACK === '1')) await log.append(fact)
  await log.close()
  console.log('R53-CHILD ' + role + ' pid=' + String(process.pid))
  process.exit(0)
}

// ------------------------------------------------------------------ declarations
/** rev1.2 frozen exports: every one of these is required. */
const FROZEN = ['DISPATCH_KIND', 'RESULT_KIND', 'dispatchRecord', 'resultRecord', 'projectDispatches',
  'resolveDispatch', 'acceptResult', 'appendResult', 'createLocalTools', 'executeDispatches']
/** Forms the contract says to reuse; they are anchors because they ship today. */
const REUSED = ['openControlLog', 'foldClaim', 'projectTeamState', 'capabilityRecord', 'livenessOf', 'routes']
/** Judgement spellings frozen across A2/A3/A4 and rev1.2, kept here so the closure is one list. */
const VERDICTS = ['unknown-id', 'refused', 'pending', 'answered', 'unknown-tool', 'capability-mismatch',
  'wrong-writer', 'duplicate-result', 'duplicate-id', 'route-down', 'member-silent']
const DISPATCH_REFUSALS = ['duplicate-id', 'capability-mismatch']
// rev1.3 adds one word to the result-refusal closure: an answer whose dispatch the projection
// already refused is refused-dispatch, not unknown-id and not wrong-writer.
const RESULT_REFUSALS = ['unknown-id', 'wrong-writer', 'duplicate-result', 'refused-dispatch']
const STATUSES = ['pending', 'answered', 'refused']
const ACCEPT_REASONS = ['accepted', 'unknown-id', 'wrong-writer', 'duplicate-result', 'refused-dispatch']
const RESOLVE_VERDICTS = ['unknown-id', 'refused', 'pending', 'answered']
/** The readings the armed defect must move - and the only ones it may move. */
const DECLARED = [
  { id: 'R1', kind: 'anchor', needs: [], attack: false },
  { id: 'R2', kind: 'anchor', needs: REUSED, attack: false },
  { id: 'R3', kind: 'fold', needs: ['dispatchRecord', 'resultRecord', 'projectDispatches', 'resolveDispatch', 'acceptResult'], attack: false },
  { id: 'R4', kind: 'fold', needs: ['resultRecord', 'projectDispatches', 'acceptResult'], attack: false },
  { id: 'R5', kind: 'fold', needs: ['dispatchRecord', 'resultRecord', 'projectDispatches', 'acceptResult'], attack: false },
  { id: 'R6', kind: 'fold', needs: ['dispatchRecord', 'resultRecord', 'projectDispatches', 'acceptResult'], attack: false },
  { id: 'R7', kind: 'fold', needs: ['dispatchRecord', 'projectDispatches'], attack: false },
  { id: 'R8', kind: 'execute', needs: ['createLocalTools', 'executeDispatches', 'projectTeamState', 'openControlLog'], attack: false },
  { id: 'R9', kind: 'fold', needs: ['dispatchRecord', 'capabilityRecord', 'projectDispatches'], attack: false },
  { id: 'R10', kind: 'fold', needs: ['dispatchRecord', 'resultRecord', 'projectDispatches'], attack: false },
  // The process reading is deliberately independent of the R53 symbols: the children write the
  // contract's frozen kind literals through the shipped openControlLog, so this reading is a real
  // two-process reading even before the producer lands - and it keeps measuring the same path after.
  { id: 'R11', kind: 'process', needs: ['openControlLog'], attack: true },
  { id: 'R12', kind: 'route', needs: ['dispatchRecord', 'capabilityRecord', 'resolveDispatch', 'assignThrough', 'hostRecord', 'projectTeamState'], attack: false },
  { id: 'R13', kind: 'execute', needs: ['acceptResult', 'appendResult', 'openControlLog', 'projectTeamState', 'resultRecord'], attack: false },
  { id: 'R14', kind: 'conformance', needs: ['dispatchRecord', 'resultRecord', 'capabilityRecord', 'projectDispatches', 'resolveDispatch', 'acceptResult'], attack: false },
  { id: 'R16', kind: 'conformance', needs: ['dispatchRecord', 'resultRecord', 'capabilityRecord', 'projectDispatches'], attack: false },
  { id: 'R15', kind: 'conformance', needs: ['dispatchRecord', 'resultRecord', 'capabilityRecord', 'projectDispatches', 'resolveDispatch', 'acceptResult', 'appendResult', 'createLocalTools', 'executeDispatches', 'openControlLog', 'projectTeamState'], attack: false },
]
const ATTACK_READINGS = DECLARED.filter((row) => row.attack).map((row) => row.id).sort()

if (!existsSync(ARTIFACT)) {
  console.error('no artifact at ' + ARTIFACT + ' - build it first; this gate never builds')
  process.exit(2)
}
const bytes = readFileSync(ARTIFACT)
const sha = createHash('sha256').update(bytes).digest('hex')
const exportList = (() => {
  const text = bytes.toString('utf8')
  const at = text.lastIndexOf('export {')
  if (at === -1) return new Set()
  const block = text.slice(at, text.indexOf('}', at) + 1)
  return new Set(block.replace('export {', '').replace('}', '').split(',')
    .map((name) => name.trim().split(/\s+as\s+/).pop()).filter((name) => name !== ''))
})()
const mod = await import(pathToFileURL(ARTIFACT).href)

const verdicts = new Map()
const record = (id, ok, detail) => {
  const row = DECLARED.find((entry) => entry.id === id)
  verdicts.set(id, { id, ok, detail, kind: row ? row.kind : '?' })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + id + ' [' + (row ? row.kind : '?') + '] ' + detail)
}
/** One reading: a missing symbol becomes a named failure, never a skip. */
const evaluate = async (id, fn) => {
  const row = DECLARED.find((entry) => entry.id === id)
  const missing = (row ? row.needs : []).filter((name) => typeof mod[name] === 'undefined')
  if (missing.length > 0) { record(id, false, 'blocked: the artifact does not export ' + missing.join(', ')); return }
  try { await fn() } catch (error) { record(id, false, 'threw: ' + String(error && error.message ? error.message : error)) }
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
/** A temporary directory per reading that needs a real ledger. */
const tempDir = () => mkdtempSync(join(tmpdir(), 'r53-gate-'))
// rev1.2 4: capability is the projection's authoritative call, so every fixture that expects a
// pending/answered entry must carry the target member's capability record first.
  const declaredB = (capabilities, seq) => ({ seq, channel: 'control', at: seq, actor: 'b', ...mod.capabilityRecord('b', capabilities) })

// ------------------------------------------------------------------ R1 / R2 anchors
await evaluate('R1', () => {
  const missing = FROZEN.filter((name) => !exportList.has(name))
  record('R1', missing.length === 0, missing.length === 0
    ? 'all ' + String(FROZEN.length) + ' frozen exports ship in the artifact'
    : 'missing from the artifact export list: ' + missing.join(', ') + ' (sha256 ' + sha.slice(0, 12) + ')')
})
await evaluate('R2', () => {
  const missing = REUSED.filter((name) => typeof mod[name] === 'undefined')
  record('R2', missing.length === 0, missing.length === 0
    ? 'anchors resolve from the artifact (sha256 ' + sha.slice(0, 12) + '); judgement closure ' + String(VERDICTS.length) + ' words'
    : 'anchor exports missing: ' + missing.join(', '))
})

// ------------------------------------------------------------------ R3 normal round trip
await evaluate('R3', async () => {
  const dispatch = mod.dispatchRecord('job-1', 'b', 'echo', { text: 'hi' }, 100)
  const result = mod.resultRecord('job-1', 'b', { ok: true, value: { echo: 'hi' } }, 101)
  const records = [declaredB(['echo'], 0), { seq: 1, channel: 'control', at: 100, ...dispatch }, { seq: 2, channel: 'control', at: 101, ...result }]
  const folded = mod.projectDispatches(records)
  const state = mod.projectTeamState(records)
  const resolved = mod.resolveDispatch(state, 'job-1', 200)
  const beforeAdoption = mod.projectTeamState([declaredB(['echo'], 0), { seq: 3, channel: 'control', at: 100, ...dispatch }])
  const accepted = mod.acceptResult(beforeAdoption, result)
  const entry = folded.dispatches[0]
  const ok = folded.dispatches.length === 1 && entry.status === 'answered' && entry.result !== null
    && folded.results.length === 1 && folded.pending.length === 0
    && resolved.verdict === 'answered' && accepted.accepted === true && accepted.reason === 'accepted'
  record('R3', ok, 'status=' + String(entry.status) + ' resolve=' + String(resolved.verdict) + ' accept=' + String(accepted.reason)
    + ' dispatches=' + String(folded.counts.dispatches) + ' results=' + String(folded.counts.results))
})

// ------------------------------------------------------------------ R4 result with no dispatch
await evaluate('R4', async () => {
  const orphan = mod.resultRecord('job-9', 'b', { ok: true, value: 1 }, 101)
  const records = [{ seq: 1, channel: 'control', at: 101, ...orphan }]
  const folded = mod.projectDispatches(records)
  const answer = mod.acceptResult(mod.projectTeamState(records), orphan)
  const refused = folded.refusedResults[0]
  record('R4', answer.reason === 'unknown-id' && answer.accepted === false && folded.results.length === 0
    && folded.refusedResults.length === 1 && refused.reason === 'unknown-id',
    'acceptResult=' + JSON.stringify(answer) + ' results=' + String(folded.results.length) + ' refusedResults=' + JSON.stringify(folded.refusedResults))
})

// ------------------------------------------------------------------ R5 wrong writer
await evaluate('R5', async () => {
  const dispatch = mod.dispatchRecord('job-1', 'b', 'echo', {}, 100)
  const stranger = mod.resultRecord('job-1', 'c', { ok: true, value: 1 }, 101)
  const records = [declaredB(['echo'], 0), { seq: 1, channel: 'control', at: 100, ...dispatch }, { seq: 2, channel: 'control', at: 101, ...stranger }]
  const folded = mod.projectDispatches(records)
  const answer = mod.acceptResult(mod.projectTeamState(records), stranger)
  record('R5', answer.reason === 'wrong-writer' && folded.dispatches[0].status === 'pending'
    && folded.refusedResults.length === 1 && folded.refusedResults[0].reason === 'wrong-writer',
    'acceptResult=' + answer.reason + ' status=' + String(folded.dispatches[0].status) + ' refusedResults=' + JSON.stringify(folded.refusedResults))
})

// ------------------------------------------------------------------ R6 duplicate result keeps the first value
await evaluate('R6', async () => {
  const dispatch = mod.dispatchRecord('job-1', 'b', 'echo', {}, 100)
  const first = mod.resultRecord('job-1', 'b', { ok: true, value: 'first' }, 101)
  const second = mod.resultRecord('job-1', 'b', { ok: true, value: 'second' }, 102)
  const records = [declaredB(['echo'], 0), { seq: 1, channel: 'control', at: 100, ...dispatch }, { seq: 2, channel: 'control', at: 101, ...first }, { seq: 3, channel: 'control', at: 102, ...second }]
  const folded = mod.projectDispatches(records)
  const answer = mod.acceptResult(mod.projectTeamState(records), second)
  const kept = folded.dispatches[0].result
  record('R6', answer.reason === 'duplicate-result' && folded.results.length === 1 && same(kept && kept.value, 'first')
    && folded.refusedResults.length === 1 && folded.refusedResults[0].reason === 'duplicate-result',
    'acceptResult=' + answer.reason + ' results=' + String(folded.results.length) + ' keptValue=' + JSON.stringify(kept && kept.value) + ' refusedResults=' + JSON.stringify(folded.refusedResults))
})

// ------------------------------------------------------------------ R7 duplicate dispatch id
await evaluate('R7', async () => {
  const first = mod.dispatchRecord('job-1', 'b', 'echo', { text: 'first' }, 100)
  const second = mod.dispatchRecord('job-1', 'b', 'other', { text: 'second' }, 101)
  const records = [declaredB(['echo'], 0), { seq: 1, channel: 'control', at: 100, ...first }, { seq: 2, channel: 'control', at: 101, ...second }]
  const folded = mod.projectDispatches(records)
  const entry = folded.dispatches[0]
  record('R7', folded.dispatches.length === 1 && entry.tool === 'echo' && same(entry.args, { text: 'first' })
    && folded.refusedDispatches.length === 1 && folded.refusedDispatches[0].reason === 'duplicate-id',
    'dispatches=' + String(folded.dispatches.length) + ' keptTool=' + String(entry && entry.tool) + ' refusedDispatches=' + JSON.stringify(folded.refusedDispatches))
})

// ------------------------------------------------------------------ R9 capability is the projection's call
await evaluate('R9', async () => {
  const dispatch = mod.dispatchRecord('job-1', 'b', 'echo', {}, 100)
  const bare = [{ seq: 1, channel: 'control', at: 100, actor: 'b', ...dispatch }]
  const declared = [{ seq: 1, channel: 'control', at: 100, actor: 'b', ...dispatch },
    { seq: 2, channel: 'control', at: 101, actor: 'b', ...mod.capabilityRecord('b', ['echo']) }]
  const refusedFold = mod.projectDispatches(bare)
  const okFold = mod.projectDispatches(declared)
  record('R9', refusedFold.dispatches[0].status === 'refused' && refusedFold.refusedDispatches.length === 1
    && refusedFold.refusedDispatches[0].reason === 'capability-mismatch' && okFold.dispatches[0].status === 'pending',
    'without capability: status=' + String(refusedFold.dispatches[0].status) + ' refused=' + JSON.stringify(refusedFold.refusedDispatches)
    + ' ; with capability: status=' + String(okFold.dispatches[0].status))
})

// ------------------------------------------------------------------ R10 order independence
await evaluate('R10', async () => {
  const dispatch = mod.dispatchRecord('job-1', 'b', 'echo', {}, 100)
  const result = mod.resultRecord('job-1', 'b', { ok: true, value: 1 }, 101)
  const refusal = mod.resultRecord('job-8', 'b', { ok: false, error: 'nope' }, 102)
  const records = [declaredB(['echo'], 0),
    { seq: 1, channel: 'control', at: 100, actor: 'b', ...dispatch },
    { seq: 2, channel: 'control', at: 101, actor: 'b', ...result },
    { seq: 3, channel: 'control', at: 102, actor: 'b', ...refusal }]
  const forward = mod.projectDispatches(records)
  // Same seq SET, different array order: the whole array is reversed, capability record included.
  const backward = mod.projectDispatches([...records].reverse())
  const keys = ['dispatches', 'results', 'pending', 'refusedDispatches', 'refusedResults', 'counts']
  const differ = keys.filter((key) => !same(forward[key], backward[key]))
  record('R10', differ.length === 0 && forward.results.length === 1 && forward.refusedResults.length === 1, differ.length === 0
    ? 'forward and reversed fold byte-identical on all six outputs (adopted=' + String(forward.results.length) + ' refused=' + String(forward.refusedResults.length) + ', so the comparison is not vacuous)'
    : 'these outputs differ between arrival orders: ' + differ.join(', '))
})

// ------------------------------------------------------------------ R8 local tools + no write when refused
await evaluate('R8', async () => {
  const dir = tempDir()
  const log = mod.openControlLog({ dir, writer: 'b' })
  const local = mod.createLocalTools()
  const missing = local.invoke('nope', {})
  const ghost = mod.dispatchRecord('job-2', 'b', 'ghost', {}, 100)
  const boom = mod.dispatchRecord('job-3', 'b', 'boom', {}, 101)
  const state = mod.projectTeamState([declaredB(['ghost', 'boom'], 0),
    { seq: 1, channel: 'control', at: 100, actor: 'b', ...ghost },
    { seq: 2, channel: 'control', at: 101, actor: 'b', ...boom }])
  const dispose = local.register('boom', () => { throw new Error('handler exploded') })
  const threw = local.invoke('boom', {})
  const before = log.replay().length
  const run = await mod.executeDispatches(state, { local: 'b', tools: local, log, now: 200, at: 200 })
  const after = log.replay().length
  dispose()
  const written = log.replay()
  const last = written[written.length - 1]
  const refused = JSON.stringify(run.refused)
  const ok = missing.ok === false && missing.error === 'unknown-tool' && threw.ok === false && threw.error === 'handler exploded'
    && refused.includes('unknown-tool') && after - before === 1
    && last !== undefined && last.payload !== undefined && last.payload.ok === false && last.payload.error === 'handler exploded'
  await log.close()
  rmSync(dir, { recursive: true, force: true })
  record('R8', ok, 'invoke(unknown)=' + JSON.stringify(missing) + ' invoke(throwing)=' + JSON.stringify(threw)
    + ' executed=' + String(run.executed.length) + ' refused=' + refused + ' ledger ' + String(before) + '->' + String(after))
})

// ------------------------------------------------------------------ R13 appendResult writes only when allowed
await evaluate('R13', async () => {
  const dir = tempDir()
  const log = mod.openControlLog({ dir, writer: 'b' })
  const dispatch = mod.dispatchRecord('job-3', 'b', 'echo', {}, 100)
  const state = mod.projectTeamState([declaredB(['echo'], 0), { seq: 1, channel: 'control', at: 100, actor: 'b', ...dispatch }])
  const stranger = mod.resultRecord('job-3', 'c', { ok: true, value: 1 }, 101)
  const refusal = await mod.appendResult(state, log, stranger)
  const afterRefusal = log.replay().length
  const good = mod.resultRecord('job-3', 'b', { ok: true, value: 7 }, 102)
  const write = await mod.appendResult(state, log, good)
  const afterWrite = log.replay().length
  await log.close()
  rmSync(dir, { recursive: true, force: true })
  record('R13', afterRefusal === 0 && afterWrite === 1 && write.appended === true,
    'refused write: appended=' + String(refusal.appended) + ' reason=' + String(refusal.reason) + ' ledger=' + String(afterRefusal)
    + ' ; allowed write: appended=' + String(write.appended) + ' ledger=' + String(afterWrite) + ' keys=' + JSON.stringify(Object.keys(write)))
})

// ------------------------------------------------------------------ R12 silent member must be judgeable
await evaluate('R12', async () => {
  // rev1.4: A4 is a PAIR of readings. 'no answer yet' (resolveDispatch) and 'cannot be reached
  // right now' (assignThrough, the already-shipped R44 symbol) are different questions; putting
  // route-down inside resolveDispatch would give one question two answer sources.
  const TEAM = 'team-r53', LOCAL = 'end-A', END_B = 'end-B', NOW = 1800000000000, TIMEOUT = 60000
  // Every record is the contract builder's own object, spread into the envelope: wrapping it in
  // another payload layer is the mistake this replaces (it reads as payload.payload and the fold
  // correctly sees no id at all).
  const built = (seq, record) => ({ seq, channel: 'control', at: NOW - 1000, actor: TEAM, ...record })
  const memberFact = (seq, id) => ({ seq, channel: 'control', at: NOW - 1000, actor: TEAM, subject: id, kind: 'member/state', payload: { id, name: id, state: 'active', role: 'member' } })
  const beatFact = (seq, id, at) => ({ seq, channel: 'control', at, actor: TEAM, subject: id, kind: 'member/heartbeat', payload: { id, at } })
  const alive = [
    built(0, mod.dispatchRecord('job-1', 'm-live', 'echo', {}, NOW - 500)),
    built(1, mod.capabilityRecord('m-live', ['echo'])),
    built(2, mod.hostRecord('m-b', END_B, LOCAL, NOW - 1000)),
    memberFact(3, 'm-b'),
    beatFact(4, 'm-b', NOW - 1000),
    built(5, mod.hostRecord('m-live', END_B, LOCAL, NOW - 1000)),
    memberFact(6, 'm-live'),
    beatFact(7, 'm-live', NOW - 1000),
  ]
  // The transit member m-b stops beating: the hop is dead while the target member is still fine.
  const stopped = alive.map((row) => (row.kind === 'member/heartbeat' && row.subject === 'm-b'
    ? beatFact(row.seq, 'm-b', NOW - 5 * TIMEOUT) : row))
  const okState = mod.projectTeamState(alive)
  const deadState = mod.projectTeamState(stopped)
  const noAnswerYet = mod.resolveDispatch(okState, 'job-1', NOW)
  const stillNoAnswer = mod.resolveDispatch(deadState, 'job-1', NOW)
  const reachable = mod.assignThrough(okState, TEAM, 'm-live', LOCAL, NOW, { timeoutMs: TIMEOUT })
  const unreachable = mod.assignThrough(deadState, TEAM, 'm-live', LOCAL, NOW, { timeoutMs: TIMEOUT })
  const allowed = ['route-down', 'member-silent']
  const ok = noAnswerYet.verdict === 'pending' && stillNoAnswer.verdict === 'pending'
    && reachable.ok === true && unreachable.ok === false && allowed.includes(unreachable.reason)
  record('R12', ok, 'resolveDispatch pending now=' + String(noAnswerYet.verdict) + ' after-stop=' + String(stillNoAnswer.verdict)
    + ' ; assignThrough alive=' + String(reachable.ok) + '/' + String(reachable.reason) + ' after-stop=' + String(unreachable.ok) + '/' + String(unreachable.reason))
})

// ------------------------------------------------------------------ R14 judgement closure (rev1.3)
await evaluate('R14', async () => {
  const records = [declaredB(['echo'], 0),
    { seq: 1, channel: 'control', at: 100, actor: 'b', ...mod.dispatchRecord('job-1', 'b', 'echo', {}, 100) },
    { seq: 2, channel: 'control', at: 101, actor: 'b', ...mod.dispatchRecord('job-1', 'b', 'other', {}, 101) },
    { seq: 3, channel: 'control', at: 102, actor: 'b', ...mod.dispatchRecord('job-2', 'b', 'missing-tool', {}, 102) },
    { seq: 4, channel: 'control', at: 103, actor: 'b', ...mod.resultRecord('job-1', 'b', { ok: true, value: 1 }, 103) },
    { seq: 5, channel: 'control', at: 104, actor: 'b', ...mod.resultRecord('job-1', 'b', { ok: true, value: 2 }, 104) },
    { seq: 6, channel: 'control', at: 105, actor: 'b', ...mod.resultRecord('job-9', 'b', { ok: true, value: 3 }, 105) },
    { seq: 7, channel: 'control', at: 106, actor: 'b', ...mod.resultRecord('job-2', 'b', { ok: true, value: 4 }, 106) }]
  const folded = mod.projectDispatches(records)
  const state = mod.projectTeamState(records)
  const wrongWriter = mod.acceptResult(state, mod.resultRecord('job-1', 'c', { ok: true, value: 5 }, 107))
  const unknownId = mod.acceptResult(state, mod.resultRecord('job-9', 'b', { ok: true, value: 6 }, 108))
  const refusedDispatch = mod.acceptResult(state, mod.resultRecord('job-2', 'b', { ok: true, value: 7 }, 109))
  const statuses = [...new Set(folded.dispatches.map((row) => row.status))]
  const dispatchReasons = [...new Set(folded.refusedDispatches.map((row) => row.reason))]
  const resultReasons = [...new Set(folded.refusedResults.map((row) => row.reason))]
  const accepts = [wrongWriter.reason, unknownId.reason, refusedDispatch.reason]
  const resolved = ['job-1', 'job-2', 'job-9'].map((id) => mod.resolveDispatch(state, id, 200).verdict)
  const outside = { status: statuses.filter((w) => !STATUSES.includes(w)),
    refusedDispatches: dispatchReasons.filter((w) => !DISPATCH_REFUSALS.includes(w)),
    refusedResults: resultReasons.filter((w) => !RESULT_REFUSALS.includes(w)),
    acceptResult: accepts.filter((w) => !ACCEPT_REASONS.includes(w)),
    resolveDispatch: resolved.filter((w) => !RESOLVE_VERDICTS.includes(w)) }
  const outsiders = Object.values(outside).flat()
  record('R14', outsiders.length === 0, outsiders.length === 0
    ? 'every judgement word is inside the frozen closure: ' + JSON.stringify({ statuses, dispatchReasons, resultReasons, accepts, resolved })
    : 'judgement words outside the contract closure: ' + JSON.stringify(outside))
})

// ------------------------------------------------------------------ R15 declared shapes
await evaluate('R15', async () => {
  const keysOf = (value) => Object.keys(value === null || value === undefined ? {} : value).sort()
  // The contract spells the required fields; extra fields are reported, not failed.
  const carries = (value, want) => want.filter((key) => !keysOf(value).includes(key))
  const extras = (value, want) => keysOf(value).filter((key) => !want.includes(key))
  const dir = tempDir()
  const log = mod.openControlLog({ dir, writer: 'b' })
  const records = [declaredB(['echo'], 0), { seq: 1, channel: 'control', at: 100, actor: 'b', ...mod.dispatchRecord('job-1', 'b', 'echo', {}, 100) }]
  const folded = mod.projectDispatches(records)
  const state = mod.projectTeamState(records)
  const write = await mod.appendResult(state, log, mod.resultRecord('job-1', 'b', { ok: true, value: 1 }, 101))
  // One fixture that produces an adopted result, a refused dispatch and a refused result.
  const dupFold = mod.projectDispatches([declaredB(['echo'], 0),
    { seq: 1, channel: 'control', at: 100, actor: 'b', ...mod.dispatchRecord('job-1', 'b', 'echo', {}, 100) },
    { seq: 2, channel: 'control', at: 101, actor: 'b', ...mod.dispatchRecord('job-1', 'b', 'other', {}, 101) },
    { seq: 3, channel: 'control', at: 102, actor: 'b', ...mod.resultRecord('job-1', 'b', { ok: true, value: 1 }, 102) },
    { seq: 4, channel: 'control', at: 103, actor: 'b', ...mod.resultRecord('job-9', 'b', { ok: true, value: 2 }, 103) }])
  const local = mod.createLocalTools()
  const run = await mod.executeDispatches(state, { local: 'c', tools: local, log, now: 200, at: 200 })
  await log.close()
  rmSync(dir, { recursive: true, force: true })
  // rev1.4: appendResult returns {appended, reason, seq}; every row type carries seq.
  const shapes = [
    ['appendResult', write, ['appended', 'reason', 'seq']],
    ['resolveDispatch', mod.resolveDispatch(state, 'job-1', 200), ['id', 'verdict']],
    ['acceptResult', mod.acceptResult(state, mod.resultRecord('job-1', 'b', { ok: true, value: 1 }, 101)), ['id', 'accepted', 'reason']],
    ['projectDispatches', folded, ['dispatches', 'results', 'pending', 'refusedDispatches', 'refusedResults', 'counts']],
    ['counts', folded.counts, ['dispatches', 'results', 'pending', 'refusedDispatches', 'refusedResults']],
    ['canonical entry', folded.dispatches[0], ['id', 'to', 'tool', 'args', 'at', 'status', 'result', 'seq']],
    ['refusedDispatch', dupFold.refusedDispatches[0], ['id', 'at', 'reason', 'seq']],
    ['refusedResult', dupFold.refusedResults[0], ['id', 'from', 'at', 'reason', 'seq']],
    ['adopted result', dupFold.results[0], ['id', 'from', 'ok', 'at', 'seq']],
    ['executeDispatches', run, ['executed', 'refused']],
    ['createLocalTools', local, ['register', 'has', 'invoke']],
  ]
  const missingFields = shapes.map(([name, value, want]) => [name, carries(value, want)]).filter(([, missing]) => missing.length > 0)
  const extraFields = shapes.map(([name, value, want]) => name + ':' + JSON.stringify(extras(value, want))).filter((row) => !row.endsWith('[]'))
  record('R15', missingFields.length === 0, missingFields.length === 0
    ? 'every declared return shape carries the fields the contract names (extras reported: ' + extraFields.join(' ') + ')'
    : 'declared fields the artifact does not return: ' + JSON.stringify(missingFields))
})

// ------------------------------------------------------------------ R16 ordering (rev1.4)
await evaluate('R16', async () => {
  // rev1.4: dispatches/results/pending are ordered by id; the two refusal lists are ordered by seq.
  const fact = (seq, record, at) => ({ seq, channel: 'control', at, actor: 'b', ...record })
  const records = [declaredB(['echo'], 0),
    fact(1, mod.dispatchRecord('job-b', 'b', 'echo', {}, 100), 100),
    fact(2, mod.dispatchRecord('job-a', 'b', 'echo', {}, 101), 101),
    fact(3, mod.dispatchRecord('job-a', 'b', 'other', {}, 102), 102),
    fact(4, mod.resultRecord('job-b', 'b', { ok: true, value: 1 }, 103), 103),
    fact(5, mod.resultRecord('job-zz', 'b', { ok: true, value: 2 }, 104), 104),
    fact(6, mod.resultRecord('job-aa', 'b', { ok: true, value: 3 }, 105), 105)]
  const folded = mod.projectDispatches(records)
  const ascending = (rows, key) => rows.every((row, index) => index === 0 || key(rows[index - 1]) <= key(row))
  const problems = []
  if (!ascending(folded.dispatches, (row) => row.id)) problems.push('dispatches is not id-ascending: ' + JSON.stringify(folded.dispatches.map((row) => row.id)))
  if (!ascending(folded.results, (row) => row.id)) problems.push('results is not id-ascending: ' + JSON.stringify(folded.results.map((row) => row.id)))
  if (!ascending(folded.pending, (row) => row)) problems.push('pending is not id-ascending: ' + JSON.stringify(folded.pending))
  if (!ascending(folded.refusedDispatches, (row) => row.seq)) problems.push('refusedDispatches is not seq-ascending: ' + JSON.stringify(folded.refusedDispatches.map((row) => row.seq)))
  if (!ascending(folded.refusedResults, (row) => row.seq)) problems.push('refusedResults is not seq-ascending: ' + JSON.stringify(folded.refusedResults.map((row) => row.seq)))
  record('R16', problems.length === 0, problems.length === 0
    ? 'orders match rev1.4: ' + JSON.stringify({ dispatches: folded.dispatches.map((row) => row.id), results: folded.results.map((row) => row.id), pending: folded.pending, refusedDispatches: folded.refusedDispatches.map((row) => row.seq), refusedResults: folded.refusedResults.map((row) => row.seq) })
    : 'order problems: ' + JSON.stringify(problems))
})

// ------------------------------------------------------------------ R11 two real child processes
await evaluate('R11', async () => {
  const dirA = tempDir()
  const dirB = tempDir()
  const env = { ...process.env, ...(ATTACK ? { R53_ATTACK: '1' } : {}) }
  const runChild = (role, dir) => spawnSync(process.execPath, [SELF, '--child', role, '--dir', dir], { encoding: 'utf8', env, timeout: 60000 })
  const a = runChild('a', dirA)
  const b = runChild('b', dirB)
  const markA = /R53-CHILD a pid=(\d+)/.exec(a.stdout || '')
  const markB = /R53-CHILD b pid=(\d+)/.exec(b.stdout || '')
  const distinct = markA !== null && markB !== null && markA[1] !== markB[1]
  // Both children have exited; the parent reopens their logs: external persistence, read again.
  const logA = mod.openControlLog({ dir: dirA, writer: 'a' })
  const logB = mod.openControlLog({ dir: dirB, writer: 'b' })
  const fromA = logA.replay()
  const fromB = logB.replay()
  // The relay's receiving half is the shipped ingest: A takes B's own records as B wrote them.
  const handoff = fromB.map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at }))
  // The peer's relay identity is read from the peer's own ledger directory, exactly as the shipped
  // ingest demands it (writer + instance); nothing about it is guessed from the sender's payload.
  const instanceFile = join(dirB, '.instance')
  const instanceB = existsSync(instanceFile) ? readFileSync(instanceFile, 'utf8').trim() : ''
  const landed = await logA.ingest({ writer: 'b', instance: instanceB, records: handoff })
  const relayed = logA.replay()
  const kinds = relayed.map((row) => row.kind).sort()
  // The expectation is FIXED, never derived from the armed flag: a worker that answers is the
  // contract, so the armed run must fail this reading rather than redefine it.
  const expect = ['task/dispatch', 'task/result']
  const ok = distinct && instanceB !== '' && existKinds(fromA, ['task/dispatch']) && same(kinds, expect)
    && fromB.length === 1 && fromB[0].kind === 'task/result' && landed.appended === 1
  await logA.close()
  await logB.close()
  rmSync(dirA, { recursive: true, force: true })
  rmSync(dirB, { recursive: true, force: true })
  record('R11', ok, 'pids=' + String(markA && markA[1]) + '/' + String(markB && markB[1]) + ' reopenedA=' + String(fromA.length)
    + ' reopenedB=' + String(fromB.length) + ' after relay=' + JSON.stringify(kinds) + ' ingested=' + String(landed.appended))
})

function existKinds(rows, kinds) { return kinds.every((kind) => rows.some((row) => row.kind === kind)) }

// ------------------------------------------------------------------ coverage matrix
const escaped = DECLARED.filter((row) => !verdicts.has(row.id)).map((row) => row.id)
const rows = DECLARED.map((row) => ({ id: row.id, kind: row.kind, ok: (verdicts.get(row.id) || {}).ok === true, detail: (verdicts.get(row.id) || {}).detail || 'no verdict' }))
const held = rows.filter((row) => row.ok).length
console.log('')
console.log('coverage matrix: ' + String(rows.length) + ' declared readings, ' + String(held) + ' held, '
  + String(rows.length - held) + ' failed, ' + String(escaped.length) + ' escaped')
if (JSON_OUT) console.log(JSON.stringify(Object.fromEntries(rows.map((row) => [row.id, row.ok]))))

// ------------------------------------------------------------------ self-attack
if (ATTACK) {
  const baseline = spawnSync(process.execPath, [SELF, '--json'], { encoding: 'utf8', timeout: 300000 })
  const line = (baseline.stdout || '').split(/\r?\n/).filter((row) => row.startsWith('{')).pop()
  if (line === undefined) { console.error('self-attack: the baseline run printed no verdict map'); process.exit(1) }
  const base = JSON.parse(line)
  const ids = DECLARED.map((row) => row.id)
  const flipped = ids.filter((id) => Boolean(base[id]) !== Boolean((verdicts.get(id) || {}).ok)).sort()
  if (escaped.length > 0) { console.error('self-attack: readings escaped the matrix: ' + escaped.join(', ')); process.exit(1) }
  if (flipped.length === 0) {
    console.error('self-attack: the armed defect moved no reading - this gate cannot fail')
    console.error('  baseline=' + JSON.stringify(base))
    console.error('  armed=' + JSON.stringify(Object.fromEntries(ids.map((id) => [id, Boolean((verdicts.get(id) || {}).ok)]))))
    console.error('  baseline exit=' + String(baseline.status) + ' stderr tail=' + ((baseline.stderr || '').split(/\r?\n/).slice(-3).join(' | ')))
    process.exit(1)
  }
  if (!same(flipped, ATTACK_READINGS)) {
    console.error('self-attack: not localised. flipped=' + JSON.stringify(flipped) + ' declared=' + JSON.stringify(ATTACK_READINGS))
    process.exit(1)
  }
  console.log('armed: flipped=' + JSON.stringify(flipped) + ' declared=' + JSON.stringify(ATTACK_READINGS))
  console.log('self-attack: localised to ' + String(flipped.length) + ' declared reading(s) - this gate can fail')
  process.exit(0)
}

if (rows.length - held === 0 && escaped.length === 0) {
  console.log('all ' + String(rows.length) + ' readings held')
  process.exit(0)
}
console.log(String(rows.length - held) + ' reading(s) failed: ' + rows.filter((row) => !row.ok).map((row) => row.id).join(', '))
process.exit(1)
