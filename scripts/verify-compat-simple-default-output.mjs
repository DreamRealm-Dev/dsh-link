#!/usr/bin/env node
/** R112 gate draft (T52): the compat default-output fix, measured as a PAIR in an isolated world.
 * Reading A (shipped plugin): tools.add without output must SUCCEED. Reading B (patched copy whose default
 * is forced back to { type: 'json' }): the same call must THROW JsonSchemaError. Mutants change only the
 * WORLD (not the expectations). */
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
// R115: promoted out of .tmp. Paths are derived, never hard-coded (the frozen T52_* contract):
//   T52_PROJECT     default: the process working directory (the project root)
//   T52_WORLD_ROOT  default: <project>/.tmp/r115-world — the world builder deletes and rebuilds it.
//   T52_COPY_ROOT   default: <project>/.tmp/r115-copies — private copies a mutant may write; the shipped
//                   artifact under plugins/ is READ-ONLY here and is only ever read and hashed.
const PROJECT = resolve(process.env.T52_PROJECT ?? process.env.R111_PROJECT ?? process.cwd())
const ROOT = resolve(process.env.T52_WORLD_ROOT ?? process.env.R111_ROOT ?? join(PROJECT, '.tmp', 'r115-world'))
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')
const BOOT = join(PROJECT, 'scripts', 'fixtures', 't52-boot.mjs')
const WORLD_PS = join(PROJECT, 'scripts', 'fixtures', 't52-world.ps1')
// R115-F: the frozen contract names T52_*; the old R111_* names stay as a fallback so this gate own
// self-attack keeps working. Reading only R111_* silently ignored a T52_MUTANT the caller had set.
const MUTANT = process.env.T52_MUTANT ?? process.env.R111_MUTANT ?? ''
const argv = process.argv.slice(2)
const readEvents = (p) => existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } }) : []
const names = (events, n) => events.map((r) => r.event).filter((o) => o && o.event === n)
const HOME = join(ROOT, 'home')
const NODES = join(HOME, 'profiles', 'web', 'node_modules')
const LINK = join(NODES, 'dsh-link-compat')
const SHIPPED = join(PROJECT, 'plugins', 'dsh-link-compat')
const PATCHED = join(ROOT, 'patched-compat')
// R114: the real artifact is READ-ONLY for this gate. Every world the mutants mutate is a private copy
// under this root (R114_ROOT, passed in rather than derived), so no mutant can reach plugins/ at all.
const PRIVATE_ROOT = resolve(process.env.T52_COPY_ROOT ?? process.env.R114_ROOT ?? join(PROJECT, '.tmp', 'r115-copies'))
const ACTOR = join(PRIVATE_ROOT, 'world', 'dsh-link-compat')
const ARTIFACT = join(SHIPPED, 'lib', 'index.js')
const MANIFEST = join(HOME, 'profiles', 'web', 'package.json')
const point = (target) => spawnSync('powershell', ['-NoProfile', '-Command', 'Remove-Item -Recurse -Force "' + LINK + '"; New-Item -ItemType Junction -Path "' + LINK + '" -Target "' + target + '" | Out-Null'], { encoding: 'utf8' }).status === 0
// The two kernel entry points are derived from PROJECT as file URLs (they used to be written out with a
// hard-coded absolute root, which is exactly what the frozen T52_* contract forbids).
const fileUrl = (relPath) => 'file:///' + join(PROJECT, relPath).replaceAll(String.fromCharCode(92), '/')
const boot = (marker) => { rmSync(marker, { force: true }); const run = spawnSync(process.execPath, ['--import', 'tsx/esm', BOOT], { cwd: KERNEL, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, DSH_HOME: HOME, R91_MARKER: marker, R91_PROFILE: 'web', R91_APP_BOOT: fileUrl('core/deepseek-harness/packages/boot/app-boot/src/index.ts'), R91_PROFILE_BOOT: fileUrl('core/deepseek-harness/apps/cli/src/profile-boot.ts'), DSH_LINK_KERNEL_VERSION: 'dsh-v0.2.1-alpha.1' } }); return { exit: run.status, events: readEvents(marker) } }
/** SHA-256 of the shipped artifact: this gate may read it and must never change it. */
const shaOf = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null)
const ARTIFACT_BEFORE = shaOf(ARTIFACT)
const checkArtifact = (label) => {
  const after = shaOf(ARTIFACT)
  const same = ARTIFACT_BEFORE === after
  // Loud, and NOT a SKIP: a run that changes the artifact is a broken instrument, whatever the readings say.
  console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  INV  ' + label + ' the shipped artifact is byte-identical (before=' + String(ARTIFACT_BEFORE).slice(0, 16) + ' after=' + String(after).slice(0, 16) + ')')
  if (!same) process.exitCode = 1
  return same
}

const readings = []
const held = (id, ok, detail) => readings.push({ id, ok: ok === true, detail: String(detail) })
// The builder deletes and rebuilds the whole world, so callers must be serial: it is told which project and
// which world root to use rather than guessing them.
// R182-H: Windows PowerShell 5.1 refuses to load an unsigned .ps1 stored on a non-system volume (H: here)
// unless the process-scope policy allows it -- and whether it does is decided by whoever launched the gate, not
// by the gate. Measured: the same file runs from C: and is refused from H:, and -ExecutionPolicy Bypass
// (which scripts/verify-shell-radius.mjs:1138 already passes) makes the refusal go away. This changes the HOST
// policy for the child only; the world builder and every reading stay exactly as they were.
const build = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORLD_PS], { cwd: PROJECT, encoding: 'utf8', timeout: 300000, env: { ...process.env, T52_PROJECT: PROJECT, T52_WORLD_ROOT: ROOT } })
held('R1', build.status === 0, 'isolated world built at ' + HOME + ': exit=' + String(build.status))
// mutants mutate the WORLD only — and the world's "shipped" side is the private copy, never the artifact
// R197: the shipped plugin now carries its OWN node_modules (a junction to the kernel's vendored schemastery),
// and cpSync aborts inside it with EEXIST - the vendored copy's own relative link
// vendor/schemastery/node_modules/@deepseek-ai/cosmokit -> ../../../cosmokit only resolves where that tree
// really lives. So the actor is the plugin's OWN files copied, and its dependency tree is REACHED through a
// junction instead of duplicated: it differs from the shipped plugin in the one file a mutant may touch.
const copyActor = (dest) => {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(SHIPPED)) {
    if (entry === 'node_modules') continue
    cpSync(join(SHIPPED, entry), join(dest, entry), { recursive: true })
  }
  const deps = join(SHIPPED, 'node_modules')
  if (existsSync(deps)) symlinkSync(deps, join(dest, 'node_modules'), 'junction')
}
copyActor(ACTOR)
if (MUTANT === 'copy-not-patched') copyFileSync(join(ACTOR, 'lib', 'index.js'), join(PATCHED, 'lib', 'index.js'))
if (MUTANT === 'shipped-is-patched') copyFileSync(join(PATCHED, 'lib', 'index.js'), join(ACTOR, 'lib', 'index.js'))
if (MUTANT === 'no-compat') { const pkg = JSON.parse(readFileSync(MANIFEST, 'utf8')); pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== 'dsh-link-compat'); writeFileSync(MANIFEST, JSON.stringify(pkg, null, 2) + '\n', 'utf8') }
const backToShipped = point(ACTOR)
const unpatched = boot(join(ROOT, 'marker-unpatched.jsonl'))
const okA = names(unpatched.events, 'A.no-output.ok')
const avail = unpatched.events.map((r) => r.event).filter((o) => o && o.event === 'available')
held('R2', backToShipped && okA.length === 1 && avail.length === 1 && avail[0].value.tools === true, 'shipped plugin: A.no-output.ok x' + String(okA.length) + ', available=' + JSON.stringify(avail[0]?.value ?? null) + ', boot=' + String(unpatched.exit))
const toPatched = MUTANT === 'both-shipped' ? point(ACTOR) : point(PATCHED)
const patchedBoot = boot(join(ROOT, 'marker-patched.jsonl'))
const threw = names(patchedBoot.events, 'A.no-output.threw')
held('R3', toPatched && threw.length === 1 && threw[0].name === 'JsonSchemaError', 'patched copy: A.no-output.threw x' + String(threw.length) + ' name=' + String(threw[0]?.name) + ', boot=' + String(patchedBoot.exit))
held('R4', unpatched.exit === 0 && patchedBoot.exit === 0 && names(unpatched.events, 'driver-error').length === 0 && names(patchedBoot.events, 'driver-error').length === 0, 'both worlds boot without driver-error: ' + String(unpatched.exit) + '/' + String(patchedBoot.exit))
checkArtifact('after the readings, before the self-attack')
const DECLARED = { 'copy-not-patched': ['R3'], 'shipped-is-patched': ['R2'], 'no-compat': ['R2', 'R3', 'R4'], 'both-shipped': ['R3'] }
if (argv.includes('--self-attack')) {
  const base = {}
  for (const row of readings) base[row.id] = row.ok
  checkArtifact('before spawning the mutant worlds')
  let bad = 0
  const moved = new Set()
  for (const name of Object.keys(DECLARED)) {
    const run = spawnSync(process.execPath, [resolve(process.env.T52_SELF ?? process.env.R111_SELF ?? process.argv[1]), '--json'], { cwd: PROJECT, encoding: 'utf8', timeout: 1800000, env: { ...process.env, R111_MUTANT: name, R111_PROJECT: PROJECT, R111_ROOT: ROOT, R111_SELF: process.env.R111_SELF ?? process.argv[1] } })
    const line = ((run.stdout ?? '') + (run.stderr ?? '')).split(/\r?\n/).filter((l) => l.startsWith('[')).pop()
    if (line === undefined) { bad += 1; console.log('  FAIL  ' + name + '  produced no readings'); continue }
    const after = {}
    for (const row of JSON.parse(line)) after[row.id] = row.ok
    const flipped = Object.keys(after).filter((id) => base[id] !== after[id]).sort()
    for (const id of flipped) moved.add(id)
    const ok = JSON.stringify(flipped) === JSON.stringify(DECLARED[name])
    if (!ok) bad += 1
    console.log((ok ? '  ok    ' : '  FAIL  ') + name + '  flipped=' + (flipped.join(',') || '(none)') + ' declared=' + DECLARED[name].join(','))
  }
  checkArtifact('after every mutant world')
  // R1 is the world-building PRECONDITION (it reports that the isolated world was built), so it is not a
  // mutant target and is excluded from the coverage table by name — exactly like the INV line above.
  const uncovered = Object.keys(base).filter((id) => moved.has(id) === false && id !== 'R1')
  console.log('coverage: ' + String(moved.size) + ' of ' + String(Object.keys(base).length) + ' moved; uncovered=' + (uncovered.join(',') || '(none)'))
  console.log('declared-set mismatches: ' + String(bad))
  process.exit(bad === 0 && uncovered.length === 0 ? 0 : 1)
}
const failed = readings.filter((r) => r.ok === false).length
if (argv.includes('--json')) console.log(JSON.stringify(readings))
else { for (const r of readings) console.log((r.ok ? '  ok    ' : '  FAIL  ') + r.id + '  |  ' + r.detail); console.log(String(readings.length) + ' readings, ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed') }
process.exit(failed === 0 ? 0 : 1)