#!/usr/bin/env node
/**
 * R492 shared measurement instrumentation.
 *
 * One place for the readings every perf script in this directory records, so a number in one
 * table means the same thing as the number in another:
 *
 *   - wall time and CPU time (process.cpuUsage delta: user + system);
 *   - RSS and heap around a scenario (peak while it runs when the scenario yields, delta when it
 *     is one synchronous block, which is the honest reading for a sync workload);
 *   - per-operation latency samples (count, p50, p95, p99, max, mean, ops/s);
 *   - event-loop health around the scenario: a 1 ms monitorEventLoopDelay histogram, a 1 ms drift
 *     timer, and two independent setImmediate canary chains. A synchronous block collects all of
 *     these AFTER it returns, so for a pure-sync workload the canary gap equals the block's wall
 *     time: the honest stall number there is wall time itself, and the probes are what prove it
 *     rather than claim it;
 *   - object counts and JSON byte sizes for the synthetic models (allocated/retained are labelled
 *     so a model number is never mistaken for a measured one).
 *
 * Nothing here touches the running LINK; it is process-local instrumentation.
 *
 *   node scripts/perf-multi-agent.mjs --instrument=full     # uses this module
 *   node scripts/perf-b2-render.mjs --live                  # uses this module
 */

import { monitorEventLoopDelay } from 'node:perf_hooks'

/** Milliseconds since a process.hrtime.bigint() stamp. */
export const elapsedMs = (start) => Number(process.hrtime.bigint() - start) / 1e6
/** Current monotonic stamp in bigint nanoseconds. */
export const stamp = () => process.hrtime.bigint()
/** Round for display. */
export const round = (value, digits = 3) => Number(value.toFixed(digits))
const mb = (bytes) => round(bytes / (1024 * 1024), 2)

/**
 * Summarize per-operation latency samples.
 *
 * @param samples - milliseconds per operation, one entry per measured repetition.
 * @param totalMs - summed wall time of those repetitions.
 * @returns count/mean/min/p50/p95/p99/max/opsPerSec, rounded.
 */
export function summarizeSamples(samples, totalMs) {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((left, right) => left - right)
  const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))]
  const mean = totalMs / samples.length
  return {
    reps: samples.length,
    totalMs: round(totalMs, 1),
    meanMs: round(mean, 3),
    minMs: round(sorted[0], 3),
    p50Ms: round(quantile(0.5), 3),
    p95Ms: round(quantile(0.95), 3),
    p99Ms: round(quantile(0.99), 3),
    maxMs: round(sorted[sorted.length - 1], 3),
    opsPerSec: mean > 0 ? round(1000 / mean, 1) : null,
  }
}

/** One process resource snapshot. */
export function resourceSnapshot() {
  const usage = process.memoryUsage()
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  }
}

/**
 * Wall/CPU/RSS/heap readings around one scenario.
 *
 * Memory is sampled every 5 ms while the scenario is running; a synchronous block cannot be
 * sampled from inside itself, so its peak then equals the post-block value and the sync flag says
 * so. CPU time comes from process.cpuUsage() and is always a delta over the scenario.
 */
export class ResourceProbe {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs ?? 5
    this.started = null
    this.sampler = null
    this.peakRss = 0
    this.peakHeap = 0
    this.samples = 0
  }

  start() {
    this.started = { hr: stamp(), cpu: process.cpuUsage(), resource: resourceSnapshot() }
    this.peakRss = this.started.resource.rss
    this.peakHeap = this.started.resource.heapUsed
    this.samples = 0
    this.sampler = setInterval(() => {
      const usage = process.memoryUsage()
      if (usage.rss > this.peakRss) this.peakRss = usage.rss
      if (usage.heapUsed > this.peakHeap) this.peakHeap = usage.heapUsed
      this.samples += 1
    }, this.intervalMs)
    if (typeof this.sampler.unref === 'function') this.sampler.unref()
  }

  stop() {
    if (this.sampler !== null) clearInterval(this.sampler)
    this.sampler = null
    const wallMs = elapsedMs(this.started.hr)
    const cpu = process.cpuUsage(this.started.cpu)
    const end = resourceSnapshot()
    const start = this.started.resource
    return {
      wallMs: round(wallMs, 3),
      cpuUserMs: round(cpu.user / 1000, 3),
      cpuSystemMs: round(cpu.system / 1000, 3),
      cpuTotalMs: round((cpu.user + cpu.system) / 1000, 3),
      rss: {
        startMb: mb(start.rss), endMb: mb(end.rss), peakMb: mb(this.peakRss),
        deltaMb: mb(end.rss - start.rss), samples: this.samples,
      },
      heap: {
        startMb: mb(start.heapUsed), endMb: mb(end.heapUsed), peakMb: mb(this.peakHeap),
        deltaMb: mb(end.heapUsed - start.heapUsed),
        externalDeltaMb: mb(end.external - start.external),
        arrayBuffersDeltaMb: mb(end.arrayBuffers - start.arrayBuffers),
      },
      sync: this.samples === 0,
    }
  }
}

/**
 * Event-loop health around one scenario: histogram + drift timer + two canary chains.
 *
 * The 1 ms interval and the setImmediate canaries are what dsh-next's methodology uses to
 * separate "the work took long" from "the process could not get back to the loop". In a
 * synchronous scenario the callbacks fire only after the block, so their delay is the block's own
 * duration; the trackScenario reading states that as syncWallAsStallMs rather than claiming a
 * delay the loop never got to measure mid-block.
 */
export class StallProbe {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs ?? 1
    this.histogram = null
    this.timer = null
    this.driftSamples = []
    this.over1ms = 0
    this.expected = 0
    this.canary = { first: [], second: [] }
    this.started = false
  }

  start() {
    this.histogram = monitorEventLoopDelay({ resolution: this.intervalMs })
    this.histogram.enable()
    this.driftSamples = []
    this.over1ms = 0
    this.canary = { first: [], second: [] }
    this.expected = performance.now() + this.intervalMs
    this.started = true
    this.timer = setInterval(() => {
      const now = performance.now()
      const late = now - this.expected
      this.driftSamples.push(late)
      if (late > 1) this.over1ms += 1
      this.expected += this.intervalMs
      if (this.expected < now) this.expected = now + this.intervalMs
    }, this.intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    this.armCanaries()
    return this
  }

  /** Queue one canary on each of the two independent chains; the delay is the loop's answer. */
  armCanaries() {
    for (const chain of ['first', 'second']) {
      const scheduled = stamp()
      setImmediate(() => { this.canary[chain].push(elapsedMs(scheduled)) })
    }
  }

  snapshot() {
    const histogram = this.histogram
    const delay = histogram === null ? null : {
      count: histogram.count,
      p50Ms: round(histogram.percentile(50) / 1e6, 3),
      p95Ms: round(histogram.percentile(95) / 1e6, 3),
      p99Ms: round(histogram.percentile(99) / 1e6, 3),
      maxMs: round(histogram.max / 1e6, 3),
      meanMs: round(histogram.mean / 1e6, 3),
    }
    const driftMax = this.driftSamples.length === 0 ? 0 : Math.max(...this.driftSamples)
    return {
      eventLoopDelay: delay,
      drift: { ticks: this.driftSamples.length, over1ms: this.over1ms, maxMs: round(driftMax, 3) },
      canary: {
        firstMaxDelayMs: this.canary.first.length === 0 ? null : round(Math.max(...this.canary.first), 3),
        secondMaxDelayMs: this.canary.second.length === 0 ? null : round(Math.max(...this.canary.second), 3),
        chains: 2,
      },
    }
  }

  /**
   * Stop sampling AFTER the loop has answered.
   *
   * A synchronous block leaves the 1 ms monitor timer, the drift timer and both canaries overdue;
   * if sampling stopped before those callbacks ran, every reading would be zero and the stall
   * would look absent. Two loop turns are therefore given first: the timers phase records the
   * delay, then the canaries (check phase) record theirs, and only then is the histogram disabled.
   */
  async stop() {
    this.started = false
    await new Promise((done) => setImmediate(done))
    await new Promise((done) => setImmediate(done))
    // monitorEventLoopDelay re-arms on its own timer; one sample window after the drain is what
    // makes the post-block delay appear in the histogram (observed on Node 24: the first callback
    // re-arms before recording, the next one records).
    await new Promise((done) => setTimeout(done, Math.max(3, this.intervalMs * 3)))
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    const reading = this.snapshot()
    if (this.histogram !== null) this.histogram.disable()
    return reading
  }
}

/**
 * Run one scenario under both probes.
 *
 * @param fn - the scenario body; awaited so one call measures one unit of work.
 * @param options - label and probe switches.
 * @returns the probes' readings plus the awaited body's value.
 */
export async function trackScenario(fn, options = {}) {
  const resource = new ResourceProbe(options.resource ?? {})
  const stall = options.stall === false ? null : new StallProbe(options.stallOptions ?? {}).start()
  resource.start()
  let value
  let error = null
  try {
    value = await fn()
  } catch (thrown) {
    error = String(thrown && thrown.message ? thrown.message : thrown)
  }
  const resourceReading = resource.stop()
  const stallReading = stall === null ? null : await stall.stop()
  const canaries = stallReading === null ? [] : [stallReading.canary.firstMaxDelayMs, stallReading.canary.secondMaxDelayMs].filter((value) => typeof value === 'number')
  // The sampler cannot fire inside a synchronous block, but a sub-5 ms async scenario also records
  // zero samples; the caller therefore declares sync explicitly when it knows. Unknown stays null
  // rather than being guessed from a sampling artifact.
  const synchronous = options.sync === true ? true : options.sync === false ? false : null
  return {
    label: options.label ?? 'scenario',
    wallMs: resourceReading.wallMs,
    error,
    resource: resourceReading,
    stall: stallReading,
    // A synchronous scenario cannot be interrupted by probes: its wall time IS the stall.
    syncWallAsStallMs: synchronous ? resourceReading.wallMs : null,
    sync: synchronous,
    canaryObservedStallMs: canaries.length === 0 ? null : round(Math.max(...canaries), 3),
    value,
  }
}

/**
 * Count objects in a value graph (the synthetic models' allocation counter).
 *
 * @param value - the value to walk.
 * @param options - depth and node caps so a pathological graph cannot hang the instrument.
 * @returns objects seen, arrays seen and total nodes counted.
 */
export function countObjects(value, options = {}) {
  const maxDepth = options.maxDepth ?? 12
  const maxNodes = options.maxNodes ?? 5000000
  const seen = new Set()
  const pending = [{ value, depth: 0 }]
  let objects = 0
  let arrays = 0
  let nodes = 0
  while (pending.length > 0 && nodes < maxNodes) {
    const current = pending.pop()
    if (current.value === null || typeof current.value !== 'object') { nodes += 1; continue }
    if (seen.has(current.value)) continue
    seen.add(current.value)
    nodes += 1
    objects += 1
    if (Array.isArray(current.value)) arrays += 1
    if (current.depth >= maxDepth) continue
    const keys = Array.isArray(current.value) ? current.value.map((ignored, index) => index) : Object.keys(current.value)
    for (const key of keys) pending.push({ value: current.value[key], depth: current.depth + 1 })
    if (nodes + pending.length > maxNodes) break
  }
  return { objects, arrays, nodes, truncated: nodes >= maxNodes }
}

/** JSON byte length of a value, the bytes a wire/ledger reader would actually touch. */
export function jsonBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value)) } catch (error) { void error; return null }
}

/** A tiny fixed-width table printer, so every script's output reads the same. */
export function printTable(headers, rows, widths = []) {
  const cells = (row) => row.map((cell) => String(cell))
  const sizes = headers.map((header, index) => Math.max(String(header).length, ...rows.map((row) => cells(row)[index].length), widths[index] ?? 0))
  const line = (row) => cells(row).map((cell, index) => cell.padEnd(sizes[index])).join(' ')
  console.log(line(headers))
  for (const row of rows) console.log(line(row))
}
