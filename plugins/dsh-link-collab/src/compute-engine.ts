/**
 * R505: the compute-fold engine switch for collab's read path, as a shadow comparison.
 *
 * The compute plugin publishes a byte-batched index over the same control ledger. Its contract is
 * NOT collab's TeamState contract (R505 measured the difference: identity sets overlap, but member
 * and task TEAM attribution, the counts vocabulary and eleven collab-only projections do not), so
 * the index cannot answer state() yet. What it can do safely today is run BESIDE the existing fold
 * and report how far the two agree: a shadow comparison.
 *
 * Invariants this module keeps (approved as hard constraints, R505 review rounds 1 and 2):
 *
 *  1. READ-ONLY, ZERO RESPONSE IMPACT. observe() never returns a value, never throws and never
 *     mutates the state it is given. Any failure is swallowed and counted; state() is byte-for-byte
 *     the same as with engine=ts.
 *  2. OFF THE RESPONSE PATH. observe() only counts and schedules; the ledger read and the fold run
 *     in setImmediate/setTimeout(0) (or an injected scheduler), never inside state(). A large
 *     ledger therefore cannot add latency to a read; it can only consume background time.
 *  3. BUDGETED. A ledger larger than shadowMaxBytes (default 8 MiB) disables the shadow and is
 *     counted; the response path keeps working untouched.
 *  4. THROTTLED. Sampling is limited by BOTH a sample counter (default every 20th eligible call)
 *     and a wall-clock interval (default 2000 ms); the FIRST eligible call is always sampled
 *     (explicit first-sample semantics), and a sample already in flight is never overlapped.
 *  5. CACHED BY (size, mtime). While both are unchanged the previous snapshot is reused (a cache
 *     hit). THREAT MODEL: an in-place rewrite that preserves both makes the shadow compare a stale
 *     fold. Acceptable for a diagnostics-only shadow; once a serving path is considered, the cache
 *     MUST become a content hash (listed in R505 section 8).
 *  6. NO PAYLOAD CONTENT IN DIAGNOSTICS. Only counts, ids of the first differing row, field names,
 *     timings and error messages are recorded.
 *
 * Configuration lives under CollabConfig.fold.engine: 'ts' (default) | 'native-shadow'. Sampling
 * parameters are compiled defaults here; only engine is a configuration key (R505 section 5).
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Which engine collab's read path uses for its own fold. */
export type FoldEngineName = 'ts' | 'native-shadow'

/** What resolveFoldEngine answers: the configured engine, and why. */
export interface FoldEngineChoice {
  /** The engine the read path should use. */
  readonly engine: FoldEngineName
  /** Where the choice came from, for logs and diagnostics. */
  readonly reason: string
}

/** The fixed diagnostics shape exposed to the capability and the panel. */
export interface ComputeShadowDiagnostics {
  /** The sampled comparison is on only when this is 'native-shadow'. */
  readonly mode: FoldEngineName
  /** False once the budget disabled the shadow (or it was never enabled). */
  readonly enabled: boolean
  /** Samples that completed. */
  readonly runs: number
  /** Eligible state() calls seen (sampling counter). */
  readonly calls: number
  /** Samples skipped because the throttle had not elapsed. */
  readonly skipped: number
  /** Samples skipped because another sample was still in flight. */
  readonly overlapped: number
  /** Calls skipped because the ledger exceeded shadowMaxBytes (the shadow is then disabled). */
  readonly oversizeSkips: number
  /** Times a sample was answered from the (size, mtime) cache. */
  readonly cacheHits: number
  /** Number of overlapping-field differences in the latest sample. */
  readonly diffs: number
  /** The first differing field of the latest sample, or null. */
  readonly firstDiff: { readonly entity: string, readonly id: string, readonly field: string } | null
  /** Wall time of the latest completed sample, in milliseconds (background, not response path). */
  readonly lastMs: number
  /** p50/p99/max of the last completed sample times (ring of 64). */
  readonly sampleP50Ms: number
  readonly sampleP99Ms: number
  readonly sampleMaxMs: number
  /** Samples that failed (service missing, addon error, domain rejection, bad shape). */
  readonly failures: number
  /** Last failure message, or null. Never contains payload content. */
  readonly lastError: string | null
  /** Why the shadow stopped sampling (budget), or null. */
  readonly disabledReason: string | null
  /** Which compute half answered the latest sample ('native' | 'typescript' | 'none'). */
  readonly computeKind: 'native' | 'typescript' | 'none'
}

/** Options for one shadow instance (one control log). */
export interface ComputeShadowOptions {
  /** Directory holding control.jsonl. */
  readonly directory: string
  /** Return the compute facade (ctx.linkCompute), or undefined when the row is not mounted. */
  readonly getService: () => unknown
  /** Sample every Nth eligible call. @default 20 */
  readonly sampleEvery?: number
  /** Minimum wall-clock distance between samples. @default 2000 */
  readonly sampleIntervalMs?: number
  /** Largest ledger the shadow is allowed to fold; larger disables it. @default 8 MiB */
  readonly shadowMaxBytes?: number
  /** Injectable clock for tests. @default Date.now */
  readonly now?: () => number
  /** Injectable scheduler for tests; must run the task later, off the caller's stack. */
  readonly schedule?: (task: () => void) => void
}

/** A structural view of the compute facade this module needs (no import of its types). */
interface ComputeFacadeLike {
  readonly kind?: string
  openFoldIndex: () => {
    appendRecords: (frame: Uint8Array) => Uint8Array
    snapshot: () => string
  }
}

/** A structural view of the collab TeamState fields the comparison reads. */
interface CollabStateLike {
  readonly members?: ReadonlyArray<{ readonly id?: unknown, readonly team?: unknown, readonly state?: unknown }>
  readonly tasks?: ReadonlyArray<{ readonly id?: unknown, readonly team?: unknown, readonly owner?: unknown, readonly status?: unknown }>
  readonly teams?: { readonly teams?: ReadonlyArray<{ readonly id?: unknown, readonly team?: unknown, readonly parent?: unknown, readonly lead?: unknown }> }
  readonly counts?: { readonly folded?: unknown }
}

/** The mutable twin the sampler writes; diagnostics() copies it out as the readonly shape. */
interface MutableDiagnostics {
  mode: FoldEngineName
  enabled: boolean
  runs: number
  calls: number
  skipped: number
  overlapped: number
  oversizeSkips: number
  cacheHits: number
  diffs: number
  firstDiff: ComputeShadowDiagnostics['firstDiff']
  lastMs: number
  failures: number
  lastError: string | null
  disabledReason: string | null
  computeKind: 'native' | 'typescript' | 'none'
}

/** Build the default diagnostics object. */
function emptyDiagnostics(mode: FoldEngineName): MutableDiagnostics {
  return {
    mode, enabled: mode === 'native-shadow', runs: 0, calls: 0, skipped: 0, overlapped: 0, oversizeSkips: 0,
    cacheHits: 0, diffs: 0, firstDiff: null, lastMs: 0, failures: 0, lastError: null, disabledReason: null,
    computeKind: 'none',
  }
}

/** Read config.fold.engine, defaulting to 'ts' and refusing an unknown value. */
export function resolveFoldEngine(config?: { readonly fold?: { readonly engine?: unknown } }): FoldEngineChoice {
  const requested = config?.fold?.engine
  if (requested === undefined || requested === 'ts') return { engine: 'ts', reason: 'default: TypeScript fold (native shadow off)' }
  if (requested === 'native-shadow') return { engine: 'native-shadow', reason: 'configured: native index runs as a shadow comparison only' }
  throw new TypeError("dsh-link-collab: fold.engine must be 'ts' or 'native-shadow'; got " + String(requested))
}

/** Compare one sampled fold against collab's state; returns the number of differing fields. */
function compareState(state: CollabStateLike, snapshotJson: string): { diffs: number, firstDiff: ComputeShadowDiagnostics['firstDiff'] } {
  const snapshot = JSON.parse(snapshotJson) as {
    members?: ReadonlyArray<{ readonly id?: unknown, readonly team?: unknown, readonly state?: unknown }>
    tasks?: ReadonlyArray<{ readonly id?: unknown, readonly team?: unknown, readonly owner?: unknown, readonly state?: unknown }>
    teams?: ReadonlyArray<{ readonly team?: unknown, readonly parent?: unknown, readonly lead?: unknown }>
  }
  const collabMembers = new Map<string, { team?: unknown, state?: unknown }>()
  for (const member of state.members ?? []) collabMembers.set(String(member.id), { team: member.team ?? null, state: member.state ?? null })
  const computeMembers = new Map<string, { team?: unknown, state?: unknown }>()
  for (const member of snapshot.members ?? []) computeMembers.set(String(member.id), { team: member.team ?? null, state: member.state ?? null })
  const collabTasks = new Map<string, { team?: unknown, owner?: unknown, status?: unknown }>()
  for (const task of state.tasks ?? []) collabTasks.set(String(task.id), { team: task.team ?? null, owner: task.owner ?? null, status: task.status ?? null })
  const computeTasks = new Map<string, { team?: unknown, owner?: unknown, state?: unknown }>()
  for (const task of snapshot.tasks ?? []) computeTasks.set(String(task.id), { team: task.team ?? null, owner: task.owner ?? null, state: task.state ?? null })
  const collabTeams = new Map<string, { parent?: unknown, lead?: unknown }>()
  for (const node of state.teams?.teams ?? []) collabTeams.set(String(node.id ?? node.team), { parent: node.parent ?? null, lead: node.lead ?? null })
  const computeTeams = new Map<string, { parent?: unknown, lead?: unknown }>()
  for (const node of snapshot.teams ?? []) computeTeams.set(String(node.team), { parent: node.parent ?? null, lead: node.lead ?? null })

  let diffs = 0
  let firstDiff: ComputeShadowDiagnostics['firstDiff'] = null
  const check = (entity: string, id: string, field: string): void => {
    diffs += 1
    if (firstDiff === null) firstDiff = { entity, id, field }
  }
  for (const [id, collab] of collabMembers) {
    const compute = computeMembers.get(id)
    if (compute === undefined) { check('member', id, 'presence'); continue }
    if (JSON.stringify(collab.team) !== JSON.stringify(compute.team)) check('member', id, 'team')
    if (JSON.stringify(collab.state) !== JSON.stringify(compute.state)) check('member', id, 'state')
  }
  for (const id of computeMembers.keys()) if (!collabMembers.has(id)) check('member', id, 'presence')
  for (const [id, collab] of collabTasks) {
    const compute = computeTasks.get(id)
    if (compute === undefined) { check('task', id, 'presence'); continue }
    if (JSON.stringify(collab.team) !== JSON.stringify(compute.team)) check('task', id, 'team')
    if (JSON.stringify(collab.owner) !== JSON.stringify(compute.owner)) check('task', id, 'owner')
    if (JSON.stringify(collab.status) !== JSON.stringify(compute.state)) check('task', id, 'status')
  }
  for (const id of computeTasks.keys()) if (!collabTasks.has(id)) check('task', id, 'presence')
  for (const [id, collab] of collabTeams) {
    const compute = computeTeams.get(id)
    if (compute === undefined) { check('team', id, 'presence'); continue }
    if (JSON.stringify(collab.parent) !== JSON.stringify(compute.parent)) check('team', id, 'parent')
    if (JSON.stringify(collab.lead) !== JSON.stringify(compute.lead)) check('team', id, 'lead')
  }
  for (const id of computeTeams.keys()) if (!collabTeams.has(id)) check('team', id, 'presence')
  return { diffs, firstDiff }
}

/** Nearest-rank percentile from an ascending array (0 when empty). */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil(fraction * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] ?? 0
}

/** One shadow bound to one control log. */
export interface ComputeShadow {
  /** Count one eligible state() call and maybe schedule a sample; never throws, never returns. */
  observe: (state: unknown) => void
  /** The fixed diagnostics shape. */
  diagnostics: () => ComputeShadowDiagnostics
  /**
   * Release this shadow: no further sampling, no scheduled work, diagnostics answer as disabled.
   * Called when the owning composition unloads (see disposeComputeShadow), so a hot reload or a
   * switch back to engine=ts cannot leave a stale shadow sampling behind.
   */
  dispose: () => void
}

/**
 * Create the shadow comparison for one control log.
 *
 * @param options - directory, service getter, throttle and budget settings.
 * @returns the shadow handle.
 */
export function createComputeShadow(options: ComputeShadowOptions): ComputeShadow {
  const sampleEvery = options.sampleEvery ?? 20
  const sampleIntervalMs = options.sampleIntervalMs ?? 2000
  const shadowMaxBytes = options.shadowMaxBytes ?? 8 * 1024 * 1024
  const now = options.now ?? ((): number => Date.now())
  const schedule = options.schedule ?? ((task: () => void): void => { setTimeout(task, 0) })
  const diagnostics: MutableDiagnostics = emptyDiagnostics('native-shadow')
  const sampleTimes: number[] = []
  let lastSampleAt = Number.NEGATIVE_INFINITY
  let lastKey = ''
  let lastSnapshot: string | null = null
  let sampleInFlight = false
  let pendingState: unknown = null
  let pendingScheduled = false
  let disposed = false

  /** Run one sample; only ever called from the scheduler, never from observe(). */
  const sample = (): void => {
    if (disposed) return
    sampleInFlight = true
    const began = now()
    try {
      const service = options.getService()
      if (service === null || typeof service !== 'object') {
        diagnostics.failures += 1
        diagnostics.lastError = 'linkCompute is not mounted (compute row disabled or absent)'
        return
      }
      const facade = service as ComputeFacadeLike
      if (typeof facade.openFoldIndex !== 'function') {
        diagnostics.failures += 1
        diagnostics.lastError = 'linkCompute publishes no openFoldIndex'
        return
      }
      const path = join(options.directory, 'control.jsonl')
      const stat = statSync(path)
      // Budget first: an oversized ledger disables the shadow instead of adding background work.
      if (stat.size > shadowMaxBytes) {
        diagnostics.oversizeSkips += 1
        diagnostics.enabled = false
        diagnostics.disabledReason = 'ledger exceeds shadowMaxBytes (' + String(stat.size) + ' > ' + String(shadowMaxBytes) + ')'
        return
      }
      const key = String(stat.size) + ':' + String(stat.mtimeMs)
      let snapshotJson = lastSnapshot
      if (key !== lastKey || snapshotJson === null) {
        const bytes = readFileSync(path)
        const index = facade.openFoldIndex()
        // Byte-batched append in fixed chunks: one crossing per batch, never one per record.
        const chunk = 500 * 1024
        for (let offset = 0; offset < bytes.length; offset += chunk) {
          index.appendRecords(bytes.subarray(offset, Math.min(bytes.length, offset + chunk)))
        }
        snapshotJson = index.snapshot()
        lastSnapshot = snapshotJson
        lastKey = key
      } else {
        diagnostics.cacheHits += 1
      }
      diagnostics.computeKind = facade.kind === 'native' ? 'native' : 'typescript'
      diagnostics.runs += 1
      const comparison = compareState((pendingState ?? {}) as CollabStateLike, snapshotJson)
      diagnostics.diffs = comparison.diffs
      diagnostics.firstDiff = comparison.firstDiff
      diagnostics.lastMs = now() - began
      sampleTimes.push(diagnostics.lastMs)
      if (sampleTimes.length > 64) sampleTimes.shift()
    } catch (error) {
      // READ-ONLY INVARIANT: a shadow defect must never reach the caller of state().
      diagnostics.failures += 1
      diagnostics.lastError = error instanceof Error ? error.message : String(error)
      diagnostics.lastMs = now() - began
    } finally {
      sampleInFlight = false
    }
  }

  return {
    observe(state: unknown): void {
      if (disposed) return
      diagnostics.calls += 1
      // First-sample semantics: the first eligible call is always sampled, no counter/interval gate.
      const firstSample = diagnostics.runs === 0 && !sampleInFlight && !pendingScheduled
      if (diagnostics.enabled && firstSample) {
        lastSampleAt = now()
        pendingState = state
        pendingScheduled = true
        schedule(() => { pendingScheduled = false; sample() })
        return
      }
      if (diagnostics.calls % sampleEvery !== 0) { diagnostics.skipped += 1; return }
      if (sampleInFlight || pendingScheduled) { diagnostics.overlapped += 1; return }
      if (now() - lastSampleAt < sampleIntervalMs) { diagnostics.skipped += 1; return }
      lastSampleAt = now()
      pendingState = state
      pendingScheduled = true
      schedule(() => { pendingScheduled = false; sample() })
    },
    dispose(): void {
      disposed = true
      pendingScheduled = false
      pendingState = null
    },
    diagnostics(): ComputeShadowDiagnostics {
      const sorted = sampleTimes.slice().sort((left, right) => left - right)
      const max = sorted.length === 0 ? 0 : (sorted[sorted.length - 1] ?? 0)
      return {
        ...diagnostics,
        enabled: disposed ? false : diagnostics.enabled,
        disabledReason: disposed ? 'disposed' : diagnostics.disabledReason,
        firstDiff: diagnostics.firstDiff === null ? null : { ...diagnostics.firstDiff },
        sampleP50Ms: percentile(sorted, 0.5),
        sampleP99Ms: percentile(sorted, 0.99),
        sampleMaxMs: max,
      }
    },
  }
}

// One shadow per control-log directory, so the capability can expose diagnostics without the
// composition threading a handle through. Never created when engine=ts.
const SHADOWS = new Map<string, ComputeShadow>()

/** Get or create the shadow for one directory. */
export function computeShadowFor(options: ComputeShadowOptions): ComputeShadow {
  const existing = SHADOWS.get(options.directory)
  if (existing !== undefined) return existing
  const created = createComputeShadow(options)
  SHADOWS.set(options.directory, created)
  return created
}

/** The diagnostics of every shadow this process created (the capability exposes this). */
export function computeShadowDiagnostics(): ReadonlyArray<ComputeShadowDiagnostics> {
  return [...SHADOWS.values()].map((shadow) => shadow.diagnostics())
}

/**
 * Release the shadow for one control-log directory.
 *
 * A composition that created a shadow owns it: the collab row calls this from its dispose hook so a
 * hot reload (or a switch back to engine=ts) neither leaves stale background sampling nor keeps old
 * diagnostics in the map. Idempotent; safe when no shadow exists.
 */
export function disposeComputeShadow(directory: string): void {
  const shadow = SHADOWS.get(directory)
  if (shadow === undefined) return
  shadow.dispose()
  SHADOWS.delete(directory)
}

/** Drop every shadow (tests, and a composition tearing down the plugin). */
export function resetComputeShadows(): void {
  for (const shadow of SHADOWS.values()) shadow.dispose()
  SHADOWS.clear()
}
