#!/usr/bin/env node
/**
 * The collaboration bus across two logs, tested by trying to break the merge.
 *
 * One log is one device. Two devices both number their records from 1, so a receiver that keys
 * records by sequence alone swallows the other side's work and reports it as already applied —
 * the board then shows one team's task where two exist, and nothing in the counters says so.
 * A relay therefore needs, and this gate measures, four properties:
 *
 *   1  a peer's batch lands and both folds agree   the receiver's board equals the sender's
 *   2  re-sending a batch is idempotent            nothing is appended twice
 *   3  a hole is refused, not skipped              a gap and an internal hole both throw
 *   4  writers do not swallow each other           two devices reusing sequences keep both tasks
 *   5  a re-sent batch catches up on its tail only sequences are not replayed
 *   6  a rebuilt peer log identifies itself        same name, new instance: refused unless adopted
 *   7  a position holds one record                 contradicting content is a conflict, not a re-send
 *   8  a failed append leaves no trace             no sequence spent, no wedged close, still relayable
 *   9  a malformed sequence is refused             missing, non-integer and repeated all say so
 *  10  a batch may not be this log                 a forged identity lands in nobody's ownPage
 *  11  key order is not a difference               the same record in another order is a re-send
 *  12  adopting twice appends once                 the replaced stream stays idempotent
 *
 * Then `--self-attack` arms the writer-identity defects (SEQ_ONLY collapses every writer into one
 * key, NAME_ONLY drops the instance), and the run passes only when the injections that measure those
 * two properties are the ones that fail: 4, 7 and 13 for the key collapse (13 compares a record
 * with the one already applied under its origin identity), 6 and 12 for the instance identity — an
 * attack nobody can localise is not evidence that the others measure what they claim.
 *
 * Run:  node scripts/verify-collab-relay.mjs [--self-attack]
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

const selfAttack = process.argv.includes('--self-attack')
if (selfAttack) {
  process.env.DSH_LINK_COLLAB_ATTACKS = '1'
  process.env.DSH_LINK_COLLAB_RELAY_SEQ_ONLY = '1'
  process.env.DSH_LINK_COLLAB_RELAY_NAME_ONLY = '1'
}

/** One injection: its name, the work, and the assertion that must hold. */
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}

const freshDir = () => mkdtempSync(join(tmpdir(), 'collab-relay-'))
const exported = (log) => log.ownPage(0).map((row) => ({ seq: row.originSeq, kind: row.kind, actor: row.actor, subject: row.subject, payload: row.payload, at: row.at }))
const refusal = async (work) => {
  try { await work(); return 'ACCEPTED' } catch (error) { return String(error?.code ?? error?.name ?? 'ERROR') }
}

// ---------------------------------------------------------------- 1 land, and both boards agree
{
  const dir = freshDir()
  const sender = openControlLog({ dir: join(dir, 'sender'), writer: 'device-a' })
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  await sender.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'pending' } })
  await sender.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'in_progress', owner: 'ann' } })
  const landed = await receiver.ingest({ writer: 'device-a', instance: sender.instance, records: exported(sender) })
  const senderFold = projectTeamState(sender.replay())
  const receiverFold = projectTeamState(receiver.replay())
  const agree = JSON.stringify(senderFold.tasks) === JSON.stringify(receiverFold.tasks)
  record('1 a peer batch lands and both folds agree',
    landed.appended === 2 && agree && receiverFold.counts.tasks === 1,
    'appended=' + String(landed.appended) + ' agree=' + String(agree)
    + ' receiver=' + JSON.stringify(receiverFold.tasks.map((row) => row.team + '/' + row.id + '/' + row.status)))
  await sender.close(); await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 2 re-sending changes nothing
{
  const dir = freshDir()
  const sender = openControlLog({ dir: join(dir, 'sender'), writer: 'device-a' })
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  await sender.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'pending' } })
  const batch = { writer: 'device-a', instance: sender.instance, records: exported(sender) }
  await receiver.ingest(batch)
  const before = receiver.replay().length
  const again = await receiver.ingest(batch)
  record('2 re-sending a batch appends nothing twice',
    again.appended === 0 && receiver.replay().length === before,
    'appended=' + String(again.appended) + ' skipped=' + String(again.skipped) + ' records=' + String(receiver.replay().length))
  await sender.close(); await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 3 a gap is refused, not filled in
{
  const dir = freshDir()
  const sender = openControlLog({ dir: join(dir, 'sender'), writer: 'device-a' })
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  await sender.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'pending' } })
  await sender.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'in_progress' } })
  await receiver.ingest({ writer: 'device-a', instance: sender.instance, records: exported(sender) })
  const before = receiver.replay().length
  const missingMiddle = await refusal(() => receiver.ingest({ writer: 'device-a', instance: sender.instance, records: [{ seq: 4, kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'completed' } }] }))
  const internalHole = await refusal(() => receiver.ingest({ writer: 'device-a', instance: sender.instance, records: [{ seq: 5, kind: 'task/state', actor: 'team-A', payload: { id: 'x', state: 'open' } }, { seq: 7, kind: 'task/state', actor: 'team-A', payload: { id: 'y', state: 'open' } }] }))
  const nameless = await refusal(() => receiver.ingest({ writer: '', instance: 'x', records: [] }))
  record('3 a gap, an internal hole, and a nameless batch are refused',
    missingMiddle === 'RELAY_GAP' && internalHole === 'RELAY_HOLE' && nameless === 'RELAY_WRITER_MISSING'
    && receiver.replay().length === before,
    'gap=' + missingMiddle + ' hole=' + internalHole + ' nameless=' + nameless + ' records=' + String(receiver.replay().length))
  await sender.close(); await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 4 two writers keep their own sequences
{
  // The receiver writes first, so its own records already occupy sequences 1 and 2. A sender that
  // also numbers from 1 then arrives: keyed by writer both sides survive; keyed by sequence the
  // receiver reports the sender's batch as already applied and one team's task disappears.
  const dir = freshDir()
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  const sender = openControlLog({ dir: join(dir, 'sender'), writer: 'device-a' })
  await receiver.append({ kind: 'task/state', actor: 'team-B', payload: { id: 'task-1', state: 'pending' } })
  await receiver.append({ kind: 'task/state', actor: 'team-B', payload: { id: 'task-1', state: 'in_progress' } })
  await sender.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'completed', owner: 'ann' } })
  const landed = await receiver.ingest({ writer: 'device-a', instance: sender.instance, records: exported(sender) })
  const fold = projectTeamState(receiver.replay())
  const marks = receiver.marks()
  record('4 two writers reusing one sequence space keep both records',
    landed.appended === 1 && fold.counts.tasks === 2 && fold.counts.teams === 2
    && marks.length === 2 && receiver.ownPage(0).length === 2,
    'appended=' + String(landed.appended) + ' tasks=' + String(fold.counts.tasks) + ' teams=' + String(fold.counts.teams)
    + ' marks=' + JSON.stringify(marks) + ' own=' + String(receiver.ownPage(0).length))
  await sender.close(); await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 5 catch-up appends only the tail
{
  const dir = freshDir()
  const sender = openControlLog({ dir: join(dir, 'sender'), writer: 'device-a' })
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  await sender.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'pending' } })
  await receiver.ingest({ writer: 'device-a', instance: sender.instance, records: exported(sender) })
  await sender.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'completed' } })
  const caught = await receiver.ingest({ writer: 'device-a', instance: sender.instance, records: exported(sender) })
  const fold = projectTeamState(receiver.replay())
  record('5 a re-sent batch catches up on its tail only',
    caught.appended === 1 && caught.skipped === 1 && fold.counts.tasks === 1 && fold.tasks[0]?.status === 'completed',
    'appended=' + String(caught.appended) + ' skipped=' + String(caught.skipped) + ' status=' + String(fold.tasks[0]?.status))
  await sender.close(); await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 6 a rebuilt peer log says so
{
  // A writer name is a label a caller chooses; a peer that loses its directory starts numbering
  // again under the same label. Treated as one stream, the receiver either reports the new
  // history as already applied (losing it) or splices it onto the old tail (producing a state no
  // writer ever produced). The instance is what makes the two distinguishable.
  const dir = freshDir()
  const peer = openControlLog({ dir: join(dir, 'peer'), writer: 'device-a' })
  await peer.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'old-1', state: 'pending' } })
  const archived = exported(peer)
  const originalInstance = peer.instance
  await peer.close()
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  await receiver.ingest({ writer: 'device-a', instance: originalInstance, records: archived })
  const before = receiver.replay().length
  const rebuilt = {
    writer: 'device-a',
    instance: 'rebuilt-with-a-new-identity',
    records: [
      { seq: 1, kind: 'task/state', actor: 'team-A', payload: { id: 'new-1', state: 'in_progress' } },
      { seq: 2, kind: 'task/state', actor: 'team-A', payload: { id: 'new-2', state: 'open' } },
    ],
  }
  const refusedRewrite = await refusal(() => receiver.ingest(rebuilt))
  const untouched = receiver.replay().length === before
  const adopted = await receiver.ingest({ ...rebuilt, adopt: true })
  const fold = projectTeamState(receiver.replay())
  record('6 a rebuilt peer log is refused by default and adopted on request',
    refusedRewrite === 'RELAY_REWRITTEN' && untouched && adopted.appended === 2 && fold.counts.tasks === 3,
    'refused=' + refusedRewrite + ' untouched=' + String(untouched) + ' adopted=' + String(adopted.appended)
    + ' tasks=' + String(fold.counts.tasks));
  await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 7 a position holds one record
{
  // Re-sending is normal; re-sending something else at a position already applied is not. The
  // difference decides whether a receiver can report "already applied" without comparing content.
  const dir = freshDir()
  const peer = openControlLog({ dir: join(dir, 'peer'), writer: 'device-a' })
  await peer.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'pending' } })
  const batch = { writer: 'device-a', instance: peer.instance, records: exported(peer) }
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  await receiver.ingest(batch)
  const contradicting = {
    writer: 'device-a',
    instance: peer.instance,
    records: [{ seq: 1, kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'completed' } }],
  }
  const conflict = await refusal(() => receiver.ingest(contradicting))
  const benign = await receiver.ingest(batch)
  const status = projectTeamState(receiver.replay()).tasks[0]?.status
  record('7 contradicting an applied position is a conflict, an identical re-send is not',
    conflict === 'RELAY_CONFLICT' && benign.appended === 0 && status === 'pending',
    'conflict=' + conflict + ' benignAppended=' + String(benign.appended) + ' status=' + String(status));
  await peer.close(); await receiver.close(); rmSync(dir, { recursive: true, force: true })
}
// ---------------------------------------------------------------- 8 a failed append leaves no trace
{
  // A payload JSON cannot represent throws while the record is being written. Counted in flight
  // too early, that one throw left the sequence consumed (a hole no later write could fill),
  // `close()` waiting on a counter that could never move, and the log unrelayable forever.
  const dir = freshDir()
  const log = openControlLog({ dir: join(dir, 'log'), writer: 'device-a' })
  await log.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } })
  const refused = await log.append({ kind: 'task/state', actor: 'team-A', payload: { big: 1n } })
    .then(() => 'ACCEPTED', (error) => String(error?.name ?? 'ERROR'))
  const next = await log.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't2', state: 'open' } })
  const closed = await Promise.race([
    log.close().then(() => 'closed'),
    new Promise((done) => setTimeout(() => done('TIMEOUT'), 5000)),
  ])
  // The log that survived must still be relayable: a fresh peer accepts its export whole.
  const peer = openControlLog({ dir: join(dir, 'peer'), writer: 'device-b' })
  const relayed = await peer.ingest({ writer: 'device-a', instance: log.instance, records: exported(log) })
  record('8 a failed append consumes no sequence and does not wedge close()',
    refused === 'TypeError' && next === 2 && closed === 'closed' && relayed.appended === 2,
    'refused=' + refused + ' nextSeq=' + String(next) + ' close=' + closed + ' relayed=' + String(relayed.appended));
  await peer.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 9 malformed sequences are refused
{
  // Without a usable sequence a record used to fall through every check and be reported as
  // already applied: nothing appended, nothing said. Missing, non-integer and repeated
  // sequences now have one answer.
  const dir = freshDir()
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  const batch = (records) => ({ writer: 'device-a', instance: 'peer-instance', records })
  const missing = await refusal(() => receiver.ingest(batch([{ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } }])));
  const stringSeq = await refusal(() => receiver.ingest(batch([{ seq: '3', kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } }])));
  const repeated = await refusal(() => receiver.ingest(batch([{ seq: 1, kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } }, { seq: 1, kind: 'task/state', actor: 'team-A', payload: { id: 't2', state: 'open' } }])));
  record('9 a record without a usable sequence is refused, not called already applied',
    missing === 'RELAY_MALFORMED' && stringSeq === 'RELAY_MALFORMED' && repeated === 'RELAY_MALFORMED'
    && receiver.replay().length === 0,
    'missing=' + missing + ' string=' + stringSeq + ' repeated=' + repeated + ' records=' + String(receiver.replay().length));
  await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 10 a batch may not be this log
{
  // Knowing two field values is enough to forge them: a batch claiming this log's own writer and
  // instance was accepted and landed in `ownPage()`, which is supposed to hold what this process
  // wrote. The identity is therefore refused, not trusted.
  const dir = freshDir()
  const log = openControlLog({ dir: join(dir, 'log'), writer: 'device-a' })
  const forged = await refusal(() => log.ingest({
    writer: log.writer,
    instance: log.instance,
    records: [{ seq: 1, kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } }],
  }))
  record('10 a batch claiming this log\'s own identity is refused',
    forged === 'RELAY_IMPERSONATION' && log.ownPage(0).length === 0,
    'forged=' + forged + ' ownPage=' + String(log.ownPage(0).length));
  await log.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 11 key order is not a difference
{
  // Two records whose payloads differ only in the order their keys were assigned are the same
  // record. Compared as raw JSON text they would conflict, and no re-send could heal that.
  const dir = freshDir()
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  const first = { writer: 'device-a', instance: 'peer-instance', records: [{ seq: 1, kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open', owner: 'ann' } }] }
  const reordered = { ...first, records: [{ seq: 1, kind: 'task/state', actor: 'team-A', payload: { owner: 'ann', state: 'open', id: 't1' } }] }
  await receiver.ingest(first)
  const again = await refusal(() => receiver.ingest(reordered)).then((code) => code, () => 'ERROR')
  const benign = await receiver.ingest(reordered).then((result) => String(result.appended), (error) => String(error?.code ?? 'ERROR'))
  record('11 the same record in another key order is a re-send, not a conflict',
    benign === '0' && receiver.replay().length === 1,
    'firstAttempt=' + again + ' reappended=' + benign + ' records=' + String(receiver.replay().length));
  await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 12 adopting twice appends once
{
  // Adoption must let a rebuilt peer in without forgetting the stream it replaced: dropping the
  // superseded mark made an old batch look new again, and alternating adoptions appended the same
  // history over and over.
  const dir = freshDir()
  const peer = openControlLog({ dir: join(dir, 'peer'), writer: 'device-a' })
  await peer.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } })
  await peer.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'in_progress' } })
  const oldBatch = { writer: 'device-a', instance: peer.instance, records: exported(peer) }
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  await receiver.ingest(oldBatch)
  const afterFirst = receiver.replay().length
  const rebuilt = { writer: 'device-a', instance: 'rebuilt-instance', records: [{ seq: 1, kind: 'task/state', actor: 'team-A', payload: { id: 't2', state: 'open' } }] }
  await receiver.ingest({ ...rebuilt, adopt: true })
  const afterAdopt = receiver.replay().length
  const oldAgain = await receiver.ingest(oldBatch)
  const rebuiltAgain = await receiver.ingest({ ...rebuilt, adopt: true })
  record('12 adopting a rebuilt peer does not re-append either stream',
    afterFirst === 2 && afterAdopt === 3 && oldAgain.appended === 0 && rebuiltAgain.appended === 0
    && receiver.replay().length === 3,
    'afterFirst=' + String(afterFirst) + ' afterAdopt=' + String(afterAdopt)
    + ' oldAgain=' + String(oldAgain.appended) + ' rebuiltAgain=' + String(rebuiltAgain.appended)
    + ' records=' + String(receiver.replay().length));
  await peer.close(); await receiver.close(); rmSync(dir, { recursive: true, force: true })
}
// ---------------------------------------------------------------- 13 the disk form is the compared form
{
  // Comparing in-memory objects against a log that holds JSON text made a changed Date look like
  // a re-send, made the same record's verdict depend on whether it arrived as an object or as JSON,
  // and dropped a payload's own `__proto__` key. What is compared now is what the file keeps.
  const dir = freshDir()
  const receiver = openControlLog({ dir: join(dir, 'receiver'), writer: 'device-b' })
  const batch = (payload) => ({ writer: 'device-a', instance: 'peer-instance', records: [{ seq: 1, kind: 'task/state', actor: 'team-A', payload }] })
  const first = { id: 't1', when: new Date(5) }
  await receiver.ingest(batch(first))
  const changedLive = await receiver.ingest(batch({ id: 't1', when: new Date(6) }))
    .then((result) => 'appended:' + String(result.appended), (error) => String(error?.code ?? 'ERROR'))
  const persisted = JSON.parse(JSON.stringify(first))
  const asPersisted = await receiver.ingest(batch(persisted))
    .then((result) => 'appended:' + String(result.appended), (error) => String(error?.code ?? 'ERROR'))
  const protoOne = JSON.parse('{"id":"p1","__proto__":{"a":1}}')
  const protoTwo = JSON.parse('{"id":"p1","__proto__":{"a":2}}')
  await receiver.ingest({ writer: 'device-a', instance: 'peer-instance', records: [{ seq: 2, kind: 'task/state', actor: 'team-A', payload: protoOne }] })
  const protoChanged = await receiver.ingest({ writer: 'device-a', instance: 'peer-instance', records: [{ seq: 2, kind: 'task/state', actor: 'team-A', payload: protoTwo }] })
    .then((result) => 'appended:' + String(result.appended), (error) => String(error?.code ?? 'ERROR'))
  record('13 a changed value is a conflict and the persisted form is a re-send',
    changedLive === 'RELAY_CONFLICT' && asPersisted === 'appended:0' && protoChanged === 'RELAY_CONFLICT',
    'changedDate=' + changedLive + ' persistedForm=' + asPersisted + ' protoKeyChanged=' + protoChanged);
  await receiver.close(); rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 14 a write admitted before close still lands
{
  // Close used to decide the fate of queued work when that work ran, so a write offered before
  // close was refused by close. The decision is now taken when the caller asks: one admitted
  // before close reaches the disk, one offered after is refused.
  const dir = freshDir()
  const log = openControlLog({ dir: join(dir, 'log'), writer: 'device-a' })
  await log.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'warm' } })
  const admitted = log.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'admitted' } })
  const closing = log.close().then(() => 'closed', (error) => 'rej:' + String(error?.message ?? error))
  const admittedResult = await admitted.then((seq) => 'ok:' + String(seq), (error) => 'rej:' + String(error?.message ?? error))
  const closedResult = await closing
  const late = await log.append({ kind: 'task/state', actor: 'team-A', payload: { id: 'late' } })
    .then(() => 'ACCEPTED', () => 'rej')
  const reopened = openControlLog({ dir: join(dir, 'log'), writer: 'device-a' })
  const ids = reopened.replay().map((row) => row.payload?.id)
  record('14 a write admitted before close lands, one offered after does not',
    admittedResult === 'ok:2' && closedResult === 'closed' && late === 'rej'
    && JSON.stringify(ids) === JSON.stringify(['warm', 'admitted']),
    'admitted=' + admittedResult + ' close=' + closedResult + ' late=' + late + ' onDisk=' + JSON.stringify(ids));
  await reopened.close(); rmSync(dir, { recursive: true, force: true })
}
const failed = results.filter((row) => !row.ok)
const EXPECTED_UNDER_ATTACK = ['4', '6', '7', '12', '13']
console.log('')
if (selfAttack) {
  const flipped = failed.map((row) => String(row.name).split(' ')[0])
  const localised = flipped.length === EXPECTED_UNDER_ATTACK.length
    && EXPECTED_UNDER_ATTACK.every((number) => flipped.includes(number))
  console.log('with the writer-identity defects armed: flipped=' + JSON.stringify(flipped)
    + ' (expected ' + JSON.stringify(EXPECTED_UNDER_ATTACK) + ')')
  if (localised) {
    console.log('the armed defects are caught by the injections that measure writer identity: this gate can fail')
    process.exit(0)
  }
  console.log('the armed defects were NOT localised — this gate cannot tell what it measures')
  process.exit(1)
}
console.log(results.length + ' injections, ' + (results.length - failed.length) + ' held, ' + failed.length + ' failed')
process.exit(failed.length > 0 ? 1 : 0)