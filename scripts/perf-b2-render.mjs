#!/usr/bin/env node
/**
 * R492 B2 rendering baseline: what the client event window costs while a session's live tail grows.
 *
 * The instrument answers three questions the R493/R495 designs need from the other side:
 *
 *   1. How big is the real problem? It reads the kernel's own session logs (read-only) and reports
 *      the actual event/message/byte distribution of the 77 sessions on this machine, including the
 *      one the running shell currently shows.
 *   2. What does the current implementation cost? The client keeps its whole live tail in memory
 *      (packages/api/session-controller: events.open(500-message page), then every append is kept and
 *      every publish materializes the entire window). The model below is a faithful port of that
 *      window (leaf/concat/materialize) fed with real parsed session events.
 *   3. What would the two candidate fixes cost? A 500-entry ring and a paged window (500-message page
 *      plus a 500-entry tail ring) are measured through the same model and the same DOM calibration,
 *      so current / ring500 / paged differ only by window policy.
 *
 * Live DOM calibration (optional, --live) reads the running shell over CDP: it counts real
 * conversation nodes and rows, then times deep clones of real row shapes to price one rendered row.
 * It never types, scrolls, clicks, or reloads; the window is currently 158x26 px with a 0 px-tall
 * conversation scroller, so frame/scroll latency is reported as NOT MEASURED instead of faked.
 *
 *   node scripts/perf-b2-render.mjs --sizes=10000,50000,100000 --live --out=.tmp/R492-b2.json
 *   node scripts/perf-b2-render.mjs --live=off            # model only, no CDP
 *   node scripts/perf-b2-render.mjs --sessions-only       # just the real session-scale inventory
 *
 * Exit codes: 0 = measured (live part skipped with a documented reason if CDP is unavailable),
 * 1 = the instrument's own premise failed (kernel home unreadable, session log corrupt, model
 * self-check mismatch).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { cpus, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize as v8Serialize } from 'node:v8'
import { zstdDecompressSync } from 'node:zlib'
import { countObjects, jsonBytes, printTable, round, trackScenario } from './perf-instrument.mjs'

/* ------------------------------------------------------------------ paths and arguments */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PATHS = {
  collabLib: join(REPO, 'plugins', 'dsh-link-collab', 'lib', 'index.js'),
  teamsLib: join(REPO, 'plugins', 'dsh-link-teams', 'lib', 'index.js'),
  chatWindow: join(REPO, 'plugins', 'dsh-link-chat-window'),
  kernelRepo: join(REPO, 'core', 'deepseek-harness'),
  scratch: join(REPO, '.tmp'),
}

const argv = process.argv.slice(2)
const options = {
  sizes: [10000, 50000, 100000],
  live: null,                       // null = auto (try CDP, degrade with a reason)
  json: false,
  out: null,
  kernelHome: null,
  pageMessages: 500,                // HISTORY_PAGE_OPTIONS.maxMessages
  tailCap: 500,                     // proposed live-tail ring
  sessionsOnly: false,
  r495: true,
  stamp: false,
  port: 9222,
}
for (const arg of argv) {
  const at = arg.indexOf('=')
  if (!arg.startsWith('--') || at < 0) {
    if (arg === '--json') options.json = true
    else if (arg === '--sessions-only') options.sessionsOnly = true
    else if (arg === '--no-r495') options.r495 = false
    else if (arg === '--no-live') options.live = false
    else if (arg === '--stamp') options.stamp = true
    else if (arg === '--help' || arg === '-h') options.json = false
    continue
  }
  const name = arg.slice(2, at)
  const value = arg.slice(at + 1)
  if (name === 'sizes') options.sizes = value.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
  else if (name === 'live') options.live = value !== 'off'
  else if (name === 'out') options.out = resolve(REPO, value)
  else if (name === 'kernel-home') options.kernelHome = resolve(value)
  else if (name === 'page-messages') options.pageMessages = Math.max(1, Number(value) | 0)
  else if (name === 'tail-cap') options.tailCap = Math.max(1, Number(value) | 0)
  else if (name === 'r495') options.r495 = value !== 'off'
  else if (name === 'port') options.port = Number(value) | 0
}
if (options.json === true) options.live = false
const HEADS_UP = options.json !== true
const startedAt = Date.now()

function fail(message) {
  console.error('FAIL: ' + message)
  process.exit(1)
}

/**
 * Timestamped output path, so a re-run never overwrites the archive a document cites.
 * --stamp turns .tmp/R492-b2.json into .tmp/R492-b2-20261027T133744.json (UTC).
 */
function stampedPath(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dot = file.lastIndexOf('.')
  return dot < 0 ? file + '-' + stamp : file.slice(0, dot) + '-' + stamp + file.slice(dot)
}
const OUTPUT_FILE = options.out === null ? null : (options.stamp ? stampedPath(options.out) : options.out)
function logSection(title) { console.log('\n== ' + title + ' ==') }
function mb(bytes) { return round(bytes / (1024 * 1024), 2) }
function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex') }
function statInfo(file) {
  if (!existsSync(file)) return null
  const stat = statSync(file)
  return { file, bytes: stat.size, mtimeMs: stat.mtimeMs }
}

/* ------------------------------------------------------------------ kernel home and session logs */

/** Locate the running kernel's home: --kernel-home, DSH_LINK_KERNEL_HOME, then the LINK default. */
function resolveKernelHome() {
  const candidates = []
  if (options.kernelHome !== null) candidates.push(options.kernelHome)
  if (typeof process.env.DSH_LINK_KERNEL_HOME === 'string' && process.env.DSH_LINK_KERNEL_HOME !== '') candidates.push(process.env.DSH_LINK_KERNEL_HOME)
  if (typeof process.env.APPDATA === 'string') candidates.push(join(process.env.APPDATA, 'dev.dshlink.client', 'dsh-link', 'kernel-home'))
  for (const candidate of candidates) if (existsSync(join(candidate, 'sessions'))) return candidate
  return null
}

// A session log is a concatenation of Zstandard frames (RFC 8878), one per append batch; each frame
// is located from its own header so the file can be read without a session API.
const ZSTD_MAGIC = 0xFD2FB528
const DICT_ID_SIZES = [0, 1, 2, 4]
const FCS_SIZES = [0, 1, 2, 4, 8]
const SIZE_FIELDS = [0, 1, 2, 4]

/** Byte length of one structurally complete Zstandard frame at offset, or -1 when torn. */
function frameSize(buffer, offset) {
  if (buffer.length - offset < 4) return -1
  if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('invalid Zstandard frame magic at byte ' + String(offset))
  let cursor = offset + 4
  const descriptor = buffer[cursor]
  cursor += 1
  const fcsFlag = descriptor >> 6
  const singleSegment = (descriptor >> 5) & 1
  const checksum = (descriptor >> 2) & 1
  const dictIdFlag = descriptor & 3
  if (singleSegment === 0) cursor += 1
  cursor += DICT_ID_SIZES[dictIdFlag]
  cursor += singleSegment === 1 && fcsFlag === 0 ? 1 : FCS_SIZES[fcsFlag]
  for (;;) {
    if (buffer.length - cursor < 3) return -1
    const header = buffer.readUIntLE(cursor, 3)
    cursor += 3
    const last = header & 1
    const type = (header >> 1) & 3
    const size = header >>> 3
    if (type === 0) cursor += size
    else if (type === 1) cursor += 1
    else if (type === 2) cursor += size
    else throw new Error('reserved Zstandard block type at byte ' + String(cursor))
    if (last === 1) break
  }
  if (checksum === 1) cursor += 4
  return cursor - offset
}

/** List every session log under the kernel home, largest first. */
function inventorySessionLogs(kernelHome) {
  const root = join(kernelHome, 'sessions')
  const sessions = []
  for (const group of readdirSync(root)) {
    for (const session of readdirSync(join(root, group))) {
      const file = join(root, group, session, 'session.v4.jsonl.zstd')
      try {
        sessions.push({ group, session, file, compressed: statSync(file).size })
      } catch (error) { void error }
    }
  }
  sessions.sort((left, right) => right.compressed - left.compressed)
  return sessions
}

/**
 * Scan one session log: event count, type histogram, decompressed bytes, frames.
 *
 * @param file - session.v4.jsonl.zstd.
 * @param options.collect - how many parsed event objects to keep as the model sample.
 * @returns counts plus up to collect parsed events, without ever holding the whole log decoded.
 */
function scanSessionLog(file, options = {}) {
  const collect = options.collect ?? 0
  const tailLimit = options.tail ?? 0
  const buffer = readFileSync(file)
  let offset = 0
  let frames = 0
  let decompressed = 0
  let events = 0
  let partial = ''
  const histogram = {}
  const samples = []
  const tailLines = []
  const countLine = (line, byteLength) => {
    if (line === '') return
    events += 1
    const match = /"type":"([^"]+)"/.exec(line)
    const type = match === null ? 'unparsed' : match[1]
    histogram[type] = (histogram[type] || 0) + 1
    if (samples.length < collect && line.length < 2_000_000) {
      try {
        const parsed = JSON.parse(line)
        samples.push({ event: parsed, bytes: byteLength })
      } catch (error) { void error }
    }
    if (tailLimit > 0 && line.length < 2_000_000) {
      tailLines.push({ line, bytes: byteLength })
      if (tailLines.length > tailLimit) tailLines.shift()
    }
  }
  while (offset < buffer.length) {
    const size = frameSize(buffer, offset)
    if (size <= 0) break
    const decoded = zstdDecompressSync(buffer.subarray(offset, offset + size))
    frames += 1
    decompressed += decoded.length
    const text = partial + decoded.toString('utf8')
    const parts = text.split('\n')
    partial = parts.pop() ?? ''
    for (const line of parts) countLine(line, Buffer.byteLength(line) + 1)
    offset += size
  }
  if (partial !== '') countLine(partial, Buffer.byteLength(partial) + 1)
  const scanned = {
    file,
    compressed: buffer.length,
    decompressed,
    frames,
    events,
    histogram,
    messages: (histogram['assistant/message'] ?? 0) + (histogram['user/message'] ?? 0),
    assistantMessages: histogram['assistant/message'] ?? 0,
    userMessages: histogram['user/message'] ?? 0,
    toolCalls: histogram['tool/call'] ?? 0,
    turns: (histogram['turn/start'] ?? 0) + (histogram['turn/end'] ?? 0),
    tornBytes: buffer.length - offset,
  }
  if (collect > 0) scanned.samples = samples
  if (tailLimit > 0) {
    scanned.tail = []
    for (const entry of tailLines) {
      try { scanned.tail.push({ event: JSON.parse(entry.line), bytes: entry.bytes }) } catch (error) { void error }
    }
  }
  return scanned
}

/**
 * One message-aligned history page, computed the way session/page does: walk backwards until
 * maxMessages messages are covered, then extend to a turn boundary (min two turns), and report the
 * record slice's event and byte counts. The wire response also carries projections; the comparison
 * in the report uses the record slice only and says so.
 */
function measureMessagePage(tail, maxMessages) {
  let messages = 0
  let index = tail.length - 1
  while (index >= 0 && messages < maxMessages) {
    const type = tail[index].event?.type
    if (type === 'assistant/message' || type === 'user/message') messages += 1
    index -= 1
  }
  let turns = 0
  while (index >= 0 && turns < 2) {
    if (tail[index].event?.type === 'turn/start') turns += 1
    index -= 1
  }
  const slice = tail.slice(index + 1)
  return {
    pageMessages: messages,
    pageEvents: slice.length,
    pageBytes: slice.reduce((sum, entry) => sum + entry.bytes, 0),
    pageTurns: turns,
    startSeq: slice.length === 0 ? null : (slice[0].event?.seq ?? null),
    endSeq: slice.length === 0 ? null : (slice[slice.length - 1].event?.seq ?? null),
    note: 'record slice only; the live session/page response also carries projections, so its wire bytes are larger',
  }
}

/** Real session-scale distribution: the honest upper bound for "how big do sessions get". */
function buildSessionInventory(kernelHome, currentSessionId) {
  const logs = inventorySessionLogs(kernelHome)
  const startedAtMs = Number(process.hrtime.bigint())
  const rows = []
  for (const entry of logs) {
    let scanned
    try { scanned = scanSessionLog(entry.file) } catch (error) { rows.push({ session: entry.session, group: entry.group, error: String(error && error.message ? error.message : error) }); continue }
    rows.push({
      session: entry.session,
      group: entry.group,
      compressed: scanned.compressed,
      decompressed: scanned.decompressed,
      frames: scanned.frames,
      events: scanned.events,
      messages: scanned.messages,
      assistantMessages: scanned.assistantMessages,
      userMessages: scanned.userMessages,
      toolCalls: scanned.toolCalls,
      turns: scanned.turns,
      eventsPerMessage: scanned.messages === 0 ? null : round(scanned.events / scanned.messages, 2),
      bytesPerEvent: scanned.events === 0 ? null : round(scanned.decompressed / scanned.events, 1),
      topTypes: Object.entries(scanned.histogram).sort((left, right) => right[1] - left[1]).slice(0, 6),
    })
  }
  const scanMs = (Number(process.hrtime.bigint()) - startedAtMs) / 1e6
  const eventCounts = rows.filter((row) => typeof row.events === 'number').map((row) => row.events).sort((left, right) => left - right)
  const quantile = (q) => eventCounts.length === 0 ? 0 : eventCounts[Math.min(eventCounts.length - 1, Math.floor(eventCounts.length * q))]
  const current = rows.find((row) => row.session === currentSessionId) ?? null
  return {
    scanned: rows.length,
    scanMs: round(scanMs, 1),
    totalCompressed: rows.reduce((sum, row) => sum + (row.compressed ?? 0), 0),
    totalEvents: rows.reduce((sum, row) => sum + (row.events ?? 0), 0),
    eventPercentiles: { p50: quantile(0.5), p90: quantile(0.9), p99: quantile(0.99), max: eventCounts.length === 0 ? 0 : eventCounts[eventCounts.length - 1] },
    current,
    top: rows.slice(0, 8),
  }
}


/* ------------------------------------------------------------------ faithful client window model */

// Port of packages/api/session-controller/src/client/contract/events.ts: append is O(1) (one
// concat node), materialize is O(n) over the whole window, and the live tail is never trimmed.
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

/** Grow a window by appending one entry at a time, exactly like the client's live tail. */
function growWindow(entries) {
  let window = leafNode([])
  for (const entry of entries) window = concatNode(window, leafNode([entry]))
  return window
}

/** Row descriptors a renderer builds per publish (order.map in ChatView); count their objects. */
function mapWindowToRows(materialized) {
  const rows = new Array(materialized.length)
  for (let index = 0; index < materialized.length; index += 1) rows[index] = { key: materialized[index].seq, kind: 'row', entry: materialized[index] }
  return rows
}

/** The window model's entry: a renderer-level wrapper around one real parsed session event. */
function makeModelEntries(samples, count) {
  const entries = new Array(count)
  for (let index = 0; index < count; index += 1) {
    const sample = samples[index % samples.length]
    entries[index] = { seq: index + 1, type: sample.event.type, event: sample.event }
  }
  return entries
}

/** Median of numeric samples. */
function medianOf(samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Retained heap of one graph, best of a few reps (noise or a negative delta means a GC ran). */
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

/**
 * Retained heap of one real parsed session event (distinct objects).
 *
 * With --expose-gc a collection before each rep makes the delta stable; without it the number is a
 * median over reps and the report labels the method. A deterministic structural companion
 * (v8.serialize length) is always reported so a noisy heap reading cannot become the only number.
 */
function measurePerEventHeap(samples) {
  const slice = samples.slice(0, Math.min(800, samples.length))
  const collect = typeof global.gc === 'function' ? global.gc : null
  const deltas = []
  for (let rep = 0; rep < 5; rep += 1) {
    if (collect !== null) collect()
    const before = process.memoryUsage().heapUsed
    const keep = slice.map((sample) => JSON.parse(JSON.stringify(sample.event)))
    const after = process.memoryUsage().heapUsed
    const delta = after - before
    if (delta > 0) deltas.push(delta)
    keep.length = 0
  }
  deltas.sort((left, right) => left - right)
  const bytes = deltas.length === 0 ? null : deltas[Math.floor(deltas.length / 2)]
  const serialized = slice.map((sample) => v8Serialize(sample.event).length).sort((left, right) => left - right)
  return {
    method: collect === null ? 'heap delta median of 5 (no --expose-gc; noisy)' : 'heap delta median of 5 with pre-rep GC (--expose-gc)',
    gcAvailable: collect !== null,
    sampleEvents: slice.length,
    retainedBytes: bytes,
    bytesPerEvent: bytes === null ? null : round(bytes / slice.length, 1),
    serializedBytesPerEvent: serialized.length === 0 ? null : round(serialized[Math.floor(serialized.length / 2)], 1),
    sourceBytesPerEvent: slice.length === 0 ? null : round(slice.reduce((sum, sample) => sum + sample.bytes, 0) / slice.length, 1),
  }
}

/** CPU per repetition for a synchronous scenario: repeat until a Windows tick is amortized. */
async function cpuPerRep(fn, wallMs, targetMs = 250) {
  const reps = Math.max(1, Math.min(400, Math.ceil(targetMs / Math.max(wallMs, 0.01))))
  const before = process.cpuUsage()
  for (let rep = 0; rep < reps; rep += 1) await fn()
  const delta = process.cpuUsage(before)
  return { reps, cpuPerRepMs: round(((delta.user + delta.system) / 1000) / reps, 4) }
}

/**
 * Measure one window policy at one size.
 *
 * @param label - tier/size label.
 * @param entries - the window's retained entries (growWindow consumes them).
 * @param context - { domModel(rows), publishes } where domModel prices rows/nodes from calibration.
 */
async function measureWindow(label, entries, context) {
  const retainedEntries = entries.length
  const appendStart = process.hrtime.bigint()
  const window = growWindow(entries)
  const appendTreeMs = round(Number(process.hrtime.bigint() - appendStart) / 1e6, 3)
  const objects = countObjects(window, { maxDepth: 6 })
  const materializeSamples = []
  let materialized = null
  for (let rep = 0; rep < 3; rep += 1) {
    const materializeStart = process.hrtime.bigint()
    materialized = materializeNode(window)
    materializeSamples.push(Number(process.hrtime.bigint() - materializeStart) / 1e6)
  }
  const materializeMs = round(medianOf(materializeSamples), 3)
  const mapStart = process.hrtime.bigint()
  const rows = mapWindowToRows(materialized)
  const mapMs = round(Number(process.hrtime.bigint() - mapStart) / 1e6, 3)
  const firstPaint = await trackScenario(() => {
    const built = growWindow(entries)
    const flat = materializeNode(built)
    return mapWindowToRows(flat)
  }, { label: label + '/first-paint', sync: true })
  const firstPaintCpu = await cpuPerRep(() => { materializeNode(growWindow(entries)) }, firstPaint.wallMs)
  const publishWall = materializeMs + mapMs
  const publish = await trackScenario(() => {
    const appended = concatNode(window, leafNode([entries[entries.length - 1]]))
    return mapWindowToRows(materializeNode(appended))
  }, { label: label + '/one-publish', sync: true })
  const publishCpu = await cpuPerRep(() => {
    const appended = concatNode(window, leafNode([entries[entries.length - 1]]))
    materializeNode(appended)
  }, publishWall)
  // R495 §5.2 measurement, same shape: append, materialize the whole window, read its length. Only
  // the row mapping is left out, so this number is directly comparable with 1,196.9 ms / 4.7 ms.
  const matOnlyReps = Math.max(20, Math.min(1000, Math.round(20000 / Math.max(1, retainedEntries))))
  const matOnlyStart = process.hrtime.bigint()
  for (let rep = 0; rep < matOnlyReps; rep += 1) {
    const appended = concatNode(window, leafNode([entries[rep % retainedEntries]]))
    materializeNode(appended).length
  }
  const perPublishMatOnlyMs = round(Number(process.hrtime.bigint() - matOnlyStart) / 1e6 / matOnlyReps, 5)
  // Sum of every publish from the first append to size W: materialize cost is linear in n, so the
  // closed form is a*W + b*W*(W+1)/2. Fit a and b from two measured window sizes (1/8 and full).
  const smallCount = Math.max(2, Math.floor(retainedEntries / 8))
  const smallWindow = growWindow(entries.slice(0, smallCount))
  const smallSamples = []
  for (let rep = 0; rep < 3; rep += 1) {
    const smallStart = process.hrtime.bigint()
    materializeNode(smallWindow)
    smallSamples.push(Number(process.hrtime.bigint() - smallStart) / 1e6)
  }
  const smallMaterializeMs = medianOf(smallSamples)
  const slope = retainedEntries === smallCount ? 0 : (materializeMs - smallMaterializeMs) / (retainedEntries - smallCount)
  const intercept = Math.max(0, materializeMs - slope * retainedEntries)
  const publishes = context.publishesToReach ?? retainedEntries
  const perPublishAtRetained = intercept + slope * retainedEntries
  // Growing tail: every publish re-materializes a window that also grew, hence the quadratic sum.
  // Capped policies: the window is constant after the cap, so the total is publishes * one publish.
  const totalPublishMs = context.growing === false
    ? publishes * perPublishAtRetained
    : intercept * publishes + slope * publishes * (publishes + 1) / 2
  return {
    label,
    retainedEntries,
    modelBytes: {
      eventObjectBytes: context.perEventHeapBytes === undefined ? null : Math.round(context.perEventHeapBytes * retainedEntries),
      sourceJsonBytes: context.sourceBytesPerEvent === undefined ? null : Math.round(context.sourceBytesPerEvent * retainedEntries),
    },
    retainedObjects: objects,
    logicalRows: rows.length,
    appendTreeMs,
    materializeMs,
    mapMs,
    perPublishMs: round(materializeMs + mapMs, 4),
    publishModel: {
      linearFit: { interceptMs: round(intercept, 5), slopeMsPerEntry: round(slope, 8) },
      publishesToReach: publishes,
      totalMaterializeMapMs: round(totalPublishMs, 1),
      formula: 'sum over n=1..W of (intercept + slope*n) = intercept*W + slope*W*(W+1)/2',
    },
    firstPaint: {
      wallMs: firstPaint.wallMs,
      syncWallAsStallMs: firstPaint.syncWallAsStallMs,
      canaryObservedStallMs: firstPaint.canaryObservedStallMs,
      cpuTotalMs: firstPaint.resource.cpuTotalMs,
      cpuPerRepMs: firstPaintCpu.cpuPerRepMs,
      retainedHeap: measureRetainedHeap(() => growWindow(entries), 2),
    },
    publishScenario: { wallMs: publish.wallMs, syncWallAsStallMs: publish.syncWallAsStallMs, cpuPerRepMs: publishCpu.cpuPerRepMs, cpuReps: publishCpu.reps },
    perPublishMatOnlyMs,
    r495Comparable: { perPublishMatOnlyMs, reps: matOnlyReps, definition: 'append + materialize whole window + read length, no row mapping (R495 §5.2)' },
    dom: context.domModel(rows.length, retainedEntries),
    // Model allocation counts (labelled): one window slot per entry, one row object per entry, two
    // tree nodes per append (leaf + concat), plus the calibrated DOM node estimate.
    allocations: {
      materializedSlots: retainedEntries,
      rowObjects: retainedEntries,
      windowTreeNodes: retainedEntries * 2 + 1,
      domNodesModel: context.domModel(rows.length, retainedEntries).nodesModel,
      note: 'logical allocations of one first paint; the publish path repeats the materialized slots and row objects on every publish',
    },
  }
}


/* ------------------------------------------------------------------ live DOM calibration (CDP, read-only) */

/** One CDP session against the running shell page; only Runtime.evaluate and Performance.getMetrics. */
async function connectCdp(port) {
  const targets = await (await fetch('http://127.0.0.1:' + String(port) + '/json/list')).json()
  const page = targets.find((target) => target.type === 'page' && String(target.url).includes(':31761'))
  if (page === undefined) return null
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const settle = pending.get(message.id)
    if (settle !== undefined) { pending.delete(message.id); settle(message) }
  })
  await new Promise((done) => socket.addEventListener('open', done, { once: true }))
  const call = (method, params) => new Promise((settle) => {
    const id = nextId++
    pending.set(id, settle)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (answer.result?.exceptionDetails !== undefined) throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 500))
    return answer.result?.result?.value
  }
  const collectGarbage = () => call('HeapProfiler.collectGarbage').catch(() => null)
  const metrics = async () => {
    const answer = await call('Performance.getMetrics')
    const out = {}
    for (const metric of answer.result?.metrics ?? []) out[metric.name] = metric.value
    return out
  }
  return { page, call, evaluate, metrics, collectGarbage, close: () => socket.close() }
}

/**
 * The page-side calibration script.
 *
 * It only reads the DOM and clones real rows into a detached fragment (allocation cost, no layout or
 * paint, nothing attached to the document); the fragment is dropped when the script returns. Mixed
 * clone batches are built in the same proportions as the live conversation so one rendered row's
 * cost is the measured average, not a guess.
 */
const LIVE_EXPRESSION = [
  '(() => {',
  '  const nodesOf = (element) => (element === null || element === undefined ? 0 : element.getElementsByTagName("*").length + 1)',
  '  const summarize = (list) => {',
  '    if (list.length === 0) return null',
  '    const sizes = list.map(nodesOf).sort((left, right) => left - right)',
  '    return { count: list.length, min: sizes[0], p50: sizes[Math.floor(sizes.length / 2)], max: sizes[sizes.length - 1], sum: sizes.reduce((sum, value) => sum + value, 0) }',
  '  }',
  '  const scroll = document.querySelector("[class*=scrollBody]")',
  '  const flowByKind = {}',
  '  for (const element of document.querySelectorAll("[data-chat-flow-kind]")) {',
  '    const kind = String(element.getAttribute("data-chat-flow-kind"))',
  '    if (flowByKind[kind] === undefined) flowByKind[kind] = []',
  '    flowByKind[kind].push(element)',
  '  }',
  '  const flowKinds = {}',
  '  const templates = {}',
  '  for (const kind of Object.keys(flowByKind)) {',
  '    flowKinds[kind] = summarize(flowByKind[kind])',
  '    templates[kind] = nodesOf(flowByKind[kind][0])',
  '  }',
  '  const containers = {',
  '    conversationNodes: scroll === null ? null : nodesOf(scroll),',
  '    scrollBody: scroll === null ? null : { cls: String(scroll.className), scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, scrollTop: scroll.scrollTop, children: scroll.children.length },',
  '    turnContainers: summarize([...document.querySelectorAll("[data-chat-turn]")]),',
  '    callRows: summarize([...document.querySelectorAll("[data-chat-call-id]")]),',
  '    pagingAnchors: summarize([...document.querySelectorAll("[data-chat-paging-anchor]")]),',
  '  }',
  '  const heap = performance.memory === undefined ? null : { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit }',
  '  const kinds = Object.keys(flowByKind)',
  '  const totalFlowRows = kinds.reduce((sum, kind) => sum + flowByKind[kind].length, 0)',
  '  const mixes = [2000, 5000].map((rows) => ({',
  '    label: "rows=" + String(rows),',
  '    parts: kinds.map((kind) => ({ kind, count: Math.max(0, Math.round((rows * flowByKind[kind].length) / totalFlowRows)) })).filter((part) => part.count > 0),',
  '  }))',
  '  const cloneResults = []',
  '  for (const mix of mixes) {',
  '    const started = performance.now()',
  '    const heapBefore = performance.memory === undefined ? null : performance.memory.usedJSHeapSize',
  '    const fragment = document.createDocumentFragment()',
  '    let rows = 0',
  '    let nodes = 0',
  '    for (const part of mix.parts) {',
  '      const source = flowByKind[part.kind] === undefined ? undefined : flowByKind[part.kind][0]',
  '      if (source === undefined) continue',
  '      for (let index = 0; index < part.count; index += 1) {',
  '        const clone = source.cloneNode(true)',
  '        fragment.appendChild(clone)',
  '        rows += 1',
  '        nodes += nodesOf(clone)',
  '      }',
  '    }',
  '    const elapsed = performance.now() - started',
  '    const heapAfter = performance.memory === undefined ? null : performance.memory.usedJSHeapSize',
  '    cloneResults.push({ label: mix.label, rows, nodes, ms: elapsed, heapDelta: heapBefore === null || heapAfter === null ? null : heapAfter - heapBefore })',
  '  }',
  '  return {',
  '    ok: true,',
  '    title: document.title,',
  '    url: location.href,',
  '    visibility: document.visibilityState,',
  '    hidden: document.hidden,',
  '    viewport: { width: innerWidth, height: innerHeight },',
  '    domNodesTotal: document.getElementsByTagName("*").length,',
  '    flowKinds,',
  '    templates,',
  '    containers,',
  '    heap,',
  '    cloneResults,',
  '    messagesEstimate: (flowKinds["assistant-step"] === undefined ? 0 : flowKinds["assistant-step"].count) + (flowKinds["user"] === undefined ? 0 : flowKinds["user"].count),',
  '  }',
  '})()',
].join('\n')

/**
 * Build one detached clone batch and keep it in globalThis so the CDP caller can read the renderer
 * heap with the batch alive. cloneNode allocates the real row shape (text nodes, spans, svg); being
 * detached keeps layout and paint out of the number, which is what the model needs.
 */
function makeCloneKeepExpression(rows) {
  return [
    '(() => {',
    '  const nodesOf = (element) => (element === null || element === undefined ? 0 : element.getElementsByTagName("*").length + 1)',
    '  const flowByKind = {}',
    '  for (const element of document.querySelectorAll("[data-chat-flow-kind]")) {',
    '    const kind = String(element.getAttribute("data-chat-flow-kind"))',
    '    if (flowByKind[kind] === undefined) flowByKind[kind] = []',
    '    flowByKind[kind].push(element)',
    '  }',
    '  const kinds = Object.keys(flowByKind)',
    '  const total = kinds.reduce((sum, kind) => sum + flowByKind[kind].length, 0)',
    '  const fragment = document.createDocumentFragment()',
    '  let built = 0',
    '  let nodes = 0',
    '  const started = performance.now()',
    '  for (const kind of kinds) {',
    '    const count = Math.max(0, Math.round((' + String(rows) + ' * flowByKind[kind].length) / total))',
    '    const source = flowByKind[kind][0]',
    '    for (let index = 0; index < count; index += 1) {',
    '      const clone = source.cloneNode(true)',
    '      fragment.appendChild(clone)',
    '      built += 1',
    '      nodes += nodesOf(clone)',
    '    }',
    '  }',
    '  globalThis.__r492Keep = fragment',
    '  return { rows: built, nodes, ms: performance.now() - started }',
    '})()',
  ].join('\n')
}

/** Drop the kept clone batch so the next heap reading starts clean. */
const DROP_KEEP_EXPRESSION = 'globalThis.__r492Keep = null; Boolean(true)'

/** Build clone-batch mixes in the live conversation's own proportions. */
function buildCloneMixes(flowKinds, rowsPerMix = [2000, 5000]) {
  const kinds = Object.keys(flowKinds)
  const total = kinds.reduce((sum, kind) => sum + flowKinds[kind].count, 0)
  return rowsPerMix.map((rows) => ({
    label: 'rows=' + String(rows),
    parts: kinds.map((kind) => ({ kind, count: Math.max(0, Math.round((rows * flowKinds[kind].count) / total)) })).filter((part) => part.count > 0),
  }))
}

/** Derive the model's DOM numbers from the live page, or return null when the page is unavailable. */
async function liveCalibration(port) {
  let client = null
  try {
    client = await connectCdp(port)
  } catch (error) {
    return { ok: false, reason: 'CDP unavailable: ' + String(error && error.message ? error.message : error) }
  }
  if (client === null) return { ok: false, reason: 'no page on the shell origin at 127.0.0.1:' + String(port) }
  try {
    const before = await client.metrics().catch(() => null)
    const probe = await client.evaluate(LIVE_EXPRESSION)
    const after = await client.metrics().catch(() => null)
    await client.call('Performance.enable').catch(() => null)
    const heapAnswer = await client.call('Runtime.getHeapUsage').catch(() => null)
    const heapUsage = heapAnswer?.result ?? null
    if (probe === null || probe.ok !== true) return { ok: false, reason: 'page-side calibration returned nothing' }
    // Real detached-DOM heap: build a batch, keep it alive in the page, read Runtime.getHeapUsage,
    // then drop it. Best of three reps per size; the slope between two sizes removes fixed noise.
    const keepBuilds = {}
    const readHeap = async () => {
      const answer = await client.call('Runtime.getHeapUsage').catch(() => null)
      return answer?.result?.usedSize ?? null
    }
    for (const rows of [200, 1000]) {
      let best = null
      for (let rep = 0; rep < 2; rep += 1) {
        await client.evaluate(DROP_KEEP_EXPRESSION).catch(() => null)
        // HeapProfiler.collectGarbage makes the retained-batch reading deterministic; without a
        // collection the delta is dominated by garbage from the previous batch.
        await client.collectGarbage()
        const before = await readHeap()
        const built = await client.evaluate(makeCloneKeepExpression(rows))
        await client.collectGarbage()
        const after = await readHeap()
        await client.evaluate(DROP_KEEP_EXPRESSION).catch(() => null)
        if (before !== null && after !== null && built !== null && built.rows > 0) {
          const delta = after - before
          if (delta > 0 && (best === null || delta < best.bytes)) best = { bytes: delta, rows: built.rows, nodes: built.nodes, ms: built.ms }
        }
      }
      keepBuilds['rows=' + String(rows)] = best
    }
    const flowKinds = probe.flowKinds ?? {}
    const flowRows = Object.keys(flowKinds).reduce((sum, kind) => sum + (flowKinds[kind]?.count ?? 0), 0)
    const flowNodes = Object.keys(flowKinds).reduce((sum, kind) => sum + (flowKinds[kind]?.sum ?? 0), 0)
    const conversationNodes = probe.containers?.conversationNodes ?? null
    const messagesEstimate = probe.messagesEstimate ?? 0
    const cloneResults = probe.cloneResults ?? []
    const clone = cloneResults.length === 0 ? null : cloneResults[cloneResults.length - 1]
    const calibration = {
      ok: true,
      source: 'live',
      page: { title: probe.title, url: probe.url },
      visibility: probe.visibility,
      hidden: probe.hidden,
      viewport: probe.viewport,
      domNodesTotal: probe.domNodesTotal,
      conversationNodes,
      flowRows,
      flowNodes,
      flowKinds,
      templates: probe.templates,
      turnContainers: probe.containers?.turnContainers ?? null,
      callRows: probe.containers?.callRows ?? null,
      pagingAnchors: probe.containers?.pagingAnchors ?? null,
      scrollBody: probe.containers?.scrollBody ?? null,
      messagesEstimate,
      nodesPerFlowRow: flowRows === 0 ? null : round(flowNodes / flowRows, 2),
      flowRowsPerMessage: messagesEstimate === 0 ? null : round(flowRows / messagesEstimate, 2),
      heap: {
        performanceMemory: probe.heap,
        runtime: heapUsage === null ? null : { usedSize: heapUsage.usedSize, totalSize: heapUsage.totalSize, embedderHeapUsedSize: heapUsage.embedderHeapUsedSize, backingStorageSize: heapUsage.backingStorageSize },
      },
      cloneBench: cloneResults.map((result) => ({
        label: result.label, rows: result.rows, nodes: result.nodes,
        ms: round(result.ms, 3), nodesPerRow: result.rows === 0 ? null : round(result.nodes / result.rows, 2),
        perRowMs: result.rows === 0 ? null : round(result.ms / result.rows, 5),
        heapDeltaMb: result.heapDelta === null ? null : mb(result.heapDelta),
        // The renderer heap counter updates lazily, so a per-row heap delta is only diagnostic; the
        // model prices DOM heap from the live heap-per-node reading instead.
        perRowHeapDeltaBytes: result.heapDelta === null || result.rows === 0 ? null : round(result.heapDelta / result.rows, 1),
      })),
      perRowHeapBytes: (() => {
        // The slope between two collected batches prices one rendered row: the fixed part (page,
        // session data, runtime) cancels out.
        const small = keepBuilds['rows=200']
        const large = keepBuilds['rows=1000']
        if (small !== null && small !== undefined && large !== null && large !== undefined && large.rows > small.rows) {
          const perRow = (large.bytes - small.bytes) / (large.rows - small.rows)
          return perRow > 0 ? round(perRow, 1) : null
        }
        return null
      })(),
      perNodeHeapBytes: (() => {
        const small = keepBuilds['rows=200']
        const large = keepBuilds['rows=1000']
        if (small !== null && small !== undefined && large !== null && large !== undefined && large.rows > small.rows) {
          const perRow = (large.bytes - small.bytes) / (large.rows - small.rows)
          const nodesPerRow = large.nodes / large.rows
          if (perRow > 0 && nodesPerRow > 0) return round(perRow / nodesPerRow, 1)
        }
        return heapUsage === null || heapUsage.usedSize === undefined || conversationNodes === null ? null : round(heapUsage.usedSize / conversationNodes, 1)
      })(),
      keptBatchHeap: Object.fromEntries(Object.entries(keepBuilds).map(([key, value]) => [key, value === null ? null : { bytes: value.bytes, mb: mb(value.bytes), rows: value.rows, nodes: value.nodes, ms: round(value.ms, 3), perRowBytes: round(value.bytes / value.rows, 1) }])),
      script: before === null || after === null || typeof before.ScriptDuration !== 'number' || typeof after.ScriptDuration !== 'number' ? null : {
        scriptDurationMs: round((after.ScriptDuration - before.ScriptDuration) * 1000, 3),
        layoutDurationMs: round(((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)) * 1000, 3),
        nodesMetricDelta: round((after.Nodes ?? 0) - (before.Nodes ?? 0), 1),
        jsHeapDeltaMb: round(((after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0)) / (1024 * 1024), 2),
      },
    }
    calibration.nodesPerEvent = conversationNodes === null || messagesEstimate === 0 ? null : round(conversationNodes / (messagesEstimate * (options.sampleEventsPerMessage ?? 1)), 2)
    return calibration
  } catch (error) {
    return { ok: false, reason: 'live calibration threw: ' + String(error && error.message ? error.message : error) }
  } finally {
    client.close()
  }
}

/**
 * Calibration constants measured on this machine on 2026-10-27 (R492 run), used only when the live
 * page cannot be reached. They price one rendered flow row and one flow row per message; the
 * live run records the same numbers beside them so drift is visible.
 */
const FALLBACK_CALIBRATION = {
  ok: false,
  source: 'fallback-2026-10-27',
  reason: 'live page unavailable; using the constants recorded by the R492 live run',
  conversationNodes: 31366,
  flowRows: 802,
  flowNodes: 30692,
  messagesEstimate: 391,
  nodesPerFlowRow: 38.26,
  flowRowsPerMessage: 2.05,
  perRowMs: 0.0415,
  perNodeHeapBytes: 1434,
  heap: { runtime: { usedSize: 45000000, totalSize: 57000000, embedderHeapUsedSize: 22000000, backingStorageSize: 14000000 } },
  cloneBench: [{ label: 'fallback', rows: 5000, nodes: 207111, ms: 207.2, nodesPerRow: 41.43, perRowMs: 0.0415, heapDeltaMb: null, perRowHeapDeltaBytes: null }],
}

/** Turn a calibration into the DOM pricing closure the window model calls. */
function domModelFor(calibration, eventsPerMessage) {
  const nodesPerFlowRow = calibration.nodesPerFlowRow ?? FALLBACK_CALIBRATION.nodesPerFlowRow
  const flowRowsPerMessage = calibration.flowRowsPerMessage ?? FALLBACK_CALIBRATION.flowRowsPerMessage
  const clone = calibration.cloneBench === undefined || calibration.cloneBench.length === 0 ? null : calibration.cloneBench[calibration.cloneBench.length - 1]
  const perRowMs = clone === null || clone.perRowMs === null ? FALLBACK_CALIBRATION.perRowMs : clone.perRowMs
  // DOM nodes are native Blink allocations: they do NOT appear in the V8 JS heap (a kept batch of
  // 1000 real rows moves the renderer JS heap by only ~32 B/row). The model therefore reports node
  // counts and clone cost, and never invents a DOM byte figure.
  return (entryRows, retainedEntries) => {
    const messages = retainedEntries / Math.max(0.001, eventsPerMessage)
    const flowRows = Math.round(messages * flowRowsPerMessage)
    const nodes = Math.round(flowRows * nodesPerFlowRow)
    return {
      messagesModel: round(messages, 1),
      flowRowsModel: flowRows,
      nodesModel: nodes,
      nodesPerEvent: retainedEntries === 0 ? null : round(nodes / retainedEntries, 2),
      cloneMsModel: round(flowRows * perRowMs, 2),
      perRowMs,
      domHeap: 'not modeled: native DOM memory is invisible to the V8 heap and CDP exposes node counts, not bytes',
      keepBatchV8BytesPerRow: calibration.keptBatchHeap?.['rows=' + String(1000)]?.perRowBytes ?? null,
      calibrationSource: calibration.source ?? (calibration.ok === true ? 'live' : 'fallback'),
    }
  }
}



/* ------------------------------------------------------------------ R495 cross-check (same methodology) */

/**
 * The R495 §5 benchmark, run as a subprocess with the kernel repo's own tsx loader.
 *
 * It imports the real @deepseek-ai/dsh-session and the real client MutableSessionEventSource, so its
 * numbers land on exactly the same definitions as R495 §5.1/§5.2 (Session.create restore,
 * deriveMessages, tail slice, append+materialize+read-length per publish). The published values are
 * attached as reference and the report states the deltas; running the same script here keeps us from
 * maintaining a second, incomparable set of numbers.
 */
const R495_BENCH_SCRIPT = [
  "import { performance } from 'node:perf_hooks'",
  "const { Session, SessionId } = await import('@deepseek-ai/dsh-session')",
  "const { syntheticHistory } = await import('./benchmarks/agent-continuation/workload.ts')",
  "const restore = []",
  "for (const turns of [200, 800, 2000]) {",
  "  const events = syntheticHistory(turns)",
  "  const t0 = performance.now()",
  "  const session = Session.create(SessionId('r492-bench-' + turns), events)",
  "  const restoreMs = performance.now() - t0",
  "  const t1 = performance.now()",
  "  const messages = session.deriveMessages()",
  "  const deriveMs = performance.now() - t1",
  "  const t2 = performance.now()",
  "  events.slice(-2000)",
  "  const tailSliceMs = performance.now() - t2",
  "  restore.push({ turns, events: events.length, restoreMs: +restoreMs.toFixed(1), deriveMs: +deriveMs.toFixed(2), tailSliceMs: +tailSliceMs.toFixed(3), messages: messages.length })",
  "}",
  "const { MutableSessionEventSource } = await import('./packages/api/session-controller/src/client/contract/events.ts')",
  "const entry = (seq) => ({ type: 'event', event: { type: 'user/message', seq, time: seq, data: { message: { id: 'm' + seq, role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }, source: { kind: 'user' } } } })",
  "const N = 10000",
  "const window = new MutableSessionEventSource()",
  "let t = performance.now()",
  "for (let index = 0; index < N; index += 1) { window.append(entry(index)); window.getSnapshot().entries.length }",
  "const perPublish = performance.now() - t",
  "let ring = []",
  "t = performance.now()",
  "for (let index = 0; index < N; index += 1) { ring.push(entry(index)); if (ring.length > 500) ring.shift(); ring.slice() }",
  "const ringMs = performance.now() - t",
  "console.log(JSON.stringify({ restore, client: { n: N, perPublishMaterializeMs: +perPublish.toFixed(1), ring500Ms: +ringMs.toFixed(1) } }))",
].join('\n')

/** Published R495 §5 numbers (baseline: DSH 0.2.1-rc.2, node v24.16.0, this machine, single process). */
const R495_REFERENCE = {
  source: 'R495 §5.1/§5.2 (independent audit, same machine)',
  restore: [
    { turns: 200, events: 3401, restoreMs: 86.8, deriveMs: 0.9, tailSliceMs: 0.003 },
    { turns: 800, events: 13601, restoreMs: 349.4, deriveMs: 1.4, tailSliceMs: 0.004 },
    { turns: 2000, events: 34001, restoreMs: 801.7, deriveMs: 2.3, tailSliceMs: 0.003 },
  ],
  restorePerEventUs: 23.6,
  client: { n: 10000, perPublishMaterializeMs: 1196.9, ring500Ms: 4.7, ratio: 255 },
  page: { pageMessages: 500, pageEvents: 3772, pageBytes: 8900000, note: 'R494 §1.3 live response; 8.9 MB includes projections' },
}

/**
 * Run the R495 benchmark twice and keep the faster reading per metric (the machine is shared, so a
 * single reading is not a fair comparison).
 */
function runR495Benchmark() {
  if (!existsSync(join(PATHS.kernelRepo, 'benchmarks', 'agent-continuation', 'workload.ts'))) {
    return { ok: false, reason: 'kernel benchmark workload not found under ' + PATHS.kernelRepo }
  }
  const runs = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = process.hrtime.bigint()
    const child = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module'], {
      cwd: PATHS.kernelRepo,
      input: R495_BENCH_SCRIPT,
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env },
    })
    if (child.status !== 0) {
      return { ok: false, reason: 'kernel benchmark failed: ' + String(child.status) + ' ' + String(child.stderr ?? '').slice(0, 600) }
    }
    const lines = String(child.stdout ?? '').trim().split('\n')
    try {
      runs.push({ ...JSON.parse(lines[lines.length - 1]), wallMs: round(Number(process.hrtime.bigint() - started) / 1e6, 1) })
    } catch (error) {
      return { ok: false, reason: 'kernel benchmark output was not JSON: ' + String(error && error.message ? error.message : error) }
    }
  }
  const faster = (selector) => runs.reduce((best, run) => {
    const value = selector(run)
    return best === null || value < best ? value : best
  }, null)
  const restore = R495_REFERENCE.restore.map((reference, index) => {
    const measured = runs.map((run) => run.restore[index])
    return {
      turns: reference.turns,
      events: measured[0]?.events ?? null,
      restoreMs: faster((run) => run.restore[index].restoreMs),
      deriveMs: faster((run) => run.restore[index].deriveMs),
      tailSliceMs: faster((run) => run.restore[index].tailSliceMs),
      reference,
      deltaMs: round(faster((run) => run.restore[index].restoreMs) - reference.restoreMs, 1),
    }
  })
  const perPublishMeasured = faster((run) => run.client.perPublishMaterializeMs)
  const ringMeasured = faster((run) => run.client.ring500Ms)
  return {
    ok: true,
    runs: runs.length,
    wallMs: runs.map((run) => run.wallMs),
    restore,
    client: {
      n: R495_REFERENCE.client.n,
      perPublishMaterializeMs: perPublishMeasured,
      ring500Ms: ringMeasured,
      measuredRatio: ringMeasured === 0 ? null : round(perPublishMeasured / ringMeasured, 1),
      reference: R495_REFERENCE.client,
    },
    restorePerEventUs: round((faster((run) => run.restore[2].restoreMs) * 1000) / runs[0].restore[2].events, 2),
    referencePerEventUs: R495_REFERENCE.restorePerEventUs,
    pageModel: null,
  }
}

/* ------------------------------------------------------------------ main */

/** Current session id: match the live page title against the projection cache's title rows. */
function findSessionIdByTitle(kernelHome, title) {
  if (title === null || title === undefined || title === '') return null
  const dir = join(kernelHome, 'storages', 'session_projcache', 'sessions')
  if (!existsSync(dir)) return null
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const doc = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      const stored = doc.record?.rows?.title?.val
      if (typeof stored !== 'string' || stored === '') continue
      // The page title carries the app suffix ("... — DSH 本地构建"); the cache stores the bare title.
      if (stored === title || title.startsWith(stored) || stored.startsWith(title.split(' — ')[0])) return name.slice(0, -'.json'.length)
    } catch (error) { void error }
  }
  return null
}

function printInventory(inventory) {
  logSection('real session-scale inventory (kernel-home: ' + String(inventory.kernelHome) + ')')
  console.log('  sessions ' + String(inventory.scanned) + ', total ' + String(inventory.totalEvents) + ' events, '
    + String(mb(inventory.totalCompressed)) + ' MB of concatenated zstd frames; event count p50 ' + String(inventory.eventPercentiles.p50)
    + ' / p90 ' + String(inventory.eventPercentiles.p90) + ' / p99 ' + String(inventory.eventPercentiles.p99) + ' / max ' + String(inventory.eventPercentiles.max))
  const rows = inventory.top.slice(0, 6).map((entry) => [
    entry.session.slice(0, 28),
    String(entry.events),
    String(entry.messages),
    String(entry.eventsPerMessage),
    String(entry.toolCalls),
    String(entry.bytesPerEvent),
    String(mb(entry.decompressed)),
  ])
  if (inventory.current !== null) rows.unshift(['current page session', String(inventory.current.events), String(inventory.current.messages), String(inventory.current.eventsPerMessage), String(inventory.current.toolCalls), String(inventory.current.bytesPerEvent), String(mb(inventory.current.decompressed))])
  printTable(['session', 'events', 'messages', 'ev/msg', 'tools', 'B/evt', 'decomp'], rows, [28, 8, 9, 7, 6, 7, 7])
}

function printCalibration(calibration) {
  logSection('live DOM calibration (' + String(calibration.source) + (calibration.ok === true ? '' : ' : ' + String(calibration.reason)) + ')')
  if (calibration.ok !== true) {
    console.log('  using recorded large-session constants (see R492 doc): ' + String(calibration.reason))
    const liveReading = calibration.liveReading ?? null
    if (liveReading !== null) {
      console.log('  live reading kept as diagnostic: ' + String(liveReading.page.title) + ' | ' + String(liveReading.conversationNodes) + ' nodes, '
        + String(liveReading.flowRows) + ' flow rows, ' + String(liveReading.messagesEstimate) + ' message rows -> ' + String(liveReading.nodesPerFlowRow) + ' nodes/row')
      for (const bench of liveReading.cloneBench ?? []) {
        console.log('  live clone ' + String(bench.label) + ': ' + String(bench.perRowMs * 1000) + ' us/row, ' + String(bench.nodesPerRow) + ' nodes/row')
      }
    }
    return
  }
  const page = calibration.page ?? {}
  console.log('  page: ' + String(page.title) + ' | visibility ' + String(calibration.visibility) + ' | viewport ' + String(calibration.viewport.width) + 'x' + String(calibration.viewport.height))
  console.log('  conversation: ' + String(calibration.conversationNodes) + ' DOM nodes, ' + String(calibration.flowRows) + ' flow rows, '
    + String(calibration.messagesEstimate) + ' message rows -> ' + String(calibration.nodesPerFlowRow) + ' nodes/row, '
    + String(calibration.flowRowsPerMessage) + ' rows/message')
  if (calibration.scrollBody !== null) console.log('  scrollBody: scrollHeight ' + String(calibration.scrollBody.scrollHeight) + ' px, clientHeight ' + String(calibration.scrollBody.clientHeight) + ' px, scrollTop ' + String(calibration.scrollBody.scrollTop))
  if (calibration.heap?.runtime !== null && calibration.heap?.runtime !== undefined) {
    const runtime = calibration.heap.runtime
    console.log('  renderer heap: used ' + String(mb(runtime.usedSize)) + ' MB, total ' + String(mb(runtime.totalSize)) + ' MB, embedder ' + String(mb(runtime.embedderHeapUsedSize)) + ' MB, backing ' + String(mb(runtime.backingStorageSize)) + ' MB')
  }
  for (const [key, kept] of Object.entries(calibration.keptBatchHeap ?? {})) {
    if (kept === null) continue
    console.log('  kept batch ' + key + ': V8 heap +' + String(kept.perRowBytes) + ' B/row for ' + String(kept.rows) + ' rows / ' + String(kept.nodes) + ' nodes (native DOM memory is not in this number)')
  }
  for (const bench of calibration.cloneBench ?? []) {
    console.log('  clone ' + String(bench.label) + ': ' + String(bench.rows) + ' rows / ' + String(bench.nodes) + ' nodes in ' + String(bench.ms) + ' ms -> '
      + String(bench.perRowMs * 1000) + ' us/row, ' + String(bench.nodesPerRow) + ' nodes/row')
  }
  if (calibration.script !== null) {
    console.log('  CDP metrics around calibration: script ' + String(calibration.script.scriptDurationMs) + ' ms, layout ' + String(calibration.script.layoutDurationMs)
      + ' ms, nodes delta ' + String(calibration.script.nodesMetricDelta) + ', heap delta ' + String(calibration.script.jsHeapDeltaMb) + ' MB')
  }
  const measured = calibration.turnContainers
  if (measured !== null && measured !== undefined) console.log('  turn containers: ' + String(measured.count) + ' rows, ' + String(measured.sum) + ' nodes total (nested: kept out of the linear row price)')
}

function printR495(r495, pageModel) {
  logSection('R495 cross-check (same benchmark from this script: real Session + real MutableSessionEventSource)')
  if (r495.ok !== true) {
    console.log('  skipped: ' + String(r495.reason))
    return
  }
  const rows = r495.restore.map((entry) => [
    String(entry.turns),
    String(entry.events),
    String(entry.restoreMs),
    String(entry.reference.restoreMs),
    String(entry.deltaMs),
    String(entry.deriveMs),
    String(entry.reference.deriveMs),
    String(entry.tailSliceMs),
  ])
  console.log('  Session.create full restore (R495 §5.1 methodology, 2 runs, faster kept):')
  printTable(['turns', 'events', 'restoreMs', 'R495Ms', 'deltaMs', 'deriveMs', 'R495derive', 'sliceMs'], rows, [6, 7, 10, 8, 8, 9, 10, 8])
  console.log('  restore slope measured ' + String(r495.restorePerEventUs) + ' us/event vs R495 ' + String(r495.referencePerEventUs) + ' us/event')
  const client = r495.client
  console.log('  client window (R495 §5.2, N=' + String(client.n) + '): per-publish materialize ' + String(client.perPublishMaterializeMs)
    + ' ms vs R495 ' + String(client.reference.perPublishMaterializeMs) + ' ms; ring500 ' + String(client.ring500Ms)
    + ' ms vs ' + String(client.reference.ring500Ms) + ' ms -> measured ratio ' + String(client.measuredRatio) + 'x vs R495 ' + String(client.reference.ratio) + 'x')
  if (pageModel !== null) {
    console.log('  session/page record slice (' + String(options.pageMessages) + ' messages): ' + String(pageModel.pageEvents) + ' events / '
      + String(mb(pageModel.pageBytes)) + ' MB, ' + String(pageModel.pageMessages) + ' messages, ' + String(pageModel.pageTurns) + ' turn boundaries; R495/R494 reference '
      + String(R495_REFERENCE.page.pageEvents) + ' events / ' + String(mb(R495_REFERENCE.page.pageBytes)) + ' MB (different session shape)')
  }
  console.log('  note: the wire response also carries projections; the slice above counts records only, as labelled in the report')
}

function printLatencyTable(size, tiers) {
  const rows = []
  for (const [name, tier] of [['current', tiers.current], ['ring' + String(options.tailCap), tiers.ring], ['paged ' + String(options.pageMessages) + 'msg', tiers.paged]]) {
    const latency = tier.latencyModel
    rows.push([name, String(latency.firstScreenMs), String(latency.tailFollowMs), latency.pageLoadMs === null ? '-' : String(latency.pageLoadMs), latency.scrollFrame.slice(0, 2) === 'NO' ? 'n/a (hidden)' : String(latency.scrollFrame)])
  }
  console.log('  latency model @ ' + String(size) + ' (first screen / tail publish / older page load, ms):')
  printTable(['policy', 'firstScreen', 'tailFollow', 'pageLoad', 'scroll'], rows, [12, 11, 10, 9, 12])
}

function printTierTable(size, tiers, sample, calibration) {
  logSection('B2 window policies @ ' + String(size) + ' events (real event sample, ' + String(sample.eventsPerMessage) + ' events/message, '
    + String(calibration.nodesPerFlowRow ?? FALLBACK_CALIBRATION.nodesPerFlowRow) + ' nodes/flow row)')
  const rows = []
  for (const [name, tier] of [['current', tiers.current], ['ring' + String(options.tailCap), tiers.ring], ['paged ' + String(options.pageMessages) + 'msg', tiers.paged]]) {
    rows.push([
      name,
      String(tier.retainedEntries),
      String(tier.perPublishMatOnlyMs),
      String(tier.perPublishMs),
      String(tier.publishModel.totalMaterializeMapMs),
      String(tier.dom.flowRowsModel),
      String(tier.dom.nodesModel),
      String(tier.dom.cloneMsModel),
      tier.firstPaint.retainedHeap === null ? '-' : String(tier.firstPaint.retainedHeap.mb),
    ])
  }
  printTable(['policy', 'entries', 'matOnly', 'pubMs', 'sumPubsMs', 'domRows', 'domNodes', 'cloneMs', 'winGraphMB'], rows, [12, 8, 8, 7, 11, 9, 9, 8, 10])
}

function printClampSummary(sizes, tiers) {
  const largest = sizes[sizes.length - 1]
  const at = tiers[largest]
  if (at === undefined) return
  logSection('B2 comparison @ ' + String(largest) + ' events (current vs the two candidate caps)')
  const ratio = (left, right) => right === 0 ? null : round(left / right, 1)
  const rows = [
    ['retained entries', String(at.current.retainedEntries), String(at.ring.retainedEntries), String(at.paged.retainedEntries)],
    ['retained page/event bytes (MB model)', String(mb(at.current.modelBytes.eventObjectBytes ?? 0)), String(mb(at.ring.modelBytes.eventObjectBytes ?? 0)), String(mb(at.paged.modelBytes.eventObjectBytes ?? 0))],
    ['first paint wall (ms)', String(at.current.firstPaint.wallMs), String(at.ring.firstPaint.wallMs), String(at.paged.firstPaint.wallMs)],
    ['one publish materialize-only (ms)', String(at.current.perPublishMatOnlyMs), String(at.ring.perPublishMatOnlyMs), String(at.paged.perPublishMatOnlyMs)],
    ['one publish + row map (ms)', String(at.current.perPublishMs), String(at.ring.perPublishMs), String(at.paged.perPublishMs)],
    ['all publishes to reach size (ms CPU)', String(at.current.publishModel.totalMaterializeMapMs), String(at.ring.publishModel.totalMaterializeMapMs), String(at.paged.publishModel.totalMaterializeMapMs)],
    ['DOM nodes (model)', String(at.current.dom.nodesModel), String(at.ring.dom.nodesModel), String(at.paged.dom.nodesModel)],
    ['DOM build (ms model)', String(at.current.dom.cloneMsModel), String(at.ring.dom.cloneMsModel), String(at.paged.dom.cloneMsModel)],
    ['first screen (ms model)', String(at.current.latencyModel.firstScreenMs), String(at.ring.latencyModel.firstScreenMs), String(at.paged.latencyModel.firstScreenMs)],
    ['tail follow (ms model)', String(at.current.latencyModel.tailFollowMs), String(at.ring.latencyModel.tailFollowMs), String(at.paged.latencyModel.tailFollowMs)],
  ]
  printTable(['metric', 'current', 'ring500', 'paged'], rows, [34, 12, 12, 12])
  console.log('  current/paged ratios: entries ' + String(ratio(at.current.retainedEntries, at.paged.retainedEntries))
    + 'x, all-publishes CPU ' + String(ratio(at.current.publishModel.totalMaterializeMapMs, at.paged.publishModel.totalMaterializeMapMs))
    + 'x, DOM nodes ' + String(ratio(at.current.dom.nodesModel, at.paged.dom.nodesModel)) + 'x')
  console.log('  current/ring ratios: entries ' + String(ratio(at.current.retainedEntries, at.ring.retainedEntries))
    + 'x, all-publishes CPU ' + String(ratio(at.current.publishModel.totalMaterializeMapMs, at.ring.publishModel.totalMaterializeMapMs))
    + 'x, DOM nodes ' + String(ratio(at.current.dom.nodesModel, at.ring.dom.nodesModel)) + 'x')
}

async function main() {
  const kernelHome = resolveKernelHome()
  if (kernelHome === null) fail('no kernel home with a sessions/ directory (pass --kernel-home= or set DSH_LINK_KERNEL_HOME)')
  const live = options.live === false ? { ok: false, reason: 'live calibration disabled (--live=off)' } : await liveCalibration(options.port)
  const pageTitle = live.ok === true ? live.page.title : null
  const currentSessionId = findSessionIdByTitle(kernelHome, pageTitle)
  const inventory = buildSessionInventory(kernelHome, currentSessionId)
  inventory.kernelHome = kernelHome
  if (inventory.scanned === 0) fail('no readable session logs under ' + join(kernelHome, 'sessions'))
  if (options.sessionsOnly || HEADS_UP === false) {
    // no window model requested
  }
  if (options.sessionsOnly) {
    if (HEADS_UP) printInventory(inventory)
    const report = { meta: { tool: 'perf-b2-render', mode: 'sessions-only', kernelHome, generatedAt: new Date().toISOString() }, sessions: inventory }
    if (OUTPUT_FILE !== null) { report.meta.outputFile = OUTPUT_FILE; mkdirSync(dirname(OUTPUT_FILE), { recursive: true }); writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8') }
    if (options.json === true) console.log(JSON.stringify(report, null, 2))
    return
  }
  // The model shape comes from the LARGEST session on this machine: B2 is about long sessions, and
  // the shell may be showing a small one. The currently rendered session is reported separately.
  const sampleRow = inventory.top[0]
  if (sampleRow === undefined) fail('no session row to sample events from')
  const sampleFile = join(kernelHome, 'sessions', sampleRow.group, sampleRow.session, 'session.v4.jsonl.zstd')
  const scanned = scanSessionLog(sampleFile, { collect: 1500, tail: 8000 })
  if (scanned.samples.length < 100) fail('the model sample has only ' + String(scanned.samples.length) + ' parsed events; expected >= 100')
  const pageModel = scanned.tail === undefined ? null : measureMessagePage(scanned.tail, options.pageMessages)
  const eventsPerMessage = scanned.messages === 0 ? 1 : scanned.events / scanned.messages
  options.sampleEventsPerMessage = eventsPerMessage
  const perEventHeap = measurePerEventHeap(scanned.samples)
  // The model is calibrated on a LONG session's shape: the shell may be showing a small session
  // (its mounted row mix is then not representative), so live readings are used for the model only
  // when they come from a large conversation; otherwise the recorded large-session constants are.
  const calibration = live.ok === true && live.flowRows >= 400
    ? live
    : {
        ...FALLBACK_CALIBRATION,
        reason: live.ok === true
          ? 'live page shows a small session (' + String(live.flowRows) + ' mounted flow rows); using the recorded large-session shape for the model'
          : (live.reason ?? 'live calibration unavailable'),
        liveReading: live.ok === true ? live : null,
      }
  calibration.nodesPerEvent = calibration.messagesEstimate === 0 || calibration.conversationNodes === null || calibration.conversationNodes === undefined
    ? null
    : round(calibration.conversationNodes / (calibration.messagesEstimate * eventsPerMessage), 2)
  const domModel = domModelFor(calibration, eventsPerMessage)
  const modelContext = { domModel, perEventHeapBytes: perEventHeap.bytesPerEvent ?? 0, sourceBytesPerEvent: perEventHeap.sourceBytesPerEvent ?? 0 }
  if (HEADS_UP) {
    console.log('R492 B2 rendering baseline — node ' + process.version + ' ' + String(cpus().length) + ' cpus, ' + String(mb(totalmem())) + ' MB RAM')
    console.log('window sizes: ' + options.sizes.join(',') + ' events | page ' + String(options.pageMessages) + ' messages | tail cap ' + String(options.tailCap) + ' entries')
    printInventory(inventory)
    console.log('\n  model sample: session ' + String(sampleRow.session) + ' (' + String(scanned.events) + ' events, ' + String(scanned.messages) + ' messages, '
      + String(scanned.frames) + ' frames); parsed ' + String(scanned.samples.length) + ' distinct events -> ' + String(perEventHeap.bytesPerEvent) + ' B retained heap/event, '
      + String(perEventHeap.sourceBytesPerEvent) + ' B source JSON/event; events/message ' + String(round(eventsPerMessage, 2)))
    printCalibration(calibration)
  }
  // R495 cross-check: same benchmark, same method, different script boundary — one set of numbers.
  const r495 = options.r495 ? runR495Benchmark() : { ok: false, reason: 'disabled with --r495=off or --no-r495' }
  r495.pageModel = pageModel
  r495.referencePage = R495_REFERENCE.page
  if (HEADS_UP) printR495(r495, pageModel)
  const tiers = {}
  const modelStarted = process.hrtime.bigint()
  for (const size of options.sizes) {
    const currentEntries = makeModelEntries(scanned.samples, size)
    const ringEntries = makeModelEntries(scanned.samples, options.tailCap)
    const pagedEntriesCount = Math.round(options.pageMessages * eventsPerMessage) + options.tailCap
    const pagedEntries = makeModelEntries(scanned.samples, pagedEntriesCount)
    const current = await measureWindow('current@' + String(size), currentEntries, { ...modelContext, publishesToReach: size, growing: true })
    const ring = await measureWindow('ring' + String(options.tailCap) + '@' + String(size), ringEntries, { ...modelContext, publishesToReach: size, growing: false })
    const paged = await measureWindow('paged' + String(options.pageMessages) + '@' + String(size), pagedEntries, { ...modelContext, publishesToReach: size, growing: false })
    if (current.materializeMs !== null && materializeNodeForCheck(currentEntries) !== currentEntries.length) fail('window model self-check failed at size ' + String(size))
    for (const [name, tier] of [['current', current], ['ring', ring], ['paged', paged]]) {
      tier.latencyModel = {
        firstScreenMs: round(tier.firstPaint.wallMs + tier.dom.cloneMsModel, 2),
        tailFollowMs: round(tier.perPublishMs + tier.dom.perRowMs, 3),
        pageLoadMs: name === 'paged' ? round(tier.perPublishMs + domModel(0, pagedEntriesCount).cloneMsModel, 2) : null,
        scrollFrame: 'NOT MEASURED: the shell window is 158x26 px and the conversation scroller is 0 px tall, so frame/scroll readings would be meaningless',
        note: 'model: event-window work measured in-process plus calibrated DOM clone cost; no layout/paint is included',
      }
    }
    tiers[size] = { current, ring, paged, inputs: { size, eventsPerMessage: round(eventsPerMessage, 2), pageEntries: pagedEntriesCount, tailCap: options.tailCap } }
    if (HEADS_UP) { printTierTable(size, tiers[size], { eventsPerMessage: round(eventsPerMessage, 2) }, calibration); printLatencyTable(size, tiers[size]) }
  }
  if (HEADS_UP) printClampSummary(options.sizes, tiers)
  const report = {
    meta: {
      tool: 'perf-b2-render',
      node: process.version,
      platform: process.platform + '/' + process.arch,
      cpus: cpus().length,
      totalRamMb: mb(totalmem()),
      kernelHome,
      pageTitle,
      currentSessionId,
      generatedAt: new Date().toISOString(),
      modelMs: round(Number(process.hrtime.bigint() - modelStarted) / 1e6, 1),
      args: { sizes: options.sizes, pageMessages: options.pageMessages, tailCap: options.tailCap, publishes: options.publishes, live: options.live },
      artifacts: { collabLib: statInfo(PATHS.collabLib), teamsLib: statInfo(PATHS.teamsLib), collabLibSha256: existsSync(PATHS.collabLib) ? sha256(PATHS.collabLib) : null },
      windowModel: 'faithful port of packages/api/session-controller/src/client/contract/events.ts leaf/concat/materialize; entries carry real parsed session events',
      notes: {
        measurement: 'Synchronous model steps cannot be interrupted: wall time is the stall, and the canary delay recorded after the step equals it (see perf-instrument.mjs).',
        live: 'Live calibration only evaluates read-only DOM queries and clones real rows into a detached fragment; nothing is attached, typed, scrolled, or reloaded.',
        scrollLatency: 'NOT MEASURED: the running shell window is ' + String(calibration.viewport?.width ?? '?') + 'x' + String(calibration.viewport?.height ?? '?') + ' px and the conversation scroller measures 0 px tall, so frame/scroll latency readings would be meaningless; B2 live evidence stays with R479.',
        dom: 'DOM numbers are node counts and clone cost, not bytes: native Blink DOM memory does not show up in the V8 JS heap (a kept batch of 1000 real rows moves the renderer JS heap only ~32 B/row), and CDP exposes node counts, not DOM bytes. Node counts are calibrated on a large rendered conversation and scaled by the window policy.',
        calibrationSession: 'DOM calibration is per rendered session: the shell may show a different session between runs, so the report records the page title and session id, and the model only uses a live shape when the mounted row count is large enough to be representative.',
      },
    },
    sessions: inventory,
    r495: {
      ...r495,
      definition: 'R495 §5.1/§5.2 benchmark re-run from this script with the kernel repo loader: real Session.create + real MutableSessionEventSource',
      crossCheck: r495.ok === true ? {
        restorePerEventUs: { measured: r495.restorePerEventUs, reference: r495.referencePerEventUs },
        perPublishMaterializeMs: { measured: r495.client.perPublishMaterializeMs, reference: r495.client.reference.perPublishMaterializeMs },
        ring500Ms: { measured: r495.client.ring500Ms, reference: r495.client.reference.ring500Ms },
        ratio: { measured: r495.client.measuredRatio, reference: r495.client.reference.ratio },
        page: pageModel,
      } : null,
    },
    sample: {
      session: sampleRow.session,
      group: sampleRow.group,
      events: scanned.events,
      messages: scanned.messages,
      eventsPerMessage: round(eventsPerMessage, 2),
      frames: scanned.frames,
      decompressed: scanned.decompressed,
      parsedSamples: scanned.samples.length,
      perEventHeap,
      pageModel,
      topTypes: Object.entries(scanned.histogram).sort((left, right) => right[1] - left[1]).slice(0, 8),
    },
    calibration,
    domModel: {
      nodesPerFlowRow: calibration.nodesPerFlowRow ?? FALLBACK_CALIBRATION.nodesPerFlowRow,
      flowRowsPerMessage: calibration.flowRowsPerMessage ?? FALLBACK_CALIBRATION.flowRowsPerMessage,
      nodesPerEvent: calibration.nodesPerEvent ?? null,
      source: calibration.source,
    },
    tiers,
    comparison: (() => {
      const largest = options.sizes[options.sizes.length - 1]
      const at = tiers[largest]
      return {
        size: largest,
        retainedEntries: { current: at.current.retainedEntries, ring: at.ring.retainedEntries, paged: at.paged.retainedEntries },
        firstPaintMs: { current: at.current.firstPaint.wallMs, ring: at.ring.firstPaint.wallMs, paged: at.paged.firstPaint.wallMs },
        perPublishMs: { current: at.current.perPublishMs, ring: at.ring.perPublishMs, paged: at.paged.perPublishMs },
        allPublishesMs: { current: at.current.publishModel.totalMaterializeMapMs, ring: at.ring.publishModel.totalMaterializeMapMs, paged: at.paged.publishModel.totalMaterializeMapMs },
        domNodes: { current: at.current.dom.nodesModel, ring: at.ring.dom.nodesModel, paged: at.paged.dom.nodesModel },
        domBuildMs: { current: at.current.dom.cloneMsModel, ring: at.ring.dom.cloneMsModel, paged: at.paged.dom.cloneMsModel },
        firstScreenMs: { current: at.current.latencyModel.firstScreenMs, ring: at.ring.latencyModel.firstScreenMs, paged: at.paged.latencyModel.firstScreenMs },
        tailFollowMs: { current: at.current.latencyModel.tailFollowMs, ring: at.ring.latencyModel.tailFollowMs, paged: at.paged.latencyModel.tailFollowMs },
        ratios: {
          entriesCurrentOverPaged: round(at.current.retainedEntries / at.paged.retainedEntries, 1),
          publishesCurrentOverPaged: round(at.current.publishModel.totalMaterializeMapMs / at.paged.publishModel.totalMaterializeMapMs, 1),
          domCurrentOverPaged: round(at.current.dom.nodesModel / at.paged.dom.nodesModel, 1),
          entriesCurrentOverRing: round(at.current.retainedEntries / at.ring.retainedEntries, 1),
          publishesCurrentOverRing: round(at.current.publishModel.totalMaterializeMapMs / at.ring.publishModel.totalMaterializeMapMs, 1),
        },
      };
    })(),
    verdicts: [
      'Current implementation keeps the live tail unbounded and materializes the whole window on every publish: the cost of reaching N events is quadratic, which is the R479 B2 growth mechanism.',
      'A 500-entry live-tail ring holds the window at ' + String(options.tailCap) + ' entries; publish cost and DOM rows stop growing, while older history stays available through the existing page loader.',
      'A paged window (500-message page + 500-entry tail) bounds the resident window near ' + String(Math.round(options.pageMessages * (inventory.current?.eventsPerMessage ?? 7) + options.tailCap)) + ' entries and keeps the page contract intact.',
      'Live DOM calibration shows a rendered flow row costs ' + String(calibration.nodesPerFlowRow ?? '?') + ' DOM nodes and ' + String(calibration.cloneBench?.[calibration.cloneBench.length - 1]?.perRowMs ?? '?') + ' ms to clone; the model applies that price to the rows each policy keeps.',
    ],
    reproduce: [
      'node scripts/perf-b2-render.mjs --sizes=10000,50000,100000 --live --out=.tmp/R492-b2.json',
      'node scripts/perf-b2-render.mjs --sessions-only          # real session-scale inventory only',
      'node scripts/perf-multi-agent.mjs --runs=3 --instrument=full --out=.tmp/R492-perf.json',
    ],
  }
  if (OUTPUT_FILE !== null) {
    report.meta.outputFile = OUTPUT_FILE
    mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
    writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8')
    if (HEADS_UP) console.log('\nJSON report: ' + OUTPUT_FILE + ' (generatedAt ' + String(report.meta.generatedAt) + ')')
  }
  if (options.json === true) console.log(JSON.stringify(report, null, 2))
  else console.log('\ndone in ' + String(round((Date.now() - startedAt) / 1000, 1)) + ' s')
}

/** Self-check helper: materialize a freshly grown window and report its length. */
function materializeNodeForCheck(entries) {
  return materializeNode(growWindow(entries)).length
}

await main()
