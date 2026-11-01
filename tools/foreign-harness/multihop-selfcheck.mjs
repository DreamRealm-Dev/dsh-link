#!/usr/bin/env node
/**
 * Lead self-check for the transit half of docs/protocol/device-net-v1.md: our end reaches a member
 * that runs behind a foreign transit, and work is handed over two hops.
 *
 *   end-A (ours)  --push-->  foreign-T (transit)  --forward-->  foreign-B (member m-b)
 *
 * The transit forwards a peer's records regrouped by their origin; `--naive-forward` sends its own
 * page instead, which is the paired negative that shows the regrouping carries the work.
 * Run: node tools/foreign-harness/multihop-selfcheck.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { createServer as createHttp } from 'node:http'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..')
const C = await import(pathToFileURL(join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')).href)
const FOREIGN = join(HERE, 'foreign-end.mjs')
const PATH = '/api/dsh-link-collab/relay'
const readings = []
const held = (name, ok, detail) => readings.push([name, ok === true, detail])
const freePort = () => new Promise((settle) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => settle(port)) }) })

const root = mkdtempSync(join(tmpdir(), 'r59-multihop-'))
const start = (args) => {
  // Long enough that the two hops outlive a few polls: the check kills them when it is done, and a
  // foreign end that stops on its own would turn a timing miss into a confusing transport failure.
  // `--port` appears exactly once, in the caller's args: the flag reader takes the FIRST match, so a
  // default here would silently win and the end would listen somewhere other than the URL we hand out.
  const child = spawn(process.execPath, [FOREIGN, '--token', 'tok', '--rounds', '400', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
  const state = { pid: child.pid, ready: null, done: null, forwards: [], child }
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message = null
    try { message = JSON.parse(line) } catch { return }
    if (message.ready === true) state.ready = message
    if (message.done === true) state.done = message
    if (message.wire === 'forward') state.forwards.push(message)
  })
  return state
}
const arrive = async (state, key) => { for (let i = 0; i < 120 && state.ready === null; i += 1) await new Promise((settle) => setTimeout(settle, 50)); return state.ready }

const logA = C.openControlLog({ dir: join(root, 'end-A'), writer: 'end-A' })
const endpoint = C.createRelayEndpoint({ token: 'tok', log: logA })
const httpA = createHttp(endpoint.handler)
await new Promise((settle) => httpA.listen(0, '127.0.0.1', settle))
const urlA = 'http://127.0.0.1:' + String(httpA.address().port) + endpoint.path

const portT = await freePort()
const portB = await freePort()
const urlT = 'http://127.0.0.1:' + String(portT) + PATH
const urlB = 'http://127.0.0.1:' + String(portB) + PATH
const transit = start(['--home', join(root, 'T'), '--writer', 'foreign-t', '--member', 'm-t', '--end', 'T-end', '--peer', urlA, '--forward', urlB + ',' + urlA, '--beat-every', '500', '--port', String(portT), ...(process.argv.includes('--naive') ? ['--naive-forward'] : [])])
await arrive(transit)
const far = start(['--home', join(root, 'B'), '--writer', 'foreign-b', '--member', 'm-b', '--end', 'B-end', '--via', 'T-end', '--peer', urlT, '--tool', 'sum', '--port', String(portB)])
await arrive(far)

const state = () => C.projectTeamState(logA.replay())
const waitFor = async (check, budget = 80) => { for (let i = 0; i < budget; i += 1) { if (check()) return true; await new Promise((settle) => setTimeout(settle, 100)) } return check() }
const now = Date.now() + 1000
const opts = { timeoutMs: 60_000 }

const joined = await waitFor(() => state().members.some((row) => row.id === 'm-b'))
const after = state()
const hostB = after.members.find((row) => row.id === 'm-b')
held('1. the far member joined THROUGH the transit (its host fact crossed two hops)', joined && hostB !== undefined, 'members=' + JSON.stringify(after.members.map((row) => row.id)))

const routeB = C.routes(after, 'end-A', now, opts).find((row) => row.member === 'm-b')
held('2. the chain resolves to the far end, hop by hop', routeB !== undefined && JSON.stringify(routeB.path) === JSON.stringify(['end-A', 'T-end', 'B-end']) && routeB.hops === 2, 'route=' + JSON.stringify(routeB ?? null))

const admitted = C.assignThrough(after, 'team-1', 'm-b', 'end-A', now, opts)
held('3. the ledger admits work for it over the whole chain', admitted.ok === true && admitted.reason === 'ok' && admitted.hops === 2, JSON.stringify(admitted))

await logA.append(C.dispatchRecord('job-hop', 'm-b', 'sum', { a: 20, b: 22 }, Date.now()))
const batchToT = { writer: logA.writer, instance: logA.instance, records: logA.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at })) }
let pushed = { status: 0 }
try {
  pushed = await fetch(urlT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok' }, body: JSON.stringify(batchToT) })
} catch (error) {
  pushed = { status: 0, error: String(error?.cause?.code ?? error?.message ?? error) }
}
const answered = await waitFor(() => C.resolveDispatch(state(), 'job-hop', Date.now()).verdict === 'answered')
const entry = state().dispatches.dispatches.find((row) => row.id === 'job-hop')
held('4. two hops carried the work out and the answer back', answered && entry?.result?.ok === true && JSON.stringify(entry.result.value) === JSON.stringify({ sum: 42 }), 'push=' + String(pushed.status) + ' result=' + JSON.stringify(entry?.result ?? null))

const heartbeats = logA.replay().filter((row) => row.kind === 'member/heartbeat')
const told = heartbeats.map((row) => [row.subject, row.payload?.at])
const lateNow = now + 120_000
const silent = C.assignThrough(state(), 'team-1', 'm-b', 'end-A', lateNow, { timeoutMs: 60_000 })
held('5. when the transit goes quiet the chain stops AT the transit, and the far member is a different answer', silent.reason === 'route-down' && JSON.stringify(silent.path) === JSON.stringify(['end-A', 'T-end']), 'verdict=' + JSON.stringify(silent) + ' heartbeats=' + JSON.stringify(told))

// The pair for the reading above: a transit that is still beating while the member behind it is quiet
// is a different answer (`member-silent`), so "the road is broken" and "the member went quiet" stay
// two facts. The transit keeps beating (--beat-every), the far member beat once and then stopped.
// Read at a real instant, once the far member's only beat is older than the threshold while the
// transit (beating every 500 ms) is still inside it: a synthetic future instant would make BOTH
// look stale, which is the reading above, not this one.
const farBeatAt = logA.replay().filter((row) => row.kind === 'member/heartbeat' && row.subject === 'm-b').map((row) => row.payload?.at ?? 0).pop() ?? 0
let waited = 0
while (Date.now() - farBeatAt < 3_600 && waited < 8_000) { await new Promise((settle) => setTimeout(settle, 200)); waited += 200 }
const realNow = Date.now()
const farSilent = C.assignThrough(state(), 'team-1', 'm-b', 'end-A', realNow, { timeoutMs: 3_000 })
const transitAlive = C.assignThrough(state(), 'team-1', 'm-t', 'end-A', realNow, { timeoutMs: 3_000 })
held('6. a live transit with a quiet member behind it is member-silent, not route-down', farSilent.reason === 'member-silent' && transitAlive.ok === true, 'far=' + JSON.stringify(farSilent) + ' transit=' + JSON.stringify(transitAlive))

transit.child.kill()
far.child.kill()
httpA.close()
await logA.close()
rmSync(root, { recursive: true, force: true })
let failed = 0
for (const [name, ok, detail] of readings) { if (ok !== true) failed += 1; console.log((ok === true ? '  ok    ' : '  FAIL  ') + name + '  |  ' + detail) }
console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
process.exit(failed === 0 ? 0 : 1)
