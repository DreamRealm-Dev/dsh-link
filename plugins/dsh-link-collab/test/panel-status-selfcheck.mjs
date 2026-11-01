#!/usr/bin/env node
/**
 * Self-check (R204) - the collaboration bus's ONE status row in the LINK panel.
 *
 * Subject: the browser half this package now ships (lib/client.js) and the read-only route its host
 * half now binds (lib/index.js). Both are measured as BYTES ON DISK, run the way the page and the
 * kernel run them - never as source read for a promise.
 *
 * THE WORLD. The row is declared into the panel's REAL seam, not a stub: plugins/dsh-link-panel's
 * own src/client/contributions.ts is bundled here with esbuild (the same bundler and the same
 * dependency the plugin build uses) and its createLinkPanelService() is the object this half
 * declares into, so 'the row is admitted' means the shipped projection admitted it and 'notify()
 * moved the row' means the shipped listener heard it. The page's fetch, the locale service and the
 * two document/window events are named seats carrying fixed answers, because the readings they feed
 * need one fixed input each.
 *
 * READINGS (each independently failable):
 *   S1  THE ROW IS A STATUS ROW THE REAL SEAM ADMITS: one declaration, admitted with zero refusals,
 *       kind 'status', order 26, hasInvoke false - and a press on it is refused by the seam's own
 *       sentence about a row that is not an action.
 *   S2  ITS WORDS ARE ITS OWN: one register() call carrying zh AND en, identical key sets, and a
 *       language switch re-renders the SAME reading in the other language through notify().
 *   L1  NO CADENCE: the half installs no setInterval and no setTimeout for the whole world (mount,
 *       two reads, two events, a language switch) - R191's lesson, measured rather than promised.
 *   N1  A MOVED READING IS REPUBLISHED THROUGH notify(): a second read that answers different
 *       numbers notifies exactly once and the drawn row carries the new numbers; a read that
 *       answers the SAME numbers notifies zero times.
 *   F1  no linkPanel service: fail-closed, named 'linkPanel-unavailable', nothing thrown.
 *   F2  a declare() that throws: fail-closed, named 'linkPanel-declare-refused' with THAT text.
 *   F3  no locale service: named, the row is still declared, and the body comes from the same zh
 *       dictionary rather than a key name.
 *   F4  a 503 with a named code: the body carries the route's code and message as data.
 *   F5  a page with no fetch: named 'no-fetch'.
 *   H1  THE HOST ROUTE: one GET route bound at the one STATUS_PATH spelling, answering the live
 *       ledger's own counts, counting its own served reads, and refusing a POST by code.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 the subject cannot be measured here (a built
 * half, the panel's seam source or esbuild is missing).
 * Usage: node plugins/dsh-link-collab/test/panel-status-selfcheck.mjs [--keep]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..', '..')
const KEEP = process.argv.includes('--keep')
const CLIENT = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'client.js')
const HOST = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const SEAM_SOURCE = join(PROJECT, 'plugins', 'dsh-link-panel', 'src', 'client', 'contributions.ts')
const STATUS_PATH = '/api/dsh-link-collab/status'
const MARKER = '__dshLinkCollabPanel'

const readings = []
const add = (id, ok, detail, evidence = []) => {
  readings.push({ id, ok })
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + detail)
  for (const line of evidence) console.log('      ' + line)
}
const show = (value) => { try { return JSON.stringify(value) } catch { return String(value) } }

for (const [label, path] of [['the client half', CLIENT], ['the host half', HOST], ["the panel's seam source", SEAM_SOURCE]]) {
  if (existsSync(path) === false) {
    console.log('NOT MEASURED: ' + label + ' is not on this machine: ' + path + ' - run: node plugins/build.mjs')
    process.exit(3)
  }
}

/** The real seam, bundled from the panel's own source with the bundler the plugin build uses. */
let panelSeam = null
try {
  const { build } = await import('esbuild')
  const out = join(mkdtempSync(join(tmpdir(), 'r204-seam-')), 'contributions.mjs')
  await build({ entryPoints: [SEAM_SOURCE], bundle: true, format: 'esm', platform: 'node', target: 'node22', write: false, logLevel: 'error' })
    .then((result) => { writeFileSync(out, result.outputFiles[0].text) })
  panelSeam = await import(pathToFileURL(out).href)
} catch (error) {
  console.log('NOT MEASURED: the panel seam could not be bundled/imported: ' + String(error?.message ?? error))
  process.exit(3)
}

const module = await import(pathToFileURL(HOST).href)

/* ------------------------------------------------------------------ *
 * The page: its own document/window events, its own locale service, its own fetch.
 * ------------------------------------------------------------------ */
const realSetTimeout = globalThis.setTimeout
const settle = async () => { await new Promise((done) => realSetTimeout(done, 5)); await new Promise((done) => realSetTimeout(done, 5)) }

/** A page whose document and window can be made to report the two events this half listens for. */
function makePage() {
  const listeners = new Map()
  const add = (name, fn) => { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list) }
  const remove = (name, fn) => { const list = (listeners.get(name) ?? []).filter((entry) => entry !== fn); listeners.set(name, list) }
  const fire = (name) => { for (const fn of [...(listeners.get(name) ?? [])]) fn() }
  const doc = { visibilityState: 'visible', addEventListener: add, removeEventListener: remove }
  const win = { addEventListener: add, removeEventListener: remove, __ModuleLoader__: { load(registration) { win.registration = registration } } }
  return { doc, win, fire, count: () => [...listeners.values()].reduce((total, list) => total + list.length, 0) }
}

/** A locale service with the kernel service's faces, answering the active language at call time. */
function makeLocale() {
  const registered = []
  const listeners = new Set()
  let active = 'zh'
  return {
    registered,
    get active() { return active },
    register(namespace, dictionaries) {
      if (registered.some((entry) => entry.namespace === namespace)) throw new Error('locale: ' + namespace + ' already has locale')
      registered.push({ namespace, dictionaries })
    },
    bind(namespace) {
      return (key, params) => {
        const entry = registered.find((candidate) => candidate.namespace === namespace)
        const template = entry === undefined ? key : (entry.dictionaries[active]?.[key] ?? key)
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
      }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    switchTo(next) { active = next; for (const listener of [...listeners]) listener() },
  }
}

/** The route's answer, as the page's fetch hands it back. */
function makeFetch(answer) {
  const calls = []
  return {
    calls,
    fetch: async (path, init) => {
      calls.push({ path, init })
      const current = typeof answer === 'function' ? answer() : answer
      return { status: current.status, text: async () => (typeof current.text === 'string' ? current.text : JSON.stringify(current.text)) }
    },
  }
}

/** The status document the host half really serves, as a fixture with the numbers this test asserts. */
function statusDocument(fields) {
  const value = Object.assign({ records: 11, teams: 3, members: 2, relayBound: false }, fields)
  return {
    ok: true,
    path: STATUS_PATH,
    at: 1700000000000,
    ledger: { records: value.records, lastSeq: value.records, writer: 'local', instance: 'i-1', damage: { brokenLines: 0, lastGoodSeq: value.records, bytes: 100 } },
    world: { teams: value.teams, members: value.members, tasks: 0, folded: value.records, unknown: 0 },
    relay: { bound: value.relayBound, path: '/api/dsh-link-collab/relay', accepted: 0, refused: 0, lastCode: null },
    recorded: { seen: 0, recorded: 0, ignored: 0, failed: 0 },
  }
}

/**
 * Mount the browser half against one page, and hand back what it did.
 * @param options.page the fake page, options.locale the locale service, options.seam the real seam,
 *   options.fetch the page's fetch, options.ctxExtra any service override.
 */
async function mountClient(options) {
  const page = options.page ?? makePage()
  globalThis.window = page.win
  globalThis.document = page.doc
  if (options.fetch === undefined) delete globalThis.fetch
  else globalThis.fetch = options.fetch
  delete globalThis[MARKER]
  const text = readFileSync(CLIENT, 'utf8')
  new Function(text)()
  const registration = page.win.registration
  const exports = registration.factory((specifier) => { throw new Error('the half asked the module table for ' + specifier + ', which this test does not provide') })
  const ctx = {
    get(name) {
      if (name === 'linkPanel') return options.seam === undefined ? null : options.seam
      if (name === 'locale') return options.locale === undefined ? null : options.locale
      return null
    },
    effect(work) {
      ran.push(true)
      const dispose = work()
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }
  const ran = []
  const threw = []
  try {
    exports.apply(ctx)
  } catch (error) {
    threw.push(String(error?.message ?? error))
  }
  return { exports, page, ctx, threw, effectRan: ran.length > 0, marker: () => globalThis[MARKER] }
}

/** A real seam with its notify counted, and a recorder of how often the pane would be told. */
function makeSeam() {
  const seam = panelSeam.createLinkPanelService()
  const originalNotify = seam.notify
  let notifies = 0
  seam.notify = () => { notifies += 1; originalNotify.call(seam) }
  return { seam, notifies: () => notifies }
}

const ZH_BODY_3_2_11 = '\u56e2\u961f 3 \u00b7 \u6210\u5458 2 \u00b7 \u8d26\u672c 11 \u6761 \u00b7 \u4e2d\u7ee7 \u672a\u7ed1\u5b9a'
const EN_BODY_3_2_11 = 'teams 3 \u00b7 members 2 \u00b7 ledger 11 \u00b7 relay not bound'
const ZH_BODY_5_2_12 = '\u56e2\u961f 5 \u00b7 \u6210\u5458 2 \u00b7 \u8d26\u672c 12 \u6761 \u00b7 \u4e2d\u7ee7 \u5df2\u7ed1\u5b9a'

/* ------------------------------------------------------------------ *
 * S1, S2, L1, N1: the row, in a page that has everything.
 * ------------------------------------------------------------------ */
const timerCalls = { intervals: 0, timeouts: 0 }
const realInterval = globalThis.setInterval
globalThis.setInterval = (...args) => { timerCalls.intervals += 1; return realInterval(...args) }
globalThis.setTimeout = (...args) => { timerCalls.timeouts += 1; return realSetTimeout(...args) }

const seamState = makeSeam()
const locale = makeLocale()
const route = makeFetch({ status: 200, text: statusDocument({}) })
const full = await mountClient({ page: makePage(), locale, seam: seamState.seam, fetch: route.fetch })
await settle()

globalThis.setInterval = realInterval
globalThis.setTimeout = realSetTimeout

const entries = seamState.seam.entries()
const refused = seamState.seam.rejected()
const row = entries.find((entry) => entry.id === 'dsh-link-collab:bus-status')
const pressOnAReading = row === undefined ? null : seamState.seam.press(row.id)
add('S1-the-real-seam-admits-a-status-row',
  full.threw.length === 0 && entries.length === 1 && refused.length === 0 && row !== undefined
    && row.kind === 'status' && row.source === 'dsh-link-collab' && row.order === 26 && row.hasInvoke === false
    && pressOnAReading !== null && pressOnAReading.ok === false,
  'declared into the panel\u2019s own bundled seam: ' + String(entries.length) + ' row(s), ' + String(refused.length) + ' refusal(s), kind '
    + show(row?.kind) + ', order ' + show(row?.order) + ', hasInvoke ' + show(row?.hasInvoke) + ', source ' + show(row?.source)
    + '; a press on it is refused by the seam\u2019s own sentence: ' + show(pressOnAReading?.detail),
  ['entries: ' + show(entries), 'refused: ' + show(refused), 'the half threw nothing: ' + show(full.threw)])

const registration = locale.registered[0]
const zhKeys = registration === undefined ? [] : Object.keys(registration.dictionaries.zh).sort()
const enKeys = registration === undefined ? [] : Object.keys(registration.dictionaries.en).sort()
const sameKeys = show(zhKeys) === show(enKeys)
const zhBody = row === undefined ? '' : seamState.seam.entries().find((entry) => entry.id === row.id)?.body ?? ''
locale.switchTo('en')
const enRow = seamState.seam.entries().find((entry) => entry.id === 'dsh-link-collab:bus-status')
add('S2-its-own-words-one-register-both-languages',
  locale.registered.length === 1 && registration.namespace === 'dsh-link-collab' && sameKeys && zhKeys.length > 0
    && zhBody === ZH_BODY_3_2_11 && enRow !== undefined && enRow.body === EN_BODY_3_2_11,
  'one register() call under ' + show(registration?.namespace) + ' with ' + String(zhKeys.length) + ' key(s) in each language, identical: ' + String(sameKeys)
    + '; the drawn body reads the route\u2019s numbers in zh (' + show(zhBody) + ') and, after a language switch announced by the locale service, in en (' + show(enRow?.body) + ')',
  ['zh keys: ' + show(zhKeys), 'en keys: ' + show(enKeys), 'registered: ' + show(locale.registered.map((entry) => entry.namespace))])

add('L1-no-cadence',
  timerCalls.intervals === 0 && timerCalls.timeouts === 0,
  'the half installed no timer for the whole world (mount, the route read, the two page events, a language switch): '
    + String(timerCalls.intervals) + ' setInterval call(s), ' + String(timerCalls.timeouts) + ' setTimeout call(s)',
  ['the reading is taken at mount and on the document\u2019s and window\u2019s own events; the row is republished through the seam\u2019s notify()'])

// The language comes back to zh BEFORE the baseline is taken: the notch this reading measures is the
// reading that moved, not the words (S2 already took the language-move notch).
locale.switchTo('zh')
await settle()
const notifiesBefore = seamState.notifies()
// the same numbers again: nothing moved, so nothing is announced
full.page.fire('visibilitychange')
await settle()
const notifiesSame = seamState.notifies() - notifiesBefore
// different numbers: the row must be republished exactly once, and the drawn row must carry them
const movedRoute = makeFetch({ status: 200, text: statusDocument({ teams: 5, records: 12, relayBound: true }) })
globalThis.fetch = movedRoute.fetch
globalThis.document = full.page.doc
globalThis.window = full.page.win
full.page.fire('focus')
await settle()
const notifiesMoved = seamState.notifies() - notifiesBefore
const movedRow = seamState.seam.entries().find((entry) => entry.id === 'dsh-link-collab:bus-status')
add('N1-a-moved-reading-reaches-the-row-through-notify',
  notifiesSame === 0 && notifiesMoved === 1 && movedRow !== undefined && movedRow.body === ZH_BODY_5_2_12,
  'a read that answered the same numbers announced nothing (' + String(notifiesSame) + ' notify()); a read that answered different numbers announced exactly once ('
    + String(notifiesMoved) + ') and the drawn row carries them: ' + show(movedRow?.body),
  ['reads taken: ' + show(full.marker()?.reads), 'notifies used: ' + show(full.marker()?.notifies), 'the fourth routed read: ' + show(movedRoute.calls.map((call) => call.path))])

/* ------------------------------------------------------------------ *
 * F1-F5: the four absences and one refusal, each named and none thrown.
 * ------------------------------------------------------------------ */
{
  const page = makePage()
  const world = await mountClient({ page, locale: makeLocale(), seam: undefined, fetch: makeFetch({ status: 200, text: statusDocument({}) }) })
  await settle()
  const marker = world.marker()
  add('F1-no-panel-service',
    world.threw.length === 0 && marker !== undefined && marker.declared === false && String(marker.failed).startsWith('linkPanel-unavailable:') && page.count() === 0,
    'no linkPanel on the page: nothing was declared, nothing was thrown, and the marker names it: ' + show(marker?.failed),
    ['the marker: ' + show(marker), 'page listeners installed by the half: ' + String(page.count())])
}

{
  const thrown = new Error('the panel refused this id')
  const seam = panelSeam.createLinkPanelService()
  seam.declare = () => { throw thrown }
  const world = await mountClient({ page: makePage(), locale: makeLocale(), seam, fetch: makeFetch({ status: 200, text: statusDocument({}) }) })
  await settle()
  const marker = world.marker()
  add('F2-a-declare-that-throws',
    world.threw.length === 0 && marker !== undefined && marker.declared === false
      && String(marker.failed) === 'linkPanel-declare-refused: ' + thrown.message,
    'a seam whose declare() throws: the half kept the provider\u2019s own text and threw nothing: ' + show(marker?.failed),
    ['the marker: ' + show(marker)])
}

{
  const seamStateNoLocale = makeSeam()
  const world = await mountClient({ page: makePage(), locale: undefined, seam: seamStateNoLocale.seam, fetch: makeFetch({ status: 200, text: statusDocument({}) }).fetch })
  await settle()
  const noLocaleRow = seamStateNoLocale.seam.entries().find((entry) => entry.id === 'dsh-link-collab:bus-status')
  const marker = world.marker()
  add('F3-no-locale-service',
    world.threw.length === 0 && marker !== undefined && String(marker.dictionaries).startsWith('locale-unavailable:')
      && noLocaleRow !== undefined && noLocaleRow.body === ZH_BODY_3_2_11,
    'no locale service: the half names it (' + show(marker?.dictionaries) + '), still declares the row, and answers from the same zh dictionary: ' + show(noLocaleRow?.body),
    ['the marker: ' + show(marker)])
}

{
  const world = await mountClient({ page: makePage(), locale: makeLocale(), seam: makeSeam().seam,
    fetch: makeFetch({ status: 503, text: { ok: false, error: { code: 'STATUS_UNREADABLE', message: 'the ledger could not be folded' } } }).fetch })
  await settle()
  const failedRow = world.marker()
  add('F4-a-refused-reading-is-drawn-with-the-routes-own-words',
    world.threw.length === 0 && failedRow.failure !== null && failedRow.failure.code === 'STATUS_UNREADABLE'
      && String(failedRow.body).includes('STATUS_UNREADABLE') && String(failedRow.body).includes('the ledger could not be folded'),
    'a 503 carrying a named code: the drawn body carries the route\u2019s code AND its message as data: ' + show(failedRow.body),
    ['the marker failure: ' + show(failedRow.failure)])
}

{
  const world = await mountClient({ page: makePage(), locale: makeLocale(), seam: makeSeam().seam, fetch: undefined })
  await settle()
  const marker = world.marker()
  add('F5-a-page-with-no-fetch',
    world.threw.length === 0 && marker.failure !== null && marker.failure.code === 'no-fetch' && String(marker.body).includes(STATUS_PATH),
    'a page with no fetch: the row names the absence instead of drawing an empty line: ' + show(marker?.body),
    ['the marker failure: ' + show(marker?.failure)])
}

/* ------------------------------------------------------------------ *
 * H1: the host half's own route, over a real ledger.
 * ------------------------------------------------------------------ */
{
  const home = mkdtempSync(join(tmpdir(), 'r204-status-'))
  mkdirSync(join(home, 'collab'), { recursive: true })
  const routes = []
  const provided = new Map()
  const server = { register(route) { routes.push(route); return () => {} } }
  const ctx = {
    get(name) {
      if (name === 'dshHomePath') return (sub) => join(home, sub)
      if (name === 'webServer') return server
      if (name === 'tools') return undefined
      return provided.get(name)
    },
    inject(_names, work) { work({ get: (name) => (name === 'webServer' ? server : undefined) }) },
    provide(name, value) { provided.set(name, value) },
    effect(work) { const dispose = work(); return () => { if (typeof dispose === 'function') dispose() } },
    on() { return () => {} },
  }
  const printed = []
  const quiet = { log: console.log, error: console.error }
  let appliedThrew = false
  try {
    console.log = (line) => { printed.push(String(line)) }
    console.error = (line) => { printed.push(String(line)) }
    module.apply(ctx, {})
  } catch (error) {
    appliedThrew = true
    printed.push('threw: ' + String(error?.message ?? error))
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  const capability = provided.get('linkCollab')
  const log = capability?.log
  if (log !== undefined) {
    await log.append(module.teamRecord('t-1', null))
    await log.append(module.teamRecord('t-2', 't-1'))
  }
  const registered = routes.find((entry) => entry.path === STATUS_PATH)
  const answerOf = (request) => {
    const response = { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value }, end(text) { this.body = text ?? '' } }
    registered.handler(request, response)
    let parsed = null
    try { parsed = JSON.parse(response.body) } catch { parsed = null }
    return { response, parsed }
  }
  const first = registered === undefined ? null : answerOf({ method: 'GET' })
  const second = registered === undefined ? null : answerOf({ method: 'GET' })
  const post = registered === undefined ? null : answerOf({ method: 'POST' })
  const document = first?.parsed ?? null
  const servedBefore = capability?.status?.served
  add('H1-the-host-route-answers-the-live-ledger',
    appliedThrew === false && routes.length === 1 && document !== null && document.ok === true
      && document.path === STATUS_PATH && document.ledger.records === 2 && document.world.teams === 2
      && document.relay.bound === false && second.parsed.ledger.records === 2 && servedBefore === 2
      && post.response.statusCode === 405 && post.parsed.error.code === 'STATUS_READ_ONLY',
  'one route bound at ' + show(STATUS_PATH) + ' answers the ledger it just took (' + String(document?.ledger?.records) + ' record(s), '
    + String(document?.world?.teams) + ' team(s), relay bound ' + show(document?.relay?.bound) + '), counts its own reads (' + show(servedBefore) + '), and refuses a POST with ' + show(post?.parsed?.error?.code),
  ['routes bound: ' + show(routes.map((entry) => entry.kind + ' ' + entry.path)),
   'the first answer: ' + show(document),
   'the bind line the host printed: ' + show(printed.filter((line) => line.includes('status route bound'))),
   'status face: ' + show(capability?.status === undefined ? null : { bound: capability.status.bound, path: capability.status.path, served: capability.status.served })])
  if (KEEP !== true) rmSync(home, { recursive: true, force: true })
}

const failed = readings.filter((reading) => reading.ok !== true)
console.log('')
console.log(String(readings.length - failed.length) + '/' + String(readings.length) + ' reading(s) held' + (failed.length === 0 ? '' : '; FAILED: ' + failed.map((reading) => reading.id).join(', ')))
process.exit(failed.length === 0 ? 0 : 1)
