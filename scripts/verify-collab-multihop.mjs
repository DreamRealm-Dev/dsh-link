#!/usr/bin/env node
/**
 * Three logs, two hops: what a relay contract has to say, and what happens without one.
 *
 * The two-log gate proves the merge rules between a sender and a receiver. A third log exposes
 * the question neither of them asks: `ownPage()` exports what THIS log wrote, so a middle hop
 * that forwards its own page forwards nothing of the peer's work. Forwarding therefore has to
 * regroup by the record's origin, and the batch header is what the receiver believes about that
 * origin — which is why the wrong grouping is measured here instead of being assumed absent.
 *
 *   1  a middle hop can forward a peer's records   C's board equals A's board after two hops
 *   2  the naive forward sends nothing             `ownPage()` is a one-hop export by contract
 *   3  the wrong grouping is accepted as the sender's work   anyone who saw a batch can claim it
 *   4  a re-forward is idempotent                  the third hop appends nothing twice
 *
 * Run:  node scripts/verify-collab-multihop.mjs
 * Exit: 0 every injection held; 1 an injection failed; 2 the plugin is not built.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
if (!existsSync(ENTRY)) {
  console.error('the plugin is not built: ' + ENTRY)
  process.exit(2)
}
const { openControlLog, projectTeamState } = await import('file:///' + ENTRY.replaceAll('\\', '/'))

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}
const freshDir = () => mkdtempSync(join(tmpdir(), 'collab-multihop-'))
const exported = (log, since = 0) => log.ownPage(since).map((row) => ({
  seq: row.originSeq ?? row.seq,
  kind: row.kind,
  ...(row.actor === undefined ? {} : { actor: row.actor }),
  ...(row.subject === undefined ? {} : { subject: row.subject }),
  ...(row.payload === undefined ? {} : { payload: row.payload }),
  ...(row.at === undefined ? {} : { at: row.at }),
}));
// The forwarding contract: regroup every held record by the log that produced it, so each hop is
// the same shape as a first hop. A middle hop that skips this regroups nothing and forwards
// only itself.
const regroupByOrigin = (log) => {
  const groups = new Map()
  for (const row of log.page(0)) {
    const writer = row.writer ?? log.writer
    const instance = row.instance ?? log.instance
    const key = writer + '\u0000' + instance
    const list = groups.get(key) ?? { writer, instance, records: [] }
    list.records.push({ seq: row.originSeq ?? row.seq, kind: row.kind,
      ...(row.actor === undefined ? {} : { actor: row.actor }),
      ...(row.subject === undefined ? {} : { subject: row.subject }),
      ...(row.payload === undefined ? {} : { payload: row.payload }),
      ...(row.at === undefined ? {} : { at: row.at }) })
    groups.set(key, list)
  }
  return [...groups.values()]
};

// ---------------------------------------------------------------- a two-hop path, the right way
{
  const dir = freshDir()
  const A = openControlLog({ dir: join(dir, 'a'), writer: 'device-a' })
  const B = openControlLog({ dir: join(dir, 'b'), writer: 'device-b' })
  const C = openControlLog({ dir: join(dir, 'c'), writer: 'device-c' })
  await A.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'pending' } })
  await A.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'in_progress', owner: 'ann' } })
  await B.ingest({ writer: 'device-a', instance: A.instance, records: exported(A) })
  const groups = regroupByOrigin(B).filter((group) => group.writer !== B.writer)
  let appended = 0
  for (const group of groups) appended += (await C.ingest(group)).appended
  const boardA = projectTeamState(A.replay()).tasks.map((row) => String(row.team) + '/' + row.id + '/' + row.status + '/' + String(row.owner))
  const boardC = projectTeamState(C.replay()).tasks.map((row) => String(row.team) + '/' + row.id + '/' + row.status + '/' + String(row.owner))
  const marksC = C.marks().map((mark) => mark.writer + '/' + mark.instance + ':' + String(mark.lastSeq))
  record('1 a middle hop can forward a peer\'s records, and the far board matches',
    appended === 2 && JSON.stringify(boardA) === JSON.stringify(boardC)
    && marksC.includes('device-a/' + A.instance + ':2'),
    'appended=' + String(appended) + ' boardA=' + JSON.stringify(boardA) + ' boardC=' + JSON.stringify(boardC)
    + ' marksC=' + JSON.stringify(marksC))

  // The naive forward: the middle hop's own page holds only its own writes, so a relay built on
  // `ownPage()` is a one-hop relay. This is the trap the contract exists to name.
  const naive = exported(B).length
  record('2 the naive forward from a middle hop carries nothing', naive === 0,
    'ownPage() of the middle hop yields ' + String(naive) + ' records (contract: one hop)')

  // The wrong grouping is not refused: the receiver believes the batch header, so any log that
  // saw a batch once can present those records as its own work. Measured, not assumed absent.
  const mistaken = await C.ingest({ writer: 'device-b', instance: 'claimed-instance', records: exported(A) })
  const claimed = C.marks().some((mark) => mark.writer === 'device-b' && mark.instance === 'claimed-instance')
  record('3 records forwarded under the wrong origin are accepted as the forwarder\'s work',
    mistaken.appended === 2 && claimed,
    'appended=' + String(mistaken.appended) + ' receiver marks a device-b instance it never heard from otherwise: ' + String(claimed))

  const again = await C.ingest({ writer: 'device-b', instance: 'claimed-instance', records: exported(A) })
  record('4 re-forwarding the same batch appends nothing', again.appended === 0,
    'appended=' + String(again.appended) + ' skipped=' + String(again.skipped))

  await A.close(); await B.close(); await C.close(); rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((row) => !row.ok)
console.log('')
console.log(results.length + ' injections, ' + (results.length - failed.length) + ' held, ' + failed.length + ' failed')
process.exit(failed.length > 0 ? 1 : 0)