#!/usr/bin/env node
/**
 * R122 gate #89: the ops tools, measured in a world whose runtime IS provisioned.
 *
 * Gate #88 pins the other side of the same boundary: an unprovisioned world publishes no ops tools at all.
 * This gate is the positive half - R121 measured by hand that three file tools really execute once fastctx
 * is provisioned, and this is that reading turned into something a round can be accepted on.
 *
 * The claim under test is the one T54 exists for: the tool answers the same question in far fewer bytes
 * than an agent that had to read the files would spend. The baseline is named for what it is - the bytes of
 * the files the query touched, summed in this process - because this composition composes no host grep/glob
 * to compare a tool against, and BYTES ARE NOT TOKENS: this gate measures a proxy and says so.
 *
 * Prerequisite: the pinned payloads extracted at DSH_OPS_PAYLOAD (default .tmp/dsh-ops-payload), which
 * scripts/prepare-dsh-ops-payload.mjs builds from the tarballs the pin records. Missing it is a SKIP with
 * the reason and exit 3 - the repository's own convention for "this gate did not measure anything", so the
 * suite reports SKIPPED rather than a green it did not earn.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(process.env.R122_PROJECT ?? join(HERE, '..'))
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')
const WORLD_PS = join(PROJECT, 'scripts', 'fixtures', 't52-world.ps1')
const BOOT = join(PROJECT, 'scripts', 'fixtures', 'ops-boot.mjs')
const VENDOR = join(PROJECT, 'vendor', 'dsh-ops')
const PAYLOAD = resolve(process.env.DSH_OPS_PAYLOAD ?? join(PROJECT, '.tmp', 'dsh-ops-payload'))
const WORLD_ROOT = resolve(process.env.R122_WORLD_ROOT ?? join(PROJECT, '.tmp', 'r122-gate', 'world'))
const MARKER = resolve(process.env.R122_MARKER ?? join(PROJECT, '.tmp', 'r122-gate', 'marker.jsonl'))
const HOME = join(WORLD_ROOT, 'home')
const PROFILE_DIR = join(HOME, 'profiles', 'web')
const MANIFEST = join(PROFILE_DIR, 'package.json')
const NODES = join(PROFILE_DIR, 'node_modules')
const MUTANT = process.env.R122_MUTANT ?? ''
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

const FASTATX = join(PAYLOAD, 'fastctx', 'bin', 'fastctx.exe')
if (!existsSync(FASTATX)) {
  console.error('SKIP: the dsh-ops payload is not extracted at ' + PAYLOAD + ' (expected ' + FASTATX + '); run: node scripts/prepare-dsh-ops-payload.mjs')
  process.exit(3)
}
for (const required of [WORLD_PS, BOOT, VENDOR]) if (!existsSync(required)) { console.error('dsh-ops-tools: missing prerequisite ' + required); process.exit(2) }

const events = () => existsSync(MARKER) ? readFileSync(MARKER, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }) : []
const one = (list, name) => list.find((row) => row.event === name)
const all = (list, name) => list.filter((row) => row.event === name)
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const readings = []
/** Readings whose observation object is not in this world: named with their reason and counted, never a pass. */
const ABSENT = []
const held = (id, ok, detail) => readings.push({ id, ok: ok === true, detail: String(detail) })

// NOTE (R122): the first design provisioned the runtime by putting a junction at <DSH_HOME>/dsh-ops inside
// the world. The world script starts by deleting and rebuilding that tree, and Remove-Item -Recurse over a
// junction walked INTO the payload and tried to delete fastctx.exe (it failed with access denied, so the
// payload survived - luck, not design). The plugin has a seam instead: DSH_OPS_FASTCTX_BIN names the
// executable and a configured path is authoritative (lib/binary.js:23,328), which this gate now uses. The
// world is never mutated beyond its manifest, and nothing is copied.
// R182-H: Windows PowerShell 5.1 refuses to load an unsigned .ps1 stored on a non-system volume (H: here)
// unless the process-scope policy allows it -- and whether it does is decided by whoever launched the gate, not
// by the gate. Measured: the same file runs from C: and is refused from H:, and -ExecutionPolicy Bypass
// (which scripts/verify-shell-radius.mjs:1138 already passes) makes the refusal go away. This changes the HOST
// policy for the child only; the world builder and every reading stay exactly as they were.
const world = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORLD_PS], { cwd: PROJECT, encoding: 'utf8', timeout: 300000, env: { ...process.env, T52_WORLD_ROOT: WORLD_ROOT, T52_PROJECT: PROJECT } })
held('P1', world.status === 0 && /world_ready=/.test(String(world.stdout ?? '')), 'mirrored world built at ' + WORLD_ROOT + ': exit=' + String(world.status))

// Two variables are set on purpose and both are the deployment's own shape: the bundle ROW and the
// dependency entry (the loader resolves bundles from the profile's dependencies), plus a junction to the
// VENDORED copy - never the live tree.
const manifest = readJson(MANIFEST)
let manifestOk = false
if (manifest !== null) {
  const bundles = (manifest.dsh?.profile?.bundles ?? []).filter((name) => name !== 'dsh-ops')
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles: [...bundles, 'dsh-ops'] } }
  manifest.dependencies = { ...(manifest.dependencies ?? {}), 'dsh-ops': 'link:' + VENDOR.replaceAll('\\', '/') }
  writeFileSync(MANIFEST, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
  manifestOk = true
}
const linkAt = join(NODES, 'dsh-ops')
spawnSync('powershell', ['-NoProfile', '-Command', 'Remove-Item -Recurse -Force "' + linkAt + '"; New-Item -ItemType Junction -Path "' + linkAt + '" -Target "' + VENDOR + '" | Out-Null'], { encoding: 'utf8' })
// R125: the runtime is PROVISIONED into the world the way the product's own `provision` command does -
// <DSH_HOME>/dsh-ops/bin for fastctx, <DSH_HOME>/dsh-ops/shells/<kind>/<version>/bin for the shells
// (lib/binary.js:119-121, lib/shells.js:386-405, pins at lib/shells.js:133-170) - so these readings no
// longer ride on the plugin's DSH_OPS_FASTCTX_BIN seam. Three HARD LINKS: same volume, instant, and a
// hard link is an ordinary file, so the world script's recursive delete can never walk into the payload
// (R122 paid for that lesson with a junction that Remove-Item -Recurse tried to delete through).
const SHELL_PINS = { pwsh: { version: '7.6.6', file: 'pwsh.exe' }, bash: { version: '2.56.0.2', file: 'bash.exe' } }
const linkInto = (target, link) => {
  if (!existsSync(target)) return false
  mkdirSync(dirname(link), { recursive: true })
  if (!existsSync(link)) spawnSync('cmd', ['/c', 'mklink', '/H', link, target], { encoding: 'utf8' })
  return existsSync(link)
}
const MANAGED = join(HOME, 'dsh-ops')
const provisionOptions = MUTANT === 'world-without-payload' || MUTANT === 'shells-store-removed'
const provision = {
  fastctx: provisionOptions && MUTANT === 'world-without-payload' ? false : linkInto(FASTATX, join(MANAGED, 'bin', 'fastctx.exe')),
  bash: provisionOptions && MUTANT === 'shells-store-removed' ? false : linkInto(join(PAYLOAD, 'bash', 'bin', 'bash.exe'), join(MANAGED, 'shells', 'bash', SHELL_PINS.bash.version, 'bin', SHELL_PINS.bash.file)),
  pwsh: provisionOptions && MUTANT === 'shells-store-removed' ? false : linkInto(join(PAYLOAD, 'pwsh', 'bin', 'pwsh.exe'), join(MANAGED, 'shells', 'pwsh', SHELL_PINS.pwsh.version, 'bin', SHELL_PINS.pwsh.file)),
}
// R123: the product's own token accounting (fixed density, its own header says so). Passed to the driver as
// a module URL; the reading it produces is the number the product's token meter would show, not a model's.
const TOKEN_METER = pathToFileURL(join(KERNEL, 'packages', 'llm', 'token-meter', 'src', 'estimate.ts')).href
const fastctxPids = () => {
  const out = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-Process fastctx -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ","'], { encoding: 'utf8' })
  return String(out.stdout ?? '').trim().split(',').filter((id) => id !== '')
}
const pidsBefore = fastctxPids()
let bootPath = BOOT
if (MUTANT.startsWith('driver-')) {
  const patch = {
    'driver-reports-zero-baseline': { from: 'bytes += Buffer.byteLength(text)', to: 'bytes += 0' },
    'driver-drops-the-pattern': { from: "args: { pattern: '**/*.md', path: docs, limit: 50 }", to: 'args: { path: docs, limit: 50 }' },
    'driver-records-wrong-schema': { from: 'note(\'ops.schema\', { tool: name, parameters:', to: 'note(\'ops.schema\', { tool: name, parameters: {} ??' },
    'driver-reports-zero-token-baseline': { from: 'if (priceContent !== null) tokens += priceContent([{ type: \'text\', text }])', to: 'tokens += 0' },
    'driver-error-injected': { from: "note('consumer-done')", to: "note('driver-error', { message: 'injected by the driver-error-injected mutant' }); note('consumer-done')" },
    'driver-no-dispose': { from: 'await ctx.fiber.dispose()', to: '/* mutant: the composition is never disposed */' },
    'driver-reports-no-ladder': { from: "note('ops.copies', { binary, shells, dshHome: process.env.DSH_HOME ?? null })", to: "note('ops.copies', { binary, shells: null, dshHome: process.env.DSH_HOME ?? null })" },
  }[MUTANT]
  const text = readFileSync(BOOT, 'utf8')
  const next = patch === undefined ? text : text.replace(patch.from, patch.to)
  if (next === text) { console.error('dsh-ops-tools: mutant ' + MUTANT + ' changed nothing in the driver'); process.exit(2) }
  const dir = join(PROJECT, '.tmp', 'r122-gate', 'patched')
  mkdirSync(dir, { recursive: true })
  bootPath = join(dir, 'ops-boot.' + MUTANT + '.mjs')
  writeFileSync(bootPath, next, 'utf8')
}
// The comparison home for the paired shell reading: an empty directory, so the only difference between the
// two resolver calls is whether <DSH_HOME>/dsh-ops/shells holds a provisioned copy.
const EMPTY_HOME = join(dirname(MARKER), 'empty-home')
rmSync(EMPTY_HOME, { recursive: true, force: true })
mkdirSync(EMPTY_HOME, { recursive: true })
rmSync(MARKER, { force: true })
const run = spawnSync(process.execPath, ['--import', 'tsx/esm', bootPath], {
  cwd: KERNEL, encoding: 'utf8', timeout: 900000, maxBuffer: 32 * 1024 * 1024,
  env: {
    ...process.env, DSH_HOME: HOME, T54_MARKER: MARKER, T54_PROFILE: 'web', T54_TOKEN_METER: TOKEN_METER,
    T54_BINARY_MODULE: pathToFileURL(join(VENDOR, 'lib', 'binary.js')).href, T54_SHELLS_MODULE: pathToFileURL(join(VENDOR, 'lib', 'shells.js')).href,
    T54_EMPTY_HOME: join(dirname(MARKER), 'empty-home'),
    T54_APP_BOOT: pathToFileURL(join(KERNEL, 'packages', 'boot', 'app-boot', 'src', 'index.ts')).href,
    T54_PROFILE_BOOT: pathToFileURL(join(KERNEL, 'apps', 'cli', 'src', 'profile-boot.ts')).href,
  },
})
const seen = events()
held('P2', manifestOk && existsSync(linkAt) && existsSync(join(VENDOR, 'package.json')), 'the world carries the row, the dependency and the vendored junction into a real package: manifest=' + String(manifestOk) + ' junction=' + String(existsSync(linkAt)) + ' payload=' + JSON.stringify(provision))

const result = (call) => all(seen, 'ops.exec.result').find((row) => row.call === call)
const saving = (call) => {
  const row = result(call)
  const ok = row !== undefined && row.isError === false && typeof row.contentBytes === 'number' && row.contentBytes > 0
    && typeof row.baselineBytes === 'number' && row.baselineBytes > row.contentBytes
  return { ok, detail: call + ': isError=' + String(row?.isError) + ' contentBytes=' + String(row?.contentBytes) + ' baselineBytes=' + String(row?.baselineBytes) + ' files=' + String(row?.baselineFiles) + ' ratio=' + String(row?.ratio) + ' preview=' + String(row?.contentPreview ?? '').slice(0, 90) }
}
const glob = saving('glob')
held('T1', glob.ok, glob.detail)
const grep = saving('grep')
held('T2', grep.ok, grep.detail)
const inspect = saving('inspect')
held('T3', inspect.ok, inspect.detail)

// T6: the same three answers priced by the PRODUCT's own estimator. This is the closest thing to the claim
// T54 exists for that this repository can measure by itself; the estimator is a fixed-density heuristic
// (chars/4 + per-block overhead) and the baseline is still the named model of "an agent reading them all".
const priced = (call) => {
  const row = result(call)
  const ok = row !== undefined && typeof row.tokensTool === 'number' && row.tokensTool > 0 && typeof row.tokensBaseline === 'number' && row.tokensBaseline > row.tokensTool
  return { ok, detail: call + ': tokensTool=' + String(row?.tokensTool) + ' tokensBaseline=' + String(row?.tokensBaseline) + ' tokenRatio=' + String(row?.tokenRatio) }
}
const pricedRows = ['glob', 'grep', 'inspect'].map(priced)
held('T6', pricedRows.every((row) => row.ok), 'the product estimator prices the ops answers below reading what they replaced: ' + pricedRows.map((row) => row.detail).join(' | '))

// T4 pins the interface the tools declare about themselves, read from the live registry: the parameter
// surface T54 depends on staying where it is (R121 read it out of the tools, not out of the README).
const schema = (tool) => one(all(seen, 'ops.schema').filter((row) => row.tool === tool), 'ops.schema')
const params = (tool) => (schema(tool)?.parameters ?? {})
const interfaceOk = ['ops_glob', 'ops_grep', 'ops_replace'].every((tool) => (params(tool).required ?? []).includes('pattern'))
  && Object.keys(params('ops_inspect_local_file').properties ?? {}).includes('file_path')
held('T4', interfaceOk, 'the tools declare the surface R121 read: glob/grep/replace require pattern=' + String((params('ops_glob').required ?? []).includes('pattern') && (params('ops_grep').required ?? []).includes('pattern')) + ' inspect has file_path=' + String(Object.keys(params('ops_inspect_local_file').properties ?? {}).includes('file_path')))

const thenables = seen.filter((row) => row.isThenable === true)
const driverErrors = all(seen, 'driver-error')
// No `MUTANT === ...` in an assertion: the reading states the plain truth (a credible run logs no driver
// error), and the mutant that injects one is supposed to make THIS line false. R122 wrote the coupled
// version first and the mutant moved nothing - the third time that anti-pattern has cost this project a run.
held('T5', seen.length > 0 && thenables.length === 0 && one(seen, 'consumer-done') !== undefined && driverErrors.length === 0,
  'the readings are credible: events=' + String(seen.length) + ' thenables=' + JSON.stringify(thenables.map((row) => row.event)) + ' driverErrors=' + JSON.stringify(driverErrors.map((row) => row.message)) + ' boot=' + String(run.status))
// T7 (R124): the attribution R123 never measured. The residual process is identified by pid, parent pid
// and command line instead of by its image name, and the reading is paired: the plugin's OWN server
// (args 'serve --enable-shell', a child of this process) exists at settle and is GONE after disposal -
// so the kill path in the vendored lib/handshake.js:242-251 really runs - while a 'runtime-host' process
// that this process never started is already there at settle. The string 'runtime-host' appears nowhere in
// the plugin's JS (measured in R124), so the residual belongs to the payload binary, not to the plugin's
// lifecycle. Both earlier explanations of R123's leak - "the disposer is not awaited" and "shared:true
// blocks close()" - are refuted by this pairing, which is why the attribution is a reading now.
const treeOf = (event) => (one(all(seen, event), event)?.rows ?? [])
const self = one(all(seen, 'ops.tree.settled'), 'ops.tree.settled')?.self
const serving = (rows) => rows.filter((row) => row.includes('serve --enable-shell'))
const hosting = (rows) => rows.filter((row) => row.includes('runtime-host'))
const settledTree = treeOf('ops.tree.settled')
const disposedTree = treeOf('ops.tree.disposed')
// R182-H: the reading is split by its own observation object. The PAIRED leg is about the product under
// test and is gated: the plugin's own server is in the tree at settle, and it is gone after disposal (that
// is the claim 'the kill path runs', and driver-no-dispose is the mutant that moves it). The ATTRIBUTION
// leg needs a runtime-host that the PAYLOAD launches and this process never started; measured on
// 2026-10-11 with R124's own payload-only probe, the same binary no longer launches one at all (before:
// two rows including a surviving runtime-host; now: one row, gone with its server), so in this world there
// is no residue to attribute. That leg is therefore NAMED ABSENT rather than failed, which is the rule G2
// below already states in its own words: a gate that reddened when upstream stopped launching its host
// would be a gate nobody could keep. When a host IS present, the attribution is still required.
const hostRows = hosting(settledTree)
const selfServed = settledTree.length > 0 && serving(settledTree).some((row) => row.split('|')[1] === String(self))
const serverGoneAfterDisposal = serving(disposedTree).length === 0
const attributedToPayload = hostRows.some((row) => row.split('|')[1] !== String(self))
if (hostRows.length === 0) {
  ABSENT.push('T7-attribution: the payload launched no runtime-host in this world (settled tree: ' + JSON.stringify(settledTree) + '), so no residue exists to attribute to it; the paired leg below is the reading this world can take')
}
// Vacuous only while the payload launches no host at all; whenever one is in the tree the attribution is required.
const attributionHolds = hostRows.length === 0 || attributedToPayload
held('T7', selfServed && serverGoneAfterDisposal && attributionHolds, 'the plugin\'s own server exists at settle and is gone after disposal: self=' + String(self)
  + ' settled=' + JSON.stringify(settledTree)
  + ' disposed=' + JSON.stringify(disposedTree)
  + ' afterGrace=' + JSON.stringify(treeOf('ops.tree.after-grace'))
  + ' attribution=' + (hostRows.length === 0 ? 'NAMED ABSENT (the payload launched no runtime-host)' : JSON.stringify(hostRows)))

// S1/S2 (R125): which copies this deployment would actually run, read from the plugin's own resolvers.
// S1 is the runtime: with the seam retired (T54_BINARY_MODULE's env var is NOT set by this gate, measured
// as seamSet=false) the resolver must name the provisioned managed directory - and T1..T3 then prove that
// copy is the one that answered. S2 is the shell ladder, paired inside ONE boot: the same resolver, two
// environments whose only difference is DSH_HOME, so 'provisioned' versus whatever the machine happens to
// have (this machine has Git's bash on PATH - the fallback is printed, not assumed) is one variable.
const copies = one(seen, 'ops.copies') ?? {}
const seamRow = one(seen, 'ops.copies.seam') ?? {}
const binaryRow = copies.binary ?? {}
const ladder = copies.shells ?? {}
const provisionedRungs = ladder.bash?.source === 'provisioned' && ladder.pwsh?.source === 'provisioned'
const withoutStore = ladder.bashWithoutStore?.source !== 'provisioned' && ladder.pwshWithoutStore?.source !== 'provisioned'
const copiesOk = seamRow.set === false && binaryRow.source === 'managed runtime' && provisionedRungs && withoutStore
held('S1', copiesOk, 'the runtime and both shells come from the provisioned store, not from a seam: seamSet=' + String(seamRow.set) + ' binary=' + JSON.stringify(binaryRow) + ' bash=' + JSON.stringify(ladder.bash) + ' pwsh=' + JSON.stringify(ladder.pwsh) + ' withoutStore(bash=' + JSON.stringify(ladder.bashWithoutStore) + ' pwsh=' + JSON.stringify(ladder.pwshWithoutStore) + ') home=' + String(ladder.unprovisionedHome))

// S2: the shell face is ABSENT in this world and is named rather than reported as a pass. lib/session-shells.js
// publishes ops_bash per AGENT and only for a danger-full-access session; this boot composes no agent, so
// there is nothing to publish to. Naming it is the difference between 'not reachable here' and 'works'.
const agents = one(seen, 'agents.inventory') ?? {}
if (agents.count === 0 || agents.count === null) {
  ABSENT.push('ops_bash: the world composes no agent (agents.inventory.count=' + String(agents.count) + '), and the bash tool is published per agent for danger-full-access sessions only (lib/session-shells.js:5-50)')
}

// G2 (R123, corrected in R124): what the machine is left holding. R123 reported "the boot leaves a fastctx
// server alive" and read it as the plugin outliving its own disposal; T7 measures the opposite - the
// plugin's server is gone, and what survives (and holds the binary open) is the payload's own
// 'runtime-host'. Either way the guard asserts the only thing a gate can own - leave the machine as you
// found it - and the count is printed for the record rather than asserted, because a gate that reddened
// when upstream stopped launching its host would be a gate nobody could keep.
const pidsAfter = fastctxPids()
const leaked = pidsAfter.filter((id) => pidsBefore.includes(id) === false)
if (leaked.length > 0) {
  spawnSync('powershell', ['-NoProfile', '-Command', leaked.map((id) => 'Stop-Process -Id ' + id + ' -Force -ErrorAction SilentlyContinue').join('; ')], { encoding: 'utf8' })
}
const pidsFinal = fastctxPids()
held('G2', pidsFinal.every((id) => pidsBefore.includes(id)), 'the gate leaves the machine as it found it: before=' + JSON.stringify(pidsBefore) + ' after=' + JSON.stringify(pidsAfter) + ' theBootLeaked=' + String(leaked.length) + ' reaped=' + JSON.stringify(leaked) + ' remaining=' + JSON.stringify(pidsFinal))

const dirtyLines = statusLines()
const trackedWrites = dirtyLines.filter((line) => line.startsWith('??') === false)
// R127: compared before-against-after, not against HEAD - a round may legitimately ship plugin changes,
// and this round did; the old shape went red on work that was not damage.
held('G1', JSON.stringify(dirtyLines) === JSON.stringify(statusAtStart), 'the product was read, never written: trackedWrites=' + JSON.stringify(trackedWrites) + ' before=' + JSON.stringify(statusAtStart) + ' after=' + JSON.stringify(dirtyLines) + ' untracked=' + JSON.stringify(dirtyLines.filter((line) => line.startsWith('??'))))

const DECLARED = {
  // Measured: with no payload the tools never publish, so no schema is recorded either and T4 moves too.
  // Measured twice now: with no payload the tools never publish, so no schema and no token price exist
  // either - T4 and T6 move with T1..T3. Declarations are hypotheses; measurement corrects them, always in
  // the direction of the mutant being stronger than the author thought (fourth time in this project).
  // Fifth time (R124): a payload that cannot start also removes the plugin's OWN server, so T7's paired
  // premise ("the observation object exists") fails as well - widened by measurement, again upward.
  'world-without-payload': ['T1', 'T2', 'T3', 'T4', 'T6', 'T7', 'S1'],
  // R124: without disposal the plugin's server never gets killed, so the attribution reading - which is
  // exactly the claim "the kill path runs" - must flip.
  'driver-no-dispose': ['T7'],
  // R125 hypotheses, measured below: no provisioned fastctx removes the runtime the resolvers name (S1) and
  // the tools it publishes (T1..T4, T6, T7), while the world itself is still built (P2 no longer rides on the
  // binary - it used to). No provisioned shells moves the ladder's own answer (S1) and nothing else.
  'shells-store-removed': ['S1'],
  'driver-reports-no-ladder': ['S1'],
  'driver-reports-zero-baseline': ['T1', 'T2', 'T3'],
  'driver-drops-the-pattern': ['T1', 'T6'],
  'driver-records-wrong-schema': ['T4'],
  'driver-error-injected': ['T5'],
  'driver-reports-zero-token-baseline': ['T6'],
}
if (argv.includes('--self-attack')) {
  const base = {}
  for (const row of readings) base[row.id] = row.ok
  let bad = 0
  const moved = new Set()
  for (const name of Object.keys(DECLARED)) {
    const child = spawnSync(process.execPath, [resolve(process.env.R122_SELF ?? process.argv[1]), '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 1800000,
      env: { ...process.env, R122_MUTANT: name, R122_PROJECT: PROJECT, R122_SELF: process.env.R122_SELF ?? process.argv[1] },
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
  // P1/P2 are preconditions and G1/G2 are guards: none of them is a mutant target, and a mutant that moved
  // one would have to damage the product or the machine rather than the world.
  const GUARDS = ['P1', 'P2', 'G1', 'G2']
  const uncovered = Object.keys(base).filter((id) => moved.has(id) === false && GUARDS.includes(id) === false)
  console.log('coverage: ' + String(moved.size) + ' of ' + String(Object.keys(base).length) + ' moved; uncovered=' + (uncovered.join(',') || '(none)'))
  console.log('declared-set mismatches: ' + String(bad))
  process.exit(bad === 0 && uncovered.length === 0 ? 0 : 1)
}
const failed = readings.filter((row) => row.ok === false).length
if (argv.includes('--json')) console.log(JSON.stringify(readings))
else {
  for (const row of readings) console.log('  ' + (row.ok ? 'ok    ' : 'FAIL  ') + row.id + '  |  ' + row.detail)
  // Absent readings are named, never counted as passes (the repository's rule since R21: an absence must
  // first prove its observation object exists, and here the observation object - an agent - does not).
  for (const line of ABSENT) console.log('  ABSENT  ' + line)
  console.log(String(readings.length) + ' readings, ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed, ' + String(ABSENT.length) + ' absent')
}
process.exit(failed === 0 ? 0 : 1)
