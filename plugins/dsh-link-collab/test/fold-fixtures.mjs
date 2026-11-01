/**
 * Deterministic ledger fixtures for the fold / checkpoint differential suite.
 *
 * Reference only: these rows are built from the module's DOCUMENTED record shapes (`kind`,
 * `subject`, `payload`), not by calling the production record builders, so a fixture exercises the
 * reader rather than the writer. Every set is a pure function of its seed and length; the same
 * arguments produce byte-identical rows on every run, which is what lets one artifact's fold be
 * compared with another's.
 */

/** A tiny deterministic PRNG (mulberry32) so fixtures never depend on Math.random. */
export function prng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Attach ledger envelope fields (seq, channel, at) to a body, and return it. */
const row = (seq, at, body) => ({ seq, channel: 'control', at, ...body })

const TEAMS = ['team-A', 'team-B', 'team-C', 'team-D']
const MEMBERS = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11']
const TOOLS = ['run', 'read', 'write', 'plan']
const STATUSES = ['pending', 'in_progress', 'pending-claim', 'completed', 'done', 'deleted', 'weird-status']
const PHASES = ['active', 'idle', 'provisioning', 'failed', 'quarantined']

/** One record body of a given kind, deterministic on (random, index). Imports no product code. */
function bodyAt(kind, i, random, ctx) {
  const pick = (list) => list[Math.floor(random() * list.length) % list.length]
  const member = pick(MEMBERS)
  const team = pick(TEAMS)
  const taskId = 't' + String(ctx.task)
  switch (kind) {
    case 'task/state': {
      const status = pick(STATUSES)
      const owner = random() < 0.65 ? pick(MEMBERS) : undefined
      const deps = random() < 0.35 ? [pick(ctx.taskIds), pick(ctx.taskIds)] : undefined
      return {
        kind, actor: team, subject: taskId,
        payload: {
          id: taskId, state: status,
          ...(owner === undefined ? {} : { owner }),
          revision: ctx.revision,
          ...(random() < 0.5 ? { title: 'task ' + taskId + ' rev ' + String(ctx.revision) } : {}),
          ...(deps === undefined ? {} : { deps }),
          ...(random() < 0.2 ? { capability: pick(TOOLS) } : {}),
        },
      }
    }
    case 'member/state': {
      const phase = pick(PHASES)
      return {
        kind, actor: team, subject: member,
        payload: {
          id: member, state: phase,
          name: member.toUpperCase(),
          role: pick(['builder', 'lead', 'probe']),
          ...(ctx.multilevel && random() < 0.5 ? { spawnedBy: pick(MEMBERS), depth: Math.floor(random() * 3) } : {}),
          ...(phase === 'quarantined' ? { at: ctx.at, reason: 'HEARTBEAT_STALE', task: taskId, by: 'reclaimer' } : {}),
        },
      }
    }
    case 'capability/state':
      return random() < 0.3
        ? { kind, subject: member, payload: { id: member, capability: pick(TOOLS) } }
        : { kind, subject: member, payload: { id: member, capabilities: [pick(TOOLS), pick(TOOLS)] } }
    case 'member/heartbeat':
      return { kind, subject: member, payload: { id: member, at: ctx.at - Math.floor(random() * 10000) } }
    case 'team/state':
      return {
        kind, subject: team,
        payload: {
          team,
          parent: random() < 0.45 ? null : pick(TEAMS),
          ...(random() < 0.4 ? { lead: pick(MEMBERS) } : {}),
        },
      }
    case 'team.message':
      return {
        kind, actor: member, subject: pick(MEMBERS),
        payload: { id: 'msg-' + String(i), state: pick(['queued', 'delivered', 'accepted']), scope: 'this-end', senderId: member, targetId: pick(MEMBERS) },
      }
    case 'peer/state':
      return { kind, subject: pick(TEAMS), payload: { from: pick(TEAMS), to: pick(TEAMS), request: 'req-' + String(i), state: pick(['requested', 'granted', 'denied']) } }
    case 'lock/state':
      return { kind, subject: taskId, payload: { task: taskId, holder: random() < 0.5 ? pick(MEMBERS) : null, at: ctx.at, team } }
    case 'session/claim':
      return { kind, subject: 's' + String(ctx.session), payload: { session: 's' + String(ctx.session), end: pick(['end-A', 'end-B', 'end-C']), epoch: ctx.epoch, at: ctx.at } }
    case 'session/handoff':
      return { kind, subject: 's' + String(ctx.session), payload: { session: 's' + String(ctx.session), from: 'end-A', to: pick(['end-B', 'end-C']), epoch: ctx.epoch + 1, at: ctx.at } }
    case 'session/turn':
      return { kind, subject: 's' + String(ctx.session), payload: { session: 's' + String(ctx.session), end: pick(['end-A', 'end-B', 'end-C']), epoch: ctx.epoch, text: 'turn ' + String(i), at: ctx.at } }
    case 'member/host':
      return { kind, subject: member, payload: { id: member, end: pick(['end-A', 'end-B']), via: random() < 0.3 ? null : 'end-C', at: ctx.at } }
    case 'end/manifest':
      return { kind, subject: pick(['end-A', 'end-B', 'end-C']), payload: { end: pick(['end-A', 'end-B', 'end-C']), via: random() < 0.3 ? null : 'end-C', platform: pick(['web', 'desktop']), protocolVersion: 'dsh-link-device/1', capabilities: [pick(TOOLS)], at: ctx.at } }
    case 'team/merge':
      return { kind, subject: pick(TEAMS), payload: { from: pick(TEAMS), to: pick(TEAMS), state: pick(['requested', 'granted', 'denied']), mode: pick(['join', 'absorb']), by: pick(MEMBERS), at: ctx.at } }
    case 'adapter/state':
      return { kind, subject: 'adapter-' + String(i % 3), payload: { id: 'adapter-' + String(i % 3), platform: pick(['mcp', 'cli']), protocolVersion: 'dsh-link-adapter/1', offers: [pick(TOOLS)] } }
    case 'task/dispatch':
      return { kind, subject: 'd' + String(ctx.dispatch), payload: { id: 'd' + String(ctx.dispatch), to: member, tool: pick(TOOLS), args: { q: i }, at: ctx.at, ...(random() < 0.2 ? { retryOf: 'd' + String(ctx.dispatch), attempt: 1 } : {}) } }
    case 'task/result':
      return { kind, subject: 'd' + String(ctx.dispatch), payload: { id: 'd' + String(ctx.dispatch), from: member, ok: true, value: { answer: i }, at: ctx.at } }
    case 'task/retry-lease':
      return { kind, subject: 'd' + String(ctx.dispatch), payload: { root: 'd' + String(ctx.dispatch), end: pick(['end-A', 'end-B']), at: ctx.at, untilMs: 5000 } }
    case 'member/quarantine':
      return { kind, subject: member, payload: { id: member, at: ctx.at, reason: 'HEARTBEAT_STALE', task: taskId, by: 'reclaimer' } }
    default:
      return { kind, subject: 'unknown-' + String(i), payload: { id: 'unknown-' + String(i) } }
  }
}

/** Cycle order the 'mixed' profile follows; every readable kind appears at least once per 28 rows. */
const MIXED_KINDS = [
  'task/state', 'member/state', 'capability/state', 'member/heartbeat', 'team/state', 'team.message',
  'task/state', 'peer/state', 'lock/state', 'session/claim', 'session/turn', 'task/dispatch',
  'task/state', 'member/state', 'session/turn', 'task/result', 'member/host', 'end/manifest',
  'task/state', 'team/merge', 'adapter/state', 'member/heartbeat', 'task/retry-lease', 'member/quarantine',
  'task/state', 'session/handoff', 'member/state', 'task/state',
]

/** Profiles: each returns record BODIES in ledger order. */
const PROFILES = {
  mixed: (count, seed) => {
    const random = prng(seed)
    const bodies = []
    const ctx = { task: 0, taskIds: ['t0', 't1', 't2'], revision: 0, dispatch: 0, session: 0, epoch: 1, multilevel: false, at: 0 }
    for (let i = 0; i < count; i += 1) {
      const kind = MIXED_KINDS[i % MIXED_KINDS.length]
      ctx.at = 1700000000000 + i
      ctx.task = i % 7
      ctx.revision = i
      if (kind === 'task/dispatch') ctx.dispatch = i
      if (kind === 'task/result') ctx.dispatch = i
      if (kind === 'task/retry-lease') ctx.dispatch = i
      if (kind === 'session/claim' || kind === 'session/handoff' || kind === 'session/turn') { ctx.session = i % 3; ctx.epoch = 1 + Math.floor(i / 9) }
      bodies.push(bodyAt(kind, i, random, ctx))
    }
    return bodies
  },
  'mixed-multilevel': (count, seed) => {
    const random = prng(seed)
    const bodies = []
    const ctx = { task: 0, taskIds: ['t0', 't1', 't2'], revision: 0, dispatch: 0, session: 0, epoch: 1, multilevel: true, at: 0 }
    for (let i = 0; i < count; i += 1) {
      const kind = MIXED_KINDS[i % MIXED_KINDS.length]
      ctx.at = 1700000000000 + i
      ctx.task = i % 7
      ctx.revision = i
      bodies.push(bodyAt(kind, i, random, ctx))
    }
    return bodies
  },
  'task-churn': (count, seed) => {
    const random = prng(seed)
    const ctx = { task: 0, taskIds: ['t0', 't1', 't2'], revision: 0, dispatch: 0, session: 0, epoch: 1, multilevel: false, at: 0 }
    const bodies = []
    for (let i = 0; i < count; i += 1) {
      ctx.at = 1700000000000 + i
      ctx.task = i % 16
      ctx.revision = i
      bodies.push(bodyAt('task/state', i, random, ctx))
    }
    return bodies
  },
  'dispatch-heavy': (count, seed) => {
    const random = prng(seed)
    const ctx = { task: 0, taskIds: ['t0'], revision: 0, dispatch: 0, session: 0, epoch: 1, multilevel: false, at: 0 }
    const bodies = []
    for (let i = 0; i < count; i += 1) {
      ctx.at = 1700000000000 + i
      ctx.dispatch = Math.floor(i / 3)
      const kind = i % 3 === 0 ? 'capability/state' : i % 3 === 1 ? 'task/dispatch' : (i % 6 === 2 ? 'task/result' : 'task/retry-lease')
      bodies.push(bodyAt(kind, i, random, ctx))
    }
    return bodies
  },
  'session-heavy': (count, seed) => {
    const random = prng(seed)
    const ctx = { task: 0, taskIds: ['t0'], revision: 0, dispatch: 0, session: 0, epoch: 1, multilevel: false, at: 0 }
    const bodies = []
    const kinds = ['session/claim', 'session/turn', 'session/turn', 'session/handoff', 'session/claim', 'session/turn']
    for (let i = 0; i < count; i += 1) {
      ctx.at = 1700000000000 + i
      ctx.session = i % 2
      ctx.epoch = 1 + Math.floor(i / 5)
      bodies.push(bodyAt(kinds[i % kinds.length], i, random, ctx))
    }
    return bodies
  },
  'tree-heavy': (count, seed) => {
    const random = prng(seed)
    const ctx = { task: 0, taskIds: ['t0'], revision: 0, dispatch: 0, session: 0, epoch: 1, multilevel: false, at: 0 }
    const bodies = []
    for (let i = 0; i < count; i += 1) {
      ctx.at = 1700000000000 + i
      bodies.push(bodyAt(i % 2 === 0 ? 'team/state' : 'peer/state', i, random, ctx))
    }
    return bodies
  },
  weird: (count, seed) => {
    const random = prng(seed)
    const bodies = []
    for (let i = 0; i < count; i += 1) {
      const kind = ['not/a/kind', 'task/state', 'member/state', 'capability/state', 'member/heartbeat'][i % 5]
      if (kind === 'task/state') bodies.push({ kind, subject: '', payload: {} })
      else if (kind === 'member/state') bodies.push({ kind, subject: 'm' + String(i), payload: { id: 'm' + String(i), state: ['weird', 'active'][i % 2] } })
      else if (kind === 'capability/state') bodies.push({ kind, payload: {} })
      else if (kind === 'member/heartbeat') bodies.push({ kind, subject: 'm' + String(i), payload: { id: 'm' + String(i), at: i % 3 === 0 ? 'later' : 1700000000000 + i } })
      else bodies.push({ kind, subject: 'x' + String(i), payload: { id: random() } })
    }
    return bodies
  },
}

/** Build one named fixture set: records with ledger envelope fields, in sequence order. */
export function fixture(name, count, seed = 20261027) {
  const profile = PROFILES[name]
  if (profile === undefined) throw new Error('unknown fixture profile: ' + name)
  const bodies = profile(count, seed)
  return bodies.map((body, index) => row(index + 1, 1700000000000 + index, body))
}

/** Every fixture the suite uses. Small ones pin behaviour; the large one is the scale reading. */
export function fixtureSets() {
  return [
    ['empty', []],
    ['single', fixture('mixed', 1)],
    ['reverse-40', [...fixture('mixed', 40)].reverse()],
    ['mixed-200', fixture('mixed', 200)],
    ['mixed-multilevel-200', fixture('mixed-multilevel', 200)],
    ['task-churn-200', fixture('task-churn', 200)],
    ['dispatch-60', fixture('dispatch-heavy', 60)],
    ['session-60', fixture('session-heavy', 60)],
    ['tree-60', fixture('tree-heavy', 60)],
    ['weird-40', fixture('weird', 40)],
    ['mixed-2000', fixture('mixed', 2000)],
    ['mixed-100k', fixture('mixed', 100000)],
  ]
}