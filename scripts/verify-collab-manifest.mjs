#!/usr/bin/env node
/**
 * Gate 111 (R183-P4) - collab-manifest: ONE END SAYS WHAT IT CAN DO, THE ROAD DECIDES HOW MUCH OF IT
 * ARRIVES, AND THE KEYS THAT CROSS ARE OURS ALONE.
 *
 * Subject: the manifest half of R183 (docs/handoff/R183-contract.md sections 3.1/3.2, judgement
 * section 6.3 #1-#2), shipped in plugins/dsh-link-collab/lib/index.js. Written by a verifier who did
 * not write the plugin. The worlds below are BUILT by calling apply() on the shipped artifact with a
 * ctx that publishes a tools registry the way the kernel composes it; every ledger is a real
 * control.jsonl under this gate OWN temp directory, and every number is this gate OWN arithmetic over
 * the bytes it reads itself - never a fixture the plugin also produces, and never the plugin own
 * report of what it did.
 *
 * THE MANIFEST HAS NO TOOL, AND THIS GATE MEASURES THAT RATHER THAN ASSUMING IT. R183 records the
 * deviation in as many words (the manifest is written by the function pair manifestRecord /
 * appendManifest, the refusal happens before append, the ledger does not move). So the face reading
 * is behavioural in both directions: the gate calls every tool the registry holds with a bounded set
 * of argument shapes - hand-written, plus a shape carrying exactly the manifest field names - and
 * counts the calls that appended a row of kind end/manifest. Zero of them is the shipped shape and a
 * tool that starts writing manifests reddens this gate by name. The spelling of the record pair and
 * of the three folds IS written down here, because the round froze those spellings; what is
 * discovered by behaviour is the write FACE and the broker facade.
 *
 * Eight readings, each of which can fail on its own evidence:
 *
 *   1-the-manifest-write-face-is-a-function-pair-and-the-four-fields-land
 *                                            In a fresh world, apply() publishes linkCollab over an
 *                                            EMPTY control.jsonl, the published face carries broker
 *                                            with keys/call/lastCode, and NO tool in the registry
 *                                            appended an end/manifest row for any shape tried (the
 *                                            registry whole face is printed, and a registry holding
 *                                            no tool at all reddens rather than passing quietly).
 *                                            Then three appendManifest calls each add EXACTLY ONE row:
 *                                            kind, subject (the end), payload.end, payload.via (the
 *                                            next hop, null when omitted), payload.platform,
 *                                            payload.protocolVersion, the deduplicated sorted
 *                                            capabilities and payload.at must all be the values the
 *                                            caller gave, and the value the call RETURNS must carry
 *                                            the seq the FILE gave that row. What the caller reads
 *                                            and what the ledger holds are compared field by field.
 *   2-the-manifest-table-does-not-depend-on-the-arrival-order
 *                                            (a) ONE records array folded forward, reversed and
 *                                            shuffled answers byte-identical tables, sequence
 *                                            included. (b) THREE real relay batches pushed into TWO
 *                                            real logs in two different arrival orders fold to the
 *                                            same TABLE OF FACTS (end/via/platform/protocolVersion/
 *                                            capabilities/declared/at) with the same row count - only
 *                                            the arrival sequence differs, and both sequences are
 *                                            printed as evidence. A relay assigns its own arrival
 *                                            order; that is the ledger being honest, not a wobble,
 *                                            and the reading says so instead of hiding behind a
 *                                            comparison that could not have passed.
 *   3-names-outside-the-registry-are-refused-by-name-and-the-ledger-does-not-move
 *                                            A batch of malformed appendManifest calls - the closed
 *                                            set of capabilities among them - must each be refused
 *                                            with an UPPER-CASE MANIFEST_ rule name leading the
 *                                            message (MANIFEST_INPUT / END / VIA / VERSION /
 *                                            CAPABILITY / PLATFORM / AT), the same call twice
 *                                            answering the same name, and control.jsonl must be
 *                                            byte-identical across the whole batch: the bytes, the sha
 *                                            256 and the row count are each counted once before and
 *                                            once after. Paired with it: a call whose names are all
 *                                            in the registry adds exactly ONE row and every name
 *                                            lands - a refusal that still appends, or an acceptance
 *                                            that lands nothing, reddens here.
 *   4-the-decay-is-the-meet-of-every-hop-and-every-break-is-named
 *                                            A->B->C intersects hop by hop, and the gate computes
 *                                            that intersection ITSELF from the manifests before
 *                                            comparing. A hop with no manifest is NO_MANIFEST, the
 *                                            far end going quiet is PEER_SILENT, a middle hop going
 *                                            quiet is ROUTE_DOWN with the break NAMED, and the two are
 *                                            never merged into one word. The threshold is inclusive:
 *                                            a beat EXACTLY timeoutMs old is silent, one millisecond
 *                                            inside the line is not, and the road is whole again.
 *                                            Naming the local end adds it as a hop; leaving it out
 *                                            starts the path at the farthest hop that declared a
 *                                            manifest - the path has ONE owner.
 *   5-a-name-this-build-cannot-read-is-counted-and-never-offered
 *                                            Paired: a clean world counts malformed 0; a world whose
 *                                            ledger carries a manifest naming a capability nobody
 *                                            declared counts ONE more malformed, still shows that
 *                                            end row, keeps the name in its declared list, and does
 *                                            NOT put it in capabilities and NOT in any broker key -
 *                                            while the readable name on the same row still lands and
 *                                            still gets its key. "Cannot read it" is never translated
 *                                            into "it offers nothing", and never into "it offers it".
 *   6-the-key-space-has-one-writer-and-the-broker-answers-inside-six-words
 *                                            brokerKeys must answer exactly the set THIS GATE computes
 *                                            from the fold (each far end x the meet of its road), every
 *                                            key is remote:<end>:<providerKey> and nothing else, and
 *                                            the local end own capabilities are NOT in the key space.
 *                                            Then one reading each for ok, unknown-key, not-granted,
 *                                            no-provider and provider-silent, every code observed
 *                                            inside the six-word closed set, all six observed; and the
 *                                            published facade answers the same list and remembers the
 *                                            last code it returned instead of a second implementation.
 *                                            The key is ONE STRING MATCHED WHOLE: an end whose own NAME
 *                                            carries the separator still gets its key and is answered
 *                                            not-granted (the ledger holds it, only the handshake is
 *                                            missing), where a reader that split the key on its
 *                                            separator would answer unknown-key - and a key cut short
 *                                            matches nothing at all.
 *   7-a-key-that-was-listed-goes-gone-and-the-call-becomes-service-gone
 *                                            The paired reading md:382 asks for, four times over. In
 *                                            the whole world one key is LISTED and answers ok; then,
 *                                            at the same instant and for the SAME key: the relay end
 *                                            manifest is withdrawn (NO_MANIFEST), the far end goes over
 *                                            the threshold (PEER_SILENT), a middle hop does
 *                                            (ROUTE_DOWN), and a name the road did not carry is left
 *                                            out of the meet (meet:...) - and in every one of the four
 *                                            the key is GONE from brokerKeys while brokerCall answers
 *                                            service-gone, never unknown-key and never no-provider. A
 *                                            key whose own end never declared anything is measured
 *                                            beside it as unknown-key, so the two are told apart
 *                                            rather than conflated.
 *   8-a-call-the-vocabulary-cannot-answer-throws-a-typeerror
 *                                            A call the six-word vocabulary cannot answer - a blank or
 *                                            non-string key, a missing localEnd, a missing threshold, a
 *                                            non-finite instant - throws a TypeError rather than
 *                                            answering: no default success and no default failure. Each
 *                                            one is measured with the argument supplied beside it, and
 *                                            that paired call is answered with a code inside the closed
 *                                            set instead of throwing, so "refuses" and "cannot answer"
 *                                            are told apart.
 *
 * Self-attack: --self-attack measures the live world ONCE and then mutates THAT measured world in
 * memory, one mutation per mutant, asserting each mutant reddens exactly its declared readings and
 * nothing else, plus a control mutant that changes nothing. It prints the Chinese sentence
 * '声明集 == 观测集' for every mutant and then the COVERAGE MATRIX: how many mutants declare each
 * reading, with every reading required to be covered by at least one. Mutating the measured world
 * rather than a hand-written fixture is deliberate: a fixture only proves the judge agrees with
 * itself.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject could not be built here: the module
 * does not import, the R183 manifest/broker exports are absent from this build (so there is nothing
 * to measure and the gate says which names are missing rather than judging them), or apply() opened
 * no ledger to count. A reading that cannot be measured is a failure, never a pass; and a subject
 * that is not here is a NAMED third state, never green.
 *
 * Usage: node scripts/verify-collab-manifest.mjs [--module <path>] [--record <path>] [--self-attack] [--keep]
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'plugins', 'dsh-link-collab', 'lib', 'index.js'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..')
})()

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const SELF_ATTACK = has('--self-attack')
const KEEP = has('--keep')
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
/** The producer own record of what it spelled. Read for context, never used as evidence. */
const RECORD_PATH = resolve(option('--record', join(PROJECT, 'docs', 'handoff', 'R183-A-ledger.md')))

/** The names this gate writes into the world: recognisable, so a reader can tell a test fact from a work fact. */
const LOCAL = 'p4-end-A'
const END_B = 'p4-end-B'
const END_C = 'p4-end-C'
const STRANGER = 'p4-end-Z'
const END_X = 'p4-end-X'
const MISSING_END = 'p4-end-D'
const ROAD = 'gate-p4:road'
const FAR = 'gate-p4:far'
const DARK = 'gate-p4:dark'
const OWN = 'gate-p4:own'
const GHOST = 'gate-p4:ghost'
/** An end whose NAME carries the very separator the key format uses: a key is one string, matched whole. */
const COLON_END = 'p4:end:E'
const P_OK = 'p4-ok'
const P_DARK = 'p4-dark'
const OWNER = 'p4-owner'
const TEAM = 'gate-p4-team'
const T0 = 1700000000000
const NOW = 1700000350000
const TIMEOUT_MS = 60000
const FRESH = NOW - 1000
/** sinceMs === timeoutMs exactly: the equality belongs to out of bounds, the same rule as sinceMs >= timeoutMs. */
const AT_THE_LINE = NOW - TIMEOUT_MS
/** One millisecond inside it. */
const INSIDE_THE_LINE = NOW - TIMEOUT_MS + 1
/** The six words the broker answers with (contract 3.2). Nothing else may ever be returned. */
const CLOSED_CODES = ['ok', 'unknown-key', 'no-provider', 'provider-silent', 'not-granted', 'service-gone']
/** The three words a missing hop may be named with. Nothing else may ever be named. */
const MISSING_CODES = ['NO_MANIFEST', 'PEER_SILENT', 'ROUTE_DOWN']
const MANIFEST_RULES = ['MANIFEST_INPUT', 'MANIFEST_END', 'MANIFEST_VIA', 'MANIFEST_VERSION', 'MANIFEST_CAPABILITY', 'MANIFEST_PLATFORM', 'MANIFEST_AT']

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const clip = (text, width) => { const s = String(text === undefined || text === null ? '' : text); return s.length <= width ? s : s.slice(0, width) + '...' }
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const errorNameOf = (error) => (error !== null && error !== undefined && error.name !== undefined ? String(error.name) : null)
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
const keyFor = (end, providerKey) => 'remote:' + end + ':' + providerKey
/** The rule name a refusal leads with: the registry renders a thrown error as 'Error: <code>: <detail>'. */
const firstCode = (message) => {
  const match = /^\s*([A-Z][A-Z0-9_]{2,})\b/.exec(String(message === undefined || message === null ? '' : message))
  return match === null ? null : match[1]
}

// ---------------------------------------------------------------------------
// The ledger file, counted by this gate
// ---------------------------------------------------------------------------

/** Read <dir>/control.jsonl and parse it here: bytes, sha and row count are this gate own arithmetic. */
const readLedger = (dir) => {
  const path = join(dir, 'control.jsonl')
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch { return { path, rows: [], text: '', bytes: 0, lines: 0, sha: null, present: false, unreadable: 0 } }
  const raw = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const rows = []
  let unreadable = 0
  for (const line of raw) {
    try { rows.push(JSON.parse(line)) } catch { unreadable += 1 }
  }
  return { path, rows, text, bytes: Buffer.byteLength(text), lines: raw.length, sha: sha256(text), present: true, unreadable }
}
/** The four numbers the byte-accounting readings compare, each counted on its own. */
const counter = (ledger) => ({ bytes: ledger.bytes, rows: ledger.rows.length, lines: ledger.lines, sha: ledger.sha, text: ledger.text })
const counterLine = (at, ledger) => at + ': ' + String(ledger.rows.length) + ' row(s), ' + String(ledger.bytes) + ' B, sha ' + String(ledger.sha)

// ---------------------------------------------------------------------------
// The world: a fresh control log driven through the SHIPPED artifact
// ---------------------------------------------------------------------------

const buildWorld = async (module, label) => {
  const root = mkdtempSync(join(tmpdir(), 'r183-p4-' + label + '-'))
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
    logger: { warn: () => {} }
  }
  const quiet = { log: console.log, error: console.error }
  let applied = null
  try {
    console.log = () => {}
    console.error = () => {}
    module.apply(ctx, {})
    applied = { ok: true, error: null }
  } catch (error) {
    applied = { ok: false, error: describe(error) }
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  const collab = provided.get('linkCollab')
  return { root, home, dir, registry, collab, applied, disposers }
}

const closeWorld = (built) => {
  for (const dispose of built.disposers === undefined ? [] : built.disposers) { try { dispose() } catch { /* the world is being thrown away */ } }
}

// ---------------------------------------------------------------------------
// The road: the rows one end network declares, written through the SHIPPED builders
// ---------------------------------------------------------------------------

/**
 * One road, written through the shipped builders: a capability registry that names every end and two
 * provider members, the hosting facts (one hop per fact, exactly as R44 wrote them), two beats, the
 * manifests, and the handshake that lets this end call the far one. Options bite exactly one fact so
 * every scene differs from the whole world in one place:
 *
 *   skipManifest: <end>  that end never declared itself
 *   beatB / beatC        that end beat at this instant (or never)
 *   ghost                the ledger also carries a manifest naming a capability nobody declared
 */
const writeRoad = async (module, log, protocol, opts = {}) => {
  const bite = opts === undefined ? {} : opts
  const state = () => module.projectTeamState(log.replay())
  const steps = []
  const push = async (record) => { await log.append(record); steps.push(record.kind) }
  await push(module.capabilityRecord(LOCAL, [ROAD, FAR, DARK]))
  await push(module.capabilityRecord(END_B, [ROAD, DARK]))
  await push(module.capabilityRecord(END_C, [ROAD, FAR, DARK]))
  await push(module.capabilityRecord(P_OK, [ROAD]))
  await push(module.capabilityRecord(P_DARK, [DARK]))
  await push(module.capabilityRecord(OWNER, [OWN]))
  for (const id of [P_OK, P_DARK]) {
    await push({ kind: 'member/state', actor: id, subject: id, at: T0, payload: { id, team: TEAM, name: id, state: 'active', role: 'member' } })
  }
  await push(module.hostRecord(LOCAL, LOCAL, null, T0))
  await push(module.hostRecord(END_B, END_B, null, T0))
  await push(module.hostRecord(END_C, END_C, END_B, T0))
  await push(module.hostRecord(P_OK, END_C, END_B, T0))
  // P_DARK is hosted on the far end and its next hop is an end nobody represents: it is declared and
  // alive, and no route reaches it. That is the difference between provider-silent and no-provider.
  await push(module.hostRecord(P_DARK, END_C, MISSING_END, T0))
  await push(module.heartbeatRecord(P_OK, FRESH))
  await push(module.heartbeatRecord(P_DARK, FRESH))
  if (bite.beatB !== undefined) await push(module.heartbeatRecord(END_B, bite.beatB))
  if (bite.beatC !== undefined) await push(module.heartbeatRecord(END_C, bite.beatC))
  const declared = {}
  declared[LOCAL] = [ROAD, FAR, DARK, OWN]
  declared[END_B] = [ROAD, DARK, OWN]
  declared[END_C] = [ROAD, FAR, DARK, OWN]
  const via = {}
  via[LOCAL] = null
  via[END_B] = null
  via[END_C] = END_B
  const manifests = []
  for (const end of [LOCAL, END_B, END_C]) {
    if (bite.skipManifest === end) continue
    const before = log.replay().length
    const written = await module.appendManifest(state(), log, { end, via: via[end], platform: 'dsh', protocolVersion: protocol, capabilities: declared[end], at: T0 })
    manifests.push({ end, written, gained: log.replay().length - before })
  }
  if (bite.ghost === true) {
    // This row is written by the GATE itself, through the shipped log with no builder involved: a
    // peer that declares a name nobody registered (or an older build's row) lands like this, and the
    // fold has to count it rather than read it as "this end offers nothing".
    await log.append({ kind: module.MANIFEST_KIND, subject: END_X, actor: END_X, at: T0, payload: { end: END_X, via: null, platform: 'dsh', protocolVersion: protocol, capabilities: [ROAD, GHOST], at: T0 } })
  }
  if (bite.colonEnd === true) {
    await push(module.capabilityRecord(COLON_END, [ROAD]))
    await push(module.hostRecord(COLON_END, COLON_END, END_B, T0))
    const before = log.replay().length
    const written = await module.appendManifest(state(), log, { end: COLON_END, via: END_B, platform: 'dsh', protocolVersion: protocol, capabilities: [ROAD], at: T0 })
    manifests.push({ end: COLON_END, written, gained: log.replay().length - before })
  }
  if (bite.grant !== false) await push(module.peerRecord(LOCAL, END_C, 'call your provider', 'granted'))
  return { steps, manifests, declared, via }
}

/** A scene: its own directory, its own real control.jsonl, the same road with one fact bitten. */
const openScene = async (module, root, name, protocol, opts = {}) => {
  const dir = join(root, 'scene-' + name)
  mkdirSync(dir, { recursive: true })
  const log = module.openControlLog({ dir, writer: 'gate-p4-' + name, now: () => T0 })
  const road = await writeRoad(module, log, protocol, opts)
  const ledger = readLedger(dir)
  return { name, dir, log, ledger, road, state: module.projectTeamState(ledger.rows) }
}

// ---------------------------------------------------------------------------
// Reading through the shipped folds, over rows this gate parsed
// ---------------------------------------------------------------------------

const readCapabilities = (module, state, end, options, now) => {
  const instant = now === undefined ? NOW : now
  try {
    const reading = module.effectiveCapabilities(state, end, instant, options)
    return { ok: true, end, path: reading.path, capabilities: reading.capabilities, missing: reading.missing, through: reading.through, error: null, errorName: null, isTypeError: false }
  } catch (error) {
    return { ok: false, end, path: [], capabilities: [], missing: [], through: null, error: describe(error), errorName: errorNameOf(error), isTypeError: error instanceof TypeError }
  }
}
const readKeys = (module, state, options) => {
  try {
    return { ok: true, rows: module.brokerKeys(state, NOW, options).map((row) => ({ key: row.key, end: row.end, providerKey: row.providerKey, via: row.via })), error: null }
  } catch (error) {
    return { ok: false, rows: [], error: describe(error) }
  }
}
const readCall = (module, state, key, options) => {
  try {
    const answer = module.brokerCall(state, key, NOW, options)
    return { ok: true, code: answer.code, key: answer.key, end: answer.end === undefined ? null : answer.end, providerKey: answer.providerKey === undefined ? null : answer.providerKey, reason: answer.reason === undefined ? null : answer.reason, error: null, errorName: null, isTypeError: false }
  } catch (error) {
    return { ok: false, code: null, key, end: null, providerKey: null, reason: null, error: describe(error), errorName: errorNameOf(error), isTypeError: error instanceof TypeError }
  }
}
/** A refusal's own name, or nothing: the value a refusal is judged by. */
const refusalOf = (outcome) => ({ threw: outcome.ok === false, code: outcome.ok === false ? firstCode(outcome.error) : null, errorName: outcome.ok === false ? outcome.errorName : null, message: outcome.ok === false ? clip(outcome.error, 140) : clip(show(outcome.value), 140) })
const attempt = (fn) => { try { return { ok: true, value: fn(), error: null, errorName: null, isTypeError: false } } catch (error) { return { ok: false, value: null, error: describe(error), errorName: error !== null && error !== undefined && error.name !== undefined ? String(error.name) : null, isTypeError: error instanceof TypeError } } }
/** The shipped writer is async, so its refusals arrive as a rejected promise: this awaits them. */
const attemptAsync = async (fn) => { try { return { ok: true, value: await fn(), error: null, errorName: null, isTypeError: false } } catch (error) { return { ok: false, value: null, error: describe(error), errorName: error !== null && error !== undefined && error.name !== undefined ? String(error.name) : null, isTypeError: error instanceof TypeError } } }

// ---------------------------------------------------------------------------
// The face: which registered tool writes a manifest row, and what the facade publishes
// ---------------------------------------------------------------------------

/** Hand-written shapes plus one carrying exactly the manifest field names: a manifest tool, if one existed, would answer to this. */
const probeShapes = (definition, protocol) => {
  const out = [
    { id: 'empty-object', args: {} },
    { id: 'a-manifest-shaped-argument-object', args: { end: END_X, via: null, platform: 'dsh', protocolVersion: protocol, capabilities: [ROAD], at: T0 } }
  ]
  const properties = definition === undefined ? null : definition.parameters === undefined ? null : definition.parameters.properties
  if (properties !== null && properties !== undefined && typeof properties === 'object') {
    const args = {}
    let filled = 0
    for (const key of Object.keys(properties)) {
      const name = String(key).toLowerCase()
      let value
      if (/^(team|teamid)$/.test(name)) value = TEAM
      else if (/^(member|memberid|id|by|from|lead|end|self)$/.test(name)) value = LOCAL
      else if (/^(capability|capabilities|name|request|subject|topic|title)$/.test(name)) value = ROAD
      else if (/^(state|status|verdict|decision|answer)$/.test(name)) value = 'requested'
      else if (/^(grant|granted|accept|accepted|approve|approved|allow|allowed)$/.test(name)) value = true
      else if (/^(mode)$/.test(name)) value = 'join'
      else if (/^(at|now|timeoutms|ttlms)$/.test(name)) value = NOW
      if (value !== undefined) { args[key] = value; filled += 1 }
    }
    if (filled > 0) out.push({ id: 'declared-schema', args })
  }
  return out
}

const probeFace = async (module, built, protocol) => {
  const names = [...built.registry.keys()].sort()
  const attempts = []
  const manifestWriters = []
  for (const name of names) {
    const definition = built.registry.get(name)
    for (const shape of probeShapes(definition, protocol)) {
      const before = readLedger(built.dir)
      let outcome = null
      try { outcome = await definition.execute(shape.args) } catch (error) { outcome = { error: describe(error) } }
      const after = readLedger(built.dir)
      const gained = after.rows.slice(before.rows.length)
      const wroteManifest = gained.filter((row) => row.kind === module.MANIFEST_KIND)
      attempts.push({ tool: name, shape: shape.id, gained: gained.length, kinds: [...new Set(gained.map((row) => String(row.kind)))].sort() })
      if (wroteManifest.length > 0) manifestWriters.push(name + ' via ' + shape.id)
    }
  }
  const broker = built.collab === undefined || built.collab === null ? null : built.collab.broker
  return {
    names,
    attempts: attempts.length,
    manifestWriters,
    toolsNames: built.collab !== undefined && built.collab !== null && built.collab.tools !== undefined && built.collab.tools.names !== undefined ? [...built.collab.tools.names].sort() : null,
    toolsAvailable: built.collab !== undefined && built.collab !== null && built.collab.tools !== undefined ? built.collab.tools.available : null,
    namesMentioningManifest: names.filter((name) => /manifest/i.test(name)),
    broker: {
      present: broker !== null && broker !== undefined,
      keys: typeof (broker === undefined || broker === null ? null : broker.keys),
      call: typeof (broker === undefined || broker === null ? null : broker.call),
      lastCode: typeof (broker === undefined || broker === null ? null : broker.lastCode)
    },
    sample: attempts.slice(0, 4)
  }
}

// ---------------------------------------------------------------------------
// Collection: one measured world, plus the scenes that bite it one fact at a time
// ---------------------------------------------------------------------------

const recordEvidence = () => {
  try { return { path: RECORD_PATH, present: true, text: readFileSync(RECORD_PATH, 'utf8') } } catch { return { path: RECORD_PATH, present: false, text: null } }
}

const REQUIRED_EXPORTS = ['MANIFEST_KIND', 'manifestRecord', 'appendManifest', 'projectManifests', 'effectiveCapabilities', 'brokerKeys', 'brokerCall']

const collect = async (module) => {
  const progress = []
  const world = { module: MODULE_PATH, at: Date.now(), roots: [], fatal: null, kind: module.MANIFEST_KIND === undefined ? null : module.MANIFEST_KIND }
  world.exports = {}
  for (const name of REQUIRED_EXPORTS) {
    const value = module[name]
    world.exports[name] = name === 'MANIFEST_KIND' ? (typeof value === 'string' ? value : null) : typeof value
  }
  world.protocols = Array.isArray(module.MANIFEST_PROTOCOLS) ? [...module.MANIFEST_PROTOCOLS] : null
  const absent = REQUIRED_EXPORTS.filter((name) => world.exports[name] === null || world.exports[name] === 'undefined')
  if (absent.length > 0) {
    return { world, progress, fatal: 'this build does not export ' + show(absent) + ' - the R183 manifest/broker layer is not here, so gate 111 has nothing to measure (the shipped module is ' + MODULE_PATH + ')' }
  }
  const protocol = Array.isArray(world.protocols) && world.protocols.length > 0 ? world.protocols[0] : 'dsh-link-device/1'
  world.protocol = protocol
  world.record = recordEvidence()

  // 1 -- the face, in its own world ---------------------------------------------------------------
  const probe = await buildWorld(module, 'probe')
  world.roots.push(probe.root)
  world.face = await probeFace(module, probe, protocol)
  closeWorld(probe)
  progress.push('face: ' + String(world.face.names.length) + ' tool(s) registered, ' + String(world.face.attempts) + ' call(s) tried, ' + String(world.face.manifestWriters.length) + ' of them appended a ' + show(world.kind) + ' row; linkCollab.broker: ' + show(world.face.broker))

  // 2 -- the measured world -----------------------------------------------------------------------
  const built = await buildWorld(module, 'road')
  world.roots.push(built.root)
  world.dir = built.dir
  world.applied = built.applied
  if (built.applied.ok !== true || built.collab === undefined || built.collab === null) {
    return { world, progress, fatal: 'apply() published no linkCollab in this world (' + show(built.applied.error) + '), so there is no ledger and no facade to measure' }
  }
  world.ledger = { initial: counter(readLedger(built.dir)) }
  const road = await writeRoad(module, built.collab.log, protocol, {})
  const afterRoad = readLedger(built.dir)
  world.ledger.afterRoad = counter(afterRoad)
  world.road = { steps: road.steps.length, facts: road.steps.length + road.manifests.length, manifests: road.manifests.map((entry) => ({ end: entry.end, gained: entry.gained, seq: entry.written.seq, returned: entry.written })), declared: road.declared, via: road.via }
  world.manifest = { calls: road.manifests.map((entry) => ({ end: entry.end, gained: entry.gained, row: afterRoad.rows.filter((row) => row.kind === world.kind && row.subject === entry.end).slice(-1)[0] === undefined ? null : afterRoad.rows.filter((row) => row.kind === world.kind && row.subject === entry.end).slice(-1)[0], returned: entry.written })) }
  progress.push('road: ' + counterLine('afterRoad', afterRoad) + ' (3 manifests, ' + String(road.manifests.length) + ' appendManifest call(s))')

  const rows = afterRoad.rows
  const state = module.projectTeamState(rows)
  world.base = { rows: rows.length, through: state.through }
  // The builder on its own: the contract calls the write face a PAIR, so the record module.manifestRecord
  // builds for the same input must be the record the file gained - one answer, not two.
  world.builder = (() => {
    const input = { end: END_C, via: END_B, platform: 'dsh', protocolVersion: protocol, capabilities: road.declared[END_C].concat([ROAD]), at: T0 }
    const outcome = attempt(() => module.manifestRecord(input))
    return { input, ok: outcome.ok, error: outcome.ok ? null : outcome.error, record: outcome.ok ? outcome.value : null, keys: outcome.ok && outcome.value !== null && typeof outcome.value === 'object' ? Object.keys(outcome.value).sort() : null, payloadKeys: outcome.ok && outcome.value !== null && typeof outcome.value === 'object' && typeof outcome.value.payload === 'object' && outcome.value.payload !== null ? Object.keys(outcome.value.payload).sort() : null }
  })()
  const options = { timeoutMs: TIMEOUT_MS, localEnd: LOCAL }

  // 3 -- the fold, one array in three orders ------------------------------------------------------
  const foldText = (records) => { const folded = module.projectManifests(records); return { text: show(folded), malformed: folded.malformed, ends: folded.ends.map((row) => row.end) } }
  const forward = foldText(rows)
  const reversed = foldText([...rows].reverse())
  const shuffled = foldText([...rows].sort((left, right) => (String(left.kind) + String(left.subject) < String(right.kind) + String(right.subject) ? -1 : 1)))
  world.fold = { forwardText: forward.text, reversedText: reversed.text, shuffledText: shuffled.text, forwardMalformed: forward.malformed, forwardEnds: forward.ends }

  // 4 -- two real relay orders --------------------------------------------------------------------
  const ownerOf = (row) => {
    const payload = row.payload === undefined || row.payload === null ? {} : row.payload
    const named = [payload.end, payload.id, row.actor, row.subject]
    for (const end of [LOCAL, END_B, END_C]) if (named.includes(end)) return end
    return null
  }
  const batches = [
    { writer: 'gate-p4-relay-a', instance: 'i-a', rows: rows.filter((row) => ownerOf(row) === LOCAL) },
    { writer: 'gate-p4-relay-b', instance: 'i-b', rows: rows.filter((row) => ownerOf(row) === END_B) },
    { writer: 'gate-p4-relay-c', instance: 'i-c', rows: rows.filter((row) => ownerOf(row) === END_C) },
    { writer: 'gate-p4-relay-d', instance: 'i-d', rows: rows.filter((row) => ownerOf(row) === null) }
  ].map((batch) => ({ writer: batch.writer, instance: batch.instance, records: batch.rows.map((row, at) => ({ seq: at + 1, kind: row.kind, ...row.actor === undefined ? {} : { actor: row.actor }, ...row.subject === undefined ? {} : { subject: row.subject }, ...row.payload === undefined ? {} : { payload: row.payload }, ...row.at === undefined ? {} : { at: row.at } })) }))
  world.orders = { batchRows: batches.map((batch) => batch.records.length), orderA: [END_B, END_C, 'd', 'a'], orderB: ['a', 'd', END_B, END_C] }
  const consume = async (name, order) => {
    const dir = join(built.root, 'reader-' + name)
    mkdirSync(dir, { recursive: true })
    const log = module.openControlLog({ dir, writer: 'gate-p4-reader-' + name, now: () => T0 })
    const steps = []
    for (const token of order) {
      const chosen = token === END_B ? batches[1] : token === END_C ? batches[2] : token === 'a' ? batches[0] : batches[3]
      const outcome = await log.ingest(chosen)
      steps.push(token + '->' + String(outcome.appended))
    }
    const ledger = readLedger(dir)
    await log.close()
    return { dir, ledger, steps, fold: module.projectManifests(ledger.rows) }
  }
  const factsOf = (folded) => folded.ends.map((row) => ({ end: row.end, via: row.via, platform: row.platform, protocolVersion: row.protocolVersion, capabilities: row.capabilities, declared: row.declared, at: row.at }))
  const readerA = await consume('one', world.orders.orderA)
  const readerB = await consume('two', world.orders.orderB)
  world.orders.stepsA = readerA.steps
  world.orders.stepsB = readerB.steps
  world.orders.factsA = factsOf(readerA.fold)
  world.orders.factsB = factsOf(readerB.fold)
  world.orders.factsEqual = same(world.orders.factsA, world.orders.factsB)
  world.orders.rowsA = readerA.ledger.rows.length
  world.orders.rowsB = readerB.ledger.rows.length
  world.orders.malformedA = readerA.fold.malformed
  world.orders.malformedB = readerB.fold.malformed
  world.orders.seqA = readerA.fold.ends.filter((row) => row.end === END_C).map((row) => row.seq)
  world.orders.seqB = readerB.fold.ends.filter((row) => row.end === END_C).map((row) => row.seq)
  world.orders.seqsDiffer = same(world.orders.seqA, world.orders.seqB) === false
  progress.push('relay: ' + String(world.orders.rowsA) + '/' + String(world.orders.rowsB) + ' rows, ' + END_C + ' manifest at local seq ' + show(world.orders.seqA) + ' vs ' + show(world.orders.seqB))

  // 5 -- the decay, and every break named ----------------------------------------------------------
  const scenes = {}
  for (const [name, opts] of [
    ['nomanifest', { skipManifest: END_B }],
    ['far-silent', { beatC: AT_THE_LINE }],
    ['far-inside', { beatC: INSIDE_THE_LINE }],
    ['relay-silent', { beatB: AT_THE_LINE }],
    ['ghost', { ghost: true }],
    ['colon', { colonEnd: true }]
  ]) {
    scenes[name] = await openScene(module, built.root, name, protocol, opts)
  }
  world.scenes = {}
  for (const name of Object.keys(scenes)) world.scenes[name] = { rows: scenes[name].ledger.rows.length, steps: scenes[name].road.steps.length, malformed: scenes[name].state.manifests.malformed }
  world.decay = {
    whole: readCapabilities(module, state, END_C, options),
    withoutLocalEnd: readCapabilities(module, state, END_C, { timeoutMs: TIMEOUT_MS }),
    noManifest: readCapabilities(module, scenes['nomanifest'].state, END_C, options),
    farSilent: readCapabilities(module, scenes['far-silent'].state, END_C, options),
    farInside: readCapabilities(module, scenes['far-inside'].state, END_C, options),
    relaySilent: readCapabilities(module, scenes['relay-silent'].state, END_C, options),
    relayOwnKey: readCall(module, scenes['relay-silent'].state, keyFor(END_B, ROAD), options),
    expected: (() => {
      const lists = [road.declared[LOCAL], road.declared[END_B], road.declared[END_C]]
      const meet = lists[0].filter((name) => lists[1].includes(name) && lists[2].includes(name))
      return [...new Set(meet)].sort()
    })()
  }
  world.decay.codes = [...new Set([world.decay.noManifest, world.decay.farSilent, world.decay.relaySilent].flatMap((reading) => reading.missing.map((entry) => entry.code)))].sort()

  // 6 -- the ghost: a name this build cannot read ------------------------------------------------
  const ghostFold = module.projectManifests(scenes['ghost'].ledger.rows)
  const ghostRow = ghostFold.ends.filter((row) => row.end === END_X)[0] === undefined ? null : ghostFold.ends.filter((row) => row.end === END_X)[0]
  const ghostKeys = readKeys(module, scenes['ghost'].state, options)
  world.ghost = {
    cleanMalformed: forward.malformed,
    bittenMalformed: ghostFold.malformed,
    rowPresent: ghostRow !== null,
    declared: ghostRow === null ? null : ghostRow.declared,
    capabilities: ghostRow === null ? null : ghostRow.capabilities,
    keys: ghostKeys.rows.map((row) => row.key),
    writeRefusal: refusalOf(await attemptAsync(() => module.appendManifest(module.projectTeamState(scenes['ghost'].ledger.rows), scenes['ghost'].log, { end: END_X, via: null, platform: 'dsh', protocolVersion: protocol, capabilities: [ROAD, GHOST], at: T0 }))),
    ghostKeyListed: ghostKeys.rows.some((row) => row.key.includes(GHOST)),
    readableKeyListed: ghostKeys.rows.some((row) => row.key === keyFor(END_X, ROAD))
  }

  // 6b -- the name made of blanks. This gate MEASURED this build accepting one, reported it, and the
  // round froze the refusal (commit 77c4b47: end/via go through a name test that trims, so a name of
  // blanks is refused with the codes that already existed). The batch above now asserts it; this probe
  // stays as the raw reading, and it would read "accepted" again on a build that went back.
  const blankProbe = async (field, value) => {
    const input = { end: MISSING_END, via: END_B, platform: 'dsh', protocolVersion: protocol, capabilities: [ROAD], at: T0 }
    input[field] = value
    const outcome = await attemptAsync(() => module.appendManifest(module.projectTeamState(scenes['ghost'].ledger.rows), scenes['ghost'].log, input))
    return outcome.ok === true ? 'accepted' : String(firstCode(outcome.error))
  }
  world.blankNames = { end: await blankProbe('end', '   '), via: await blankProbe('via', '   '), note: 'blank (three spaces); asserted in the refusal batch since 77c4b47 froze it, and recorded here as the raw reading' }

  // 7 -- the key space, and the six words ---------------------------------------------------------
  const keys = readKeys(module, state, options)
  const expectedKeys = []
  for (const manifest of state.manifests.ends) {
    if (manifest.end === LOCAL) continue
    const reading = readCapabilities(module, state, manifest.end, options)
    if (reading.ok !== true) continue
    if (reading.missing.length > 0) continue
    for (const name of reading.capabilities) expectedKeys.push(keyFor(manifest.end, name))
  }
  expectedKeys.sort()
  const callFor = (key, callOptions) => readCall(module, state, key, callOptions === undefined ? options : callOptions)
  world.broker = {
    local: LOCAL,
    expectedKeys,
    observedKeys: keys.rows.map((row) => row.key),
    rows: keys.rows,
    localKeysListed: keys.rows.some((row) => row.end === LOCAL),
    calls: {
      ok: callFor(keyFor(END_C, ROAD)),
      unknown: callFor(keyFor(STRANGER, ROAD)),
      notGranted: callFor(keyFor(END_B, ROAD)),
      noProvider: callFor(keyFor(END_C, OWN)),
      providerSilent: callFor(keyFor(END_C, DARK))
    },
    facade: { keysOk: null, keys: null, lastCode: null, lastCallCode: null }
  }
  const facade = built.collab.broker
  const facadeKeys = attempt(() => facade.keys(state, NOW, options).map((row) => row.key))
  world.broker.facade.keysOk = facadeKeys.ok
  world.broker.facade.keys = facadeKeys.ok ? facadeKeys.value : null
  const facadeCall = attempt(() => facade.call(state, keyFor(STRANGER, ROAD), NOW, options))
  world.broker.facade.lastCallCode = facadeCall.ok ? facadeCall.value.code : null
  const lastCode = attempt(() => facade.lastCode)
  world.broker.facade.lastCode = lastCode.ok ? lastCode.value : null
  world.broker.codes = [...new Set(Object.values(world.broker.calls).map((call) => call.code))].sort()
  world.broker.codesExpected = ['no-provider', 'not-granted', 'ok', 'provider-silent', 'unknown-key']
  // One string, matched whole: the separator the key format uses appears INSIDE an end name here, so a
  // reader that split the key on ':' would answer unknown-key where the ledger knows this key exactly.
  const colonKeys = readKeys(module, scenes['colon'].state, options).rows.map((row) => row.key)
  world.colon = {
    end: COLON_END,
    key: keyFor(COLON_END, ROAD),
    cut: 'remote:' + COLON_END + ':gate-p4',
    keys: colonKeys,
    listed: colonKeys.includes(keyFor(COLON_END, ROAD)),
    darkListed: colonKeys.includes(keyFor(COLON_END, DARK)),
    call: readCall(module, scenes['colon'].state, keyFor(COLON_END, ROAD), options),
    cutCall: readCall(module, scenes['colon'].state, 'remote:' + COLON_END + ':gate-p4', options)
  }

  // 8 -- the same key, four ways gone -------------------------------------------------------------
  const withdrawn = await openScene(module, built.root, 'withdrawn', protocol, { skipManifest: END_B })
  world.scenes['withdrawn'] = { rows: withdrawn.ledger.rows.length, steps: withdrawn.road.steps.length, malformed: withdrawn.state.manifests.malformed }
  const goneKey = keyFor(END_C, ROAD)
  const listing = (sceneState) => readKeys(module, sceneState, options).rows.map((row) => row.key)
  world.gone = {
    key: goneKey,
    whole: { listed: keys.rows.some((row) => row.key === goneKey), call: { ...world.broker.calls.ok } },
    withdrawn: { listed: listing(withdrawn.state).includes(goneKey), call: readCall(module, withdrawn.state, goneKey, options), stranger: readCall(module, withdrawn.state, keyFor(END_B, ROAD), options) },
    farSilent: { listed: listing(scenes['far-silent'].state).includes(goneKey), call: readCall(module, scenes['far-silent'].state, goneKey, options) },
    relaySilent: { listed: listing(scenes['relay-silent'].state).includes(goneKey), call: readCall(module, scenes['relay-silent'].state, goneKey, options) },
    meetDropped: { declared: state.manifests.ends.filter((row) => row.end === END_C).map((row) => row.declared)[0] === undefined ? null : state.manifests.ends.filter((row) => row.end === END_C).map((row) => row.declared)[0].includes(FAR), listed: keys.rows.some((row) => row.key === keyFor(END_C, FAR)), call: readCall(module, state, keyFor(END_C, FAR), options) },
    farOwnKey: { listed: listing(scenes['far-silent'].state).includes(keyFor(END_C, ROAD)) }
  }

  // 9 -- the calls the vocabulary cannot answer ---------------------------------------------------
  const badPlan = [
    { id: 'empty-key', kind: 'call', run: () => readCall(module, state, '', options) },
    { id: 'key-not-a-string', kind: 'call', run: () => readCall(module, state, 42, options) },
    { id: 'no-local-end', kind: 'call', run: () => readCall(module, state, goneKey, { timeoutMs: TIMEOUT_MS }) },
    { id: 'empty-local-end', kind: 'call', run: () => readCall(module, state, goneKey, { timeoutMs: TIMEOUT_MS, localEnd: '' }) },
    { id: 'no-threshold', kind: 'call', run: () => readCall(module, state, goneKey, { localEnd: LOCAL }) },
    { id: 'no-options-at-all', kind: 'call', run: () => readCall(module, state, goneKey, null) },
    { id: 'end-not-a-string', kind: 'reading', run: () => readCapabilities(module, state, 42, options) },
    { id: 'empty-end', kind: 'reading', run: () => readCapabilities(module, state, '', options) },
    { id: 'no-threshold-for-a-reading', kind: 'reading', run: () => readCapabilities(module, state, END_C, { localEnd: LOCAL }) },
    { id: 'instant-not-a-number', kind: 'reading', run: () => readCapabilities(module, state, END_C, options, 'later') },
    { id: 'instant-not-finite', kind: 'reading', run: () => readCapabilities(module, state, END_C, options, Number.NaN) }
  ]
  world.badCalls = badPlan.map((entry) => ({ id: entry.id, kind: entry.kind, outcome: entry.run() }))
  world.badPairs = [
    { id: 'a-key-with-a-name-is-answered', kind: 'call', outcome: readCall(module, state, goneKey, options) },
    { id: 'a-local-end-is-answered', kind: 'call', outcome: readCall(module, state, keyFor(END_B, ROAD), { timeoutMs: TIMEOUT_MS, localEnd: LOCAL }) },
    { id: 'a-threshold-is-answered', kind: 'call', outcome: readCall(module, state, keyFor(END_C, FAR), options) },
    { id: 'a-named-end-is-answered', kind: 'reading', outcome: readCapabilities(module, state, END_B, options) },
    { id: 'a-finite-instant-is-answered', kind: 'reading', outcome: readCapabilities(module, state, END_C, options, NOW) }
  ]
  world.runCodes = [...new Set(world.broker.codes.concat(['service-gone'], world.gone === undefined ? [] : [world.gone.withdrawn.call.code, world.gone.farSilent.call.code, world.gone.relaySilent.call.code, world.gone.meetDropped.call.code, world.gone.withdrawn.stranger.code]))].sort()

  // 10 -- the refusal batch, with the ledger counted around it ------------------------------------
  const beforeRefusals = readLedger(built.dir)
  world.ledger.beforeRefusals = counter(beforeRefusals)
  const base = { end: MISSING_END, via: END_B, platform: 'dsh', protocolVersion: protocol, capabilities: [ROAD], at: T0 }
  const plan = [
    ['MANIFEST_INPUT', null], ['MANIFEST_INPUT', []], ['MANIFEST_INPUT', 'no'],
    ['MANIFEST_END', { ...base, end: '' }], ['MANIFEST_END', { ...base, end: 42 }], ['MANIFEST_END', { ...base, end: null }], ['MANIFEST_END', { platform: 'dsh', protocolVersion: protocol, capabilities: [ROAD], at: T0 }],
    ['MANIFEST_VIA', { ...base, via: MISSING_END }], ['MANIFEST_VIA', { ...base, via: 42 }], ['MANIFEST_VIA', { ...base, via: '' }], ['MANIFEST_VIA', { ...base, via: {} }],
    ['MANIFEST_VERSION', { ...base, protocolVersion: 'dsh-link-device/2' }], ['MANIFEST_VERSION', { ...base, protocolVersion: 1 }],
    ['MANIFEST_CAPABILITY', { ...base, capabilities: [ROAD, GHOST] }], ['MANIFEST_CAPABILITY', { ...base, capabilities: [] }], ['MANIFEST_CAPABILITY', { ...base, capabilities: [42] }], ['MANIFEST_CAPABILITY', { ...base, capabilities: 'no' }],
    ['MANIFEST_PLATFORM', { ...base, platform: '' }], ['MANIFEST_PLATFORM', { ...base, platform: 7 }],
    ['MANIFEST_AT', { ...base, at: 'now' }], ['MANIFEST_AT', { ...base, at: Number.NaN }],
    // A name made of blanks is not a name: this gate measured the build ACCEPTING one (the same file
    // declaring family refuses it), reported it, and the round froze the refusal in 77c4b47 - so it is
    // pinned here now rather than only recorded.
    ['MANIFEST_END', { ...base, end: '   ' }], ['MANIFEST_VIA', { ...base, via: '   ' }]
  ]
  world.refusals = []
  for (let at = 0; at < plan.length; at += 1) {
    const expected = plan[at][0]
    const input = plan[at][1]
    const outcome = await attemptAsync(() => module.appendManifest(state, built.collab.log, input))
    world.refusals.push({ at, expected, input: clip(show(input), 90), ...refusalOf(outcome) })
  }
  const repeatAt = plan.findIndex((entry) => entry[0] === 'MANIFEST_CAPABILITY')
  const repeatOutcome = await attemptAsync(() => module.appendManifest(state, built.collab.log, plan[repeatAt][1]))
  world.refusalRepeat = { at: repeatAt, code: firstCode(repeatOutcome.error), sameAsFirst: world.refusals[repeatAt].code !== null && firstCode(repeatOutcome.error) === world.refusals[repeatAt].code }
  const afterRefusals = readLedger(built.dir)
  world.ledger.afterRefusals = counter(afterRefusals)

  // 11 -- the paired positive: every name the registry knows lands --------------------------------
  const positiveInput = { end: LOCAL, via: null, platform: 'dsh', protocolVersion: protocol, capabilities: [ROAD, DARK, OWN, ROAD], at: T0 + 1000 }
  const beforePositive = readLedger(built.dir)
  const positiveCall = await attemptAsync(() => module.appendManifest(module.projectTeamState(beforePositive.rows), built.collab.log, positiveInput))
  const afterPositive = readLedger(built.dir)
  const positiveRow = afterPositive.rows[afterPositive.rows.length - 1] === undefined ? null : afterPositive.rows[afterPositive.rows.length - 1]
  world.ledger.afterPositive = counter(afterPositive)
  world.positive = {
    input: positiveInput,
    ok: positiveCall.ok,
    error: positiveCall.ok ? null : positiveCall.error,
    gained: afterPositive.rows.length - beforePositive.rows.length,
    expectedCapabilities: [...new Set(positiveInput.capabilities)].sort(),
    returnedSeq: positiveCall.ok ? positiveCall.value.seq : null,
    rowSeq: positiveRow === null ? null : positiveRow.seq,
    rowCapabilities: positiveRow === null ? null : (positiveRow.payload === undefined ? null : positiveRow.payload.capabilities),
    rowSubject: positiveRow === null ? null : positiveRow.subject,
    returnedCapabilities: positiveCall.ok ? positiveCall.value.capabilities : null
  }

  world.ledger.final = counter(readLedger(built.dir))
  for (const name of Object.keys(scenes)) await scenes[name].log.close()
  await withdrawn.log.close()
  closeWorld(built)
  progress.push('refusals: ' + counterLine('before', beforeRefusals) + ' | ' + counterLine('after', afterRefusals) + ' | positive: ' + counterLine('afterPositive', afterPositive))
  return { world, progress, fatal: null }
}

// ---------------------------------------------------------------------------
// The judge: pure over the measured world, so --self-attack can mutate the world itself
// ---------------------------------------------------------------------------

/** The colon reading: the key is in the listing. Named so the judge stays a pure function of the world. */
const collectedColon = (colon) => colon !== undefined && colon !== null && colon.listed === true

const judge = (world) => {
  const readings = []
  const add = (id, ok, detail, evidence) => readings.push({ id, ok, detail, evidence: Array.isArray(evidence) ? evidence : [] })

  // 1 ------------------------------------------------------------------------
  {
    const issues = []
    const face = world.face === undefined ? {} : world.face
    if (world.applied === undefined || world.applied.ok !== true) issues.push('apply() threw in this world: ' + show(world.applied === undefined ? null : world.applied.error))
    if (world.ledger === undefined || world.ledger.initial.rows !== 0) issues.push('the world did not start empty: control.jsonl already held ' + show(world.ledger === undefined ? null : world.ledger.initial.rows) + ' row(s)')
    if ((face.names === undefined ? [] : face.names).length === 0) issues.push('this world registry holds NO tool at all, so "no tool writes a manifest" would measure nothing')
    if ((face.manifestWriters === undefined ? ['(not measured)'] : face.manifestWriters).length > 0) issues.push('a MODEL-VISIBLE TOOL appended a ' + show(world.kind) + ' row: ' + show(face.manifestWriters) + ' - R183 ships the manifest as a function pair, and a tool writing one means the write face has two owners')
    if (face.toolsAvailable !== true) issues.push('linkCollab.tools.available is ' + show(face.toolsAvailable === undefined ? null : face.toolsAvailable))
    const names = face.names === undefined ? [] : face.names
    const listed = face.toolsNames === undefined || face.toolsNames === null ? null : face.toolsNames
    if (same(names, listed) !== true) issues.push('linkCollab.tools.names ' + show(listed) + ' is not the registry face ' + show(names))
    const broker = face.broker === undefined ? {} : face.broker
    if (broker.present !== true) issues.push('apply() published no linkCollab.broker facade (contract 3.2: the round publishes keys/call/lastCode)')
    else if (broker.keys !== 'function' || broker.call !== 'function' || broker.lastCode === 'undefined') issues.push('the published broker facade does not carry keys/call/lastCode: ' + show(broker))
    const calls = world.manifest === undefined ? [] : world.manifest.calls
    if (calls.length !== 3) issues.push('this world measured ' + show(calls.length) + ' appendManifest call(s), not the three the road declares')
    for (const call of calls) {
      const row = call.row
      if (call.gained !== 1) issues.push('the ' + show(call.end) + ' call added ' + show(call.gained) + ' row(s), not exactly one')
      if (row === null || row === undefined) { issues.push('no ' + show(call.end) + ' manifest row is in the file'); continue }
      if (row.kind !== world.kind) issues.push('the row is kind ' + show(row.kind) + ', not ' + show(world.kind))
      if (row.subject !== call.end) issues.push('subject is ' + show(row.subject) + ' while the end named is ' + show(call.end))
      const payload = row.payload === undefined ? {} : row.payload
      const expectedCaps = [...new Set(world.road.declared[call.end])].sort()
      if (payload.end !== call.end) issues.push('payload.end is ' + show(payload.end) + ', not ' + show(call.end))
      if (same(payload.via, world.road.via[call.end]) !== true) issues.push('payload.via is ' + show(payload.via) + ' while the next hop named is ' + show(world.road.via[call.end]))
      if (payload.platform !== 'dsh') issues.push('payload.platform is ' + show(payload.platform))
      if (payload.protocolVersion !== world.protocol) issues.push('payload.protocolVersion is ' + show(payload.protocolVersion) + ', not the version the build speaks ' + show(world.protocol))
      if (same(payload.capabilities, expectedCaps) !== true) issues.push('payload.capabilities is ' + show(payload.capabilities) + ' while the registry-known names are ' + show(expectedCaps))
      if (payload.at !== T0) issues.push('payload.at is ' + show(payload.at) + ', not the instant the caller gave')
      const returned = call.returned
      if (returned.seq !== row.seq) issues.push('the value the ' + show(call.end) + ' call returned carries seq ' + show(returned.seq) + ' while the file row is seq ' + show(row.seq))
      if (same(returned.capabilities, payload.capabilities) !== true) issues.push('the returned capabilities ' + show(returned.capabilities) + ' are not the ones in the file ' + show(payload.capabilities))
      if (returned.kind !== row.kind || returned.subject !== row.subject) issues.push('the returned value does not answer with the row kind/subject')
      for (const field of ['end', 'via', 'platform', 'protocolVersion', 'at']) {
        if (same(returned[field], payload[field]) !== true) issues.push('the value the ' + show(call.end) + ' call returned carries ' + field + '=' + show(returned[field]) + ' while the file row carries ' + show(payload[field]))
      }
    }
    const builder = world.builder === undefined ? {} : world.builder
    if (builder.ok !== true) issues.push('manifestRecord threw on a well-formed input: ' + show(builder.error))
    else {
      const record = builder.record === null ? {} : builder.record
      const landed = (world.manifest === undefined ? [] : world.manifest.calls).filter((call) => call.end === END_C)[0]
      if (same(builder.keys, ['kind', 'payload', 'subject']) !== true) issues.push('the record the shipped builder answers carries ' + show(builder.keys) + ' at the top level, not the frozen kind/subject/payload')
      if (same(builder.payloadKeys, ['at', 'capabilities', 'end', 'platform', 'protocolVersion', 'via']) !== true) issues.push('the payload it builds carries ' + show(builder.payloadKeys) + ', not the frozen end/via/platform/protocolVersion/capabilities/at')
      if (landed === undefined) issues.push('there is no file row to compare the builder against')
      else {
        if (record.kind !== landed.row.kind) issues.push('the builder answers kind ' + show(record.kind) + ' while the file row is ' + show(landed.row.kind))
        if (record.subject !== landed.row.subject) issues.push('the builder answers subject ' + show(record.subject) + ' while the file row is ' + show(landed.row.subject))
        if (same(record.payload, landed.row.payload) !== true) issues.push('the builder and the file disagree about the same manifest: ' + clip(show(record.payload), 160) + ' vs ' + clip(show(landed.row.payload), 160))
      }
    }
    const gained = world.ledger.afterRoad.rows - world.ledger.initial.rows
    if (calls.length === 3 && gained !== world.road.facts) issues.push('the file gained ' + show(gained) + ' rows for a road that wrote ' + show(world.road.facts) + ' facts')
    add('1-the-manifest-write-face-is-a-function-pair-and-the-four-fields-land', issues.length === 0,
      issues.length === 0
        ? 'apply() published linkCollab.broker over an empty ledger; none of the ' + String((world.face === undefined ? {} : world.face).names.length) + ' registered tool(s) appended a ' + show(world.kind) + ' row in ' + String((world.face === undefined ? {} : world.face).attempts) + ' call(s); and the three appendManifest calls each added exactly one row whose end/via/platform/protocolVersion/capabilities/at are the ones the caller gave, with the returned seq equal to the file own seq'
        : issues.join(' | '),
      [
        'registry face: ' + show((world.face === undefined ? {} : world.face).names),
        'names mentioning manifest: ' + show((world.face === undefined ? {} : world.face).namesMentioningManifest) + ' | calls tried: ' + show((world.face === undefined ? {} : world.face).sample),
        'manifest rows landed: ' + show((world.manifest === undefined ? [] : world.manifest.calls).map((call) => call.end + ' seq ' + show(call.row === undefined || call.row === null ? null : call.row.seq) + ' ' + show(call.row === undefined || call.row === null ? null : call.row.payload))),
        'the builder on the same input: keys ' + show((world.builder === undefined ? {} : world.builder).keys) + ' payload keys ' + show((world.builder === undefined ? {} : world.builder).payloadKeys) + ' -> ' + clip(show((world.builder === undefined ? {} : world.builder).record), 200),
        counterLine('the measured ledger', { rows: { length: world.ledger.afterRoad.rows }, bytes: world.ledger.afterRoad.bytes, lines: world.ledger.afterRoad.lines, sha: world.ledger.afterRoad.sha })
      ])
  }

  // 2 ------------------------------------------------------------------------
  {
    const issues = []
    const fold = world.fold === undefined ? {} : world.fold
    if (fold.forwardText !== fold.reversedText) issues.push('the same records folded in reverse answered a different table')
    if (fold.forwardText !== fold.shuffledText) issues.push('the same records shuffled answered a different table')
    if (fold.forwardMalformed !== 0) issues.push('a clean world reports malformed ' + show(fold.forwardMalformed))
    if ((fold.forwardEnds === undefined ? [] : fold.forwardEnds).length !== 3) issues.push('the fold holds ' + show((fold.forwardEnds === undefined ? [] : fold.forwardEnds).length) + ' end(s), not the three that declared')
    const orders = world.orders === undefined ? {} : world.orders
    if (orders.factsEqual !== true) issues.push('the two arrival orders fold different FACTS: ' + clip(show(orders.factsA), 200) + ' vs ' + clip(show(orders.factsB), 200))
    if (orders.rowsA !== orders.rowsB) issues.push('the two readers hold ' + show(orders.rowsA) + ' and ' + show(orders.rowsB) + ' rows')
    if (orders.malformedA !== 0 || orders.malformedB !== 0) issues.push('a relayed world reports malformed ' + show(orders.malformedA) + '/' + show(orders.malformedB))
    if (same(orders.factsA, orders.factsB) === true && (orders.factsA === undefined || orders.factsA.length !== 3)) issues.push('the relayed folds hold ' + show((orders.factsA === undefined ? [] : orders.factsA).length) + ' end(s)')
    add('2-the-manifest-table-does-not-depend-on-the-arrival-order', issues.length === 0,
      issues.length === 0
        ? 'one records array in three orders folds byte for byte the same (sequence included); two real logs fed three real relay batches in two arrival orders fold the same fact table over ' + show(orders.rowsA) + ' rows'
        : issues.join(' | '),
      [
        'forward: ' + clip(fold.forwardText, 220),
        'reversed: ' + clip(fold.reversedText, 220),
        'relay order one: ' + show(orders.stepsA) + ' | order two: ' + show(orders.stepsB),
        'the arrival sequence itself moves: ' + END_C + ' manifest at local seq ' + show(orders.seqA) + ' vs ' + show(orders.seqB) + (orders.seqsDiffer === true ? ' (the ledger own arrival order, and the facts above do not move with it)' : ' (the two orders happened to agree here)')
      ])
  }

  // 3 ------------------------------------------------------------------------
  {
    const issues = []
    const refusals = world.refusals === undefined ? [] : world.refusals
    if (refusals.length === 0) issues.push('the refusal batch was never driven, so nothing was measured')
    const notRefused = refusals.filter((entry) => entry.threw !== true)
    if (notRefused.length > 0) issues.push(String(notRefused.length) + ' malformed call(s) were not refused: ' + show(notRefused.map((entry) => entry.at + ' ' + entry.expected)))
    const unnamed = refusals.filter((entry) => entry.threw === true && entry.code === null)
    if (unnamed.length > 0) issues.push(String(unnamed.length) + ' refusal(s) lead with no rule name: ' + show(unnamed.map((entry) => entry.at)))
    const wrong = refusals.filter((entry) => entry.threw === true && entry.code !== entry.expected)
    if (wrong.length > 0) issues.push(String(wrong.length) + ' refusal(s) answered a different rule than the one broken: ' + show(wrong.map((entry) => 'case ' + entry.at + ' expected ' + entry.expected + ' got ' + entry.code)))
    const seen = [...new Set(refusals.map((entry) => entry.code).filter((code) => code !== null))].sort()
    for (const rule of MANIFEST_RULES) if (seen.includes(rule) === false) issues.push('no case was refused with ' + rule)
    for (const code of seen) if (MANIFEST_RULES.includes(code) === false) issues.push('a refusal answered ' + show(code) + ', which is not one of this family rules')
    if (world.refusalRepeat === undefined || world.refusalRepeat.sameAsFirst !== true) issues.push('the same malformed call did not answer the same name the second time: ' + show(world.refusalRepeat === undefined ? null : world.refusalRepeat))
    const before = world.ledger === undefined ? null : world.ledger.beforeRefusals
    const after = world.ledger === undefined ? null : world.ledger.afterRefusals
    if (before === null || after === null) issues.push('the ledger was not counted around the refusal batch')
    else {
      if (before.text !== after.text) issues.push('the ledger moved across the refusal batch: ' + counterLine('before', { rows: { length: before.rows }, bytes: before.bytes, lines: before.lines, sha: before.sha }) + ' -> ' + counterLine('after', { rows: { length: after.rows }, bytes: after.bytes, lines: after.lines, sha: after.sha }))
      if (before.rows !== after.rows) issues.push('the row count moved: ' + show(before.rows) + ' -> ' + show(after.rows))
      if (before.bytes !== after.bytes) issues.push('the byte count moved: ' + show(before.bytes) + ' -> ' + show(after.bytes))
      if (before.sha !== after.sha) issues.push('the sha256 changed: ' + show(before.sha) + ' -> ' + show(after.sha))
      if (before.lines !== after.lines) issues.push('the line count moved: ' + show(before.lines) + ' -> ' + show(after.lines))
    }
    const positive = world.positive === undefined ? {} : world.positive
    if (positive.ok !== true) issues.push('the call whose names are ALL in the registry did not answer: ' + show(positive.error))
    if (positive.gained !== 1) issues.push('that call added ' + show(positive.gained) + ' row(s), not exactly one')
    if (same(positive.rowCapabilities, positive.expectedCapabilities) !== true) issues.push('the names that landed are ' + show(positive.rowCapabilities) + ' while every one of ' + show(positive.expectedCapabilities) + ' was known')
    if (positive.returnedSeq !== positive.rowSeq) issues.push('the returned seq ' + show(positive.returnedSeq) + ' is not the file seq ' + show(positive.rowSeq))
    if (same(positive.returnedCapabilities, positive.expectedCapabilities) !== true) issues.push('the returned capabilities ' + show(positive.returnedCapabilities) + ' are not the ones that landed')
    add('3-names-outside-the-registry-are-refused-by-name-and-the-ledger-does-not-move', issues.length === 0,
      issues.length === 0
        ? String(refusals.length) + ' malformed calls, every one refused with its own UPPER-CASE rule name leading the message (' + show(seen) + '), the same call twice answering the same name, control.jsonl byte-identical across the batch (' + show(before.bytes) + ' B, ' + show(before.rows) + ' rows, sha ' + show(before.sha) + '), and the paired call whose names are all registered landed exactly one row carrying all ' + show(positive.expectedCapabilities)
        : issues.join(' | '),
      [
        'refusals: ' + show(refusals.slice(0, 8).map((entry) => entry.expected + ' -> ' + show(entry.code))),
        'the same call twice: ' + show(world.refusalRepeat),
        counterLine('before the batch', { rows: { length: before === null ? null : before.rows }, bytes: before === null ? null : before.bytes, lines: before === null ? null : before.lines, sha: before === null ? null : before.sha }),
        counterLine('after the batch', { rows: { length: after === null ? null : after.rows }, bytes: after === null ? null : after.bytes, lines: after === null ? null : after.lines, sha: after === null ? null : after.sha }),
        'a name made of blanks: end "   " -> ' + show(world.blankNames === undefined ? null : world.blankNames.end) + ', via "   " -> ' + show(world.blankNames === undefined ? null : world.blankNames.via) + ' (' + String(world.blankNames === undefined ? '' : world.blankNames.note) + ')',
        'the paired positive: ' + show(positive.input) + ' -> seq ' + show(positive.rowSeq) + ' ' + show(positive.rowCapabilities)
      ])
  }

  // 4 ------------------------------------------------------------------------
  {
    const issues = []
    const decay = world.decay === undefined ? {} : world.decay
    const whole = decay.whole === undefined ? {} : decay.whole
    if (whole.ok !== true) issues.push('the whole-road reading threw: ' + show(whole.error))
    if (same(whole.path, [LOCAL, END_B, END_C]) !== true) issues.push('the whole road is ' + show(whole.path) + ', not ' + show([LOCAL, END_B, END_C]))
    if (same(whole.capabilities, decay.expected) !== true) issues.push('the meet is ' + show(whole.capabilities) + ' while the gate computes the intersection of the three declared lists as ' + show(decay.expected))
    if ((whole.missing === undefined ? ['x'] : whole.missing).length !== 0) issues.push('a whole road names ' + show(whole.missing) + ' as missing')
    const without = decay.withoutLocalEnd === undefined ? {} : decay.withoutLocalEnd
    if ((whole.path === undefined ? [] : whole.path)[0] !== LOCAL) issues.push('naming the local end does not put it at the head of the path: ' + show(whole.path))
    if ((without.path === undefined ? [] : without.path)[0] === LOCAL) issues.push('leaving localEnd out still answered a path headed by ' + show(LOCAL) + ': ' + show(without.path))
    if (same(without.capabilities, decay.expected) !== true) issues.push('without localEnd the meet is ' + show(without.capabilities) + ', not the same road ' + show(decay.expected))
    const noManifest = decay.noManifest === undefined ? {} : decay.noManifest
    if (same(noManifest.missing, [{ hop: END_B, code: 'NO_MANIFEST' }]) !== true) issues.push('a relay end that never declared anything is named ' + show(noManifest.missing) + ', not one missing hop at ' + show(END_B) + ' with NO_MANIFEST')
    if ((noManifest.capabilities === undefined ? ['x'] : noManifest.capabilities).length !== 0) issues.push('a broken road still answers capabilities ' + show(noManifest.capabilities))
    const farSilent = decay.farSilent === undefined ? {} : decay.farSilent
    if (same(farSilent.missing, [{ hop: END_C, code: 'PEER_SILENT' }]) !== true) issues.push('a far end exactly at the threshold is named ' + show(farSilent.missing) + ', not ' + show([{ hop: END_C, code: 'PEER_SILENT' }]))
    const relaySilent = decay.relaySilent === undefined ? {} : decay.relaySilent
    if (same(relaySilent.missing, [{ hop: END_B, code: 'ROUTE_DOWN' }]) !== true) issues.push('a middle hop exactly at the threshold is named ' + show(relaySilent.missing) + ', not a ROUTE_DOWN broken AT ' + show(END_B))
    if (farSilent.missing !== undefined && relaySilent.missing !== undefined && farSilent.missing[0] !== undefined && relaySilent.missing[0] !== undefined && farSilent.missing[0].code === relaySilent.missing[0].code) issues.push('the two silences answer the same word ' + show(farSilent.missing[0].code) + ': PEER_SILENT and ROUTE_DOWN are not allowed to be one word')
    const inside = decay.farInside === undefined ? {} : decay.farInside
    if ((inside.missing === undefined ? ['x'] : inside.missing).length !== 0) issues.push('a beat one millisecond inside the threshold is already read as silent: ' + show(inside.missing))
    if (same(inside.capabilities, decay.expected) !== true) issues.push('one millisecond inside the line the road is not whole again: ' + show(inside.capabilities))
    for (const code of decay.codes === undefined ? [] : decay.codes) if (MISSING_CODES.includes(code) === false) issues.push('a missing hop was named with ' + show(code) + ', which is not one of ' + show(MISSING_CODES))
    add('4-the-decay-is-the-meet-of-every-hop-and-every-break-is-named', issues.length === 0,
      issues.length === 0
        ? 'A->B->C meets to ' + show(whole.capabilities) + ' (the intersection of the three declared lists, computed here), a hop that never declared is NO_MANIFEST, a far end AT the threshold is PEER_SILENT and a middle hop at it is ROUTE_DOWN with the break named at ' + show(END_B) + ' - two words, never one - and one millisecond inside the line the road is whole again'
        : issues.join(' | '),
      [
        'whole: ' + show(whole),
        'without localEnd: ' + show(without),
        'relay end never declared: ' + show(noManifest),
        'far end at the line: ' + show(farSilent),
        'middle hop at the line: ' + show(relaySilent),
        'one millisecond inside: ' + show(inside)
      ])
  }

  // 5 ------------------------------------------------------------------------
  {
    const issues = []
    const ghost = world.ghost === undefined ? {} : world.ghost
    if (ghost.cleanMalformed !== 0) issues.push('a clean world already reports malformed ' + show(ghost.cleanMalformed))
    if (ghost.bittenMalformed !== ghost.cleanMalformed + 1) issues.push('a ledger carrying one unreadable name reports malformed ' + show(ghost.bittenMalformed) + ' where the clean world reports ' + show(ghost.cleanMalformed))
    if (ghost.rowPresent !== true) issues.push('the end that declared the unreadable name is GONE from the fold: "cannot read it" was read as "that end said nothing"')
    if (same(ghost.declared, [GHOST, ROAD]) !== true) issues.push('the row declared list is ' + show(ghost.declared) + ', so the unreadable name was not kept for a reader to see')
    if (same(ghost.capabilities, [ROAD]) !== true) issues.push('the readable capabilities are ' + show(ghost.capabilities) + ' while the row carried ' + show([ROAD, GHOST]))
    if (ghost.ghostKeyListed === true) issues.push('the unreadable name is OFFERED: ' + show(ghost.keys))
    if (ghost.readableKeyListed !== true) issues.push('the readable name on the same row is not offered any more: ' + show(ghost.keys))
    if (ghost.writeRefusal === undefined || ghost.writeRefusal.code !== 'MANIFEST_CAPABILITY') issues.push('the same name through the shipped writer answered ' + show(ghost.writeRefusal === undefined ? null : ghost.writeRefusal.code) + ' instead of MANIFEST_CAPABILITY')
    add('5-a-name-this-build-cannot-read-is-counted-and-never-offered', issues.length === 0,
      issues.length === 0
        ? 'a wire row naming a capability nobody declared adds exactly one to malformed (' + show(ghost.cleanMalformed) + ' -> ' + show(ghost.bittenMalformed) + '), the end row is still there with its declared list ' + show(ghost.declared) + ', its capabilities are the readable ones ' + show(ghost.capabilities) + ', the unreadable name gets no key while the readable one still does, and the shipped writer refuses that same row by name'
        : issues.join(' | '),
      [
        'the bitten end row: declared ' + show(ghost.declared) + ' capabilities ' + show(ghost.capabilities),
        'keys around it: ' + show(ghost.keys),
        'the write face on the same name: ' + show(ghost.writeRefusal === undefined ? null : ghost.writeRefusal.code) + ' ' + clip(ghost.writeRefusal === undefined ? '' : ghost.writeRefusal.message, 120)
      ])
  }

  // 6 ------------------------------------------------------------------------
  {
    const issues = []
    const broker = world.broker === undefined ? {} : world.broker
    if (same(broker.observedKeys, broker.expectedKeys) !== true) issues.push('brokerKeys lists ' + show(broker.observedKeys) + ' while THIS gate computes ' + show(broker.expectedKeys) + ' from the fold')
    if ((broker.expectedKeys === undefined ? [] : broker.expectedKeys).length === 0) issues.push('the key space is empty in a world where three ends declared capabilities')
    for (const row of broker.rows === undefined ? [] : broker.rows) {
      if (row.key !== keyFor(row.end, row.providerKey)) issues.push('a listed key ' + show(row.key) + ' is not remote:<end>:<providerKey> for ' + show([row.end, row.providerKey]))
    }
    for (const key of broker.observedKeys === undefined ? [] : broker.observedKeys) if (/^remote:[^:]+:.+$/.test(key) === false) issues.push('a key ' + show(key) + ' does not have the frozen shape remote:<end>:<providerKey>')
    if (broker.localKeysListed === true) issues.push('this end own capabilities are in the far key space: ' + show(broker.observedKeys))
    const calls = broker.calls === undefined ? {} : broker.calls
    const wanted = { ok: 'ok', unknown: 'unknown-key', notGranted: 'not-granted', noProvider: 'no-provider', providerSilent: 'provider-silent' }
    for (const label of Object.keys(wanted)) {
      const call = calls[label] === undefined ? null : calls[label]
      if (call === null) { issues.push('the ' + label + ' reading was never taken'); continue }
      if (call.ok !== true) issues.push('the ' + label + ' call threw: ' + show(call.error))
      else if (call.code !== wanted[label]) issues.push('the ' + label + ' call answered ' + show(call.code) + ' instead of ' + show(wanted[label]) + ' (' + show(call.reason) + ')')
    }
    const observed = broker.codes === undefined ? [] : broker.codes
    for (const code of observed) if (CLOSED_CODES.includes(code) === false) issues.push('the broker answered ' + show(code) + ', which is outside its six-word vocabulary ' + show(CLOSED_CODES))
    for (const label of Object.keys(wanted)) {
      const call = calls[label] === undefined ? null : calls[label]
      if (call !== null && call.ok === true && CLOSED_CODES.includes(call.code) === false) issues.push('the ' + label + ' reading used the word ' + show(call.code) + ', outside ' + show(CLOSED_CODES))
    }
    if (same(observed, broker.codesExpected) !== true) issues.push('the five calls this reading takes answered ' + show(observed) + ' where the gate expects one reading each for ' + show(broker.codesExpected))
    const runWide = world.runCodes === undefined ? [] : world.runCodes
    for (const code of runWide) if (CLOSED_CODES.includes(code) === false) issues.push('a code outside the vocabulary was observed somewhere in this run: ' + show(code))
    for (const code of CLOSED_CODES) if (runWide.includes(code) === false) issues.push('the vocabulary word ' + show(code) + ' was never observed anywhere in this run')
    const colon = world.colon === undefined ? {} : world.colon
    if (collectedColon(colon) === false) issues.push('an end whose NAME carries the key separator has no key of its own: ' + show(colon.keys))
    const colonCall = colon.call === undefined ? null : colon.call
    if (colonCall === null) issues.push('the colon key was never called')
    else if (colonCall.ok !== true) issues.push('the colon key call threw: ' + show(colonCall.error))
    else if (colonCall.code !== 'not-granted') issues.push('the key ' + show(colon.key) + ' answered ' + show(colonCall.code) + ' where the ledger holds it and only the handshake is missing (not-granted): a reader that split the key on its separator would answer unknown-key here')
    const cutCall = colon.cutCall === undefined ? null : colon.cutCall
    if (cutCall === null || cutCall.code !== 'unknown-key') issues.push('a key cut short (' + show(colon.cut) + ') answered ' + show(cutCall === null ? null : cutCall.code) + ' instead of unknown-key')
    if (colon.darkListed === true) issues.push('a name the meet drops for that end is still listed: ' + show(colon.keys))
    const facade = broker.facade === undefined ? {} : broker.facade
    if (facade.keysOk !== true) issues.push('the published facade keys() threw or is not a function')
    else if (same(facade.keys, broker.observedKeys) !== true) issues.push('the published facade answers ' + show(facade.keys) + ' while the folded function answers ' + show(broker.observedKeys))
    if (facade.lastCode !== facade.lastCallCode) issues.push('the facade lastCode is ' + show(facade.lastCode) + ' while the last code it returned was ' + show(facade.lastCallCode))
    if (facade.lastCode !== 'unknown-key') issues.push('the facade last code is ' + show(facade.lastCode) + ' where the call it just made was the unknown-key one')
    add('6-the-key-space-has-one-writer-and-the-broker-answers-inside-six-words', issues.length === 0,
      issues.length === 0
        ? 'brokerKeys answers exactly the ' + String((broker.expectedKeys === undefined ? [] : broker.expectedKeys).length) + ' key(s) this gate computes from the fold, every one ' + show(keyFor('<end>', '<providerKey>')) + ', the local end own capabilities are absent, one reading each for ok/unknown-key/not-granted/no-provider/provider-silent, every code observed anywhere in the run inside the closed set ' + show(CLOSED_CODES) + ', and the published facade answers the same list and remembers its own last code'
        : issues.join(' | '),
      [
        'listed: ' + show(broker.observedKeys),
        'computed here: ' + show(broker.expectedKeys),
        'calls: ' + show(Object.keys(calls).map((label) => label + '=' + show(calls[label] === undefined ? null : calls[label].code))),
        'the whole run observed: ' + show(world.runCodes),
        'the key separator inside a name: ' + show(colon.key) + ' listed ' + show(colon.listed) + ' -> ' + show(colonCall === undefined || colonCall === null ? null : colonCall.code) + ' | cut short ' + show(colon.cut) + ' -> ' + show(cutCall === undefined || cutCall === null ? null : cutCall.code),
        'facade: keys ' + show(facade.keys) + ' | lastCode ' + show(facade.lastCode) + ' after the unknown-key call (' + show(facade.lastCallCode) + ')'
      ])
  }

  // 7 ------------------------------------------------------------------------
  {
    const issues = []
    const gone = world.gone === undefined ? {} : world.gone
    const key = gone.key
    const modes = ['withdrawn', 'farSilent', 'relaySilent', 'meetDropped']
    const reasons = ['NO_MANIFEST', 'PEER_SILENT', 'ROUTE_DOWN', 'meet:' + END_B]
    if (gone.whole === undefined || gone.whole.listed !== true) issues.push('the key was not listed in the whole world, so the paired reading has no positive half')
    if (gone.whole === undefined || gone.whole.call === undefined || gone.whole.call.code !== 'ok') issues.push('with the road whole the key answers ' + show(gone.whole === undefined || gone.whole.call === undefined ? null : gone.whole.call.code))
    for (const [at, mode] of modes.entries()) {
      const reading = gone[mode] === undefined ? null : gone[mode]
      if (reading === null) { issues.push('the ' + mode + ' reading was never taken'); continue }
      if (reading.listed === true) issues.push('the ' + mode + ' world still lists ' + show(key) + ' in brokerKeys')
      const call = reading.call === undefined ? null : reading.call
      if (call === null) { issues.push('the ' + mode + ' world took no call'); continue }
      if (call.code !== 'service-gone') issues.push('the ' + mode + ' world answers ' + show(call.code) + ' for the same key instead of service-gone')
      if (call.code === 'unknown-key') issues.push('the ' + mode + ' world collapsed "the service is gone" into unknown-key')
      if (call.code === 'no-provider') issues.push('the ' + mode + ' world collapsed "the service is gone" into no-provider')
      if (call.reason !== reasons[at]) issues.push('the ' + mode + ' world names the break ' + show(call.reason) + ' where the break this gate made is ' + show(reasons[at]))
    }
    if (gone.meetDropped !== undefined && gone.meetDropped.declared !== true) issues.push('the name the meet leaves out was not even declared by that end, so the meet reading measures nothing: ' + show(gone.meetDropped))
    if (gone.withdrawn !== undefined && gone.withdrawn.stranger !== undefined && gone.withdrawn.stranger.code !== 'unknown-key') issues.push('with a relay end manifest withdrawn the RELAY own key answers ' + show(gone.withdrawn.stranger.code) + ' instead of unknown-key, so the gate cannot tell a far key from a key nobody ever declared')
    add('7-a-key-that-was-listed-goes-gone-and-the-call-becomes-service-gone', issues.length === 0,
      issues.length === 0
        ? show(key) + ' is listed and answers ok with the road whole; after the relay end manifest is withdrawn, after the far end crosses the threshold, after a middle hop crosses it, and for a name the meet leaves out, the SAME key is gone from brokerKeys and answers service-gone with the break named (' + show(reasons) + ') - never unknown-key, never no-provider - while a key whose end never declared anything still answers unknown-key beside it'
        : issues.join(' | '),
      [
        'whole: listed ' + show(gone.whole === undefined ? null : gone.whole.listed) + ' call ' + show(gone.whole === undefined || gone.whole.call === undefined ? null : gone.whole.call.code),
        modes.map((mode, at) => mode + ': listed ' + show(gone[mode] === undefined ? null : gone[mode].listed) + ' -> ' + show(gone[mode] === undefined || gone[mode].call === undefined ? null : gone[mode].call.code + '/' + gone[mode].call.reason)).join(' | '),
        'the relay own key in the withdrawn world: ' + show(gone.withdrawn === undefined || gone.withdrawn.stranger === undefined ? null : gone.withdrawn.stranger.code)
      ])
  }

  // 8 ------------------------------------------------------------------------
  {
    const issues = []
    const bad = world.badCalls === undefined ? [] : world.badCalls
    if (bad.length === 0) issues.push('no call outside what the vocabulary can answer was driven')
    for (const entry of bad) {
      const outcome = entry.outcome === undefined ? {} : entry.outcome
      if (outcome.ok === true) issues.push('the ' + entry.id + ' call ANSWERED ' + show(outcome.code === undefined ? null : outcome.code) + ' where the vocabulary has no answer: a default success or a default failure, not a refusal')
      else if (outcome.isTypeError !== true) issues.push('the ' + entry.id + ' call threw ' + show(outcome.errorName) + ' instead of a TypeError: ' + clip(outcome.error, 120))
      if (outcome.ok === true && entry.kind === 'call' && CLOSED_CODES.includes(outcome.code)) issues.push('the ' + entry.id + ' call was answered with the closed-set word ' + show(outcome.code) + ' rather than refused')
    }
    const pairs = world.badPairs === undefined ? [] : world.badPairs
    if (pairs.length === 0) issues.push('no paired call with the argument supplied was taken')
    for (const pair of pairs) {
      const outcome = pair.outcome === undefined ? {} : pair.outcome
      if (outcome.ok !== true) issues.push('the paired call ' + pair.id + ' threw ' + show(outcome.errorName) + ': ' + clip(outcome.error, 120))
      else if (pair.kind === 'call' && CLOSED_CODES.includes(outcome.code) === false) issues.push('the paired call ' + pair.id + ' answered ' + show(outcome.code) + ' outside the vocabulary')
      else if (pair.kind === 'reading' && (Array.isArray(outcome.path) !== true || Array.isArray(outcome.missing) !== true)) issues.push('the paired reading ' + pair.id + ' did not answer a decay reading')
    }
    const everywhere = [...new Set(bad.concat(pairs).filter((entry) => entry.kind === 'call').map((entry) => entry.outcome === undefined ? null : entry.outcome.code).filter((code) => code !== null))].sort()
    for (const code of everywhere) if (CLOSED_CODES.includes(code) === false) issues.push('a code outside the vocabulary was observed: ' + show(code))
    add('8-a-call-the-vocabulary-cannot-answer-throws-a-typeerror', issues.length === 0,
      issues.length === 0
        ? String(bad.length) + ' calls the six-word vocabulary cannot answer each threw a TypeError (no default success, no default failure), and the ' + String(pairs.length) + ' paired calls that supply the missing argument were ANSWERED with a code inside ' + show(CLOSED_CODES)
        : issues.join(' | '),
      [
        bad.map((entry) => entry.id + ' -> ' + (entry.outcome.ok === true ? 'ANSWERED ' + show(entry.outcome.code) : show(entry.outcome.errorName))).join(' | '),
        'paired: ' + pairs.map((pair) => pair.id + ' -> ' + (pair.outcome.ok === true ? (pair.kind === 'call' ? String(pair.outcome.code) : 'a decay reading, not a throw') : 'threw ' + show(pair.outcome.errorName))).join(' | ')
      ])
  }

  return readings
}

// ---------------------------------------------------------------------------
// The self-attack: mutate the MEASURED world, one reading per mutant
// ---------------------------------------------------------------------------

const mutants = (world) => {
  const clone = () => structuredClone(world)
  const R1 = '1-the-manifest-write-face-is-a-function-pair-and-the-four-fields-land'
  const R2 = '2-the-manifest-table-does-not-depend-on-the-arrival-order'
  const R3 = '3-names-outside-the-registry-are-refused-by-name-and-the-ledger-does-not-move'
  const R4 = '4-the-decay-is-the-meet-of-every-hop-and-every-break-is-named'
  const R5 = '5-a-name-this-build-cannot-read-is-counted-and-never-offered'
  const R6 = '6-the-key-space-has-one-writer-and-the-broker-answers-inside-six-words'
  const R7 = '7-a-key-that-was-listed-goes-gone-and-the-call-becomes-service-gone'
  const R8 = '8-a-call-the-vocabulary-cannot-answer-throws-a-typeerror'
  return [
    {
      name: 'the-manifest-row-loses-its-next-hop',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.manifest.calls[2].row.payload.via = STRANGER; return next })()
    },
    {
      name: 'one-append-lands-two-rows',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.manifest.calls[0].gained = 2; return next })()
    },
    {
      name: 'the-capabilities-come-back-in-arrival-order',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.manifest.calls[2].returned.capabilities = [...next.manifest.calls[2].row.payload.capabilities].reverse(); return next })()
    },
    {
      name: 'the-builder-and-the-file-disagree-about-the-next-hop',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.builder.record.payload.via = null; return next })()
    },
    {
      name: 'the-builder-answers-a-second-vocabulary',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.builder.payloadKeys = ['at', 'capabilities', 'end', 'name', 'platform', 'protocolVersion', 'via']; return next })()
    },
    {
      name: 'a-tool-writes-the-manifest',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.face.manifestWriters = ['team_declare_capability via a-manifest-shaped-argument-object']; return next })()
    },
    {
      name: 'the-fold-follows-the-array-order',
      mustRedden: [R2],
      world: (() => { const next = clone(); next.fold.shuffledText = 'the fold answered a different table'; return next })()
    },
    {
      name: 'the-two-arrival-orders-fold-different-facts',
      mustRedden: [R2],
      world: (() => { const next = clone(); next.orders.factsEqual = false; return next })()
    },
    {
      name: 'a-refusal-names-nothing',
      mustRedden: [R3],
      world: (() => { const next = clone(); next.refusals[5].code = null; next.refusals[5].message = 'invalid input'; return next })()
    },
    {
      name: 'a-refusal-still-appends',
      mustRedden: [R3],
      world: (() => { const next = clone(); next.ledger.afterRefusals.text = next.ledger.afterRefusals.text + '{"seq":999}\n'; next.ledger.afterRefusals.bytes += 12; next.ledger.afterRefusals.rows += 1; next.ledger.afterRefusals.lines += 1; next.ledger.afterRefusals.sha = 'moved'; return next })()
    },
    {
      name: 'the-paired-acceptance-lands-nothing',
      mustRedden: [R3],
      world: (() => { const next = clone(); next.positive.gained = 0; return next })()
    },
    {
      name: 'a-hop-with-no-manifest-is-not-named',
      mustRedden: [R4],
      world: (() => { const next = clone(); next.decay.noManifest.missing = []; return next })()
    },
    {
      name: 'silence-is-reported-as-a-broken-route',
      mustRedden: [R4],
      world: (() => { const next = clone(); next.decay.farSilent.missing = [{ hop: END_C, code: 'ROUTE_DOWN' }]; return next })()
    },
    {
      name: 'the-threshold-equality-counts-as-alive',
      mustRedden: [R4],
      world: (() => { const next = clone(); next.decay.farSilent.missing = []; return next })()
    },
    {
      name: 'the-meet-keeps-a-name-a-hop-did-not-carry',
      mustRedden: [R4],
      world: (() => { const next = clone(); next.decay.whole.capabilities = [...next.decay.whole.capabilities, FAR].sort(); return next })()
    },
    {
      name: 'an-unreadable-name-is-not-counted',
      mustRedden: [R5],
      world: (() => { const next = clone(); next.ghost.bittenMalformed = next.ghost.cleanMalformed; return next })()
    },
    {
      name: 'an-unreadable-name-is-read-as-a-capability',
      mustRedden: [R5],
      world: (() => { const next = clone(); next.ghost.capabilities = [ROAD, GHOST]; return next })()
    },
    {
      name: 'the-key-space-gains-the-local-end',
      mustRedden: [R6],
      world: (() => { const next = clone(); next.broker.localKeysListed = true; return next })()
    },
    {
      name: 'the-broker-answers-a-word-outside-its-vocabulary',
      mustRedden: [R6],
      world: (() => { const next = clone(); next.broker.calls.providerSilent.code = 'gone-forever'; next.broker.codes = [...new Set(next.broker.codes.concat(['gone-forever']))].sort(); return next })()
    },
    {
      name: 'the-key-is-split-on-a-colon',
      mustRedden: [R6],
      world: (() => { const next = clone(); next.colon.call.code = 'unknown-key'; return next })()
    },
    {
      name: 'a-dead-key-stays-listed',
      mustRedden: [R7],
      world: (() => { const next = clone(); next.gone.farSilent.listed = true; return next })()
    },
    {
      name: 'a-dead-key-is-answered-as-unknown',
      mustRedden: [R7],
      world: (() => { const next = clone(); next.gone.relaySilent.call.code = 'unknown-key'; next.gone.relaySilent.call.reason = null; return next })()
    },
    {
      name: 'a-call-the-vocabulary-cannot-answer-answers-anyway',
      mustRedden: [R8],
      world: (() => { const next = clone(); next.badCalls[0].outcome.ok = true; next.badCalls[0].outcome.code = 'unknown-key'; next.badCalls[0].outcome.isTypeError = false; return next })()
    },
    {
      name: 'a-refusal-is-a-bare-error-not-a-typed-one',
      mustRedden: [R8],
      world: (() => { const next = clone(); next.badCalls[2].outcome.isTypeError = false; next.badCalls[2].outcome.errorName = 'Error'; return next })()
    },
    {
      name: 'control-nothing-changed',
      mustRedden: [],
      world: clone()
    }
  ]
}

const loadModule = async () => {
  try { return await import(pathToFileURL(MODULE_PATH).href) } catch (error) {
    console.log('SKIP: importing ' + MODULE_PATH + ' threw: ' + describe(error))
    return null
  }
}
const cleanup = (world, keep) => {
  if (keep === true) { console.log('        kept: ' + show(world.roots)); return }
  for (const root of world.roots === undefined ? [] : world.roots) { try { rmSync(root, { recursive: true, force: true }) } catch { /* the temp world is disposable */ } }
}

const runSelfAttack = async (started) => {
  const module = await loadModule()
  if (module === null) return 3
  const collected = await collect(module)
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); cleanup(collected.world, KEEP); return 3 }
  const world = collected.world
  const base = judge(world)
  const baseRed = base.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  baseline in this world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' failed')
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed) + ' (a mutant declared against a reading that is already red proves nothing)')
    for (const reading of base.filter((row) => row.ok === false)) console.log('        ' + reading.id + '. ' + reading.detail)
    cleanup(world, KEEP)
    return 1
  }
  console.log('  each mutant below rewrites ONE fact of that measured world and is judged by the same judge:')
  let failures = 0
  const built = mutants(world)
  for (const mutant of built) {
    const observed = judge(mutant.world).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const declared = mutant.mustRedden
    const precise = observed.length === declared.length && declared.every((id) => observed.includes(id))
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' — 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed))
  }
  const coverage = new Map()
  for (const mutant of built) for (const id of mutant.mustRedden) coverage.set(id, (coverage.get(id) ?? 0) + 1)
  let uncovered = 0
  console.log('  coverage matrix (every reading must be declared by at least one mutant):')
  for (const reading of base) {
    const count = coverage.get(reading.id) ?? 0
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id)
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log('  ' + String(built.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(built.filter((mutant) => mutant.mustRedden.length > 0).length) + ' of them declare a target, ' + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  console.log('  note: the mutants attack the JUDGE over the world measured in this run; the measurement itself is not repeated per mutant.')
  cleanup(world, KEEP)
  return failures === 0 && uncovered === 0 ? 0 : 1
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
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); cleanup(collected.world, KEEP); return 3 }
  const readings = judge(collected.world)
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
