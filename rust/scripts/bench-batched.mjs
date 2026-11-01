#!/usr/bin/env node
/**
 * Batching benchmark for the compute index: string vs byte-batched appends, and one
 * crossing per row vs one crossing per batch.
 *
 * The question this answers (R491 section 3.4): the R486 append path crossed the N-API boundary
 * with a JSON array string per batch. Before deciding to enable the byte-batched API, measure
 *
 *   - how much batching itself buys (batch = 500 rows vs batch = 1 row, same total rows);
 *   - whether the byte-batched entry beats the same-shape TS incremental implementation by the
 *     ">= 2x to enable" threshold;
 *   - what a delta read costs (full history vs the cursor that only returns the last batch);
 *   - and the RSS growth of one case.
 *
 * Every (implementation, api, rows, batchSize) case runs in its own child process, so the RSS
 * number is that case's growth and not another case's residue. Every child proves its snapshot
 * and delta agree with the TypeScript reference before its numbers are accepted (the rust child
 * compares against the TS index replaying the same payloads; the ts child against both the TS
 * one-shot fold and its own counterpart), so a benchmark row is never quoted for diverging data.
 *
 *   node --expose-gc rust/scripts/bench-batched.mjs
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch, version as osVersion } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeCollabRecords } from './fixtures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const ADDON = join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'lib', 'dsh_compute.node')
/** Archived runs live one file per run; the script never overwrites an existing archive. */
const RUNS_DIR = join(HERE, '..', 'bench-runs')
const CHILD_FLAG = '--child'
const QUERY_REPEATS = 30

/** The shapes measured. 1-row batches are the one-crossing-per-row control. */
const SHAPES = [
  { rows: 10_000, batchSize: 1 },
  { rows: 10_000, batchSize: 500 },
  { rows: 50_000, batchSize: 500 },
]

/** Nearest-rank percentile from an ascending array. */
function percentile(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]
}

/** Time repeats calls, after warmup calls, as ascending milliseconds. */
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

/** Load one implementation and measure its cold load. */
async function prepare(impl) {
  const require = createRequire(import.meta.url)
  const referencePath = pathToFileURL(join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'src', 'reference.ts')).href
  const loadStart = process.hrtime.bigint()
  if (impl === 'rust') {
    const addon = require(ADDON)
    const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6
    // The reference is imported after the clock stops: parity checking is not cold start.
    const reference = await import(referencePath)
    return { openIndex: () => new addon.CollabFoldIndex(), reference, loadMs }
  }
  const reference = await import(referencePath)
  const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6
  return { openIndex: () => new reference.CollabFoldIndex(), reference, loadMs }
}

/** Measure one case. */
async function runChild(impl, api, rows, batchSize) {
  const { openIndex, reference, loadMs } = await prepare(impl)
  const fixture = makeCollabRecords(rows)
  const slices = []
  for (let index = 0; index < fixture.rows.length; index += batchSize) {
    slices.push(fixture.rows.slice(index, index + batchSize))
  }
  const fullJson = JSON.stringify(fixture.rows)
  const payloads = api === 'string'
    ? slices.map((slice) => JSON.stringify(slice))
    : slices.map((slice) => Buffer.from(slice.map((row) => JSON.stringify(row)).join('\n') + '\n'))
  const payloadBytes = payloads.reduce((sum, payload) => sum + (api === 'string' ? Buffer.byteLength(payload) : payload.byteLength), 0)
  return finishChild({ impl, api, rows, batchSize, loadMs, payloads, payloadBytes, fullJson, openIndex, reference })
}

/** Append every payload, then time the query surface, then prove parity. */
function finishChild({ impl, api, rows, batchSize, loadMs, payloads, payloadBytes, fullJson, openIndex, reference }) {
  const append = (index, payload) => {
    if (api === 'string') index.appendBatch(payload)
    else index.appendRecords(payload)
  }
  const fullDelta = (index) => {
    if (api === 'string') return index.deltaSince(0)
    return JSON.stringify(reference.decodeDelta(index.readDelta(0)))
  }
  const cursorDelta = (index, cursor) => {
    if (api === 'string') return index.deltaSince(cursor)
    return JSON.stringify(reference.decodeDelta(index.readDelta(cursor)))
  }
  const appendMany = (index) => {
    for (const payload of payloads) append(index, payload)
  }

  // Parity before numbers: the measured implementation against the TS reference on the same payloads.
  const measured = openIndex()
  appendMany(measured)
  const snapshot = measured.snapshot()
  const expectedSnapshot = reference.foldCollabRecords(fullJson)
  const counterpart = new reference.CollabFoldIndex()
  for (const payload of payloads) {
    if (api === 'string') counterpart.appendBatch(payload)
    else counterpart.appendRecords(new Uint8Array(payload))
  }
  const paritySnapshot = snapshot === expectedSnapshot && snapshot === counterpart.snapshot()
  const parityDelta = fullDelta(measured) === counterpart.deltaSince(0)
  const parityVersion = measured.version() === counterpart.version() && measured.records() === counterpart.records()
  if (!paritySnapshot || !parityDelta || !parityVersion) {
    console.log('PARITY_FAIL ' + impl + '/' + api + '/' + String(rows) + '/' + String(batchSize)
      + ' snapshot=' + String(paritySnapshot) + ' delta=' + String(parityDelta) + ' version=' + String(parityVersion))
    process.exit(3)
  }

  // Timed: a fresh index, one crossing per payload.
  const timed = openIndex()
  if (global.gc) global.gc()
  const rssBefore = process.memoryUsage().rss
  const appendStart = process.hrtime.bigint()
  appendMany(timed)
  const appendTotalMs = Number(process.hrtime.bigint() - appendStart) / 1e6
  if (global.gc) global.gc()
  const rssAfter = process.memoryUsage().rss

  const fullDeltaTimes = latencies(() => fullDelta(timed), QUERY_REPEATS, 2)
  const cursor = timed.version() - 1
  const cursorDeltaTimes = latencies(() => cursorDelta(timed, cursor), QUERY_REPEATS, 2)
  const snapshotTimes = latencies(() => timed.snapshot(), QUERY_REPEATS, 2)
  const deltaBytes = Buffer.byteLength(fullDelta(timed))

  console.log('__BATCH__' + JSON.stringify({
    impl,
    api,
    rows,
    batchSize,
    crossings: payloads.length,
    loadMs,
    payloadBytes,
    appendTotalMs,
    appendRowsPerSec: rows / (appendTotalMs / 1000),
    mebibytesPerSec: payloadBytes / (1024 * 1024) / (appendTotalMs / 1000),
    fullDeltaP50Ms: percentile(fullDeltaTimes, 50),
    fullDeltaP99Ms: percentile(fullDeltaTimes, 99),
    cursorDeltaP50Ms: percentile(cursorDeltaTimes, 50),
    cursorDeltaP99Ms: percentile(cursorDeltaTimes, 99),
    snapshotP50Ms: percentile(snapshotTimes, 50),
    rssDeltaBytes: rssAfter - rssBefore,
    deltaBytes,
    checksum: timed.checksum(),
    parity: 'snapshot+delta+version byte-identical to TS reference',
  }))
  return null
}

/** Render an array of rows (header first) as an aligned table. */
function render(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  return rows.map((row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ')).join('\n')
}

/**
 * Atomically claim one output path, then publish the report with tmp+rename.
 *
 * The final path is created with O_CREAT|O_EXCL (openSync 'wx'), so two processes racing on the
 * same --out cannot both win and an existing archive is never opened for writing. The report body
 * is written to a sibling temp file and renamed over the placeholder: a reader never observes a
 * half-written JSON archive, and a crashed run leaves the placeholder to be cleaned by abort().
 *
 * @param outPath - absolute archive path.
 * @returns a handle with commit(text) and abort().
 * @throws when the path already exists (an archived run is never rewritten).
 */
function claimOutput(outPath) {
  mkdirSync(dirname(outPath), { recursive: true })
  let descriptor
  try {
    descriptor = openSync(outPath, 'wx')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error('refusing to overwrite an archived run: ' + outPath + ' (use another --out or --label)')
    }
    throw error
  }
  closeSync(descriptor)
  const tempPath = outPath + '.' + String(process.pid) + '.' + randomBytes(6).toString('hex') + '.tmp'
  return {
    tempPath,
    commit(text) {
      writeFileSync(tempPath, text)
      renameSync(tempPath, outPath)
    },
    abort() {
      try {
        unlinkSync(tempPath)
      } catch {}
      try {
        unlinkSync(outPath)
      } catch {}
    },
  }
}

/** Parse the command line for the parent run. */
function parseParentArgs(argv) {
  const args = { out: undefined, label: 'run', reserveOnly: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--out') args.out = resolve(argv[index += 1])
    else if (flag === '--label') args.label = argv[index += 1]
    else if (flag === '--reserve-only') args.reserveOnly = true
    else if (flag === '--help') {
      console.log('usage: node --expose-gc rust/scripts/bench-batched.mjs [--out <file>] [--label <run-label>]')
      process.exit(0)
    }
  }
  return args
}

/** The parent: run every case in its own child, print tables, write the report. */
function runParent(args) {
  const startedAt = new Date()
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const runId = stamp + '-' + args.label
  const outPath = args.out === undefined ? join(RUNS_DIR, 'bench-batched-' + runId + '.json') : args.out
  // Claim the path before doing any work: concurrent runs on the same --out cannot both succeed.
  const archive = claimOutput(outPath)
  if (args.reserveOnly) {
    archive.commit(JSON.stringify({ runId, reservedAt: new Date().toISOString(), outPath, mode: 'reserve-only' }, null, 2) + '\n')
    console.log('reserved: ' + runId + ' -> ' + outPath)
    return
  }
  const runs = []
  for (const shape of SHAPES) {
    for (const api of ['string', 'bytes']) {
      for (const impl of ['rust', 'ts']) {
        const args = ['--expose-gc', fileURLToPath(import.meta.url), CHILD_FLAG, impl, api, String(shape.rows), String(shape.batchSize)]
        const child = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
        if (child.error) throw child.error
        const line = (child.stdout ?? '').split('\n').find((candidate) => candidate.startsWith('__BATCH__'))
        if (child.status !== 0 || line === undefined) {
          throw new Error('batched child ' + impl + '/' + api + '/' + String(shape.rows) + '/b' + String(shape.batchSize)
            + ' failed (exit ' + String(child.status) + ')\n' + String(child.stdout) + String(child.stderr))
        }
        runs.push(JSON.parse(line.slice('__BATCH__'.length)))
      }
    }
  }

  const find = (impl, api, rows, batchSize) => runs.find((run) => run.impl === impl && run.api === api && run.rows === rows && run.batchSize === batchSize)

  const appendRows = [['rows', 'api', 'impl', 'batch', 'crossings', 'rows/s', 'MiB/s', 'append ms', 'full delta p50 ms', 'cursor delta p50 ms', 'snapshot p50 ms', 'RSS delta MB']]
  for (const run of runs) {
    appendRows.push([
      String(run.rows), run.api, run.impl, String(run.batchSize), String(run.crossings),
      run.appendRowsPerSec.toFixed(0), run.mebibytesPerSec.toFixed(1), run.appendTotalMs.toFixed(1),
      run.fullDeltaP50Ms.toFixed(4), run.cursorDeltaP50Ms.toFixed(4), run.snapshotP50Ms.toFixed(3),
      (run.rssDeltaBytes / (1024 * 1024)).toFixed(2),
    ])
  }
  console.log('\n' + render(appendRows) + '\n')

  const batchingRows = [['rows', 'api', 'impl', 'batch 1 rows/s', 'batch 500 rows/s', 'batching multiple', 'crossings saved']]
  for (const api of ['string', 'bytes']) {
    for (const impl of ['rust', 'ts']) {
      const one = find(impl, api, 10_000, 1)
      const many = find(impl, api, 10_000, 500)
      batchingRows.push([String(10_000), api, impl, one.appendRowsPerSec.toFixed(0), many.appendRowsPerSec.toFixed(0),
        (many.appendRowsPerSec / one.appendRowsPerSec).toFixed(2) + 'x', String(one.crossings - many.crossings)])
    }
  }
  console.log('batching multiple (10k rows, batch 500 vs batch 1):\n' + render(batchingRows) + '\n')

  const ratios = []
  for (const rows of [10_000, 50_000]) {
    const batchSize = 500
    const nativeBytes = find('rust', 'bytes', rows, batchSize)
    const tsBytes = find('ts', 'bytes', rows, batchSize)
    const nativeString = find('rust', 'string', rows, batchSize)
    const tsString = find('ts', 'string', rows, batchSize)
    ratios.push({
      rows,
      batchSize,
      bytes: { rust: nativeBytes.appendRowsPerSec, ts: tsBytes.appendRowsPerSec, ratio: nativeBytes.appendRowsPerSec / tsBytes.appendRowsPerSec },
      string: { rust: nativeString.appendRowsPerSec, ts: tsString.appendRowsPerSec, ratio: nativeString.appendRowsPerSec / tsString.appendRowsPerSec },
      byteVsStringNative: { rust: nativeBytes.appendRowsPerSec / nativeString.appendRowsPerSec, ts: tsBytes.appendRowsPerSec / tsString.appendRowsPerSec },
      deltaBytes: nativeBytes.deltaBytes,
    })
  }
  const ratioRows = [['rows', 'api', 'rust rows/s', 'ts rows/s', 'rust/ts', 'verdict']]
  for (const entry of ratios) {
    for (const api of ['bytes', 'string']) {
      const ratio = entry[api].ratio
      ratioRows.push([String(entry.rows), api, entry[api].rust.toFixed(0), entry[api].ts.toFixed(0), ratio.toFixed(2) + 'x',
        ratio >= 2 ? 'meets >=2x' : ratio >= 1.2 ? 'optional (1.2-2x)' : 'below 1.2x'])
    }
  }
  console.log('native vs incremental TS (batch 500):\n' + render(ratioRows) + '\n')

  // Caller-side prep context: what a JS producer holding objects pays for each form. A producer
  // that already holds the ledger's raw bytes pays a buffer slice instead (not measured here).
  const prepFixture = makeCollabRecords(10_000)
  const medianOf = (fn, repeats = 3) => {
    const times = []
    for (let index = 0; index < repeats; index += 1) {
      const begin = process.hrtime.bigint()
      fn()
      times.push(Number(process.hrtime.bigint() - begin) / 1e6)
    }
    return times.sort((left, right) => left - right)[Math.floor(times.length / 2)]
  }
  const prep = {
    stringifyArrayMs: medianOf(() => JSON.stringify(prepFixture.rows)),
    encodeNdjsonMs: medianOf(() => prepFixture.rows.map((row) => JSON.stringify(row)).join('\n') + '\n'),
    note: 'both prep forms serialise the same objects; the byte API only removes prep cost for a producer that already holds raw ledger bytes',
  }
  console.log('caller-side prep from JS objects (10k rows): stringify array ' + prep.stringifyArrayMs.toFixed(1)
    + 'ms, encode NDJSON ' + prep.encodeNdjsonMs.toFixed(1) + 'ms\n')

  const primary = {
    '@10k bytes': ratios[0].bytes.ratio,
    '@50k bytes': ratios[1].bytes.ratio,
    '@10k string': ratios[0].string.ratio,
    '@50k string': ratios[1].string.ratio,
  }
  const meets = primary['@50k bytes'] >= 2 && primary['@10k bytes'] >= 2
  const recommendation = meets
    ? 'enable the byte-batched native path: the same-shape native/TS append ratio is >=2x at both 10k and 50k'
    : 'do not enable yet: the same-shape native/TS append ratio does not clear >=2x at both 10k and 50k'

  let rustc = 'unknown'
  const rustcResult = spawnSync('rustc', ['--version'], { encoding: 'utf8' })
  if (rustcResult.status === 0) rustc = String(rustcResult.stdout).trim()

  const addonSha256 = existsSync(ADDON) ? createHash('sha256').update(readFileSync(ADDON)).digest('hex') : null
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    outPath,
    node: process.version,
    os: osVersion(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    rustc,
    addonBytes: existsSync(ADDON) ? statSync(ADDON).size : null,
    addonSha256,
    fixture: { seed: '0x5eed5eed', shapes: SHAPES, queryRepeats: QUERY_REPEATS },
    method: 'one child process per (impl, api, rows, batchSize); payloads pre-built before timing; append includes the crossing plus the native/TS fold only, not fixture construction; RSS delta across the append phase; parity against the TS reference replaying the same payloads',
    parity: 'every snapshot, delta and version byte-identical to the TS reference',
    threshold: '>=2x native/TS at the same api shape (recommended criterion from R491 section 3.4)',
    primaryRatios: primary,
    meetsThreshold: meets,
    recommendation,
    callerPrep: prep,
    batchingMultiples: batchingRows.slice(1).map((row) => ({ rows: Number(row[0]), api: row[1], impl: row[2], multiple: row[5] })),
    runs,
  }
  try {
    archive.commit(JSON.stringify(report, null, 2) + '\n')
  } catch (error) {
    archive.abort()
    throw error
  }
  console.log('run: ' + runId + ' @ ' + report.generatedAt)
  console.log('verdict: ' + recommendation)
  console.log('results written: ' + outPath)
}

if (process.argv.includes(CHILD_FLAG)) {
  await runChild(process.argv[3], process.argv[4], Number(process.argv[5]), Number(process.argv[6]))
} else {
  try {
    runParent(parseParentArgs(process.argv.slice(2)))
  } catch (error) {
    console.error('[bench-batched] FAILED: ' + (error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}
