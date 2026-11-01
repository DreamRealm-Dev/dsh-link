#!/usr/bin/env node
/**
 * R54 gate (deliverable A + the loopback half of B), written independently from .tmp/R54-contract.md.
 *
 * Reads ONLY the shipped artifact plugins/dsh-link-collab/lib/index.js: no src/, no build, no
 * plugins/** writes, no import of the producer's own harness. Expected values are contract
 * literals; nothing is read back out of the artifact to decide an answer, and no expectation
 * changes when --self-attack is armed (the R53 lesson).
 *
 * Readings:
 *   R1/R2  anchors (R53 surface present, R54 surface present)
 *   R3     stale positive (now - at > timeoutMs, entry pending)
 *   R4     equality boundary: now - at === timeoutMs IS stale
 *   R5     one millisecond below the boundary is NOT stale
 *   R6     no timeoutMs: never stale, however old
 *   R7     answered is not overridden by stale
 *   R8     refused is not overridden by stale
 *   R9     unknown-id stays unknown-id
 *   R10    expiredDispatches lists exactly the stale ids, ascending
 *   R11    order independence still holds (same seq set, reversed array)
 *   R12    both ends fold the same dispatch identically
 *   R13    authorization failure leaves the peer ledger unchanged (real HTTP)
 *   R14    a real node:http loopback round trip publishes the batch (no stub relayTo)
 *   R15    two real child processes + shipped ingest (the armed reading)
 * Usage: node scripts/verify-collab-dispatch-timeout.mjs [--json] [--self-attack]
 * Exit: 0 every reading held; 1 something failed; 2 the artifact is missing.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(SELF), '..')
const ARTIFACT = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const ATTACK = process.argv.includes('--self-attack')
const JSON_OUT = process.argv.includes('--json')
const TIMEOUT = 60000
const NOW = 1800000000000

// ---------------------------------------------------------------- child mode (real process)
const childAt = process.argv.indexOf('--child')
if (childAt !== -1) {
  const role = process.argv[childAt + 1]
  const dir = process.argv[process.argv.indexOf('--dir') + 1]
  const mod = await import(pathToFileURL(ARTIFACT).href)
  const log = mod.openControlLog({ dir, writer: role })
  const fact = role === 'a'
    ? { kind: 'task/dispatch', subject: 'job-1', at: NOW - 500, payload: { id: 'job-1', to: 'b', tool: 'echo', args: {}, at: NOW - 500 } }
    : { kind: 'task/result', subject: 'job-1', at: NOW - 400, payload: { id: 'job-1', from: 'b', ok: true, value: { echo: 'hi' }, at: NOW - 400 } }
  // The armed defect: the worker never answers. Only the readings that depend on this append may move.
  if (!(role === 'b' && process.env.R54_ATTACK === '1')) await log.append(fact)
  await log.close()
  console.log('R54-CHILD ' + role + ' pid=' + String(process.pid))
  process.exit(0)
}

// ---------------------------------------------------------------- declarations
/** R53's frozen exports: the gate's baseline surface, shipped today. */
const R53_SURFACE = ['DISPATCH_KIND', 'RESULT_KIND', 'dispatchRecord', 'resultRecord', 'projectDispatches',
  'resolveDispatch', 'acceptResult', 'appendResult', 'createLocalTools', 'executeDispatches']
/** R54's new surface, per the contract. */
const R54_SURFACE = ['expiredDispatches']
/** The shipped reuse forms the contract builds on. */
const REUSED = ['openControlLog', 'projectTeamState', 'capabilityRecord', 'livenessOf', 'assignThrough']
/** The verdict closure after R54 adds one word. */
const VERDICTS = ['unknown-id', 'refused', 'answered', 'pending', 'stale']
const STALE_VERDICT = 'stale'

const DECLARED = [
  { id: 'R1', kind: 'anchor', needs: R53_SURFACE, attack: false },
  { id: 'R2', kind: 'anchor', needs: [...R54_SURFACE, ...REUSED], attack: false },
  { id: 'R3', kind: 'timeout', needs: ['dispatchRecord', 'projectDispatches', 'resolveDispatch'], attack: false },
  { id: 'R4', kind: 'timeout', needs: ['dispatchRecord', 'projectDispatches', 'resolveDispatch'], attack: false },
  { id: 'R5', kind: 'timeout', needs: ['dispatchRecord', 'projectDispatches', 'resolveDispatch'], attack: false },
  { id: 'R6', kind: 'timeout', needs: ['dispatchRecord', 'projectDispatches', 'resolveDispatch'], attack: false },
  { id: 'R7', kind: 'timeout', needs: ['dispatchRecord', 'resultRecord', 'projectDispatches', 'resolveDispatch'], attack: false },
  { id: 'R8', kind: 'timeout', needs: ['dispatchRecord', 'projectDispatches', 'resolveDispatch'], attack: false },
  { id: 'R9', kind: 'timeout', needs: ['dispatchRecord', 'projectDispatches', 'resolveDispatch'], attack: false },
  { id: 'R10', kind: 'timeout', needs: ['dispatchRecord', 'projectDispatches', 'expiredDispatches'], attack: false },
  { id: 'R11', kind: 'fold', needs: ['dispatchRecord', 'resultRecord', 'projectDispatches'], attack: false },
  { id: 'R12', kind: 'fold', needs: ['openControlLog', 'projectDispatches'], attack: false },
  { id: 'R13', kind: 'http', needs: ['openControlLog', 'projectDispatches'], attack: false },
  { id: 'R14', kind: 'http', needs: ['openControlLog', 'projectDispatches'], attack: false },
  { id: 'R15', kind: 'process', needs: ['openControlLog'], attack: true },
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
const evaluate = async (id, fn) => {
  const row = DECLARED.find((entry) => entry.id === id)
  const missing = (row ? row.needs : []).filter((name) => typeof mod[name] === 'undefined')
  if (missing.length > 0) { record(id, false, 'blocked: the artifact does not export ' + missing.join(', ')); return }
  try { await fn() } catch (error) { record(id, false, 'threw: ' + String(error && error.message ? error.message : error)) }
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const tempDir = () => mkdtempSync(join(tmpdir(), 'r54-gate-'))
/** One dispatch fact, with the instants the reading is about. */
const dispatchFact = (mod_, seq, id, to, at) => ({ seq, channel: 'control', at, actor: to, ...mod_.dispatchRecord(id, to, 'echo', {}, at) })
const resultFact = (mod_, seq, id, from, at) => ({ seq, channel: 'control', at, actor: from, ...mod_.resultRecord(id, from, { ok: true, value: 1 }, at) })
/** A state whose entry for `id` is pending: the capability record is what keeps it out of refused. */
const pendingState = (mod_, id, at, extra) => mod_.projectTeamState([
  { seq: 0, channel: 'control', at, actor: 'b', ...mod_.capabilityRecord('b', ['echo']) },
  dispatchFact(mod_, 1, id, 'b', at),
  ...(extra || []),
])

// ---------------------------------------------------------------- R1 / R2 anchors
await evaluate('R1', () => {
  const missing = R53_SURFACE.filter((name) => !exportList.has(name))
  record('R1', missing.length === 0, missing.length === 0
    ? 'the R53 surface ships (' + String(R53_SURFACE.length) + ' exports; artifact sha256 ' + sha.slice(0, 12) + ')'
    : 'missing R53 exports: ' + missing.join(', '))
})
await evaluate('R2', () => {
  const missing = [...R54_SURFACE, ...REUSED].filter((name) => typeof mod[name] === 'undefined')
  record('R2', missing.length === 0, missing.length === 0
    ? 'the R54 surface and its reuse anchors resolve (expiredDispatches + ' + String(REUSED.length) + ' reused forms)'
    : 'missing from the artifact: ' + missing.join(', '))
})

// ---------------------------------------------------------------- R3-R9 the timeout rule
await evaluate('R3', () => {
  const at = NOW - TIMEOUT - 1
  const state = pendingState(mod, 'job-1', at)
  const out = mod.resolveDispatch(state, 'job-1', NOW, { timeoutMs: TIMEOUT })
  record('R3', out.verdict === STALE_VERDICT, 'at = now - timeoutMs - 1 -> ' + JSON.stringify(out))
})
await evaluate('R4', () => {
  const state = pendingState(mod, 'job-1', NOW - TIMEOUT)
  const out = mod.resolveDispatch(state, 'job-1', NOW, { timeoutMs: TIMEOUT })
  record('R4', out.verdict === STALE_VERDICT, 'at = now - timeoutMs exactly -> ' + JSON.stringify(out) + ' (the contract makes the equality stale)')
})
await evaluate('R5', () => {
  const inside = pendingState(mod, 'job-1', NOW - TIMEOUT + 1)
  const outside = pendingState(mod, 'job-1', NOW - TIMEOUT)
  const near = mod.resolveDispatch(inside, 'job-1', NOW, { timeoutMs: TIMEOUT })
  const past = mod.resolveDispatch(outside, 'job-1', NOW, { timeoutMs: TIMEOUT })
  record('R5', near.verdict === 'pending' && past.verdict === STALE_VERDICT,
    'one millisecond inside the window -> ' + JSON.stringify(near.verdict) + ' ; at the boundary -> ' + JSON.stringify(past.verdict) + ' (the pair is what makes the rule testable)')
})
await evaluate('R6', () => {
  const state = pendingState(mod, 'job-1', NOW - 100 * TIMEOUT)
  const without = mod.resolveDispatch(state, 'job-1', NOW)
  const withZero = mod.resolveDispatch(state, 'job-1', NOW, {})
  const withOne = mod.resolveDispatch(state, 'job-1', NOW, { timeoutMs: 1 })
  record('R6', without.verdict === 'pending' && withZero.verdict === 'pending' && withOne.verdict === STALE_VERDICT,
    'no timeoutMs -> ' + JSON.stringify(without.verdict) + ' ; empty options -> ' + JSON.stringify(withZero.verdict) + ' (no threshold, no verdict about time) ; the same record with timeoutMs=1 -> ' + JSON.stringify(withOne.verdict))
})
await evaluate('R7', () => {
  const at = NOW - 100 * TIMEOUT
  const state = mod.projectTeamState([
    { seq: 0, channel: 'control', at, actor: 'b', ...mod.capabilityRecord('b', ['echo']) },
    dispatchFact(mod, 1, 'job-1', 'b', at),
    resultFact(mod, 2, 'job-1', 'b', at + 1),
  ])
  const out = mod.resolveDispatch(state, 'job-1', NOW, { timeoutMs: TIMEOUT })
  record('R7', out.verdict === 'answered', 'an answered entry stays answered after 100x the timeout -> ' + JSON.stringify(out))
})
await evaluate('R8', () => {
  const at = NOW - 100 * TIMEOUT
  const state = mod.projectTeamState([dispatchFact(mod, 1, 'job-1', 'b', at)])
  const out = mod.resolveDispatch(state, 'job-1', NOW, { timeoutMs: TIMEOUT })
  record('R8', out.verdict === 'refused', 'a capability-refused entry stays refused -> ' + JSON.stringify(out) + ' (refused is not a timeout)')
})
await evaluate('R9', () => {
  const state = pendingState(mod, 'job-1', NOW - 100 * TIMEOUT)
  const unknown = mod.resolveDispatch(state, 'no-such-id', NOW, { timeoutMs: TIMEOUT })
  const known = mod.resolveDispatch(state, 'job-1', NOW, { timeoutMs: TIMEOUT })
  record('R9', unknown.verdict === 'unknown-id' && known.verdict === STALE_VERDICT,
    'an id that is not in the ledger -> ' + JSON.stringify(unknown.verdict) + ' ; the id that is -> ' + JSON.stringify(known.verdict))
})
await evaluate('R10', () => {
  const records = [
    { seq: 0, channel: 'control', at: NOW, actor: 'b', ...mod.capabilityRecord('b', ['echo']) },
    dispatchFact(mod, 3, 'job-c', 'b', NOW - TIMEOUT - 5),
    dispatchFact(mod, 1, 'job-a', 'b', NOW - TIMEOUT),
    dispatchFact(mod, 2, 'job-b', 'b', NOW - 1000),
  ]
  const state = mod.projectTeamState(records)
  const expired = mod.expiredDispatches(state, NOW, { timeoutMs: TIMEOUT })
  const verdictsByHand = ['job-a', 'job-b', 'job-c'].map((id) => mod.resolveDispatch(state, id, NOW, { timeoutMs: TIMEOUT }).verdict)
  record('R10', same(expired, ['job-a', 'job-c']) && same(verdictsByHand, ['stale', 'pending', 'stale']),
    'expiredDispatches -> ' + JSON.stringify(expired) + ' (ascending, exactly the stale ones); the same state judged id by id -> ' + JSON.stringify(verdictsByHand))
})

// ---------------------------------------------------------------- R11 / R12 folds
await evaluate('R11', () => {
  const records = [
    { seq: 0, channel: 'control', at: NOW, actor: 'b', ...mod.capabilityRecord('b', ['echo']) },
    dispatchFact(mod, 1, 'job-1', 'b', NOW - 1000),
    resultFact(mod, 2, 'job-1', 'b', NOW - 900),
    { seq: 3, channel: 'control', at: NOW, actor: 'b', ...mod.capabilityRecord('b', ['echo']) },
  ]
  const forward = mod.projectDispatches(records)
  const backward = mod.projectDispatches([...records].reverse())
  record('R11', same(forward, backward), 'the same seq set in reverse array order folds byte-identically (' + String(forward.dispatches.length) + ' dispatches, ' + String(forward.results.length) + ' results)')
})
await evaluate('R12', async () => {
  const dirA = tempDir()
  const dirB = tempDir()
  const a = mod.openControlLog({ dir: dirA, writer: 'end-a' })
  const b = mod.openControlLog({ dir: dirB, writer: 'end-b' })
  // One fact, owned by A; B receives it and nothing else, so both folds describe the same thing.
  await a.append({ kind: 'capability/state', subject: 'b', at: NOW, payload: { id: 'b', capabilities: ['echo'] } })
  await a.append({ kind: 'task/dispatch', subject: 'job-1', at: NOW - 1000, payload: { id: 'job-1', to: 'b', tool: 'echo', args: {}, at: NOW - 1000 } })
  const received = await b.ingest({ writer: 'end-a', instance: a.instance, records: a.ownPage().map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })) })
  const foldA = mod.projectDispatches(a.replay())
  const foldB = mod.projectDispatches(b.replay())
  await a.close()
  await b.close()
  rmSync(dirA, { recursive: true, force: true })
  rmSync(dirB, { recursive: true, force: true })
  // Each side numbers its own log, so `seq` is local by construction; the judgement-bearing
  // projection is what must agree byte for byte.
  const canonical = (fold) => JSON.stringify(fold.dispatches.map((row) => ({ id: row.id, to: row.to, tool: row.tool, args: row.args, at: row.at, status: row.status, result: row.result })))
  const agreed = canonical(foldA) === canonical(foldB)
  record('R12', agreed && received.appended === 2 && foldA.dispatches.length === 1 && foldA.dispatches[0].status === 'pending',
    'both ends fold the same dispatch identically: ' + String(agreed) + ' (ingested ' + String(received.appended) + ', status ' + String(foldA.dispatches[0] && foldA.dispatches[0].status) + ')'
      + (JSON.stringify(foldA.dispatches) === JSON.stringify(foldB.dispatches) ? ' ; raw JSON also identical' : ' ; raw JSON differs (each log numbers its own seq)'))
})

// ---------------------------------------------------------------- R13 / R14 the loopback pair
/** The secret the endpoint is built with; the wrong-secret call presents a different one. */
const RELAY_TOKEN = 'r54-gate-secret'
/** The batch this end pushes: its own records, in the shape ingest takes them. */
const pushBatchOf = (log) => ({ writer: 'end-a', instance: log.instance, records: log.ownPage().map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })) })

await evaluate('R13', async () => {
  const surface = await relaySurface()
  if (surface.reason !== null) { record('R13', false, 'blocked: ' + surface.reason); return }
  try {
    // The ledger must EXIST before the refusal is read: a reading that measures "the peer ledger did not grow"
    // against a file that was never created passes for a dead route as readily as for a refused one.
    const dirA = tempDir()
    const localLog = mod.openControlLog({ dir: dirA, writer: 'end-a' })
    await localLog.append({ kind: 'task/dispatch', subject: 'job-r13', at: NOW - 1000, payload: { id: 'job-r13', to: 'end-b', tool: 'echo', args: {}, at: NOW - 1000 } })
    const batch = pushBatchOf(localLog)
    const before = surface.peerRecords().length
    // The same batch twice: once with a bad secret, once with the right one. The pair is the reading - the
    // first half alone would also hold if the route were dead, or if the body were what got refused.
    const wrong = await postBatch(surface.url, 'WRONG', batch, { 'x-dsh-link-token': 'WRONG' })
    const afterWrong = surface.peerRecords().length
    const right = await postBatch(surface.url, RELAY_TOKEN, batch)
    const afterRight = surface.peerRecords().length
    await localLog.close()
    rmSync(dirA, { recursive: true, force: true })
    const refused = wrong.status >= 400 && wrong.code === 'UNAUTHORIZED' && afterWrong === before
    const accepted = right.status >= 200 && right.status < 300 && afterRight === before + 1
    record('R13', refused && accepted,
      'the wrong secret was refused with ' + String(wrong.status) + ' ' + String(wrong.code) + ' and the peer ledger is unchanged (' + String(before) + '->' + String(afterWrong) + '); the same batch with the right secret was accepted (' + String(right.status) + ') and landed exactly one record (' + String(before) + '->' + String(afterRight) + ') - the route answers, so the secret is what refused it; POSTs routed=' + String(surface.routed()))
  } finally { await surface.cleanup() }
})
await evaluate('R14', async () => {
  const surface = await relaySurface()
  if (surface.reason !== null) { record('R14', false, 'blocked: ' + surface.reason); return }
  try {
    const dirA = tempDir()
    const localLog = mod.openControlLog({ dir: dirA, writer: 'end-a' })
    await localLog.append({ kind: 'capability/state', subject: 'end-b', at: NOW, payload: { id: 'end-b', capabilities: ['echo'] } })
    await localLog.append({ kind: 'task/dispatch', subject: 'job-r14', at: NOW - 1000, payload: { id: 'job-r14', to: 'end-b', tool: 'echo', args: {}, at: NOW - 1000 } })
    const batch = pushBatchOf(localLog)
    const overFetch = await postBatch(surface.url, RELAY_TOKEN, batch)
    const viaClient = await surface.endpoint.relayTo(surface.url, batch)
    const landed = surface.peerRecords()
    const foldA = mod.projectDispatches(localLog.replay())
    const foldB = mod.projectDispatches(landed)
    await localLog.close()
    rmSync(dirA, { recursive: true, force: true })
    // Each log numbers its own seq, so the judgement-bearing projection is what must agree byte for byte.
    const canonical = (fold) => JSON.stringify(fold.dispatches.map((row) => ({ id: row.id, to: row.to, tool: row.tool, args: row.args, at: row.at, status: row.status, result: row.result })))
    const identical = canonical(foldA) === canonical(foldB)
    const dispatched = landed.filter((row) => row.kind === 'task/dispatch')
    const ok = overFetch.status >= 200 && overFetch.status < 300 && dispatched.length === 1 && identical
      && viaClient.ok === true && landed.length === 2
    record('R14', ok,
      'a real fetch to ' + surface.url + ' published 1 task/dispatch (status ' + String(overFetch.status) + ', peer ledger ' + String(landed.length) + ' records, kinds ' + JSON.stringify(landed.map((row) => row.kind).sort()) + '); the peer fold and the local fold are byte-identical: ' + String(identical)
        + '; the shipped client half relayTo(url, batch) re-sent the same batch -> ' + JSON.stringify({ ok: viaClient.ok, appended: viaClient.appended, skipped: viaClient.skipped }) + ' with the peer ledger still ' + String(surface.peerRecords().length) + ' (a re-sent batch does not double the ledger); POSTs routed=' + String(surface.routed()))
  } finally { await surface.cleanup() }
})

/**
 * The shipped push surface, as the contract names it: LinkCollab.relayTo plus the R16 HTTP route.
 * Nothing here stubs relayTo: when the artifact exports no way to build the server side, the two
 * HTTP readings report exactly which symbol is missing instead of faking a network hop.
 */
async function relaySurface() {
  const frozen = 'createRelayEndpoint'
  const candidates = [frozen, 'createRelayServer', 'relayServer', 'createRelayHandler', 'linkCollabServer']
  const found = candidates.filter((name) => typeof mod[name] === 'function')
  if (found.length === 0) {
    return { reason: 'the artifact exports no relay server entry point (looked for ' + candidates.join(', ') + '); the HTTP readings cannot be wired without stubbing relayTo' }
  }
  if (found.indexOf(frozen) === -1) {
    return { reason: 'the artifact exports ' + found.join(', ') + ' but not the frozen ' + frozen + ': the HTTP readings are not driven against a look-alike' }
  }
  const dir = tempDir()
  const peerLog = mod.openControlLog({ dir, writer: 'end-b' })
  const endpoint = mod.createRelayEndpoint({ token: RELAY_TOKEN, log: peerLog })
  let routed = 0
  const server = createServer((req, res) => { routed += 1; void endpoint.handler(req, res) })
  await new Promise((settle) => server.listen(0, '127.0.0.1', settle))
  const port = server.address().port
  return {
    reason: null,
    url: 'http://127.0.0.1:' + String(port) + endpoint.path,
    port,
    path: endpoint.path,
    endpoint,
    routed: () => routed,
    peerRecords: () => peerLog.replay(),
    cleanup: async () => {
      await new Promise((settle) => server.close(() => settle()))
      try { await peerLog.close() } catch { /* the reading already closed it */ }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * One POST over the loopback. The shipped client half sends "authorization: Bearer <token>" - that is what
 * pushBatch does - so the wrong-secret call presents a bad secret in that frozen form and ALSO the header name
 * the hand-off list used, and the reading reports the status and the refusal code it got back.
 */
async function postBatch(url, secret, batch, extraHeaders) {
  const headers = { 'content-type': 'application/json' }
  if (secret !== null) headers.authorization = 'Bearer ' + secret
  if (extraHeaders !== undefined) Object.assign(headers, extraHeaders)
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(batch) })
  let body = null
  try { body = await response.json() } catch { body = null }
  return { status: response.status, code: body !== null && typeof body.code === 'string' ? body.code : null }
}

// ---------------------------------------------------------------- R15 two real child processes
await evaluate('R15', async () => {
  const dirA = tempDir()
  const dirB = tempDir()
  const env = { ...process.env, ...(ATTACK ? { R54_ATTACK: '1' } : {}) }
  const runChild = (role, dir) => spawnSync(process.execPath, [SELF, '--child', role, '--dir', dir], { encoding: 'utf8', env, timeout: 60000 })
  const a = runChild('a', dirA)
  const b = runChild('b', dirB)
  const markA = /R54-CHILD a pid=(\d+)/.exec(a.stdout || '')
  const markB = /R54-CHILD b pid=(\d+)/.exec(b.stdout || '')
  const distinct = markA !== null && markB !== null && markA[1] !== markB[1]
  const logA = mod.openControlLog({ dir: dirA, writer: 'a' })
  const logB = mod.openControlLog({ dir: dirB, writer: 'b' })
  const fromA = logA.replay()
  const fromB = logB.replay()
  const instanceFile = join(dirB, '.instance')
  const instanceB = existsSync(instanceFile) ? readFileSync(instanceFile, 'utf8').trim() : ''
  const landed = await logA.ingest({ writer: 'b', instance: instanceB, records: fromB.map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })) })
  const kinds = logA.replay().map((row) => row.kind).sort()
  const expect = ['task/dispatch', 'task/result']
  const ok = distinct && instanceB !== '' && fromA.length === 1 && fromB.length === 1 && same(kinds, expect) && landed.appended === 1
  await logA.close()
  await logB.close()
  rmSync(dirA, { recursive: true, force: true })
  rmSync(dirB, { recursive: true, force: true })
  record('R15', ok, 'pids=' + String(markA && markA[1]) + '/' + String(markB && markB[1]) + ' reopenedA=' + String(fromA.length) + ' reopenedB=' + String(fromB.length) + ' after relay=' + JSON.stringify(kinds))
})

// ---------------------------------------------------------------- coverage matrix + self-attack
const escaped = DECLARED.filter((row) => !verdicts.has(row.id)).map((row) => row.id)
const rows = DECLARED.map((row) => ({ id: row.id, kind: row.kind, ok: (verdicts.get(row.id) || {}).ok === true, detail: (verdicts.get(row.id) || {}).detail || 'no verdict' }))
const held = rows.filter((row) => row.ok).length
console.log('')
console.log('coverage matrix: ' + String(rows.length) + ' declared readings, ' + String(held) + ' held, ' + String(rows.length - held) + ' failed, ' + String(escaped.length) + ' escaped')
if (JSON_OUT) console.log(JSON.stringify(Object.fromEntries(rows.map((row) => [row.id, row.ok]))))

if (ATTACK) {
  const baseline = spawnSync(process.execPath, [SELF, '--json'], { encoding: 'utf8', timeout: 300000 })
  const line = (baseline.stdout || '').split(/\r?\n/).filter((row) => row.startsWith('{')).pop()
  if (line === undefined) { console.error('self-attack: the baseline run printed no verdict map'); process.exit(1) }
  const base = JSON.parse(line)
  const ids = DECLARED.map((row) => row.id)
  const flipped = ids.filter((id) => Boolean(base[id]) !== Boolean((verdicts.get(id) || {}).ok)).sort()
  if (escaped.length > 0) { console.error('self-attack: readings escaped the matrix: ' + escaped.join(', ')); process.exit(1) }
  if (flipped.length === 0) { console.error('self-attack: the armed defect moved no reading - this gate cannot fail'); process.exit(1) }
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
