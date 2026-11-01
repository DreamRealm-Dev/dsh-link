/**
 * Pure TypeScript reference implementation of the two compute functions.
 *
 * This is the behaviour the Rust addon must match byte for byte (for ASCII identifiers),
 * and the fallback the host plugin uses when the addon is absent, older, or fails to load.
 * It is deliberately dependency-free: no Cordis, no kernel packages, no I/O, so it can be
 * imported directly by tests and the benchmark.
 *
 * Contract (identical to `rust/crates/dsh-compute-napi/src/{fold,team}.rs`):
 * - input is a JSON array as text; a non-array root or invalid JSON throws `COMPUTE_INPUT: ...`;
 * - every "last wins" decision compares `(seq, index)`, so re-ordering rows does not change
 *   the answer;
 * - output is a canonical JSON string with the field order the Rust structs declare;
 * - numbers are integers; missing fields are tolerated and counted, never guessed.
 *
 * The byte-batched surface ({@link CollabFoldIndex.appendRecords} / {@link CollabFoldIndex.readDelta})
 * exchanges the fixed binary layouts mirrored from `rust/crates/dsh-compute-napi/src/wire.rs`; the
 * encode/decode helpers here are the only place those layouts are interpreted on this side.
 */

import { TextDecoder, TextEncoder } from 'node:util'

/** Version of this reference implementation, reported by the binding. */
export const REFERENCE_VERSION = '0.3.0'

/** A JSON object row. */
type JsonObject = Record<string, unknown>

/** The ordering key of one row: `(seq, index)`. */
type Order = readonly [number, number]

/** One team/state declaration waiting for parent arbitration. */
interface TeamDeclaration {
  readonly parent: string | null
  readonly at: number
  readonly order: Order
}

/** One capability declaration, waiting to be applied in seq order. */
interface CapEvent {
  readonly order: Order
  /** A full declaration replaces the earlier ones; a single one adds a name. */
  readonly full: boolean
  readonly names: readonly string[]
}

/** One member's fold state. */
interface MemberAcc {
  order: Order
  state: string
  team: string | undefined
  hearts: number
  beatOrder: Order
  lastBeatSeq: number
  lastBeatAt: number
  /** Kept unsorted: a replace must be applied in seq order, not arrival order. */
  capsEvents: CapEvent[]
}

/** One task's fold state. */
interface TaskAcc {
  order: Order
  team: string | undefined
  state: string
  revision: number
  owner: string | undefined
}

/** One team's declaration history. */
interface TeamAcc {
  declarations: TeamDeclaration[]
  lead: string | null
  leadOrder: Order
}

/** One member's durable fold state in the team index. */
interface TeamMemberAcc {
  order: Order
  name: string
  phase: string
  spawnedBy: string | undefined
  declaredDepth: number | undefined
}

/** One task's durable fold state in the team index. */
interface TeamTaskAcc {
  order: Order
  teamId: string
  status: string
}

/** One session's runtime presence. */
interface PresenceAcc {
  order: Order
  running: boolean
}

/** One team's roster in the team index. */
interface TeamRosterAcc {
  members: Map<string, TeamMemberAcc>
}

/** Task counts by durable status; the wire names are camelCase, as the Rust structs declare. */
export interface TaskCounts {
  pending: number
  inProgress: number
  completed: number
  deleted: number
  unknown: number
}

/** Roster counts by computed runtime status. */
export interface StatusCounts {
  running: number
  inactive: number
  provisioning: number
  failed: number
}

/** Tree-shape facts of the collaboration team tree. */
export interface FoldTeamTree {
  roots: number
  maxDepth: number
  orphans: number
  cycles: number
  contested: number
}

/** Tree-shape facts of the runtime roster. */
export interface RosterTree {
  roots: number
  maxDepth: number
  orphanParents: number
  cycles: number
  duplicateNames: number
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn
const UNIT_SEPARATOR = '\u001f'
const ENCODER = new TextEncoder()

/** Feed UTF-8 bytes into a running FNV-1a 64-bit hash. */
function fnv1a64Update(hash: bigint, text: string): bigint {
  let running = hash
  for (const byte of ENCODER.encode(text)) {
    running = ((running ^ BigInt(byte)) * FNV_PRIME) & MASK64
  }
  return running
}

/** Render a 64-bit hash as sixteen lowercase hexadecimal digits. */
function fnv1a64Hex(hash: bigint): string {
  return hash.toString(16).padStart(16, '0')
}

/**
 * Binary layouts of the byte-batched API, mirrored from
 * `rust/crates/dsh-compute-napi/src/wire.rs` (all integers little-endian).
 *
 * append stats (32 bytes): "DSP1", u32 accepted, u32 unparsable, u32 version,
 *   u64 records, i64 lastSeq.
 * delta (32 bytes + parts): "DSD1", u32 fromVersion, u32 toVersion, u64 records,
 *   i64 lastSeq, u32 kindCount, then kindCount × { u16 kindLen, kindBytes (UTF-8),
 *   u64 count }, sorted by kind.
 */
const APPEND_STATS_MAGIC = 0x31505344 // "DSP1" read as a little-endian u32
const DELTA_MAGIC = 0x31445344 // "DSD1" read as a little-endian u32
/** Size of the append-stats buffer. */
export const APPEND_STATS_LEN = 32
/** Header size of a delta buffer, before the per-kind parts. */
export const DELTA_HEADER_LEN = 32
const DECODER = new TextDecoder()
const STRICT_DECODER = new TextDecoder('utf-8', { fatal: true })

/** The counters one byte-batched append reports. */
export interface AppendStats {
  accepted: number
  unparsable: number
  version: number
  records: number
  lastSeq: number
}

/** One kind's count inside a delta reading. */
export interface DeltaKindCount {
  kind: string
  count: number
}

/** The values one delta buffer carries. */
export interface DeltaReading {
  fromVersion: number
  toVersion: number
  records: number
  lastSeq: number
  byKind: DeltaKindCount[]
}

/** Encode the append-stats buffer returned by an append. */
function encodeAppendStats(stats: AppendStats): Uint8Array {
  const out = new Uint8Array(APPEND_STATS_LEN)
  const view = new DataView(out.buffer)
  view.setUint32(0, APPEND_STATS_MAGIC, true)
  view.setUint32(4, stats.accepted, true)
  view.setUint32(8, stats.unparsable, true)
  view.setUint32(12, stats.version, true)
  view.setBigUint64(16, BigInt(stats.records), true)
  view.setBigInt64(24, BigInt(stats.lastSeq), true)
  return out
}

/** Decode the append-stats buffer returned by `appendRecords`. */
export function decodeAppendStats(bytes: Uint8Array): AppendStats {
  if (bytes.byteLength !== APPEND_STATS_LEN) {
    throw inputError('append stats must be ' + String(APPEND_STATS_LEN) + ' bytes, got ' + String(bytes.byteLength))
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== APPEND_STATS_MAGIC) throw inputError('append stats magic mismatch')
  return {
    accepted: view.getUint32(4, true),
    unparsable: view.getUint32(8, true),
    version: view.getUint32(12, true),
    records: Number(view.getBigUint64(16, true)),
    lastSeq: Number(view.getBigInt64(24, true)),
  }
}

/** Encode one delta buffer. */
function encodeDelta(reading: DeltaReading): Uint8Array {
  const parts = reading.byKind.map(({ kind, count }) => ({ bytes: ENCODER.encode(kind), count }))
  const payload = parts.reduce((sum, part) => sum + 2 + part.bytes.byteLength + 8, 0)
  const out = new Uint8Array(DELTA_HEADER_LEN + payload)
  const view = new DataView(out.buffer)
  view.setUint32(0, DELTA_MAGIC, true)
  view.setUint32(4, reading.fromVersion, true)
  view.setUint32(8, reading.toVersion, true)
  view.setBigUint64(12, BigInt(reading.records), true)
  view.setBigInt64(20, BigInt(reading.lastSeq), true)
  view.setUint32(28, parts.length, true)
  let at = DELTA_HEADER_LEN
  for (const part of parts) {
    view.setUint16(at, part.bytes.byteLength, true)
    at += 2
    out.set(part.bytes, at)
    at += part.bytes.byteLength
    view.setBigUint64(at, BigInt(part.count), true)
    at += 8
  }
  return out
}

/** Decode the delta buffer returned by `readDelta`. */
export function decodeDelta(bytes: Uint8Array): DeltaReading {
  if (bytes.byteLength < DELTA_HEADER_LEN) throw inputError('delta buffer is shorter than its header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== DELTA_MAGIC) throw inputError('delta buffer magic mismatch')
  const fromVersion = view.getUint32(4, true)
  const toVersion = view.getUint32(8, true)
  const records = Number(view.getBigUint64(12, true))
  const lastSeq = Number(view.getBigInt64(20, true))
  const kindCount = view.getUint32(28, true)
  const byKind: DeltaKindCount[] = []
  let at = DELTA_HEADER_LEN
  for (let index = 0; index < kindCount; index += 1) {
    if (at + 2 > bytes.byteLength) throw inputError('delta buffer is truncated at a kind length')
    const length = view.getUint16(at, true)
    at += 2
    if (at + length + 8 > bytes.byteLength) throw inputError('delta buffer is truncated inside a kind')
    const kind = DECODER.decode(bytes.subarray(at, at + length))
    at += length
    const count = Number(view.getBigUint64(at, true))
    at += 8
    byKind.push({ kind, count })
  }
  if (at !== bytes.byteLength) throw inputError('delta buffer has trailing bytes')
  return { fromVersion, toVersion, records, lastSeq, byKind }
}

/** The one error class both implementations throw on unusable input. */
function inputError(detail: string): Error {
  return new Error('COMPUTE_INPUT: ' + detail)
}

/**
 * The parity input domain both implementations are defined over.
 *
 * Outside this domain Rust and JS disagree no matter what a fold does: invalid UTF-8 decodes to
 * U+FFFD in JS but fails the Rust parser, a lone surrogate escape is rejected by serde_json but
 * kept by JSON.parse, JSON.parse turns 1e400 into Infinity and silently rounds integers past
 * 2^53-1. The Rust side rejects these with COMPUTE_DOMAIN; this module must reject the same
 * inputs with the same typed error instead of folding them, or the two halves would silently
 * diverge.
 */
const MAX_SAFE_MAGNITUDE = 9007199254740991

/** A COMPUTE_DOMAIN violation: the input is outside the domain both halves are defined over. */
function domainError(detail: string): Error {
  return new Error('COMPUTE_DOMAIN: ' + detail)
}

/** Whether a thrown value is a COMPUTE_DOMAIN violation. */
function isDomainError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('COMPUTE_DOMAIN:')
}

/**
 * Scan JSON text for a surrogate escape that is not a valid high/low pair.
 *
 * JSON.parse accepts a lone surrogate and keeps it in the string; the Rust side rejects the same
 * escape. Scanning the raw text keeps the rejection identical (and independent of how either
 * parser normalises it).
 */
function hasLoneSurrogateEscape(text: string): boolean {
  let index = 0
  let inString = false
  while (index < text.length) {
    const char = text[index] as string
    if (!inString) {
      if (char === '"') inString = true
      index += 1
      continue
    }
    if (char === '"') {
      inString = false
      index += 1
      continue
    }
    if (char !== '\\') {
      index += 1
      continue
    }
    index += 1
    if (text[index] !== 'u') {
      index += 1
      continue
    }
    const code = parseInt(text.slice(index + 1, index + 5), 16)
    index += 5
    if (Number.isNaN(code)) return false
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = parseInt(text.slice(index + 2, index + 6), 16)
      const lowEscape = text[index] === '\\' && text[index + 1] === 'u'
      if (!lowEscape || Number.isNaN(low) || low < 0xdc00 || low > 0xdfff) return true
      index += 6
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

/**
 * Parse one JSON text value and validate it against the parity domain.
 * @param text - JSON text.
 * @param noun - the input's name, used in the syntax message.
 * @returns the parsed value.
 * @throws COMPUTE_DOMAIN outside the domain, COMPUTE_INPUT for invalid JSON.
 */
function parseJsonValueDomain(text: string, noun: string): unknown {
  if (hasLoneSurrogateEscape(text)) throw domainError('lone surrogate escape in JSON text')
  let parsed: unknown
  try {
    parsed = JSON.parse(text, (_key: string, value: unknown) => {
      if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE_MAGNITUDE)) {
        throw domainError('number outside the parity domain (finite, |n| <= 2^53-1): ' + String(value))
      }
      return value
    })
  } catch (error) {
    if (isDomainError(error)) throw error
    throw inputError(noun + ' must be valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  return parsed
}

/** Read the JSON text as an array inside the parity domain. */
function parseRows(text: string, noun: string): readonly unknown[] {
  const parsed = parseJsonValueDomain(text, noun)
  if (!Array.isArray(parsed)) throw inputError(noun + ' must be a JSON array')
  return parsed
}

/** Read `value` as a JSON object, or `undefined` when it is not one. */
function objectOf(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as JsonObject
}

/** A non-empty string at `key` of an object, or `undefined`. */
function objectString(object: JsonObject | undefined, key: string): string | undefined {
  if (object === undefined) return undefined
  const value = object[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** An integer at `key` of an object, or `undefined`. */
function objectInteger(object: JsonObject | undefined, key: string): number | undefined {
  if (object === undefined) return undefined
  const value = object[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** The row's integer `seq`, or `undefined`. */
function seqOf(value: unknown): number | undefined {
  return objectInteger(objectOf(value), 'seq')
}

/** The row's integer `at`, or `0`. */
function atOf(value: unknown): number {
  return objectInteger(objectOf(value), 'at') ?? 0
}

/** The ordering key of one row: `(seq, index)`. */
function orderOf(value: unknown, index: number): Order {
  return [seqOf(value) ?? 0, index]
}

/** Compare two ordering keys. */
function compareOrder(left: Order, right: Order): number {
  return left[0] - right[0] || left[1] - right[1]
}

/** Compare two strings by UTF-16 code unit, the order `Array#sort` uses. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Count one task status. */
function countTaskStatus(counts: TaskCounts, status: string): void {
  if (status === 'pending') counts.pending += 1
  else if (status === 'in_progress') counts.inProgress += 1
  else if (status === 'completed') counts.completed += 1
  else if (status === 'deleted') counts.deleted += 1
  else counts.unknown += 1
}

/** The winning parent of one team's declaration history (the collaboration bus rule). */
function winningParent(acc: TeamAcc): string | null {
  let winner: TeamDeclaration | undefined
  for (const declaration of acc.declarations) {
    if (winner === undefined) {
      winner = declaration
      continue
    }
    const candidateMoreSpecific = declaration.parent !== null && winner.parent === null
    const sameSpecificity = (declaration.parent === null) === (winner.parent === null)
    const earlier = declaration.at < winner.at
      || (declaration.at === winner.at && compareOrder(declaration.order, winner.order) < 0)
    if (candidateMoreSpecific || (sameSpecificity && earlier)) winner = declaration
  }
  return winner === undefined ? null : winner.parent
}

/** Depth of every declared team, plus the tree's shape facts. */
function resolveTeamDepths(teams: Map<string, TeamAcc>): { depths: Map<string, number>, tree: FoldTeamTree } {
  const depths = new Map<string, number>()
  let orphans = 0
  let cycles = 0
  let roots = 0
  let contested = 0
  for (const team of [...teams.keys()].sort(compareText)) {
    resolveTeamDepth(team, teams, depths, [], () => { orphans += 1 }, () => { cycles += 1 })
  }
  for (const acc of teams.values()) {
    const winner = winningParent(acc)
    if (winner === null) roots += 1
    for (const declaration of acc.declarations) {
      if (declaration.parent !== winner) contested += 1
    }
  }
  let maxDepth = 0
  for (const depth of depths.values()) maxDepth = Math.max(maxDepth, depth)
  return { depths, tree: { roots, maxDepth, orphans, cycles, contested } }
}

/** Depth of one team; an undeclared parent makes it a root and counts as an orphan. */
function resolveTeamDepth(
  team: string,
  teams: Map<string, TeamAcc>,
  depths: Map<string, number>,
  visiting: readonly string[],
  countOrphan: () => void,
  countCycle: () => void,
): number {
  const known = depths.get(team)
  if (known !== undefined) return known
  if (visiting.includes(team)) {
    countCycle()
    return 0
  }
  const acc = teams.get(team)
  const parent = acc === undefined ? null : winningParent(acc)
  if (parent === null) {
    depths.set(team, 0)
    return 0
  }
  if (!teams.has(parent)) {
    countOrphan()
    depths.set(team, 0)
    return 0
  }
  const parentDepth = resolveTeamDepth(parent, teams, depths, [...visiting, team], countOrphan, countCycle)
  const depth = parentDepth + 1
  depths.set(team, depth)
  return depth
}

/** Read a message's UTF-8 byte length, or `0` when it carries no text. */
function messageBytes(payload: JsonObject | undefined): number {
  const text = objectString(payload, 'text') ?? objectString(payload, 'message')
  return text === undefined ? 0 : ENCODER.encode(text).length
}

/** Apply one member's capability declarations in seq order, and return the sorted set. */
function foldedCaps(events: readonly CapEvent[]): string[] {
  const sorted = [...events].sort((left, right) => compareOrder(left.order, right.order))
  const caps = new Set<string>()
  for (const event of sorted) {
    if (event.full) {
      caps.clear()
      for (const name of event.names) caps.add(name)
    } else {
      for (const name of event.names) caps.add(name)
    }
  }
  return [...caps].sort(compareText)
}

/**
 * The mutable fold state behind the one-shot function and the incremental index.
 *
 * One instance owns every accumulator; {@link FoldState.appendBatch} adds one parsed JSON array and
 * {@link FoldState.summaryJson} materialises the summary. Appending is O(rows in the batch) and does
 * not touch the summary; materialising is O(total rows) and allocates the output rows.
 */
class FoldState {
  byKind = new Map<string, number>()
  members = new Map<string, MemberAcc>()
  tasks = new Map<string, TaskAcc>()
  teams = new Map<string, TeamAcc>()
  messageCount = 0
  messageByteCount = 0
  records = 0
  malformedRows = 0
  lastSeq = 0
  checksum = 0n
  nextIndex = 0

  /** Parse one JSON array of records and fold it into this state. */
  appendBatch(recordsJson: string): void {
    const rows = parseRows(recordsJson, 'records')
    for (const value of rows) this.appendRow(value)
  }

  /**
   * Parse a newline-delimited JSON batch (the collaboration log's on-disk form) and fold every
   * parseable line.
   *
   * A damaged line is counted, not fatal: a tail reader may hand over the last, partially written
   * line of a log and still fold the rest of the batch. A line that parses to a non-object is
   * folded like the corresponding array element (it becomes a malformed row).
   */
  appendNdjson(bytes: Uint8Array): { accepted: number; unparsable: number } {
    // Decode the whole frame strictly first: a JS decoder would replace invalid bytes with
    // U+FFFD and fold a record the Rust half refuses. Domain violations abort the batch before
    // any row is folded, matching the Rust side's atomicity.
    let text: string
    try {
      text = STRICT_DECODER.decode(bytes)
    } catch {
      throw domainError('invalid UTF-8 in NDJSON batch')
    }
    if (text.startsWith('\ufeff')) text = text.slice(1)
    const lines = text.split('\n')
    const values: unknown[] = []
    let unparsable = 0
    for (const rawLine of lines) {
      const line = rawLine.replace(/^[ \t\r\v\f]+|[ \t\r\v\f]+$/g, '')
      if (line === '') continue
      let value: unknown
      try {
        value = parseJsonValueDomain(line, 'records')
      } catch (error) {
        if (isDomainError(error)) throw error
        // A damaged line is counted in the append stats and skipped: the caller decides whether a
        // batch with unparsable lines is worth keeping (a tray tail can hand over a partial line).
        unparsable += 1
        continue
      }
      values.push(value)
    }
    for (const value of values) this.appendRow(value)
    return { accepted: values.length, unparsable }
  }

  /** Fold one already-parsed row. */
  private appendRow(value: unknown): void {
    const index = this.nextIndex
    this.nextIndex += 1
    const order = orderOf(value, index)
    this.records += 1
    const row = objectOf(value)
    const kind = objectString(row, 'kind')
    const subject = objectString(row, 'subject') ?? ''
    this.checksum = (this.checksum + fnv1a64Update(FNV_OFFSET, String(order[0]) + UNIT_SEPARATOR + (kind ?? '') + UNIT_SEPARATOR + subject + '\n')) & MASK64
    const seq = seqOf(value)
    if (seq !== undefined) this.lastSeq = Math.max(this.lastSeq, seq)
    if (row === undefined || kind === undefined) {
      this.malformedRows += 1
      return
    }
    this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + 1)
    const payload = objectOf(row['payload'])

    if (kind === 'member/state') {
      const id = objectString(payload, 'id') ?? objectString(row, 'subject') ?? objectString(row, 'actor')
      if (id === undefined) {
        this.malformedRows += 1
        return
      }
      const entry = memberEntry(this.members, id)
      if (compareOrder(order, entry.order) >= 0) {
        entry.order = order
        entry.state = objectString(payload, 'state') ?? objectString(payload, 'status') ?? 'unknown'
        entry.team = objectString(payload, 'team')
      }
      return
    }
    if (kind === 'member/heartbeat') {
      const id = objectString(payload, 'id') ?? objectString(row, 'subject')
      if (id === undefined) {
        this.malformedRows += 1
        return
      }
      const entry = memberEntry(this.members, id)
      entry.hearts += 1
      if (compareOrder(order, entry.beatOrder) >= 0) {
        entry.beatOrder = order
        entry.lastBeatSeq = order[0]
        entry.lastBeatAt = objectInteger(payload, 'at') ?? atOf(value)
      }
      return
    }
    if (kind === 'capability/state') {
      const id = objectString(payload, 'id') ?? objectString(row, 'subject')
      const listed = payload === undefined ? undefined : payload['capabilities']
      const full = Array.isArray(listed) ? listed : undefined
      const single = objectString(payload, 'capability')
      if (id === undefined || (full === undefined && single === undefined)) {
        this.malformedRows += 1
        return
      }
      const entry = memberEntry(this.members, id)
      if (full !== undefined) {
        entry.capsEvents.push({ order, full: true, names: full.filter((name): name is string => typeof name === 'string' && name !== '') })
      } else if (single !== undefined) {
        entry.capsEvents.push({ order, full: false, names: [single] })
      }
      return
    }
    if (kind === 'task/state') {
      const id = objectString(payload, 'id') ?? objectString(payload, 'task') ?? objectString(row, 'subject')
      if (id === undefined) {
        this.malformedRows += 1
        return
      }
      let entry = this.tasks.get(id)
      if (entry === undefined) {
        entry = { order, team: undefined, state: '', revision: 0, owner: undefined }
        this.tasks.set(id, entry)
      }
      if (compareOrder(order, entry.order) >= 0) {
        entry.order = order
        entry.team = objectString(payload, 'team')
        entry.state = objectString(payload, 'state') ?? objectString(payload, 'status') ?? 'unknown'
        entry.revision = objectInteger(payload, 'revision') ?? 0
        entry.owner = objectString(payload, 'owner') ?? objectString(payload, 'ownerId')
      }
      return
    }
    if (kind === 'team/state') {
      const team = objectString(payload, 'team') ?? objectString(row, 'subject')
      if (team === undefined) {
        this.malformedRows += 1
        return
      }
      let entry = this.teams.get(team)
      if (entry === undefined) {
        entry = { declarations: [], lead: null, leadOrder: [0, 0] }
        this.teams.set(team, entry)
      }
      entry.declarations.push({ parent: objectString(payload, 'parent') ?? null, at: atOf(value), order })
      const lead = objectString(payload, 'lead')
      if (lead !== undefined && compareOrder(order, entry.leadOrder) >= 0) {
        entry.leadOrder = order
        entry.lead = lead
      }
      return
    }
    if (kind === 'team.message') {
      this.messageCount += 1
      this.messageByteCount += messageBytes(payload)
    }
  }

  /** Counts by kind folded so far, as a snapshot a caller can diff across an append. */
  kindCounts(): Map<string, number> {
    return new Map(this.byKind)
  }

  /** Materialise the summary of everything folded so far. */
  summaryJson(): string {
    const teamMemberCounts = new Map<string, number>()
    for (const member of this.members.values()) {
      if (member.team === undefined) continue
      teamMemberCounts.set(member.team, (teamMemberCounts.get(member.team) ?? 0) + 1)
    }
    const teamTaskCounts = new Map<string, number>()
    for (const task of this.tasks.values()) {
      if (task.team === undefined) continue
      teamTaskCounts.set(task.team, (teamTaskCounts.get(task.team) ?? 0) + 1)
    }
    const { depths, tree } = resolveTeamDepths(this.teams)

    const byKindRows = [...this.byKind.keys()].sort(compareText).map((kind) => ({ kind, count: this.byKind.get(kind) ?? 0 }))
    const memberRows = [...this.members.keys()].sort(compareText).map((id) => {
      const acc = this.members.get(id)
      if (acc === undefined) throw new Error('unreachable: member vanished during the fold')
      return {
        id,
        team: acc.team ?? null,
        state: acc.state,
        hearts: acc.hearts,
        lastBeatSeq: acc.lastBeatSeq,
        lastBeatAt: acc.lastBeatAt,
        caps: foldedCaps(acc.capsEvents),
      }
    })
    const taskRows = [...this.tasks.keys()].sort(compareText).map((id) => {
      const acc = this.tasks.get(id)
      if (acc === undefined) throw new Error('unreachable: task vanished during the fold')
      return {
        id,
        team: acc.team ?? null,
        state: acc.state,
        revision: acc.revision,
        owner: acc.owner ?? null,
      }
    })
    const teamRows = [...this.teams.keys()].sort(compareText).map((team) => {
      const acc = this.teams.get(team)
      if (acc === undefined) throw new Error('unreachable: team vanished during the fold')
      return {
        team,
        parent: winningParent(acc),
        lead: acc.lead,
        members: teamMemberCounts.get(team) ?? 0,
        tasks: teamTaskCounts.get(team) ?? 0,
        depth: depths.get(team) ?? 0,
      }
    })
    const summary = {
      ok: true,
      records: this.records,
      malformedRows: this.malformedRows,
      lastSeq: this.lastSeq,
      byKind: byKindRows,
      members: memberRows,
      tasks: taskRows,
      teams: teamRows,
      messages: { count: this.messageCount, bytes: this.messageByteCount },
      teamTree: tree,
      checksum: fnv1a64Hex(this.checksum),
    }
    return JSON.stringify(summary)
  }
}

/**
 * Fold collaboration-bus control records into the summary JSON (the one-shot surface).
 * @param recordsJson - JSON array of control records, as text.
 * @returns canonical summary JSON, as text.
 */
export function foldCollabRecords(recordsJson: string): string {
  const state = new FoldState()
  state.appendBatch(recordsJson)
  return state.summaryJson()
}

/** One batch's contribution, kept so {@link CollabFoldIndex.deltaSince} needs no re-fold. */
interface BatchDelta {
  readonly version: number
  readonly records: number
  readonly byKind: ReadonlyArray<readonly [string, number]>
}

/**
 * A stateful, append-only index over collaboration-bus control records.
 *
 * The one-shot `foldCollabRecords` re-parses and re-folds the whole ledger on every call. This
 * class keeps the fold state instead: `appendBatch` parses and folds only the new records, and
 * `snapshot`/`deltaSince` materialise the answer a caller asks for.
 *
 * The snapshot is byte-identical to `foldCollabRecords` over the concatenation of every batch
 * appended so far, and matches the Rust `CollabFoldIndex` byte for byte.
 */
export class CollabFoldIndex {
  private readonly state = new FoldState()
  private readonly batches: BatchDelta[] = []
  private currentVersion = 0

  /** Fold one JSON array of records into the index; returns `{accepted, records, lastSeq, version}`. */
  appendBatch(recordsJson: string): string {
    const recordsBefore = this.state.records
    const kindsBefore = this.state.kindCounts()
    this.state.appendBatch(recordsJson)
    const result = this.recordBatch(recordsBefore, kindsBefore)
    return JSON.stringify({ accepted: result.accepted, records: result.records, lastSeq: result.lastSeq, version: result.version })
  }

  /**
   * Fold one newline-delimited JSON batch into the index; returns the 32-byte append-stats buffer.
   *
   * This is the byte-batched append: the caller hands over the ledger's own bytes and nothing is
   * re-serialised as a JSON array. `unparsable` in the stats counts damaged lines that were
   * skipped, never fatal.
   */
  appendRecords(frame: Uint8Array): Uint8Array {
    const recordsBefore = this.state.records
    const kindsBefore = this.state.kindCounts()
    const { unparsable } = this.state.appendNdjson(frame)
    const result = this.recordBatch(recordsBefore, kindsBefore)
    return encodeAppendStats({
      accepted: result.accepted,
      unparsable,
      version: result.version,
      records: result.records,
      lastSeq: result.lastSeq,
    })
  }

  /** Materialise the summary of everything appended so far. */
  snapshot(): string {
    return this.state.summaryJson()
  }

  /** The records and kinds added after `sinceVersion`; 0 asks for everything. */
  deltaSince(sinceVersion: number): string {
    const totals = this.deltaTotals(sinceVersion)
    const delta = {
      fromVersion: sinceVersion,
      toVersion: this.currentVersion,
      records: totals.records,
      lastSeq: this.state.lastSeq,
      byKind: totals.byKind.map(([kind, count]) => ({ kind, count })),
    }
    return JSON.stringify(delta)
  }

  /** The records and kinds added after `cursor`; returns the delta buffer. */
  readDelta(cursor: number): Uint8Array {
    const totals = this.deltaTotals(cursor)
    return encodeDelta({
      fromVersion: cursor,
      toVersion: this.currentVersion,
      records: totals.records,
      lastSeq: this.state.lastSeq,
      byKind: totals.byKind.map(([kind, count]) => ({ kind, count })),
    })
  }

  /** The current version; incremented once per append call. */
  version(): number {
    return this.currentVersion
  }

  /** How many rows the index folded so far. */
  records(): number {
    return this.state.records
  }

  /** The commutative fingerprint of everything appended so far. */
  checksum(): string {
    return fnv1a64Hex(this.state.checksum)
  }

  /** Book-keeping for one append, shared by the string and byte forms. */
  private recordBatch(recordsBefore: number, kindsBefore: Map<string, number>): {
    accepted: number
    records: number
    lastSeq: number
    version: number
  } {
    const kindsAfter = this.state.kindCounts()
    const accepted = this.state.records - recordsBefore
    const byKind: Array<[string, number]> = []
    for (const kind of [...kindsAfter.keys()].sort(compareText)) {
      const after = kindsAfter.get(kind) ?? 0
      const before = kindsBefore.get(kind) ?? 0
      if (after > before) byKind.push([kind, after - before])
    }
    this.currentVersion += 1
    this.batches.push({ version: this.currentVersion, records: accepted, byKind })
    return { accepted, records: this.state.records, lastSeq: this.state.lastSeq, version: this.currentVersion }
  }

  /** Aggregate every batch after `sinceVersion`, kinds in sorted order. */
  private deltaTotals(sinceVersion: number): { records: number; byKind: Array<[string, number]> } {
    let records = 0
    const byKind = new Map<string, number>()
    for (const batch of this.batches) {
      if (batch.version <= sinceVersion) continue
      records += batch.records
      for (const [kind, count] of batch.byKind) byKind.set(kind, (byKind.get(kind) ?? 0) + count)
    }
    const sorted: Array<[string, number]> = [...byKind.keys()].sort(compareText).map((kind) => [kind, byKind.get(kind) ?? 0])
    return { records, byKind: sorted }
  }
}

/** Get or create one member's fold state. */
function memberEntry(members: Map<string, MemberAcc>, id: string): MemberAcc {
  let entry = members.get(id)
  if (entry === undefined) {
    entry = {
      order: [0, 0],
      state: '',
      team: undefined,
      hearts: 0,
      beatOrder: [0, 0],
      lastBeatSeq: 0,
      lastBeatAt: 0,
      capsEvents: [],
    }
    members.set(id, entry)
  }
  return entry
}

/** Fold one presence reading: the highest order wins. */
function foldPresence(presence: Map<string, PresenceAcc>, sessionId: string, running: boolean, order: Order): void {
  let entry = presence.get(sessionId)
  if (entry === undefined) {
    entry = { order, running }
    presence.set(sessionId, entry)
    return
  }
  if (compareOrder(order, entry.order) >= 0) {
    entry.order = order
    entry.running = running
  }
}

/** Depth of one roster member, derived from the `spawnedBy` chain when not declared. */
function deriveDepth(
  id: string,
  parentOf: Map<string, string | null>,
  depths: Map<string, number>,
  countCycle: () => void,
): number {
  const known = depths.get(id)
  if (known !== undefined) return known
  const path: string[] = []
  let current = id
  for (;;) {
    const memo = depths.get(current)
    if (memo !== undefined) {
      let depth = memo
      for (const node of [...path].reverse()) {
        depth += 1
        depths.set(node, depth)
      }
      return depths.get(id) ?? 0
    }
    if (path.includes(current)) {
      countCycle()
      for (const node of path) if (!depths.has(node)) depths.set(node, 0)
      if (!depths.has(current)) depths.set(current, 0)
      return depths.get(id) ?? 0
    }
    path.push(current)
    const parent = parentOf.get(current) ?? null
    if (parent === null) {
      let depth = 0
      for (const node of [...path].reverse()) {
        depths.set(node, depth)
        depth += 1
      }
      return depths.get(id) ?? 0
    }
    current = parent
  }
}

/**
 * Index a team's durable event stream into the team-status JSON.
 * @param eventsJson - JSON array of team/session events, as text.
 * @returns canonical status JSON, as text.
 */
export function indexTeamStatus(eventsJson: string): string {
  const events = parseRows(eventsJson, 'events')
  const teams = new Map<string, TeamRosterAcc>()
  const tasks = new Map<string, TeamTaskAcc>()
  const presence = new Map<string, PresenceAcc>()
  let unknownEvents = 0
  let malformedEvents = 0
  let lastSeq = 0
  let checksum = 0n

  events.forEach((value, index) => {
    const order = orderOf(value, index)
    const row = objectOf(value)
    const eventType = objectString(row, 'type') ?? objectString(row, 'kind')
    const subject = objectString(row, 'subject') ?? ''
    checksum = (checksum + fnv1a64Update(FNV_OFFSET, String(order[0]) + UNIT_SEPARATOR + (eventType ?? '') + UNIT_SEPARATOR + subject + '\n')) & MASK64
    const seq = seqOf(value)
    if (seq !== undefined) lastSeq = Math.max(lastSeq, seq)
    if (row === undefined || eventType === undefined) {
      unknownEvents += 1
      return
    }
    const payload = objectOf(row['payload'])

    if (eventType === 'team/member') {
      const member = payload === undefined ? undefined : objectOf(payload['member'])
      const teamId = objectString(payload, 'teamId')
      const id = objectString(member, 'id')
      if (teamId === undefined || id === undefined) {
        malformedEvents += 1
        return
      }
      const name = objectString(member, 'name') ?? id
      const phase = objectString(member, 'phase') ?? 'active'
      const spawnedBy = objectString(member, 'spawnedBy')
      const declaredDepth = objectInteger(member, 'depth')
      let team = teams.get(teamId)
      if (team === undefined) {
        team = { members: new Map<string, TeamMemberAcc>() }
        teams.set(teamId, team)
      }
      let memberAcc = team.members.get(id)
      if (memberAcc === undefined) {
        memberAcc = { order, name, phase, spawnedBy, declaredDepth }
        team.members.set(id, memberAcc)
      } else if (compareOrder(order, memberAcc.order) >= 0) {
        memberAcc.order = order
        memberAcc.name = name
        memberAcc.phase = phase
        memberAcc.spawnedBy = spawnedBy
        memberAcc.declaredDepth = declaredDepth
      }
      return
    }
    if (eventType === 'team/task') {
      const task = payload === undefined ? undefined : objectOf(payload['task'])
      const teamId = objectString(payload, 'teamId')
      const id = objectString(task, 'id')
      const status = objectString(task, 'status')
      if (teamId === undefined || id === undefined || status === undefined) {
        malformedEvents += 1
        return
      }
      // The same task id under two teams is two tasks: the durable board is per team.
      const key = teamId + UNIT_SEPARATOR + id
      let taskAcc = tasks.get(key)
      if (taskAcc === undefined) {
        taskAcc = { order, teamId, status }
        tasks.set(key, taskAcc)
      } else if (compareOrder(order, taskAcc.order) >= 0) {
        taskAcc.order = order
        taskAcc.teamId = teamId
        taskAcc.status = status
      }
      return
    }
    if (eventType === 'session/presence') {
      const sessionId = objectString(payload, 'sessionId')
      const runningValue = payload === undefined ? undefined : payload['running']
      const running = typeof runningValue === 'boolean' ? runningValue : undefined
      if (sessionId === undefined || running === undefined) {
        malformedEvents += 1
        return
      }
      foldPresence(presence, sessionId, running, order)
      return
    }
    if (eventType === 'session/started') {
      const sessionId = objectString(payload, 'sessionId')
      if (sessionId === undefined) {
        malformedEvents += 1
        return
      }
      foldPresence(presence, sessionId, true, order)
      return
    }
    if (eventType === 'session/ended') {
      const sessionId = objectString(payload, 'sessionId')
      if (sessionId === undefined) {
        malformedEvents += 1
        return
      }
      foldPresence(presence, sessionId, false, order)
      return
    }
    unknownEvents += 1
  })

  const teamTaskCounts = new Map<string, TaskCounts>()
  const tasksTotal: TaskCounts = { pending: 0, inProgress: 0, completed: 0, deleted: 0, unknown: 0 }
  for (const task of tasks.values()) {
    let counts = teamTaskCounts.get(task.teamId)
    if (counts === undefined) {
      counts = { pending: 0, inProgress: 0, completed: 0, deleted: 0, unknown: 0 }
      teamTaskCounts.set(task.teamId, counts)
    }
    countTaskStatus(counts, task.status)
    countTaskStatus(tasksTotal, task.status)
  }

  const statusCounts: StatusCounts = { running: 0, inactive: 0, provisioning: 0, failed: 0 }
  const tree: RosterTree = { roots: 0, maxDepth: 0, orphanParents: 0, cycles: 0, duplicateNames: 0 }
  const memberRows: ReturnType<typeof buildMemberRow>[] = []
  const teamRows: ReturnType<typeof buildTeamRow>[] = []

  for (const teamId of [...teams.keys()].sort(compareText)) {
    const roster = teams.get(teamId)
    if (roster === undefined) continue
    const nameToId = new Map<string, string>()
    for (const id of [...roster.members.keys()].sort(compareText)) {
      const member = roster.members.get(id)
      if (member === undefined) continue
      if (nameToId.has(member.name)) tree.duplicateNames += 1
      else nameToId.set(member.name, id)
    }
    const parentOf = new Map<string, string | null>()
    let orphansHere = 0
    for (const [id, member] of roster.members) {
      const parentId = member.spawnedBy === undefined ? undefined : nameToId.get(member.spawnedBy)
      if (member.spawnedBy !== undefined && parentId === undefined) orphansHere += 1
      parentOf.set(id, parentId ?? null)
    }
    tree.orphanParents += orphansHere
    const depths = new Map<string, number>()
    for (const [id, member] of roster.members) {
      if (member.declaredDepth !== undefined) depths.set(id, member.declaredDepth)
    }
    const children = new Map<string, number>()
    // Two passes: every child must be counted before any row reports its children count.
    for (const id of roster.members.keys()) {
      deriveDepth(id, parentOf, depths, () => { tree.cycles += 1 })
      const parentId = parentOf.get(id) ?? null
      if (parentId !== null) children.set(parentId, (children.get(parentId) ?? 0) + 1)
    }
    for (const id of roster.members.keys()) {
      const member = roster.members.get(id)
      if (member === undefined) continue
      const depth = depths.get(id) ?? 0
      const parentId = parentOf.get(id) ?? null
      const running = presence.get(id)?.running ?? false
      const status = member.phase === 'failed'
        ? 'failed'
        : member.phase === 'provisioning'
          ? 'provisioning'
          : running
            ? 'running'
            : 'inactive'
      if (status === 'running') statusCounts.running += 1
      else if (status === 'provisioning') statusCounts.provisioning += 1
      else if (status === 'failed') statusCounts.failed += 1
      else statusCounts.inactive += 1
      memberRows.push(buildMemberRow(id, member, teamId, status, depth, parentId, children.get(id) ?? 0, running))
    }
    let maxDepth = 0
    for (const depth of depths.values()) maxDepth = Math.max(maxDepth, depth)
    let runningCount = 0
    for (const id of roster.members.keys()) {
      if (presence.get(id)?.running === true) runningCount += 1
    }
    teamRows.push(buildTeamRow(teamId, roster.members.size, maxDepth, runningCount, orphansHere, teamTaskCounts.get(teamId)))
  }

  memberRows.sort((left, right) => compareText(left.teamId, right.teamId)
    || left.depth - right.depth
    || compareText(left.name, right.name)
    || compareText(left.id, right.id))
  for (const member of memberRows) {
    if (member.spawnedBy === null) tree.roots += 1
    tree.maxDepth = Math.max(tree.maxDepth, member.depth)
  }

  const state = {
    ok: true,
    events: events.length,
    unknownEvents,
    malformedEvents,
    lastSeq,
    teams: teamRows,
    members: memberRows,
    tree,
    tasks: tasksTotal,
    statusCounts,
    checksum: fnv1a64Hex(checksum),
  }
  return JSON.stringify(state)
}

/** Build one roster row. */
function buildMemberRow(
  id: string,
  member: TeamMemberAcc,
  teamId: string,
  status: string,
  depth: number,
  parentId: string | null,
  children: number,
  running: boolean,
): {
  id: string
  name: string
  teamId: string
  role: string
  phase: string
  status: string
  depth: number
  spawnedBy: string | null
  parentId: string | null
  children: number
  running: boolean
} {
  return {
    id,
    name: member.name,
    teamId,
    role: member.spawnedBy === undefined ? 'lead' : 'teammate',
    phase: member.phase,
    status,
    depth,
    spawnedBy: member.spawnedBy ?? null,
    parentId,
    children,
    running,
  }
}

/** Build one team row. */
function buildTeamRow(
  teamId: string,
  members: number,
  maxDepth: number,
  running: number,
  orphans: number,
  tasks: TaskCounts | undefined,
): { teamId: string, members: number, maxDepth: number, running: number, orphans: number, tasks: TaskCounts } {
  return {
    teamId,
    members,
    maxDepth,
    running,
    orphans,
    tasks: tasks ?? { pending: 0, inProgress: 0, completed: 0, deleted: 0, unknown: 0 },
  }
}