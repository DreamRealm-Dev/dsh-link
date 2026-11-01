#!/usr/bin/env node
// R73 alive-control: present - a 'root-alive-control' marker event reads dshHomePath from the booted tree
/**
 * Loader boot: does the compat loader actually start inside a real profile?
 *
 * R21 measured the MOUNT stage (which rows mount, what config they receive) and the table gates
 * measure the table against a live surface. Neither answers the row-level question this round
 * asks: mount the repository plugin itself as a real row of a throwaway profile, boot it with
 * runProfile() (apps/cli/src/profile-boot.ts:244), and record what the loader judged.
 *
 * Instrument. Every case gets a fresh mkdtemp home and a profile initialized from a shipped
 * template. The patch file is rewritten so its inserts name (a) the repository plugin, exactly as
 * the plugin's own shipped cordis.patch.yml names it, (b) a local calibration module that must
 * mount, or (c) a module that does not exist. A driver written beside the throwaway home runs
 * inside the kernel's own module graph, boots the profile, then reads the live context directly:
 * ctx.reflect.get('link'), the loader report, and one lookup per capability. Its observation is a
 * JSON file, so the finding is a recorded reading rather than an assertion about one.
 *
 * Calibration is not optional. Without the calibration row, "the loader was refused" and "the
 * boot never reached the mount stage" are the same observation, and only one of them is a finding.
 * A case whose calibration row is missing is reported as harness-error, never as a refusal.
 *
 * Two falsifiable negative constructs:
 *   missing-module  a row naming a module that does not exist must fail loud.
 *   fake-table      a synthetic section registered under its own identity, whose tools row names a
 *                   service this kernel does not have, must produce a refusal. Its CONTROL is the
 *                   same synthetic section with no mutation: if the control refuses too, the
 *                   refusal was caused by the injection and not by the mutation, and the case fails.
 *
 * Paths come from THIS FILE's location (R21's artifact was clobbered once by a cwd-derived path).
 * The live shell and the live home are never read or written: DSH_HOME is the throwaway home.
 *
 * Usage (kernel checkout as cwd, like webworker-packer does):
 *   cd <kernel> && node --import tsx/esm <path>/probe-loader-boot.mjs [--keep] [--cases a,b]
 *                                              [--timeout 180000] [--mode minimal|template] [--out FILE]
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const option = (name, fallback) => {
  const at = process.argv.indexOf('--' + name)
  return at === -1 ? fallback : process.argv[at + 1]
}
const flag = (name) => process.argv.includes('--' + name)

const HERE = dirname(fileURLToPath(import.meta.url))
/** The dsh-link repository root, one level above scripts/. */
const REPO = resolve(HERE, '..')
const KERNEL_FROM_REPO = join(REPO, 'core', 'deepseek-harness')
const KERNEL = resolve(
  option('kernel', process.env.DSH_LINK_KERNEL
    ?? (existsSync(join(KERNEL_FROM_REPO, 'apps', 'cli', 'src', 'profile-boot.ts')) ? KERNEL_FROM_REPO : process.cwd())),
)
const OUT = resolve(option('out', join(REPO, 'compat', 'adaptation', 'loader-boot.json')))
const PROFILE = 'r31probe'
const BOOT_TIMEOUT = Number(option('timeout', '180000'))
const KEEP = flag('keep')
const ONLY = option('cases', null)

const PROFILE_BOOT = pathToFileURL(join(KERNEL, 'apps/cli/src/profile-boot.ts')).href
const APP_BOOT = pathToFileURL(join(KERNEL, 'packages/boot/app-boot/src/index.ts')).href
const SCHEMA = pathToFileURL(join(KERNEL, 'vendor/schemastery/src/index.ts')).href

/** The plugin under test, as the repository ships it. */
const PLUGIN_DIR = join(REPO, 'plugins', 'dsh-link-compat')
const PLUGIN_LIB = join(PLUGIN_DIR, 'lib', 'index.js')
const PLUGIN_SRC = join(PLUGIN_DIR, 'src', 'index.ts')
const PLUGIN_PATCH = join(PLUGIN_DIR, 'cordis.patch.yml')
/** The module the src build imports, and the one the driver mutates for the fake-table case. */
const COMPAT_INDEX = join(REPO, 'compat', 'index.ts')

/** The synthetic identity the fake table is registered under. */
const FAKE_KERNEL = 'dsh-v0.0.0-r31-fake'

if (!existsSync(join(KERNEL, 'apps/cli/src/profile-boot.ts'))) {
  process.stderr.write('run this with the kernel checkout as cwd; not found: ' + join(KERNEL, 'apps/cli/src/profile-boot.ts') + String.fromCharCode(10))
  process.exit(2)
}

/** SHA-256 of one file, so the reading is bound to the bytes that produced it. */
const sha256 = (file) => {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch (error) {
    return 'unreadable: ' + String(error && error.message ? error.message : error)
  }
}

/** One artifact's identity: path, bytes, digest. */
const artifact2 = (file) => {
  const digest = sha256(file)
  return { path: file.slice(REPO.length + 1), sha256: digest, bytes: digest.startsWith('unreadable') ? null : readFileSync(file).length }
}

/** The calibration module: it must mount in every case, or the case proves nothing. */
const CALIBRATION = 'calibration'
const calibrationSource = "import { appendFileSync } from 'node:fs'" + String.fromCharCode(10)
  + "export const name = 'r31-calibration'" + String.fromCharCode(10)
  + 'export function apply(ctx, config) {' + String.fromCharCode(10)
  + '  appendFileSync(process.env.R31_MARKER, JSON.stringify({ event: "apply", tag: "calibration", config: config === undefined ? null : config }) + String.fromCharCode(10))' + String.fromCharCode(10)
  + '  return () => { appendFileSync(process.env.R31_MARKER, JSON.stringify({ event: "dispose", tag: "calibration" }) + String.fromCharCode(10)) }' + String.fromCharCode(10)
  + '}' + String.fromCharCode(10)

/** Initialize a profile from the first shipped template that accepts the name. */
const initProfile = (home) => {
  const candidates = [option('template', null), 'headless', 'web', 'base'].filter(Boolean)
  const attempts = []
  for (const template of candidates) {
    const script = 'import { initializeProfileFromDefault } from ' + JSON.stringify(PROFILE_BOOT) + String.fromCharCode(10)
      + 'try {' + String.fromCharCode(10)
      + '  initializeProfileFromDefault(process.env.R31_PROFILE, ' + JSON.stringify(template) + ', process.env.DSH_HOME)' + String.fromCharCode(10)
      + "  process.stdout.write('OK')" + String.fromCharCode(10)
      + '} catch (error) {' + String.fromCharCode(10)
      + "  process.stdout.write('FAIL ' + String(error && error.message ? error.message : error))" + String.fromCharCode(10)
      + '}' + String.fromCharCode(10)
    const file = join(home, 'init.mjs')
    writeFileSync(file, script, 'utf8')
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', file], {
      cwd: KERNEL, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: home, R31_PROFILE: PROFILE },
    })
    const text = ((result.stdout ?? '') + (result.stderr ?? '')).trim()
    attempts.push({ template, text: text.slice(0, 400) })
    if (text.startsWith('OK')) return { template, attempts }
  }
  return { template: null, attempts }
}
/** The boot driver: it runs inside the kernel's own module graph and records what it reads. */
const driverSource = [
  "import { appendFileSync, writeFileSync } from 'node:fs'",
  "",
  "const NL = String.fromCharCode(10)",
  "const marker = process.env.R31_MARKER",
  "const note = (event, extra) => {",
  "  try { appendFileSync(marker, JSON.stringify({ event, ...(extra ?? {}) }) + NL) } catch (error) { /* the marker is best effort */ }",
  "}",
  "const fact = (error) => ({",
  "  name: error && error.name ? String(error.name) : null,",
  "  message: String(error && error.message ? error.message : error),",
  "  head: String(error && error.stack ? error.stack : '').split(NL).slice(0, 8),",
  "  capability: error && error.capability !== undefined ? String(error.capability) : null,",
  "  kernelVersion: error && error.kernelVersion !== undefined ? String(error.kernelVersion) : null,",
  "  reason: error && error.reason !== undefined ? String(error.reason) : null,",
  "  suggestion: error && error.suggestion !== undefined ? String(error.suggestion) : null,",
  "})",
  "const observation = { case: process.env.R31_CASE, injected: null, identity: {}, boot: null, link: null, lookups: {}, refusalViolations: null, servicesIdentity: null, servicesUnknown: null, capabilityUnknown: null, errors: [] }",
  "",
  "const main = async () => {",
  "  observation.identity = {",
  "    cwd: process.cwd(),",
  "    handedVersion: process.env.DSH_LINK_KERNEL_VERSION ?? null,",
  "    globalVersion: typeof globalThis.__DSH_VERSION__ === 'string' ? globalThis.__DSH_VERSION__ : null,",
  "    node: process.version,",
  "    argv: process.argv.slice(1),",
  "  }",
  "  if (process.env.R31_FAKE_MODE) {",
  "    const compat = await import(process.env.R31_COMPAT_URL)",
  "    const tables = compat.TABLES",
  "    const base = tables[0]",
  "    const fake = structuredClone(base)",
  "    fake.kernel = process.env.R31_FAKE_KERNEL",
  "    fake.packageVersion = process.env.R31_FAKE_KERNEL",
  "    fake.notes = 'R31 construct: a copy of the shipped section under a synthetic identity.'",
  "    fake.refused = {}",
  "    const row = fake.capabilities.tools",
  "    const target = row ? row.targets[0] : null",
  "    const realService = target ? target.service : null",
  "    if (process.env.R31_FAKE_MODE === 'unsatisfiable' && target) target.service = 'r31-absent-service'",
  "    tables.push(fake)",
  "    observation.injected = { mode: process.env.R31_FAKE_MODE, kernel: fake.kernel, tables: tables.map((entry) => entry.kernel), realTableKernel: base.kernel, toolsService: target ? target.service : null, toolsServiceBeforeMutation: realService, refusalsDropped: true, refusalRowsInShippedSection: Object.keys(base.refused).length }",
  "  }",
  "  const appBoot = await import(process.env.R31_APP_BOOT_URL)",
  "  const boot = await import(process.env.R31_PROFILE_BOOT_URL)",
  "  const facts = await import(process.env.R31_FACTS_URL)",
  "  observation.identity.installedKernel = facts.installedKernel()",
  "  observation.identity.knownKernels = facts.knownKernels()",
  "  observation.identity.tableForInstalled = facts.tableFor(facts.installedKernel() ?? '') !== undefined",
  "  note('driver-imported')",
  "  let result = null",
  "  try {",
  "    result = await boot.runProfile({ environment: appBoot.loadLayeredEnv('dsh'), profile: process.env.R31_PROFILE, patchFiles: [], args: [] })",
  "  } catch (error) {",
  "    observation.boot = { settled: false, error: fact(error) }",
  "    note('boot-threw', { message: observation.boot.error.message })",
  "  }",
  "  if (result !== null) {",
  "    observation.boot = { settled: true, error: null }",
  "    note('settled')",
  "    const ctx = result.ctx",
  "    const read = (name) => { try { return { present: true, value: ctx.reflect.get(name, false) } } catch (error) { return { present: false, error: fact(error) } } }",
  "    if (process.env.R31_SERVICES) {",
  "      const inventory = {}",
  "      for (const name of process.env.R31_SERVICES.split(',')) {",
  "        const held = read(name)",
  "        inventory[name] = held.present && held.value !== undefined && held.value !== null",
  "      }",
  "      observation.inventory = inventory",
  "    }",
  "    note('root-alive-control', { rootAlive: (() => { const held = read('dshHomePath'); return held.present && held.value !== undefined && held.value !== null })() })",
  "    const linkRead = read('link')",
  "    const linkValue = linkRead.present ? linkRead.value : undefined",
  "    const compat = linkValue && typeof linkValue === 'object' && linkValue.compat ? linkValue.compat : null",
  "    observation.link = { read: { present: linkRead.present, error: linkRead.error ?? null }, keys: linkValue && typeof linkValue === 'object' ? Object.keys(linkValue) : null, hasCompat: compat !== null }",
  "    if (compat !== null) {",
  "      observation.link.compatMembers = Object.keys(compat)",
  "      const report = typeof compat.report === 'function' ? compat.report() : null",
  "      observation.link.report = report",
  "      const probes = (process.env.R31_CAPABILITIES || 'tools,store,settings,workspace,http,shell,link').split(',')",
  "      const refused = report ? report.refused.slice() : []",
  "      const lookups = {}",
  "      const violations = []",
  "      for (const name of probes.concat(refused.filter((entry) => probes.includes(entry) === false))) {",
  "        if (lookups[name] !== undefined) continue",
  "        const entry = { has: null, silentPass: null, refusal: null, members: null, kinds: null, capabilityError: null, inReport: refused.includes(name) }",
  "        if (typeof compat.has === 'function') entry.has = compat.has(name)",
  "        if (entry.has === true) {",
  "          try {",
  "            const value = compat.capability(name)",
  "            entry.members = value && typeof value === 'object' ? Object.keys(value) : null",
  "            entry.kinds = value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map((pair) => [pair[0], typeof pair[1]])) : null",
  "          } catch (error) { entry.capabilityError = fact(error) }",
  "        } else {",
  "          try { compat.capability(name); entry.silentPass = true } catch (error) { entry.silentPass = false; entry.refusal = fact(error) }",
  "          if (entry.silentPass === true) violations.push(name + ': capability() returned instead of throwing')",
  "          if (entry.refusal !== null && (!entry.refusal.reason || !entry.refusal.suggestion)) violations.push(name + ': refusal carries an empty reason or suggestion')",
  "          if (entry.has === true) violations.push(name + ': has() true for a refused capability')",
  "        }",
  "        lookups[name] = entry",
  "      }",
  "      observation.lookups = lookups",
  "      observation.refusalViolations = violations",
  "      try {",
  "        const service = compat.services.get('tools')",
  "        const live = read('tools')",
  "        observation.servicesIdentity = { serviceRead: typeof service, livePresent: live.present && live.value !== undefined, sameObject: live.present && service === live.value }",
  "      } catch (error) { observation.servicesIdentity = { threw: true, refusal: fact(error) } }",
  "      try { compat.services.get('r31-absent-service'); observation.servicesUnknown = { threw: false } } catch (error) { observation.servicesUnknown = { threw: true, refusal: fact(error) } }",
  "      try { compat.capability('r31-absent-capability'); observation.capabilityUnknown = { threw: false } } catch (error) { observation.capabilityUnknown = { threw: true, refusal: fact(error) } }",
  "    }",
  "    try { await result.ctx.fiber.dispose(); note('disposed') } catch (error) { observation.disposeError = fact(error); note('dispose-error', { message: observation.disposeError.message }) }",
  "  }",
  "}",
  "",
  "try { await main() } catch (error) { observation.errors.push(fact(error)); note('driver-error', { message: observation.errors[0].message }) }",
  "try { writeFileSync(process.env.R31_OBSERVATION, JSON.stringify(observation, null, 2) + NL) } catch (error) { note('observation-write-failed', { message: String(error) }) }",
  "process.exit(observation.boot !== null && observation.boot.settled === false ? 4 : 0)",
].join(String.fromCharCode(10))
const NL = String.fromCharCode(10)

/** The row the plugin ships for itself, kept verbatim as the thing the package case reproduces. */
const shippedPatchText = readFileSync(PLUGIN_PATCH, 'utf8')

/** The services the table's refusal premises and capability targets name; the injected row waits for them. */
const INJECT = ['sessions', 'sessionPersistence', 'tools', 'settings', 'pluginManager', 'sandboxPolicy', 'shell', 'fs']

const CASES = [
  {
    id: 'positive-package',
    shape: 'shipped-row',
    label: '实测',
    why: 'the row the plugin ships for itself, resolved by its own package name out of the throwaway profile',
    install: 'package-junction',
    rows: [{ insert: [{ id: 'dsh-link-compat', name: 'dsh-link-compat' }] }],
    expect: 'the boot settles, the loader publishes ctx.link.compat and judges the real table on a live composition',
  },
  {
    id: 'positive-liburl',
    shape: 'entry-url',
    label: '实测',
    why: 'the built entry as the row target, so the reading is bound to the artifact the package ships',
    install: null,
    rows: [{ insert: [{ id: 'dsh-link-compat', name: pathToFileURL(PLUGIN_LIB).href }] }],
    expect: 'same reading as the package case, from the built entry instead of the package name',
  },
  {
    id: 'positive-source',
    shape: 'source-url',
    label: '实测',
    why: 'the source entry, which imports compat/index.ts as its own module so the driver can register a synthetic section in it',
    install: null,
    rows: [{ insert: [{ id: 'dsh-link-compat', name: pathToFileURL(PLUGIN_SRC).href }] }],
    expect: 'same reading as the other positives, from source',
  },
  {
    id: 'positive-injected',
    shape: 'entry-url+inject',
    label: '构造触发',
    why: 'the built entry as the row target plus an inject list naming the services the table premises on, so the loader is held until they are mounted',
    install: null,
    rows: [{ insert: [{ id: 'dsh-link-compat', name: pathToFileURL(PLUGIN_LIB).href, inject: INJECT }] }],
    expect: 'the row activates once the premised services exist and publishes ctx.link.compat with a judgement',
  },
  {
    id: 'positive-nostrict',
    shape: 'entry-url+inject+nostrict',
    label: '构造触发',
    why: 'the shipped section with the row config strict: false and the inject list, so the loader reports instead of failing the row',
    install: null,
    rows: [{ insert: [{ id: 'dsh-link-compat', name: pathToFileURL(PLUGIN_LIB).href, inject: INJECT, config: { strict: false } }] }],
    expect: 'the shipped section activates and reports its judgement, including any stale refusal, instead of failing the row',
  },
  {
    id: 'negative-missing-module',
    shape: 'absent-entry',
    label: '构造触发',
    why: 'a row naming a module that does not exist',
    install: null,
    rows: [{ insert: [{ id: 'r31-missing-module', name: './r31-missing-module.mjs' }] }],
    expect: 'the boot fails loud with the missing module named, and nothing publishes ctx.link',
  },
  {
    id: 'negative-unknown-kernel',
    shape: 'unsupported-kernel',
    label: '构造触发',
    why: 'a row asking for a kernel identity this build carries no section for (the earlier kernel the table names)',
    install: null,
    rows: [{ insert: [{ id: 'dsh-link-compat', name: pathToFileURL(PLUGIN_LIB).href, config: { kernel: 'dsh-v0.1.1-rc.2' } }] }],
    expect: 'the loader refuses, naming the compat table file to add, and nothing publishes ctx.link',
  },
  {
    id: 'negative-fake-table',
    shape: 'unsatisfiable-section',
    label: '构造触发',
    why: 'a synthetic section registered under its own identity whose tools row names a service this kernel does not have',
    install: null,
    fakeMode: 'unsatisfiable',
    rows: [{ insert: [{ id: 'dsh-link-compat', name: pathToFileURL(PLUGIN_SRC).href, inject: INJECT, config: { kernel: FAKE_KERNEL } }] }],
    expect: 'tools is refused with the absent service named while other rows still resolve: a refusal, not a silent pass',
  },
  {
    id: 'control-fake-table',
    shape: 'satisfiable-section',
    label: '构造触发',
    why: 'the same synthetic section with no mutation: the control for the case above',
    install: null,
    fakeMode: 'satisfiable',
    rows: [{ insert: [{ id: 'dsh-link-compat', name: pathToFileURL(PLUGIN_SRC).href, inject: INJECT, config: { kernel: FAKE_KERNEL } }] }],
    expect: 'the control does NOT refuse tools; if it did, the refusal above would be an artifact of the injection',
  },
]

/** Give the throwaway profile a node_modules that resolves the plugin by its shipped name. */
const stagePackage = (profileDir) => {
  const modules = join(profileDir, 'node_modules')
  const log = []
  try {
    mkdirSync(modules, { recursive: true })
    const target = join(modules, 'dsh-link-compat')
    if (existsSync(target)) log.push('already present: ' + target)
    else { symlinkSync(PLUGIN_DIR, target, 'junction'); log.push('junction ' + target + ' -> ' + PLUGIN_DIR) }
  } catch (error) {
    log.push('staging failed: ' + String(error && error.message ? error.message : error))
  }
  return log
}

const tail = (text, limit) => (text.length <= limit ? text : text.slice(text.length - limit))

/** Lines a reader needs from the boot output, instead of the whole log. */
const errorLines = (text) => text.split(/\r?\n/).filter((line) => /error|refus|unsupported|cannot find|not found|no such|patch:|stale|threw|warn/i.test(line)).slice(0, 40)

/** One case: a fresh home, a fresh profile, one boot, one observation. */
const runCase = (testCase, mode) => {
  const home = mkdtempSync(join(tmpdir(), 'r31-loader-'))
  const marker = join(home, 'markers.jsonl')
  const observationPath = join(home, 'observation.json')
  writeFileSync(marker, '', 'utf8')
  const record = {
    case: testCase.id, shape: testCase.shape, label: testCase.label, why: testCase.why, expect: testCase.expect,
    home, rowsWritten: [{ insert: [{ id: 'r31-calibration', name: './r31-calibration.mjs' }] }, ...testCase.rows],
    stageLog: [], template: null, exitCode: null, timedOut: false, elapsedMs: 0, status: 'skip', findings: [], gaps: [],
    stdoutTail: '', stderrTail: '', errorLines: [], markerEvents: [], observation: null, harnessError: false,
  }
  try {
    const initialized = initProfile(home)
    record.template = initialized.template
    record.initAttempts = initialized.attempts
    if (initialized.template === null) { record.findings.push('profile initialization failed; the case proves nothing'); record.status = 'skip'; record.harnessError = true; return record }
    const profileDir = join(home, 'profiles', PROFILE)
    const manifestPath = join(profileDir, 'package.json')
    if (mode === 'minimal') {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [] } }
      writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + NL, 'utf8')
      record.minimal = true
    }
    if (testCase.install === 'package-junction') record.stageLog = stagePackage(profileDir)
    writeFileSync(join(profileDir, 'r31-calibration.mjs'), calibrationSource, 'utf8')
    const patchText = JSON.stringify(record.rowsWritten, undefined, 2) + NL
    writeFileSync(join(profileDir, 'cordis.patch.yml'), patchText, 'utf8')
    record.patchText = patchText
    const driver = join(home, 'run.mjs')
    writeFileSync(driver, driverSource, 'utf8')
    const env = {
      ...process.env,
      DSH_HOME: home,
      R31_MARKER: marker,
      R31_OBSERVATION: observationPath,
      R31_CASE: testCase.id,
      R31_PROFILE: PROFILE,
      R31_PROFILE_BOOT_URL: PROFILE_BOOT,
      R31_APP_BOOT_URL: APP_BOOT,
      R31_FACTS_URL: pathToFileURL(COMPAT_INDEX).href,
      R31_COMPAT_URL: pathToFileURL(COMPAT_INDEX).href,
      R31_FAKE_KERNEL: FAKE_KERNEL,
      R31_SERVICES: 'tools,settings,pluginManager,sandboxPolicy,sessions,sessionPersistence,workspaceFiles,shell,webServer,store,http,agent,team,skill,telemetry,fs',
    }
    if (testCase.fakeMode) env.R31_FAKE_MODE = testCase.fakeMode
    const started = Date.now()
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', driver], {
      cwd: KERNEL, encoding: 'utf8', timeout: BOOT_TIMEOUT, maxBuffer: 64 * 1024 * 1024, env,
    })
    record.elapsedMs = Date.now() - started
    record.exitCode = result.status
    record.timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM'
    record.stderrTail = tail(result.stderr ?? '', 6000)
    record.stdoutTail = tail(result.stdout ?? '', 3000)
    record.errorLines = errorLines((result.stdout ?? '') + NL + (result.stderr ?? ''))
    const markerTextRaw = readFileSync(marker, 'utf8')
    record.markerText = tail(markerTextRaw, 4000)
    record.markerEvents = markerTextRaw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)] } catch (error) { return [{ event: 'unparseable-marker-line', line: line.slice(0, 200) }] }
    })
    if (existsSync(observationPath)) {
      try { record.observation = JSON.parse(readFileSync(observationPath, 'utf8')) } catch (error) { record.findings.push('observation file is not JSON: ' + String(error && error.message ? error.message : error)) }
    } else {
      record.findings.push('the driver wrote no observation file; its output below is the whole reading')
    }
    return record
  } finally {
    if (!KEEP) rmSync(home, { recursive: true, force: true })
  }
}

const haystackOf = (record) => [record.stdoutTail, record.stderrTail, record.markerText, record.observation === null ? '' : JSON.stringify(record.observation)].join(NL)

/** The whole reading of one run, as one flat object, so judging reads plainly. */
/** The section's row counts by disposition, plus the stale count that fails a strict load. */
const countDispositions = (report) => {
  const counts = { resolve: 0, translate: 0, refuse: 0, served: 0, withheld: 0, stale: report.staleRefusals.length }
  for (const row of report.rows) {
    if (row.disposition === 'resolve') counts.resolve += 1
    else if (row.disposition === 'translate') counts.translate += 1
    else counts.refuse += 1
  }
  counts.served = report.resolved.length
  counts.withheld = report.refused.length
  return counts
}

const readingOf = (record) => {
  const observation = record.observation ?? {}
  const boot = observation.boot ?? null
  const link = observation.link ?? null
  const report = link && link.report ? link.report : null
  const applied = record.markerEvents.some((event) => event.event === 'apply' && event.tag === 'calibration')
  return {
    calibration: applied,
    settled: boot !== null && boot.settled === true,
    bootError: boot !== null && boot.settled === false ? boot.error : null,
    linkPresent: link !== null && link.hasCompat === true,
    linkKeys: link === null ? null : link.keys,
    report,
    counts: report === null ? null : countDispositions(report),
    refused: report ? report.refused : null,
    resolved: report ? report.resolved : null,
    lookups: observation.lookups ?? null,
    refusalViolations: observation.refusalViolations ?? null,
    injected: observation.injected ?? null,
    identity: observation.identity ?? null,
    inventory: observation.inventory ?? null,
    servicesIdentity: observation.servicesIdentity ?? null,
    servicesUnknown: observation.servicesUnknown ?? null,
    capabilityUnknown: observation.capabilityUnknown ?? null,
    driverErrors: observation.errors ?? [],
  }
}

/** What each case claims, and what would make it fail. */
const judge = (testCase, record, reading, haystack) => {
  const findings = []
  const pass = (why) => { findings.push('ok: ' + why) }
  const fail = (why) => { findings.push('FAIL: ' + why) }
  if (!reading.calibration) {
    fail('the calibration row did not mount, so this case cannot tell a refusal from a boot that never got there')
    return { pass: false, harnessError: true, findings }
  }
  pass('the calibration row mounted')
  if (testCase.id.startsWith('positive-')) {
    if (/EADDRINUSE/.test(haystack)) {
      fail('the profile template could not start because a port it wants is owned by another process; the loader was never asked, so this case measures nothing')
      return { pass: false, harnessError: true, findings }
    }
    if (!reading.settled) fail('the boot did not settle: ' + JSON.stringify(reading.bootError))
    else pass('the boot settled')
    if (reading.linkPresent !== true) {
      fail('ctx.link.compat was not published')
      if (/stale refusal/i.test(haystack)) findings.push('note: the row threw at load because the section premises on services that are not mounted yet; the same run read them present after the boot settled: ' + JSON.stringify(reading.inventory))
      const staleLine = haystack.split(NL).find((line) => /stale refusal/i.test(line))
      if (staleLine !== undefined) findings.push('raw: ' + staleLine.trim().slice(0, 600))
    }
    else pass('ctx.link.compat is present in the live context')
    if (reading.report === null) fail('the loader produced no report')
    else {
      pass('the loader judged ' + reading.report.resolved.length + ' capabilities resolved, ' + reading.report.refused.length + ' refused, in ' + reading.report.resolveMs + 'ms')
      if (reading.report.staleRefusals.length !== 0) fail('the section still has a stale refusal: ' + reading.report.staleRefusals.join(', '))
      else pass('no stale refusal: every witness premise holds as read')
      if (reading.counts !== null) pass('dispositions resolve ' + reading.counts.resolve + ', translate ' + reading.counts.translate + ', refuse ' + reading.counts.refuse + '; served ' + reading.counts.served + ', withheld ' + reading.counts.withheld)
      if (reading.report.kernel !== (reading.identity ? reading.identity.installedKernel : null)) fail('report kernel ' + reading.report.kernel + ' is not the installed kernel ' + (reading.identity ? reading.identity.installedKernel : null))
      else pass('the report is keyed by the installed kernel identity ' + reading.report.kernel)
      if (reading.report.resolved.length === 0) fail('no capability resolved, so nothing was really served')
      if (reading.refusalViolations !== null && reading.refusalViolations.length > 0) fail('a refused capability did not refuse cleanly: ' + reading.refusalViolations.join('; '))
      else pass('every refused capability threw with a non-empty reason and suggestion')
    }
    return { pass: findings.every((line) => line.startsWith('FAIL:') === false), harnessError: false, findings }
  }
  if (testCase.id === 'negative-missing-module') {
    const named = /r31-missing-module\.mjs/.test(haystack)
    const loud = /ERR_MODULE_NOT_FOUND|Cannot find (module|package)|no such file|failed to import/i.test(haystack)
    if (!named) fail('the missing module is not named anywhere in the boot output')
    else pass('the boot names the module that does not exist')
    if (!loud) fail('no import failure reached the output: the row may have been skipped silently')
    else pass('the raw output reports the row as a failed import')
    if (/Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i.test(haystack)) pass('the underlying cause is shown')
    else findings.push('note: the row is reported as a failed import without the underlying cause, so the output names what failed but not why')
    if (reading.linkPresent) fail('ctx.link.compat was published although the row could not load')
    else pass('nothing published ctx.link.compat')
    return { pass: findings.every((line) => line.startsWith('FAIL:') === false), harnessError: false, findings }
  }
  if (testCase.id === 'negative-unknown-kernel') {
    if (!/dsh-v0\.1\.1-rc\.2/.test(haystack)) fail('the refused kernel identity is not named in the output')
    else pass('the output names the kernel identity that has no section')
    if (!/compat[\\/]table/.test(haystack)) fail('the refusal does not name the compat table file to add')
    else pass('the refusal names the compat table file to add')
    if (reading.linkPresent) fail('ctx.link.compat was published for a kernel with no section')
    else pass('nothing published ctx.link.compat')
    return { pass: findings.every((line) => line.startsWith('FAIL:') === false), harnessError: false, findings }
  }
  if (testCase.id === 'negative-fake-table') {
    if (!reading.settled) fail('the boot did not settle')
    else pass('the boot settled')
    if (reading.linkPresent !== true) fail('the row did not publish ctx.link.compat, so no judgement was produced')
    if (reading.report === null || reading.report.kernel !== FAKE_KERNEL) fail('the report is not keyed by the synthetic identity ' + FAKE_KERNEL)
    else pass('the loader ran the synthetic section ' + reading.report.kernel)
    if (reading.injected === null) fail('the driver registered no synthetic section')
    if (reading.refused === null || reading.refused.includes('tools') === false) fail('tools was not refused by the unsatisfiable section')
    else pass('tools is refused by the synthetic section')
    if (reading.resolved === null || reading.resolved.length === 0) fail('no other capability resolved, so the loader refused everything and the construct discriminates nothing')
    else pass('the same loader still resolved ' + reading.resolved.length + ' other capabilities: ' + reading.resolved.slice(0, 6).join(', '))
    const toolsLookup = reading.lookups === null ? null : reading.lookups.tools
    if (toolsLookup === null || toolsLookup.silentPass !== false) fail('capability(tools) returned instead of throwing: a silent pass')
    else pass('capability(tools) threw')
    if (toolsLookup !== null && toolsLookup.refusal !== null && toolsLookup.refusal.reason && toolsLookup.refusal.reason.indexOf('r31-absent-service') !== -1) pass('the refusal names the service this kernel does not have')
    else fail('the refusal does not name the absent service: ' + JSON.stringify(toolsLookup === null ? null : toolsLookup.refusal))
    if (reading.refusalViolations !== null && reading.refusalViolations.length > 0) fail('refusal violations: ' + reading.refusalViolations.join('; '))
    return { pass: findings.every((line) => line.startsWith('FAIL:') === false), harnessError: false, findings }
  }
  if (testCase.id === 'control-fake-table') {
    if (reading.linkPresent !== true) fail('the control never reached the loader')
    if (reading.report === null || reading.report.kernel !== FAKE_KERNEL) fail('the control did not run the synthetic section')
    if (reading.refused !== null && reading.refused.includes('tools')) fail('the unmutated section also refuses tools, so the refusal above is an artifact of the injection')
    else pass('the unmutated synthetic section does not refuse tools')
    const toolsLookup = reading.lookups === null ? null : reading.lookups.tools
    if (toolsLookup === null || toolsLookup.has !== true) fail('the unmutated section did not serve tools, so the control is not a control')
    else pass('the unmutated section serves tools')
    return { pass: findings.every((line) => line.startsWith('FAIL:') === false), harnessError: false, findings }
  }
  fail('no judge for this case')
  return { pass: false, harnessError: false, findings }
}
const mode = option('mode', 'template')
const selected = CASES.filter((testCase) => ONLY === null || ONLY.split(',').includes(testCase.id))
const OUT_URL_LINE = 'artifact: ' + OUT
const runs = []

process.stdout.write('== probe-loader-boot' + NL)
process.stdout.write('   kernel ' + KERNEL + NL)
process.stdout.write('   plugin ' + PLUGIN_DIR + NL)
process.stdout.write('   mode   ' + mode + '   cases ' + selected.map((entry) => entry.case).join(', ') + NL)

for (const testCase of selected) {
  process.stdout.write('== case ' + testCase.id + ' (' + testCase.shape + ')' + NL)
  const record = runCase(testCase, mode)
  const reading = readingOf(record)
  const verdict = judge(testCase, record, reading, haystackOf(record))
  record.reading = reading
  record.verdict = verdict
  record.status = verdict.harnessError ? 'harness-error' : (verdict.pass ? 'pass' : 'fail')
  runs.push(record)
  process.stdout.write('   ' + record.status + '  exit=' + record.exitCode + ' settled=' + reading.settled + ' link=' + reading.linkPresent + ' calibration=' + reading.calibration + ' template=' + record.template + ' ' + record.elapsedMs + 'ms' + NL)
  if (reading.report !== null) {
    process.stdout.write('   report kernel=' + reading.report.kernel + ' resolved=' + reading.report.resolved.length + ' refused=' + reading.report.refused.length + ' staleRefusals=' + reading.report.staleRefusals.length + NL)
    if (reading.counts !== null) process.stdout.write('   dispositions resolve=' + reading.counts.resolve + ' translate=' + reading.counts.translate + ' refuse=' + reading.counts.refuse + ' served=' + reading.counts.served + ' withheld=' + reading.counts.withheld + NL)
  }
  if (reading.injected !== null) process.stdout.write('   synthetic section ' + reading.injected.kernel + ' tables=' + reading.injected.tables.join('|') + ' tools->' + reading.injected.toolsService + NL)
  for (const line of verdict.findings) if (line.startsWith('FAIL:') || line.startsWith('ok:') === false) process.stdout.write('   ' + line + NL)
  for (const line of record.errorLines.slice(0, 6)) process.stdout.write('   raw: ' + line.slice(0, 200) + NL)
}

const failed = runs.filter((entry) => entry.status === 'fail')
const skipped = runs.filter((entry) => entry.status === 'skip' || entry.status === 'harness-error')
const positives = runs.filter((entry) => entry.case.startsWith('positive-'))
const bootProven = positives.filter((entry) => entry.status === 'pass').map((entry) => entry.case)

const gaps = [
  'the throwaway profile is built from a shipped template, so it is a real boot of a real profile but not the live shell composition; the live composition is measured separately by scripts/probe-live-composition.mjs and the R7 live gate',
  'the loader identity is taken from the boot process working directory (the pinned kernel checkout), which is what compat/index.ts documents; the throwaway home contributes no kernel identity of its own',
  'the package-case row resolves through a junction placed in the throwaway profile, which is how an installed package reaches a profile; the repository copy is never written',
  'the synthetic sections used by the negative construct are registered in the loader module the source entry imports, so those readings are of the same code path the shipped entry uses, with the section data supplied by the probe',
]

const artifact = {
  schema: 'dsh-link.loader-boot/1',
  probe: {
    script: 'scripts/probe-loader-boot.mjs',
    argv: process.argv.slice(2),
    ranAt: new Date().toISOString(),
    mode,
    casesRequested: selected.map((entry) => entry.case),
    timeoutMs: BOOT_TIMEOUT,
    kernel: { checkout: KERNEL, profileBoot: PROFILE_BOOT, appBoot: APP_BOOT },
    homePolicy: 'one mkdtemp home per case under the OS temp directory; DSH_HOME points at it; the live home and the live shell are never read or written',
  },
  plugin: {
    dir: PLUGIN_DIR.slice(REPO.length + 1),
    files: [artifact2(PLUGIN_LIB), artifact2(PLUGIN_SRC), artifact2(PLUGIN_PATCH), artifact2(join(PLUGIN_DIR, 'package.json')), artifact2(COMPAT_INDEX)],
    shippedPatch: shippedPatchText,
  },
  instrument: {
    calibration: { module: 'r31-calibration.mjs', why: 'without it a refusal and a boot that never reached the mount stage read the same' },
    driver: 'a module written beside the throwaway home, spawned with the kernel checkout as cwd and tsx as the ESM hook; it boots the profile with runProfile(), reads the live context, and writes one observation JSON',
    labels: ['实测', '代码可证(file:line)', '外部', '推断', '构造触发', '未验'],
  },
  runs: runs.map((entry) => ({
    case: entry.case, shape: entry.shape, label: entry.label, why: entry.why, expect: entry.expect,
    status: entry.status, findings: entry.verdict.findings, harnessError: entry.harnessError,
    template: entry.template, mode, exitCode: entry.exitCode, timedOut: entry.timedOut, elapsedMs: entry.elapsedMs,
    rowsWritten: entry.rowsWritten, patchText: entry.patchText, stageLog: entry.stageLog,
    markerEvents: entry.markerEvents,
    reading: entry.reading,
    rawErrorLines: entry.errorLines,
    stdoutTail: entry.stdoutTail, stderrTail: entry.stderrTail,
  })),
  verdict: {
    boot: bootProven.length > 0
      ? 'the repository plugin mounts as a real row of a throwaway profile and its loader starts: ' + bootProven.join(', ')
      : 'NOT established: no positive case reached the loader',
    bootProven,
    positivesFailed: positives.filter((entry) => entry.status !== 'pass').map((entry) => entry.case),
    negatives: runs.filter((entry) => entry.case.startsWith('negative-')).map((entry) => ({ case: entry.case, status: entry.status })),
    control: runs.filter((entry) => entry.case.startsWith('control-')).map((entry) => ({ case: entry.case, status: entry.status })),
    failed: failed.map((entry) => entry.case),
    skipped: skipped.map((entry) => entry.case),
  },
  gaps,
}

writeFileSync(OUT, JSON.stringify(artifact, undefined, 2) + NL, 'utf8')
process.stdout.write(NL + '== verdict' + NL)
process.stdout.write('   ' + artifact.verdict.boot + NL)
for (const entry of runs) process.stdout.write('   ' + entry.status.padEnd(13) + entry.case + NL)
process.stdout.write('   ' + (failed.length === 0 ? 'no case failed' : 'failed: ' + failed.map((entry) => entry.case).join(', ')) + NL)
process.stdout.write('   ' + OUT_URL_LINE + NL)
process.stdout.write(JSON.stringify({ schema: artifact.schema, ranAt: artifact.probe.ranAt, mode, kernel: KERNEL, statuses: Object.fromEntries(runs.map((entry) => [entry.case, entry.status])), boot: artifact.verdict.boot, out: OUT }, null, 2) + NL)

process.exit(failed.length > 0 ? 1 : (runs.length === 0 ? 3 : 0))
