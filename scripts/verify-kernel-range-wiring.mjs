#!/usr/bin/env node
/**
 * R127 gate #91: the kernel-range scan is WIRED IN (T49 step two).
 *
 * The subject is the SHIPPED artifact plugins/dsh-link-upgrade/lib/index.js, not the source: a wiring that
 * exists only in src/ is not shipped, and R114 was paid for exactly this distinction. The upstream rule
 * this gate enforces is docs/feature-pack-spec.md:79 - a start-up compatibility scan marks what the kernel
 * does not satisfy and WRITES IT BACK IDEMPOTENTLY.
 *
 * AUTHOR DEBT (recorded, not hidden): producer is compatbuilder; this gate is the Lead's, because verifier,
 * gatefixer and critic each declined it with a clean zero-file handoff rather than leave a half-finished
 * gate in scripts/. A read-only recomputation by a fourth member is the mitigation, reported in the record.
 *
 * Mutants patch a PRIVATE COPY of the artifact inside .tmp/. The shipped bytes are hashed before and after
 * (W5) because a mutant that rewrote the product and got committed has happened here before.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(process.env.R127_PROJECT ?? join(HERE, '..'))
const ARTIFACT = join(PROJECT, 'plugins', 'dsh-link-upgrade', 'lib', 'index.js')
const EXPORTS = ['installedRangeRows', 'kernelVersionAt', 'markRangeVerdicts']
const WORLD = resolve(process.env.R127_WORLD ?? join(PROJECT, '.tmp', 'r127-gate'))
const MUTANT = process.env.R127_MUTANT ?? ''
const argv = process.argv.slice(2)

if (!existsSync(ARTIFACT)) {
  console.error('SKIP: the shipped artifact is not built at ' + ARTIFACT + ' (run: node plugins/build.mjs)')
  process.exit(3)
}

// Each mutant patches a copy of the shipped artifact. The anchors are exact substrings of that artifact,
// each verified to occur exactly once; a missing anchor is an error, never a silently green no-op.
const MUTANTS = {
  'marks-everything-incompatible': [{ from: 'const incompatible = row.verdict !== "satisfied";', to: 'const incompatible = true;' }],
  // Re-anchored after the producer's fix rewrote this expression (an anchor that stops matching is a dead
  // mutant, not a green one): the replacement below still blanks every reason, whatever its shape.
  // Re-anchored again in R128 (the source suffix was added to this expression): a dead anchor is a dead
  // mutant, and re-anchoring is the fix - never a weaker assertion.
  'reason-left-empty': [{ from: '      reason: incompatible ? row.verdict === "unscannable" ? "unscannable: no package.json under " + join2(pluginsDir, name) : row.verdict + ": range " + String(row.range) + " from " + String(row.source) + " against kernel " + String(kernelVersion) + " (from " + String(kernel.source) + ")" : null', to: '      reason: null' }],
  'report-carries-the-previous-size': [{ from: 'const document = { ...registry, plugins: [...registry.plugins], verdicts };', to: 'const document = { plugins: [...registry.plugins], verdicts, previous: readFileSync2(registryFile, "utf8").length };' }],
  'kernel-version-constant': [{ from: 'function kernelVersionAtFromClosure(closureDir) {\n  return kernelVersionFromClosure(installedClosureVersions(closureDir));\n}', to: 'function kernelVersionAtFromClosure(closureDir) {\n  return "0.2.1";\n}' }],
  'missing-registry-returns-empty': [{ from: 'if (!existsSync2(registryFile)) throw new TypeError("markRangeVerdicts: no registry at " + registryFile);', to: 'if (!existsSync2(registryFile)) return { plugins: [], verdicts: {} };' }],
  // Re-aimed in R131: the wiring now judges each registry entry's own manifest, so patching the module's
  // scan branch no longer reaches it (this mutant became a measurable no-op, flipped=(none), which is how the
  // change was noticed) - it has to bite the decision the wiring actually makes.
  'no-range-marked-compatible': [{ from: 'const verdict = declared.range === null ? "no-range" : kernelVersion === null ? "unknown-kernel" : verdictForRange(declared.range, kernelVersion);', to: 'const verdict = declared.range === null ? "satisfied" : kernelVersion === null ? "unknown-kernel" : verdictForRange(declared.range, kernelVersion);' }],
  'closure-looked-up-in-the-wrong-place': [{ from: 'const kernel = resolveRangeKernel(join2(pluginsDir, "node_modules"), options);', to: 'const kernel = resolveRangeKernel(join2(pluginsDir, "absent-node_modules"), options);' }],
  'unscannable-entry-dropped': [{ from: '      verdicts[name] = { incompatible: true, reason: reason ?? "unscannable" };\n      continue;', to: '      continue;' }],
  // The production bug as a mutant: with the fallback gone, a closure that carries no kernel package name
  // can no longer be identified and every row falls back to unknown-kernel.
  'kernel-root-ignored': [{ from: 'const later = resolveKernelVersion({ closureDir, kernelRoot: options.kernelRoot, lockFile: options.lockFile });', to: 'const later = { version: null, source: null };' }],
  // The enforcement path exists but nobody may switch it off silently, and the declarations the plugins
  // now carry are the only reason the real set is satisfied.
  'enforcement-never-throws': [{ from: '  throw new RangeError("assertRangesSatisfied: " + String(bad.length) + " of " + String(rows.length) + " plugin(s) do not satisfy the installed kernel range: " + named.join("; "));', to: '  return rows;' }],
  // Anchors are read from the ARTIFACT, never from src/: esbuild re-emits the bundle with double quotes,
  // so an anchor copied out of the TypeScript source (single quotes) can never match - measured in R129,
  // where this mutant reported "produced no readings" for exactly that reason.
  'declared-range-ignored': [{ from: '  if (typeof requires.dsh === "string") return { range: requires.dsh, source: "requires.dsh" };', to: '  if (false && typeof requires.dsh === "string") return { range: requires.dsh, source: "requires.dsh" };' }],
  // The two ways the opt-in flag could be wrong: never firing, or firing by default. Both must move W11.
  'enforcement-flag-ignored': [{ from: '  if (options.enforceKernelRange === true) {', to: '  if (false && options.enforceKernelRange === true) {' }],
  'enforcement-defaults-on': [{ from: '  if (options.enforceKernelRange === true) {', to: '  if (options.enforceKernelRange !== false) {' }],
  // The two defects as mutants: dropping the spread destroys the registry's siblings, and reporting
  // 'inherited' instead of naming the ambiguity hides which directory a verdict came from.
  'registry-siblings-dropped': [{ from: 'const document = { ...registry, plugins: [...registry.plugins], verdicts };', to: 'const document = { plugins: [...registry.plugins], verdicts };' }],
  'ambiguous-inherits-instead-of-reporting': [{ from: 'reason = "ambiguous: " + Math.max(sameName.length, dirs.length) + " directories declare " + name + " (" + dirs.join(", ") + ")";', to: 'reason = "mismatch: inherited from a same-named directory";' }],
  'unlisted-scan-results-added': [{ from: 'for (const name of [...registry.plugins].sort()) {', to: 'for (const name of [...new Set([...registry.plugins, ...declaredNames.keys()])].sort()) {' }],
}

const hashOf = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
// The invariant is that THIS RUN changes nothing tracked - not that the tree is clean, because the round
// under test legitimately ships new bytes (R114's lesson was a run that rewrote the product, so the
// comparison is start-of-run against end-of-run, plus the artifact's own hash).
const trackedNow = () => {
  const out = spawnSync('git', ['status', '--short', '--', 'plugins'], { cwd: PROJECT, encoding: 'utf8' })
  return String(out.stdout ?? '').trim() === '' ? [] : String(out.stdout).trim().split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('??') === false)
}
const trackedAtStart = trackedNow()
const sourceText = readFileSync(ARTIFACT, 'utf8')
const sourceHash = hashOf(ARTIFACT)

let target = ARTIFACT
let mutationNote = 'baseline: the shipped artifact itself'
if (MUTANT !== '') {
  const patch = MUTANTS[MUTANT]
  if (patch === undefined) { console.error('kernel-range-wiring: unknown mutant ' + MUTANT); process.exit(2) }
  let text = sourceText
  for (const step of patch) {
    const next = text.replace(step.from, step.to)
    if (next === text) { console.error('kernel-range-wiring: mutant ' + MUTANT + ' changed nothing; anchor missing: ' + step.from.slice(0, 90)); process.exit(2) }
    text = next
  }
  const dir = join(WORLD, 'mutant-' + MUTANT)
  mkdirSync(dir, { recursive: true })
  target = join(dir, 'index.js')
  writeFileSync(target, text, 'utf8')
  mutationNote = 'mutant ' + MUTANT + ' patched a private copy at ' + target
}
const M = await import(pathToFileURL(target).href)

const readings = []
const held = (id, ok, detail) => readings.push({ id, ok: ok === true, detail: String(detail) })

// --- W1: the wiring is IN the shipped artifact, and it looks where its own contract says -------------
const CASE = join(WORLD, MUTANT === '' ? 'case' : 'case-' + MUTANT)
rmSync(CASE, { recursive: true, force: true })
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8') }
// MEASURED, not assumed: installedRangeRows looks for the closure INSIDE the directory it is handed
// (`join2(pluginsDir, "node_modules")` in the artifact), i.e. it expects the profile root whose plugins and
// node_modules sit together. The first version of this fixture put node_modules BESIDE plugins/ and the
// reading said unknown-kernel for everything - which is the function being honest, not a defect. Both
// shapes are exercised below: the one it assumes, and one without any closure at all.
const INSTALLED_ROOT = join(CASE, 'installed')
const CLOSURE = join(INSTALLED_ROOT, 'node_modules')
writeJson(join(CLOSURE, '@deepseek-ai', 'dsh', 'package.json'), { name: '@deepseek-ai/dsh', version: '0.2.1' })
// installedRangeRows reads the closure NEXT TO the plugins directory it is handed, so the world gives it
// exactly that shape (plugins live inside the installed tree) - otherwise the function answers
// unknown-kernel for everything, which is honest but leaves its own premise untested.
const INSTALLED_PLUGINS = join(INSTALLED_ROOT, 'plugins')
// ...and the plugins it scans live in that same root, with the closure as its sibling (what the function
// reads is <pluginsDir>/node_modules, so the world hands it a root that has one).
writeJson(join(INSTALLED_PLUGINS, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), { name: '@deepseek-ai/dsh', version: '0.2.1' })
writeJson(join(INSTALLED_PLUGINS, 'p-ok', 'package.json'), { name: 'p-ok', version: '1.0.0', requires: { dsh: '^0.2.0' } })
writeJson(join(INSTALLED_PLUGINS, 'p-reds', 'package.json'), { name: 'p-reds', version: '1.0.0', requires: { dsh: '^0.9.0' } })
const LOOSE_PLUGINS = join(CASE, 'loose', 'plugins')
writeJson(join(LOOSE_PLUGINS, 'p-ok', 'package.json'), { name: 'p-ok', version: '1.0.0', requires: { dsh: '^0.2.0' } })
const surfaces = EXPORTS.map((name) => typeof M[name])
const installedRows = M.installedRangeRows(INSTALLED_PLUGINS).map((row) => row.plugin + ':' + row.verdict).sort()
const looseRows = M.installedRangeRows(LOOSE_PLUGINS).map((row) => row.plugin + ':' + row.verdict).sort()
held('W1', surfaces.every((kind) => kind === 'function')
  && JSON.stringify(installedRows) === JSON.stringify(['p-ok:satisfied', 'p-reds:mismatch'])
  && looseRows.every((row) => row.endsWith(':unknown-kernel')),
  'the shipped artifact exposes the wiring and it reads the closure beside the plugins it is handed: exports=' + JSON.stringify(surfaces) + ' installed=' + JSON.stringify(installedRows) + ' withoutAClosure=' + JSON.stringify(looseRows))

// --- W2: the marks are correct and paired (the upstream rule: only what is not satisfied is flagged) --
const FULL = join(CASE, 'full', 'plugins')
writeJson(join(FULL, 'p-ok', 'package.json'), { name: 'p-ok', version: '1.0.0', requires: { dsh: '^0.2.0' } })
writeJson(join(FULL, 'p-reds', 'package.json'), { name: 'p-reds', version: '1.0.0', requires: { dsh: '^0.9.0' } })
writeJson(join(FULL, 'p-grade', 'package.json'), { name: 'p-grade', version: '1.0.0', engines: { dsh: '>=0.2.0' } })
writeJson(join(FULL, 'p-none', 'package.json'), { name: 'p-none', version: '1.0.0' })
const REGISTRY = join(CASE, 'full', 'plugins.json')
writeJson(REGISTRY, { plugins: ['p-ok', 'p-reds', 'p-grade', 'p-none'] })
const before = M.markRangeVerdicts(REGISTRY, FULL, CLOSURE)
const flags = Object.fromEntries(Object.entries(before.verdicts).map(([name, row]) => [name, row.incompatible]))
const reasons = Object.fromEntries(Object.entries(before.verdicts).map(([name, row]) => [name, row.reason]))
const reasonOk = (name, word) => typeof reasons[name] === 'string' && reasons[name].includes(word) && reasons[name].includes('0.2.1')
held('W2', flags['p-ok'] === false && reasons['p-ok'] === null && flags['p-reds'] === true && flags['p-grade'] === true && flags['p-none'] === true
  && reasonOk('p-reds', 'mismatch') && reasonOk('p-grade', 'unsupported-syntax') && reasonOk('p-none', 'no-range'),
  'the satisfied plugin is marked compatible and the three others are flagged with a reason naming the kernel version: flags=' + JSON.stringify(flags) + ' reasons=' + JSON.stringify(reasons))

// --- W3: writing the same registry twice leaves the same bytes ---------------------------------------
const firstText = readFileSync(REGISTRY, 'utf8')
const again = M.markRangeVerdicts(REGISTRY, FULL, CLOSURE)
const secondText = readFileSync(REGISTRY, 'utf8')
const hashFirst = createHash('sha256').update(firstText).digest('hex')
const hashSecond = createHash('sha256').update(secondText).digest('hex')
held('W3', firstText === secondText && hashFirst === hashSecond && secondText.length === firstText.length
  && secondText.includes('\r') === false && secondText.endsWith('\n')
  && JSON.stringify(again.verdicts) === JSON.stringify(before.verdicts),
  'the write-back is idempotent: identical=' + String(firstText === secondText) + ' sha256=' + hashFirst + ' grewBy=' + String(secondText.length - firstText.length))

// --- W4: the version comes from the real closure, and an empty closure is never a pass ----------------
const EMPTY_CLOSURE = join(CASE, 'empty', 'node_modules')
mkdirSync(EMPTY_CLOSURE, { recursive: true })
const emptyVersion = M.kernelVersionAt(EMPTY_CLOSURE)
const flipped = M.markRangeVerdicts(REGISTRY, FULL, join(CASE, 'elsewhere', 'node_modules'))
const flippedFlags = Object.fromEntries(Object.entries(flipped.verdicts).map(([name, row]) => [name, row.incompatible]))
held('W4', emptyVersion === null && Object.values(flippedFlags).every((value) => value === true)
  && flags['p-ok'] === false && flippedFlags['p-ok'] === true,
  'the verdict follows the installed closure and a missing one is not a pass: emptyVersion=' + JSON.stringify(emptyVersion) + ' withClosure=' + JSON.stringify(flags) + ' withoutClosure=' + JSON.stringify(flippedFlags))

// --- W7: the registry is the authority on WHAT is installed, in BOTH directions ----------------------
// This reading is a defect the author of this gate found while writing it: the first wiring drove its
// marks from the scan, so a registry entry whose directory had gone missing simply got no verdict at all
// - the entry a reader most needs flagged vanished instead. The producer fixed it (registry-driven
// marks), and the counterexample is kept as a reading rather than as a paragraph in a record.
const PARTIAL_ROOT = join(CASE, 'partial')
writeJson(join(PARTIAL_ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), { name: '@deepseek-ai/dsh', version: '0.2.1' })
const PARTIAL = join(PARTIAL_ROOT, 'plugins')
writeJson(join(PARTIAL, 'p-ok', 'package.json'), { name: 'p-ok', version: '1.0.0', requires: { dsh: '^0.2.0' } })
// On disk, but NOT in the registry: it must not appear in the marks either.
writeJson(join(PARTIAL, 'p-extra', 'package.json'), { name: 'p-extra', version: '1.0.0', requires: { dsh: '^0.9.0' } })
const PARTIAL_REGISTRY = join(PARTIAL_ROOT, 'plugins.json')
writeJson(PARTIAL_REGISTRY, { plugins: ['p-ok', 'p-vanished'] })
const partial = M.markRangeVerdicts(PARTIAL_REGISTRY, PARTIAL, join(PARTIAL_ROOT, 'node_modules'))
const partialKeys = Object.keys(partial.verdicts)
const vanished = partial.verdicts['p-vanished']
held('W7', JSON.stringify(partialKeys) === JSON.stringify(['p-ok', 'p-vanished'])
  && vanished?.incompatible === true && typeof vanished?.reason === 'string' && vanished.reason.includes('unscannable')
  && partialKeys.includes('p-extra') === false,
  'every registry entry gets a verdict and nothing else does: registry=' + JSON.stringify(partial.plugins) + ' marked=' + JSON.stringify(partialKeys) + ' vanished=' + JSON.stringify(vanished) + ' scannedButUnlistedMarked=' + String(partialKeys.includes('p-extra')))

// --- W8: a world shaped like PRODUCTION, which is the shape that hid the bug -------------------------
// R127's read-only review proved the wiring looked for the package name '@deepseek-ai/dsh' while the
// kernel this repository runs identifies as '@deepseek-ai/dsh-root' (kernel.lock.json:3). In a real
// profile closure the old lookup answered null, so every row would be unknown-kernel and THIS GATE would
// not notice - because every fixture above manufactures the name the old code wanted. So the production
// shape gets its own reading: a closure that is non-empty and has no kernel package name, with the kernel
// checkout beside it.
const PROD_ROOT = join(CASE, 'prod')
const PROD_CLOSURE = join(PROD_ROOT, 'node_modules')
writeJson(join(PROD_CLOSURE, 'left-pad', 'package.json'), { name: 'left-pad', version: '1.0.0' })
const PROD_CHECKOUT = join(PROD_ROOT, 'kernel')
writeJson(join(PROD_CHECKOUT, 'package.json'), { name: '@deepseek-ai/dsh-root', version: '0.2.1-alpha.1' })
const PROD = join(PROD_ROOT, 'plugins')
writeJson(join(PROD, 'p-ok', 'package.json'), { name: 'p-ok', version: '1.0.0', requires: { dsh: '^0.2.0' } })
writeJson(join(PROD, 'p-reds', 'package.json'), { name: 'p-reds', version: '1.0.0', requires: { dsh: '^9.0.0' } })
const PROD_REGISTRY = join(PROD_ROOT, 'plugins.json')
writeJson(PROD_REGISTRY, { plugins: ['p-ok', 'p-reds'] })
const prod = M.markRangeVerdicts(PROD_REGISTRY, PROD, PROD_CLOSURE, { kernelRoot: PROD_CHECKOUT })
const prodFlags = Object.fromEntries(Object.entries(prod.verdicts).map(([name, row]) => [name, row.incompatible]))
const prodReasons = Object.fromEntries(Object.entries(prod.verdicts).map(([name, row]) => [name, row.reason]))
const prodReport = M.kernelVersionReportAt({ closureDir: PROD_CLOSURE, kernelRoot: PROD_CHECKOUT })
held('W8', prodFlags['p-ok'] === false && prodFlags['p-reds'] === true
  && typeof prodReport?.version === 'string' && prodReport.version === '0.2.1-alpha.1' && prodReport.source === 'checkout'
  && typeof prodReasons['p-reds'] === 'string' && prodReasons['p-reds'].includes('0.2.1-alpha.1') && prodReasons['p-reds'].includes('checkout'),
  'in a production-shaped world the marks are real and name where the version came from: flags=' + JSON.stringify(prodFlags) + ' reasons=' + JSON.stringify(prodReasons) + ' report=' + JSON.stringify({ version: prodReport?.version, source: prodReport?.source }))

// --- W12/W13: the two defects a read-only review found in this wiring ---------------------------------
// Both were reproduced by the Lead before the fix (raw evidence kept in the round record), and both are
// readings now: the registry is a shipped layout asset whose sibling keys must survive the write-back, and
// two directories that declare the SAME manifest name must not silently inherit one another's verdict.
const SIBLINGS = join(CASE, 'siblings')
const SIB_CLOSURE = join(SIBLINGS, 'node_modules')
writeJson(join(SIB_CLOSURE, '@deepseek-ai', 'dsh', 'package.json'), { name: '@deepseek-ai/dsh', version: '0.2.1' })
const SIB_PLUGINS = join(SIBLINGS, 'plugins')
writeJson(join(SIB_PLUGINS, 'p-a', 'package.json'), { name: 'p-a', version: '1.0.0', requires: { dsh: '^0.2.0' } })
writeJson(join(SIB_PLUGINS, 'p-b', 'package.json'), { name: 'p-b', version: '1.0.0', requires: { dsh: '^9.0.0' } })
const SIB_REGISTRY = join(SIBLINGS, 'plugins.json')
writeJson(SIB_REGISTRY, { format: 'dsh-link.plugins/1', generation: 7, plugins: ['p-a', 'p-b'], layout: 'v3' })
M.markRangeVerdicts(SIB_REGISTRY, SIB_PLUGINS, SIB_CLOSURE)
const siblingsFirst = readFileSync(SIB_REGISTRY, 'utf8')
const siblingsParsed = JSON.parse(siblingsFirst)
M.markRangeVerdicts(SIB_REGISTRY, SIB_PLUGINS, SIB_CLOSURE)
const siblingsSecond = readFileSync(SIB_REGISTRY, 'utf8')
held('W12', siblingsParsed.format === 'dsh-link.plugins/1' && siblingsParsed.generation === 7 && siblingsParsed.layout === 'v3'
  && Array.isArray(siblingsParsed.plugins) && siblingsParsed.verdicts['p-b']?.incompatible === true && siblingsFirst === siblingsSecond,
  'the write-back keeps the registry\'s other keys and stays idempotent: keys=' + JSON.stringify(Object.keys(siblingsParsed)) + ' format=' + JSON.stringify(siblingsParsed.format) + ' generation=' + JSON.stringify(siblingsParsed.generation) + ' layout=' + JSON.stringify(siblingsParsed.layout) + ' p-b=' + JSON.stringify(siblingsParsed.verdicts['p-b']) + ' secondWriteIdentical=' + String(siblingsFirst === siblingsSecond))

const NAMED = join(CASE, 'named')
const NAMED_CLOSURE = join(NAMED, 'node_modules')
writeJson(join(NAMED_CLOSURE, '@deepseek-ai', 'dsh', 'package.json'), { name: '@deepseek-ai/dsh', version: '0.2.1' })
const NAMED_PLUGINS = join(NAMED, 'plugins')
writeJson(join(NAMED_PLUGINS, 'dir-one', 'package.json'), { name: 'same-name', version: '1.0.0', requires: { dsh: '^0.2.0' } })
writeJson(join(NAMED_PLUGINS, 'dir-two', 'package.json'), { name: 'same-name', version: '1.0.0', requires: { dsh: '^9.0.0' } })
const NAMED_REGISTRY = join(NAMED, 'plugins.json')
writeJson(NAMED_REGISTRY, { plugins: ['dir-one', 'dir-two', 'same-name'] })
const named = M.markRangeVerdicts(NAMED_REGISTRY, NAMED_PLUGINS, NAMED_CLOSURE)
const namedOne = named.verdicts['dir-one']
const namedTwo = named.verdicts['dir-two']
const namedAmbig = named.verdicts['same-name']
held('W13', namedOne?.incompatible === false && namedTwo?.incompatible === true
  && namedAmbig?.incompatible === true && String(namedAmbig?.reason).includes('ambiguous')
  && String(namedAmbig?.reason).includes('dir-one') && String(namedAmbig?.reason).includes('dir-two'),
  'two directories declaring one manifest name keep their OWN verdicts, and the ambiguous entry names them instead of inheriting: dir-one=' + JSON.stringify(namedOne) + ' dir-two=' + JSON.stringify(namedTwo) + ' same-name=' + JSON.stringify(namedAmbig))

// --- W11: the refusal wired into the migration, opt-in and before anything is created ------------------
// spec:79's second half is 'stop it', not only 'mark it'. The contract freezes the shape: the check runs
// after the plan is computed but BEFORE the staging/backup roots exist, it is off unless asked for, and a
// refused migration must leave the state root byte-identical (the four legs below are the whole claim).
const ENFORCE_MANIFEST = { format: M.MIGRATIONS_FORMAT, current: 2, steps: [{ from: 1, to: 2, actions: [{ kind: 'note', text: 'r130' }] }] }
// This block builds its own plugin directories and options rather than reusing W9/W10's: those are defined
// further down the file, and reading them here would be a temporal-dead-zone reference (measured in R130
// on the first version of this reading - the gate refused to run at all, which is the loud kind of wrong).
const MIGRATE_OPTIONS = { kernelRoot: join(PROJECT, 'core', 'deepseek-harness'), lockFile: join(PROJECT, 'kernel.lock.json') }
const MIGRATE_BAD = join(CASE, 'migrate', 'plugins-bad')
writeJson(join(MIGRATE_BAD, 'p-good', 'package.json'), { name: 'p-good', version: '1.0.0', requires: { dsh: '^0.2.0' } })
writeJson(join(MIGRATE_BAD, 'p-out', 'package.json'), { name: 'p-out', version: '1.0.0', requires: { dsh: '^9.0.0' } })
const MIGRATE_GOOD = join(CASE, 'migrate', 'plugins-good')
writeJson(join(MIGRATE_GOOD, 'p-good', 'package.json'), { name: 'p-good', version: '1.0.0', requires: { dsh: '^0.2.0' } })
const mkStateRoot = (name) => {
  const root = join(CASE, 'migrate', name)
  writeJson(join(root, 'version.json'), { link: '0.1.0', layout: 1 })
  writeJson(join(root, 'plugins.json'), { plugins: ['p-a'] })
  return root
}
const neighbours = (root) => readdirSync(dirname(root)).filter((name) => name.includes('.staging-') || name.includes('.backup-'))
// Every call below is wrapped: a mutant that breaks an EARLIER reading's premise (no kernel version, no
// declared range) makes these calls throw, and an unguarded throw would crash the gate into reporting NO
// readings instead of a flip - measured in R130, where three mutants vanished that way and W9 silently fell
// out of the coverage table. A gate that judges must survive its subject being wrong.
const defaultRoot = mkStateRoot('default')
let defaultReport = null
try { defaultReport = M.applyMigration(defaultRoot, ENFORCE_MANIFEST) } catch (error) { defaultReport = error }
const refusedRoot = mkStateRoot('refused')
const refusedBefore = M.hashTree(refusedRoot)
let refusedError = null
try { M.applyMigration(refusedRoot, ENFORCE_MANIFEST, { enforceKernelRange: true, kernelRange: { pluginsDir: MIGRATE_BAD, ...MIGRATE_OPTIONS } }) } catch (error) { refusedError = error }
const refusedAfter = M.hashTree(refusedRoot)
const satisfiedRoot = mkStateRoot('satisfied')
let satisfiedReport = null
try { satisfiedReport = M.applyMigration(satisfiedRoot, ENFORCE_MANIFEST, { enforceKernelRange: true, kernelRange: { pluginsDir: MIGRATE_GOOD, ...MIGRATE_OPTIONS } }) } catch (error) { satisfiedReport = error }
const unconfiguredRoot = mkStateRoot('unconfigured')
let unconfiguredError = null
try { M.applyMigration(unconfiguredRoot, ENFORCE_MANIFEST, { enforceKernelRange: true }) } catch (error) { unconfiguredError = error }
const refusedMessage = refusedError === null ? '' : String(refusedError.message)
held('W11', defaultReport?.ok === true && defaultReport?.rootUnchanged === false
  && refusedError?.name === 'RangeError' && refusedMessage.includes('p-out') && JSON.stringify(refusedBefore) === JSON.stringify(refusedAfter) && neighbours(refusedRoot).length === 0
  && satisfiedReport?.ok === true
  && unconfiguredError?.name === 'TypeError' && String(unconfiguredError.message).includes('kernelRange.pluginsDir'),
  'a refused migration stops before anything is built, and the flag is opt-in: default+outOfRange ok=' + String(defaultReport.ok) + ' rootUnchanged=' + String(defaultReport.rootUnchanged) + ' | flag+outOfRange threw=' + String(refusedError?.name) + ' rootSame=' + String(JSON.stringify(refusedBefore) === JSON.stringify(refusedAfter)) + ' leftovers=' + JSON.stringify(neighbours(refusedRoot)) + ' message=' + JSON.stringify(refusedMessage.slice(0, 110)) + ' | flag+satisfied ok=' + String(satisfiedReport.ok) + ' | flagWithoutInputs threw=' + String(unconfiguredError?.name))

// --- W9: the REAL plugin set, and the production-shaped closure of this very checkout ------------------
// Every fixture above is a world this gate built. This reading is the repository's own plugins/ directory
// and its own root node_modules, which is the shape production presents: a non-empty closure with no
// kernel package name (measured: 78 manifests, none of them the kernel), so the version has to come from
// the checkout. The declarations the plugins carry are what makes the scan say something true.
const REAL_PLUGINS = join(PROJECT, 'plugins')
const REAL_OPTIONS = { kernelRoot: join(PROJECT, 'core', 'deepseek-harness'), lockFile: join(PROJECT, 'kernel.lock.json') }
const pluginDirs = readdirSync(REAL_PLUGINS, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(REAL_PLUGINS, entry.name, 'package.json'))).map((entry) => entry.name).sort()
const realRows = M.installedRangeRows(REAL_PLUGINS, REAL_OPTIONS)
const realBad = realRows.filter((row) => row.verdict !== 'satisfied')
const realReport = M.kernelVersionReportAt(REAL_OPTIONS)
const closureOnlyReport = M.kernelVersionReportAt({ closureDir: join(PROJECT, 'node_modules') })
const closureNames = REAL_OPTIONS.kernelRoot
held('W9', realRows.length === pluginDirs.length && realBad.length === 0
  && realRows.every((row) => row.source === 'requires.dsh')
  && realReport?.source === 'checkout' && typeof realReport?.version === 'string' && realReport.version.length > 0
  && closureOnlyReport?.version === null && String(closureOnlyReport?.tried?.[0]?.detail ?? '').includes('none named'),
  'the repository\'s own plugin set is declared and satisfied, against a kernel version read past a real closure: pluginsOnDisk=' + String(pluginDirs.length) + ' rows=' + String(realRows.length) + ' notSatisfied=' + JSON.stringify(realBad.map((row) => row.plugin + ':' + row.verdict)) + ' sources=' + JSON.stringify([...new Set(realRows.map((row) => row.source))]) + ' report=' + JSON.stringify({ version: realReport?.version, source: realReport?.source }) + ' closureAlone=' + JSON.stringify({ version: closureOnlyReport?.version, firstTried: closureOnlyReport?.tried?.[0]?.detail }))

// --- W10: the opt-in refusal path, and its paired leg --------------------------------------------------
// The contract asked for { rows, kernel }; the shipped function returns the rows array and exposes the
// kernel through kernelVersionReportAt instead. Measured rather than argued: this reading pins the SHIPPED
// shape (and W9 pins the source), so the deviation is visible here instead of only in a record.
const ENFORCE_ROOT = join(CASE, 'enforce')
const ENFORCE_BAD = join(ENFORCE_ROOT, 'bad', 'plugins')
writeJson(join(ENFORCE_BAD, 'p-good', 'package.json'), { name: 'p-good', version: '1.0.0', requires: { dsh: '^0.2.0' } })
writeJson(join(ENFORCE_BAD, 'p-out', 'package.json'), { name: 'p-out', version: '1.0.0', requires: { dsh: '^9.0.0' } })
const ENFORCE_GOOD = join(ENFORCE_ROOT, 'good', 'plugins')
writeJson(join(ENFORCE_GOOD, 'p-good', 'package.json'), { name: 'p-good', version: '1.0.0', requires: { dsh: '^0.2.0' } })
let enforceThrew = null
try { M.assertRangesSatisfied(ENFORCE_BAD, REAL_OPTIONS) } catch (error) { enforceThrew = error }
let enforcePassed = null
try { enforcePassed = M.assertRangesSatisfied(ENFORCE_GOOD, REAL_OPTIONS) } catch (error) { enforcePassed = error }
let realEnforce = null
try { realEnforce = M.assertRangesSatisfied(REAL_PLUGINS, REAL_OPTIONS) } catch (error) { realEnforce = error }
const threwMessage = enforceThrew === null ? '' : String(enforceThrew.message)
held('W10', enforceThrew instanceof Error && enforceThrew.name === 'RangeError'
  && threwMessage.includes('p-out') && threwMessage.includes('^9.0.0') && threwMessage.includes('requires.dsh')
  && Array.isArray(enforcePassed) && enforcePassed.every((row) => row.verdict === 'satisfied')
  && Array.isArray(realEnforce) && realEnforce.length === realRows.length,
  'an out-of-range plugin refuses with the offending row named, while a clean set and the real plugin set return their rows: name=' + String(enforceThrew?.name) + ' message=' + JSON.stringify(threwMessage) + ' cleanRows=' + String(Array.isArray(enforcePassed) ? enforcePassed.length : 'notAnArray') + ' realRows=' + String(Array.isArray(realEnforce) ? realEnforce.length : 'notAnArray'))

// --- W6: a registry that is missing or unreadable fails loudly, and leaves no half-written file -------
const ABSENT = join(CASE, 'absent.json')
let absentError = 'no-throw'
try { M.markRangeVerdicts(ABSENT, FULL, CLOSURE) } catch (error) { absentError = error?.name }
const BROKEN = join(CASE, 'broken.json')
writeFileSync(BROKEN, '{not json', 'utf8')
let brokenError = 'no-throw'
try { M.markRangeVerdicts(BROKEN, FULL, CLOSURE) } catch (error) { brokenError = error?.name }
held('W6', absentError === 'TypeError' && brokenError === 'TypeError' && existsSync(ABSENT) === false && readFileSync(BROKEN, 'utf8') === '{not json',
  'bad input fails loudly and leaves nothing half-written: missing=' + String(absentError) + ' createdAFile=' + String(existsSync(ABSENT)) + ' broken=' + String(brokenError) + ' brokenFileUntouched=' + String(readFileSync(BROKEN, 'utf8') === '{not json'))

// --- W5: the shipped artifact was read, never written (R114) ----------------------------------------
const afterHash = existsSync(ARTIFACT) ? hashOf(ARTIFACT) : 'missing'
const tracked = trackedNow()
held('W5', afterHash === sourceHash && JSON.stringify(tracked) === JSON.stringify(trackedAtStart),
  'the product was read, never written: sha256=' + sourceHash.slice(0, 16) + ' unchanged=' + String(afterHash === sourceHash) + ' trackedAtStart=' + JSON.stringify(trackedAtStart) + ' trackedAtEnd=' + JSON.stringify(tracked) + ' run=' + mutationNote)

const DECLARED = {
  // Hypotheses, measured below. Each names the mechanism, so a mismatch is a disagreement about a
  // mechanism rather than licence to widen a set (this repository has paid for that nine times).
  // Twelfth widening (measured): the production-shaped world is marked by the same expression, so it
  // moves with W2 and W4 too.
  // Nineteenth widening (measured): the ambiguity reading asserts the satisfied directory stays satisfied, so
  // marking everything incompatible moves it too.
  'marks-everything-incompatible': ['W2', 'W4', 'W8', 'W13'],
  // Eleventh widening (measured): W7 asserts that the vanished entry's reason names its own case, so
  // blanking every reason moves that reading too.
  // Thirteenth widening (measured): W8 asserts the reason names where the version came from, so blanking
  // every reason moves it as well.
  // Corrected by measurement (20th/21st/22nd adjustment in this series): W7's vanished entry gets its reason
  // from a different branch, so blanking the row-reason expression does not reach it.
  'reason-left-empty': ['W2', 'W8'],
  'report-carries-the-previous-size': ['W3', 'W12'],
  // Tenth widening (measured): a constant version also moves W1, because a directory with NO closure
  // stops answering unknown-kernel once the lookup no longer reads a file at all.
  // Narrowed by measurement after the wiring moved to the ladder: this function is now reached only
  // through kernelVersionAt, so W1 (which goes through resolveRangeKernel) no longer moves with it.
  'kernel-version-constant': ['W4'],
  'missing-registry-returns-empty': ['W6'],
  // Ninth widening (measured): dropping the no-range refusal moves W2 and W4 - W1's fixture carries no
  // range-less plugin, so its declared leg was simply wrong (hypothesis, not measurement).
  'no-range-marked-compatible': ['W2', 'W4'],
  'closure-looked-up-in-the-wrong-place': ['W1'],
  // Hypotheses for the two readings of the W7 counterexample: dropping the unscannable fallback loses the
  // vanished entry, and iterating everything the scan found adds an entry the registry never listed.
  'unscannable-entry-dropped': ['W7', 'W13'],
  'unlisted-scan-results-added': ['W7'],
  // Hypothesis: only the production-shaped reading depends on the fallback (every other fixture's closure
  // answers at the first rung).
  // Fourteenth widening (measured): the refusal reading and the real-set reading both resolve the kernel
  // version through the same fallback, so removing it moves W9 and W10 as well as W8.
  // Seventeenth widening (measured): the migration reading's satisfied leg resolves the version through the
  // same fallback, so it moves with W8/W9/W10.
  'kernel-root-ignored': ['W8', 'W9', 'W10', 'W11'],
  // Hypotheses: the refusal reading depends on the throw (W10), and the real set's verdicts depend on the
  // requires.dsh branch that the 18 manifests now fill (W9, and W10's clean leg reads the same function).
  // Sixteenth widening (measured): the migration reading refuses through the same throw, so it moves too.
  'enforcement-never-throws': ['W10', 'W11'],
  // Fifteenth widening (measured, and the mechanism is the point): every fixture in this gate declares its
  // range through requires.dsh, so dropping that branch turns the whole set into no-range - W1, W2, W4, W8,
  // W9 and W10 all move, not just the real-set reading.
  // Eighteenth widening (measured): without the requires.dsh branch the migration world's own plugins fall
  // out of range too, so W11 moves with the rest.
  'declared-range-ignored': ['W1', 'W2', 'W4', 'W8', 'W9', 'W10', 'W11', 'W13'],
  // Hypotheses for the two flag mutants: both change only the migration reading (nothing else here migrates).
  'enforcement-flag-ignored': ['W11'],
  'enforcement-defaults-on': ['W11'],
  // Hypotheses: each mutant owns one of the two readings, and nothing else here touches the registry shape
  // or the ambiguity branch except W10's vanished leg (which reports 'unscannable', a different string).
  'registry-siblings-dropped': ['W12'],
  'ambiguous-inherits-instead-of-reporting': ['W13'],
}

if (argv.includes('--self-attack')) {
  const base = {}
  for (const row of readings) base[row.id] = row.ok
  let bad = 0
  const moved = new Set()
  for (const name of Object.keys(MUTANTS)) {
    const child = spawnSync(process.execPath, [resolve(process.env.R127_SELF ?? process.argv[1]), '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 600000,
      env: { ...process.env, R127_MUTANT: name, R127_PROJECT: PROJECT, R127_WORLD: WORLD, R127_SELF: process.env.R127_SELF ?? process.argv[1] },
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
  const GUARDS = ['W5']
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