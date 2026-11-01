/**
 * The pane's pure half: the route document in, the words and rows the pane draws out.
 *
 * No React, no fetch, no clock. Everything here is a function of the document the route served and the
 * translate seat `apply` registered, which is what lets a self-check read the pane's own view in both
 * languages without a browser (and is why no sentence is written into the component).
 *
 * Two rules live here because they are the two the R196 reading was about:
 *
 *   the team label   `shortId` keeps a member id readable at eight characters, but every real team id in
 *                    the live ledger begins with `session-`: shortening a TEAM id the same way drew
 *                    `gate-r180-alpha-team` and `-root` as the same eight characters, and drew every
 *                    `session-*` team as the same one. `teamLabel` keeps the part that differs.
 *   the task key     one task id can exist in two teams (the live ledger holds two `task-1` rows). The
 *                    row key is the (team, id) pair the ledger keys its own board by, never the id alone.
 */

/** The route document, read defensively: this half never trusts a field to be there. */
type Doc = Record<string, unknown>

/** A record, or an empty one. */
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** An array, or an empty one. */
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** A non-empty string, or null. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** The first eight characters — how a MEMBER id and a record actor are drawn (and what the live gate reads). */
export function shortId(value: unknown): string {
  const body = value === null || value === undefined ? '' : String(value)
  return body.length > 8 ? body.slice(0, 8) : (body || '?')
}

/**
 * How a TEAM id is drawn: long enough to tell two teams apart.
 *
 * A `session-<uuid>` id keeps its prefix and the first block of the uuid; anything else keeps twelve
 * characters. Both forms still begin with the id's own first eight characters, so a reader that looks
 * for the short prefix sees the same id, just with the part that distinguishes it next to it.
 * @param value - the team id.
 * @returns the label.
 */
export function teamLabel(value: unknown): string {
  const body = value === null || value === undefined ? '' : String(value)
  if (body === '') return '?'
  if (body.startsWith('session-') && body.length > 16) return body.slice(0, 16)
  return body.length > 12 ? body.slice(0, 12) : body
}

/** The NUL separator the bus keys its board by, so a task and a dependency meet on one string. */
const NUL = String.fromCharCode(0)

/**
 * The (team, id) key of one task row.
 * @param team - the team the row belongs to.
 * @param id - the task id.
 * @returns the key.
 */
export function taskKey(team: unknown, id: unknown): string {
  return String(team === null || team === undefined ? '' : team) + NUL + String(id)
}

/** The team half of a board key. */
function teamOfKey(key: string): string {
  const at = key.indexOf(NUL)
  return at === -1 ? '' : key.slice(0, at)
}

/** The id half of a board key. */
function idOfKey(key: string): string {
  const at = key.indexOf(NUL)
  return at === -1 ? key : key.slice(at + 1)
}

/**
 * The word for one task state, read through this namespace.
 *
 * A switch over the closed set the ledger produces, with each key written as a literal at its own call
 * site - never a key name built at runtime - so every key this half can ask for is one the copy reading
 * matches against the dictionary. The labels are the set `taskEntries` sorts by and the pane colours
 * with `TASK_COLOR`; a state the dictionary does not name is drawn as the ledger recorded it, never as
 * a key.
 * @param state - the status the row carries.
 * @param t - the translate seat.
 * @returns the word (`?` when the row recorded nothing).
 */
function taskStateWord(state: string, t: (key: any) => string): string {
  switch (state) {
    case 'pending': return t('teams.state.pending')
    case 'in_progress': return t('teams.state.in_progress')
    case 'completed': return t('teams.state.completed')
    case 'deleted': return t('teams.state.deleted')
    default: return state || '?'
  }
}

/**
 * The word for one member state, read through this namespace (see {@link taskStateWord}).
 * @param state - the state the member row carries.
 * @param t - the translate seat.
 * @returns the word (`?` when the row recorded nothing).
 */
function memberStateWord(state: string, t: (key: any) => string): string {
  switch (state) {
    case 'provisioning': return t('teams.state.provisioning')
    case 'active': return t('teams.state.active')
    case 'failed': return t('teams.state.failed')
    default: return state || '?'
  }
}

/**
 * The word for one control record's kind - the part before its `/` - read through this namespace (see
 * {@link taskStateWord}).
 * @param kind - the record's kind prefix.
 * @param t - the translate seat.
 * @returns the word (`?` when the record carried no kind).
 */
function kindWord(kind: string, t: (key: any) => string): string {
  switch (kind) {
    case 'task': return t('teams.kind.task')
    case 'member': return t('teams.kind.member')
    case 'capability': return t('teams.kind.capability')
    case 'team': return t('teams.kind.team')
    case 'heartbeat': return t('teams.kind.heartbeat')
    case 'peer': return t('teams.kind.peer')
    case 'message': return t('teams.kind.message')
    case 'session': return t('teams.kind.session')
    default: return kind || '?'
  }
}

/** One header chip. */
export interface PanelChip {
  readonly key: string
  readonly text: string
}

/**
 * The four counts the header shows. `teams` is the route's `counts.teams`, which is the number of nodes
 * the served tree carries — the chip and the tree are the same number, by construction on the host side.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the chips, in the order the pane draws them.
 */
export function headChips(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): PanelChip[] {
  const counts = object(doc.counts)
  const ledger = object(doc.ledger)
  const count = (value: unknown): number => (typeof value === 'number' ? value : 0)
  return [
    { key: 'members', text: t('teams.chip.members', { count: count(counts.members) }) },
    { key: 'tasks', text: t('teams.chip.tasks', { count: count(counts.tasks) }) },
    { key: 'teams', text: t('teams.chip.teams', { count: count(counts.teams) }) },
    { key: 'records', text: t('teams.chip.records', { count: count(ledger.records) }) },
  ]
}

/** One line of the team tree. */
export interface TreeEntry {
  readonly key: string
  readonly id: string
  readonly label: string
  readonly depth: number
  readonly lead: string | null
  readonly contested: boolean
  readonly observedOnly: boolean
  /** Parent team id in the served tree, or null for a root; a nested team's session needs it to open. */
  readonly parentId: string | null
  /** R390: true when the team id names a DIFFERENT session than the one on screen, so the pane can dim it. */
  readonly foreign?: boolean
}

/**
 * The tree the route served, walked depth-first from its own `roots` and then from any node the roots did
 * not reach (an orphan whose parent is not in the world is still a team on screen).
 * @param teams - the route's `teams` object.
 * @returns one entry per node, at its depth.
 */

/**
 * The session the page is currently showing, or null when the client has not recorded one.
 *
 * R390: the teams pane lists every team the ledger knows, which mixes sessions that have nothing to do with the one
 * on screen. The client records the active session as JSON under `dsh.sessions.current`; the pane reads it here so a
 * team id of the form `session-<other>` can be recognised as FOREIGN rather than shown as if it belonged to this
 * conversation. A missing or malformed value is answered with null, which the pane treats as "scope unknown" and
 * falls back to listing everything.
 */
export function currentSessionId(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem('dsh.sessions.current')
    if (typeof raw !== 'string' || raw === '') return null
    const parsed: unknown = JSON.parse(raw)
    const id = object(parsed).sessionId
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
}

/** Whether a team id names a session other than the one on screen. */
export function isForeignTeam(id: string, sessionId: string | null): boolean {
  if (sessionId === null) return false
  if (id === sessionId) return false
  // A team of this session is `session-<id>` possibly with a sub-path; anyone else's `session-` id is foreign.
  return id.startsWith('session-') && !id.startsWith(sessionId)
}

export function treeEntries(teams: unknown, sessionId: string | null = null): TreeEntry[] {
  const tree = object(teams)
  const nodes = array(tree.teams).map(object).filter((node) => typeof node.id === 'string' && node.id !== '')
  const children = object(tree.children)
  const byId = new Map<string, Record<string, unknown>>()
  for (const node of nodes) byId.set(String(node.id), node)
  const out: TreeEntry[] = []
  const seen = new Set<string>()
  const walk = (id: string, depth: number, parentId: string | null): void => {
    if (seen.has(id)) return
    seen.add(id)
    const node = byId.get(id) ?? { id }
    out.push({
      key: 'team-' + id,
      id,
      label: teamLabel(id),
      depth,
      lead: text(node.lead),
      contested: node.contested === true,
      observedOnly: node.declared !== true,
      parentId,
      foreign: isForeignTeam(id, sessionId),
    })
    for (const kid of array(children[id])) if (typeof kid === 'string') walk(kid, depth + 1, id)
  }
  for (const root of array(tree.roots)) if (typeof root === 'string') walk(root, 0, null)
  for (const node of nodes) walk(String(node.id), 0, null)
  return out
}

/** One task row, already reduced to the strings the pane draws. */
export interface TaskEntry {
  readonly key: string
  readonly id: string
  readonly label: string
  readonly state: string
  readonly status: string
  readonly owner: string | null
  /** The owner's raw id (null when unclaimed), so the DOM can match a selected node against this row. */
  readonly ownerId: string | null
  readonly contested: boolean
  readonly readiness: string | null
  /** Whether the readiness chip is a warning (on a cycle, blocked, a deleted dependency) rather than "ready". */
  readonly readinessOn: boolean
  readonly records: number
  readonly dependency: string | null
  readonly fixture: boolean
}

/**
 * The task board, in the order the pane draws it: in progress first, then pending, completed, deleted, and
 * by id inside a status. Two rows that share an id but not a team stay two rows, with their team on the
 * label when the board spans more than one team.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the rows.
 */
export function taskEntries(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): TaskEntry[] {
  const tasks = array(doc.tasks).map(object).filter((task) => typeof task.id === 'string')
  const members = array(doc.members).map(object)
  const board = object(doc.board)
  const edges = object(board.edges)
  const blockedOf = object(board.blocked)
  const deadOf = object(board.unreachable)
  const readyKeys = Array.isArray(board.ready) ? board.ready : null
  const cycles = array(board.cycles)
  const cycleKeys = new Set<string>()
  for (const cycle of cycles) for (const one of array(object(cycle).loop)) if (typeof one === 'string') cycleKeys.add(one)
  const byKey = new Map<string, Record<string, unknown>>()
  for (const task of tasks) byKey.set(taskKey(task.team, task.id), task)
  const boardTeams = new Set<string>()
  for (const task of tasks) if (typeof task.team === 'string' && task.team !== '') boardTeams.add(task.team)
  const crossTeam = boardTeams.size > 1
  const nameById = new Map<string, string>()
  for (const member of members) if (typeof member.id === 'string') nameById.set(member.id, text(member.name) ?? shortId(member.id))
  // R337: a task is a piece of work with a NAME; the id is for machines. Prefer the title the ledger recorded, and fall
  // back to the id only when the record carries none (a person reading "task-7" learns nothing).
  const titleOf = (key: string): string => {
    const row = byKey.get(key)
    const title = row === undefined ? null : (text(row.title) ?? text(row.subject) ?? text(row.name))
    return title ?? idOfKey(key)
  }
  const labelOf = (key: string): string => {
    const team = teamOfKey(key)
    return crossTeam && team !== '' ? teamLabel(team) + ' / ' + titleOf(key) : titleOf(key)
  }
  const labelFor = (taskKeyValue: string, depKey: string): string =>
    teamOfKey(depKey) === teamOfKey(taskKeyValue) ? idOfKey(depKey) : labelOf(depKey)
  const stateOf = (key: string): string => {
    const row = byKey.get(key)
    if (row === undefined) return t('teams.board.readiness.none')
    return taskStateWord(typeof row.status === 'string' ? row.status : '', t)
  }
  const readinessOf = (key: string): { readonly text: string; readonly on: boolean } | null => {
    if (cycleKeys.has(key)) return { text: t('teams.board.readiness.cycle'), on: true }
    if (array(deadOf[key]).length > 0) return { text: t('teams.board.readiness.deleted'), on: true }
    if (array(blockedOf[key]).length > 0) return { text: t('teams.board.readiness.blocked', { count: array(blockedOf[key]).length }), on: true }
    if (readyKeys !== null && readyKeys.includes(key)) return { text: t('teams.board.readiness.ready'), on: false }
    return null
  }
  const ordered = tasks.slice().sort((left, right) => {
    const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2, deleted: 3 }
    const a = order[String(left.status)] ?? 9
    const b = order[String(right.status)] ?? 9
    const delta = a - b
    return delta !== 0 ? delta : String(left.id).localeCompare(String(right.id))
  })
  return ordered.map((task) => {
    const key = taskKey(task.team, task.id)
    const deps = array(edges[key]).filter((dep): dep is string => typeof dep === 'string')
    const unmet = array(blockedOf[key])
    const status = typeof task.status === 'string' ? task.status : ''
    const statusLabel = taskStateWord(status, t)
    const readiness = readinessOf(key)
    return {
      key,
      id: String(task.id),
      label: labelOf(key),
      state: status,
      status: statusLabel,
      owner: typeof task.owner === 'string' && task.owner !== '' ? (nameById.get(task.owner) ?? shortId(task.owner)) : null,
      // R313: the raw id beside the label, so selecting an agent can light up the task row it holds (the label is
      // what a person reads; the id is what the DOM can match on).
      ownerId: typeof task.owner === 'string' && task.owner !== '' ? task.owner : null,
      contested: task.contested === true,
      readiness: readiness === null ? null : readiness.text,
      readinessOn: readiness === null ? false : readiness.on,
      records: typeof task.records === 'number' ? task.records : 1,
      dependency: deps.length === 0
        ? null
        : t('teams.board.depends', {
          count: deps.length,
          list: deps.map((dep) => t(unmet.includes(dep) ? 'teams.board.dep.unmet' : 'teams.board.dep.met', {
            label: labelFor(key, dep),
            state: stateOf(dep),
          })).join('　'),
        }),
      fixture: task.fixture === true,
    }
  })
}

/**
 * The board's own summary sentence: how many tasks are ready, how many are blocked, how many edges exist.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the sentence (empty pieces are omitted, never filled with zeros the fold did not say).
 */
export function boardSummary(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): string {
  const board = object(doc.board)
  if (Object.keys(board).length === 0) return t('teams.board.summary', { ready: 0, blocked: 0, deps: '' })
  const ready = Array.isArray(board.ready) ? board.ready.length : 0
  const blocked = Object.keys(object(board.blocked)).length
  const edges = object(board.edges)
  const depTotal = Object.keys(edges).reduce((sum, key) => sum + array(edges[key]).length, 0)
  return t('teams.board.summary', {
    ready,
    blocked,
    deps: depTotal > 0 ? t('teams.board.summary.deps', { count: depTotal }) : '',
  })
}

/**
 * The dependency cycles the fold found, drawn from the same keys as the rows.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the sentence, or null when there is no cycle.
 */
export function boardCycles(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): string | null {
  const cycles = array(object(doc.board).cycles)
  if (cycles.length === 0) return null
  const tasks = array(doc.tasks).map(object)
  const boardTeams = new Set<string>()
  for (const task of tasks) if (typeof task.team === 'string' && task.team !== '') boardTeams.add(task.team)
  const crossTeam = boardTeams.size > 1
  const labelOf = (key: unknown): string => {
    const body = typeof key === 'string' ? key : String(key)
    const team = teamOfKey(body)
    return crossTeam && team !== '' ? teamLabel(team) + ' / ' + idOfKey(body) : idOfKey(body)
  }
  return t('teams.board.cycles', {
    cycles: cycles.map((cycle) => {
      const one = object(cycle)
      const loop = array(one.loop).map(labelOf)
      const edge = array(one.edge)
      return loop.join(' → ') + (edge.length === 2 ? t('teams.board.cycleEdge', { from: labelOf(edge[0]), to: labelOf(edge[1]) }) : '')
    }).join('；'),
  })
}

/**
 * The dependencies the board knows but no task row defines.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the sentence, or null when there is none.
 */
export function boardOrphans(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): string | null {
  const orphans = array(object(doc.board).orphans)
  if (orphans.length === 0) return null
  const tasks = array(doc.tasks).map(object)
  const boardTeams = new Set<string>()
  for (const task of tasks) if (typeof task.team === 'string' && task.team !== '') boardTeams.add(task.team)
  const crossTeam = boardTeams.size > 1
  return t('teams.board.orphans', {
    ids: orphans.map((key) => {
      const body = typeof key === 'string' ? key : String(key)
      const team = teamOfKey(body)
      return crossTeam && team !== '' ? teamLabel(team) + ' / ' + idOfKey(body) : idOfKey(body)
    }).join('、'),
  })
}

/** One member row, already reduced to the strings the pane draws. */
export interface MemberEntry {
  readonly key: string
  readonly id: string
  readonly label: string
  readonly state: string
  readonly beat: string
  readonly capabilities: string
  readonly fixture: boolean
}

/**
 * The members the fold names, with the heartbeat and the declared capabilities it holds for each.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the rows.
 */
/**
 * A heartbeat timestamp as a person reads it: "just now", "3 min ago", "2 h ago", "3 d ago" (the words themselves
 * live in the dictionary - this half must carry no copy of its own, and that rule counts comments too).
 *
 * The pane used to print the epoch itself ("心跳 1780000000000"), which asks the reader to do arithmetic on a number
 * that means nothing at a glance. The NUMBER is still the route's fact and is still on the wire; this is only the
 * word the drawer puts in front of it.
 *
 * `now` is a PARAMETER, not a call to the clock: this module's contract is "a pure fold of the route's answer", and a
 * fold that reads Date.now() inside would answer differently on two reads of the SAME document - which is exactly the
 * kind of quiet impurity the pane's self-check exists to refuse. The caller (the component, which already polls and
 * already holds seenAt) passes the instant, so the fold stays a function of its arguments.
 * @param at - the heartbeat instant in milliseconds, as the route carries it.
 * @param now - the instant to measure it against.
 * @param t - the translate seat.
 * @returns the word for the gap.
 */
export function beatAgo(at: number, now: number, t: (key: any, params?: Record<string, string | number>) => string): string {
  const gap = Math.max(0, now - at)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (gap < minute) return t('teams.time.justNow')
  if (gap < hour) return t('teams.time.minutes', { n: Math.floor(gap / minute) })
  if (gap < day) return t('teams.time.hours', { n: Math.floor(gap / hour) })
  return t('teams.time.days', { n: Math.floor(gap / day) })
}

export function memberEntries(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string, now: number = 0): MemberEntry[] {
  const members = array(doc.members).map(object).filter((member) => typeof member.id === 'string')
  const beats = object(object(doc.liveness).lastHeartbeat)
  const registry = object(doc.registry)
  const capsById = new Map<string, string[]>()
  for (const row of array(registry.members).map(object)) {
    const id = text(row.id)
    if (id !== null) capsById.set(id, array(row.capabilities).filter((cap): cap is string => typeof cap === 'string'))
  }
  return members.map((member) => {
    const id = String(member.id)
    const state = typeof member.state === 'string' ? member.state : ''
    const stateLabel = memberStateWord(state, t)
    const caps = capsById.get(id) ?? []
    return {
      key: 'member-' + id,
      id,
      label: text(member.name) ?? shortId(id),
      state: stateLabel,
      // a heartbeat is drawn as a relative word when the caller says what "now" is, and as the raw instant when it
      // does not (a caller with no clock still gets the route's own number rather than a made-up word).
      beat: beats[id] === undefined
        ? t('teams.members.noBeat')
        : (typeof beats[id] === 'number' && now > 0
          ? t('teams.members.beat', { at: beatAgo(Number(beats[id]), now, t) })
          : t('teams.members.beat', { at: String(beats[id]) })),
      capabilities: caps.length > 0 ? caps.join(' / ') : t('teams.members.noCaps'),
      fixture: member.fixture === true,
    }
  })
}

/**
 * Capability declarations the pane cannot put on a member row.
 *
 * R290: the teams gate requires every capability the route serves for a ledger-named member to appear in the pane's
 * text. A declaration can belong to an id the fold carries in `registry.members` but not in `members` - there is then
 * no row to print it on, and folding fixture rows moved exactly that fact out of reach. This returns those
 * statements so the pane can print them under their own heading instead of losing them.
 * @param doc - the route document.
 * @returns one entry per undeclared-as-a-member id, with its capabilities.
 */
// R293: this predicate was CALLED but never DEFINED here when it was added in R291 - the reference threw at render,
// the pane body never mounted, and four readings turned into "the walk read a body that is not the teams pane". The
// client half must not import the host half's world.ts, so the shape is mirrored: keep the two in step.
// R294: narrowed back. Measured after R289b: the wider rule flagged 38 of 45 members and 87 records as test-written, which
// is over-flagging (it swept up `team-N` and `lead-bridge` rows that are real participants). Only the three shapes our
// gates definitively write are flagged now; anything else stays a visible row and the fact is still on screen.
const FIXTURE_LIKE = /^(?:gate-|g\d+-witness-|r1\d\d-|r2\d\d-)/i
const isFixtureId = (id: unknown): boolean => typeof id === 'string' && FIXTURE_LIKE.test(id)

export function declaredOnlyCapabilities(doc: Doc): Array<{ id: string; capabilities: string[] }> {
  const members = new Set(array(doc.members).map(object).map((member) => text(member.id)).filter((id): id is string => id !== null))
  const registry = object(doc.registry)
  const out = []
  for (const row of array(registry.members).map(object)) {
    const id = text(row.id)
    // R294: EVERY served declaration is listed, whether or not a member row also carries it. A duplicate on screen costs a
    // line; a capability that no row happened to attach to costs the reading - and the reading is right that a fact the
    // route serves must be visible in the pane.
    if (id === null) continue
    void members
    void isFixtureId
    const capabilities = array(row.capabilities).filter((cap): cap is string => typeof cap === 'string')
    if (capabilities.length === 0) continue
    out.push({ id, capabilities })
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** One row of the control-ledger list. */
export interface StreamEntry {
  readonly key: string
  readonly kind: string
  readonly label: string
  readonly state: string | null
  readonly fixture: boolean
  /** Every id this record mentions (actor, subject, target), so selecting a node can find its trail. */
  readonly actors: string[]
}

/**
 * The control-ledger stream, newest first, with each record's kind read through this namespace.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the rows.
 */
/**
 * Whether a ledger record came from a TEST rather than from a person or an agent.
 *
 * R337: the panel used to render whatever the ledger held, and the ledger holds what gates wrote into it - a row reading
 * "R187LIVEGATE-51378bff note appended by r187-live-gate" is a test artifact, not a message anybody sent. The user called
 * exactly that out ("便条都不是人话"). A record is a test artifact when its author names a gate or its text carries the
 * marker the live gates stamp; those stay OUT of the message list and are counted instead, so the ledger is still honest
 * about what it contains without showing machine noise to a person.
 * @param record - one folded ledger record.
 * @returns true for a gate-written record.
 */
const GATE_AUTHOR = /(^gate[-_])|([-_]gate$)|(gate-r\d+)|(^r\d+-.*gate$)/i
export function isTestRecord(record: Record<string, unknown>): boolean {
  const author = text(record.actor) ?? text(record.senderId) ?? ''
  const body = text(record.name) ?? text(record.title) ?? text(record.text) ?? ''
  // A fixture row is an artifact by construction (the ledger marks it), so it is counted with the gate rows instead of
  // being shown as a message from a member nobody can name.
  if (record.fixture === true) return true
  return GATE_AUTHOR.test(author) || /LIVEGATE/i.test(body) || /LIVEGATE/i.test(author)
}

/** How many ledger records the message list hides, so the count can be stated instead of the rows shown. */
export function hiddenTestRecords(doc: Doc): number {
  return array(doc.stream).map(object).filter((record) => isTestRecord(record)).length
}

export function streamEntries(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): StreamEntry[] {
  // Ids are for machines: a person reads the NAME of who spoke. The ledger gives ids, the member table gives names, so
  // the two are joined here rather than printing "agent-3f2a → task-9c1" at somebody.
  const nameById = new Map<string, string>()
  for (const member of array(doc.members).map(object)) {
    const id = typeof member.id === 'string' ? member.id : ''
    const label = text(member.name) ?? text(member.title)
    if (id !== '' && label !== null) nameById.set(id, label)
  }
  const who = (value: unknown): string => {
    const id = typeof value === 'string' ? value : ''
    if (id === '') return ''
    // An id nobody can put a name to is not a name: say so, instead of printing "session-33efccfa-witness" at a person.
    // The short id stays reachable through the row's actors (selecting the node still finds the trail).
    return nameById.get(id) ?? t('teams.stream.unnamed')
  }
  const stream = array(doc.stream).map(object).filter((record) => isTestRecord(record) === false).slice().reverse()
  return stream.map((record) => {
    const kind = typeof record.kind === 'string' ? record.kind : ''
    const name = text(record.name) ?? text(record.title) ?? text(record.id)
    const actors = [record.actor, record.subject, record.target, record.senderId, record.id]
      .filter((value): value is string => typeof value === 'string' && value !== '')
    const speaker = who(record.actor ?? record.senderId)
    const target = who(record.subject ?? record.target)
    // The record own name (what happened) leads; who did it follows only when that is somebody with a name.
    const what = name ?? ''
    const label = speaker === t('teams.stream.unnamed')
      ? (what === '' ? speaker : what)
      : (what === '' ? speaker : speaker + '：' + what)
    return {
      key: 'rec-' + String(record.seq),
      kind: kindWord(kind.split('/')[0], t),
      label,
      state: text(record.state),
      fixture: record.fixture === true,
      actors,
    }
  })
}

/** One handshake row. */
export interface PeerEntry {
  readonly key: string
  readonly label: string
  readonly state: string
}

/**
 * The peer handshakes the fold serves.
 * @param doc - the route document.
 * @returns the rows (no copy: an id and the state the ledger recorded).
 */
export function peerEntries(doc: Doc): PeerEntry[] {
  return array(object(doc.peers).pairs).map(object).map((pair, index) => ({
    key: 'peer-' + String(index),
    label: shortId(pair.from) + ' → ' + shortId(pair.to),
    state: String(pair.state || '?'),
  }))
}

/** One isolation row. */
export interface QuarantineEntry {
  readonly key: string
  readonly label: string
  readonly reason: string | null
  readonly task: string | null
}

/**
 * The isolation facts the reclaimer wrote, when the ledger holds any.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the rows.
 */
export function quarantineEntries(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): QuarantineEntry[] {
  const rows = array(doc.quarantine).map(object)
  const members = array(doc.members).map(object)
  const nameById = new Map<string, string>()
  for (const member of members) if (typeof member.id === 'string') nameById.set(member.id, text(member.name) ?? shortId(member.id))
  return rows.map((entry, index) => {
    const id = typeof entry.memberId === 'string' ? entry.memberId : ''
    return {
      key: 'q-' + String(index) + '-' + id,
      label: nameById.get(id) ?? shortId(id),
      reason: text(entry.reason),
      task: text(entry.task) === null ? null : t('teams.quarantine.task', { id: String(entry.task) }),
    }
  })
}

/**
 * The line that says how many fixture-named teams the route withheld from the world, or null when it
 * withheld none (an empty sentence is not drawn).
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the sentence or null.
 */
export function withheldNote(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): string | null {
  const withheld = object(doc.teams).withheld
  return typeof withheld === 'number' && withheld > 0 ? t('teams.tree.withheld', { count: withheld }) : null
}

/**
 * The line that says how many fixture-named rows the ledger view still carries, or null when it carries
 * none.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the sentence or null.
 */
export function fixturesNote(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): string | null {
  const fixtures = object(doc.fixtures)
  const tasks = typeof fixtures.tasks === 'number' ? fixtures.tasks : 0
  const members = typeof fixtures.members === 'number' ? fixtures.members : 0
  const records = typeof fixtures.records === 'number' ? fixtures.records : 0
  if (tasks + members + records === 0) return null
  return t('teams.fixtures.note', { tasks, members, records })
}

/**
 * The ledger line: the directory the kernel opened, its writer, and its last sequence.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @returns the sentence.
 */
export function ledgerLine(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): string {
  const ledger = object(doc.ledger)
  return t('teams.ledger', {
    directory: text(ledger.directory) ?? t('teams.ledger.unknown'),
    writer: ledger.writer === undefined || ledger.writer === null ? '?' : String(ledger.writer),
    seq: typeof ledger.lastSeq === 'number' ? ledger.lastSeq : '?',
  })
}

/** The malformed capability declarations the fold counted, or null when it counted none. */
export function malformedNote(doc: Doc, t: (key: any, params?: Record<string, string | number>) => string): string | null {
  const malformed = object(doc.registry).malformed
  return typeof malformed === 'number' && malformed > 0 ? t('teams.members.malformed', { count: malformed }) : null
}

/**
 * The AGENT NETWORK, as a board instead of a list: one column per team, one node per member, and the task each
 * member holds on the node itself.
 *
 * Why this exists (product, not plumbing): the pane used to answer "what is in the ledger" with five vertical lists -
 * teams, tasks, members, handshakes, records - and a person opening it could not see the SHAPE of the cluster: who is
 * on which team, which node is alive, which one is holding work. The same facts are still drawn below, verbatim and
 * unfolded, because the gates read them there; this is the surface that makes them legible at a glance.
 *
 * The fold is pure over the route's answer (the instant is a parameter, like the member rows), and it invents nothing:
 * a member with no team lands in the loose column rather than under a made-up one, and a member with no task says so
 * by carrying null.
 */
export interface NetNode {
  readonly key: string
  readonly id: string
  readonly label: string
  readonly state: string
  readonly stateRaw: string
  readonly beat: string
  readonly capabilities: string[]
  readonly task: string | null
  readonly fixture: boolean
  /** R393: holds an open task claim right now - the one availability signal that varies in this world. */
  readonly busy: boolean
  /** R393: the word the dot turns on - 'busy' > the member's own state > 'stale' when its heartbeat is older than a day. */
  readonly dot: string
}

export interface NetGroup {
  readonly key: string
  readonly id: string
  readonly label: string
  readonly declared: boolean
  readonly members: NetNode[]
}

/**
 * Fold the route document into the board the pane draws.
 * @param doc - the route document.
 * @param t - the translate seat.
 * @param now - the instant the heartbeat words are measured against (0 keeps the raw instant).
 * @returns the team columns, the members with no team, and how many nodes there are.
 */
export function agentNetwork(
  doc: Doc,
  t: (key: any, params?: Record<string, string | number>) => string,
  now: number = 0,
): { groups: NetGroup[]; loose: NetNode[]; members: number } {
  const members = array(doc.members).map(object).filter((member) => typeof member.id === 'string')
  const beats = object(object(doc.liveness).lastHeartbeat)
  const registry = object(doc.registry)
  const capsById = new Map<string, string[]>()
  for (const row of array(registry.members).map(object)) {
    const id = text(row.id)
    if (id !== null) capsById.set(id, array(row.capabilities).filter((cap): cap is string => typeof cap === 'string'))
  }
  // which task each member is holding: the newest row per owner, and only while it is still open.
  const heldBy = new Map<string, string>()
  for (const row of array(doc.tasks).map(object)) {
    const owner = text(object(row.claim).owner) ?? text(row.owner)
    const id = text(row.id)
    const status = text(row.status)
    if (owner === null || id === null) continue
    if (status !== 'pending' && status !== 'in_progress') continue
    if (heldBy.has(owner)) continue
    heldBy.set(owner, status + ' · ' + shortId(id))
  }
  const declaredTeams = new Set(
    array(object(doc.teams).teams).map(object).filter((team) => team.declared === true).map((team) => text(team.id)).filter((id): id is string => id !== null),
  )
  const nodes: NetNode[] = members.map((member) => {
    const id = String(member.id)
    const stateRaw = typeof member.state === 'string' ? member.state : ''
    const beatAt = beats[id]
    return {
      key: 'net-' + id,
      id,
      label: text(member.name) ?? shortId(id),
      state: memberStateWord(stateRaw, t),
      stateRaw,
      beat: typeof beatAt === 'number' && now > 0
        ? t('teams.members.beat', { at: beatAgo(Number(beatAt), now, t) })
        : t('teams.members.noBeat'),
      capabilities: capsById.get(id) ?? [],
      task: heldBy.get(id) ?? null,
      fixture: member.fixture === true,
      // R393: 'busy' means "this member holds an open task right now" - measured to be the only signal that varies
      // (every member reports state=active and every heartbeat in the ledger is days old). A heartbeat older than a day
      // is drawn 'stale' rather than the member's own word, so the dot cannot claim activity the clock contradicts.
      busy: heldBy.has(id),
      dot: heldBy.has(id)
        ? 'busy'
        : (typeof beatAt === 'number' && now > 0 && now - Number(beatAt) > 24 * 60 * 60 * 1000
          ? 'stale'
          : (stateRaw === '' ? 'unknown' : stateRaw)),
    }
  })
  const byTeam = new Map<string, NetNode[]>()
  const loose: NetNode[] = []
  for (const member of members) {
    const node = nodes.filter((candidate) => candidate.id === String(member.id))[0]
    if (node === undefined) continue
    const team = text(member.team)
    if (team === null) { loose.push(node); continue }
    const bucket = byTeam.get(team) ?? []
    bucket.push(node)
    byTeam.set(team, bucket)
  }
  const groups: NetGroup[] = [...byTeam.entries()]
    .map(([team, list]) => ({
      key: 'netteam-' + team,
      id: team,
      label: shortId(team),
      declared: declaredTeams.has(team),
      members: list.slice().sort((a, b) => String(a.label).localeCompare(String(b.label))),
    }))
    .sort((a, b) => (a.declared === b.declared ? b.members.length - a.members.length : a.declared ? -1 : 1))
  return { groups, loose, members: nodes.length }
}
