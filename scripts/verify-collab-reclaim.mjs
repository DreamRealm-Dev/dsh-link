#!/usr/bin/env node
/**
 * Gate (R181-B) - fault isolation and rescheduling: a member that holds an in_progress task and stopped
 * answering loses it BY NAME, and the decision that says so is a pure function of (latest heartbeat,
 * now, timeoutMs).
 *
 * Subject: docs/handoff/R181-A-reclaim.md (the reclaim line of R181). Written by a verifier who did not
 * write the plugin: the worlds below are BUILT by calling apply() on the shipped artifact with a ctx
 * that publishes a tools registry the way the kernel composes it, and every count is this gate's own
 * arithmetic over the control.jsonl it parses itself - never a fixture the plugin also produces, and
 * never the plugin's own report of what it did.
 *
 * Nine readings, each of which can fail on its own evidence:
 *
 *   1-the-world-is-the-shipped-registration-and-it-holds-the-reclaim-tool
 *                                            In a world whose composition ASKS for the reclaim tool, apply()
 *                                            publishes linkCollab and registers exactly ONE tool whose name
 *                                            announces reclaiming; the fresh ledger holds 0 rows and this gate's
 *                                            seed lands in it as written (four in_progress tasks: three owned,
 *                                            each with its own heartbeat history, and one with no owner at all);
 *                                            the tool declares a fillable input schema; and the fold reads the
 *                                            world the gate meant to build. A gate that measured an empty world
 *                                            by accident fails here instead of passing eight readings about nothing.
 *   2-the-verdict-is-a-pure-function-of-the-latest-heartbeat-now-and-the-timeout
 *                                            The gate DISCOVERS the shipped verdict by behaviour - the single
 *                                            export that answers differently for a holder that never beat and one
 *                                            that beat a second ago - and then pins it: with one state and one task,
 *                                            never-beat => reclaimable, a beat 1 ms inside the timeout => not, a
 *                                            beat EXACTLY timeoutMs old => reclaimable (the equality belongs to
 *                                            'out of bounds'), a day-old beat => reclaimable; the two reclaimable
 *                                            causes are NAMED APART in the answer; the same (state, now) answers
 *                                            byte-identically twice; and it answers the same with Date.now replaced
 *                                            by a thrower.
 *   3-the-tool-really-reclaims-the-release-row-and-the-isolation-fact
 *                                            One call through the registered definition for the task whose holder
 *                                            never beat: the FILE gains exactly ONE row and no more - the task's own
 *                                            release (owner cleared, revision continued) carrying the isolation fact
 *                                            about the member it cleared - the answer the tool returned agrees with
 *                                            that row by seq and by field, and the fold reads both the cleared owner
 *                                            and the isolation.
 *   4-the-conditions-not-met-are-refused-by-name-and-the-ledger-does-not-move
 *                                            The same call for a holder that beat one second ago must be REFUSED,
 *                                            with a name leading the message (not a bare TypeError), and the ledger
 *                                            must be byte-identical before and after - a refusal that still appends
 *                                            is the failure this reading exists for.
 *   5-the-counterfactuals-flip-the-verdict       Two counterfactuals over the same records: drop the holder's
 *                                            heartbeat row and the verdict for the in-timeout instant flips to
 *                                            reclaimable; keep the beat but attribute it to ANOTHER member and the
 *                                            verdict stays where it was, so the decision reads the holder's own beat
 *                                            and not the presence of any beat.
 *   6-the-fold-changes-across-the-reclaim-and-not-across-the-refusal
 *                                            The fold before and after the successful call differ in the task axis
 *                                            AND in a member-shaped axis (the isolation the reclaim recorded), and
 *                                            not merely in through/counts, while the refused call leaves the fold
 *                                            byte-identical.
 *   7-a-stale-beat-is-reclaimed-too-and-not-by-the-same-row
 *                                            The same call for a holder that beat a day ago - silence past the
 *                                            timeout rather than no beat at all - must also release the task and
 *                                            isolate that owner, in a row of its own that is not the row the
 *                                            never-beat reclaim wrote.
 *   8-the-shipped-surface-admits-one-extra-writer-and-the-switch-takes-it-back
 *                                            The model-visible tool face, pinned from both sides in worlds of its
 *                                            own: the DEFAULT composition registers the three declaring tools plus
 *                                            exactly one name announcing reclaiming (the same admission gate 107
 *                                            makes by name, so a smuggled second name reddens both), and
 *                                            {reclaim:{enabled:false}} leaves exactly the three - while the rule's
 *                                            own door, linkCollab.reclaim, is a function either way, so switching
 *                                            the tool off does not switch the rule off.
 *   9-a-row-with-no-owner-is-released-without-isolating-anybody
 *                                            The live ledger's own case (an in_progress row nobody owns): the call
 *                                            must succeed, gain exactly ONE row, add NO isolation fact to the fold -
 *                                            there is nobody to isolate - and leave the fold's owner empty.
 *
 * Self-attack: --self-attack measures the live world ONCE and then mutates THAT measured world in memory,
 * one mutation per mutant, asserting each mutant reddens exactly its declared readings and nothing else,
 * plus a control mutant that changes nothing. It prints the Chinese sentence '声明集 == 观测集' for every
 * mutant. Mutating the measured world rather than a hand-written fixture is deliberate: a fixture only
 * proves the judge agrees with itself.
 *
 * Budget: this gate is offline (no port, no client, no kernel boot); it writes two throwaway directories
 * under the OS temp dir and removes them unless --keep is given. It prints its elapsed time.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject itself could not be built here (the module
 * does not import, or a world could not open its ledger). A reading that cannot be measured is a failure,
 * never a pass.
 *
 * Usage: node scripts/verify-collab-reclaim.mjs [--module <path>] [--self-attack] [--keep]
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
const TEAM = 'gate-r181-team'
const HOLDER = 'gate-r181-holder'                 // holds a task and NEVER beat
const HOLDER_FRESH = 'gate-r181-holder-fresh'     // holds a task and beat one second before the call
const HOLDER_OLD = 'gate-r181-holder-old'         // holds a task and beat a day before the call
const BYSTANDER = 'gate-r181-bystander'           // the member the counterfactual attributes a beat to
const RECLAIMER = 'gate-r181-reclaimer'           // the member the tool is called as
const TASK = 'gate-r181-task'
const TASK_FRESH = 'gate-r181-task-fresh'
const TASK_OLD = 'gate-r181-task-old'
const TASK_NOBODY = 'gate-r181-task-nobody'       // in_progress and owned by nobody: the live ledger's own case
const REVISION = 7
const TIMEOUT_MS = 30000
/** The instant the hand-made probe records name, and the clock every probe call is made at. */
const T0 = 1700000000000
const DEMAND = 'code-review'
/** The three tools the shipped registration has always held; the reclaim tool is an addition, never a substitution. */
const DECLARING_TOOLS = ['team_declare_capability', 'team_declare_subteam', 'team_heartbeat']

/** The one tool this gate is looking for: a name that announces taking work back from somebody. */
const RECLAIM_TOOL = /reclaim|take-?over|requeue|rescue|reschedul|evict|steal/i
/** The exports worth probing for the verdict: the discovery below decides by behaviour, this only bounds the search. */
const VERDICT_EXPORT = /reclaim|verdict|stale|silent|ttl|expire|quarantin|health|liveness|abandon|evict/i
/** The leading name a refusal must carry, the way the declaring tools' refusals do. */
const REFUSAL_NAME = /^([A-Z][A-Z0-9_]{2,})/
/** A fold axis that shows a member being kept out of work: the isolation this feature writes. */
const ISOLATION_AXIS = /quarantine|isolat|member/i


const show = (value) => JSON.stringify(value === undefined ? null : value)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const clip = (text, limit) => { const raw = String(text ?? ''); return raw.length > limit ? raw.slice(0, limit) + '...' : raw }

// ---------------------------------------------------------------------------
// The ledger file, counted by this gate
// ---------------------------------------------------------------------------

/** Read <dir>/control.jsonl and parse it here: the row count is this gate's arithmetic, not the plugin's. */
const readLedger = (dir) => {
  const path = join(dir, 'control.jsonl')
  let text = ''
  let present = true
  try { text = readFileSync(path, 'utf8') } catch { present = false }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const rows = []
  let unreadable = 0
  for (const line of lines) {
    try { rows.push(JSON.parse(line)) } catch { unreadable += 1 }
  }
  return { path, present, rows, text, bytes: Buffer.byteLength(text), unreadable }
}
const kindsOf = (rows) => {
  const counts = {}
  for (const row of rows) counts[row.kind || '(no kind)'] = (counts[row.kind || '(no kind)'] || 0) + 1
  return counts
}
/** A row as this gate needs it: identity and payload, never the plugin's own reading of itself. */
const rowOf = (row) => ({ seq: row.seq, kind: row.kind ?? null, actor: row.actor ?? null, subject: row.subject ?? null, payload: row.payload ?? null, text: clip(JSON.stringify(row), 700) })
const rowsGained = (before, after) => {
  const known = new Set(before.rows.map((row) => row.seq))
  return after.rows.filter((row) => known.has(row.seq) === false).map(rowOf)
}
/** Everything the fold says except the two counters that move for any append: what is left is the state itself. */
const foldOf = (state) => {
  const copy = { ...state }
  delete copy.through
  delete copy.counts
  return copy
}
const foldText = (state) => JSON.stringify(foldOf(state))
const changedAxes = (before, after) => Object.keys(before).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort()
const taskRows = (state, ids) => (state.tasks ?? []).filter((task) => ids.includes(task.id)).map((task) => ({ id: task.id, status: task.status, owner: task.owner }))

// ---------------------------------------------------------------------------
// Reading a verdict that this gate did not write: find it by behaviour, then pin it
// ---------------------------------------------------------------------------

/** A boolean-ish answer normalised, so a 'unhealthy'/'healthy' word counts as much as true/false. */
const normWord = (text) => {
  const word = text.toLowerCase()
  if (['unhealthy', 'quarantined', 'stale', 'expired', 'reclaimable', 'dead', 'silent', 'out-of-bounds', 'outofbounds', 'true', 'yes'].includes(word)) return true
  if (['healthy', 'live', 'alive', 'active', 'ok', 'ready', 'reclaimed', 'false', 'no', 'fresh'].includes(word)) return false
  return null
}
const walk = (value, path, out) => {
  if (value === null || value === undefined) return
  if (typeof value === 'boolean') { out.push({ path: path.slice(), raw: value, norm: value }); return }
  if (typeof value === 'string') {
    const norm = normWord(value)
    if (norm !== null) out.push({ path: path.slice(), raw: value, norm })
    return
  }
  if (Array.isArray(value)) { for (let at = 0; at < value.length; at += 1) walk(value[at], path.concat([at]), out); return }
  if (typeof value === 'object') { for (const key of Object.keys(value)) walk(value[key], path.concat([key]), out); return }
}
/** Every path where the first answer says yes and the second says no: the behaviour this gate pins. */
const flips = (left, right) => {
  const first = []
  const second = []
  walk(left, [], first)
  walk(right, [], second)
  const byPath = new Map(second.map((entry) => [entry.path.join('.'), entry]))
  const found = []
  for (const entry of first) {
    if (entry.norm !== true) continue
    const other = byPath.get(entry.path.join('.'))
    if (other === undefined || other.norm !== false) continue
    found.push({ path: entry.path, pathText: entry.path.join('.'), yes: entry.raw, no: other.raw })
  }
  return found
}
/**
 * Which of the flipping booleans IS the decision. A verdict object may report more than one - the R179
 * reading carries 'reclaimable' next to 'holderUnhealthy' - so the gate names the decision-shaped field
 * instead of demanding that a function flip exactly one boolean (which would red a correct verdict that
 * also says WHY it decided that way).
 */
const pickDecision = (found) => {
  if (found.length === 0) return null
  const last = (entry) => String(entry.path[entry.path.length - 1])
  const tiers = [
    /^(reclaimable|reclaim|canreclaim|evictable|outofbounds|out_of_bounds)$/i,
    /reclaim|stale|expire|silent|dead|abandon|evict|out.of.bounds/i,
    /liveness|health|quarantin|verdict/i
  ]
  for (const tier of tiers) {
    const hit = found.find((entry) => tier.test(last(entry)))
    if (hit !== undefined) return hit
  }
  return found.length === 1 ? found[0] : null
}
const readPath = (value, path) => {
  let at = value
  for (const step of path) {
    if (at === null || at === undefined) return undefined
    at = at[step]
  }
  return at
}
const verdictOfRaw = (raw) => (typeof raw === 'boolean' ? raw : (typeof raw === 'string' ? normWord(raw) : null))
/** The words an answer uses to say WHICH way it decided: the code, the reason, or the sentence. */
const labelOf = (value) => {
  if (value === null || typeof value !== 'object') return null
  for (const key of ['code', 'reason', 'verdict', 'state']) {
    if (typeof value[key] === 'string' && value[key] !== '') return String(value[key])
  }
  return typeof value.detail === 'string' && value.detail !== '' ? value.detail : null
}

// ---------------------------------------------------------------------------
// The worlds: fresh control logs driven through the SHIPPED artifact
// ---------------------------------------------------------------------------

/** Run fn with Date.now replaced by a thrower: a pure reader must answer anyway. */
const underDeadClock = (fn) => {
  const real = Date.now
  Date.now = () => { throw new Error('the reader read the clock') }
  try { return { ok: true, value: fn() } } catch (error) { return { ok: false, error: String(error && error.message ? error.message : error) } } finally { Date.now = real }
}

const buildWorld = async (module, root, config) => {
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
    // The plugin announces itself on apply(); this gate's output must stay a verdict.
    module.apply(ctx, config ?? {})
    applied = { ok: true }
  } catch (error) {
    applied = { ok: false, error: String(error && error.message ? error.message : error) }
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  return { root, dir, registry, collab: provided.get('linkCollab'), applied, disposers }
}

/** Fill the arguments a tool declares, from this gate's own names. Every property is reported in the evidence. */
const fillArgs = (schema, intent) => {
  const notes = []
  const valueFor = (name, spec, path) => {
    const type = spec && typeof spec.type === 'string' ? spec.type : 'string'
    const source =
      /^(task|taskId|task_id|id)$/i.test(name) ? { label: 'the stale task', value: intent.task } :
      /team/i.test(name) ? { label: 'the team', value: intent.team } :
      /key/i.test(name) ? { label: 'the board key', value: intent.key } :
      /now|instant|clock|^at$/i.test(name) ? { label: 'the instant', value: intent.now } :
      /timeout|ttl|deadline|grace/i.test(name) ? { label: 'the timeout', value: intent.timeoutMs } :
      /reason|note|why|comment|message/i.test(name) ? { label: 'a reason', value: 'gate-r181: the holder stopped answering' } :
      /capability|skill/i.test(name) ? { label: 'the demand', value: DEMAND } :
      /member|holder|owner|by|actor|who|caller|reclaimer|agent|session|from/i.test(name) ? { label: 'the reclaiming member', value: intent.member } :
      { label: 'a name this gate invented', value: 'gate-r181-' + name }
    if (type === 'integer' || type === 'number') {
      const number = typeof source.value === 'number' ? source.value : Number(source.value)
      notes.push(path + name + ' <- ' + source.label + ' (' + String(number) + ')')
      return Number.isFinite(number) ? number : intent.now
    }
    if (type === 'boolean') { notes.push(path + name + ' <- true'); return true }
    if (type === 'array') {
      const items = Array.isArray(spec.items) ? spec.items[0] : spec.items
      const inner = valueFor(name, items ?? { type: 'string' }, path + name + '[]:')
      notes.push(path + name + ' <- [' + source.label + ']')
      return [inner]
    }
    if (type === 'object') {
      const nested = spec.properties !== undefined && typeof spec.properties === 'object' ? spec.properties : {}
      const required = Array.isArray(spec.required) ? spec.required : Object.keys(nested)
      const object = {}
      for (const key of required) object[key] = valueFor(key, nested[key] ?? { type: 'string' }, path + name + '.')
      notes.push(path + name + ' <- an object with ' + show(Object.keys(object)))
      return object
    }
    notes.push(path + name + ' <- ' + source.label + ' (' + clip(String(source.value), 60) + ')')
    return String(source.value)
  }
  const schemaProperties = schema !== undefined && schema.properties !== undefined && typeof schema.properties === 'object' ? schema.properties : null
  if (schemaProperties === null) return { ok: false, reason: 'the tool declares no input schema (parameters.properties), so this gate cannot call it honestly', args: null, notes }
  const declared = Object.keys(schemaProperties)
  const asked = Array.isArray(schema.required) ? schema.required.slice() : declared.slice()
  // Fill what the schema requires, plus the optional properties that name the instant, the threshold or the
  // place: a decision about (latest heartbeat, now, timeoutMs) is only measurable if the gate can name both,
  // and a task on a board keyed by (team, id) is only aimable if the gate can name the team.
  for (const name of declared) {
    if (asked.includes(name)) continue
    const named = /^(now|at|instant|clock)$/i.test(name) || /timeout|ttl|deadline|grace/i.test(name) || /^(team|key)$/i.test(name)
    if (named) asked.push(name)
  }
  const args = {}
  for (const name of asked) {
    if (schemaProperties[name] === undefined) return { ok: false, reason: 'the schema requires ' + show(name) + ' and declares no shape for it', args: null, notes }
    args[name] = valueFor(name, schemaProperties[name], '')
  }
  return { ok: true, reason: null, args, notes, required: asked, declared: declared.sort() }
}

/** The probe records: hand-made ledger rows, the same shapes the R36 failover gate uses. */
const probeRecords = (module) => {
  const member = (seq, id) => ({ seq, writer: 'w-' + id, instance: 'i1', kind: 'member/state', actor: TEAM, subject: id, payload: { id, name: id, state: 'active', role: 'member' } })
  const task = (seq, id, state, owner) => ({ seq, writer: 'w-probe', instance: 'i1', kind: 'task/state', actor: TEAM, subject: id, payload: { id, state, owner, revision: REVISION, capability: DEMAND } })
  const beat = (seq, id, at) => ({ seq, writer: 'w-' + id, instance: 'i1', kind: 'member/heartbeat', actor: TEAM, subject: id, payload: { id, at } })
  const never = [member(1, HOLDER), task(2, TASK, 'in_progress', HOLDER)]
  const fresh = never.concat([beat(3, HOLDER, T0)])
  const elsewhere = never.concat([beat(4, BYSTANDER, T0)])
  const dropped = fresh.filter((record) => record.kind !== 'member/heartbeat')
  const project = (records) => module.projectTeamState(records.map((record) => ({ ...record, payload: { ...record.payload } })))
  return {
    key: typeof module.boardKey === 'function' ? module.boardKey(TEAM, TASK) : TEAM + '\u0000' + TASK,
    never: project(never),
    fresh: project(fresh),
    elsewhere: project(elsewhere),
    dropped: project(dropped)
  }
}

const VERDICT_SHAPES = [
  { id: '(state, key, now, {timeoutMs, ttlMs})', build: (state, key, now, opts) => [state, key, now, { timeoutMs: opts.timeoutMs, ttlMs: opts.ttlMs }] },
  { id: '(state, key, now, {timeoutMs})', build: (state, key, now, opts) => [state, key, now, { timeoutMs: opts.timeoutMs }] },
  { id: '(state, key, now, {ttlMs})', build: (state, key, now, opts) => [state, key, now, { ttlMs: opts.ttlMs }] },
  { id: '(state, holder, now, {timeoutMs, ttlMs})', build: (state, _key, now, opts) => [state, HOLDER, now, { timeoutMs: opts.timeoutMs, ttlMs: opts.ttlMs }] },
  { id: '(state, now, {timeoutMs, ttlMs})', build: (state, _key, now, opts) => [state, now, { timeoutMs: opts.timeoutMs, ttlMs: opts.ttlMs }] }
]

/** Find the one shipped verdict by behaviour: never-beat says yes, beat-a-second-ago says no, one boolean apart. */
const discoverVerdict = (module, probes) => {
  const candidates = Object.keys(module).filter((name) => typeof module[name] === 'function' && VERDICT_EXPORT.test(name)).sort()
  const tried = []
  const matches = []
  const call = (name, build, state, now) => {
    try {
      const value = module[name](...build(state, probes.key, now, { timeoutMs: TIMEOUT_MS, ttlMs: TIMEOUT_MS }))
      // An export may be async: a probe with the wrong shape would otherwise reject unhandled and take
      // this gate's whole process down, hiding the reading it was measuring.
      if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
        Promise.resolve(value).catch(() => {})
        return { ok: false, error: 'the export returned a promise: it writes, so it is not the reading this gate is looking for' }
      }
      return { ok: true, value }
    } catch (error) { return { ok: false, error: String(error && error.message ? error.message : error) } }
  }
  for (const name of candidates) {
    for (const shape of VERDICT_SHAPES) {
      const yes = call(name, shape.build, probes.never, T0 + 1000)
      const no = call(name, shape.build, probes.fresh, T0 + 1000)
      if (yes.ok !== true || no.ok !== true) { tried.push(name + ' ' + shape.id + ' -> ' + clip(yes.ok ? no.error : yes.error, 60)); continue }
      const found = flips(yes.value, no.value)
      tried.push(name + ' ' + shape.id + ' -> ' + String(found.length) + ' flipping path(s)')
      const picked = pickDecision(found)
      if (picked !== null) matches.push({ name, shape: shape.id, build: shape.build, path: picked.path, pathText: picked.pathText, never: picked.yes, fresh: picked.no, flipped: found.map((flip) => flip.pathText) })
    }
  }
  // One verdict may answer to several call shapes - the same function called three compatible ways is
  // still one function. The identity this gate pins is (export, field), not (export, argument list).
  const onePerName = new Map()
  for (const match of matches) if (onePerName.has(match.name) === false) onePerName.set(match.name, match)
  const distinct = [...onePerName.values()]
  const preferred = distinct.filter((match) => /reclaim/i.test(match.name))
  const chosen = distinct.length === 1 ? distinct[0] : (preferred.length === 1 ? preferred[0] : null)
  return {
    candidates: candidates.length,
    tried,
    matches: matches.map((match) => ({ name: match.name, shape: match.shape, path: match.pathText, never: match.never, fresh: match.fresh, flipped: match.flipped })),
    distinct: distinct.map((match) => match.name),
    chosen: chosen === null ? null : { name: chosen.name, shape: chosen.shape, path: chosen.path, pathText: chosen.pathText }
  }
}

// ---------------------------------------------------------------------------
// Collection: the worlds, measured once
// ---------------------------------------------------------------------------

const collect = async (module) => {
  const progress = []
  const root = mkdtempSync(join(tmpdir(), 'r181-reclaim-'))
  const world = { module: MODULE_PATH, root, dir: join(root, 'collab'), at: Date.now(), warnings: [] }

  // 8 -- the shipped surface, measured in worlds of its own: what the default composition admits, and what
  // the switch turns off. Gate 107 pins the same admission from its side, so these two worlds are the other
  // half of one contract: exactly one extra name, never a smuggled second.
  const surfaceOf = async (tag, config) => {
    const builtSurface = await buildWorld(module, mkdtempSync(join(root, tag + '-')), config)
    const seen = {
      config: show(config),
      applied: builtSurface.applied,
      registry: [...builtSurface.registry.keys()].sort(),
      available: builtSurface.collab?.tools?.available ?? null,
      names: builtSurface.collab?.tools?.names ? [...builtSurface.collab.tools.names].sort() : null,
      reason: builtSurface.collab?.tools?.reason ?? null,
      reclaimDoor: typeof builtSurface.collab?.reclaim === 'function'
    }
    for (const dispose of builtSurface.disposers) { try { dispose() } catch { /* the world is being thrown away */ } }
    return seen
  }
  world.surfaces = {
    plain: await surfaceOf('plain', {}),
    off: await surfaceOf('off', { reclaim: { enabled: false } })
  }
  progress.push('default surface: ' + show(world.surfaces.plain.registry))
  progress.push('switch off:      ' + show(world.surfaces.off.registry))

  const built = await buildWorld(module, root, { reclaim: { enabled: true, timeoutMs: TIMEOUT_MS } })
  world.applied = built.applied
  world.registry = {
    names: [...built.registry.keys()].sort(),
    available: built.collab?.tools?.available ?? null,
    reason: built.collab?.tools?.reason ?? null,
    capabilityNames: built.collab?.tools?.names ? [...built.collab.tools.names].sort() : null,
    reclaimDoor: typeof built.collab?.reclaim === 'function'
  }
  world.collabPublished = built.collab !== undefined
  world.ledger = { initial: readLedger(built.dir), files: [] }
  progress.push('world: ' + show(root))
  try { world.ledger.files = readdirSync(built.dir) } catch { world.ledger.files = [] }
  if (built.applied.ok !== true || built.collab === undefined) {
    for (const dispose of built.disposers) { try { dispose() } catch { /* the world is being thrown away */ } }
    return { world, progress, fatal: 'apply() did not publish linkCollab in this world: ' + show(built.applied.error ?? 'no capability provided') }
  }

  // The tool this whole gate is about, found by its name among the registered definitions.
  const reclaimNames = world.registry.names.filter((name) => RECLAIM_TOOL.test(name))
  world.tool = { names: reclaimNames, name: reclaimNames.length === 1 ? reclaimNames[0] : null, schema: null, schemaField: null, schemaText: null, args: null, fill: null, notes: [], call: null, gained: [], release: null, isolation: null, oldArgs: null, oldCall: null, oldGained: [], refusalArgs: null, refusal: null, nobodyArgs: null, nobodyCall: null, nobodyGained: [] }

  const seedNow = Date.now()
  const beats = { fresh: seedNow - 1000, old: seedNow - 24 * 60 * 60 * 1000 }
  world.seed = { at: seedNow, beats, plan: [], ok: false, error: null, rows: [] }
  const seedPlan = [
    { kind: 'member/state', actor: TEAM, subject: RECLAIMER, payload: { id: RECLAIMER, name: RECLAIMER, state: 'active', role: 'member' } },
    { kind: 'member/state', actor: TEAM, subject: HOLDER, payload: { id: HOLDER, name: HOLDER, state: 'active', role: 'member' } },
    { kind: 'member/state', actor: TEAM, subject: HOLDER_FRESH, payload: { id: HOLDER_FRESH, name: HOLDER_FRESH, state: 'active', role: 'member' } },
    { kind: 'member/state', actor: TEAM, subject: HOLDER_OLD, payload: { id: HOLDER_OLD, name: HOLDER_OLD, state: 'active', role: 'member' } },
    { kind: 'capability/state', actor: TEAM, subject: RECLAIMER, payload: { id: RECLAIMER, member: RECLAIMER, capability: DEMAND, state: 'granted' } },
    { kind: 'member/heartbeat', actor: TEAM, subject: HOLDER_FRESH, payload: { id: HOLDER_FRESH, at: beats.fresh } },
    { kind: 'member/heartbeat', actor: TEAM, subject: HOLDER_OLD, payload: { id: HOLDER_OLD, at: beats.old } },
    { kind: 'task/state', actor: TEAM, subject: TASK, payload: { id: TASK, state: 'in_progress', owner: HOLDER, revision: REVISION, capability: DEMAND } },
    { kind: 'task/state', actor: TEAM, subject: TASK_FRESH, payload: { id: TASK_FRESH, state: 'in_progress', owner: HOLDER_FRESH, revision: REVISION, capability: DEMAND } },
    { kind: 'task/state', actor: TEAM, subject: TASK_OLD, payload: { id: TASK_OLD, state: 'in_progress', owner: HOLDER_OLD, revision: REVISION, capability: DEMAND } },
    { kind: 'task/state', actor: TEAM, subject: TASK_NOBODY, payload: { id: TASK_NOBODY, state: 'in_progress', revision: REVISION, capability: DEMAND } }
  ]
  world.seed.plan = seedPlan.map((record) => ({ kind: record.kind, subject: record.subject ?? null, payload: record.payload ?? null }))
  try {
    for (const record of seedPlan) await built.collab.log.append(record)
    world.seed.ok = true
  } catch (error) {
    world.seed.error = String(error && error.message ? error.message : error)
  }
  world.ledger.seeded = readLedger(built.dir)
  try { world.ledger.files = readdirSync(built.dir) } catch { world.ledger.files = [] }
  world.seed.rows = world.ledger.seeded.rows.map((row) => ({ seq: row.seq, kind: row.kind, actor: row.actor ?? null, subject: row.subject ?? null, payload: row.payload ?? null }))
  const stateBefore = built.collab.state()
  world.fold = {
    before: foldText(stateBefore),
    beforeAxes: Object.keys(foldOf(stateBefore)).sort(),
    taskBefore: taskRows(stateBefore, [TASK, TASK_FRESH, TASK_OLD, TASK_NOBODY]),
    quarantineBefore: (stateBefore.quarantine ?? []).map((row) => ({ memberId: row.memberId ?? null, reason: row.reason ?? null, task: row.task ?? null })),
    after: null,
    afterTask: null,
    diffAxes: [],
    afterOld: null,
    oldTask: null,
    quarantineAfterOld: [],
    afterNobody: null,
    nobodyTask: null,
    afterRefusal: null,
    refusalDiff: []
  }
  if (world.tool.name !== null) {
    const definition = built.registry.get(world.tool.name)
    // The shipped definitions put the JSON Schema in 'parameters'; the other two spellings are read so a
    // tool that declares its input under a different name is still measurable rather than invisible.
    const declared = definition === undefined ? null : (definition.parameters ?? definition.inputSchema ?? definition.schema ?? null)
    world.tool.schemaField = definition === undefined ? null : (definition.parameters !== undefined ? 'parameters' : (definition.inputSchema !== undefined ? 'inputSchema' : (definition.schema !== undefined ? 'schema' : null)))
    world.tool.schemaText = declared === null ? null : clip(show(declared), 1200)
    world.tool.schema = declared
    // The instant the gate calls at is AFTER the seed: the board resolves conflicting claims by (at, seq),
    // so a call stamped before the claim it releases loses silently - which is a property of the board, not
    // of this feature, and a real caller passes "now".
    world.tool.callAt = Math.max(Date.now(), seedNow + 1)
    const filled = fillArgs(world.tool.schema, { task: TASK, team: TEAM, member: RECLAIMER, now: world.tool.callAt, timeoutMs: TIMEOUT_MS, key: module.boardKey(TEAM, TASK) })
    world.tool.fill = { ok: filled.ok === true, reason: filled.reason ?? null }
    world.tool.notes = filled.notes ?? []
    world.tool.args = filled.args
  }

  const callTool = async (name, args) => {
    const definition = built.registry.get(name)
    if (definition === undefined) return { ok: false, missing: true, error: name + ' is not in the registry' }
    try {
      const value = await definition.execute(args)
      let plainValue = null
      try { plainValue = JSON.parse(JSON.stringify(value)) } catch { plainValue = null }
      return { ok: true, value: plainValue, raw: clip(show(value), 900) }
    } catch (error) {
      return { ok: false, missing: false, error: String(error && error.message ? error.message : error), name: error && error.name ? error.name : null, code: error && error.code !== undefined ? error.code : null }
    }
  }
  /** The same argument object aimed at another task. */
  const aimedAt = (args, taskId) => {
    if (args === null) return null
    const next = { ...args }
    for (const key of Object.keys(next)) {
      if (/^(task|taskId|task_id|id)$/i.test(key)) next[key] = taskId
      if (/key/i.test(key)) next[key] = module.boardKey(TEAM, taskId)
    }
    return next
  }
  /** Split the rows one call gained into the row that releases the task and the row that isolates its owner. */
  const splitRows = (gained) => {
    const release = gained.find((row) => [TASK, TASK_FRESH, TASK_OLD, TASK_NOBODY].includes(String(row.subject)) || [TASK, TASK_FRESH, TASK_OLD, TASK_NOBODY].includes(String(row.payload?.id))) ?? null
    const isolation = gained.find((row) => row !== release && (/quarantin|isolat/i.test(String(row.kind)) || /quarantin|isolat/i.test(String(row.text)))) ?? gained.find((row) => row !== release) ?? null
    return { release, isolation }
  }

  // 3 -- the tool, called once for the task whose holder never beat ---------------------------------
  if (world.tool.name !== null && world.tool.args !== null) world.tool.call = await callTool(world.tool.name, world.tool.args)
  else if (world.tool.name !== null) world.tool.call = { ok: false, missing: false, error: 'this gate could not build the declared arguments: ' + show(world.tool.fill?.reason ?? null) }
  else world.tool.call = { ok: false, missing: true, error: 'no reclaiming tool in the registry: ' + show(world.registry.names) }
  world.ledger.afterReclaim = readLedger(built.dir)
  world.tool.gained = rowsGained(world.ledger.seeded, world.ledger.afterReclaim)
  const split = splitRows(world.tool.gained)
  world.tool.release = split.release
  world.tool.isolation = split.isolation
  const stateAfter = built.collab.state()
  world.fold.after = foldText(stateAfter)
  world.fold.afterAxes = Object.keys(foldOf(stateAfter)).sort()
  world.fold.diffAxes = changedAxes(foldOf(stateBefore), foldOf(stateAfter))
  world.fold.afterTask = taskRows(stateAfter, [TASK, TASK_FRESH, TASK_OLD, TASK_NOBODY])
  world.fold.quarantineAfter = (stateAfter.quarantine ?? []).map((row) => ({ memberId: row.memberId ?? null, reason: row.reason ?? null, task: row.task ?? null }))

  // 7 -- the same call for a holder that beat a day ago: silence past the timeout, not no beat at all ---
  world.tool.oldArgs = aimedAt(world.tool.args, TASK_OLD)
  world.tool.oldCall = world.tool.name === null || world.tool.oldArgs === null
    ? { ok: false, missing: true, error: 'no tool to call' }
    : await callTool(world.tool.name, world.tool.oldArgs)
  world.ledger.afterOldReclaim = readLedger(built.dir)
  world.tool.oldGained = rowsGained(world.ledger.afterReclaim, world.ledger.afterOldReclaim)
  const stateOld = built.collab.state()
  world.fold.afterOld = foldText(stateOld)
  world.fold.oldTask = taskRows(stateOld, [TASK_OLD])
  world.fold.quarantineAfterOld = (stateOld.quarantine ?? []).map((row) => ({ memberId: row.memberId ?? null, reason: row.reason ?? null, task: row.task ?? null }))

  // 9 -- the live ledger's own case: in_progress and owned by nobody -----------------------------------
  world.tool.nobodyArgs = aimedAt(world.tool.args, TASK_NOBODY)
  world.tool.nobodyCall = world.tool.name === null || world.tool.nobodyArgs === null
    ? { ok: false, missing: true, error: 'no tool to call' }
    : await callTool(world.tool.name, world.tool.nobodyArgs)
  world.ledger.afterNobody = readLedger(built.dir)
  world.tool.nobodyGained = rowsGained(world.ledger.afterOldReclaim, world.ledger.afterNobody)
  const stateNobody = built.collab.state()
  world.fold.afterNobody = foldText(stateNobody)
  world.fold.nobodyTask = taskRows(stateNobody, [TASK_NOBODY])
  world.fold.quarantineNobody = (stateNobody.quarantine ?? []).map((row) => ({ memberId: row.memberId ?? null, reason: row.reason ?? null, task: row.task ?? null }))

  // 4 -- the paired control: the same call for a holder that beat one second ago --------------------
  world.tool.refusalArgs = aimedAt(world.tool.args, TASK_FRESH)
  world.ledger.beforeRefusal = readLedger(built.dir)
  world.tool.refusal = world.tool.name === null || world.tool.refusalArgs === null
    ? { ok: false, missing: true, error: 'no tool to call' }
    : await callTool(world.tool.name, world.tool.refusalArgs)
  world.ledger.afterRefusal = readLedger(built.dir)
  const stateRefused = built.collab.state()
  world.fold.afterRefusal = foldText(stateRefused)
  world.fold.refusalDiff = changedAxes(foldOf(stateNobody), foldOf(stateRefused))

  // 2 and 5 -- the verdict, discovered by behaviour and then asked at four instants -----------------
  const probes = probeRecords(module)
  const discovery = discoverVerdict(module, probes)
  world.pure = {
    candidates: discovery.candidates,
    tried: discovery.tried,
    matches: discovery.matches,
    distinct: discovery.distinct,
    found: discovery.chosen,
    neverBeat: null,
    inTimeout: null,
    boundary: null,
    oldBeat: null,
    repeat: null,
    deadClock: null,
    droppedBeat: null,
    elsewhereBeat: null
  }
  const chosen = discovery.chosen
  if (chosen !== null) {
    const shape = VERDICT_SHAPES.find((entry) => entry.id === chosen.shape)
    const ask = (state, now) => {
      try {
        const value = module[chosen.name](...shape.build(state, probes.key, now, { timeoutMs: TIMEOUT_MS, ttlMs: TIMEOUT_MS }))
        const raw = readPath(value, chosen.path)
        return { ok: true, norm: verdictOfRaw(raw), raw: clip(show(raw), 120), label: labelOf(value), whole: clip(show(value), 400) }
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error), norm: null, raw: null, label: null }
      }
    }
    world.pure.neverBeat = ask(probes.never, T0 + 1000)
    world.pure.inTimeout = ask(probes.fresh, T0 + 1000)
    world.pure.boundary = ask(probes.fresh, T0 + TIMEOUT_MS)
    world.pure.oldBeat = ask(probes.fresh, T0 + 24 * 60 * 60 * 1000)
    const once = ask(probes.fresh, T0 + 1000)
    const twice = ask(probes.fresh, T0 + 1000)
    world.pure.repeat = { identical: once.ok === true && twice.ok === true && same(once.whole, twice.whole), first: once.whole, second: twice.whole }
    const dead = underDeadClock(() => module[chosen.name](...shape.build(probes.fresh, probes.key, T0 + 1000, { timeoutMs: TIMEOUT_MS, ttlMs: TIMEOUT_MS })))
    world.pure.deadClock = dead.ok === true
      ? { ok: true, norm: verdictOfRaw(readPath(dead.value, chosen.path)), raw: clip(show(readPath(dead.value, chosen.path)), 120), identical: clip(show(dead.value), 400) === world.pure.inTimeout.whole }
      : { ok: false, error: dead.error, norm: null, raw: null, identical: false }
    world.pure.droppedBeat = ask(probes.dropped, T0 + 1000)
    world.pure.elsewhereBeat = ask(probes.elsewhere, T0 + 1000)
  }

  for (const dispose of built.disposers) { try { dispose() } catch { /* the world is being thrown away */ } }
  return { world, progress, fatal: null }
}

// ---------------------------------------------------------------------------
// The judge: pure over the measured world, so --self-attack can mutate the world itself
// ---------------------------------------------------------------------------

const judge = (world) => {
  const readings = []
  const add = (id, ok, detail, evidence) => readings.push({ id, ok, detail, evidence: Array.isArray(evidence) ? evidence : [] })
  /**
   * Every row one reclaim appended, accounted for. Exactly one row releases the task (it names the task
   * and carries no owner, with the seed's revision continued), and - if the shipped build writes the
   * isolation as its own record - exactly one more row carries the isolation fact naming the member that
   * was cleared. Nothing else may be written. The FACT is the contract here, not its packing: a build may
   * carry the isolation inside the release row or as a second record, and this gate reads either, but an
   * unexplained row, a missing release or an isolation that names nobody reddens the reading.
   */
  const auditRows = (gained, taskId, holderId, issues) => {
    // The task identity is subject/payload.id: a QUARANTINE row also names the task in payload.task, so
    // payload.task alone would count the isolation record as a second release.
    const releases = gained.filter((row) => {
      const names = row.subject === taskId || row.payload?.id === taskId
      return names === true && (row.payload?.owner ?? null) === null
    })
    if (releases.length !== 1) issues.push('the call wrote ' + show(releases.length) + ' row(s) that release ' + show(taskId) + ' with no owner, where exactly one is expected: ' + show(gained.map((row) => row.text)))
    const release = releases[0] ?? null
    const others = gained.filter((row) => row !== release)
    if (others.length > 1) issues.push('the call wrote ' + show(others.length) + ' rows besides the release of ' + show(taskId) + ': ' + show(others.map((row) => row.text)))
    const isolation = others[0] ?? null
    if (release !== null) {
      const revision = release.payload?.revision ?? release.revision ?? null
      if (revision !== REVISION + 1) issues.push('the release row carries revision ' + show(revision) + ' instead of the seeded ' + String(REVISION) + ' + 1: ' + show(release.text))
    }
    const named = (release !== null && release.text.includes(holderId))
      || (isolation !== null && (isolation.text.includes(holderId) || isolation.subject === holderId || isolation.payload?.id === holderId || isolation.payload?.memberId === holderId))
    if (named !== true) issues.push('nothing the call wrote names the reclaimed member ' + show(holderId) + ', so it records no isolation fact about it: ' + show(gained.map((row) => row.text)))
    return { release, isolation, packing: isolation === null ? 'carried by the release row' : 'a record of its own (' + show(isolation.kind) + ')' }
  }
  /** The keys the answer and the rows share, compared so 'what it said' is 'what the file gained'. */
  const sharedFields = (answer, rows, issues) => {
    if (answer === null || typeof answer !== 'object') return
    for (const key of ['seq', 'kind', 'task', 'taskId', 'id', 'subject', 'state', 'member', 'memberId', 'holder', 'owner', 'revision', 'team', 'code', 'reclaimedFrom']) {
      if (answer[key] === undefined) continue
      for (const row of rows) {
        if (row === null) continue
        const inRow = row[key] !== undefined ? row[key] : (row.payload === null ? undefined : row.payload[key])
        if (inRow === undefined) continue
        if (same(answer[key], inRow) !== true) issues.push('the answer says ' + key + '=' + show(answer[key]) + ' while the row says ' + show(inRow))
        break
      }
    }
  }

  // 1 ------------------------------------------------------------------------
  {
    const issues = []
    if (world.applied?.ok !== true) issues.push('apply() threw in this world: ' + show(world.applied?.error ?? null))
    if (world.collabPublished !== true) issues.push('apply() published no linkCollab capability')
    if ((world.registry?.names ?? []).length === 0) issues.push('apply() registered no tool at all')
    for (const name of DECLARING_TOOLS) if ((world.registry?.names ?? []).includes(name) === false) issues.push('the registry no longer holds ' + show(name) + ': ' + show(world.registry?.names ?? []))
    if (world.tool.names.length === 0) issues.push('no registered tool announces reclaiming (looked for ' + String(RECLAIM_TOOL) + '): ' + show(world.registry?.names ?? []))
    if (world.tool.names.length > 1) issues.push('more than one tool announces reclaiming: ' + show(world.tool.names))
    if (world.ledger?.seeded?.present !== true) issues.push('the world wrote no control.jsonl at ' + show(world.ledger?.seeded?.path ?? null) + ' (dir holds ' + show(world.ledger?.files ?? []) + ')')
    if ((world.ledger?.initial?.rows ?? []).length !== 0) issues.push('the world did not start empty: control.jsonl already held ' + show((world.ledger?.initial?.rows ?? []).length) + ' row(s)')
    if (world.seed?.ok !== true) issues.push('the gate could not seed the world through the plugin own log: ' + show(world.seed?.error ?? null))
    if ((world.seed?.rows ?? []).length !== (world.seed?.plan ?? []).length) issues.push('the ledger gained ' + show((world.seed?.rows ?? []).length) + ' row(s) for the ' + show((world.seed?.plan ?? []).length) + ' the gate appended, so this gate is not reading the ledger the plugin writes')
    const seeded = Object.fromEntries((world.seed?.rows ?? []).filter((row) => row.kind === 'task/state').map((row) => [String(row.payload?.id ?? row.subject), row.payload ?? null]))
    for (const [id, owner, status] of [[TASK, HOLDER, 'in_progress'], [TASK_FRESH, HOLDER_FRESH, 'in_progress'], [TASK_OLD, HOLDER_OLD, 'in_progress'], [TASK_NOBODY, null, 'in_progress']]) {
      const row = seeded[id]
      if (row === undefined) { issues.push('the fold cannot read the seeded task ' + show(id)); continue }
      if ((row.owner ?? null) !== owner) issues.push('the seeded task ' + show(id) + ' reads owner ' + show(row.owner ?? null) + ' instead of ' + show(owner))
      if (row.state !== status) issues.push('the seeded task ' + show(id) + ' reads state ' + show(row.state) + ' instead of ' + show(status))
      if (row.revision !== REVISION) issues.push('the seeded task ' + show(id) + ' reads revision ' + show(row.revision) + ' instead of ' + show(REVISION))
    }
    const tasks = world.fold?.taskBefore ?? []
    if (tasks.length !== 4) issues.push('the fold reads ' + show(tasks.length) + ' of the 4 seeded tasks: ' + show(tasks))
    if (world.tool.name !== null && world.tool.schemaText === null) issues.push('the reclaim tool declares no input schema under parameters/inputSchema/schema')
    if (world.tool.name !== null && world.tool.fill?.ok !== true) issues.push('this gate cannot fill the tool declared arguments: ' + show(world.tool.fill?.reason ?? null))
    if (world.tool.name !== null && world.tool.args === null) issues.push('this gate has no argument object to call the tool with')
    add('1-the-world-is-the-shipped-registration-and-it-holds-the-reclaim-tool', issues.length === 0,
      issues.length === 0
        ? 'a composition that ASKS for the reclaim tool got ' + show(world.registry.names) + ' - the three declaring tools plus exactly one that announces reclaiming (' + show(world.tool.name) + '); the fresh ledger held 0 rows and the gate own seed landed as written (4 in_progress tasks: three owned with their own heartbeat history, one owned by nobody)'
        : issues.join('; '),
      ['registered tools: ' + show(world.registry.names),
        'linkCollab.tools: available=' + show(world.registry?.available ?? null) + ' names=' + show(world.registry?.capabilityNames ?? null) + ' reason=' + show(world.registry?.reason ?? null),
        'control.jsonl: ' + show(world.ledger?.seeded?.path ?? null) + ' -> ' + show((world.ledger?.initial?.rows ?? []).length) + ' rows at open, ' + show((world.seed?.rows ?? []).length) + ' after the seed (' + show(kindsOf((world.seed?.rows ?? []).map((row) => ({ kind: row.kind })))) + ')',
        'seed instants: ' + show(world.seed?.beats ?? null) + ' against a timeout of ' + String(TIMEOUT_MS) + ' ms',
        'fold reads: ' + show(world.fold?.taskBefore ?? null),
        'tool schema (' + show(world.tool.schemaField ?? null) + '): ' + show(world.tool.schemaText),
        'tool arguments built by this gate: ' + show(world.tool.args) + ' | ' + (world.tool.notes ?? []).join(' | ')])
  }

  // 2 ------------------------------------------------------------------------
  {
    const issues = []
    if (world.pure.found === null) {
      issues.push('this gate could not find the shipped verdict by behaviour: ' + show(world.pure.matches) + ' (profiled ' + String(world.pure.candidates) + ' export(s); ' + (world.pure.tried ?? []).slice(0, 4).join(' | ') + ')')
    } else {
      const at = { neverBeat: world.pure.neverBeat, inTimeout: world.pure.inTimeout, boundary: world.pure.boundary, oldBeat: world.pure.oldBeat }
      for (const [name, reading] of Object.entries(at)) {
        if (reading === null || reading.ok !== true) issues.push('the verdict threw for ' + name + ': ' + show(reading?.error ?? null))
      }
      if (issues.length === 0) {
        if (world.pure.neverBeat.norm !== true) issues.push('a holder that NEVER beat while holding an in_progress task reads ' + show(world.pure.neverBeat.raw) + ', not reclaimable')
        if (world.pure.inTimeout.norm !== false) issues.push('a holder that beat 1 s ago reads ' + show(world.pure.inTimeout.raw) + ', not "still alive"')
        if (world.pure.boundary.norm !== true) issues.push('a beat EXACTLY timeoutMs old reads ' + show(world.pure.boundary.raw) + ', so the equality does not belong to "out of bounds"')
        if (world.pure.oldBeat.norm !== true) issues.push('a beat a day old reads ' + show(world.pure.oldBeat.raw) + ', not reclaimable')
        if (world.pure.neverBeat.label === null || world.pure.oldBeat.label === null) issues.push('the two reclaimable causes are not told apart by name in the answer (never-beat label ' + show(world.pure.neverBeat.label) + ', silent label ' + show(world.pure.oldBeat.label) + ')')
        else if (world.pure.neverBeat.label === world.pure.oldBeat.label) issues.push('a holder that never beat and a holder that beat and stopped carry the same name ' + show(world.pure.neverBeat.label) + ', so the ledger cannot tell them apart')
        if (world.pure.repeat?.identical !== true) issues.push('the same (state, now) answered differently twice: ' + show(world.pure.repeat))
        if (world.pure.deadClock?.ok !== true) issues.push('the verdict read a clock: with Date.now a thrower it ' + show(world.pure.deadClock?.error ?? 'answered differently'))
        else if (world.pure.deadClock.norm !== world.pure.inTimeout.norm) issues.push('with Date.now a thrower the verdict changed from ' + show(world.pure.inTimeout.raw) + ' to ' + show(world.pure.deadClock.raw))
      }
    }
    add('2-the-verdict-is-a-pure-function-of-the-latest-heartbeat-now-and-the-timeout', issues.length === 0,
      issues.length === 0
        ? 'the shipped verdict (' + world.pure.found.name + world.pure.found.shape + ', field ' + show(world.pure.found.pathText) + ') reads, at one state and one task: never beat => ' + show(world.pure.neverBeat.raw) + ' as ' + show(world.pure.neverBeat.label) + ', a beat 1 s old => ' + show(world.pure.inTimeout.raw) + ' as ' + show(world.pure.inTimeout.label) + ', a beat exactly ' + String(TIMEOUT_MS) + ' ms old => ' + show(world.pure.boundary.raw) + ' as ' + show(world.pure.boundary.label) + ', a beat a day old => ' + show(world.pure.oldBeat.raw) + ' as ' + show(world.pure.oldBeat.label) + '; the same call twice is byte-identical and a dead clock changes nothing'
        : issues.join('; '),
      ['discovery: ' + String(world.pure.candidates) + ' export(s) profiled, ' + String(world.pure.matches.length) + ' call shape(s) answered the two worlds differently, across ' + show(world.pure.distinct ?? []) + ' export(s)',
        'matches: ' + show(world.pure.matches),
        'pinned: ' + show(world.pure.found),
        'never beat: ' + show(world.pure.neverBeat),
        'beat 1 s ago: ' + show(world.pure.inTimeout),
        'beat exactly timeoutMs ago: ' + show(world.pure.boundary),
        'beat a day ago: ' + show(world.pure.oldBeat),
        'twice: ' + show(world.pure.repeat?.identical ?? null) + ' | dead clock: ' + show(world.pure.deadClock)])
  }

  // 3 ------------------------------------------------------------------------
  {
    const issues = []
    const call = world.tool.call ?? null
    const gained = world.tool.gained ?? []
    const release = world.tool.release ?? null
    const isolation = world.tool.isolation ?? null
    if (call === null || call.ok !== true) issues.push('the call did not succeed: ' + show(call?.error ?? null) + (call?.missing === true ? '' : ' (name ' + show(call?.name ?? null) + ', code ' + show(call?.code ?? null) + ')'))
    if (world.tool.name === null) issues.push('there is no tool to call')
    const audited = call !== null && call.ok === true ? auditRows(gained, TASK, HOLDER, issues) : { release: null, isolation: null, packing: null }
    if (call !== null && call.ok === true) sharedFields(call.value, [audited.release, audited.isolation].filter((row) => row !== null), issues)
    add('3-the-tool-really-reclaims-the-release-row-and-the-isolation-fact', issues.length === 0,
      issues.length === 0
        ? 'one call for the task whose holder never beat returned ' + show(world.tool.call.raw) + ' and the FILE gained ' + show(gained.length) + ' row(s): the release ' + show(audited.release.text) + ' (owner cleared, revision ' + String(REVISION + 1) + ') and the isolation fact naming ' + show(HOLDER) + ', ' + show(audited.packing) + ' - no row the call wrote is unaccounted for'
        : issues.join('; '),
      ['call: ' + show(call?.raw ?? call?.error ?? null),
      'rows gained: ' + show(gained.map((row) => row.seq)) + ' (' + show(kindsOf(gained.map((row) => ({ kind: row.kind })))) + ')',
      'the release row: ' + show(audited.release?.text ?? null),
      'the isolation row: ' + show(audited.isolation?.text ?? null) + ' (' + show(audited.packing) + ')',
      'the answer: ' + show(call?.value ?? null),
      'the isolation the fold reads: ' + show((world.fold.quarantineAfter ?? []).filter((row) => row.memberId === HOLDER))])
  }

  // 4 ------------------------------------------------------------------------
  {
    const issues = []
    const refusal = world.tool.refusal ?? null
    if (refusal.ok === true) {
      issues.push('the call for a holder that beat one second ago SUCCEEDED: ' + show(refusal.raw ?? null))
    } else if (refusal.missing === true) {
      issues.push('there was no tool to refuse with')
    } else {
      const text = String(refusal.error ?? '').trim()
      const named = REFUSAL_NAME.exec(text)
      if (named === null) issues.push('the refusal carries no leading name, so a model cannot act on it: ' + show(clip(text, 160)) + ' (thrown ' + show(refusal.name ?? null) + ')')
    }
    if (world.ledger.beforeRefusal.text !== world.ledger.afterRefusal.text) issues.push('the ledger MOVED across the refusal: ' + String(world.ledger.beforeRefusal.bytes) + ' bytes -> ' + String(world.ledger.afterRefusal.bytes) + ', rows ' + String(world.ledger.beforeRefusal.rows.length) + ' -> ' + String(world.ledger.afterRefusal.rows.length))
    if ((world.fold.refusalDiff ?? []).length !== 0) issues.push('the fold moved across the refusal: ' + show(world.fold.refusalDiff))
    add('4-the-conditions-not-met-are-refused-by-name-and-the-ledger-does-not-move', issues.length === 0,
      issues.length === 0
        ? 'the same call for a holder that beat one second ago was refused with ' + show(clip(String(world.tool.refusal.error ?? ''), 140)) + ', and control.jsonl is byte-identical around it (' + String(world.ledger.beforeRefusal.bytes) + ' bytes, ' + String(world.ledger.beforeRefusal.rows.length) + ' rows) with the fold unchanged'
        : issues.join('; '),
      ['call: ' + show(world.tool.name) + ' with ' + show(world.tool.refusalArgs),
      'outcome: ' + show(world.tool.refusal),
      'ledger: ' + show(world.ledger.beforeRefusal.path) + ' ' + String(world.ledger.beforeRefusal.bytes) + ' B -> ' + String(world.ledger.afterRefusal.bytes) + ' B; identical=' + String(world.ledger.beforeRefusal.text === world.ledger.afterRefusal.text),
      'fold axes moved: ' + show(world.fold.refusalDiff ?? [])])
  }

  // 5 ------------------------------------------------------------------------
  {
    const issues = []
    if (world.pure.found === null) issues.push('there is no discovered verdict to flip')
    else {
      if (world.pure.inTimeout?.norm !== false) issues.push('the baseline is not what the counterfactual needs: a beat one second old reads ' + show(world.pure.inTimeout?.raw))
      if (world.pure.droppedBeat === null || world.pure.droppedBeat.ok !== true) issues.push('the verdict threw when the heartbeat row was dropped: ' + show(world.pure.droppedBeat?.error ?? null))
      else if (world.pure.droppedBeat.norm !== true) issues.push('with the holder own heartbeat row dropped the verdict stayed ' + show(world.pure.droppedBeat.raw) + ', so the decision does not read that row')
      if (world.pure.elsewhereBeat === null || world.pure.elsewhereBeat.ok !== true) issues.push('the verdict threw when the beat was attributed to another member: ' + show(world.pure.elsewhereBeat?.error ?? null))
      else if (world.pure.elsewhereBeat.norm !== true) issues.push('the same beat attributed to ANOTHER member still reads ' + show(world.pure.elsewhereBeat.raw) + ', so the decision does not key on the holder')
    }
    add('5-the-counterfactuals-flip-the-verdict', issues.length === 0,
      issues.length === 0
        ? 'with the same records and the same instant: the holder beat one second ago => ' + show(world.pure.inTimeout.raw) + '; drop that heartbeat row => ' + show(world.pure.droppedBeat.raw) + '; keep the row but attribute it to ' + show(BYSTANDER) + ' => ' + show(world.pure.elsewhereBeat.raw)
        : issues.join('; '),
      ['beat one second ago: ' + show(world.pure.inTimeout),
      'that row dropped: ' + show(world.pure.droppedBeat),
      'that row attributed to ' + show(BYSTANDER) + ': ' + show(world.pure.elsewhereBeat)])
  }

  // 6 ------------------------------------------------------------------------
  {
    const issues = []
    const before = world.fold.before
    const after = world.fold.after
    if (before === null || after === null) issues.push('the gate never read the fold on both sides of the call')
    else {
      if (before === after) issues.push('the fold is byte-identical before and after the successful call, so the reclaim moved no reading at all')
      const axes = world.fold.diffAxes ?? []
      if (axes.includes('tasks') !== true) issues.push('the task axis did not move: ' + show(axes))
      const isolated = axes.some((axis) => ISOLATION_AXIS.test(axis))
      if (isolated !== true) issues.push('no member-shaped axis moved, so the isolation the call wrote is invisible in the fold: ' + show(axes))
      const quarantined = (world.fold.quarantineAfter ?? []).filter((row) => row.memberId === HOLDER)
      if (isolated === true && quarantined.length !== 1) issues.push('the fold holds ' + show(quarantined.length) + ' isolation fact(s) about ' + show(HOLDER) + ' after one reclaim: ' + show(world.fold.quarantineAfter ?? []))
      const taskAfter = (world.fold.afterTask ?? []).find((task) => task.id === TASK) ?? null
      if (taskAfter === null) issues.push('the fold no longer reads the reclaimed task at all')
      else if (taskAfter.owner !== null) issues.push('the fold still reads owner ' + show(taskAfter.owner) + ' on the reclaimed task, so the reclaim did not clear ownership')
      const taskBefore = (world.fold.taskBefore ?? []).find((task) => task.id === TASK) ?? null
      if (taskBefore !== null && taskBefore.owner !== HOLDER) issues.push('the baseline is not what this reading needs: the task read owner ' + show(taskBefore.owner) + ' before the call')
    }
    add('6-the-fold-changes-across-the-reclaim-and-not-across-the-refusal', issues.length === 0,
      issues.length === 0
        ? 'the fold moved across the call in ' + show(world.fold.diffAxes) + '- the task row and the isolation both reach it (' + show((world.fold.quarantineAfter ?? []).filter((row) => row.memberId === HOLDER)) + ') - and ' + show(TASK) + ' now reads owner null (status ' + show((world.fold.afterTask.find((task) => task.id === TASK) ?? {}).status) + '); the refused call left it byte-identical'
        : issues.join('; '),
      ['axes that differ across the successful call: ' + show(world.fold.diffAxes),
      'tasks before: ' + show(world.fold.taskBefore),
      'tasks after: ' + show(world.fold.afterTask),
      'the isolation as the fold reads it: ' + show(world.fold.quarantineBefore ?? []) + ' -> ' + show(world.fold.quarantineAfter ?? []),
      'axes that differ across the refused call: ' + show(world.fold.refusalDiff ?? [])])
  }

  // 7 ------------------------------------------------------------------------
  {
    const issues = []
    const call = world.tool.oldCall ?? null
    const gained = world.tool.oldGained ?? []
    if (call === null || call.ok !== true) issues.push('the same call for a holder that beat a day ago did not succeed: ' + show(call?.error ?? null) + ' (name ' + show(call?.name ?? null) + ')')
    const audited = call !== null && call.ok === true ? auditRows(gained, TASK_OLD, HOLDER_OLD, issues) : { release: null, isolation: null, packing: null }
    if (audited.release !== null && (world.tool.gained ?? []).some((earlier) => earlier.seq === audited.release.seq)) issues.push('both reclaims wrote the same row (seq ' + show(audited.release.seq) + '), so the ledger gained one row for two reclaims')
    const task = (world.fold.oldTask ?? [])[0] ?? null
    if (task === null) issues.push('the fold no longer reads the task ' + show(TASK_OLD))
    else if (task.owner !== null) issues.push('the fold still reads owner ' + show(task.owner) + ' on ' + show(TASK_OLD) + ' (status ' + show(task.status) + '), so a beat a day older than the ' + String(TIMEOUT_MS) + ' ms timeout was not enough to take the task back')
    add('7-a-stale-beat-is-reclaimed-too-and-not-by-the-same-row', issues.length === 0,
      issues.length === 0
        ? 'the same call for the holder that beat a day ago (' + show(HOLDER_OLD) + ') also returned ' + show(call.raw) + ' and gained its own DIFFERENT rows (seq ' + show(gained.map((row) => row.seq)) + ' vs the never-beat reclaim ' + show((world.tool.gained ?? []).map((row) => row.seq)) + '), releasing the task with revision ' + String(REVISION + 1) + ' and isolating that owner, ' + show(audited.packing) + '; the fold now reads owner null on ' + show(TASK_OLD) + ' too'
        : issues.join('; '),
      ['call: ' + show(world.tool.name) + ' with ' + show(world.tool.oldArgs),
      'outcome: ' + show(call?.raw ?? call?.error ?? null),
      'rows it gained: ' + show(gained.map((row) => row.text)),
      'the never-beat reclaim gained seq ' + show((world.tool.gained ?? []).map((entry) => entry.seq)),
      'the two arms differ in one thing only: which holder stopped answering, and how long ago'])
  }

  // 8 ------------------------------------------------------------------------
  {
    const issues = []
    const plain = world.surfaces?.plain ?? {}
    const off = world.surfaces?.off ?? {}
    if (plain.applied?.ok !== true) issues.push('apply() threw in the default world: ' + show(plain.applied?.error ?? null))
    if (off.applied?.ok !== true) issues.push('apply() threw in the world that switches the tool off: ' + show(off.applied?.error ?? null))
    // This reading owns THE RECLAIM SWITCH, not the whole tool face. Other rounds add writers to the same
    // face (the declaring trio in R179, the reclaimer here, the peer pair in R182) and gate 107 pins the
    // face as a whole; when this line asserted “exactly one extra name” it reddened the moment a
    // different round added its own tool, which says nothing about reclaiming. What must hold here is the
    // switch: the default composition carries a reclaimer, the switched-off one does not, and flipping it
    // removes exactly that one name and nothing else.
    const missingDeclaring = DECLARING_TOOLS.filter((name) => (plain.registry ?? []).includes(name) === false)
    if (missingDeclaring.length > 0) issues.push('the default composition no longer registers ' + show(missingDeclaring) + ': ' + show(plain.registry ?? []))
    const extra = (plain.registry ?? []).filter((name) => DECLARING_TOOLS.includes(name) === false)
    const reclaimNames = extra.filter((name) => RECLAIM_TOOL.test(name) === true)
    if (reclaimNames.length !== 1) issues.push('the default composition does not register exactly one reclaiming name: ' + show(extra))
    const offExtra = (off.registry ?? []).filter((name) => DECLARING_TOOLS.includes(name) === false)
    if (offExtra.some((name) => RECLAIM_TOOL.test(name) === true)) issues.push('a reclaimer is registered even though reclaiming was switched off: ' + show(off.registry ?? []))
    if (same(offExtra, extra.filter((name) => RECLAIM_TOOL.test(name) !== true)) !== true) issues.push('switching reclaiming off changed more than the reclaimer: default extras ' + show(extra) + ' vs off extras ' + show(offExtra))
    if (same(plain.registry ?? [], world.registry?.names ?? []) !== true) issues.push('the default composition and the composition that asks for the tool differ: ' + show(plain.registry ?? []) + ' vs ' + show(world.registry?.names ?? []))
    if (same(plain.registry ?? [], off.registry ?? []) === true) issues.push('switching reclaim off changed nothing: both worlds register ' + show(plain.registry ?? []))
    if ((off.registry ?? []).some((name) => RECLAIM_TOOL.test(name) === true)) issues.push('the switched-off composition still registers a reclaiming name: ' + show(off.registry ?? []))
    if (same(plain.names ?? [], plain.registry ?? []) !== true) issues.push('linkCollab.tools.names ' + show(plain.names ?? null) + ' disagrees with the registry ' + show(plain.registry ?? []))
    if (plain.available !== true) issues.push('linkCollab.tools.available is ' + show(plain.available) + ' in the default world (reason ' + show(plain.reason ?? null) + ')')
    if (off.available !== true) issues.push('linkCollab.tools.available is ' + show(off.available) + ' in the world with the tool switched off (reason ' + show(off.reason ?? null) + ')')
    if (plain.reclaimDoor !== true) issues.push('linkCollab.reclaim is not a function in the default world, so a caller with the capability has no door at all')
    if (off.reclaimDoor !== true) issues.push('linkCollab.reclaim is not a function in the world with the tool switched off, so the rule leaves with the tool')
    if (world.registry?.reclaimDoor !== true) issues.push('linkCollab.reclaim is not a function in the world this gate measured')
    add('8-the-shipped-surface-admits-one-extra-writer-and-the-switch-takes-it-back', issues.length === 0,
      issues.length === 0
        ? 'the default composition registers ' + show(plain.registry ?? []) + ' - the three declaring tools plus exactly the one admitted reclaimer - and {reclaim:{enabled:false}} leaves ' + show(off.registry ?? []) + '; linkCollab.reclaim is a function in both, so the rule survives the tool being switched off'
        : issues.join('; '),
      ['default composition: ' + show(plain.config) + ' -> ' + show(plain.registry ?? []),
      'switched off: ' + show(off.config) + ' -> ' + show(off.registry ?? []),
      'linkCollab.tools in the default world: available=' + show(plain.available) + ' names=' + show(plain.names ?? null) + ' reason=' + show(plain.reason ?? null),
      'linkCollab.reclaim: default ' + show(plain.reclaimDoor) + ', switched off ' + show(off.reclaimDoor) + ', measured ' + show(world.registry?.reclaimDoor ?? null),
      'gate 107 admits exactly the one reclaimer by name; a second name here would redden this reading and that gate'])
  }

  // 9 ------------------------------------------------------------------------
  {
    const issues = []
    const call = world.tool.nobodyCall ?? null
    const gained = world.tool.nobodyGained ?? []
    if (call === null || call.ok !== true) issues.push('the call for an in_progress row nobody owns did not succeed: ' + show(call?.error ?? null) + ' (name ' + show(call?.name ?? null) + ')')
    if (call !== null && call.ok === true && gained.length !== 1) issues.push('that call appended ' + show(gained.length) + ' row(s); with no owner there is nobody to isolate, so the release row is the whole write: ' + show(gained.map((row) => row.text)))
    const release = gained[0] ?? null
    if (release !== null) {
      const names = release.subject === TASK_NOBODY || release.payload?.id === TASK_NOBODY || release.payload?.task === TASK_NOBODY
      if (names !== true) issues.push('the row does not name the task ' + show(TASK_NOBODY) + ': ' + show(release.text))
      if ((release.payload?.owner ?? null) !== null) issues.push('the row carries owner ' + show(release.payload?.owner ?? null) + ' on a task nobody owned: ' + show(release.text))
    }
    const answered = call !== null && call.ok === true ? call.value : null
    if (answered !== null && typeof answered === 'object' && answered.isolationSeq !== undefined && answered.isolationSeq !== null) issues.push('the answer names an isolation fact (' + show(answered.isolationSeq) + ') for a task nobody owned')
    const quarantinedBefore = world.fold.quarantineAfterOld ?? []
    const quarantinedAfter = world.fold.quarantineNobody ?? []
    if (quarantinedAfter.length !== quarantinedBefore.length) issues.push('the call for a row nobody owned added ' + show(quarantinedAfter.length - quarantinedBefore.length) + ' isolation fact(s): ' + show(quarantinedAfter))
    const task = (world.fold.nobodyTask ?? [])[0] ?? null
    if (task === null) issues.push('the fold no longer reads the task ' + show(TASK_NOBODY))
    else if (task.owner !== null) issues.push('the fold reads owner ' + show(task.owner) + ' on a task that never had one')
    add('9-a-row-with-no-owner-is-released-without-isolating-anybody', issues.length === 0,
      issues.length === 0
        ? 'the in_progress row nobody owns (the live ledger own case) was released by the same tool with exactly ONE row (' + show(release.text) + ') and no isolation fact at all, and the fold reads it with no owner'
        : issues.join('; '),
      ['call: ' + show(world.tool.name) + ' with ' + show(world.tool.nobodyArgs),
      'outcome: ' + show(call?.raw ?? call?.error ?? null),
      'rows it gained: ' + show(gained.map((row) => row.text)),
      'the fold after: ' + show(world.fold.nobodyTask ?? []),
      'the isolation the fold held before and after: ' + show(world.fold.quarantineAfter ?? []) + ' -> ' + show(world.fold.quarantineNobody ?? [])])
  }

  return readings
}

// ---------------------------------------------------------------------------
// Self-attack: mutate the measured world, one fact per mutant
// ---------------------------------------------------------------------------

const clone = (world) => JSON.parse(JSON.stringify(world))

const mutants = (world) => {
  const release = world.tool.release ?? null
  const isolation = world.tool.isolation ?? null
  return [
    {
      name: 'never-beat-reads-as-still-alive',
      mustRedden: ['2-the-verdict-is-a-pure-function-of-the-latest-heartbeat-now-and-the-timeout'],
      world: (() => { const next = clone(world); next.pure.neverBeat.norm = false; next.pure.neverBeat.raw = 'healthy'; return next })()
    },
    {
      name: 'the-equality-does-not-belong-to-out-of-bounds',
      mustRedden: ['2-the-verdict-is-a-pure-function-of-the-latest-heartbeat-now-and-the-timeout'],
      world: (() => { const next = clone(world); next.pure.boundary.norm = false; next.pure.boundary.raw = 'healthy'; return next })()
    },
    {
      name: 'the-verdict-reads-an-ambient-clock',
      mustRedden: ['2-the-verdict-is-a-pure-function-of-the-latest-heartbeat-now-and-the-timeout'],
      world: (() => { const next = clone(world); next.pure.deadClock = { ok: false, error: 'the reader read the clock', norm: null, raw: null, identical: false }; return next })()
    },
    {
      name: 'the-two-reclaimable-causes-carry-one-name',
      mustRedden: ['2-the-verdict-is-a-pure-function-of-the-latest-heartbeat-now-and-the-timeout'],
      world: (() => { const next = clone(world); next.pure.oldBeat.label = next.pure.neverBeat.label; return next })()
    },
    {
      name: 'the-call-appends-nothing',
      mustRedden: ['3-the-tool-really-reclaims-the-release-row-and-the-isolation-fact'],
      world: (() => { const next = clone(world); next.ledger.afterReclaim = next.ledger.seeded; next.tool.gained = []; next.tool.release = null; next.tool.isolation = null; return next })()
    },
    {
      name: 'an-unexplained-third-row-is-written',
      mustRedden: ['3-the-tool-really-reclaims-the-release-row-and-the-isolation-fact'],
      world: (() => { const next = clone(world); const stray = { seq: 900, kind: 'gate-r181/stray', subject: 'gate-r181-stray', payload: { id: 'gate-r181-stray' }, text: '{"kind":"gate-r181/stray","subject":"gate-r181-stray"}' }; next.tool.gained = (world.tool.gained ?? []).concat([stray]); return next })()
    },
    {
      name: 'the-answer-invents-its-own-seq',
      mustRedden: ['3-the-tool-really-reclaims-the-release-row-and-the-isolation-fact'],
      world: (() => { const next = clone(world); next.tool.call.value = { ...(next.tool.call.value ?? {}), seq: 999 }; return next })()
    },
    {
      name: 'the-isolation-fact-names-nobody',
      mustRedden: ['3-the-tool-really-reclaims-the-release-row-and-the-isolation-fact'],
      world: (() => { const next = clone(world); if (release !== null) { const blanked = { ...release, text: release.text.replaceAll(HOLDER, 'gate-r181-nobody'), payload: { ...(release.payload ?? {}), reclaimed: { ...(release.payload?.reclaimed ?? {}), from: 'gate-r181-nobody' } } }; next.tool.gained = [blanked]; next.tool.release = blanked } return next })()
    },
    {
      name: 'the-release-row-keeps-the-seeded-revision',
      mustRedden: ['3-the-tool-really-reclaims-the-release-row-and-the-isolation-fact'],
      world: (() => { const next = clone(world); if (release !== null && release.payload !== null) { const kept = { ...release, payload: { ...release.payload, revision: REVISION } }; next.tool.gained = [kept]; next.tool.release = kept } return next })()
    },
    {
      name: 'the-refusal-appends-anyway',
      mustRedden: ['4-the-conditions-not-met-are-refused-by-name-and-the-ledger-does-not-move'],
      world: (() => { const next = clone(world); next.ledger.afterRefusal = { ...next.ledger.afterRefusal, text: next.ledger.afterRefusal.text + '{"seq":999}\n', bytes: next.ledger.afterRefusal.bytes + 12, rows: next.ledger.afterRefusal.rows.concat([{ seq: 999 }]) }; return next })()
    },
    {
      name: 'the-refusal-is-an-un-named-crash',
      mustRedden: ['4-the-conditions-not-met-are-refused-by-name-and-the-ledger-does-not-move'],
      world: (() => { const next = clone(world); next.tool.refusal = { ...next.tool.refusal, ok: false, missing: false, error: 'Cannot read properties of undefined (reading id)', name: 'TypeError' }; return next })()
    },
    {
      name: 'the-counterfactual-does-not-flip',
      mustRedden: ['5-the-counterfactuals-flip-the-verdict'],
      world: (() => { const next = clone(world); next.pure.droppedBeat = next.pure.inTimeout; return next })()
    },
    {
      name: 'the-beat-of-another-member-counts',
      mustRedden: ['5-the-counterfactuals-flip-the-verdict'],
      world: (() => { const next = clone(world); next.pure.elsewhereBeat = next.pure.inTimeout; return next })()
    },
    {
      name: 'the-owner-is-never-cleared',
      mustRedden: ['6-the-fold-changes-across-the-reclaim-and-not-across-the-refusal'],
      world: (() => { const next = clone(world); next.fold.afterTask = next.fold.afterTask.map((task) => task.id === TASK ? { ...task, owner: HOLDER } : task); return next })()
    },
    {
      name: 'the-fold-only-advances-its-counter',
      mustRedden: ['6-the-fold-changes-across-the-reclaim-and-not-across-the-refusal'],
      world: (() => { const next = clone(world); next.fold.after = next.fold.before; next.fold.diffAxes = []; next.fold.afterTask = next.fold.taskBefore; return next })()
    },
    {
      name: 'the-isolation-never-reaches-the-fold',
      mustRedden: ['6-the-fold-changes-across-the-reclaim-and-not-across-the-refusal'],
      world: (() => { const next = clone(world); next.fold.diffAxes = next.fold.diffAxes.filter((axis) => /quarantine|isolat|member/i.test(axis) === false); return next })()
    },
    {
      name: 'a-stale-beat-is-left-in-place',
      mustRedden: ['7-a-stale-beat-is-reclaimed-too-and-not-by-the-same-row'],
      world: (() => { const next = clone(world); next.tool.oldCall = { ok: false, missing: false, name: 'Error', code: null, error: 'RECLAIM_OWNER_ACTIVE: the holder is still inside its timeout' }; return next })()
    },
    {
      name: 'the-two-reclaims-write-the-same-row',
      mustRedden: ['7-a-stale-beat-is-reclaimed-too-and-not-by-the-same-row'],
      world: (() => { const next = clone(world); if (release !== null && next.tool.oldGained.length > 0) { const first = next.tool.oldGained[0]; next.tool.oldGained = [{ ...first, seq: release.seq, text: String(first.text).replace('"seq":' + String(first.seq), '"seq":' + String(release.seq)) }].concat(next.tool.oldGained.slice(1)) } return next })()
    },
    {
      name: 'the-stale-release-forgets-its-revision',
      mustRedden: ['7-a-stale-beat-is-reclaimed-too-and-not-by-the-same-row'],
      world: (() => { const next = clone(world); const at = next.tool.oldGained.findIndex((row) => row.subject === TASK_OLD || row.payload?.id === TASK_OLD || row.payload?.task === TASK_OLD); if (at !== -1 && next.tool.oldGained[at].payload !== null) next.tool.oldGained[at] = { ...next.tool.oldGained[at], payload: { ...next.tool.oldGained[at].payload, revision: REVISION } }; return next })()
    },
    {
      name: 'a-name-nobody-admitted-joins-the-default-surface',
      mustRedden: ['8-the-shipped-surface-admits-one-extra-writer-and-the-switch-takes-it-back'],
      world: (() => { const next = clone(world); next.surfaces.plain.registry = next.surfaces.plain.registry.concat(['gate-r181-smuggled-tool']).sort(); next.surfaces.plain.names = next.surfaces.plain.names.concat(['gate-r181-smuggled-tool']).sort(); return next })()
    },
    {
      name: 'the-switch-does-not-turn-the-tool-off',
      mustRedden: ['8-the-shipped-surface-admits-one-extra-writer-and-the-switch-takes-it-back'],
      world: (() => { const next = clone(world); next.surfaces.off.registry = next.surfaces.plain.registry.slice(); next.surfaces.off.names = next.surfaces.plain.names.slice(); return next })()
    },
    {
      name: 'the-rules-own-door-disappears',
      mustRedden: ['8-the-shipped-surface-admits-one-extra-writer-and-the-switch-takes-it-back'],
      world: (() => { const next = clone(world); next.surfaces.off.reclaimDoor = false; return next })()
    },
    {
      name: 'a-row-nobody-owns-waits-forever',
      mustRedden: ['9-a-row-with-no-owner-is-released-without-isolating-anybody'],
      world: (() => { const next = clone(world); next.tool.nobodyCall = { ok: false, missing: false, name: 'Error', code: null, error: 'RECLAIM_OWNER_ACTIVE: still inside its timeout' }; return next })()
    },
    {
      name: 'the-release-of-a-nameless-row-isolates-anybody',
      mustRedden: ['9-a-row-with-no-owner-is-released-without-isolating-anybody'],
      world: (() => { const next = clone(world); next.fold.quarantineNobody = next.fold.quarantineNobody.concat([{ memberId: HOLDER, reason: 'NEVER_BEAT', task: TASK_NOBODY }]); return next })()
    },
    {
      name: 'control-nothing-changed',
      mustRedden: [],
      world: clone(world)
    }
  ]
}

const runSelfAttack = async (started) => {
  const module = await loadModule()
  if (module === null) { console.log('SKIP: ' + MODULE_PATH + ' could not be imported, so there is no world to attack'); return 3 }
  const collected = await collect(module)
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); return 3 }
  const world = collected.world
  const base = judge(world)
  const baseRed = base.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  baseline in this world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' failed')
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed) + ' (a mutant declared against a reading that is already red proves nothing)')
    if (KEEP !== true) { try { rmSync(world.root, { recursive: true, force: true }) } catch { /* disposable */ } }
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
  console.log('  ' + String(built.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(built.filter((mutant) => mutant.mustRedden.length > 0).length) + ' of them declare a target | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  console.log('  note: the mutants attack the JUDGE over the world measured in this run; the measurement itself is not repeated per mutant.')
  if (KEEP !== true) { try { rmSync(world.root, { recursive: true, force: true }) } catch { /* disposable */ } }
  else console.log('        kept: ' + show(world.root))
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
  if (SELF_ATTACK) return await runSelfAttack(started)
  const module = await loadModule()
  if (module === null) return 3
  const collected = await collect(module)
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) { console.log('SKIP: ' + collected.fatal); return 3 }
  const readings = judge(collected.world)
  for (const reading of readings) {
    console.log('  ' + (reading.ok === true ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  if (KEEP !== true) { try { rmSync(collected.world.root, { recursive: true, force: true }) } catch { /* disposable */ } }
  else console.log('        kept: ' + show(collected.world.root))
  return failed.length > 0 ? 1 : 0
}

process.exitCode = await main()
