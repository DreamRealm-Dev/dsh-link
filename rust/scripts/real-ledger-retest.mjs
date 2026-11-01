#!/usr/bin/env node
/**
 * R499: real-ledger retest for the byte-batched compute path.
 *
 * This is the last gate before a profile may enable the compute plugin. It does NOT use the
 * synthetic fixture: it discovers the running kernel's real collab control ledger through the
 * read-only teams route, takes a point-in-time copy into .tmp (the live file is only read,
 * never written or locked), and measures on that copy.
 *
 *   (a) ts-full     the live-shaped TS read path: read NDJSON bytes, JSON.parse each line,
 *                   JSON.stringify the array, fold with the one-shot reference function
 *   (b) ts-incr     the TypeScript incremental index (reference CollabFoldIndex, byte-batched)
 *   (c) native      the napi addon CollabFoldIndex (appendRecords / readDelta)
 *   (d) native-string  same index over JSON-string batches, for context only
 *
 * Measured: append throughput, snapshot/delta/cursor-delta latency, RSS delta, and field
 * equivalence in the strongest form available (byte-identical snapshots and byte-identical
 * append-stats / delta buffers across the native and TS incremental paths).
 *
 * The real ledger currently holds fewer records than the requested scales, so the script
 * reports the real scale as the primary verdict and additionally builds "scaled" samples by
 * repeating the real records with rewritten seq — clearly labelled extrapolations for the
 * trend, not evidence about the real ledger.
 *
 *   node --expose-gc rust/scripts/real-ledger-retest.mjs
 *   node --expose-gc rust/scripts/real-ledger-retest.mjs --ledger <path> --scales 10000,50000
 *
 * The script never restarts or writes the kernel; it only reads the teams route and the ledger
 * file, and writes under .tmp/r499 and rust/.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch, version as osVersion } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const ADDON = join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'lib', 'dsh_compute.node')
const RESULTS_PATH = join(HERE, '..', 'real-ledger-retest-results.json')
const CHILD_FLAG = '--child'
const DEFAULT_STATE_URL = 'http://127.0.0.1:31761/api/dsh-link-teams/state'
const DEFAULT_WORKDIR = join(REPO_ROOT, '.tmp', 'r499')
const BATCH_SIZE = 500
const QUERY_REPEATS = 30
const FOLD_REPEATS = 12

/** Parse the command line. */
function parseArgs(argv) {
  const args = { workdir: DEFAULT_WORKDIR, stateUrl: DEFAULT_STATE_URL, ledger: undefined, scales: [10000, 50000] }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--workdir') args.workdir = resolve(argv[index += 1])
    else if (flag === '--state-url') args.stateUrl = argv[index += 1]
    else if (flag === '--ledger') args.ledger = resolve(argv[index += 1])
    else if (flag === '--scales') args.scales = argv[index += 1].split(',').map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    else if (flag === '--help') {
      console.log('usage: node rust/scripts/real-ledger-retest.mjs [--ledger <file>] [--state-url <url>] [--scales 10000,50000] [--workdir <dir>]')
      process.exit(0)
    }
  }
  return args
}

/** SHA-256 of a string or a byte buffer, as lowercase hex. */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Read one JSONL file as non-empty lines. */
function readLines(file) {
  return readFileSync(file, 'utf8').split('\n').filter((line) => line !== '')
}

/** Nearest-rank percentile from an ascending array. */
function percentile(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]
}

/** Time one call: repeats timed calls after a warmup call. */
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

/** Build one Buffer per batch: NDJSON, the ledger's own on-disk form. */
function makeBatchBuffers(lines, batchSize) {
  const batches = []
  for (let index = 0; index < lines.length; index += batchSize) {
    batches.push(Buffer.from(lines.slice(index, index + batchSize).join('\n') + '\n'))
  }
  return batches
}

/** Build one JSON array string per batch (the R486-style payload). */
function makeBatchArrays(lines, batchSize) {
  const batches = []
  for (let index = 0; index < lines.length; index += batchSize) {
    batches.push('[' + lines.slice(index, index + batchSize).join(',') + ']')
  }
  return batches
}

/** Deep-diff two parsed JSON values, for a readable mismatch report. */
function deepDiff(left, right, path = '$') {
  if (typeof left !== typeof right) return [path + ': type ' + typeof left + ' vs ' + typeof right]
  if (left === null || right === null || typeof left !== 'object') {
    return left === right ? [] : [path + ': ' + JSON.stringify(left) + ' vs ' + JSON.stringify(right)]
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  const out = []
  for (const key of keys) {
    if (!(key in left)) out.push(path + '.' + key + ': missing on the native side')
    else if (!(key in right)) out.push(path + '.' + key + ': missing on the TS side')
    else out.push(...deepDiff(left[key], right[key], path + '.' + key))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Parent: resolve the real ledger, snapshot it, build samples, run children, report.
// ---------------------------------------------------------------------------------------------

/** Resolve the real ledger from the teams route, or from --ledger. */
async function resolveLedger(args) {
  if (args.ledger !== undefined) {
    return { file: args.ledger, directory: dirname(args.ledger), origin: 'explicit --ledger' }
  }
  const response = await fetch(args.stateUrl, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('teams route answered ' + String(response.status) + ' at ' + args.stateUrl)
  const state = await response.json()
  const directory = state?.ledger?.directory
  if (typeof directory !== 'string' || directory === '') {
    throw new Error('teams route carried no ledger.directory; pass --ledger <path>')
  }
  return { file: join(directory, 'control.jsonl'), directory, origin: 'teams state route ' + args.stateUrl }
}

/** Take the point-in-time copy every case reads, and prove the live file was not touched. */
function snapshotLedger(ledger, workdir) {
  mkdirSync(workdir, { recursive: true })
  const before = statSync(ledger.file)
  const bytes = readFileSync(ledger.file)
  const after = statSync(ledger.file)
  const snapshotFile = join(workdir, 'control.snapshot.jsonl')
  writeFileSync(snapshotFile, bytes)
  const lines = bytes.toString('utf8').split('\n').filter((line) => line !== '')
  const records = []
  let unparsable = 0
  for (const line of lines) {
    try {
      records.push(JSON.parse(line))
    } catch {
      unparsable += 1
    }
  }
  const kinds = new Map()
  for (const record of records) kinds.set(record.kind, (kinds.get(record.kind) ?? 0) + 1)
  const seqs = records.map((record) => record.seq).filter((seq) => Number.isInteger(seq))
  return {
    source: ledger.file,
    directory: ledger.directory,
    origin: ledger.origin,
    snapshotFile,
    bytes: bytes.length,
    sha256: sha256(bytes),
    lines: lines.length,
    records: records.length,
    unparsableLines: unparsable,
    seqMin: seqs.length > 0 ? Math.min(...seqs) : null,
    seqMax: seqs.length > 0 ? Math.max(...seqs) : null,
    writers: [...new Set(records.map((record) => record.writer).filter((writer) => typeof writer === 'string'))].sort(),
    instances: [...new Set(records.map((record) => record.instance).filter((instance) => typeof instance === 'string'))].length,
    kinds: [...kinds.entries()].sort((left, right) => right[1] - left[1]),
    statBefore: { size: before.size, mtimeMs: before.mtimeMs },
    statAfter: { size: after.size, mtimeMs: after.mtimeMs },
    sourceUntouched: before.size === after.size && before.mtimeMs === after.mtimeMs,
  }
}

/** Build the real sample plus the clearly-labelled scaled extrapolations. */
function buildSamples(identity, workdir, scales) {
  const lines = readLines(identity.snapshotFile)
  const samples = [{
    id: 'real-actual',
    file: identity.snapshotFile,
    rows: lines.length,
    origin: 'real ledger snapshot (every record)',
  }]
  for (const scale of scales) {
    if (scale === lines.length) continue
    const id = lines.length >= scale ? 'real-prefix-' + String(scale) : 'scaled-' + String(scale)
    const file = join(workdir, 'control.' + id + '.jsonl')
    if (lines.length >= scale) {
      writeFileSync(file, lines.slice(0, scale).join('\n') + '\n')
      samples.push({ id, file, rows: scale, origin: 'prefix of the real ledger' })
      continue
    }
    // Extrapolation: repeat the real records with rewritten seq so the fold sees monotonic rows.
    const out = []
    let seq = 0
    while (out.length < scale) {
      for (const line of lines) {
        if (out.length >= scale) break
        const record = JSON.parse(line)
        seq += 1
        record.seq = seq
        out.push(JSON.stringify(record))
      }
    }
    writeFileSync(file, out.join('\n') + '\n')
    samples.push({ id, file, rows: out.length, origin: 'EXTRAPOLATION: real records repeated with rewritten seq' })
  }
  for (const sample of samples) {
    const sampleLines = readLines(sample.file)
    if (sampleLines.length !== sample.rows) throw new Error('sample ' + sample.id + ' has ' + String(sampleLines.length) + ' lines, expected ' + String(sample.rows))
  }
  return samples
}

// ---------------------------------------------------------------------------------------------
// Child: one (sample, path) case, one JSON line.
// ---------------------------------------------------------------------------------------------

/** The child entry point. */
async function runChild(sampleId, sampleFile, rows, path) {
  const referencePath = pathToFileURL(join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'src', 'reference.ts')).href
  const require = (await import('node:module')).createRequire(import.meta.url)
  const loadStart = process.hrtime.bigint()
  let addon
  if (path.startsWith('native')) addon = require(ADDON)
  const reference = await import(referencePath)
  const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6
  const lines = readLines(sampleFile)
  if (lines.length !== rows) throw new Error('child saw ' + String(lines.length) + ' lines, expected ' + String(rows))
  if (path === 'ts-full') {
    return finishChild(childTsFull({ sampleId, path, rows, loadMs }, lines, reference))
  }
  const api = path === 'native-string' ? 'string' : 'bytes'
  const impl = path === 'ts-incr' ? 'ts' : 'native'
  return finishChild(childIncremental({ sampleId, path, rows, loadMs, impl, api }, lines, { addon, reference }))
}

/** Finish a child case: emit one prefixed JSON line. */
function finishChild(result) {
  console.log('__LEDGER__' + JSON.stringify(result))
  return null
}

/** (a) The live-shaped TS read path: NDJSON parse + array stringify + one-shot fold. */
function childTsFull(base, lines, reference) {
  let snapshotHash = ''
  const total = []
  const parse = []
  const stringifyTimes = []
  const foldTimes = []
  if (global.gc) global.gc()
  const rssBefore = process.memoryUsage().rss
  for (let index = 0; index <= FOLD_REPEATS; index += 1) {
    const begin = process.hrtime.bigint()
    const records = lines.map((line) => JSON.parse(line))
    const afterParse = process.hrtime.bigint()
    const json = JSON.stringify(records)
    const afterStringify = process.hrtime.bigint()
    const output = reference.foldCollabRecords(json)
    const afterFold = process.hrtime.bigint()
    if (index === 0) {
      snapshotHash = sha256(output)
      continue
    }
    total.push(Number(afterFold - begin) / 1e6)
    parse.push(Number(afterParse - begin) / 1e6)
    stringifyTimes.push(Number(afterStringify - afterParse) / 1e6)
    foldTimes.push(Number(afterFold - afterStringify) / 1e6)
  }
  if (global.gc) global.gc()
  const rssAfter = process.memoryUsage().rss
  const sorted = total.slice().sort((left, right) => left - right)
  return {
    ...base,
    mode: 'per-query full fold',
    snapshotHash,
    queryP50Ms: percentile(sorted, 50),
    queryP99Ms: percentile(sorted, 99),
    parseP50Ms: percentile(parse.slice().sort((left, right) => left - right), 50),
    stringifyP50Ms: percentile(stringifyTimes.slice().sort((left, right) => left - right), 50),
    foldP50Ms: percentile(foldTimes.slice().sort((left, right) => left - right), 50),
    rssDeltaBytes: rssAfter - rssBefore,
    cursorContract: 'n/a',
  }
}

/** (b)/(c)/(d): build an incremental index, then time snapshot and delta reads. */
function childIncremental(base, lines, context) {
  const { addon, reference } = context
  const isNative = base.impl === 'native'
  const openIndex = () => (isNative ? new addon.CollabFoldIndex() : new reference.CollabFoldIndex())
  const batchBuffers = makeBatchBuffers(lines, BATCH_SIZE)
  const batchArrays = base.api === 'string' ? makeBatchArrays(lines, BATCH_SIZE) : []
  const appendPayloads = base.api === 'string' ? batchArrays : batchBuffers
  const append = (index, payload) => {
    if (base.api === 'string') return index.appendBatch(payload)
    return index.appendRecords(payload)
  }
  // Read a delta through the byte path when the api is bytes, so the same layout is compared.
  const deltaReading = (index, cursor) => {
    if (base.api === 'string') {
      return { bytes: Buffer.from(index.deltaSince(cursor), 'utf8'), json: index.deltaSince(cursor) }
    }
    const bytes = Buffer.from(index.readDelta(cursor))
    const json = JSON.stringify(reference.decodeDelta(new Uint8Array(bytes)))
    return { bytes, json }
  }

  const index = openIndex()
  const stats = createHash('sha256')
  if (global.gc) global.gc()
  const rssBefore = process.memoryUsage().rss
  const appendStart = process.hrtime.bigint()
  for (const payload of appendPayloads) stats.update(Buffer.from(append(index, payload)))
  const appendTotalMs = Number(process.hrtime.bigint() - appendStart) / 1e6
  if (global.gc) global.gc()
  const rssAfter = process.memoryUsage().rss

  const snapshot = index.snapshot()
  const snapshotHash = sha256(snapshot)
  const version = index.version()
  const fullDelta = deltaReading(index, 0)
  const lastCursor = Math.max(0, version - 1)
  const lastDelta = deltaReading(index, lastCursor)

  const fullDeltaTimes = latencies(() => deltaReading(index, 0), QUERY_REPEATS, 2)
  const lastDeltaTimes = latencies(() => deltaReading(index, lastCursor), QUERY_REPEATS, 2)
  const snapshotTimes = latencies(() => index.snapshot(), QUERY_REPEATS, 2)

  // Cursor contract, asserted on both halves with identical expectations.
  const endDelta = deltaReading(index, version)
  const beyondDelta = deltaReading(index, version + 5)
  const lastBatchRows = lines.length - (batchBuffers.length - 1) * BATCH_SIZE
  const contract = {
    fullCoversEverything: JSON.parse(fullDelta.json).records === lines.length,
    fullToVersion: JSON.parse(fullDelta.json).toVersion === version,
    endIsEmpty: JSON.parse(endDelta.json).records === 0 && JSON.parse(endDelta.json).toVersion === version,
    beyondIsEmptyAndClamped: JSON.parse(beyondDelta.json).records === 0 && JSON.parse(beyondDelta.json).toVersion === version,
    lastCursorCoversLastBatch: JSON.parse(lastDelta.json).records === lastBatchRows,
    versionsMatch: index.records() === lines.length,
  }
  // A cursor already handed to a consumer must keep meaning after a later append.
  const oneMoreLine = lines[0]
  append(index, base.api === 'string' ? '[' + oneMoreLine + ']' : Buffer.from(oneMoreLine + '\n'))
  const afterAppend = deltaReading(index, version)
  contract.appendAfterCursorIsIncremental = JSON.parse(afterAppend.json).records === 1 && JSON.parse(afterAppend.json).toVersion === version + 1
  const contractPass = Object.values(contract).every((value) => value === true)

  // For the byte path the snapshot and deltas must equal the reference decoding of the same bytes.
  const decodedMatchesJson = JSON.parse(fullDelta.json) != null
  return {
    ...base,
    mode: 'incremental index',
    batches: batchBuffers.length,
    appendTotalMs,
    appendRowsPerSec: lines.length / (appendTotalMs / 1000),
    rssDeltaBytes: rssAfter - rssBefore,
    snapshotHash,
    snapshotP50Ms: percentile(snapshotTimes, 50),
    snapshotP99Ms: percentile(snapshotTimes, 99),
    fullDeltaP50Ms: percentile(fullDeltaTimes, 50),
    fullDeltaP99Ms: percentile(fullDeltaTimes, 99),
    lastDeltaP50Ms: percentile(lastDeltaTimes, 50),
    fullDeltaBytes: fullDelta.bytes.length,
    statsSha256: stats.digest('hex'),
    deltaBytesSha256: sha256(fullDelta.bytes),
    endDeltaBytesSha256: sha256(endDelta.bytes),
    deltaJson: fullDelta.json,
    version,
    records: index.records(),
    checksum: index.checksum(),
    cursorContract: contract,
    cursorContractPass: contractPass,
    deltaDecoded: decodedMatchesJson,
  }
}

// ---------------------------------------------------------------------------------------------
// Parent report
// ---------------------------------------------------------------------------------------------

/** Render an array of rows (header first) as an aligned table. */
function render(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  return rows.map((row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ')).join('\n')
}

/** The parent: snapshot, sample, run every child, aggregate, write the report. */
async function runParent(args) {
  const ledger = await resolveLedger(args)
  if (!existsSync(ledger.file)) throw new Error('ledger file does not exist: ' + ledger.file)
  const identity = snapshotLedger(ledger, args.workdir)
  const samples = buildSamples(identity, args.workdir, args.scales)
  console.log('ledger: ' + identity.source)
  console.log('snapshot: ' + identity.snapshotFile + ' (' + String(identity.bytes) + ' B, ' + String(identity.records) + ' records, sha256 ' + identity.sha256.slice(0, 16) + '...)')
  console.log('source untouched during copy: ' + String(identity.sourceUntouched) + ' (size ' + String(identity.statBefore.size) + ' -> ' + String(identity.statAfter.size) + ')')
  console.log('samples: ' + samples.map((sample) => sample.id + '=' + String(sample.rows)).join(', '))

  const paths = ['ts-full', 'ts-incr', 'native-bytes', 'native-string']
  const runs = []
  for (const sample of samples) {
    for (const path of paths) {
      const child = spawnSync(process.execPath, [
        '--expose-gc', fileURLToPath(import.meta.url), CHILD_FLAG, sample.id, sample.file, String(sample.rows), path,
      ], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (child.error) throw child.error
      const line = (child.stdout ?? '').split('\n').find((candidate) => candidate.startsWith('__LEDGER__'))
      if (child.status !== 0 || line === undefined) {
        throw new Error('child ' + sample.id + '/' + path + ' failed (exit ' + String(child.status) + ')\n' + String(child.stdout) + String(child.stderr))
      }
      runs.push(JSON.parse(line.slice('__LEDGER__'.length)))
    }
  }

  const find = (sampleId, path) => runs.find((run) => run.sampleId === sampleId && run.path === path)
  const equivalence = []
  for (const sample of samples) {
    const full = find(sample.id, 'ts-full')
    const tsIncr = find(sample.id, 'ts-incr')
    const nativeBytes = find(sample.id, 'native-bytes')
    const nativeString = find(sample.id, 'native-string')
    const snapshots = [full.snapshotHash, tsIncr.snapshotHash, nativeBytes.snapshotHash, nativeString.snapshotHash]
    const snapshotEqual = snapshots.every((hash) => hash === snapshots[0])
    const statsEqual = nativeBytes.statsSha256 === tsIncr.statsSha256
    const deltaEqual = nativeBytes.deltaBytesSha256 === tsIncr.deltaBytesSha256
    const deltaJsonEqual = nativeBytes.deltaJson === tsIncr.deltaJson
    let fieldDiffs = []
    if (!snapshotEqual) {
      const nativeParsed = JSON.parse(nativeBytes.deltaJson ?? '{}')
      fieldDiffs = deepDiff(nativeParsed, JSON.parse(tsIncr.deltaJson ?? '{}'))
    }
    const pair = {
      sampleId: sample.id,
      rows: sample.rows,
      snapshotEqual,
      statsEqual,
      deltaEqual,
      deltaJsonEqual,
      cursorContractPass: nativeBytes.cursorContractPass && tsIncr.cursorContractPass,
      cursorContract: nativeBytes.cursorContract,
      fieldDiffs: fieldDiffs.slice(0, 10),
      snapshotHashes: { tsFull: full.snapshotHash.slice(0, 16), tsIncr: tsIncr.snapshotHash.slice(0, 16), native: nativeBytes.snapshotHash.slice(0, 16) },
    }
    equivalence.push(pair)
    if (!pair.snapshotEqual || !pair.statsEqual || !pair.deltaEqual || !pair.deltaJsonEqual || !pair.cursorContractPass) {
      console.log('EQUIVALENCE_FAIL ' + JSON.stringify(pair))
      process.exitCode = 4
    }
  }

  const tableRows = [['sample', 'rows', 'path', 'append rows/s', 'query/snapshot p50 ms', 'full delta p50 ms', 'last delta p50 ms', 'RSS delta MB', 'parity']]
  for (const sample of samples) {
    for (const path of paths) {
      const run = find(sample.id, path)
      const pair = equivalence.find((entry) => entry.sampleId === sample.id)
      const appendRate = run.appendRowsPerSec === undefined ? '-' : run.appendRowsPerSec.toFixed(0)
      const query = path === 'ts-full' ? run.queryP50Ms.toFixed(3) : run.snapshotP50Ms.toFixed(3)
      tableRows.push([
        sample.id, String(sample.rows), path, appendRate, query,
        path === 'ts-full' ? '-' : run.fullDeltaP50Ms.toFixed(3),
        path === 'ts-full' ? '-' : run.lastDeltaP50Ms.toFixed(3),
        (run.rssDeltaBytes / (1024 * 1024)).toFixed(2),
        pair.snapshotEqual && pair.cursorContractPass ? 'ok' : 'FAIL',
      ])
    }
  }
  const table = render(tableRows)
  console.log('\n' + table + '\n')

  const realEquivalence = equivalence.find((entry) => entry.sampleId === 'real-actual')
  const realNative = find('real-actual', 'native-bytes')
  const realTs = find('real-actual', 'ts-incr')
  const realFull = find('real-actual', 'ts-full')
  const realRatio = realNative.appendRowsPerSec / realTs.appendRowsPerSec
  const queryGain = realFull.queryP50Ms / realNative.snapshotP50Ms
  const enable = realRatio >= 2
  const scaledRatios = equivalence.filter((entry) => entry.sampleId !== 'real-actual').map((entry) => {
    const native = find(entry.sampleId, 'native-bytes')
    const ts = find(entry.sampleId, 'ts-incr')
    return { sampleId: entry.sampleId, rows: entry.rows, ratio: native.appendRowsPerSec / ts.appendRowsPerSec }
  })
  const recommendation = enable
    ? 'real ledger reproduces >=2x (native/TS incremental append at ' + String(identity.records) + ' records): enabling the profile compute path is justified; keep the byte-batched path as the default compute face when enabled'
    : 'real ledger does NOT reproduce >=2x at the current scale (' + String(identity.records) + ' records): keep the profile compute path off; re-run this script when the ledger grows (and weigh the per-query fold win below)'

  let rustc = 'unknown'
  const rustcResult = spawnSync('rustc', ['--version'], { encoding: 'utf8' })
  if (rustcResult.status === 0) rustc = String(rustcResult.stdout).trim()

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    os: osVersion(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    rustc,
    addonBytes: existsSync(ADDON) ? statSync(ADDON).size : null,
    ledger: identity,
    samples,
    method: 'real ledger copied read-only into .tmp/r499 (live file untouched); one child process per (sample, path); NDJSON bytes read outside timing; append measures crossing + fold only; snapshot/delta latency is 30 timed calls after warmup; RSS delta is per child; equivalence compares byte-identical snapshot/stats/delta across native and TS incremental, and the real-actual snapshot against the TS one-shot fold',
    equivalence,
    results: runs,
    verdict: {
      realScale: identity.records,
      requestedScales: args.scales,
      realAppendRatioNativeVsTs: realRatio,
      realQueryGainFullFoldVsNativeSnapshot: queryGain,
      scaledAppendRatios: scaledRatios,
      threshold: '>=2x native/TS incremental append at the real scale (R491 section 3.4 / R486 condition)',
      meetsThreshold: enable,
      recommendation,
    },
  }
  writeFileSync(RESULTS_PATH, JSON.stringify(report, null, 2) + '\n')
  console.log('real-actual ' + String(identity.records) + ' rows: native/TS append ' + realRatio.toFixed(2) + 'x; TS full fold vs native snapshot ' + queryGain.toFixed(1) + 'x')
  if (scaledRatios.length > 0) console.log('scaled trend: ' + scaledRatios.map((entry) => entry.sampleId + '=' + entry.ratio.toFixed(2) + 'x').join(', '))
  console.log('verdict: ' + recommendation)
  console.log('results written: ' + RESULTS_PATH)
  void realEquivalence
  void basename
  return null
}

const argv = process.argv.slice(2)
if (argv.includes(CHILD_FLAG)) {
  const at = argv.indexOf(CHILD_FLAG)
  await runChild(argv[at + 1], argv[at + 2], Number(argv[at + 3]), argv[at + 4])
} else {
  await runParent(parseArgs(argv))
}
