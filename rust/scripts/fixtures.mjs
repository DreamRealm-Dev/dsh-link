#!/usr/bin/env node
/**
 * Deterministic fixtures shared by the smoke test and the microbenchmark.
 *
 * Nothing here reads the clock or a random source: the same seed produces the same
 * bytes on every run and every machine, so a benchmark number can be compared with
 * the next one. The collab fixture is shaped like real `dsh-link-collab` control
 * records (seq / at / kind / subject / payload); the team fixture is shaped like the
 * `agent-team` journal's `team/member` and `team/task` payloads plus a runtime
 * presence event.
 */

/** Small, fast, deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick one element of `list` with `random`. */
function pick(random, list) {
  return list[Math.floor(random() * list.length)]
}

/** Shuffle a copy of `list` with the given seed. */
export function shuffled(list, seed) {
  const random = mulberry32(seed)
  const copy = list.slice()
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const item = copy[index]
    copy[index] = copy[other]
    copy[other] = item
  }
  return copy
}

/** The capabilities members declare in the fixture. */
const CAPABILITIES = ['analyze', 'build', 'critique', 'dispatch', 'index', 'review', 'test', 'write']

/** The message texts the fixture sends between members. */
const MESSAGE_TEXTS = [
  'ready to take the next task',
  'the ledger fold is done, moving to the index',
  'please review the strict-mode typecheck output',
  'blocked on the build lock, retrying in a moment',
  'handing the panel section to the next owner',
]

/**
 * Build a 1000-row (by default) collaboration-ledger fixture.
 *
 * The fixture deliberately contains 5 damaged rows (no kind, a non-object row, a
 * member/state with no id, a team/state with no team, a capability/state with no
 * declaration), so the fold's `malformedRows` path is exercised by the same fixture
 * whose summary is benchmarked.
 * @param {number} rowCount - total number of rows to produce.
 * @param {number} seed - PRNG seed.
 * @returns {{rows: object[], meta: object}} rows plus the shape facts a test asserts.
 */
export function makeCollabRecords(rowCount = 1000, seed = 0x5eed5eed) {
  const random = mulberry32(seed)
  const teams = [
    { team: 'root', parent: null, lead: 'm00' },
    { team: 't1', parent: 'root', lead: 'm01' },
    { team: 't2', parent: 'root', lead: 'm02' },
    { team: 't3', parent: 't1', lead: 'm03' },
    { team: 't4', parent: 't2', lead: 'm04' },
  ]
  const memberCount = 24
  const members = []
  for (let index = 0; index < memberCount; index += 1) {
    const team = teams[index % teams.length].team
    members.push({ id: 'm' + String(index).padStart(2, '0'), team })
  }
  const taskCount = 120
  const tasks = []
  for (let index = 0; index < taskCount; index += 1) {
    tasks.push({
      id: 'task-' + String(index).padStart(3, '0'),
      team: teams[index % teams.length].team,
      owner: members[index % memberCount].id,
      state: index % 3 === 0 ? 'completed' : index % 3 === 1 ? 'in_progress' : 'pending',
    })
  }

  const rows = []
  let seq = 0
  const push = (kind, subject, payload) => {
    seq += 1
    rows.push({ seq, channel: 'control', at: 1_700_000_000_000 + seq * 10, kind, subject, payload })
  }

  // Teams: one declaration each, plus one contested declaration (t2 first claims no
  // parent, then names root) so parent arbitration and the contested count are real.
  for (const team of teams) {
    push('team/state', team.team, { team: team.team, parent: team.parent, lead: team.lead })
  }
  push('team/state', 't2', { team: 't2', parent: 'root' })

  // Members: a provisioning row and then an active row, so "last wins" is exercised.
  for (const member of members) {
    push('member/state', member.id, { id: member.id, team: member.team, state: 'provisioning' })
    push('member/state', member.id, { id: member.id, team: member.team, state: 'active' })
  }
  // Capabilities: a full set, then one incremental declaration.
  for (const member of members) {
    const names = [pick(random, CAPABILITIES), pick(random, CAPABILITIES), pick(random, CAPABILITIES)]
    push('capability/state', member.id, { id: member.id, capabilities: [...new Set(names)] })
    push('capability/state', member.id, { id: member.id, capability: pick(random, CAPABILITIES) })
  }
  // Tasks: the first update and, for every third task, a completing update.
  for (const task of tasks) {
    push('task/state', task.id, { id: task.id, team: task.team, state: 'pending', revision: 1, owner: task.owner })
    if (task.state !== 'pending') {
      push('task/state', task.id, { id: task.id, team: task.team, state: task.state, revision: 2, owner: task.owner })
    }
  }

  const filler = ['member/heartbeat', 'team.message', 'session/claim', 'task/dispatch', 'task/result', 'lock/state']
  while (rows.length < rowCount - 5) {
    const kind = pick(random, filler)
    const member = pick(random, members)
    const task = pick(random, tasks)
    if (kind === 'member/heartbeat') {
      push(kind, member.id, { id: member.id, at: 1_700_000_000_000 + seq * 10 })
    } else if (kind === 'team.message') {
      push(kind, member.id, { from: member.id, to: pick(random, members).id, text: pick(random, MESSAGE_TEXTS) })
    } else if (kind === 'session/claim') {
      push(kind, member.id, { id: member.id, session: 's-' + member.id, state: 'claimed' })
    } else if (kind === 'task/dispatch') {
      push(kind, task.id, { task: task.id, to: member.id })
    } else if (kind === 'task/result') {
      push(kind, task.id, { task: task.id, by: member.id, ok: true })
    } else {
      push(kind, 'ledger', { writer: 'fixture' })
    }
  }

  // Five damaged rows: the fold must count them, never guess at them.
  rows.push({ channel: 'control', at: 1_700_000_000_000, subject: 'no-kind', payload: {} })
  rows.push(42)
  rows.push({ seq: rows.length + 1, channel: 'control', at: 1_700_000_000_000, kind: 'member/state', payload: {} })
  rows.push({ seq: rows.length + 1, channel: 'control', at: 1_700_000_000_000, kind: 'team/state', payload: {} })
  rows.push({ seq: rows.length + 1, channel: 'control', at: 1_700_000_000_000, kind: 'capability/state', payload: {} })

  return {
    rows: shuffled(rows, seed ^ 0x9e3779b9),
    meta: {
      rowCount: rows.length,
      teams: teams.length,
      members: memberCount,
      tasks: taskCount,
      malformedRows: 5,
      contestedTeams: 1,
    },
  }
}

/**
 * Build a team-event fixture for `memberCount` members (12 or 24 in the acceptance).
 *
 * Roster shape: one lead, three L2 leads (spawned by lead), and the rest L3 (spawned by
 * one of the L2 names), so parent resolution, derived depth and children counts are all
 * exercised. Every member gets a provisioning and an active snapshot; tasks step through
 * their states; some sessions report running and then stop.
 * @param {number} memberCount - roster size, lead included.
 * @param {number} seed - PRNG seed.
 * @returns {{events: object[], meta: object}} events plus the shape facts a test asserts.
 */
export function makeTeamEvents(memberCount = 12, seed = 0x7ea3) {
  const random = mulberry32(seed)
  const events = []
  let seq = 0
  const push = (type, subject, payload) => {
    seq += 1
    events.push({ seq, at: 1_700_000_000_000 + seq * 10, type, subject, payload })
  }
  const l2Names = ['builder-lead', 'analyst-lead', 'critic-lead']
  const l2Ids = ['s-l2-builder', 's-l2-analyst', 's-l2-critic']
  const roster = [{ id: 's-lead', name: 'lead', spawnedBy: undefined, depth: 0 }]
  for (let index = 0; index < l2Names.length && roster.length < memberCount; index += 1) {
    roster.push({ id: l2Ids[index], name: l2Names[index], spawnedBy: 'lead', depth: 1 })
  }
  while (roster.length < memberCount) {
    const index = roster.length - 4
    const l2 = index % l2Names.length
    roster.push({ id: 's-l3-' + index, name: 'l3-' + index, spawnedBy: l2Names[l2], depth: 2 })
  }

  for (const member of roster) {
    push('team/member', member.id, {
      version: 2,
      teamId: 'team-root',
      member: {
        id: member.id,
        name: member.name,
        description: 'fixture member',
        provider: 'fixture',
        context: 'fresh',
        phase: 'provisioning',
        ...(member.spawnedBy === undefined ? {} : { spawnedBy: member.spawnedBy }),
        ...(member.depth === undefined ? {} : { depth: member.depth }),
      },
    })
    const failed = member.depth === 2 && member.id.endsWith('3')
    push('team/member', member.id, {
      version: 2,
      teamId: 'team-root',
      member: {
        id: member.id,
        name: member.name,
        description: 'fixture member',
        provider: 'fixture',
        context: 'fresh',
        phase: failed ? 'failed' : 'active',
        ...(member.spawnedBy === undefined ? {} : { spawnedBy: member.spawnedBy }),
        ...(member.depth === undefined ? {} : { depth: member.depth }),
      },
    })
  }

  const taskCount = 12
  for (let index = 0; index < taskCount; index += 1) {
    const id = 'k' + String(index).padStart(2, '0')
    const owner = roster[index % roster.length]
    push('team/task', id, { version: 2, teamId: 'team-root', task: { id, revision: 1, subject: 'fixture task', description: 'task', status: 'pending', blockedBy: [], writeScopes: [], ownerId: owner.id } })
    push('team/task', id, { version: 2, teamId: 'team-root', task: { id, revision: 2, subject: 'fixture task', description: 'task', status: index % 4 === 0 ? 'completed' : 'in_progress', blockedBy: [], writeScopes: [], ownerId: owner.id } })
  }

  // Runtime presence: roughly every third member is running at read time.
  for (const member of roster) {
    if (roster.indexOf(member) % 3 === 0) {
      push('session/presence', member.id, { sessionId: member.id, running: true })
    }
  }
  push('session/started', roster[0].id, { sessionId: roster[0].id })
  push('session/ended', roster[1].id, { sessionId: roster[1].id })

  // Two events the index does not model, and two damaged events.
  push('session/turn', 's-lead', { sessionId: 's-lead', turn: 1 })
  push('team/message', 's-lead', { id: 'msg-1', text: 'hello' })
  push('team/member', 'broken', { member: { id: 's-broken' } })
  push('session/presence', 's-lead', { sessionId: 's-lead' })

  return {
    events: shuffled(events, seed ^ 0x85ebca6b),
    meta: { memberCount: roster.length, events: events.length, derivedMaxDepth: 2, l2: l2Ids.length },
  }
}
