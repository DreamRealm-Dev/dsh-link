#!/usr/bin/env node
/**
 * R85 gate: what a line shift actually COSTS the three citation tables, measured on the shipped tree.
 *
 * R84 measured, with a four-case harness, that a `path#text` row rides a line shift (the same citation was
 * found on 188 before and 208 after) while a `path:line` twin reddens on the same shift. R84 then tried to
 * convert the page and REVERTED, because three judges deliberately require the line form. This gate is the
 * consequence: it does not demand any form, it WATCHES the price of the form each table ships with.
 *
 * Directed-copy worlds only (a whole-tree copy hits ENOSPC on src-tauri/target and core/**), the checker is
 * copied INTO the world so it resolves the world's root, and the +N shift is applied to the cited sources
 * themselves \u2014 the same mechanism R71/R74 had to repair by hand.
 *
 * --json prints one line of readings; --self-attack rebuilds the world under each declared mutation and
 * compares measured flips/touches with the declared sets.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Roots are passed IN, never derived from where this file happens to sit (R81): the self-attack runs patched
// copies of this gate from .tmp, and a copy that derived its root from its own path would read an empty world.
const PROJECT = resolve(process.env.R85_PROJECT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const SELF_ATTACK = argv.includes('--self-attack')
const ONLY = (() => { const i = argv.indexOf('--only-mutant'); return i === -1 ? '' : argv[i + 1] })()
const MUTANT = process.env.R85_MUTANT ?? ''
const ROOTS = process.env.R85_ROOTS ?? ''
const SCRATCH = ROOTS === '' ? join(PROJECT, '.tmp', 'r85-drift') : ROOTS
const SHIFT = Number(process.env.R85_SHIFT ?? 20)
const PAGE = 'docs/protocol/device-net-v1.md'
const TEXT_DOCS = ['docs/handoff/PLAN.md', 'docs/handoff/STATUS.md']
const DOCS = [PAGE, ...TEXT_DOCS]
const BEGIN = '<!-- citations'
const END = '<!-- /citations -->'
const DECLARED_READINGS = 7

const filler = Array.from({ length: SHIFT }, (_, i) => '// R85 shift filler ' + String(i + 1)).join('\n') + '\n'
const flat = (text) => text.replace(/\s+/g, ' ').trim()

// The markers are matched at the START of a line, exactly like the shipped checker: debt 46's own prose in
// STATUS.md QUOTES both markers inside a sentence, so a plain indexOf lands on the wrong region and reads an
// empty table (found the hard way in R85's first baseline run).
function rowsOf(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(BEGIN))
  const end = lines.findIndex((line) => line.startsWith(END))
  if (start === -1 || end === -1 || end < start) return []
  const out = []
  for (const line of lines.slice(start, end + 1)) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 3) continue
    if (/^-+$/.test(cells[0].replace(/\s/g, ''))) continue
    if (cells[1] === 'where' || cells[0] === 'id') continue
    out.push({ id: cells[0], where: cells[1], form: /^(.*):(\d+)$/.test(cells[1]) ? 'line' : /^(.*)#(.+)$/.test(cells[1]) ? 'text' : 'other' })
  }
  return out
}
const anchorOf = (row) => { const hit = /^(.*)#(.+)$/.exec(row.where); return hit === null ? null : { path: hit[1], anchor: hit[2] } }
// Either form names a file, and BOTH must be copied into the world: the first version collected only the
// text-form rows, so the one line-form row pointing at scripts/verify-collab-multihop.mjs was never copied
// and the "unshifted control" went red with "no such file".
const pathOf = (row) => {
  const line = /^(.*):(\d+)$/.exec(row.where)
  if (line !== null) return line[1]
  const hash = /^(.*)#(.+)$/.exec(row.where)
  return hash === null ? null : hash[1]
}

// the instrument: three synthetic rows whose form is known by construction
function classify(line) {
  const row = rowsOf(BEGIN + ' fixture -->\n| id | where | must |\n|---|---|---|\n' + line + '\n' + END + '\n')[0]
  return row === undefined ? 'row-dropped' : row.form
}
const CALIBRATION = [
  ['| a | plugins/dsh-link-collab/src/index.ts:188 | x |', 'line', 'a plain path:line row is the line form'],
  ['| b | plugins/dsh-link-collab/src/index.ts#export function x | - |', 'text', 'a path#text row is the text form'],
  ['| c | plugins/dsh-link-collab/src/index.ts# | - |', 'other', 'an empty anchor is neither form'],
  ['| d | :188 | x |', 'line', 'an empty path still reads as the line form (the checker reports the missing file)'],
  ['| e | plugins/dsh-link-collab/src/index.ts | x |', 'other', 'a bare path is neither form'],
  ['| f | plugins/dsh-link-collab/src/index.ts#const a = 1 ; const b = 2 | - |', 'text', 'a semicolon does not break the text form'],
]

const live = (path) => readFileSync(join(PROJECT, path), 'utf8')

function buildWorld(name) {
  const root = join(SCRATCH, 'world-' + name)
  rmSync(root, { recursive: true, force: true })
  // The instrument lives at a path no page cites, and the SHIPPED checker is copied with the other cited
  // files: the first version copied the instrument to scripts/check-protocol-page.mjs and then shifted it as
  // a cited file, dragging 20 filler lines in front of its shebang and killing the world.
  mkdirSync(join(root, 'tools'), { recursive: true })
  cpSync(join(PROJECT, 'scripts', 'check-protocol-page.mjs'), join(root, 'tools', 'r85-check.mjs'))
  const cited = new Set()
  for (const doc of DOCS) for (const row of rowsOf(live(doc))) { const path = pathOf(row); if (path !== null) cited.add(path) }
  let copied = 0
  if (name !== 'no-cited-files') {
    for (const path of cited) {
      const target = join(root, path)
      mkdirSync(dirname(target), { recursive: true })
      const text = live(path)
      const unshifted = name === 'no-shift' || name === 'sanity-unchanged'
      writeFileSync(target, unshifted ? text : filler + text)
      copied += 1
    }
  }
  for (const doc of DOCS) {
    const target = join(root, doc)
    mkdirSync(dirname(target), { recursive: true })
    let text = live(doc)
    if (name === 'page-as-text') {
      for (const row of rowsOf(text)) {
        const hit = /^(.*):(\d+)$/.exec(row.where)
        if (hit === null) continue
        const lines = live(hit[1]).split(/\r?\n/)
        const needle = flat(lines[Number(hit[2]) - 1]).slice(0, 60).trim()
        if (needle === '') continue
        text = text.split(row.where).join(hit[1] + '#' + needle)
      }
    }
    if (name === 'plan-anchor-broken' && doc === TEXT_DOCS[0]) {
      const first = rowsOf(text).map(anchorOf).filter((one) => one !== null)[0]
      if (first !== undefined) text = text.split(first.path + '#' + first.anchor).join(first.path + '#R85 broke this anchor on purpose')
    }
    writeFileSync(target, text)
  }
  return { root, copies: copied }
}
const runCheck = (world, doc) => {
  const run = spawnSync(process.execPath, [join(world.root, 'tools', 'r85-check.mjs'), '--page', doc], { cwd: world.root, encoding: 'utf8' })
  const out = ((run.stdout ?? '') + (run.stderr ?? '')).split(/\r?\n/)
  return { exit: run.status, fails: out.filter((line) => /^\s*FAIL/.test(line)).length, first: flat(out.find((line) => /^\s*FAIL/.test(line)) ?? '').slice(0, 120) }
}

function measure() {
  const world = buildWorld(MUTANT === '' ? 'shipped' : MUTANT)
  const page = runCheck(world, PAGE)
  const texts = TEXT_DOCS.map((doc) => ({ doc, ...runCheck(world, doc) }))
  const plain = buildWorld(MUTANT === 'sanity-shifted' ? 'sanity-shifted' : 'sanity-unchanged')
  const sanity = [PAGE, ...TEXT_DOCS].map((doc) => runCheck(plain, doc).exit)
  const pageRows = rowsOf(live(PAGE))
  const lineRows = pageRows.filter((row) => row.form === 'line').length
  const textRowCounts = TEXT_DOCS.map((doc) => rowsOf(live(doc)).filter((row) => row.form === 'text').length)
  return { world, page, texts, sanity, pageRows: pageRows.length, lineRows, textRowCounts, copied: world.copies }
}

const runReadings = () => {
  const readings = []
  const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail: String(detail) })
  const m = measure()
  const shiftedRows = m.copied === 0 ? 0 : m.lineRows

  held('R1', 'the subject: the shipped page is line-form, the other two tables are text-form, and the world holds copies of every cited file',
    m.pageRows >= 40 && m.lineRows === m.pageRows && m.textRowCounts[0] >= 5 && m.textRowCounts[1] >= 5 && m.copied >= 2,
    'page rows=' + String(m.pageRows) + ' line-form=' + String(m.lineRows) + ' text-form=' + JSON.stringify(m.textRowCounts) + ' cited files copied=' + String(m.copied))

  held('R2', 'the price of the line form, measured: +' + String(SHIFT) + ' lines at the top of the cited sources reddens the page',
    m.page.exit === 1 && m.page.fails === shiftedRows && shiftedRows > 0,
    'page exit=' + String(m.page.exit) + ' failing rows=' + String(m.page.fails) + ' of ' + String(shiftedRows) + ' | ' + m.page.first)

  held('R3', 'the same shift does not touch the two text-form tables',
    m.texts.every((one) => one.exit === 0),
    m.texts.map((one) => one.doc.replace('docs/handoff/', '') + ' exit=' + String(one.exit) + (one.first === '' ? '' : ' | ' + one.first)).join('  '))

  held('R4', 'control: the world nobody shifted is green on all three tables (so R2 red is caused by the shift and not by the world)',
    m.sanity.every((exit) => exit === 0),
    'unshifted exits=' + JSON.stringify(m.sanity))

  held('R5', 'the cost is quantified and the reading cannot go vacuous: every line-form row into a shifted file breaks, and there is at least one',
    m.copied === 0 ? m.page.fails === 0 || m.page.exit === 3 : (m.page.fails === shiftedRows && shiftedRows > 0),
    'line-form rows=' + String(shiftedRows) + ' broken=' + String(m.page.fails) + ' shift=' + String(SHIFT) + ' cited copied=' + String(m.copied))

  const wrong = CALIBRATION.filter(([line, expect]) => classify(line) !== expect)
  held('R6', 'instrument calibration: the form classifier judges ' + String(CALIBRATION.length) + ' synthetic rows as declared',
    wrong.length === 0,
    String(CALIBRATION.length) + ' fixtures, verdicts=' + CALIBRATION.map(([line]) => (classify(line) === 'line' ? 'L' : classify(line) === 'text' ? 'T' : classify(line) === 'other' ? 'O' : '?')).join('') + ' wrong=' + JSON.stringify(wrong.map(([line]) => line)))

  held('RD', 'the declared reading count matches what this run produced', readings.length + 1 === DECLARED_READINGS, 'declared=' + String(DECLARED_READINGS) + ' produced=' + String(readings.length + 1))
  return readings
}

const MUTANTS = [
  { name: 'no-shift', moved: ['R2', 'R5'], touched: ['R2', 'R5'], why: 'remove the shift and the page stops breaking: the red in R2 must be caused by the shift' },
  { name: 'page-as-text', moved: ['R2', 'R5'], touched: ['R2', 'R5'], why: 'convert the world page to the text form (what R84 tried): the page then rides the shift, which is exactly the trade the three judges refuse' },
  { name: 'plan-anchor-broken', moved: ['R3'], touched: ['R3'], why: 'break one text-form anchor: a text row must still be falsifiable, not self-healing at any price' },
  { name: 'no-cited-files', moved: ['R1', 'R2', 'R3', 'R5'], touched: ['R1', 'R2', 'R3', 'R5'], why: 'copy no cited file: a world that cannot resolve its citations must not look measured' },
  { name: 'sanity-shifted', moved: ['R4'], touched: ['R4'], why: 'shift the CONTROL world too: then R2 and R4 agree and neither of them is a control any more' },
  { name: 'calibration-expectation-flipped', patch: { from: "['| a | plugins/dsh-link-collab/src/index.ts:188 | x |', 'line',", to: "['| a | plugins/dsh-link-collab/src/index.ts:188 | x |', 'text'," }, moved: ['R6'], touched: ['R6'], why: 'flip one calibration expectation: the classifier reading must redden rather than rubber-stamp itself' },
]

const signature = () => {
  const rows = runReadings()
  const out = {}
  for (const row of rows) out[row.id] = { ok: row.ok, detail: row.detail }
  return out
}
const flippedBetween = (before, after) => Object.keys(after).filter((id) => before[id].ok !== after[id].ok).sort()
const touchedBetween = (before, after) => Object.keys(after).filter((id) => before[id].detail !== after[id].detail).sort()
const agrees = (got, declared) => got.length === declared.length && got.every((id, at) => id === declared[at])

if (SELF_ATTACK) {
  const base = signature()
  let mismatches = 0
  let built = 0
  const movedAll = new Set()
  for (const mutant of MUTANTS) {
    if (ONLY !== '' && ONLY !== mutant.name) continue
    built += 1
    let target = fileURLToPath(import.meta.url)
    if (mutant.patch !== undefined) {
      const text = readFileSync(target, 'utf8')
      if (text.includes(mutant.patch.from) === false) { mismatches += 1; console.log('  FAIL  ' + mutant.name + '  anchor gone: ' + mutant.patch.from.slice(0, 60)); continue }
      target = join(SCRATCH, 'gate-' + mutant.name + '.mjs')
      writeFileSync(target, text.replace(mutant.patch.from, mutant.patch.to), 'utf8')
    }
    const run = spawnSync(process.execPath, [target, '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 240000,
      env: { ...process.env, R85_PROJECT: PROJECT, R85_MUTANT: mutant.name, R85_ROOTS: SCRATCH },
    })
    const line = ((run.stdout ?? '') + (run.stderr ?? '')).split(/\r?\n/).filter((one) => one.startsWith('[')).pop()
    if (line === undefined) { mismatches += 1; console.log('  FAIL  ' + mutant.name + '  produced no readings'); continue }
    const after = {}
    for (const row of JSON.parse(line)) after[row.id] = { ok: row.ok, detail: row.detail }
    const flipped = flippedBetween(base, after)
    const touched = touchedBetween(base, after)
    for (const id of flipped) movedAll.add(id)
    const ok = agrees(flipped, mutant.moved) && agrees(touched, mutant.touched)
    if (!ok) mismatches += 1
    console.log((ok ? '  ok    ' : '  FAIL  ') + mutant.name + '  flipped=' + (flipped.join(',') || '(none)') + ' declared=' + mutant.moved.join(',') +
      ' touched=' + touched.join(',') + ' touched-declared=' + mutant.touched.join(',') + '  |  ' + mutant.why)
  }
  const uncovered = Object.keys(base).filter((id) => movedAll.has(id) === false && id !== 'RD')
  console.log('coverage: ' + String(Object.keys(base).length - 1) + ' readings, ' + String(movedAll.size) + ' moved by at least one mutant, uncovered=' + (uncovered.join(',') || '(none)'))
  console.log('declared-set mismatches: ' + String(mismatches) + '; mutants that could not be built: ' + String(MUTANTS.length - built))
  process.exit(mismatches === 0 && uncovered.length === 0 && built === MUTANTS.length ? 0 : 1)
}

const readings = runReadings()
if (JSON_OUT) console.log(JSON.stringify(readings))
else {
  for (const row of readings) console.log((row.ok ? '  ok    ' : '  FAIL  ') + row.id + ' ' + row.name + '  |  ' + row.detail)
  const failed = readings.filter((row) => row.ok === false).length
  console.log(String(readings.length) + ' readings, ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed')
}
process.exit(readings.every((row) => row.ok) ? 0 : 1)
