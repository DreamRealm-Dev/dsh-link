#!/usr/bin/env node
/**
 * R72 build self-check: the harder device-net shapes.
 *
 * Routing is a walk with a visited set (no hop limit, a repeated end is a cycle), so these shapes are
 * expected to need no product change. What they need is to be READ: a four-hop chain, one transit
 * carrying two far members, two chains that cross on one end, and a cycle that must not poison the rest
 * of the table. Every reading is taken at CHOSEN instants and every shape has a paired negative - a
 * shape on its own only shows that a table is printed, not that it is right.
 *
 * Which shapes run as real processes and which are synthetic is stated per reading: a chain of hops and
 * a fan-out are exactly what the reference implementation does, so they run as real child processes with
 * a real relay; the crossing pair and the cycle-with-bypass need two members on ONE end reached through
 * two different hops, and the reference implementation declares one --end and one --via per process, so
 * those two are built from the shipped pure functions over a real log and are labelled synthetic.
 *
 * Reads the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js) only.
 * Run: node tools/foreign-harness/topology-selfcheck.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { createServer as createHttp } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..')
const C = await import(pathToFileURL(join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')).href)
const FOREIGN = join(HERE, 'foreign-end.mjs')
const PATH = '/api/dsh-link-collab/relay'
const TEAM = 'team-1'
const T0 = 1_800_000_000_000
const WINDOW = 60_000
const readings = []
const held = (name, ok, detail) => readings.push([name, ok === true, detail])
const J = (value) => JSON.stringify(value)
const freePort = () => new Promise((settle) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => settle(port)) }) })
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))

const root = mkdtempSync(join(tmpdir(), 'r72-topology-'))
const running = []
const start = (label, args) => {
  const child = spawn(process.execPath, [FOREIGN, '--token', 'tok', '--rounds', '400', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
  const state = { label, pid: child.pid, ready: null, child }
  createInterface({ input: child.stdout }).on('line', (line) => { let m = null; try { m = JSON.parse(line) } catch { return } if (m.ready === true) state.ready = m })
  running.push(state)
  return state
}
const up = async (state) => { for (let i = 0; i < 120 && state.ready === null; i += 1) await sleep(50); if (state.ready === null) throw new Error('never came up: ' + state.label); return state }
const endpoint = async (dir, writer) => {
  const log = C.openControlLog({ dir, writer })
  const server = createHttp(C.createRelayEndpoint({ token: 'tok', log }).handler)
  await new Promise((settle) => server.listen(0, '127.0.0.1', settle))
  return { log, server, url: 'http://127.0.0.1:' + String(server.address().port) + PATH, state: () => C.projectTeamState(log.replay()) }
}
const url = (port) => 'http://127.0.0.1:' + String(port) + PATH
const waitFor = async (check, budget = 80) => { for (let i = 0; i < budget; i += 1) { if (check()) return true; await sleep(100) } return check() }
const pushOwn = (target, log) => fetch(target, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
  body: JSON.stringify({ writer: log.writer, instance: log.instance, records: log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })) }),
}).catch(() => ({ status: 0 }))

/** A synthetic world: real log, real envelopes, chosen instants. */
const synth = async (name) => {
  const log = C.openControlLog({ dir: join(root, name), writer: 'end-A' })
  const member = async (id, end, via, at = T0) => {
    await log.append({ kind: 'member/state', actor: TEAM, subject: id, payload: { id, state: 'active', name: id } })
    if (end !== null) await log.append(C.hostRecord(id, end, via, at))
    await log.append(C.heartbeatRecord(id, at))
    await log.append(C.capabilityRecord(id, ['sum']))
  }
  return { log, member, state: () => C.projectTeamState(log.replay()) }
}
const closeWorld = async (...worlds) => { for (const w of worlds) { if (w.server !== undefined) w.server.close(); await w.log.close() } }

/* ---- 1. four hops out, four hops back ---------------------------------------------------------- */
{
  // Synthetic first: the shape of the answer, and the paired negative that proves the reading bites.
  const good = await synth('chain-four')
  await good.member('m-h1', 'H1-end', null)
  await good.member('m-h2', 'H2-end', 'H1-end')
  await good.member('m-h3', 'H3-end', 'H2-end')
  await good.member('m-e', 'E-end', 'H3-end')
  const now = T0 + 10
  const route = C.routes(good.state(), 'end-A', now, { timeoutMs: WINDOW }).find((row) => row.member === 'm-e')
  held('1a. four hops resolve hop by hop from chosen instants (synthetic)', route !== undefined && route.hops === 4
    && J(route.path) === J(['end-A', 'H1-end', 'H2-end', 'H3-end', 'E-end']), 'path=' + J(route?.path ?? null) + ' hops=' + String(route?.hops ?? null))

  const broken = await synth('chain-four-broken')
  await broken.member('m-h1', 'H1-end', null)
  await broken.member('m-h2', 'H2-end', 'H1-end')
  // H3's host fact is deliberately absent: nothing says H3-end can be reached.
  await broken.member('m-h3', null, null)
  await broken.member('m-e', 'E-end', 'H3-end')
  const brokenState = broken.state()
  const stillThere = C.routes(brokenState, 'end-A', now, { timeoutMs: WINDOW }).some((row) => row.member === 'm-e')
  const failure = C.routeFailures(brokenState, 'end-A', now, { timeoutMs: WINDOW }).find((row) => row.member === 'm-e')
  held('1b. the same chain without the middle hop fact fails by name, and the far member is not a route (paired)',
    !stillThere && failure !== undefined && failure.reason === 'no-route' && failure.path.includes('H3-end'),
    'inRoutes=' + String(stillThere) + ' failure=' + J(failure ?? null))
  await closeWorld(good, broken)

  // Then the real thing: four hops with work out and the answer back.
  const a = await endpoint(join(root, 'r1-A'), 'end-A')
  const p1 = await freePort(), p2 = await freePort(), p3 = await freePort(), p4 = await freePort()
  const u1 = url(p1), u2 = url(p2), u3 = url(p3), u4 = url(p4)
  const beat = ['--beat-every', '200']
  const h1 = await up(start('R1H1', ['--home', join(root, 'R1H1'), '--writer', 'foreign-r1h1', '--member', 'm-h1', '--end', 'H1-end', '--peer', u2, '--forward', u2 + ',' + a.url, '--port', String(p1), ...beat]))
  const h2 = await up(start('R1H2', ['--home', join(root, 'R1H2'), '--writer', 'foreign-r1h2', '--member', 'm-h2', '--end', 'H2-end', '--via', 'H1-end', '--peer', u1, '--forward', u1 + ',' + u3, '--port', String(p2), ...beat]))
  const h3 = await up(start('R1H3', ['--home', join(root, 'R1H3'), '--writer', 'foreign-r1h3', '--member', 'm-h3', '--end', 'H3-end', '--via', 'H2-end', '--peer', u2, '--forward', u2 + ',' + u4, '--port', String(p3), ...beat]))
  await up(start('R1E', ['--home', join(root, 'R1E'), '--writer', 'foreign-r1e', '--member', 'm-e', '--end', 'E-end', '--via', 'H3-end', '--peer', u3, '--tool', 'sum', '--port', String(p4), ...beat]))
  const joined = await waitFor(() => a.state().members.some((row) => row.id === 'm-e'))
  const readNow = Date.now() + 1000
  const realRoute = C.routes(a.state(), 'end-A', readNow, { timeoutMs: WINDOW }).find((row) => row.member === 'm-e')
  held('1c. four hops resolve in real processes (chosen instant, real relays)', joined && realRoute !== undefined && realRoute.hops === 4
    && J(realRoute.path) === J(['end-A', 'H1-end', 'H2-end', 'H3-end', 'E-end']),
    'joined=' + String(joined) + ' path=' + J(realRoute?.path ?? null))
  await a.log.append(C.dispatchRecord('job-four', 'm-e', 'sum', { a: 40, b: 2 }, Date.now()))
  const pushed = await pushOwn(u1, a.log)
  const answered = await waitFor(() => C.resolveDispatch(a.state(), 'job-four', Date.now()).verdict === 'answered')
  const entry = a.state().dispatches.dispatches.find((row) => row.id === 'job-four')
  held('1d. work and its answer travel four hops each way', answered && entry?.result?.ok === true && J(entry.result.value) === J({ sum: 42 }),
    'push=' + String(pushed.status) + ' answered=' + String(answered) + ' result=' + J(entry?.result ?? null))
  // Paired, real: the middle hop stops beating. Its beats carry the far end's beats too, so killing it
  // silences two members at once and WHICH deadline fires first decides the verdict - so the reason is
  // predicted from the two last beats and then compared with what the reading answers, instead of being
  // assumed. (The hop-only case, where a transit's silence is route-down and nothing else is stale, is
  // read deterministically in 1f.)
  h3.child.kill()
  // Let anything already in flight land before the instant is chosen from, or the reading would be about
  // a race rather than about a deadline.
  await sleep(1200)
  const beats = a.state().liveness.lastHeartbeat
  const hopBeat = beats['m-h3'] ?? null
  const farBeat = beats['m-e'] ?? null
  const first = hopBeat === null || farBeat === null ? null : Math.min(hopBeat, farBeat)
  const expected = hopBeat === null || farBeat === null ? null : (farBeat <= hopBeat ? 'member-silent' : 'route-down')
  const earlyChain = first === null ? null : C.assignThrough(a.state(), TEAM, 'm-e', 'end-A', first + 59_999, { timeoutMs: 60_000 })
  const deadChain = first === null ? null : C.assignThrough(a.state(), TEAM, 'm-e', 'end-A', first + 60_000, { timeoutMs: 60_000 })
  held('1e. a hop that stops beating cuts the chain: whole chain one millisecond before the first deadline, refused ON it, and the reason is the one the beats predict (paired, real)',
    earlyChain !== null && deadChain !== null && earlyChain.ok === true && earlyChain.hops === 4 && deadChain.ok === false && deadChain.reason === expected,
    'hopBeat=' + String(hopBeat) + ' farBeat=' + String(farBeat) + ' expected=' + String(expected) + ' early=' + J(earlyChain ?? null) + ' atDeadline=' + J(deadChain ?? null))

  // The hop-only case, chosen so that exactly one deadline is crossed: only the TRANSIT is silent, and a
  // silent transit is route-down (a missing host fact is no-route, which 1b reads).
  const silent = await synth('chain-silent-hop')
  await silent.member('m-h1', 'H1-end', null)
  await silent.member('m-h2', 'H2-end', 'H1-end')
  await silent.member('m-h3', 'H3-end', 'H2-end', T0 - 5_000)
  await silent.member('m-e', 'E-end', 'H3-end')
  const silentState = silent.state()
  const beforeHop = C.assignThrough(silentState, TEAM, 'm-e', 'end-A', T0 + 59_999 - 5_000, { timeoutMs: 60_000 })
  const onHop = C.assignThrough(silentState, TEAM, 'm-e', 'end-A', T0 + 60_000 - 5_000, { timeoutMs: 60_000 })
  held('1f. a silent transit is route-down exactly on its deadline, and the whole chain one millisecond earlier (paired, synthetic)',
    beforeHop.ok === true && beforeHop.hops === 4 && onHop.ok === false && onHop.reason === 'route-down' && onHop.path.includes('H2-end'),
    'before=' + J(beforeHop) + ' on=' + J(onHop))
  await closeWorld(silent)
  await closeWorld(a)
}

/* ---- 2. one transit, two far members ----------------------------------------------------------- */
{
  const fan = await synth('fan-out')
  await fan.member('m-t', 'T-end', null)
  await fan.member('m-c', 'C-end', 'T-end')
  await fan.member('m-d', 'D-end', 'T-end')
  const now = T0 + 10
  const rows = C.routes(fan.state(), 'end-A', now, { timeoutMs: WINDOW }).filter((row) => row.member === 'm-c' || row.member === 'm-d')
  held('2a. two far members behind one transit both resolve at two hops, and neither is folded away (synthetic)',
    rows.length === 2 && rows.every((row) => row.hops === 2) && J(rows[0].path) !== J(rows[1].path)
    && C.routeFailures(fan.state(), 'end-A', now, { timeoutMs: WINDOW }).length === 0,
    'rows=' + J(rows.map((row) => ({ m: row.member, hops: row.hops, path: row.path }))))
  const orphan = await synth('fan-out-quiet')
  await orphan.member('m-t', null, null)
  await orphan.member('m-c', 'C-end', 'T-end')
  await orphan.member('m-d', 'D-end', 'T-end')
  const orphanState = orphan.state()
  const bothGone = !C.routes(orphanState, 'end-A', now, { timeoutMs: WINDOW }).some((row) => row.member === 'm-c' || row.member === 'm-d')
  const bothFailed = C.routeFailures(orphanState, 'end-A', now, { timeoutMs: WINDOW }).filter((row) => row.member === 'm-c' || row.member === 'm-d')
  held('2b. without the transit both far members fail at once, with the same reason (paired)',
    bothGone && bothFailed.length === 2 && bothFailed[0].reason === bothFailed[1].reason,
    'inRoutes=false reason=' + J(bothFailed.map((row) => row.member + ':' + row.reason)))
  await closeWorld(fan, orphan)

  const a = await endpoint(join(root, 'r2-A'), 'end-A')
  const p1 = await freePort(), p2 = await freePort(), p3 = await freePort()
  const u1 = url(p1), u2 = url(p2), u3 = url(p3)
  await up(start('R2T', ['--home', join(root, 'R2T'), '--writer', 'foreign-r2t', '--member', 'm-t', '--end', 'T-end', '--peer', a.url, '--forward', a.url + ',' + u2 + ',' + u3, '--port', String(p1)]))
  await up(start('R2C', ['--home', join(root, 'R2C'), '--writer', 'foreign-r2c', '--member', 'm-c', '--end', 'C-end', '--via', 'T-end', '--peer', u1, '--tool', 'sum', '--port', String(p2)]))
  await up(start('R2D', ['--home', join(root, 'R2D'), '--writer', 'foreign-r2d', '--member', 'm-d', '--end', 'D-end', '--via', 'T-end', '--peer', u1, '--tool', 'sum', '--port', String(p3)]))
  const joined = await waitFor(() => ['m-t', 'm-c', 'm-d'].every((id) => a.state().members.some((row) => row.id === id)))
  const now2 = Date.now() + 1000
  const real = C.routes(a.state(), 'end-A', now2, { timeoutMs: WINDOW }).filter((row) => row.member === 'm-c' || row.member === 'm-d')
  held('2c. both far members resolve at two hops in real processes', joined && real.length === 2 && real.every((row) => row.hops === 2),
    'joined=' + String(joined) + ' rows=' + J(real.map((row) => ({ m: row.member, hops: row.hops }))))
  await a.log.append(C.dispatchRecord('job-c', 'm-c', 'sum', { a: 1, b: 2 }, Date.now()))
  await a.log.append(C.dispatchRecord('job-d', 'm-d', 'sum', { a: 3, b: 4 }, Date.now()))
  await pushOwn(u1, a.log)
  const bothAnswered = await waitFor(() => ['job-c', 'job-d'].every((id) => C.resolveDispatch(a.state(), id, Date.now()).verdict === 'answered'))
  const values = ['job-c', 'job-d'].map((id) => a.state().dispatches.dispatches.find((row) => row.id === id)?.result?.value ?? null)
  held('2d. both fan-out members answer, and neither answer lands on the other', bothAnswered && J(values) === J([{ sum: 3 }, { sum: 7 }]),
    'answered=' + String(bothAnswered) + ' values=' + J(values))
  await closeWorld(a)
}

/* ---- 3. two chains that cross on one end (synthetic: one process declares one --end/--via) ------ */
{
  const cross = await synth('crossing')
  await cross.member('m-b', 'B-end', null)
  await cross.member('m-d', 'D-end', null)
  await cross.member('m-1', 'E-end', 'B-end')
  await cross.member('m-2', 'E-end', 'D-end')
  const now = T0 + 10
  const state = cross.state()
  const one = C.routes(state, 'end-A', now, { timeoutMs: WINDOW }).find((row) => row.member === 'm-1')
  const two = C.routes(state, 'end-A', now, { timeoutMs: WINDOW }).find((row) => row.member === 'm-2')
  const failures = C.routeFailures(state, 'end-A', now, { timeoutMs: WINDOW })
  const again = J(C.routes(C.projectTeamState(cross.log.replay()), 'end-A', now, { timeoutMs: WINDOW }))
  held('3a. two members on one end keep two different paths, and neither is a failure (synthetic)',
    one !== undefined && two !== undefined && J(one.path) !== J(two.path) && one.path[1] === 'B-end' && two.path[1] === 'D-end' && failures.length === 0,
    'one=' + J(one?.path ?? null) + ' two=' + J(two?.path ?? null) + ' failures=' + String(failures.length))
  held('3b. the same instant read twice gives the same table, byte for byte',
    again === J(C.routes(state, 'end-A', now, { timeoutMs: WINDOW })), 'readTwice=' + String(again === J(C.routes(state, 'end-A', now, { timeoutMs: WINDOW }))))
  await closeWorld(cross)
}

/* ---- 4. a cycle must not poison the table ----------------------------------------------------- */
{
  const mixed = await synth('cycle-bypass')
  await mixed.member('m-x', 'X-end', 'Y-end')
  await mixed.member('m-y', 'Y-end', 'X-end')
  await mixed.member('m-q', 'Q-end', null)
  await mixed.member('m-p', 'P-end', 'Q-end')
  const now = T0 + 10
  const state = mixed.state()
  const routed = C.routes(state, 'end-A', now, { timeoutMs: WINDOW })
  const failures = C.routeFailures(state, 'end-A', now, { timeoutMs: WINDOW })
  const cyclic = failures.find((row) => row.member === 'm-x')
  const bypass = routed.find((row) => row.member === 'm-p')
  held('4a. a cycle is a verdict that names the closed edge, and it is not a route (synthetic)',
    cyclic !== undefined && cyclic.reason === 'path-cycle' && Array.isArray(cyclic.loop) && cyclic.loop.length > 0
    && cyclic.path.includes('X-end') && !routed.some((row) => row.member === 'm-x'),
    'cyclic=' + J(cyclic ?? null) + ' inRoutes=' + String(routed.some((row) => row.member === 'm-x')))
  held('4b. the bypass member is still ok in the SAME read - one bad chain does not poison the table (paired)',
    bypass !== undefined && bypass.hops === 2 && J(bypass.path) === J(['end-A', 'Q-end', 'P-end'])
    && failures.length === 2 && failures.every((row) => row.reason === 'path-cycle'),
    'bypass=' + J(bypass ?? null) + ' failures=' + J(failures.map((row) => row.member + ':' + row.reason)))
  await closeWorld(mixed)
}

for (const state of running) state.child.kill()
rmSync(root, { recursive: true, force: true })
let failed = 0
for (const [name, ok, detail] of readings) { if (ok !== true) failed += 1; console.log((ok === true ? '  ok    ' : '  FAIL  ') + name + '  |  ' + detail) }
console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
process.exit(failed === 0 ? 0 : 1)
