#!/usr/bin/env node
/**
 * R487 — multi-agent CPU hotspot simulator + audit harness.
 *
 * WHAT THIS IS
 * A reproducible instrument, not a claim: it generates synthetic 12-member (default, maxDepth 1)
 * and 24-member (multi-level, maxDepth 3) team streams and measures the TS costs the live LINK
 * pays for them. Every number it prints is measured on THIS machine in THIS run; the JSON it can
 * write carries artifact hashes so a later run can say whether the code changed.
 *
 * WHAT IT MEASURES, AND HOW FAITHFULLY
 *   - full re-fold: production projectTeamState (plugins/dsh-link-collab/lib/index.js, the built
 *     bundle the kernel actually loads), on ledger-shaped control records. Member/task/message
 *     rows are produced by feeding synthetic kernel session/event objects through the production
 *     teamEventToRecord, so the rows are the rows the recorder would write.
 *   - per-projection cost: each of the 15 production project* functions, so the fold's internal
 *     ranking is measured rather than inferred.
 *   - cached-poll path: a faithful teamState() stand-in (replay copy + (lastSeq,length) cache) plus
 *     the REAL teams route — the production apply() from plugins/dsh-link-teams/lib/index.js is
 *     mounted against a stub context and its real handler is called, so the measured poll includes
 *     the real snapshot(), world composition, row reduction and JSON.stringify.
 *   - JSON serialization: fold JSON, the route document, and the whole ledger as one string (the
 *     JS->native crossing any napi fold would pay).
 *   - incremental fold approximation: a harness-side entity fold (tasks/members/teams) that MUST
 *     reproduce the production fold field-for-field; the script fails loudly if it does not. It
 *     measures the per-append cost a maintained index would pay instead of a cold re-fold.
 *   - DIAG per-event logging: the production recordTeamEvents recorder is mounted and fed a
 *     synthetic session-event stream, with console.log left real (stdout pipe), redirected to a
 *     file sink, and silenced; the difference is the DIAG line's measured cost.
 *   - client event-window assembly: a faithful port of the kernel's leaf/concat/materialize window
 *     (packages/api/session-controller/src/client/contract/events.ts) plus the capped-window
 *     counterfactual, and the retained-heap-per-entry model behind B2 renderer growth.
 *   - churn ledger: claim-churn vs claim-stable ledgers of the same length, which is the losers
 *     quadratic (every disagreeing claim prepends to a copied array).
 *
 * WHAT IT DOES NOT DO
 * No kernel, shell or running LINK process is touched; no network; no restart; no build. It reads
 * production bundles from disk and runs them in this Node process. Renderer DOM/image costs (B2)
 * are modelled, not driven in a browser — the model and the live evidence are reported separately.
 *
 * HOW TO RUN
 *   node dsh-link/scripts/perf-multi-agent.mjs                  # full run, both modes
 *   node dsh-link/scripts/perf-multi-agent.mjs --quick          # smaller sizes, ~1/3 the time
 *   node dsh-link/scripts/perf-multi-agent.mjs --rows=10000,30000,100000 --modes=default
 *   node dsh-link/scripts/perf-multi-agent.mjs --engine=rust --out=.tmp/R487-perf.json
 * Needs Node >= 22.18: plain .mjs plus one .ts import (world.ts), which is strip-safe today (no
 * parameter properties). If a future world.ts is not strip-safe, run with
 * 'node --experimental-transform-types'.
 *
 * Exit codes: 0 = measured, 1 = the instrument's own premise failed (imports, incremental-fold
 * mismatch, teams route not bound), 2 = --engine=rust was requested and no addon was found.
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { countObjects, trackScenario } from './perf-instrument.mjs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/* ------------------------------------------------------------------ paths and arguments */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PATHS = {
  collabLib: join(REPO, 'plugins', 'dsh-link-collab', 'lib', 'index.js'),
  teamsLib: join(REPO, 'plugins', 'dsh-link-teams', 'lib', 'index.js'),
  worldSrc: join(REPO, 'plugins', 'dsh-link-teams', 'src', 'world.ts'),
  scratch: join(REPO, '.tmp'),
  computeLib: join(REPO, 'plugins', 'dsh-link-compute', 'lib'),
  rustRelease: join(REPO, 'rust', 'target', 'release'),
  rustDebug: join(REPO, 'rust', 'target', 'debug'),
}

const argv = process.argv.slice(2)
const options = {
  quick: argv.includes('--quick'),
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
  modes: ['default', 'multi-level'],
  rows: [10000, 30000, 100000],
  engine: 'auto',
  seed: 20261027,
  out: null,
  budgetMs: 800,
  eventWindowMax: 10000,
  diagEvents: 20000,
  runs: 1,
  instrument: 'full',
  stamp: false,
  skip: new Set(),
  exitCode: 0,
}
for (const arg of argv) {
  if (arg === '--stamp') { options.stamp = true; continue }
  const at = arg.indexOf('=')
  if (!arg.startsWith('--') || at < 0) continue
  const name = arg.slice(2, at)
  const value = arg.slice(at + 1)
  if (name === 'rows') options.rows = value.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
  else if (name === 'modes') options.modes = value.split(',').map((s) => s.trim()).filter(Boolean)
  else if (name === 'engine') options.engine = value
  else if (name === 'seed') options.seed = Number(value) | 0
  else if (name === 'out') options.out = resolve(REPO, value)
  else if (name === 'budget') options.budgetMs = Number(value)
  else if (name === 'diag-events') options.diagEvents = Number(value)
  else if (name === 'skip') for (const part of value.split(',')) options.skip.add(part.trim())
  else if (name === 'runs') options.runs = Math.max(1, Math.min(9, Number(value) | 0))
  else if (name === 'instrument') options.instrument = value === 'off' ? 'off' : 'full'
}
if (options.quick) {
  options.rows = [3000, 10000]
  options.budgetMs = 300
  options.diagEvents = 6000
  options.eventWindowMax = 3000
}
const HEADS_UP = options.json !== true

/**
 * Timestamped output path, so a re-run never overwrites the archive a document cites.
 * --stamp turns .tmp/R492-perf.json into .tmp/R492-perf-20261027T133354.json (UTC).
 */
function stampedPath(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dot = file.lastIndexOf('.')
  return dot < 0 ? file + '-' + stamp : file.slice(0, dot) + '-' + stamp + file.slice(dot)
}
const OUTPUT_FILE = options.out === null ? null : (options.stamp ? stampedPath(options.out) : options.out)

if (options.help) {
  console.log('R487 multi-agent perf harness.')
  console.log('  --quick              smaller sizes (3000,10000) for a smoke run')
  console.log('  --rows=a,b,c         ledger lengths to measure (default 10000,30000,100000)')
  console.log('  --modes=default,multi-level')
  console.log('  --engine=ts|rust|auto  (rust measures the napi addon when one exists)')
  console.log('  --runs=N             repeat the whole sweep N times and report each metric as the median across runs')
  console.log('  --instrument=full|off  per-scenario wall/CPU/RSS/heap/loop-lag/canary readings (default full)')
  console.log('  --seed=N --out=path --budget=ms --diag-events=N --json')
  console.log('  --skip=fold,projections,poll,json,incremental,diag,churn,window,rust')
  process.exit(0)
}

/* ------------------------------------------------------------------ small utilities */

const round = (value, digits = 3) => Number(value.toFixed(digits))
const mb = (bytes) => round(bytes / (1024 * 1024), 2)
const hrtimeMs = (start) => Number(process.hrtime.bigint() - start) / 1e6

function summarize(samples, totalMs) {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))]
  const mean = totalMs / samples.length
  return {
    reps: samples.length,
    totalMs: round(totalMs, 1),
    meanMs: round(mean, 3),
    p50Ms: round(quantile(0.5), 3),
    p95Ms: round(quantile(0.95), 3),
    p99Ms: round(quantile(0.99), 3),
    minMs: round(sorted[0], 3),
    maxMs: round(sorted[sorted.length - 1], 3),
    opsPerSec: mean > 0 ? round(1000 / mean, 1) : null,
  }
}

function measureSync(fn, settings = {}) {
  const warmup = settings.warmup ?? 1
  const minReps = settings.minReps ?? 5
  const maxReps = settings.maxReps ?? 500
  const budgetMs = settings.budgetMs ?? options.budgetMs
  for (let i = 0; i < warmup; i += 1) fn()
  const samples = []
  let total = 0
  for (let i = 0; i < maxReps; i += 1) {
    const start = process.hrtime.bigint()
    fn()
    const ms = hrtimeMs(start)
    samples.push(ms)
    total += ms
    if (samples.length >= minReps && total >= budgetMs) break
  }
  return summarize(samples, total)
}

async function measureAsync(fn, settings = {}) {
  const warmup = settings.warmup ?? 1
  const minReps = settings.minReps ?? 3
  const maxReps = settings.maxReps ?? 300
  const budgetMs = settings.budgetMs ?? options.budgetMs
  for (let i = 0; i < warmup; i += 1) await fn()
  const samples = []
  let total = 0
  for (let i = 0; i < maxReps; i += 1) {
    const start = process.hrtime.bigint()
    await fn()
    const ms = hrtimeMs(start)
    samples.push(ms)
    total += ms
    if (samples.length >= minReps && total >= budgetMs) break
  }
  return summarize(samples, total)
}

/* ------------------------------------------------------------------ R492 instrumentation */

/**
 * One instrumented repetition of a scenario, recorded beside the statistics.
 *
 * The statistics above answer "how long per operation"; this answers "what did that cost the
 * process": wall, CPU, RSS/heap movement, event-loop lag, drift, canary delay. A synchronous
 * scenario reports its wall time as the stall (syncWallAsStallMs) — the canary delay recorded
 * after it returns is the same number, which is the proof behind the convention.
 *
 * @param label - stable scenario name for the report.
 * @param fn - one unit of the scenario.
 * @param extra - bytesRead and objects readings the caller knows how to compute.
 * @returns the reading, or null when instrumentation is off.
 */
async function instrumentScenario(label, fn, extra = {}) {
  if (options.instrument !== 'full') return null
  const reading = await trackScenario(fn, { label: (extra.scope === undefined ? '' : extra.scope + '/') + label, sync: extra.sync })
  if (reading.error !== null) throw new Error('instrumented scenario ' + label + ' threw: ' + reading.error)
  // The scenario's return value (a 27 MB string for json-ledger, a 100k-entry array for the window
  // model) is not a measurement: dropping it keeps the JSON report small.
  reading.value = undefined
  reading.bytesRead = extra.bytesRead ?? null
  reading.objects = extra.objects ?? null
  // Windows process CPU accounting is quantized to the ~15.6 ms system tick: a sub-tick scenario
  // reads 0 or one tick, which is why the per-op CPU number comes from a repeated pass whose total
  // comfortably exceeds one tick rather than from a single fast rep.
  if (reading.sync === true) {
    const targetMs = 250
    const reps = Math.max(1, Math.min(400, Math.ceil(targetMs / Math.max(reading.wallMs, 0.01))))
    const cpuBefore = process.cpuUsage()
    for (let rep = 0; rep < reps; rep += 1) await fn()
    const cpuDelta = process.cpuUsage(cpuBefore)
    reading.cpuPerRepMs = round(((cpuDelta.user + cpuDelta.system) / 1000) / reps, 4)
    reading.cpuReps = reps
  }
  INSTRUMENT.scenarios[reading.label] = reading
  return reading
}

/** Everything R492's instrumentation collected; report.instrument is this object. */
const INSTRUMENT = {
  enabled: options.instrument === 'full',
  resolutionMs: 1,
  probes: 'monitorEventLoopDelay(1ms) + 1ms drift timer + 2 setImmediate canary chains',
  scenarios: {},
  stallProof: null,
  notes: {
    syncStall: 'A pure-sync scenario cannot be sampled from inside: its wall time is the stall, and the post-block canary delay equals it.',
    cpuQuantum: 'Windows process CPU accounting is quantized to the ~15.6 ms system tick, so single-rep sub-tick cpu readings are 0 or one tick; cpuPerRepMs comes from a repeated pass of at least 250 ms of work.',
    memory: 'RSS/heap are sampled every 5 ms when the scenario yields; for a sync block the peak is the post-block value (sync flag true).',
    objects: 'objects counts are retained objects in the measured result (model counts are labelled); allocations of transient arrays are called out per scenario.',
    bytesRead: 'bytesRead is the JSON/ledger bytes the scenario had to read, not the process RSS movement.',
  },
}

/** Deterministic PRNG: every fixture in this file is a function of --seed. */
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const swap = list[i]
    list[i] = list[j]
    list[j] = swap
  }
  return list
}

/** Largest-remainder allocation of total over weighted names; deterministic. */
function allocate(total, weights) {
  const keys = Object.keys(weights)
  const sum = keys.reduce((n, key) => n + weights[key], 0)
  const rows = keys.map((key) => {
    const exact = (total * weights[key]) / sum
    return { key, n: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let assigned = rows.reduce((n, row) => n + row.n, 0)
  rows.sort((a, b) => b.frac - a.frac || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (let i = 0; assigned < total; i += 1, assigned += 1) rows[i % rows.length].n += 1
  const out = {}
  for (const row of rows) out[row.key] = row.n
  return out
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12)
const statInfo = (path) => {
  const stat = statSync(path)
  return { path: path.replace(REPO + '\\', '').replace(REPO + '/', ''), bytes: stat.size, mtime: stat.mtime.toISOString() }
}

let peakRssMb = 0
function samplePeak() {
  const rss = round(process.memoryUsage().rss / (1024 * 1024), 1)
  if (rss > peakRssMb) peakRssMb = rss
  return rss
}
const heapUsed = () => process.memoryUsage().heapUsed

/* ------------------------------------------------------------------ premise: load production code */

function fail(message) {
  console.error('r487-harness: ' + message)
  process.exit(1)
}

for (const path of [PATHS.collabLib, PATHS.teamsLib, PATHS.worldSrc]) {
  if (!existsSync(path)) fail('missing production artifact: ' + path + ' (run node plugins/build.mjs first)')
}

const collab = await import(pathToFileURL(PATHS.collabLib).href)
const teams = await import(pathToFileURL(PATHS.teamsLib).href)
let world
try {
  world = await import(pathToFileURL(PATHS.worldSrc).href)
} catch (error) {
  fail('could not import ' + PATHS.worldSrc + ' on this Node (' + process.version + '): ' + String(error && error.message)
    + '\n  world.ts must stay strip-safe; retry with node --experimental-transform-types')
}
for (const name of ['projectTeamState', 'projectBoard', 'projectRegistry', 'projectDispatches', 'projectRetryLeases', 'projectLocks', 'projectSessions', 'projectHosting', 'projectAdapters', 'projectManifests', 'projectMerges', 'projectPeers', 'projectLiveness', 'projectQuarantine', 'projectTaskDemands', 'projectTeams', 'teamEventToRecord', 'heartbeatRecord', 'capabilityRecord', 'lockRecord', 'dispatchRecord', 'retryLeaseRecord', 'peerRecord', 'teamRecord', 'foldClaim', 'boardKey', 'recordTeamEvents', 'openControlLog']) {
  if (typeof collab[name] !== 'function') fail('production module does not export ' + name)
}
if (typeof teams.apply !== 'function' || typeof world.composeWorld !== 'function' || typeof world.fixtureCensus !== 'function') {
  fail('production teams module does not export apply/composeWorld/fixtureCensus')
}

const ARTIFACTS = {
  collabLib: { ...statInfo(PATHS.collabLib), sha256: sha256(PATHS.collabLib) },
  teamsLib: { ...statInfo(PATHS.teamsLib), sha256: sha256(PATHS.teamsLib) },
  worldSrc: { ...statInfo(PATHS.worldSrc), sha256: sha256(PATHS.worldSrc) },
}

/* ------------------------------------------------------------------ fixtures */

// The two record kinds the entity fold reads (src:2632-2634; not exported by the bundle).
const TASK_KIND = 'task/state'
const MEMBER_KIND = 'member/state'

const MODE_SHAPES = {
  default: {
    label: 'default (maxDepth 1)',
    members: 12, tasks: 24, level2: 0, level3: 0,
    // R484: with multi-level ON the kernel writes spawnedBy/depth; default mode does not.
    carriesHierarchy: false,
  },
  'multi-level': {
    label: 'multi-level (maxDepth 3)',
    members: 24, tasks: 36, level2: 8, level3: 15,
    carriesHierarchy: true,
  },
}

const ROLES = ['builder', 'reviewer', 'analyst', 'coordinator']
const MEMBER_PHASES = ['active', 'idle', 'active', 'active', 'idle']
const TASK_STATUSES = ['pending', 'in_progress', 'completed']

const pick = (list, index) => list[((index % list.length) + list.length) % list.length]

function makeSpec(mode, rng) {
  const shape = MODE_SHAPES[mode]
  if (shape === undefined) fail('unknown mode ' + mode)
  const team = 'session-' + String(10000000 + Math.floor(rng() * 89999999)) + '-perf'
  const members = []
  const level2 = []
  if (shape.carriesHierarchy) {
    members.push({ id: team + '#lead', name: 'lead', role: 'lead', depth: 0, spawnedBy: null })
    for (let i = 0; i < shape.level2; i += 1) {
      const name = 'l2-' + ROLES[i % ROLES.length] + '-' + String(i + 1)
      const member = { id: team + '#l2-' + String(i + 1), name, role: ROLES[i % ROLES.length], depth: 1, spawnedBy: 'lead' }
      members.push(member)
      level2.push(member)
    }
    for (let i = 0; i < shape.level3; i += 1) {
      const parent = level2[i % level2.length]
      const name = 'l3-' + ROLES[i % ROLES.length] + '-' + String(i + 1)
      members.push({ id: team + '#l3-' + String(i + 1), name, role: ROLES[i % ROLES.length], depth: 2, spawnedBy: parent.name })
    }
  } else {
    // Default mode: every teammate is a direct child of the lead (upstream flat roster), and the
    // kernel events carry no depth/spawnedBy because R484 only writes them when multi-level is on.
    members.push({ id: team + '#lead', name: 'lead', role: 'lead', depth: 0, spawnedBy: null })
    for (let i = 0; i < shape.members - 1; i += 1) {
      const name = 'member-' + ROLES[i % ROLES.length] + '-' + String(i + 1)
      members.push({ id: team + '#member-' + String(i + 1), name, role: ROLES[i % ROLES.length], depth: 0, spawnedBy: null })
    }
  }
  const tasks = []
  for (let i = 0; i < shape.tasks; i += 1) {
    tasks.push({
      id: 'task-' + String(i + 1),
      title: 'deliverable ' + String(i + 1),
      owner: members[(i + 1) % members.length].name,
      deps: i >= 4 && i % 5 === 0 ? ['task-' + String(i - 3)] : [],
    })
  }
  return { mode, label: shape.label, team, members, tasks, instance: 'perf-instance-' + String(1000 + Math.floor(rng() * 8999)) }
}

/** One kernel team/member session event, in the shape teamEventToRecord reads. */
function memberEvent(spec, member, phase) {
  return {
    type: 'team/member',
    data: {
      teamId: spec.team,
      member: {
        id: member.id, phase, name: member.name, role: member.role,
        ...(MODE_SHAPES[spec.mode].carriesHierarchy ? { spawnedBy: member.spawnedBy, depth: member.depth } : {}),
      },
    },
  }
}

function taskEvent(spec, task, status, revision) {
  return {
    type: 'team/task',
    data: {
      teamId: spec.team,
      task: {
        id: task.id, status, revision, subject: task.title,
        ...(status === 'in_progress' ? { ownerId: task.owner } : {}),
        ...(revision === 1 ? { blockedBy: task.deps } : {}),
      },
    },
  }
}

function messageEvent(spec, from, to, index) {
  return {
    type: 'agent/inbox/spliced',
    data: {
      target: to.id,
      inserted: [{ id: 'msg-' + String(index), source: { kind: 'agent-message', senderSessionId: from.id } }],
    },
  }
}

const STEADY_WEIGHTS = {
  default: { memberState: 18, taskState: 12, heartbeat: 45, message: 10, capability: 6, lock: 3, dispatch: 3, retryLease: 2, peer: 1 },
  'multi-level': { memberState: 22, taskState: 14, heartbeat: 41, message: 10, capability: 6, lock: 3, dispatch: 3, retryLease: 2, peer: 1 },
}

/** Declarations first, then the steady-state mix, exactly rows entries long. */
function planRowKinds(spec, rows, rng) {
  const declarations = []
  for (const ignored of spec.members) { void ignored; declarations.push('memberState') }
  for (const ignored of spec.tasks) { void ignored; declarations.push('taskState') }
  declarations.push('teamState')
  for (const ignored of spec.members) { void ignored; declarations.push('capability') }
  const steadyCount = Math.max(0, rows - declarations.length)
  const counts = allocate(steadyCount, STEADY_WEIGHTS[spec.mode])
  const steady = []
  for (const key of Object.keys(counts)) for (let i = 0; i < counts[key]; i += 1) steady.push(key)
  shuffle(steady, rng)
  return [...declarations, ...steady].slice(0, rows)
}

/**
 * Build one ledger the way the live system would: rows that come from kernel session/event
 * objects go through the production teamEventToRecord; rows this layer writes itself (heartbeat,
 * capability, lock, dispatch, retry lease, peer) go through the production builders.
 */
function buildLedger(spec, rows, rng) {
  const started = process.hrtime.bigint()
  const plan = planRowKinds(spec, rows, rng)
  const records = []
  const counters = { member: new Map(), task: new Map(), message: 0, lock: 0, dispatch: 0, lease: 0, capability: 0, peer: 0, eventMapped: 0, eventDropped: 0, hierarchyDropped: 0 }
  const at0 = 1760000000000
  const pickAt = (list, index) => list[((index % list.length) + list.length) % list.length]
  let index = 0
  while (records.length < rows && index < rows * 4) {
    const kind = plan[index % plan.length]
    const at = at0 + index * 250
    let draft = null
    if (kind === 'memberState') {
      const member = pickAt(spec.members, index)
      const seen = counters.member.get(member.id) ?? 0
      counters.member.set(member.id, seen + 1)
      draft = collab.teamEventToRecord(memberEvent(spec, member, seen === 0 ? 'active' : MEMBER_PHASES[seen % MEMBER_PHASES.length]))
      if (draft !== null) counters.eventMapped += 1
      else counters.eventDropped += 1
      if (draft !== null && MODE_SHAPES[spec.mode].carriesHierarchy && draft.payload.depth === undefined) counters.hierarchyDropped += 1
    } else if (kind === 'taskState') {
      const task = pickAt(spec.tasks, index)
      const seen = counters.task.get(task.id) ?? 0
      counters.task.set(task.id, seen + 1)
      draft = collab.teamEventToRecord(taskEvent(spec, task, seen === 0 ? 'pending' : TASK_STATUSES[seen % TASK_STATUSES.length], seen + 1))
      if (draft !== null) counters.eventMapped += 1
      else counters.eventDropped += 1
    } else if (kind === 'heartbeat') {
      draft = collab.heartbeatRecord(pickAt(spec.members, index).id, at)
    } else if (kind === 'capability') {
      counters.capability += 1
      draft = collab.capabilityRecord(pickAt(spec.members, index).id, ['send_message', 'list_agents', index % 2 === 0 ? 'spawn_teammate' : 'read_file'])
    } else if (kind === 'message') {
      counters.message += 1
      draft = collab.teamEventToRecord(messageEvent(spec, pickAt(spec.members, index), pickAt(spec.members, index + 3), counters.message))
      if (draft !== null) counters.eventMapped += 1
      else counters.eventDropped += 1
    } else if (kind === 'lock') {
      counters.lock += 1
      draft = collab.lockRecord(pickAt(spec.tasks, index).id, counters.lock % 3 === 0 ? null : pickAt(spec.members, index).name, at, spec.team)
    } else if (kind === 'dispatch') {
      counters.dispatch += 1
      const to = pickAt(spec.members, index)
      draft = collab.dispatchRecord('disp-' + String(counters.dispatch), to.name, 'send_message', { to: to.name, body: 'work ' + String(index) }, at)
    } else if (kind === 'retryLease') {
      counters.lease += 1
      draft = collab.retryLeaseRecord(pickAt(spec.tasks, index).id, 'end-A', at, 30000)
    } else if (kind === 'peer') {
      counters.peer += 1
      draft = collab.peerRecord('lead-a', 'lead-' + String(counters.peer), 'team.sync', 'granted')
    } else if (kind === 'teamState') {
      draft = collab.teamRecord(spec.team, null, 'lead')
    }
    index += 1
    if (draft === null || draft === undefined) continue
    records.push({
      seq: records.length + 1,
      kind: draft.kind,
      at,
      writer: 'local',
      instance: spec.instance,
      ...(draft.actor === undefined ? {} : { actor: draft.actor }),
      ...(draft.subject === undefined ? {} : { subject: draft.subject }),
      payload: draft.payload,
    })
  }
  if (records.length !== rows) fail('fixture builder produced ' + records.length + ' records for rows=' + rows)
  const elapsedMs = hrtimeMs(started)
  const bytes = Buffer.byteLength(JSON.stringify(records))
  return { records, bytes, elapsedMs, counters, team: spec.team }
}

/** Synthetic kernel session/event stream: ~4% team events, the rest ordinary session traffic. */
const SESSION_EVENT_MIX = [
  ['assistant/message', 30], ['tool/call', 22], ['tool/result', 18], ['step/start', 8],
  ['step/end', 6], ['turn/start', 3], ['turn/end', 3], ['user/message', 4],
  ['team/member', 2], ['team/task', 1], ['agent/inbox/spliced', 3],
]
function buildSessionEvents(spec, count, rng) {
  const weights = Object.fromEntries(SESSION_EVENT_MIX.map(([name, weight]) => [name, weight]))
  const names = SESSION_EVENT_MIX.map(([name]) => name)
  const counts = allocate(count, weights)
  const events = []
  let memberIndex = 0
  let taskIndex = 0
  for (const name of names) {
    for (let i = 0; i < counts[name]; i += 1) {
      const ordinal = events.length
      if (name === 'team/member') events.push(memberEvent(spec, pick(spec.members, memberIndex++), MEMBER_PHASES[memberIndex % MEMBER_PHASES.length]))
      else if (name === 'team/task') events.push(taskEvent(spec, pick(spec.tasks, taskIndex++), TASK_STATUSES[taskIndex % TASK_STATUSES.length], taskIndex + 1))
      else if (name === 'agent/inbox/spliced') events.push(messageEvent(spec, pick(spec.members, ordinal), pick(spec.members, ordinal + 2), ordinal))
      else if (name === 'assistant/message') events.push({ type: name, data: { turn: 1 + (ordinal % 12), step: 1 + (ordinal % 7), text: 'x'.repeat(120), attemptId: 'attempt-' + String(ordinal % 40) } })
      else if (name === 'tool/call') events.push({ type: name, data: { callId: 'call-' + String(ordinal), name: 'send_message', args: { to: 'peer', body: 'y'.repeat(24) } } })
      else if (name === 'tool/result') events.push({ type: name, data: { callId: 'call-' + String(ordinal), ok: true, value: 'z'.repeat(80) } })
      else events.push({ type: name, data: { turn: 1, step: 1 } })
    }
  }
  shuffle(events, rng)
  return events
}

/* ------------------------------------------------------------------ incremental entity fold */

// READABLE_KINDS is not exported; this is the literal set projectTeamState's unknown counter reads.
const READABLE_KINDS = new Set([
  'task/state', 'member/state', 'capability/state', 'member/heartbeat', 'lock/state', 'team/state',
  'peer/state', 'task/dispatch', 'task/result', 'task/retry-lease', 'team.message', 'session/state',
  'session/handoff', 'turn/state', 'agent/result', 'member/host', 'member/quarantine', 'adapter/state',
  'team/manifest', 'team/merge',
])

function teamOfRecord(record) {
  const payload = record.payload
  const text = (value) => (typeof value === 'string' && value !== '' ? value : null)
  const fromPayloadId = payload === null || payload === undefined ? null : text(payload.teamId)
  const fromPayloadTeam = payload === null || payload === undefined ? null : text(payload.team)
  return text(record.actor) ?? fromPayloadId ?? fromPayloadTeam
}
function stateOfRecord(record) {
  const payload = record.payload
  if (payload === null || payload === undefined || typeof payload.id !== 'string' || payload.id === '') return null
  const text = (value) => (typeof value === 'string' && value !== '' ? value : null)
  return { id: payload.id, team: teamOfRecord(record), state: text(payload.state) ?? 'open', owner: text(payload.owner), name: text(payload.name), role: text(payload.role) }
}

/**
 * An index maintained by appending, instead of a cold fold: tasks/members/teams only, losers as a
 * COUNT (the useful information; the history is what makes the production fold quadratic). Every
 * field the production task/member fold exposes is reproduced, and compareEntityFold proves it.
 */
class IncrementalEntityFold {
  constructor() {
    this.tasks = new Map()
    this.members = new Map()
    this.teams = new Set()
    this.through = 0
    this.counts = { folded: 0, unknown: 0, tasks: 0, members: 0, teams: 0, unattributed: 0 }
  }
  ingest(record) {
    this.through = Math.max(this.through, record.seq)
    if (!READABLE_KINDS.has(record.kind)) this.counts.unknown += 1
    const change = record.kind === TASK_KIND || record.kind === MEMBER_KIND ? stateOfRecord(record) : null
    if (change === null) return
    this.counts.folded += 1
    if (change.team === null) this.counts.unattributed += 1
    else this.teams.add(change.team)
    const key = collab.boardKey(change.team, change.id)
    const table = record.kind === TASK_KIND ? this.tasks : this.members
    const previous = table.get(key)
    if (record.kind === TASK_KIND) {
      const incoming = { status: change.state, owner: change.owner, at: record.at ?? null, seq: record.seq, writer: record.actor ?? null }
      if (previous === undefined) {
        table.set(key, { id: change.id, team: change.team, status: incoming.status, owner: incoming.owner, records: 1, at: record.seq, claim: incoming, resolvedBy: 'arrival', contested: false, losersCount: 0 })
        return
      }
      const folded = collab.foldClaim({ at: previous.claim.at, seq: previous.claim.seq }, { at: incoming.at, seq: incoming.seq })
      const winner = folded.incomingWins ? incoming : previous.claim
      const loser = folded.incomingWins ? previous.claim : incoming
      const disagrees = loser.status !== winner.status || loser.owner !== winner.owner
      table.set(key, {
        id: change.id, team: change.team, status: winner.status, owner: winner.owner,
        records: previous.records + 1, at: Math.max(previous.at, record.seq), claim: winner,
        resolvedBy: folded.byAt ? 'at' : 'arrival',
        contested: previous.contested || disagrees,
        losersCount: disagrees ? previous.losersCount + 1 : previous.losersCount,
      })
      return
    }
    const incoming = { name: change.name, state: change.state, role: change.role, at: record.at ?? null, seq: record.seq, writer: record.actor ?? null }
    if (previous === undefined) {
      table.set(key, { id: change.id, team: change.team, name: incoming.name, state: incoming.state, role: incoming.role, at: record.seq, claim: incoming, resolvedBy: 'arrival', contested: false, losersCount: 0 })
      return
    }
    const folded = collab.foldClaim({ at: previous.claim.at, seq: previous.claim.seq }, { at: incoming.at, seq: incoming.seq })
    const winner = folded.incomingWins ? incoming : previous.claim
    const loserClaim = folded.incomingWins ? previous.claim : incoming
    const disagrees = loserClaim.name !== winner.name || loserClaim.state !== winner.state || loserClaim.role !== winner.role
    table.set(key, {
      id: change.id, team: change.team, name: winner.name, state: winner.state, role: winner.role,
      at: Math.max(previous.at, record.seq), claim: winner,
      resolvedBy: folded.byAt ? 'at' : 'arrival',
      contested: previous.contested || disagrees,
      losersCount: disagrees ? previous.losersCount + 1 : previous.losersCount,
    })
  }
}

/** Compare the incremental index against the production fold; returns a list of mismatches. */
function compareEntityFold(state, index) {
  const mismatches = []
  const productionTasks = new Map(state.tasks.map((task) => [collab.boardKey(task.team, task.id), task]))
  const productionMembers = new Map(state.members.map((member) => [collab.boardKey(member.team, member.id), member]))
  for (const [key, task] of productionTasks) {
    const mine = index.tasks.get(key)
    if (mine === undefined) { mismatches.push('task missing ' + key); continue }
    if (mine.status !== task.status || mine.owner !== task.owner || mine.records !== task.records || mine.contested !== task.contested || mine.resolvedBy !== task.resolvedBy || mine.losersCount !== task.losers.length) mismatches.push('task differs ' + key)
  }
  if (index.tasks.size !== productionTasks.size) mismatches.push('task count ' + index.tasks.size + ' vs ' + productionTasks.size)
  for (const [key, member] of productionMembers) {
    const mine = index.members.get(key)
    if (mine === undefined) { mismatches.push('member missing ' + key); continue }
    if (mine.name !== member.name || mine.state !== member.state || mine.role !== member.role || mine.contested !== member.contested || mine.resolvedBy !== member.resolvedBy || mine.losersCount !== member.losers.length) mismatches.push('member differs ' + key)
  }
  if (index.members.size !== productionMembers.size) mismatches.push('member count ' + index.members.size + ' vs ' + productionMembers.size)
  const productionTeams = new Set(state.teams.teams.map((node) => node.id))
  for (const team of productionTeams) if (!index.teams.has(team)) mismatches.push('team missing ' + team)
  if (index.teams.size !== productionTeams.size) mismatches.push('team count ' + index.teams.size + ' vs ' + productionTeams.size)
  if (index.counts.folded !== state.counts.folded) mismatches.push('counts.folded')
  if (index.tasks.size !== state.counts.tasks || index.members.size !== state.counts.members || index.teams.size !== state.counts.teams) mismatches.push('counts entity numbers ' + String(index.tasks.size) + '/' + String(index.members.size) + '/' + String(index.teams.size) + ' vs ' + String(state.counts.tasks) + '/' + String(state.counts.members) + '/' + String(state.counts.teams))
  if (index.counts.unknown !== state.counts.unknown) mismatches.push('counts.unknown ' + index.counts.unknown + ' vs ' + state.counts.unknown)
  if (index.through !== state.through) mismatches.push('through')
  return mismatches
}

/* ------------------------------------------------------------------ teams route (real handler) */

function mountTeamsRoute(records, stateReader) {
  const routes = []
  let route = null
  const collabStub = {
    state: () => stateReader(),
    log: {
      // Production replay() returns [...records]; copying here keeps the poll cost faithful.
      replay: () => [...records],
      directory: '<workspace>\\\\.tmp\\perf-kernel-home\\collab',
      writer: 'local',
      instance: 'perf-instance',
      lastSeq: records.length,
      damage: null,
    },
  }
  const ctx = {
    get(name) {
      if (name === 'linkCollab') return collabStub
      if (name === 'webServer') return { register: (definition) => { routes.push(definition); return () => {} } }
      return undefined
    },
    effect: (body) => { const dispose = body(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  const quiet = console.log
  console.log = () => {}
  try {
    teams.apply(ctx, {})
  } finally {
    console.log = quiet
  }
  // The plugin binds its state route AND a session-title route; pick the state route by path.
  route = routes.find((definition) => String(definition.path).endsWith('/state'))
  if (route === undefined) fail('the production teams state route did not bind against the stub context (bound: ' + routes.map((definition) => definition.path).join(', ') + ')')
  return route.handler
}

async function pollRoute(handler) {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value },
    end(text) { this.body = text },
  }
  await handler({ method: 'GET', url: '/api/dsh-link-teams/state' }, res)
  return res
}

function makeCachedState(records) {
  let cached = null
  let cachedLength = -1
  const read = () => {
    // collab teamState() calls own.replay() (a shallow copy) on every read, then compares
    // (lastSeq, length) against its cache. Both halves are reproduced here.
    const copy = [...records]
    const length = records.length
    if (cached !== null && cachedLength === length) return cached
    cached = collab.projectTeamState(copy)
    cachedLength = length
    return cached
  }
  read.invalidate = () => { cachedLength = -1 }
  return read
}

/** Attribution replica of the teams route's snapshot(), for parts-vs-total comparison. */
function attributeRoute(records, state, streamLimit) {
  const parts = []
  const part = (name, fn) => {
    const start = process.hrtime.bigint()
    const value = fn()
    parts.push({ name, ms: round(hrtimeMs(start), 3) })
    return value
  }
  const replay = part('replay-copy', () => [...records])
  const worldDoc = part('composeWorld', () => world.composeWorld(state))
  const from = Math.max(0, replay.length - streamLimit)
  const census = part('fixtureCensus', () => world.fixtureCensus(state, replay.slice(from)))
  const tasks = part('taskRows', () => state.tasks.map((task) => {
    const { losers, ...rest } = task ?? {}
    const by = world.isFixtureId(task?.team) ? 'team' : world.isFixtureId(task?.id) ? 'id' : null
    return { ...rest, losersCount: Array.isArray(losers) ? losers.length : 0, fixture: by !== null, fixtureBy: by }
  }))
  const members = part('memberRows', () => state.members.map((member) => {
    const { losers, ...rest } = member ?? {}
    const by = world.isFixtureId(member?.team) ? 'team' : world.isFixtureId(member?.id) ? 'id' : null
    return { ...rest, losersCount: Array.isArray(losers) ? losers.length : 0, fixture: by !== null, fixtureBy: by }
  }))
  const body = part('assemble', () => ({
    ok: true, at: 0, path: '/api/dsh-link-teams/state',
    ledger: { directory: null, writer: 'local', instance: 'perf-instance', lastSeq: records.length, records: records.length, damage: null },
    counts: worldDoc.counts, through: state.through ?? null, teams: worldDoc.teams,
    tasks, members, registry: state.registry ?? null, liveness: state.liveness ?? null,
    peers: state.peers ?? null, board: state.board ?? null, quarantine: state.quarantine ?? null,
    fixtures: census,
    stream: replay.slice(from).map((record) => ({ seq: record.seq, kind: record.kind, actor: record.actor ?? null, subject: record.subject ?? null, at: record.at ?? null, fixture: false, fixtureBy: null })),
    served: 1,
  }))
  const text = part('JSON.stringify', () => JSON.stringify(body))
  return { parts, bytes: Buffer.byteLength(text) }
}

/* ------------------------------------------------------------------ DIAG measurement */

function mountRecorder() {
  const hooks = []
  const ctx = {
    on(name, callback) {
      hooks.push({ name, callback })
      return () => {}
    },
    effect(body) {
      const dispose = body()
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }
  const counters = { appended: 0 }
  const log = { append: () => { counters.appended += 1; return Promise.resolve(counters.appended) } }
  const recorder = collab.recordTeamEvents(ctx, log)
  const hook = hooks.find((entry) => entry.name === 'session/event')
  if (hook === undefined) fail('the production recorder did not subscribe to session/event')
  return { listener: hook.callback, recorder, counters }
}

async function drain(events, listener) {
  for (let index = 0; index < events.length; index += 1) {
    listener(undefined, events[index])
    if (index > 0 && index % 500 === 0) await new Promise((done) => setImmediate(done))
  }
  await new Promise((done) => setImmediate(done))
}

async function measureDiagCosts(events) {
  const out = {}
  const perEvent = (stats, count) => round((stats.meanMs * 1000) / count, 3)
  // R487 QW1: the DIAG line is now env-gated (default off, DSH_LINK_COLLAB_TRACE=1 restores it).
  // The variants below measure the ON cost (what turning the switch on buys/costs); the OFF variant
  // at the end measures today's default, which is the recorder plus the mapping and nothing else.
  const TRACE_VAR = 'DSH_LINK_COLLAB_TRACE'
  const restoreTrace = process.env[TRACE_VAR]
  process.env[TRACE_VAR] = '1'

  const noopMount = mountRecorder()
  const realLog = console.log
  console.log = () => {}
  try {
    out.noopLog = await measureAsync(() => drain(events, noopMount.listener), { minReps: 2, maxReps: 6, budgetMs: 600 })
  } finally { console.log = realLog }

  // stdout is a pipe in the kernel (host -> shell). Emitting 20k lines per rep would flood this
  // harness's own output, so the real-stdout variant runs on a 2000-event sample and is reported
  // per event; the file variant runs the full stream.
  const stdoutSample = events.slice(0, Math.min(2000, events.length))
  const stdoutMount = mountRecorder()
  out.stdout = await measureAsync(() => drain(stdoutSample, stdoutMount.listener), { minReps: 2, maxReps: 4, budgetMs: 600 })
  out.stdout.sampleEvents = stdoutSample.length

  mkdirSync(PATHS.scratch, { recursive: true })
  const sinkPath = join(PATHS.scratch, 'perf-multi-agent-diag.log')
  const sink = createWriteStream(sinkPath, { flags: 'w' })
  const fileMount = mountRecorder()
  console.log = (line) => sink.write(String(line) + '\n')
  try {
    out.fileSink = await measureAsync(() => drain(events, fileMount.listener), { minReps: 2, maxReps: 6, budgetMs: 600 })
  } finally {
    console.log = realLog
    await new Promise((done) => sink.end(done))
  }
  try { rmSync(sinkPath, { force: true }) } catch { /* the scratch file is not evidence */ }

  out.mappingOnly = measureSync(() => {
    for (let index = 0; index < 2000; index += 1) collab.teamEventToRecord(events[index % events.length])
  })

  out.perEventUs = {
    noopLog: perEvent(out.noopLog, events.length),
    stdoutPipe: perEvent(out.stdout, stdoutSample.length),
    fileSink: perEvent(out.fileSink, events.length),
    mappingOnly: round((out.mappingOnly.meanMs * 1000) / 2000, 3),
  }
  out.perEventUs.diagLineStdoutUs = round(out.perEventUs.stdoutPipe - out.perEventUs.noopLog, 3)
  out.perEventUs.diagLineFileUs = round(out.perEventUs.fileSink - out.perEventUs.noopLog, 3)

  // Today's default: the switch is off, so the line is not paid at all.
  delete process.env[TRACE_VAR]
  const offMount = mountRecorder()
  out.traceOff = await measureAsync(() => drain(events, offMount.listener), { minReps: 2, maxReps: 6, budgetMs: 600 })
  if (restoreTrace === undefined) delete process.env[TRACE_VAR]
  else process.env[TRACE_VAR] = restoreTrace
  out.perEventUs.traceOff = perEvent(out.traceOff, events.length)
  // R492: one instrumented trace-ON drain (2000 events) — the loop/CPU/RSS reading for the
  // switch-on cost plus the bytes a session-event reader had to touch.
  process.env[TRACE_VAR] = '1'
  const instrMount = mountRecorder()
  const instrEvents = events.slice(0, Math.min(2000, events.length))
  out.instr = await instrumentScenario('diag-trace-on-2000', () => drain(instrEvents, instrMount.listener), {
    sync: false, bytesRead: instrEvents.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)), 0),
  })
  if (restoreTrace === undefined) delete process.env[TRACE_VAR]
  else process.env[TRACE_VAR] = restoreTrace
  out.traceSwitch = { variable: TRACE_VAR, default: false, measuredOnUs: out.perEventUs.stdoutPipe, measuredOffUs: out.perEventUs.traceOff }

  // Rate model: R479 measured 6384 durable events in ~1.5 h = 1.18 events/s in ONE busy session.
  // "busy" is a stated assumption (several durable events per second per session during turns).
  out.rateModel = {}
  const sessions = { default: 13, 'multi-level': 25 }
  for (const mode of Object.keys(sessions)) {
    const sessionCount = sessions[mode]
    const steady = sessionCount * 1.18
    const busy = sessionCount * 5
    out.rateModel[mode] = {
      sessions: sessionCount,
      steadyEventsPerSec: round(steady, 1),
      busyEventsPerSec: round(busy, 1),
      steadyCpuPercent: round((steady * out.perEventUs.stdoutPipe) / 10000, 4),
      busyCpuPercent: round((busy * out.perEventUs.stdoutPipe) / 10000, 4),
      cpuSecondsPerMillionEvents: round(out.perEventUs.stdoutPipe, 2),
    }
  }
  return out
}

/* ------------------------------------------------------------------ event window / renderer */

// Faithful port of packages/api/session-controller/src/client/contract/events.ts (leaf/concat/
// materialize): append is O(1), materialize is O(n), and the live tail is never trimmed.
const leafNode = (entries) => ({ kind: 'leaf', entries, length: entries.length })
const concatNode = (left, right) => ({ kind: 'concat', left, right, length: left.length + right.length })
function materializeNode(node) {
  if (node.kind === 'leaf') return node.entries
  const entries = new Array(node.length)
  const pending = [node]
  let index = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (current.kind === 'concat') { pending.push(current.right, current.left); continue }
    for (const entry of current.entries) { entries[index] = entry; index += 1 }
  }
  return entries
}
function makeEntry(index) {
  return { type: 'event', event: { seq: index, type: 'assistant/message', time: 1760000000000 + index, data: { text: 'x'.repeat(120), attemptId: 'attempt-' + String(index) } } }
}

function measureEventWindow(sizes) {
  const out = {}
  for (const size of sizes) {
    const entries = Array.from({ length: size }, (_, index) => makeEntry(index))
    const appendStart = process.hrtime.bigint()
    let window = leafNode([])
    for (const entry of entries) window = concatNode(window, leafNode([entry]))
    const appendMs = round(hrtimeMs(appendStart), 3)
    const materializeStart = process.hrtime.bigint()
    const materialized = materializeNode(window)
    const materializeMs = round(hrtimeMs(materializeStart), 3)
    out['appendTree@' + String(size)] = { appendMs, materializeMs, entries: entries.length, materialized: materialized.length }
  }
  // Uncapped live tail read on every publish (a consumer that materializes per event): O(n^2).
  out.materializeEachAppend = {}
  for (const size of [1000, 3000, options.eventWindowMax]) {
    if (size > options.eventWindowMax) continue
    const entries = Array.from({ length: size }, (_, index) => makeEntry(index))
    const start = process.hrtime.bigint()
    let window = leafNode([])
    let checksum = 0
    for (const entry of entries) {
      window = concatNode(window, leafNode([entry]))
      checksum += materializeNode(window).length
    }
    const ms = round(hrtimeMs(start), 3)
    out.materializeEachAppend['n=' + String(size)] = { totalMs: ms, perAppendMs: round(ms / size, 4), complexity: 'O(n^2)', checksum }
  }
  out.cappedRing = {}
  for (const size of sizes) {
    const cap = 500
    const ring = new Array(cap)
    let head = 0
    let length = 0
    const start = process.hrtime.bigint()
    for (let index = 0; index < size; index += 1) {
      ring[head] = makeEntry(index)
      head = (head + 1) % cap
      if (length < cap) length += 1
    }
    const appendMs = round(hrtimeMs(start), 3)
    const matchStart = process.hrtime.bigint()
    const ordered = new Array(length)
    for (let i = 0; i < length; i += 1) ordered[i] = ring[(head + cap - length + i) % cap]
    out.cappedRing['n=' + String(size)] = { appendMs, materializeMs: round(hrtimeMs(matchStart), 3), cap, materialized: ordered.length }
  }
  // Retained heap of the live tail, and the per-frame map over it (renderer model; DOM nodes and
  // decoded images are NOT included — that part is the B2 live evidence, not this model).
  // Heap deltas are noisy, so take the best of three and keep every allocation alive in a keeper
  // list until the measurement closes.
  const retainedEntryCount = sizes[sizes.length - 1]
  const keepers = []
  let retainedBytes = 0
  let renderMapMs = 0
  for (let rep = 0; rep < 3; rep += 1) {
    const before = heapUsed()
    const entries = Array.from({ length: retainedEntryCount }, (_, index) => makeEntry(index))
    let window = leafNode([])
    for (const entry of entries) window = concatNode(window, leafNode([entry]))
    const after = heapUsed()
    keepers.push(entries, window)
    if (after - before > retainedBytes) retainedBytes = after - before
    const frameStart = process.hrtime.bigint()
    const mapped = entries.map((entry) => ({ kind: 'node', key: entry.event.seq }))
    const frameMs = round(hrtimeMs(frameStart), 3)
    keepers.push(mapped)
    if (rep === 0) renderMapMs = frameMs
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(makeEntry(0)))
  out.renderer = {
    entries: retainedEntryCount,
    retainedBytes,
    bytesPerEntry: round(retainedBytes / retainedEntryCount, 1),
    serializedEntryBytes: serializedBytes,
    heapMbFor100k: mb((retainedBytes / retainedEntryCount) * 100000),
    renderMapMs,
    renderMapEntries: keepers.length > 0 ? retainedEntryCount : 0,
    note: 'event-window only: DOM rows and decoded images add the rest of B2 (90MB -> 1694MB observed live)',
  }
  return out
}

/* ------------------------------------------------------------------ churn (losers quadratic) */

function buildChurnLedger(entities, rows, churn, baseAt) {
  const records = []
  for (let index = 0; index < rows; index += 1) {
    const entity = records.length % entities
    const seen = Math.floor(records.length / entities)
    const draft = collab.teamEventToRecord({
      type: 'team/task',
      data: {
        teamId: 'session-churn',
        task: {
          id: 'churn-task-' + String(entity + 1),
          status: churn ? TASK_STATUSES[seen % TASK_STATUSES.length] : 'in_progress',
          revision: seen + 1,
          subject: 'churn task',
          ownerId: 'owner-' + String(entity),
        },
      },
    })
    records.push({
      seq: records.length + 1, kind: draft.kind, at: baseAt + index * 100, writer: 'local', instance: 'churn',
      ...(draft.actor === undefined ? {} : { actor: draft.actor }),
      ...(draft.subject === undefined ? {} : { subject: draft.subject }),
      payload: draft.payload,
    })
  }
  return records
}

/* ------------------------------------------------------------------ rust engine hook */

function loadRustEngine() {
  const candidates = []
  for (const dir of [PATHS.computeLib, PATHS.rustRelease, PATHS.rustDebug]) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) if (name.endsWith('.node')) candidates.push(join(dir, name))
  }
  const require = createRequire(import.meta.url)
  const failures = []
  for (const file of candidates) {
    try {
      const native = require(file)
      const fold = native.foldCollabRecords ?? native.fold_collab_records
      const index = native.indexTeamStatus ?? native.index_team_status
      if (typeof fold === 'function') return { file, fold, index: typeof index === 'function' ? index : null, nativeVersion: native.nativeVersion, failures }
      failures.push(file + ': no foldCollabRecords export')
    } catch (error) {
      failures.push(file + ': ' + String(error && error.message))
    }
  }
  return { file: null, fold: null, index: null, failures }
}

/**
 * Retained heap of one result graph, best of a few reps: build the value, keep it alive, read the
 * heap delta, drop it. A negative/flapped delta means the reading is noise (a GC ran), so the
 * smallest positive rep is reported rather than a sum; null means no rep produced a clean reading.
 */
function measureRetainedHeap(fn, reps = 3) {
  let best = null
  for (let rep = 0; rep < reps; rep += 1) {
    const keepers = []
    const before = process.memoryUsage().heapUsed
    keepers.push(fn())
    const after = process.memoryUsage().heapUsed
    const delta = after - before
    if (delta > 0 && (best === null || delta < best)) best = delta
    keepers.length = 0
  }
  return best === null ? null : { bytes: best, mb: round(best / (1024 * 1024), 3) }
}

/** Append one batch to a fresh production control log (instrumentation scenario). */
async function appendSample(sample) {
  const dir = join(PATHS.scratch, 'perf-instrument-append-' + String(process.pid))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const log = collab.openControlLog({ dir })
  try {
    for (const record of sample) {
      await log.append({
        kind: record.kind,
        ...(record.actor === undefined ? {} : { actor: record.actor }),
        ...(record.subject === undefined ? {} : { subject: record.subject }),
        payload: record.payload,
        at: record.at,
      })
    }
  } finally {
    await log.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The real control-log append path: one JSONL line per record through the production writer.
 * Repeated on fresh logs and reported as a median, so one scheduling hiccup cannot name the cost.
 */
async function measureRealLogAppend(records) {
  const sample = records.slice(0, Math.min(2000, records.length))
  const toAppend = (record) => ({
    kind: record.kind,
    ...(record.actor === undefined ? {} : { actor: record.actor }),
    ...(record.subject === undefined ? {} : { subject: record.subject }),
    payload: record.payload,
    at: record.at,
  })
  const lineBytes = round(sample.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(toAppend(record))), 0) / sample.length, 1)
  const runs = []
  for (let rep = 0; rep < 3; rep += 1) {
    const dir = join(PATHS.scratch, 'perf-control-log-' + String(process.pid) + '-' + String(rep))
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const log = collab.openControlLog({ dir })
    try {
      for (const record of sample.slice(0, 50)) await log.append(toAppend(record))
      const start = process.hrtime.bigint()
      for (const record of sample) await log.append(toAppend(record))
      runs.push((hrtimeMs(start) * 1000) / sample.length)
    } finally {
      await log.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
  runs.sort((left, right) => left - right)
  const perRecordUs = round(runs[Math.floor(runs.length / 2)], 2)
  return {
    records: sample.length,
    reps: runs.length,
    perRecordUs,
    recordsPerSec: round(1_000_000 / perRecordUs, 0),
    lineBytes,
  }
}

/* ------------------------------------------------------------------ main measurement */

const report = {
  meta: {
    harness: 'r487-multi-agent-perf',
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    cpus: cpus().length,
    seed: options.seed,
    rows: options.rows,
    modes: options.modes,
    engineRequested: options.engine,
    instrument: options.instrument,
    repo: REPO,
    artifacts: ARTIFACTS,
    note: 'measured on the production bundles plugins/*/lib/index.js (what the kernel loads); src line notes live in R487-perf-audit.md',
  },
  instrument: INSTRUMENT,
  modes: {},
  append: null,
  diag: null,
  churn: null,
  window: null,
  rust: null,
  peakRssMb: null,
  warnings: [],
}

function logSection(title) { console.log('\n== ' + title + ' ==') }
function logRow(cells, widths) {
  console.log(cells.map((cell, index) => String(cell).padEnd(widths[index])).join(' '))
}

function printModeTable(section) {
  const widths = [8, 10, 10, 12, 12, 11, 11, 10, 11, 10, 10]
  logSection('mode ' + section.mode + ' — ' + section.label + ' | members ' + String(section.members) + ' tasks ' + String(section.tasks) + ' levels ' + String(section.levels))
  logRow(['rows', 'recBytes', 'foldMs', 'foldUs/rec', 'cachedPoll', 'coldPoll', 'stateKB', 'routeKB', 'incrMs', 'appendUs', 'jsonMs'], widths)
  for (const rows of Object.keys(section.rows)) {
    const result = section.rows[rows]
    logRow([
      rows,
      String(result.fixture.bytes),
      result.fold === null ? '-' : String(result.fold.meanMs),
      result.fold === null ? '-' : String(result.fold.perRecordUs),
      result.foldCached === null ? '-' : String(result.foldCached.meanMs),
      result.routeCold === null ? '-' : String(result.routeCold.meanMs),
      result.stateBytes === undefined ? '-' : String(round(result.stateBytes.bytes / 1024, 1)),
      result.route === null ? '-' : String(round(result.route.bytes / 1024, 1)),
      result.incremental === null ? '-' : String(result.incremental.coldMs),
      result.incremental === null ? '-' : String(result.incremental.appendPerRecordUs),
      result.json === null ? '-' : String(result.json.state.meanMs),
    ], widths)
    if (result.route !== null && result.route.attribution !== undefined) {
      const parts = result.route.attribution.parts
      const partTotal = round(parts.reduce((sum, part) => sum + part.ms, 0), 3)
      console.log('  route poll ' + String(result.route.meanMs) + ' ms/req, ' + String(mb(result.route.bytes)) + ' MB/answer | attribution: '
        + parts.map((part) => part.name + '=' + String(part.ms)).join(' ') + ' (sum ' + String(partTotal) + ' ms)')
    }
    if (result.models !== undefined) {
      console.log('  models: append cadence ' + String(result.models.appendCadenceMs) + ' ms -> cold-fold duty ' + String(result.models.coldFoldDutyPercent)
        + '% of a core; one write folds twice = ' + String(result.models.twoFoldWriteMs) + ' ms; 2s route poll duty ' + String(result.models.routePoll2sDutyPercent) + '%')
    }
    if (result.instr !== undefined && result.instr.fold !== null && result.instr.fold !== undefined) {
      const fold = result.instr.fold
      const loop = fold.stall === null ? null : fold.stall.eventLoopDelay
      console.log('  instr fold: wall ' + String(fold.wallMs) + ' ms, cpu ' + String(fold.resource.cpuTotalMs) + ' ms, rss +' + String(fold.resource.rss.deltaMb)
        + ' MB, heap +' + String(fold.resource.heap.deltaMb) + ' MB, loop max ' + String(loop === null ? '-' : loop.maxMs) + ' ms, drain-missed ' + String(fold.syncWallAsStallMs)
        + ' ms (sync wall-as-stall), bytesRead ' + String(fold.bytesRead) + ' B')
    }
  }
}

async function runMode(mode) {
  const rng = mulberry32(options.seed + mode.length * 7919)
  const spec = makeSpec(mode, rng)
  const shape = MODE_SHAPES[mode]
  const section = {
    mode, label: shape.label, members: spec.members.length, tasks: spec.tasks.length,
    levels: spec.members.reduce((max, member) => Math.max(max, member.depth + 1), 0), rows: {},
  }
  const projectionNames = ['projectRegistry', 'projectLiveness', 'projectQuarantine', 'projectTaskDemands', 'projectTeams', 'projectPeers', 'projectBoard', 'projectLocks', 'projectSessions', 'projectHosting', 'projectAdapters', 'projectDispatches', 'projectRetryLeases', 'projectManifests', 'projectMerges']

  for (const rows of options.rows) {
    const fixtureStarted = process.hrtime.bigint()
    const ledger = buildLedger(spec, rows, rng)
    const fixtureMs = round(hrtimeMs(fixtureStarted), 1)
    samplePeak()
    const result = {
      fixture: { rows: ledger.records.length, bytes: ledger.bytes, bytesPerRecord: round(ledger.bytes / ledger.records.length, 1), buildMs: fixtureMs, counters: ledger.counters },
      fold: null, foldCached: null, projection: null, route: null, routeCold: null, json: null, incremental: null, stateBytes: undefined,
    }

    if (!options.skip.has('fold')) {
      result.fold = measureSync(() => collab.projectTeamState(ledger.records), { minReps: rows >= 100000 ? 1 : 3, maxReps: rows >= 100000 ? 3 : 8, budgetMs: 2000 })
      result.fold.perRecordUs = round((result.fold.meanMs * 1000) / ledger.records.length, 3)
      const state = collab.projectTeamState(ledger.records)
      const text = JSON.stringify(state)
      result.stateBytes = { bytes: Buffer.byteLength(text), mb: mb(Buffer.byteLength(text)) }
      // The cached path the panel actually hits: replay copy + cache compare, no fold.
      result.foldCached = measureSync(() => {
        const copy = [...ledger.records]
        if (copy.length === ledger.records.length) return
      }, { minReps: rows >= 100000 ? 2 : 5, maxReps: rows >= 100000 ? 5 : 15, budgetMs: 1200 })
      // R492: one instrumented fold rep — what it costs the process, not just how long it ran.
      const stateForObjects = collab.projectTeamState(ledger.records)
      result.instr = result.instr === undefined ? {} : result.instr
      result.instr.fold = await instrumentScenario('fold@' + String(rows), () => collab.projectTeamState(ledger.records), {
        scope: mode, sync: true, bytesRead: ledger.bytes,
        objects: { retained: countObjects(stateForObjects, { maxDepth: 8 }), note: 'retained objects in the folded state; the 15 projections additionally allocate their filtered/sorted arrays per fold' },
      })
      result.instr.fold.retainedHeap = measureRetainedHeap(() => collab.projectTeamState(ledger.records))
      result.instr.fold.stateJsonBytes = result.stateBytes === undefined ? null : result.stateBytes.bytes
    }

    const state = collab.projectTeamState(ledger.records)
    const stateReader = makeCachedState(ledger.records)
    const handler = mountTeamsRoute(ledger.records, stateReader)

    if (!options.skip.has('projections') && rows === options.rows[options.rows.length - 1]) {
      const projections = {}
      for (const name of projectionNames) {
        projections[name] = measureSync(() => collab[name](ledger.records), { minReps: 1, maxReps: rows >= 100000 ? 1 : 2, budgetMs: 400 })
      }
      result.projection = projections
    }

    if (!options.skip.has('poll')) {
      const warm = await pollRoute(handler)
      const warmBytes = Buffer.byteLength(warm.body)
      if (warm.statusCode !== 200 || warmBytes < 1024) {
        fail('the mounted teams route did not answer a snapshot (status ' + String(warm.statusCode) + ', ' + String(warmBytes) + ' B): ' + String(warm.body).slice(0, 300))
      }
      result.route = await measureAsync(() => pollRoute(handler), { minReps: 3, maxReps: 20, budgetMs: 1200 })
      result.route.status = warm.statusCode
      result.route.bytes = warmBytes
      result.route.attribution = attributeRoute(ledger.records, state, 40)
      result.routeCold = await measureAsync(() => { stateReader.invalidate(); return pollRoute(handler) }, { minReps: 2, maxReps: 5, budgetMs: 1500 })
      result.instr = result.instr === undefined ? {} : result.instr
      result.instr.route = await instrumentScenario('route-poll@' + String(rows), () => pollRoute(handler), { scope: mode, sync: false, bytesRead: warmBytes })
      result.instr.routeCold = await instrumentScenario('route-cold@' + String(rows), async () => { stateReader.invalidate(); return pollRoute(handler) }, { scope: mode, sync: false, bytesRead: warmBytes })
    }

    // What the measured costs mean per second of a live team, using the team's own heartbeat
    // cadence as the append clock: every member writes one heartbeat a minute, and each append
    // invalidates the fold cache, so the cold fold is paid that often.
    const appendCadenceMs = 60000 / Math.max(1, spec.members.length)
    // Every projection starts with [...records].sort(); the ledger is already in seq order, so this
    // measures the order-verification a sort-free projection could skip (15 of them per fold).
    result.sortCost = measureSync(() => {
      const copy = [...ledger.records]
      copy.sort((left, right) => left.seq - right.seq)
    }, { minReps: 2, maxReps: 5, budgetMs: 600 })
    result.models = {
      appendCadenceMs,
      coldFoldDutyPercent: result.fold === null ? null : round((result.fold.meanMs / appendCadenceMs) * 100, 2),
      twoFoldWriteMs: result.fold === null ? null : round(result.fold.meanMs * 2, 3),
      routePoll2sDutyPercent: result.route === null ? null : round((result.route.meanMs / 2000) * 100, 4),
      coldPoll2sDutyPercent: result.routeCold === null ? null : round((result.routeCold.meanMs / 2000) * 100, 3),
      oneSortMs: result.sortCost.meanMs,
      fifteenSortsMs: round(result.sortCost.meanMs * 15, 3),
      fifteenSortsShareOfFoldPercent: result.fold === null ? null : round((result.sortCost.meanMs * 15 * 100) / result.fold.meanMs, 1),
    }

    if (!options.skip.has('json')) {
      result.json = {
        state: measureSync(() => JSON.stringify(state), { minReps: 3, maxReps: 10, budgetMs: 500 }),
        ledgerString: measureSync(() => JSON.stringify(ledger.records), { minReps: 2, maxReps: 5, budgetMs: 800 }),
      }
      result.json.stateBytes = Buffer.byteLength(JSON.stringify(state))
      result.json.ledgerBytes = Buffer.byteLength(JSON.stringify(ledger.records))
      result.instr = result.instr === undefined ? {} : result.instr
      result.instr.jsonState = await instrumentScenario('json-state@' + String(rows), () => JSON.stringify(state), { scope: mode, sync: true, bytesRead: result.json.stateBytes })
      result.instr.jsonLedger = await instrumentScenario('json-ledger@' + String(rows), () => JSON.stringify(ledger.records), { scope: mode, sync: true, bytesRead: result.json.ledgerBytes })
    }

    if (!options.skip.has('incremental')) {
      const index = new IncrementalEntityFold()
      const incrementalStart = process.hrtime.bigint()
      for (const record of ledger.records) index.ingest(record)
      const incrementalMs = round(hrtimeMs(incrementalStart), 3)
      const mismatches = compareEntityFold(state, index)
      if (mismatches.length > 0) fail('incremental fold does not reproduce the production fold: ' + mismatches.slice(0, 5).join('; '))
      // Steady-state append: 60 fresh records at a time — the cost a maintained index pays per event.
      const extra = buildLedger(spec, 600, mulberry32(options.seed + 991))
      const steady = measureSync(() => {
        const fresh = new IncrementalEntityFold()
        for (let i = 0; i < 60; i += 1) fresh.ingest(extra.records[i % extra.records.length])
        if (fresh.tasks.size === 0 && fresh.members.size === 0) throw new Error('empty index')
      }, { minReps: 5, maxReps: 20, budgetMs: 600 })
      result.instr = result.instr === undefined ? {} : result.instr
      result.instr.incrementalIngest = await instrumentScenario('incremental-ingest@' + String(rows), () => {
        const fresh = new IncrementalEntityFold()
        for (const record of ledger.records) fresh.ingest(record)
        return fresh
      }, { scope: mode, sync: true, bytesRead: ledger.bytes, objects: { retained: { tasks: index.tasks.size, members: index.members.size, teams: index.teams.size }, note: 'index entries (maps + values), one per entity' } })
      result.incremental = {
        coldMs: incrementalMs,
        coldPerRecordUs: round((incrementalMs * 1000) / ledger.records.length, 3),
        equivalent: true,
        equivalenceFields: 'tasks(status/owner/records/contested/resolvedBy/losers), members(name/state/role/contested/resolvedBy/losers), teams, counts.folded/tasks/members/teams/unknown, through',
        appendPerRecordUs: round((steady.meanMs * 1000) / 60, 3),
        coldFoldMs: result.fold === null ? null : result.fold.meanMs,
        coldFoldVsIncremental: result.fold === null ? null : round(result.fold.meanMs / incrementalMs, 2),
      }
    }

    section.rows[String(rows)] = result
    samplePeak()
  }

  return section
}

function printProjections(section) {
  const largest = options.rows[options.rows.length - 1]
  const firstRow = section.rows[String(largest)]
  const projection = firstRow === undefined ? undefined : firstRow.projection
  if (projection === undefined || projection === null || !HEADS_UP) return
  logSection('per-projection cost at rows=' + String(largest) + ' (mode ' + section.mode + ')')
  const order = Object.entries(projection).sort((a, b) => b[1].meanMs - a[1].meanMs)
  logRow(['projection', 'meanMs', 'p50Ms', 'p99Ms', 'shareOfProjectionTotal'], [28, 9, 9, 9, 24])
  const total = order.reduce((sum, [, stats]) => sum + stats.meanMs, 0)
  for (const [name, stats] of order) logRow([name, String(stats.meanMs), String(stats.p50Ms), String(stats.p99Ms), round((100 * stats.meanMs) / total, 1) + '%'], [28, 9, 9, 9, 24])
}

/** Median across repeated runs, recursively. Each metric is reported as the median of the runs. */
function medianOf(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2, 3)
}
/** Keep the fastest single measurement per metric: under shared-machine load the min is the
 * least-contended sample and the median is the typical one; the audit cites both. */
function annotateBest(merged, sections) {
  for (const rows of Object.keys(merged.rows)) {
    const target = merged.rows[rows]
    const same = sections.map((section) => section.rows[rows])
    for (const key of ['fold', 'foldCached', 'route', 'routeCold', 'sortCost']) {
      const holders = same.map((value) => value[key]).filter((value) => value !== null && value !== undefined && typeof value.minMs === 'number')
      if (target[key] !== null && target[key] !== undefined && holders.length > 0) target[key].bestMs = Math.min(...holders.map((value) => value.minMs))
    }
    if (target.json !== null && target.json !== undefined) {
      for (const key of ['state', 'ledgerString']) {
        const holders = same.map((value) => (value.json === null ? undefined : value.json[key])).filter((value) => value !== undefined && typeof value.minMs === 'number')
        if (target.json[key] !== undefined && holders.length > 0) target.json[key].bestMs = Math.min(...holders.map((value) => value.minMs))
      }
    }
    if (target.projection !== null && target.projection !== undefined) {
      for (const name of Object.keys(target.projection)) {
        const holders = same.map((value) => (value.projection === null || value.projection === undefined ? undefined : value.projection[name])).filter((value) => value !== undefined && typeof value.minMs === 'number')
        if (holders.length > 0) target.projection[name].bestMs = Math.min(...holders.map((value) => value.minMs))
      }
    }
  }
}

function mergeAcrossRuns(values) {
  const first = values[0]
  if (typeof first === 'number') return medianOf(values)
  if (first instanceof Map) return first
  if (Array.isArray(first)) return first.map((ignored, index) => { void ignored; return mergeAcrossRuns(values.map((value) => value[index])) })
  if (first !== null && typeof first === 'object') {
    const out = {}
    for (const key of Object.keys(first)) {
      const present = values.map((value) => value[key]).filter((value) => value !== undefined)
      out[key] = present.length === 0 ? first[key] : mergeAcrossRuns(present)
    }
    return out
  }
  return first
}

/* ------------------------------------------------------------------ run */

const startedAt = Date.now()
if (HEADS_UP) {
  console.log('R487 multi-agent perf harness — node ' + process.version + ' ' + process.platform + '/' + process.arch + ' seed ' + String(options.seed))
  console.log('artifacts: collab lib ' + ARTIFACTS.collabLib.sha256 + ' (' + String(ARTIFACTS.collabLib.bytes) + ' B) | teams lib ' + ARTIFACTS.teamsLib.sha256 + ' (' + String(ARTIFACTS.teamsLib.bytes) + ' B) | world src ' + ARTIFACTS.worldSrc.sha256)
  console.log('rows ' + options.rows.join(',') + ' | modes ' + options.modes.join(',') + ' | runs ' + String(options.runs) + ' | instrument ' + options.instrument + (options.quick ? ' | QUICK' : ''))
}

for (const mode of options.modes) {
  if (!Object.hasOwn(MODE_SHAPES, mode)) fail('unknown mode ' + mode + ' (expected default|multi-level)')
}

// JIT/measurement warmup before anything is counted: the production fold is a 15-projection
// monolith, so the first measured call would otherwise pay compilation and make the first mode
// look slower than the second. Warm every measured path once on a small fixture.
{
  const warmSpec = makeSpec('default', mulberry32(options.seed + 5150))
  const warmLedger = buildLedger(warmSpec, 2000, mulberry32(options.seed + 5151))
  for (let i = 0; i < 4; i += 1) collab.projectTeamState(warmLedger.records)
  const warmState = collab.projectTeamState(warmLedger.records)
  for (let i = 0; i < 2; i += 1) { world.composeWorld(warmState); JSON.stringify(warmState) }
  const warmHandler = mountTeamsRoute(warmLedger.records, makeCachedState(warmLedger.records))
  for (let i = 0; i < 3; i += 1) await pollRoute(warmHandler)
  const warmIndex = new IncrementalEntityFold()
  for (const record of warmLedger.records) warmIndex.ingest(record)
}

// R492 stall-proof: a synchronous scenario's honest stall number is its wall time, and the probes
// are what show that rather than assert it. Schedule the canaries, run a synchronous fold, then
// read the delay they recorded after the block returned; a yielding control with the same probes
// keeps the delay in the microsecond range, which is what makes the sync reading meaningful.
if (options.instrument === 'full') {
  const proofSpec = makeSpec('default', mulberry32(options.seed + 6160))
  const proofLedger = buildLedger(proofSpec, 30000, mulberry32(options.seed + 6161))
  for (let i = 0; i < 2; i += 1) collab.projectTeamState(proofLedger.records)
  const syncProof = await instrumentScenario('stall-proof-sync', () => {
    for (let i = 0; i < 3; i += 1) collab.projectTeamState(proofLedger.records)
  }, { sync: true })
  const yieldProof = await instrumentScenario('stall-proof-yield', async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((done) => setImmediate(done))
  }, { sync: false })
  const pickProof = (reading) => ({
    wallMs: reading.wallMs,
    canaryObservedStallMs: reading.canaryObservedStallMs,
    syncWallAsStallMs: reading.syncWallAsStallMs,
    loopMaxMs: reading.stall === null ? null : reading.stall.eventLoopDelay.maxMs,
    loopP99Ms: reading.stall === null ? null : reading.stall.eventLoopDelay.p99Ms,
    driftMaxMs: reading.stall === null ? null : reading.stall.drift.maxMs,
    driftOver1ms: reading.stall === null ? null : reading.stall.drift.over1ms,
    cpuMs: reading.resource.cpuTotalMs,
  })
  INSTRUMENT.stallProof = {
    sync: pickProof(syncProof),
    yield: pickProof(yieldProof),
    interpretation: 'Sync canary delay tracks the block wall time (the loop could not answer); the yielding control keeps it in the microsecond range. For a pure-sync workload the instrument therefore reports wall time as the stall reading, and the probes prove why.',
  }
  if (HEADS_UP) {
    logSection('R492 event-loop instrumentation — stall-proof (30k-row fold x3 vs 3 yields)')
    logRow(['scenario', 'wallMs', 'canaryDelayMs', 'syncStallMs', 'loopP99Ms', 'loopMaxMs', 'driftMaxMs', 'cpuMs'], [20, 9, 13, 12, 11, 11, 11, 9])
    const proofRow = (label, proof) => logRow([label, String(proof.wallMs), String(proof.canaryObservedStallMs), String(proof.syncWallAsStallMs), String(proof.loopP99Ms), String(proof.loopMaxMs), String(proof.driftMaxMs), String(proof.cpuMs)], [20, 9, 13, 12, 11, 11, 11, 9])
    proofRow('sync fold (3 reps)', INSTRUMENT.stallProof.sync)
    proofRow('yield control', INSTRUMENT.stallProof.yield)
  }
}

const runSections = []
for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
  for (const mode of options.modes) {
    runSections.push(await runMode(mode))
    if (HEADS_UP && options.runs > 1) console.log('  [run ' + String(runIndex + 1) + '/' + String(options.runs) + '] mode ' + mode + ' measured (' + String(round((Date.now() - startedAt) / 1000, 1)) + ' s elapsed)')
  }
}
const modesRan = [...options.modes]
for (const mode of modesRan) {
  const sections = runSections.filter((section) => section.mode === mode)
  const merged = sections.length === 1 ? sections[0] : mergeAcrossRuns(sections)
  merged.mode = mode
  merged.label = MODE_SHAPES[mode].label
  if (sections.length > 1 && merged.rows !== undefined) annotateBest(merged, sections)
  report.modes[mode] = merged
  if (HEADS_UP) {
    printModeTable(merged)
    printProjections(merged)
  }
}
if (HEADS_UP && options.runs > 1) console.log('\n(each number above is the median across ' + String(options.runs) + ' runs)')

// Ledger write path: the production append (one JSONL line per record) and what a write costs
// when the fold cache is cold (the collab write handlers fold before AND after each append).
if (!options.skip.has('write')) {
  const writeRng = mulberry32(options.seed + 777)
  const writeSpec = makeSpec('multi-level', writeRng)
  const writeLedger = buildLedger(writeSpec, 2000, writeRng)
  const append = await measureRealLogAppend(writeLedger.records)
  report.append = append
  report.append.instr = await instrumentScenario('ledger-append-500', () => appendSample(writeLedger.records.slice(0, 500)), { sync: false, bytesRead: writeLedger.records.slice(0, 500).reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)), 0) })
  const fold100k = report.modes['multi-level'] === undefined ? null : report.modes['multi-level'].rows[String(options.rows[options.rows.length - 1])]
  report.append.writeCostModel = fold100k === null || fold100k.fold === null ? null : {
    rows: options.rows[options.rows.length - 1],
    twoColdFoldsMs: round(fold100k.fold.meanMs * 2, 1),
    appendMs: round((append.perRecordUs * 2) / 1000, 6),
    totalMsPerWrite: round(fold100k.fold.meanMs * 2 + (append.perRecordUs * 2) / 1000, 1),
  }
  if (HEADS_UP) {
    logSection('ledger write path (production openControlLog append, ' + String(append.records) + ' records)')
    console.log('  append: ' + String(append.perRecordUs) + ' us/record (' + String(append.recordsPerSec) + ' records/s), ' + String(append.lineBytes) + ' B/JSONL line')
    if (report.append.writeCostModel !== null) {
      const model = report.append.writeCostModel
      console.log('  one write at rows=' + String(model.rows) + ': 2 cold folds ' + String(model.twoColdFoldsMs) + ' ms + append -> ' + String(model.totalMsPerWrite) + ' ms of synchronous host work')
    }
  }
  samplePeak()
}

// DIAG: one execution, independent of mode (the recorder sees every session).
if (!options.skip.has('diag')) {
  const rng = mulberry32(options.seed + 12345)
  const spec = makeSpec('multi-level', rng)
  const events = buildSessionEvents(spec, options.diagEvents, rng)
  const teamEvents = events.filter((event) => String(event.type).startsWith('team/') || event.type === 'agent/inbox/spliced').length
  const diag = await measureDiagCosts(events)
  diag.sample = { events: events.length, teamEvents, teamSharePercent: round((100 * teamEvents) / events.length, 2) }
  report.diag = diag
  if (HEADS_UP) {
    logSection('DIAG per-event logging (production recordTeamEvents, ' + String(events.length) + ' session events)')
    logRow(['variant', 'us/event', 'ms per 1M events'], [22, 12, 18])
    logRow(['noop log (recorder only)', String(diag.perEventUs.noopLog), String(round(diag.perEventUs.noopLog, 1))], [22, 12, 18])
    logRow(['stdout pipe (sample ' + String(diag.stdout.sampleEvents) + ')', String(diag.perEventUs.stdoutPipe), String(round(diag.perEventUs.stdoutPipe, 1))], [22, 12, 18])
    logRow(['file sink', String(diag.perEventUs.fileSink), String(round(diag.perEventUs.fileSink, 1))], [22, 12, 18])
    logRow(['teamEventToRecord only', String(diag.perEventUs.mappingOnly), '-'], [22, 12, 18])
    logRow(['DIAG line (pipe / file)', String(diag.perEventUs.diagLineStdoutUs) + ' / ' + String(diag.perEventUs.diagLineFileUs), '-'], [22, 12, 18])
    logRow(['default now (trace off)', String(diag.perEventUs.traceOff), String(round(diag.perEventUs.traceOff, 1))], [22, 12, 18])
    for (const mode of Object.keys(diag.rateModel)) {
      const rate = diag.rateModel[mode]
      console.log('  ' + mode + ': ' + String(rate.sessions) + ' sessions, steady ' + String(rate.steadyEventsPerSec) + ' ev/s -> '
        + String(rate.steadyCpuPercent) + '% of one core; busy ' + String(rate.busyEventsPerSec) + ' ev/s -> ' + String(rate.busyCpuPercent) + '%')
    }
  }
}

// Churn: the losers quadratic — same length, same entity count, only claim disagreement differs.
if (!options.skip.has('churn')) {
  const churnRows = options.quick ? 4000 : 10000
  const entities = 16
  const churn = buildChurnLedger(entities, churnRows, true, 1760000000000)
  const stable = buildChurnLedger(entities, churnRows, false, 1760000000000)
  const churnFold = measureSync(() => collab.projectTeamState(churn), { minReps: 2, maxReps: 5, budgetMs: 1200 })
  const stableFold = measureSync(() => collab.projectTeamState(stable), { minReps: 2, maxReps: 5, budgetMs: 1200 })
  const churnState = collab.projectTeamState(churn)
  const stableState = collab.projectTeamState(stable)
  const churnJson = Buffer.byteLength(JSON.stringify(churnState))
  const stableJson = Buffer.byteLength(JSON.stringify(stableState))
  const losers = churnState.tasks.reduce((sum, task) => sum + task.losers.length, 0)
  report.churn = {
    rows: churnRows, entities,
    churn: { foldMs: churnFold.meanMs, usPerRecord: round((churnFold.meanMs * 1000) / churnRows, 3), stateBytes: churnJson, losers },
    stable: { foldMs: stableFold.meanMs, usPerRecord: round((stableFold.meanMs * 1000) / churnRows, 3), stateBytes: stableJson, losers: 0 },
    foldRatio: round(churnFold.meanMs / stableFold.meanMs, 2),
    bytesRatio: round(churnJson / stableJson, 2),
  }
  report.churn.instr = {
    churn: await instrumentScenario('churn-fold', () => collab.projectTeamState(churn), { sync: true, bytesRead: Buffer.byteLength(JSON.stringify(churn)) }),
    stable: await instrumentScenario('churn-stable-fold', () => collab.projectTeamState(stable), { sync: true, bytesRead: Buffer.byteLength(JSON.stringify(stable)) }),
  }
  if (HEADS_UP) {
    logSection('churn ledgers (losers quadratic), rows=' + String(churnRows) + ' entities=' + String(entities))
    console.log('  claim-churn: fold ' + String(churnFold.meanMs) + ' ms (' + String(report.churn.churn.usPerRecord) + ' us/rec), state ' + String(mb(churnJson)) + ' MB, losers ' + String(losers))
    console.log('  claim-stable: fold ' + String(stableFold.meanMs) + ' ms (' + String(report.churn.stable.usPerRecord) + ' us/rec), state ' + String(mb(stableJson)) + ' MB, losers 0')
    console.log('  churn / stable = ' + String(report.churn.foldRatio) + 'x fold, ' + String(report.churn.bytesRatio) + 'x bytes')
  }
  samplePeak()
}

// Client event-window assembly / renderer live-tail model.
if (!options.skip.has('window')) {
  const sizes = options.rows.filter((size) => size <= 100000)
  const windowReport = measureEventWindow(sizes)
  report.window = windowReport
  // R492: instrument the worst case (build the window, then materialize once at the largest size).
  const largestWindowSize = sizes[sizes.length - 1]
  const windowEntries = Array.from({ length: largestWindowSize }, (ignored, index) => { void ignored; return makeEntry(index) })
  const instrWindow = await instrumentScenario('window-build-materialize@' + String(largestWindowSize), () => {
    let built = leafNode([])
    for (const entry of windowEntries) built = concatNode(built, leafNode([entry]))
    return materializeNode(built)
  }, { sync: true, bytesRead: windowEntries.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0) })
  const windowTree = (() => {
    let built = leafNode([])
    for (const entry of windowEntries) built = concatNode(built, leafNode([entry]))
    return built
  })()
  report.window.instr = {
    ...instrWindow,
    retainedHeap: measureRetainedHeap(() => ({ entries: [...windowEntries], tree: windowTree, materialized: materializeNode(windowTree) })),
    objects: {
      retained: { entries: windowEntries.length, concatNodes: largestWindowSize, leafNodes: largestWindowSize, materializedArray: largestWindowSize },
      note: 'exact object counts for the faithful window model: one leaf+one concat node per append, plus the materialized array',
    },
  }
  const renderMapEntries = null
  void renderMapEntries
  if (HEADS_UP) {
    logSection('client event window + renderer live-tail model')
    for (const size of sizes) {
      const entry = windowReport['appendTree@' + String(size)]
      console.log('  tree append n=' + String(size) + ': ' + String(entry.appendMs) + ' ms total, one materialize ' + String(entry.materializeMs) + ' ms')
    }
    for (const [key, entry] of Object.entries(windowReport.materializeEachAppend)) {
      console.log('  materialize-every-append ' + key + ': ' + String(entry.totalMs) + ' ms total (' + String(entry.perAppendMs) + ' ms/append, ' + entry.complexity + ')')
    }
    for (const size of sizes) {
      const entry = windowReport.cappedRing['n=' + String(size)]
      console.log('  capped ring (500) n=' + String(size) + ': append ' + String(entry.appendMs) + ' ms, materialize ' + String(entry.materializeMs) + ' ms')
    }
    const renderer = windowReport.renderer
    console.log('  renderer model: ' + String(renderer.bytesPerEntry) + ' B/event retained (' + String(renderer.heapMbFor100k) + ' MB per 100k events), one map pass over '
      + String(renderer.entries) + ' = ' + String(renderer.renderMapMs) + ' ms')
  }
  samplePeak()
}

// Rust path: measured only when an addon exists. The same script drives it when the module lands.
if (!options.skip.has('rust')) {
  const engine = loadRustEngine()
  if (options.engine === 'rust' && engine.fold === null) {
    console.error('r487-harness: --engine=rust requested but no dsh-compute .node was found. Looked in: '
      + [PATHS.computeLib, PATHS.rustRelease, PATHS.rustDebug].join(', '))
    if (engine.failures.length > 0) console.error('  ' + engine.failures.join('\n  '))
    report.rust = { requested: true, available: false, failures: engine.failures }
    options.exitCode = 2
  } else {
    const mode = modesRan[0]
    const section = report.modes[mode]
    const largest = options.rows[options.rows.length - 1]
    const rng = mulberry32(options.seed + mode.length * 7919)
    const spec = makeSpec(mode, rng)
    const ledger = buildLedger(spec, largest, mulberry32(options.seed + 4242))
    const tsFold = section.rows[String(largest)].fold
    if (engine.fold === null) {
      report.rust = {
        requested: options.engine, available: false, failures: engine.failures,
        skippedReason: 'no napi addon found; this script calls foldCollabRecords(recordsJson) when plugins/dsh-link-compute/lib or rust/target/*/*.node exists',
        measuredTsReference: tsFold === null ? null : { foldMs: tsFold.meanMs, rows: ledger.records.length },
      }
      if (HEADS_UP) console.log('\n== rust path ==\n  no addon found (expected until the napi module lands); TS reference fold at rows=' + String(largest) + ' is ' + String(tsFold === null ? '-' : tsFold.meanMs) + ' ms')
    } else {
      // The napi contract today is string-in/string-out (foldCollabRecords(recordsJson)), so the
      // crossing itself is part of the price: stringify the whole ledger, parse it in Rust, parse
      // the summary back in JS. Warm the addon first, then report medians of three calls.
      let addonVersion = null
      try { addonVersion = typeof engine.nativeVersion === 'function' ? engine.nativeVersion() : null } catch { addonVersion = null }
      try { engine.fold(JSON.stringify(ledger.records.slice(0, 2000))) } catch { /* a warmup failure is reported by the measured call */ }
      const inputSamples = []
      const callSamples = []
      const outputSamples = []
      let inputBytes = 0
      let summary = null
      let error = null
      for (let rep = 0; rep < 3; rep += 1) {
        const inputStart = process.hrtime.bigint()
        const json = JSON.stringify(ledger.records)
        inputSamples.push(hrtimeMs(inputStart))
        inputBytes = Buffer.byteLength(json)
        const callStart = process.hrtime.bigint()
        try { summary = engine.fold(json) } catch (thrown) { error = String(thrown && thrown.message); summary = null }
        callSamples.push(hrtimeMs(callStart))
        const outputStart = process.hrtime.bigint()
        try { JSON.parse(String(summary ?? '{}')) } catch { /* the call's own answer is reported below */ }
        outputSamples.push(hrtimeMs(outputStart))
      }
      const median = (list) => { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] }
      const inputMs = round(median(inputSamples), 3)
      const callMs = round(median(callSamples), 3)
      const outputMs = round(median(outputSamples), 3)
      const totalMs = round(inputMs + callMs + outputMs, 3)
      let summaryFields = null
      try {
        const parsed = JSON.parse(String(summary ?? '{}'))
        summaryFields = {
          keys: Object.keys(parsed).slice(0, 12),
          records: typeof parsed.records === 'number' ? parsed.records : null,
          lastSeq: typeof parsed.lastSeq === 'number' ? parsed.lastSeq : null,
          memberRows: Array.isArray(parsed.members) ? parsed.members.length : null,
          byKindKinds: Array.isArray(parsed.byKind) ? parsed.byKind.length : null,
        }
      } catch { summaryFields = null }
      const artifact = existsSync(engine.file) ? { ...statInfo(engine.file), sha256: sha256(engine.file) } : null
      const rustInstr = await instrumentScenario('rust-fold@' + String(largest), () => {
        const json = JSON.stringify(ledger.records)
        return engine.fold(json)
      }, { sync: true, bytesRead: inputBytes })
      report.rust = {
        requested: options.engine, available: true, file: engine.file, artifact, addonVersion,
        rows: ledger.records.length, reps: 3,
        inputMs, inputBytes, callMs, outputMs, totalMs, error, summaryFields,
        tsFoldMeanMs: tsFold === null ? null : tsFold.meanMs,
        tsFoldBestMs: tsFold === null ? null : tsFold.bestMs,
        netSpeedup: tsFold === null ? null : round(tsFold.meanMs / totalMs, 2),
        crossingSharePercent: round((100 * (inputMs + outputMs)) / totalMs, 1),
        instr: rustInstr,
      }
      if (HEADS_UP) {
        console.log('\n== rust path ==\n  ' + String(engine.file) + ' (nativeVersion ' + String(addonVersion) + '): input stringify ' + String(inputMs) + ' ms (' + String(mb(inputBytes)) + ' MB) + call ' + String(callMs) + ' ms + output parse ' + String(outputMs) + ' ms -> net ' + String(report.rust.netSpeedup) + 'x vs TS (' + String(report.rust.tsFoldMeanMs) + ' ms); crossing = ' + String(report.rust.crossingSharePercent) + '% of the total')
      }
    }
  }
  samplePeak()
}

// R492 instrumentation summary: one instrumented rep per scenario, side by side.
if (HEADS_UP && options.instrument === 'full') {
  const scenarios = Object.entries(INSTRUMENT.scenarios).filter(([label]) => !label.startsWith('stall-proof'))
  if (scenarios.length > 0) {
    logSection('R492 instrumentation summary (' + String(scenarios.length) + ' instrumented scenarios)')
    logRow(['scenario', 'wallMs', 'cpuMs', 'cpuUs/op', 'rssDelta', 'heapDelta', 'loopP99', 'loopMax', 'canaryMs', 'syncStall', 'bytesRead'], [34, 9, 8, 10, 9, 10, 9, 9, 10, 10, 10])
    for (const [label, reading] of scenarios) {
      const loop = reading.stall === null ? null : reading.stall.eventLoopDelay
      logRow([
        label,
        String(reading.wallMs),
        String(reading.resource.cpuTotalMs),
        String(reading.cpuPerRepMs === undefined ? '-' : round(reading.cpuPerRepMs * 1000, 1)),
        '+' + String(reading.resource.rss.deltaMb),
        '+' + String(reading.resource.heap.deltaMb),
        String(loop === null ? '-' : loop.p99Ms),
        String(loop === null ? '-' : loop.maxMs),
        String(reading.canaryObservedStallMs === null ? '-' : reading.canaryObservedStallMs),
        String(reading.syncWallAsStallMs === null ? '-' : reading.syncWallAsStallMs),
        String(reading.bytesRead === null ? '-' : reading.bytesRead),
      ], [34, 9, 8, 10, 9, 10, 9, 9, 10, 10, 10])
    }
  }
}

report.peakRssMb = samplePeak()
report.meta.elapsedMs = Date.now() - startedAt
report.meta.humanElapsedSeconds = round(report.meta.elapsedMs / 1000, 1)

if (options.out !== null) {
  report.meta.outputFile = OUTPUT_FILE
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
  writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8')
  if (HEADS_UP) console.log('\nJSON report: ' + OUTPUT_FILE + ' (generatedAt ' + String(report.meta.startedAt) + ')')
}
if (options.json === true) console.log(JSON.stringify(report, null, 2))
else console.log('\ndone in ' + String(report.meta.humanElapsedSeconds) + ' s | peak RSS ' + String(report.peakRssMb) + ' MB')
process.exit(options.exitCode)
