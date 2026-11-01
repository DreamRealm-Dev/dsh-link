#!/usr/bin/env node
/**
 * R421 - the DRSS results table, computed by a script instead of by hand.
 *
 * Why this exists: the R416 report's three axis tables were hand-computed (a reviewer was right that nothing in the repo
 * reproduced them), and hand-computing is what allowed three cells to be filled with a max/min instead of a mean, and
 * four "ranges" to be derived from 4-decimal DISPLAY values rather than the underlying numbers.
 *
 * Rules, stated once so they cannot drift:
 *   - one row per TAG (not per run): n, mean, min, max, spread (max-min computed from raw floats, printed at 6 dp);
 *   - failed runs (ok !== true) are counted but never averaged;
 *   - a run whose trainWall < 5 s is a CACHE REPLAY of an earlier artifact: it is a valid measurement of the same
 *     weights, but it is not independent, so it is flagged and excluded from the spread;
 *   - sorting is by mean, so the table cannot silently pick a best single run.
 *
 *   node scripts/drss-table.mjs [--dir .tmp/r416-team] [--json out.json]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const DIR = resolve(flag('--dir', join(PROJECT, '.tmp', 'r416-team')))
const OUT = flag('--json', '')

const walk = (dir) => {
  const found = []
  for (const name of readdirSync(dir)) {
    const at = join(dir, name)
    if (statSync(at).isDirectory()) found.push(...walk(at))
    else if (name === 'results.jsonl') found.push(at)
  }
  return found
}

if (!existsSync(DIR)) { console.log('no results directory at ' + DIR); process.exit(1) }
const rows = []
for (const file of walk(DIR)) {
  const axis = dirname(file).split(/[\\/]/).pop()
  for (const line of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
    if (line.trim() === '') continue
    try { rows.push({ ...JSON.parse(line), axis }) } catch (error) { /* a torn line is skipped, not counted */ }
  }
}

const byTag = new Map()
for (const row of rows) {
  const list = byTag.get(row.tag) ?? []
  list.push(row)
  byTag.set(row.tag, list)
}
const table = [...byTag.entries()].map(([tag, list]) => {
  const ok = list.filter((row) => row.ok === true && typeof row.gain_db === 'number')
  const replay = ok.filter((row) => typeof row.trainWall === 'number' && row.trainWall < 5)
  const real = ok.filter((row) => typeof row.trainWall !== 'number' || row.trainWall >= 5)
  const gains = ok.map((row) => row.gain_db)
  const spread = gains.length > 1 ? Math.max(...gains) - Math.min(...gains) : 0
  return {
    tag, axis: list[0].axis, runs: list.length, ok: ok.length, failed: list.length - ok.length,
    replays: replay.length,
    mean: gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : null,
    min: gains.length > 0 ? Math.min(...gains) : null,
    max: gains.length > 0 ? Math.max(...gains) : null,
    spread,
    meanReal: real.length > 0 ? real.reduce((a, b) => a + b.gain_db, 0) / real.length : null,
  }
}).sort((a, b) => (b.mean ?? -1e9) - (a.mean ?? -1e9))

const lines = []
lines.push('| tag | axis | runs | ok | failed | replays | mean gain | min | max | spread (raw) | mean excl. replays |')
lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const row of table) {
  const f = (v) => (v === null ? '—' : v.toFixed(6))
  lines.push('| ' + [row.tag, row.axis, row.runs, row.ok, row.failed, row.replays, f(row.mean), f(row.min), f(row.max), row.spread === 0 ? '0' : row.spread.toExponential(2), f(row.meanReal)].join(' | ') + ' |')
}
const text = lines.join(String.fromCharCode(10))
console.log(text)
if (OUT !== '') writeFileSync(resolve(OUT), JSON.stringify({ rows: table.length, tags: table }, null, 2), 'utf8')
process.exit(0)
