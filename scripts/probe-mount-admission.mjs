#!/usr/bin/env node
// R73 alive-control: present - same pair of readings (settled / disposed) from a root-provided service
/**
 * Mount-stage admission: what a real boot does with a legacy-shaped row.
 *
 * R20 measured the COMPOSITION stage and left admission unverified: the dump prints rows and
 * deliberately does not admit them (app-boot/src/index.ts:407-408). This probe boots a real
 * profile against a throwaway home and observes which rows actually mount, and what config each
 * mounted plugin receives.
 *
 * Instrument. Each case gets a fresh \`mkdtemp\` home, a profile initialized from a shipped
 * template, and a rewritten \`cordis.patch.yml\` whose inserts name local modules written beside
 * the patch file (document.ts:14 — an inserted relative plugin path is anchored beside its patch
 * file). Each local module appends one JSON line per lifecycle event to a marker file, so the
 * observation is an event log rather than an assertion about it. The driver then awaits
 * \`runProfile()\` (apps/cli/src/profile-boot.ts:244), which settles once the profile has mounted.
 *
 * Every case carries a calibration row that must mount. Without it, "the tested row did not
 * mount" and "the boot never got far enough to mount anything" are the same observation — and
 * only one of them is a finding. A case whose calibration row is missing is reported as
 * \`harness-error\`, never as "the loader refused it".
 *
 * The live shell's home is never read or written: DSH_HOME is the throwaway home for every run.
 *
 * Usage (must run with the kernel checkout as cwd, like webworker-packer does):
 *   cd <kernel> && node --import tsx/esm <path>/probe-mount-admission.mjs [--keep] [--cases a,b]
 *                                              [--timeout 120000] [--mode minimal|template]
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const option = (name, fallback) => {
  const at = process.argv.indexOf('--' + name)
  return at === -1 ? fallback : process.argv[at + 1]
}
const flag = (name) => process.argv.includes('--' + name)

// Paths come from THIS FILE's location, never from the cwd and never from a literal drive
// letter: a probe run from a copy of the tree must read and write that copy, not the real
// checkout. Deriving the artifact path from process.cwd() once let a run from a scratch copy
// overwrite this repository's own artifact with a one-case result.
const HERE = dirname(fileURLToPath(import.meta.url))
/** The dsh-link repository root, one level above scripts/. */
const REPO = resolve(HERE, '..')
const KERNEL_FROM_REPO = join(REPO, 'core', 'deepseek-harness')
/**
 * The kernel checkout to boot.
 *
 * Resolved from the repository this file lives in, so a copy of the tree boots its own kernel and
 * a run from any cwd boots the same one. The cwd is consulted only as a last resort, for a probe
 * that has been copied somewhere outside a repository (the mount gate exercises exactly that, from
 * a throwaway copy with the kernel as cwd); it never decides where the artifact goes.
 */
const KERNEL = resolve(
  option(
    'kernel',
    process.env.DSH_LINK_KERNEL
      ?? (existsSync(join(KERNEL_FROM_REPO, 'apps', 'cli', 'src', 'profile-boot.ts'))
        ? KERNEL_FROM_REPO
        : process.cwd()),
  ),
)
const OUT = resolve(option('out', join(REPO, 'compat', 'adaptation', 'rows', 'mount-admission.json')))
const PROFILE = 'r21probe'
const BOOT_TIMEOUT = Number(option('timeout', '120000'))
const KEEP = flag('keep')
const ONLY = option('cases', null)

const PROFILE_BOOT = pathToFileURL(join(KERNEL, 'apps/cli/src/profile-boot.ts')).href
const APP_BOOT = pathToFileURL(join(KERNEL, 'packages/boot/app-boot/src/index.ts')).href
const SCHEMA = pathToFileURL(join(KERNEL, 'vendor/schemastery/src/index.ts')).href

if (!existsSync(join(KERNEL, 'apps/cli/src/profile-boot.ts'))) {
  process.stderr.write('run this with the kernel checkout as cwd; not found: ' + join(KERNEL, 'apps/cli/src/profile-boot.ts') + '\n')
  process.exit(2)
}

/** The plugin source for one marker row. Records every event with the tag baked in. */
const pluginSource = (tag) => `import { appendFileSync } from 'node:fs'
export const name = 'r21-${tag}'
export function apply(ctx, config) {
  appendFileSync(process.env.R21_MARKER, JSON.stringify({
    event: 'apply', tag: '${tag}', config: config === undefined ? null : config,
    configKeys: config === undefined || config === null ? null : Object.keys(config),
  }) + '\\n')
  return () => {
    appendFileSync(process.env.R21_MARKER, JSON.stringify({ event: 'dispose', tag: '${tag}' }) + '\\n')
  }
}
`

/** A module that DECLARES a config schema, so an unknown config key has something to violate. */
const schemaPluginSource = (tag, schemaBody = '{ knownKey: Schema.number() }') => `import { appendFileSync } from 'node:fs'
const Schema = globalThis.__R21_SCHEMA__
export const name = 'r21-${tag}'
export const Config = Schema.object(${schemaBody})
export function apply(ctx, config) {
  appendFileSync(process.env.R21_MARKER, JSON.stringify({
    event: 'apply', tag: '${tag}', config: config === undefined ? null : config,
    configKeys: config === undefined || config === null ? null : Object.keys(config),
  }) + '\\n')
  return () => {
    appendFileSync(process.env.R21_MARKER, JSON.stringify({ event: 'dispose', tag: '${tag}' }) + '\\n')
  }
}
`

const CALIBRATION = 'calibration'

/**
 * The cases. \`rows\` are the patch rows written into the profile layer; the calibration row is
 * appended to every case by the runner so a silent case is distinguishable from a dead boot.
 */
const CASES = [
  {
    id: 'control-plain-row',
    question: 'Positive control: a row with only id + name mounts, and what config does it receive?',
    modules: [[CALIBRATION, pluginSource(CALIBRATION)], ['plain', pluginSource('plain')]],
    rows: [{ insert: [{ id: 'r21-plain', name: './r21-plain.mjs' }] }],
    expect: { mounted: ['calibration', 'plain'] },
  },
  {
    id: 'disabled-true',
    question: 'Does disabled: true keep the row out of the tree? (positive control for the rest)',
    modules: [[CALIBRATION, pluginSource(CALIBRATION)], ['disabled', pluginSource('disabled')]],
    rows: [{ insert: [{ id: 'r21-disabled', name: './r21-disabled.mjs', disabled: true }] }],
    expect: { mounted: ['calibration'], absent: ['disabled'] },
  },
  {
    id: 'legacy-disable-true',
    question: '0.1.x spelling disable: true — does the row still mount?',
    modules: [[CALIBRATION, pluginSource(CALIBRATION)], ['legacy-disable', pluginSource('legacy-disable')]],
    rows: [{ insert: [{ id: 'r21-legacy-disable', name: './r21-legacy-disable.mjs', disable: true }] }],
    expect: { mounted: ['calibration'], observe: ['legacy-disable'] },
  },
  {
    id: 'legacy-enabled-and-options',
    question: '0.1.x keys enabled: true and options: {...} — do they reach the mounted plugin config?',
    modules: [[CALIBRATION, pluginSource(CALIBRATION)], ['legacy-enabled', pluginSource('legacy-enabled')]],
    rows: [{ insert: [{ id: 'r21-legacy-enabled', name: './r21-legacy-enabled.mjs', enabled: true, options: { keepMe: true } }] }],
    expect: { mounted: ['calibration', 'legacy-enabled'], observe: ['legacy-enabled'] },
  },
  {
    id: 'config-key-outside-schema',
    question: 'A config key the declared Config schema does not accept: loud failure, or silently passed?',
    modules: [
      [CALIBRATION, pluginSource(CALIBRATION)],
      ['schema-control', schemaPluginSource('schema-control')],
      ['schema-unknown', schemaPluginSource('schema-unknown')],
    ],
    rows: [
      { insert: [{ id: 'r21-schema-control', name: './r21-schema-control.mjs', config: { knownKey: 1 } }] },
      { insert: [{ id: 'r21-schema-unknown', name: './r21-schema-unknown.mjs', config: { knownKey: 1, unknownKey: 2 } }] },
    ],
    expect: { mounted: ['calibration', 'schema-control'], observe: ['schema-unknown'] },
  },
  {
    id: 'same-id-two-rows',
    question: 'Two inserted rows sharing one id: composition keeps both and indexes the last — which one mounts?',
    modules: [
      [CALIBRATION, pluginSource(CALIBRATION)],
      ['dupe-a', pluginSource('dupe-a')],
      ['dupe-b', pluginSource('dupe-b')],
    ],
    rows: [
      { insert: [{ id: 'r21-dupe', name: './r21-dupe-a.mjs' }] },
      { insert: [{ id: 'r21-dupe', name: './r21-dupe-b.mjs' }] },
    ],
    expect: { mounted: ['calibration'], observe: ['dupe-a', 'dupe-b'] },
  },
  // The two loud-failure cases below ask when the config schema actually refuses a row. They are
  // appended AFTER the six cases above so that every earlier reading keeps its position, and their
  // ids and constructions avoid the words the mount gate's pinned checks match on, so no check can
  // start selecting one of these instead of the case it was written for.
  {
    id: 'config-absent-optional-key',
    // Scoped deliberately to the OPTIONAL case. schemastery only reports a missing value when the
    // schema carries meta.required (vendor/schemastery/src/index.ts:534), and \`.required()\` is an
    // explicit call (:160), so this construction asks what an absent declared-but-optional key does.
    question: 'A config that omits a key the schema declares but does not require (no .required()): does the row mount?',
    modules: [
      [CALIBRATION, pluginSource(CALIBRATION)],
      ['schema-optional', schemaPluginSource('schema-optional', '{ knownKey: Schema.number(), optionalKey: Schema.string() }')],
    ],
    rows: [
      { insert: [{ id: 'r21-schema-optional', name: './r21-schema-optional.mjs', config: { knownKey: 1 } }] },
    ],
    expect: { mounted: ['calibration', 'schema-optional'], observe: ['schema-optional'] },
  },
  {
    id: 'config-missing-required-key',
    question: 'A config that omits a key marked .required(): does the row mount, and what is reported?',
    modules: [
      [CALIBRATION, pluginSource(CALIBRATION)],
      ['schema-required', schemaPluginSource('schema-required', '{ knownKey: Schema.number(), requiredKey: Schema.string().required() }')],
    ],
    rows: [
      { insert: [{ id: 'r21-schema-required', name: './r21-schema-required.mjs', config: { knownKey: 1 } }] },
    ],
    expect: { mounted: ['calibration'], absent: ['schema-required'], loudFailure: true },
  },
  {
    id: 'config-type-mismatch',
    question: 'A config whose value has the wrong type for the declared schema: does the row mount, and what is reported?',
    modules: [
      [CALIBRATION, pluginSource(CALIBRATION)],
      ['schema-type', schemaPluginSource('schema-type', '{ knownKey: Schema.number(), requiredKey: Schema.string() }')],
    ],
    rows: [
      { insert: [{ id: 'r21-schema-type', name: './r21-schema-type.mjs', config: { knownKey: 'not-a-number', requiredKey: 'ok' } }] },
    ],
    expect: { mounted: ['calibration'], absent: ['schema-type'], loudFailure: true },
  },
]

/** The boot driver written into each throwaway home; runs inside the kernel's own module graph. */
const driverSource = `import { appendFileSync } from 'node:fs'
const marker = process.env.R21_MARKER
const note = (event, extra = {}) => appendFileSync(marker, JSON.stringify({ event, ...extra }) + '\\n')
try {
  const schemaUrl = process.env.R21_SCHEMA_URL
  if (schemaUrl !== undefined && schemaUrl !== '') {
    const loaded = await import(schemaUrl)
    globalThis.__R21_SCHEMA__ = loaded.default ?? loaded
  }
  const appBoot = await import(process.env.R21_APP_BOOT_URL)
  const boot = await import(process.env.R21_PROFILE_BOOT_URL)
  note('driver-imported')
  const result = await boot.runProfile({
    environment: appBoot.loadLayeredEnv('dsh'),
    profile: process.env.R21_PROFILE,
    patchFiles: [],
    args: [],
  })
  // R73 control: a root-provided service is read before and after the teardown, so "the row is gone"
  // can be told apart from "the whole composition is gone".
  const rootAlive = () => { try { return result.ctx.reflect.get('dshHomePath', false) !== undefined } catch { return false } }
  note('settled', { rootAlive: rootAlive() })
  await result.ctx.fiber.dispose()
  note('disposed', { rootAlive: rootAlive() })
  process.exit(0)
} catch (error) {
  note('driver-error', { message: String(error && error.message ? error.message : error), stack: String(error && error.stack ? error.stack : '').slice(0, 2000) })
  process.exit(3)
}
`

/** Initialize a profile from the first shipped template that accepts the name. */
const initProfile = (home) => {
  const candidates = [option('template', null), 'headless', 'web', 'base'].filter(Boolean)
  const attempts = []
  for (const template of candidates) {
    const script = `import { initializeProfileFromDefault } from '${PROFILE_BOOT}'
try {
  initializeProfileFromDefault(process.env.R21_PROFILE, '${template}', process.env.DSH_HOME)
  process.stdout.write('OK')
} catch (error) {
  process.stdout.write('FAIL ' + String(error && error.message ? error.message : error))
}`
    const file = join(home, 'init.mjs')
    writeFileSync(file, script, 'utf8')
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', file], {
      cwd: KERNEL, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: home, R21_PROFILE: PROFILE },
    })
    const text = ((result.stdout ?? '') + (result.stderr ?? '')).trim()
    attempts.push({ template, text: text.slice(0, 400) })
    if (text.startsWith('OK')) return { template, attempts }
  }
  return { template: null, attempts }
}

const modes = option('mode', null)
const runCase = (testCase, mode) => {
  const home = mkdtempSync(join(tmpdir(), 'r21-mount-'))
  const marker = join(home, 'markers.jsonl')
  writeFileSync(marker, '', 'utf8')
  try {
    const initialized = initProfile(home)
    if (initialized.template === null) {
      return { home, marker, status: null, stdout: '', stderr: 'profile initialization failed', initMode: null, initAttempts: initialized.attempts, elapsedMs: 0, markerText: '' }
    }
    const profileDir = join(home, 'profiles', PROFILE)
    const manifestPath = join(profileDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const templateBundles = [...(manifest.dsh?.profile?.bundles ?? [])]
    if (mode === 'minimal') {
      manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [] } }
      writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
    }
    for (const [tag, source] of testCase.modules) writeFileSync(join(profileDir, 'r21-' + tag + '.mjs'), source, 'utf8')
    const rows = [{ insert: [{ id: 'r21-' + CALIBRATION, name: './r21-' + CALIBRATION + '.mjs' }] }, ...testCase.rows]
    writeFileSync(join(profileDir, 'cordis.patch.yml'), JSON.stringify(rows, null, 2) + '\n', 'utf8')
    const driver = join(home, 'run.mjs')
    writeFileSync(driver, driverSource, 'utf8')
    const started = Date.now()
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', driver], {
      cwd: KERNEL,
      encoding: 'utf8',
      timeout: BOOT_TIMEOUT,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        DSH_HOME: home,
        R21_MARKER: marker,
        R21_PROFILE: PROFILE,
        R21_PROFILE_BOOT_URL: PROFILE_BOOT,
        R21_APP_BOOT_URL: APP_BOOT,
        R21_SCHEMA_URL: SCHEMA,
      },
    })
    const elapsedMs = Date.now() - started
    const events = readFileSync(marker, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return [{ event: 'unparseable-marker-line', line: line.slice(0, 200) }]
      }
    })
    return {
      home,
      marker,
      status: result.status,
      timedOut: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      initMode: initialized.template,
      templateBundles,
      elapsedMs,
      markerText: readFileSync(marker, 'utf8'),
      events,
    }
  } finally {
    if (!KEEP) rmSync(home, { recursive: true, force: true })
  }
}

const truncate = (text, limit) => (text.length <= limit ? text : text.slice(0, limit) + '\n…[truncated, ' + String(text.length - limit) + ' more chars]')

// Preflight: does a minimal profile (no bundles) settle at all? If not, fall back to the
// template's own bundle list, which is the composition the R7 live gate already boots.
let mode = modes
if (mode === null) {
  process.stdout.write('== preflight: minimal profile\n')
  const preflight = runCase(CASES[0], 'minimal')
  const settled = (preflight.events ?? []).some(event => event.event === 'settled')
  mode = settled ? 'minimal' : 'template'
  process.stdout.write('   settled=' + String(settled) + ' -> mode=' + mode + '\n')
  if (!settled) {
    process.stdout.write('   preflight stderr tail: ' + truncate((preflight.stderr ?? '').trim().slice(-400), 400) + '\n')
  }
}

const results = []
for (const testCase of CASES) {
  if (ONLY !== null && !ONLY.split(',').includes(testCase.id)) continue
  process.stdout.write('== case ' + testCase.id + '\n')
  const run = runCase(testCase, mode)
  const events = run.events ?? []
  const applied = events.filter(event => event.event === 'apply').map(event => event.tag)
  const calibrationMounted = applied.includes(CALIBRATION)
  const harnessOk = calibrationMounted
  const observed = {
    mountedTags: applied,
    disposedTags: events.filter(event => event.event === 'dispose').map(event => event.tag),
    configByTag: Object.fromEntries(events.filter(event => event.event === 'apply').map(event => [event.tag, event.config])),
    driverEvents: events.filter(event => String(event.event).startsWith('driver-')).map(event => ({ event: event.event, message: event.message ?? null })),
    settled: events.some(event => event.event === 'settled'),
    // Whether the teardown path ran at all: the driver disposes the root fiber after settling, and
    // a plugin teardown that never fires is a fact about this instrument worth recording rather
    // than assuming.
    driverDisposed: events.some(event => event.event === 'disposed'),
    // Loud vs quiet, kept apart on the evidence: a refusal that reports nothing is a different
    // finding from a refusal that names the violation, and only the second one is a failure a
    // 0.1.x profile could notice.
    loudness: {
      driverError: (events.find(event => event.event === 'driver-error') ?? {}).message ?? null,
      reportedOnStderr: (run.stderr ?? '').trim() !== '',
      stderrExcerpt: truncate((run.stderr ?? '').trim() === '' ? '' : (run.stderr ?? '').trim(), 500),
    },
    exitStatus: run.status,
    timedOut: run.timedOut === true,
  }
  // A reading derived from the event log only: which rows mounted, and what each one received.
  observed.reading = [
    'mounted: [' + applied.join(', ') + ']',
    ...(testCase.expect.absent ?? []).filter(tag => applied.includes(tag)).map(tag => 'row the control expects to stay out DID mount: ' + tag),
    ...(testCase.expect.observe ?? []).filter(tag => applied.includes(tag)).map(tag => tag + ' config=' + JSON.stringify(observed.configByTag[tag] ?? null)),
  ].join(' | ')
  const loud = observed.loudness.driverError !== null || observed.loudness.reportedOnStderr
  const stayedOut = (testCase.expect.absent ?? []).filter(tag => !applied.includes(tag))
  const verdict = !harnessOk
    ? 'harness-error: the calibration row did not mount, so this boot never reached admission (see rawStderrExcerpt / driverEvents)'
    : testCase.expect.absent?.some(tag => applied.includes(tag))
      ? 'the row the control says should stay out of the tree DID mount: admission accepted it, so this outcome is SILENT'
      : testCase.expect.loudFailure === true
        // A schema refusal is only a "loud failure" if the boot actually reports it. Staying out
        // quietly would still be a refusal, but a 0.1.x profile could not tell it from success.
        ? (loud
            ? 'refused with a report: the row did not mount (' + stayedOut.join(', ') + ') and the boot said so — ' +
              String(observed.loudness.driverError ?? 'see loudness.stderrExcerpt').split('\n')[0].slice(0, 200)
            : 'refused QUIETLY: the row did not mount, but nothing was reported (see loudness)')
        : testCase.expect.mounted.every(tag => applied.includes(tag))
          ? 'admission matches the control: mounted [' + testCase.expect.mounted.join(', ') + ']' +
            (testCase.expect.observe ? ', observed [' + testCase.expect.observe.join(', ') + ']' : '')
          : 'EXPECTED MOUNT MISSING: wanted [' + testCase.expect.mounted.join(', ') + '], got [' + applied.join(', ') + ']'
  process.stdout.write('   mounted=' + JSON.stringify(applied) + ' settled=' + String(observed.settled) + ' exit=' + String(run.status) + '\n')
  process.stdout.write('   ' + verdict + '\n')
  results.push({
    id: testCase.id,
    question: testCase.question,
    constructed: 'profile ' + PROFILE + ' (mode ' + mode + ', initialized from template ' + String(run.initMode) + '), rows: ' + JSON.stringify(testCase.rows),
    command: 'DSH_HOME=<mkdtemp> node --import tsx/esm <home>/run.mjs   (cwd=' + KERNEL + ', then runProfile({profile, patchFiles: [], args: []}))',
    exitStatus: run.status,
    elapsedMs: run.elapsedMs,
    profileMode: mode,
    initTemplate: run.initMode,
    calibrationMounted,
    observed,
    rawExcerpt: truncate(run.markerText === '' ? '(no marker lines)' : run.markerText, 1200),
    rawStderrExcerpt: run.stderr === '' ? '' : truncate(run.stderr, 900),
    rawStdoutExcerpt: run.stdout === '' ? '' : truncate(run.stdout, 600),
    verdict,
    measured: harnessOk,
    labels: harnessOk ? ['实测', '构造触发'] : ['harness-error'],
  })
}

const payload = {
  format: 'dsh-link.mount-admission/1',
  kernel: KERNEL,
  method: {
    boot: 'runProfile() from apps/cli/src/profile-boot.ts:244, awaited until the profile settles',
    home: 'fresh mkdtemp per case; DSH_HOME points at it; the live shell home is never read or written',
    rows: 'inserted into <home>/profiles/' + PROFILE + '/cordis.patch.yml; each row names a local module written beside the patch file',
    observation: 'each module appends one JSON line per lifecycle event (apply/dispose) to a marker file',
    calibration: 'every case also inserts a calibration row that must mount; without it, "the row did not mount" and "the boot never got there" are the same reading',
    mode,
  },
  cases: results,
}

mkdirSync(resolve(OUT, '..'), { recursive: true })
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
process.stdout.write('\nwrote ' + OUT + '\n')
process.exit(results.every(entry => entry.measured === true) ? 0 : 1)
