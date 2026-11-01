#!/usr/bin/env node
/**
 * R62 self-check: what a dispatcher does about work that was never answered.
 *
 * The rule is a pure function of the ledger and the caller's clock, and the write face re-derives it,
 * so the readings below are about decisions (planned, blocked and why) and about the executor not
 * running an attempt a later attempt has superseded.
 * Run: node plugins/dsh-link-collab/test/redispatch-selfcheck.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const C = await import(pathToFileURL(join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')).href)
const T0 = 1_800_000_000_000
const TEAM = 'team-1'
const readings = []
const held = (name, ok, detail) => readings.push([name, ok === true, detail])
const root = mkdtempSync(join(tmpdir(), 'r62-redispatch-'))
let world = 0

const fresh = async (options = {}) => {
  world += 1
  const log = C.openControlLog({ dir: join(root, 'w' + String(world)), writer: 'end-A' })
  await log.append(C.capabilityRecord('m-b', options.capabilities ?? ['sum']))
  await log.append({ kind: 'member/state', actor: TEAM, subject: 'm-b', payload: { id: 'm-b', name: 'm-b', state: 'active', role: 'member' } })
  await log.append(C.hostRecord('m-b', options.end ?? 'end-A', options.via ?? null, T0))
  await log.append(C.heartbeatRecord('m-b', options.beatAt ?? T0))
  const state = () => C.projectTeamState(log.replay())
  return { log, state }
}

const w = await fresh()
await w.log.append(C.dispatchRecord('job', 'm-b', 'sum', { a: 1, b: 2 }, T0))
const plan = C.redispatchPlan(w.state(), { team: TEAM, localEnd: 'end-A', now: T0 + 1000, timeoutMs: 1000, maxAttempts: 5 })
const entry = plan.entries[0]
held('1. a stale dispatch becomes one named attempt', plan.entries.length === 1 && entry?.from === 'job' && entry.id === 'job#r2' && entry.attempt === 2 && entry.to === 'm-b' && entry.tool === 'sum', JSON.stringify(plan))

const boundary = C.redispatchPlan(w.state(), { team: TEAM, localEnd: 'end-A', now: T0 + 1000, timeoutMs: 1000, maxAttempts: 5 })
const freshNow = C.redispatchPlan(w.state(), { team: TEAM, localEnd: 'end-A', now: T0 + 999, timeoutMs: 1000, maxAttempts: 5 })
held('2. the threshold is inclusive and a fresh wait plans nothing (paired)', boundary.entries.length === 1 && freshNow.entries.length === 0, 'at-threshold=' + String(boundary.entries.length) + ' one-ms-short=' + String(freshNow.entries.length))

const written = await C.appendRedispatches(w.state(), w.log, { team: TEAM, localEnd: 'end-A', now: T0 + 1000, timeoutMs: 1000, maxAttempts: 5 })
const after = w.state()
const retried = after.dispatches.dispatches.find((row) => row.id === 'job#r2')
// R341: the write face appends the root CLAIM and then the attempt (appendRedispatches), so two records is the
// intended shape; this reading expected one from before the claim rule landed.
held('3. the write face appends the claim and the attempt the plan named', written.length === 2 && retried?.status === 'pending' && retried?.retryOf === 'job' && retried?.attempt === 2, 'written=' + JSON.stringify(written) + ' (claim + attempt) entry=' + JSON.stringify(retried ?? null))

const again = await C.appendRedispatches(w.state(), w.log, { team: TEAM, localEnd: 'end-A', now: T0 + 1000, timeoutMs: 1000, maxAttempts: 5 })
const blockedNow = C.redispatchPlan(w.state(), { team: TEAM, localEnd: 'end-A', now: T0 + 1000, timeoutMs: 1000, maxAttempts: 5 })
held('4. re-planning invents nothing: the attempt is already in the ledger and it says so', again.length === 0 && blockedNow.entries.length === 0 && blockedNow.blocked.some((row) => row.from === 'job' && row.reason === 'already-attempted'), 'again=' + JSON.stringify(again) + ' blocked=' + JSON.stringify(blockedNow.blocked))

const capped = C.redispatchPlan(after, { team: TEAM, localEnd: 'end-A', now: T0 + 1000, timeoutMs: 1000, maxAttempts: 1 })
// The pair: the same ledger under a cap that still allows attempt 2 is refused for the OTHER reason,
// so "the cap stopped it" and "that id already exists" stay two different answers.
const atCap = C.redispatchPlan(after, { team: TEAM, localEnd: 'end-A', now: T0 + 1000, timeoutMs: 1000, maxAttempts: 2 })
held('5. the attempt cap is a reason, and it is a different reason from an existing attempt', capped.entries.length === 0 && capped.blocked.some((row) => row.reason === 'attempts-exhausted') && atCap.blocked.some((row) => row.reason === 'already-attempted'), 'cap-1=' + JSON.stringify(capped.blocked) + ' cap-2=' + JSON.stringify(atCap.blocked))

const tools = C.createLocalTools()
tools.register('sum', (args) => ({ sum: args.a + args.b }))
const execution = await C.executeDispatches(w.state(), { local: 'm-b', tools, log: w.log, now: T0 + 2000, at: T0 + 2000 })
const ranIds = execution.executed.map((row) => row.id)
held('6. the executor runs the new attempt and refuses the superseded one', JSON.stringify(ranIds) === '["job#r2"]' && execution.refused.some((row) => row.id === 'job' && row.reason === 'superseded'), 'executed=' + JSON.stringify(ranIds) + ' refused=' + JSON.stringify(execution.refused))

const remote = await fresh({ end: 'B-end', beatAt: T0 })
await remote.log.append(C.dispatchRecord('far', 'm-b', 'sum', {}, T0))
const staleRoute = C.redispatchPlan(remote.state(), { team: TEAM, localEnd: 'end-A', now: T0 + 5000, timeoutMs: 1000, maxAttempts: 5 })
const staleReason = staleRoute.blocked.find((row) => row.from === 'far')?.reason
held('7. a member that cannot be reached right now is blocked with the routing verdict, not retried blindly', staleRoute.entries.length === 0 && staleReason === 'member-silent', 'blocked=' + JSON.stringify(staleRoute.blocked))

// Capability has ONE owner (the projection, R53): a member that no longer declares the tool makes the
// dispatch `refused` there, so it is never stale and never reaches the replanner. The pair is a world
// where the capability is present, which plans normally.
const withoutTool = await fresh({ capabilities: [] })
await withoutTool.log.append(C.dispatchRecord('gone', 'm-b', 'sum', {}, T0))
const withdrawn = withoutTool.state()
const noTool = C.redispatchPlan(withdrawn, { team: TEAM, localEnd: 'end-A', now: T0 + 5000, timeoutMs: 1000, maxAttempts: 5 })
const verdict = C.resolveDispatch(withdrawn, 'gone', T0 + 5000, { timeoutMs: 1000 })
const withTool = await fresh({ capabilities: ['sum'] })
await withTool.log.append(C.dispatchRecord('here', 'm-b', 'sum', {}, T0))
const plain = C.redispatchPlan(withTool.state(), { team: TEAM, localEnd: 'end-A', now: T0 + 5000, timeoutMs: 1000, maxAttempts: 5 })
held('8. capability keeps one owner: a withdrawn tool is refused by the projection and is not replannable, while the same world with the capability plans (paired)', noTool.entries.length === 0 && noTool.blocked.length === 0 && verdict.verdict === 'refused' && plain.entries.length === 1, 'refused-verdict=' + JSON.stringify(verdict) + ' replan=' + JSON.stringify(noTool) + ' with-capability=' + JSON.stringify(plain.entries.map((row) => row.id)))

for (const entryLog of [w, remote, withoutTool, withTool]) await entryLog.log.close()
rmSync(root, { recursive: true, force: true })
let failed = 0
for (const [name, ok, detail] of readings) { if (ok !== true) failed += 1; console.log((ok === true ? '  ok    ' : '  FAIL  ') + name + '  |  ' + detail) }
console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
process.exit(failed === 0 ? 0 : 1)
