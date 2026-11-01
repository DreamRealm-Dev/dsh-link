#!/usr/bin/env node
/**
 * R61 gate: the citation tables in three documents, and the checker that reads them.
 *
 * A citation table is a judge, and the checker under it is an instrument: this gate judges BOTH. It
 * runs the shipped checker against the shipped tables (and reads the checker's own count instead of
 * trusting a number written here), proves both citation forms can go red on copies, proves a
 * malformed row is loud instead of being dropped, measures the checker's known blind spot (a deleted
 * row is invisible to it) and covers that blind spot itself, and finally ties the cited seams to the
 * SHIPPED module: a table row that claims `export function X` must find X on the built artifact.
 *
 * Mutants are applied to copies only: the checker, one document and the built module each have a
 * mutant copy, and every anchor is taken from the shipped file (a missing anchor is a failure, never a
 * silent skip). Exit 0 all readings hold; 1 a reading failed; 3 an input is missing.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const all = (name) => argv.reduce((out, item, index) => (item === name && argv[index + 1] !== undefined ? [...out, argv[index + 1]] : out), [])
const at = (value) => (isAbsolute(value) ? value : join(PROJECT, value))
const CHECKER = at(option('--checker', 'scripts/check-protocol-page.mjs'))
const COLLAB = at(option('--collab', 'plugins/dsh-link-collab/lib/index.js'))
const ONLY = option('--only-mutant', '')
const DOCS = (all('--doc').length > 0 ? all('--doc') : ['docs/protocol/device-net-v1.md', 'docs/handoff/PLAN.md', 'docs/handoff/STATUS.md']).map(at)
const SELF_ATTACK = argv.includes('--self-attack')
const BEGIN = '<!-- citations'
const END = '<!-- /citations -->'
const DECLARED = ['R1', 'R2', 'R3', 'R4', 'R5']

const ROOT = mkdtempSync(join(tmpdir(), 'r61-citations-'))
const MIRROR = join(ROOT, 'mirror')
const flat = (text) => text.replace(/\s+/g, ' ').trim()
const cells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim())
const stage = (name, text) => { const path = join(ROOT, name); writeFileSync(path, text); return path }

/**
 * Stage a copy of `original` holding `replaced`, and say whether the text actually moved. A
 * replacement that matches nothing leaves the copy identical, and a reading measured on an unchanged
 * copy reports the input's behaviour while looking like it tested something — this gate's author hit
 * exactly that twice in one sitting (an anchor spelled `export function` where the table says
 * `export async function`, and a row rewritten without its third cell). Silent no-ops are the failure
 * mode of every copy-and-mutate technique, so they are flagged instead of being discovered later.
 */
function copyOf(name, original, replaced) {
  if (original === replaced) return { path: null, changed: false }
  return { path: stage(name, replaced), changed: true }
}

/**
 * A mirror world for checker mutants: the checker resolves cited paths against ITS OWN directory, so a
 * copy dropped in a temp dir would resolve every citation to a file that is not there and redden
 * everything — which is a fact about where the copy sits, not about the mutant. The mirror copies each
 * cited file to the same relative path under one root, and the mutant checker lives in that root.
 */
function mirror(root) {
  const seen = new Set()
  for (const doc of DOCS) {
    for (const row of table(doc).rows) {
      const match = /^([^#:]+)[#:]/.exec(row.where)
      if (match === null || seen.has(match[1])) continue
      seen.add(match[1])
      const source = join(PROJECT, match[1])
      if (!existsSync(source)) continue
      const target = join(root, match[1])
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(source))
    }
  }
  return root
}

/** This gate's own parser, written apart from the checker's: the two counts are compared. */
function table(absPath) {
  const lines = readFileSync(absPath, 'utf8').split(/\r?\n/)
  const begin = lines.findIndex((line) => line.startsWith(BEGIN))
  const end = lines.findIndex((line) => line.trim() === END)
  if (begin === -1 || end === -1 || end < begin) return { rows: [], malformed: [] }
  const rows = []
  const malformed = []
  for (const line of lines.slice(begin + 1, end)) {
    if (!line.trim().startsWith('|')) continue
    const [id, where, must] = cells(line)
    if (id === 'id' || id === undefined || /^-+$/.test(id)) continue
    if (where === undefined || where === '' || must === undefined) { malformed.push(line); continue }
    rows.push({ id, where, fragments: must === '' || must === '-' ? [] : must.split(' ; ') })
  }
  return { rows, malformed }
}

/** Run the checker the way a reader would, over one document. */
function check(doc, checker = CHECKER) {
  if (!existsSync(checker)) return { status: 3, out: 'the checker is missing: ' + checker, summary: null }
  const run = spawnSync(process.execPath, [checker, '--page', doc], { cwd: PROJECT, encoding: 'utf8' })
  const out = String(run.stdout ?? '') + String(run.stderr ?? '')
  const match = /(\d+) of (\d+) citation\(s\) hold/.exec(out)
  return { status: run.status, out, summary: match === null ? null : { held: Number(match[1]), total: Number(match[2]) } }
}

/** Whether git knows this path: a citation into a build output or a temp file cannot be maintained. */
function tracked(relative) {
  const run = spawnSync('git', ['ls-files', '--error-unmatch', '--', relative], { cwd: PROJECT, encoding: 'utf8' })
  return run.status === 0
}

/** A needle of the form `export function X` / `export const X` names a seam, not just a string. */
function seamOf(row) {
  const hash = /^(.*)#(.+)$/.exec(row.where)
  if (hash === null) return null
  const match = /export (?:async )?(?:function|const) ([A-Za-z_$][\w$]*)/.exec(hash[2])
  return match === null ? null : { file: hash[1], name: match[1] }
}

const results = []
const reached = new Set()
const reading = async (id, label, body) => {
  reached.add(id)
  try {
    const verdict = await body()
    results.push({ id, label, ok: verdict.ok === true, detail: verdict.detail })
  } catch (error) {
    results.push({ id, label, ok: false, detail: 'this reading threw: ' + String(error).slice(0, 200) })
  }
}

await reading('R1', 'every shipped table holds, and the checker count matches an independent count', async () => {
  const details = []
  let ok = true
  for (const doc of DOCS) {
    const run = check(doc)
    const mine = table(doc).rows.length
    const theirs = run.summary === null ? -1 : run.summary.total
    if (run.status !== 0 || theirs !== mine || run.summary === null || run.summary.held !== mine) ok = false
    details.push(doc.replace(PROJECT + '\\', '') + ': exit=' + String(run.status) + ' checker=' + String(theirs) + ' mine=' + String(mine))
  }
  return { ok, detail: details.join(' | ') }
})

await reading('R2', 'both citation forms can go red, and an untouched copy stays green', async () => {
  const protocol = readFileSync(DOCS[0], 'utf8')
  const plan = readFileSync(DOCS[1], 'utf8')
  // R84/T45: the protocol table is now entirely `path#text` (self-healing), so the off-by-one mutant can
  // no longer be cut out of a shipped row — it is SYNTHESISED instead: one extra row whose line number is
  // exactly one past the line that really holds the needle. The reading still measures the brittle form
  // (path:line can go red on drift) without the shipped table having to keep a stale line number alive.
  const source = readFileSync(join(PROJECT, 'plugins/dsh-link-collab/src/index.ts'), 'utf8').split(/\r?\n/)
  const needle = 'export interface RelayRecord {'
  const lands = source.findIndex((line) => line.includes(needle)) + 1
  if (lands === 0) return { ok: false, detail: 'the anchor ' + needle + ' is gone from the cited source, so the off-by-one mutant could not be built' }
  const synthetic = '| off-by-one-fixture | plugins/dsh-link-collab/src/index.ts:' + String(lands + 1) + ' | ' + needle + ' |'
  const shifted = copyOf('shifted.md', protocol, protocol.replace(END, synthetic + '\n' + END))
  const reworded = copyOf('reworded.md', protocol, protocol.replace("refuse(401, 'UNAUTHORIZED')", "refuse(401, 'WRONG')"))
  const missing = copyOf('missing.md', plan, plan.replace('#export function createMcpClient', '#export function createMcpClientGone'))
  const ambiguous = copyOf('ambiguous.md', plan, plan.replace('#export async function executeDispatches', '#const '))
  const intact = copyOf('intact.md', plan, plan + '\n')
  const cases = [
    ['a line number off by one', shifted, 1],
    ['a reworded fragment', reworded, 1],
    ['a needle that no longer exists', missing, 1],
    ['a needle that appears on many lines', ambiguous, 1],
    ['an untouched copy', intact, 0],
  ]
  const details = []
  let ok = true
  for (const [what, copy, expected] of cases) {
    if (!copy.changed) ok = false
    const run = copy.path === null ? { status: -1 } : check(copy.path)
    if (run.status !== expected) ok = false
    details.push(what + ' -> ' + (copy.changed ? 'exit ' + String(run.status) : 'THE COPY DID NOT CHANGE, so nothing was measured'))
  }
  const ambiguousRun = ambiguous.path === null ? { out: '' } : check(ambiguous.path)
  const namesMany = /appears on (\d+) lines/.exec(ambiguousRun.out)
  if (namesMany === null || Number(namesMany[1]) < 2) ok = false
  details.push('the ambiguous report names ' + (namesMany === null ? 'no line count' : namesMany[1] + ' lines'))
  return { ok, detail: details.join(' | ') }
})

await reading('R3', 'a malformed row is loud, and repairing it with a dash is accepted', async () => {
  const plan = readFileSync(DOCS[1], 'utf8')
  const row = "| gate-device-net-variants | scripts/verify-all.mjs#{ name: 'device-net-variants' | - |"
  const shortRow = '| gate-device-net-variants | scripts/verify-all.mjs |'
  const brokenText = plan.replace(row, shortRow)
  // The repaired copy is staged FROM the broken one: repairing a copy and then comparing it with the
  // untouched original would produce an identical file, which proves nothing (that is what this gate's
  // guard flagged the first time it ran).
  const truncated = copyOf('truncated.md', plan, brokenText)
  const repaired = copyOf('repaired.md', brokenText, brokenText.replace(shortRow, row))
  const bad = truncated.path === null ? { status: -1, out: '' } : check(truncated.path)
  const good = repaired.path === null ? { status: -1 } : check(repaired.path)
  const loud = /malformed row/.test(bad.out)
  return { ok: truncated.changed && repaired.changed && bad.status === 1 && loud && good.status === 0, detail: 'short row exit=' + String(bad.status) + ' says-malformed=' + String(loud) + ' | two-cell row with a dash exit=' + String(good.status) + ' | both copies changed: ' + String(truncated.changed && repaired.changed) }
})

await reading('R4', 'the checker cannot see a deleted row, and this gate checks what the table covers', async () => {
  const plan = readFileSync(DOCS[1], 'utf8')
  const row = "| mcp-client | plugins/dsh-link-collab/src/index.ts#export function createMcpClient | - |\n"
  const deleted = stage('deleted.md', plan.replace(row, ''))
  const blind = check(deleted)
  const rows = DOCS.flatMap((doc) => table(doc).rows.map((entry) => ({ doc, entry })))
  const untracked = rows.filter(({ entry }) => { const match = /^([^#:]+)[#:]/.exec(entry.where); return match === null ? true : !tracked(match[1]) })
  const doctored = stage('doctored.md', plan.replace('<!-- /citations -->', '| bogus-untracked | .tmp/nope.mjs#const x | - |\n<!-- /citations -->'))
  const doctoredRows = table(doctored).rows.filter((entry) => { const match = /^([^#:]+)[#:]/.exec(entry.where); return match === null ? true : !tracked(match[1]) })
  return {
    ok: blind.status === 0 && rows.length > 0 && untracked.length === 0 && doctoredRows.length === 1,
    detail: 'a deleted row leaves the checker green (exit ' + String(blind.status) + ') | this gate checked ' + String(rows.length) + ' row(s), ' + String(untracked.length) + ' pointing outside version control' + ' | a copy citing .tmp is rejected by the same check: ' + String(doctoredRows.length) + ' of 1',
  }
})

await reading('R5', 'every seam a table cites as an export is really exported by the shipped module', async () => {
  const module = await import(pathToFileURL(COLLAB).href)
  const seams = DOCS.flatMap((doc) => table(doc).rows.map((entry) => ({ doc, seam: seamOf(entry) }))).filter((row) => row.seam !== null)
  const missing = seams.filter(({ seam }) => typeof module[seam.name] === 'undefined')
  return { ok: seams.length > 0 && missing.length === 0, detail: String(seams.length) + ' seam(s) claimed as exports, ' + String(missing.length) + ' not on the built module' + (missing.length === 0 ? '' : ': ' + JSON.stringify(missing.map((row) => row.seam.name))) }
})

for (const id of DECLARED) if (!reached.has(id)) results.push({ id, label: 'never-reached', ok: false, detail: 'this reading did not run' })

const report = () => {
  for (const row of results) console.log('  ' + (row.ok ? 'ok    ' : 'FAIL  ') + row.id + ' ' + row.label + '  |  ' + row.detail)
  console.log('reading-verdicts: ' + results.map((row) => row.id + '=' + (row.ok ? 'ok' : 'FAIL')).join(' '))
  const failed = results.filter((row) => !row.ok).length
  console.log(String(results.length - failed) + ' of ' + String(results.length) + ' readings held')
}

const MUTANTS = [
  { name: 'checker-drops-last-row', declared: ['R1'], file: 'checker', anchor: '  return { rows, malformed }', to: '  rows.pop()\n  return { rows, malformed }' },
  { name: 'checker-fragment-blind', declared: ['R2'], file: 'checker', anchor: '    const missing = row.fragments.filter((fragment) => !text.includes(flat(fragment)))', to: '    const missing = []' },
  { name: 'checker-ambiguity-blind', declared: ['R2'], file: 'checker', anchor: '  if (hits.length > 1) return { ok: false,', to: '  if (false) return { ok: false,' },
  { name: 'checker-silent-malformed', declared: ['R3'], file: 'checker', anchor: '{ malformed.push(line); continue }', to: '{ continue }' },
  { name: 'module-export-gone', declared: ['R5'], file: 'collab', anchor: '  createLocalTools,', to: '' },
  // A world mutant: a row that cites a file which EXISTS and reads fine but that version control does
  // not know — exactly the citation nobody can maintain. The file lives in the repo's ignored .tmp so
  // it is genuinely untracked, and it holds one `const` line so the checker's own rule stays happy.
  { name: 'doc-untracked-row', declared: ['R4'], file: 'doc' },
]

const selfAttack = () => {
  mirror(MIRROR)
  const checkerText = readFileSync(CHECKER, 'utf8')
  const collabText = readFileSync(COLLAB, 'utf8')
  // Created and removed only by the self-attack parent: a child run must leave it alone, or the first
  // reading to finish would delete the very file the mutant's row cites and redden everything after it.
  const untracked = join(PROJECT, '.tmp', 'r61-untracked.mjs')
  mkdirSync(dirname(untracked), { recursive: true })
  writeFileSync(untracked, 'const onlyLineHere = 1\n')
  const doctoredPlan = stage('mutant-doc-untracked.md', readFileSync(DOCS[1], 'utf8').replace('<!-- /citations -->', '| bogus-untracked | .tmp/r61-untracked.mjs#const onlyLineHere | - |\n<!-- /citations -->'))
  const mutantDocs = [DOCS[0], doctoredPlan, ...DOCS.slice(2)]
  let failures = 0
  for (const mutant of MUTANTS) {
    if (ONLY !== '' && ONLY !== mutant.name) continue
    if (mutant.file === 'doc') {
      const args = [fileURLToPath(import.meta.url), '--checker', CHECKER, '--collab', COLLAB]
      for (const doc of mutantDocs) args.push('--doc', doc)
      const run = spawnSync(process.execPath, args, { cwd: PROJECT, encoding: 'utf8' })
      const out = String(run.stdout ?? '') + String(run.stderr ?? '')
      const line = /reading-verdicts: (.+)/.exec(out)
      const flipped = line === null ? [] : line[1].split(' ').filter((entry) => entry.endsWith('=FAIL')).map((entry) => entry.split('=')[0]).sort()
      const declared = [...mutant.declared].sort()
      const same = JSON.stringify(flipped) === JSON.stringify(declared)
      if (!same) failures += 1
      console.log((same ? '  ok    ' : '  FAIL  ') + mutant.name + '  |  declared=[' + declared.join(',') + '] flipped=[' + flipped.join(',') + ']')
      continue
    }
    const source = mutant.file === 'checker' ? checkerText : collabText
    if (!source.includes(mutant.anchor)) {
      failures += 1
      console.log('  ANCHOR MISSING  ' + mutant.name + '  |  the shipped file no longer holds ' + JSON.stringify(mutant.anchor.slice(0, 60)))
      continue
    }
    const mutated = source.replace(mutant.anchor, mutant.to)
    const path = mutant.file === 'checker'
      ? (() => { const target = join(MIRROR, 'scripts', 'check-protocol-page.mjs'); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, mutated); return target })()
      : stage('mutant-' + mutant.name + '.js', mutated)
    const args = [fileURLToPath(import.meta.url), '--checker', mutant.file === 'checker' ? path : CHECKER, '--collab', mutant.file === 'collab' ? path : COLLAB]
    for (const doc of DOCS) args.push('--doc', doc)
    const run = spawnSync(process.execPath, args, { cwd: PROJECT, encoding: 'utf8' })
    const out = String(run.stdout ?? '') + String(run.stderr ?? '')
    const line = /reading-verdicts: (.+)/.exec(out)
    const flipped = line === null ? [] : line[1].split(' ').filter((entry) => entry.endsWith('=FAIL')).map((entry) => entry.split('=')[0]).sort()
    const declared = [...mutant.declared].sort()
    const same = JSON.stringify(flipped) === JSON.stringify(declared)
    if (!same) failures += 1
    console.log((same ? '  ok    ' : '  FAIL  ') + mutant.name + '  |  declared=[' + declared.join(',') + '] flipped=[' + flipped.join(',') + ']' + (line === null ? ' (the run printed no verdict line: exit ' + String(run.status) + ')' : ''))
  }
  console.log(failures === 0 ? 'every mutant moved exactly what it declared' : String(failures) + ' mutant(s) did not')
  return failures
}

let code = 0
try {
  if (SELF_ATTACK) {
    const baseline = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv.filter((item) => item !== '--self-attack')], { cwd: PROJECT, encoding: 'utf8' })
    if (baseline.status !== 0) {
      console.log('the unmutated tree is not green, so no mutant can be trusted:')
      console.log(String(baseline.stdout ?? '').split('\n').filter((line) => line.includes('FAIL')).join('\n'))
      code = 1
    } else {
      code = selfAttack() === 0 ? 0 : 1
    }
  } else {
    report()
    code = results.every((row) => row.ok) ? 0 : 1
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true })
  if (SELF_ATTACK) rmSync(join(PROJECT, '.tmp', 'r61-untracked.mjs'), { force: true })
}
process.exitCode = code
