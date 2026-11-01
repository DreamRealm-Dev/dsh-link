#!/usr/bin/env node
/**
 * R86: the repair path for line-form citations.
 *
 * R84 measured that `path#text` rows ride a line shift while `path:line` rows break on every one of the 42
 * rows of the device-net page — and R84 also reverted the conversion, because three judges deliberately
 * require the line form on that page. So the debt is not the form, it is the REPAIR COST: R71 and R74 each
 * paid it by hand (4 rows, then 16). This tool pays it mechanically, and refuses loudly when the repair is
 * not mechanical (the anchor moved to more than one line, or vanished).
 *
 *   node scripts/realign-citations.mjs [--root <dir>] [--page <path>] [--check] [--json]
 *
 *   default   rewrite every stale `path:line` row with the line that really holds its fragments
 *   --check   report only; exit 1 if any row is stale or refused (nothing is written)
 *   exit      0 = every row holds or was repaired; 1 = at least one row was refused (or stale, with --check)
 *
 * It reads the citation markers the way the shipped checker does (at the start of a line) and it does NOT
 * import the checker: the checker stays the judge, this stays the repairman.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const CHECK = argv.includes('--check')
const JSON_OUT = argv.includes('--json')
const ROOT = resolve(option('--root', resolve(HERE, '..')))
const PAGE = option('--page', 'docs/protocol/device-net-v1.md')
const flat = (text) => text.replace(/\s+/g, ' ').trim()
const BEGIN = '<!-- citations'
const END = '<!-- /citations -->'

const pagePath = isAbsolute(PAGE) ? PAGE : join(ROOT, PAGE)
if (existsSync(pagePath) === false) { console.error('realign: no such page: ' + pagePath); process.exit(3) }
const page = readFileSync(pagePath, 'utf8')
// R87 (found by an independent recompute, not by this tool's author): splitting on /\r?\n/ and joining on
// '\n' silently rewrote EVERY line ending on the page \u2014 on a CRLF checkout that is 151 bytes of ghost
// diff while the tool reported "1 rewritten". The page is therefore re-joined with the ending it shipped:
// a repair may change the cells it reports, and nothing else, down to the byte.
const EOL = page.includes('\r\n') ? '\r\n' : '\n'
const lines = page.split(/\r?\n/)
const start = lines.findIndex((line) => line.startsWith(BEGIN))
const end = lines.findIndex((line) => line.startsWith(END))
if (start === -1 || end === -1 || end < start) { console.error('realign: the page carries no citation table between the markers'); process.exit(3) }

const rows = []
for (let at = start + 1; at < end; at += 1) {
  const line = lines[at]
  if (line.trim().startsWith('|') === false) continue
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
  if (cells.length < 3) continue
  if (/^-+$/.test(cells[0].replace(/\s/g, ''))) continue
  if (cells[1] === 'where' || cells[0] === 'id') continue
  rows.push({ at, id: cells[0], where: cells[1], must: cells[2] })
}

const reportRows = []
let rewritten = 0
let unchanged = 0
const refused = []
const stale = []
for (const row of rows) {
  const line = /^(.*):(\d+)$/.exec(row.where)
  const text = line === null ? /^(.*)#(.+)$/.exec(row.where) : null
  if (line === null && text === null) { refused.push({ id: row.id, reason: 'not-a-citation' }); continue }
  const path = (line ?? text)[1]
  const file = isAbsolute(path) ? path : join(ROOT, path)
  if (existsSync(file) === false) { refused.push({ id: row.id, reason: 'no-such-file:' + path }); continue }
  const fileLines = readFileSync(file, 'utf8').split(/\r?\n/)
  const fragments = row.must.trim() === '' || row.must.trim() === '-' ? [] : row.must.split(' ; ').map(flat)
  const listOf = (hits) => hits.slice(0, 5).map(([at]) => String(at)).join(',') + (hits.length > 5 ? '(+' + String(hits.length - 5) + ' more)' : '')
  if (text !== null) {
    // R88 (T48): the FIRST version searched only the must-column fragments, so a `path#text` row whose must
    // column is '-' (the convention in PLAN.md/STATUS.md) matched EVERY line and was refused with a line list
    // thousands of numbers long. The anchor in the where cell is the claim; it must occur exactly once, and
    // any extra fragment must sit on that same line. Everything else is refused, loudly and briefly.
    const needle = flat(text[2])
    const hits = fileLines.map((one, index) => [index + 1, flat(one)]).filter(([, one]) => one.includes(needle))
    if (hits.length === 0) { refused.push({ id: row.id, reason: 'anchor-gone:' + path }); continue }
    if (hits.length > 1) { refused.push({ id: row.id, reason: 'text-not-unique:' + path + ':' + listOf(hits) }); continue }
    const found = fragments.filter((fragment) => hits[0][1].includes(fragment))
    if (found.length !== fragments.length) { refused.push({ id: row.id, reason: 'anchor-and-fragment-disagree:' + path + ':' + String(hits[0][0]) }); continue }
    unchanged += 1
    reportRows.push({ id: row.id, form: 'text', line: hits[0][0] })
    continue
  }
  if (fragments.length === 0) {
    // A line-form row with nothing to look for cannot be located: refusing is the only honest answer
    // (silently "repairing" it would point it at line 1, because every line trivially contains nothing).
    refused.push({ id: row.id, reason: 'no-fragments-to-locate:' + path })
    continue
  }
  const hits = fileLines.map((one, index) => [index + 1, flat(one)]).filter(([, one]) => fragments.every((fragment) => one.includes(fragment)))
  if (hits.length === 0) { refused.push({ id: row.id, reason: 'anchor-gone:' + path }); continue }
  if (hits.length > 1) { refused.push({ id: row.id, reason: 'ambiguous:' + path + ':' + listOf(hits) }); continue }
  const wanted = Number(line[2])
  if (hits[0][0] === wanted) { unchanged += 1; reportRows.push({ id: row.id, form: 'line', line: wanted }); continue }
  stale.push({ id: row.id, from: wanted, to: hits[0][0] })
  if (CHECK === false) {
    lines[row.at] = lines[row.at].split(row.where).join(path + ':' + String(hits[0][0]))
    rewritten += 1
  }
  reportRows.push({ id: row.id, form: 'line', line: hits[0][0] })
}

if (CHECK === false && rewritten > 0) writeFileSync(pagePath, lines.join(EOL), 'utf8')
const summary = { page: pagePath, rows: rows.length, rewritten, unchanged, stale, refused }
if (JSON_OUT) console.log(JSON.stringify(summary))
else {
  for (const one of stale) console.log('  stale    ' + one.id + '  ' + String(one.from) + ' -> ' + String(one.to))
  for (const one of refused) console.log('  refused  ' + one.id + '  ' + one.reason)
  // A counter must not lie: in --check mode nothing is rewritten, so the number that matters is stale.
  const moved = CHECK ? stale.length : rewritten
  console.log(String(rows.length) + ' row(s): ' + String(moved) + ' ' + (CHECK ? 'stale' : 'rewritten') + ', ' + String(unchanged) + ' already holding, ' + String(refused.length) + ' refused' + (CHECK ? ' (nothing written)' : ''))
}
process.exit(refused.length > 0 || (CHECK && stale.length > 0) ? 1 : 0)
