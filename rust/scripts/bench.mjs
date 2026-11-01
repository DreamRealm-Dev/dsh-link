#!/usr/bin/env node
/**
 * Microbenchmark: Rust addon vs the pure-TS reference, on identical fixtures.
 *
 *   node --expose-gc rust/scripts/bench.mjs            both implementations, prints a table
 *   node --expose-gc rust/scripts/bench.mjs --json     also writes rust/bench-results.json
 *
 * Every (implementation, fixture) pair runs in its own child process, so the RSS delta is
 * that one case's growth instead of the residue of earlier cases in the same process. Each
 * child receives the same pre-serialised fixture string, warms up, then times every call
 * individually so the p50/p99 are per-call latencies rather than batch averages. The native
 * child also asserts byte parity with the TS reference for its fixture, so a benchmark
 * number is never quoted for a diverging result.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch, version as nodeVersion } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeCollabRecords, makeTeamEvents } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const ADDON = join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'lib', 'dsh_compute.node')
const RESULTS_PATH = join(HERE, '..', 'bench-results.json')
const CHILD_FLAG = '--child'

/** The timed cases. Iterations are sized so each case runs for roughly a second. */
const CASES = [
  { id: 'collab-1k', kind: 'fold', iterations: 1500, warmup: 30, build: () => makeCollabRecords(1000) },
  { id: 'collab-10k', kind: 'fold', iterations: 200, warmup: 10, build: () => makeCollabRecords(10_000, 0x5eed5eed) },
  { id: 'collab-50k', kind: 'fold', iterations: 50, warmup: 5, build: () => makeCollabRecords(50_000, 0x5eed5eed) },
  { id: 'team-12', kind: 'index', iterations: 3000, warmup: 50, build: () => makeTeamEvents(12) },
  { id: 'team-24', kind: 'index', iterations: 3000, warmup: 50, build: () => makeTeamEvents(24) },
]

/** Nearest-rank percentile from an ascending array. */
function percentile(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]
}

/** Time one function over a pre-serialised input. */
function measure(fn, input, iterations, warmup) {
  for (let index = 0; index < warmup; index += 1) fn(input)
  if (global.gc) global.gc()
  const memoryBefore = process.memoryUsage()
  const times = new Float64Array(iterations)
  const started = process.hrtime.bigint()
  for (let index = 0; index < iterations; index += 1) {
    const begin = process.hrtime.bigint()
    fn(input)
    times[index] = Number(process.hrtime.bigint() - begin) / 1e6
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  if (global.gc) global.gc()
  const memoryAfter = process.memoryUsage()
  const sorted = Array.from(times).sort((left, right) => left - right)
  return {
    iterations,
    elapsedMs,
    opsPerSec: iterations / (elapsedMs / 1000),
    meanMs: elapsedMs / iterations,
    p50Ms: percentile(sorted, 50),
    p99Ms: percentile(sorted, 99),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
    heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
  }
}

/** The child process: one implementation, one JSON line of results. */
async function runChild(impl, onlyCase) {
  const require = createRequire(import.meta.url)
  const loadStart = process.hrtime.bigint()
  const referencePath = pathToFileURL(join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'src', 'reference.ts')).href
  if (impl === 'native') {
    const addon = require(ADDON)
    const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6
    // The reference is imported after the clock stops: parity checking is not part of cold start.
    const reference = await import(referencePath)
    const parity = (caseId, input) => {
      const rust = caseId.startsWith('collab') ? addon.foldCollabRecords(input) : addon.indexTeamStatus(input)
      const ts = caseId.startsWith('collab') ? reference.foldCollabRecords(input) : reference.indexTeamStatus(input)
      return rust === ts
    }
    const call = (caseId, input) => caseId.startsWith('collab') ? addon.foldCollabRecords(input) : addon.indexTeamStatus(input)
    return finishChild(impl, loadMs, call, parity, onlyCase)
  }
  const reference = await import(referencePath)
  const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6
  const call = (caseId, input) => caseId.startsWith('collab') ? reference.foldCollabRecords(input) : reference.indexTeamStatus(input)
  return finishChild(impl, loadMs, call, undefined, onlyCase)
}

/** Time every case for one already-loaded implementation and emit the child's one JSON line. */
function finishChild(impl, loadMs, call, parity, onlyCase) {
  const results = []
  const firstCallStart = process.hrtime.bigint()
  for (const testCase of onlyCase === undefined ? CASES : CASES.filter((candidate) => candidate.id === onlyCase)) {
    const fixture = testCase.build()
    const rows = testCase.kind === 'fold' ? fixture.meta.rowCount : fixture.meta.events
    const input = JSON.stringify(testCase.kind === 'fold' ? fixture.rows : fixture.events)
    if (parity !== undefined && !parity(testCase.id, input)) {
      console.log('PARITY_FAIL ' + testCase.id)
      process.exit(3)
    }
    if (results.length === 0) call(testCase.id, input)
    const firstCallMs = results.length === 0 ? Number(process.hrtime.bigint() - firstCallStart) / 1e6 : 0
    const measurement = measure(call.bind(null, testCase.id), input, testCase.iterations, testCase.warmup)
    results.push({ case: testCase.id, kind: testCase.kind, rows, firstCallMs, ...measurement })
  }
  console.log('__BENCH__' + JSON.stringify({ impl, loadMs, results }))
  return null
}

/** The parent: run one child per (implementation, case), merge, print and persist. */
function runParent() {
  const results = { native: [], reference: [] }
  const loadMs = { native: 0, reference: 0 }
  for (const impl of ['native', 'reference']) {
    for (const testCase of CASES) {
      const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), CHILD_FLAG, impl, testCase.id], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
      if (child.error) throw child.error
      const line = (child.stdout ?? '').split('\n').find((candidate) => candidate.startsWith('__BENCH__'))
      if (child.status !== 0 || line === undefined) {
        throw new Error('bench child ' + impl + '/' + testCase.id + ' failed (exit ' + String(child.status) + ')\n' + String(child.stdout) + String(child.stderr))
      }
      const parsed = JSON.parse(line.slice('__BENCH__'.length))
      loadMs[impl] = parsed.loadMs
      results[impl].push(...parsed.results)
    }
    console.log('ran ' + impl + ' children (' + String(CASES.length) + '): cold load ' + loadMs[impl].toFixed(2) + 'ms')
  }
  const runs = {
    native: { loadMs: loadMs.native, results: results.native },
    reference: { loadMs: loadMs.reference, results: results.reference },
  }

  let rustc = 'unknown'
  const rustcResult = spawnSync('rustc', ['--version'], { encoding: 'utf8' })
  if (rustcResult.status === 0) rustc = String(rustcResult.stdout).trim()

  const merged = CASES.map((testCase) => {
    const native = runs.native.results.find((row) => row.case === testCase.id)
    const reference = runs.reference.results.find((row) => row.case === testCase.id)
    return {
      case: testCase.id,
      kind: testCase.kind,
      rows: native.rows,
      native,
      reference,
      speedup: native.opsPerSec / reference.opsPerSec,
      latencyRatioP99: native.p99Ms / reference.p99Ms,
      parity: 'byte-identical',
    }
  })

  const header = '| fixture | rows | impl | ops/s | mean ms | p50 ms | p99 ms | RSS delta MB | heap delta MB |'
  const divider = '|---|---:|---|---:|---:|---:|---:|---:|---:|'
  const lines = [header, divider]
  for (const row of merged) {
    for (const [label, measurement] of [['rust', row.native], ['ts', row.reference]]) {
      lines.push('| ' + row.case + ' | ' + String(row.rows) + ' | ' + label + ' | '
        + measurement.opsPerSec.toFixed(1) + ' | '
        + measurement.meanMs.toFixed(4) + ' | '
        + measurement.p50Ms.toFixed(4) + ' | '
        + measurement.p99Ms.toFixed(4) + ' | '
        + (measurement.rssDeltaBytes / (1024 * 1024)).toFixed(2) + ' | '
        + (measurement.heapDeltaBytes / (1024 * 1024)).toFixed(2) + ' |')
    }
    lines.push('| ' + row.case + ' | ' + String(row.rows) + ' | **rust/ts** | **' + row.speedup.toFixed(2) + 'x** | | | **p99 ' + row.latencyRatioP99.toFixed(2) + 'x** | | |')
  }
  const table = lines.join('\n')
  console.log('\n' + table + '\n')
  console.log('cold load: native ' + runs.native.loadMs.toFixed(2) + 'ms, ts ' + runs.reference.loadMs.toFixed(2) + 'ms')

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    os: nodeVersion(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    rustc,
    addonBytes: existsSync(ADDON) ? statSync(ADDON).size : null,
    fixtures: { collabSeed: '0x5eed5eed', teamSeed: '0x7ea3', rows: 1000 },
    coldLoadMs: { native: runs.native.loadMs, reference: runs.reference.loadMs },
    parity: 'byte-identical on every timed fixture',
    results: merged,
  }
  writeFileSync(RESULTS_PATH, JSON.stringify(report, null, 2) + '\n')
  console.log('results written: ' + RESULTS_PATH)
}

if (process.argv.includes(CHILD_FLAG)) {
  await runChild(process.argv[3], process.argv[4])
} else {
  runParent()
}
