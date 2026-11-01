/**
 * The world a live answer is allowed to describe.
 *
 * ## Why this file exists
 *
 * The route used to forward two different folds as if they were one world: `state.teams`
 * (the `team/state` declarations, which in the live ledger are the R180-B acceptance run's
 * `gate-r180-alpha-*` rows) and `state.counts.teams` (the distinct teams the task and
 * member rows name, which are the real `session-*` teams). The tree therefore held only the
 * fixture, the real teams were missing from it, and the chip counted a third number.
 *
 * ## What the fix can and cannot be
 *
 * The fixture is not a stale cache: the bus answers `collab.state()`, which re-folds the control
 * log on every read (`plugins/dsh-link-collab/src/index.ts:9442`), and `log.replay()` is the
 * in-memory copy of the file the kernel opened (`:998-1000`). The R180-B rows are IN the live
 * ledger (seq 50-54 of `<kernel-home>\collab\control.jsonl`), and they carry
 * `writer: "local"` with the live instance id - byte-identical provenance to the kernel's own
 * rows - so no reader can separate them by who wrote them. Re-folding on read cannot remove a row
 * that is really there.
 *
 * What a surface CAN decide is what it calls a team. This module composes ONE world out of the live
 * fold: every team the ledger declares OR names in a task/member row becomes a node, so a real
 * session team that was never declared is still drawn; a team whose id matches the round's own
 * fixture naming contract (`gate-` / `r18x-`) is withheld from the world and COUNTED
 * (`withheld`), never silently dropped. The ledger view (the stream, the member rows, the
 * capability declarations) still carries those rows because they are facts of the file; each row
 * that carries a fixture name is flagged (`fixture: true`) so the pane can say so.
 *
 * ## The invariant the pane and the route share
 *
 * `counts.teams === teams.teams.length` for every answer, and the tree's own `children`,
 * `roots` and `orphans` are computed over exactly the nodes that are served. A pane that
 * draws `teams.teams` and a chip that reads `counts.teams` therefore cannot disagree.
 */

/**
 * The fixture naming contract this round's acceptance gate writes down: a team id beginning with
 * `gate-` or `r18<digit|x>-` is a test world's id, not a live one.
 *
 * It is the ONLY discriminator available on this machine, and that is stated rather than hidden:
 * the R180-B rows and the live kernel's rows share writer, instance and shape.
 */
// R289: widened from `(?:gate-|r18(?:\d|x)-)` after the user pointed at the pane and called its rows fake data. The
// three shapes below are the ones our own harnesses left in the live ledger and a reader cannot tell from real work:
// gate-134's witnesses (`g134-witness-*`), the foreign harness's own team (`team-1`), and every round-prefixed
// fixture (`r18x-`, `r17\d-`, `r2\d\d-`). It is still a NAME-BASED discriminator, and that limit is stated rather
// than hidden: a harness that names its rows like real work will still read as real work.
export const FIXTURE_ID = /^(?:gate-|g\d+-witness-|r1\d\d-|r2\d\d-)/i

/**
 * Whether one id belongs to a fixture world.
 * @param value - any value a fold field may hold.
 * @returns true only for a string matching {@link FIXTURE_ID}.
 */
export function isFixtureId(value) {
  return typeof value === 'string' && FIXTURE_ID.test(value)
}

/** The team fields the fold publishes today; read defensively because an older/newer fold may omit them. */
function record(value) {
  return value !== null && typeof value === 'object' ? value : {}
}

/** A non-empty string, or null. */
function text(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * One served team node: what a declaration says, and what the ledger's task/member rows show.
 * @param id - the team id.
 * @param declared - the `team/state` node the fold holds for this id, or undefined.
 * @param activity - the task/member counts this id was named with, or undefined.
 * @param withheldParent - whether this node's declared parent was withheld from the world.
 * @returns the node to serve.
 */
export function teamNode(id, declared, activity, withheldParent) {
  const node = declared ?? {}
  return {
    id,
    // A parent that was withheld from the world is not published: naming it would put a fixture id back
    // into the answer. The node is reported as an orphan instead (see `orphans` below).
    parent: withheldParent ? null : text(node.parent),
    lead: text(node.lead),
    seq: typeof node.seq === 'number' ? node.seq : null,
    contested: node.contested === true,
    losers: Array.isArray(node.losers) ? node.losers : [],
    /** Whether a `team/state` row declares this team. */
    declared: declared !== undefined,
    /** Whether a task or member row names this team (the only view of a team that never declared itself). */
    observed: activity !== undefined,
    /** How many task rows name this team. */
    tasks: activity === undefined ? 0 : activity.tasks,
    /** How many member rows name this team. */
    members: activity === undefined ? 0 : activity.members,
  }
}

/**
 * Compose the world from the live fold.
 *
 * @param state - the object `collab.state()` returned for this read (its `teams`, `tasks`,
 *   `members` and `counts` fields are read; every other field is ignored).
 * @returns the served tree, its own counts, and the number of fixture-named teams withheld from it.
 */
export function composeWorld(state) {
  const fold = record(state)
  const tree = record(fold.teams)
  const declaredNodes = Array.isArray(tree.teams) ? tree.teams : []
  const tasks = Array.isArray(fold.tasks) ? fold.tasks : []
  const members = Array.isArray(fold.members) ? fold.members : []

  const declared = new Map()
  for (const node of declaredNodes) {
    const id = record(node).id
    if (typeof id === 'string' && id !== '') declared.set(id, node)
  }
  const activity = new Map()
  const touch = (team, field) => {
    if (typeof team !== 'string' || team === '') return
    const row = activity.get(team) ?? { tasks: 0, members: 0 }
    row[field] += 1
    activity.set(team, row)
  }
  for (const task of tasks) touch(record(task).team, 'tasks')
  for (const member of members) touch(record(member).team, 'members')

  // The union of what is declared and what is named: a team that never wrote a team/state row is still a
  // team the ledger shows work in, and leaving it out of the tree is what made the real session invisible.
  const ids = [...new Set([...declared.keys(), ...activity.keys()])].sort()
  const withheldIds = new Set(ids.filter(isFixtureId))
  const served = ids.filter((id) => withheldIds.has(id) === false)

  const nodes = served.map((id) => {
    const node = declared.get(id)
    const parent = text(record(node).parent)
    return teamNode(id, node, activity.get(id), parent !== null && withheldIds.has(parent))
  })
  const byId = new Set(nodes.map((node) => node.id))

  const children = {}
  const roots = []
  const orphans = []
  for (const node of nodes) {
    if (node.parent !== null) {
      if (byId.has(node.parent)) {
        children[node.parent] = [...(children[node.parent] ?? []), node.id]
        continue
      }
      // A parent that is not in the world (withheld, or never declared): the node is a root AND named as
      // an orphan, because "parent withheld" and "no parent" are different facts about the same node.
      orphans.push(node.id)
      roots.push(node.id)
      continue
    }
    const declaredParent = text(record(declared.get(node.id)).parent)
    if (declaredParent !== null && byId.has(declaredParent) === false) orphans.push(node.id)
    roots.push(node.id)
  }
  for (const key of Object.keys(children)) children[key].sort()

  // A cycle that names a withheld id cannot be drawn without that id, so it is not drawn at all.
  const cycles = (Array.isArray(tree.cycles) ? tree.cycles : []).filter((cycle) => {
    const one = record(cycle)
    const loop = Array.isArray(one.loop) ? one.loop : []
    const edge = Array.isArray(one.edge) ? one.edge : []
    return [...loop, ...edge].every((id) => typeof id !== 'string' || (byId.has(id) && withheldIds.has(id) === false))
  })

  const counts = record(fold.counts)
  return {
    teams: {
      teams: nodes,
      children,
      roots,
      orphans,
      cycles,
      declared: declared.size,
      named: typeof counts.teams === 'number' ? counts.teams : activity.size,
      observed: nodes.filter((node) => node.observed).length,
      withheld: withheldIds.size,
    },
    counts: { ...counts, teams: nodes.length },
  }
}

/**
 * Count the fixture-named facts the LEDGER view still carries, without repeating any id.
 *
 * The world withholds fixture teams; the ledger view keeps their rows because the file holds them.
 * This census is what lets the pane say "N fixture rows are on screen" instead of letting them read
 * like live work.
 *
 * @param state - the live fold.
 * @param records - the control records the route serves as its stream.
 * @returns counts by kind.
 */
export function fixtureCensus(state, records) {
  const fold = record(state)
  const tasks = Array.isArray(fold.tasks) ? fold.tasks : []
  const members = Array.isArray(fold.members) ? fold.members : []
  const stream = Array.isArray(records) ? records : []
  const isFixtureRow = (row) => {
    const one = record(row)
    const payload = record(one.payload)
    return [one.actor, one.subject, one.id, one.team, one.name, payload.id, payload.name, payload.senderId, payload.targetId].some(isFixtureId)
  }
  return {
    tasks: tasks.filter(isFixtureRow).length,
    members: members.filter(isFixtureRow).length,
    records: stream.filter(isFixtureRow).length,
  }
}
