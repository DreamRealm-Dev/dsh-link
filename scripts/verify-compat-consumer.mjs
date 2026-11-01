#!/usr/bin/env node
/**
 * R197 gate 132 compat-consumer (OFFLINE): the loader gets a customer, and the customer is the
 * thing that proves the loader is usable.
 *
 * docs/handoff/R197-contract.md section 2 P3. One fixture plugin whose ONLY registration path is
 * the compat loader's `http` capability, mounted in throwaway kernels built from the SHIPPED
 * artifacts (the built plugin plugins/dsh-link-compat/lib/index.js, the kernel's own webserver
 * service, one fresh mkdtemp home per world, runProfile() awaited until the profile settles):
 *
 *   (a)  with the shipped compat row, the fixture's own route answers 200 with the fixture's own
 *        body, registering through the contract-named call
 *        `ctx.link.compat.capability('http').register(...)` (R197:8, R197:19, R197:27)
 *   (b)  without the compat row, that fixture's registration FAILS with an error that NAMES the
 *        capability `http` - not a bare property TypeError, and not a silent success: the same
 *        route answers 404, because nothing registered it.
 *   (c)  the fixture's own source carries no `ctx.server.register` call and no other server
 *        access path (read from the fixture's bytes, with the compat call asserted present so
 *        the reading cannot pass vacuously).
 *   (d)  the loader's `has()` / `capability()` answers agree with the shipped table for this
 *        kernel: every capability the table REFUSES answers not-usable (has false, capability
 *        throwing an error that carries its own name), no row answers has-true-and-throws or
 *        has-false-and-returns, and a resolve row that answers false names one of the services or
 *        members that row itself binds - so the answer is tied to the table, not to opinion.
 *   (a2) the same pipeline through the loader's own role word `registerRoute` (README:26,95;
 *        R1-compat.md:44,121). Added so a red (a) cannot be blamed on the pipeline: if (a2) is
 *        green and (a) is red, the defect is the NAME of the member, not the row, the world or
 *        the route.
 *
 * Offline: no CDP, no client start/stop, no model round, no live port (31761/31760/9222 are never
 * touched). The only socket is a throwaway kernel's own webServer bound to 127.0.0.1 port 0
 * (OS-assigned) inside a temp home, asked by ONE loopback GET from this process: the world publishes
 * the bound port, this file asks the route and hands the answer back to the world's own record, so
 * the 200 is a status line a client read, not a handler called by hand.
 * Deterministic: fixed route, fixed bodies, no clock in any answer, a fresh home per world.
 *
 * Usage: node scripts/verify-compat-consumer.mjs [--keep]
 * Exit codes: 0 every reading held; 1 a reading failed; 3 a reading could not be taken (a named
 * world or input gap, never reported as green).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadCompatModule } from '../compat/load.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const KERNEL = resolve(process.env.DSH_LINK_KERNEL ?? join(PROJECT, 'core', 'deepseek-harness'))
const PLUGIN_LIB = join(PROJECT, 'plugins', 'dsh-link-compat', 'lib', 'index.js')
const PLUGIN_URL = pathToFileURL(PLUGIN_LIB).href
const WEBSERVER_LIB = join(KERNEL, 'packages', 'host', 'webserver', 'lib', 'index.js')
const WEBSERVER_URL = pathToFileURL(WEBSERVER_LIB).href
const PROFILE_BOOT = pathToFileURL(join(KERNEL, 'apps', 'cli', 'src', 'profile-boot.ts')).href
const APP_BOOT = pathToFileURL(join(KERNEL, 'packages', 'boot', 'app-boot', 'src', 'index.ts')).href
const KEEP = process.argv.includes('--keep')
const PROFILE = 'r197consumer'
const TEMPLATE = 'headless'
const ROUTE = '/api/r197-compat-consumer/state'
const FIXTURE = 'r197-compat-consumer'
const BODY = { ok: true, fixture: FIXTURE, capability: 'http', via: 'link.compat', route: ROUTE }
const NL = String.fromCharCode(10)

/* ------------------------------------------------------------------ readings */

const readings = []
const reading = (id, name, verdict, detail, evidence) => {
  readings.push({ id, name, verdict, detail, evidence: evidence ?? [] })
  const tag = verdict === 'green' ? 'ok  ' : verdict === 'red' ? 'FAIL' : 'NM  '
  console.log('  ' + tag + '  (' + id + ') ' + name + ' — ' + detail)
  for (const line of evidence ?? []) console.log('        ' + line)
  return verdict
}
const green = (id, name, detail, evidence) => reading(id, name, 'green', detail, evidence)
const red = (id, name, detail, evidence) => reading(id, name, 'red', detail, evidence)
const unmeasured = (id, name, detail, evidence) => reading(id, name, 'unmeasured', detail, evidence)
const section = (title) => { console.log(''); console.log(title) }
const clip = (text, n) => (text === null || text === undefined ? String(text) : (String(text).length > n ? String(text).slice(0, n) + '…' : String(text)))
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/* ------------------------------------------------------------------ inputs */

const compat = await loadCompatModule()
// R218: judge the section that describes the PINNED kernel. With the pin at 0.2.1-alpha.1 this was TABLES[0];
// after the move to 0.2.1-alpha.5 the loader reports the new kernel while TABLES[0] still described the old
// one, so reading (d) - "the answers agree with the table FOR THIS KERNEL" - compared two kernels.
const PINNED_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(PROJECT, 'core', 'deepseek-harness', 'package.json'), 'utf8')).version } catch (error) { return null }
})()
const table = (PINNED_VERSION === null ? undefined : compat.tableFor(PINNED_VERSION)) ?? compat.TABLES[0]
const refusedRows = table === undefined ? [] : Object.keys(table.refused)
const resolveRows = table === undefined ? [] : Object.keys(table.capabilities)
/** The services the loader itself premises on, derived the way the plugin derives them. */
const premises = (() => {
  const needed = new Set()
  if (table === undefined) return []
  for (const row of Object.values(table.refused)) for (const witness of row.witness) needed.add(witness.service)
  return [...needed].sort()
})()

/* ------------------------------------------------- the fixtures and the driver */

/**
 * The consumer. `word` selects the one member it registers through; nothing else differs.
 *
 * Every failure it can record names the capability it was asking for, because a consumer that
 * dies on `undefined.compat` tells an operator nothing about which capability the composition
 * could not serve (R197 P2: absence is a named fact, never a crash).
 */
const consumerSource = (word) => `import { appendFileSync } from 'node:fs'

export const name = 'r197-compat-consumer'
const ROUTE = ${JSON.stringify(ROUTE)}
const CAPABILITY = 'http'
const BODY = ${JSON.stringify(BODY)}
const nl = String.fromCharCode(10)
const note = (record) => appendFileSync(process.env.R197_MARKERS, JSON.stringify(record) + nl)

/**
 * Ask the loader for a capability by name: ctx.link.compat.capability(name), read at the moment
 * of registration and never injected.
 */
function ask(ctx, name) {
  // ctx.get(name) is the kernel's documented read for an optional service: the property spelling
  // ctx.link is not readable without an inject entry, and this plugin has none. What the property
  // read answers is recorded rather than assumed, because it is the read the contract names.
  let property = null
  try {
    void ctx.link
    property = 'readable'
  } catch (error) {
    property = 'threw: ' + String(error && error.message ? error.message : error)
  }
  note({ event: 'link-property', name: name, property: property })
  let link
  let raw = null
  try {
    link = typeof ctx.get === 'function' ? ctx.get('link') : undefined
  } catch (error) {
    link = undefined
    raw = 'reading ctx.get("link") threw: ' + String(error && error.message ? error.message : error)
  }
  const compat = link === null || link === undefined ? undefined : link.compat
  if (compat === null || compat === undefined || typeof compat.capability !== 'function') {
    const error = new Error('compat consumer: capability "' + name + '" is unavailable because ctx.link.compat is absent in this composition')
    error.capability = name
    error.because = raw === null ? 'ctx.get("link") answered ' + String(link) + ', so there is no compat face to ask' : raw
    throw error
  }
  return compat.capability(name)
}

function handler(request, response) {
  const text = JSON.stringify(BODY)
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(text)) })
  response.end(text)
}

let registered = false

/** The ONLY registration path this fixture has: the compat capability, then one member of it. */
function register(ctx) {
  if (registered) return true
  const http = ask(ctx, CAPABILITY)
  // Exactly the call the contract names: capability('http'), then the one member.
  const member = http.${word}
  if (typeof member !== 'function') {
    const error = new TypeError('the "' + CAPABILITY + '" capability has no callable "${word}" member (its keys are ' + Object.keys(http).join(', ') + ')')
    error.capability = CAPABILITY
    throw error
  }
  const disposer = member({ kind: 'exact', path: ROUTE, handler })
  registered = true
  note({ event: 'registered', capability: CAPABILITY, member: '${word}', keys: Object.keys(http), disposer: typeof disposer })
  if (typeof ctx.effect === 'function') ctx.effect(() => () => { registered = false; if (typeof disposer === 'function') disposer() })
  return true
}

function attempt(ctx) {
  try {
    register(ctx)
    return true
  } catch (error) {
    note({
      event: 'registration-failed',
      capability: CAPABILITY,
      member: '${word}',
      name: String(error && error.name ? error.name : typeof error),
      message: String(error && error.message ? error.message : error),
      because: error && error.because ? String(error.because) : null,
    })
    return false
  }
}

export function apply(ctx) {
  if (attempt(ctx)) return
  // This row can be applied before the compat row has published; a loader that appears later gets
  // exactly one retry. A world without a loader leaves the recorded failure as the last outcome.
  if (typeof ctx.inject === 'function') ctx.inject(['link'], () => { attempt(ctx) })
}
`

/** The calibration row: if this does not mount, the world never reached the mount stage. */
const calibrationSource = `import { appendFileSync } from 'node:fs'

export const name = 'r197-calibration'
const nl = String.fromCharCode(10)

export function apply(ctx) {
  appendFileSync(process.env.R197_MARKERS, JSON.stringify({ event: 'calibration-mounted' }) + nl)
}
`

/** The driver: boots the throwaway profile, reads the live context, asks the route, records JSON. */
const driverSource = `import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const observation = { identity: {}, boot: null, webserver: null, link: null, report: null, probes: {}, get: null, errors: [] }
const fact = (error) => ({
  name: error && error.name ? String(error.name) : null,
  message: String(error && error.message ? error.message : error),
  capability: error && error.capability !== undefined ? String(error.capability) : null,
})

const main = async () => {
  observation.identity = { cwd: process.cwd(), node: process.version, profile: process.env.R197_PROFILE, home: process.env.DSH_HOME }
  const appBoot = await import(process.env.R197_APP_BOOT)
  const profileBoot = await import(process.env.R197_PROFILE_BOOT)
  let result = null
  try {
    result = await profileBoot.runProfile({ environment: appBoot.loadLayeredEnv('dsh'), profile: process.env.R197_PROFILE, patchFiles: [], args: [] })
  } catch (error) {
    observation.boot = { settled: false, error: fact(error) }
  }
  if (result === null) return
  observation.boot = { settled: true }
  const ctx = result.ctx
  const read = (name) => {
    try {
      return { present: true, value: ctx.reflect.get(name, false) }
    } catch (error) {
      return { present: false, error: fact(error) }
    }
  }
  // R73 alive-control: this gate really boots a throwaway kernel and holds ctx, so it can answer the
  // aliveness question from a ROOT-PROVIDED service instead of asserting it.
  const rootAlive = (() => { try { return ctx.reflect.get('dshHomePath', false) !== undefined } catch { return false } })()
  observation.control = { rootAlive }
  const held = (read) => read.present === true && read.value !== undefined && read.value !== null
  const server = read('webServer')
  observation.webserver = held(server) && typeof server.value === 'object'
    ? { present: true, host: String(server.value.host === undefined ? '' : server.value.host), port: Number(server.value.port) }
    : { present: false, read: { present: server.present, value: String(server.value) }, error: server.error === undefined ? null : server.error }
  const link = read('link')
  const linkValue = held(link) ? link.value : undefined
  const linkIsObject = linkValue !== undefined && linkValue !== null && typeof linkValue === 'object'
  const compatFace = linkIsObject && linkValue.compat ? linkValue.compat : null
  observation.link = { present: linkValue !== undefined, isObject: linkIsObject, keys: linkIsObject ? Object.keys(linkValue) : null, hasCompat: compatFace !== null, readPresent: link.present, error: link.present ? null : link.error }
  if (compatFace !== null) {
    observation.link.compatKeys = Object.keys(compatFace)
    try {
      const report = compatFace.report()
      observation.report = {
        kernel: report.kernel,
        resolved: report.resolved,
        refused: report.refused,
        refusedSemanticChanged: report.refusedSemanticChanged,
        refusedAbsent: report.refusedAbsent,
        staleRefusals: report.staleRefusals,
        rows: (report.rows || []).map((row) => ({ capability: row.capability, status: row.status, failures: row.failures })),
      }
    } catch (error) {
      observation.report = { threw: fact(error) }
    }
    for (const name of JSON.parse(process.env.R197_NAMES)) {
      const entry = { has: null, outcome: null, keys: null, error: null }
      try {
        entry.has = compatFace.has(name)
      } catch (error) {
        entry.has = 'threw'
        entry.error = fact(error)
      }
      try {
        const value = compatFace.capability(name)
        entry.outcome = 'returned'
        entry.keys = value !== null && value !== undefined && typeof value === 'object' ? Object.keys(value) : null
      } catch (error) {
        entry.outcome = 'threw'
        entry.error = fact(error)
      }
      observation.probes[name] = entry
    }
  }
  // The route is asked from OUTSIDE this process: the kernel's own boot fences outbound connections
  // (a loopback GET from in here is reset, measured), and the reading belongs to a client asking the
  // route anyway. So the driver publishes what it read (including the bound port), waits for the
  // caller to hand the answer back, and records that answer as its own observation.
  writeFileSync(process.env.R197_READY, JSON.stringify(observation), 'utf8')
  const deadline = Date.now() + 180000
  while (!existsSync(process.env.R197_RELEASE) && Date.now() < deadline) {
    await new Promise((rest) => setTimeout(rest, 50))
  }
  try {
    observation.get = JSON.parse(readFileSync(process.env.R197_RELEASE, 'utf8'))
  } catch (error) {
    observation.get = { missing: 'no answer was handed back: ' + String(error && error.message ? error.message : error) }
  }
  try {
    await ctx.fiber.dispose()
  } catch (error) {
    observation.errors.push(fact(error))
  }
}

try { await main() } catch (error) { observation.errors.push(fact(error)) }
try {
  writeFileSync(process.env.R197_OBSERVATION, JSON.stringify(observation, null, 2), 'utf8')
} catch (error) { /* the observation is best effort; the gate reports its absence as a named gap */ }
process.exit(0)
`

/* ------------------------------------------------------------------ the worlds */

const initScript = 'import { initializeProfileFromDefault } from ' + JSON.stringify(PROFILE_BOOT) + NL
  + 'try {' + NL
  + '  initializeProfileFromDefault(process.env.R197_PROFILE, ' + JSON.stringify(TEMPLATE) + ', process.env.DSH_HOME)' + NL
  + "  process.stdout.write('OK')" + NL
  + '} catch (error) {' + NL
  + "  process.stdout.write('FAIL ' + String(error && error.message ? error.message : error))" + NL
  + '}' + NL

const markerEvents = (text) => String(text ?? '').split(/\r?\n/).filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)] } catch { return [{ event: 'unparseable-marker-line', line: line.slice(0, 200) }] }
})

/**
 * One throwaway kernel world.
 *
 * @param spec.withRow - mount the SHIPPED compat plugin as a row (its own file URL, its defaults).
 * @param spec.word - which member of the `http` capability the fixture registers through.
 */
async function runWorld(spec) {
  const home = mkdtempSync(join(tmpdir(), 'r197-' + spec.id + '-'))
  const record = { id: spec.id, withRow: spec.withRow, word: spec.word, home, init: null, exit: null, ms: 0, stdout: '', stderr: '', events: [], markerText: '', observation: null, rows: [] }
  const profileDir = join(home, 'profiles', PROFILE)
  const consumerFile = 'r197-consumer-' + spec.word + '.mjs'
  try {
    writeFileSync(join(home, 'init.mjs'), initScript, 'utf8')
    const initRun = spawnSync(process.execPath, ['--import', 'tsx/esm', join(home, 'init.mjs')], {
      cwd: KERNEL, encoding: 'utf8', timeout: 180000, env: { ...process.env, DSH_HOME: home, R197_PROFILE: PROFILE },
    })
    record.init = { exit: initRun.status, text: clip(((initRun.stdout ?? '') + (initRun.stderr ?? '')).trim(), 300) }
    if (!String(initRun.stdout ?? '').startsWith('OK')) return record

    writeFileSync(join(profileDir, 'r197-calibration.mjs'), calibrationSource, 'utf8')
    writeFileSync(join(profileDir, consumerFile), consumerSource(spec.word), 'utf8')

    const rows = [
      { insert: [{ id: 'r197-calibration', name: './r197-calibration.mjs' }] },
      { insert: [{ id: 'r197-webserver', name: WEBSERVER_URL, config: { host: '127.0.0.1', port: 0 } }] },
    ]
    if (spec.withRow) {
      // The loader premises on the services its refusal witnesses observe, plus webServer, which the
      // `http` capability binds to: without that one the loader would judge `http` before the
      // server exists and refuse it for a reason that belongs to the mount order, not the table.
      rows.push({ insert: [{ id: 'dsh-link-compat', name: PLUGIN_URL, inject: [...premises, 'webServer'] }] })
    }
    rows.push({ insert: [{ id: 'r197-consumer', name: './' + consumerFile }] })
    record.rows = rows
    writeFileSync(join(profileDir, 'cordis.patch.yml'), JSON.stringify(rows, null, 2) + NL, 'utf8')

    const markerPath = join(home, 'markers.jsonl')
    const observationPath = join(home, 'observation.json')
    const readyPath = join(home, 'ready.json')
    const releasePath = join(home, 'release.json')
    writeFileSync(markerPath, '', 'utf8')
    writeFileSync(join(home, 'run.mjs'), driverSource, 'utf8')
    const started = Date.now()
    const child = spawn(process.execPath, ['--import', 'tsx/esm', join(home, 'run.mjs')], {
      cwd: KERNEL,
      env: {
        ...process.env,
        DSH_HOME: home,
        R197_PROFILE: PROFILE,
        R197_APP_BOOT: APP_BOOT,
        R197_PROFILE_BOOT: PROFILE_BOOT,
        R197_MARKERS: markerPath,
        R197_OBSERVATION: observationPath,
        R197_READY: readyPath,
        R197_RELEASE: releasePath,
        R197_ROUTE: ROUTE,
        R197_NAMES: JSON.stringify([...resolveRows, ...refusedRows]),
      },
    })
    const chunks = { out: '', err: '' }
    child.stdout.on('data', (chunk) => { chunks.out += chunk })
    child.stderr.on('data', (chunk) => { chunks.err += chunk })
    const exited = new Promise((settle) => child.on('exit', (code) => settle(code)))
    const ready = await waitForFile(readyPath, 240000, exited)
    let answer = null
    if (ready !== null) {
      const port = Number(ready.webserver?.port ?? 0)
      answer = port > 0 ? await askRoute(port) : { missing: 'the world published no bound port' }
      writeFileSync(releasePath, JSON.stringify(answer), 'utf8')
    }
    record.exit = await exited
    record.ms = Date.now() - started
    record.stdout = chunks.out
    record.stderr = chunks.err
    record.markerText = readFileSync(markerPath, 'utf8')
    record.events = markerEvents(record.markerText)
    record.observation = existsSync(observationPath) ? JSON.parse(readFileSync(observationPath, 'utf8')) : null
    return record
  } finally {
    if (!KEEP) rmSync(home, { recursive: true, force: true })
  }
}

/** Wait until a file the driver writes appears, the child exits, or the budget runs out. */
async function waitForFile(path, timeoutMs, exited) {
  const deadline = Date.now() + timeoutMs
  let childExited = false
  exited.then(() => { childExited = true })
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try { return JSON.parse(readFileSync(path, 'utf8')) } catch (error) { return null }
    }
    if (childExited) return null
    await new Promise((rest) => setTimeout(rest, 50))
  }
  return null
}

/**
 * Ask the fixture's route over loopback, from THIS process.
 *
 * The world's own process fences outbound connections (a GET from inside it is reset, measured),
 * so the client lives here: one HTTP GET to 127.0.0.1 on the port the throwaway kernel published.
 */
function askRoute(port) {
  return new Promise((settle) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: ROUTE, method: 'GET' }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => settle({ status: response.statusCode ?? 0, contentType: response.headers['content-type'] ?? null, body: body.slice(0, 700) }))
    })
    request.on('error', (error) => settle({ threw: { name: error?.name ?? null, message: String(error?.message ?? error) }, code: error?.code ?? null }))
    request.setTimeout(20000, () => { request.destroy(new Error('the route did not answer within 20s')) })
    request.end()
  })
}

/* ------------------------------------------------------------------ main */

const missing = []
if (!existsSync(PLUGIN_LIB)) missing.push('built plugin ' + PLUGIN_LIB + ' (run node plugins/build.mjs)')
if (!existsSync(WEBSERVER_LIB)) missing.push('kernel webserver ' + WEBSERVER_LIB)
if (!existsSync(join(KERNEL, 'apps', 'cli', 'src', 'profile-boot.ts'))) missing.push('kernel CLI ' + join(KERNEL, 'apps', 'cli', 'src', 'profile-boot.ts'))
if (!existsSync(join(KERNEL, 'node_modules', 'tsx'))) missing.push('tsx under ' + join(KERNEL, 'node_modules'))
if (table === undefined) missing.push('a compat table section in this build')

console.log('R197 gate 132 — compat-consumer (OFFLINE)')
console.log('  kernel       ' + KERNEL)
console.log('  plugin       plugins/dsh-link-compat/lib/index.js sha256 ' + (existsSync(PLUGIN_LIB) ? sha256(PLUGIN_LIB) : 'absent'))
console.log('  table        ' + String(table?.kernel) + ' — ' + String(resolveRows.length) + ' resolve/translate rows, ' + String(refusedRows.length) + ' refused rows')
console.log('  loader premises (refusal witnesses)  ' + JSON.stringify(premises))
console.log('  route        ' + ROUTE + '  (fixture ' + FIXTURE + ')')
console.log('  worlds       three throwaway homes from the shipped "' + TEMPLATE + '" template; no client, no live port, no model round')

if (missing.length > 0) {
  console.log('')
  console.log('NOT MEASURED — the worlds cannot be built here; missing:')
  for (const item of missing) console.log('  - ' + item)
  console.log('nothing was verified; this is an input gap, not a pass.')
  section('summary')
  console.log('0 readings, 0 green, 0 red, 0 not measured (inputs missing)')
  console.log('NOT MEASURED — ' + String(missing.length) + ' input(s) missing')
  process.exit(3)
}

const worlds = {}
for (const spec of [
  { id: 'with-row-register', withRow: true, word: 'register' },
  { id: 'with-row-registerRoute', withRow: true, word: 'registerRoute' },
  { id: 'no-row-register', withRow: false, word: 'register' },
]) {
  console.log('')
  console.log('== world ' + spec.id + ' (compat row ' + (spec.withRow ? 'mounted' : 'ABSENT') + '; fixture registers through "' + spec.word + '")')
  const world = await runWorld(spec)
  worlds[spec.id] = world
  console.log('   home ' + world.home + (KEEP ? ' (kept)' : ' (removed)'))
  console.log('   profile init ' + clip(String(world.init?.text), 160))
  console.log('   boot exit ' + String(world.exit) + ' in ' + String(world.ms) + 'ms, ' + String(world.events.length) + ' marker event(s)' + (world.observation === null ? ', NO observation file' : ''))
  for (const event of world.events) console.log('   marker ' + clip(JSON.stringify(event), 300))
  if (world.observation !== null) {
    console.log('   observation.boot ' + clip(JSON.stringify(world.observation.boot), 220))
    console.log('   observation.webserver ' + clip(JSON.stringify(world.observation.webserver), 220))
    console.log('   observation.link ' + clip(JSON.stringify(world.observation.link), 300))
    console.log('   observation.get  ' + clip(JSON.stringify(world.observation.get), 300))
  }
  if (String(world.stderr).trim() !== '') console.log('   stderr tail ' + clip(String(world.stderr).trim().split(/\r?\n/).slice(-6).join(' | '), 400))
}

const getWorld = (id) => worlds[id] ?? null
const settled = (run) => run !== null && run.observation !== null && run.observation.boot !== null && run.observation.boot.settled === true
const calibrated = (run) => run !== null && run.events.some((event) => event.event === 'calibration-mounted')
const route = (run) => (run === null || run.observation === null ? null : run.observation.get)
const answeredBody = (response) => response !== null && response !== undefined && response.status === 200 && typeof response.body === 'string' && response.body.includes('"fixture":"' + FIXTURE + '"')
const lastOutcome = (run) => {
  const relevant = (run?.events ?? []).filter((event) => event.event === 'registered' || event.event === 'registration-failed')
  return relevant.length === 0 ? null : relevant[relevant.length - 1]
}
const httpKeys = (run) => {
  const probe = run?.observation?.probes?.http
  return probe !== undefined && Array.isArray(probe.keys) ? probe.keys : null
}
const bootFailure = (run) => clip(JSON.stringify(run?.observation?.boot?.error ?? String(run?.stderr ?? '').trim().slice(-300)), 240)

section('readings')

/* (a) the contract-named call, with the shipped row */
{
  const name = "with the shipped compat row, the route answers 200 through capability('http').registerRoute(...) - THE ROLE WORD, which is how the handle is keyed"
  const run = getWorld('with-row-registerRoute')
  const evidence = []
  if (run === null) unmeasured('a', name, 'the world was not run', evidence)
  else {
    evidence.push('rows: ' + clip(JSON.stringify(run.rows), 420))
    evidence.push("capability('http') keys in that kernel: " + JSON.stringify(httpKeys(run)))
    evidence.push('fixture recorded: ' + clip(JSON.stringify(lastOutcome(run)), 320))
    evidence.push('GET ' + ROUTE + ' -> ' + clip(JSON.stringify(route(run)), 320))
    if (run.observation === null) unmeasured('a', name, 'the driver recorded no observation (boot exit ' + String(run.exit) + '): ' + clip(String(run.stderr).trim().slice(-240), 240), evidence)
    else if (!calibrated(run)) unmeasured('a', name, 'the calibration row did not mount, so the world never reached the mount stage (boot ' + String(run.exit) + ', ' + clip(String(run.stderr).trim().slice(-200), 200) + ')', evidence)
    else if (!settled(run)) red('a', name, 'the boot did not settle: ' + bootFailure(run), evidence)
    else if (answeredBody(route(run))) green('a', name, "HTTP 200 with the fixture's own body — the contract-named call registered the route", evidence)
    else red('a', name, 'the route did not answer 200 with the fixture\'s body (status ' + String(route(run) === null ? 'none' : route(run).status) + ')', evidence)
  }
}

/* (a3) the SAME row, asked with the table's kernel member word: refused BY NAME, never silently accepted */
{
  const name = "the wrong member word ('register', the table's kernel member name) is refused by name, and the capability's real keys are printed"
  const run = getWorld('with-row-register')
  const evidence = []
  if (run === null) unmeasured('a3', name, 'the world was not run', evidence)
  else {
    const failure = (run.events ?? []).filter((event) => event.event === 'registration-failed').slice(-1)[0] ?? null
    const registered = (run.events ?? []).some((event) => event.event === 'registered')
    evidence.push("capability('http') keys in that kernel: " + JSON.stringify(httpKeys(run)))
    evidence.push('fixture recorded: ' + clip(JSON.stringify(failure), 340))
    evidence.push('a "registered" marker is present: ' + String(registered))
    evidence.push('GET ' + ROUTE + ' -> ' + clip(JSON.stringify(route(run)), 220))
    if (run.observation === null) unmeasured('a3', name, 'the driver recorded no observation (boot exit ' + String(run.exit) + ')', evidence)
    else if (!calibrated(run)) unmeasured('a3', name, 'the calibration row did not mount, so this world never reached the mount stage', evidence)
    else if (!settled(run)) red('a3', name, 'the boot did not settle: ' + bootFailure(run), evidence)
    else {
      const keys = httpKeys(run)
      const message = String(failure === null ? '' : failure.message ?? '')
      const problems = []
      if (registered) problems.push('the wrong word was SILENTLY accepted: a "registered" marker exists')
      if (answeredBody(route(run))) problems.push('the route answers 200 through the wrong word, so the member name is not what the handle is keyed by')
      if (failure === null) problems.push('no registration-failed event was recorded')
      if (failure !== null && failure.name !== 'TypeError') problems.push('the refusal is ' + String(failure.name) + ', not the TypeError the fixture raises at the missing member')
      if (failure !== null && failure.capability !== 'http') problems.push('the refusal does not name the capability: ' + clip(JSON.stringify(failure), 200))
      if (Array.isArray(keys) && message !== '' && keys.some((key) => message.includes(key) === false)) problems.push('the refusal text does not print the keys the handle really carries (' + JSON.stringify(keys) + '): ' + clip(message, 200))
      if (problems.length > 0) red('a3', name, problems.join(' | '), evidence)
      else green('a3', name, "the wrong word is refused with a TypeError that names the capability and prints its real keys " + JSON.stringify(keys) + ', and nothing was registered', evidence)
    }
  }
}

/* (b) without the row: a named failure, and no route */
{
  const name = "without the compat row the fixture's registration fails with an error that NAMES the capability http"
  const run = getWorld('no-row-register')
  const evidence = []
  if (run === null) unmeasured('b', name, 'the world was not run', evidence)
  else {
    const failure = (run.events ?? []).filter((event) => event.event === 'registration-failed').slice(-1)[0] ?? null
    const registered = (run.events ?? []).some((event) => event.event === 'registered')
    evidence.push('ctx.link in that kernel: ' + clip(JSON.stringify(run.observation?.link ?? null), 260))
    evidence.push('fixture recorded: ' + clip(JSON.stringify(failure), 340))
    evidence.push('a "registered" marker is present: ' + String(registered))
    evidence.push('the fixture records the failure instead of rethrowing, so this world stays alive to show the route is ABSENT (a row that threw would take the server down with it)')
    evidence.push('GET ' + ROUTE + ' -> ' + clip(JSON.stringify(route(run)), 260))
    if (run.observation === null) unmeasured('b', name, 'the driver recorded no observation (boot exit ' + String(run.exit) + ')', evidence)
    else if (!calibrated(run)) unmeasured('b', name, 'the calibration row did not mount, so the world never reached the mount stage (boot ' + String(run.exit) + ')', evidence)
    else if (!settled(run)) red('b', name, 'the boot did not settle: ' + bootFailure(run), evidence)
    else if (run.observation.link.present !== false) unmeasured('b', name, 'this world is not loader-free (ctx.link was published), so the absence this reading needs cannot be measured here', evidence)
    else if (registered || (route(run) !== null && route(run).status === 200)) red('b', name, 'the fixture reports a silent success without the loader (a "registered" marker or a 200), which is exactly what this reading excludes', evidence)
    else if (failure === null) red('b', name, 'the fixture recorded no registration failure at all', evidence)
    else if (failure.capability !== 'http' || !/(^|[^a-z])http([^a-z]|$)/.test(String(failure.message))) red('b', name, 'the failure does not name the capability http: ' + clip(String(failure.message), 200), evidence)
    else if (/Cannot read propert/i.test(String(failure.message))) red('b', name, 'the failure is a bare property TypeError that never names the capability: ' + clip(String(failure.message), 200), evidence)
    else if (route(run) === null || route(run).status !== 404) red('b', name, 'the route is not demonstrably absent (expected 404, got ' + String(route(run) === null ? 'no reading' : route(run).status) + ')', evidence)
    else green('b', name, String(failure.name) + ' naming "http" (capability field "http"), and the same route answers 404 because nothing registered it', evidence)
  }
}

/* (c) the fixture's own bytes */
{
  const name = "the fixture's own source carries no ctx.server.register (and no other server access path)"
  const written = [
    { word: 'register', file: 'r197-consumer-register.mjs' },
    { word: 'registerRoute', file: 'r197-consumer-registerRoute.mjs' },
  ]
  const forbidden = [
    { label: 'ctx.server.register', pattern: /ctx\s*\.\s*server\s*\.\s*register/ },
    { label: 'server.register', pattern: /\.\s*server\s*\.\s*register/ },
    { label: "ctx.webServer / ctx.get('webServer')", pattern: /ctx\s*\.\s*webServer|ctx\s*\.\s*get\s*\(\s*['"]webServer['"]\s*\)/ },
    { label: 'registerFallback / registerUpgrade', pattern: /registerFallback|registerUpgrade/ },
  ]
  const required = [/compat\s*\.\s*capability\s*\(/, /ctx\s*\.\s*get\s*\(\s*['"]link['"]\s*\)/, /CAPABILITY\s*=\s*['"]http['"]/]
  const evidence = []
  let bytes = 0
  let violations = 0
  let carriesCompatCall = true
  // The bytes on disk, not the string this file holds in memory: the fixtures are written to a
  // throwaway directory and read back, so what is scanned is what a world would have loaded.
  const scratch = mkdtempSync(join(tmpdir(), 'r197-fixtures-'))
  try {
    for (const entry of written) {
      const path = join(scratch, entry.file)
      writeFileSync(path, consumerSource(entry.word), 'utf8')
      const text = readFileSync(path, 'utf8')
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
      const size = readFileSync(path).length
      bytes += size
      const found = forbidden.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label)
      if (found.length > 0) violations += 1
      if (!required.every((pattern) => pattern.test(text))) carriesCompatCall = false
      evidence.push(entry.file + ': ' + String(size) + ' bytes read from disk, sha256 ' + digest.slice(0, 16) + ', forbidden matches: ' + (found.length === 0 ? 'none' : found.join(', ')))
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  evidence.push('the compat path is present in every fixture (ctx.get(\'link\'), its compat capability call, the http capability name): ' + String(carriesCompatCall))
  evidence.push('forbidden set — ' + forbidden.map((rule) => rule.label).join(' | '))
  if (violations > 0) red('c', name, String(violations) + ' fixture file(s) reach the server directly, so the compat capability would not be the only registration path', evidence)
  else if (!carriesCompatCall) red('c', name, 'a fixture does not carry the compat call at all, so "only path" would be true by accident', evidence)
  else green('c', name, "both fixture files carry the compat call and no direct server access (" + String(bytes) + ' bytes read)', evidence)
}

/* (d) has()/capability() against the table */
{
  const name = "the loader's has()/capability() answers agree with the table for this kernel"
  const run = getWorld('with-row-registerRoute')
  const evidence = []
  if (run === null) unmeasured('d', name, 'the world was not run', evidence)
  else if (run.observation === null) unmeasured('d', name, 'the driver recorded no observation (boot exit ' + String(run.exit) + ')', evidence)
  else if (!calibrated(run)) unmeasured('d', name, 'the calibration row did not mount, so this world never reached the mount stage', evidence)
  else if (!settled(run)) red('d', name, 'the boot did not settle: ' + bootFailure(run), evidence)
  else if (run.observation.link.hasCompat !== true) red('d', name, 'no ctx.link.compat in this world, so there is no loader to ask', evidence)
  else {
    const probes = run.observation.probes
    const report = run.observation.report ?? {}
    const problems = []
    if (report.kernel !== table.kernel) problems.push('the loader judged "' + String(report.kernel) + '" but the table under test is "' + table.kernel + '"')
    if (Array.isArray(report.staleRefusals) && report.staleRefusals.length > 0) problems.push('stale refusals at load: ' + report.staleRefusals.join(', '))
    const usable = []
    const unusable = []
    for (const rowName of resolveRows) {
      const probe = probes[rowName]
      const row = table.capabilities[rowName]
      if (probe === undefined) { problems.push(rowName + ': no answer recorded'); continue }
      if (probe.has === true && probe.outcome === 'returned') { usable.push(rowName); continue }
      if (probe.has !== false || probe.outcome !== 'threw') { problems.push(rowName + ': answered neither usable nor a refusal (has ' + JSON.stringify(probe.has) + ', capability ' + String(probe.outcome) + ')'); continue }
      unusable.push(rowName)
      const reason = String(probe.error?.message ?? '')
      const parts = row.targets.map((target) => target.service).concat(row.targets.flatMap((target) => target.binds.map((bind) => bind.member)))
      if (probe.error?.capability !== rowName) problems.push(rowName + ': the refusal does not carry the capability name')
      if (!reason.includes(rowName)) problems.push(rowName + ': the refusal message does not name the capability')
      if (row.self !== true && !parts.some((part) => reason.includes(part))) problems.push(rowName + ': answered unusable without naming any service or member this row binds (' + parts.join(', ') + ')')
    }
    for (const rowName of refusedRows) {
      const probe = probes[rowName]
      if (probe === undefined) { problems.push(rowName + ': no answer recorded'); continue }
      if (probe.has !== false) problems.push(rowName + ': the table refuses it, but has() answered ' + JSON.stringify(probe.has))
      if (probe.outcome !== 'threw') problems.push(rowName + ': the table refuses it, but capability() returned a value')
      if (probe.error?.capability !== rowName) problems.push(rowName + ': the refusal does not carry the capability name')
      if (!String(probe.error?.message ?? '').includes(rowName)) problems.push(rowName + ': the refusal message does not name the capability')
      const counted = (Array.isArray(report.refused) && report.refused.includes(rowName)) || (Array.isArray(report.staleRefusals) && report.staleRefusals.includes(rowName))
      if (!counted) problems.push(rowName + ': the refusal is not counted by report() (refused or staleRefusals)')
    }
    for (const rowName of [...resolveRows, ...refusedRows]) {
      const probe = probes[rowName]
      if (probe === undefined) continue
      if (probe.has !== true && probe.has !== false) problems.push(rowName + ': has() did not answer a boolean')
      if (probe.has === true && probe.outcome === 'threw') problems.push(rowName + ': has() true but capability() threw')
      if (probe.has === false && probe.outcome === 'returned') problems.push(rowName + ': has() false but capability() returned')
    }
    evidence.push('report: kernel ' + String(report.kernel) + ', resolved ' + String((report.resolved ?? []).length) + ', refused ' + String((report.refused ?? []).length) + ', stale ' + String((report.staleRefusals ?? []).length))
    evidence.push('usable rows: ' + (usable.length === 0 ? '(none)' : usable.join(', ')))
    evidence.push('unusable rows here: ' + (unusable.length === 0 ? '(none)' : unusable.join(', ')))
    for (const rowName of refusedRows) evidence.push('refused row ' + rowName + ': has ' + JSON.stringify(probes[rowName]?.has) + ', capability ' + String(probes[rowName]?.outcome) + ' — ' + clip(String(probes[rowName]?.error?.message ?? ''), 170))
    for (const rowName of unusable) evidence.push('unusable resolve row ' + rowName + ': ' + clip(String(probes[rowName]?.error?.message ?? ''), 210))
    if (problems.length > 0) red('d', name, problems.slice(0, 3).join(' | '), evidence)
    else green('d', name, 'every refused row answers not-usable and names itself (' + String(refusedRows.length) + ' of them), and every other answer is tied to the row it belongs to (' + String(usable.length) + ' usable, ' + String(unusable.length) + ' refused because this composition lacks what the row binds)', evidence)
  }
}

/* (a2) the same pipeline through the loader's own role word */
{
  const name = "the same compat pipeline through the loader's role word registerRoute answers 200"
  const run = getWorld('with-row-registerRoute')
  const evidence = []
  if (run === null) unmeasured('a2', name, 'the world was not run', evidence)
  else {
    evidence.push("capability('http') keys in that kernel: " + JSON.stringify(httpKeys(run)))
    evidence.push('fixture recorded: ' + clip(JSON.stringify(lastOutcome(run)), 340))
    evidence.push('GET ' + ROUTE + ' -> ' + clip(JSON.stringify(route(run)), 320))
    if (run.observation === null) unmeasured('a2', name, 'the driver recorded no observation (boot exit ' + String(run.exit) + ')', evidence)
    else if (!calibrated(run) || !settled(run)) unmeasured('a2', name, 'the world did not reach a settled mount (calibration ' + String(calibrated(run)) + ', settled ' + String(settled(run)) + ')', evidence)
    else if (answeredBody(route(run))) green('a2', name, "HTTP 200 with the fixture's own body — the row, the world and the route are sound, so a red (a) is the NAME of the member, not the pipeline", evidence)
    else red('a2', name, 'the route did not answer 200 with the fixture\'s body (status ' + String(route(run) === null ? 'none' : route(run).status) + ')', evidence)
  }
}

/* ------------------------------------------------------------------ summary */

const counted = readings.reduce((tally, entry) => { tally[entry.verdict] += 1; return tally }, { green: 0, red: 0, unmeasured: 0 })
section('summary')
for (const entry of readings) console.log('  ' + (entry.verdict === 'green' ? 'green        ' : entry.verdict === 'red' ? 'RED          ' : 'NOT-MEASURED ') + '(' + entry.id + ') ' + entry.name)
console.log('')
console.log(String(readings.length) + ' readings, ' + String(counted.green) + ' green, ' + String(counted.red) + ' red, ' + String(counted.unmeasured) + ' not measured')
console.log('LIVE: nothing was started, stopped or clicked; no CDP, no model round, no port 31761/31760/9222.')
if (counted.red > 0) {
  console.log('FAIL — ' + String(counted.red) + ' reading(s) failed: ' + readings.filter((entry) => entry.verdict === 'red').map((entry) => '(' + entry.id + ')').join(', '))
  process.exit(1)
}
if (counted.unmeasured > 0) {
  console.log('NOT MEASURED — ' + String(counted.unmeasured) + ' reading(s) could not be taken: ' + readings.filter((entry) => entry.verdict === 'unmeasured').map((entry) => '(' + entry.id + ')').join(', '))
  process.exit(3)
}
console.log("PASS — a compat-only consumer registers and answers 200 with the loader, fails by name without it, and the loader's answers agree with the table")
process.exit(0)
