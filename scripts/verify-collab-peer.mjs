#!/usr/bin/env node
/**
 * Gate (R182-B) - two leads HANDSHAKE ON THE LEDGER: the two model-visible peer tools append the
 * 'peer/state' rows their fold reads, a request is not a permission, only the ordered pair a grant
 * names is allowed, a later denial clears an earlier grant, the fold answers the same table however
 * its rows are arranged and whichever log wrote them, malformed calls are refused BY NAME without
 * moving the file, and the permission is in the file rather than in the process that wrote it.
 *
 * Subject: the peer line of R182 (docs/handoff/R182-A-peer-tools.md). Written by a verifier who did
 * not write the plugin: the worlds below are BUILT by calling apply() on the shipped artifact with a
 * ctx that publishes a tools registry the way the kernel composes it, the tools are CALLED through
 * the definitions that registry holds, and every count is this gate's own arithmetic over the
 * control.jsonl it parses itself - never a fixture the plugin also produces, and never the plugin's
 * own report of what it did.
 *
 * THE TWO TOOLS ARE NOT NAMED HERE. The gate DISCOVERS them by behaviour: it calls every tool the
 * registry holds with a bounded set of argument shapes (both hand-written and derived from each
 * tool's OWN declared schema), and keeps the ones whose call appends exactly one 'peer/state' row.
 * The tool that writes state='requested' is the asking tool; the tool that writes 'granted' and
 * 'denied' is the answering tool. A gate that found them by name would pass on a registry where the
 * names moved, and would have to be edited whenever they did - the spelling is the producer's to
 * choose (R182-A records it) and this gate's job is to measure whether whatever they chose works.
 * The producer's record file is READ when it exists, and the names found by behaviour must appear in
 * it: a record that documents tools nobody registered reddens reading 1.
 *
 * Eight readings, each of which can fail on its own evidence:
 *
 *   1-the-round-adds-two-peer-writers-and-they-really-append
 *                                            In a fresh world, apply() publishes linkCollab, the
 *                                            ledger starts at 0 rows, and exactly TWO tool names
 *                                            appended a peer/state row: one that writes 'requested'
 *                                            (the asking tool) and one that writes both 'granted' and
 *                                            'denied' (the answering tool). The registry's whole face
 *                                            is printed, and the names the producer's record file
 *                                            mentions must be among it. A gate that measured an empty
 *                                            world - or one where the two tools were never registered -
 *                                            fails here instead of passing seven readings about nothing.
 *   2-the-asking-tool-writes-the-request-row-it-returns
 *                                            One call through the registry: the FILE gains exactly ONE
 *                                            row, kind 'peer/state', payload {from,to,request,
 *                                            state:'requested'} for the pair the caller named, subject
 *                                            equal to the record the shipped builder builds for the same
 *                                            four fields - and the value the call RETURNS must be that
 *                                            row: it carries the row's own seq and the four values it
 *                                            just wrote. An answer the model reads but the ledger does
 *                                            not hold is the failure this reading exists for.
 *   3-requested-is-not-permission-and-only-the-named-direction-is-granted
 *                                            After the request: mayExchange is false in BOTH directions,
 *                                            and the fold shows one row, state 'requested', waiting on
 *                                            the lead that was asked (pendingRequests names the asker).
 *                                            After the answer grants: TRUE for the ordered pair (A -> B)
 *                                            and FALSE for its reverse (B -> A), the pair is no longer
 *                                            pending, and the table still holds exactly one row per
 *                                            ordered pair. A fold that treats a request as permission, or
 *                                            a grant as symmetric, reddens here.
 *   4-a-denial-clears-an-earlier-grant        granted, then denied, on the same ordered pair: the answer
 *                                            flips to false, the pair's row is the DENIAL with its own
 *                                            (higher) seq, and the fold still holds ONE row for that
 *                                            pair - a revocation is the fold's consequence, not a second
 *                                            row that leaves the old one visible.
 *   5-two-rows-of-one-pair-are-decided-by-seq-and-the-arrangement-does-not-matter
 *                                            The same rows folded in reverse answer the same table; drop
 *                                            the denial row and the pair is granted again; drop both answers
 *                                            and it is requested again; and renumbering the three rows so the
 *                                            DENIAL carries the lowest seq makes the fold answer requested -
 *                                            the highest seq decides, not the word a row carries. A ledger this
 *                                            gate writes ITSELF, through the shipped log with no tool involved,
 *                                            folds into the same table - so the fold reads the file rather than
 *                                            the tool's bookkeeping.
 *   6-bad-inputs-are-refused-by-name-and-the-ledger-does-not-move
 *                                            A batch of malformed calls to both tools (no arguments, an
 *                                            array, blank and malformed names, an unknown state word, a
 *                                            non-boolean decision, a repeated call) must each throw with
 *                                            an UPPER-CASE rule name leading the message - not a bare
 *                                            TypeError - the same call twice must answer the same name, and
 *                                            control.jsonl must be byte-identical before and after the whole
 *                                            batch: a refusal that still appends is the failure this
 *                                            reading exists for.
 *   7-two-logs-write-one-row-each-and-both-fold-the-same-handshake
 *                                            The cross-writer case: the asking tool writes the request
 *                                            into the plugin's own log, that log's own page is RELAYED (the
 *                                            shipped ingest, with its writer/instance header) into a second
 *                                            log this gate opened, the second log writes the grant for the
 *                                            same ordered pair, and its page is relayed back. Both logs then
 *                                            hold both writers' rows and must fold the SAME table: granted in
 *                                            that direction, false in the reverse, identically on both sides.
 *                                            The degenerate case is measured beside it rather than assumed
 *                                            away: two logs that write the same pair WITHOUT having seen each
 *                                            other fold to their own arrival order (they disagree), and the
 *                                            reading pins what must hold anyway - both logs hold both rows,
 *                                            and neither invents an answer that is not one of the two rows.
 *   8-the-permission-is-in-the-file-and-a-reopened-log-answers-the-same
 *                                            The measured world's control.jsonl is copied to a fresh
 *                                            directory and opened as a new log with no tools attached: it
 *                                            holds the same records, folds the same table and answers
 *                                            mayExchange the same way. A permission cached in the writing
 *                                            process would not survive this copy.
 *
 * Self-attack: --self-attack measures the live world ONCE and then mutates THAT measured world in
 * memory, one mutation per mutant, asserting each mutant reddens exactly its declared readings and
 * nothing else, plus a control mutant that changes nothing. It prints the Chinese sentence
 * '声明集 == 观测集' for every mutant. Mutating the measured world rather than a hand-written fixture is
 * deliberate: a fixture only proves the judge agrees with itself.
 *
 * Budget: this gate is offline (no port, no client, no kernel boot); it writes throwaway directories
 * under the OS temp dir and removes them unless --keep is given. It prints its elapsed time.
 *
 * Exit 0 all readings held | 1 a reading failed (including: the shipped face holds no peer tools, which
 * is a NAMED failure that says what is missing) | 3 the subject itself could not be built here (the
 * module does not import, or no world could open its ledger). A reading that cannot be measured is a
 * failure, never a pass.
 *
 * Usage: node scripts/verify-collab-peer.mjs [--module <path>] [--record <path>] [--self-attack] [--keep]
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
/** The producer's own record of what it spelled the tools. Read for evidence, never required. */
const RECORD_PATH = resolve(option('--record', join(PROJECT, 'docs', 'handoff', 'R182-A-peer-tools.md')))

/** The names this gate writes into the world. Recognisable on purpose: a reader of the ledger can tell a test fact from a work fact. */
const LEAD_A = 'gate-r182-alpha'
const LEAD_B = 'gate-r182-beta'
const LEAD_C = 'gate-r182-gamma'
const LEAD_D = 'gate-r182-delta'
const REQUEST = 'exchange'
const TEAM = 'gate-r182-team'
/** The record kind the round promised. The module's own PEER_KIND wins when it exports one. */
const PEER_KIND_FALLBACK = 'peer/state'
/** The four writers R181 left behind: the round adds two tools, it must not overload one of these. */
const R181_FACE = ['team_declare_capability', 'team_declare_subteam', 'team_heartbeat', 'team_reclaim_task']

const show = (value) => JSON.stringify(value === undefined ? null : value)
const clip = (text, width) => { const s = String(text ?? ''); return s.length <= width ? s : s.slice(0, width) + '...' }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const kindOf = (module) => (typeof module?.PEER_KIND === 'string' && module.PEER_KIND !== '' ? module.PEER_KIND : PEER_KIND_FALLBACK)

/** The rule name a refusal leads with. The registry renders a thrown error as 'Error: <code>: <detail>', and this is the code. */
const firstCode = (message) => {
  const match = /^\s*([A-Z][A-Z0-9_]{2,})\b/.exec(String(message ?? ''))
  return match === null ? null : match[1]
}

// ---------------------------------------------------------------------------
// The ledger file, counted by this gate
// ---------------------------------------------------------------------------

/** Read <dir>/control.jsonl and parse it here: the row count is this gate's arithmetic, not the plugin's. */
const readLedger = (dir) => {
  const path = join(dir, 'control.jsonl')
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch { return { path, rows: [], text: '', bytes: 0, unreadable: 0, present: false } }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const rows = []
  let unreadable = 0
  for (const line of lines) {
    try { rows.push(JSON.parse(line)) } catch { unreadable += 1 }
  }
  return { path, rows, text, bytes: Buffer.byteLength(text), unreadable, present: true }
}

// ---------------------------------------------------------------------------
// The folds, read through the shipped module over rows this gate parsed
// ---------------------------------------------------------------------------

const foldOf = (module, rows) => {
  try {
    const state = module.projectTeamState(rows)
    const pairs = state.peers.pairs.map((pair) => ({ from: pair.from, to: pair.to, request: pair.request, state: pair.state, seq: pair.seq }))
    return { ok: true, pairs, text: JSON.stringify(pairs.map((pair) => [pair.from, pair.to, pair.request, pair.state, pair.seq])), error: null }
  } catch (error) {
    return { ok: false, pairs: [], text: 'the fold threw', error: String(error && error.message ? error.message : error) }
  }
}
const mayOf = (module, rows, from, to) => {
  try { return module.mayExchange(module.projectTeamState(rows), from, to) } catch (error) { return 'threw: ' + String(error && error.message ? error.message : error) }
}
const pendingOf = (module, rows, to) => {
  try { return module.pendingRequests(module.projectTeamState(rows), to).map((pair) => pair.from + '->' + pair.to + ':' + pair.state) } catch (error) { return ['threw: ' + String(error && error.message ? error.message : error)] }
}
const writersOf = (rows) => [...new Set(rows.map((row) => String(row.writer ?? '(none)') + '/' + String(row.instance ?? '(none)')))].sort()

// ---------------------------------------------------------------------------
// The world: a fresh control log driven through the SHIPPED artifact
// ---------------------------------------------------------------------------

const buildWorld = async (module, label) => {
  const root = mkdtempSync(join(tmpdir(), 'r182-peer-' + label + '-'))
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
  return { root, dir, registry, collab, applied, disposers }
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

// ---------------------------------------------------------------------------
// Discovery: which registered tool appends a peer/state row, and with what arguments
// ---------------------------------------------------------------------------

/** Hand-written argument shapes: the words a tool for this record could plausibly take. */
const PROBE_SHAPES = [
  { id: 'from/to/request', args: { from: LEAD_A, to: LEAD_B, request: REQUEST } },
  { id: 'from/to/request+state=requested', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, state: 'requested' } },
  { id: 'from/to/request+state=granted', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, state: 'granted' } },
  { id: 'from/to/request+state=denied', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, state: 'denied' } },
  { id: 'from/to/request+granted=true', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, granted: true } },
  { id: 'from/to/request+granted=false', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, granted: false } },
  { id: 'from/to/request+grant=true', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, grant: true } },
  { id: 'from/to/request+grant=false', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, grant: false } },
  { id: 'from/to/request+denied=true', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, denied: true } },
  { id: 'from/to/request+decision=granted', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, decision: 'granted' } },
  { id: 'from/to/request+decision=denied', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, decision: 'denied' } },
  { id: 'from/to/request+allow=true', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, allow: true } },
  { id: 'from/to/request+allow=false', args: { from: LEAD_A, to: LEAD_B, request: REQUEST, allow: false } },
  { id: 'asker/answerer/request', args: { asker: LEAD_A, answerer: LEAD_B, request: REQUEST } },
  { id: 'lead/peer/request', args: { lead: LEAD_A, peer: LEAD_B, request: REQUEST } },
  { id: 'self/other/request', args: { self: LEAD_A, other: LEAD_B, request: REQUEST } },
  { id: 'to/request', args: { to: LEAD_B, request: REQUEST } },
  { id: 'from/request+granted=true', args: { from: LEAD_A, request: REQUEST, granted: true } },
  { id: 'team/from/to/request', args: { team: TEAM, from: LEAD_A, to: LEAD_B, request: REQUEST } },
]

/** What one declared property name means, in the record's own vocabulary. */
const schemaValue = (key, variant) => {
  const name = String(key).toLowerCase()
  if (/^(from|asker|requester|source|self|a|by)$/.test(name)) return LEAD_A
  if (/^(to|answerer|responder|target|peer|other|with|b)$/.test(name)) return LEAD_B
  if (/^(request|topic|purpose|what|capability|scope|about)$/.test(name)) return REQUEST
  if (/^(team)$/.test(name)) return TEAM
  if (/^(state|verdict|decision|status|answer|response)$/.test(name)) return variant
  if (/^(grant|granted|accept|accepted|approve|approved|allow|allowed|ok|yes)$/.test(name)) return variant === 'granted'
  if (/^(deny|denied|refuse|refused|reject|rejected|revoke|revoked)$/.test(name)) return variant === 'denied'
  return undefined
}

/** Hand-written shapes, plus shapes built from the tool's OWN declared schema - so a tool that names its fields differently is still reachable. */
const probeShapes = (definition) => {
  const out = PROBE_SHAPES.map((shape) => ({ id: shape.id, args: shape.args, declared: false }))
  const properties = definition?.parameters?.properties
  if (properties !== null && typeof properties === 'object') {
    for (const variant of ['requested', 'granted', 'denied']) {
      const args = {}
      let filled = 0
      for (const key of Object.keys(properties)) {
        const value = schemaValue(key, variant)
        if (value !== undefined) { args[key] = value; filled += 1 }
      }
      if (filled > 0) out.push({ id: 'declared-schema state=' + variant, args, declared: true })
    }
  }
  return out
}

/** Call every registered tool with every shape and keep the calls that appended exactly one peer/state row. */
const probeOnce = async (built, module, tried) => {
  const successes = []
  const kind = kindOf(module)
  for (const name of [...built.registry.keys()].sort()) {
    const definition = built.registry.get(name)
    for (const shape of probeShapes(definition)) {
      const before = readLedger(built.dir)
      const outcome = await call(built, name, shape.args)
      const after = readLedger(built.dir)
      const gained = after.rows.slice(before.rows.length)
      const peers = gained.filter((row) => row.kind === kind)
      if (peers.length === 1 && gained.length === 1) {
        const state = typeof peers[0].payload?.state === 'string' ? peers[0].payload.state : null
        successes.push({ tool: name, shape: shape.id, declared: shape.declared, args: shape.args, state, row: peers[0] })
        tried.push(name + ' | ' + shape.id + ' -> appended ' + show(peers[0].payload))
        continue
      }
      tried.push(name + ' | ' + shape.id + ' -> ' + (outcome.ok === true ? 'appended ' + String(gained.length) + ' row(s), none of them ' + kind : clip(outcome.error, 60)))
    }
  }
  return successes
}

/**
 * The answer tool may refuse a decision for a request it has not seen, so a second pass runs over the
 * same shapes with one hand-written request already in the ledger - that seeding is what lets an
 * answering tool be discovered at all, and it is this gate's row, not the plugin's.
 */
const discoverPeers = async (module) => {
  const built = await buildWorld(module, 'probe')
  const tried = []
  let successes = await probeOnce(built, module, tried)
  const seeded = successes.some((entry) => entry.state === 'granted' || entry.state === 'denied')
  let seedRow = null
  if (seeded === false) {
    seedRow = { kind: kindOf(module), subject: LEAD_A + '->' + LEAD_B, payload: { from: LEAD_A, to: LEAD_B, request: REQUEST, state: 'requested' } }
    try { await built.collab.log.append(seedRow) } catch (error) { tried.push('seeding a request threw: ' + clip(error && error.message, 60)) }
    const second = await probeOnce(built, module, tried)
    const already = new Set(successes.map((entry) => entry.tool + '|' + entry.state))
    successes = successes.concat(second.filter((entry) => already.has(entry.tool + '|' + entry.state) === false))
  }
  const first = (state) => successes.find((entry) => entry.state === state) ?? null
  const writers = [...new Set(successes.map((entry) => entry.tool))].sort()
  const discovery = {
    names: [...built.registry.keys()].sort(),
    tried,
    successes: successes.map((entry) => ({ tool: entry.tool, shape: entry.shape, declared: entry.declared, state: entry.state, args: entry.args, subject: entry.row.subject ?? null })),
    writers,
    ask: first('requested'),
    grant: first('granted'),
    deny: first('denied'),
    seeded: seedRow !== null,
    seedRow,
  }
  closeWorld(built)
  return { discovery, probeRoot: built.root }
}

// ---------------------------------------------------------------------------
// Collection: one measured world, plus the across-writer and across-restart worlds
// ---------------------------------------------------------------------------

const recordEvidence = () => {
  try { return { path: RECORD_PATH, text: readFileSync(RECORD_PATH, 'utf8'), present: true } } catch { return { path: RECORD_PATH, text: null, present: false } }
}

/** Every fact the judge reads, measured once. Mutants rewrite these fields; nothing else is re-read. */
const collect = async (module) => {
  const progress = []
  const world = { module: MODULE_PATH, kind: kindOf(module), at: Date.now(), roots: [], fatal: null }

  const { discovery, probeRoot } = await discoverPeers(module)
  world.roots.push(probeRoot)
  world.discovery = discovery
  progress.push('discovery: ' + String(discovery.names.length) + ' tool(s) in the registry, ' + String(discovery.writers.length) + ' of them appended a ' + world.kind + ' row (seeded request: ' + String(discovery.seeded) + ')')

  const built = await buildWorld(module, 'measure')
  world.roots.push(built.root)
  world.dir = built.dir
  world.applied = built.applied
  world.collab = { available: built.collab?.tools?.available ?? null, reason: built.collab?.tools?.reason ?? null, names: built.collab?.tools?.names ? [...built.collab.tools.names].sort() : null }
  world.ledger = { initial: readLedger(built.dir) }
  if (built.applied.ok !== true || built.collab === undefined) {
    world.hasCapability = false
    world.registry = { names: [...built.registry.keys()].sort() }
    closeWorld(built)
    return { world, progress, fatal: 'apply() did not publish linkCollab in this world: ' + show(built.applied.error ?? 'no capability provided') }
  }
  world.hasCapability = true
  world.registry = { names: [...built.registry.keys()].sort(), logWriter: String(built.collab.log?.writer ?? '(none)') }
  world.record = recordEvidence()

  const nameInRegistry = (entry) => entry !== null && (world.registry.names ?? []).includes(entry.tool)
  const askUsable = nameInRegistry(discovery.ask)
  const grantUsable = nameInRegistry(discovery.grant)
  const denyUsable = nameInRegistry(discovery.deny)
  world.discovery.usable = { ask: askUsable, grant: grantUsable, deny: denyUsable }

  // 2 -- one call of the asking tool, and the row it must have written --------------------------------
  world.calls = {}
  world.ledger.afterAsk = readLedger(built.dir)
  if (askUsable === false) {
    world.calls.ask = { ok: false, missing: true, error: 'no asking tool was discovered, so there is nothing to call' }
  } else {
    world.calls.ask = await call(built, discovery.ask.tool, discovery.ask.args)
  }
  world.ledger.afterAsk = readLedger(built.dir)
  const gained = world.ledger.afterAsk.rows.slice(world.ledger.initial.rows.length)
  world.askRow = gained.length === 1 ? gained[0] : null
  world.askGained = gained.length
  world.askReturn = { ok: world.calls.ask?.ok === true, json: null, seq: null, values: [], error: world.calls.ask?.error ?? null }
  if (world.calls.ask?.ok === true) {
    let text = null
    try { text = JSON.stringify(world.calls.ask.value) } catch (error) { text = null }
    world.askReturn.json = text
    const value = world.calls.ask.value
    world.askReturn.seq = value !== null && typeof value === 'object' && typeof value.seq === 'number' ? value.seq : null
    const haystack = text ?? ''
    world.askReturn.values = [LEAD_A, LEAD_B, REQUEST, 'requested'].filter((needle) => haystack.includes(needle))
  }
  world.expectedSubject = (() => {
    try { return module.peerRecord === undefined ? null : module.peerRecord(LEAD_A, LEAD_B, REQUEST, 'requested').subject } catch { return null }
  })()

  // 3 -- the request is not a permission; the grant names one direction only --------------------------
  world.fold = {}
  const rowsAfterAsk = world.ledger.afterAsk.rows
  world.fold.afterAsk = {
    table: foldOf(module, rowsAfterAsk),
    mayForward: mayOf(module, rowsAfterAsk, LEAD_A, LEAD_B),
    mayReverse: mayOf(module, rowsAfterAsk, LEAD_B, LEAD_A),
    pendingAtAsked: pendingOf(module, rowsAfterAsk, LEAD_B),
    pendingAtAsker: pendingOf(module, rowsAfterAsk, LEAD_A),
  }

  world.ledger.afterGrant = readLedger(built.dir)
  if (grantUsable === false) {
    world.calls.grant = { ok: false, missing: true, error: 'no answering tool wrote a granted row, so there is nothing to call' }
  } else {
    world.calls.grant = await call(built, discovery.grant.tool, discovery.grant.args)
  }
  world.ledger.afterGrant = readLedger(built.dir)
  const granted = world.ledger.afterGrant.rows.slice(world.ledger.afterAsk.rows.length)
  world.grantRow = granted.length === 1 ? granted[0] : null
  world.grantGained = granted.length
  const rowsAfterGrant = world.ledger.afterGrant.rows
  world.fold.afterGrant = {
    table: foldOf(module, rowsAfterGrant),
    mayForward: mayOf(module, rowsAfterGrant, LEAD_A, LEAD_B),
    mayReverse: mayOf(module, rowsAfterGrant, LEAD_B, LEAD_A),
    pendingAtAsked: pendingOf(module, rowsAfterGrant, LEAD_B),
  }

  // 4 -- a denial clears the grant ----------------------------------------------------------------
  world.ledger.afterDeny = readLedger(built.dir)
  if (denyUsable === false) {
    world.calls.deny = { ok: false, missing: true, error: 'no answering tool wrote a denied row, so there is nothing to call' }
  } else {
    world.calls.deny = await call(built, discovery.deny.tool, discovery.deny.args)
  }
  world.ledger.afterDeny = readLedger(built.dir)
  const denied = world.ledger.afterDeny.rows.slice(world.ledger.afterGrant.rows.length)
  world.denyRow = denied.length === 1 ? denied[0] : null
  world.denyGained = denied.length
  const rowsAfterDeny = world.ledger.afterDeny.rows
  world.fold.afterDeny = {
    table: foldOf(module, rowsAfterDeny),
    mayForward: mayOf(module, rowsAfterDeny, LEAD_A, LEAD_B),
  }

  // 5 -- the fold by seq, and what it reads -------------------------------------------------------
  world.fold.reversed = foldOf(module, [...rowsAfterDeny].reverse())
  const withoutSeq = (rows, row) => (row === null ? rows : rows.filter((candidate) => candidate.seq !== row.seq))
  world.fold.minusDeny = foldOf(module, withoutSeq(rowsAfterDeny, world.denyRow))
  world.fold.onlyRequest = foldOf(module, withoutSeq(withoutSeq(rowsAfterDeny, world.denyRow), world.grantRow))
  // The rows of ONE pair, renumbered so the DENIAL carries the lowest seq and the request the highest:
  // if the fold follows seq, the answer changes with the numbering. A fold that let a denial win
  // because it is a denial would answer 'denied' either way, and this is what tells the two apart.
  const pairRows = rowsAfterDeny.filter((row) => row.kind === world.kind).sort((left, right) => left.seq - right.seq)
  world.fold.renumbered = foldOf(module, pairRows.map((row, at) => ({ ...row, seq: pairRows.length - at })))
  world.fold.renumberedExpected = { state: 'requested', seq: pairRows.length }
  world.ownLedger = (() => {
    const dir = join(built.root, 'own-log')
    mkdirSync(dir, { recursive: true })
    try {
      const log = module.openControlLog({ dir, writer: 'gate-r182-own' })
      const rows = [
        { kind: world.kind, subject: LEAD_C + '->' + LEAD_D, payload: { from: LEAD_C, to: LEAD_D, request: REQUEST, state: 'granted' } },
        { kind: world.kind, subject: LEAD_C + '->' + LEAD_D, payload: { from: LEAD_C, to: LEAD_D, request: REQUEST, state: 'denied' } },
      ]
      return { rows, write: (async () => { for (const row of rows) await log.append(row); await log.close(); return true })(), dir }
    } catch (error) {
      return { rows: [], write: Promise.resolve(false), error: String(error && error.message ? error.message : error), dir }
    }
  })()
  world.ownLedger.written = await world.ownLedger.write
  world.ownLedger.table = foldOf(module, readLedger(world.ownLedger.dir).rows)
  world.ownLedger.may = mayOf(module, readLedger(world.ownLedger.dir).rows, LEAD_C, LEAD_D)
  delete world.ownLedger.write

  // 6 -- the refusals, in one batch, with the ledger byte-compared around it ------------------------
  world.ledger.beforeRefusals = readLedger(built.dir)
  world.refusals = []
  const refusalPlan = []
  // Which fields a tool declares is the tool's own business: a malformed value is only malformed for a
  // field that tool takes, so the plan is built from each tool's OWN declared schema. A hand-written
  // pile of keys would refuse the asking tool for a field it never reads, which measures nothing.
  const declaredKeys = (tool) => Object.keys(built.registry.get(tool)?.parameters?.properties ?? {})
  for (const [label, entry] of [['ask', discovery.ask], ['answer', discovery.grant]]) {
    if (entry === null) continue
    const valid = entry.args
    const plan = [
      { id: label + ':no-arguments', args: null },
      { id: label + ':array', args: [] },
      { id: label + ':empty-object', args: {} },
      { id: label + ':whole-arguments-replaced-by-a-string', args: 'no' },
      { id: label + ':blank-from', args: { ...valid, from: '   ' } },
      { id: label + ':from-with-a-space', args: { ...valid, from: 'gate r182 alpha' } },
      { id: label + ':from-not-a-string', args: { ...valid, from: 42 } },
      { id: label + ':blank-to', args: { ...valid, to: '   ' } },
      { id: label + ':to-with-a-space', args: { ...valid, to: 'gate r182 beta' } },
      { id: label + ':empty-request', args: { ...valid, request: '' } },
      { id: label + ':request-not-a-string', args: { ...valid, request: 42 } },
    ]
    const keys = declaredKeys(entry.tool)
    for (const key of keys.filter((name) => /^(state|verdict|decision|status|answer|response)$/i.test(name))) {
      plan.push({ id: label + ':' + key + '-is-not-a-state-word', args: { ...valid, [key]: 'maybe' } })
    }
    for (const key of keys.filter((name) => /^(grant|granted|accept|accepted|approve|approved|allow|allowed)$/i.test(name))) {
      plan.push({ id: label + ':' + key + '-is-not-a-boolean', args: { ...valid, [key]: 'yes' } })
    }
    refusalPlan.push(...plan.map((item) => ({ label, tool: entry.tool, ...item })))
  }
  for (const plan of refusalPlan) {
    const outcome = await call(built, plan.tool, plan.args)
    const message = outcome.ok === true ? '' : String(outcome.error ?? '')
    world.refusals.push({
      id: plan.id,
      tool: plan.tool,
      ok: outcome.ok === false && outcome.missing !== true,
      threw: outcome.ok === false,
      errorName: outcome.name ?? null,
      code: firstCode(message),
      message: clip(message, 120),
    })
  }
  const twice = refusalPlan.length > 0 ? await call(built, refusalPlan[2].tool, refusalPlan[2].args) : { ok: true }
  world.refusalRepeat = { id: refusalPlan.length > 0 ? refusalPlan[2].id : null, code: firstCode(twice.ok === true ? '' : twice.error), sameAsFirst: false }
  world.refusalRepeat.sameAsFirst = world.refusalRepeat.code !== null && world.refusalRepeat.code === (world.refusals[2]?.code ?? null)
  world.ledger.afterRefusals = readLedger(built.dir)

  // 7 -- the cross-writer handshake: two logs, one row each -----------------------------------------
  const secondDir = join(built.root, 'peer-b')
  mkdirSync(secondDir, { recursive: true })
  const cross = { steps: [], secondWriter: 'gate-r182-peer-b' }
  try {
    const other = module.openControlLog({ dir: secondDir, writer: 'gate-r182-peer-b' })
    const asBatch = (log) => ({ writer: log.writer, instance: log.instance, records: log.ownPage(0).map((record) => ({ ...record, seq: record.originSeq ?? record.seq })) })
    const askPair = { from: LEAD_C, to: LEAD_D }
    const askArgs = discovery.ask === null ? null : Object.fromEntries(Object.entries(discovery.ask.args).map(([key, value]) => [key, value === LEAD_A ? LEAD_C : value === LEAD_B ? LEAD_D : value]))
    cross.ask = askArgs === null ? { ok: false, error: 'no asking tool was discovered' } : await call(built, discovery.ask.tool, askArgs)
    const afterAskWrite = readLedger(built.dir)
    cross.sideA = { rows: afterAskWrite.rows.length, last: afterAskWrite.rows[afterAskWrite.rows.length - 1] ?? null }
    const relayedToB = built.collab.log.ownPage(0).length > 0 ? await other.ingest(asBatch(built.collab.log)) : { appended: 0 }
    cross.steps.push('A -> B: ' + show(relayedToB))
    const pairRow = cross.sideA.last
    const from = typeof pairRow?.payload?.from === 'string' ? pairRow.payload.from : askPair.from
    const to = typeof pairRow?.payload?.to === 'string' ? pairRow.payload.to : askPair.to
    cross.pair = { from, to }
    const grant = module.peerRecord === undefined
      ? { kind: world.kind, subject: from + '->' + to, payload: { from, to, request: REQUEST, state: 'granted' } }
      : module.peerRecord(from, to, REQUEST, 'granted')
    await other.append(grant)
    cross.steps.push('B wrote the grant for ' + from + ' -> ' + to + ' (' + (module.peerRecord === undefined ? 'hand-built record' : 'the shipped builder') + ')')
    const relayedToA = await built.collab.log.ingest(asBatch(other))
    cross.steps.push('B -> A: ' + show(relayedToA))
    const rowsA = readLedger(built.dir).rows
    const rowsB = readLedger(secondDir).rows
    cross.aRows = { count: rowsA.length, writers: writersOf(rowsA), pairWriters: writersOf(rowsA.filter((row) => row.kind === world.kind)) }
    cross.bRows = { count: rowsB.length, writers: writersOf(rowsB), pairWriters: writersOf(rowsB.filter((row) => row.kind === world.kind)) }
    cross.foldA = { table: foldOf(module, rowsA), mayForward: mayOf(module, rowsA, from, to), mayReverse: mayOf(module, rowsA, to, from) }
    cross.foldB = { table: foldOf(module, rowsB), mayForward: mayOf(module, rowsB, from, to), mayReverse: mayOf(module, rowsB, to, from) }
    // The records each log holds, by writer and origin stream position: the relay must be symmetric.
    const held = (rows) => rows.filter((row) => row.kind === world.kind).map((row) => String(row.writer) + '/' + String(row.originSeq ?? row.seq)).sort()
    cross.held = { a: held(rowsA), b: held(rowsB) }
    cross.rowsEqual = same(held(rowsA), held(rowsB))
    // The degenerate case, measured rather than assumed away: two logs writing the SAME pair without
    // having seen each other have no shared order, so each folds its own last arrival.
    const degDir = { c: join(built.root, 'deg-c'), d: join(built.root, 'deg-d') }
    mkdirSync(degDir.c, { recursive: true })
    mkdirSync(degDir.d, { recursive: true })
    const make = (record) => (module.peerRecord === undefined
      ? { kind: world.kind, subject: record.from + '->' + record.to, payload: { ...record } }
      : module.peerRecord(record.from, record.to, record.request, record.state))
    const logC = module.openControlLog({ dir: degDir.c, writer: 'gate-r182-deg-c' })
    const logD = module.openControlLog({ dir: degDir.d, writer: 'gate-r182-deg-d' })
    await logC.append(make({ from: LEAD_A, to: LEAD_B, request: REQUEST, state: 'requested' }))
    await logD.append(make({ from: LEAD_A, to: LEAD_B, request: REQUEST, state: 'granted' }))
    await logD.ingest(asBatch(logC))
    await logC.ingest(asBatch(logD))
    const degRows = { c: readLedger(degDir.c).rows, d: readLedger(degDir.d).rows }
    cross.degenerate = {
      c: { table: foldOf(module, degRows.c), may: mayOf(module, degRows.c, LEAD_A, LEAD_B) },
      d: { table: foldOf(module, degRows.d), may: mayOf(module, degRows.d, LEAD_A, LEAD_B) },
      rowsEqual: same(writersOf(degRows.c), writersOf(degRows.d)) && degRows.c.length === degRows.d.length,
      answers: [foldOf(module, degRows.c).pairs[0]?.state ?? null, foldOf(module, degRows.d).pairs[0]?.state ?? null],
      agrees: false,
    }
    cross.degenerate.agrees = cross.degenerate.answers[0] === cross.degenerate.answers[1]
    cross.degenerate.bothStatesAreTheRows = cross.degenerate.answers.every((state) => state === 'requested' || state === 'granted')
    // Each log's answer must be its own file order's last row for that pair, not a third answer.
    const lastStateOf = (rows) => {
      const ordered = [...rows].sort((left, right) => left.seq - right.seq)
      return ordered[ordered.length - 1]?.payload?.state ?? null
    }
    cross.degenerate.ownOrder = [lastStateOf(degRows.c), lastStateOf(degRows.d)]
    cross.degenerate.ownOrderHolds = cross.degenerate.ownOrder[0] === cross.degenerate.answers[0] && cross.degenerate.ownOrder[1] === cross.degenerate.answers[1]
    await logC.close()
    await logD.close()
    await other.close()
  } catch (error) {
    cross.error = String(error && error.message ? error.message : error)
    cross.foldA = cross.foldA ?? { table: foldOf(module, []), mayForward: false, mayReverse: false }
    cross.foldB = cross.foldB ?? { table: foldOf(module, []), mayForward: false, mayReverse: false }
    cross.held = cross.held ?? { a: [], b: [] }
    cross.degenerate = cross.degenerate ?? { c: { table: foldOf(module, []) }, d: { table: foldOf(module, []) }, agrees: false, ownOrderHolds: false, bothStatesAreTheRows: false, rowsEqual: false }
  }
  world.crossWriter = cross

  // 8 -- the same permission, read out of a copy of the file with no tools attached -------------------
  const copyDir = join(built.root, 'reopened')
  mkdirSync(copyDir, { recursive: true })
  world.restart = { copied: false, liveFold: foldOf(module, rowsAfterDeny), fold: null, liveMay: mayOf(module, rowsAfterDeny, LEAD_A, LEAD_B), may: null, rows: null, error: null }
  try {
    // The BYTES the fold above was measured on, not the live file: by now the refusal batch and the
    // relaying world have written rows this reading is not about.
    writeFileSync(join(copyDir, 'control.jsonl'), world.ledger.afterDeny.text)
    const reopened = module.openControlLog({ dir: copyDir, writer: 'gate-r182-reopened' })
    const rows = reopened.replay()
    world.restart.copied = true
    world.restart.rows = rows.length
    world.restart.fold = foldOf(module, rows)
    world.restart.may = mayOf(module, rows, LEAD_A, LEAD_B)
    await reopened.close()
  } catch (error) {
    world.restart.error = String(error && error.message ? error.message : error)
    world.restart.fold = foldOf(module, [])
  }

  // Nothing this gate did AFTER the refusal batch may have written to the measured ledger except the
  // calls this gate made on purpose. The file is read once more and kept for the judge.
  world.ledger.final = readLedger(built.dir)
  closeWorld(built)
  return { world, progress, fatal: null }
}

// ---------------------------------------------------------------------------
// The judge: pure over the measured world, so --self-attack can mutate the world itself
// ---------------------------------------------------------------------------

const judge = (world, module) => {
  const readings = []
  const add = (id, ok, detail, evidence) => readings.push({ id, ok, detail, evidence: Array.isArray(evidence) ? evidence : [] })

  // 1 ------------------------------------------------------------------------
  {
    const issues = []
    const names = world.registry?.names ?? []
    if (world.applied?.ok !== true) issues.push('apply() threw in this world: ' + show(world.applied?.error ?? null))
    if (world.hasCapability !== true) issues.push('apply() published no linkCollab capability')
    if (world.ledger?.initial?.rows?.length !== 0) issues.push('the world did not start empty: control.jsonl already held ' + show(world.ledger?.initial?.rows?.length) + ' row(s)')
    if (world.collab?.available !== true) issues.push('linkCollab.tools.available is ' + show(world.collab?.available ?? null) + ' (reason ' + show(world.collab?.reason ?? null) + ')')
    const writers = world.discovery?.writers ?? []
    const ask = world.discovery?.ask ?? null
    const grant = world.discovery?.grant ?? null
    const deny = world.discovery?.deny ?? null
    if (writers.length === 0) {
      issues.push('NO TOOL in the model-visible face appended a ' + show(world.kind) + ' row: the round promises two tools (申请 / 答复), and none of the ' + String(names.length) + ' registered name(s) ' + show(names) + ' wrote one for any of the argument shapes this gate tried')
    } else if (writers.length !== 2) {
      issues.push('the round promises exactly TWO peer tools (申请 / 答复); ' + String(writers.length) + ' name(s) appended a ' + show(world.kind) + ' row: ' + show(writers))
    }
    if (ask === null) issues.push('no tool wrote state=requested, so the asking tool (申请) is missing from the face')
    if (grant === null) issues.push('no tool wrote state=granted, so no tool can answer (答复) with a grant')
    if (deny === null) issues.push('no tool wrote state=denied, so a refusal cannot be recorded')
    if (ask !== null && grant !== null && ask.tool !== grant.tool && writers.length === 2) {
      // The two tools must be two tools: an answer that shares the asker's name is one tool wearing two.
    }
    const overloaded = writers.filter((name) => R181_FACE.includes(name))
    if (overloaded.length > 0) issues.push('a name R181 already shipped wrote the handshake too: ' + show(overloaded))
    const usable = world.discovery?.usable ?? { ask: false, grant: false, deny: false }
    if (usable.ask !== true || usable.grant !== true || usable.deny !== true) issues.push('the discovered tools are not all in the measured world\'s registry: ' + show(usable))
    if (world.record?.present === true) {
      for (const entry of [ask, grant, deny]) if (entry !== null && String(world.record.text ?? '').includes(entry.tool) === false) issues.push('the producer\'s record ' + world.record.path + ' does not mention ' + show(entry.tool) + ', a tool the registry really registered')
    }
    add('1-the-round-adds-two-peer-writers-and-they-really-append', issues.length === 0,
      issues.length === 0
        ? 'the face holds ' + String(names.length) + ' tool(s) and exactly two of them appended ' + show(world.kind) + ': ' + show(ask.tool) + ' wrote requested, ' + show(grant.tool) + ' wrote granted and denied'
        : issues.join(' | '),
      [
        'registry: ' + show(names) + ' | linkCollab.tools.names: ' + show(world.collab?.names ?? null),
        'discovered: ' + show((world.discovery?.successes ?? []).map((entry) => entry.tool + ' ' + entry.shape + ' -> ' + entry.state)),
        'producer record: ' + (world.record?.present === true ? world.record.path + ' (present)' : show(world.record?.path ?? null) + ' (absent: the gate discovered the pair by behaviour alone)'),
      ])
  }

  // 2 ------------------------------------------------------------------------
  {
    const issues = []
    const row = world.askRow
    if (world.calls?.ask?.ok !== true) issues.push('the asking tool did not answer: ' + show(world.calls?.ask?.error ?? null))
    if (world.askGained !== 1) issues.push('the call added ' + show(world.askGained) + ' row(s) to control.jsonl, not one')
    if (row === null) issues.push('no row was there to inspect')
    else {
      if (row.kind !== world.kind) issues.push('the row is kind ' + show(row.kind) + ', not ' + show(world.kind))
      const payload = row.payload ?? {}
      if (payload.from !== LEAD_A) issues.push('payload.from is ' + show(payload.from) + ', not ' + show(LEAD_A))
      if (payload.to !== LEAD_B) issues.push('payload.to is ' + show(payload.to) + ', not ' + show(LEAD_B))
      if (payload.request !== REQUEST) issues.push('payload.request is ' + show(payload.request) + ', not ' + show(REQUEST))
      if (payload.state !== 'requested') issues.push('payload.state is ' + show(payload.state) + ', not ' + show('requested'))
      if (world.expectedSubject !== null && row.subject !== world.expectedSubject) issues.push('subject is ' + show(row.subject) + ' while the shipped builder builds ' + show(world.expectedSubject) + ' for the same four fields')
    }
    const returned = world.askReturn ?? {}
    if (returned.ok !== true) issues.push('the asking tool returned nothing usable: ' + show(returned.error ?? null))
    else {
      if (returned.json === null) issues.push('the value the asking tool returned cannot be serialised, so no model could read it')
      if (row !== null && returned.seq !== row.seq) issues.push('the answer carries seq ' + show(returned.seq) + ' while the file row is seq ' + show(row?.seq ?? null))
      const missing = [LEAD_A, LEAD_B, REQUEST, 'requested'].filter((needle) => (returned.values ?? []).includes(needle) === false)
      if (missing.length > 0) issues.push('the value the tool returned does not carry ' + show(missing) + ' (it says ' + clip(returned.json, 160) + ')')
    }
    add('2-the-asking-tool-writes-the-request-row-it-returns', issues.length === 0,
      issues.length === 0
        ? 'one call appended exactly one row - seq ' + show(row.seq) + ', subject ' + show(row.subject) + ', payload ' + show(row.payload) + ' - and the returned value carries that seq and those four values'
        : issues.join(' | '),
      ['the row: ' + show(row), 'the answer: ' + clip(world.askReturn?.json, 200)])
  }

  // 3 ------------------------------------------------------------------------
  {
    const issues = []
    const asked = world.fold?.afterAsk ?? {}
    if (asked.table?.ok !== true) issues.push('the fold threw: ' + show(asked.table?.error ?? null))
    if (asked.mayForward !== false) issues.push('a REQUEST was already permission: mayExchange(from,to) answered ' + show(asked.mayForward) + ' before any grant')
    if (asked.mayReverse !== false) issues.push('mayExchange(reverse) answered ' + show(asked.mayReverse) + ' before any grant')
    if (same(asked.pendingAtAsked ?? [], [LEAD_A + '->' + LEAD_B + ':requested']) !== true) issues.push('the lead that was asked does not see the request pending: pendingRequests answered ' + show(asked.pendingAtAsked ?? null))
    if (same(asked.pendingAtAsker ?? [], []) !== true) issues.push('the asking lead sees its own request as pending on itself: ' + show(asked.pendingAtAsker ?? null))
    if ((asked.table?.pairs ?? []).length !== 1) issues.push('the table holds ' + show((asked.table?.pairs ?? []).length) + ' row(s) after one request, not one')
    const granted = world.fold?.afterGrant ?? {}
    if (world.grantGained !== 1) issues.push('the granting call added ' + show(world.grantGained) + ' row(s), not one')
    if (granted.mayForward !== true) issues.push('after the grant, mayExchange(from,to) is ' + show(granted.mayForward) + ', not true')
    if (granted.mayReverse !== false) issues.push('the grant leaked to the reverse pair: mayExchange(to,from) is ' + show(granted.mayReverse) + ', not false')
    if (same(granted.pendingAtAsked ?? [], []) !== true) issues.push('the granted pair still shows as pending: ' + show(granted.pendingAtAsked ?? null))
    const pairs = granted.table?.pairs ?? []
    if (pairs.length !== 1) issues.push('after the grant the table holds ' + show(pairs.length) + ' rows for one ordered pair; a permission is one row per ordered pair')
    else if (pairs[0].state !== 'granted') issues.push('the pair\'s state is ' + show(pairs[0].state) + ', not granted')
    add('3-requested-is-not-permission-and-only-the-named-direction-is-granted', issues.length === 0,
      issues.length === 0
        ? 'requested: may(' + LEAD_A + '->' + LEAD_B + ')=' + show(asked.mayForward) + ' may(' + LEAD_B + '->' + LEAD_A + ')=' + show(asked.mayReverse) + ' pending=' + show(asked.pendingAtAsked) + '; granted: may(' + LEAD_A + '->' + LEAD_B + ')=' + show(granted.mayForward) + ' may(' + LEAD_B + '->' + LEAD_A + ')=' + show(granted.mayReverse)
        : issues.join(' | '),
      ['the table after the request: ' + clip(asked.table?.text, 200), 'the table after the grant: ' + clip(granted.table?.text, 200)])
  }

  // 4 ------------------------------------------------------------------------
  {
    const issues = []
    const denied = world.fold?.afterDeny ?? {}
    if (world.denyGained !== 1) issues.push('the denying call added ' + show(world.denyGained) + ' row(s), not one')
    if (denied.mayForward !== false) issues.push('a denial did not clear the grant: mayExchange(from,to) is still ' + show(denied.mayForward))
    const pairs = denied.table?.pairs ?? []
    if (pairs.length !== 1) issues.push('after the denial the table holds ' + show(pairs.length) + ' row(s) for the pair, not one')
    else {
      if (pairs[0].state !== 'denied') issues.push('the pair\'s state is ' + show(pairs[0].state) + ', not denied')
      if (world.denyRow !== null && pairs[0].seq !== world.denyRow.seq) issues.push('the surviving row is seq ' + show(pairs[0].seq) + ' while the denial the tool wrote is seq ' + show(world.denyRow.seq))
    }
    add('4-a-denial-clears-an-earlier-grant', issues.length === 0,
      issues.length === 0
        ? 'granted, then denied: may(' + LEAD_A + '->' + LEAD_B + ')=' + show(denied.mayForward) + ' and the one row for the pair is ' + clip(denied.table?.text, 120)
        : issues.join(' | '),
      ['the table after the denial: ' + clip(denied.table?.text, 200), 'the denial row: ' + show(world.denyRow)])
  }

  // 5 ------------------------------------------------------------------------
  {
    const issues = []
    const forward = world.fold?.afterDeny?.table ?? {}
    const reversed = world.fold?.reversed ?? {}
    if (forward.ok !== true || reversed.ok !== true) issues.push('a fold threw: ' + show(forward.error ?? reversed.error ?? null))
    if (reversed.text !== forward.text) issues.push('the same rows folded in reverse answered ' + clip(reversed.text, 120) + ' instead of ' + clip(forward.text, 120))
    const minusDeny = world.fold?.minusDeny ?? {}
    const onlyRequest = world.fold?.onlyRequest ?? {}
    const renumbered = world.fold?.renumbered ?? {}
    if ((minusDeny.pairs ?? [])[0]?.state !== 'granted') issues.push('dropping the denial row left the pair as ' + show((minusDeny.pairs ?? [])[0]?.state ?? null) + ', not granted: the fold is not reading the rows the tools wrote')
    if ((onlyRequest.pairs ?? [])[0]?.state !== 'requested') issues.push('dropping both answers left the pair as ' + show((onlyRequest.pairs ?? [])[0]?.state ?? null) + ', not requested')
    const expected = world.fold?.renumberedExpected ?? { state: null, seq: null }
    if ((renumbered.pairs ?? [])[0]?.state !== expected.state) issues.push('with the rows renumbered so the denial has the LOWEST seq, the fold answered ' + show((renumbered.pairs ?? [])[0]?.state ?? null) + ' instead of ' + show(expected.state) + ': the winner is not decided by seq')
    if ((renumbered.pairs ?? [])[0]?.seq !== expected.seq) issues.push('the renumbered fold kept seq ' + show((renumbered.pairs ?? [])[0]?.seq ?? null) + ' instead of the highest ' + show(expected.seq))
    const own = world.ownLedger ?? {}
    if (own.written !== true) issues.push('the ledger this gate wrote by hand could not be opened: ' + show(own.error ?? null))
    const ownPairs = own.table?.pairs ?? []
    if (ownPairs.length !== 1 || ownPairs[0]?.state !== 'denied' || ownPairs[0]?.from !== LEAD_C) issues.push('a ledger with no tool involved folded to ' + clip(own.table?.text, 120) + ', not one denied row for ' + LEAD_C + ' -> ' + LEAD_D)
    if (own.may !== false) issues.push('the hand-written ledger answers mayExchange ' + show(own.may) + ', not false for its denied pair')
    add('5-two-rows-of-one-pair-are-decided-by-seq-and-the-arrangement-does-not-matter', issues.length === 0,
      issues.length === 0
        ? 'reversed rows answer the same table; dropping the denial gives granted and dropping both answers gives requested; renumbering the same three rows so the denial is first makes the fold answer requested - the highest seq decides, not the word; and a ledger this gate wrote itself folds to its own highest seq (' + clip(own.table?.text, 100) + ')'
        : issues.join(' | '),
      ['forward: ' + clip(forward.text, 160), 'reversed: ' + clip(reversed.text, 160), 'minus the denial: ' + clip(minusDeny.text, 120), 'only the request: ' + clip(onlyRequest.text, 120), 'the same rows renumbered (denial first): ' + clip(renumbered.text, 120), 'the gate\'s own ledger: ' + clip(own.table?.text, 160)])
  }

  // 6 ------------------------------------------------------------------------
  {
    const issues = []
    const refusals = world.refusals ?? []
    if (refusals.length === 0) issues.push('the refusal batch was never driven, so nothing was measured')
    const unnamed = refusals.filter((entry) => entry.ok !== true)
    if (unnamed.length > 0) issues.push(String(unnamed.length) + ' malformed call(s) were not refused: ' + show(unnamed.map((entry) => entry.id)))
    const bare = refusals.filter((entry) => entry.ok === true && entry.code === null)
    if (bare.length > 0) issues.push(String(bare.length) + ' refusal(s) lead with no rule name (so the model reads a bare error): ' + show(bare.map((entry) => entry.id + ' -> ' + clip(entry.message, 60))))
    if (world.refusalRepeat?.sameAsFirst !== true) issues.push('the same malformed call answered ' + show(world.refusalRepeat?.code ?? null) + ' the second time and ' + show(refusals[2]?.code ?? null) + ' the first')
    const before = world.ledger?.beforeRefusals ?? {}
    const after = world.ledger?.afterRefusals ?? {}
    if (before.text !== after.text) issues.push('the ledger moved across the refusal batch: ' + show(before.bytes) + ' -> ' + show(after.bytes) + ' bytes (' + show(before.rows?.length) + ' -> ' + show(after.rows?.length) + ' rows)')
    const codes = [...new Set(refusals.map((entry) => entry.code).filter((code) => code !== null))].sort()
    add('6-bad-inputs-are-refused-by-name-and-the-ledger-does-not-move', issues.length === 0,
      issues.length === 0
        ? String(refusals.length) + ' malformed calls, every one refused with a UPPER-CASE rule name leading the message (' + show(codes) + '), the same call twice answering the same name, and control.jsonl byte-identical across the batch (' + show(before.bytes) + ' B, ' + show(before.rows?.length) + ' rows)'
        : issues.join(' | '),
      refusals.slice(0, 6).map((entry) => entry.id + ' -> ' + show(entry.code) + ' ' + clip(entry.message, 90)))
  }

  // 7 ------------------------------------------------------------------------
  {
    const issues = []
    const cross = world.crossWriter ?? {}
    const a = cross.foldA ?? {}
    const b = cross.foldB ?? {}
    if (cross.error !== undefined) issues.push('the cross-writer world threw: ' + show(cross.error))
    if (cross.ask?.ok !== true) issues.push('the asking tool did not answer in the relaying world: ' + show(cross.ask?.error ?? null))
    if (cross.rowsEqual !== true) issues.push('the two logs do not hold the same records after the relay: A ' + show(cross.held?.a ?? null) + ' vs B ' + show(cross.held?.b ?? null))
    if (a.table?.ok !== true || b.table?.ok !== true) issues.push('a fold threw: ' + show(a.table?.error ?? b.table?.error ?? null))
    if (a.table?.text !== b.table?.text) issues.push('the two logs folded the same handshake to different tables: A ' + clip(a.table?.text, 120) + ' vs B ' + clip(b.table?.text, 120))
    if (a.mayForward !== true || b.mayForward !== true) issues.push('the granted pair is not allowed in both logs: A ' + show(a.mayForward) + ', B ' + show(b.mayForward))
    if (a.mayReverse !== false || b.mayReverse !== false) issues.push('the reverse pair is allowed somewhere: A ' + show(a.mayReverse) + ', B ' + show(b.mayReverse))
    const pairWriters = [...new Set([...(cross.aRows?.pairWriters ?? []), ...(cross.bRows?.pairWriters ?? [])])].sort()
    if (pairWriters.length !== 2) issues.push('the two logs do not hold rows from exactly two writers: ' + show([cross.aRows?.pairWriters ?? null, cross.bRows?.pairWriters ?? null]))
    const deg = cross.degenerate ?? {}
    if (deg.rowsEqual !== true) issues.push('the two concurrent logs do not hold the same records: ' + show(deg.rowsEqual ?? null))
    if (deg.bothStatesAreTheRows !== true) issues.push('a concurrent log answered with a state that is neither row: ' + show(deg.answers ?? null))
    if (deg.ownOrderHolds !== true) issues.push('a concurrent log did not answer its own file order\'s last row: answers ' + show(deg.answers ?? null) + ' vs own order ' + show(deg.ownOrder ?? null))
    add('7-two-logs-write-one-row-each-and-both-fold-the-same-handshake', issues.length === 0,
      issues.length === 0
        ? 'the request written by the tool and the grant written by a second log relay both ways, both logs hold ' + show(cross.held?.a ?? null) + ', and both fold ' + clip(a.table?.text, 120) + ' (may forward ' + show(a.mayForward) + '/' + show(b.mayForward) + ', reverse ' + show(a.mayReverse) + '/' + show(b.mayReverse) + ')' + (deg.agrees === true ? '' : '; the concurrent same-pair case is measured beside it: the two logs answer ' + show(deg.answers ?? null) + ' - each its own arrival order, the fold\'s own rule')
        : issues.join(' | '),
      (cross.steps ?? []).map((step) => 'relay: ' + step).concat([
        'A holds ' + show(cross.aRows?.pairWriters ?? null) + ' | B holds ' + show(cross.bRows?.pairWriters ?? null),
        'B\'s table: ' + clip(b.table?.text, 160),
        'concurrent same-pair: C ' + show(deg.answers?.[0] ?? null) + ' / D ' + show(deg.answers?.[1] ?? null) + (deg.agrees === true ? ' (they agree here)' : ' (they differ: local arrival order decides, and two logs that never saw each other share no order)'),
      ]))
  }

  // 8 ------------------------------------------------------------------------
  {
    const issues = []
    const restart = world.restart ?? {}
    if (restart.copied !== true) issues.push('the ledger could not be copied and reopened: ' + show(restart.error ?? null))
    if (restart.rows !== (world.ledger?.afterDeny?.rows?.length ?? null)) issues.push('the reopened copy holds ' + show(restart.rows) + ' row(s) while the file it was copied from held ' + show(world.ledger?.afterDeny?.rows?.length ?? null))
    if (restart.fold?.ok !== true) issues.push('the reopened log did not fold: ' + show(restart.fold?.error ?? null))
    if (restart.fold?.text !== restart.liveFold?.text) issues.push('the reopened copy folded ' + clip(restart.fold?.text, 120) + ' while the writing process folded ' + clip(restart.liveFold?.text, 120))
    if (restart.may !== restart.liveMay) issues.push('the reopened copy answers mayExchange ' + show(restart.may) + ' while the writing process answers ' + show(restart.liveMay))
    add('8-the-permission-is-in-the-file-and-a-reopened-log-answers-the-same', issues.length === 0,
      issues.length === 0
        ? 'a copy of control.jsonl opened as a new log with no tools attached reads ' + show(restart.rows) + ' row(s), folds the same table and answers mayExchange the same way (' + show(restart.may) + ')'
        : issues.join(' | '),
      ['live: ' + clip(restart.liveFold?.text, 160) + ' | may ' + show(restart.liveMay), 'reopened: ' + clip(restart.fold?.text, 160) + ' | may ' + show(restart.may)])
  }

  return readings
}

// ---------------------------------------------------------------------------
// The self-attack: mutate the MEASURED world, one reading per mutant
// ---------------------------------------------------------------------------

const mutants = (world) => {
  const clone = () => structuredClone(world)
  return [
    {
      name: 'the-asking-tool-answers-a-seq-the-file-does-not-carry',
      mustRedden: ['2-the-asking-tool-writes-the-request-row-it-returns'],
      world: (() => { const next = clone(); next.askReturn.seq = (next.askRow?.seq ?? 0) + 1; return next })(),
    },
    {
      name: 'the-asking-tool-answers-a-stranger-pair',
      mustRedden: ['2-the-asking-tool-writes-the-request-row-it-returns'],
      world: (() => { const next = clone(); next.askReturn.values = next.askReturn.values.filter((value) => value !== LEAD_B); return next })(),
    },
    {
      name: 'a-request-already-counts-as-a-permission',
      mustRedden: ['3-requested-is-not-permission-and-only-the-named-direction-is-granted'],
      world: (() => { const next = clone(); next.fold.afterAsk.mayForward = true; return next })(),
    },
    {
      name: 'granting-one-direction-grants-the-reverse',
      mustRedden: ['3-requested-is-not-permission-and-only-the-named-direction-is-granted'],
      world: (() => { const next = clone(); next.fold.afterGrant.mayReverse = true; return next })(),
    },
    {
      name: 'a-denial-does-not-clear-the-grant',
      mustRedden: ['4-a-denial-clears-an-earlier-grant'],
      world: (() => { const next = clone(); next.fold.afterDeny.mayForward = true; return next })(),
    },
    {
      name: 'the-fold-keeps-the-first-row-instead-of-the-highest-seq',
      mustRedden: ['5-two-rows-of-one-pair-are-decided-by-seq-and-the-arrangement-does-not-matter'],
      world: (() => { const next = clone(); next.fold.reversed.text = 'the fold answered a different table'; return next })(),
    },
    {
      name: 'the-fold-lets-a-denial-win-by-its-word-rather-than-its-seq',
      mustRedden: ['5-two-rows-of-one-pair-are-decided-by-seq-and-the-arrangement-does-not-matter'],
      world: (() => { const next = clone(); next.fold.renumbered = { ok: true, pairs: [{ from: LEAD_A, to: LEAD_B, request: REQUEST, state: 'denied', seq: 1 }], text: 'mutant', error: null }; return next })(),
    },
    {
      name: 'the-fold-drops-the-row-no-tool-wrote',
      mustRedden: ['5-two-rows-of-one-pair-are-decided-by-seq-and-the-arrangement-does-not-matter'],
      world: (() => { const next = clone(); next.ownLedger.table = { ok: true, pairs: [], text: '[]', error: null }; return next })(),
    },
    {
      name: 'a-refusal-still-appends',
      mustRedden: ['6-bad-inputs-are-refused-by-name-and-the-ledger-does-not-move'],
      world: (() => { const next = clone(); next.ledger.afterRefusals.text = next.ledger.afterRefusals.text + '{"seq":999}\n'; next.ledger.afterRefusals.bytes += 12; next.ledger.afterRefusals.rows = next.ledger.afterRefusals.rows.concat([{ seq: 999 }]); return next })(),
    },
    {
      name: 'a-refusal-names-nothing',
      mustRedden: ['6-bad-inputs-are-refused-by-name-and-the-ledger-does-not-move'],
      world: (() => { const next = clone(); next.refusals[0].code = null; next.refusals[0].message = 'invalid input'; return next })(),
    },
    {
      name: 'the-same-malformed-call-answers-a-different-name-the-second-time',
      mustRedden: ['6-bad-inputs-are-refused-by-name-and-the-ledger-does-not-move'],
      world: (() => { const next = clone(); next.refusalRepeat.sameAsFirst = false; next.refusalRepeat.code = 'SOMETHING_ELSE'; return next })(),
    },
    {
      name: 'the-second-log-never-sees-the-answer',
      mustRedden: ['7-two-logs-write-one-row-each-and-both-fold-the-same-handshake'],
      world: (() => { const next = clone(); next.crossWriter.foldB.table = { ok: true, pairs: [{ from: LEAD_C, to: LEAD_D, request: REQUEST, state: 'requested', seq: 1 }], text: 'mutant', error: null }; next.crossWriter.foldB.mayForward = false; return next })(),
    },
    {
      name: 'the-cross-writer-relay-loses-a-record',
      mustRedden: ['7-two-logs-write-one-row-each-and-both-fold-the-same-handshake'],
      world: (() => { const next = clone(); next.crossWriter.held = { a: ['gate-r182-peer-b/1'], b: [] }; next.crossWriter.rowsEqual = false; return next })(),
    },
    {
      name: 'the-copied-ledger-loses-the-grant',
      mustRedden: ['8-the-permission-is-in-the-file-and-a-reopened-log-answers-the-same'],
      world: (() => { const next = clone(); next.restart.fold = { ok: true, pairs: [], text: '[]', error: null }; next.restart.may = false; return next })(),
    },
    {
      name: 'control-nothing-changed',
      mustRedden: [],
      world: clone(),
    },
  ]
}

const loadModule = async () => {
  try { return await import(pathToFileURL(MODULE_PATH).href) } catch (error) {
    console.log('SKIP: importing ' + MODULE_PATH + ' threw: ' + String(error && error.message ? error.message : error))
    return null
  }
}
const cleanup = (world, keep) => {
  if (keep === true) { console.log('        kept: ' + show(world.roots ?? [])); return }
  for (const root of world.roots ?? []) { try { rmSync(root, { recursive: true, force: true }) } catch { /* the temp world is disposable */ } }
}

const runSelfAttack = async (started) => {
  const module = await loadModule()
  if (module === null) return 3
  const collected = await collect(module)
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); return 3 }
  const world = collected.world
  const base = judge(world, module)
  const baseRed = base.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  baseline in this world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' failed')
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed) + ' (a mutant declared against a reading that is already red proves nothing)')
    cleanup(world, KEEP)
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
  cleanup(world, KEEP)
  return failures === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const started = Date.now()
  if (SELF_ATTACK) return await runSelfAttack(started)
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
  cleanup(collected.world, KEEP)
  return failed.length > 0 ? 1 : 0
}

process.exitCode = await main()
