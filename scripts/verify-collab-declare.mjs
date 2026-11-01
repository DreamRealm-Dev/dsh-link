#!/usr/bin/env node
/**
 * Gate (R180-B) — the three DECLARING TOOLS write the ledger they claim to, and the page they are read
 * through folds exactly the prefix it says it folded.
 *
 * Subject: the declaring line that landed in R179 (docs/handoff/R179-C-declaring-tools.md):
 * team_declare_capability / team_declare_subteam / team_heartbeat, their named refusals, the
 * liveness verdict built from heartbeats, the team tree built from subteam declarations, and
 * linkCollab.records({since, limit}). Written by a verifier who did not write the plugin: every
 * reading below is taken from the SHIPPED artifact and from the ledger file this gate parses with
 * its own JSON.parse, never from a fixture the plugin also produces.
 *
 * Six readings, each of which can fail on its own evidence:
 *
 *   1-world-is-the-shipped-registration      The world this gate measures is built by calling apply()
 *                                            on the shipped artifact with a ctx that publishes a tools
 *                                            registry, the way the kernel composes it: exactly the three
 *                                            DECLARE_TOOL_NAMES land in the registry, linkCollab.tools
 *                                            reports available=true with those three names, and the fresh
 *                                            control.jsonl this world opened holds 0 rows. A gate that
 *                                            measured an empty world by accident fails here instead of
 *                                            passing five readings about nothing.
 *   2-three-tools-write-the-record-they-return  Each of the three tools is called once, through the
 *                                            definition the registry holds, and the value it RETURNS must
 *                                            be the row the FILE gained: the capability call returns
 *                                            {seq, kind:'capability/state', member, capabilities} and the
 *                                            ledger gains exactly one capability/state row whose seq, subject,
 *                                            actor and payload agree (capabilities deduplicated and sorted);
 *                                            the subteam call returns {seq, kind:'team/state', team, parent,
 *                                            lead} and the row carries payload {team,parent,lead}; the
 *                                            heartbeat call returns {seq, kind:'member/heartbeat', member, at}
 *                                            and record.at === payload.at === the instant the caller named.
 *                                            The row count is the gate's, counted from the file.
 *   3-bad-inputs-are-refused-by-name          Fifteen malformed calls, each of which must raise the code
 *                                            its own rule names — DECLARE_INPUT, DECLARE_MEMBER_EMPTY,
 *                                            DECLARE_MEMBER_NAME, DECLARE_CAPABILITY_LIST,
 *                                            DECLARE_CAPABILITY_EMPTY, DECLARE_CAPABILITY_NAME,
 *                                            DECLARE_TEAM_EMPTY, DECLARE_TEAM_NAME, DECLARE_PARENT_NAME,
 *                                            DECLARE_PARENT_SELF, DECLARE_HEARTBEAT_AT — with the code first
 *                                            in the message, and the ledger byte-identical before and after
 *                                            the whole batch: a refusal that still appends is the failure
 *                                            this reading exists to catch.
 *   4-heartbeat-decides-liveness              The heartbeat instant is data, not an ambient clock read:
 *                                            a call with no 'at' writes the instant the tool's own clock
 *                                            supplies, and the same factory driven with an injected clock
 *                                            writes THAT instant; and the verdict is a function of (latest
 *                                            beat, now, timeoutMs) — same records, now = beat+1s => healthy,
 *                                            now = beat+timeout => unhealthy (the boundary), a member with no
 *                                            beat => unknown, and the isQuarantined wrapper agrees. Both
 *                                            directions are paired with the same fold with the heartbeat row
 *                                            removed, which must answer unknown, so a verdict that ignored the
 *                                            ledger could not pass.
 *   5-subteam-declaration-enters-the-tree    Declarations made through the subteam tool — a root, a child,
 *                                            a grandchild, an orphan whose parent nobody declared, and a
 *                                            two-team loop — must read as exactly that tree: roots,
 *                                            children[root], pathOf(grandchild) root-first, descendantsOf(root),
 *                                            the orphan named as an orphan, the cycle named with the edge that
 *                                            closes it, and pathOf(orphan) stopping at the orphan. The counter-
 *                                            factual (the same fold with every team/state row dropped) must
 *                                            lose the tree, so a tree that came from somewhere else fails.
 *   6-records-page-folds-its-own-prefix       linkCollab.records({since, limit}) must answer a page whose
 *                                            state is the fold of exactly the rows up to page.through — and
 *                                            this gate folds that prefix ITSELF and compares — while the fold
 *                                            of the whole ledger has a different through (so a page that
 *                                            always folded everything is caught), counts.more/returned/total
 *                                            are the page's own arithmetic over the tail, a cursor past the
 *                                            end answers through === since with no rows and no more, limit is
 *                                            clamped, since/limit out of range raise TypeError by name, and
 *                                            two identical calls (the second one with Date.now replaced by a
 *                                            thrower) answer byte-identical documents: the page reads no clock.
 *
 * Self-attack: --self-attack measures the live world ONCE and then mutates THAT measured world in memory,
 * one mutation per mutant, asserting each mutant reddens exactly its declared readings and nothing else,
 * plus a control mutant that changes nothing. It prints '声明集 == 观测集' for every mutant. Mutating the
 * measured world rather than a hand-written fixture is deliberate: a fixture only proves the judge agrees
 * with itself.
 *
 * Budget: this gate is offline (no port, no client, no kernel boot); it writes one throwaway directory
 * under the OS temp dir and removes it unless --keep is given. It prints its elapsed time.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject itself could not be built here (the module
 * does not import, or the world could not open its ledger). A reading that cannot be measured is a failure,
 * never a pass.
 *
 * Usage: node scripts/verify-collab-declare.mjs [--module <path>] [--self-attack] [--keep]
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = has('--self-attack')
const KEEP = has('--keep')
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))

/** The names this gate writes into the world. Recognisable on purpose: a reader of the ledger can tell a test fact from a work fact. */
const WORKER = 'gate-r180-worker'
const TEAM = 'gate-r180-team'
const ROOT = 'gate-r180-root'
const CHILD = 'gate-r180-child'
const GRAND = 'gate-r180-grandchild'
const ORPHAN = 'gate-r180-orphan'
const ABSENT = 'gate-r180-absent'
const LOOP_A = 'gate-r180-loop-a'
const LOOP_B = 'gate-r180-loop-b'
const CAPABILITIES = ['write:src', 'code-review', 'write:src']
/** The sorted, deduplicated set the capability tool is contracted to return. */
const CAPABILITIES_FOLDED = ['code-review', 'write:src']
/** The instant every heartbeat in this world names, and the clock the injected-clock control returns. */
const T0 = 1700000000000
const INJECTED_AT = 1700000123456
const TIMEOUT_MS = 30000

const CAPABILITY_KIND = 'capability/state'
const TEAM_KIND = 'team/state'
const HEARTBEAT_KIND = 'member/heartbeat'
const TOOL_NAMES = ['team_declare_capability', 'team_declare_subteam', 'team_heartbeat']
// R181: the plugin's whole model-visible tool face, which this gate pins exactly. The round added one
// tool (the reclaimer for silent owners); admitting it HERE is deliberate and narrow - a name that is
// not on this list still reddens reading 1, so a tool cannot be smuggled in by being written next to a
// green one. A tool admitted here must bring its own gate: verify-collab-reclaim is that gate.
const RECLAIM_TOOL_NAME = 'team_reclaim_task'
// R182: the peer pair joined the same model-visible face (a lead asks another lead to exchange, and answers).
// Admitted here by name, like the reclaimer: a name that is not on this list still reddens reading 1.
const PEER_TOOL_NAMES = ['team_request_peer', 'team_answer_peer']
// R183: the merge pair joins the same face by the same rule (a lead recruits another team, and the team being
// folded in answers with its own lead). Each admission here has to bring its own gate: verify-collab-peer for
// the pair above, verify-collab-manifest and verify-collab-merge for this round's two.
const MERGE_TOOL_NAMES = ['team_request_merge', 'team_answer_merge']
// SORTED, because the registry sorts: reading 1 compares `linkCollab.tools.names` with this array
// position by position, and an expectation in registration order fails on a face that is actually in order.
const ALL_TOOL_NAMES = [...TOOL_NAMES, RECLAIM_TOOL_NAME, ...PEER_TOOL_NAMES, ...MERGE_TOOL_NAMES].sort()

/**
 * Every malformed call this gate makes, with the code its own rule names.
 * The code is the first segment of the message: that is what a model reads back (R179-C: 'the registry
 * renders an exception as Error: <message>'), so it is what this gate checks.
 */
const REFUSALS = [
  { tool: 'team_declare_capability', args: null, code: 'DECLARE_INPUT', why: 'the arguments are not an object' },
  { tool: 'team_declare_capability', args: [], code: 'DECLARE_INPUT', why: 'an array is not the argument object' },
  { tool: 'team_declare_capability', args: {}, code: 'DECLARE_MEMBER_EMPTY', why: 'no member at all' },
  { tool: 'team_declare_capability', args: { member: '   ', capabilities: ['code-review'] }, code: 'DECLARE_MEMBER_EMPTY', why: 'a member made of blanks is not a name' },
  { tool: 'team_declare_capability', args: { member: 'gate r180 worker', capabilities: ['code-review'] }, code: 'DECLARE_MEMBER_NAME', why: 'a space inside a name' },
  { tool: 'team_declare_capability', args: { member: '-worker', capabilities: ['code-review'] }, code: 'DECLARE_MEMBER_NAME', why: 'a name may not start with a dash' },
  { tool: 'team_declare_capability', args: { member: WORKER, capabilities: [] }, code: 'DECLARE_CAPABILITY_LIST', why: 'an empty capability list' },
  { tool: 'team_declare_capability', args: { member: WORKER, capabilities: 'code-review' }, code: 'DECLARE_CAPABILITY_LIST', why: 'a bare string is not a list' },
  { tool: 'team_declare_capability', args: { member: WORKER, capabilities: [''] }, code: 'DECLARE_CAPABILITY_EMPTY', why: 'an empty capability name inside the list' },
  { tool: 'team_declare_capability', args: { member: WORKER, capabilities: ['code review'] }, code: 'DECLARE_CAPABILITY_NAME', why: 'a space inside a capability name' },
  { tool: 'team_declare_capability', args: { member: WORKER, capabilities: ['code-review'], team: '' }, code: 'DECLARE_TEAM_EMPTY', why: 'an empty team' },
  { tool: 'team_declare_capability', args: { member: WORKER, capabilities: ['code-review'], team: 'gate r180 team' }, code: 'DECLARE_TEAM_NAME', why: 'a space inside a team name' },
  { tool: 'team_declare_subteam', args: {}, code: 'DECLARE_TEAM_EMPTY', why: 'no team to place' },
  { tool: 'team_declare_subteam', args: { team: TEAM, parent: 'gate r180 root' }, code: 'DECLARE_PARENT_NAME', why: 'a space inside a parent name' },
  { tool: 'team_declare_subteam', args: { team: TEAM, parent: TEAM, lead: null }, code: 'DECLARE_PARENT_SELF', why: 'a team cannot be its own parent' },
  { tool: 'team_heartbeat', args: {}, code: 'DECLARE_MEMBER_EMPTY', why: 'no member to beat for' },
  { tool: 'team_heartbeat', args: { member: WORKER, at: 1.5 }, code: 'DECLARE_HEARTBEAT_AT', why: 'a fractional instant' },
  { tool: 'team_heartbeat', args: { member: WORKER, at: -1 }, code: 'DECLARE_HEARTBEAT_AT', why: 'an instant before the epoch' },
  { tool: 'team_heartbeat', args: { member: WORKER, at: 'now' }, code: 'DECLARE_HEARTBEAT_AT', why: 'a word where an instant belongs' },
]

const show = (value) => JSON.stringify(value === undefined ? null : value)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// ---------------------------------------------------------------------------
// The ledger file, counted by this gate
// ---------------------------------------------------------------------------

/** Read <dir>/control.jsonl and parse it here: the row count is this gate's arithmetic, not the plugin's. */
const readLedger = (dir) => {
  const path = join(dir, 'control.jsonl')
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch { return { path, rows: [], text: '', bytes: 0, unreadable: 0, readable: true } }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const rows = []
  let unreadable = 0
  for (const line of lines) {
    try { rows.push(JSON.parse(line)) } catch { unreadable += 1 }
  }
  return { path, rows, text, bytes: Buffer.byteLength(text), unreadable, readable: true }
}
const kindsOf = (rows) => {
  const counts = {}
  for (const row of rows) counts[row.kind || '(no kind)'] = (counts[row.kind || '(no kind)'] || 0) + 1
  return counts
}
/** The subset of a fold this gate compares, so two folds can be compared without dragging every field in. */
const shape = (state) => ({
  through: state.through,
  counts: state.counts,
  registry: { declarations: state.registry.declarations, members: state.registry.members, malformed: state.registry.malformed },
  liveness: state.liveness,
  teams: {
    ids: state.teams.teams.map((team) => team.id).sort(),
    roots: state.teams.roots,
    children: state.teams.children,
    orphans: state.teams.orphans,
    cycles: state.teams.cycles,
  },
})
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

// ---------------------------------------------------------------------------
// The world: a fresh control log driven through the SHIPPED artifact
// ---------------------------------------------------------------------------

/** Run fn with Date.now replaced by a thrower: a pure reader must answer anyway. */
const underDeadClock = (fn) => {
  const real = Date.now
  Date.now = () => { throw new Error('the reader read the clock') }
  try { return { ok: true, value: fn() } } catch (error) { return { ok: false, error: String(error && error.message ? error.message : error) } } finally { Date.now = real }
}

const buildWorld = async (module) => {
  const root = mkdtempSync(join(tmpdir(), 'r180-declare-'))
  const home = root
  const dir = join(root, 'collab')
  mkdirSync(dir, { recursive: true })
  const registry = new Map()
  const provided = new Map()
  const disposers = []
  const registryService = { register(definition) { registry.set(definition.name, definition); return () => { registry.delete(definition.name) } } }
  const server = { register(route) { return () => { void route } } }
  const ctx = {
    get(name) {
      if (name === 'tools') return registryService
      if (name === 'webServer') return server
      if (name === 'dshHomePath') return (sub) => join(home, sub)
      return provided.get(name)
    },
    inject(_dependencies, callback) { callback({ get: (name) => (name === 'tools' ? registryService : undefined) }) },
    provide(name, value) { provided.set(name, value) },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return () => {} },
    on() { return () => {} },
    logger: { warn: () => {} },
  }
  const quiet = { log: console.log, error: console.error }
  let applied = null
  try {
    console.log = () => {}
    console.error = () => {}
    // The plugin announces itself on apply(); this gate's output must stay a verdict.
    module.apply(ctx, {})
    applied = { ok: true }
  } catch (error) {
    applied = { ok: false, error: String(error && error.message ? error.message : error) }
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  const collab = provided.get('linkCollab')
  return { root, dir, registry, collab, applied, disposers }
}

// ---------------------------------------------------------------------------
// Collection: one world, measured once
// ---------------------------------------------------------------------------

const collect = async (module) => {
  const progress = []
  const world = { module: MODULE_PATH, dir: null, root: null, at: Date.now() }
  const built = await buildWorld(module)
  world.dir = built.dir
  world.root = built.root
  world.applied = built.applied
  world.registry = {
    names: [...built.registry.keys()].sort(),
    available: built.collab?.tools?.available ?? null,
    reason: built.collab?.tools?.reason ?? null,
    capabilityNames: built.collab?.tools?.names ? [...built.collab.tools.names].sort() : null,
  }
  world.ledger = { initial: readLedger(built.dir) }
  progress.push('world: ' + show(built.dir))
  if (built.applied.ok !== true || built.collab === undefined) {
    return { world, progress, fatal: 'apply() did not publish linkCollab in this world: ' + show(built.applied.error ?? 'no capability provided') }
  }
  world.hasCapability = true

  // The declaring tools declare what a member can do; they do not create the member. The liveness fold
  // answers for the members the ledger names, so this world names one — through the control log the plugin
  // itself opened — and every count below is taken around the tools' own calls.
  world.seed = { ok: false }
  try {
    const memberRecord = { kind: 'member/state', subject: WORKER, actor: TEAM, payload: { id: WORKER, name: WORKER, state: 'active', role: 'member' } }
    const seq = await built.collab.log.append(memberRecord)
    world.seed = { ok: true, seq, row: memberRecord }
  } catch (error) {
    world.seed = { ok: false, error: String(error && error.message ? error.message : error) }
  }
  if (world.seed.ok !== true) {
    for (const dispose of built.disposers) { try { dispose() } catch { /* the world is being thrown away */ } }
    return { world, progress, fatal: 'the world could not name a member to answer for: ' + show(world.seed.error) }
  }
  world.ledger.seeded = readLedger(built.dir)
  try {
    world.livenessBeforeBeat = module.livenessOf(built.collab.state(), T0 + 1000, { timeoutMs: TIMEOUT_MS }).find((reading) => reading.memberId === WORKER) ?? null
  } catch (error) {
    world.livenessBeforeBeat = { error: String(error && error.message ? error.message : error) }
  }

  const call = async (name, args) => {
    const definition = built.registry.get(name)
    if (definition === undefined) return { ok: false, missing: true, error: name + ' is not in the registry' }
    try { return { ok: true, value: await definition.execute(args) } } catch (error) {
      return {
        ok: false,
        missing: false,
        error: String(error && error.message ? error.message : error),
        name: error && error.name ? error.name : null,
        code: error && error.code !== undefined ? error.code : null,
        refused: module.DeclareRefusal !== undefined && error instanceof module.DeclareRefusal,
      }
    }
  }
  world.call = null
  world.calls = {}

  // 2 -- the three declaration tools, each called once ------------------------------------------------
  world.calls.capability = await call(TOOL_NAMES[0], { member: WORKER, capabilities: CAPABILITIES, team: TEAM })
  world.ledger.afterCapability = readLedger(built.dir)
  world.calls.subteam = await call(TOOL_NAMES[1], { team: TEAM, parent: ROOT, lead: 'gate-r180-lead' })
  world.ledger.afterSubteam = readLedger(built.dir)
  world.calls.heartbeat = await call(TOOL_NAMES[2], { member: WORKER, at: T0, team: TEAM })
  world.ledger.afterThree = readLedger(built.dir)

  // 3 -- the refusals, in one batch, with the ledger byte-compared around it ---------------------------
  world.ledger.beforeRefusals = readLedger(built.dir)
  world.expectedRefusals = REFUSALS.map((entry) => ({ tool: entry.tool, code: entry.code, why: entry.why, args: entry.args }))
  world.refusals = []
  for (const entry of REFUSALS) {
    const outcome = await call(entry.tool, entry.args)
    world.refusals.push({
      tool: entry.tool,
      expected: entry.code,
      why: entry.why,
      ok: outcome.ok === false && outcome.missing !== true,
      thrown: outcome.error ?? null,
      name: outcome.name ?? null,
      code: outcome.code ?? null,
      refused: outcome.refused === true,
    })
  }
  world.ledger.afterRefusals = readLedger(built.dir)

  // 5 -- the tree, declared through the subteam tool ---------------------------------------------------
  const treeCalls = [
    { team: ROOT, label: 'a root (no parent)' },
    { team: CHILD, parent: ROOT, label: 'a child of the root' },
    { team: GRAND, parent: CHILD, label: 'a grandchild' },
    { team: ORPHAN, parent: ABSENT, label: 'an orphan: its parent is declared by nobody' },
    { team: LOOP_A, parent: LOOP_B, label: 'the first half of a loop' },
    { team: LOOP_B, parent: LOOP_A, label: 'the second half of the loop' },
  ]
  world.treeCalls = []
  for (const entry of treeCalls) {
    const outcome = await call(TOOL_NAMES[1], { team: entry.team, ...entry.parent === undefined ? {} : { parent: entry.parent } })
    world.treeCalls.push({ team: entry.team, parent: entry.parent ?? null, label: entry.label, ok: outcome.ok === true, seq: outcome.value?.seq ?? null, error: outcome.error ?? null })
  }
  world.ledger.final = readLedger(built.dir)
  world.rows = world.ledger.final.rows

  // 4 -- the heartbeat as data, the verdict as a function of (records, now, timeoutMs) -----------------
  const state = built.collab.state()
  const records = built.collab.log.replay()
  const withoutBeats = module.projectTeamState(records.filter((record) => record.kind !== HEARTBEAT_KIND))
  const verdictAt = (at, timeoutMs) => module.livenessOf(state, at, { timeoutMs }).find((reading) => reading.memberId === WORKER) ?? null
  world.liveness = {
    t0Plus1s: verdictAt(T0 + 1000, TIMEOUT_MS),
    t0PlusTimeout: verdictAt(T0 + TIMEOUT_MS, TIMEOUT_MS),
    t0PlusTimeoutMinusOne: verdictAt(T0 + TIMEOUT_MS - 1, TIMEOUT_MS),
    unknownMember: module.livenessOf(state, T0 + 1000, { timeoutMs: TIMEOUT_MS }).find((reading) => reading.memberId === 'gate-r180-nobody') ?? null,
    quarantinedNear: module.isQuarantined(state, WORKER, T0 + 1000, { timeoutMs: TIMEOUT_MS }),
    quarantinedFar: module.isQuarantined(state, WORKER, T0 + TIMEOUT_MS + 60000, { timeoutMs: TIMEOUT_MS }),
    withoutHeartbeat: module.livenessOf(withoutBeats, T0 + 1000, { timeoutMs: TIMEOUT_MS }).find((reading) => reading.memberId === WORKER) ?? null,
    memberIds: module.livenessOf(state, T0 + 1000, { timeoutMs: TIMEOUT_MS }).map((reading) => reading.memberId).sort(),
  }
  // The clock is a constructor parameter, not an ambient read: the same factory driven with an injected
  // clock must write the injected instant even though the real clock says otherwise.
  const clockDir = join(built.root, 'injected')
  mkdirSync(clockDir, { recursive: true })
  const clockLog = module.openControlLog({ dir: clockDir, writer: 'gate-r180-clock' })
  let injected = { ok: false, error: 'declaringTools missing' }
  try {
    const definitions = module.declaringTools({ log: clockLog, now: () => INJECTED_AT })
    const tool = definitions.find((definition) => definition.name === TOOL_NAMES[2])
    const value = await tool.execute({ member: WORKER })
    injected = { ok: true, value }
  } catch (error) {
    injected = { ok: false, error: String(error && error.message ? error.message : error) }
  }
  await clockLog.close()
  world.heartbeatClock = { injected, rows: readLedger(clockDir).rows }

  // 5 -- the tree, read back ---------------------------------------------------------------------------
  const withoutTeamRows = module.projectTeamState(records.filter((record) => record.kind !== TEAM_KIND))
  const ids = (value) => (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : item?.id ?? null)).filter((item) => item !== null) : null)
  world.tree = {
    ids: state.teams.teams.map((team) => ({ id: team.id, parent: team.parent, lead: team.lead ?? null })).sort((left, right) => (left.id < right.id ? -1 : 1)),
    roots: ids(module.rootsOf(state)),
    children: state.teams.children,
    orphans: state.teams.orphans,
    cycles: state.teams.cycles,
    pathGrand: ids(module.pathOf(state, GRAND)),
    pathOrphan: ids(module.pathOf(state, ORPHAN)),
    descendantsRoot: ids(module.descendantsOf(state, ROOT)),
    withoutTeamRows: { roots: ids(module.rootsOf(withoutTeamRows)), children: withoutTeamRows.teams.children, cycles: withoutTeamRows.teams.cycles, ids: withoutTeamRows.teams.teams.map((team) => team.id).sort() },
  }

  // 6 -- the records page ------------------------------------------------------------------------------
  const take = (options) => {
    const dead = underDeadClock(() => built.collab.records({ ...options }))
    return dead.ok === true ? { ok: true, value: dead.value } : { ok: false, error: dead.error }
  }
  const page = (options) => { try { return { ok: true, value: built.collab.records({ ...options }) } } catch (error) { return { ok: false, name: error && error.name ? error.name : null, error: String(error && error.message ? error.message : error) } } }
  const total = world.rows.length
  const three = page({ since: 0, limit: 3 })
  world.page = {
    total,
    three,
    all: page({ since: 0, limit: 1000 }),
    tail: page({ since: total, limit: 10 }),
    badSince: page({ since: -1 }),
    badLimit: page({ limit: 0 }),
    clamped: page({ since: 0, limit: 5000 }),
    repeat: { first: three.ok ? JSON.stringify(three.value) : null, second: page({ since: 0, limit: 3 }).ok ? JSON.stringify(page({ since: 0, limit: 3 }).value) : null },
    deadClock: take({ since: 0, limit: 3 }),
    // What this gate folds ITSELF from the same rows, for the prefix the page claims to have folded.
    expected: { state: null },
  }
  const prefix = world.rows.filter((row) => row.seq <= (three.ok && three.value.through !== undefined ? three.value.through : 3))
  world.page.expected.state = shape(module.projectTeamState(prefix))
  world.page.wholeLedger = shape(module.projectTeamState(world.rows))

  // Nothing this gate did AFTER the refusals batch may have written to the ledger.
  world.ledger.afterMeasurements = readLedger(built.dir)
  for (const dispose of built.disposers) { try { dispose() } catch { /* the world is being thrown away */ } }
  return { world, progress, fatal: null }
}

// ---------------------------------------------------------------------------
// The judge: pure over the measured world, so --self-attack can mutate the world itself
// ---------------------------------------------------------------------------

const judge = (world, module) => {
  const readings = []
  const add = (id, ok, detail, evidence) => readings.push({ id, ok, detail, evidence: Array.isArray(evidence) ? evidence : [] })
  const bad = (detail, evidence) => { add(detail.id, false, detail.text, evidence); return detail.id }
  const problems = () => []

  // 1 ------------------------------------------------------------------------
  {
    const issues = problems()
    const names = world.registry?.names ?? []
    const missing = TOOL_NAMES.filter((name) => names.includes(name) === false)
    if (world.applied?.ok !== true) issues.push('apply() threw in this world: ' + show(world.applied?.error ?? null))
    if (missing.length > 0) issues.push('the registry does not hold ' + show(missing))
    const extra = names.filter((name) => ALL_TOOL_NAMES.includes(name) === false)
    if (extra.length > 0) issues.push('the registry holds names that are not declaring tools: ' + show(extra))
    if (world.registry?.available !== true) issues.push('linkCollab.tools.available is ' + show(world.registry?.available) + ' (reason ' + show(world.registry?.reason ?? null) + ')')
    if (same(world.registry?.capabilityNames ?? [], ALL_TOOL_NAMES) === false) issues.push('linkCollab.tools.names is ' + show(world.registry?.capabilityNames ?? null) + ', not the three')
    if (world.ledger?.initial?.rows?.length !== 0) issues.push('the world did not start empty: control.jsonl already held ' + show(world.ledger?.initial?.rows?.length) + ' row(s)')
    if (world.hasCapability !== true) issues.push('apply() published no linkCollab capability')
    add('1-world-is-the-shipped-registration', issues.length === 0,
      issues.length === 0
        ? 'apply() on the shipped artifact registered exactly ' + TOOL_NAMES.join(', ') + ', linkCollab.tools reports available with those three names, and the fresh ledger held 0 rows'
        : issues.join('; '),
      ['registry after apply(): ' + show(names),
        'linkCollab.tools: available=' + show(world.registry?.available ?? null) + ' names=' + show(world.registry?.capabilityNames ?? null) + ' reason=' + show(world.registry?.reason ?? null),
        'control.jsonl at open: ' + show(world.ledger?.initial?.path ?? null) + ' -> ' + show(world.ledger?.initial?.rows?.length ?? null) + ' rows'])
  }

  // 2 ------------------------------------------------------------------------
  {
    const issues = problems()
    const rowsOf = (snapshot) => (snapshot?.rows ?? [])
    const afterThree = rowsOf(world.ledger?.afterThree)
    const capability = world.calls?.capability ?? {}
    const subteam = world.calls?.subteam ?? {}
    const heartbeat = world.calls?.heartbeat ?? {}
    if (capability.ok !== true) issues.push('team_declare_capability did not answer: ' + show(capability.error ?? 'missing'))
    if (subteam.ok !== true) issues.push('team_declare_subteam did not answer: ' + show(subteam.error ?? 'missing'))
    if (heartbeat.ok !== true) issues.push('team_heartbeat did not answer: ' + show(heartbeat.error ?? 'missing'))
    const seeded = (world.ledger?.seeded?.rows ?? []).length
    const gained = afterThree.length - seeded
    if (gained !== 3) issues.push('the three calls added ' + gained + ' row(s) to the ' + seeded + ' the world already held, not 3')
    const added = afterThree.slice(seeded)
    const kinds = kindsOf(added)
    if (kinds[CAPABILITY_KIND] !== 1 || kinds[TEAM_KIND] !== 1 || kinds[HEARTBEAT_KIND] !== 1) issues.push('the three rows are not one of each kind: ' + show(kinds))
    if (afterThree.length !== (world.ledger?.seeded?.rows ?? []).length + 3) issues.push('the row count does not read ' + show(afterThree.length) + ' = ' + show(seeded) + ' seeded + 3 declared')
    const rowOf = (kind, snapshot) => rowsOf(snapshot).find((row) => row.kind === kind) ?? null
    // capability
    const capabilityValue = capability.value ?? null
    const capabilityRow = rowOf(CAPABILITY_KIND, world.ledger?.afterCapability)
    if (capabilityRow === null) issues.push('no ' + CAPABILITY_KIND + ' row reached the file')
    else if (capabilityValue === null || capabilityValue.seq !== capabilityRow.seq) issues.push('the capability call returned seq=' + show(capabilityValue?.seq ?? null) + ' but the file row carries seq=' + show(capabilityRow.seq))
    else {
      if (capabilityRow.subject !== WORKER) issues.push('the capability row names subject ' + show(capabilityRow.subject) + ', not ' + show(WORKER))
      if (capabilityRow.actor !== TEAM) issues.push('the capability row carries actor ' + show(capabilityRow.actor) + ', not the team ' + show(TEAM))
      if (capabilityValue.kind !== CAPABILITY_KIND || capabilityValue.member !== WORKER || capabilityValue.team !== TEAM) issues.push('the capability answer is ' + show(capabilityValue))
      if (same(capabilityValue.capabilities, CAPABILITIES_FOLDED) === false) issues.push('the capability answer listed ' + show(capabilityValue.capabilities) + ', expected the deduplicated sorted ' + show(CAPABILITIES_FOLDED))
      if (same(capabilityRow.payload?.capabilities, CAPABILITIES_FOLDED) === false) issues.push('the row payload listed ' + show(capabilityRow.payload?.capabilities))
      if (capabilityRow.payload?.id !== WORKER) issues.push('the row payload id is ' + show(capabilityRow.payload?.id))
    }
    // subteam
    const subteamValue = subteam.value ?? null
    const subteamRow = rowOf(TEAM_KIND, world.ledger?.afterSubteam)
    if (subteamRow === null) issues.push('no ' + TEAM_KIND + ' row reached the file')
    else if (subteamValue === null || subteamValue.seq !== subteamRow.seq) issues.push('the subteam call returned seq=' + show(subteamValue?.seq ?? null) + ' but the file row carries seq=' + show(subteamRow.seq))
    else {
      if (subteamRow.subject !== TEAM) issues.push('the team row names subject ' + show(subteamRow.subject) + ', not ' + show(TEAM))
      if (subteamValue.kind !== TEAM_KIND || subteamValue.team !== TEAM || subteamValue.parent !== ROOT || subteamValue.lead !== 'gate-r180-lead') issues.push('the subteam answer is ' + show(subteamValue))
      if (subteamRow.payload?.team !== TEAM || subteamRow.payload?.parent !== ROOT || subteamRow.payload?.lead !== 'gate-r180-lead') issues.push('the team row payload is ' + show(subteamRow.payload ?? null))
    }
    // heartbeat
    const heartbeatValue = heartbeat.value ?? null
    const heartbeatRow = rowOf(HEARTBEAT_KIND, world.ledger?.afterThree)
    if (heartbeatRow === null) issues.push('no ' + HEARTBEAT_KIND + ' row reached the file')
    else if (heartbeatValue === null || heartbeatValue.seq !== heartbeatRow.seq) issues.push('the heartbeat call returned seq=' + show(heartbeatValue?.seq ?? null) + ' but the file row carries seq=' + show(heartbeatRow.seq))
    else {
      if (heartbeatRow.subject !== WORKER) issues.push('the heartbeat row names subject ' + show(heartbeatRow.subject))
      if (heartbeatValue.kind !== HEARTBEAT_KIND || heartbeatValue.member !== WORKER || heartbeatValue.at !== T0 || heartbeatValue.team !== TEAM) issues.push('the heartbeat answer is ' + show(heartbeatValue))
      if (heartbeatRow.payload?.at !== T0) issues.push('the heartbeat row payload.at is ' + show(heartbeatRow.payload?.at) + ', not the instant the caller named (' + show(T0) + ')')
      if (heartbeatRow.at !== T0) issues.push('the heartbeat row at is ' + show(heartbeatRow.at) + ', so the instant the caller named is not the instant the record carries')
      if (heartbeatRow.actor !== TEAM) issues.push('the heartbeat row carries actor ' + show(heartbeatRow.actor))
    }
    add('2-three-tools-write-the-record-they-return', issues.length === 0,
      issues.length === 0
        ? 'each of the three tools answered with the seq the FILE gained, and the three rows are one capability/state, one team/state and one member/heartbeat whose payloads agree with the answers'
        : issues.join('; '),
      ['control.jsonl after the three calls: ' + show(afterThree.length) + ' rows (' + show(seeded) + ' seeded by this gate + 3 declared), kinds ' + show(kinds) + ' over the three new rows',
        'capability -> ' + show(capabilityValue) + ' | row ' + show(capabilityRow === null ? null : { seq: capabilityRow.seq, subject: capabilityRow.subject, actor: capabilityRow.actor, payload: capabilityRow.payload }),
        'subteam -> ' + show(subteamValue) + ' | row ' + show(subteamRow === null ? null : { seq: subteamRow.seq, subject: subteamRow.subject, payload: subteamRow.payload }),
        'heartbeat -> ' + show(heartbeatValue) + ' | row ' + show(heartbeatRow === null ? null : { seq: heartbeatRow.seq, subject: heartbeatRow.subject, at: heartbeatRow.at, actor: heartbeatRow.actor, payload: heartbeatRow.payload })])
  }

  // 3 ------------------------------------------------------------------------
  {
    const issues = problems()
    const measured = world.refusals ?? []
    const expected = world.expectedRefusals ?? []
    if (measured.length !== expected.length) issues.push('this gate made ' + measured.length + ' malformed calls but declared ' + expected.length)
    const missed = []
    for (const entry of measured) {
      if (entry.ok !== true) { missed.push(entry.tool + ' ACCEPTED ' + show(entry.args ?? null) + ' (' + entry.why + ')'); continue }
      if (entry.code !== entry.expected) { missed.push(entry.tool + ' refused ' + show(entry.why) + ' with code ' + show(entry.code) + ', not ' + show(entry.expected)); continue }
      if (entry.refused !== true) { missed.push(entry.tool + ' raised ' + show(entry.name) + ' rather than the plugin\'s own DeclareRefusal for ' + show(entry.expected)); continue }
      if (typeof entry.thrown !== 'string' || entry.thrown.startsWith(entry.expected + ':') === false) missed.push(entry.tool + ' message ' + show(entry.thrown) + ' does not begin with ' + show(entry.expected + ':'))
    }
    if (missed.length > 0) issues.push(missed.length + ' call(s) did not name their rule: ' + missed.slice(0, 4).join(' | '))
    const before = world.ledger?.beforeRefusals ?? {}
    const after = world.ledger?.afterRefusals ?? {}
    if ((before.rows ?? []).length !== (after.rows ?? []).length) issues.push('the ledger moved while refusing: ' + show((before.rows ?? []).length) + ' rows before, ' + show((after.rows ?? []).length) + ' after')
    if (before.text !== after.text) issues.push('the ledger bytes changed across the refusals batch (' + show(before.bytes) + ' -> ' + show(after.bytes) + ' bytes): a refused call still wrote something')
    const settled = world.ledger?.final ?? {}
    if ((world.ledger?.afterMeasurements?.text ?? null) !== settled.text) issues.push('the ledger moved while this gate was measuring it (' + show(settled.bytes) + ' bytes before measuring, ' + show(world.ledger?.afterMeasurements?.bytes ?? null) + ' at the end)')
    add('3-bad-inputs-are-refused-by-name', issues.length === 0,
      issues.length === 0
        ? show(measured.length) + ' malformed calls each raised the code its own rule names, and the ledger was byte-identical across the batch and after every measurement'
        : issues.join('; '),
      ['codes measured: ' + show(measured.map((entry) => entry.code)),
        'the ledger around the batch: ' + show((before.rows ?? []).length) + ' rows / ' + show(before.bytes) + ' bytes -> ' + show((after.rows ?? []).length) + ' rows / ' + show(after.bytes) + ' bytes; at the end of the run ' + show((world.ledger?.afterMeasurements?.rows ?? []).length) + ' rows / ' + show(world.ledger?.afterMeasurements?.bytes ?? null) + ' bytes',
        'example refusal message: ' + show(measured[0]?.thrown ?? null)])
  }

  // 4 ------------------------------------------------------------------------
  {
    const issues = problems()
    const live = world.liveness ?? {}
    const clock = world.heartbeatClock ?? {}
    const injectedRow = (clock.rows ?? [])[0] ?? null
    if (clock.injected?.ok !== true) issues.push('the same factory with an injected clock did not answer: ' + show(clock.injected?.error ?? 'missing'))
    else {
      if (clock.injected.value?.at !== INJECTED_AT) issues.push('the heartbeat tool returned at=' + show(clock.injected.value?.at ?? null) + ' although its clock supplies ' + show(INJECTED_AT))
      if (injectedRow === null) issues.push('the injected-clock world gained no row')
      else if (injectedRow.payload?.at !== INJECTED_AT || injectedRow.at !== INJECTED_AT) issues.push('the injected-clock row carries ' + show({ at: injectedRow.at, payloadAt: injectedRow.payload?.at }) + ', not ' + show(INJECTED_AT))
    }
    const before = world.livenessBeforeBeat ?? null
    if (before === null || before.liveness !== 'unknown') issues.push('before any beat the same member reads ' + show(before === null ? null : before.liveness) + ', not unknown, so the two verdicts below are not a pair')
    if (live.t0Plus1s?.liveness !== 'healthy') issues.push('one second after the beat the member reads ' + show(live.t0Plus1s?.liveness ?? null) + ', not healthy')
    if (live.t0PlusTimeoutMinusOne?.liveness !== 'healthy') issues.push('one millisecond before the timeout the member reads ' + show(live.t0PlusTimeoutMinusOne?.liveness ?? null) + ', not healthy')
    if (live.t0PlusTimeout?.liveness !== 'unhealthy') issues.push('at exactly the timeout the member reads ' + show(live.t0PlusTimeout?.liveness ?? null) + ', not unhealthy')
    if (live.t0Plus1s?.sinceMs !== 1000) issues.push('the reading does not carry the elapsed time this gate named: sinceMs=' + show(live.t0Plus1s?.sinceMs ?? null))
    if (live.t0Plus1s?.now !== T0 + 1000) issues.push('the reading echoes now=' + show(live.t0Plus1s?.now ?? null) + ', not the instant this gate passed in')
    if (live.unknownMember !== null) issues.push('the liveness fold invents a reading for a name no record declares: ' + show(live.unknownMember))
    if (live.quarantinedNear !== false) issues.push('isQuarantined answered ' + show(live.quarantinedNear) + ' one second after the beat')
    if (live.quarantinedFar !== true) issues.push('isQuarantined answered ' + show(live.quarantinedFar) + ' a minute past the timeout')
    if (live.withoutHeartbeat?.liveness !== 'unknown') issues.push('with the heartbeat row removed the same fold reads ' + show(live.withoutHeartbeat?.liveness ?? null) + ', so the verdict is not read from the heartbeat at all')
    const beatMember = (live.memberIds ?? []).includes(WORKER)
    if (beatMember !== true) issues.push('the member that beat is not among the members the liveness fold answers for: ' + show(live.memberIds ?? null))
    add('4-heartbeat-decides-liveness', issues.length === 0,
      issues.length === 0
        ? 'the instant is data (a named at, or the clock the factory is built with), and the verdict follows (beat + 1s healthy, beat + timeout unhealthy) while the same fold without the row reads unknown'
        : issues.join('; '),
      ['the same member before any beat: ' + show(world.livenessBeforeBeat ?? null),
        'injected clock: ' + show(clock.injected?.value ?? clock.injected?.error ?? null) + ' | row ' + show(injectedRow === null ? null : { at: injectedRow.at, payloadAt: injectedRow.payload?.at }),
        'liveness of ' + show(WORKER) + ' at now=beat+1000ms -> ' + show(live.t0Plus1s) ,
        'at now=beat+' + String(TIMEOUT_MS) + 'ms -> ' + show(live.t0PlusTimeout) + ' | one ms earlier -> ' + show(live.t0PlusTimeoutMinusOne?.liveness ?? null),
        'isQuarantined near/far = ' + show(live.quarantinedNear) + '/' + show(live.quarantinedFar) + ' | the same fold without the heartbeat row -> ' + show(live.withoutHeartbeat) + ' | members answered for ' + show(live.memberIds ?? null)])
  }

  // 5 ------------------------------------------------------------------------
  {
    const issues = problems()
    const tree = world.tree ?? {}
    const roots = tree.roots ?? []
    const children = tree.children ?? {}
    const cycles = tree.cycles ?? []
    if (tree.ids === null || Array.isArray(tree.ids) === false) issues.push('the fold named no teams at all')
    if (roots.includes(ROOT) !== true) issues.push(ROOT + ' is not a root (' + show(roots) + ')')
    if (roots.includes(ORPHAN)) issues.push('the orphan is painted as a root, so its missing parent is invisible')
    if (same(children[ROOT] ?? null, [CHILD, TEAM]) === false) issues.push('children[' + ROOT + '] is ' + show(children[ROOT] ?? null) + ', expected ' + show([CHILD, TEAM]) + ' — the subteam tool\'s own declaration of ' + TEAM + ' must land in the same tree')
    if (same(children[CHILD] ?? null, [GRAND]) === false) issues.push('children[' + CHILD + '] is ' + show(children[CHILD] ?? null) + ', expected ' + show([GRAND]))
    if (same(tree.pathGrand ?? null, [ROOT, CHILD, GRAND]) === false) issues.push('pathOf(' + GRAND + ') is ' + show(tree.pathGrand ?? null) + ', expected the whole chain root-first')
    if (same(tree.pathOrphan ?? null, [ORPHAN]) === false) issues.push('pathOf(' + ORPHAN + ') is ' + show(tree.pathOrphan ?? null) + ', expected just the orphan')
    if (same(tree.descendantsRoot ?? null, [CHILD, TEAM, GRAND]) === false) issues.push('descendantsOf(' + ROOT + ') is ' + show(tree.descendantsRoot ?? null))
    if ((tree.orphans ?? []).includes(ORPHAN) !== true) issues.push('the orphan is not named as an orphan (' + show(tree.orphans ?? null) + ')')
    const loop = cycles.filter((cycle) => (cycle.loop ?? []).slice().sort().join('|') === [LOOP_A, LOOP_B].slice().sort().join('|'))
    if (loop.length !== 1) issues.push('the two-team loop is reported ' + show(cycles.length) + ' time(s) as ' + show(cycles) + ', expected exactly one cycle over ' + show([LOOP_A, LOOP_B]))
    const counter = tree.withoutTeamRows ?? {}
    if ((counter.roots ?? []).includes(ROOT)) issues.push('with every team/state row dropped ' + ROOT + ' is STILL a root, so the tree does not come from these declarations')
    if ((counter.cycles ?? []).length !== 0) issues.push('with every team/state row dropped the loop is still reported: ' + show(counter.cycles))
    add('5-subteam-declaration-enters-the-tree', issues.length === 0,
      issues.length === 0
        ? 'the declared root/child/grandchild/orphan/loop read back as exactly that tree, and dropping the team/state rows takes the tree away'
        : issues.join('; '),
      ['teams folded: ' + show(tree.ids ?? null),
        'roots ' + show(roots) + ' | children ' + show(children) + ' | orphans ' + show(tree.orphans ?? null) + ' | cycles ' + show(cycles),
        'pathOf(' + GRAND + ') ' + show(tree.pathGrand ?? null) + ' | pathOf(' + ORPHAN + ') ' + show(tree.pathOrphan ?? null) + ' | descendantsOf(' + ROOT + ') ' + show(tree.descendantsRoot ?? null),
        'counterfactual (every team/state row dropped): roots ' + show(counter.roots ?? null) + ' | cycles ' + show(counter.cycles ?? null) + ' | teams ' + show(counter.ids ?? null)])
  }

  // 6 ------------------------------------------------------------------------
  {
    const issues = problems()
    const page = world.page ?? {}
    const total = page.total ?? 0
    const three = page.three ?? {}
    if (three.ok !== true) issues.push('records({since:0,limit:3}) threw: ' + show(three.error ?? 'missing'))
    else {
      const value = three.value ?? {}
      const rows = value.rows ?? []
      if (value.through !== 3) issues.push('the page of 3 rows reports through=' + show(value.through) + ', but the third row of this world is seq 3')
      if (rows.length !== 3) issues.push('the page carried ' + rows.length + ' rows, not 3')
      if (value.counts?.total !== total) issues.push('the page reports counts.total=' + show(value.counts?.total ?? null) + ' while this gate counted ' + show(total) + ' rows in the file')
      if (value.counts?.returned !== 3) issues.push('the page reports counts.returned=' + show(value.counts?.returned ?? null))
      if (value.counts?.more !== true) issues.push('the page reports counts.more=' + show(value.counts?.more ?? null) + ' with ' + show(total - 3) + ' rows behind it')
      if (value.next !== value.through) issues.push('next=' + show(value.next ?? null) + ' is not the cursor through=' + show(value.through))
      if (value.state?.through !== value.through) issues.push('the page folded to through=' + show(value.state?.through ?? null) + ' while the page itself ends at ' + show(value.through) + ': the state and the rows disagree')
      if (same(shape(value.state ?? {}), page.expected?.state ?? null) === false) issues.push('the page\'s state is not the fold of the rows up to through: this gate folded that prefix itself and got ' + show(page.expected?.state ?? null))
      if (same(page.wholeLedger?.through ?? null, value.through) === true && total > 3) issues.push('the page folded the whole ledger (' + show(page.wholeLedger?.through) + '), not its own prefix')
      const firstThree = rows.map((row) => row.seq)
      if (same(firstThree, [1, 2, 3]) === false) issues.push('the page named rows ' + show(firstThree) + ', not the first three of this world')
      if (page.repeat?.first === null || page.repeat.first !== page.repeat.second) issues.push('two identical calls answered different documents')
      if (page.deadClock?.ok !== true) issues.push('with Date.now replaced by a thrower the page threw: ' + show(page.deadClock?.error ?? null))
      else if (JSON.stringify(page.deadClock.value) !== JSON.stringify(three.value)) issues.push('the page answered a different document once the clock was forbidden')
    }
    const all = page.all ?? {}
    if (all.ok !== true) issues.push('records with the maximum limit threw: ' + show(all.error ?? 'missing'))
    else {
      if ((all.value?.rows ?? []).length !== Math.min(1000, total)) issues.push('the widest page carried ' + (all.value?.rows ?? []).length + ' rows, expected min(1000, ' + show(total) + ')')
      if (all.value?.counts?.more !== false) issues.push('the widest page still claims more rows')
      if (all.value?.through !== total) issues.push('the widest page folds to through=' + show(all.value?.through ?? null) + ', not the last seq ' + show(total))
    }
    const tail = page.tail ?? {}
    if (tail.ok !== true) issues.push('a cursor past the end threw: ' + show(tail.error ?? 'missing'))
    else {
      if ((tail.value?.rows ?? []).length !== 0) issues.push('a cursor past the end answered ' + (tail.value?.rows ?? []).length + ' rows')
      if (tail.value?.through !== total || tail.value?.next !== total) issues.push('a cursor past the end moved the cursor: through=' + show(tail.value?.through ?? null))
      if (tail.value?.counts?.more !== false) issues.push('a cursor past the end claims more rows')
      if (tail.value?.state?.through !== total) issues.push('a cursor past the end folded to ' + show(tail.value?.state?.through ?? null))
    }
    const clamped = page.clamped ?? {}
    if (clamped.ok !== true) issues.push('a limit above the cap threw instead of clamping: ' + show(clamped.error ?? 'missing'))
    else if ((clamped.value?.rows ?? []).length !== Math.min(1000, total)) issues.push('limit=5000 carried ' + (clamped.value?.rows ?? []).length + ' rows, expected the cap min(1000, ' + show(total) + ')')
    if (page.badSince?.ok !== false || page.badSince?.name !== 'TypeError') issues.push('records({since:-1}) answered ' + show(page.badSince?.ok === false ? page.badSince?.name : 'a value') + ', not a TypeError')
    if (page.badLimit?.ok !== false || page.badLimit?.name !== 'TypeError') issues.push('records({limit:0}) answered ' + show(page.badLimit?.ok === false ? page.badLimit?.name : 'a value') + ', not a TypeError')
    add('6-records-page-folds-its-own-prefix', issues.length === 0,
      issues.length === 0
        ? 'the page carries the first 3 rows, folds exactly its own prefix (this gate folded that prefix itself and matched), agrees with the file count, clamps the limit, refuses a bad cursor by name, and answers byte-identically with the clock forbidden'
        : issues.join('; '),
      ['records({since:0,limit:3}) -> through=' + show(three.value?.through ?? null) + ' rows=' + show((three.value?.rows ?? []).map((row) => row.seq)) + ' counts=' + show(three.value?.counts ?? null) + ' state.through=' + show(three.value?.state?.through ?? null),
        'the fold this gate computed for the same prefix: ' + show(page.expected?.state ?? null),
        'the fold of the whole ledger: through=' + show(page.wholeLedger?.through ?? null) + ' | the file: ' + show(total) + ' rows',
        'tail(through=total) ' + show(tail.value?.counts ?? null) + ' | limit=5000 carried ' + show((page.clamped?.value?.rows ?? []).length) + ' | since=-1 -> ' + show(page.badSince?.name ?? null) + ' | limit=0 -> ' + show(page.badLimit?.name ?? null),
        'the same call with Date.now replaced by a thrower: ' + show(page.deadClock?.ok === true ? 'answered the same bytes' : page.deadClock?.error ?? null)])
  }

  return readings
}

// ---------------------------------------------------------------------------
// The self-attack: mutate the MEASURED world, one reading per mutant
// ---------------------------------------------------------------------------

const mutants = (world) => {
  const clone = () => structuredClone(world)
  const firstRowIndex = (kind) => (world.rows ?? []).findIndex((row) => row.kind === kind)
  const capabilityIndex = firstRowIndex(CAPABILITY_KIND)
  const teamIndex = world.rows?.findIndex((row) => row.kind === TEAM_KIND && row.subject === ROOT) ?? -1
  return [
    {
      name: 'tool-answer-seq-off-by-one',
      mustRedden: ['2-three-tools-write-the-record-they-return'],
      world: (() => { const next = clone(); next.calls.capability.value.seq += 1; return next })(),
    },
    {
      name: 'capability-set-loses-its-deduplication',
      mustRedden: ['2-three-tools-write-the-record-they-return'],
      world: (() => { const next = clone(); next.calls.capability.value.capabilities = ['write:src', 'code-review', 'write:src']; return next })(),
    },
    {
      name: 'heartbeat-instant-not-the-one-the-record-carries',
      mustRedden: ['2-three-tools-write-the-record-they-return'],
      world: (() => { const next = clone(); next.ledger.afterThree.rows.find((row) => row.kind === HEARTBEAT_KIND).payload.at = T0 + 1; return next })(),
    },
    {
      name: 'a-refused-input-is-accepted',
      mustRedden: ['3-bad-inputs-are-refused-by-name'],
      world: (() => { const next = clone(); next.refusals[6].ok = false; next.refusals[6].code = null; return next })(),
    },
    {
      name: 'a-refusal-names-the-wrong-rule',
      mustRedden: ['3-bad-inputs-are-refused-by-name'],
      world: (() => { const next = clone(); next.refusals[4].code = 'DECLARE_MEMBER_EMPTY'; next.refusals[4].thrown = 'DECLARE_MEMBER_EMPTY: x'; return next })(),
    },
    {
      name: 'a-refused-call-still-appends',
      mustRedden: ['3-bad-inputs-are-refused-by-name'],
      world: (() => { const next = clone(); next.ledger.afterRefusals.text = next.ledger.afterRefusals.text + '{"seq":999}\n'; next.ledger.afterRefusals.rows = next.ledger.afterRefusals.rows.concat([{ seq: 999 }]); return next })(),
    },
    {
      name: 'liveness-ignores-the-heartbeat',
      mustRedden: ['4-heartbeat-decides-liveness'],
      world: (() => { const next = clone(); next.liveness.t0Plus1s = { memberId: WORKER, liveness: 'unknown', lastHeartbeat: null, now: T0 + 1000, timeoutMs: TIMEOUT_MS, sinceMs: null }; return next })(),
    },
    {
      name: 'liveness-never-goes-unhealthy',
      mustRedden: ['4-heartbeat-decides-liveness'],
      world: (() => { const next = clone(); next.liveness.t0PlusTimeout.liveness = 'healthy'; return next })(),
    },
    {
      name: 'the-clock-is-not-a-parameter',
      mustRedden: ['4-heartbeat-decides-liveness'],
      world: (() => { const next = clone(); next.heartbeatClock.injected.value.at = Date.now(); return next })(),
    },
    {
      name: 'the-tree-loses-the-child',
      mustRedden: ['5-subteam-declaration-enters-the-tree'],
      world: (() => { const next = clone(); next.tree.children[ROOT] = [TEAM]; return next })(),
    },
    {
      name: 'the-orphan-is-painted-as-a-root',
      mustRedden: ['5-subteam-declaration-enters-the-tree'],
      world: (() => { const next = clone(); next.tree.roots = next.tree.roots.concat([ORPHAN]).sort(); next.tree.orphans = next.tree.orphans.filter((id) => id !== ORPHAN); return next })(),
    },
    {
      name: 'the-loop-is-not-reported',
      mustRedden: ['5-subteam-declaration-enters-the-tree'],
      world: (() => { const next = clone(); next.tree.cycles = []; return next })(),
    },
    {
      name: 'the-tree-outlives-its-declarations',
      mustRedden: ['5-subteam-declaration-enters-the-tree'],
      world: (() => { const next = clone(); next.tree.withoutTeamRows = { roots: next.tree.roots, children: next.tree.children, cycles: next.tree.cycles, ids: next.tree.ids.map((entry) => entry.id) }; return next })(),
    },
    {
      name: 'the-page-folds-the-whole-ledger',
      mustRedden: ['6-records-page-folds-its-own-prefix'],
      world: (() => { const next = clone(); next.page.three.value.state.through = next.page.total; return next })(),
    },
    {
      name: 'the-page-invents-its-own-total',
      mustRedden: ['6-records-page-folds-its-own-prefix'],
      world: (() => { const next = clone(); next.page.three.value.counts.total = next.page.total + 3; return next })(),
    },
    {
      name: 'the-page-reads-the-clock',
      mustRedden: ['6-records-page-folds-its-own-prefix'],
      world: (() => { const next = clone(); next.page.deadClock = { ok: false, error: 'the reader read the clock' }; return next })(),
    },
    {
      name: 'the-page-accepts-a-bad-cursor',
      mustRedden: ['6-records-page-folds-its-own-prefix'],
      world: (() => { const next = clone(); next.page.badSince = { ok: true, value: { rows: [] } }; return next })(),
    },
    {
      name: 'control-nothing-changed',
      mustRedden: [],
      world: clone(),
    },
  ]
}

const runSelfAttack = async (started) => {
  const module = await loadModule()
  if (module === null) { console.log('SKIP: ' + MODULE_PATH + ' could not be imported, so there is no world to attack'); return 3 }
  const collected = await collect(module)
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); return 3 }
  const world = collected.world
  const base = judge(world, module)
  const baseRed = base.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  baseline in this world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' failed')
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed) + ' (a mutant declared against a reading that is already red proves nothing)')
    return 1
  }
  console.log('  each mutant below rewrites ONE fact of that measured world and is judged by the same judge:')
  let failures = 0
  const built = mutants(world)
  for (const mutant of built) {
    const observed = judge(mutant.world, module).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const declared = mutant.mustRedden
    const precise = observed.length === declared.length && declared.every((id) => observed.includes(id))
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' — 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed))
  }
  console.log('  ' + String(built.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(built.filter((mutant) => mutant.mustRedden.length > 0).length) + ' of them declare a target | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  console.log('  note: the mutants attack the JUDGE over the world measured in this run; the measurement itself is not repeated per mutant.')
  return failures === 0 ? 0 : 1
}

const loadModule = async () => {
  try { return await import(pathToFileURL(MODULE_PATH).href) } catch (error) {
    console.log('SKIP: importing ' + MODULE_PATH + ' threw: ' + String(error && error.message ? error.message : error))
    return null
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const started = Date.now()
  if (SELF_ATTACK) {
    const code = await runSelfAttack(started)
    return code
  }
  const module = await loadModule()
  if (module === null) return 3
  const collected = await collect(module)
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); return 3 }
  const readings = judge(collected.world, module)
  for (const reading of readings) {
    console.log('  ' + (reading.ok === true ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  if (KEEP !== true) { try { rmSync(collected.world.root, { recursive: true, force: true }) } catch { /* the temp world is disposable */ } }
  else console.log('        kept: ' + show(collected.world.root))
  return failed.length > 0 ? 1 : 0
}

process.exitCode = await main()
