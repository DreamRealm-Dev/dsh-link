#!/usr/bin/env node
/**
 * Lead self-check for docs/protocol/device-net-v1.md: our end (shipped `createRelayEndpoint`) and a
 * foreign end (a real child process that imports none of our code) join, hand work over and answer it.
 *
 * This is the producer's own check, not the acceptance: scripts/verify-device-net-foreign.mjs is the
 * independent gate, and it writes its own misbehaving foreign ends for the refusal readings.
 * Run: node tools/foreign-harness/join-selfcheck.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const COLLAB = pathToFileURL(join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')).href
const C = await import(COLLAB)
const readings = []
const held = (name, ok, detail) => readings.push([name, ok === true, detail])

const root = mkdtempSync(join(tmpdir(), 'r57-foreign-'))
const logA = C.openControlLog({ dir: join(root, 'end-A'), writer: 'end-A' })
const endpoint = C.createRelayEndpoint({ token: 'tok', log: logA })
const serverA = createServer(endpoint.handler)
await new Promise((settle) => serverA.listen(0, '127.0.0.1', settle))
const portA = serverA.address().port
const urlA = 'http://127.0.0.1:' + String(portA) + endpoint.path

const child = spawn(process.execPath, [fileURLToPath(import.meta.url).replace('join-selfcheck.mjs', 'foreign-end.mjs'),
  '--home', join(root, 'foreign'), '--peer', urlA, '--token', 'tok', '--port', '0',
  '--member', 'm-foreign', '--team', 'team-1', '--tool', 'sum', '--rounds', '30'], { stdio: ['ignore', 'pipe', 'inherit'] })
let ready = null
let summary = null
const lines = createInterface({ input: child.stdout })
lines.on('line', (line) => {
  let message = null
  try { message = JSON.parse(line) } catch { return }
  if (message.ready === true) ready = message
  if (message.done === true) summary = message
})
for (let i = 0; i < 100 && ready === null; i += 1) await new Promise((settle) => setTimeout(settle, 50))
if (ready === null) { console.error('foreign end never came up'); process.exit(1) }
const urlForeign = 'http://127.0.0.1:' + String(ready.port) + endpoint.path
held('1. the foreign end is a real other process with its own route', child.pid !== process.pid && ready.port > 0, 'pid=' + String(child.pid) + ' port=' + String(ready.port) + ' pushed=' + JSON.stringify(ready.reached))

const batchOf = () => ({ writer: logA.writer, instance: logA.instance, records: logA.ownPage(0).map((r) => ({ seq: r.originSeq, kind: r.kind, actor: r.actor, subject: r.subject, payload: r.payload, at: r.at })) })
const push = async (url, token) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(batchOf()) })
  return { status: response.status, body: await response.json().catch(() => null) }
}
const wait = async (check, budget = 60) => { for (let i = 0; i < budget; i += 1) { if (check()) return true; await new Promise((settle) => setTimeout(settle, 100)) } return check() }

const foldedWhen = () => C.projectTeamState(logA.replay())
const arrived = await wait(() => foldedWhen().members.some((m) => m.id === 'm-foreign'))
const stateAfterJoin = foldedWhen()
held('2. the foreign end pushed its own declaration and our fold sees the member and its capability', arrived && C.capabilitiesOf(stateAfterJoin, 'm-foreign').includes('sum'), 'members=' + JSON.stringify(stateAfterJoin.members.map((m) => m.id)) + ' caps=' + JSON.stringify(C.capabilitiesOf(stateAfterJoin, 'm-foreign')))

// A batch of our own records would be refused as impersonation, so the pair below carries a third
// end's records: that is what the route is meant to receive, and it keeps the two legs comparable.
const stranger = { writer: 'other-end', instance: 'instance-1', records: [{ seq: 1, at: Date.now(), kind: 'member/state', actor: 'team-1', subject: 'm-other', payload: { id: 'm-other', state: 'active', role: 'member' } }] }
const lengthBefore = logA.replay().length
const wrongToken = await fetch(urlA, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer WRONG' }, body: JSON.stringify(stranger) })
const wrongBody = await wrongToken.json().catch(() => null)
const lengthAfterRefusal = logA.replay().length
const goodToken = await fetch(urlA, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok' }, body: JSON.stringify(stranger) })
const goodBody = await goodToken.json().catch(() => null)
held('3. a wrong secret is refused with the ledger untouched, and the right one is accepted (paired)', wrongToken.status === 401 && wrongBody?.code === 'UNAUTHORIZED' && lengthAfterRefusal === lengthBefore && goodToken.status === 200 && (goodBody?.appended ?? 0) > 0, 'denied=' + String(wrongToken.status) + '/' + String(wrongBody?.code) + ' ledger ' + String(lengthBefore) + '->' + String(lengthAfterRefusal) + ' then=' + String(goodToken.status) + '/appended ' + String(goodBody?.appended))

const now = Date.now()
await logA.append(C.dispatchRecord('job-ok', 'm-foreign', 'sum', { a: 3, b: 4 }, now))
await logA.append(C.dispatchRecord('job-bad', 'm-foreign', 'nope', {}, now))
const pushed = await push(urlForeign, 'tok')
const answered = await wait(() => C.resolveDispatch(foldedWhen(), 'job-ok', Date.now()).verdict === 'answered')
const folded = foldedWhen()
const entry = folded.dispatches.dispatches.find((row) => row.id === 'job-ok')
held('4. work handed to the foreign end came back answered, with the value it computed', answered && entry?.result?.ok === true && JSON.stringify(entry.result.value) === JSON.stringify({ sum: 7 }), 'pushed=' + JSON.stringify(pushed.body) + ' result=' + JSON.stringify(entry?.result ?? null))

await wait(() => summary !== null, 40)
const bad = C.resolveDispatch(foldedWhen(), 'job-bad', Date.now())
const refusedRow = foldedWhen().dispatches.refusedDispatches.find((row) => row.id === 'job-bad')
held('5. a tool the foreign end never declared is refused by the ledger, and it never ran there', bad.verdict === 'refused' && refusedRow?.reason === 'capability-mismatch' && summary !== null && !JSON.stringify(summary.executed).includes('job-bad'), 'verdict=' + JSON.stringify(bad) + ' refused=' + JSON.stringify(refusedRow) + ' foreign executed=' + JSON.stringify(summary?.executed ?? null))

child.kill()
serverA.close()
await logA.close()
rmSync(root, { recursive: true, force: true })
let failed = 0
for (const [name, ok, detail] of readings) { if (ok !== true) failed += 1; console.log((ok === true ? '  ok    ' : '  FAIL  ') + name + '  |  ' + detail) }
console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
process.exit(failed === 0 ? 0 : 1)
