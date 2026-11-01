#!/usr/bin/env node
/**
 * R505: read-path latency evidence for the compute shadow (post-P2 revision).
 *
 * The shadow no longer folds inside state(): observe() only counts and schedules, and the read +
 * fold run on a later tick. This script measures exactly that contract on a read-only copy of the
 * real ledger:
 *   - observe() per-call cost (what a state() call actually pays; expected sub-microsecond to
 *     microsecond, O(1), no I/O)
 *   - background sample cost p50/p99/max (as the shadow reports them)
 *   - the old synchronous "read+append+snapshot" cost, kept only as a comparison figure
 *   - GET /api/dsh-link-teams/state on the running kernel (baseline; the running build predates
 *     each landing, so re-measure after R504/R507, never reuse these numbers as before/after)
 *
 *   node rust/scripts/collab-readpath-latency.mjs
 * Results: rust/scripts/collab-readpath-latency.json
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const RESULTS = join(HERE, 'collab-readpath-latency.json')
const STATE_URL = 'http://127.0.0.1:31761/api/dsh-link-teams/state'
const REPEATS = 10
const HTTP_REPEATS = 60

/** Nearest-rank percentile from an ascending array. */
function percentile(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]
}

/** Resolve the live ledger through the read-only teams route. */
async function resolveLedger() {
  const response = await fetch(STATE_URL, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('teams route answered ' + String(response.status))
  const state = await response.json()
  return { file: join(state.ledger.directory, 'control.jsonl') }
}

/** Parse NDJSON into records. */
function parse(bytes) {
  const records = []
  for (const line of bytes.toString('utf8').split('\n')) {
    if (line.trim() === '') continue
    try { records.push(JSON.parse(line)) } catch { /* damaged line */ }
  }
  return records
}

/** Time a synchronous function; returns ascending ms. */
function times(fn, repeats) {
  const out = []
  for (let index = 0; index < repeats; index += 1) {
    const began = process.hrtime.bigint()
    fn()
    out.push(Number(process.hrtime.bigint() - began) / 1e6)
  }
  return out.sort((left, right) => left - right)
}

/** Resume when the next macrotask/tick has run. */
const tick = () => new Promise((resolveTick) => setTimeout(resolveTick, 0))

/** The parent. */
async function main() {
  const ledger = await resolveLedger()
  const bytes = readFileSync(ledger.file)
  const records = parse(bytes)
  console.log('ledger:', ledger.file, bytes.length + ' B', 'records=' + String(records.length))

  const collab = await import(pathToFileURL(join(REPO_ROOT, 'plugins/dsh-link-collab/lib/index.js')).href)
  if (typeof collab.projectTeamState !== 'function') throw new Error('collab lib exports no projectTeamState')
  const reference = await import(pathToFileURL(join(REPO_ROOT, 'plugins/dsh-link-compute/src/reference.ts')).href)
  const engine = await import(pathToFileURL(join(REPO_ROOT, 'plugins/dsh-link-collab/src/compute-engine.ts')).href)
  const require = createRequire(import.meta.url)
  const addon = require(join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'lib', 'dsh_compute.node'))

  const projectTimes = times(() => collab.projectTeamState(records), REPEATS)
  const syncSampleTimes = times(() => {
    const index = new addon.CollabFoldIndex()
    const chunk = 500 * 1024
    for (let offset = 0; offset < bytes.length; offset += chunk) index.appendRecords(bytes.subarray(offset, Math.min(bytes.length, offset + chunk)))
    index.snapshot()
  }, REPEATS)
  const referenceIndex = new reference.CollabFoldIndex()
  referenceIndex.appendRecords(bytes)
  const collabState = collab.projectTeamState(records)

  // What a state() call pays: observe() only. Most calls are pure counters under the default
  // throttle. 20,000 calls give a stable per-call number.
  const facade = { kind: 'native', openFoldIndex: () => new addon.CollabFoldIndex() }
  const observeShadow = engine.createComputeShadow({
    directory: dirname(ledger.file),
    getService: () => facade,
    sampleEvery: 20,
    sampleIntervalMs: 2000,
  })
  const OBSERVE_CALLS = 20000
  const observeBegan = process.hrtime.bigint()
  for (let call = 0; call < OBSERVE_CALLS; call += 1) observeShadow.observe(collabState)
  const observePerCallUs = Number(process.hrtime.bigint() - observeBegan) / 1000 / OBSERVE_CALLS

  // Background samples: force one per call and let each finish, so the diagnostics percentiles
  // describe the real sample body (read + byte-batched append + snapshot + compare).
  const sampleShadow = engine.createComputeShadow({
    directory: dirname(ledger.file),
    getService: () => facade,
    sampleEvery: 1,
    sampleIntervalMs: 0,
  })
  for (let sample = 0; sample < 8; sample += 1) {
    const before = sampleShadow.diagnostics().runs
    sampleShadow.observe(collabState)
    for (let wait = 0; wait < 100 && sampleShadow.diagnostics().runs === before; wait += 1) await tick()
  }
  const sampleDiagnostics = sampleShadow.diagnostics()

  const httpTimes = []
  for (let index = 0; index < HTTP_REPEATS; index += 1) {
    const began = process.hrtime.bigint()
    const response = await fetch(STATE_URL, { headers: { accept: 'application/json' } })
    await response.arrayBuffer()
    httpTimes.push(Number(process.hrtime.bigint() - began) / 1e6)
  }
  httpTimes.sort((left, right) => left - right)

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    ledger: { path: ledger.file, bytes: bytes.length, records: records.length, snapshotRecords: records.length },
    caveat: 'The running kernel is not this worktree; HTTP numbers are a baseline to re-measure after R504/R507, never a before/after claim.',
    projectTeamState: { p50Ms: percentile(projectTimes, 50), p99Ms: percentile(projectTimes, 99), repeats: REPEATS },
    shadowObservePerCallUs: observePerCallUs,
    shadowBackgroundSample: {
      runs: sampleDiagnostics.runs,
      p50Ms: sampleDiagnostics.sampleP50Ms,
      p99Ms: sampleDiagnostics.sampleP99Ms,
      maxMs: sampleDiagnostics.sampleMaxMs,
      lastMs: sampleDiagnostics.lastMs,
      failures: sampleDiagnostics.failures,
      lastError: sampleDiagnostics.lastError,
    },
    syncSampleForComparison: { p50Ms: percentile(syncSampleTimes, 50), p99Ms: percentile(syncSampleTimes, 99), repeats: REPEATS },
    httpGetStateRoute: { p50Ms: percentile(httpTimes, 50), p99Ms: percentile(httpTimes, 99), repeats: HTTP_REPEATS },
  }
  writeFileSync(RESULTS, JSON.stringify(report, null, 2) + '\n')
  console.log('projectTeamState p50/p99:', report.projectTeamState.p50Ms.toFixed(3), '/', report.projectTeamState.p99Ms.toFixed(3), 'ms')
  console.log('shadow observe per-call:', report.shadowObservePerCallUs.toFixed(3), 'us')
  console.log('shadow background sample p50/p99/max:', report.shadowBackgroundSample.p50Ms.toFixed(2), '/', report.shadowBackgroundSample.p99Ms.toFixed(2), '/', report.shadowBackgroundSample.maxMs.toFixed(2), 'ms', 'runs=' + String(report.shadowBackgroundSample.runs))
  console.log('sync sample for comparison p50/p99:', report.syncSampleForComparison.p50Ms.toFixed(2), '/', report.syncSampleForComparison.p99Ms.toFixed(2), 'ms')
  console.log('GET route p50/p99/max:', report.httpGetStateRoute.p50Ms.toFixed(2), '/', report.httpGetStateRoute.p99Ms.toFixed(2), '/', Math.max(...httpTimes).toFixed(2), 'ms', 'repeats=' + String(HTTP_REPEATS))
  console.log('results:', RESULTS)
}

main().catch((error) => { console.error('FAILED:', error instanceof Error ? error.stack : String(error)); process.exit(1) })
