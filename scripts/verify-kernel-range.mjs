#!/usr/bin/env node
/**
 * R126 gate #90: the kernel-range resolver (T49, DSH-EAC standard S3).
 *
 * The semantics are not invented here; they are quoted from the standard this gate migrates, and the
 * expectation table below was written from those quotes plus ordinary semver semantics BEFORE the
 * product's answers were looked at:
 *
 *   docs/feature-pack-spec.md:78  versions are read from the REAL INSTALL CLOSURE, never from a constant
 *   docs/feature-pack-spec.md:79  a start-up compatibility scan marks an unsatisfied plugin incompatible
 *                                 and writes it back IDEMPOTENTLY
 *   docs/feature-pack-spec.md:81  PRERELEASE TOLERANCE: when the range declares no prerelease tag, a
 *                                 release of the same [major,minor,patch] satisfies it
 *   docs/feature-pack-spec.md:85  the supported surface is ^ ~ || space-AND partial versions
 *   docs/feature-pack-spec.md:86  UNSUPPORTED SYNTAX IS A MISMATCH, and the refusal names the position
 *
 * AUTHOR DEBT (recorded, not hidden): the producer (compatbuilder) is a different person, but this gate
 * is written by the Lead - verifier and gatefixer each declined it with a clean zero-file handoff rather
 * than leave a half-finished gate in scripts/. A read-only recomputation by a third member is the
 * mitigation, and it is reported in the round record.
 *
 * Mutants patch a PRIVATE COPY of the module inside .tmp/. The shipped artifact is hashed before and
 * after (G1) because R114 paid for exactly this: a mutant that rewrote the product and got committed.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(process.env.R126_PROJECT ?? join(HERE, '..'))
const MODULE = join(PROJECT, 'compat', 'kernel-range.ts')
const FIXTURES = join(PROJECT, 'compat', 'kernel-range.fixtures.json')
const WORLD = resolve(process.env.R126_WORLD ?? join(PROJECT, '.tmp', 'r126-gate'))
const MUTANT = process.env.R126_MUTANT ?? ''
const argv = process.argv.slice(2)
// GUARD SHAPE (R127): the product guards below compare the working tree at the START of this run with the
// one at its end. They used to require an empty --short output, which misfired the moment a round shipped
// plugin changes of its own: three unrelated gates went red on this round's wiring work for work that was
// not damage. What a run owns is that IT added nothing - and that is what is measured now.
const statusLines = () => {
  const out = spawnSync('git', ['status', '--short', '--', 'compat'], { cwd: PROJECT, encoding: 'utf8' })
  return String(out.stdout ?? '').trim() === '' ? [] : String(out.stdout).trim().split(/\r?\n/).map((line) => line.trim()).sort()
}
const statusAtStart = statusLines()

if (!existsSync(MODULE)) {
  console.error('SKIP: the resolver does not exist at ' + MODULE + ' (task-169 producer deliverable)')
  process.exit(3)
}
if (!existsSync(FIXTURES)) {
  console.error('SKIP: the fixture inputs are not at ' + FIXTURES)
  process.exit(3)
}

// The gate's OWN expectations, derived from the quotes above. They are deliberately NOT read from the
// fixtures file (which carries inputs only) nor from the producer's self-check.
const EXPECTED = {
  'caret-satisfied': 'satisfied',
  'caret-mismatch': 'mismatch',
  'tilde-satisfied': 'satisfied',
  'tilde-mismatch': 'mismatch',
  'or-satisfied': 'satisfied',
  'and-space-satisfied': 'satisfied',
  'partial-satisfied': 'satisfied',
  'partial-x-satisfied': 'satisfied',
  'any-satisfied': 'satisfied',
  'prerelease-tolerant': 'satisfied',
  'prerelease-strict-mismatch': 'mismatch',
  'unsupported-gte': 'unsupported-syntax',
}

const MUTANTS = {
  'unsupported-becomes-match': [{ from: "  if (parseRange(range).ok === false) return 'unsupported-syntax'", to: "  if (parseRange(range).ok === false) return 'satisfied'" }],
  'prerelease-tolerance-removed': [{ from: "  const tolerant = range.includes('-') === false", to: '  const tolerant = false' }],
  'closure-version-constant': [{ from: '  const row = closure.find((entry) => entry.name === name)\n  return row === undefined ? null : row.version', to: "  return '0.2.1'" }],
  // Re-anchored in R128: the ladder's work added existsSync to this import line, and an anchor that stops
  // matching is a DEAD mutant ("produced no readings"), not a green one - measured, then fixed here.
  'report-appends-instead-of-replacing': [
    { from: "import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'", to: "import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'" },
    { from: "  writeFileSync(file, text, 'utf8')", to: "  appendFileSync(file, text, 'utf8')" },
  ],
  // The production bug itself, as a mutant: narrowing the accepted names back to the one the first
  // implementation looked for must move the reading that pins the ladder.
  'kernel-names-narrowed': [{ from: "const KERNEL_PACKAGE_NAMES: readonly string[] = ['@deepseek-ai/dsh-root', '@deepseek-ai/dsh']", to: "const KERNEL_PACKAGE_NAMES: readonly string[] = ['@deepseek-ai/dsh']" }],
  'ladder-guesses-when-nothing-answers': [{ from: '  return { version: null, source: null, tried }', to: "  return { version: '0.2.1-alpha.1', source: 'guessed', tried }" }],
  'tolerance-always-on': [{ from: "  const tolerant = range.includes('-') === false", to: '  const tolerant = true' }],
  'no-range-becomes-satisfied': [{ from: "rows.push({ plugin: name, range: null, source: null, verdict: 'no-range' })", to: "rows.push({ plugin: name, range: null, source: null, verdict: 'satisfied' })" }],
}

// The product must be read, never written (G1), and the mutant copy must really differ (G3).
const hashOf = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const sourceText = readFileSync(MODULE, 'utf8')
const sourceHash = hashOf(MODULE)

let target = MODULE
let mutationNote = 'baseline: the shipped artifact itself'
if (MUTANT !== '') {
  const patch = MUTANTS[MUTANT]
  if (patch === undefined) { console.error('kernel-range: unknown mutant ' + MUTANT); process.exit(2) }
  let text = sourceText
  for (const step of patch) {
    const next = text.replace(step.from, step.to)
    if (next === text) { console.error('kernel-range: mutant ' + MUTANT + ' changed nothing; anchor missing: ' + step.from.slice(0, 80)); process.exit(2) }
    text = next
  }
  const dir = join(WORLD, 'mutant-' + MUTANT)
  mkdirSync(dir, { recursive: true })
  target = join(dir, 'kernel-range.ts')
  writeFileSync(target, text, 'utf8')
  mutationNote = 'mutant ' + MUTANT + ' patched a private copy at ' + target
}
const M = await import(pathToFileURL(target).href)

const readings = []
const held = (id, ok, detail) => readings.push({ id, ok: ok === true, detail: String(detail) })

// --- R1: the twelve fixtures, judged against the table above ------------------------------------------
const fixtureFile = JSON.parse(readFileSync(FIXTURES, 'utf8'))
const mismatches = []
for (const row of fixtureFile.fixtures) {
  const got = M.verdictForRange(row.range, row.version)
  if (got !== EXPECTED[row.id]) mismatches.push(row.id + ' range=' + JSON.stringify(row.range) + ' version=' + JSON.stringify(row.version) + ' got=' + got + ' expected=' + EXPECTED[row.id])
}
const extra = fixtureFile.fixtures.filter((row) => EXPECTED[row.id] === undefined).map((row) => row.id)
held('R1', fixtureFile.fixtures.length === Object.keys(EXPECTED).length && mismatches.length === 0 && extra.length === 0,
  'all ' + String(fixtureFile.fixtures.length) + ' fixture inputs resolve as the spec-derived table says: mismatches=' + JSON.stringify(mismatches) + ' fixturesWithNoExpectation=' + JSON.stringify(extra))

// --- R2: prerelease tolerance, paired with the control that must NOT be tolerated --------------------
const tolerant = M.verdictForRange('^0.2.1', '0.2.1-alpha.1')
const strict = M.verdictForRange('^0.2.1-rc.1', '0.2.1-alpha.1')
const plain = M.verdictForRange('^0.2.1', '0.2.2')
held('R2', tolerant === 'satisfied' && strict === 'mismatch' && plain === 'satisfied',
  'tolerance is paired: range without a prerelease tag accepts 0.2.1-alpha.1 (got ' + tolerant + '), a range that names one does not accept a lower prerelease (got ' + strict + '), and the release itself still satisfies (got ' + plain + ')')

// --- R3: unsupported syntax is a mismatch AND the refusal names the position in the original text ----
const firstRefusal = M.parseRange('>=0.1.7-0 || >=0.2.0-0')
const laterRefusal = M.parseRange('^0.2.1 > 0.1.0')
const positionOk = firstRefusal.ok === false && firstRefusal.index === 0 && firstRefusal.token === '>'
  && laterRefusal.ok === false && laterRefusal.index === 7 && laterRefusal.token === '>'
held('R3', positionOk && M.verdictForRange('>=0.2.0', '0.2.1-alpha.1') === 'unsupported-syntax' && M.satisfiesRange('>=0.2.0', '0.2.1-alpha.1') === false,
  'unsupported syntax refuses with the index of the token in the ORIGINAL text and never matches: firstToken=' + JSON.stringify(firstRefusal.token) + '@' + String(firstRefusal.index) + ' secondToken=' + JSON.stringify(laterRefusal.token) + '@' + String(laterRefusal.index) + ' verdict=' + M.verdictForRange('>=0.2.0', '0.2.1-alpha.1'))

// --- the world: a real installed closure and real plugin manifests ----------------------------------
const CASE = join(WORLD, MUTANT === '' ? 'case' : 'case-' + MUTANT)
rmSync(CASE, { recursive: true, force: true })
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8') }
const KERNEL_MANIFEST = join(CASE, 'root', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
writeJson(KERNEL_MANIFEST, { name: '@deepseek-ai/dsh', version: '0.2.1-alpha.1' })
const PLUGINS = join(CASE, 'plugins')
writeJson(join(PLUGINS, 'p-ok', 'package.json'), { name: 'p-ok', version: '1.0.0', requires: { dsh: '^0.2.0' } })
writeJson(join(PLUGINS, 'p-reds', 'package.json'), { name: 'p-reds', version: '1.0.0', requires: { dsh: '^0.3.0' } })
writeJson(join(PLUGINS, 'p-none', 'package.json'), { name: 'p-none', version: '1.0.0' })
writeJson(join(PLUGINS, 'p-grade', 'package.json'), { name: 'p-grade', version: '1.0.0', engines: { dsh: '~0.2.1' } })
writeJson(join(PLUGINS, 'p-peer', 'package.json'), { name: 'p-peer', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0' } })
const closureDir = join(CASE, 'root', 'node_modules')

// --- R4: the version comes from the closure, and the verdict follows it when the closure changes -----
const closureA = M.installedClosureVersions(closureDir)
const versionA = M.kernelVersionFromClosure(closureA)
const rowsA = M.scanPluginRanges(PLUGINS, versionA)
const okRowA = rowsA.find((row) => row.plugin === 'p-ok')
writeJson(KERNEL_MANIFEST, { name: '@deepseek-ai/dsh', version: '0.3.0' })
const versionB = M.kernelVersionFromClosure(M.installedClosureVersions(closureDir))
const rowsB = M.scanPluginRanges(PLUGINS, versionB)
const okRowB = rowsB.find((row) => row.plugin === 'p-ok')
// A third leg, added after a read-only review objected that "the verdict follows the argument" is not the
// same claim as "the version comes from the closure": an EMPTY closure must yield null rather than a
// remembered value, so a constant (or a table keyed by anything else) cannot pass this reading.
const emptyClosureDir = join(CASE, 'no-kernel', 'node_modules')
mkdirSync(emptyClosureDir, { recursive: true })
const versionMissing = M.kernelVersionFromClosure(M.installedClosureVersions(emptyClosureDir))
held('R4', versionA === '0.2.1-alpha.1' && versionB === '0.3.0' && versionMissing === null && okRowA?.verdict === 'satisfied' && okRowB?.verdict === 'mismatch',
  'the kernel version is read from the closure and the verdict follows it: closure=' + JSON.stringify(closureA) + ' versionA=' + String(versionA) + ' p-ok=' + String(okRowA?.verdict) + ' | after rewriting the manifest versionB=' + String(versionB) + ' p-ok=' + String(okRowB?.verdict) + ' | emptyClosure=' + JSON.stringify(versionMissing))
writeJson(KERNEL_MANIFEST, { name: '@deepseek-ai/dsh', version: '0.2.1-alpha.1' })

// --- R5: writing the report twice is byte-identical --------------------------------------------------
// R5 is about writing the SAME file twice, not about two files agreeing: the first version of this
// reading compared report-a.json with report-b.json, which a writer that appends would also pass - the
// appending mutant went through it untouched, so the reading was hollow and is now the real question.
const reportFile = join(CASE, 'report.json')
const rowsForReport = M.scanPluginRanges(PLUGINS, '0.2.1-alpha.1')
const firstText = M.writeIncompatibleReport(reportFile, rowsForReport)
const afterFirst = readFileSync(reportFile, 'utf8')
const secondText = M.writeIncompatibleReport(reportFile, rowsForReport)
const afterSecond = readFileSync(reportFile, 'utf8')
const hashFirst = createHash('sha256').update(afterFirst).digest('hex')
const hashSecond = createHash('sha256').update(afterSecond).digest('hex')
const textA = afterSecond
held('R5', hashFirst === hashSecond && afterFirst === afterSecond && firstText === afterFirst && secondText === afterSecond
  && afterSecond.includes('\r') === false && afterSecond.endsWith('\n') && afterSecond.endsWith('\n\n') === false,
  'writing the same file twice leaves the same bytes: identical=' + String(afterFirst === afterSecond) + ' sha256=' + hashFirst + ' grewBy=' + String(afterSecond.length - afterFirst.length) + ' crlf=' + String(afterSecond.includes('\r')))

// --- R6: the report names exactly what is not satisfied, with the reason ----------------------------
// A report that does not parse is a failed reading, not a crashed gate: an appending writer produces
// exactly that, and a harness that dies instead of judging would report "no readings" rather than a flip.
const parsed = (() => { try { return JSON.parse(textA) } catch { return null } })()
const listed = (parsed?.rows ?? [{ plugin: 'unparsable', verdict: 'unparsable' }]).map((row) => row.plugin + ':' + row.verdict).sort()
// Corrected by measurement (the first version of this line expected p-grade here): p-grade declares
// engines.dsh '~0.2.1', which the tolerant reading accepts for 0.2.1-alpha.1, so it must NOT be listed.
// The unsatisfied trio is p-none (no range), p-peer ('>=0.2.0', unsupported) and p-reds ('^0.3.0').
const expectedListed = ['p-none:no-range', 'p-peer:unsupported-syntax', 'p-reds:mismatch']
// The counts are the only summary an external reader gets without unfolding the rows, so they are part of
// this reading (a gap a read-only review named): they must agree with the rows and with the scan.
const counts = parsed?.counts ?? {}
held('R6', JSON.stringify(listed) === JSON.stringify(expectedListed) && textA.includes('p-ok') === false
  && counts.rows === rowsForReport.length && counts.unsatisfied === expectedListed.length,
  'the report lists exactly the unsatisfied rows and never the satisfied one: listed=' + JSON.stringify(listed) + ' counts=' + JSON.stringify(counts) + ' rowsScanned=' + String(rowsForReport.length) + ' satisfiedPluginAppears=' + String(textA.includes('p-ok')))

// --- R7: no-range and unknown-kernel are never satisfied, and the source field is named --------------
const rowsNoKernel = M.scanPluginRanges(PLUGINS, null)
const neverSatisfied = rowsNoKernel.every((row) => row.verdict !== 'satisfied' && (row.verdict === 'unknown-kernel' || row.verdict === 'no-range'))
const sources = new Set(rowsForReport.map((row) => row.source).filter((source) => source !== null))
const noneRow = rowsForReport.find((row) => row.plugin === 'p-none')
held('R7', neverSatisfied && noneRow?.verdict === 'no-range' && sources.size === 3,
  'a missing version is not a pass: with no kernel version every row is unknown-kernel (except the range-less one) got=' + JSON.stringify(rowsNoKernel.map((row) => row.plugin + ':' + row.verdict)) + ' rangeLessVerdict=' + String(noneRow?.verdict) + ' distinctSources=' + JSON.stringify([...sources]))


// --- R8: which text the tolerance rule looks at, pinned as a decision rather than left implicit --------
// spec:81 says "a range that declares no prerelease ...", and this resolver reads that as THE WHOLE
// declaration text: one branch carrying a prerelease tag switches tolerance off for every branch of the
// same range. The distinguishing case below (a tag in the second branch, a release triple that would
// satisfy the first branch) is where the other reading - per branch - would answer differently, so the
// choice is measured instead of assumed.
const mixedRange = '^0.2.1 || ^0.3.0-pre'
const achievedByMixing = M.verdictForRange(mixedRange, '0.2.1-alpha.1')
const pureBranch = M.verdictForRange('^0.2.1', '0.2.1-alpha.1')
held('R8', achievedByMixing === 'mismatch' && pureBranch === 'satisfied',
  'one prerelease tag in a range switches tolerance off for the whole text: mixed=' + JSON.stringify(mixedRange) + ' -> ' + achievedByMixing + ' while the same branch alone -> ' + pureBranch)

// --- R9: the version's SOURCE ladder (task-174) -------------------------------------------------------
// A read-only review proved this reading was missing in the worst way: this module looked for the kernel
// package name '@deepseek-ai/dsh', while the kernel this repository actually runs identifies as
// '@deepseek-ai/dsh-root' (kernel.lock.json:3 and core/deepseek-harness/package.json, both measured). In a
// real profile closure the old lookup answered null, every row became unknown-kernel, and gate #91 stayed
// green because its fixtures manufactured the old name. The ladder that fixes it is measured here, source
// by source, and the production-shaped case is one of the four legs rather than a paragraph in a record.
const LADDER = join(CASE, 'ladder')
writeJson(join(LADDER, 'closure-a', '@deepseek-ai', 'dsh-root', 'package.json'), { name: '@deepseek-ai/dsh-root', version: '0.2.1-alpha.1' })
writeJson(join(LADDER, 'closure-b', 'left-pad', 'package.json'), { name: 'left-pad', version: '1.0.0' })
writeJson(join(LADDER, 'checkout', 'package.json'), { name: '@deepseek-ai/dsh-root', version: '0.2.1-alpha.1' })
writeJson(join(LADDER, 'kernel.lock.json'), { packageName: '@deepseek-ai/dsh-root', packageVersion: '0.2.1-alpha.1', tag: 'dsh-v0.2.1-alpha.1' })
const fromClosure = M.resolveKernelVersion({ closureDir: join(LADDER, 'closure-a') })
const fromCheckout = M.resolveKernelVersion({ closureDir: join(LADDER, 'closure-b'), kernelRoot: join(LADDER, 'checkout') })
const fromLock = M.resolveKernelVersion({ lockFile: join(LADDER, 'kernel.lock.json') })
const fromNothing = M.resolveKernelVersion({ closureDir: join(LADDER, 'closure-b'), kernelRoot: join(LADDER, 'missing-checkout'), lockFile: join(LADDER, 'missing.lock.json') })
const plannedNewSource = (answer) => typeof answer.source === 'string' && answer.source.startsWith('closure:')
const triedNames = Array.isArray(fromNothing.tried) ? fromNothing.tried.map((row) => row.source) : []
held('R9', plannedNewSource(fromClosure) && fromClosure.version === '0.2.1-alpha.1'
  && fromCheckout.source === 'checkout' && fromCheckout.version === '0.2.1-alpha.1'
  && fromLock.source === 'lock' && fromLock.version === '0.2.1-alpha.1'
  && fromNothing.version === null && fromNothing.source === null
  && triedNames.join(',') === 'closure,checkout,lock'
  && fromNothing.tried.every((row) => row.ok === false && String(row.detail).length > 0),
  'the kernel version comes from a ladder whose source is named: closureRoot=' + JSON.stringify({ version: fromClosure.version, source: fromClosure.source })
  + ' productionShaped=' + JSON.stringify({ version: fromCheckout.version, source: fromCheckout.source })
  + ' lockOnly=' + JSON.stringify({ version: fromLock.version, source: fromLock.source })
  + ' nothing=' + JSON.stringify({ version: fromNothing.version, source: fromNothing.source, tried: triedNames }))

// --- G1: the shipped artifact was read, never written -----------------------------------------------
const afterHash = existsSync(MODULE) ? hashOf(MODULE) : 'missing'
// '?? compat/kernel-range.ts' means the gate's own subject is new in this round, not that the gate wrote
// it: only a tracked modification would be the R114 failure mode, so untracked lines are excluded here.
const dirtyLines = statusLines()
held('G1', afterHash === sourceHash && JSON.stringify(dirtyLines) === JSON.stringify(statusAtStart),
  'the product was read, never written: sha256=' + sourceHash.slice(0, 16) + ' unchanged=' + String(afterHash === sourceHash) + ' before=' + JSON.stringify(statusAtStart) + ' after=' + JSON.stringify(dirtyLines))

// --- G2: the expectations really are this gate's own -----------------------------------------------
// Structural, not a substring hunt: that file's prose explains why it carries no expectations, so
// matching the word 'expect' would fail on its own explanation (measured - the first version did).
const inputKeys = ['id', 'range', 'version']
const verdictKeys = ['expect', 'expected', 'verdict', 'satisfied', 'mismatch', 'unsupported-syntax', 'no-range', 'unknown-kernel']
const fixtureRows = Array.isArray(fixtureFile.fixtures) ? fixtureFile.fixtures : []
const strayRows = fixtureRows.filter((row) => Object.keys(row).some((key) => inputKeys.includes(key) === false || verdictKeys.includes(key)))
held('G2', fixtureRows.length > 0 && strayRows.length === 0,
  'the fixture file carries inputs only, so the table above is the judge\'s own: rows=' + String(fixtureRows.length) + ' rowsCarryingAnExpectation=' + JSON.stringify(strayRows.map((row) => Object.keys(row))))

// --- G3: the mutant copy really differs from the shipped text ---------------------------------------
held('G3', MUTANT === '' ? mutationNote.startsWith('baseline') : mutationNote.startsWith('mutant') && sourceText !== readFileSync(target, 'utf8'),
  'the run under test is identified: ' + mutationNote + ' differsFromShipped=' + String(MUTANT !== '' && sourceText !== readFileSync(target, 'utf8')))

// Hypotheses, corrected by measurement below. Written down before the mutants were run, and each one
// carries the mechanism that should move it, so a mismatch is a disagreement about a mechanism rather
// than an excuse to widen a set (this repository has paid for that lesson six times).
const DECLARED = {
  // The unsupported fixture row and the position reading both turn green, and p-grade drops out of the
  // report because its verdict becomes 'satisfied'.
  'unsupported-becomes-match': ['R1', 'R3', 'R6'],
  // Corrected by measurement (seventh time a declaration was narrower than its mutant): switching the
  // tolerance off also turns p-grade's '~0.2.1' into a mismatch against 0.2.1-alpha.1 - a prerelease is
  // lower than its own release - so that plugin enters the report and R6 moves with R1 and R2.
  // Eighth widening (measured): switching the tolerance off also breaks R8's control leg, because the
  // same branch alone stops accepting the prerelease once tolerance is gone.
  'prerelease-tolerance-removed': ['R1', 'R2', 'R6', 'R8'],
  // The closure reading is the only one that reads a version out of the world.
  'closure-version-constant': ['R4'],
  // Appending makes the second run differ, and the file no longer parses as one report.
  'report-appends-instead-of-replacing': ['R5', 'R6'],
  // A range-less plugin stops being listed and stops being refused.
  'no-range-becomes-satisfied': ['R6', 'R7'],
  // Hypotheses for the new mutant: an always-on tolerance also makes the strict fixture row and the paired
  // strict leg pass, which is exactly what spec:81's 'declares no prerelease' qualifier prevents.
  'tolerance-always-on': ['R1', 'R2', 'R8'],
  // Hypotheses for the ladder mutants: narrowing the names loses the closure rung; guessing fills the
  // leg that must stay null.
  'kernel-names-narrowed': ['R9'],
  'ladder-guesses-when-nothing-answers': ['R9'],
}

if (argv.includes('--self-attack')) {
  const base = {}
  for (const row of readings) base[row.id] = row.ok
  let bad = 0
  const moved = new Set()
  for (const name of Object.keys(MUTANTS)) {
    const child = spawnSync(process.execPath, [resolve(process.env.R126_SELF ?? process.argv[1]), '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 600000,
      env: { ...process.env, R126_MUTANT: name, R126_PROJECT: PROJECT, R126_WORLD: WORLD, R126_SELF: process.env.R126_SELF ?? process.argv[1] },
    })
    const line = ((child.stdout ?? '') + (child.stderr ?? '')).split(/\r?\n/).filter((row) => row.startsWith('[')).pop()
    if (line === undefined) { bad += 1; console.log('  FAIL  ' + name + '  produced no readings'); continue }
    const after = {}
    for (const row of JSON.parse(line)) after[row.id] = row.ok
    const flipped = [...new Set([...Object.keys(base), ...Object.keys(after)])].filter((id) => base[id] !== after[id]).sort()
    for (const id of flipped) moved.add(id)
    const ok = JSON.stringify(flipped) === JSON.stringify([...DECLARED[name]].sort())
    if (!ok) bad += 1
    console.log((ok ? '  ok    ' : '  FAIL  ') + name + '  flipped=' + (flipped.join(',') || '(none)') + ' declared=' + DECLARED[name].join(','))
  }
  const GUARDS = ['G1', 'G2', 'G3']
  const uncovered = Object.keys(base).filter((id) => moved.has(id) === false && GUARDS.includes(id) === false)
  console.log('coverage: ' + String(moved.size) + ' of ' + String(Object.keys(base).length) + ' moved; uncovered=' + (uncovered.join(',') || '(none)'))
  console.log('declared-set mismatches: ' + String(bad))
  process.exit(bad === 0 && uncovered.length === 0 ? 0 : 1)
}
const failed = readings.filter((row) => row.ok === false).length
if (argv.includes('--json')) console.log(JSON.stringify(readings))
else {
  for (const row of readings) console.log('  ' + (row.ok ? 'ok    ' : 'FAIL  ') + row.id + '  |  ' + row.detail)
  console.log(String(readings.length) + ' readings, ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed')
}
process.exit(failed === 0 ? 0 : 1)
