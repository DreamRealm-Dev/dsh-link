#!/usr/bin/env node
/**
 * dsh-link-teams self-check (producer-owned, R196 P5).
 *
 *   node plugins/dsh-link-teams/test/teams-truth.spec.mjs
 *   node plugins/dsh-link-teams/test/teams-truth.spec.mjs --self-attack
 *
 * Needs no browser, no DSH, no socket and no CDP. Two planes are measured, each on the artifact the web
 * shell and the kernel actually serve:
 *
 *   the HOST plane (lib/index.js, driven through apply() and its captured route)
 *     H1  ONE WORLD: counts.teams EQUALS teams.teams.length, the tree holds the real session team, and
 *         the two task rows that share an id but not a team stay two rows with distinct keys.
 *     H2  NO FIXTURE IN THE WORLD: a fold whose own teams.teams is the R180-B acceptance fixture (the
 *         leak's exact shape, PRINTED as the paired control) answers a tree with zero gate-/r18x- ids,
 *         and the withheld team(s) are counted instead.
 *     H3  THE LEDGER VIEW IS STILL THE FILE: the stream is the tail of the records, its length is
 *         min(40, records), and every fixture-bearing row is flagged instead of dropped.
 *     H3b THE FLAG NAMES ITS REASON: every flagged row (and every flat task/member row) carries the FIELD
 *         that raised the flag, that field really holds a fixture-named value under the shipped rule, and an
 *         unflagged row names none - so "why is this row flagged" is a reading, not a hand read of the ledger.
 *     H4  A FIXTURE-ONLY FOLD answers no teams at all (the negative control for H2: the same route that
 *         refuses the leak reports teams 0, so H2 is not a property of the fixture being absent).
 *     H5  THE NAMED BRANCHES: no linkCollab -> 503 NO_CAPABILITY, a bus without state() -> 503
 *         NO_STATE_READER, and the same harness with a stand-in -> 200 (the paired control).
 *     H6  READ-ONLY BY CONSTRUCTION: POST/PUT/DELETE are 405 METHOD_NOT_ALLOWED while GET on the same
 *         path answered 200 in this run.
 *
 *   the CLIENT plane (lib/client.js + src/client/**, with the kernel's own LocaleRuntime)
 *     C1  the bundle is the module-loader registration for dsh-link-teams and exports apply/inject.
 *     C2  ONE call registers BOTH dictionaries under this package's namespace, and the service refuses a
 *         second registration of the same (ns, locale) in its own words.
 *     C3  zh and en carry the same key set, and every key is this namespace's.
 *     C4  every key the half can ask for resolves in both languages (the literals, plus the closed sets
 *         the dynamic lookups walk).
 *     C5  no Chinese is written into the half: the source carries none outside the dictionary module, and
 *         every CJK run in the DECODED built bundle is a value of the zh dictionary.
 *     C6  the pane's own view agrees with the route: the teams chip equals the number of tree rows and
 *         the route's count, the two task-1 rows are labelled differently, and no gate- id is drawn.
 *     C7  the wiring: inject names locale, the tab type is the same id/kind, and both slot registrations
 *         carry the key and declare locale: NS (which is what binds the t seat).
 *     C8  the LINK panel row: ONE action item, this package's own namespaced id and source, no body, a
 *         callable invoke, and a title that is the zh dictionary word (not the en one), bound through
 *         ctx.effect so the row leaves with the half.
 *     C9  the press: invoke calls the right column's openTab exactly once with the kind READ out of the
 *         tab type this half registered, and this package's own marker names the same kind.
 *     C10 a page with no panel service and no locale service still works: apply() throws nothing, the tab
 *         type and both slots are registered, the words answer from the zh dictionary, and the marker
 *         NAMES both absences (linkPanel-unavailable / locale-unavailable).
 *     C11 a refusal is contained and named wherever it comes from: a throwing openTab, an absent right
 *         column, and a panel that refuses the declaration are each caught, carry the service's own
 *         words in this package's marker, and leave the tab type and the slots standing.
 *     C12 a language switch reaches the seam through its own notify() on ONE locale subscription, and the
 *         row follows the language without being re-declared.
 *
 * --self-attack stages a copy of the built host half whose world is the OLD pass-through (state.teams and
 * state.counts forwarded untouched) and requires H1, H2 and H4 to redden there: a check that cannot fail
 * on the defect it was written for is not a check.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 a premise is missing (a build, the kernel's locale
 * bundle, the dictionaries).
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(PACKAGE, '..', '..')
const HOST = join(PACKAGE, 'lib', 'index.js')
const CLIENT = join(PACKAGE, 'lib', 'client.js')
const LOCALE_BUNDLE = join(REPO, 'core', 'deepseek-harness', 'packages', 'client', 'locale', 'lib', 'client.js')
const SELF_ATTACK = process.argv.includes('--self-attack')

const rows = []
const premises = []
const check = (id, ok, detail, evidence) => {
  rows.push({ id, ok, detail, evidence: Array.isArray(evidence) ? evidence : [] })
  console.log((ok ? 'ok   ' : 'FAIL ') + id + '  ' + detail)
  for (const line of Array.isArray(evidence) ? evidence : []) console.log('       ' + line)
  return ok
}
const show = (value) => JSON.stringify(value === undefined ? null : value)
const NUL = String.fromCharCode(0)
const FIXTURE = /^(?:gate-|r18(?:\d|x)-)/i
const isFixture = (value) => typeof value === 'string' && FIXTURE.test(value)

// ------------------------------------------------------------------------------------------------ fixtures
// A fold with the shape the live route answered on 2026-10-17 (evidence-live-teams-route-summary.json):
// two declared teams that only the R180-B acceptance run ever wrote, real session teams named by task and
// member rows, two task-1 rows in two teams, and a fixture member with a declared capability.
const sessionA = 'session-<example>'
const sessionB = 'session-<example>'

function liveShaped() {
  const records = []
  for (let seq = 1; seq <= 45; seq += 1) {
    const fixture = seq >= 40
    records.push({
      seq,
      kind: fixture ? (seq % 2 === 0 ? 'member/state' : 'capability/state') : 'task/state',
      actor: fixture ? 'gate-r180-alpha-team' : sessionB,
      subject: fixture ? 'gate-r180-alpha' : 'task-' + String(seq),
      payload: fixture ? { id: 'gate-r180-alpha', capabilities: ['gate-r180-alpha-capability'] } : { id: 'task-' + String(seq), state: 'pending' },
    })
  }
  return {
    records,
    state: {
      counts: { folded: 39, unknown: 14, tasks: 9, members: 9, teams: 3, unattributed: 0 },
      through: 45,
      teams: {
        teams: [
          { id: 'gate-r180-alpha-root', parent: null, lead: null, seq: 52, contested: false, losers: [] },
          { id: 'gate-r180-alpha-team', parent: 'gate-r180-alpha-root', lead: 'gate-r180-alpha-lead', seq: 51, contested: false, losers: [] },
        ],
        children: { 'gate-r180-alpha-root': ['gate-r180-alpha-team'] },
        roots: ['gate-r180-alpha-root'],
        orphans: [],
        cycles: [],
      },
      tasks: [
        { id: 'task-1', team: sessionA, status: 'pending', owner: null, records: 1, contested: false },
        { id: 'task-1', team: sessionB, status: 'completed', owner: null, records: 3, contested: true },
        { id: 'r181-live-task', team: sessionB, status: 'pending', owner: null, records: 2, contested: true },
      ],
      members: [
        { id: 'e7f22afb-e36e-4fd7-803e-', name: 'seg1-analyst', team: sessionB, state: 'active', role: 'member' },
        { id: 'gate-r180-alpha', name: 'gate-r180-alpha', team: 'gate-r180-alpha-', state: 'active', role: 'member' },
      ],
      registry: { members: [{ id: 'gate-r180-alpha', capabilities: ['gate-r180-alpha-capability'], seq: 50 }], byCapability: { 'gate-r180-alpha-capability': ['gate-r180-alpha'] }, declarations: 1, malformed: 0 },
      liveness: { lastHeartbeat: { 'gate-r180-alpha': 1780000000000 }, beatSeq: { 'gate-r180-alpha': 53 }, beats: 1, malformed: 0 },
      peers: { pairs: [{ from: 'r182-lead', to: 'r182-live-peer', request: 'R182-E live acceptance', state: 'granted', seq: 44 }] },
      board: { tasks: [], edges: {}, ready: [], blocked: {}, missing: {}, done: [], cycles: [], orphans: [], removed: [], unreachable: {}, unknown: [] },
      quarantine: [{ memberId: 'r181-live-victim', at: 1791710580095, reason: 'NEVER_BEAT', task: 'r181-live-task', by: 'r181-live', seq: 43 }],
    },
  }
}

/** A fold whose only teams are fixture-named: the leak with nothing real to hide behind. */
function fixtureOnly() {
  const { records } = liveShaped()
  return {
    records,
    state: {
      counts: { folded: 0, unknown: 0, tasks: 0, members: 0, teams: 0, unattributed: 0 },
      through: 45,
      teams: { teams: [{ id: 'gate-r180-alpha-team', parent: null, lead: null, seq: 51 }], children: {}, roots: ['gate-r180-alpha-team'], orphans: [], cycles: [] },
      tasks: [], members: [],
      registry: { members: [], byCapability: {}, declarations: 0, malformed: 0 },
      liveness: { lastHeartbeat: {}, beats: 0, malformed: 0 },
      peers: { pairs: [] },
      board: {},
      quarantine: [],
    },
  }
}

/** The empty world a first boot answers. */
function empty() {
  return {
    records: [],
    state: {
      counts: { folded: 0, unknown: 0, tasks: 0, members: 0, teams: 0, unattributed: 0 },
      through: 0,
      teams: { teams: [], children: {}, roots: [], orphans: [], cycles: [] },
      tasks: [], members: [],
      registry: { members: [], byCapability: {}, declarations: 0, malformed: 0 },
      liveness: { lastHeartbeat: {}, beats: 0, malformed: 0 },
      peers: { pairs: [] },
      board: {},
      quarantine: [],
    },
  }
}

// ------------------------------------------------------------------------------------------- host harness
/** A response object the route can write, read back as a parsed body. */
function response() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(body) { this.text = String(body === undefined ? '' : body) },
    body() { try { return JSON.parse(this.text) } catch { return null } },
  }
}

/** One ctx that publishes a web server and (optionally) a linkCollab stand-in. */
function drive(ctxWorld) {
  let route = null
  const ctx = {
    get: (name) => (name === 'webServer'
      ? { register: (registered) => { route = registered; return () => {} } }
      : name === 'linkCollab'
        ? ctxWorld.collab
        : undefined),
    inject: () => {},
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
  }
  return { ctx, route: () => route }
}

/** Import one host artifact (cache-busted) and drive one GET through its captured route. */
async function answer(hostPath, kind, tag) {
  const module = await import(pathToFileURL(hostPath).href + '?case=' + encodeURIComponent(tag))
  const plugin = module.default === undefined ? module : module.default
  const world = kind === 'absent' ? {} : kind === 'no-reader' ? { collab: { log: { replay: () => [] } } } : (() => {
    const built = kind === 'empty' ? empty() : kind === 'fixture-only' ? fixtureOnly() : liveShaped()
    return { collab: { state: () => built.state, log: { replay: () => built.records, directory: 'C:/live/collab', writer: 'local', instance: 'f8787c7f', lastSeq: 45, damage: null } }, fold: built.state }
  })()
  const harness = drive(world)
  const quiet = { log: console.log, error: console.error }
  console.log = () => {}
  console.error = () => {}
  try {
    plugin.apply(harness.ctx, {})
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  const route = harness.route()
  if (route === null) throw new Error('apply() registered no route: ' + hostPath)
  const get = response()
  await route.handler({ method: 'GET' }, get)
  return { route, get, body: get.body(), fold: world.fold === undefined ? null : world.fold }
}

// ------------------------------------------------------------------------------------------ client harness
/** A stub that answers every read with another stub, so a browser bundle runs unattended. */
function makeStub(path) {
  const fn = function () { return makeStub(path + '()') }
  return new Proxy(fn, {
    get(target, key) {
      if (key === Symbol.toPrimitive) return () => path
      if (key === 'then') return undefined
      if (key === 'length') return 0
      if (key === 'name') return path
      return makeStub(path + '.' + String(key))
    },
    apply() { return makeStub(path + '()') },
    construct() { return makeStub('new ' + path) },
    has() { return true },
  })
}

/** The browser module-loader registration point: run one built bundle and return its registration. */
function loadBundle(path) {
  const code = readFileSync(path, 'utf8')
  let captured = null
  const window = { __ModuleLoader__: { load(module) { captured = module } } }
  new Function('window', code)(window)
  if (captured === null) throw new Error('no window.__ModuleLoader__.load registration in ' + path)
  return captured
}

/** The kernel's own LocaleRuntime, from its shipped bundle, with a recorder on register(). */
function localeService() {
  const bundle = loadBundle(LOCALE_BUNDLE)
  const exports = bundle.factory((specifier) => makeStub('require:' + String(specifier)))
  const runtime = new exports.LocaleRuntime({
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    emit: () => {},
  })
  const calls = []
  const original = runtime.register.bind(runtime)
  runtime.register = function (...args) {
    const result = original(...args)
    calls.push({ ns: args[0], locales: typeof args[1] === 'string' ? [args[1]] : Object.keys(args[1] === undefined ? {} : args[1]) })
    return result
  }
  return { runtime, calls }
}

/** The client bundle's exports, with the module table stubbed to the browser baseline. */
function clientExports(path) {
  const registration = loadBundle(path)
  const react = {
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const element = (type, props) => ({ type, props: props === undefined ? {} : props })
  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: null }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { IconUsersOutlineRegular: () => null }
    throw new Error('the bundle asked for ' + String(specifier) + ', which is not in the module table')
  })
  return { registration, exports }
}

/** Every file under a directory, by extension. */
function walk(dir, test) {
  const out = []
  if (existsSync(dir) === false) return out
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path, test))
    else if (test(entry)) out.push(path)
  }
  return out
}

/** Blank out comments, keeping line numbers (a comment is not product text). */
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))

// ---------------------------------------------------------------------------------------------- the readings
async function hostPlane(hostPath, tag) {
  const live = await answer(hostPath, 'live', tag + '-live')
  const body = live.body
  const tree = body === null ? null : body.teams

  // H1 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    if (live.get.statusCode !== 200 || body === null || body.ok !== true) problems.push('the route answered status=' + live.get.statusCode)
    const ids = tree === null ? [] : tree.teams.map((node) => node.id)
    if (body !== null && body.counts.teams !== ids.length) problems.push('counts.teams=' + show(body.counts.teams) + ' but the tree carries ' + show(ids.length) + ' node(s)')
    if (ids.includes(sessionA) === false || ids.includes(sessionB) === false) problems.push('the real session team(s) are missing from the tree: ' + show(ids))
    const missing = tree === null ? [] : tree.teams.filter((node) => tree.children[node.id] === undefined && tree.roots.includes(node.id) === false && tree.orphans.includes(node.id) === false).map((node) => node.id)
    if (missing.length > 0) problems.push('tree node(s) reachable from neither roots nor children: ' + show(missing))
    const keys = body === null ? [] : body.tasks.map((task) => String(task.team) + NUL + String(task.id))
    if (new Set(keys).size !== keys.length) problems.push('two task rows share one (team, id) key: ' + show(keys))
    const ones = body === null ? [] : body.tasks.filter((task) => task.id === 'task-1')
    if (ones.length !== 2) problems.push('expected the two task-1 rows, got ' + show(ones.map((task) => task.team)))
    check('H1', problems.length === 0,
      problems.length === 0
        ? 'one world: counts.teams = ' + show(body.counts.teams) + ' = ' + show(ids.length) + ' tree node(s), both real session teams in the tree, and the two task-1 rows keyed apart'
        : problems.join('; '),
      ['tree ids: ' + show(ids), 'task keys: ' + show(keys)])
  }

  // H2 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    const all = []
    if (tree !== null) {
      for (const node of tree.teams) all.push(node.id)
      for (const [parent, kids] of Object.entries(tree.children)) { all.push(parent); all.push(...kids) }
      all.push(...tree.roots, ...tree.orphans)
    }
    const leaked = all.filter(isFixture)
    if (leaked.length > 0) problems.push('the world carries fixture id(s): ' + show(leaked))
    if (tree === null || typeof tree.withheld !== 'number') problems.push('teams.withheld is not a number: ' + show(tree === null ? null : tree.withheld))
    else if (tree.withheld !== 3) problems.push('expected 3 withheld fixture teams (2 declared + the member-row team), got ' + show(tree.withheld))
    const inputFixture = live.fold === null ? [] : live.fold.teams.teams.map((node) => node.id).filter(isFixture)
    if (inputFixture.length === 0) problems.push('the paired control failed: the INPUT fold carries no fixture team, so this reading would pass on a world that never had the leak')
    check('H2', problems.length === 0,
      problems.length === 0
        ? 'the fixture the input fold really carries (' + show(inputFixture) + ') reaches no tree node, and ' + show(tree.withheld) + ' withheld team(s) are counted instead'
        : problems.join('; '),
      ['input fold teams.teams: ' + show(live.fold === null ? null : live.fold.teams.teams.map((node) => node.id)), 'answer tree ids: ' + show(tree === null ? null : tree.teams.map((node) => node.id)), 'withheld: ' + show(tree === null ? null : tree.withheld)])
  }

  // H3 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    const stream = body === null ? [] : body.stream
    if (body !== null && body.ledger.records !== 45) problems.push('ledger.records=' + show(body.ledger.records) + ', expected the 45 records this world holds')
    if (stream.length !== Math.min(40, body === null ? 0 : body.ledger.records)) problems.push('the stream carries ' + show(stream.length) + ' rows, expected min(40, records)')
    const want = live.fold === null ? [] : liveShaped().records.slice(-40).map((record) => record.seq)
    const got = stream.map((record) => record.seq)
    if (show(want) !== show(got)) problems.push('the stream is not the tail of the records')
    const flagged = stream.filter((record) => record.fixture === true).length
    const real = stream.filter((record) => record.fixture !== true).length
    if (flagged === 0) problems.push('no stream row is flagged although the fixture rows are in the tail')
    check('H3', problems.length === 0,
      problems.length === 0
        ? 'the ledger view is the file: ' + show(stream.length) + ' tail rows, ' + show(flagged) + ' flagged as fixture rows and ' + show(real) + ' not, none dropped'
        : problems.join('; '),
      ['stream seqs: ' + show(got.slice(0, 6)) + '...', 'flagged: ' + show(stream.filter((record) => record.fixture === true).map((record) => record.seq))])
  }

  // H3b ----------------------------------------------------------------------------------------------
  {
    const problems = []
    const stream = body === null ? [] : body.stream
    const fieldValue = (row, by) => {
      if (by === 'actor' || by === 'subject') return row[by]
      if (typeof by === 'string' && by.indexOf('payload.') === 0) {
        const payload = row.payload !== undefined ? row.payload : liveShaped().records.filter((record) => record.seq === row.seq)[0]?.payload
        return payload === undefined || payload === null ? undefined : payload[by.slice('payload.'.length)]
      }
      return undefined
    }
    const flagged = stream.filter((record) => record.fixture === true)
    for (const record of flagged) {
      const by = record.fixtureBy
      if (typeof by !== 'string' || by === '') { problems.push('flagged row ' + show(record.seq) + ' names no field: ' + show(by)); continue }
      // The named field must hold a fixture-named value under the SHIPPED rule; the payload fields are read back
      // off the input fold, because the served row carries the reduced shape by design.
      const value = fieldValue(record, by)
      if (isFixture(value) === false) problems.push('row ' + show(record.seq) + ' says ' + show(by) + ' named it, but that field holds ' + show(value))
    }
    for (const record of stream.filter((row) => row.fixture !== true)) {
      if (record.fixtureBy !== null && record.fixtureBy !== undefined) problems.push('unflagged row ' + show(record.seq) + ' still names a field: ' + show(record.fixtureBy))
    }
    const flat = body === null ? [] : body.tasks.concat(body.members)
    for (const record of flat.filter((entry) => entry.fixture === true)) {
      if (record.fixtureBy !== 'team' && record.fixtureBy !== 'id') problems.push('flat row ' + show(record.id) + ' names ' + show(record.fixtureBy) + ', expected team or id')
    }
    if (flagged.length === 0) problems.push('no flagged row to check')
    check('H3b', problems.length === 0,
      problems.length === 0
        ? 'every flagged row names the field that raised it (' + show([...new Set(flagged.map((record) => record.fixtureBy))]) + '), that field holds a fixture-named value, and unflagged rows name none'
        : problems.join('; '),
      ['flagged rows: ' + show(flagged.slice(0, 4).map((record) => ({ seq: record.seq, by: record.fixtureBy }))), 'flat flags: ' + show(flat.filter((entry) => entry.fixture === true).map((entry) => ({ id: entry.id, by: entry.fixtureBy })))])
  }

  // H4 -----------------------------------------------------------------------------------------------
  {
    const only = await answer(hostPath, 'fixture-only', tag + '-fixture-only')
    const emptyWorld = await answer(hostPath, 'empty', tag + '-empty')
    const problems = []
    if (only.body === null || only.get.statusCode !== 200) problems.push('the fixture-only fold did not answer 200')
    else {
      if (only.body.teams.teams.length !== 0) problems.push('the fixture-only fold answered ' + show(only.body.teams.teams.map((node) => node.id)) + ' as a world')
      if (only.body.counts.teams !== 0) problems.push('counts.teams=' + show(only.body.counts.teams) + ' for a world with no teams')
      if (only.body.teams.withheld !== 1) problems.push('withheld=' + show(only.body.teams.withheld) + ', expected the one fixture team to be counted')
    }
    if (emptyWorld.body === null || emptyWorld.get.statusCode !== 200) problems.push('the empty fold did not answer 200')
    else if (emptyWorld.body.counts.teams !== 0 || emptyWorld.body.teams.teams.length !== 0) problems.push('the empty fold invented a team')
    check('H4', problems.length === 0,
      problems.length === 0
        ? 'a fold whose only team is a fixture answers teams 0 / counts 0 with the withheld count named, and an empty fold answers 0 without inventing one'
        : problems.join('; '),
      ['fixture-only answer: ' + show(only.body === null ? null : { teams: only.body.teams.teams, counts: only.body.counts.teams, withheld: only.body.teams.withheld })])
  }

  // H5 -----------------------------------------------------------------------------------------------
  {
    const absent = await answer(hostPath, 'absent', tag + '-absent')
    const noReader = await answer(hostPath, 'no-reader', tag + '-no-reader')
    const problems = []
    const code = (result) => (result.body !== null && result.body.error !== undefined ? result.body.error.code : null)
    if (absent.get.statusCode !== 503 || code(absent) !== 'NO_CAPABILITY') problems.push('no linkCollab -> ' + show(absent.get.statusCode) + ' ' + show(code(absent)))
    if (noReader.get.statusCode !== 503 || code(noReader) !== 'NO_STATE_READER') problems.push('a bus without state() -> ' + show(noReader.get.statusCode) + ' ' + show(code(noReader)))
    if (live.get.statusCode !== 200) problems.push('the paired control failed: the same harness answered ' + show(live.get.statusCode))
    check('H5', problems.length === 0,
      problems.length === 0 ? 'no bus -> 503 NO_CAPABILITY, a bus without state() -> 503 NO_STATE_READER, and the same harness with a stand-in -> 200' : problems.join('; '),
      ['absent=' + show(absent.get.statusCode) + '/' + show(code(absent)) + '  no-reader=' + show(noReader.get.statusCode) + '/' + show(code(noReader))])
  }

  // H6 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = response()
      await live.route.handler({ method }, res)
      const answerBody = res.body()
      const refused = answerBody !== null && answerBody.error !== undefined ? answerBody.error.code : null
      if (res.statusCode !== 405) problems.push(method + ' answered ' + res.statusCode)
      if (refused !== 'METHOD_NOT_ALLOWED') problems.push(method + ' was refused with ' + show(refused))
    }
    if (live.get.statusCode !== 200) problems.push('the paired control failed: GET answered ' + live.get.statusCode + ' in this run')
    check('H6', problems.length === 0,
      problems.length === 0 ? 'POST/PUT/DELETE are 405 METHOD_NOT_ALLOWED while GET on the same path answered 200 in this run' : problems.join('; '))
  }
  return { live, tree }
}

/**
 * One client plane: its OWN copy of the built bundle, its OWN kernel locale service, and a recorder on
 * every seat the half reaches for.
 *
 * A fresh copy per plane is not tidiness: the built half keeps page-scoped module state (the marker's
 * press counter among it), so two readings sharing one copy would be reading each other's page.
 * @param options - 'absent' or 'refuses' per service, which is how the fail-closed readings are driven.
 * @returns the plane: the bundle, what the half did with it, its own marker, and the two seats the
 *   action reaches (the panel's seam and the right column).
 */
async function planeOf(options = {}) {
  const { runtime, calls } = localeService()
  const { registration, exports } = clientExports(CLIENT)
  const kept = {
    effects: [], definitions: [], slots: [], slotInjects: [], errors: [], disposers: [],
    declarations: [], openTabCalls: [], notifications: 0, released: [], localeSubscribers: 0,
    applied: false, threw: null,
  }
  const present = (name) => options[name] !== 'absent'
  const services = {
    linkPanel: {
      declare(definition) {
        if (options.declare === 'refuses') throw new Error('PANEL_DUP_ID: duplicate id "' + String(definition === null || definition === undefined ? '' : definition.id) + '" (this spec own refusal)')
        kept.declarations.push(definition)
        return () => { kept.released.push('panel:' + String(definition === null || definition === undefined ? '' : definition.id)) }
      },
      notify() { kept.notifications += 1 },
    },
    sidebarRight: {
      openTab(kind) {
        if (options.openTab === 'refuses') throw new Error('sidebarRight: no session surface is mounted')
        kept.openTabCalls.push(kind)
      },
    },
  }
  if (present('locale')) {
    const subscribe = runtime.subscribe.bind(runtime)
    runtime.subscribe = (listener) => { kept.localeSubscribers += 1; return subscribe(listener) }
  }
  const ctx = {
    effect(fn, label) {
      kept.effects.push(String(label))
      try {
        const dispose = fn()
        const released = typeof dispose === 'function' ? dispose : () => {}
        kept.disposers.push({ label: String(label), dispose: released })
        return released
      } catch (error) {
        kept.errors.push(String(error && error.message))
        return () => {}
      }
    },
    get(name) {
      if (name === 'locale') return present('locale') ? runtime : undefined
      return present(name) ? services[name] ?? undefined : undefined
    },
    locale: present('locale') ? runtime : undefined,
    sidebarRightTabs: { register: (definition) => { kept.definitions.push(definition); return () => {} } },
    slots: {
      inject: (name, factory) => { kept.slotInjects.push(String(name)); try { factory() } catch (error) { kept.errors.push(String(error && error.message)) } return () => {} },
      register: (spec, component) => { kept.slots.push({ options: spec, component }); return () => {} },
    },
  }
  delete globalThis.__dshLinkTeamsPanel
  try {
    exports.apply(ctx)
    kept.applied = true
  } catch (error) {
    kept.threw = String(error && error.message ? error.message : error)
  }
  return {
    registration, exports, kept, runtime, calls, ctx,
    marker: () => globalThis.__dshLinkTeamsPanel ?? null,
    switchLanguage: (next) => runtime.setLocale(next),
  }
}

async function clientPlane() {
  const locales = await import(pathToFileURL(join(PACKAGE, 'src', 'client', 'locales.ts')).href)
  const view = await import(pathToFileURL(join(PACKAGE, 'src', 'client', 'view.ts')).href)
  const zh = locales.zh
  const en = locales.en
  const plane = await planeOf()
  const { registration, exports, kept, runtime, calls } = plane

  // C1 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    if (registration.id !== 'dsh-link-teams') problems.push('the bundle registered id ' + show(registration.id))
    if (typeof exports.apply !== 'function') problems.push('the client half exports no apply()')
    const inject = Array.isArray(exports.inject) ? exports.inject : []
    for (const name of ['slots', 'sidebarRightTabs', 'locale']) if (inject.includes(name) === false) problems.push('inject does not name ' + show(name))
    check('C1', problems.length === 0 && kept.errors.length === 0,
      problems.length === 0 && kept.errors.length === 0 ? 'the built client half is the dsh-link-teams module-loader registration and its apply() ran without an error' : problems.concat(kept.errors).join('; '),
      ['inject: ' + show(inject), 'effects: ' + show(kept.effects)])
  }

  // C2 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    const taken = calls.filter((call) => call.ns === 'dsh-link-teams')
    if (taken.length !== 1) problems.push('the half registered its namespace ' + show(taken.length) + ' time(s), expected exactly one call')
    else if (show(taken[0].locales) !== show(['zh', 'en'])) problems.push('one call carried ' + show(taken[0].locales) + ', expected both dictionaries together')
    let refusal = null
    try {
      runtime.register('dsh-link-teams', 'zh', zh)
    } catch (error) {
      refusal = String(error && error.message ? error.message : error)
    }
    if (refusal === null || refusal.includes('already has locale') === false) problems.push('a second registration of the same pair was not refused by the service: ' + show(refusal))
    check('C2', problems.length === 0,
      problems.length === 0 ? 'ONE call registered { zh, en } under this package own namespace, and the kernel service refused a second (ns, locale) with its own message' : problems.join('; '),
      ['calls: ' + show(calls), 'second registration -> ' + show(refusal)])
  }

  // C3 -----------------------------------------------------------------------------------------------
  {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    const problems = []
    if (show(zhKeys) !== show(enKeys)) problems.push('zh and en carry different key sets')
    const bad = zhKeys.filter((key) => key.startsWith('teams.') === false)
    if (bad.length > 0) problems.push('key(s) outside this namespace: ' + show(bad))
    const empty = zhKeys.filter((key) => String(zh[key]) === '' || String(en[key]) === '')
    if (empty.length > 0) problems.push('empty value(s): ' + show(empty))
    check('C3', problems.length === 0,
      problems.length === 0 ? show(zhKeys.length) + ' keys in both dictionaries, every one under teams., none empty' : problems.join('; '))
  }

  // C4 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    const files = walk(join(PACKAGE, 'src', 'client'), (entry) => /\.(ts|tsx)$/.test(entry))
    const literals = new Set()
    for (const path of files) {
      if (/locales?\.tsx?$/i.test(path)) continue
      const text = blankComments(readFileSync(path, 'utf8'))
      // A literal that ends in a dot is the prefix of a dynamic lookup (\`t('teams.state.' + status)\`); the
      // closed sets below are what check those, so the prefix itself is not a key.
      for (const match of text.matchAll(/\bt\(\s*(['"])([^'"\n]+)\1/g)) if (match[2].endsWith('.') === false) literals.add(match[2])
    }
    const dynamic = []
    for (const status of ['pending', 'in_progress', 'completed', 'deleted', 'provisioning', 'active', 'failed']) dynamic.push('teams.state.' + status)
    for (const kind of ['task', 'member', 'capability', 'team', 'heartbeat', 'peer', 'message', 'session']) dynamic.push('teams.kind.' + kind)
    const asked = [...new Set([...literals, ...dynamic])].filter((key) => key.startsWith('teams.'))
    const missingZh = asked.filter((key) => Object.prototype.hasOwnProperty.call(zh, key) === false)
    const missingEn = asked.filter((key) => Object.prototype.hasOwnProperty.call(en, key) === false)
    if (missingZh.length > 0) problems.push('zh is missing ' + show(missingZh))
    if (missingEn.length > 0) problems.push('en is missing ' + show(missingEn))
    const t = runtime.bind('dsh-link-teams')
    const unresolved = []
    for (const locale of ['zh', 'en']) {
      runtime.setLocale(locale)
      for (const key of asked) if (t(key) === key) unresolved.push(locale + ':' + key)
    }
    runtime.setLocale('zh')
    if (unresolved.length > 0) problems.push('the shipped translator answers the key itself for ' + show(unresolved))
    check('C4', problems.length === 0,
      problems.length === 0 ? 'every key this half can ask for (' + show(asked.length) + ' literals + closed dynamic sets) resolves in zh and en through the kernel service' : problems.join('; '),
      ['asked: ' + show(asked.filter((key) => literals.has(key)))])
  }

  // C5 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    const files = walk(join(PACKAGE, 'src', 'client'), (entry) => /\.(ts|tsx)$/.test(entry))
    const leaked = []
    for (const path of files) {
      if (/locales?\.tsx?$/i.test(path)) continue
      const text = blankComments(readFileSync(path, 'utf8'))
      const match = text.match(/[\u3400-\u9fff\uf900-\ufaff]/)
      if (match !== null) leaked.push(relative(PACKAGE, path).replaceAll('\\', '/') + ':' + String(text.slice(0, match.index).split('\n').length))
    }
    if (leaked.length > 0) problems.push('Chinese written into the half outside the dictionary: ' + show(leaked))
    const values = Object.values(zh).map((value) => String(value))
    const decoded = readFileSync(CLIENT, 'utf8').replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex) => String.fromCharCode(parseInt(hex, 16)))
    const runs = decoded.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) ?? []
    const outside = runs.filter((run) => values.some((value) => value.includes(run)) === false)
    if (outside.length > 0) problems.push('CJK in the built half that is not a dictionary value: ' + show(outside.slice(0, 6)))
    check('C5', problems.length === 0,
      problems.length === 0 ? 'no Chinese outside the dictionary module in src/client/**, and every one of the ' + show(runs.length) + ' CJK run(s) in the decoded built bundle is a zh dictionary value' : problems.join('; '),
      ['scanned ' + show(files.length) + ' source file(s); decoded bundle CJK runs: ' + show(new Set(runs).size) + ' unique'])
  }

  // C6 -----------------------------------------------------------------------------------------------
  {
    const live = await answer(HOST, 'live', 'client-plane')
    const body = live.body
    const t = runtime.bind('dsh-link-teams')
    runtime.setLocale('zh')
    const problems = []
    const tree = view.treeEntries(body.teams)
    const chips = view.headChips(body, t)
    const teamsChip = chips.find((chip) => chip.key === 'teams')
    if (teamsChip === undefined) problems.push('the pane has no teams chip')
    else if (teamsChip.text !== '团队 ' + String(tree.length)) problems.push('the pane chip says ' + show(teamsChip.text) + ' while its tree draws ' + show(tree.length) + ' row(s)')
    else if (teamsChip.text !== '团队 ' + String(body.counts.teams)) problems.push('the pane chip says ' + show(teamsChip.text) + ' while the route counts ' + show(body.counts.teams))
    const labels = tree.map((entry) => entry.label)
    if (labels.some(isFixture)) problems.push('the pane draws a fixture team label: ' + show(labels.filter(isFixture)))
    if (labels.includes('session-31baf8eb') === false) problems.push('the pane does not draw the real session team: ' + show(labels))
    const tasks = view.taskEntries(body, t)
    const ones = tasks.filter((task) => task.id === 'task-1')
    if (ones.length !== 2) problems.push('the pane drew ' + show(ones.length) + ' of the two task-1 rows')
    else if (ones[0].label === ones[1].label) problems.push('the pane labels both task-1 rows ' + show(ones[0].label))
    else if (ones[0].key === ones[1].key) problems.push('the pane keys both task-1 rows alike')
    const only = await answer(HOST, 'fixture-only', 'client-plane-only')
    const onlyChip = view.headChips(only.body, t).find((chip) => chip.key === 'teams')
    if (onlyChip === undefined || onlyChip.text !== '团队 0') problems.push('a fixture-only world is drawn as ' + show(onlyChip === undefined ? null : onlyChip.text))
    check('C6', problems.length === 0,
      problems.length === 0
        ? 'the pane own view agrees with the route: ' + show(teamsChip.text) + ' = ' + show(tree.length) + ' tree row(s) = counts.teams, the two task-1 rows differ (' + show(ones.map((task) => task.label)) + '), and no fixture id is drawn'
        : problems.join('; '),
      ['tree labels: ' + show(labels), 'task labels: ' + show(ones.map((task) => task.label))])
  }

  // C7 -----------------------------------------------------------------------------------------------
  {
    const problems = []
    const definition = kept.definitions.find((entry) => entry.id === 'dsh-link-teams:panel')
    if (definition === undefined) problems.push('no rail tab type with the pane id was registered')
    else {
      if (definition.kind !== 'link-teams') problems.push('the tab type kind is ' + show(definition.kind))
      if (definition.priority !== 'builtin') problems.push('the tab type priority is ' + show(definition.priority))
      if (definition.title() !== zh['teams.title']) problems.push('the tab title is ' + show(definition.title()))
      const guide = Array.isArray(definition.guide) ? definition.guide[0] : undefined
      if (guide === undefined || guide.description() !== zh['teams.guide']) problems.push('the guide entry does not carry the dictionary description')
    }
    for (const name of ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title']) {
      if (kept.slotInjects.includes(name) === false) problems.push('no slots.inject for ' + show(name))
      const entry = kept.slots.find((slot) => slot.options.name === name)
      if (entry === undefined) problems.push('nothing registered on ' + show(name))
      else {
        if (entry.options.key !== 'dsh-link-teams:panel') problems.push(name + ' registered key ' + show(entry.options.key))
        if (entry.options.locale !== 'dsh-link-teams') problems.push(name + ' declares locale ' + show(entry.options.locale) + ' instead of the package namespace')
      }
    }
    check('C7', problems.length === 0,
      problems.length === 0 ? 'the wiring: one tab type (link-teams/builtin) with the dictionary title and guide, and both slot registrations keyed dsh-link-teams:panel and declaring locale: dsh-link-teams' : problems.join('; '),
      ['definitions: ' + show(kept.definitions.map((entry) => entry.id)), 'slots: ' + show(kept.slots.map((slot) => ({ name: slot.options.name, key: slot.options.key, locale: slot.options.locale })))])
  }

  // C8 -----------------------------------------------------------------------------------------------
  // The row itself, as declared: ONE item, of kind action, carrying THIS package's own words.
  {
    const problems = []
    const panel = await planeOf()
    panel.switchLanguage('zh')
    const item = panel.kept.declarations[0]
    const tab = panel.kept.definitions[0]
    const marker = panel.marker()
    if (item === undefined) problems.push('the half declared nothing into the panel seam')
    else {
      if (panel.kept.declarations.length !== 1) problems.push('it declared ' + show(panel.kept.declarations.length) + ' item(s); one half declares one row')
      if (item.id !== 'dsh-link-teams:open-panel') problems.push('the id is ' + show(item.id) + ', not this package own namespaced id')
      if (item.kind !== 'action') problems.push('the kind is ' + show(item.kind) + ', not the seam own word for something to do')
      if (item.source !== 'dsh-link-teams') problems.push('the source is ' + show(item.source))
      if (Number.isFinite(item.order) === false || item.order <= 0 || item.order >= 40) problems.push('the order is ' + show(item.order) + ', outside the range the panel own rows use')
      if (typeof item.title !== 'function') problems.push('the title is ' + typeof item.title + ', not a thunk over the dictionary')
      else {
        if (item.title() !== zh['teams.panel.action']) problems.push('the title is ' + show(item.title()) + ', not this package own zh word ' + show(zh['teams.panel.action']))
        if (item.title() === en['teams.panel.action']) problems.push('the title is the en value even though the page is zh: the row is not reading the dictionary')
      }
      if (Object.prototype.hasOwnProperty.call(item, 'body')) problems.push('an action carries no body, and this one does')
      if (typeof item.invoke !== 'function') problems.push('invoke is ' + typeof item.invoke + ', so the row promises a press nobody can make')
      if (show(Object.keys(item)) !== show(['id', 'kind', 'source', 'order', 'title', 'invoke'])) problems.push('the declaration carries ' + show(Object.keys(item)))
    }
    const actionEffect = panel.kept.disposers.filter((entry) => entry.label === 'dsh-link-teams: panel action')[0]
    if (actionEffect === undefined) problems.push('the contribution is not bound through ctx.effect, so it would outlive the half')
    else {
      actionEffect.dispose()
      if (panel.kept.released.includes('panel:dsh-link-teams:open-panel') === false) problems.push('disposing the effect did not take the row back out of the seam: ' + show(panel.kept.released))
    }
    if (marker === null) problems.push('the half recorded nothing in its own marker')
    else {
      if (marker.declared !== true) problems.push('the marker says the row was not declared: ' + show(marker.failed))
      if (marker.id !== 'dsh-link-teams:open-panel') problems.push('the marker names item ' + show(marker.id))
      if (tab === undefined) problems.push('no tab type was registered, so the row has no kind to be read against')
      else if (marker.tabKind !== tab.kind) problems.push('the marker names tab kind ' + show(marker.tabKind) + ' while the tab type carries ' + show(tab.kind))
    }
    check('C8', problems.length === 0,
      problems.length === 0
        ? 'one action row is declared into the panel seam, with this package own id/source and the zh dictionary word ' + show(zh['teams.panel.action']) + ' (the en word is ' + show(en['teams.panel.action']) + '), no body, a callable invoke, and disposing the ctx.effect takes the row back out with the half (' + show(panel.kept.released) + ')'
        : problems.join('; '),
      ['the declaration: ' + show(item === undefined ? null : { id: item.id, kind: item.kind, source: item.source, order: item.order, title: item.title(), keys: Object.keys(item) }), 'the marker: ' + show(marker === null ? null : { declared: marker.declared, tabKind: marker.tabKind, tabId: marker.tabId })])
  }

  // C9 -----------------------------------------------------------------------------------------------
  // The press: invoke opens the KIND this same half registered, read out of the tab type itself.
  {
    const problems = []
    const panel = await planeOf()
    const tab = panel.kept.definitions[0]
    const item = panel.kept.declarations[0]
    if (tab === undefined || item === undefined) problems.push('no tab type or no declared row, so invoke has nothing to be judged against')
    else {
      item.invoke()
      const marker = panel.marker()
      const last = marker === null || marker.lastInvoke === null || marker.lastInvoke === undefined ? null : marker.lastInvoke
      if (panel.kept.openTabCalls.length !== 1) problems.push('openTab was called ' + show(panel.kept.openTabCalls.length) + ' time(s) for one press')
      if (panel.kept.openTabCalls[0] !== tab.kind) problems.push('openTab was called with ' + show(panel.kept.openTabCalls[0]) + ' while the tab type carries kind ' + show(tab.kind))
      if (typeof tab.kind !== 'string' || tab.kind.length === 0) problems.push('the tab type kind is ' + show(tab.kind))
      if (last === null) problems.push('the press was not recorded in this package own marker')
      else {
        if (last.ok !== true) problems.push('the marker says the press failed: ' + show(last.failed))
        if (last.failed !== null) problems.push('the marker carries a failure for a press that held: ' + show(last.failed))
        if (last.kind !== tab.kind) problems.push('the marker names kind ' + show(last.kind) + ' while the tab type carries ' + show(tab.kind))
        if (Object.values(last).some((value) => typeof value === 'function')) problems.push('the marker row carries a function, so it is not readable data')
      }
      if (marker === null ? null : marker.invokes !== 1) problems.push('the marker counted ' + show(marker === null ? null : marker.invokes) + ' press(es) for one press')
    }
    check('C9', problems.length === 0,
      problems.length === 0
        ? 'invoke called the right column openTab exactly once, with the kind READ out of the tab type this half registered (' + show(tab.kind) + '), and this package own marker names the same kind'
        : problems.join('; '),
      ['openTab calls: ' + show(panel.kept.openTabCalls), 'the tab type kind: ' + show(tab === undefined ? null : tab.kind), 'the marker: ' + show(panel.marker())])
  }

  // C10 ----------------------------------------------------------------------------------------------
  // A page with no panel service and no locale service: nothing throws, and the half is still there.
  {
    const problems = []
    const bare = await planeOf({ linkPanel: 'absent', locale: 'absent' })
    const marker = bare.marker()
    const tab = bare.kept.definitions[0]
    if (bare.kept.threw !== null) problems.push('apply() threw: ' + bare.kept.threw)
    if (bare.kept.applied !== true) problems.push('apply() did not run to the end')
    if (bare.kept.declarations.length !== 0) problems.push('something was declared into a seam that is not there')
    if (tab === undefined) problems.push('the tab type was not registered on a page with no panel')
    else {
      if (tab.id !== 'dsh-link-teams:panel') problems.push('the tab type id is ' + show(tab.id))
      if (tab.kind !== 'link-teams') problems.push('the tab type kind is ' + show(tab.kind))
      if (tab.title() !== zh['teams.title']) problems.push('the words do not answer from this package own zh dictionary: ' + show(tab.title()))
    }
    if (bare.kept.slotInjects.length !== 2) problems.push('the slots were not both filled: ' + show(bare.kept.slotInjects))
    if (bare.kept.errors.length !== 0) problems.push('the half recorded an error of its own: ' + show(bare.kept.errors))
    if (marker === null) problems.push('the absence was not recorded in this package own marker')
    else {
      if (marker.declared !== false) problems.push('the marker claims the row was declared')
      if (String(marker.failed).startsWith('linkPanel-unavailable') === false) problems.push('the marker does not NAME what was missing: ' + show(marker.failed))
      if (marker.id !== 'dsh-link-teams:open-panel') problems.push('the marker does not name the row that was not declared: ' + show(marker.id))
      if (String(marker.dictionaries).startsWith('locale-unavailable') === false) problems.push('the absent locale service is not named either: ' + show(marker.dictionaries))
    }
    check('C10', problems.length === 0,
      problems.length === 0
        ? 'a page with no panel service and no locale service: apply() threw nothing, the tab type (link-teams) and both slots are still registered, the words answer from the zh dictionary, and the marker NAMES both absences'
        : problems.join('; '),
      ['the marker: ' + show(marker), 'tab type: ' + show(tab === undefined ? null : { id: tab.id, kind: tab.kind, title: tab.title() }), 'slots: ' + show(bare.kept.slotInjects)])
  }

  // C11 ----------------------------------------------------------------------------------------------
  // A refusal, wherever it comes from, is named and contained - never thrown at the panel.
  {
    const problems = []
    // (a) the panel takes the row, the column is there, and openTab throws its own sentence.
    const throwing = await planeOf({ openTab: 'refuses' })
    const throwingItem = throwing.kept.declarations[0]
    let escaped = null
    try { throwingItem.invoke() } catch (error) { escaped = String(error && error.message ? error.message : error) }
    const thrownMarker = throwing.marker()
    const thrownLast = thrownMarker === null || thrownMarker.lastInvoke === null || thrownMarker.lastInvoke === undefined ? null : thrownMarker.lastInvoke
    if (escaped !== null) problems.push('a throwing openTab escaped invoke: ' + escaped)
    if (throwing.kept.openTabCalls.length !== 0) problems.push('a refusing openTab was recorded as having opened ' + show(throwing.kept.openTabCalls))
    if (thrownLast === null) problems.push('the refusal was not recorded in this package own marker')
    else {
      if (thrownLast.ok !== false) problems.push('the marker calls a refused press a success')
      if (String(thrownLast.failed).startsWith('openTab-refused') === false) problems.push('the refusal is not named: ' + show(thrownLast.failed))
      if (String(thrownLast.failed).includes('no session surface is mounted') === false) problems.push('the refusal does not carry the service own words: ' + show(thrownLast.failed))
    }
    if (thrownMarker === null ? null : thrownMarker.invokes !== 1) problems.push('the marker counted ' + show(thrownMarker === null ? null : thrownMarker.invokes) + ' press(es)')
    // (b) the panel takes the row and there is no right column at all.
    const naked = await planeOf({ sidebarRight: 'absent' })
    const nakedItem = naked.kept.declarations[0]
    let nakedEscaped = null
    try { nakedItem.invoke() } catch (error) { nakedEscaped = String(error && error.message ? error.message : error) }
    const nakedMarker = naked.marker()
    const nakedLast = nakedMarker === null || nakedMarker.lastInvoke === null || nakedMarker.lastInvoke === undefined ? null : nakedMarker.lastInvoke
    if (nakedEscaped !== null) problems.push('an absent right column escaped invoke: ' + nakedEscaped)
    if (String(nakedLast === null ? null : nakedLast.failed).startsWith('sidebarRight-unavailable') === false) problems.push('the absent column is not named: ' + show(nakedLast === null ? null : nakedLast.failed))
    // (c) the panel itself refuses the declaration, and the rest of the half still stands.
    const refusing = await planeOf({ declare: 'refuses' })
    const refusingMarker = refusing.marker()
    if (refusing.kept.threw !== null) problems.push('a refusing panel broke apply(): ' + refusing.kept.threw)
    if (refusingMarker === null || refusingMarker.declared !== false) problems.push('a refused declaration is not recorded as not declared')
    if (String(refusingMarker === null ? null : refusingMarker.failed).startsWith('linkPanel-declare-refused') === false) problems.push('the refused declaration is not named: ' + show(refusingMarker === null ? null : refusingMarker.failed))
    if (String(refusingMarker === null ? null : refusingMarker.failed).includes('PANEL_DUP_ID') === false) problems.push('the refusal does not carry the panel own words: ' + show(refusingMarker === null ? null : refusingMarker.failed))
    if (refusing.kept.definitions.length !== 1) problems.push('a refused declaration took the tab type with it: ' + show(refusing.kept.definitions.length))
    if (refusing.kept.slotInjects.length !== 2) problems.push('a refused declaration took the slots with it: ' + show(refusing.kept.slotInjects))
    check('C11', problems.length === 0,
      problems.length === 0
        ? 'a throwing openTab, an absent right column and a panel that refuses the declaration are each caught, named in this package own marker with the service own words, and leave the tab type and both slots standing'
        : problems.join('; '),
      ['openTab-refused: ' + show(thrownLast === null ? null : thrownLast.failed), 'sidebarRight-unavailable: ' + show(nakedLast === null ? null : nakedLast.failed), 'declare-refused: ' + show(refusingMarker === null ? null : refusingMarker.failed)])
  }

  // C12 ----------------------------------------------------------------------------------------------
  // A language switch reaches the seam through its own notify(): the row follows, and is not re-declared.
  {
    const problems = []
    const panel = await planeOf()
    panel.switchLanguage('zh')
    const item = panel.kept.declarations[0]
    const tab = panel.kept.definitions[0]
    const before = item === undefined ? null : item.title()
    const notificationsBefore = panel.kept.notifications
    panel.switchLanguage('en')
    if (panel.kept.localeSubscribers !== 1) problems.push('the half subscribed to the locale service ' + show(panel.kept.localeSubscribers) + ' time(s), expected exactly one')
    if (item === undefined) problems.push('no declared row, so nothing can be watched across a switch')
    else {
      if (item.title() !== en['teams.panel.action']) problems.push('the row still says ' + show(item.title()) + ' after the switch; the en word is ' + show(en['teams.panel.action']))
      if (item.title() === before) problems.push('the row did not move with the language')
    }
    if (panel.kept.notifications - notificationsBefore !== 1) problems.push('the switch reached the seam ' + show(panel.kept.notifications - notificationsBefore) + ' time(s) instead of once')
    if (panel.kept.declarations.length !== 1) problems.push('the row was re-declared to change language: ' + show(panel.kept.declarations.length) + ' row(s)')
    if (tab === undefined) problems.push('no tab type was registered')
    else if (tab.title() !== en['teams.title']) problems.push('the tab type words did not follow the switch either: ' + show(tab.title()))
    check('C12', problems.length === 0,
      problems.length === 0
        ? 'one locale subscription and one notify() carried the switch to the panel: the row moved from ' + show(before) + ' to ' + show(item === undefined ? null : item.title()) + ' without being re-declared, and the tab type moved with it'
        : problems.join('; '),
      ['row before/after: ' + show([before, item === undefined ? null : item.title()]), 'notifications: ' + show(panel.kept.notifications), 'declarations: ' + show(panel.kept.declarations.length)])
  }
}

// ----------------------------------------------------------------------------------------------- the attack
/** Stage a copy of the host artifact whose world is the OLD pass-through. */
async function selfAttack() {
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-link-teams-attack-'))
  try {
    const staged = join(scratch, 'index.mjs')
    const before = readFileSync(HOST, 'utf8')
    const anchor = 'const world = composeWorld(state);'
    if (before.includes(anchor) === false) {
      console.log('NOT MEASURED: the mutant anchor ' + show(anchor) + ' is not in the built host half')
      return 3
    }
    writeFileSync(staged, before.replace(anchor, 'const world = { teams: state.teams, counts: state.counts };'))
    const rowsBefore = rows.length
    await hostPlane(staged, 'attack')
    const moved = rows.slice(rowsBefore).filter((row) => row.ok === false).map((row) => row.id)
    const want = ['H1', 'H2', 'H4']
    const ok = want.every((id) => moved.includes(id))
    console.log('')
    console.log((ok ? 'ok   ' : 'FAIL ') + 'ATTACK  the pass-through mutant reddens ' + show(moved) + ' (declared: ' + show(want) + ')')
    return ok ? 0 : 1
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------------------------------- main
if (existsSync(HOST) === false || existsSync(CLIENT) === false) {
  console.error('the built halves are missing (run: node plugins/build.mjs): ' + HOST + ', ' + CLIENT)
  process.exit(3)
}
if (existsSync(LOCALE_BUNDLE) === false) {
  console.error('the kernel client locale bundle is not on this machine: ' + LOCALE_BUNDLE)
  process.exit(3)
}

let exit = 0
if (SELF_ATTACK) {
  exit = await selfAttack()
} else {
  await hostPlane(HOST, 'base')
  await clientPlane()
  const failed = rows.filter((row) => row.ok !== true)
  console.log('')
  console.log(rows.length - failed.length + '/' + rows.length + ' reading(s) held' + (failed.length === 0 ? '' : '; failed: ' + show(failed.map((row) => row.id))))
  exit = failed.length === 0 ? 0 : 1
}
process.exit(exit)
