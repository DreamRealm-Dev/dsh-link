#!/usr/bin/env node
/**
 * R116 gate: do the three simplified roles work end to end in the REAL mirrored mount?
 *
 * This is the "mounted" half of acceptance A. The hermetic half (three compositions, including a
 * composition with no services at all) is a separate gate; this one mounts the shipped plugin the way
 * the operator's own profile does - scripts/fixtures/t52-world.ps1 mirrors the live profile, the
 * plugin under test is reached through a PRIVATE copy of the built artifact, and
 * scripts/fixtures/acceptance-boot.mjs calls the three roles and records raw facts.
 *
 * The driver decides nothing (its header says so); every expectation lives here. Two rules carried in
 * from earlier rounds:
 *   - the real artifact is READ-ONLY for this gate: a mutant may only touch the private copy;
 *   - a reading that cannot be taken is printed as ABSENT with its reason and counted, never silently
 *     green (the "hollow green" discipline). Rows/limit/id-independence need a non-empty store, and a
 *     fresh world's store is empty by construction (SessionCorpus.listSessions = persisted + live).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(process.env.MOUNTED_PROJECT ?? join(HERE, '..'))
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')
const WORLD_PS = join(PROJECT, 'scripts', 'fixtures', 't52-world.ps1')
const WORLD_ROOT = resolve(process.env.T52_WORLD_ROOT ?? join(PROJECT, '.tmp', 'r116-mounted', 'world'))
const ACTOR = resolve(process.env.MOUNTED_ACTOR ?? join(PROJECT, '.tmp', 'r116-mounted', 'actor'))
const MARKER = resolve(process.env.MOUNTED_MARKER ?? join(PROJECT, '.tmp', 'r116-mounted', 'marker.jsonl'))
const SHIPPED = join(PROJECT, 'plugins', 'dsh-link-compat')
const ARTIFACT = join(SHIPPED, 'lib', 'index.js')
const HOME = join(WORLD_ROOT, 'home')
const LINK = join(HOME, 'profiles', 'web', 'node_modules', 'dsh-link-compat')
const MANIFEST = join(HOME, 'profiles', 'web', 'package.json')
const MUTANT = process.env.MOUNTED_MUTANT ?? ''
const argv = process.argv.slice(2)
// GUARD SHAPE (R127): the product guards below compare the working tree at the START of this run with the
// one at its end. They used to require an empty --short output, which misfired the moment a round shipped
// plugin changes of its own: three unrelated gates went red on this round's wiring work for work that was
// not damage. What a run owns is that IT added nothing - and that is what is measured now.
const statusLines = () => {
  const out = spawnSync('git', ['status', '--short', '--', 'plugins'], { cwd: PROJECT, encoding: 'utf8' })
  return String(out.stdout ?? '').trim() === '' ? [] : String(out.stdout).trim().split(/\r?\n/).map((line) => line.trim()).sort()
}
const statusAtStart = statusLines()
const BOOT = process.env.MOUNTED_BOOT ?? join(PROJECT, 'scripts', 'fixtures', 'acceptance-boot.mjs')
const SETTINGS_STATUS = ['unreadable', 'applied', 'rejected', 'already-present']

for (const required of [WORLD_PS, BOOT, ARTIFACT]) {
  if (!existsSync(required)) { console.error('roles-mounted: missing prerequisite ' + required); process.exit(2) }
}

const events = () => existsSync(MARKER)
  ? readFileSync(MARKER, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
  : []
const one = (list, name) => list.find((row) => row.event === name)
const all = (list, name) => list.filter((row) => row.event === name)
const shaOf = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null)

// The artifact must be byte-identical throughout: a world the mutants mutate is always the private copy.
const ARTIFACT_BEFORE = shaOf(ARTIFACT)
const integrity = []
const checkArtifact = (label) => {
  const after = shaOf(ARTIFACT)
  const same = ARTIFACT_BEFORE === after
  integrity.push({ label, same, before: String(ARTIFACT_BEFORE).slice(0, 16), after: String(after).slice(0, 16) })
  console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  INV  ' + label + ' shipped artifact byte-identical (before=' + String(ARTIFACT_BEFORE).slice(0, 16) + ' after=' + String(after).slice(0, 16) + ')')
  if (!same) process.exitCode = 1
  return same
}

const pointLink = (target) => spawnSync('powershell', ['-NoProfile', '-Command', 'Remove-Item -Recurse -Force "' + LINK + '"; New-Item -ItemType Junction -Path "' + LINK + '" -Target "' + target + '" | Out-Null'], { encoding: 'utf8' }).status === 0

// World, then the private copy the mutants are allowed to touch.
// R182-H: Windows PowerShell 5.1 refuses to load an unsigned .ps1 stored on a non-system volume (H: here)
// unless the process-scope policy allows it -- and whether it does is decided by whoever launched the gate, not
// by the gate. Measured: the same file runs from C: and is refused from H:, and -ExecutionPolicy Bypass
// (which scripts/verify-shell-radius.mjs:1138 already passes) makes the refusal go away. This changes the HOST
// policy for the child only; the world builder and every reading stay exactly as they were.
const world = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORLD_PS], { cwd: PROJECT, encoding: 'utf8', timeout: 300000, env: { ...process.env, T52_WORLD_ROOT: WORLD_ROOT, T52_PROJECT: PROJECT } })
mkdirSync(dirname(MARKER), { recursive: true })
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
let bootPath = BOOT
const patchedDir = join(PROJECT, '.tmp', 'r116-mounted', 'patched')
mkdirSync(patchedDir, { recursive: true })

if (MUTANT === 'actor-old-default') {
  const lib = join(ACTOR, 'lib', 'index.js')
  const text = readFileSync(lib, 'utf8')
  const reverted = text.replace('spec.output ?? {}', "spec.output ?? { type: 'json' }")
  if (reverted === text) { console.error('roles-mounted: actor-old-default could not patch the actor copy'); process.exit(2) }
  writeFileSync(lib, reverted, 'utf8')
}
if (MUTANT === 'no-compat' || MUTANT === 'actor-missing') {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== 'dsh-link-compat')
  writeFileSync(MANIFEST, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
}
if (MUTANT === 'drop-await-on-recent' || MUTANT === 'control-read-removed' || MUTANT === 'no-seed-sessions' || MUTANT === 'post-seed-session-unrecorded') {
  const text = readFileSync(BOOT, 'utf8')
  const next = MUTANT === 'drop-await-on-recent'
    ? text.replace("const rows = await recent.recent('__r116-probe__')", "const rows = recent.recent('__r116-probe__')")
    : MUTANT === 'no-seed-sessions'
      ? text.replace('const created = sessions.create()', 'const created = null')
      : MUTANT === 'post-seed-session-unrecorded'
        // R118: the hollow-ness test the independent recompute asked for. The driver records two ids and
        // then one MORE session appears before recent() is called, so the returned rows contain an id that
        // was never recorded. A1 must notice; if it does not, A1 is hollow and has to be rewritten.
        ? text.replace('    const recent = simple.sessions', '    ctx.sessions.create()\n    const recent = simple.sessions')
      : text.replace("note('control.settled', undefined, { rootAlive: aliveRoot(ctx) })", "// control reading removed by the control-read-removed mutant")
  if (next === text) { console.error('roles-mounted: mutant ' + MUTANT + ' changed nothing'); process.exit(2) }
  bootPath = join(patchedDir, 'acceptance-boot.' + MUTANT + '.mjs')
  writeFileSync(bootPath, next, 'utf8')
}

const linked = MUTANT === 'actor-missing' ? pointLink(join(patchedDir, 'does-not-exist')) : pointLink(ACTOR)
rmSync(MARKER, { force: true })
const run = spawnSync(process.execPath, ['--import', 'tsx/esm', bootPath], {
  cwd: KERNEL, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024,
  env: {
    ...process.env, DSH_HOME: HOME, T52_MARKER: MARKER, T52_PROFILE: 'web',
    T52_APP_BOOT: pathToFileURL(join(KERNEL, 'packages', 'boot', 'app-boot', 'src', 'index.ts')).href,
    T52_PROFILE_BOOT: pathToFileURL(join(KERNEL, 'apps', 'cli', 'src', 'profile-boot.ts')).href,
    DSH_LINK_KERNEL_VERSION: 'dsh-v0.2.1-alpha.1',
  },
})
const seen = events()
const readings = []
const held = (id, ok, detail) => readings.push({ id, ok: ok === true, detail: String(detail) })
const probeStatusIsZero = (result) => result.status === 0
const absent = []
const absentReading = (id, reason, precondition) => { absent.push(id); console.log('  ABSENT ' + id + '  |  ' + reason + '  (precondition: ' + precondition + ')') }

const worldBuilt = world.status === 0 && /world_ready=/.test(String(world.stdout ?? ''))
held('R1', worldBuilt, 'mirrored world built at ' + WORLD_ROOT + ': exit=' + String(world.status) + (worldBuilt ? '' : ' stdout=' + String(world.stdout ?? '').slice(-200) + ' stderr=' + String(world.stderr ?? '').slice(-200)))
const available = one(seen, 'available')
const trio = available?.valuePreview === undefined ? null : (() => { try { return JSON.parse(available.valuePreview) } catch { return null } })()
held('R2', linked && trio !== null && trio.sessions === true && trio.tools === true && trio.settings === true, 'mounted plugin: available=' + String(available?.valuePreview) + ', linked=' + String(linked) + ', boot=' + String(run.status))
const added = one(seen, 'tools.add.ok')
held('R3', added !== undefined && added.has === true && added.namesInclude === true, 'tools.add with no output: ok, has=' + String(added?.has) + ' namesInclude=' + String(added?.namesInclude) + ' definitionKeys=' + JSON.stringify(added?.definitionKeys ?? null))
const recent = one(seen, 'sessions.recent.ok')
const listLength = typeof recent?.length === 'number' ? recent.length : -1
held('R4', recent !== undefined && recent.isArray === true && listLength >= 0, 'sessions.recent: isArray=' + String(recent?.isArray) + ' length=' + String(listLength) + ' (two live sessions were seeded through the kernel before this call)')
const declared = one(seen, 'settings.define.ok')
const status = declared?.declaration?.status
const reason = declared?.declaration?.reason
const reasonPaired = status === 'applied' || status === 'already-present' ? reason === null || reason === undefined : typeof reason === 'string' && reason.length > 0
held('R5', declared !== undefined && SETTINGS_STATUS.includes(status) && reasonPaired, 'settings.define: status=' + String(status) + ' reason=' + String(typeof reason === 'string' ? reason.slice(0, 90) : reason) + ' keys=' + JSON.stringify(declared?.declarationKeys ?? null))
const thenables = seen.filter((row) => row.isThenable === true)
held('R6', seen.length > 0 && thenables.length === 0, 'no reading is a Promise: events=' + String(seen.length) + ' thenables=' + JSON.stringify(thenables.map((row) => row.event)))
const settled = one(seen, 'control.settled')
const disposed = one(seen, 'control.disposed')
const driverErrors = all(seen, 'driver-error')
held('R7', settled?.rootAlive === true && disposed !== undefined && one(seen, 'consumer-done') !== undefined && driverErrors.length === 0, 'the reading is credible: settled rootAlive=' + JSON.stringify(settled?.rootAlive) + ', consumer-done=' + String(one(seen, 'consumer-done') !== undefined) + ', driver-errors=' + JSON.stringify(driverErrors.map((row) => row.message)))
checkArtifact('after the readings')
const statusAtEnd = statusLines()
held('R8', JSON.stringify(statusAtEnd) === JSON.stringify(statusAtStart), 'the gate never wrote the product: this RUN added no status line under plugins/ (before=' + JSON.stringify(statusAtStart) + ' after=' + JSON.stringify(statusAtEnd) + ')')

// Rows, limit slicing and id-independence need a non-empty store. Say so out loud instead of passing.
// A reading that cannot be taken is reported, never turned into a quiet false. Three situations:
// the store is empty (precondition listLength=0), the role did not run at all (the plugin is missing
// from this world), or there are rows to judge. Only the last one asserts.
// Three situations, and only the last one may be a quiet pass:
//   listLength > 0  - the driver seeded two live sessions through the kernel, so the rows can be judged;
//   listLength === 0 - the store came back empty (say so, with the precondition);
//   listLength < 0   - the role never ran in this world (the plugin is missing, say so too).
const seededEvent = one(seen, 'sessions.seed.ok')
const seededIds = Array.isArray(seededEvent?.ids) ? seededEvent.ids.filter((id) => typeof id === 'string') : []
const rows = (() => { try { return JSON.parse(recent?.valuePreview ?? 'null') } catch { return null } })()
if (listLength > 0) {
  // R117: the reading that matters is correlation, not a shape string: the rows this composition returns
  // must be exactly the sessions this driver created through the kernel's own service. The summary fields
  // stay null because the kernel's list role carries no summaries - the source says so and refuses to
  // invent them (compat/simple.ts:90-101), so null is the assertion, not a missing reading.
  const rowIds = Array.isArray(rows) ? rows.map((row) => row?.id) : null
  const keys = Array.isArray(rows) && rows.length > 0 ? Object.keys(rows[0]).sort().join(',') : ''
  held('A1', rowIds !== null && seededIds.length === 2 && JSON.stringify([...rowIds].sort()) === JSON.stringify([...seededIds].sort())
    && keys === 'bytes,entries,id,title,updatedAt'
    && rows.every((row) => row.title === null && row.updatedAt === null && row.entries === null && row.bytes === null),
    'rows are the two sessions this driver created through the kernel, and no summary is invented: rowIds=' + JSON.stringify(rowIds) + ' seeded=' + JSON.stringify(seededIds) + ' keys=' + keys + ' shape=' + String(recent?.rowShape ?? ''))
  const limited = one(seen, 'sessions.recent.limit1')
  held('A2', limited?.isArray === true && limited.length === 1 && listLength >= 2, 'limit=1 slicing on a seeded store: length=' + String(limited?.length) + ' of listLength=' + String(listLength))
  const unknown = one(seen, 'sessions.recent.unknown')
  held('A3', unknown?.sameIdsAsList === true && unknown?.length === listLength, 'id-independence per the source (the id only reads an anchor): sameIdsAsList=' + String(unknown?.sameIdsAsList) + ' length=' + String(unknown?.length) + ' listLength=' + String(listLength))
} else if (listLength === 0) {
  absentReading('A1', 'recent rows not judged: the store came back empty', 'listLength=0')
  absentReading('A2', 'limit slicing not judged: needs at least two rows', 'listLength=0')
  absentReading('A3', 'id-independence not judged: every call returns the same empty list', 'listLength=0')
} else {
  const why = 'the role did not run in this world (isArray=' + String(recent?.isArray) + ', events=' + String(seen.length) + ')'
  absentReading('A1', 'recent rows not judged: ' + why, 'listLength=' + String(listLength))
  absentReading('A2', 'limit slicing not judged: ' + why, 'listLength=' + String(listLength))
  absentReading('A3', 'id-independence not judged: ' + why, 'listLength=' + String(listLength))
}

// ---------------------------------------------------------------------------
// The hermetic half: three compositions judged from the instrument's payload. The instrument
// (scripts/probe-compat-simple.mjs, R21/R30) only reports; every expectation lives here. Mutants
// patch a COPY of the instrument's case table, never the shipped one.
// ---------------------------------------------------------------------------
const PROBE = join(PROJECT, 'scripts', 'probe-compat-simple.mjs')
let probePath = PROBE
if (MUTANT.startsWith('hermetic-')) {
  const text = readFileSync(PROBE, 'utf8')
  let next = text.replace("const PROJECT = resolve(HERE, '..')", "const PROJECT = resolve(process.env.HERMETIC_PROJECT ?? resolve(HERE, '..'))")
  if (next === text) { console.error('roles-mounted: the instrument no longer exposes a PROJECT line to rebase'); process.exit(2) }
  const rebased = next
  if (MUTANT === 'hermetic-drops-a-case') next = next.replace("id: 'services-present'", "id: 'services-present-dropped'")
  if (MUTANT === 'hermetic-breaks-a-role') next = next.replace("await simple.settings.define('r30-probe', { enabled: true }, { type: 'object' })", "await Promise.reject(new Error('hermetic-breaks-a-role mutant'))")
  if (MUTANT === 'hermetic-driver-fails') next = next.replace("note('driver-imported')", "note('driver-imported'); throw new Error('hermetic-driver-fails mutant')")
  if (next === rebased) { console.error('roles-mounted: mutant ' + MUTANT + ' changed nothing in the instrument'); process.exit(2) }
  probePath = join(patchedDir, 'probe.' + MUTANT + '.mjs')
  writeFileSync(probePath, next, 'utf8')
}
const hermeticOut = join(PROJECT, '.tmp', 'r116-mounted', 'payload.' + (MUTANT || 'baseline') + '.json')
const hermeticRun = spawnSync(process.execPath, [probePath, '--out', hermeticOut], {
  cwd: PROJECT, encoding: 'utf8', timeout: 1200000, maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, HERMETIC_PROJECT: PROJECT, R30_MARKER: join(PROJECT, '.tmp', 'r116-mounted', 'probe-marker.' + (MUTANT || 'baseline') + '.jsonl') },
})
let payload = null
try { payload = existsSync(hermeticOut) ? JSON.parse(readFileSync(hermeticOut, 'utf8')) : null } catch { payload = null }
const cases = payload?.cases ?? []
const byId = (id) => cases.find((row) => row.id === id)
const eventsOf = (row) => row?.observed?.events ?? []
const sawEvent = (row, name) => eventsOf(row).some((event) => event.event === name)
const rolesRefused = (row) => ['sessions.recent.threw', 'tools.add.threw', 'settings.define.threw'].every((name) => sawEvent(row, name))
const allTrue = (row) => { const value = row?.observed?.available; return value !== null && value !== undefined && value.sessions === true && value.tools === true && value.settings === true }
const allFalse = (row) => { const value = row?.observed?.available; return value !== null && value !== undefined && value.sessions === false && value.tools === false && value.settings === false }
const typedRefusals = (row) => eventsOf(row).filter((event) => ['sessions.recent', 'tools.add', 'settings.define'].some((role) => event.event === role + '.threw')
  && event.name === 'UnsupportedError'
  && typeof event.capability === 'string' && event.capability.length > 0
  && typeof event.reason === 'string' && event.reason.length > 0)
const JUDGED = ['services-present', 'sdk-minimal', 'services-absent']
const everyCase = (predicate) => JUDGED.every((id) => { const row = byId(id); return row !== undefined && predicate(row) })
// R116 findings that decide what may be asserted here (both measured, not assumed):
//   1. production pays the whole work.
//   2. an unregistered verify-*.mjs refuses to let the suite start.
//   3. production must leave the repo clean and gate-list-compliant.
// The reading below is the one the instrument can actually take in these three compositions: all three
// roles REFUSE, with the loader's typed error. Measured on 2026-10-10 the same way it was measured in
// the R30-era payload (.tmp/r30/compat-simple.json, 2026-10-09): dsh-base and dsh-sdk-minimal do not
// mount the sessions/tools/settings services, so "services-present" is a label, not a fact. The
// roles-work reading lives in the mounted half above (R2-R5), where the live profile's composition
// really does mount them.
console.log('  NOTE  hermetic: dsh-base and dsh-sdk-minimal mount none of sessions/tools/settings in this kernel; the three roles are measured in the mounted composition (R2-R5) and the refusal path here (H1-H2)')
held('H1', everyCase((row) => allFalse(row) && rolesRefused(row) && typedRefusals(row).length === 3), 'hermetic: every composition refuses all three roles with a typed error: ' + JSON.stringify(JUDGED.map((id) => ({ id, available: byId(id)?.observed?.available ?? null, typed: typedRefusals(byId(id)).map((event) => event.event + ':' + event.name + '/' + event.capability) }))))
held('H2', everyCase((row) => ['store', 'tools', 'settings'].every((capability) => eventsOf(row).some((event) => event.capability === capability))), 'hermetic: the same three capabilities are named absent in every composition: ' + JSON.stringify(JUDGED.map((id) => eventsOf(byId(id)).filter((event) => event.capability !== undefined).map((event) => event.capability).sort())))
held('H3', probeStatusIsZero(hermeticRun) && cases.length === JUDGED.length && everyCase((row) => row.measured === true && row.observed.settled === true && row.observed.consumerDone === true && (row.observed.driverErrors ?? []).length === 0), 'instrument credible: exit=' + String(hermeticRun.status) + ' cases=' + String(cases.length) + ' measured=' + JSON.stringify(cases.map((row) => row.measured)) + ' settled=' + JSON.stringify(cases.map((row) => row.observed?.settled)))

const DECLARED = {
  'actor-old-default': ['R3'],
  // Measured: a world without the plugin also turns the three row readings into ABSENT lines (the move
  // is real - the union comparison counts a reading that disappeared), and a Promise from recent() does
  // the same. Declared to the measured reach, never the other way round.
  'no-compat': ['R2', 'R3', 'R4', 'R5', 'A1', 'A2', 'A3'],
  'actor-missing': ['R2', 'R3', 'R4', 'R5', 'A1', 'A2', 'A3'],
  'drop-await-on-recent': ['R4', 'R6', 'A1', 'A2', 'A3'],
  'control-read-removed': ['R7'],
  // Measured: without the kernel-side seed the store is empty again, so the three row readings turn into
  // ABSENT lines (the union comparison counts that as a move) while R4 still holds (an empty array is a
  // valid answer for an empty store).
  'no-seed-sessions': ['A1', 'A2', 'A3'],
  'post-seed-session-unrecorded': ['A1'],
  // Measured, not assumed: dropping a case out of the three also breaks the capabilities reading (H2)
  // and the credibility reading (H3, cases.length), and a role that refuses with a plain Error also
  // breaks H2 because that composition no longer names all three capabilities. My first declarations were
  // narrower than the mutants' real reach; widened to the measurement, never the other way round.
  'hermetic-drops-a-case': ['H1', 'H2', 'H3'],
  'hermetic-breaks-a-role': ['H1', 'H2'],
  'hermetic-driver-fails': ['H1', 'H2', 'H3'],
}
if (argv.includes('--self-attack')) {
  const base = {}
  for (const row of readings) base[row.id] = row.ok
  checkArtifact('before spawning the mutant worlds')
  let bad = 0
  const moved = new Set()
  for (const name of Object.keys(DECLARED)) {
    const child = spawnSync(process.execPath, [resolve(process.env.MOUNTED_SELF ?? process.argv[1]), '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 1800000,
      env: { ...process.env, MOUNTED_MUTANT: name, MOUNTED_PROJECT: PROJECT, MOUNTED_SELF: process.env.MOUNTED_SELF ?? process.argv[1] },
    })
    const line = ((child.stdout ?? '') + (child.stderr ?? '')).split(/\r?\n/).filter((row) => row.startsWith('[')).pop()
    if (line === undefined) { bad += 1; continue }
    const after = {}
    for (const row of JSON.parse(line)) after[row.id] = row.ok
    // A reading that a mutant turns into an ABSENT line disappears from the child's array, and that is a
    // move too: compare over the union of ids, never only over the child's keys.
    const flipped = [...new Set([...Object.keys(base), ...Object.keys(after)])].filter((id) => base[id] !== after[id]).sort()
    for (const id of flipped) moved.add(id)
    // Compare as SETS: the declared list is a set of readings, and a matching set must not depend on
    // the order the author happened to write it in (this gate failed its own self-attack once for exactly
    // that reason while both sides held the same six ids).
    const ok = JSON.stringify(flipped) === JSON.stringify([...DECLARED[name]].sort())
    if (!ok) bad += 1
    console.log((ok ? '  ok    ' : '  FAIL  ') + name + '  flipped=' + (flipped.join(',') || '(none)') + ' declared=' + DECLARED[name].join(','))
  }
  checkArtifact('after every mutant world')
  const uncovered = Object.keys(base).filter((id) => moved.has(id) === false && id !== 'R1' && id !== 'R8')
  console.log('coverage: ' + String(moved.size) + ' of ' + String(Object.keys(base).length) + ' moved; uncovered=' + (uncovered.join(',') || '(none)'))
  console.log('absent readings (declared, not measured): ' + String(absent.length) + (absent.length > 0 ? ' [' + absent.join(',') + ']' : ''))
  console.log('declared-set mismatches: ' + String(bad))
  process.exit(bad === 0 && uncovered.length === 0 ? 0 : 1)
}
const failed = readings.filter((row) => row.ok === false).length
if (argv.includes('--json')) console.log(JSON.stringify(readings))
else {
  for (const row of readings) console.log('  ' + (row.ok ? 'ok    ' : 'FAIL  ') + row.id + '  |  ' + row.detail)
  console.log(String(readings.length) + ' readings, ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed; absent=' + String(absent.length))
}
process.exit(failed === 0 ? 0 : 1)
