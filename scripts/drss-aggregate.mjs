#!/usr/bin/env node
/**
 * R384 - aggregate the team DRSS selection: every axis results.jsonl into one table, with failures named.
 *
 * The selection was run by branches that each owned one axis; this script only reads what they wrote. It never turns a
 * failed candidate into a zero: a row without a number is listed under "produced NO number" with its reason.
 *
 *   node scripts/drss-aggregate.mjs [--dir .tmp/r152-team] [--out docs/drss/R384-artifacts]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at === -1 ? fallback : argv[at + 1] }
const DIR = resolve(flag('dir', join(PROJECT, '.tmp', 'r152-team')))
const OUT = flag('out', '')
const NEWLINE = String.fromCharCode(10)

const walk = (dir) => {
  const found = []
  for (const name of readdirSync(dir)) {
    const at = join(dir, name)
    const info = statSync(at)
    if (info.isDirectory()) found.push(...walk(at))
    else if (name === 'results.jsonl') found.push(at)
  }
  return found
}

if (existsSync(DIR) !== true) { console.log('SKIP: no results directory at ' + DIR); process.exit(1) }
const rows = []
for (const file of walk(DIR)) {
  for (const line of readFileSync(file, 'utf8').split(NEWLINE)) {
    if (line.trim() === '') continue
    try { rows.push(JSON.parse(line)) } catch (error) { console.log('  (unreadable line in ' + file + ')') }
  }
}
const measured = rows.filter((row) => row.ok === true && typeof row.gain_db === 'number').sort((a, b) => b.gain_db - a.gain_db)
const failed = rows.filter((row) => row.ok !== true)
const byAxis = {}
for (const row of measured) { byAxis[row.axis] = (byAxis[row.axis] ?? 0) + 1 }

const table = [
  '# R384 - the team-run DRSS selection',
  '',
  'Three branches each owned one axis of the candidate space; every candidate was trained on the existing frozen TRAIN',
  'patch cache and scored on the frozen 25-scene validation split by the repo own evaluator path. Nothing was written',
  'under H:/mod/mcst.',
  '',
  '## Measured candidates, best first',
  '',
  '| # | axis | candidate | options that differ from the shipped operating point | val PSNR (dB) | gain (dB) | steps | params |',
  '|---:|---|---|---|---:|---:|---:|---:|',
]
measured.forEach((row, index) => {
  const options = Object.keys(row.options ?? {}).map((key) => key + ' ' + row.options[key]).join(', ')
  table.push('| ' + String(index + 1) + ' | ' + row.axis + ' | ' + row.tag + ' | ' + (options === '' ? '(shipped operating point)' : options) + ' | ' + Number(row.val_psnr).toFixed(4) + ' | ' + (row.gain_db >= 0 ? '+' : '') + Number(row.gain_db).toFixed(4) + ' | ' + String(row.steps) + ' | ' + String(row.params) + ' |')
})
if (failed.length > 0) {
  table.push('', '## Candidates that produced NO number', '', '| candidate | why |', '|---|---|')
  for (const row of failed) table.push('| ' + row.tag + ' | ' + String(row.why) + (Array.isArray(row.tail) && row.tail.length > 0 ? ' - ' + String(row.tail[0]).trim().slice(0, 120) : '') + ' |')
}
table.push('', '## Axis coverage', '')
for (const axis of Object.keys(byAxis).sort()) table.push('- **' + axis + '**: ' + String(byAxis[axis]) + ' measured candidate(s)')
table.push('', 'Reference points from earlier rounds (same protocol): R379 winner +0.4057 dB single seed; R254 candidate A +0.3567 dB; the pre-existing reference checkpoint +0.3908 dB. The protocol own reproducibility floor is 0.03-0.05 dB, so differences under ~0.05 dB between candidates are not conclusions by themselves.')
const text = table.join(NEWLINE) + NEWLINE

if (OUT !== '') {
  const dir = resolve(OUT)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'TEAM-SELECTION.md'), text, 'utf8')
  writeFileSync(join(dir, 'team-selection.json'), JSON.stringify({ ranAt: new Date().toISOString(), measured, failed }, null, 2), 'utf8')
  console.log('written: ' + join(dir, 'TEAM-SELECTION.md'))
}
console.log(text)
process.exit(measured.length > 0 ? 0 : 1)