#!/usr/bin/env node
// R73 alive-control: present - reads a ROOT-provided service (dshHomePath) on 'settled' and on 'disposed', so 'my row is gone' is distinguishable from 'the whole composition is gone'
/**
 * Does the simple layer actually work in a real kernel, and what happens when a capability is absent?
 *
 * R21 left the mount instrument: a throwaway home, a profile built from a shipped template whose
 * bundle list is rewritten, rows inserted by relative path beside the patch file, and
 * \`runProfile()\` awaited until the profile settles. This probe uses the same instrument for two
 * questions the simple layer must answer:
 *
 *   1. **available** — with the kernel's own services mounted, do the three entry points work, and
 *      what exactly do they return? The consumer plugin calls them and appends what it saw to a
 *      marker file, so the evidence is the layer's own output, not this script's opinion of it.
 *   2. **absent** — with no bundles at all, the capabilities cannot resolve. The simple layer must
 *      refuse in a way a caller can act on (the loader's typed error), not degrade to undefined and
 *      not substitute a default.
 *
 * The consumer row is inserted after the compat row and declares the link service as an injection,
 * so the loader holds it until the compat row has published. Both rows are local modules written
 * beside the patch file, so nothing has to be installed into the throwaway home.
 *
 * Usage (the kernel checkout must be reachable; paths come from this file, not from cwd):
 *   node scripts/probe-compat-simple.mjs [--keep] [--out <json>]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const KERNEL = resolve(process.env.DSH_LINK_KERNEL ?? join(PROJECT, 'core', 'deepseek-harness'))
const OUT = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(PROJECT, '.tmp', 'r30', 'compat-simple.json'))
const KEEP = process.argv.includes('--keep')
const PROFILE = 'r30probe'

const PROFILE_BOOT = pathToFileURL(join(KERNEL, 'apps/cli/src/profile-boot.ts')).href
const APP_BOOT = pathToFileURL(join(KERNEL, 'packages/boot/app-boot/src/index.ts')).href
const COMPAT_LIB = pathToFileURL(join(PROJECT, 'plugins/dsh-link-compat/lib/index.js')).href

if (!existsSync(join(KERNEL, 'apps/cli/src/profile-boot.ts'))) {
  process.stderr.write('kernel not found at ' + KERNEL + '\n')
  process.exit(2)
}
if (!existsSync(join(PROJECT, 'plugins/dsh-link-compat/lib/index.js'))) {
  process.stderr.write('build the plugin first: node plugins/build.mjs\n')
  process.exit(2)
}

/** The compat row's module: the shipped plugin, reached by absolute path. */
const BRIDGE = `export { name, Config, apply } from '${COMPAT_LIB}'
`

/** The consumer: calls the three entry points and records exactly what came back. */
const CONSUMER = `import { appendFileSync } from 'node:fs'

export const name = 'r30-consumer'
// Wait for the compat row to publish the link service before this apply runs.
export const inject = ['link']

const note = (record) => appendFileSync(process.env.R30_MARKER, JSON.stringify(record) + '\\n')

const refusal = (error) => ({
  name: error && error.name ? error.name : typeof error,
  capability: error && error.capability !== undefined ? error.capability : null,
  kernelVersion: error && error.kernelVersion !== undefined ? error.kernelVersion : null,
  reason: error && error.reason !== undefined ? error.reason : null,
  suggestion: error && error.suggestion !== undefined ? error.suggestion : null,
  message: String(error && error.message ? error.message : error).slice(0, 300),
})

export async function apply(ctx) {
  const compat = ctx.link && ctx.link.compat
  note({ event: 'link-visible', hasLink: ctx.link !== undefined, hasCompat: compat !== undefined, hasSimple: Boolean(compat && compat.simple) })
  const simple = compat && compat.simple
  if (!simple) { note({ event: 'no-simple' }); return }

  try {
    note({ event: 'available', value: simple.available() })
  } catch (error) {
    note({ event: 'available-threw', ...refusal(error) })
  }

  // The loader's own report says which capabilities bound and which refused with what reason,
  // which is the difference between "the simple layer is wrong" and "this composition has no
  // services to bind to".
  try {
    const report = compat.report()
    note({
      event: 'report',
      kernel: report.kernel,
      resolved: report.resolved,
      refused: report.refused,
      rows: (report.rows || []).filter((row) => row.status !== 'resolved').map((row) => ({ capability: row.capability, status: row.status, failures: row.failures })),
    })
  } catch (error) {
    note({ event: 'report-threw', ...refusal(error) })
  }

  try {
    const rows = await simple.sessions.recent(process.env.R30_ANCHOR || 'session-does-not-exist', 3)
    note({
      event: 'sessions.recent.ok', isArray: Array.isArray(rows), length: rows.length,
      rowKeys: rows.length > 0 ? Object.keys(rows[0]) : [], sample: rows.slice(0, 2),
    })
  } catch (error) {
    note({ event: 'sessions.recent.threw', ...refusal(error) })
  }

  try {
    const handle = simple.tools.add('r30-probe-tool', {
      description: 'R30 probe tool',
      parameters: { value: { type: 'string' } },
      execute: (args) => ({ echo: args && args.value !== undefined ? args.value : null }),
    })
    note({
      event: 'tools.add.ok', name: handle.name, definition: handle.definition,
      has: simple.tools.has('r30-probe-tool'), namesInclude: simple.tools.names().includes('r30-probe-tool'),
      namesCount: simple.tools.names().length,
    })
  } catch (error) {
    note({ event: 'tools.add.threw', ...refusal(error) })
  }

  try {
    const declaration = await simple.settings.define('r30-probe', { enabled: true }, { type: 'object' })
    note({ event: 'settings.define.ok', declaration })
  } catch (error) {
    note({ event: 'settings.define.threw', ...refusal(error) })
  }

  note({ event: 'consumer-done' })
}
`

/** The driver: boot the profile, let it settle, dispose, and report a hard failure as data. */
const DRIVER = `import { appendFileSync } from 'node:fs'
const marker = process.env.R30_MARKER
const note = (event, extra = {}) => appendFileSync(marker, JSON.stringify({ event, ...extra }) + '\\n')
try {
  const appBoot = await import(process.env.R30_APP_BOOT_URL)
  const boot = await import(process.env.R30_PROFILE_BOOT_URL)
  note('driver-imported')
  const result = await boot.runProfile({
    environment: appBoot.loadLayeredEnv('dsh'),
    profile: process.env.R30_PROFILE,
    patchFiles: [],
    args: [],
  })
  // R73 control: is the composition still alive at the moment this reading is taken? A root-provided
  // service is the only witness that does not depend on our own plugin, so it is read before and after
  // the teardown rather than assumed.
  const rootAlive = () => { try { return result.ctx.reflect.get('dshHomePath', false) !== undefined } catch { return false } }
  note('settled', { rootAlive: rootAlive() })
  await result.ctx.fiber.dispose()
  note('disposed', { rootAlive: rootAlive() })
  process.exit(0)
} catch (error) {
  note('driver-error', { message: String(error && error.message ? error.message : error).slice(0, 600) })
  process.exit(3)
}
`

/** Reads what this composition published, before any capability is asked for. */
const DIAG = `import { appendFileSync } from 'node:fs'

export const name = 'r30-diag'

const note = (record) => appendFileSync(process.env.R30_MARKER, JSON.stringify(record) + '\\n')

export function apply(ctx) {
  const visible = (name) => {
    try { return ctx.get(name) !== undefined } catch (error) { return 'threw: ' + String(error && error.message ? error.message : error) }
  }
  note({
    event: 'diag',
    profileContext: visible('profileContext'),
    tools: visible('tools'),
    settings: visible('settings'),
    sessions: visible('sessions'),
    sessionPersistence: visible('sessionPersistence'),
  })
}
`

/** Cases: the same consumer, once with the kernel's services and once with none. */
const CASES = [
  // base alone. The first run of this probe mounted base + headless, and case 1's captured stderr
  // was "dsh: a task is required, for example: dsh --profile headless \"run the tests\"" — the
  // headless bundle mounts a one-shot runner that refuses to start without a task, and running a
  // task would need a model. So that composition aborted before mounting anything, which is what
  // the all-absent reading actually measured. The platform bundle mounts no such runner.
  { id: 'services-present', bundles: ['@deepseek-ai/dsh-base'], question: 'With the platform bundle mounted, do the three entry points work, and what do they return?' },
  // The sdk-minimal bundle declares itself the COMPLETE Cordis tree (it does not layer over
  // dsh-base) and serves stdio JSON-RPC: no webserver, no port, no task argument. It is the one
  // shipped composition that mounts core services without an app loop.
  { id: 'sdk-minimal', bundles: ['@deepseek-ai/dsh-sdk-minimal'], question: 'With the complete stdio tree mounted, do the three entry points work, and what do they return?' },
  { id: 'services-absent', bundles: [], question: 'With no capability resolvable, what does each entry point do instead of working?' },
]

const truncate = (text, limit) => (text.length <= limit ? text : text.slice(0, limit) + '\n…[truncated, ' + String(text.length - limit) + ' more chars]')

const initProfile = (home) => {
  for (const template of ['headless', 'web', 'base']) {
    const script = `import { initializeProfileFromDefault } from '${PROFILE_BOOT}'
try { initializeProfileFromDefault(process.env.R30_PROFILE, '${template}', process.env.DSH_HOME); process.stdout.write('OK') }
catch (error) { process.stdout.write('FAIL ' + String(error && error.message ? error.message : error)) }`
    const file = join(home, 'init.mjs')
    writeFileSync(file, script, 'utf8')
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', file], {
      cwd: KERNEL, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: home, R30_PROFILE: PROFILE },
    })
    const text = ((result.stdout ?? '') + (result.stderr ?? '')).trim()
    if (text.startsWith('OK')) return template
  }
  return null
}

const runCase = (testCase) => {
  const home = mkdtempSync(join(tmpdir(), 'r30-simple-'))
  const marker = join(home, 'markers.jsonl')
  writeFileSync(marker, '', 'utf8')
  try {
    const template = initProfile(home)
    if (template === null) return { home, marker, status: null, timedOut: false, stdout: '', stderr: 'profile initialization failed', events: [], markerText: '', elapsedMs: 0 }
    const profileDir = join(home, 'profiles', PROFILE)
    const manifestPath = join(profileDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: testCase.bundles } }
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
    writeFileSync(join(profileDir, 'r30-diag.mjs'), DIAG, 'utf8')
    writeFileSync(join(profileDir, 'r30-compat.mjs'), BRIDGE, 'utf8')
    writeFileSync(join(profileDir, 'r30-consumer.mjs'), CONSUMER, 'utf8')
    writeFileSync(join(profileDir, 'cordis.patch.yml'), JSON.stringify([
      // First, before any capability is asked for: what did this composition actually publish?
      { insert: [{ id: 'r30-diag', name: './r30-diag.mjs' }] },
      // strict: false is the documented row option, and it is required here: with the default
      // strict: true the shipped plugin refuses to load in a partial composition, because three of
      // the table's refusal witnesses were measured on a fuller profile (pluginManager is absent
      // from dsh-base, and the settings witness rides on that). That is a finding about composing a
      // subset, not about the simple layer, so the probe lifts it and records it.
      { insert: [{ id: 'r30-compat', name: './r30-compat.mjs', config: { kernel: '', strict: false } }] },
      { insert: [{ id: 'r30-consumer', name: './r30-consumer.mjs' }] },
    ], null, 2) + '\n', 'utf8')
    const driver = join(home, 'run.mjs')
    writeFileSync(driver, DRIVER, 'utf8')
    const started = Date.now()
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', driver], {
      cwd: KERNEL,
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        DSH_HOME: home,
        R30_MARKER: marker,
        R30_PROFILE: PROFILE,
        R30_PROFILE_BOOT_URL: PROFILE_BOOT,
        R30_APP_BOOT_URL: APP_BOOT,
        // The compat row identifies its kernel by walking up from cwd; naming it removes a second
        // variable from the reading, and the row is exercised through the same code path either way.
        DSH_LINK_KERNEL_VERSION: 'dsh-v0.2.1-alpha.1',
      },
    })
    const elapsedMs = Date.now() - started
    const markerText = readFileSync(marker, 'utf8')
    const events = markerText.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return [{ event: 'unparseable-marker-line', line: line.slice(0, 200) }]
      }
    })
    return {
      home, marker, template, status: result.status, timedOut: result.signal === 'SIGTERM',
      stdout: result.stdout ?? '', stderr: result.stderr ?? '', markerText, events, elapsedMs,
    }
  } finally {
    if (!KEEP) rmSync(home, { recursive: true, force: true })
  }
}

const results = []
let allMeasured = true
for (const testCase of CASES) {
  process.stdout.write('== case ' + testCase.id + '\n')
  const run = runCase(testCase)
  const events = run.events ?? []
  const done = events.some((event) => event.event === 'consumer-done')
  const linkVisible = (events.find((event) => event.event === 'link-visible') ?? {}).hasSimple === true
  const measured = done
  if (!measured) allMeasured = false
  for (const event of events) process.stdout.write('   ' + JSON.stringify(event).slice(0, 220) + '\n')
  results.push({
    id: testCase.id,
    question: testCase.question,
    constructed: 'profile ' + PROFILE + ' from template "' + String(run.template) + '" with bundles ' + JSON.stringify(testCase.bundles)
      + ', rows: compat row (./r30-compat.mjs, the shipped plugin) then consumer row (./r30-consumer.mjs, inject: [link])',
    command: 'DSH_HOME=<mkdtemp> node --import tsx/esm <home>/run.mjs   (cwd=' + KERNEL + ', runProfile({profile, patchFiles: [], args: []}))',
    exitStatus: run.status,
    elapsedMs: run.elapsedMs,
    measured,
    labels: measured ? ['实测', '构造触发'] : ['harness-error'],
    observed: {
      linkVisible,
      // Stated as its own field so the artifact cannot be read as "the three entry points work"
      // when what it measured was "the three entry points refuse, correctly, in a composition with
      // no services". available === all true is case A; available === all false with three typed
      // refusals is case C.
      available: (events.find((event) => event.event === 'available') ?? {}).value ?? null,
      refusals: events.filter((event) => String(event.event).endsWith('.threw')).map((event) => ({
        entry: String(event.event).replace('.threw', ''), name: event.name, capability: event.capability, reason: event.reason,
      })),
      events,
      settled: events.some((event) => event.event === 'settled'),
      consumerDone: done,
      driverErrors: events.filter((event) => event.event === 'driver-error').map((event) => event.message),
    },
    rawExcerpt: truncate(run.markerText === '' ? '(no marker lines)' : run.markerText, 1600),
    rawStderrExcerpt: run.stderr === '' ? '' : truncate(run.stderr, 900),
    // The driver's stdout is this composition's boot log: the shell's boot.log is the same stream
    // captured by its supervisor, and activation diagnostics are printed there.
    rawStdoutExcerpt: run.stdout === '' ? '' : truncate(run.stdout, 2000),
    activationLines: (run.stdout ?? '').split(/\r?\n/).filter((line) => /did not activate|skipped|disabled/i.test(line)).slice(0, 20),
  })
}

mkdirSync(dirname(OUT), { recursive: true })
const payload = {
  format: 'dsh-link.compat-simple-live/1',
  kernel: KERNEL,
  method: {
    boot: 'runProfile() from apps/cli/src/profile-boot.ts, awaited until the profile settles',
    home: 'fresh mkdtemp per case; DSH_HOME points at it; the live shell home is never read or written',
    rows: 'the shipped plugin (plugins/dsh-link-compat/lib/index.js) and a consumer written beside the patch file, inserted by relative path',
    consumer: 'calls simple.available / sessions.recent / tools.add / settings.define and appends what it saw to a marker file',
    cases: 'services-present mounts the shipped headless template (base + headless) so the capabilities can resolve; services-absent mounts no bundles at all',
    availability: 'read from the consumer\'s own available() call, not inferred: true means the entry points ran, false means they refused, and observed.refusals then carries the loader\'s typed reason for each',
  },
  cases: results,
}
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
process.stdout.write('\nwrote ' + OUT + '\n')
process.exit(allMeasured ? 0 : 1)
