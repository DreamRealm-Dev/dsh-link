#!/usr/bin/env node
/**
 * R72 (task-130): the device net's harder shapes - four hops, a fan-out, crossing chains, and a cycle
 * that must not poison the table it sits in.
 *
 * What is read: the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js) only. Every world below is
 * built here, from this gate's own records and its own child-process choreography; the producer's
 * self-check is not imported, its worlds are not reused, and no expectation is copied from an
 * implementation - each one is the contract's wording turned into a comparison.
 *
 * The routing rule this reads is a walk with a visited set (no hop limit, a repeated end is a verdict
 * rather than a walk): so what is really under test is that four hops are four applications of one
 * rule, that two chains through one transit stay independent, that two paths to one end stay two, and
 * that one bad chain is a row in the failure table rather than the end of the table.
 *
 * Every judgement leg is read at a CHOSEN instant (all members healthy at that instant); the two
 * choreographed legs drive the shipped foreign reference implementation as real child processes.
 *
 * Exit 0 every reading held; 1 a reading failed; 2 the artifact is not built; 3 an input is missing.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer as createHttp } from 'node:http'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(import.meta.url)
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
// A mutant copy of this gate runs from a temp directory, so the project is named by the parent rather
// than derived from this file's own path.
const PROJECT = resolve(option('--project', resolve(dirname(HERE), '..')))
const SHIPPED = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const MODULE = resolve(option('--module', SHIPPED))
const FOREIGN = resolve(option('--foreign', join(PROJECT, 'tools', 'foreign-harness', 'foreign-end.mjs')))
const TOKEN = 'tok'
const AS_JSON = argv.includes('--json')
const CHILD = argv.includes('--plain-child')
const TIMEOUT = 8000
const TEAM = 'team-1'
const LOCAL = 'end-A'

if (!existsSync(MODULE)) { console.error('the plugin is not built: ' + MODULE); process.exit(2) }
if (!existsSync(FOREIGN)) { console.error('the foreign reference end is missing: ' + FOREIGN); process.exit(3) }

const C = await import(pathToFileURL(MODULE).href)

/* ------------------------------------------------------------------------------------------------
 * The gate's own vocabulary: records as the log writes them, and worlds built out of them.
 * ---------------------------------------------------------------------------------------------- */
const T = 1_800_000_000_000
let sequence = 0
const rec = (kind, subject, payload, actor = TEAM) => {
  sequence += 1
  return {
    seq: sequence, channel: 'control', at: T, kind, actor, subject, payload,
    writer: 'gate-r72', instance: 'gate-r72-i1', originSeq: sequence,
  }
}
const memberRec = (id) => rec('member/state', id, { id, state: 'active', name: id })
const beatRec = (id, at = T) => ({ ...C.heartbeatRecord(id, at), ...{ seq: ++sequence, channel: 'control', at, writer: 'gate-r72', instance: 'gate-r72-i1', originSeq: sequence, actor: TEAM } })
const hostRec = (id, end, via) => ({ ...C.hostRecord(id, end, via, T), ...{ seq: ++sequence, channel: 'control', at: T, writer: 'gate-r72', instance: 'gate-r72-i1', originSeq: sequence, actor: TEAM } })
const capRec = (id, tools) => ({ ...C.capabilityRecord(id, tools), ...{ seq: ++sequence, channel: 'control', at: T, writer: 'gate-r72', instance: 'gate-r72-i1', originSeq: sequence, actor: TEAM } })
/** A member that exists, runs on `end`, is reached through `via`, and is healthy at the chosen instant. */
const joined = (id, end, via, tools = []) => [
  memberRec(id),
  hostRec(id, end, via),
  ...(tools.length === 0 ? [] : [capRec(id, tools)]),
  beatRec(id),
]
const world = (records) => C.projectTeamState(records)
const routeOf = (state, id, now) => C.routes(state, LOCAL, now, { timeoutMs: TIMEOUT }).find((row) => row.member === id) ?? null
const failureOf = (state, id, now) => C.routeFailures(state, LOCAL, now, { timeoutMs: TIMEOUT }).find((row) => row.member === id) ?? null
const pathOf = (route) => (route === null ? null : [...route.path])

const readings = []
const held = (name, ok, detail) => {
  const row = { name, ok: ok === true, detail: String(detail) }
  const at = readings.findIndex((existing) => existing.name === name)
  if (at === -1) readings.push(row)
  else readings[at] = row
}
const guard = async (name, body) => {
  try { await body() } catch (error) { held(name, false, 'threw: ' + String(error && error.message ? error.message : error)) }
}
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const until = async (check, budgetMs) => { const end = Date.now() + budgetMs; for (;;) { if (check()) return true; if (Date.now() > end) return false; await sleep(40) } }
// Every world owns its own ports. The probe is released before the port is handed out (a child needs to
// bind it afterwards), so the window where another process can take it is inherent to probing - what this
// allocator can and does rule out is handing the SAME number to two worlds of this gate, which is the
// self-collision that would make two ends fight for one port.
const handedOut = new Set()
const freePort = (attempt = 0) => new Promise((settle, fail) => {
  if (attempt > 20) { fail(new Error('no unused port after 20 attempts')); return }
  const probe = createServer()
  probe.on('error', fail)
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port
    probe.close(() => {
      if (handedOut.has(port)) { freePort(attempt + 1).then(settle, fail); return }
      handedOut.add(port)
      settle(port)
    })
  })
})
const relayUrl = (port) => 'http://127.0.0.1:' + String(port) + '/api/dsh-link-collab/relay'
const dumps = (value) => JSON.stringify(value)

/* ------------------------------------------------------------------------------------------------
 * One end of ours, with a real relay route: the same client half the page describes.
 * ---------------------------------------------------------------------------------------------- */
async function startOurEnd(root, name) {
  const log = C.openControlLog({ dir: join(root, name), writer: name })
  const endpoint = C.createRelayEndpoint({ token: TOKEN, log })
  const server = createHttp(endpoint.handler)
  await new Promise((settle) => server.listen(0, '127.0.0.1', settle))
  return {
    log,
    url: 'http://127.0.0.1:' + String(server.address().port) + endpoint.path,
    close: async () => { server.closeAllConnections(); server.close(); await log.close() },
  }
}
/** One child foreign end, with the ready line, its wire account and its summary kept. */
function startForeign(root, name, args) {
  const home = join(root, name)
  mkdirSync(home, { recursive: true })
  const proc = spawn(process.execPath, [FOREIGN, '--home', home, '--token', TOKEN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  const state = { ready: null, wires: [], proc, url: null, stderr: '' }
  proc.stderr.on('data', (chunk) => { state.stderr += String(chunk) })
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let message = null
    try { message = JSON.parse(line) } catch { return }
    if (message.ready === true) { state.ready = message; state.url = relayUrl(message.port) }
    if (message.wire !== undefined) state.wires.push(message)
  })
  state.stop = () => { try { proc.kill() } catch { /* already gone */ } }
  return state
}
async function pushOwnTo(log, url) {
  const records = log.ownPage(0).map((row) => ({
    seq: row.originSeq, kind: row.kind,
    ...(row.actor === undefined ? {} : { actor: row.actor }),
    ...(row.subject === undefined ? {} : { subject: row.subject }),
    ...(row.payload === undefined ? {} : { payload: row.payload }),
    ...(row.at === undefined ? {} : { at: row.at }),
  }))
  if (records.length === 0) return { status: 0, sent: 0, body: null }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ writer: 'end-A', instance: 'gate-r72-i1', records }),
  })
  return { status: response.status, sent: records.length, body: await response.json().catch(() => null) }
}
const fold = (log) => C.projectTeamState(log.replay())

/* ------------------------------------------------------------------------------------------------
 * Leg one: four hops, read as a judgement and then walked by real processes.
 * ---------------------------------------------------------------------------------------------- */
async function fourHopsJudgement() {
  // The chain is read beside a member whose own chain is a cycle: a table that gives up when one row
  // fails would lose the four hops too, and that is a different claim from "four hops resolve".
  const chain = [joined('m-b', 'B-end', null), joined('m-c', 'C-end', 'B-end'), joined('m-d', 'D-end', 'C-end'), joined('m-e', 'E-end', 'D-end', ['sum']), joined('m-x', 'B-end', 'C-end')].flat()
  const state = world(chain)
  const now = T + 10
  const route = routeOf(state, 'm-e', now)
  const want = [LOCAL, 'B-end', 'C-end', 'D-end', 'E-end']
  held(
    '1. four hops resolve as one rule applied four times: the far member names every hop and hops is 4',
    route !== null && route.hops === 4 && dumps(pathOf(route)) === dumps(want) && route.end === 'E-end',
    'route=' + dumps(route),
  )
  // Paired: take one middle hop out of the hosting facts and the same member becomes unreachable, with
  // the failure naming the hop it stopped at - that is what makes reading 1 about the chain.
  const without = world([joined('m-b', 'B-end', null), joined('m-d', 'D-end', 'C-end'), joined('m-e', 'E-end', 'D-end', ['sum'])].flat())
  const broken = failureOf(without, 'm-e', now)
  const gone = routeOf(without, 'm-e', now)
  held(
    '2. removing a middle hop makes the member unreachable and names the hop it stopped at (paired)',
    broken !== null && broken.reason === 'no-route' && broken.path[broken.path.length - 1] === 'C-end' && gone === null,
    'failure=' + dumps(broken) + ' route=' + dumps(gone),
  )
  // The whole table is one walk per member: a chain that is only four hops long must not be capped.
  const everyHop = ['m-b', 'm-c', 'm-d', 'm-e'].map((id) => { const row = routeOf(state, id, now); return row === null ? null : row.hops })
  held(
    '3. each member on the chain reports its own distance, and hops is always the path it walked (not stored)',
    dumps(everyHop) === dumps([1, 2, 3, 4])
      && C.routes(state, LOCAL, now, { timeoutMs: TIMEOUT }).every((row) => row.hops === row.path.length - 1),
    'hops=' + dumps(everyHop),
  )
}

/* ------------------------------------------------------------------------------------------------
 * Leg two: a fan-out behind one transit, and the transit falling silent.
 * ---------------------------------------------------------------------------------------------- */
async function fanOutJudgement() {
  const records = [
    joined('m-t', 'T-end', null),
    joined('m-c', 'C-end', 'T-end', ['sum']),
    joined('m-d', 'D-end', 'T-end', ['sum']),
  ].flat()
  const state = world(records)
  const now = T + 10
  const left = routeOf(state, 'm-c', now)
  const right = routeOf(state, 'm-d', now)
  held(
    '4. one transit carries two far members: both resolve with two hops and neither disturbs the other',
    left !== null && right !== null && left.hops === 2 && right.hops === 2
      && dumps(pathOf(left)) === dumps([LOCAL, 'T-end', 'C-end'])
      && dumps(pathOf(right)) === dumps([LOCAL, 'T-end', 'D-end'])
      && C.assignThrough(state, TEAM, 'm-c', LOCAL, now, { timeoutMs: TIMEOUT }).ok === true
      && C.assignThrough(state, TEAM, 'm-d', LOCAL, now, { timeoutMs: TIMEOUT }).ok === true,
    'left=' + dumps(left) + ' right=' + dumps(right),
  )
  // Paired: the one hop they share goes quiet, and both answers move together. Read at a chosen instant,
  // so this is the verdict and not the clock.
  const quiet = world([
    joined('m-t', 'T-end', null),
    joined('m-c', 'C-end', 'T-end', ['sum']),
    joined('m-d', 'D-end', 'T-end', ['sum']),
  ].flat().map((row) => (row.kind === 'member/heartbeat' && row.subject === 'm-t' ? beatRec('m-t', T - 20000) : row)))
  const later = now
  const leftFail = failureOf(quiet, 'm-c', later)
  const rightFail = failureOf(quiet, 'm-d', later)
  held(
    '5. the transit falls silent and both far members fail at once with route-down (paired)',
    leftFail !== null && rightFail !== null && leftFail.reason === 'route-down' && rightFail.reason === 'route-down'
      && routeOf(quiet, 'm-c', later) === null && routeOf(quiet, 'm-d', later) === null,
    'left=' + dumps(leftFail) + ' right=' + dumps(rightFail),
  )
}

/* ------------------------------------------------------------------------------------------------
 * Leg three: two chains that arrive at the same far end.
 * ---------------------------------------------------------------------------------------------- */
async function crossingJudgement() {
  const records = [
    joined('m-b', 'B-end', null),
    joined('m-c', 'C-end', 'B-end'),
    joined('m-d', 'D-end', 'C-end'),
    joined('m-p', 'E-end', 'B-end', ['sum']),
    joined('m-q', 'E-end', 'D-end', ['sum']),
  ].flat()
  const state = world(records)
  const now = T + 10
  const short = routeOf(state, 'm-p', now)
  const long = routeOf(state, 'm-q', now)
  const failures = C.routeFailures(state, LOCAL, now, { timeoutMs: TIMEOUT }).map((row) => row.member).sort()
  held(
    '6. two paths to one far end stay two: same end, different chains, and neither is a failure',
    short !== null && long !== null && short.end === 'E-end' && long.end === 'E-end'
      && short.hops === 2 && long.hops === 4
      && dumps(pathOf(short)) === dumps([LOCAL, 'B-end', 'E-end'])
      && dumps(pathOf(long)) === dumps([LOCAL, 'B-end', 'C-end', 'D-end', 'E-end'])
      && dumps(failures) === dumps([]),
    'short=' + dumps(short) + ' long=' + dumps(long) + ' failures=' + dumps(failures),
  )
  const again = world(records)
  held(
    '7. the same world read twice is byte-identical, chains included',
    dumps(C.routes(state, LOCAL, now, { timeoutMs: TIMEOUT })) === dumps(C.routes(again, LOCAL, now, { timeoutMs: TIMEOUT }))
      && dumps(C.routeFailures(state, LOCAL, now, { timeoutMs: TIMEOUT })) === dumps(C.routeFailures(again, LOCAL, now, { timeoutMs: TIMEOUT })),
    'routes=' + dumps(C.routes(state, LOCAL, now, { timeoutMs: TIMEOUT }).map((row) => row.member + ':' + String(row.hops))),
  )
}

/* ------------------------------------------------------------------------------------------------
 * Leg four: a cycle, and the bypass beside it.
 * ---------------------------------------------------------------------------------------------- */
async function cycleJudgement() {
  const records = [
    joined('m-b', 'B-end', null),
    joined('m-c', 'C-end', 'B-end'),
    joined('m-x', 'B-end', 'C-end'),
    joined('m-y', 'D-end', 'B-end', ['sum']),
  ].flat()
  const state = world(records)
  const now = T + 10
  const cycle = failureOf(state, 'm-x', now)
  const bypass = routeOf(state, 'm-y', now)
  const inRoutes = C.routes(state, LOCAL, now, { timeoutMs: TIMEOUT }).map((row) => row.member).sort()
  held(
    '8. a cycle is a verdict: path-cycle names the closed edge rather than walking it',
    cycle !== null && cycle.reason === 'path-cycle' && dumps(cycle.loop) === dumps(['B-end', 'C-end']),
    'failure=' + dumps(cycle),
  )
  held(
    '9. the bypass beside the cycle is ok in the same read: one bad chain does not poison the table',
    bypass !== null && bypass.hops === 2 && dumps(pathOf(bypass)) === dumps([LOCAL, 'B-end', 'D-end']) && inRoutes.includes('m-y'),
    'bypass=' + dumps(bypass) + ' routes=' + dumps(inRoutes),
  )
  held(
    '10. the member in the cycle is not offered as a route (paired with 8 and 9)',
    !inRoutes.includes('m-x') && routeOf(state, 'm-x', now) === null,
    'routes=' + dumps(inRoutes),
  )
  // The precedence is total: a member in a cycle is refused for that reason even though its end has a
  // live representative - so the two answers cannot disagree about the same member.
  const assign = C.assignThrough(state, TEAM, 'm-x', LOCAL, now, { timeoutMs: TIMEOUT })
  held(
    '11. handing work over agrees with the table: a cycling member is refused as path-cycle with the loop',
    assign.ok === false && assign.reason === 'path-cycle' && dumps(assign.loop) === dumps(['B-end', 'C-end']),
    'assign=' + dumps(assign),
  )
}

/* ------------------------------------------------------------------------------------------------
 * Leg five: the same shapes, walked by real child processes.
 * ---------------------------------------------------------------------------------------------- */
async function fourHopsReal(root) {
  const a = await startOurEnd(root, 'end-A')
  const portB = await freePort(); const portC = await freePort(); const portD = await freePort(); const portE = await freePort()
  const urlB = relayUrl(portB); const urlC = relayUrl(portC); const urlD = relayUrl(portD); const urlE = relayUrl(portE)
  const b = startForeign(root, 'B', ['--peer', a.url, '--forward', [a.url, urlC].join(','), '--port', String(portB), '--writer', 'end-B', '--member', 'm-b', '--end', 'B-end', '--tool', 'sum'])
  const c = startForeign(root, 'C', ['--peer', urlB, '--forward', [urlB, urlD].join(','), '--port', String(portC), '--writer', 'end-C', '--member', 'm-c', '--end', 'C-end', '--via', 'B-end'])
  const d = startForeign(root, 'D', ['--peer', urlC, '--forward', [urlC, urlE].join(','), '--port', String(portD), '--writer', 'end-D', '--member', 'm-d', '--end', 'D-end', '--via', 'C-end'])
  const e = startForeign(root, 'E', ['--peer', urlD, '--port', String(portE), '--writer', 'end-E', '--member', 'm-e', '--end', 'E-end', '--via', 'D-end', '--tool', 'sum'])
  try {
    const seen = () => fold(a.log)
    const joinedAll = await until(() => ['m-b', 'm-c', 'm-d', 'm-e'].every((id) => seen().members.some((row) => row.id === id)), 20000)
    const now = Date.now()
    const route = routeOf(seen(), 'm-e', now)
    await a.log.append(C.dispatchRecord('job-4hop', 'm-e', 'sum', { a: 40, b: 2 }, Date.now()))
    const pushed = await pushOwnTo(a.log, b.url)
    const answered = await until(() => C.resolveDispatch(fold(a.log), 'job-4hop', Date.now()).verdict === 'answered', 25000)
    const entry = fold(a.log).dispatches.dispatches.find((row) => row.id === 'job-4hop')
    held(
      '12. real processes: a four-hop chain admits work at the far end and the answer comes all the way back',
      joinedAll && route !== null && route.hops === 4 && answered && entry !== undefined && entry.status === 'answered'
        && dumps(entry.result.value) === dumps({ sum: 42 }) && entry.result.from === 'm-e',
      'joined=' + String(joinedAll) + ' route=' + dumps(route) + ' push=' + dumps(pushed.body) + ' result=' + dumps(entry ? entry.result : null),
    )
    const hops = (state) => Object.fromEntries(['m-b', 'm-c', 'm-d', 'm-e'].map((id) => { const row = routeOf(state, id, Date.now()); return [id, row === null ? null : row.hops] }))
    held(
      '13. the same chain read from the live ledger reports every intermediate distance in order',
      dumps(hops(seen())) === dumps({ 'm-b': 1, 'm-c': 2, 'm-d': 3, 'm-e': 4 }),
      'hops=' + dumps(hops(seen())),
    )
  } finally {
    b.stop(); c.stop(); d.stop(); e.stop(); await a.close()
  }
}

async function fanOutReal(root) {
  const a = await startOurEnd(root, 'end-A')
  const portT = await freePort(); const portC = await freePort(); const portD = await freePort()
  const urlT = relayUrl(portT); const urlC = relayUrl(portC); const urlD = relayUrl(portD)
  const t = startForeign(root, 'T', ['--peer', a.url, '--forward', [a.url, urlC, urlD].join(','), '--port', String(portT), '--writer', 'end-T', '--member', 'm-t', '--end', 'T-end', '--tool', 'sum'])
  const c = startForeign(root, 'C', ['--peer', urlT, '--port', String(portC), '--writer', 'end-C', '--member', 'm-c', '--end', 'C-end', '--via', 'T-end', '--tool', 'sum'])
  const d = startForeign(root, 'D', ['--peer', urlT, '--port', String(portD), '--writer', 'end-D', '--member', 'm-d', '--end', 'D-end', '--via', 'T-end', '--tool', 'sum'])
  try {
    const seen = () => fold(a.log)
    const joinedAll = await until(() => ['m-t', 'm-c', 'm-d'].every((id) => seen().members.some((row) => row.id === id)), 20000)
    await a.log.append(C.dispatchRecord('job-left', 'm-c', 'sum', { a: 1, b: 2 }, Date.now()))
    await a.log.append(C.dispatchRecord('job-right', 'm-d', 'sum', { a: 3, b: 4 }, Date.now()))
    await pushOwnTo(a.log, t.url)
    const both = await until(() => C.resolveDispatch(fold(a.log), 'job-left', Date.now()).verdict === 'answered'
      && C.resolveDispatch(fold(a.log), 'job-right', Date.now()).verdict === 'answered', 25000)
    const left = fold(a.log).dispatches.dispatches.find((row) => row.id === 'job-left')
    const right = fold(a.log).dispatches.dispatches.find((row) => row.id === 'job-right')
    const leftRoute = routeOf(seen(), 'm-c', Date.now())
    const rightRoute = routeOf(seen(), 'm-d', Date.now())
    held(
      '14. real processes: both far members behind one transit answer, each with its own value',
      joinedAll && both && leftRoute !== null && rightRoute !== null && leftRoute.hops === 2 && rightRoute.hops === 2 && left !== undefined && right !== undefined
        && dumps(left.result.value) === dumps({ sum: 3 }) && dumps(right.result.value) === dumps({ sum: 7 })
        && left.result.from === 'm-c' && right.result.from === 'm-d',
      'left=' + dumps(left ? left.result : null) + ' right=' + dumps(right ? right.result : null),
    )
  } finally {
    t.stop(); c.stop(); d.stop(); await a.close()
  }
}

/* ------------------------------------------------------------------------------------------------
 * The run.
 * ---------------------------------------------------------------------------------------------- */
async function plainRun() {
  sequence = 0
  await guard('1. four hops resolve as one rule applied four times: the far member names every hop and hops is 4', fourHopsJudgement)
  await guard('4. one transit carries two far members: both resolve with two hops and neither disturbs the other', fanOutJudgement)
  await guard('6. two paths to one far end stay two: same end, different chains, and neither is a failure', crossingJudgement)
  await guard('8. a cycle is a verdict: path-cycle names the closed edge rather than walking it', cycleJudgement)
  const root = mkdtempSync(join(tmpdir(), 'r72-topologies-'))
  try {
    await guard('12. real processes: a four-hop chain admits work at the far end and the answer comes all the way back', () => fourHopsReal(join(root, 'chain')))
    await guard('14. real processes: both far members behind one transit answer, each with its own value', () => fanOutReal(join(root, 'fanout')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  // A reading a leg never reached is not a reading that held: it is the most dangerous of the silent
  // passes, so every declared name is looked up and reported as a failure when it is missing.
  const missing = EXPECTED.filter((name) => !readings.some((row) => row.name === name))
  for (const name of missing) held(name, false, 'the reading never registered (a leg threw before it)')
  held('15. the declared reading count is what this run produced', readings.length + 1 === DECLARED, 'declared=' + String(DECLARED) + ' produced=' + String(readings.length + 1) + (missing.length === 0 ? '' : ' missing=' + dumps(missing)))
}

const EXPECTED = [
  '1. four hops resolve as one rule applied four times: the far member names every hop and hops is 4',
  '2. removing a middle hop makes the member unreachable and names the hop it stopped at (paired)',
  '3. each member on the chain reports its own distance, and hops is always the path it walked (not stored)',
  '4. one transit carries two far members: both resolve with two hops and neither disturbs the other',
  '5. the transit falls silent and both far members fail at once with route-down (paired)',
  '6. two paths to one far end stay two: same end, different chains, and neither is a failure',
  '7. the same world read twice is byte-identical, chains included',
  '8. a cycle is a verdict: path-cycle names the closed edge rather than walking it',
  '9. the bypass beside the cycle is ok in the same read: one bad chain does not poison the table',
  '10. the member in the cycle is not offered as a route (paired with 8 and 9)',
  '11. handing work over agrees with the table: a cycling member is refused as path-cycle with the loop',
  '12. real processes: a four-hop chain admits work at the far end and the answer comes all the way back',
  '13. the same chain read from the live ledger reports every intermediate distance in order',
  '14. real processes: both far members behind one transit answer, each with its own value',
]
const DECLARED = EXPECTED.length + 1

/* ------------------------------------------------------------------------------------------------
 * Self-attack: mutants patch the SHIPPED artifact's own text, and each one declares the readings it
 * must move. A reading whose declared set does not match what moved is a gate defect, not a pass.
 * ---------------------------------------------------------------------------------------------- */
const MUTANTS = [
  { id: 'cycle-reason-blurred', anchor: 'reason: "path-cycle"', replace: 'reason: "no-route"', declared: ['8. a cycle is a verdict: path-cycle names the closed edge rather than walking it', '11. handing work over agrees with the table: a cycling member is refused as path-cycle with the loop'] },
  { id: 'loop-forgotten', anchor: 'loop: chain.slice(chain.indexOf(next))', replace: 'loop: []', declared: ['8. a cycle is a verdict: path-cycle names the closed edge rather than walking it', '11. handing work over agrees with the table: a cycling member is refused as path-cycle with the loop'] },
  { id: 'hops-stored-wrong', anchor: 'hops: resolved.path.length - 1', replace: 'hops: 1', declared: ['1. four hops resolve as one rule applied four times: the far member names every hop and hops is 4', '3. each member on the chain reports its own distance, and hops is always the path it walked (not stored)', '4. one transit carries two far members: both resolve with two hops and neither disturbs the other', '6. two paths to one far end stay two: same end, different chains, and neither is a failure', '9. the bypass beside the cycle is ok in the same read: one bad chain does not poison the table', '12. real processes: a four-hop chain admits work at the far end and the answer comes all the way back', '13. the same chain read from the live ledger reports every intermediate distance in order', '14. real processes: both far members behind one transit answer, each with its own value'] },
  { id: 'hosting-ignored', anchor: 'const memberEnd = host === null ? localEnd : host.end;', replace: 'const memberEnd = localEnd;', declared: ['1. four hops resolve as one rule applied four times: the far member names every hop and hops is 4', '2. removing a middle hop makes the member unreachable and names the hop it stopped at (paired)', '3. each member on the chain reports its own distance, and hops is always the path it walked (not stored)', '4. one transit carries two far members: both resolve with two hops and neither disturbs the other', '5. the transit falls silent and both far members fail at once with route-down (paired)', '6. two paths to one far end stay two: same end, different chains, and neither is a failure', '8. a cycle is a verdict: path-cycle names the closed edge rather than walking it', '9. the bypass beside the cycle is ok in the same read: one bad chain does not poison the table', '10. the member in the cycle is not offered as a route (paired with 8 and 9)', '11. handing work over agrees with the table: a cycling member is refused as path-cycle with the loop', '12. real processes: a four-hop chain admits work at the far end and the answer comes all the way back', '13. the same chain read from the live ledger reports every intermediate distance in order', '14. real processes: both far members behind one transit answer, each with its own value'] },
  { id: 'route-down-ignored', anchor: 'return { path: stopped, failure: { member, reason: "route-down", path: stopped, loop: [] } };', replace: 'continue;', declared: ['5. the transit falls silent and both far members fail at once with route-down (paired)'] },
  { id: 'poisoned-table', anchor: 'if (resolved.failure !== null) continue;', replace: 'if (resolved.failure !== null) return [];', declared: ['1. four hops resolve as one rule applied four times: the far member names every hop and hops is 4', '3. each member on the chain reports its own distance, and hops is always the path it walked (not stored)', '9. the bypass beside the cycle is ok in the same read: one bad chain does not poison the table'] },
  // Two members reached over two different chains to the same end: collapsing the table by end is the
  // shape this reading exists for. The first version of this mutant (dropping the id-preference in the
  // representative lookup) changed nothing in that world, so it was not a falsifier of the reading.
  { id: 'crossing-collapsed', anchor: 'out.push({ member: row.id, end: resolved.path[resolved.path.length - 1], path: resolved.path, hops: resolved.path.length - 1 });', replace: 'if (out.some((row) => row.end === resolved.path[resolved.path.length - 1])) continue;\n      out.push({ member: row.id, end: resolved.path[resolved.path.length - 1], path: resolved.path, hops: resolved.path.length - 1 });', declared: ['6. two paths to one far end stay two: same end, different chains, and neither is a failure'] },
  // A reading about determinism needs two reads that really differ: this mutant changes the world
  // between them instead of touching the comparison, which would only test the comparison.
  { id: 'read-twice-different-world', kind: 'gate', anchor: 'const again = world(records)', replace: 'const again = world(records.slice(1))', declared: ['7. the same world read twice is byte-identical, chains included'] },
  // The anchor is assembled from two pieces on purpose: written whole, it also occurs in this table,
  // so the replacement would land on the table's own copy and the mutant would silently do nothing.
  { id: 'declaration-drifts', kind: 'gate', anchor: 'readings.length + 1 ' + '=== DECLARED', replace: 'readings.length + 1 === 99', declared: ['15. the declared reading count is what this run produced'] },
]

async function selfAttack() {
  const shipped = readFileSync(SHIPPED, 'utf8')
  const baseline = spawnSync(process.execPath, [HERE, '--plain-child', '--json'], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  let baselineResults = null
  try { baselineResults = JSON.parse(baseline.stdout.trim().split(/\r?\n/).pop()) } catch { baselineResults = null }
  if (baselineResults === null) { console.log('self-attack: the unmutated run printed no result'); process.exit(1) }
  const baselineFailed = Object.entries(baselineResults).filter(([, ok]) => ok !== true).map(([name]) => name)
  if (baselineFailed.length > 0) {
    console.log('self-attack: the unmutated run is not green (' + dumps(baselineFailed) + '), so no mutant can be trusted')
    process.exit(1)
  }
  let mismatches = 0
  const matrix = []
  for (const mutant of MUTANTS) {
    const source = mutant.kind === 'gate' ? readFileSync(HERE, 'utf8') : shipped
    if (!source.includes(mutant.anchor)) { console.log('  FAIL  ' + mutant.id + ': ANCHOR MISSING (' + mutant.kind + ')'); mismatches += 1; continue }
    const dir = mkdtempSync(join(tmpdir(), 'r72-mutant-'))
    const path = join(dir, mutant.kind === 'gate' ? 'gate.mjs' : 'module.js')
    writeFileSync(path, source.replace(mutant.anchor, mutant.replace))
    const extra = mutant.kind === 'gate' ? [path] : ['--module', path]
    const launch = mutant.kind === 'gate'
      ? [process.execPath, [path, '--plain-child', '--json', '--project', PROJECT]]
      : [process.execPath, [HERE, '--plain-child', '--json', ...extra]]
    const run = spawnSync(launch[0], launch[1], { cwd: PROJECT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 })
    rmSync(dir, { recursive: true, force: true })
    let observed = null
    try { observed = JSON.parse((run.stdout ?? '').trim().split(/\r?\n/).pop()) } catch { observed = null }
    if (observed === null) { console.log('  FAIL  ' + mutant.id + ': the mutated run printed no result'); mismatches += 1; continue }
    const names = Object.keys(baselineResults)
    const neverRan = names.filter((name) => observed[name] === undefined).sort()
    const flipped = names.filter((name) => baselineResults[name] === true && observed[name] !== true).sort()
    const declared = [...mutant.declared].sort()
    const same = dumps(flipped) === dumps(declared)
    if (!same) mismatches += 1
    matrix.push({ id: mutant.id, flipped, neverRan, declared, same })
    console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + mutant.id + '  flipped=' + dumps(flipped) + ' declared=' + dumps(declared) + (neverRan.length === 0 ? '' : ' neverRan=' + dumps(neverRan)))
  }
  const covered = new Set(matrix.flatMap((row) => row.flipped))
  const uncovered = Object.keys(baselineResults).filter((name) => !covered.has(name))
  console.log('coverage: ' + String(Object.keys(baselineResults).length) + ' declared readings, ' + String(covered.size) + ' moved by at least one mutant, uncovered ' + dumps(uncovered))
  console.log('declared-set mismatches: ' + String(mismatches) + '; anchors missing: ' + String(MUTANTS.filter((mutant) => !(mutant.kind === 'gate' ? readFileSync(HERE, 'utf8') : shipped).includes(mutant.anchor)).length))
  process.exit(mismatches === 0 && uncovered.length === 0 ? 0 : 1)
}

if (argv.includes('--self-attack')) await selfAttack()
else {
  await plainRun()
  if (AS_JSON || CHILD) console.log(JSON.stringify(Object.fromEntries(readings.map((row) => [row.name, row.ok]))))
  else {
    for (const row of readings) console.log((row.ok ? '  ok    ' : '  FAIL  ') + row.name + '  |  ' + row.detail)
    const failed = readings.filter((row) => !row.ok).length
    console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
    process.exit(failed === 0 ? 0 : 1)
  }
}
