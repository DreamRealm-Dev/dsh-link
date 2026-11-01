#!/usr/bin/env node
/**
 * Lead self-check for the multi-hop variants R59 left unread: a deterministic silence reading, a
 * three-hop chain, and a loop in the `via` chain.
 *
 * The silence reading is deterministic because every foreign end is given the instant to stamp
 * (`--at`), so "a live transit behind a quiet member" is decided by chosen instants rather than by
 * waiting on a wall clock: the judgement itself already takes `now` as a parameter (R40), and this is
 * the harness finally feeding it one.
 * Run: node tools/foreign-harness/multihop-variants-selfcheck.mjs
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
const readings = []
const held = (name, ok, detail) => readings.push([name, ok === true, detail])
const freePort = () => new Promise((settle) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => settle(port)) }) })
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))

const root = mkdtempSync(join(tmpdir(), 'r60-variants-'))
const running = []
const start = (label, args) => {
  const child = spawn(process.execPath, [FOREIGN, '--token', 'tok', '--rounds', '400', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
  const state = { label, pid: child.pid, ready: null, child }
  createInterface({ input: child.stdout }).on('line', (line) => { let m = null; try { m = JSON.parse(line) } catch { return } if (m.ready === true) state.ready = m })
  running.push(state)
  return state
}
const up = async (state) => { for (let i = 0; i < 120 && state.ready === null; i += 1) await sleep(50); if (state.ready === null) throw new Error('never came up: ' + state.label); return state.ready }
const world = async () => {
  const dir = join(root, 'world-' + String(running.length))
  const log = C.openControlLog({ dir: join(dir, 'end-A'), writer: 'end-A' })
  const endpoint = C.createRelayEndpoint({ token: 'tok', log })
  const httpA = createHttp(endpoint.handler)
  await new Promise((settle) => httpA.listen(0, '127.0.0.1', settle))
  return { log, httpA, urlA: 'http://127.0.0.1:' + String(httpA.address().port) + PATH, state: () => C.projectTeamState(log.replay()) }
}
const waitFor = async (check, budget = 80) => { for (let i = 0; i < budget; i += 1) { if (check()) return true; await sleep(100) } return check() }

// ---- world 1: a live transit behind which the far member is quiet, decided by chosen instants ----
const w1 = await world()
const t1Port = await freePort(), b1Port = await freePort()
const urlT1 = 'http://127.0.0.1:' + String(t1Port) + PATH
const urlB1 = 'http://127.0.0.1:' + String(b1Port) + PATH
const transit1 = start('T1', ['--home', join(root, 'T1'), '--writer', 'foreign-t1', '--member', 'm-t', '--end', 'T-end', '--peer', w1.urlA, '--forward', urlB1 + ',' + w1.urlA, '--port', String(t1Port), '--at', String(T0 + 2500)])
await up(transit1)
const far1 = start('B1', ['--home', join(root, 'B1'), '--writer', 'foreign-b1', '--member', 'm-b', '--end', 'B-end', '--via', 'T-end', '--peer', urlT1, '--port', String(b1Port), '--at', String(T0)])
await up(far1)
const joined1 = await waitFor(() => w1.state().members.some((row) => row.id === 'm-b'))
const readNow = T0 + 3000
const farVerdict = C.assignThrough(w1.state(), TEAM, 'm-b', 'end-A', readNow, { timeoutMs: 3000 })
const transitVerdict = C.assignThrough(w1.state(), TEAM, 'm-t', 'end-A', readNow, { timeoutMs: 3000 })
held('1. a live transit with a quiet member behind it is member-silent, read from chosen instants (no waiting)', joined1 && farVerdict.reason === 'member-silent' && transitVerdict.ok === true, 'far=' + JSON.stringify(farVerdict) + ' transit=' + JSON.stringify(transitVerdict))
w1.httpA.close()
await w1.log.close()

// ---- world 2: three hops out, three hops back ----
const w2 = await world()
const p1 = await freePort(), p2 = await freePort(), p3 = await freePort()
const u1 = 'http://127.0.0.1:' + String(p1) + PATH, u2 = 'http://127.0.0.1:' + String(p2) + PATH, u3 = 'http://127.0.0.1:' + String(p3) + PATH
const hop1 = start('H1', ['--home', join(root, 'H1'), '--writer', 'foreign-h1', '--member', 'm-h1', '--end', 'H1-end', '--peer', u2, '--forward', u2 + ',' + w2.urlA, '--port', String(p1)])
await up(hop1)
const hop2 = start('H2', ['--home', join(root, 'H2'), '--writer', 'foreign-h2', '--member', 'm-h2', '--end', 'H2-end', '--via', 'H1-end', '--peer', u1, '--forward', u1 + ',' + u3, '--port', String(p2)])
await up(hop2)
const tail2 = start('B2', ['--home', join(root, 'B2'), '--writer', 'foreign-b2', '--member', 'm-b', '--end', 'B-end', '--via', 'H2-end', '--peer', u2, '--tool', 'sum', '--port', String(p3)])
await up(tail2)
const joined3 = await waitFor(() => w2.state().members.some((row) => row.id === 'm-b'))
const route3 = C.routes(w2.state(), 'end-A', Date.now() + 1000, { timeoutMs: 60_000 }).find((row) => row.member === 'm-b')
held('2. a three-hop chain resolves end to end', joined3 && route3 !== undefined && JSON.stringify(route3.path) === JSON.stringify(['end-A', 'H1-end', 'H2-end', 'B-end']) && route3.hops === 3, 'route=' + JSON.stringify(route3 ?? null))
await w2.log.append(C.dispatchRecord('job-three', 'm-b', 'sum', { a: 40, b: 2 }, Date.now()))
const push2 = await fetch(u1, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok' }, body: JSON.stringify({ writer: w2.log.writer, instance: w2.log.instance, records: w2.log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })) }) }).catch(() => ({ status: 0 }))
const answered3 = await waitFor(() => C.resolveDispatch(w2.state(), 'job-three', Date.now()).verdict === 'answered')
const entry3 = w2.state().dispatches.dispatches.find((row) => row.id === 'job-three')
held('3. work and its answer travel three hops each way', answered3 && entry3?.result?.ok === true && JSON.stringify(entry3.result.value) === JSON.stringify({ sum: 42 }), 'push=' + String(push2.status) + ' result=' + JSON.stringify(entry3?.result ?? null))
w2.httpA.close()
await w2.log.close()

// ---- world 3: a loop in the via chain is a cycle, not a long wait ----
const w3 = await world()
const q1 = await freePort(), q2 = await freePort()
const v1 = 'http://127.0.0.1:' + String(q1) + PATH, v2 = 'http://127.0.0.1:' + String(q2) + PATH
const loop1 = start('L1', ['--home', join(root, 'L1'), '--writer', 'foreign-l1', '--member', 'm-l1', '--end', 'L1-end', '--via', 'L2-end', '--peer', v2, '--forward', v2 + ',' + w3.urlA, '--port', String(q1)])
await up(loop1)
const loop2 = start('L2', ['--home', join(root, 'L2'), '--writer', 'foreign-l2', '--member', 'm-l2', '--end', 'L2-end', '--via', 'L1-end', '--peer', v1, '--forward', v1 + ',' + w3.urlA, '--port', String(q2)])
await up(loop2)
const joinedLoop = await waitFor(() => w3.state().members.some((row) => row.id === 'm-l2'))
const cyclic = C.assignThrough(w3.state(), TEAM, 'm-l2', 'end-A', Date.now() + 1000, { timeoutMs: 60_000 })
held('4. a loop in the chain is a cycle with the closed edge named, not a wait', joinedLoop && cyclic.reason === 'path-cycle' && cyclic.loop.length > 0, 'verdict=' + JSON.stringify(cyclic))
w3.httpA.close()
await w3.log.close()

for (const state of running) state.child.kill()
rmSync(root, { recursive: true, force: true })
let failed = 0
for (const [name, ok, detail] of readings) { if (ok !== true) failed += 1; console.log((ok === true ? '  ok    ' : '  FAIL  ') + name + '  |  ' + detail) }
console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
process.exit(failed === 0 ? 0 : 1)
