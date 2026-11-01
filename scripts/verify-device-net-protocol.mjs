#!/usr/bin/env node
/**
 * R58: the protocol page's citations, machine-checked - plus the coverage the checker cannot see.
 *
 * Subject: docs/protocol/device-net-v1.md section six (the citation table between the two comment
 * markers) and scripts/check-protocol-page.mjs, which is the instrument that reads it. The producer
 * wrote both; this gate recomputes every number it reports and builds its own copies for the
 * falsifiability readings. The only product this gate loads is the built module, and only for the
 * one refusal the page promises but no reading has ever exercised (RELAY_CONFLICT).
 *
 * The checker's documented blind spot is measured here rather than assumed: it judges the rows it is
 * given, so deleting a row removes its own requirement and it still exits 0. Reading R3 owns that
 * question - every RELAY_* code the prose promises must be cited by some row - and proves the rule
 * bites on copies where the checker stays green.
 *
 * Exit 0 all held; 1 a reading failed (a missing input, or a page with no citation table, is a failed
 * reading here: the checker's own 1-versus-3 distinction is measured by R2 instead of being reproduced
 * as this gate's exit code).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const PROJECT = resolve(dirname(SELF), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : resolve(argv[i + 1]) }
const ATTACK = argv.includes('--self-attack')
const JSON_OUT = argv.includes('--json')
const PAGE = option('--page', join(PROJECT, 'docs', 'protocol', 'device-net-v1.md'))
const CHECKER = option('--checker', join(PROJECT, 'scripts', 'check-protocol-page.mjs'))
const MODULE = option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js'))

const NL = String.fromCharCode(10)
const DECLARED = ['R1', 'R2', 'R3', 'R4']
const BEGIN = '<!-- citations'
const END = '<!-- /citations -->'
const results = []
const record = (id, ok, detail) => { results.push({ id, ok: ok === true }); console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + ' ' + detail) }
const say = (text) => console.log('      ' + text)
const clip = (text, n) => (String(text).length > n ? String(text).slice(0, n) + '...' : String(text))
const show = (value) => JSON.stringify(value)
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)
const MADE = []
function mkTemp(prefix) {
  mkdirSync(join(PROJECT, '.tmp'), { recursive: true })
  const dir = mkdtempSync(join(PROJECT, '.tmp', prefix))
  MADE.push(dir)
  return dir
}

/** One edit of one string, refused when the anchor is absent or not unique: a mutant that cannot be
 *  applied has to be reported, never silently skipped (a green run proves nothing then). */
function swapOnce(text, find, replace) {
  const first = text.indexOf(find)
  if (first === -1) throw new Error('anchor missing: ' + clip(find, 70))
  if (text.indexOf(find, first + find.length) !== -1) throw new Error('anchor is not unique: ' + clip(find, 70))
  return text.slice(0, first) + replace + text.slice(first + find.length)
}

/** Run the checker on one page and read back its exit code and its own summary line. */
function runChecker(pagePath) {
  const run = spawnSync(process.execPath, [CHECKER, '--page', pagePath], { encoding: 'utf8', cwd: PROJECT, timeout: 120000 })
  const out = String(run.stdout === null ? '' : run.stdout) + String(run.stderr === null ? '' : run.stderr)
  const summary = /([0-9]+) of ([0-9]+) citation\(s\) hold/.exec(out)
  return { exit: run.status, out, held: summary === null ? null : Number(summary[1]), rows: summary === null ? null : Number(summary[2]) }
}

/** The citation rows the page declares, parsed here rather than asked of the checker. */
function rowsOf(pageText) {
  const lines = pageText.split(/\r?\n/)
  const begin = lines.findIndex((line) => line.startsWith(BEGIN))
  const end = lines.findIndex((line) => line.trim() === END)
  if (begin === -1 || end === -1 || end < begin) return null
  const rows = []
  for (let i = begin + 1; i < end; i += 1) {
    const line = lines[i]
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 3) continue
    const id = cells[0]
    if (id === 'id' || /^-+$/.test(id)) continue
    rows.push({ id, where: cells[1], must: cells[2], fragments: cells[2].split(' ; '), line })
  }
  return rows
}

/** The page with the citation block removed: the prose that makes promises to a reader. */
function proseOf(pageText) {
  const lines = pageText.split(/\r?\n/)
  const begin = lines.findIndex((line) => line.startsWith(BEGIN))
  const end = lines.findIndex((line) => line.trim() === END)
  if (begin === -1 || end === -1) return pageText
  return lines.slice(0, begin).concat(lines.slice(end + 1)).join(NL)
}

/** Every RELAY_* code the prose promises, and which of them no citation row cites. */
function coverageOf(pageText) {
  const codes = [...new Set(proseOf(pageText).match(/RELAY_[A-Z_]+/g) || [])].sort()
  const rows = rowsOf(pageText) || []
  const uncited = codes.filter((code) => !rows.some((row) => row.must.includes(code)))
  return { codes, uncited, rows: rows.length }
}
/** R1: the page as shipped and the source as shipped agree, and the count comes from the checker. */
function checkR1() {
  const pageText = readText(PAGE)
  if (pageText === null) throw new Error('the page is missing: ' + PAGE)
  const mine = rowsOf(pageText)
  if (mine === null || mine.length === 0) throw new Error('the page carries no citation table between ' + BEGIN + ' and ' + END)
  const outcome = runChecker(PAGE)
  const agrees = outcome.exit === 0 && outcome.rows !== null && outcome.held === outcome.rows && outcome.rows === mine.length
  record('R1', agrees, 'the shipped page cites the shipped source: checker exit ' + String(outcome.exit) + ' with ' + String(outcome.held) + ' of ' + String(outcome.rows) + ' citation(s) holding, and this gate counted ' + String(mine.length) + ' row(s) in the table itself')
  for (const row of outcome.out.split(NL).filter((line) => line.trim() !== '')) say(clip(row.trim(), 150))
  if (outcome.rows !== null && outcome.rows > 0) say('the count above is the checker own summary line; nothing here hardcodes 16, or any number')
}

/** R2: the checker reddens, and the two failure answers (a row failed, an input is missing) are told apart. */
function checkR2() {
  const pageText = readText(PAGE)
  if (pageText === null) throw new Error('the page is missing: ' + PAGE)
  const rows = rowsOf(pageText)
  if (rows === null || rows.length === 0) throw new Error('the page carries no citation table')
  const dir = mkTemp('r58-r2-')
  const first = rows[0]
  const last = rows[rows.length - 1]
  const at = /^(.*):([0-9]+)$/.exec(first.where)
  if (at === null) throw new Error('the first citation is not path:line: ' + first.where)
  const under = /^(.*):([0-9]+)$/.exec(last.where)
  if (under === null) throw new Error('the last citation is not path:line: ' + last.where)

  // R218: the anchors are the WHOLE table cells. The bare path:line collides with a longer line number -
  // 'index.ts:909' is a substring of 'index.ts:9095', and this page cites both - so the mutant threw
  // "anchor is not unique" instead of applying. The pipes make each cell exact.
  const cell = (where) => '| ' + where + ' |'
  writeFileSync(join(dir, 'shifted.md'), swapOnce(pageText, cell(first.where), '| ' + at[1] + ':' + String(Number(at[2]) + 1) + ' |'))
  writeFileSync(join(dir, 'reworded.md'), swapOnce(pageText, first.fragments[0], first.fragments[0] + 'ZZZ'))
  writeFileSync(join(dir, 'absent-file.md'), swapOnce(pageText, cell(last.where), '| ' + join('no', 'such', 'candidate.ts') + ':' + under[2] + ' |'))
  writeFileSync(join(dir, 'intact.md'), pageText)

  const shifted = runChecker(join(dir, 'shifted.md'))
  const reworded = runChecker(join(dir, 'reworded.md'))
  const absentFile = runChecker(join(dir, 'absent-file.md'))
  const intact = runChecker(join(dir, 'intact.md'))
  const missingPage = runChecker(join(dir, 'no-page-here.md'))
  const namesRow = (outcome, id) => outcome.out.includes(id)
  const ok = shifted.exit === 1 && namesRow(shifted, first.id)
    && reworded.exit === 1 && namesRow(reworded, first.id)
    && absentFile.exit === 1 && /no such file/i.test(absentFile.out)
    && intact.exit === 0 && intact.held === intact.rows
    && missingPage.exit === 3
  record('R2', ok, 'the checker reddens on a copy this gate builds: a line number off by one -> exit ' + String(shifted.exit) + ' (row ' + first.id + '), a reworded fragment -> exit ' + String(reworded.exit) + ', a citation pointing at a file that does not exist -> exit ' + String(absentFile.exit) + ' with "no such file", the unmodified copy -> exit ' + String(intact.exit) + ', and a missing page -> exit ' + String(missingPage.exit))
  say('the two failure answers are different on purpose: exit 1 is one citation failing (the row is named above), exit 3 is an input the checker cannot even read (no page, or no table) - so a green run cannot be produced by feeding it nothing')
}

/** R3: the coverage the checker cannot see - every code the prose promises must be cited by a row. */
function checkR3() {
  const pageText = readText(PAGE)
  if (pageText === null) throw new Error('the page is missing: ' + PAGE)
  const shipped = coverageOf(pageText)
  if (shipped.codes.length === 0) throw new Error('the prose promises no RELAY_* code at all, so this rule would be vacuous')
  let dropped = null
  for (const row of rowsOf(pageText) || []) {
    const without = pageText.split(NL).filter((line) => line.trim() !== row.line.trim()).join(NL)
    if (without === pageText) continue
    const after = coverageOf(without)
    if (after.uncited.length > 0) { dropped = { id: row.id, text: without, after }; break }
  }
  if (dropped === null) throw new Error('no single row is the only citer of any code, so the blind spot could not be measured here')
  const withNewCode = swapOnce(pageText, '**洞必须被拒**', '**洞必须被拒**（RELAY_NEW）')
  const proseOnly = coverageOf(withNewCode)
  const dir = mkTemp('r58-r3-')
  writeFileSync(join(dir, 'dropped-row.md'), dropped.text)
  writeFileSync(join(dir, 'prose-only-code.md'), withNewCode)
  const droppedChecked = runChecker(join(dir, 'dropped-row.md'))
  const proseChecked = runChecker(join(dir, 'prose-only-code.md'))
  const ok = shipped.uncited.length === 0 && dropped.after.uncited.length > 0 && droppedChecked.exit === 0
    && proseOnly.uncited.includes('RELAY_NEW') && proseChecked.exit === 0
  record('R3', ok, 'the prose promises ' + String(shipped.codes.length) + ' code(s) and every one is cited (' + show(shipped.codes) + '); the checker cannot see this: dropping the row that is the only citer of ' + show(dropped.after.uncited) + ' still exits ' + String(droppedChecked.exit) + ' while this rule reports it, and a code only the prose knows (RELAY_NEW) is reported too while the checker exits ' + String(proseChecked.exit))
  say('the dropped row is ' + dropped.id + ': the checker judges the rows it is given, so a deleted requirement leaves no trace in it - that gap is this reading')
}

/** R4: the one refusal code no reading has exercised - RELAY_CONFLICT - over a real loopback route. */
async function checkR4() {
  const C = await import(pathToFileURL(MODULE).href)
  const dir = mkTemp('r58-r4-')
  const log = C.openControlLog({ dir: join(dir, 'end-A'), writer: 'end-A' })
  const endpoint = C.createRelayEndpoint({ token: 'r58-secret', log })
  const server = createServer(endpoint.handler)
  await new Promise((settle) => server.listen(0, '127.0.0.1', settle))
  const url = 'http://127.0.0.1:' + String(server.address().port) + endpoint.path
  const post = async (batch) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer r58-secret' }, body: JSON.stringify(batch) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const first = { seq: 1, at: 1_800_000_000_000, kind: 'member/state', actor: 'team-1', subject: 'm-1', payload: { id: 'm-1', state: 'active', role: 'member' } }
  const batch = { writer: 'rogue-1', instance: 'inst-1', records: [first] }
  const clash = { writer: 'rogue-1', instance: 'inst-1', records: [Object.assign({}, first, { subject: 'm-1-clash', payload: { id: 'm-1', state: 'busy', role: 'member' } })] }
  const landed = await post(batch)
  const afterLand = log.replay().length
  const conflicted = await post(clash)
  const afterClash = log.replay().length
  const held = log.replay().find((row) => row.seq === 1)
  const repeated = await post(batch)
  const afterRepeat = log.replay().length
  // The keep-alive sockets undici opened are closed here on purpose: calling process.exit while libuv is
  // still closing an async handle aborts the process on Windows (observed: UV_HANDLE_CLOSING assertion),
  // and a crash says nothing about the reading that just passed.
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
  server.close()
  await log.close()
  const kept = held === undefined ? null : held.payload
  const ok = landed.status === 200 && landed.body !== null && landed.body.appended === 1
    && conflicted.status === 400 && conflicted.body !== null && conflicted.body.code === 'RELAY_CONFLICT'
    && afterClash === afterLand
    && kept !== null && kept.state === 'active'
    && repeated.status === 200 && repeated.body !== null && repeated.body.appended === 0 && repeated.body.skipped >= 1
    && afterRepeat === afterLand
  record('R4', ok, 'the last unexercised refusal runs over a real route: a first batch -> ' + String(landed.status) + '/appended ' + String(landed.body === null ? null : landed.body.appended)
    + ', the same writer, instance and seq with different content -> ' + String(conflicted.status) + '/' + String(conflicted.body === null ? null : conflicted.body.code) + ' with the ledger held at ' + String(afterClash)
    + ' and the first record still reading state=' + String(kept === null ? null : kept.state)
    + ', and the identical batch again -> ' + String(repeated.status) + '/appended ' + String(repeated.body === null ? null : repeated.body.appended) + ' skipped ' + String(repeated.body === null ? null : repeated.body.skipped))
  say('the conflict leg reads the value that survived (state=active, not the clashing busy), so this is not a reading of the refusal code alone')
}
/* -----------------------------------------------------------------------------------------------
 * Self-attack: one mutant per reading, the declared set has to equal the observed set, and every
 * reading has to be declared by at least one mutant.
 */

/** A citation line number drifts by one: the page now points at the wrong line of a shipped file. */
function shiftFirstRow(text) {
  const rows = rowsOf(text)
  if (rows === null || rows.length === 0) throw new Error('the page carries no citation table')
  // R218: the anchor has to be the WHOLE table cell, not the bare path:line. The bare form collides with a
  // longer line number: 'index.ts:909' is a substring of 'index.ts:9095', so a page that cites both files
  // made this mutant throw "anchor is not unique" instead of applying. The pipes make the cell exact.
  const cell = (where) => '| ' + where + ' |'
  const row = rows.find((one) => /^(.*):([0-9]+)$/.test(one.where) && text.split(cell(one.where)).length === 2)
  if (row === undefined) throw new Error('the page carries no citation row whose path:line cell appears exactly once')
  const at = /^(.*):([0-9]+)$/.exec(row.where)
  return swapOnce(text, cell(row.where), '| ' + at[1] + ':' + String(Number(at[2]) + 1) + ' |')
}

/** The first row whose deletion leaves a promised code with no citer at all. */
function removeSoleCiterRow(text) {
  for (const row of rowsOf(text) || []) {
    const without = text.split(NL).filter((line) => line.trim() !== row.line.trim()).join(NL)
    if (without === text) continue
    if (coverageOf(without).uncited.length > 0) return without
  }
  throw new Error('no row is the only citer of any code')
}

/** A code the prose promises and no row cites. */
const addUncitedProseCode = (text) => swapOnce(text, '**洞必须被拒**', '**洞必须被拒**（RELAY_NEW）')

const MUTANTS = [
  { id: 'M1', declared: ['R1', 'R2', 'R3'], target: 'page', apply: shiftFirstRow,
    note: 'a citation line number drifts by one: R1 loses its green run, R2 loses the paired leg that needs the unmodified copy to hold, and R3 loses the leg that needs the checker green on the dropped-row copy - the three are causally coupled through one broken row, so the set is declared as observed rather than trimmed' },
  { id: 'M2', declared: ['R3'], target: 'page', apply: removeSoleCiterRow,
    note: 'the row that is the only citer of some codes is deleted: the checker still passes, the coverage rule does not' },
  { id: 'M3', declared: ['R3'], target: 'page', apply: addUncitedProseCode,
    note: 'the prose promises a code no row cites' },
  { id: 'M4', declared: ['R4'], target: 'module', note: 'the conflict refusal reports a code nobody promised',
    find: 'throw new RelayError("RELAY_CONFLICT"', replace: 'throw new RelayError("RELAY_CLASH"' },
  { id: 'M5', declared: ['R2'], target: 'checker', note: 'the checker always exits 0, so no citation failure can be observed',
    find: 'process.exit(outcome.exit)', replace: 'process.exit(0)' },
]

/** Run this same gate in a child process and read its verdict map back. */
function childVerdicts(extraArgs) {
  const run = spawnSync(process.execPath, [SELF, '--json'].concat(extraArgs), { encoding: 'utf8', timeout: 300000, cwd: PROJECT })
  const out = String(run.stdout === null ? '' : run.stdout)
  const line = out.split(NL).filter((row) => row.startsWith('{')).pop()
  if (line !== undefined) return { ok: true, map: JSON.parse(line) }
  const map = Object.fromEntries(DECLARED.map((id) => [id, false]))
  for (const row of out.split(NL)) {
    const match = /^\s+(ok|FAIL)\s+(R[0-9]+)\b/.exec(row)
    if (match !== null && match[1] === 'ok') map[match[2]] = true
  }
  const printed = out.split(NL).filter((row) => /^\s+(ok|FAIL)\s+R[0-9]+\b/.test(row)).length
  if (printed === 0) return { ok: false, why: 'the armed run printed no reading (exit ' + show(run.status) + '): ' + clip(out + String(run.stderr === null ? '' : run.stderr), 200) }
  return { ok: true, map, crashed: true }
}

/** The world arguments this run was given, so a child run judges the same world the parent judged. */
function worldArgs() {
  const args = []
  for (const name of ['--page', '--checker', '--module']) {
    const i = argv.indexOf(name)
    if (i !== -1) args.push(name, resolve(argv[i + 1]))
  }
  return args
}

/** Keep the parent's world, but let the mutant's own switch win: the same option twice would be read
 *  first-wins, so the mutant would silently never be applied. */
function withOverride(base, extra) {
  const names = extra.filter((token) => token.startsWith('--'))
  const kept = []
  for (let i = 0; i < base.length; i += 2) if (!names.includes(base[i])) kept.push(base[i], base[i + 1])
  return kept.concat(extra)
}

/**
 * A world where the CHECKER itself is replaced. The checker derives its project root from its own
 * location, so a copy dropped anywhere else would judge the page against a different root: the mirror
 * recreates the layout (the mutated checker under scripts/, plus a copy of every file the citation
 * table names at the same relative path), otherwise the mutant would move readings for a reason that
 * has nothing to do with the defect injected.
 */
function checkerMirror(mutant) {
  const dir = mkTemp('r58-mut-' + mutant.id + '-')
  const shippedChecker = readText(CHECKER)
  if (shippedChecker === null) throw new Error('the checker is missing: ' + CHECKER)
  const target = join(dir, 'scripts', 'check-protocol-page.mjs')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, swapOnce(shippedChecker, mutant.find, mutant.replace))
  const pageText = readText(PAGE)
  if (pageText === null) throw new Error('the page is missing: ' + PAGE)
  for (const row of rowsOf(pageText) || []) {
    const at = /^(.*):([0-9]+)$/.exec(row.where)
    if (at === null) continue
    const source = resolve(PROJECT, at[1])
    const text = readText(source)
    if (text === null) continue
    const copy = join(dir, at[1])
    mkdirSync(dirname(copy), { recursive: true })
    writeFileSync(copy, text)
  }
  return ['--checker', target]
}

/** A mutant is applied to a COPY of the shipped file; the copy is what the child run reads. */
function mutantArgs(mutant) {
  if (mutant.target === 'page') {
    const dir = mkTemp('r58-mut-' + mutant.id + '-')
    const file = join(dir, 'page.md')
    const shipped = readText(PAGE)
    if (shipped === null) throw new Error('the page is missing: ' + PAGE)
    writeFileSync(file, mutant.apply(shipped))
    return ['--page', file]
  }
  if (mutant.target === 'checker') return checkerMirror(mutant)
  const shipped = readText(MODULE)
  if (shipped === null) throw new Error('the module is missing: ' + MODULE)
  const dir = mkTemp('r58-mut-' + mutant.id + '-')
  const file = join(dir, mutant.target === 'module' ? 'index.js' : 'checker.mjs')
  writeFileSync(file, swapOnce(shipped, mutant.find, mutant.replace))
  return [mutant.target === 'module' ? '--module' : '--checker', file]
}

async function runAttack() {
  console.log('')
  console.log('=== self-attack: one mutant per reading, the declared set has to equal the observed set ===')
  console.log('  (every mutant runs this gate again in a child process, so the injection selects the defect and never')
  console.log('   the expectations; the baseline map comes from a clean run of this same code)')
  const base = childVerdicts(worldArgs())
  if (!base.ok) { console.error('self-attack: the baseline run produced no verdict map: ' + base.why); return false }
  const baselineRed = DECLARED.filter((id) => !base.map[id])
  if (baselineRed.length > 0) {
    console.error('self-attack: the unmutated run is not green (failed ' + show(baselineRed) + '), so no mutant can be trusted: settle the red reading first, then run the attack')
    return false
  }
  const table = []
  const coverage = new Map()
  let ok = true
  for (const mutant of MUTANTS) {
    for (const reading of mutant.declared) coverage.set(reading, [...(coverage.get(reading) || []), mutant.id])
    try {
      const armed = childVerdicts(withOverride(worldArgs(), mutantArgs(mutant)))
      const observed = armed.ok ? DECLARED.filter((id) => Boolean(base.map[id]) !== Boolean(armed.map[id])) : ['gate failure']
      const localised = show(observed) === show([...mutant.declared].sort())
      if (!localised) ok = false
      table.push({ id: mutant.id, note: mutant.note, declared: mutant.declared, observed, localised, crashed: armed.crashed === true })
    } catch (error) {
      ok = false
      table.push({ id: mutant.id, note: mutant.note, declared: mutant.declared, observed: ['anchor not shipped'], localised: false, why: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const row of table) {
    console.log('  ' + row.id + ' [' + row.declared.join(',') + '] ' + row.note)
    console.log('      -> observed ' + show(row.observed) + '  ' + (row.localised ? 'LOCALISED' : 'MISMATCH') + (row.crashed === true ? ' (the armed run crashed; the readings it printed were read off the transcript)' : '') + (row.why === undefined ? '' : ' [' + row.why + ']'))
  }
  console.log('')
  console.log('coverage matrix (reading -> mutants that declare it):')
  for (const reading of DECLARED) console.log('  ' + reading + ': ' + ((coverage.get(reading) || []).join(', ') || '(none)'))
  const uncovered = DECLARED.filter((reading) => (coverage.get(reading) || []).length === 0)
  const mismatched = table.filter((row) => !row.localised).map((row) => row.id)
  console.log('')
  console.log('mutants applied ' + String(table.filter((row) => row.observed[0] !== 'anchor not shipped').length) + ' of ' + String(MUTANTS.length) + '; declared-set matches ' + String(table.length - mismatched.length) + ' of ' + String(table.length) + '; uncovered readings ' + show(uncovered))
  return ok && uncovered.length === 0 && mismatched.length === 0
}

const started = Date.now()
/** A reading that throws is a FAILED reading recorded against its own id: one broken input must not stop
 *  the readings after it, and a mutant that makes the subject throw is exactly what they have to see. */
const guard = async (id, body) => {
  try { await body() } catch (error) {
    if (!results.some((row) => row.id === id)) record(id, false, 'threw: ' + clip(error instanceof Error ? error.message : String(error), 160))
  }
}
await guard('R1', checkR1)
await guard('R2', checkR2)
await guard('R3', checkR3)
await guard('R4', checkR4)
const ordered = DECLARED.map((id) => ({ id, ok: (results.find((row) => row.id === id) || {}).ok === true }))
const held = ordered.filter((row) => row.ok).length
const failed = ordered.length - held
const escaped = DECLARED.filter((id) => !results.some((row) => row.id === id))
console.log('')
console.log('coverage matrix: ' + String(ordered.length) + ' declared readings, ' + String(held) + ' held, ' + String(failed) + ' failed, ' + String(escaped.length) + ' escaped')
if (JSON_OUT) console.log(JSON.stringify(Object.fromEntries(ordered.map((row) => [row.id, row.ok]))))
console.log('')
console.log('boundary: the checker is run on copies this gate builds, so its exit codes are observed rather than')
console.log('          trusted; the coverage rule reads the prose the checker never looks at; and the conflict refusal')
console.log('          is exercised over a real loopback route against the shipped built module.')
console.log(String(ordered.length) + ' readings, ' + String(held) + ' held, 0 skipped, ' + String(failed) + ' failed')
let attackOk = true
if (ATTACK && argv.indexOf('--mutant') === -1) attackOk = await runAttack()
console.log('wall ' + String(Date.now() - started) + ' ms')
if (process.env.DSH_KEEP_MUTANTS === '1') console.log('kept ' + String(MADE.length) + ' temporary director(ies) under .tmp (DSH_KEEP_MUTANTS=1)')
else for (const dir of MADE) rmSync(dir, { recursive: true, force: true })
process.exitCode = failed === 0 && attackOk ? 0 : 1
