#!/usr/bin/env node
/**
 * R71 (T34): every threshold verdict read at the equality instant.
 *
 * R54 put one boundary rule on staleness ("at exactly the threshold the wait has lasted the whole
 * timeout") and R69 put the same discipline on a lease. The other thresholds - the heartbeat that
 * decides liveness, the route verdict that decides "the road is broken" against "the member went
 * quiet" - were never read AT the equality instant, so nobody could tell whether they agree with the
 * two that were.
 *
 * Method: every verdict here is read from a real on-disk control log through the shipped module, and
 * every instant is CHOSEN and passed in (no sleeping, no waiting): each threshold is read 1ms before,
 * exactly at, and 1ms past its own boundary. A reading that does not move across the boundary fails,
 * because it is then not measuring the boundary at all.
 *
 * The thresholds live in their own ledgers on purpose: an interaction found while writing this (a lease
 * for a root makes an EARLIER dispatch of that root by a non-holder read as lease-mismatch) would
 * otherwise hide the staleness boundary behind it. That interaction is reported separately below.
 *
 * Self-check, not a gate.
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
const THRESHOLD = 1000
const readings = []
const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail })
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const freePort = () => new Promise((settle) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => settle(port)) }) })

const root = mkdtempSync(join(tmpdir(), 'r71-threshold-'))
const running = []
const AT = (delta) => T0 + THRESHOLD + delta

/* ------------------------------------------------------------------------------------------------
 * Legs 1 and 3: staleness and liveness, read from one real log with no lease in it.
 * ---------------------------------------------------------------------------------------------- */
const logA = C.openControlLog({ dir: join(root, 'A', 'end-A'), writer: 'end-A' })
await logA.append({ kind: 'member/state', actor: TEAM, subject: 'm-a', payload: { id: 'm-a', state: 'active', name: 'm-a' } })
await logA.append(C.capabilityRecord('m-a', ['sum']))
await logA.append(C.dispatchRecord('job-1', 'm-a', 'sum', {}, T0))
await logA.append(C.heartbeatRecord('m-a', T0))

const stateA = () => C.projectTeamState(logA.replay())
const rowFor = (delta) => ({
  delta,
  dispatch: C.resolveDispatch(stateA(), 'job-1', AT(delta), { timeoutMs: THRESHOLD }).verdict,
  expired: C.expiredDispatches(stateA(), AT(delta), { timeoutMs: THRESHOLD }),
  planned: C.redispatchPlan(stateA(), { team: TEAM, localEnd: 'end-A', now: AT(delta), timeoutMs: THRESHOLD, maxAttempts: 3 }).entries.map((entry) => entry.id),
  liveness: (C.livenessOf(stateA(), AT(delta), { timeoutMs: THRESHOLD }).find((row) => row.memberId === 'm-a') ?? {}).liveness,
  quarantined: C.isQuarantined(stateA(), 'm-a', AT(delta), { timeoutMs: THRESHOLD }),
})
const table = [rowFor(-1), rowFor(0), rowFor(1)]
const [before, exactly, after] = table
const spread = (key) => table.map((row) => String(row.delta) + ':' + String(row[key])).join(' ')

held('T1a', 'the dispatch verdict is pending 1ms before, stale at and past the threshold (paired: the two sides differ)',
  before.dispatch === 'pending' && exactly.dispatch === 'stale' && after.dispatch === 'stale' && before.dispatch !== after.dispatch,
  'dispatch=' + spread('dispatch'))
held('T1b', 'the expiry list holds the id from the equality instant on, and not one millisecond earlier',
  before.expired.length === 0 && String(exactly.expired) === 'job-1' && String(after.expired) === 'job-1',
  'expired=' + table.map((row) => String(row.delta) + ':[' + row.expired.join(',') + ']').join(' '))
held('T1c', 'the re-dispatch pass plans the next attempt from the equality instant on, and nothing before it',
  before.planned.length === 0 && String(exactly.planned) === 'job-1#r2' && String(after.planned) === 'job-1#r2',
  'planned=' + table.map((row) => String(row.delta) + ':[' + row.planned.join(',') + ']').join(' '))
held('T1d', 'the list, the pass and the verdict are one answer over the three instants',
  table.every((row) => (row.dispatch === 'stale') === (row.planned.length > 0) && (row.dispatch === 'stale') === row.expired.includes('job-1')),
  'agreement over the three instants: ' + String(table.every((row) => (row.dispatch === 'stale') === (row.planned.length > 0))))
held('T3a', 'a member is healthy 1ms before the threshold and unhealthy at and past it (paired)',
  before.liveness === 'healthy' && exactly.liveness === 'unhealthy' && after.liveness === 'unhealthy' && before.liveness !== after.liveness,
  'liveness=' + spread('liveness'))
held('T3b', 'quarantine follows the same instant as liveness (one boundary, not two)',
  before.quarantined === false && exactly.quarantined === true && after.quarantined === true
  && table.every((row) => row.quarantined === (row.liveness === 'unhealthy')),
  'quarantined=' + spread('quarantined'))
held('T4', 'the same instant read twice is byte-identical (a verdict is a function of the ledger and now)',
  JSON.stringify(rowFor(1)) === JSON.stringify(rowFor(1)) && JSON.stringify(rowFor(0)) === JSON.stringify(rowFor(0)),
  'rowFor(1) and rowFor(0) read twice: identical')
held('T5', 'the three boundaries put the equality on the same side: stale inclusive, liveness inclusive',
  exactly.dispatch === 'stale' && exactly.liveness === 'unhealthy' && before.dispatch === 'pending' && before.liveness === 'healthy',
  'equality: stale=' + exactly.dispatch + ' liveness=' + exactly.liveness)
await logA.close()

/* ------------------------------------------------------------------------------------------------
 * Leg 2: the lease boundary, in its own ledger (root job-2, which no dispatch refers to).
 * ---------------------------------------------------------------------------------------------- */
const logB = C.openControlLog({ dir: join(root, 'B', 'end-A'), writer: 'end-A' })
await logB.append(C.retryLeaseRecord('job-2', 'end-B', T0, THRESHOLD))
const leases = () => C.projectRetryLeases(logB.replay())
const ownerFor = (delta) => C.retryOwner(leases(), { root: 'job-2', localEnd: 'end-A', now: AT(delta) })
const owners = [ownerFor(-1), ownerFor(0), ownerFor(1)]
held('T2', 'a lease is live 1ms before its boundary and expired at and past it (paired: the two sides differ)',
  owners[0].reason === 'other' && owners[1].reason === 'expired' && owners[2].reason === 'expired'
  && owners[0].reason !== owners[2].reason && owners[0].mine === false,
  'owner=' + owners.map((row, index) => String([-1, 0, 1][index]) + ':' + row.reason).join(' '))
held('T2b', 'the holder is the same end on both sides of the boundary (expiry changes liveness, not identity)',
  owners[0].holder === 'end-B' && owners[1].holder === null && owners[2].holder === null,
  'holder=' + owners.map((row) => String(row.holder)).join('/'))

/* ------------------------------------------------------------------------------------------------
 * Finding (reported, not judged here): a lease for a root also governs an EARLIER dispatch of that root.
 * ---------------------------------------------------------------------------------------------- */
await logB.append(C.dispatchRecord('job-2', 'm-a', 'sum', {}, T0))
const interaction = C.projectTeamState(logB.replay())
const finding = {
  observed: 'a task/dispatch of a root with a live lease, written by an end that is not the holder, is read as lease-mismatch',
  dispatches: interaction.dispatches.dispatches.map((row) => row.id),
  refused: (interaction.dispatches.refusedDispatches ?? []).map((row) => row.id + ':' + row.reason),
  note: 'the record carries no actor (dispatchRecord sets none), so the fold falls back to the writer, which is not the lease holder',
}
await logB.close()

/* ------------------------------------------------------------------------------------------------
 * Leg 4: route-down against member-silent, read at chosen instants around the TRANSIT boundary, with
 * two real foreign processes (their own homes, writers and ports, exactly as the multi-hop self-check
 * wires them).
 * ---------------------------------------------------------------------------------------------- */
const logR = C.openControlLog({ dir: join(root, 'R', 'end-A'), writer: 'end-A' })
const endpoint = C.createRelayEndpoint({ token: 'tok', log: logR })
const httpA = createHttp(endpoint.handler)
await new Promise((settle) => httpA.listen(0, '127.0.0.1', settle))
const urlA = 'http://127.0.0.1:' + String(httpA.address().port) + PATH
const start = (label, args) => {
  const child = spawn(process.execPath, [FOREIGN, '--token', 'tok', '--rounds', '400', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
  const state = { label, pid: child.pid, ready: null, child }
  createInterface({ input: child.stdout }).on('line', (line) => { let m = null; try { m = JSON.parse(line) } catch { return } if (m.ready === true) state.ready = m })
  running.push(state)
  return state
}
const up = async (state) => { for (let i = 0; i < 120 && state.ready === null; i += 1) await sleep(50); if (state.ready === null) throw new Error('never came up: ' + state.label) }
const waitFor = async (check, budget = 80) => { for (let i = 0; i < budget; i += 1) { if (check()) return true; await sleep(100) } return check() }

const transitPort = await freePort()
const farPort = await freePort()
const transitUrl = 'http://127.0.0.1:' + String(transitPort) + PATH
const farUrl = 'http://127.0.0.1:' + String(farPort) + PATH
const transit = start('T', ['--home', join(root, 'T'), '--writer', 'foreign-t', '--member', 'm-t', '--end', 'T-end', '--peer', urlA, '--forward', farUrl + ',' + urlA, '--port', String(transitPort), '--beat-every', '5000', '--tool', 'sum'])
await up(transit)
const far = start('B', ['--home', join(root, 'B'), '--writer', 'foreign-b', '--member', 'm-b', '--end', 'B-end', '--via', 'T-end', '--peer', transitUrl, '--port', String(farPort), '--no-heartbeat', '--tool', 'sum'])
await up(far)
const joined = await waitFor(() => C.projectTeamState(logR.replay()).members.some((row) => row.id === 'm-b'))
const beats = logR.replay().filter((record) => record.kind === C.HEARTBEAT_KIND && record.payload?.id === 'm-t').map((record) => record.payload.at)
const lastBeat = beats.length === 0 ? null : Math.max(...beats)
const routeAt = (delta, member) => C.assignThrough(C.projectTeamState(logR.replay()), TEAM, member, 'end-A', (lastBeat ?? Date.now()) + THRESHOLD + delta, { timeoutMs: THRESHOLD })
const transitRoute = [-1, 0, 1].map((delta) => routeAt(delta, 'm-t'))
const farRoute = [-1, 0, 1].map((delta) => routeAt(delta, 'm-b'))
held('T6', 'a live transit in front of a member that never beat is member-silent, read 1ms before the transit boundary',
  joined && lastBeat !== null && farRoute[0].reason === 'member-silent' && transitRoute[0].reason === 'ok',
  'joined=' + String(joined) + ' lastBeat=' + String(lastBeat) + ' far=' + farRoute[0].reason + ' transit=' + transitRoute[0].reason)
// The same instant, two questions, two different words - which is the point of R59/R60's split. A member
// BEHIND the transit is route-down once the transit stops beating (the road is broken); the transit asked
// about ITSELF is member-silent (its own heartbeat is what aged out; there is no further hop to blame).
held('T7', 'past the transit boundary a member behind it is route-down while the transit itself is member-silent (paired on both)',
  transitRoute[0].reason === 'ok' && transitRoute[1].reason === 'member-silent' && transitRoute[2].reason === 'member-silent'
  && farRoute[0].reason === 'member-silent' && farRoute[1].reason === 'route-down' && farRoute[2].reason === 'route-down'
  && transitRoute[0].reason !== transitRoute[1].reason && farRoute[0].reason !== farRoute[1].reason
  && transitRoute[1].reason !== farRoute[1].reason,
  'transit=' + transitRoute.map((row) => row.reason).join('/') + ' far=' + farRoute.map((row) => row.reason).join('/'))
held('T8', 'the route legs read one chosen instant twice identically',
  JSON.stringify(routeAt(0, 'm-t')) === JSON.stringify(routeAt(0, 'm-t')),
  'routeAt(0,m-t) read twice: identical')

httpA.close()
await logR.close()
for (const state of running) state.child.kill()
rmSync(root, { recursive: true, force: true })

const failed = readings.filter((reading) => !reading.ok)
console.log(JSON.stringify({ threshold: THRESHOLD, instants: [-1, 0, 1], matrix: table, leaseOwners: owners.map((row) => row.reason), route: { lastBeat, transit: transitRoute.map((row) => row.reason), far: farRoute.map((row) => row.reason) }, finding }, undefined, 2))
for (const reading of readings) console.log((reading.ok ? '  ok    ' : '  FAIL  ') + reading.id + ' ' + reading.name + '  |  ' + reading.detail)
console.log(readings.length - failed.length + ' of ' + readings.length + ' readings held')
process.exitCode = failed.length === 0 ? 0 : 1
