#!/usr/bin/env node
/**
 * Incremental-API benchmark: stateful Rust index vs stateful TS index.
 *
 * This is the experiment that decides whether the collaboration-ledger fold should migrate
 * (R486): the one-shot API re-parses and re-folds the whole ledger per query, so its numbers
 * do not say whether a live index is worth a native addon. Here both implementations keep the
 * fold state and are measured on the same fixtures:
 *
 *   append        parse + fold one batch (500 rows) at a time, all rows, rows/s
 *   snapshot      materialise the full summary from the kept state, p50 latency
 *   one-shot      fold the whole ledger with the stateless function, p50 latency (context)
 *   deltaSince(0) answer "what changed since version 0", p50 latency
 *   memory        RSS growth across the append phase (one case per child process)
 *
 * Every (implementation, size) pair runs in its own child, so the RSS number is that case's
 * growth and not another case's residue. The native child compares its snapshot and delta with
 * the TypeScript index replaying the same batches; a mismatch fails the run before numbers are
 * reported.
 *
 *   node --expose-gc rust/scripts/bench-incremental.mjs
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch, version as nodeVersion } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeCollabRecords } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const ADDON = join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'lib', 'dsh_compute.node')
const RESULTS_PATH = join(HERE, '..', 'bench-incremental-results.json')
const CHILD_FLAG = '--child'

/** Sizes and batch shape of the experiment. */
const SIZES = [10_000, 20_000, 50_000]
const BATCH_SIZE = 500
/** Snapshot/delta repeats per case; large snapshots are expensive to materialise. */
const QUERY_REPEATS = 20
/** One-shot full-fold repeats per case (context only). */
const ONE_SHOT_REPEATS = 5

/** Nearest-rank percentile from an ascending array. */
function percentile(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]
}

/** Run fn repeats times and return per-call milliseconds. */
function latencies(fn, repeats, warmup) {
  for (let index = 0; index < warmup; index += 1) fn()
  const times = []
  for (let index = 0; index < repeats; index += 1) {
    const begin = process.hrtime.bigint()
    fn()
    times.push(Number(process.hrtime.bigint() - begin) / 1e6)
  }
  return times.sort((left, right) => left - right)
}

/** The child: one implementation, one size, one JSON line. */
async function runChild(impl, size) {
  const require = createRequire(import.meta.url)
  const referencePath = pathToFileURL(join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'src', 'reference.ts')).href
  const loadStart = process.hrtime.bigint()
  let openIndex
  let oneShot
  let reference
  if (impl === 'rust') {
    const addon = require(ADDON)
    const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6
    reference = await import(referencePath)
    openIndex = () => new addon.CollabFoldIndex()
    oneShot = (text) => addon.foldCollabRecords(text)
    return finishChild({ impl, size, loadMs, openIndex, oneShot, reference })
  }
  reference = await import(referencePath)
  const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6
  openIndex = () => new reference.CollabFoldIndex()
  oneShot = (text) => reference.foldCollabRecords(text)
  return finishChild({ impl, size, loadMs, openIndex, oneShot, reference })
}

/** Measure one case with an already-loaded implementation. */
function finishChild({ impl, size, loadMs, openIndex, oneShot, reference }) {
  const fixture = makeCollabRecords(size)
  const rows = fixture.rows
  const fullJson = JSON.stringify(rows)
  const batches = []
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    batches.push(JSON.stringify(rows.slice(index, index + BATCH_SIZE)))
  }

  // Context: the stateless function over the whole ledger.
  const oneShotTimes = latencies(() => oneShot(fullJson), ONE_SHOT_REPEATS, 1)
  const oneShotP50Ms = percentile(oneShotTimes, 50)

  // The incremental path: build state batch by batch.
  const index = openIndex()
  if (global.gc) global.gc()
  const rssBefore = process.memoryUsage().rss
  const appendStart = process.hrtime.bigint()
  for (const batch of batches) index.appendBatch(batch)
  const appendTotalMs = Number(process.hrtime.bigint() - appendStart) / 1e6
  const appendRowsPerSec = rows.length / (appendTotalMs / 1000)

  // Queries against the kept state.
  const snapshotTimes = latencies(() => index.snapshot(), QUERY_REPEATS, 2)
  const deltaTimes = latencies(() => index.deltaSince(0), QUERY_REPEATS, 2)
  const snapshot = index.snapshot()
  if (global.gc) global.gc()
  const rssAfter = process.memoryUsage().rss

  // Parity: the stateful snapshot and delta must equal the TS reference replaying the batches.
  const tsIndex = new reference.CollabFoldIndex()
  for (const batch of batches) tsIndex.appendBatch(batch)
  const paritySnapshot = snapshot === tsIndex.snapshot()
  const parityDelta = index.deltaSince(0) === tsIndex.deltaSince(0)
  const parityOneShot = snapshot === reference.foldCollabRecords(fullJson)
  if (!paritySnapshot || !parityDelta || !parityOneShot) {
    console.log('PARITY_FAIL ' + impl + '/' + String(size) + ' snapshot=' + String(paritySnapshot) + ' delta=' + String(parityDelta) + ' oneShot=' + String(parityOneShot))
    process.exit(3)
  }

  console.log('__INCR__' + JSON.stringify({
    impl,
    size,
    loadMs,
    batches: batches.length,
    appendTotalMs,
    appendRowsPerSec,
    oneShotP50Ms,
    snapshotP50Ms: percentile(snapshotTimes, 50),
    snapshotP99Ms: percentile(snapshotTimes, 99),
    deltaP50Ms: percentile(deltaTimes, 50),
    deltaP99Ms: percentile(deltaTimes, 99),
    rssDeltaBytes: rssAfter - rssBefore,
    snapshotBytes: Buffer.byteLength(snapshot),
    records: index.records(),
    version: index.version(),
    checksum: index.checksum(),
    parity: 'snapshot+delta byte-identical to TS',
  }))
  return null
}

/** The parent: run one child per (implementation, size), print and persist. */
function runParent() {
  const runs = []
  for (const impl of ['rust', 'ts']) {
    for (const size of SIZES) {
      const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), CHILD_FLAG, impl, String(size)], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
      if (child.error) throw child.error
      const line = (child.stdout ?? '').split('\n').find((candidate) => candidate.startsWith('__INCR__'))
      if (child.status !== 0 || line === undefined) {
        throw new Error('incremental child ' + impl + '/' + String(size) + ' failed (exit ' + String(child.status) + ')\n' + String(child.stdout) + String(child.stderr))
      }
      runs.push(JSON.parse(line.slice('__INCR__'.length)))
    }
  }

  const rows = [['rows', 'impl', 'append rows/s', 'append total ms', 'snapshot p50 ms', 'snapshot p99 ms', 'one-shot p50 ms', 'delta p50 ms', 'RSS delta MB', 'snapshot KB']]
  for (const run of runs) {
    rows.push([
      String(run.size),
      run.impl,
      run.appendRowsPerSec.toFixed(0),
      run.appendTotalMs.toFixed(1),
      run.snapshotP50Ms.toFixed(2),
      run.snapshotP99Ms.toFixed(2),
      run.oneShotP50Ms.toFixed(2),
      run.deltaP50Ms.toFixed(3),
      (run.rssDeltaBytes / (1024 * 1024)).toFixed(2),
      (run.snapshotBytes / 1024).toFixed(0),
    ])
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  const table = rows.map((row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ')).join('\n')
  console.log('\n' + table + '\n')

  const verdicts = []
  for (const size of SIZES) {
    const rust = runs.find((run) => run.impl === 'rust' && run.size === size)
    const ts = runs.find((run) => run.impl === 'ts' && run.size === size)
    const appendRatio = rust.appendRowsPerSec / ts.appendRowsPerSec
    const snapshotRatio = ts.snapshotP50Ms / rust.snapshotP50Ms
    const oneShotQueryRatio = rust.oneShotP50Ms / rust.snapshotP50Ms
    verdicts.push({ size, appendRatio, snapshotRatio, oneShotQueryRatio })
    console.log(String(size) + ' rows: append ' + appendRatio.toFixed(2) + 'x, snapshot ' + snapshotRatio.toFixed(2)
      + 'x, native query vs native one-shot ' + oneShotQueryRatio.toFixed(1) + 'x')
  }

  let rustc = 'unknown'
  const rustcResult = spawnSync('rustc', ['--version'], { encoding: 'utf8' })
  if (rustcResult.status === 0) rustc = String(rustcResult.stdout).trim()

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    os: nodeVersion(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    rustc,
    addonBytes: existsSync(ADDON) ? statSync(ADDON).size : null,
    fixture: { seed: '0x5eed5eed', batchSize: BATCH_SIZE, sizes: SIZES, queryRepeats: QUERY_REPEATS },
    method: 'one child process per (implementation, size); JSON batch strings pre-built; append includes JSON.parse + fold only; RSS delta across the append phase; parity against the TS index replaying the same batches',
    parity: 'every snapshot and delta byte-identical to the TS reference',
    threshold: 'migrate only when the incremental native path is >= 2x the TS incremental path on append throughput or snapshot latency',
    verdicts,
    runs,
  }
  writeFileSync(RESULTS_PATH, JSON.stringify(report, null, 2) + '\n')
  console.log('\nresults written: ' + RESULTS_PATH)
}

if (process.argv.includes(CHILD_FLAG)) {
  await runChild(process.argv[3], Number(process.argv[4]))
} else {
  runParent()
}
