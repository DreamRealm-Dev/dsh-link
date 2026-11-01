#!/usr/bin/env node
/**
 * R53: cross-end dispatch between two REAL processes, over real control logs.
 *
 * The parent spawns two child node processes. Each child opens its own control log on disk, and the
 * only thing that crosses between them is a relay batch the parent forwards — no shared memory, no
 * in-process shortcut. The parent then re-opens both ledgers after the children are gone, which is
 * the reading that says the answer lives outside the process that produced it.
 *
 * Run: node plugins/dsh-link-collab/test/two-process-dispatch.mjs
 * Exit 0 all readings held; 1 a reading failed.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MODULE = pathToFileURL(join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')).href
const NOW = 1_800_000_000_000
const batchOf = (log, C) => ({
  writer: log.writer,
  instance: log.instance,
  records: log.ownPage(0).map((record) => ({ seq: record.originSeq, kind: record.kind, actor: record.actor, subject: record.subject, payload: record.payload, at: record.at })),
})

async function child(end, root) {
  const C = await import(MODULE)
  const log = C.openControlLog({ dir: join(root, end), writer: end })
  const tools = C.createLocalTools()
  tools.register('echo', (args) => ({ echoed: args }))
  const state = () => C.projectTeamState(log.replay())
  const say = (message) => process.stdout.write(JSON.stringify(message) + '\n')
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === '') continue
    const message = JSON.parse(line)
    if (message.apply !== undefined) {
      await log.ingest(message.apply)
      say({ id: message.id, applied: log.replay().length })
    } else if (message.run === 'declare') {
      await log.append(C.capabilityRecord('m-b', ['echo']))
      await log.append({ kind: 'member/state', actor: end, subject: 'm-b', payload: { id: 'm-b', name: 'm-b', state: 'active', role: 'member' } })
      await log.append(C.hostRecord('m-b', end, null, NOW))
      await log.append(C.heartbeatRecord('m-b', NOW))
      say({ id: message.id, relay: batchOf(log, C) })
    } else if (message.run === 'dispatch') {
      await log.append(C.dispatchRecord('d-1', 'm-b', 'echo', { say: 'hi' }, NOW))
      await log.append(C.dispatchRecord('d-2', 'm-b', 'nope', {}, NOW))
      await log.append(C.dispatchRecord('d-1', 'm-b', 'echo', { say: 'again' }, NOW))
      const folded = state()
      say({
        id: message.id,
        relay: batchOf(log, C),
        ledger: log.replay().length,
        pending: folded.dispatches.pending,
        refused: folded.dispatches.refusedDispatches,
        verdicts: ['', 'd-1', 'd-2', 'd-none'].slice(1).map((id) => C.resolveDispatch(folded, id, NOW)),
      })
    } else if (message.run === 'execute') {
      const before = log.replay().length
      const execution = await C.executeDispatches(state(), { local: 'm-b', tools, log, now: NOW, at: NOW + 5 })
      say({ id: message.id, relay: batchOf(log, C), before, after: log.replay().length, execution })
    } else if (message.run === 'fold') {
      const folded = state()
      say({
        id: message.id,
        ledger: log.replay().length,
        writers: log.marks().map((mark) => mark.writer),
        dispatches: folded.dispatches.dispatches.map((entry) => ({ id: entry.id, status: entry.status, result: entry.result })),
        refusedResults: folded.dispatches.refusedResults,
        counts: folded.dispatches.counts,
      })
    } else if (message.run === 'exit') {
      await log.close()
      say({ id: message.id, closed: end })
      process.exit(0)
    }
  }
}

async function main() {
  if (process.argv[2] === '--end') return child(process.argv[3], process.argv[4])
  const readings = []
  const root = mkdtempSync(join(tmpdir(), 'r53-two-process-'))
  const start = (end) => {
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--end', end, root], { stdio: ['pipe', 'pipe', 'inherit'] })
    const waiting = new Map()
    createInterface({ input: proc.stdout }).on('line', (line) => {
      const message = JSON.parse(line)
      const settle = waiting.get(message.id)
      if (settle !== undefined) waiting.delete(message.id)
      if (settle !== undefined) settle(message)
    })
    let counter = 0
    return {
      pid: proc.pid,
      ask: (body) => new Promise((settle) => { counter += 1; const id = end + ':' + String(counter); waiting.set(id, settle); proc.stdin.write(JSON.stringify({ id, ...body }) + '\n') }),
      stop: () => proc.stdin.end(),
      exited: new Promise((settle) => proc.on('exit', settle)),
    }
  }
  const a = start('end-A')
  const b = start('end-B')
  readings.push(['1. two children, not this process and not each other', a.pid !== b.pid && a.pid !== process.pid && b.pid !== process.pid, a.pid + ' / ' + b.pid + ' vs ' + String(process.pid)])

  const declared = await b.ask({ run: 'declare' })
  const seenByA = await a.ask({ apply: declared.relay })
  readings.push(['2. B declares a member, a capability and a heartbeat; A ingests the batch', seenByA.applied >= 4, 'A holds ' + String(seenByA.applied) + ' record(s)'])

  const dispatched = await a.ask({ run: 'dispatch' })
  const d1 = dispatched.verdicts.find((v) => v.id === 'd-1')
  const d2 = dispatched.verdicts.find((v) => v.id === 'd-2')
  readings.push(['3. the capability ledger refuses the tool nobody declared, before anything runs', d1.verdict === 'pending' && d2.verdict === 'refused' && dispatched.refused.length === 2 && dispatched.refused.every((row) => row.reason === 'duplicate-id' || row.reason === 'capability-mismatch'), JSON.stringify(dispatched.verdicts) + ' refused=' + JSON.stringify(dispatched.refused)])

  const seenByB = await b.ask({ apply: dispatched.relay })
  const executed = await b.ask({ run: 'execute' })
  const ran = executed.execution.executed.map((row) => row.id)
  readings.push(['4. B runs only the dispatch addressed to it and to a tool it has', JSON.stringify(ran) === '["d-1"]' && executed.execution.refused.length === 0 && executed.after === executed.before + 1, 'executed=' + JSON.stringify(executed.execution.executed.map((row) => [row.id, row.outcome.ok, row.outcome.value])) + ' ledger ' + String(executed.before) + '->' + String(executed.after)])

  const again = await b.ask({ run: 'execute' })
  readings.push(['5. a second pass runs nothing: the one answer a dispatch has is already spent', again.execution.executed.length === 0 && again.after === again.before, 'executed=' + String(again.execution.executed.length) + ' ledger ' + String(again.before) + '->' + String(again.after)])

  const answerSeenByA = await a.ask({ apply: executed.relay })
  const foldA = await a.ask({ run: 'fold' })
  const entryA = foldA.dispatches.find((entry) => entry.id === 'd-1')
  readings.push(['6. A folds the answer: exactly one accepted result, from the addressed member', entryA.status === 'answered' && entryA.result.ok === true && JSON.stringify(entryA.result.value) === JSON.stringify({ echoed: { say: 'hi' } }) && foldA.counts.results === 1 && foldA.counts.pending === 0, JSON.stringify(entryA) + ' counts=' + JSON.stringify(foldA.counts)])

  const foldB = await b.ask({ run: 'fold' })
  const entryB = foldB.dispatches.find((entry) => entry.id === 'd-1')
  readings.push(['7. both ends fold the same verdict for the same dispatch', JSON.stringify(entryB) === JSON.stringify(entryA) && JSON.stringify(foldB.counts) === JSON.stringify(foldA.counts), JSON.stringify(entryB)])

  readings.push(['8. the whole ledger crossed the relay: A holds both writers', foldA.writers.includes('end-A') && foldA.writers.includes('end-B'), JSON.stringify(foldA.writers)])

  await a.ask({ run: 'exit' })
  await b.ask({ run: 'exit' })
  await Promise.all([a.exited, b.exited])

  const C = await import(MODULE)
  const reopened = C.openControlLog({ dir: join(root, 'end-A'), writer: 'end-A-reopen', reclaim: true })
  const afterDeath = C.projectTeamState(reopened.replay())
  const entryDead = afterDeath.dispatches.dispatches.find((entry) => entry.id === 'd-1')
  readings.push(['9. after both processes are gone, a fresh reader still reads the answer', entryDead !== undefined && entryDead.status === 'answered' && JSON.stringify(entryDead.result.value) === JSON.stringify({ echoed: { say: 'hi' } }), JSON.stringify(entryDead?.result ?? null)])
  await reopened.close()
  rmSync(root, { recursive: true, force: true })

  let failed = 0
  for (const [name, held, detail] of readings) {
    if (held !== true) failed += 1
    console.log((held === true ? '  ok    ' : '  FAIL  ') + name + '  |  ' + detail)
  }
  console.log(String(readings.length - failed) + ' of ' + String(readings.length) + ' readings held')
  process.exit(failed === 0 ? 0 : 1)
}

await main()
