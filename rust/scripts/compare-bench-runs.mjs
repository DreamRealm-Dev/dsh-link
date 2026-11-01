#!/usr/bin/env node
/**
 * R506 absolute regression gate: native throughput must not drop more than a fixed bound versus
 * the previous archived version.
 *
 * The ratio threshold in R497 (native/TS >= 2x) is a *comparison between the two halves of one
 * code version at one shape*. It says nothing about whether this version's native side got slower
 * than last version's native side. This gate closes that hole: same native case (api, rows, batch)
 * in the baseline archive and the current archive, median append throughput compared, and a drop
 * larger than --max-drop-pct fails the gate.
 *
 *   node rust/scripts/compare-bench-runs.mjs \
 *     --baseline-manifest rust/bench-runs/baseline.json \
 *     --current rust/bench-runs/bench-batched-*-r506-run*.json
 *
 * Exit 0 = within bound, 1 = regression beyond the bound (or no comparable cases).
 */
import { globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const DEFAULT_MANIFEST = join(HERE, '..', 'bench-runs', 'baseline.json')

/** Parse the command line. */
function parseArgs(argv) {
  const args = { manifest: DEFAULT_MANIFEST, current: [], maxDropPct: 10, minRuns: 5 }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--baseline-manifest') args.manifest = resolve(argv[index += 1])
    else if (flag === '--current') args.current.push(argv[index += 1])
    else if (flag === '--max-drop-pct') args.maxDropPct = Number(argv[index += 1])
    else if (flag === '--min-runs') args.minRuns = Number(argv[index += 1])
    else if (flag === '--help') {
      console.log('usage: node rust/scripts/compare-bench-runs.mjs [--baseline-manifest <file>] --current <glob-or-file...> [--max-drop-pct 10] [--min-runs 5]')
      process.exit(0)
    }
  }
  if (args.current.length === 0) throw new Error('pass at least one --current <glob-or-file>')
  return args
}

/** Expand one file or glob argument to absolute paths. */
function filesOf(argument) {
  const pattern = resolve(argument)
  if (!pattern.includes('*')) return [pattern]
  const found = globSync(pattern)
  if (found.length === 0) throw new Error('no files match ' + argument)
  return found.sort()
}

/** Load one archived run and fail loudly when it is not a full report. */
function loadRun(file) {
  const run = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(run.runs)) throw new Error(file + ' is not a bench-batched archive (no runs array)')
  return { file, run }
}

/** The median of one numeric array. */
function median(values) {
  const sorted = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Key one native case. */
function caseKey(entry) {
  return entry.api + '/' + String(entry.rows) + '/b' + String(entry.batchSize)
}

/** Aggregate one archive set into native-case medians. */
function nativeMedians(archiveSet) {
  const cases = new Map()
  for (const { run } of archiveSet) {
    for (const entry of run.runs) {
      if (entry.impl !== 'rust') continue
      const key = caseKey(entry)
      const bucket = cases.get(key) ?? []
      bucket.push(entry.appendRowsPerSec)
      cases.set(key, bucket)
    }
  }
  const medians = new Map()
  for (const [key, values] of cases) medians.set(key, { median: median(values), runs: values.length })
  return medians
}

/** The gate. */
function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
  const baselineFiles = manifest.files.map((file) => resolve(REPO_ROOT, file))
  const baseline = baselineFiles.map(loadRun)
  const current = args.current.flatMap(filesOf).map(loadRun)
  const baselineMedians = nativeMedians(baseline)
  const currentMedians = nativeMedians(current)

  const rows = [['native case', 'baseline rows/s', 'current rows/s', 'change', 'verdict']]
  const failures = []
  for (const [key, base] of [...baselineMedians.entries()].sort()) {
    const now = currentMedians.get(key)
    if (now === undefined) {
      rows.push([key, String(Math.round(base.median)), 'missing', '—', 'not measured'])
      failures.push(key + ': current archive does not measure this case (cannot prove no regression)')
      continue
    }
    const changePct = ((now.median - base.median) / base.median) * 100
    const verdict = changePct < -args.maxDropPct ? 'REGRESSION' : changePct < 0 ? 'within bound (slower)' : 'improved'
    if (changePct < -args.maxDropPct) {
      failures.push(key + ': ' + changePct.toFixed(1) + '% slower (bound ' + String(-args.maxDropPct) + '%)')
    }
    rows.push([key, String(Math.round(base.median)), String(Math.round(now.median)), (changePct >= 0 ? '+' : '') + changePct.toFixed(1) + '%', verdict])
  }

  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  for (const row of rows) {
    console.log(row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  '))
  }
  console.log('')
  console.log('baseline: ' + manifest.label + ' (' + String(baseline.length) + ' archived runs: ' + manifest.runIds.join(', ') + ')')
  console.log('current:  ' + String(current.length) + ' archived runs')
  if (current.length < args.minRuns) {
    // Shared machines produce run-to-run swings far larger than the 10% bound (measured up to
    // about 20% on a single case), so a median of fewer than minRuns rounds can flag pure noise.
    console.log('WARNING:  fewer than ' + String(args.minRuns) + ' current runs; the median is noise-prone.'
      + ' Re-run more rounds before treating a failure as a code regression.')
  }
  console.log('bound:    native throughput drop <= ' + String(args.maxDropPct) + '% per case')
  if (failures.length > 0) {
    console.error('REGRESSION GATE FAIL (' + String(failures.length) + ' case(s))')
    for (const failure of failures) console.error('  FAIL ' + failure)
    process.exit(1)
  }
  console.log('REGRESSION GATE PASS: every native case within the bound')
}

main()
