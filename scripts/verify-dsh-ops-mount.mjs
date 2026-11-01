#!/usr/bin/env node
/**
 * R119 gate #88: the third-party bundle dsh-ops, mounted in a throwaway composition.
 *
 * Why this exists: T54 asks whether T-Auto/dsh-ops (MIT AND Apache-2.0) can be carried by this project.
 * R117/R118 settled the shape of the answer - the plugin package is vendored (0.94 MB, 157 files) so the
 * reading can be re-run offline, while the three win32-x64 payloads (127 MB) stay pinned in
 * dsh-ops.pin.json and are never vendored. This gate is the part that must be reproducible:
 *
 *   I1  the vendored tree is the tree the lock folds (per-file sha256, kernel.lock.json's shape)
 *   I2  the supply-chain facts we refuse to take from the upstream README: no npm install scripts, no
 *       kernel-internal imports, the licence actually declared, and the bundle patch's row set
 *   A1  the composition activates CLEANLY with dsh-ops in it
 *   A2  it really publishes its tools: _ops names in the KERNEL's own registry, not in its own prose
 *   A3  our own layer still works in that composition (mounting a third party must not cost us ours)
 *   D1  the same boot minus exactly one variable (the dsh-ops row) - the pair that says what it added
 *   A4  a GUARD, not a measurement: nothing wrote plugins/ or vendor/ while all of that ran. It stays
 *       out of the coverage table by name, exactly like the artifact invariants in gate #86/#87: a
 *       mutant that moved it would have to damage the product, which is the defect it exists to catch.
 *
 * The live profile is never touched. The payloads are absent on purpose: R118 read that the plugin's
 * binary search does not throw at load, so the composition must come up anyway.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(process.env.T54_PROJECT ?? join(HERE, '..'))
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')
const WORLD_PS = join(PROJECT, 'scripts', 'fixtures', 't52-world.ps1')
const BOOT = join(PROJECT, 'scripts', 'fixtures', 'ops-boot.mjs')
const LOCK = join(PROJECT, 'dsh-ops.lock.json')
const VENDOR = resolve(process.env.T54_VENDOR ?? join(PROJECT, 'vendor', 'dsh-ops'))
const WORLD_ROOT = resolve(process.env.T52_WORLD_ROOT ?? join(PROJECT, '.tmp', 'r119-world', 'world'))
const MARKER = resolve(process.env.T54_MARKER_PATH ?? join(PROJECT, '.tmp', 'r119-world', 'marker.jsonl'))
const HOME = join(WORLD_ROOT, 'home')
const NODES = join(HOME, 'profiles', 'web', 'node_modules')
const MANIFEST = join(HOME, 'profiles', 'web', 'package.json')
const MUTANT = process.env.T54_MUTANT ?? ''
const INJECT = process.env.T54_INJECT_LINE ?? ''
const FAKE_OPS = process.env.T54_FAKE_OPS ?? ''
const argv = process.argv.slice(2)
// GUARD SHAPE (R127): the product guards below compare the working tree at the START of this run with the
// one at its end. They used to require an empty --short output, which misfired the moment a round shipped
// plugin changes of its own: three unrelated gates went red on this round's wiring work for work that was
// not damage. What a run owns is that IT added nothing - and that is what is measured now.
const statusLines = () => {
  const out = spawnSync('git', ['status', '--short', '--', 'plugins', 'vendor'], { cwd: PROJECT, encoding: 'utf8' })
  return String(out.stdout ?? '').trim() === '' ? [] : String(out.stdout).trim().split(/\r?\n/).map((line) => line.trim()).sort()
}
const statusAtStart = statusLines()

for (const required of [WORLD_PS, BOOT, LOCK]) {
  if (!existsSync(required)) { console.error('dsh-ops-mount: missing prerequisite ' + required); process.exit(2) }
}
if (!existsSync(VENDOR)) { console.error('dsh-ops-mount: no vendored tree at ' + VENDOR + ' - the vendor step is checked in, so this is a broken checkout'); process.exit(2) }

// One vendored subtree, enumerated by glob on purpose: this gate hashes a pinned third-party tree, it does
// not walk the repository's plugin roster. verify-roster-single-source counts a readdirSync loop beside the
// three source roots as a second roster scan, and a glob here says what the code actually does.
const walk = (dir) => globSync('**/*', { cwd: dir, withFileTypes: false }).map((rel) => join(dir, String(rel))).filter((path) => statSync(path).isFile())
// Canonical form: line endings normalised to LF before hashing (the rule dsh-ops.lock.json records).
// core.autocrlf rewrites EOLs on checkout, so hashing raw bytes would make this reading depend on the
// checkout environment rather than on the vendored package - the defect class R115 caught.
const canonical = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const foldOf = (dir) => {
  const rows = walk(dir).map((file) => relative(dir, file).split('\\').join('/')).sort().map((rel) => rel + '|' + createHash('sha256').update(canonical(join(dir, rel))).digest('hex'))
  return createHash('sha256').update(rows.join('\n') + '\n').digest('hex')
}
const shaOf = (path) => (existsSync(path) ? createHash('sha256').update(canonical(path)).digest('hex') : null)
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const markerEvents = () => existsSync(MARKER) ? readFileSync(MARKER, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }) : []
const one = (list, name) => list.find((row) => row.event === name)
const COMPAT_LIB = join(PROJECT, 'plugins', 'dsh-link-compat', 'lib', 'index.js')
const compatBefore = shaOf(COMPAT_LIB)

const readings = []
const held = (id, ok, detail) => readings.push({ id, ok: ok === true, detail: String(detail) })

// I1 - the vendored tree is what the lock folds.
const lock = readJson(LOCK)
const fold = foldOf(VENDOR)
held('I1', lock !== null && lock.fold === 'sha256:' + fold, 'the vendored tree folds to the checked-in lock: lock=' + String(lock?.fold).slice(0, 24) + ' tree=sha256:' + fold.slice(0, 16) + ' files=' + String(walk(VENDOR).length))

// I2 - supply-chain facts, read from our own vendored copy rather than from the README.
const pkg = readJson(join(VENDOR, 'package.json'))
const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'prepublishOnly'].filter((key) => pkg?.scripts?.[key] !== undefined)
const libFiles = existsSync(join(VENDOR, 'lib')) ? walk(join(VENDOR, 'lib')) : []
const kernelImports = libFiles.flatMap((file) => readFileSync(file, 'utf8').split('\n').filter((line) => /from ['"]@deepseek-ai\//.test(line) || /import\(['"]@deepseek-ai\//.test(line)))
const patchText = readFileSync(join(VENDOR, 'cordis.patch.yml'), 'utf8')
const patchRows = patchText.split('\n').filter((line) => /^\s*- id: /.test(line)).map((line) => line.replace(/^\s*- id: /, '').trim())
const patchDisabled = patchText.split('\n').filter((line) => /^\s*disabled: true/.test(line)).length
const licenceOk = pkg?.license === 'MIT AND Apache-2.0' && existsSync(join(VENDOR, 'NOTICE')) && existsSync(join(VENDOR, 'PROVENANCE.md'))
held('I2', lifecycle.length === 0 && kernelImports.length === 0 && licenceOk && patchRows.length === 3
  && JSON.stringify([...patchRows].sort()) === JSON.stringify(['dsh-ops-background', 'dsh-ops-file', 'dsh-ops-shell']) && patchDisabled === 1,
  'supply chain: installScripts=' + JSON.stringify(lifecycle) + ' kernelImports=' + String(kernelImports.length) + ' license=' + String(pkg?.license) + ' notice=' + String(existsSync(join(VENDOR, 'NOTICE'))) + ' provenance=' + String(existsSync(join(VENDOR, 'PROVENANCE.md'))) + ' rows=' + JSON.stringify(patchRows) + ' disabled=' + String(patchDisabled))

// The world: a mirror of the live profile, plus a junction to OUR vendored copy (never the live tree).
// R182-H: Windows PowerShell 5.1 refuses to load an unsigned .ps1 stored on a non-system volume (H: here)
// unless the process-scope policy allows it -- and whether it does is decided by whoever launched the gate, not
// by the gate. Measured: the same file runs from C: and is refused from H:, and -ExecutionPolicy Bypass
// (which scripts/verify-shell-radius.mjs:1138 already passes) makes the refusal go away. This changes the HOST
// policy for the child only; the world builder and every reading stay exactly as they were.
const world = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORLD_PS], { cwd: PROJECT, encoding: 'utf8', timeout: 300000, env: { ...process.env, T52_WORLD_ROOT: WORLD_ROOT, T52_PROJECT: PROJECT } })
mkdirSync(dirname(MARKER), { recursive: true })
const linkAt = join(NODES, 'dsh-ops')
const point = (target) => spawnSync('powershell', ['-NoProfile', '-Command', 'Remove-Item -Recurse -Force "' + linkAt + '"; New-Item -ItemType Junction -Path "' + linkAt + '" -Target "' + target + '" | Out-Null'], { encoding: 'utf8' }).status === 0

const bootWorld = (withOps, withCompat) => {
  const manifest = readJson(MANIFEST)
  if (manifest === null) return { status: -1, events: [], stdout: '', linked: false }
  let bundles = (manifest.dsh?.profile?.bundles ?? []).filter((name) => name !== 'dsh-ops')
  if (!withCompat) bundles = bundles.filter((name) => name !== 'dsh-link-compat')
  if (withOps) bundles = [...bundles, 'dsh-ops']
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } }
  writeFileSync(MANIFEST, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
  // The junction is ALWAYS there: the single variable this gate changes is the bundle ROW, never the
  // package's presence. (A pair that moved two things at once would say nothing about either.)
  const linked = point(VENDOR)
  rmSync(MARKER, { force: true })
  const run = spawnSync(process.execPath, ['--import', 'tsx/esm', BOOT], {
    cwd: KERNEL, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env, DSH_HOME: HOME, T54_MARKER: MARKER, T54_PROFILE: 'web',
      T54_APP_BOOT: pathToFileURL(join(KERNEL, 'packages', 'boot', 'app-boot', 'src', 'index.ts')).href,
      T54_PROFILE_BOOT: pathToFileURL(join(KERNEL, 'apps', 'cli', 'src', 'profile-boot.ts')).href,
      DSH_LINK_KERNEL_VERSION: 'dsh-v0.2.1-alpha.1',
    },
  })
  // A mutant may inject a line into what the grader reads. That seam exists so the activation rule can be
  // shown to bite; it is never used by the baseline run.
  const seen = markerEvents()
  // A second injection seam, for the same reason as the first: the reading 'it publishes nothing' must be
  // shown to bite. The baseline never sets it.
  if (FAKE_OPS !== '' && withOps) for (const row of seen) if (row.event === 'tools.names') { row.ops = FAKE_OPS.split(',').filter(Boolean); row.count = (typeof row.count === 'number' ? row.count : 0) + row.ops.length }
  return { status: run.status, events: seen, stdout: String(run.stdout ?? '') + (INJECT === '' ? '' : '\n' + INJECT), linked }
}
const activationFailures = (text) => text.split(/\r?\n/).filter((line) => /did not activate|startup failed/i.test(line))
const opsOf = (events) => { const row = one(events, 'tools.names'); return Array.isArray(row?.ops) ? row.ops : null }
const countOf = (events) => { const row = one(events, 'tools.names'); return typeof row?.count === 'number' ? row.count : -1 }

const withOps = bootWorld(MUTANT === 'row-removed' ? false : true, MUTANT === 'compat-row-removed' ? false : true)
const opsNames = opsOf(withOps.events)
const compatVisible = one(withOps.events, 'compat.visible')
const compatTools = one(withOps.events, 'compat.tools')
const failures = activationFailures(withOps.stdout)
held('A1', world.status === 0 && withOps.linked === true && failures.length === 0 && one(withOps.events, 'consumer-done') !== undefined && one(withOps.events, 'driver-error') === undefined,
  'the composition with dsh-ops mounts cleanly: world=' + String(world.status) + ' linked=' + String(withOps.linked) + ' boot=' + String(withOps.status) + ' activationFailures=' + JSON.stringify(failures.slice(0, 3)) + ' dshOpsLines=' + JSON.stringify(withOps.stdout.split(/\r?\n/).filter((line) => /dsh-ops/i.test(line)).slice(0, 4)))
// C1 - the construction really carries dsh-ops (a reading, so a broken construction cannot be mistaken
// for a property of the third party).
const manifestNow = readJson(MANIFEST)
const vendoredThroughTheJunction = readJson(join(linkAt, 'package.json'))
held('C1', Array.isArray(manifestNow?.dsh?.profile?.bundles) && manifestNow.dsh.profile.bundles.includes('dsh-ops')
  && vendoredThroughTheJunction?.name === 'dsh-ops' && vendoredThroughTheJunction?.version === '0.2.4'
  && vendoredThroughTheJunction?.dsh?.bundle?.patch === './cordis.patch.yml',
  'the construction carries it: manifestListsDshOps=' + String(Array.isArray(manifestNow?.dsh?.profile?.bundles) && manifestNow.dsh.profile.bundles.includes('dsh-ops')) + ' throughJunction=' + JSON.stringify({ name: vendoredThroughTheJunction?.name, version: vendoredThroughTheJunction?.version, patch: vendoredThroughTheJunction?.dsh?.bundle?.patch }))
// C2 - the CONTROL: the same construction loads a bundle we know works, so "nothing happened" cannot be
// blamed on a dead world. This is the R21 rule (prove the observation object exists before an absence).
held('C2', compatVisible?.hasCompat === true && compatVisible?.hasSimple === true && countOf(withOps.events) > 0,
  'the control loads in the same boot: hasCompat=' + String(compatVisible?.hasCompat) + ' hasSimple=' + String(compatVisible?.hasSimple) + ' toolCount=' + String(countOf(withOps.events)) + ' sample=' + JSON.stringify(one(withOps.events, 'tools.names')?.sample ?? null))
// A2 - the MEASURED TRUTH, pinned: in this construction dsh-ops publishes nothing. R119 ruled out (a) the
// missing 127 MB payloads, (b) subpath row names (dsh-ops/shell) versus a bare name, (c) a missing
// dependencies row, and (d) a failure line - all four were tried by hand and none of them changed this.
// The day it publishes tools the reading flips, which is the signal to re-read the T54 decision rather
// than to quietly keep this section.
// R120: the reason for the zero is now known and pinned here as a PRECONDITION, not as a mystery. The rows
// mount (R120 read hasFiber=true for dsh-ops-shell/-file through the loader), and the plugin publishes only
// what its own runtime has provisioned into <DSH_HOME>/dsh-ops/bin - R118 read that policy out of its code
// ("absent tools never get advertised"). R120 provisioned fastctx into a world by hand and the registry went
// from 14 tools to 18, gaining ops_glob/ops_grep/ops_inspect_local_file/ops_replace. This gate deliberately
// runs the UNPROVISIONED world, so the boundary it pins is: no provisioned runtime means no ops tools, and
// the moment someone provisions this world the second conjunct reddens and says so.
const provisionedDir = join(HOME, 'dsh-ops', 'bin')
const runtimeProvisioned = existsSync(provisionedDir)
held('A2', Array.isArray(opsNames) && opsNames.length === 0 && countOf(withOps.events) >= 0 && runtimeProvisioned === false,
  'dsh-ops publishes NO tools while its runtime is unprovisioned: ' + ' (runtimeProvisioned=' + String(runtimeProvisioned) + ') ' + ' ops=' + JSON.stringify(opsNames) + ' toolCount=' + String(countOf(withOps.events)) + ' service=' + JSON.stringify(one(withOps.events, 'tools.service') ?? null) + ' hasPwsh=' + String(one(withOps.events, 'tools.names')?.hasPwsh))
held('A3', compatVisible?.hasCompat === true && typeof compatTools?.count === 'number' && compatTools.count >= 0, 'our own layer is intact in that composition: hasCompat=' + String(compatVisible?.hasCompat) + ' hasSimple=' + String(compatVisible?.hasSimple) + ' compatToolCount=' + String(compatTools?.count) + ' compatOps=' + JSON.stringify(compatTools?.ops ?? null))

// D1 - the same boot minus exactly one variable: the dsh-ops row.
const withoutOps = bootWorld(false, true)
const opsWithout = opsOf(withoutOps.events)
// R168: "19 vs 14" is not a diagnosis. The pair is one row apart, so the difference has to say WHICH tools appeared and
// therefore whose they are; otherwise this reading can only report an unexplained count.
const namesOf = (events) => { const row = one(events, 'tools.names'); return Array.isArray(row?.sample) ? row.sample : (Array.isArray(row?.names) ? row.names : []) }
const sampleWith = namesOf(withOps.events)
const sampleWithout = namesOf(withoutOps.events)
const onlyWith = sampleWith.filter((name) => sampleWithout.includes(name) === false)
const onlyWithout = sampleWithout.filter((name) => sampleWith.includes(name) === false)
const sampleIsPartial = sampleWith.length < countOf(withOps.events) || sampleWithout.length < countOf(withoutOps.events)
held('D1', Array.isArray(opsWithout) && opsWithout.length === 0 && Array.isArray(opsNames) && opsNames.length === 0 && countOf(withOps.events) === countOf(withoutOps.events),
  'the pair, one variable apart, changes nothing visible: toolCount with=' + String(countOf(withOps.events)) + ' without=' + String(countOf(withoutOps.events)) + ' onlyWith=' + JSON.stringify(onlyWith) + ' onlyWithout=' + JSON.stringify(onlyWithout) + (sampleIsPartial ? ' (the name lists are SAMPLES: ' + String(sampleWith.length) + '/' + String(countOf(withOps.events)) + ' and ' + String(sampleWithout.length) + '/' + String(countOf(withoutOps.events)) + ')' : '') + ' opsWith=' + JSON.stringify(opsNames) + ' opsWithout=' + JSON.stringify(opsWithout) + ' activationFailuresWithout=' + JSON.stringify(activationFailures(withoutOps.stdout).slice(0, 3)))

// A4 - GUARD (excluded from the coverage table by name).
const vendorAfter = foldOf(VENDOR)
const compatAfter = shaOf(COMPAT_LIB)
const dirtyLines = statusLines()
// What this run owns is that IT changed no status line - a round that ships plugin changes starts and ends
// with those same lines, and an untracked vendor/ tree that was there at the start is not damage.
const trackedWrites = dirtyLines.filter((line) => line.startsWith('??') === false)
const productAdditions = dirtyLines.filter((line) => line.startsWith('?? plugins/'))
const cleanTree = JSON.stringify(dirtyLines) === JSON.stringify(statusAtStart)
held('A4', vendorAfter === fold && compatAfter === compatBefore && cleanTree, 'the product was read, never written: vendorFoldSame=' + String(vendorAfter === fold) + ' compatLibSame=' + String(compatAfter === compatBefore) + ' trackedWrites=' + JSON.stringify(trackedWrites) + ' newFilesUnderPlugins=' + JSON.stringify(productAdditions) + ' untracked=' + JSON.stringify(dirtyLines.filter((line) => line.startsWith('??'))))

const DECLARED = {
  'row-removed': ['C1'],
  'compat-row-removed': ['C2', 'A3'],
  'vendor-tampered': ['I1'],
  'patch-extra-row': ['I1', 'I2'],
  'did-not-activate-injected': ['A1'],
  'fake-ops-tool': ['A2', 'D1'],
}
const GUARDS = ['A4']
const mutantVendor = (name) => {
  const dir = join(PROJECT, '.tmp', 'r119-world', 'mutants', name)
  rmSync(dir, { recursive: true, force: true })
  cpSync(VENDOR, dir, { recursive: true })
  if (name === 'vendor-tampered') {
    const victim = join(dir, 'lib', 'index.js')
    writeFileSync(victim, readFileSync(victim, 'utf8') + '\n// tampered by the vendor-tampered mutant\n', 'utf8')
  }
  if (name === 'patch-extra-row') {
    const patch = join(dir, 'cordis.patch.yml')
    writeFileSync(patch, readFileSync(patch, 'utf8') + '\n- insert:\n    - id: dsh-ops-extra\n      name: dsh-ops/shell\n', 'utf8')
  }
  return dir
}
if (argv.includes('--self-attack')) {
  const base = {}
  for (const row of readings) base[row.id] = row.ok
  let bad = 0
  const moved = new Set()
  for (const name of Object.keys(DECLARED)) {
    const env = { ...process.env, T54_MUTANT: name, T54_PROJECT: PROJECT, T54_SELF: process.env.T54_SELF ?? process.argv[1] }
    if (name === 'did-not-activate-injected') env.T54_INJECT_LINE = '[dsh-ops] did not activate (injected by the did-not-activate-injected mutant)'
    if (name === 'fake-ops-tool') env.T54_FAKE_OPS = 'ops_inspect_local_file'
    if (name === 'vendor-tampered' || name === 'patch-extra-row') env.T54_VENDOR = mutantVendor(name)
    const child = spawnSync(process.execPath, [resolve(process.env.T54_SELF ?? process.argv[1]), '--json'], { cwd: PROJECT, encoding: 'utf8', timeout: 1800000, env })
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
