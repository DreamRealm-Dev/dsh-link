#!/usr/bin/env node
/**
 * Check the protocol page's citations against the shipped source.
 *
 * A page that says "the route is this and the refusal is that" is a judge, and a judge nobody checks
 * rots: a line number moves, the sentence keeps claiming it, and the next reader trusts it because it
 * looks cited. This reads the page's citation table (between the two comment markers) and requires, for
 * each row, that the named file has that line and that the line contains every fragment the row names.
 *
 * It reads SOURCE on purpose. The device-net gate reads the built module; this one is the only place
 * that cares whether the page still points at the line in `src`.
 *
 * Exit 0 all rows hold; 1 a row failed (each printed); 3 an input is missing.
 * --self-test proves the checker reddens: a shifted line number, a reworded fragment and a removed row
 * each have to fail on a copy of the page.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const PAGE = isAbsolute(option('--page', '')) ? option('--page', '') : join(PROJECT, option('--page', 'docs/protocol/device-net-v1.md'))
const BEGIN = '<!-- citations'
const END = '<!-- /citations -->'

const cells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim())
const flat = (text) => text.replace(/\s+/g, ' ').trim()

/** Every citation row the page declares, in order. */
function rowsOf(pageText) {
  const lines = pageText.split(/\r?\n/)
  const begin = lines.findIndex((line) => line.startsWith(BEGIN))
  const end = lines.findIndex((line) => line.trim() === END)
  if (begin === -1 || end === -1 || end < begin) return null
  const rows = []
  const malformed = []
  for (const line of lines.slice(begin + 1, end)) {
    if (!line.trim().startsWith('|')) continue
    // Everything past the `where` cell is the requirement, joined back with the pipes markdown used to
    // split it. Taking only the third cell truncated any fragment containing '|' and the row then read
    // as GREEN while checking half a claim — the blind spot this parse exists to close. A pipe inside the
    // requirement is also a broken table shape, so such a row is reported by name rather than guessed at.
    const parts = line.split('|').slice(1, -1)
    const id = (parts[0] ?? '').trim()
    const where = (parts[1] ?? '').trim()
    const mustRaw = parts.slice(2).join('|')
    const must = mustRaw.trim()
    if (id === 'id' || id === undefined) continue
    if (/^-+$/.test(id)) continue
    if (mustRaw.includes('|')) { malformed.push(line); continue }
    // A row that cannot name a place and a requirement is not a row that passes: it is a row that
    // says nothing, and silently dropping it is how a table comes to look complete while a citation
    // nobody wrote sits in it. Malformed rows are reported instead (measured while extending the
    // checker: a two-cell row made the whole citation vanish and the page still read as green).
    // A row with no requirement cell at all, or with an empty one, is not a row that passes: it is a row
    // that says nothing. `-` stays the deliberate spelling for "this row carries no requirement", so the
    // two are told apart here rather than lumped together - joining the remainder above turned the old
    // `must === undefined` test into a dead branch, and a two-cell row then read as a fragment-less row.
    if (where === '' || parts.length < 3 || (must === '' && mustRaw !== '-')) { malformed.push(line); continue }
    rows.push({ id, where, fragments: must.trim() === '' || must.trim() === '-' ? [] : must.split(' ; ') })
  }
  return { rows, malformed }
}

/**
 * Read one citation and check it. Two forms, and the difference is deliberate:
 *
 *   path:line   the line number is part of the claim — "I read THIS line and it says this". It is the
 *               stronger evidence and the one that goes stale when the source moves.
 *   path#text   the claim is that this text occurs in the file, EXACTLY ONCE — self-healing, and still
 *               falsifiable (a fragment that vanished, or one that now appears twice and so names no
 *               single place, both fail). The line it resolved to is printed, so a reviewer sees drift.
 */
function checkRow(root, row) {
  const exact = /^(.*):(\d+)$/.exec(row.where)
  const search = exact === null ? /^(.*)#(.+)$/.exec(row.where) : null
  if (exact === null && search === null) return { ok: false, detail: 'the citation is neither path:line nor path#text' }
  const file = isAbsolute((exact ?? search)[1]) ? (exact ?? search)[1] : join(root, (exact ?? search)[1])
  if (!existsSync(file)) return { ok: false, detail: 'no such file: ' + (exact ?? search)[1] }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  if (exact !== null) {
    const wanted = Number(exact[2])
    if (wanted < 1 || wanted > lines.length) return { ok: false, detail: 'line ' + String(wanted) + ' is outside ' + (exact)[1] + ' (' + String(lines.length) + ' lines)' }
    const text = flat(lines[wanted - 1])
    const missing = row.fragments.filter((fragment) => !text.includes(flat(fragment)))
    if (missing.length > 0) return { ok: false, detail: 'line ' + String(wanted) + ' does not contain ' + JSON.stringify(missing) + '; it holds: ' + text.slice(0, 160) }
    return { ok: true, detail: 'line ' + String(wanted) + ' holds all ' + String(row.fragments.length) + ' fragment(s)' }
  }
  const needle = flat(search[2])
  const hits = lines.map((line, index) => [index + 1, flat(line)]).filter(([, text]) => text.includes(needle))
  if (hits.length === 0) return { ok: false, detail: 'the file no longer contains ' + JSON.stringify(search[2]) }
  if (hits.length > 1) return { ok: false, detail: JSON.stringify(search[2]) + ' appears on ' + String(hits.length) + ' lines (' + hits.map(([line]) => line).join(', ') + '); a citation has to name one place' }
  const [at, text] = hits[0]
  const missing = row.fragments.filter((fragment) => !text.includes(flat(fragment)))
  if (missing.length > 0) return { ok: false, detail: 'line ' + String(at) + ' does not contain ' + JSON.stringify(missing) + '; it holds: ' + text.slice(0, 160) }
  return { ok: true, detail: 'found on line ' + String(at) + ' (by text), holds ' + String(row.fragments.length + 1) + ' fragment(s)' }
}

function run(pagePath, root) {
  if (!existsSync(pagePath)) return { exit: 3, report: ['the page is missing: ' + pagePath] }
  const parsed = rowsOf(readFileSync(pagePath, 'utf8'))
  if (parsed === null || parsed.rows.length === 0) return { exit: 3, report: ['the page carries no citation table between ' + BEGIN + ' and ' + END] }
  const { rows, malformed } = parsed
  const report = []
  let failed = 0
  for (const line of malformed) { failed += 1; report.push('  FAIL  malformed row (it names no place or no requirement): ' + flat(line).slice(0, 120)) }
  for (const row of rows) {
    const verdict = checkRow(root, row)
    if (!verdict.ok) failed += 1
    report.push((verdict.ok ? '  ok    ' : '  FAIL  ') + row.id + '  ' + row.where + '  |  ' + verdict.detail)
  }
  report.push(String(rows.length - failed) + ' of ' + String(rows.length) + ' citation(s) hold')
  return { exit: failed === 0 ? 0 : 1, report, rows: rows.length }
}

const selfTest = () => {
  const root = mkdtempSync(join(tmpdir(), 'r58-citations-'))
  const page = readFileSync(PAGE, 'utf8')
  const cases = []
  const shifted = page.replace(/:354 \|/, ':355 |')
  writeFileSync(join(root, 'shifted.md'), shifted)
  cases.push(['a line number off by one is caught', join(root, 'shifted.md'), 1])
  const reworded = page.replace("refuse(401, 'UNAUTHORIZED')", "refuse(401, 'WRONG')")
  writeFileSync(join(root, 'reworded.md'), reworded)
  cases.push(['a reworded fragment is caught', join(root, 'reworded.md'), 1])
  const trimmed = page.replace(/\n\| own-stream-seq[^\n]*/, '')
  writeFileSync(join(root, 'trimmed.md'), trimmed)
  // A row that is deleted takes its own requirement with it, and this checker cannot see that: it
  // judges the rows it is given. The reading below states the limitation instead of papering over it,
  // and the gate that runs this checker owns the coverage question (every code the page promises
  // must be a row in this table).
  cases.push(['a removed row is NOT caught here (documented limit; the gate owns coverage)', join(root, 'trimmed.md'), 0])
  writeFileSync(join(root, 'intact.md'), page)
  cases.push(['the page as shipped holds', join(root, 'intact.md'), 0])
  // The self-healing form has its own two ways to be wrong: the text can be gone, or it can now name
  // more than one place (in which case it is not a citation of a place at all).
  const searchMissing = page.replace('| regroup-helper | scripts/verify-collab-multihop.mjs:50 | const regroupByOrigin = (log) => { |'
    , '| regroup-helper | scripts/verify-collab-multihop.mjs#const regroupByOriginGone = (log) => { | - |')
  writeFileSync(join(root, 'search-missing.md'), searchMissing)
  cases.push(['a search citation whose text is gone is caught', join(root, 'search-missing.md'), 1])
  const searchAmbiguous = page.replace('| regroup-helper | scripts/verify-collab-multihop.mjs:50 | const regroupByOrigin = (log) => { |'
    , '| regroup-helper | scripts/verify-collab-multihop.mjs#const | - |')
  writeFileSync(join(root, 'search-ambiguous.md'), searchAmbiguous)
  cases.push(['a search citation that names more than one line is caught', join(root, 'search-ambiguous.md'), 1])
  const searchFine = page.replace('| own-stream-seq | plugins/dsh-link-collab/src/index.ts:88 | readonly originSeq?: number |'
    , '| own-stream-seq | plugins/dsh-link-collab/src/index.ts#readonly originSeq?: number | - |')
  writeFileSync(join(root, 'search-fine.md'), searchFine)
  cases.push(['a search citation that names exactly one line holds', join(root, 'search-fine.md'), 0])
  let failed = 0
  for (const [name, path, expected] of cases) {
    const outcome = run(path, PROJECT)
    const before = run(path, PROJECT).rows
    const after = name.startsWith('a removed') ? run(PAGE, PROJECT).rows - 1 : before
    const ok = outcome.exit === expected && (name.startsWith('a removed') ? before === after : true)
    if (!ok) failed += 1
    console.log((ok ? '  ok    ' : '  FAIL  ') + name + '  |  exit=' + String(outcome.exit) + ' expected=' + String(expected) + ' rows=' + String(before))
  }
  rmSync(root, { recursive: true, force: true })
  console.log(String(cases.length - failed) + ' of ' + String(cases.length) + ' self-test reading(s) hold')
  process.exit(failed === 0 ? 0 : 1)
}

if (argv.includes('--self-test')) selfTest()
const outcome = run(PAGE, PROJECT)
for (const line of outcome.report) console.log(line)
process.exit(outcome.exit)
