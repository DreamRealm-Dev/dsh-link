#!/usr/bin/env node
/**
 * The collaboration bus control channel, tested by trying to break it.
 *
 * A durable log is the kind of component that passes every happy-path test and then loses a
 * team's task history on the first crash. So this file is written as seven injections, each of
 * which describes a way the channel could be wrong and then measures whether it is:
 *
 *   1  append then read back           sequences increase by one, and a cursor page agrees
 *   2  restart                         the same directory reopens with its sequence continuing
 *   3  the data channel                 entries never reach the disk, and expire
 *   4  a data flood does not block control   a control append stays fast while data piles up
 *   5  a truncated tail                the reader is told what was lost, never "empty log"
 *   6  concurrent appends              no duplicate sequence, no gap
 *   7  two processes                   the second writer is refused rather than sharing a counter
 *   8  a task belongs to its team      two teams may both have "1"; keying by id alone merges them
 *   9  the fault switches ship          injection flags are inert unless the master switch is on
 *  10  an unreleasable lock             a lock that names no live writer is reclaimed, not obeyed
 *
 * Then `--self-attack` runs the same injections against a deliberately broken log, because a
 * test that cannot fail is not evidence. Each attack flips one design decision and names the
 * injection that must catch it. Arming requires DSH_LINK_COLLAB_ATTACKS, which is what keeps the
 * same switches inert in a shipped build.
 *
 * Run:  node scripts/verify-teams-log.mjs [--self-attack]
 * Exit: 0 every injection held; 1 an injection failed; 2 the plugin is not built.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')

if (!existsSync(ENTRY)) {
  console.error('the plugin is not built: ' + ENTRY)
  process.exit(2)
}
const { openControlLog, projectTeamState, teamEventToRecord, recordTeamEvents } = await import('file:///' + ENTRY.replaceAll('\\', '/'))

// Injection 7 spawns this file with --child-open <dir>: opening a log that another process
// holds must be refused. Handled before anything else so the child does no other work.
if (process.argv.includes('--child-open')) {
  const dir = process.argv[process.argv.indexOf('--child-open') + 1]
  try {
    openControlLog({ dir })
    console.log('child opened the log, which it must not have')
    process.exit(3)
  } catch (error) {
    console.log(String(error?.message ?? error))
    process.exit(4)
  }
}

const selfAttack = process.argv.includes('--self-attack')
// One flag per design decision whose removal an injection is supposed to catch. Arming them
// is how this gate proves it can fail: if an armed attack still produces every injection held,
// the injections are not measuring what they claim. The master switch is set first and is what
// the plugin checks before honoring any of the flags below — the same file ships to production.
if (selfAttack) {
  process.env.DSH_LINK_COLLAB_ATTACKS = '1'
  process.env.DSH_LINK_COLLAB_FORGET_SEQ = '1'
  process.env.DSH_LINK_COLLAB_NO_LOCK = '1'
  process.env.DSH_LINK_COLLAB_DROP_OWNER = '1'
  process.env.DSH_LINK_COLLAB_DROP_TEAM_KEY = '1'
}

/** One injection: its name, the work, and the assertion that must hold. */
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
}

/** A fresh directory under the OS temp area for one log. */
const freshDir = () => mkdtempSync(join(tmpdir(), 'collab-log-'))

const now = () => Date.now()

// ---------------------------------------------------------------- 1 append then read back
{
  const dir = freshDir()
  const log = openControlLog({ dir })
  await log.append({ kind: 'task.created', actor: 'lead', subject: 'task-1', payload: { title: 'first' } })
  await log.append({ kind: 'task.claimed', actor: 'worker-a', subject: 'task-1' })
  await log.append({ kind: 'task.completed', actor: 'worker-a', subject: 'task-1' })
  const all = log.replay()
  const monotonic = all.every((row, index) => index === 0 || row.seq === all[index - 1].seq + 1)
  const channeled = all.every((row) => row.channel === 'control')
  const page = log.page(1, 2)
  record('1 append then read back',
    all.length === 3 && monotonic && channeled && page.length === 2 && page[0].seq === 2,
    'replay=' + all.length + ' monotonic=' + String(monotonic) + ' channel=' + String(channeled)
    + ' page(1,2)=' + page.map((row) => row.seq).join(','))
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// ------------------------------------------------------------------------ 2 restart continuity
{
  const dir = freshDir()
  const first = openControlLog({ dir })
  await first.append({ kind: 'task.created', subject: 'task-1' })
  await first.append({ kind: 'task.claimed', subject: 'task-1' })
  const beforeClose = first.lastSeq
  await first.close()

  const second = openControlLog({ dir })
  const title = second.lastSeq === beforeClose
    ? 'reuse the highest sequence the file holds'
    : 'forget the tail and restart the counter'
  const continued = await second.append({ kind: 'task.completed', subject: 'task-1' })
  const replayed = second.replay().map((row) => row.seq)
  const contiguous = replayed.every((seq, index) => index === 0 || seq === replayed[index - 1] + 1)
  record('2 restart continues the sequence',
    continued === beforeClose + 1 && contiguous,
    'closed at ' + beforeClose + ', appended ' + continued + ', replayed [' + replayed.join(',') + '], '
    + (selfAttack ? 'ATTACK ARMED (tail forgetting): ' : '') + title)
  delete process.env.DSH_LINK_COLLAB_FORGET_SEQ
  await second.close()
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------- 3 the data channel
{
  const dir = freshDir()
  const log = openControlLog({ dir, dataTtlMs: 60 })
  for (let index = 0; index < 500; index += 1) log.put('tokens', { kind: 'delta', payload: 'x' })
  const capped = log.take('tokens').length
  const file = join(dir, 'control.jsonl')
  const onDiskBefore = existsSync(file) ? readFileSync(file, 'utf8') : ''
  await log.append({ kind: 'note' })
  const onDisk = readFileSync(file, 'utf8')
  const leaked = /"channel":"data"/.test(onDisk)
  await new Promise((wake) => setTimeout(wake, 90))
  const expired = log.take('tokens').length
  record('3 the data channel stays off the disk and expires',
    !leaked && capped <= 256 && expired === 0 && onDiskBefore === '',
    'capped=' + capped + ' expiredAfterTtl=' + expired + ' dataInControlFile=' + String(leaked))
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// ------------------------------------------------- 4 a data flood must not delay control
{
  const dir = freshDir()
  const log = openControlLog({ dir, dataCapacity: 128 })
  const controlOnly = []
  for (let index = 0; index < 20; index += 1) {
    const begin = process.hrtime.bigint()
    await log.append({ kind: 'control-baseline' })
    controlOnly.push(Number(process.hrtime.bigint() - begin) / 1e6)
  }
  const baseline = controlOnly.sort((a, b) => a - b)[Math.floor(controlOnly.length / 2)]
  const flooded = []
  for (let index = 0; index < 200_000; index += 1) log.put('flood', { kind: 'delta', payload: index })
  for (let index = 0; index < 20; index += 1) {
    const begin = process.hrtime.bigint()
    await log.append({ kind: 'control-during-flood' })
    flooded.push(Number(process.hrtime.bigint() - begin) / 1e6)
  }
  const during = flooded.sort((a, b) => a - b)[Math.floor(flooded.length / 2)]
  // The threshold is a measured baseline with headroom, not a wish: the design claim is that
  // the two channels do not queue behind each other, so the tolerable ratio is generous but
  // bounded.
  record('4 a data flood does not slow the control channel',
    during <= Math.max(baseline * 10, 20),
    'median control append ' + baseline.toFixed(3) + 'ms alone, ' + during.toFixed(3) + 'ms during 200k data puts (budget '
    + Math.max(baseline * 10, 20).toFixed(1) + 'ms), dataSize=' + log.dataSize())
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// --------------------------------------------------------------- 5 a truncated tail is damage
{
  const dir = freshDir()
  const log = openControlLog({ dir })
  for (let index = 0; index < 10; index += 1) await log.append({ kind: 'step', payload: index })
  await log.close()

  const file = join(dir, 'control.jsonl')
  const size = statSync(file).size
  truncateSync(file, size - 7)

  const reopened = openControlLog({ dir })
  const damage = reopened.damage
  const reported = damage !== null && damage.brokenLines.length > 0 && damage.lastGoodSeq > 0
    && damage.lastGoodSeq < 10
  record('5 a truncated tail is reported, not swallowed',
    reported,
    damage === null
      ? 'the reader saw a clean log after 7 bytes were cut off — this is the failure the injection exists for'
      : 'brokenLines=[' + damage.brokenLines.join(',') + '] lastGoodSeq=' + damage.lastGoodSeq + ' bytes=' + damage.bytes)
  await reopened.close()
  rmSync(dir, { recursive: true, force: true })
}

// --------------------------------------------------------------------- 6 concurrent appends
{
  const dir = freshDir()
  const log = openControlLog({ dir })
  const assigned = await Promise.all(Array.from({ length: 200 }, (_unused, index) => log.append({ kind: 'parallel', payload: index })))
  const unique = new Set(assigned)
  const sorted = [...assigned].sort((a, b) => a - b)
  const contiguous = sorted.every((seq, index) => seq === index + 1)
  const onDisk = readFileSync(join(dir, 'control.jsonl'), 'utf8').trim().split('\n').length
  record('6 concurrent appends get unique, contiguous sequences',
    unique.size === assigned.length && contiguous && onDisk === assigned.length,
    'assigned=' + assigned.length + ' unique=' + unique.size + ' contiguous=' + String(contiguous) + ' linesOnDisk=' + onDisk)
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// ------------------------------------------------------------------------- 7 two processes
{
  const dir = freshDir()
  const log = openControlLog({ dir })
  await log.append({ kind: 'held' })

  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child-open', dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output += chunk })
  const code = await new Promise((done) => child.on('exit', (value) => done(value ?? 1)))
  const refused = code !== 0 && /already open by process/.test(output)
  record('7 a second writer is refused rather than sharing the counter',
    refused,
    'child exit ' + code + ', said: ' + output.trim().split('\n').slice(-1)[0])
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// ------------------------------------------ 8 the ledger folds back into the state it describes
{
  const dir = freshDir()
  const log = openControlLog({ dir })
  await log.append({ kind: 'member/state', payload: { id: 'worker-a', state: 'active' } })
  await log.append({ kind: 'task/state', subject: 't1', payload: { id: 't1', state: 'open' } })
  await log.append({ kind: 'task/state', subject: 't1', payload: { id: 't1', state: 'claimed', owner: 'worker-a' } })
  await log.append({ kind: 'something/nobody-defined', payload: { note: 'a record this fold does not know' } })
  await log.append({ kind: 'task/state', subject: 't1', payload: { id: 't1', state: 'review', owner: 'worker-a' } })
  await log.append({ kind: 'task/state', subject: 't2', payload: { id: 't2', state: 'open' } })

  const state = projectTeamState(log.replay())
  const t1 = state.tasks.find((task) => task.id === 't1')
  const t2 = state.tasks.find((task) => task.id === 't2')
  record('8 the ledger folds back into the team state it describes',
    state.tasks.length === 2 && t1?.status === 'review' && t1?.owner === 'worker-a' && t1?.records === 3
    && t2?.status === 'open' && state.members.length === 1 && state.members[0].state === 'active'
    && state.counts.folded === 5 && state.counts.unknown === 1 && state.through === 6,
    'tasks=' + state.tasks.map((task) => task.id + ':' + task.status + '(' + task.records + ')').join(',')
    + ' members=' + state.members.map((member) => member.name + ':' + member.state).join(',')
    + ' folded=' + state.counts.folded + ' unknown=' + state.counts.unknown + ' through=' + state.through)
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// ------------------------------------------- 9 a cursor is meaningful: the same records, same state
{
  const dir = freshDir()
  const log = openControlLog({ dir })
  for (let index = 0; index < 12; index += 1) {
    await log.append({ kind: 'task/state', subject: 't' + String(index % 3), payload: { id: 't' + String(index % 3), state: index < 6 ? 'open' : 'claimed', owner: index < 6 ? null : 'worker-b' } })
  }
  const all = log.replay()
  const once = projectTeamState(all)
  const twice = projectTeamState(all)
  const half = projectTeamState(all.slice(0, 6))

  // Determinism is the property that makes a replay an audit rather than a re-run: two folds of
  // the same records must agree, and a fold of a prefix must be the state after that prefix.
  const deterministic = JSON.stringify(once) === JSON.stringify(twice)
  const prefixIsIntermediate = half.tasks.length === 3 && half.tasks.every((task) => task.status === 'open' && task.records === 2)
  const later = once.tasks.every((task) => task.status === 'claimed' && task.owner === 'worker-b' && task.records === 4)
  record('9 folding is deterministic and a prefix is an intermediate state',
    deterministic && prefixIsIntermediate && later,
    'deterministic=' + String(deterministic) + ' prefix=' + half.tasks.map((task) => task.id + ':' + task.status + '(' + task.records + ')').join(',')
    + ' full=' + once.tasks.map((task) => task.id + ':' + task.status + '(' + task.records + ')').join(','))
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// ------------------------------- 10 the projection survives a restart of the process that wrote it
{
  const dir = freshDir()
  const writer = openControlLog({ dir })
  await writer.append({ kind: 'task/state', subject: 'persisted', payload: { id: 'persisted', state: 'completed', owner: 'worker-c' } })
  await writer.put('tokens', { kind: 'delta', payload: 'must not appear in the projection' })
  await writer.close()

  const reopened = openControlLog({ dir })
  const state = projectTeamState(reopened.replay())
  const task = state.tasks.find((row) => row.id === 'persisted')
  // The data channel is gone by design; the control record is not, and the fold sees exactly
  // one fact because that is all the writer wrote.
  record('10 the projection is rebuilt from disk after a restart',
    task?.status === 'completed' && task?.owner === 'worker-c' && state.counts.folded === 1 && state.counts.unknown === 0,
    'tasks=' + state.tasks.map((row) => row.id + ':' + row.status).join(',') + ' folded=' + state.counts.folded + ' unknown=' + state.counts.unknown)
  await reopened.close()
  rmSync(dir, { recursive: true, force: true })
}

// --------------------------- 11 the kernel's team events become control records, verbatim-ish
{
  // Payloads copied from the kernel's own event declarations: a task row as `team/task` carries
  // it (packages/experimental/agent-team/src/projection.ts:325-328) and a member row as
  // `team/member` carries it (:315-316). The vocabulary is kept rather than translated, so a
  // reader of this ledger and a reader of the service agree on what a row says.
  // Armed, the mapper drops a fact it must keep, so this injection fails as it should: a gate
  // whose new assertions never go red is a gate that has not been shown to measure anything.
  const armed = process.env.DSH_LINK_COLLAB_DROP_MEMBER_FIELDS === '1'
  const task = teamEventToRecord({ type: 'team/task', data: { version: 2, teamId: 'team-1', task: { id: 'task-7', revision: 3, subject: 'wire the bus', status: 'in_progress', ownerName: armed ? undefined : 'worker-a', blockedBy: [], writeScopes: [] } } })
  const member = teamEventToRecord({ type: 'team/member', data: { version: 2, teamId: 'team-1', member: { id: 'agent-9', name: 'worker-a', role: 'teammate', phase: 'active' } } })
  // Both message payloads are the kernel's own shapes (agent-team/src/types.ts:236-243): the
  // queued one carries the whole snapshot, the delivered one only an acknowledgement. The first
  // version of this mapper read a `from`/`to` pair out of both, which matched neither, so the
  // test now asserts the declared fields rather than the ones I assumed.
  const queued = teamEventToRecord({ type: 'team/message/queued', data: { version: 2, teamId: 'team-1', message: { id: 'msg-1', senderId: 'sess-lead', senderName: 'lead', targetId: 'sess-a', content: [] } } })
  const delivered = teamEventToRecord({ type: 'team/message/delivered', data: { version: 2, teamId: 'team-1', messageId: 'msg-2', targetId: 'sess-a' } })
  const irrelevant = teamEventToRecord({ type: 'user/message', data: { role: 'user', content: [] } })
  const malformed = teamEventToRecord({ type: 'team/task', data: { task: { subject: 'no id' } } })

  const ok = task?.kind === 'task/state' && task.payload.id === 'task-7' && task.payload.state === 'in_progress'
    && task.payload.owner === 'worker-a'
    && task.payload.owner === 'worker-a' && task.payload.revision === 3 && task.subject === 'task-7'
    && member?.kind === 'member/state' && member.payload.id === 'agent-9' && member.payload.state === 'active'
    && member.payload.name === 'worker-a' && member.payload.role === 'teammate'
    && queued?.kind === 'team.message' && queued.payload.state === 'queued' && queued.payload.id === 'msg-1'
    && queued.actor === 'lead' && queued.subject === 'sess-a' && queued.payload.senderId === 'sess-lead'
    && delivered?.kind === 'team.message' && delivered.payload.state === 'delivered'
    && delivered.payload.id === 'msg-2' && delivered.subject === 'sess-a' && delivered.actor === undefined
    && irrelevant === null && malformed === null
  record('11 a team event maps to a control record, and anything else is refused',
    ok,
    'task->' + JSON.stringify(task?.payload) + ' member->' + JSON.stringify(member?.payload)
    + ' queued->' + JSON.stringify(queued?.payload) + ' from=' + String(queued?.actor)
    + ' delivered->' + JSON.stringify(delivered?.payload) + ' actorless=' + String(delivered?.actor === undefined)
    + ' user/message->' + String(irrelevant) + ' task-without-id->' + String(malformed))
}

// ---------------------- 12 end to end: the kernel's feed drives the ledger, and the fold agrees
{
  const dir = freshDir()
  const log = openControlLog({ dir })
  // A stub context stands in for the kernel's Session feed: `on` captures the listener and
  // `effect` captures the disposer, which is all this module asks of a context.
  // The effect stub models the framework contract as this module uses it — the synchronous
  // function-return form — and deliberately rejects anything else: cordis also accepts a body that
  // returns a Promise or an iterable (vendor/cordis/src/fiber.ts:373-375), but a stub wider than
  // the case under test would accept shapes this gate was never asked to reason about. cordis RUNS the body
  // immediately and keeps the disposer the body RETURNS (vendor/cordis/src/fiber.ts:404-418). The
  // earlier stub stored the body itself as the disposer, so a recorder that passed its teardown as
  // the body looked correct here while it unsubscribed itself at load in a real kernel — a stub
  // that encodes the wrong contract hides the defect instead of catching it.
  let listener = null
  let disposer = null
  const ctx = {
    on: (name, fn) => { listener = fn; return () => { listener = null } },
    effect: (work) => {
      const produced = work()
      if (typeof produced !== 'function') {
        throw new Error('the effect body must return its disposer, and this one returned ' + typeof produced)
      }
      disposer = produced
    },
  }
  const recorder = recordTeamEvents(ctx, log)
  if (listener === null) throw new Error('the recorder did not subscribe')

  const feed = [
    { type: 'team/member', data: { teamId: 't', member: { id: 'm1', name: 'worker-a', role: 'teammate', phase: 'active' } } },
    { type: 'team/task', data: { teamId: 't', task: { id: 'k1', revision: 1, subject: 'first', status: 'pending' } } },
    { type: 'team/task', data: { teamId: 't', task: { id: 'k1', revision: 2, subject: 'first', status: 'in_progress', ownerName: 'worker-a' } } },
    { type: 'user/message', data: { role: 'user', content: [] } },
    { type: 'team/message/queued', data: { teamId: 't', message: { id: 'q1', senderId: 'sess-lead', senderName: 'lead', targetId: 'sess-a', content: [] } } },
    { type: 'team/task', data: { teamId: 't', task: { id: 'k1', revision: 3, subject: 'first', status: 'completed', ownerName: 'worker-a' } } },
  ]
  for (const event of feed) listener({}, event)
  // The recorder is fire-and-forget by design, so the test waits for the appends to land rather
  // than assuming they have: an observer must be measured where it actually is.
  const deadline = Date.now() + 5000
  while (recorder.counts.recorded < 5 && Date.now() < deadline) await new Promise((wake) => setTimeout(wake, 50))

  const state = projectTeamState(log.replay())
  const task = state.tasks.find((row) => row.id === 'k1')
  const member = state.members.find((row) => row.id === 'm1')
  const messages = log.replay().filter((row) => row.kind === 'team.message')

  const pass = recorder.counts.recorded === 5 && recorder.counts.ignored === 1 && recorder.counts.failed === 0
    && task?.status === 'completed' && task?.owner === 'worker-a' && task?.records === 3
    && member?.state === 'active' && messages.length === 1 && messages[0].payload.state === 'queued'

  // Disposal must detach the listener, or a reloaded plugin keeps writing through a dead log.
  disposer?.()
  const before = log.replay().length
  if (listener !== null) listener({}, { type: 'team/task', data: { teamId: 't', task: { id: 'k1', status: 'deleted' } } })
  await new Promise((wake) => setTimeout(wake, 200))
  const detached = log.replay().length === before

  record('12 the kernel feed drives the ledger, and the fold agrees with it',
    pass && detached,
    'recorded=' + recorder.counts.recorded + ' ignored=' + recorder.counts.ignored + ' failed=' + recorder.counts.failed
    + ' task=' + (task === undefined ? 'none' : task.status + '/' + String(task.owner) + '(' + task.records + ')')
    + ' member=' + String(member?.state) + ' messages=' + messages.length + ' detachedOnDispose=' + String(detached))
  await log.close()
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 13 one task per (team, id)
{
  // Two teams are the documented main case (the plan puts two Teams in one session), and the
  // kernel does not make task ids unique across them. A fold that keys by id alone keeps whichever
  // team wrote last and counts both records as folded, so the loss is invisible in every counter.
  const state = projectTeamState([
    { seq: 1, channel: 'control', at: 0, kind: 'task/state', actor: 'team-A', payload: { id: 'task-1', state: 'pending' } },
    { seq: 2, channel: 'control', at: 0, kind: 'task/state', actor: 'team-B', payload: { id: 'task-1', state: 'completed', owner: 'bob' } },
    { seq: 3, channel: 'control', at: 0, kind: 'member/state', actor: 'team-B', payload: { id: 'm1', state: 'active', name: 'bob' } },
  ])
  const byTeam = (team, id) => state.tasks.find((row) => row.team === team && row.id === id)
  const held = state.tasks.length === 2 && state.counts.tasks === 2 && state.counts.teams === 2
    && byTeam('team-A', 'task-1')?.status === 'pending'
    && byTeam('team-B', 'task-1')?.status === 'completed' && byTeam('team-B', 'task-1')?.owner === 'bob'
    && state.members.every((row) => row.team !== null)
  record('13 one task per (team, id) — two teams do not merge',
    held,
    'tasks=' + JSON.stringify(state.tasks.map((row) => String(row.team) + '/' + row.id + '/' + row.status))
    + ' counts=' + JSON.stringify(state.counts))
}

// ---------------------------------------------------------------- 13b the team id can move fields
{
  // The fold knows the team id where the kernel puts it today (the record's actor). A writer that
  // puts it in the payload instead — a future kernel, a second producer, a backfilled row — must
  // not fold into the unnamed bucket, because that is the same silent merge under another field
  // name. Both rows carry the same task id and the same team ids; only the field differs.
  const payloadRows = [
    { seq: 1, channel: 'control', at: 0, kind: 'task/state', payload: { id: 'task-1', state: 'pending', teamId: 'team-A' } },
    { seq: 2, channel: 'control', at: 0, kind: 'task/state', payload: { id: 'task-1', state: 'completed', teamId: 'team-B' } },
  ]
  const viaPayload = projectTeamState(payloadRows)
  const actorRows = payloadRows.map((row) => ({ ...row, actor: row.payload.teamId }))
  const viaActor = projectTeamState(actorRows)
  record('13b a team id in the payload folds like a team id on the actor',
    viaPayload.tasks.length === 2 && viaPayload.counts.teams === 2 && viaPayload.tasks.length === viaActor.tasks.length,
    'payload=' + JSON.stringify(viaPayload.counts) + ' actor=' + JSON.stringify(viaActor.counts))
}

// ---------------------------------------------------------------- 13c unattributed is not a team
{
  // An unnamed bucket is not a team, and a reader asking how many teams it is looking at must not
  // be told three when the answer is two plus one record the writer never attributed. Empty and
  // missing are the same fact to this fold; both are reported as unattributed records.
  const state = projectTeamState([
    { seq: 1, channel: 'control', at: 0, kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } },
    { seq: 2, channel: 'control', at: 0, kind: 'task/state', actor: 'team-B', payload: { id: 't2', state: 'open' } },
    { seq: 3, channel: 'control', at: 0, kind: 'task/state', payload: { id: 't3', state: 'open' } },
    { seq: 4, channel: 'control', at: 0, kind: 'task/state', actor: '', payload: { id: 't4', state: 'open' } },
  ])
  record('13c counts report named teams and unattributed records separately',
    state.counts.teams === 2 && state.counts.unattributed === 2 && state.counts.tasks === 4,
    'counts=' + JSON.stringify(state.counts))
}

// ---------------------------------------------------------------- 14 the switches ship inert
{
  // The flags are compiled into the shipped file, so an inherited environment variable must not
  // be able to unsubscribe the plugin or replay its sequence. This injection removes the master
  // switch and sets a flag anyway: the flag has to do nothing.
  const master = process.env.DSH_LINK_COLLAB_ATTACKS
  const forget = process.env.DSH_LINK_COLLAB_FORGET_SEQ
  delete process.env.DSH_LINK_COLLAB_ATTACKS
  process.env.DSH_LINK_COLLAB_FORGET_SEQ = '1'
  let restarted = null
  let inert = false
  try {
    const dir = freshDir()
    const first = openControlLog({ dir })
    await first.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'pending' } })
    await first.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'completed' } })
    await first.close()
    // With the flag honored this reopens at sequence 0 and the next append reuses seq 1.
    restarted = openControlLog({ dir })
    inert = restarted.lastSeq === 2
    await restarted.close()
    rmSync(dir, { recursive: true, force: true })
  } finally {
    if (master === undefined) delete process.env.DSH_LINK_COLLAB_ATTACKS
    else process.env.DSH_LINK_COLLAB_ATTACKS = master
    if (forget === undefined) delete process.env.DSH_LINK_COLLAB_FORGET_SEQ
    else process.env.DSH_LINK_COLLAB_FORGET_SEQ = forget
  }
  record('14 an injection flag does nothing without the master switch',
    inert,
    'lastSeq after reopen with the flag set but the master switch off=' + String(restarted?.lastSeq))
}

// ---------------------------------------------------------------- 15 a lock naming no live writer
{
  const truncated = freshDir()
  writeFileSync(join(truncated, '.writer'), '', 'utf8')
  let reclaimedEmpty = false
  try {
    const log = openControlLog({ dir: truncated })
    await log.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } })
    reclaimedEmpty = log.replay().length === 1
    await log.close()
  } catch (error) { reclaimedEmpty = false }
  rmSync(truncated, { recursive: true, force: true })

  // A pid that has exited: the lock it left is unreleasable by its writer, and obeying it would
  // refuse this plugin for the lifetime of the file. Reclaiming it is the only way back.
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' })
  const goneDir = freshDir()
  writeFileSync(join(goneDir, '.writer'), String(dead.pid ?? 0), 'utf8')
  let reclaimedDead = false
  try {
    const log = openControlLog({ dir: goneDir })
    await log.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } })
    reclaimedDead = log.replay().length === 1
    await log.close()
  } catch (error) { reclaimedDead = false }
  rmSync(goneDir, { recursive: true, force: true })

  // A live holder is still refused: reclaiming must not become "take the lock whenever the
  // content looks wrong to me", or two kernels on one home share a counter.
  const liveDir = freshDir()
  writeFileSync(join(liveDir, '.writer'), String(process.pid), 'utf8')
  let refused = false
  try { openControlLog({ dir: liveDir }) } catch (error) { refused = /already open by process/.test(String(error?.message ?? error)) }
  rmSync(liveDir, { recursive: true, force: true })

  // The supported way back: a lock naming a live process that does not hold this log (a recycled id,
  // or any unrelated live process) can be taken by a caller that asks for it, without arming fault
  // injection. Recovery must not depend on a test switch.
  let reclaimedOnRequest = false
  const askedDir = freshDir()
  writeFileSync(join(askedDir, '.writer'), String(process.pid), 'utf8')
  try {
    const log = openControlLog({ dir: askedDir, reclaim: true })
    await log.append({ kind: 'task/state', actor: 'team-A', payload: { id: 't1', state: 'open' } })
    reclaimedOnRequest = log.replay().length === 1
    await log.close()
  } catch (error) { reclaimedOnRequest = false }
  rmSync(askedDir, { recursive: true, force: true })

  record('15 a lock naming no live writer is reclaimed, a live one needs reclaim: true',
    reclaimedEmpty && reclaimedDead && refused && reclaimedOnRequest,
    'empty=' + String(reclaimedEmpty) + ' deadPid(' + String(dead.pid) + ')= ' + String(reclaimedDead)
    + ' liveRefused=' + String(refused) + ' onRequest=' + String(reclaimedOnRequest))
}

const failed = results.filter((row) => !row.ok)
console.log('')
console.log((selfAttack ? 'with attacks armed: ' : '') + results.length + ' injections, ' + (results.length - failed.length) + ' held, ' + failed.length + ' failed')
process.exit(failed.length > 0 ? 1 : 0)
