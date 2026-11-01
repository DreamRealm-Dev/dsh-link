/**
 * Loading policy for the compute core: the napi addon when it is present and usable, the
 * pure-TypeScript reference otherwise.
 *
 * Two failure modes are covered, with different costs:
 * - **load failure** (missing file, wrong platform, broken ABI, an addon that does not export the
 *   functions) resolves to the reference before `apply` publishes anything, so the row works
 *   unchanged and reports which half answered;
 * - **call failure** (a panic or a defect inside the addon) latches the reference permanently:
 *   the failing call is re-answered by the reference, `nativeFailures` records it once and later
 *   calls never touch the addon again. One bad call must not become a retry storm on a hot path.
 *
 * The reference is the same module the gate and the benchmark compare the addon against, so the
 * fallback is the verified implementation, not a second behaviour to audit.
 *
 * Both halves are defined over one explicit input domain (valid UTF-8, finite numbers within
 * 2^53-1, no lone surrogate escapes); outside it both throw COMPUTE_DOMAIN instead of folding
 * differently. A native failure latches the reference and increments nativeFailures, so the
 * fallback is observable and never silent.
 */
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CollabFoldIndex as ReferenceFoldIndex,
  REFERENCE_VERSION,
  foldCollabRecords as referenceFoldCollabRecords,
  indexTeamStatus as referenceIndexTeamStatus,
} from './reference.ts'

/** Which half answered: the native addon or the pure-TypeScript reference. */
export type ComputeKind = 'native' | 'typescript'

/**
 * The native API version this host build was written against.
 *
 * The addon's `probe()` reports its own version; a mismatch means the two halves were built
 * against different wire layouts or entry signatures, so the addon is refused and the reference
 * answers instead of risking a silent misread. Bump both sides together on a breaking change.
 */
export const NATIVE_API_VERSION = 2

/** Every native capability this host build uses; an addon that omits one is refused. */
export const REQUIRED_NATIVE_FEATURES: readonly string[] = Object.freeze([
  'foldCollabRecords',
  'indexTeamStatus',
  'collabFoldIndex',
  'byteBatched',
  'deltaCursor',
  'probe',
])

/** What the answering half reports about its own API surface. */
export interface ProbeReport {
  /** True when the half loaded and can answer calls. */
  readonly ok: boolean
  /** Which half answered. */
  readonly kind: ComputeKind
  /** The native API version, or null for the pure-TypeScript reference. */
  readonly nativeApiVersion: number | null
  /** The capability names this half offers. */
  readonly features: readonly string[]
  /** The implementation version. */
  readonly version: string
  /** Where the half came from. */
  readonly detail: string
}

/** A stateful, append-only index over collaboration-bus control records. */
export interface FoldIndexBinding {
  /** Fold one JSON array of records; returns `{accepted, records, lastSeq, version}` JSON. */
  appendBatch(recordsJson: string): string
  /** Materialise the full summary of everything appended so far. */
  snapshot(): string
  /** The records and kinds added after `version`; 0 asks for everything. */
  deltaSince(version: number): string
  /** Fold one newline-delimited JSON batch; returns the 32-byte append-stats buffer. */
  appendRecords(frame: Uint8Array): Uint8Array
  /** The records and kinds added after `cursor`, as the delta buffer. */
  readDelta(cursor: number): Uint8Array
  /** The current version; incremented once per append. */
  version(): number
  /** How many rows the index folded so far. */
  records(): number
  /** The commutative fingerprint of everything appended so far. */
  checksum(): string
}

/**
 * The health/ready readout for operations: which half answers, which API/version it speaks, and
 * whether the addition fell back (with the failure counter and first error).
 *
 * Ready logs and health checks consume this object; it never triggers a native call itself.
 */
export interface ComputeHealth {
  /** False once a native failure latched the reference; true otherwise. */
  readonly ok: boolean
  /** Which half answers now. */
  readonly kind: ComputeKind
  /** The native API version the answering half speaks, or null for the reference. */
  readonly nativeApiVersion: number | null
  /** The answering half's implementation version. */
  readonly version: string
  /** The version the pure-TS half reports; native should be pair-locked to it. */
  readonly referenceVersion: string
  /** True when the answering half's version matches the reference version (pair-lock check). */
  readonly pairLocked: boolean
  /** Capability names the answering half offers. */
  readonly features: readonly string[]
  /** Native calls answered so far. */
  readonly nativeCalls: number
  /** Native calls that failed; the first one latched the reference. */
  readonly nativeFailures: number
  /** Message of the first native failure, or null when there was none. */
  readonly lastError: string | null
  /** Where the answering half came from. */
  readonly detail: string
}

/** One implementation behind the two function names. */
export interface ComputeBinding {
  /** Which half this is. */
  readonly kind: ComputeKind
  /** The implementation version: the crate version, or the reference module's version. */
  readonly version: string
  /** A human-readable note about where this binding came from. */
  readonly detail: string
  /** Fold collaboration-bus control records into the summary JSON. */
  foldCollabRecords(recordsJson: string): string
  /** Index a team's durable event stream into the team-status JSON. */
  indexTeamStatus(eventsJson: string): string
  /** Open a stateful incremental index over control records. */
  openFoldIndex(): FoldIndexBinding
  /** Report this half's API version and capabilities. */
  probe(): ProbeReport
}

/** Options for {@link resolveBinding}. */
export interface BindingOptions {
  /** `auto` loads the addon when present; `off` always uses the reference. @default 'auto' */
  readonly native?: 'auto' | 'off'
  /** Explicit addon path, for a caller that stages the binary elsewhere. */
  readonly addonPath?: string
}

/** The plugin root, from the source (src/) or the build artifact (lib/) alike. */
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Where the addon build publishes the binary. */
const ADDON_PATH = join(PLUGIN_ROOT, 'lib', 'dsh_compute.node')

/** Capabilities the pure-TypeScript reference offers (the same names the addon reports). */
const REFERENCE_FEATURES: readonly string[] = Object.freeze([
  'foldCollabRecords',
  'indexTeamStatus',
  'collabFoldIndex',
  'byteBatched',
  'deltaCursor',
])

/** The probe answer of the pure-TypeScript reference. */
function referenceProbe(): ProbeReport {
  return {
    ok: true,
    kind: 'typescript',
    nativeApiVersion: null,
    features: REFERENCE_FEATURES,
    version: REFERENCE_VERSION,
    detail: 'pure-TypeScript reference',
  }
}

/** The pure-TypeScript reference, as a binding. */
const REFERENCE: ComputeBinding = Object.freeze({
  kind: 'typescript',
  version: REFERENCE_VERSION,
  detail: 'pure-TypeScript reference',
  foldCollabRecords: referenceFoldCollabRecords,
  indexTeamStatus: referenceIndexTeamStatus,
  openFoldIndex: () => new ReferenceFoldIndex(),
  probe: referenceProbe,
})

/** The reference binding. */
export function referenceBinding(): ComputeBinding {
  return REFERENCE
}

/** Check one required value is a callable function. */
function functionOf(record: Record<string, unknown>, name: string): ((input: string) => unknown) | undefined {
  const value = record[name]
  return typeof value === 'function' ? (value as (input: string) => unknown) : undefined
}

/** Require a call's answer to be the JSON string the contract promises. */
function jsonStringOf(name: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('compute addon ' + name + ' returned ' + typeof value + ' instead of a JSON string')
  }
  return value
}

/** Wrap the addon's CollabFoldIndex class in the binding interface. */
function nativeFoldIndexOf(constructor: unknown, path: string): FoldIndexBinding {
  if (typeof constructor !== 'function') {
    throw new Error('compute addon at ' + path + ' exports no CollabFoldIndex')
  }
  const instance = new (constructor as new () => unknown)()
  if (typeof instance !== 'object' || instance === null) {
    throw new Error('compute addon CollabFoldIndex did not construct an object')
  }
  const record = instance as Record<string, unknown>
  const call = (name: string, args: unknown[]): unknown => {
    const method = record[name]
    if (typeof method !== 'function') {
      throw new Error('compute addon CollabFoldIndex is missing ' + name)
    }
    return (method as (...methodArgs: unknown[]) => unknown).call(instance, ...args)
  }
  const callString = (name: string, args: unknown[]): string => jsonStringOf('CollabFoldIndex.' + name, call(name, args))
  const callNumber = (name: string, args: unknown[]): number => {
    const value = call(name, args)
    if (typeof value !== 'number') {
      throw new Error('compute addon CollabFoldIndex.' + name + ' returned ' + typeof value + ' instead of a number')
    }
    return value
  }
  const callBytes = (name: string, args: unknown[]): Uint8Array => {
    const value = call(name, args)
    if (!(value instanceof Uint8Array)) {
      throw new Error('compute addon CollabFoldIndex.' + name + ' returned ' + typeof value + ' instead of bytes')
    }
    return value
  }
  return {
    appendBatch: (recordsJson: string) => callString('appendBatch', [recordsJson]),
    snapshot: () => callString('snapshot', []),
    deltaSince: (sinceVersion: number) => callString('deltaSince', [sinceVersion]),
    // The napi Buffer argument wraps the very same memory as the caller's Uint8Array view
    // (Buffer.from(arrayBuffer, offset, length) copies nothing), so the byte path stays one copy.
    appendRecords: (frame: Uint8Array) => callBytes('appendRecords', [Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)]),
    readDelta: (cursor: number) => callBytes('readDelta', [cursor]),
    version: () => callNumber('version', []),
    records: () => callNumber('records', []),
    checksum: () => callString('checksum', []),
  }
}

/** Render a thrown value as text for a diagnostic. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read and validate the addon's probe(), or say why the addon cannot be used. */
function nativeProbeOf(record: Record<string, unknown>, path: string, version: string): ProbeReport | string {
  const probeFunction = record['probe']
  if (typeof probeFunction !== 'function') return 'addon at ' + path + ' exports no probe()'
  let raw: unknown
  try {
    raw = (probeFunction as () => unknown)()
  } catch (error) {
    return 'addon at ' + path + ' probe() threw: ' + messageOf(error)
  }
  if (typeof raw !== 'object' || raw === null) return 'addon at ' + path + ' probe() did not return an object'
  const probe = raw as Record<string, unknown>
  if (probe['ok'] !== true) return 'addon at ' + path + ' probe() reported ok=false'
  const apiVersion = probe['nativeApiVersion']
  if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion)) {
    return 'addon at ' + path + ' probe() reported no integer nativeApiVersion'
  }
  if (apiVersion !== NATIVE_API_VERSION) {
    return 'addon at ' + path + ' speaks native API version ' + String(apiVersion) + ', host requires '
      + String(NATIVE_API_VERSION) + '; using the TypeScript reference'
  }
  const features = probe['features']
  if (!Array.isArray(features) || features.some((feature) => typeof feature !== 'string')) {
    return 'addon at ' + path + ' probe() reported no string features list'
  }
  const offered = new Set(features as string[])
  const missing = REQUIRED_NATIVE_FEATURES.filter((feature) => !offered.has(feature))
  if (missing.length > 0) {
    return 'addon at ' + path + ' is missing native features ' + missing.join(', ') + '; using the TypeScript reference'
  }
  return {
    ok: true,
    kind: 'native',
    nativeApiVersion: apiVersion,
    features: features as string[],
    version,
    detail: 'napi addon at ' + path,
  }
}

/** Validate a required `require()` result into a native binding, or say why it is unusable. */
function nativeBindingOf(value: unknown, path: string): ComputeBinding | string {
  if (typeof value !== 'object' || value === null) return 'addon at ' + path + ' exported no functions'
  const record = value as Record<string, unknown>
  const fold = functionOf(record, 'foldCollabRecords')
  const index = functionOf(record, 'indexTeamStatus')
  const versionFunction = record['nativeVersion']
  if (fold === undefined || index === undefined || typeof versionFunction !== 'function') {
    return 'addon at ' + path + ' does not export foldCollabRecords/indexTeamStatus/nativeVersion'
  }
  if (typeof record['CollabFoldIndex'] !== 'function') {
    return 'addon at ' + path + ' exports no CollabFoldIndex class'
  }
  let reported: unknown
  try {
    reported = (versionFunction as () => unknown)()
  } catch (error) {
    return 'addon at ' + path + ' nativeVersion() threw: ' + messageOf(error)
  }
  const version = typeof reported === 'string' ? reported : 'unknown'
  const probed = nativeProbeOf(record, path, version)
  if (typeof probed === 'string') return probed
  return {
    kind: 'native',
    version,
    detail: 'napi addon at ' + path,
    foldCollabRecords: (recordsJson: string) => jsonStringOf('foldCollabRecords', fold(recordsJson)),
    indexTeamStatus: (eventsJson: string) => jsonStringOf('indexTeamStatus', index(eventsJson)),
    openFoldIndex: () => nativeFoldIndexOf(record['CollabFoldIndex'], path),
    probe: () => probed,
  }
}

/** Try one addon path; return the binding, or a reason it was not used. */
function loadAddon(path: string): ComputeBinding | string {
  try {
    const require = createRequire(import.meta.url)
    const value: unknown = require(path)
    return nativeBindingOf(value, path)
  } catch (error) {
    return 'addon at ' + path + ' failed to load: ' + messageOf(error)
  }
}

/**
 * Resolve the binding the plugin should answer with.
 * @param options - native on/off and an optional explicit addon path.
 * @returns the native binding when it loads and validates, the reference otherwise.
 */
export function resolveBinding(options: BindingOptions = {}): ComputeBinding {
  if (options.native === 'off') {
    return { ...REFERENCE, detail: 'pure-TypeScript reference (native disabled by config)' }
  }
  const candidates = options.addonPath === undefined ? [ADDON_PATH] : [options.addonPath]
  const reasons: string[] = []
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      reasons.push('no addon at ' + candidate)
      continue
    }
    const loaded = loadAddon(candidate)
    if (typeof loaded !== 'string') return loaded
    reasons.push(loaded)
  }
  return { ...REFERENCE, detail: reasons.join('; ') }
}

/**
 * The published compute core: the resolved binding plus the fallback discipline.
 *
 * `kind`, `version` and `detail` describe the half answering now; after a native call failure
 * they describe the reference. `nativeCalls` and `nativeFailures` are counters a health probe
 * can read without changing behaviour.
 */
export class ComputeFacade {
  /** The pure-TypeScript reference, always available. */
  readonly reference: ComputeBinding
  private active: ComputeBinding
  /** Calls the native addon answered. */
  nativeCalls = 0
  /** Native calls that threw; the first one latched the reference. */
  nativeFailures = 0
  /** The message of the first native call failure, when there was one. */
  lastError: string | undefined = undefined

  /**
   * @param binding - the resolved binding to start with.
   */
  constructor(binding: ComputeBinding) {
    this.active = binding
    this.reference = REFERENCE
  }

  /** Which half is answering now. */
  get kind(): ComputeKind {
    return this.active.kind
  }

  /** The version of the half answering now. */
  get version(): string {
    return this.active.version
  }

  /** Where the half answering now came from. */
  get detail(): string {
    return this.active.detail
  }

  /**
   * Fold collaboration-bus control records into the summary JSON.
   * @param recordsJson - JSON array of control records, as text.
   * @returns canonical summary JSON, as text.
   */
  foldCollabRecords(recordsJson: string): string {
    return this.answer('fold', recordsJson)
  }

  /**
   * Index a team's durable event stream into the team-status JSON.
   * @param eventsJson - JSON array of team/session events, as text.
   * @returns canonical status JSON, as text.
   */
  indexTeamStatus(eventsJson: string): string {
    return this.answer('index', eventsJson)
  }

  /** Report the API version and capabilities of the half answering now. */
  probe(): ProbeReport {
    return this.active.probe()
  }

  /**
   * Report the health/ready readout for logs and probes: half, API version, implementation
   * version, pair-lock status and the fallback counters. Cheap and side-effect free.
   * @returns the health readout.
   */
  health(): ComputeHealth {
    const report = this.active.probe()
    return {
      ok: this.nativeFailures === 0,
      kind: this.active.kind,
      nativeApiVersion: report.nativeApiVersion,
      version: report.version,
      referenceVersion: REFERENCE_VERSION,
      pairLocked: this.active.kind !== 'native' || report.version === REFERENCE_VERSION,
      features: report.features,
      nativeCalls: this.nativeCalls,
      nativeFailures: this.nativeFailures,
      lastError: this.lastError ?? null,
      detail: this.active.detail,
    }
  }

  /**
   * Open a stateful incremental index on the half answering now.
   *
   * A native index keeps its state inside the addon, so a native failure inside an open index
   * cannot be replayed into the reference. The failure is surfaced (typed), the facade latches
   * the reference and counts the failure, and the caller reopens to get a reference index: the
   * already-open native index never keeps serving after a failure. The stateless calls above
   * re-answer from the reference immediately.
   */
  openFoldIndex(): FoldIndexBinding {
    if (this.active.kind === 'typescript') return this.active.openFoldIndex()
    return new LatchingFoldIndex(this, this.active.openFoldIndex())
  }

  /**
   * Latch the reference after a native call failure: counts it and stops using the addon.
   * @param errorMessage - the message of the failure, kept as the diagnostic.
   */
  latchToReference(errorMessage: string): void {
    if (this.active.kind === 'typescript') return
    this.nativeFailures += 1
    this.lastError = errorMessage
    this.active = this.reference
  }

  /** Answer one call, latching the reference when the native half fails. */
  private answer(kind: 'fold' | 'index', input: string): string {
    if (this.active.kind === 'typescript') {
      return kind === 'fold' ? this.active.foldCollabRecords(input) : this.active.indexTeamStatus(input)
    }
    try {
      const result = kind === 'fold' ? this.active.foldCollabRecords(input) : this.active.indexTeamStatus(input)
      this.nativeCalls += 1
      return result
    } catch (error) {
      this.latchToReference(error instanceof Error ? error.message : String(error))
      return kind === 'fold' ? this.reference.foldCollabRecords(input) : this.reference.indexTeamStatus(input)
    }
  }
}

/**
 * A native index whose failures latch the facade to the reference.
 *
 * The state of an already-open native index cannot be replayed into the reference, so a failure
 * is surfaced to the caller and the facade switches to the reference for everything opened
 * afterwards. Continuing to serve from the native index after a failure (or silently retrying)
 * would be exactly the silent divergence the parity domain exists to prevent.
 */
class LatchingFoldIndex implements FoldIndexBinding {
  private readonly facade: ComputeFacade
  private readonly inner: FoldIndexBinding
  private failed = false

  constructor(facade: ComputeFacade, inner: FoldIndexBinding) {
    this.facade = facade
    this.inner = inner
  }

  /** Run one index call; on failure latch the reference, mark this index unusable, rethrow. */
  private guard<T>(work: (inner: FoldIndexBinding) => T): T {
    if (this.failed) throw new Error('COMPUTE_FALLBACK: this index failed over; reopen for the reference index')
    try {
      return work(this.inner)
    } catch (error) {
      this.failed = true
      this.facade.latchToReference(messageOf(error))
      throw error
    }
  }

  appendBatch(recordsJson: string): string {
    return this.guard((inner) => inner.appendBatch(recordsJson))
  }

  snapshot(): string {
    return this.guard((inner) => inner.snapshot())
  }

  deltaSince(version: number): string {
    return this.guard((inner) => inner.deltaSince(version))
  }

  appendRecords(frame: Uint8Array): Uint8Array {
    return this.guard((inner) => inner.appendRecords(frame))
  }

  readDelta(cursor: number): Uint8Array {
    return this.guard((inner) => inner.readDelta(cursor))
  }

  version(): number {
    return this.guard((inner) => inner.version())
  }

  records(): number {
    return this.guard((inner) => inner.records())
  }

  checksum(): string {
    return this.guard((inner) => inner.checksum())
  }
}
