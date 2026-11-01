#!/usr/bin/env node
/**
 * R86 gate: the repair path, judged by somebody other than the repairman.
 *
 * R84 measured that the device-net page's 42 line-form rows all break when the cited sources move; R71 and
 * R74 paid that repair BY HAND. R86 added scripts/realign-citations.mjs. This gate never asks the tool
 * whether it worked: it builds a directed-copy world, lets scripts/check-protocol-page.mjs (a third
 * artifact) judge the page, and only then asks the tool to repair it \u2014 after which the SAME judge must
 * go green again, with a line-by-line diff proving nothing but the 42 where-cells moved.
 *
 * AUTHORSHIP, stated plainly: this gate and the tool share an author (Lead), which is weaker than every
 * other gate in this repository. Mitigations, not excuses: the judge is a different artifact, two of the
 * readings below were independently recomputed by teammate \`simulator\` (shipped baseline, and that
 * \`--check\` writes no bytes), and the world/shift mechanism already has an independently built sibling
 * (\`citation-drift\`). Recorded as a separation debt in docs/handoff/R86-citation-realign.md.
 *
 * --json prints one line of readings; --self-attack rebuilds under each declared mutation.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(process.env.R86_PROJECT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const SELF_ATTACK = argv.includes('--self-attack')
const ONLY = (() => { const i = argv.indexOf('--only-mutant'); return i === -1 ? '' : argv[i + 1] })()
const MUTANT = process.env.R86_MUTANT ?? ''
const ROOTS = process.env.R86_ROOTS ?? ''
const SCRATCH = ROOTS === '' ? join(PROJECT, '.tmp', 'r86-gate') : ROOTS
const DOC = 'docs/protocol/device-net-v1.md'
const SHIFT = 20
const DECLARED_READINGS = 12
const FILLER = Array.from({ length: SHIFT }, (_, i) => '// r86 filler ' + String(i + 1)).join('\n') + '\n'
const ANCHOR = 'export interface RelayRecord {'
const flat = (text) => text.replace(/\s+/g, ' ').trim()
const linesOf = (text) => text.split(/\r?\n/)

// An independent reader for the marker region and the two forms: the gate must not borrow the tool's parser.
// Markers match at the START of a line, like the shipped checker (debt 46's prose quotes both markers).
function tableOf(text) {
  const all = linesOf(text)
  const start = all.findIndex((line) => line.startsWith('<!-- citations'))
  const end = all.findIndex((line) => line.startsWith('<!-- /citations -->'))
  if (start === -1 || end === -1 || end < start) return []
  const rows = []
  for (const line of all.slice(start + 1, end)) {
    if (line.trim().startsWith('|') === false) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 3) continue
    if (/^-+$/.test(cells[0].replace(/\s/g, ''))) continue
    if (cells[1] === 'where' || cells[0] === 'id') continue
    rows.push({ id: cells[0], where: cells[1], form: /^(.*):(\d+)$/.test(cells[1]) ? 'line' : /^(.*)#(.+)$/.test(cells[1]) ? 'text' : 'other' })
  }
  return rows
}
const classify = (line) => (tableOf('<!-- citations x -->\n| id | where | must |\n|---|---|---|\n' + line + '\n<!-- /citations -->\n')[0] ?? { form: 'row-dropped' }).form
const CALIBRATION = [
  ['| a | plugins/dsh-link-collab/src/index.ts:188 | x |', 'line'],
  ['| b | plugins/dsh-link-collab/src/index.ts#export function x | - |', 'text'],
  ['| c | plugins/dsh-link-collab/src/index.ts# | - |', 'other'],
  ['| d | :188 | x |', 'line'],
  ['| e | plugins/dsh-link-collab/src/index.ts | x |', 'other'],
]

const PLAN_DOC = 'docs/handoff/PLAN.md'
const live = (path) => readFileSync(join(PROJECT, path), 'utf8')
const citedOf = (doc) => {
  const out = new Set()
  for (const row of tableOf(live(doc))) {
    const hit = /^(.*):(\d+)$/.exec(row.where) ?? /^(.*)#(.+)$/.exec(row.where)
    if (hit !== null) out.add(hit[1])
  }
  return [...out]
}
// R88 worlds: the two cases T48 named, each built so the tool has to REFUSE rather than guess.
function buildPlanWorld(name, kind) {
  const root = join(SCRATCH, 'world-' + name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'docs', 'handoff'), { recursive: true })
  writeFileSync(join(root, PLAN_DOC), live(PLAN_DOC))
  for (const path of citedOf(PLAN_DOC)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    let text = live(path)
    const first = tableOf(live(PLAN_DOC)).filter((row) => row.form === 'text')[0]
    const hit = first === undefined ? null : /^(.*)#(.+)$/.exec(first.where)
    if (kind === 'dup-plan-anchor' && hit !== null && hit[1] === path) {
      const rows = linesOf(text)
      const at = rows.findIndex((one) => one.includes(hit[2]))
      if (at !== -1) { rows.splice(at, 0, rows[at]); text = rows.join('\n') }
    }
    writeFileSync(target, text)
  }
  return root
}
function buildWorld(name, kind) {
  const root = join(SCRATCH, 'world-' + name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'tools'), { recursive: true })
  mkdirSync(join(root, dirname(DOC)), { recursive: true })
  cpSync(join(PROJECT, 'scripts', 'check-protocol-page.mjs'), join(root, 'tools', 'check.mjs'))
  writeFileSync(join(root, DOC), live(DOC))
  if (kind !== 'no-cited-files') {
    for (const row of tableOf(live(DOC))) {
      const hit = /^(.*):(\d+)$/.exec(row.where) ?? /^(.*)#(.+)$/.exec(row.where)
      if (hit === null) continue
      const target = join(root, hit[1])
      mkdirSync(dirname(target), { recursive: true })
      let text = live(hit[1])
      if (kind !== 'no-shift') text = FILLER + text
      if (kind === 'span-anchor') {
        const rows = linesOf(text)
        const at = rows.findIndex((one) => one.includes(ANCHOR))
        // the anchor text itself is cut in two: no single line holds the fragment any more
        if (at !== -1) { rows.splice(at, 1, ANCHOR.replace(/ \{$/, ''), '{'); text = rows.join('\n') }
      }
      if (kind === 'drop-anchor' || kind === 'duplicate-anchor') {
        const rows = linesOf(text)
        const at = rows.findIndex((one) => one.includes(ANCHOR))
        if (at !== -1) {
          if (kind === 'drop-anchor') rows.splice(at, 1)
          else rows.splice(at, 0, rows[at])
          text = rows.join('\n')
        }
      }
      writeFileSync(target, text)
    }
  }
  return root
}
const judge = (root) => {
  const run = spawnSync(process.execPath, [join(root, 'tools', 'check.mjs'), '--page', DOC], { cwd: root, encoding: 'utf8' })
  const out = ((run.stdout ?? '') + (run.stderr ?? '')).split(/\r?\n/)
  return { exit: run.status, fails: out.filter((line) => /^\s*FAIL/.test(line)).length }
}
const TOOL = resolve(process.env.R86_TOOL ?? join(PROJECT, 'scripts', 'realign-citations.mjs'))
const realign = (root, extra, doc = DOC) => {
  const run = spawnSync(process.execPath, [TOOL, '--root', root, '--page', doc, ...extra, '--json'], { cwd: PROJECT, encoding: 'utf8' })
  const line = ((run.stdout ?? '') + (run.stderr ?? '')).split(/\r?\n/).filter((one) => one.startsWith('{')).pop()
  return { exit: run.status, out: line === undefined ? null : JSON.parse(line) }
}

function measure() {
  const out = {}
  // R183: the page grew from 42 line-form rows to 125 (two new sections, and the ledger face they
  // document). Every count below is a premise the page's own table answers, so it is COUNTED here rather
  // than written down: a judge that hardcodes today's row count reddens the day the page it judges gets
  // longer, and prints the contradiction itself - "125 of 42" (measured, 19:0x).
  const ROWS = tableOf(live(DOC)).filter((row) => row.form === 'line').length
  const ONE_SHORT = ROWS - 1
  // The control world is the SAME construction with the shift left out \u2014 and when a mutant says
  // "shift the control too", that is exactly what this line builds, so R1 goes red on its own evidence.
  const control = buildWorld('control', MUTANT === 'sanity-shifted' ? 'drift' : 'no-shift')
  const controlJudge = judge(control)
  const controlCheck = realign(control, ['--check'])
  out.R1 = {
    ok: controlJudge.exit === 0 && controlCheck.exit === 0 && controlCheck.out.stale.length === 0 && controlCheck.out.rewritten === 0,
    detail: 'control world (same construction, no shift): checker exit=' + String(controlJudge.exit) + ' --check exit=' + String(controlCheck.exit) + ' stale=' + String(controlCheck.out === null ? -1 : controlCheck.out.stale.length) + ' rewritten=' + String(controlCheck.out === null ? -1 : controlCheck.out.rewritten),
  }

  const drift = buildWorld('drift', MUTANT === 'no-shift' ? 'no-shift' : MUTANT === 'no-cited-files' ? 'no-cited-files' : 'drift')
  const damaged = judge(drift)
  out.R2 = { ok: damaged.exit === 1 && damaged.fails === ROWS, detail: 'drifted world: checker exit=' + String(damaged.exit) + ' failing rows=' + String(damaged.fails) + ' of ' + String(ROWS) }

  const pageBefore = readFileSync(join(drift, DOC), 'utf8')
  const checkOnly = MUTANT === 'no-cited-files' ? { exit: 3, out: { stale: [], rewritten: 0, refused: [] } } : realign(drift, ['--check'])
  const pageAfterCheck = readFileSync(join(drift, DOC), 'utf8')
  out.R3 = {
    ok: checkOnly.exit === 1 && checkOnly.out.stale.length === ROWS && checkOnly.out.rewritten === 0 && pageAfterCheck === pageBefore,
    detail: '--check exit=' + String(checkOnly.exit) + ' stale=' + String(checkOnly.out.stale.length) + ' rewritten=' + String(checkOnly.out.rewritten) + ' page byte-identical=' + String(pageAfterCheck === pageBefore),
  }

  const repaired = MUTANT === 'no-cited-files' ? { exit: 3, out: { rewritten: 0 } } : realign(drift, [])
  const pageRepaired = readFileSync(join(drift, DOC), 'utf8')
  if (MUTANT === 'repair-not-applied') writeFileSync(join(drift, DOC), pageBefore, 'utf8')
  const nowText = readFileSync(join(drift, DOC), 'utf8')
  const a = linesOf(pageBefore), b = linesOf(nowText)
  const changed = a.map((one, i) => (one === b[i] ? null : i)).filter((i) => i !== null)
  const allCitation = changed.length > 0 && changed.every((i) => a[i].includes(':') && a[i].trim().startsWith('|'))
  out.R4 = {
    ok: repaired.exit === 0 && repaired.out.rewritten === ROWS && a.length === b.length && changed.length === ROWS && allCitation,
    detail: 'repair exit=' + String(repaired.exit) + ' rewritten=' + String(repaired.out.rewritten) + ' lines ' + String(a.length) + '->' + String(b.length) + ' changed lines=' + String(changed.length) + ' all-citation-rows=' + String(allCitation),
  }

  const healed = judge(drift)
  out.R5 = { ok: healed.exit === 0 && pageRepaired !== pageBefore, detail: 'after repair the JUDGE says: checker exit=' + String(healed.exit) + ' failing=' + String(healed.fails) + ' page changed=' + String(pageRepaired !== pageBefore) }

  // R87: byte-level exactness, and the reason this reading exists. An independent recompute (teammate
  // critic, a DIFFERENT world construction: shift 7 only in verify-collab-multihop.mjs) caught the tool
  // rewriting all 151 line endings of the page while reporting one rewritten row. Functionally green,
  // byte-wise a ghost diff. So the expected page is rebuilt from the stale list and compared byte for byte;
  // the mutant below reverts the fix and this reading must redden.
  const beforeLines = linesOf(pageBefore)
  const afterLines = linesOf(pageRepaired)
  const differing = beforeLines.map((one, i) => (one === afterLines[i] ? null : i)).filter((i) => i !== null)
  const cellOnly = differing.every((i) => {
    const rowA = tableOf(pageBefore).find((row) => beforeLines[i].includes('| ' + row.id + ' |'))
    if (rowA === undefined) return false
    const rowB = tableOf(pageRepaired).find((row) => row.id === rowA.id)
    if (rowB === undefined) return false
    // strip the where cell from both versions of the line: what is left must be identical, so the ONLY
    // difference on that line is the cell the tool said it repaired.
    return beforeLines[i].split(rowA.where).join('') === afterLines[i].split(rowB.where).join('')
  })
  const endings = (text) => (text.match(/\r\n/g) ?? []).length
  const endingsPreserved = endings(pageRepaired) === endings(pageBefore)
  out.R9 = {
    ok: checkOnly.out.stale.length === ROWS && differing.length === ROWS && cellOnly && endingsPreserved && beforeLines.length === afterLines.length,
    detail: 'byte-level: changed lines=' + String(differing.length) + '/' + String(ROWS) + ', every changed line differs ONLY in its where cell=' + String(cellOnly) + ', line endings preserved=' + String(endingsPreserved) + ' (' + String(endings(pageBefore)) + ' CRLF), line count ' + String(beforeLines.length) + '->' + String(afterLines.length) + ', bytes ' + String(Buffer.byteLength(pageBefore, 'utf8')) + '->' + String(Buffer.byteLength(pageRepaired, 'utf8')),
  }

  const doomed = buildWorld('doomed', MUTANT === 'no-dropped-anchor' ? 'drift' : MUTANT === 'no-cited-files' ? 'no-cited-files' : 'drop-anchor')
  const refused = realign(doomed, [])
  // R214: the cell expectation is DERIVED, not written down. The version before this round required the
  // refused row's cell to end with ':237' - the world line number of the day the anchor sat at line 217 of
  // index.ts - and it reddened, correctly and uselessly, when 23 lines of unrelated product work moved the
  // anchor to 240. What the reading owes the product is: the refused row keeps byte-for-byte the cell the
  // page carried in, and (below) the refused row IS the row whose anchor was taken away. A fixture that
  // pins a line number measures the calendar; this one now measures the refusal.
  const cellBefore = tableOf(live(DOC)).find((row) => row.id === 'record-shape').where
  const leftAlone = (page) => {
    const rows = tableOf(page).filter((row) => row.id === 'record-shape')
    return rows.length === 1 && rows[0].where === cellBefore
  }
  const doomedPage = readFileSync(join(doomed, DOC), 'utf8')
  const goneRows = refused.out.refused.filter((one) => one.reason.startsWith('anchor-gone'))
  out.R6 = {
    ok: refused.exit === 1 && goneRows.length === 1 && goneRows[0].id === 'record-shape' && refused.out.rewritten === ONE_SHORT && leftAlone(doomedPage),
    detail: 'exit=' + String(refused.exit) + ' anchor-gone=' + String(goneRows.length) + ' still-repaired=' + String(refused.out.rewritten) + ' refused-row-left-alone=' + String(leftAlone(doomedPage)),
  }

  const twice = buildWorld('twice', MUTANT === 'no-duplicate' ? 'drift' : MUTANT === 'no-cited-files' ? 'no-cited-files' : 'duplicate-anchor')
  const ambiguous = realign(twice, [])
  const ambiguousRows = ambiguous.out.refused.filter((one) => one.reason.startsWith('ambiguous'))
  out.R7 = {
    ok: ambiguous.exit === 1 && ambiguousRows.length === 1 && ambiguous.out.rewritten === ONE_SHORT,
    detail: 'exit=' + String(ambiguous.exit) + ' ambiguous refused=' + String(ambiguousRows.length) + ' reasons=' + JSON.stringify(ambiguousRows.map((one) => one.reason).slice(0, 1)) + ' still-repaired=' + String(ambiguous.out.rewritten),
  }

  // R10 (T48a): a \`path#text\` anchor made non-unique by the world must be REFUSED and left alone. The first
  // version of the tool never looked at that anchor at all (it searched the must column, which is '-' here)
  // and refused all 7 rows with a line list thousands of numbers long: the reading below is what finds that.
  const planRoot = buildPlanWorld('plan', MUTANT === 'no-plan-duplicate' ? 'plain' : 'dup-plan-anchor')
  const planBefore = readFileSync(join(planRoot, PLAN_DOC), 'utf8')
  const planCheck = realign(planRoot, ['--check'], PLAN_DOC)
  const planAfter = readFileSync(join(planRoot, PLAN_DOC), 'utf8')
  const planTarget = tableOf(live(PLAN_DOC)).filter((row) => row.form === 'text')[0]
  const planRefused = planCheck.out.refused.filter((one) => one.id === planTarget.id && one.reason.startsWith('text-not-unique'))
  out.R10 = {
    ok: planCheck.exit === 1 && planRefused.length === 1 && planCheck.out.refused.length === 1 && planCheck.out.rewritten === 0 && planAfter === planBefore,
    detail: 'ambiguous text anchor: exit=' + String(planCheck.exit) + ' refused=' + JSON.stringify(planCheck.out.refused.map((one) => one.id + ':' + one.reason.split(':')[0])) + ' rewritten=' + String(planCheck.out.rewritten) + ' page untouched=' + String(planAfter === planBefore),
  }

  // R11 (T48b): fragments split across two lines cannot be located on one line \u2014 refuse, never guess.
  const spanning = buildWorld('spanning', MUTANT === 'no-span' ? 'drift' : 'span-anchor')
  const spanRepair = realign(spanning, [])
  const spanPage = readFileSync(join(spanning, DOC), 'utf8')
  const spanGone = spanRepair.out.refused.filter((one) => one.reason.startsWith('anchor-gone'))
  out.R11 = {
    ok: spanRepair.exit === 1 && spanGone.length === 1 && spanGone[0].id === 'record-shape' && spanRepair.out.rewritten === ONE_SHORT && leftAlone(spanPage),
    detail: 'fragments spanning two lines: exit=' + String(spanRepair.exit) + ' anchor-gone=' + String(spanGone.length) + ' still-repaired=' + String(spanRepair.out.rewritten) + ' refused-row-left-alone=' + String(leftAlone(spanPage)),
  }

  const wrong = CALIBRATION.filter(([line, expect]) => classify(line) !== expect)
  out.R8 = { ok: wrong.length === 0, detail: String(CALIBRATION.length) + ' fixtures, verdicts=' + CALIBRATION.map(([line]) => classify(line)[0].toUpperCase()).join('') + ' wrong=' + String(wrong.length) }
  return out
}

const runReadings = () => {
  const measured = measure()
  const rows = Object.keys(measured).map((id) => ({ id, ok: measured[id].ok, detail: measured[id].detail }))
  rows.push({ id: 'RD', ok: rows.length + 1 === DECLARED_READINGS, detail: 'declared=' + String(DECLARED_READINGS) + ' produced=' + String(rows.length + 1) })
  return rows
}

const MUTANTS = [
  { name: 'no-shift', moved: ['R2', 'R3', 'R4', 'R5', 'R9'], touched: ['R2', 'R3', 'R4', 'R5', 'R9'], why: 'no shift: the damage R2 measures must not be there, so the whole repair chain loses its subject' },
  { name: 'no-cited-files', moved: ['R3', 'R4', 'R5', 'R6', 'R7', 'R9'], touched: ['R3', 'R4', 'R5', 'R6', 'R7', 'R9'], why: 'copy no cited file into ANY world: the tool must then refuse (not-such-file) instead of repairing, and the two refusal readings must lose their expected reasons. R2 is deliberately unchanged \u2014 the judge reports the same 42 failing rows whether the files are missing or merely shifted, and that is honest' },
  { name: 'repair-not-applied', moved: ['R4', 'R5'], touched: ['R4', 'R5'], why: 'run the repair but throw the result away: the JUDGE must stay red, which is why R5 is judged by the checker and not by the tool' },
  { name: 'sanity-shifted', moved: ['R1'], touched: ['R1'], why: 'shift the control world too: then there is no control left and R1 must say so' },
  { name: 'no-dropped-anchor', moved: ['R6'], touched: ['R6'], why: 'do not delete the anchor: an expected refusal that never happens must redden its own reading' },
  { name: 'no-duplicate', moved: ['R7'], touched: ['R7'], why: 'do not duplicate the anchor: ambiguity that is not there must not be reported as repaired' },
  { name: 'tool-eol-normalizing', patchTool: { from: "const EOL = page.includes('\\r\\n') ? '\\r\\n' : '\\n'", to: "const EOL = '\\n'" }, moved: ['R9'], touched: ['R9'], why: 'revert the R87 fix in a copy of the tool: the byte-exactness reading must redden, which is the only thing that proves it measures the pit the independent recompute found' },
  { name: 'no-plan-duplicate', moved: ['R10'], touched: ['R10'], why: 'do not duplicate the text anchor: an ambiguity that is not there must not be refused (nor must the tool be let off by searching something else)' },
  { name: 'no-span', moved: ['R11'], touched: ['R11'], why: 'do not split the anchor line: then every row is repairable and a refusal that never happens must redden its own reading' },
  { name: 'calibration-expectation-flipped', patch: { from: "['| a | plugins/dsh-link-collab/src/index.ts:188 | x |', 'line'],", to: "['| a | plugins/dsh-link-collab/src/index.ts:188 | x |', 'text']," }, moved: ['R8'], touched: ['R8'], why: 'flip one calibration expectation: the classifier reading must redden instead of rubber-stamping itself' },
]

const signature = () => { const out = {}; for (const row of runReadings()) out[row.id] = { ok: row.ok, detail: row.detail }; return out }
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
    let toolOverride = ''
    if (mutant.patchTool !== undefined) {
      const text = readFileSync(TOOL, 'utf8')
      if (text.includes(mutant.patchTool.from) === false) { mismatches += 1; console.log('  FAIL  ' + mutant.name + '  the tool no longer carries the line this mutant reverts'); continue }
      toolOverride = join(SCRATCH, 'tool-' + mutant.name + '.mjs')
      writeFileSync(toolOverride, text.replace(mutant.patchTool.from, mutant.patchTool.to), 'utf8')
    }
    if (mutant.patch !== undefined) {
      const text = readFileSync(target, 'utf8')
      if (text.includes(mutant.patch.from) === false) { mismatches += 1; console.log('  FAIL  ' + mutant.name + '  anchor gone'); continue }
      target = join(SCRATCH, 'gate-' + mutant.name + '.mjs')
      writeFileSync(target, text.replace(mutant.patch.from, mutant.patch.to), 'utf8')
    }
    const run = spawnSync(process.execPath, [target, '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 300000,
      env: { ...process.env, R86_PROJECT: PROJECT, R86_MUTANT: mutant.name, R86_ROOTS: SCRATCH, ...(toolOverride === '' ? {} : { R86_TOOL: toolOverride }) },
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
  for (const row of readings) console.log((row.ok ? '  ok    ' : '  FAIL  ') + row.id + '  |  ' + row.detail)
  const failed = readings.filter((row) => row.ok === false).length
  console.log(String(readings.length) + ' readings, ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed')
}
process.exit(readings.every((row) => row.ok) ? 0 : 1)
