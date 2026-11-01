#!/usr/bin/env node
/**
 * Gate (R183-P5, gate 112) - two Teams RECRUIT EACH OTHER ON THE LEDGER: the two model-visible merge
 * tools append the 'team/merge' rows their fold reads, a request is not a permission, an agreement is
 * written by the party being merged in and by nobody else, no merge happens without a granted
 * handshake (and the handshake is CALLED, never re-derived), the winner of one ordered pair is the
 * highest seq rather than the word a row carries, malformed calls are refused BY NAME without moving
 * the file, and the two directions a merge can run are the two the vocabulary freezes.
 *
 * Subject: the merge half of R183 (docs/handoff/R183-contract.md 3.1/3.3, producer record
 * docs/handoff/R183-A-ledger.md). Written by a verifier who did not write the plugin: every world
 * below is BUILT by calling apply() on the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js,
 * never src) with a ctx that publishes a tools registry the way the kernel composes it, the tools are
 * CALLED through the definitions that registry holds, and every count - rows, bytes, sha256 - is this
 * gate's own arithmetic over the control.jsonl it parses itself. No producer fixture is read as
 * evidence and no producer self-test is trusted.
 *
 * THE TWO TOOLS ARE NOT NAMED HERE. The gate DISCOVERS them by behaviour: every tool the registry
 * holds is called, each in its OWN freshly seeded world (a probe that answers a request, grants a
 * merge or re-parents a team changes what the next probe would be measured against), with a bounded
 * set of argument shapes (hand-written, plus shapes derived from each tool's OWN declared schema), and
 * the calls that append exactly one 'team/merge' row (and nothing but that row and at most one
 * 'team/state' row) are kept. The tool whose row says state='requested' is the asking tool; the tool
 * whose row says 'granted' and 'denied' answers. A gate that found them by name would pass on a
 * registry where the names moved; the producer's record file is READ when it exists, and the names
 * found by behaviour must appear in it.
 *
 * Seven readings, each of which can fail on its own evidence:
 *
 *   1-the-round-adds-two-merge-writers-and-they-really-append
 *                                            In a fresh world, apply() publishes linkCollab over an
 *                                            EMPTY control.jsonl and exactly TWO tool names appended
 *                                            a team/merge row: one that writes 'requested' (the asking
 *                                            tool) and one that writes both 'granted' and 'denied' (the
 *                                            answering tool). The whole face is printed, a third
 *                                            writer reddens, a name R181/R182 already shipped writing
 *                                            the merge reddens, and the names the producer's record
 *                                            mentions must be among them. When NOT ONE tool in the face
 *                                            appends a team/merge row, the subject is not in this world:
 *                                            the gate says so BY NAME ("the registry of this world holds
 *                                            no such tool") and exits 3 instead of passing six readings
 *                                            about nothing.
 *   2-the-asking-tool-writes-the-request-row-it-returns
 *                                            One call through the registry: control.jsonl gains exactly
 *                                            ONE row, kind 'team/merge', subject equal to the asking
 *                                            team, payload {from, to, mode, state:'requested', by, at}
 *                                            for the team the caller named - byte for byte the record
 *                                            the shipped mergeRecord builder builds for the same six
 *                                            fields - and the value the call RETURNS carries that row's
 *                                            own seq and those same values, with mayExchange true and
 *                                            mayMerge false. An answer the model reads but the ledger
 *                                            does not hold is the failure this reading exists for. The
 *                                            fold over the same bytes shows one pair, state 'requested',
 *                                            and the tree unmoved (a request is not a permission).
 *   3-a-denial-writes-one-row-and-a-join-grant-writes-exactly-two
 *                                            The branch count R181 ruling 5 froze. grant:false adds
 *                                            exactly ONE row - the 'team/merge' denial, no tree row -
 *                                            and returns no treeSeq. grant:true on a mode='join' request
 *                                            adds exactly TWO rows in one call: the answering party's own
 *                                            'team/state' (its parent is the team that took it in, its
 *                                            lead preserved) FIRST, then the 'team/merge' authorization -
 *                                            no row missing, and no third row. The tool's returned
 *                                            treeSeq/treeTeam/treeParent name the row it wrote, and the
 *                                            fold's history length equals the merge rows this gate
 *                                            counted in the file itself.
 *   4-only-the-party-being-merged-in-writes-its-own-parent
 *                                            The discipline the whole act exists to keep: a merge never
 *                                            writes another team's team/state. ONE fact - an absorb
 *                                            request from team-alpha, written by the asking tool in the
 *                                            measured world - is relayed VERBATIM (kind, subject and
 *                                            payload byte for byte) into two more ledgers whose writers
 *                                            lead different teams, so the only thing that changes across
 *                                            the three worlds is who may write. The applicant offering
 *                                            to write the other side's parent is refused BY NAME
 *                                            (MERGE_NOT_AUTHORIZED) with control.jsonl byte-identical
 *                                            (sha256, bytes, rows) and the tree untouched; an uninvolved
 *                                            writer is refused the same way, named and unnamed; and the
 *                                            same bytes answered by the party being merged in's own lead
 *                                            LAND - two rows, the FIRST of them that party's OWN
 *                                            team/state. Both merge directions are measured against the
 *                                            frozen semantics: 'join' makes the ASKING team the child of
 *                                            the team it named (measured at the fold), 'absorb' makes the
 *                                            ANSWERED team the child of the asking team (measured where
 *                                            the tree has no earlier claim, because a second non-null
 *                                            parent for one node is the R98 arbiter's question, not the
 *                                            merge's). Only the node being merged in moves; nothing
 *                                            outside it may.
 *   5-no-merge-without-the-handshake-and-the-handshake-is-not-re-derived
 *                                            A merge needs a granted handshake. Asking a team with no
 *                                            handshake is refused MERGE_PEER_REQUIRED, and - the sharper
 *                                            case - a request that was legitimate when it was written and
 *                                            whose handshake was REVOKED afterwards is refused with the
 *                                            same name although the standing request is right there in the
 *                                            file: the merge asks what mayExchange answers and does not
 *                                            work out "can these two talk" a second time. Both refusals
 *                                            leave control.jsonl byte-identical.
 *   6-the-winner-is-the-highest-seq-and-the-arrangement-does-not-matter
 *                                            Three rows of one ordered pair (requested, granted, denied)
 *                                            written by THIS gate through the shipped log and the shipped
 *                                            builder: folded in three arrival orders they answer the same
 *                                            table byte for byte, including seq; the history keeps all
 *                                            three; dropping the denial gives 'granted' and dropping both
 *                                            answers gives 'requested'; and RENUMBERING the same three rows
 *                                            so the DENIAL carries the lowest seq makes the fold answer
 *                                            'requested' - the winner is the highest seq, not the word
 *                                            "denied". The rows the tools really wrote fold the same way
 *                                            whichever way the array is arranged.
 *   7-bad-inputs-are-refused-by-name-and-the-ledger-does-not-move
 *                                            Twenty-seven malformed calls - whole-argument shapes, empty and
 *                                            malformed names, a mode that is not a direction, a state word
 *                                            that is not one of the three this vocabulary holds, a grant
 *                                            that is not a boolean, an answer with no request behind it, an
 *                                            answer with two requests behind it, and the builder's own
 *                                            refusals - must each throw with an UPPER-CASE MERGE_* rule
 *                                            name leading the message, the required nine of them must all be
 *                                            OBSERVED (MERGE_INPUT / MERGE_SELF / MERGE_STATE / MERGE_MODE /
 *                                            MERGE_PEER_REQUIRED / MERGE_NOT_AUTHORIZED / MERGE_GRANT /
 *                                            MERGE_REQUEST_NONE / MERGE_REQUEST_AMBIGUOUS), the same call
 *                                            twice must answer the same name, and control.jsonl must be
 *                                            byte-identical (sha256, bytes, rows) before and after the whole
 *                                            batch. A refusal that still appends is the failure this reading
 *                                            exists for. Beside the batch, a second request against a pair the
 *                                            ledger already holds as granted is refused
 *                                            MERGE_ALREADY_GRANTED with the file unmoved: a request must not
 *                                            silently clear an agreement the fold keeps by seq; and a writer
 *                                            that leads TWO teams is refused MERGE_LOCAL_TEAM rather than
 *                                            having one of them picked for it.
 *
 * Self-attack: --self-attack measures the live world ONCE and then mutates THAT measured world in
 * memory, one mutation per mutant, asserting each mutant reddens exactly its declared readings and
 * nothing else, plus a control mutant that changes nothing. It prints the coverage matrix and the
 * Chinese sentence '声明集 == 观测集' for every mutant, and every reading must be declared by at least one
 * mutant (a reading no mutant can redden is a reading nobody can falsify). Mutating the measured world
 * rather than a hand-written fixture is deliberate: a fixture only proves the judge agrees with itself.
 *
 * Budget: this gate is offline (no port, no client, no kernel boot); it writes throwaway directories
 * under the OS temp dir and removes them unless --keep is given. It prints its elapsed time.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject itself could not be measured here: the
 * module does not import, no world could open its ledger, or NOT ONE tool in the face appends a
 * team/merge row (a NAMED "not measured", never a pass). A reading that cannot be measured is reported
 * as NOT MEASURED and the gate exits 3.
 *
 * Usage: node scripts/verify-collab-merge.mjs [--module <path>] [--record <path>] [--self-attack] [--keep]
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from .tmp/ while it is being built and from scripts/ once it is green. */
const PROJECT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(dir, 'plugins', 'dsh-link-collab', 'lib', 'index.js'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
})()
const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = has('--self-attack')
const KEEP = has('--keep')
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
/** The producer's own record of what it spelled the tools. Read for evidence, never required. */
const RECORD_PATH = resolve(option('--record', join(PROJECT, 'docs', 'handoff', 'R183-A-ledger.md')))

/** The names this gate writes into the world. Recognisable on purpose: a reader of the ledger can tell a test fact from a work fact. */
const TEAM_A = 'gate-r183-alpha'
const TEAM_B = 'gate-r183-beta'
const TEAM_C = 'gate-r183-gamma'
const TEAM_D = 'gate-r183-delta'
const TEAM_E = 'gate-r183-epsilon'
const PAIR_FROM = 'gate-r183-pair-from'
const PAIR_TO = 'gate-r183-pair-to'
const LEAD_A = 'gate-r183-lead-a'
const LEAD_B = 'gate-r183-lead-b'
const HAND = 'recruit'
/** A fixed instant, so the gate-written facts are the same facts in every world. */
const AT = 1760000000000
const TEAM_IDS = [TEAM_A, TEAM_B, TEAM_C, TEAM_D, TEAM_E]
/** The record kinds this round promises. The module's own constants win when it exports them. */
const MERGE_KIND_FALLBACK = 'team/merge'
const TEAM_KIND_FALLBACK = 'team/state'
/** The names R181 and R182 already shipped: the merge must not overload any of them. */
const EARLIER_FACE = ['team_declare_capability', 'team_declare_subteam', 'team_heartbeat', 'team_reclaim_task', 'team_request_peer', 'team_answer_peer']
/** The nine codes the contract and the producer name for this family: each must be OBSERVED by the refusal batch. */
const REQUIRED_CODES = ['MERGE_INPUT', 'MERGE_SELF', 'MERGE_STATE', 'MERGE_MODE', 'MERGE_PEER_REQUIRED', 'MERGE_NOT_AUTHORIZED', 'MERGE_GRANT', 'MERGE_REQUEST_NONE', 'MERGE_REQUEST_AMBIGUOUS']

const READING_IDS = [
  '1-the-round-adds-two-merge-writers-and-they-really-append',
  '2-the-asking-tool-writes-the-request-row-it-returns',
  '3-a-denial-writes-one-row-and-a-join-grant-writes-exactly-two',
  '4-only-the-party-being-merged-in-writes-its-own-parent',
  '5-no-merge-without-the-handshake-and-the-handshake-is-not-re-derived',
  '6-the-winner-is-the-highest-seq-and-the-arrangement-does-not-matter',
  '7-bad-inputs-are-refused-by-name-and-the-ledger-does-not-move',
]

const show = (value) => JSON.stringify(value === undefined ? null : value)
const clip = (text, width) => { const s = String(text ?? ''); return s.length <= width ? s : s.slice(0, width) + '...' }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const kindOf = (module, name, fallback) => (typeof module?.[name] === 'string' && module[name] !== '' ? module[name] : fallback)
const mergeKindOf = (module) => kindOf(module, 'MERGE_KIND', MERGE_KIND_FALLBACK)
const teamKindOf = (module) => kindOf(module, 'TEAM_KIND', TEAM_KIND_FALLBACK)

/** The rule name a refusal leads with. A registry may render a thrown error as 'Error: <code>: <detail>'; this is the code. */
const firstCode = (message) => {
  const match = /^\s*(?:Error:\s*)?([A-Z][A-Z0-9_]{2,})\b/.exec(String(message ?? ''))
  return match === null ? null : match[1]
}

// ---------------------------------------------------------------------------
// The ledger file, counted by this gate
// ---------------------------------------------------------------------------

/** Read <dir>/control.jsonl and parse it here: the sha256, the byte count and the row count are this gate's arithmetic, not the plugin's. */
const readLedger = (dir) => {
  const path = join(dir, 'control.jsonl')
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch { return { path, rows: [], lines: [], text: '', bytes: 0, sha256: null, unreadable: 0, present: false } }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const rows = []
  let unreadable = 0
  for (const line of lines) {
    try { rows.push(JSON.parse(line)) } catch { unreadable += 1 }
  }
  return { path, rows, lines, text, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text, 'utf8').digest('hex'), unreadable, present: true }
}
const stamp = (ledger) => ({ present: ledger.present, sha256: ledger.sha256, bytes: ledger.bytes, rows: ledger.rows.length, lines: ledger.lines.length, unreadable: ledger.unreadable })
const stampSame = (left, right) => left?.present === right?.present && left?.sha256 === right?.sha256 && left?.bytes === right?.bytes && left?.rows === right?.rows && left?.lines === right?.lines

// ---------------------------------------------------------------------------
// The folds and the tree, read through the shipped module over rows this gate parsed
// ---------------------------------------------------------------------------

const mergeFoldOf = (module, rows) => {
  try {
    const state = module.projectMerges(rows)
    const pairs = state.pairs.map((pair) => ({ from: pair.from, to: pair.to, mode: pair.mode, state: pair.state, seq: pair.seq }))
    const history = state.merges.map((row) => ({ from: row.from, to: row.to, mode: row.mode, state: row.state, seq: row.seq }))
    return { ok: true, pairs, history, malformed: state.malformed, text: JSON.stringify(pairs.map((pair) => [pair.from, pair.to, pair.mode, pair.state, pair.seq])), error: null }
  } catch (error) {
    return { ok: false, pairs: [], history: [], malformed: null, text: 'the fold threw', error: String(error && error.message ? error.message : error) }
  }
}
const teamStateOf = (module, rows) => {
  try { return { ok: true, state: module.projectTeamState(rows), error: null } } catch (error) { return { ok: false, state: null, error: String(error && error.message ? error.message : error) } }
}
/** What the shipped tree fold says about the teams this gate named: the node's parent and lead, and only those. */
const nodeMap = (module, rows, ids) => {
  const folded = teamStateOf(module, rows)
  if (folded.ok !== true) return { ok: false, map: {}, text: 'the tree fold threw: ' + show(folded.error), error: folded.error }
  const map = {}
  for (const id of ids) {
    const node = (folded.state.teams?.teams ?? []).find((team) => team.id === id)
    map[id] = node === undefined ? null : { id: node.id, parent: node.parent === undefined ? null : node.parent, lead: node.lead === undefined ? null : node.lead }
  }
  return { ok: true, map, text: JSON.stringify(ids.map((id) => map[id])), error: null }
}
const changedBetween = (before, after) => {
  if (before?.ok !== true || after?.ok !== true) return []
  return Object.keys(before.map).filter((id) => same(before.map[id], after.map[id]) === false)
}
const mayMergeOf = (module, rows, from, to) => {
  try { return module.mayMerge(module.projectTeamState(rows), from, to) } catch (error) { return 'threw: ' + String(error && error.message ? error.message : error) }
}
const mayExchangeOf = (module, rows, from, to) => {
  try { return module.mayExchange(module.projectTeamState(rows), from, to) } catch (error) { return 'threw: ' + String(error && error.message ? error.message : error) }
}

// ---------------------------------------------------------------------------
// The world: a fresh control log driven through the SHIPPED artifact
// ---------------------------------------------------------------------------

const safeLabel = (text) => String(text).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40)

const buildWorld = async (module, label) => {
  const root = mkdtempSync(join(tmpdir(), 'r183-merge-' + safeLabel(label) + '-'))
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
    module.apply(ctx, {})
    applied = { ok: true }
  } catch (error) {
    applied = { ok: false, error: String(error && error.message ? error.message : error) }
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  const collab = provided.get('linkCollab')
  return { root, dir, registry, collab, applied, disposers, writer: String(collab?.log?.writer ?? '(none)') }
}
const closeWorld = (built) => {
  for (const dispose of built.disposers ?? []) { try { dispose() } catch { /* the world is being thrown away */ } }
}
const call = async (built, name, args) => {
  const definition = built.registry.get(name)
  if (definition === undefined) return { ok: false, missing: true, error: name + ' is not in the registry' }
  try { return { ok: true, value: await definition.execute(args) } } catch (error) {
    const message = String(error && error.message ? error.message : error)
    return { ok: false, missing: false, error: message, name: error && error.name ? error.name : null, code: firstCode(message) }
  }
}
/** Seed the facts a world needs before a tool can do anything: the ledger is the only place any of this lives. */
const seedWorld = async (built, module, records) => {
  const written = []
  for (const record of records) written.push(await built.collab.log.append(record))
  return written
}
/** The facts every probe world starts from: one team the writer leads, two it does not, and the handshakes a merge needs. */
const probeSeed = (module, writer) => [
  module.teamRecord(TEAM_A, null, writer),
  module.teamRecord(TEAM_B, null, LEAD_B),
  module.teamRecord(TEAM_C, null, LEAD_B),
  module.peerRecord(TEAM_A, TEAM_B, HAND, 'granted'),
  module.peerRecord(TEAM_A, TEAM_C, HAND, 'granted'),
  module.mergeRecord({ from: TEAM_A, to: TEAM_C, mode: 'join', state: 'requested', by: writer, at: AT }),
]

// ---------------------------------------------------------------------------
// Discovery: which registered tool appends a team/merge row, and with what arguments
// ---------------------------------------------------------------------------

/** Hand-written argument shapes: the words a tool for this record could plausibly take. */
const PROBE_SHAPES = [
  { id: 'team+mode=join', args: { team: TEAM_B, mode: 'join' } },
  { id: 'team+mode=absorb', args: { team: TEAM_B, mode: 'absorb' } },
  { id: 'from+grant=true', args: { from: TEAM_A, grant: true } },
  { id: 'from+grant=false', args: { from: TEAM_A, grant: false } },
  { id: 'from+team+grant=true', args: { from: TEAM_A, team: TEAM_A, grant: true } },
  { id: 'from+team+grant=false', args: { from: TEAM_A, team: TEAM_A, grant: false } },
  { id: 'team', args: { team: TEAM_B } },
  { id: 'from', args: { from: TEAM_A } },
  { id: 'from+to+mode=join', args: { from: TEAM_A, to: TEAM_B, mode: 'join' } },
  { id: 'from+to+grant=true', args: { from: TEAM_A, to: TEAM_B, grant: true } },
  { id: 'empty-object', args: {} },
]
/** What one declared property name means, in this record's own vocabulary. */
const schemaValue = (key, variant, team) => {
  const name = String(key).toLowerCase()
  if (/^(team|teamid|team_id|target|answerer|taker)$/.test(name)) return team
  if (/^(from|asker|requester|source)$/.test(name)) return TEAM_A
  if (/^(mode|direction|way)$/.test(name)) return variant === 'absorb' ? 'absorb' : 'join'
  if (/^(grant|granted|accept|accepted|approve|approved|allow|allowed|ok|yes)$/.test(name)) return variant === 'grant'
  if (/^(state|verdict|decision|status|answer|response)$/.test(name)) return variant === 'grant' ? 'granted' : 'requested'
  return undefined
}
/** Hand-written shapes, plus shapes built from the tool's OWN declared schema - so a tool that names its fields differently is still reachable. */
const probeShapes = (definition) => {
  const out = PROBE_SHAPES.map((shape) => ({ id: shape.id, args: shape.args, declared: false }))
  const properties = definition?.parameters?.properties
  if (properties !== null && typeof properties === 'object') {
    for (const variant of ['join', 'absorb', 'grant']) {
      for (const team of [TEAM_A, TEAM_B]) {
        const args = {}
        let filled = 0
        for (const key of Object.keys(properties)) {
          const value = schemaValue(key, variant, team)
          if (value !== undefined) { args[key] = value; filled += 1 }
        }
        if (filled > 0) out.push({ id: 'declared-schema variant=' + variant + ' team=' + team, args, declared: true })
      }
    }
  }
  return out
}

/**
 * Call every registered name in its OWN freshly seeded world and keep the calls that appended exactly
 * one team/merge row (plus at most one team/state row, which is how a grant writes its tree).
 */
const discoverMerges = async (module) => {
  const kind = mergeKindOf(module)
  const teamKind = teamKindOf(module)
  const namesWorld = await buildWorld(module, 'names')
  const names = [...namesWorld.registry.keys()].sort()
  const writer = namesWorld.writer
  const applied = namesWorld.applied
  const roots = [namesWorld.root]
  closeWorld(namesWorld)

  const successes = []
  const tried = []
  for (const name of names) {
    const world = await buildWorld(module, 'probe-' + name)
    roots.push(world.root)
    const definition = world.registry.get(name)
    if (world.applied.ok !== true || world.collab === undefined) {
      tried.push(name + ' -> the world would not open (apply(): ' + clip(world.applied.error ?? 'no capability', 60) + ')')
      closeWorld(world)
      continue
    }
    try { await seedWorld(world, module, probeSeed(module, world.writer)) } catch (error) { tried.push(name + ' -> the probe seed would not land: ' + clip(error?.message, 60)) }
    for (const shape of probeShapes(definition)) {
      const before = readLedger(world.dir)
      const outcome = await call(world, name, shape.args)
      const after = readLedger(world.dir)
      const gained = after.rows.slice(before.rows.length)
      const merges = gained.filter((row) => row.kind === kind)
      const others = gained.filter((row) => row.kind !== kind)
      const clean = merges.length === 1 && gained.length <= 3 && others.every((row) => row.kind === teamKind) && after.unreadable === before.unreadable
      if (clean === true && outcome.ok === true) {
        successes.push({
          tool: name, shape: shape.id, declared: shape.declared, args: shape.args,
          state: typeof merges[0].payload?.state === 'string' ? merges[0].payload.state : null,
          mode: typeof merges[0].payload?.mode === 'string' ? merges[0].payload.mode : null,
          subject: merges[0].subject ?? null, gained: gained.length,
          kinds: gained.map((row) => row.kind),
        })
        tried.push(name + ' | ' + shape.id + ' -> appended ' + String(gained.length) + ' row(s) [' + gained.map((row) => row.kind).join(', ') + ']')
        continue
      }
      tried.push(name + ' | ' + shape.id + ' -> ' + (outcome.ok === true ? 'appended ' + String(gained.length) + ' row(s), none of them ' + kind : clip(outcome.error, 60)))
    }
    closeWorld(world)
  }
  const first = (state) => successes.find((entry) => entry.state === state) ?? null
  const writers = [...new Set(successes.map((entry) => entry.tool))].sort()
  return {
    discovery: {
      names, writer, applied, tried,
      successes: successes.map((entry) => ({ tool: entry.tool, shape: entry.shape, declared: entry.declared, state: entry.state, mode: entry.mode, subject: entry.subject, gained: entry.gained, kinds: entry.kinds })),
      writers, ask: first('requested'), grant: first('granted'), deny: first('denied'), kind, teamKind,
    },
    roots,
  }
}

// ---------------------------------------------------------------------------
// Collection: the measured world, plus the two worlds the discipline is paired across
// ---------------------------------------------------------------------------

const recordEvidence = () => {
  try { return { path: RECORD_PATH, text: readFileSync(RECORD_PATH, 'utf8'), present: true } } catch { return { path: RECORD_PATH, text: null, present: false } }
}

/** Every fact the judge reads, measured once. Mutants rewrite these fields; nothing else is re-read. */
const collect = async (module) => {
  const progress = []
  const world = {
    module: MODULE_PATH, kind: mergeKindOf(module), at: Date.now(), roots: [], fatal: null, unmeasured: [],
    discovery: null, registry: null, record: recordEvidence(),
    ledger: {}, calls: {}, request: null, tree: {}, direction: null, pair: null, handshake: null, seq: null,
    refusals: [], refusalRepeat: null, counts: {},
  }
  const { discovery, roots } = await discoverMerges(module)
  world.roots.push(...roots)
  world.discovery = discovery
  world.roots.push(...(roots.length > 0 ? [] : []))
  progress.push('discovery: ' + String(discovery.names.length) + ' tool(s) in the face, ' + String(discovery.writers.length) + ' of them appended a ' + show(world.kind) + ' row in their own seeded world')
  if (discovery.writers.length === 0) {
    world.fatal = 'NOT MEASURED - 这个世界的 registry 里没有该工具: not ONE of the ' + String(discovery.names.length) + ' registered name(s) ' + show(discovery.names) + ' appended a ' + show(world.kind) + ' row for any of the argument shapes this gate tried, so the merge act is not in this world to be measured'
    return { world, progress, fatal: world.fatal }
  }

  const built = await buildWorld(module, 'measure')
  world.roots.push(built.root)
  world.dir = built.dir
  world.applied = built.applied
  if (built.applied.ok !== true || built.collab === undefined) {
    closeWorld(built)
    world.fatal = 'apply() did not publish linkCollab in the measured world: ' + show(built.applied.error ?? 'no capability provided')
    return { world, progress, fatal: world.fatal }
  }
  const W = built.writer
  world.collabNames = built.collab.tools?.names ? [...built.collab.tools.names].sort() : null
  world.collabAvailable = built.collab.tools?.available ?? null
  world.registry = { names: [...built.registry.keys()].sort(), logWriter: W }
  const usable = (entry) => entry !== null && world.registry.names.includes(entry.tool)
  world.discovery.usable = { ask: usable(discovery.ask), grant: usable(discovery.grant), deny: usable(discovery.deny) }
  if (world.discovery.usable.ask !== true) world.unmeasured.push({ id: READING_IDS[1], reason: 'no tool in this registry appended a ' + show(world.kind) + ' row with state=requested, so there is nothing to call' })
  if (world.discovery.usable.grant !== true || world.discovery.usable.deny !== true) world.unmeasured.push({ id: READING_IDS[2], reason: 'no tool in this registry answered a standing request with a granted (grant=' + show(world.discovery.usable.grant) + ') and a denied (deny=' + show(world.discovery.usable.deny) + ') row, so the two branch shapes cannot be measured here' })
  if (world.discovery.usable.ask !== true || world.discovery.usable.grant !== true) {
    world.unmeasured.push({ id: READING_IDS[3], reason: 'the merge act needs both an asking tool (present=' + show(world.discovery.usable.ask) + ') and an answering tool (present=' + show(world.discovery.usable.grant) + ') in this registry; without both, whose parent a merge writes cannot be measured' })
    world.unmeasured.push({ id: READING_IDS[4], reason: 'the handshake precondition is reached by asking (present=' + show(world.discovery.usable.ask) + ') and by answering (present=' + show(world.discovery.usable.grant) + '); without both, only half the rule is reachable' })
    world.unmeasured.push({ id: READING_IDS[6], reason: 'the refusal batch is driven through both tools (ask present=' + show(world.discovery.usable.ask) + ', answer present=' + show(world.discovery.usable.grant) + ') and the required ' + String(REQUIRED_CODES.length) + ' codes cannot all be reached without both' })
  }

  const snap = (extra) => {
    const ledger = readLedger(built.dir)
    return { stamp: stamp(ledger), rows: ledger.rows, ...extra }
  }
  const nodesNow = () => { const ledger = readLedger(built.dir); return { stamp: stamp(ledger), nodes: nodeMap(module, ledger.rows, TEAM_IDS) } }
  const foldNow = () => { const ledger = readLedger(built.dir); return { stamp: stamp(ledger), fold: mergeFoldOf(module, ledger.rows) } }

  // -- 0. the seed: one team the writer leads, four it does not, and the handshakes ---------------
  world.ledger.beforeSeed = snap()
  await seedWorld(built, module, [
    module.teamRecord(TEAM_A, null, W),
    module.teamRecord(TEAM_B, null, LEAD_B),
    module.teamRecord(TEAM_C, null, LEAD_B),
    module.teamRecord(TEAM_D, null, LEAD_B),
    module.teamRecord(TEAM_E, null),
    module.peerRecord(TEAM_A, TEAM_B, HAND, 'granted'),
    module.peerRecord(TEAM_A, TEAM_C, HAND, 'granted'),
    module.peerRecord(TEAM_A, TEAM_D, HAND, 'granted'),
    module.peerRecord(TEAM_C, TEAM_A, HAND, 'granted'),
  ])
  world.ledger.seeded = snap()
  world.tree.afterSeed = nodesNow()
  progress.push('measured world: writer ' + show(W) + ', ledger ' + show(world.ledger.seeded.stamp.sha256?.slice(0, 12)) + ' over ' + String(world.ledger.seeded.stamp.rows) + ' seeded row(s)')

  const askArgs = { team: TEAM_B, mode: 'join' }
  world.calls.ask = usable(discovery.ask) ? await call(built, discovery.ask.tool, askArgs) : { ok: false, missing: true, error: 'no asking tool was discovered, so there is nothing to call' }
  world.ledger.afterAsk = snap()
  const askGained = world.ledger.afterAsk.rows.slice(world.ledger.seeded.rows.length)
  world.request = {
    args: askArgs,
    tool: discovery.ask?.tool ?? null,
    shape: discovery.ask?.shape ?? null,
    gained: askGained.length,
    rows: askGained,
    row: askGained.length === 1 ? askGained[0] : null,
    returned: world.calls.ask?.ok === true ? world.calls.ask.value : null,
    returnedError: world.calls.ask?.ok === true ? null : String(world.calls.ask?.error ?? null),
    builder: null,
    fold: foldNow(),
    mayExchange: mayExchangeOf(module, world.ledger.afterAsk.rows, TEAM_A, TEAM_B),
    mayMerge: mayMergeOf(module, world.ledger.afterAsk.rows, TEAM_A, TEAM_B),
    tree: nodeMap(module, world.ledger.afterAsk.rows, TEAM_IDS),
  }
  world.request.builder = (() => {
    const row = world.request.row
    if (row === null || row === undefined) return null
    try {
      const built2 = module.mergeRecord({ from: row.payload?.from, to: row.payload?.to, mode: row.payload?.mode, state: row.payload?.state, by: row.payload?.by, at: row.payload?.at })
      return { kind: built2.kind, subject: built2.subject, payload: built2.payload }
    } catch (error) { return { threw: String(error && error.message ? error.message : error) } }
  })()

  // -- 1. the denial: exactly one row, and no tree row -------------------------------------------
  world.calls.deny = usable(discovery.deny) ? await call(built, discovery.deny.tool, { from: TEAM_A, grant: false }) : { ok: false, missing: true, error: 'no denying tool was discovered, so there is nothing to call' }
  world.ledger.afterDeny = snap()
  const denyGained = world.ledger.afterDeny.rows.slice(world.ledger.afterAsk.rows.length)
  world.denial = {
    tool: discovery.deny?.tool ?? null,
    gained: denyGained.length,
    rows: denyGained,
    returned: world.calls.deny?.ok === true ? world.calls.deny.value : null,
    returnedError: world.calls.deny?.ok === true ? null : String(world.calls.deny?.error ?? null),
    tree: nodeMap(module, world.ledger.afterDeny.rows, TEAM_IDS),
  }

  // -- 2. the join grant: exactly two rows, one call ---------------------------------------------
  world.calls.askAgain = usable(discovery.ask) ? await call(built, discovery.ask.tool, askArgs) : { ok: false, missing: true, error: 'no asking tool was discovered' }
  world.ledger.beforeJoinGrant = snap()
  world.calls.grant = usable(discovery.grant) ? await call(built, discovery.grant.tool, { from: TEAM_A, grant: true }) : { ok: false, missing: true, error: 'no granting tool was discovered' }
  world.ledger.afterJoinGrant = snap()
  const grantGained = world.ledger.afterJoinGrant.rows.slice(world.ledger.beforeJoinGrant.rows.length)
  world.joinGrant = {
    tool: discovery.grant?.tool ?? null,
    gained: grantGained.length,
    rows: grantGained,
    returned: world.calls.grant?.ok === true ? world.calls.grant.value : null,
    returnedError: world.calls.grant?.ok === true ? null : String(world.calls.grant?.error ?? null),
    tree: nodeMap(module, world.ledger.afterJoinGrant.rows, TEAM_IDS),
    mayMerge: mayMergeOf(module, world.ledger.afterJoinGrant.rows, TEAM_A, TEAM_B),
    fold: mergeFoldOf(module, world.ledger.afterJoinGrant.rows),
  }
  world.counts.fileMergeRows = world.ledger.afterJoinGrant.rows.filter((row) => row.kind === world.kind).length
  world.counts.foldHistory = world.joinGrant.fold.history.length
  if (world.counts.fileMergeRows === 0) world.unmeasured.push({ id: READING_IDS[5], reason: 'no tool appended a ' + show(world.kind) + ' row in the measured world, so the arrangement of the rows the tools really wrote cannot be tested here' })
  world.tree.afterJoinGrant = world.joinGrant.tree
  world.tree.movedByJoin = changedBetween(world.tree.afterSeed.nodes, world.tree.afterJoinGrant)

  // -- 2b. the agreement stands until it is answered for ------------------------------------------
  // A second request against a pair the ledger already holds as granted would silently clear it (the
  // fold keeps the highest seq per ordered pair), so it is refused by name before anything is written.
  world.ledger.beforeSecondAsk = snap()
  world.calls.secondAsk = usable(discovery.ask) ? await call(built, discovery.ask.tool, askArgs) : { ok: false, missing: true, error: 'no asking tool was discovered' }
  world.ledger.afterSecondAsk = snap()
  world.alreadyGranted = {
    code: world.calls.secondAsk?.code ?? null,
    message: clip(String(world.calls.secondAsk?.error ?? ''), 180),
    threw: world.calls.secondAsk?.ok === false,
    bytesSame: stampSame(world.ledger.beforeSecondAsk.stamp, world.ledger.afterSecondAsk.stamp),
  }

  // -- 3. asking a team with no handshake at all -------------------------------------------------
  world.ledger.beforeBareAsk = snap()
  world.calls.bareAsk = usable(discovery.ask) ? await call(built, discovery.ask.tool, { team: TEAM_E, mode: 'join' }) : { ok: false, missing: true, error: 'no asking tool was discovered' }
  world.ledger.afterBareAsk = snap()
  world.handshake = {
    bareAsk: { code: world.calls.bareAsk?.code ?? null, message: clip(String(world.calls.bareAsk?.error ?? ''), 160), threw: world.calls.bareAsk?.ok === false, bytesSame: stampSame(world.ledger.beforeBareAsk.stamp, world.ledger.afterBareAsk.stamp) },
    revoked: null,
  }

  // -- 4. the honest absorb inside this world: the writer's own team is the party merged in ------
  // The asker is another team, so this request arrives as a FACT relayed into this ledger, written
  // through the shipped builder - exactly how a peer end's own page would land here.
  const relayedRequest = module.mergeRecord({ from: TEAM_C, to: TEAM_A, mode: 'absorb', state: 'requested', by: 'gate-r183-asker-c', at: AT })
  await built.collab.log.append(relayedRequest)
  world.ledger.beforeAbsorbGrant = snap()
  world.calls.absorbGrant = usable(discovery.grant) ? await call(built, discovery.grant.tool, { from: TEAM_C, team: TEAM_A, grant: true }) : { ok: false, missing: true, error: 'no granting tool was discovered' }
  world.ledger.afterAbsorbGrant = snap()
  const absorbGained = world.ledger.afterAbsorbGrant.rows.slice(world.ledger.beforeAbsorbGrant.rows.length)
  world.direction = {
    relayed: { kind: relayedRequest.kind, subject: relayedRequest.subject, payload: relayedRequest.payload },
    gained: absorbGained.length,
    rows: absorbGained,
    // Which teams the rows of a grant are ABOUT: the only writer a merge may be is the party being
    // merged in, and this is that claim measured on the rows themselves rather than on the fold.
    rowsWrittenTeams: absorbGained.filter((row) => row.kind === teamKindOf(module)).map((row) => row.subject),
    returned: world.calls.absorbGrant?.ok === true ? world.calls.absorbGrant.value : null,
    returnedError: world.calls.absorbGrant?.ok === true ? null : String(world.calls.absorbGrant?.error ?? null),
    tree: nodeMap(module, world.ledger.afterAbsorbGrant.rows, TEAM_IDS),
    joinEdge: { asker: TEAM_A, named: TEAM_B, rowTeam: world.joinGrant.rows[0]?.subject ?? null, rowParent: world.joinGrant.rows[0]?.payload?.parent ?? null, parentAfter: world.tree.afterJoinGrant.map?.[TEAM_A]?.parent ?? null },
    // The folded value after a SECOND non-null claim for one node is the tree arbiter's question (R98,
    // team-parent-arbitration), not the merge's: the row says gamma, and the arbiter keeps the earlier
    // claim. Both are recorded here rather than asserted as if the merge owned the arbiter's rule.
    absorbEdge: { asker: TEAM_C, answered: TEAM_A, rowTeam: absorbGained[0]?.subject ?? null, rowParent: absorbGained[0]?.payload?.parent ?? null, parentAfter: null, foldedAfter: null },
    mayMergeAbsorb: mayMergeOf(module, world.ledger.afterAbsorbGrant.rows, TEAM_C, TEAM_A),
  }
  world.direction.absorbEdge.parentAfter = (world.direction.tree.map[TEAM_A] ?? null)?.parent ?? null
  world.direction.absorbEdge.foldedAfter = JSON.stringify(world.direction.tree.map[TEAM_A] ?? null)
  world.tree.afterAbsorbGrant = world.direction.tree
  world.tree.movedByAbsorb = changedBetween(world.tree.afterJoinGrant, world.tree.afterAbsorbGrant)

  // -- 5. the applicant offers to write the other side's parent ----------------------------------
  // Asked with the OTHER mode and the OTHER team: alpha takes delta in, so the party being merged in
  // is delta - whose lead is not this ledger's writer.
  world.calls.absorbAsk = usable(discovery.ask) ? await call(built, discovery.ask.tool, { team: TEAM_D, mode: 'absorb' }) : { ok: false, missing: true, error: 'no asking tool was discovered' }
  world.ledger.afterAbsorbAsk = snap()
  world.absorbAsk = {
    gained: world.ledger.afterAbsorbAsk.rows.length - world.ledger.afterAbsorbGrant.rows.length,
    row: world.ledger.afterAbsorbAsk.rows[world.ledger.afterAbsorbAsk.rows.length - 1] ?? null,
  }
  world.ledger.beforeWrongWriter = nodesNow()
  world.calls.wrongWriter = usable(discovery.grant) ? await call(built, discovery.grant.tool, { from: TEAM_A, team: TEAM_D, grant: true }) : { ok: false, missing: true, error: 'no granting tool was discovered' }
  world.ledger.afterWrongWriter = nodesNow()
  world.wrongWriter = {
    code: world.calls.wrongWriter?.code ?? null,
    message: clip(String(world.calls.wrongWriter?.error ?? ''), 200),
    threw: world.calls.wrongWriter?.ok === false,
    bytesSame: stampSame(world.ledger.beforeWrongWriter.stamp, world.ledger.afterWrongWriter.stamp),
    treeSame: world.ledger.beforeWrongWriter.nodes.text === world.ledger.afterWrongWriter.nodes.text,
  }

  // -- 6. the SAME fact in three ledgers: refused by the applicant, refused by an uninvolved writer,
  //       and landing when the party being merged in writes its own parent --------------------------
  // The fact is the one this world's applicant really asked for (alpha takes delta in), relayed
  // VERBATIM - kind, subject and payload byte for byte - into two more ledgers whose writers lead
  // different teams. The only thing that changes between the three worlds is who may write.
  const mFact = world.absorbAsk?.row === null || world.absorbAsk?.row === undefined ? null : { kind: world.absorbAsk.row.kind, subject: world.absorbAsk.row.subject, payload: world.absorbAsk.row.payload }
  world.pair = { fact: mFact, uninvolved: null, owner: null, sameFact: null, error: null }
  const relay = (fact) => ({ kind: fact.kind, subject: fact.subject, payload: fact.payload })
  const factBy = (dir, to) => {
    const held = readLedger(dir).rows.filter((row) => row.kind === world.kind && row.payload?.to === to)
    return held.length === 1 ? { kind: held[0].kind, subject: held[0].subject, payload: held[0].payload } : null
  }

  const uninvolved = await buildWorld(module, 'uninvolved')
  world.roots.push(uninvolved.root)
  try {
    await seedWorld(uninvolved, module, [
      module.teamRecord(TEAM_A, null, LEAD_A),
      module.teamRecord(TEAM_B, null, uninvolved.writer),
      module.peerRecord(TEAM_A, TEAM_D, HAND, 'granted'),
    ])
    await uninvolved.collab.log.append(relay(mFact))
    const beforeUnnamed = nodesNow2(uninvolved, module)
    const callUnnamed = await call(uninvolved, discovery.grant?.tool ?? '', { from: TEAM_A, grant: true })
    const afterUnnamed = nodesNow2(uninvolved, module)
    const callNamed = await call(uninvolved, discovery.grant?.tool ?? '', { from: TEAM_A, team: TEAM_D, grant: true })
    const afterNamed = nodesNow2(uninvolved, module)
    world.pair.uninvolved = {
      writer: uninvolved.writer,
      whoseFactItHolds: factBy(uninvolved.dir, TEAM_D),
      refusalUnnamed: { code: firstCode(callUnnamed?.error), threw: callUnnamed?.ok === false, message: clip(String(callUnnamed?.error ?? ''), 160), bytesSame: stampSame(beforeUnnamed.stamp, afterUnnamed.stamp), treeSame: beforeUnnamed.nodes.text === afterUnnamed.nodes.text },
      refusalNamed: { code: firstCode(callNamed?.error), threw: callNamed?.ok === false, message: clip(String(callNamed?.error ?? ''), 160), bytesSame: stampSame(afterUnnamed.stamp, afterNamed.stamp), treeSame: afterUnnamed.nodes.text === afterNamed.nodes.text },
    }
  } catch (error) { world.pair.error = 'uninvolved: ' + String(error && error.message ? error.message : error) }
  closeWorld(uninvolved)

  const owner = await buildWorld(module, 'owner')
  world.roots.push(owner.root)
  try {
    await seedWorld(owner, module, [
      module.teamRecord(TEAM_A, null, LEAD_A),
      module.teamRecord(TEAM_D, null, owner.writer),
      module.peerRecord(TEAM_A, TEAM_D, HAND, 'granted'),
    ])
    await owner.collab.log.append(relay(mFact))
    // The fact as this ledger holds it, read BEFORE the landing writes the agreement beside it.
    const heldFact = factBy(owner.dir, TEAM_D)
    const beforeLanding = nodesNow2(owner, module)
    const landingCall = await call(owner, discovery.grant?.tool ?? '', { from: TEAM_A, grant: true })
    const afterLanding = nodesNow2(owner, module)
    const gained = afterLanding.rows.slice(beforeLanding.rows.length)
    world.pair.owner = {
      writer: owner.writer,
      whoseFactItHolds: heldFact,
      ok: landingCall.ok === true,
      error: landingCall.ok === true ? null : clip(String(landingCall.error ?? ''), 200),
      gained: gained.length,
      rows: gained,
      returned: landingCall.ok === true ? landingCall.value : null,
      nodes: afterLanding.nodes,
      moved: changedBetween(beforeLanding.nodes, afterLanding.nodes),
      stampMoved: stampSame(beforeLanding.stamp, afterLanding.stamp) === false,
      answeredPartyParent: (afterLanding.nodes.map[TEAM_D] ?? null)?.parent ?? null,
    }
  } catch (error) { world.pair.error = (world.pair.error === null ? '' : world.pair.error + '; ') + 'owner: ' + String(error && error.message ? error.message : error) }
  closeWorld(owner)

  world.pair.sameFact = {
    measured: mFact,
    uninvolved: world.pair.uninvolved?.whoseFactItHolds ?? null,
    owner: world.pair.owner?.whoseFactItHolds ?? null,
    allSame: false,
  }
  world.pair.sameFact.allSame = same(world.pair.sameFact.measured, world.pair.sameFact.uninvolved) && same(world.pair.sameFact.measured, world.pair.sameFact.owner)

  // -- 7. the handshake, revoked after the request was legitimately written ----------------------
  const shake = await buildWorld(module, 'handshake')
  world.roots.push(shake.root)
  try {
    const W3 = shake.writer
    await seedWorld(shake, module, [
      module.teamRecord(TEAM_A, null, W3),
      module.teamRecord(TEAM_B, null, LEAD_B),
      module.teamRecord(TEAM_E, null),
      module.peerRecord(TEAM_A, TEAM_B, HAND, 'granted'),
    ])
    const asked = await call(shake, discovery.ask?.tool ?? '', { team: TEAM_B, mode: 'join' })
    const standing = readLedger(shake.dir).rows.filter((row) => row.kind === world.kind && row.payload?.state === 'requested')
    await shake.collab.log.append(module.peerRecord(TEAM_A, TEAM_B, HAND, 'denied'))
    const beforeAnswer = nodesNow2(shake, module)
    const answered = await call(shake, discovery.grant?.tool ?? '', { from: TEAM_A, grant: true })
    const afterAnswer = nodesNow2(shake, module)
    world.handshake.revoked = {
      asked: asked.ok === true,
      standingRequest: standing.length === 1 ? { from: standing[0].payload.from, to: standing[0].payload.to, mode: standing[0].payload.mode, state: standing[0].payload.state } : null,
      mayExchangeBefore: mayExchangeOf(module, beforeAnswer.rows, TEAM_A, TEAM_B),
      code: firstCode(answered?.error),
      threw: answered.ok === false,
      message: clip(String(answered?.error ?? ''), 200),
      bytesSame: stampSame(beforeAnswer.stamp, afterAnswer.stamp),
      treeSame: beforeAnswer.nodes.text === afterAnswer.nodes.text,
    }
  } catch (error) { world.handshake.error = String(error && error.message ? error.message : error) }
  closeWorld(shake)

  // -- 7b. a writer that leads two teams cannot ask on anybody's behalf --------------------------
  // The asking tool reads the asking team OUT of the ledger, so two teams led by one writer is a
  // question only the caller can answer: it is refused rather than picked for them.
  const twoTeams = await buildWorld(module, 'two-teams')
  world.roots.push(twoTeams.root)
  try {
    await seedWorld(twoTeams, module, [
      module.teamRecord(TEAM_A, null, twoTeams.writer),
      module.teamRecord(TEAM_B, null, twoTeams.writer),
      module.peerRecord(TEAM_A, TEAM_B, HAND, 'granted'),
    ])
    const beforeLocal = nodesNow2(twoTeams, module)
    const callLocal = await call(twoTeams, discovery.ask?.tool ?? '', { team: TEAM_C, mode: 'join' })
    const afterLocal = nodesNow2(twoTeams, module)
    world.twoTeams = {
      writer: twoTeams.writer,
      code: firstCode(callLocal?.error),
      threw: callLocal?.ok === false,
      message: clip(String(callLocal?.error ?? ''), 180),
      bytesSame: stampSame(beforeLocal.stamp, afterLocal.stamp),
      treeSame: beforeLocal.nodes.text === afterLocal.nodes.text,
    }
  } catch (error) { world.twoTeams = { error: String(error && error.message ? error.message : error) } }
  closeWorld(twoTeams)

  // -- 8. the winner is the highest seq: three rows this gate writes, three arrival orders --------
  const seqDir = join(built.root, 'seq-log')
  mkdirSync(seqDir, { recursive: true })
  world.seq = { dir: seqDir, three: null, measured: null, error: null }
  try {
    const log = module.openControlLog({ dir: seqDir, writer: 'gate-r183-seq' })
    const three = [
      module.mergeRecord({ from: PAIR_FROM, to: PAIR_TO, mode: 'join', state: 'requested', by: 'gate-r183-seq', at: AT }),
      module.mergeRecord({ from: PAIR_FROM, to: PAIR_TO, mode: 'join', state: 'granted', by: 'gate-r183-seq', at: AT + 1 }),
      module.mergeRecord({ from: PAIR_FROM, to: PAIR_TO, mode: 'join', state: 'denied', by: 'gate-r183-seq', at: AT + 2 }),
    ]
    for (const record of three) await log.append(record)
    await log.close()
    const rows = readLedger(seqDir).rows.filter((row) => row.kind === world.kind).sort((left, right) => left.seq - right.seq)
    const foldOf = (records) => mergeFoldOf(module, records)
    const original = foldOf(rows)
    const reversed = foldOf([...rows].reverse())
    const rotated = rows.length === 3 ? foldOf([rows[1], rows[2], rows[0]]) : foldOf(rows)
    const without = (state) => rows.filter((row) => row.payload?.state !== state)
    const renumber = (order) => foldOf(rows.map((row, at) => ({ ...row, seq: order[at] })))
    const denialFirst = renumber([rows.length, rows.length - 1, 1])
    world.seq.three = {
      rows: rows.length,
      original, reversed, rotated,
      allSame: original.text === reversed.text && original.text === rotated.text,
      minusDeny: foldOf(without('denied')),
      onlyRequest: foldOf(without('granted').filter((row) => row.payload?.state === 'requested')),
      renumberedDenialFirst: denialFirst,
      expectedRenumbered: { state: 'requested', seq: rows.length },
    }
    const measured = readLedger(built.dir).rows.filter((row) => row.kind === world.kind)
    const measuredFold = foldOf(measured)
    const measuredReversed = foldOf([...measured].reverse())
    world.seq.measured = { rows: measured.length, forward: measuredFold, reversed: measuredReversed, same: measuredFold.text === measuredReversed.text, malformed: measuredFold.malformed }
  } catch (error) { world.seq.error = String(error && error.message ? error.message : error) }

  // -- 9. the refusals, in one batch, with the ledger byte-compared around it --------------------
  // Need a second standing row from the same asker, so the ambiguity branch is reachable at all: the
  // asking tool writes it, because it is this ledger's own team that asks.
  world.calls.ambiguousAsk = usable(discovery.ask) ? await call(built, discovery.ask.tool, { team: TEAM_C, mode: 'absorb' }) : { ok: false, missing: true, error: 'no asking tool was discovered' }
  world.ledger.beforeRefusals = readLedger(built.dir)
  world.ledger.beforeRefusals.stamp = stamp(world.ledger.beforeRefusals)
  const answers = (args) => ({ tool: discovery.grant?.tool ?? '', args })
  const asks = (args) => ({ tool: discovery.ask?.tool ?? '', args })
  const refusalPlan = [
    { id: 'answer:no-arguments', ...answers(null), expect: 'MERGE_INPUT' },
    { id: 'answer:array', ...answers([]), expect: 'MERGE_INPUT' },
    { id: 'answer:whole-arguments-are-a-string', ...answers('no'), expect: 'MERGE_INPUT' },
    { id: 'answer:blank-from', ...answers({ from: '   ', grant: true }), expect: 'MERGE_FROM_EMPTY' },
    { id: 'answer:from-with-a-space', ...answers({ from: 'gate r183 alpha', grant: true }), expect: 'MERGE_FROM_NAME' },
    { id: 'answer:from-not-a-string', ...answers({ from: 42, grant: true }), expect: 'MERGE_FROM_NAME' },
    { id: 'answer:grant-is-not-a-boolean', ...answers({ from: TEAM_A, grant: 'yes' }), expect: 'MERGE_GRANT' },
    { id: 'answer:grant-is-missing', ...answers({ from: TEAM_A }), expect: 'MERGE_GRANT' },
    { id: 'answer:blank-team', ...answers({ from: TEAM_A, team: '   ', grant: true }), expect: 'MERGE_TEAM_EMPTY' },
    { id: 'answer:team-with-a-space', ...answers({ from: TEAM_A, team: 'gate r183 beta', grant: true }), expect: 'MERGE_TEAM_NAME' },
    { id: 'answer:no-standing-row-for-that-asker', ...answers({ from: TEAM_B, grant: true }), expect: 'MERGE_REQUEST_NONE' },
    { id: 'answer:team-names-a-party-nobody-asked-for', ...answers({ from: TEAM_A, team: TEAM_E, grant: true }), expect: 'MERGE_REQUEST_NONE' },
    { id: 'answer:two-standing-rows-and-no-team-named', ...answers({ from: TEAM_A, grant: false }), expect: 'MERGE_REQUEST_AMBIGUOUS' },
    { id: 'answer:applicant-writes-the-other-parent', ...answers({ from: TEAM_A, team: TEAM_D, grant: true }), expect: 'MERGE_NOT_AUTHORIZED' },
    { id: 'ask:no-arguments', ...asks(null), expect: 'MERGE_INPUT' },
    { id: 'ask:blank-team', ...asks({ team: '   ', mode: 'join' }), expect: 'MERGE_TEAM_EMPTY' },
    { id: 'ask:team-with-a-space', ...asks({ team: 'gate r183 beta', mode: 'join' }), expect: 'MERGE_TEAM_NAME' },
    { id: 'ask:mode-is-not-a-direction', ...asks({ team: TEAM_B, mode: 'sideways' }), expect: 'MERGE_MODE' },
    { id: 'ask:mode-is-missing', ...asks({ team: TEAM_B }), expect: 'MERGE_MODE' },
    { id: 'ask:self', ...asks({ team: TEAM_A, mode: 'join' }), expect: 'MERGE_SELF' },
    { id: 'ask:no-handshake', ...asks({ team: TEAM_E, mode: 'join' }), expect: 'MERGE_PEER_REQUIRED' },
  ]
  const builderPlan = [
    { id: 'builder:not-an-object', args: null, expect: 'MERGE_INPUT' },
    { id: 'builder:blank-from', args: { from: '', to: TEAM_B, mode: 'join', state: 'requested', by: W, at: AT }, expect: 'MERGE_FROM_EMPTY' },
    { id: 'builder:state-is-not-a-state', args: { from: TEAM_A, to: TEAM_B, mode: 'join', state: 'maybe', by: W, at: AT }, expect: 'MERGE_STATE' },
    { id: 'builder:mode-is-not-a-direction', args: { from: TEAM_A, to: TEAM_B, mode: 'sideways', state: 'requested', by: W, at: AT }, expect: 'MERGE_MODE' },
    { id: 'builder:self', args: { from: TEAM_A, to: TEAM_A, mode: 'join', state: 'requested', by: W, at: AT }, expect: 'MERGE_SELF' },
    { id: 'builder:at-is-not-a-number', args: { from: TEAM_A, to: TEAM_B, mode: 'join', state: 'requested', by: W, at: 'now' }, expect: 'MERGE_AT' },
  ]
  for (const plan of refusalPlan) {
    const outcome = await call(built, plan.tool, plan.args)
    const message = outcome.ok === true ? '' : String(outcome.error ?? '')
    world.refusals.push({ id: plan.id, tool: plan.tool, expect: plan.expect, ok: outcome.ok === false && outcome.missing !== true, threw: outcome.ok === false, errorName: outcome.name ?? null, code: firstCode(message), message: clip(message, 140) })
  }
  for (const plan of builderPlan) {
    let code = null
    let message = ''
    try { module.mergeRecord(plan.args); message = 'the builder ACCEPTED it' } catch (error) { message = String(error && error.message ? error.message : error); code = firstCode(message) }
    world.refusals.push({ id: plan.id, tool: '(mergeRecord)', expect: plan.expect, ok: code !== null, threw: true, errorName: null, code, message: clip(message, 140) })
  }
  const repeatEntry = world.refusals[0]
  const repeatOutcome = await call(built, repeatEntry.tool, refusalPlan[0].args)
  world.refusalRepeat = { id: repeatEntry.id, first: repeatEntry.code, second: firstCode(repeatOutcome.ok === true ? '' : repeatOutcome.error), sameAsFirst: false }
  world.refusalRepeat.sameAsFirst = world.refusalRepeat.second !== null && world.refusalRepeat.second === world.refusalRepeat.first
  world.ledger.afterRefusals = readLedger(built.dir)
  world.ledger.afterRefusals.stamp = stamp(world.ledger.afterRefusals)

  world.ledger.final = readLedger(built.dir)
  world.ledger.final.stamp = stamp(world.ledger.final)
  world.tree.final = nodeMap(module, world.ledger.final.rows, TEAM_IDS)
  world.mayMergeFinal = { toB: mayMergeOf(module, world.ledger.final.rows, TEAM_A, TEAM_B), fromC: mayMergeOf(module, world.ledger.final.rows, TEAM_C, TEAM_A), reverse: mayMergeOf(module, world.ledger.final.rows, TEAM_B, TEAM_A) }
  closeWorld(built)
  return { world, progress, fatal: null }
}

/** The same node map, computed over another world's own file. */
const nodesNow2 = (built, module) => {
  const ledger = readLedger(built.dir)
  return { stamp: stamp(ledger), rows: ledger.rows, nodes: nodeMap(module, ledger.rows, TEAM_IDS) }
}

// ---------------------------------------------------------------------------
// The judge: pure over the measured world, so --self-attack can mutate the world itself
// ---------------------------------------------------------------------------

const judge = (world, module) => {
  const readings = []
  const blocked = (id) => {
    const entry = (world.unmeasured ?? []).find((candidate) => candidate.id === id)
    if (entry === undefined) return false
    readings.push({ id, ok: false, unmeasured: true, detail: 'NOT MEASURED: ' + entry.reason, evidence: [] })
    return true
  }
  const add = (id, ok, detail, evidence) => readings.push({ id, ok, unmeasured: false, detail, evidence: Array.isArray(evidence) ? evidence : [] })

  // 1 ------------------------------------------------------------------------
  {
    const issues = []
    const names = world.registry?.names ?? []
    if (world.applied?.ok !== true) issues.push('apply() threw in this world: ' + show(world.applied?.error ?? null))
    if (world.ledger?.beforeSeed?.stamp?.rows !== 0) issues.push('the measured world did not start empty: control.jsonl already held ' + show(world.ledger?.beforeSeed?.stamp?.rows) + ' row(s)')
    if ((world.ledger?.seeded?.stamp?.rows ?? 0) <= 0) issues.push('the gate\'s own seed did not land: control.jsonl holds ' + show(world.ledger?.seeded?.stamp?.rows) + ' row(s) after seeding')
    const writers = world.discovery?.writers ?? []
    const ask = world.discovery?.ask ?? null
    const grant = world.discovery?.grant ?? null
    const deny = world.discovery?.deny ?? null
    if (writers.length !== 2) issues.push('the round promises exactly TWO merge tools (ask / answer); ' + String(writers.length) + ' name(s) appended a ' + show(world.kind) + ' row: ' + show(writers))
    if (ask === null) issues.push('no tool wrote state=requested, so the asking tool is missing from the face')
    if (grant === null) issues.push('no tool wrote state=granted, so no tool can answer with an agreement')
    if (deny === null) issues.push('no tool wrote state=denied, so a refusal cannot be answered for')
    if (ask !== null && grant !== null && ask.tool !== grant.tool) {
      // The two ends of the act must be two names: one tool wearing both hats would mean the asking
      // side can answer itself.
    } else if (ask !== null && grant !== null) {
      issues.push('the asking tool and the answering tool are the same name ' + show(ask.tool) + ': one tool cannot ask for a merge and grant it')
    }
    const overloaded = writers.filter((name) => EARLIER_FACE.includes(name))
    if (overloaded.length > 0) issues.push('a name an earlier round already shipped wrote the merge too: ' + show(overloaded))
    const usable = world.discovery?.usable ?? { ask: false, grant: false, deny: false }
    if (usable.ask !== true || usable.grant !== true || usable.deny !== true) issues.push('the tools discovered by behaviour are not all registered in the measured world: ' + show(usable))
    if (world.record?.present === true) {
      for (const entry of [ask, grant]) if (entry !== null && String(world.record.text ?? '').includes(entry.tool) === false) issues.push('the producer\'s record ' + world.record.path + ' does not mention ' + show(entry.tool) + ', a tool the registry really registered')
    }
    add(READING_IDS[0], issues.length === 0,
      issues.length === 0
        ? 'the face holds ' + String(names.length) + ' tool(s) and exactly two of them appended ' + show(world.kind) + ': ' + show(ask.tool) + ' wrote requested, ' + show(grant.tool) + ' wrote granted and denied'
        : issues.join(' | '),
      [
        'registry: ' + show(names) + ' | linkCollab.tools.names: ' + show(world.collabNames ?? null),
        'discovered: ' + show((world.discovery?.successes ?? []).map((entry) => entry.tool + ' ' + entry.shape + ' -> ' + entry.state + ' (gained ' + String(entry.gained) + ' row(s): ' + entry.kinds.join('+') + ')')),
        'producer record: ' + (world.record?.present === true ? world.record.path + ' (present)' : show(world.record?.path ?? null) + ' (absent: the pair was discovered by behaviour alone)'),
      ])
  }

  // 2 ------------------------------------------------------------------------
  if (blocked(READING_IDS[1]) === false) {
    const issues = []
    const request = world.request ?? {}
    const row = request.row ?? null
    if (request.returnedError !== null && request.returnedError !== undefined) issues.push('the asking tool did not answer: ' + show(request.returnedError))
    if (request.gained !== 1) issues.push('the call added ' + show(request.gained) + ' row(s) to control.jsonl, not one')
    if (row === null) issues.push('no row was there to inspect')
    else {
      if (row.kind !== world.kind) issues.push('the row is kind ' + show(row.kind) + ', not ' + show(world.kind))
      if (row.subject !== TEAM_A) issues.push('the row\'s subject is ' + show(row.subject) + ' while the asking team is ' + show(TEAM_A) + ' (the record is about the team that asked)')
      const payload = row.payload ?? {}
      if (payload.from !== TEAM_A) issues.push('payload.from is ' + show(payload.from) + ', not ' + show(TEAM_A))
      if (payload.to !== TEAM_B) issues.push('payload.to is ' + show(payload.to) + ', not ' + show(TEAM_B) + ': the call named team ' + show(TEAM_B))
      if (payload.mode !== 'join') issues.push('payload.mode is ' + show(payload.mode) + ', not the direction the caller named (' + show('join') + ')')
      if (payload.state !== 'requested') issues.push('payload.state is ' + show(payload.state) + ', not ' + show('requested') + ': a request is not a permission')
      if (payload.by !== world.registry?.logWriter) issues.push('payload.by is ' + show(payload.by) + ' while this ledger\'s writer is ' + show(world.registry?.logWriter ?? null))
      if (typeof payload.at !== 'number' || Number.isFinite(payload.at) !== true) issues.push('payload.at is ' + show(payload.at ?? null) + ', not the finite instant the row carries')
      const builder = request.builder
      if (builder === null) issues.push('the shipped builder was never asked what the same six fields build')
      else if (builder.threw !== undefined) issues.push('the shipped builder threw on the row the tool just wrote: ' + show(builder.threw))
      else {
        if (builder.kind !== row.kind) issues.push('the row is kind ' + show(row.kind) + ' while the shipped builder builds ' + show(builder.kind))
        if (builder.subject !== row.subject) issues.push('the row\'s subject is ' + show(row.subject) + ' while the shipped builder builds ' + show(builder.subject))
        if (same(builder.payload, row.payload) !== true) issues.push('the row\'s payload ' + show(row.payload) + ' is not the payload the shipped builder builds for the same fields: ' + show(builder.payload))
      }
    }
    const returned = request.returned
    if (returned === null || returned === undefined) issues.push('the asking tool returned nothing usable')
    else {
      if (row !== null && returned.seq !== row.seq) issues.push('the answer carries seq ' + show(returned.seq) + ' while the file row is seq ' + show(row?.seq ?? null))
      // Every field the answer carries must be the row's own: seq above, and the eight facts below.
      const expected = row === null ? null : { kind: row.kind, subject: row.subject, from: row.payload?.from, to: row.payload?.to, mode: row.payload?.mode, state: row.payload?.state, by: row.payload?.by, at: row.payload?.at }
      const wrong = expected === null ? [] : Object.keys(expected).filter((key) => same(returned[key], expected[key]) === false)
      if (wrong.length > 0) issues.push('the value the tool returned disagrees with the row it wrote about ' + show(wrong) + ': it says ' + show(wrong.map((key) => [key, returned[key]])) + ' while the row says ' + show(wrong.map((key) => [key, expected[key]])))
      if (returned.mayExchange !== true) issues.push('the request row does not carry a granted handshake, yet the answer says mayExchange=' + show(returned.mayExchange ?? null) + ' (the seeded handshake is ' + show(TEAM_A + ' -> ' + TEAM_B) + ')')
      if (returned.mayMerge !== false) issues.push('a REQUEST already reads as a merge: mayMerge answered ' + show(returned.mayMerge ?? null))
    }
    const fold = request.fold ?? {}
    if (fold.fold?.ok !== true) issues.push('the fold threw over the bytes the tool just wrote: ' + show(fold.fold?.error ?? null))
    else {
      const pairs = fold.fold.pairs ?? []
      if (pairs.length !== 1) issues.push('after one request the table holds ' + show(pairs.length) + ' row(s), not one')
      else if (pairs[0].state !== 'requested' || pairs[0].from !== TEAM_A || pairs[0].to !== TEAM_B || pairs[0].mode !== 'join') issues.push('the table says ' + show(pairs[0]) + ', not one requested join from ' + show(TEAM_A) + ' to ' + show(TEAM_B))
    }
    if (request.mayMerge !== false) issues.push('mayMerge is ' + show(request.mayMerge ?? null) + ' after a request alone')
    if (request.mayExchange !== true) issues.push('mayExchange is ' + show(request.mayExchange ?? null) + ' although the seeded handshake is granted')
    const moved = changedBetween(world.tree?.afterSeed?.nodes, request.tree)
    if (moved.length > 0) issues.push('the request moved the tree: ' + show(moved.map((id) => [id, request.tree?.map?.[id] ?? null])))
    add(READING_IDS[1], issues.length === 0,
      issues.length === 0
        ? 'one call appended exactly one row - seq ' + show(row.seq) + ', subject ' + show(row.subject) + ', payload ' + show(row.payload) + ' - which is byte for byte what the shipped builder builds for those six fields, the returned value carries that seq and those same values (mayExchange ' + show(request.returned?.mayExchange) + ', mayMerge ' + show(request.returned?.mayMerge) + '), and the tree did not move'
        : issues.join(' | '),
      ['the row: ' + show(row), 'the answer: ' + clip(JSON.stringify(request.returned ?? null), 220), 'the shipped builder for the same fields: ' + clip(JSON.stringify(request.builder ?? null), 220), 'the fold: ' + clip(fold.fold?.text, 160)])
  }

  // 3 ------------------------------------------------------------------------
  if (blocked(READING_IDS[2]) === false) {
    const issues = []
    const denial = world.denial ?? {}
    const grant = world.joinGrant ?? {}
    if (denial.returnedError !== null && denial.returnedError !== undefined) issues.push('the denying call did not answer: ' + show(denial.returnedError))
    if (denial.gained !== 1) issues.push('grant:false added ' + show(denial.gained) + ' row(s), not exactly one')
    if ((denial.rows ?? []).some((row) => row.kind !== world.kind)) issues.push('grant:false wrote something that is not a ' + show(world.kind) + ' row: ' + show((denial.rows ?? []).map((row) => row.kind)))
    const denied = (denial.rows ?? [])[0] ?? null
    if (denied !== null) {
      if (denied.payload?.state !== 'denied') issues.push('the single row grant:false wrote is state ' + show(denied.payload?.state ?? null) + ', not denied')
      if (denied.payload?.mode !== 'join' || denied.payload?.from !== TEAM_A || denied.payload?.to !== TEAM_B) issues.push('the denial answers a different pair than the request: ' + show(denied.payload))
      if (denied.subject !== TEAM_A) issues.push('the denial\'s subject is ' + show(denied.subject) + ', not the asking team ' + show(TEAM_A))
    }
    if (denial.returned?.state !== 'denied') issues.push('grant:false answered ' + show(denial.returned?.state ?? null) + ', not denied')
    if (denial.returned !== null && denial.returned !== undefined && 'treeSeq' in denial.returned) issues.push('grant:false reported treeSeq ' + show(denial.returned.treeSeq) + ': a denial writes no tree row')
    const movedByDenial = changedBetween(world.request?.tree, denial.tree)
    if (movedByDenial.length > 0) issues.push('a denial moved the tree: ' + show(movedByDenial))
    if (grant.returnedError !== null && grant.returnedError !== undefined) issues.push('the granting call did not answer: ' + show(grant.returnedError))
    if (grant.gained !== 2) issues.push('grant:true on a mode=join request added ' + show(grant.gained) + ' row(s), not exactly two (the party\'s own team/state and the authorization)')
    const rows = grant.rows ?? []
    if (rows.length >= 1) {
      if (rows[0].kind !== world.discovery?.teamKind) issues.push('the first row of a grant is ' + show(rows[0].kind) + ', not the party\'s own ' + show(world.discovery?.teamKind))
      if (rows[0].subject !== TEAM_A) issues.push('the tree row written by the grant is about ' + show(rows[0].subject) + ', while the party being merged in is ' + show(TEAM_A))
      if (rows[0].payload?.parent !== TEAM_B) issues.push('the tree row\'s parent is ' + show(rows[0].payload?.parent ?? null) + ', not the team that took it in (' + show(TEAM_B) + ')')
      if (rows[0].payload?.lead !== world.registry?.logWriter) issues.push('the tree row written by the grant lost the team\'s own lead: it says ' + show(rows[0].payload?.lead ?? null) + ' while the ledger\'s writer is ' + show(world.registry?.logWriter ?? null))
    }
    if (rows.length >= 2) {
      if (rows[1].kind !== world.kind) issues.push('the second row of a grant is ' + show(rows[1].kind) + ', not ' + show(world.kind))
      if (rows[1].payload?.state !== 'granted') issues.push('the second row of a grant is state ' + show(rows[1].payload?.state ?? null) + ', not granted')
      if (rows[1].subject !== TEAM_A) issues.push('the authorization\'s subject is ' + show(rows[1].subject) + ', not the asking team ' + show(TEAM_A))
    }
    if (rows.length > 2) issues.push('a grant wrote ' + show(rows.length) + ' rows: ' + show(rows.map((row) => row.kind)))
    const returned = grant.returned
    if (returned === null || returned === undefined) issues.push('the granting tool returned nothing usable')
    else {
      if (rows.length >= 1 && returned.treeSeq !== rows[0].seq) issues.push('the grant reported treeSeq ' + show(returned.treeSeq ?? null) + ' while the tree row it wrote is seq ' + show(rows[0].seq))
      if (rows.length >= 2 && returned.seq !== rows[1].seq) issues.push('the grant reported seq ' + show(returned.seq ?? null) + ' while the authorization it wrote is seq ' + show(rows[1].seq))
      if (rows.length >= 1 && returned.treeTeam !== TEAM_A) issues.push('the grant reported treeTeam ' + show(returned.treeTeam ?? null) + ', not the party being merged in (' + show(TEAM_A) + ')')
      if (rows.length >= 1 && returned.treeParent !== TEAM_B) issues.push('the grant reported treeParent ' + show(returned.treeParent ?? null) + ', not the team that took it in (' + show(TEAM_B) + ')')
      if (returned.state !== 'granted') issues.push('the grant answered ' + show(returned.state ?? null) + ', not granted')
      if (returned.mayMerge !== true) issues.push('after the agreement mayMerge reads ' + show(returned.mayMerge ?? null) + ', not true')
    }
    if (world.counts?.fileMergeRows !== world.counts?.foldHistory) issues.push('the fold\'s history holds ' + show(world.counts?.foldHistory) + ' row(s) while the gate counted ' + show(world.counts?.fileMergeRows) + ' ' + show(world.kind) + ' row(s) in the file')
    if (world.joinGrant?.fold?.malformed !== 0) issues.push('the fold counted ' + show(world.joinGrant?.fold?.malformed) + ' malformed merge row(s) after the tools wrote them')
    add(READING_IDS[2], issues.length === 0,
      issues.length === 0
        ? 'grant:false added exactly ONE row [' + show((denial.rows ?? []).map((row) => row.kind + '/' + show(row.payload?.state))) + '] and wrote no tree row; grant:true on a join request added exactly TWO rows in one call [' + show(rows.map((row) => row.kind)) + '] - the answering party\'s own team/state (parent ' + show(rows[0]?.payload?.parent ?? null) + ', lead kept ' + show(rows[0]?.payload?.lead ?? null) + ') then the authorization (seq ' + show(rows[1]?.seq ?? null) + ') - and no third row'
        : issues.join(' | '),
      ['the denial batch: ' + show((denial.rows ?? []).map((row) => ({ seq: row.seq, kind: row.kind, subject: row.subject, payload: row.payload }))), 'the grant batch: ' + show(rows.map((row) => ({ seq: row.seq, kind: row.kind, subject: row.subject, payload: row.payload }))), 'the grant value: ' + clip(JSON.stringify(returned ?? null), 200), 'the tree after the grant: ' + clip(grant.tree?.text, 200)])
  }

  // 4 ------------------------------------------------------------------------
  if (blocked(READING_IDS[3]) === false) {
    const issues = []
    const direction = world.direction ?? {}
    const pair = world.pair ?? {}
    const row = world.absorbAsk?.row ?? null
    // (a) the honest absorb inside the measured world: the writer's own team was the party merged in
    if (direction.returnedError !== null && direction.returnedError !== undefined) issues.push('the honest absorb answer did not answer: ' + show(direction.returnedError))
    if (direction.gained !== 2) issues.push('answering a standing absorb request with grant:true added ' + show(direction.gained) + ' row(s), not two')
    if (show(direction.rowsWrittenTeams ?? null) !== show([TEAM_A])) issues.push('the absorb grant wrote the team/state of ' + show(direction.rowsWrittenTeams ?? null) + ' while the party being merged in is ' + show([TEAM_A]) + ': a merge writes the merged-in party\'s own parent and nobody else\'s')
    if ((direction.rows ?? [])[0]?.kind !== world.discovery?.teamKind) issues.push('the first row of the absorb grant is ' + show((direction.rows ?? [])[0]?.kind ?? null) + ', not the merged-in party\'s own ' + show(world.discovery?.teamKind))
    if ((direction.rows ?? [])[0]?.payload?.parent !== TEAM_C) issues.push('the honest absorb wrote parent ' + show((direction.rows ?? [])[0]?.payload?.parent ?? null) + ', not the asking team (' + show(TEAM_C) + ')')
    if (direction.absorbEdge?.rowTeam !== TEAM_A || direction.absorbEdge?.rowParent !== TEAM_C) issues.push('the row the absorb wrote is ' + show([direction.absorbEdge?.rowTeam ?? null, direction.absorbEdge?.rowParent ?? null]) + ' while absorb freezes the ANSWERED team (' + show(TEAM_A) + ') as the child of the asking team (' + show(TEAM_C) + ')')
    if (direction.returned?.treeTeam !== TEAM_A || direction.returned?.treeParent !== TEAM_C) issues.push('the absorb answered treeTeam/treeParent ' + show([direction.returned?.treeTeam ?? null, direction.returned?.treeParent ?? null]) + ', not the party being merged in and the team taking it in (' + show([TEAM_A, TEAM_C]) + ')')
    if (direction.mayMergeAbsorb !== true) issues.push('mayMerge(' + TEAM_C + ' -> ' + TEAM_A + ') reads ' + show(direction.mayMergeAbsorb) + ' after that pair was granted')
    // (b) the frozen directions at the FOLD, on a node with no earlier claim: join makes the ASKING
    // team the child of the team it named, absorb makes the ANSWERED team the child of the asker.
    if (direction.joinEdge?.asker !== TEAM_A || direction.joinEdge?.named !== TEAM_B) issues.push('the join measured here is not an asking team naming another: ' + show([direction.joinEdge?.asker ?? null, direction.joinEdge?.named ?? null]))
    if (direction.joinEdge?.parentAfter !== TEAM_B) issues.push('after the join the asking team\'s folded parent reads ' + show(direction.joinEdge?.parentAfter ?? null) + ', not the team it named (' + show(TEAM_B) + ')')
    const landing = pair.owner ?? {}
    if (landing.ok !== true) issues.push('the SAME fact answered by the party being merged in\'s own lead was refused: ' + show(landing.error ?? null))
    if (landing.gained !== 2) issues.push('the honest paired landing wrote ' + show(landing.gained) + ' row(s), not two')
    if ((landing.rows ?? [])[0]?.kind !== world.discovery?.teamKind) issues.push('the honest paired landing\'s first row is ' + show((landing.rows ?? [])[0]?.kind ?? null) + ', not the merged-in party\'s own team/state')
    if ((landing.rows ?? [])[0]?.subject !== TEAM_D) issues.push('the honest paired landing wrote the tree row of ' + show((landing.rows ?? [])[0]?.subject ?? null) + ', not of the party being merged in (' + show(TEAM_D) + ')')
    if ((landing.rows ?? [])[0]?.payload?.parent !== TEAM_A) issues.push('the honest paired landing wrote parent ' + show((landing.rows ?? [])[0]?.payload?.parent ?? null) + ', not the asking team (' + show(TEAM_A) + ')')
    if ((landing.rows ?? [])[1]?.payload?.state !== 'granted') issues.push('the honest paired landing\'s second row is ' + show((landing.rows ?? [])[1]?.payload?.state ?? null) + ', not granted')
    if (show(landing.moved ?? null) !== show([TEAM_D])) issues.push('the honest paired landing moved ' + show(landing.moved ?? null) + ' node(s); absorb takes the ANSWERED team in, so exactly ' + show([TEAM_D]) + ' moves')
    if (landing.answeredPartyParent !== TEAM_A) issues.push('after the landing the answered party\'s folded parent reads ' + show(landing.answeredPartyParent ?? null) + ', not the asking team (' + show(TEAM_A) + ')')
    if (landing.stampMoved !== true) issues.push('the honest paired landing did not move its ledger')
    // Only the party being merged in may move: anything else that changed is a second writer of a tree.
    const outsideJoin = (world.tree?.movedByJoin ?? []).filter((id) => id !== TEAM_A)
    if (outsideJoin.length > 0) issues.push('the join grant moved ' + show(outsideJoin) + ', which nobody asked to take in or be taken in by')
    const outsideAbsorb = (world.tree?.movedByAbsorb ?? []).filter((id) => id !== TEAM_A)
    if (outsideAbsorb.length > 0) issues.push('the absorb grant moved ' + show(outsideAbsorb) + ', which nobody asked to take in or be taken in by')
    // (c) the applicant offering to write the other side's parent, named, ledger and tree unmoved
    const wrong = world.wrongWriter ?? {}
    if (wrong.threw !== true) issues.push('the applicant\'s offer to write the other side\'s parent was NOT refused: ' + show(wrong.message ?? null))
    if (wrong.code !== 'MERGE_NOT_AUTHORIZED') issues.push('that refusal is named ' + show(wrong.code ?? null) + ', not MERGE_NOT_AUTHORIZED: ' + clip(wrong.message, 120))
    if (wrong.bytesSame !== true) issues.push('the refusal moved control.jsonl: sha256/bytes/rows changed across it')
    if (wrong.treeSame !== true) issues.push('the refusal moved the tree fold')
    // (d) the SAME fact in three ledgers
    if (pair.error !== null && pair.error !== undefined) issues.push('a paired world threw: ' + show(pair.error))
    if (pair.sameFact?.allSame !== true) issues.push('the three ledgers did not hold the same fact: ' + clip(JSON.stringify(pair.sameFact ?? null), 240))
    const un = pair.uninvolved ?? {}
    if (un.refusalUnnamed?.threw !== true || un.refusalUnnamed?.code !== 'MERGE_NOT_AUTHORIZED') issues.push('the unnamed answer by a writer that does not lead the party being merged in answered ' + show(un.refusalUnnamed?.code ?? null) + ' instead of MERGE_NOT_AUTHORIZED')
    if (un.refusalUnnamed?.bytesSame !== true) issues.push('that unnamed refusal moved the paired world\'s ledger')
    if (un.refusalNamed?.threw !== true || un.refusalNamed?.code !== 'MERGE_NOT_AUTHORIZED') issues.push('the named answer by a writer that does not lead that party answered ' + show(un.refusalNamed?.code ?? null) + ' instead of MERGE_NOT_AUTHORIZED')
    if (un.refusalNamed?.bytesSame !== true) issues.push('that named refusal moved the paired world\'s ledger')
    if (un.refusalNamed?.treeSame !== true) issues.push('that named refusal moved the paired world\'s tree fold')
    if (row !== null && (row.kind !== world.kind || row.payload?.mode !== 'absorb' || row.payload?.to !== TEAM_D)) issues.push('the applicant\'s own request is ' + show(row) + ', not an absorb request naming ' + show(TEAM_D))
    add(READING_IDS[3], issues.length === 0,
      issues.length === 0
        ? 'join made the asking team ' + show(TEAM_A) + ' the child of the team it named (' + show(direction.joinEdge?.parentAfter ?? null) + '); absorb wrote the ANSWERED party\'s own row (' + show(direction.absorbEdge?.rowTeam ?? null) + ', parent ' + show(direction.absorbEdge?.rowParent ?? null) + ') and, where the arbiter had no earlier claim, moved exactly ' + show(landing.moved ?? null) + ' with parent ' + show(landing.answeredPartyParent ?? null) + '; the applicant offering to write ' + show(TEAM_D) + '\'s parent was refused ' + show(wrong.code) + ' with control.jsonl byte-identical, and the same fact was refused twice in a world whose writer leads elsewhere before landing two rows in a world whose writer leads the party being merged in'
        : issues.join(' | '),
      [
        'join: asker ' + show(TEAM_A) + ' named ' + show(TEAM_B) + ' -> row ' + show([direction.joinEdge?.rowTeam ?? null, direction.joinEdge?.rowParent ?? null]) + ', folded parent ' + show(direction.joinEdge?.parentAfter ?? null) + ', nodes moved ' + show(world.tree?.movedByJoin ?? null),
        'absorb: asker ' + show(TEAM_C) + ' took ' + show(TEAM_A) + ' in -> row ' + show([direction.absorbEdge?.rowTeam ?? null, direction.absorbEdge?.rowParent ?? null]) + ', nodes moved outside the merged-in party ' + show((world.tree?.movedByAbsorb ?? []).filter((id) => id !== TEAM_A)) + '; the folded value there is ' + show(direction.absorbEdge?.foldedAfter ?? null) + ' because a SECOND non-null claim for one node is the tree arbiter\'s question (R98), not the merge\'s - the row it wrote is the merge\'s answer',
        'the applicant\'s refusal: ' + show(wrong.code) + ' ' + clip(wrong.message, 120),
        'the same fact in three ledgers: ' + clip(JSON.stringify(pair.sameFact?.measured ?? null), 200),
        'the three writers: this world ' + show(world.registry?.logWriter ?? null) + ' (leads ' + show(TEAM_A) + '), uninvolved ' + show(un?.writer ?? null) + ' (leads ' + show(TEAM_B) + '), owner ' + show(landing.writer ?? null) + ' (leads ' + show(TEAM_D) + ')',
      ])
  }

  // 5 ------------------------------------------------------------------------
  if (blocked(READING_IDS[4]) === false) {
    const issues = []
    const bare = world.handshake?.bareAsk ?? {}
    const revoked = world.handshake?.revoked ?? {}
    if (world.handshake?.error !== undefined) issues.push('the handshake world threw: ' + show(world.handshake.error))
    if (bare.threw !== true) issues.push('asking a team with no handshake was NOT refused')
    if (bare.code !== 'MERGE_PEER_REQUIRED') issues.push('the no-handshake ask was refused as ' + show(bare.code ?? null) + ', not MERGE_PEER_REQUIRED')
    if (bare.bytesSame !== true) issues.push('the no-handshake refusal moved control.jsonl')
    if (revoked.asked !== true) issues.push('the handshake world could not write the legitimate request first: the reading would prove nothing')
    if (revoked.standingRequest === null || revoked.standingRequest === undefined) issues.push('no standing request was in the handshake world\'s ledger when the answer was refused')
    else {
      if (revoked.standingRequest.state !== 'requested') issues.push('the standing row is ' + show(revoked.standingRequest.state) + ', not a request')
      if (revoked.standingRequest.from !== TEAM_A || revoked.standingRequest.to !== TEAM_B) issues.push('the standing request is about ' + show(revoked.standingRequest.from) + ' -> ' + show(revoked.standingRequest.to) + ', not the pair the gate asked about')
    }
    if (revoked.mayExchangeBefore !== false) issues.push('the handshake still reads granted (' + show(revoked.mayExchangeBefore) + ') at the moment of the refusal, so mayExchange is not what refused it')
    if (revoked.threw !== true) issues.push('the answer to a standing request whose handshake was revoked was NOT refused: ' + show(revoked.message ?? null))
    if (revoked.code !== 'MERGE_PEER_REQUIRED') issues.push('that refusal is named ' + show(revoked.code ?? null) + ', not MERGE_PEER_REQUIRED')
    if (revoked.bytesSame !== true) issues.push('that refusal moved the handshake world\'s ledger (sha256/bytes/rows)')
    if (revoked.treeSame !== true) issues.push('that refusal moved the handshake world\'s tree fold')
    add(READING_IDS[4], issues.length === 0,
      issues.length === 0
        ? 'a team with no handshake was refused ' + show(bare.code) + ' without moving the file; and a request that was legitimate when written, whose handshake was revoked afterwards, was refused ' + show(revoked.code) + ' with the standing request (' + show(revoked.standingRequest) + ') and mayExchange ' + show(revoked.mayExchangeBefore) + ' right there in the ledger - the merge asks, it does not re-derive'
        : issues.join(' | '),
      ['bare ask: ' + show(bare.code) + ' ' + clip(bare.message, 120), 'revoked handshake: ' + show(revoked.code) + ' ' + clip(revoked.message, 160), 'the standing request the fold held at that moment: ' + show(revoked.standingRequest ?? null)])
  }

  // 6 ------------------------------------------------------------------------
  {
    const issues = []
    const seq = world.seq ?? {}
    if (seq.error !== null && seq.error !== undefined) issues.push('the three-row ledger this gate writes could not be built: ' + show(seq.error))
    const three = seq.three ?? {}
    if (three.rows !== 3) issues.push('the gate\'s own ledger holds ' + show(three.rows) + ' merge row(s), not three')
    if (three.allSame !== true) issues.push('the same three records folded in three arrival orders answered different tables: ' + clip(three.original?.text, 100) + ' / ' + clip(three.reversed?.text, 100) + ' / ' + clip(three.rotated?.text, 100))
    if ((three.original?.history ?? []).length !== 3) issues.push('the fold\'s history holds ' + show((three.original?.history ?? []).length) + ' row(s), not all three: a round that clears a grant is part of what happened')
    const winner = (three.original?.pairs ?? [])[0] ?? null
    if (winner === null || winner.state !== 'denied') issues.push('the highest seq of the three rows is the denial, yet the fold answered ' + show(winner?.state ?? null))
    if (three.minusDeny?.pairs?.[0]?.state !== 'granted') issues.push('dropping the denial left the pair as ' + show(three.minusDeny?.pairs?.[0]?.state ?? null) + ', not granted')
    if (three.onlyRequest?.pairs?.[0]?.state !== 'requested') issues.push('dropping both answers left the pair as ' + show(three.onlyRequest?.pairs?.[0]?.state ?? null) + ', not requested')
    const renumbered = (three.renumberedDenialFirst?.pairs ?? [])[0] ?? null
    if (renumbered === null || renumbered.state !== three.expectedRenumbered?.state) issues.push('with the same three rows renumbered so the DENIAL carries the lowest seq, the fold answered ' + show(renumbered?.state ?? null) + ' instead of ' + show(three.expectedRenumbered?.state ?? null) + ': the winner is not decided by seq')
    if (renumbered !== null && renumbered.seq !== three.expectedRenumbered?.seq) issues.push('the renumbered fold kept seq ' + show(renumbered.seq) + ' instead of the highest ' + show(three.expectedRenumbered?.seq))
    const measured = seq.measured ?? {}
    if (measured.rows === 0) issues.push('the measured world held no merge row to fold, so the arrangement could not be tested on what the tools wrote')
    if (measured.same !== true) issues.push('the rows the tools really wrote answered different tables in two arrangements: ' + clip(measured.forward?.text, 100) + ' vs ' + clip(measured.reversed?.text, 100))
    if (measured.malformed !== 0) issues.push('folding the measured world\'s rows counted ' + show(measured.malformed) + ' malformed merge row(s)')
    add(READING_IDS[5], issues.length === 0,
      issues.length === 0
        ? 'three rows of one ordered pair folded in three arrival orders answer the same table byte for byte (history keeps all three); dropping the denial gives granted, dropping both answers gives requested; renumbering the same rows so the denial is FIRST makes the fold answer ' + show(renumbered.state) + ' at seq ' + show(renumbered.seq) + ' - the highest seq decides, not the word; and the ' + show(measured.rows) + ' row(s) the tools wrote fold the same way in either arrangement'
        : issues.join(' | '),
      ['original: ' + clip(three.original?.text, 160), 'reversed: ' + clip(three.reversed?.text, 160), 'the same rows with the denial first by seq: ' + clip(three.renumberedDenialFirst?.text, 160), 'the measured world\'s own rows forward/reversed: ' + clip(measured.forward?.text, 120) + ' / ' + clip(measured.reversed?.text, 120)])
  }

  // 7 ------------------------------------------------------------------------
  if (blocked(READING_IDS[6]) === false) {
    const issues = []
    const refusals = world.refusals ?? []
    if (refusals.length === 0) issues.push('the refusal batch was never driven, so nothing was measured')
    const notRefused = refusals.filter((entry) => entry.ok !== true)
    if (notRefused.length > 0) issues.push(String(notRefused.length) + ' malformed call(s) were not refused: ' + show(notRefused.map((entry) => entry.id)))
    const foreign = refusals.filter((entry) => entry.ok === true && (typeof entry.code !== 'string' || entry.code.startsWith('MERGE_') !== true))
    if (foreign.length > 0) issues.push(String(foreign.length) + ' refusal(s) did not lead with this family\'s own MERGE_* name: ' + show(foreign.map((entry) => entry.id + ' -> ' + clip(entry.message, 60))))
    const observed = [...new Set(refusals.map((entry) => entry.code).filter((code) => typeof code === 'string'))].sort()
    const missing = REQUIRED_CODES.filter((code) => observed.includes(code) === false)
    if (missing.length > 0) issues.push('the required refusals were never observed: ' + show(missing) + ' (observed ' + show(observed) + ')')
    if (world.alreadyGranted?.threw !== true || world.alreadyGranted?.code !== 'MERGE_ALREADY_GRANTED') issues.push('a second request against a pair the ledger already holds as granted answered ' + show(world.alreadyGranted?.code ?? null) + ' instead of MERGE_ALREADY_GRANTED: the request would clear the agreement the fold keeps (' + clip(world.alreadyGranted?.message ?? null, 100) + ')')
    if (world.alreadyGranted?.bytesSame !== true) issues.push('that refusal moved control.jsonl')
    if (world.twoTeams?.threw !== true || world.twoTeams?.code !== 'MERGE_LOCAL_TEAM') issues.push('a writer that leads two teams asked on their behalf and answered ' + show(world.twoTeams?.code ?? null) + ' instead of MERGE_LOCAL_TEAM: a request comes from ONE team (' + clip(world.twoTeams?.message ?? null, 100) + ')')
    if (world.twoTeams?.bytesSame !== true) issues.push('the two-teams refusal moved its world\'s ledger')
    if (world.refusalRepeat?.sameAsFirst !== true) issues.push('the same malformed call answered ' + show(world.refusalRepeat?.second ?? null) + ' the second time and ' + show(world.refusalRepeat?.first ?? null) + ' the first')
    const before = world.ledger?.beforeRefusals?.stamp ?? {}
    const after = world.ledger?.afterRefusals?.stamp ?? {}
    if (stampSame(before, after) !== true) issues.push('the ledger moved across the refusal batch: sha256 ' + clip(show(before.sha256), 16) + ' -> ' + clip(show(after.sha256), 16) + ', ' + show(before.bytes) + ' -> ' + show(after.bytes) + ' bytes, ' + show(before.rows) + ' -> ' + show(after.rows) + ' rows')
    add(READING_IDS[6], issues.length === 0,
      issues.length === 0
        ? String(refusals.length) + ' malformed calls, every one refused with a MERGE_* rule name leading the message (' + show(observed) + '), the required ' + String(REQUIRED_CODES.length) + ' all observed, the same call twice answering the same name, and control.jsonl byte-identical across the batch (' + show(before.bytes) + ' B, ' + show(before.rows) + ' rows, sha256 ' + clip(show(before.sha256), 12) + ')'
        : issues.join(' | '),
      refusals.slice(0, 12).map((entry) => entry.id + ' -> expected ' + show(entry.expect) + ', got ' + show(entry.code) + ' ' + clip(entry.message, 80))
        .concat(['(' + String(Math.max(0, refusals.length - 12)) + ' further refusal(s) in the same batch are kept in the world dump; run with --keep to see the temp directories)'])
        .concat(['a second request against a pair the ledger holds as granted -> ' + show(world.alreadyGranted?.code ?? null) + ' ' + clip(world.alreadyGranted?.message ?? null, 90)])
        .concat(['a writer that leads two teams -> ' + show(world.twoTeams?.code ?? null) + ' ' + clip(world.twoTeams?.message ?? null, 90)]))
  }

  return readings
}

// ---------------------------------------------------------------------------
// The self-attack: mutate the MEASURED world, one reading per mutant
// ---------------------------------------------------------------------------

const mutants = (world) => {
  const clone = () => structuredClone(world)
  const list = [
    { name: 'a-third-tool-appends-a-merge-row', mustRedden: [READING_IDS[0]],
      world: (() => { const next = clone(); next.discovery.writers = [...next.discovery.writers, 'team_reclaim_task'].sort(); next.discovery.successes = next.discovery.successes.concat([{ tool: 'team_reclaim_task', shape: 'declared-schema', state: 'requested', gained: 1, kinds: [next.kind], subject: 'x' }]); return next })() },
    { name: 'the-asking-tool-answers-a-seq-the-file-does-not-carry', mustRedden: [READING_IDS[1]],
      world: (() => { const next = clone(); next.request.returned.seq = (next.request.row?.seq ?? 0) + 1; return next })() },
    { name: 'the-request-row-names-a-team-nobody-asked', mustRedden: [READING_IDS[1]],
      world: (() => { const next = clone(); next.request.row.payload.to = TEAM_C; return next })() },
    { name: 'a-denial-forgets-its-own-row-count', mustRedden: [READING_IDS[2]],
      world: (() => { const next = clone(); next.denial.gained = 2; next.denial.rows = next.denial.rows.concat([{ seq: 99, kind: next.kind, subject: TEAM_A, payload: { from: TEAM_A, to: TEAM_B, mode: 'join', state: 'denied', by: 'local', at: 1 } }]); return next })() },
    { name: 'a-grant-writes-the-authorization-alone', mustRedden: [READING_IDS[2]],
      world: (() => { const next = clone(); next.joinGrant.rows = next.joinGrant.rows.slice(1); next.joinGrant.gained = 1; return next })() },
    { name: 'a-grant-writes-a-third-row', mustRedden: [READING_IDS[2]],
      world: (() => { const next = clone(); next.joinGrant.rows = next.joinGrant.rows.concat([{ seq: 98, kind: next.kind, subject: TEAM_A, payload: { from: TEAM_A, to: TEAM_B, mode: 'join', state: 'granted', by: 'local', at: 1 } }]); next.joinGrant.gained = 3; return next })() },
    { name: 'the-applicant-writes-the-other-sides-parent', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.wrongWriter.code = null; next.wrongWriter.threw = false; return next })() },
    { name: 'a-refused-answer-still-appends', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.wrongWriter.bytesSame = false; return next })() },
    { name: 'absorb-writes-the-askers-parent-instead-of-the-answered-party', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.direction.rowsWrittenTeams = [TEAM_C]; next.direction.rows[0].subject = TEAM_C; next.direction.absorbEdge.rowTeam = TEAM_C; return next })() },
    { name: 'absorb-names-the-wrong-team-as-the-parent', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.direction.absorbEdge.rowParent = TEAM_A; return next })() },
    { name: 'join-makes-the-wrong-team-the-child', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.direction.joinEdge.parentAfter = TEAM_C; return next })() },
    { name: 'the-same-fact-does-not-land-for-the-party-being-merged-in', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.pair.owner.gained = 1; next.pair.owner.rows = next.pair.owner.rows.slice(1); return next })() },
    { name: 'the-honest-landing-moves-more-than-the-answered-party', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.pair.owner.moved = [TEAM_A, TEAM_D]; return next })() },
    { name: 'the-three-ledgers-hold-different-facts', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.pair.sameFact.allSame = false; next.pair.sameFact.owner.payload = { ...next.pair.sameFact.owner.payload, to: TEAM_B }; return next })() },
    { name: 'the-uninvolved-writers-refusal-still-appends', mustRedden: [READING_IDS[3]],
      world: (() => { const next = clone(); next.pair.uninvolved.refusalNamed.bytesSame = false; return next })() },
    { name: 'the-merge-does-not-ask-mayExchange-a-second-time', mustRedden: [READING_IDS[4]],
      world: (() => { const next = clone(); next.handshake.revoked.code = null; next.handshake.revoked.threw = false; return next })() },
    { name: 'a-request-with-no-handshake-lands-anyway', mustRedden: [READING_IDS[4]],
      world: (() => { const next = clone(); next.handshake.bareAsk.code = null; next.handshake.bareAsk.threw = false; return next })() },
    { name: 'the-fold-lets-a-denial-win-by-its-word-rather-than-its-seq', mustRedden: [READING_IDS[5]],
      world: (() => { const next = clone(); next.seq.three.renumberedDenialFirst = { ok: true, pairs: [{ from: PAIR_FROM, to: PAIR_TO, mode: 'join', state: 'denied', seq: 1 }], history: [], malformed: 0, text: 'mutant', error: null }; return next })() },
    { name: 'the-fold-follows-the-arrival-order', mustRedden: [READING_IDS[5]],
      world: (() => { const next = clone(); next.seq.three.allSame = false; next.seq.three.reversed = { ok: true, pairs: [{ from: PAIR_FROM, to: PAIR_TO, mode: 'join', state: 'requested', seq: 1 }], history: [], malformed: 0, text: 'mutant', error: null }; return next })() },
    { name: 'the-fold-forgets-the-row-a-round-cleared', mustRedden: [READING_IDS[5]],
      world: (() => { const next = clone(); next.seq.three.original.history = next.seq.three.original.history.slice(0, 1); return next })() },
    { name: 'a-refusal-names-nothing', mustRedden: [READING_IDS[6]],
      world: (() => { const next = clone(); next.refusals[0].code = 'TYPE_ERROR'; next.refusals[0].message = 'invalid input'; return next })() },
    { name: 'a-refusal-still-appends', mustRedden: [READING_IDS[6]],
      world: (() => { const next = clone(); next.ledger.afterRefusals.stamp.rows += 1; next.ledger.afterRefusals.stamp.bytes += 90; next.ledger.afterRefusals.stamp.sha256 = 'moved'; return next })() },
    { name: 'the-same-malformed-call-answers-a-different-name-the-second-time', mustRedden: [READING_IDS[6]],
      world: (() => { const next = clone(); next.refusalRepeat.sameAsFirst = false; next.refusalRepeat.second = 'MERGE_SOMETHING_ELSE'; return next })() },
    { name: 'a-writer-leading-two-teams-asks-anyway', mustRedden: [READING_IDS[6]],
      world: (() => { const next = clone(); next.twoTeams.code = null; next.twoTeams.threw = false; return next })() },
    { name: 'a-second-request-clears-the-agreement', mustRedden: [READING_IDS[6]],
      world: (() => { const next = clone(); next.alreadyGranted.code = null; next.alreadyGranted.threw = false; return next })() },
    { name: 'a-named-refusal-goes-missing', mustRedden: [READING_IDS[6]],
      world: (() => { const next = clone(); next.refusals = next.refusals.filter((entry) => entry.code !== 'MERGE_REQUEST_AMBIGUOUS'); return next })() },
    { name: 'control-nothing-changed', mustRedden: [], world: clone() },
  ]
  return list
}

const loadModule = async () => {
  try { return await import(pathToFileURL(MODULE_PATH).href) } catch (error) {
    console.log('SKIP: importing ' + MODULE_PATH + ' threw: ' + String(error && error.message ? error.message : error))
    return null
  }
}
const cleanup = (world, keep) => {
  if (keep === true) { console.log('        kept: ' + show(world.roots ?? [])); return }
  for (const root of [...new Set(world.roots ?? [])]) { try { rmSync(root, { recursive: true, force: true }) } catch { /* the temp world is disposable */ } }
}
const report = (readings) => {
  for (const reading of readings) {
    const mark = reading.unmeasured === true ? 'NOT MEASURED' : reading.ok === true ? 'ok  ' : 'FAIL'
    console.log('  ' + mark + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence ?? []) console.log('        ' + line)
  }
}

const runSelfAttack = async (started) => {
  const module = await loadModule()
  if (module === null) return 3
  const collected = await collect(module)
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); return 3 }
  const world = collected.world
  const base = judge(world, module)
  const baseRed = base.filter((reading) => reading.ok === false && reading.unmeasured !== true).map((reading) => reading.id)
  const baseNotMeasured = base.filter((reading) => reading.unmeasured === true).map((reading) => reading.id)
  console.log('  baseline in this world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' failed, ' + String(baseNotMeasured.length) + ' not measured')
  if (baseRed.length > 0 || baseNotMeasured.length > 0) {
    console.log('  FAIL  the attack needs a green, fully measured baseline: red=' + show(baseRed) + ' notMeasured=' + show(baseNotMeasured) + ' (a mutant declared against a reading that is already red proves nothing)')
    cleanup(world, KEEP)
    return baseNotMeasured.length > 0 ? 3 : 1
  }
  const built = mutants(world)
  const declaredAll = new Set(built.flatMap((mutant) => mutant.mustRedden))
  const judgedIds = base.map((reading) => reading.id)
  if (judgedIds.length !== READING_IDS.length) console.log('  NOTE  the judge produced ' + String(judgedIds.length) + ' reading(s) while this gate declares ' + String(READING_IDS.length) + ': ' + show(READING_IDS.filter((id) => judgedIds.includes(id) === false)))
  const uncovered = READING_IDS.filter((id) => declaredAll.has(id) === false)
  console.log('  each mutant below rewrites ONE fact of that measured world and is judged by the same judge:')
  let failures = 0
  const rows = []
  for (const mutant of built) {
    const observed = judge(mutant.world, module).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const declared = mutant.mustRedden
    const precise = observed.length === declared.length && declared.every((id) => observed.includes(id))
    if (precise === false) failures += 1
    rows.push({ name: mutant.name, declared, observed, precise })
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' — 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed))
  }
  console.log('')
  console.log('  coverage matrix (reading -> mutants that declare it):')
  for (const id of READING_IDS) {
    const claimants = rows.filter((row) => row.declared.includes(id)).map((row) => row.name)
    console.log('    ' + id + ': ' + (claimants.length === 0 ? 'UNCOVERED' : String(claimants.length) + ' mutant(s)'))
  }
  if (uncovered.length > 0) console.log('  UNCOVERED READINGS: ' + show(uncovered))
  const mutating = built.filter((mutant) => mutant.mustRedden.length > 0).length
  console.log('  ' + String(built.length) + ' mutants (' + String(mutating) + ' of them declare a target), ' + String(failures) + ' imprecise, uncovered readings ' + String(uncovered.length) + ' | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  console.log('  note: the mutants attack the JUDGE over the world measured in this run; the measurement itself is not repeated per mutant.')
  cleanup(world, KEEP)
  return failures === 0 && uncovered.length === 0 ? 0 : 1
}

const main = async () => {
  const started = Date.now()
  if (SELF_ATTACK) return await runSelfAttack(started)
  const module = await loadModule()
  if (module === null) return 3
  const collected = await collect(module)
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); return 3 }
  const readings = judge(collected.world, module)
  report(readings)
  const failed = readings.filter((reading) => reading.ok === false && reading.unmeasured !== true)
  const notMeasured = readings.filter((reading) => reading.unmeasured === true)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  cleanup(collected.world, KEEP)
  if (notMeasured.length > 0) {
    console.log('SKIP: NOT MEASURED - ' + notMeasured.map((reading) => reading.id).join(', ') + ': ' + notMeasured.map((reading) => reading.detail).join(' | '))
    return 3
  }
  return failed.length > 0 ? 1 : 0
}

process.exitCode = await main()
