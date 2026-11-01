#!/usr/bin/env node
/**
 * Gate (R217) - the collaboration bus reads TWO kernel lines' message flow, and says which one it read.
 *
 * WHY THIS EXISTS. The two supported kernels write the same fact in different places:
 *   - 0.2.1-alpha.1 appends `team/message/queued` and `team/message/delivered` to the LEAD's own log,
 *     so one ledger sees a team message in BOTH directions.
 *   - 0.2.1-alpha.5 appends no Team mailbox event at all: the message is steered into the TARGET's
 *     inbox as `agent/inbox/spliced` with source = { kind: 'agent-message', form: 'relay',
 *     senderSessionId }, so the same ledger only ever sees what was delivered INTO this end.
 * A row that counts "messages" therefore means one thing on one kernel and half of it on the other.
 * The shipped producer (plugins/dsh-link-collab/src/index.ts and src/bus-status.ts, built into
 * lib/index.js + lib/client.js) claims four things, and until now nothing measured any of them: that
 * both shapes map to one `team.message` record, that every OTHER inbox splice (a user steer, a
 * prompt) is refused, that the status document NAMES which source the ledger holds, and that the
 * panel's row says so where the count means less than it looks.
 *
 * WHAT THIS GATE DOES NOT PROVE - said here because a gate that overclaims is worse than none:
 *   - It does not prove the kernel writes these events. The fixtures are synthetic: their fields are
 *     the ones the producer reads and the ones the recorded event vocabulary names
 *     (docs/handoff/R14-live-path.md:149-157 saw `agent/inbox/spliced` in a real session). A kernel
 *     that writes NEITHER kind is indistinguishable here from a quiet team - reading 4 reports 'none'
 *     as the document's own word, and whether that word is right is a live-kernel question.
 *   - It does not prove a message was delivered or that the relay works (verify-collab-relay*), nor
 *     that the panel DRAWS the row (test/panel-status-selfcheck.mjs owns the mount): reading 5
 *     measures the row's WORDS from the row function itself, not through a page.
 *   - It does not arm the shipped DSH_LINK_COLLAB_ATTACKS switches: no shipped flag exists for the
 *     message mapping, so every --self-attack mutant is a lie told at the seam this gate reads over
 *     the shipped function, never an edit to the plugin.
 *
 * READINGS (each independently failable, each printing its measured value):
 *   1  a legacy `team/message/queued` (and `delivered`) event maps to a team.message record carrying
 *      payload.state queued/delivered AND the sender/target the event itself carried.
 *   2  an `agent/inbox/spliced` whose inserted message carries source.kind === 'agent-message' maps to
 *      a team.message record with payload.state 'accepted', payload.scope 'this-end', the
 *      senderSessionId as actor AND payload.senderId, and the inbox target - for THREE targets, two
 *      of them the ones this round names (next-turn, next-step), so the target cannot be a rule.
 *   3  a splice carrying anything else - a user steer, a message with no source, an empty insert - maps
 *      to null, so a user steer never enters the bus ledger as team traffic; and a splice with two
 *      inserted messages where only the SECOND is a relay maps, and takes the second.
 *   4  the status document the ROUTE answers names its source: a journal-only ledger reads
 *      ('journal','both-directions'), an inbox-only ledger ('inbox','this-end-only'), a ledger with
 *      neither ('none','none'), and one holding both ('both','this-end-only'). Built by the shipped
 *      builder, driven the way the panel drives it: real `apply()`, real ledger, real route handler.
 *   5  the row says it: bodyText appends exactly the one suffix named by the scope, in BOTH shipped
 *      languages, and nothing for 'both-directions' or 'unknown'; and what the row says is read out of
 *      the document the route answered, through the shipped readAnswer.
 *   6  the readings this file declares are the readings it produced.
 *
 * Usage: node scripts/verify-collab-message-sources.mjs [--self-attack] [--keep]
 * Exit 0 every reading held | 1 a reading failed or a mutant did not land | 3 an input is missing
 * (a built half, or the module's own exports). Exit 3 is never a verdict on the product.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const SELF_ATTACK = argv.includes('--self-attack')
const KEEP = argv.includes('--keep')

const HOST_PATH = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')
const CLIENT_PATH = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'client.js')
const STATUS_PATH = '/api/dsh-link-collab/status'
const DECLARED = 6

const R1 = '1-a-legacy-team-message-still-maps'
const R2 = '2-a-relay-splice-maps-whatever-its-target'
const R3 = '3-a-splice-that-is-not-a-team-message-is-refused'
const R4 = '4-the-status-names-the-source'
const R5 = '5-the-row-says-the-same'
const R6 = '6-declared-readings-equal-produced'

const msg = (error) => String(error && error.message ? error.message : error)
const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch (error) { return '<unserialisable: ' + msg(error) + '>' } }
const clip = (text, width) => { const line = String(text === undefined || text === null ? '' : text); return line.length <= width ? line : line.slice(0, width) + '...' }
/** An input this machine does not have is exit 3, never a pass and never a failure. */
const notMeasured = (why) => { console.log('NOT MEASURED: ' + why); process.exit(3) }
const missing = (why) => Object.assign(new Error(why), { missing: true })

for (const [label, path] of [['the built host half', HOST_PATH], ['the built client half', CLIENT_PATH]]) if (existsSync(path) !== true) notMeasured(label + ' is not on this machine: ' + path + ' - run the plugin build')

const host = await import(pathToFileURL(HOST_PATH).href)
for (const name of ['teamEventToRecord', 'apply']) if (typeof host[name] !== 'function') notMeasured(HOST_PATH + ' exports no ' + name + ' (typeof ' + typeof host[name] + '); exports that mention it: ' + show(Object.keys(host).filter((one) => /team|record|apply|message/i.test(one))))

/**
 * The row's own functions, taken FROM THE SHIPPED BUNDLE. lib/client.js registers a factory with the
 * page loader and exports only apply/inject; bodyText and readAnswer stay private to that closure.
 * Rather than copy them (a copy cannot drift with the product, which is the whole point), this
 * evaluates the shipped factory for real and rebuilds the SAME body with one extra statement: return
 * the row functions it already declared. If a future build minifies those names away: exit 3.
 */
const loadClient = () => {
  const text = readFileSync(CLIENT_PATH, 'utf8')
  let registration = null
  try { new Function('window', text)({ __ModuleLoader__: { load(one) { registration = one } } }) } catch (error) {
    notMeasured('the client bundle could not be evaluated the way the page evaluates it: ' + clip(msg(error), 200))
  }
  if (registration === null || typeof registration.factory !== 'function') notMeasured('the client bundle registered no factory with the page loader: ' + CLIENT_PATH)
  const source = registration.factory.toString()
  const open = source.indexOf('=> {')
  const close = source.lastIndexOf('}')
  if (open === -1 || close <= open) notMeasured('the client factory is not a function body this gate can read: ' + clip(source, 160))
  const body = source.slice(open + 4, close)
  const tail = 'return module.exports;'
  const at = body.lastIndexOf(tail)
  if (at === -1) notMeasured('the client factory no longer ends with "' + tail + '", so its private row functions cannot be reached: ' + CLIENT_PATH)
  const rebuilt = body.slice(0, at) + String.fromCharCode(10) + 'return { apply, bodyText, readAnswer, bindTranslate, substitute, zh, en };'
  let built = null
  try { built = new Function('require', rebuilt)((specifier) => { throw new Error('the client half asked for ' + specifier + ', which this gate does not provide') }) } catch (error) {
    notMeasured('the client bundle could not be rebuilt with its row functions exposed: ' + clip(msg(error), 200))
  }
  const absent = ['bodyText', 'readAnswer', 'bindTranslate', 'substitute', 'zh', 'en'].filter((name) => built[name] === undefined)
  if (absent.length > 0) notMeasured('the client bundle carries no ' + absent.join('/') + ' in its scope (minified?), so the row cannot be measured: ' + CLIENT_PATH)
  return built
}
const client = loadClient()

/** The shipped dictionary, read the way the page reads it: one language, its own templates. */
const translate = (language) => client.bindTranslate({ register() { return undefined }, bind() { return (key, params) => client.substitute((client[language] ?? client.zh)[key] ?? key, params) } })

// The fixtures: synthetic session events, in the shapes the producer reads.
const SENDER = 'sess-lead'
const TARGET = 'sess-worker'
const TEAM = 'gate-r217'

const legacyQueued = (id) => ({ type: 'team/message/queued', data: { version: 2, teamId: TEAM, message: { id, senderId: SENDER, senderName: 'lead', targetId: TARGET, content: [] } } })
const legacyDelivered = (id) => ({ type: 'team/message/delivered', data: { version: 2, teamId: TEAM, messageId: id, targetId: TARGET } })
const relayMessage = (id, senderSessionId) => ({ id, role: 'user', content: [], source: { kind: 'agent-message', form: 'relay', senderSessionId } })
const steerMessage = (id) => ({ id, role: 'user', content: [], source: { kind: 'user' } })
const splice = (target, inserted) => ({ type: 'agent/inbox/spliced', data: { target, inserted } })
const taskEvent = (id) => ({ type: 'team/task', data: { version: 2, teamId: TEAM, task: { id, revision: 1, subject: 'not a message', status: 'pending', blockedBy: [] } } })

/** The four ledgers reading 4 judges. `expect` is what this gate says the document must name. */
const WORLD_SPECS = [
  { name: 'journal-only', why: 'a ledger from the alpha.1 line: the Team mailbox events, both directions', events: [legacyQueued('msg-j1'), legacyDelivered('msg-j2')], expect: { journal: 2, inbox: 0, source: 'journal', scope: 'both-directions' } },
  { name: 'inbox-only', why: 'a ledger from the alpha.5 line: one relay splice, with a user steer inserted before it', events: [splice('next-turn', [steerMessage('msg-i0'), relayMessage('msg-i1', SENDER)])], expect: { journal: 0, inbox: 1, source: 'inbox', scope: 'this-end-only' } },
  { name: 'neither', why: 'a ledger that carries work and a user steer but no team message at all', events: [taskEvent('task-1'), splice('next-step', [steerMessage('msg-n1')])], expect: { journal: 0, inbox: 0, source: 'none', scope: 'none' } },
  { name: 'both', why: 'an upgraded log: it holds a journal row and an inbox row', events: [legacyQueued('msg-b1'), splice('next-step', [relayMessage('msg-b2', SENDER)])], expect: { journal: 1, inbox: 1, source: 'both', scope: 'this-end-only' } },
]

/** What this gate reads: every member is a seam over a shipped function, so a mutant can make ONE lie. */
const makeSubject = () => ({
  mapEvent: (event) => host.teamEventToRecord(event),
  finish: (document) => document,
  body: (reading, failure, t) => client.bodyText(reading, failure, t),
  read: (input) => client.readAnswer(input),
})

// One world: the shipped plugin applied over its own ledger, then the route the panel reads.

/** Console captured, so a plugin applying itself four times does not bury the readings. */
const capture = () => {
  const lines = []
  const real = { log: console.log, error: console.error, warn: console.warn }
  const push = (...args) => { lines.push(args.map((one) => (typeof one === 'string' ? one : show(one))).join(' ')) }
  console.log = push; console.error = push; console.warn = push
  return { lines, restore() { Object.assign(console, real) } }
}

/** The panel's own way in: a GET on the bound route, answered by the host's handler. */
const answerOf = (route) => {
  const response = { statusCode: 0, body: '', setHeader() { return undefined }, end(text) { this.body = text ?? '' } }
  route.handler({ method: 'GET' }, response)
  let document = null
  try { document = JSON.parse(response.body) } catch (error) { document = null }
  return { status: response.statusCode, document }
}

const buildWorld = async (subject, spec, root) => {
  const home = mkdtempSync(join(root, spec.name + '-'))
  mkdirSync(join(home, 'collab'), { recursive: true })
  const routes = []
  const provided = new Map()
  const disposers = []
  const server = { register(route) { routes.push(route); return () => undefined } }
  const ctx = {
    get(name) { if (name === 'dshHomePath') return (sub) => join(home, sub); if (name === 'webServer') return server; return provided.get(name) },
    inject(_names, work) { work({ get: (name) => (name === 'webServer' ? server : undefined) }) },
    provide(name, value) { provided.set(name, value) },
    effect(work) { const produced = work(); if (typeof produced === 'function') disposers.push(produced); return () => undefined },
    on() { return () => undefined },
  }
  const print = capture()
  let threw = null
  try { host.apply(ctx, {}) } catch (error) { threw = msg(error) } finally { print.restore() }
  const capability = provided.get('linkCollab')
  if (capability === undefined || capability.log === undefined) {
    throw missing('the host half did not publish a linkCollab capability over ' + home + ', so no ledger exists to read'
      + (threw === null ? '' : ' (apply threw: ' + clip(threw, 160) + ')')
      + '; it printed: ' + show(print.lines.filter((one) => /unavailable|refused|error/i.test(one)).slice(0, 3)))
  }
  const mapped = []
  for (const event of spec.events) {
    const record = subject.mapEvent(event)
    mapped.push(record)
    if (record !== null && typeof record === 'object') await capability.log.append(record)
  }
  const route = routes.find((one) => one.path === STATUS_PATH)
  const answered = route === undefined ? null : answerOf(route)
  const face = typeof capability.status?.read === 'function' ? capability.status.read() : null
  const rows = capability.log.replay()
  const messages = rows.filter((row) => row.kind === 'team.message')
  for (const dispose of disposers) { try { dispose() } catch (error) { /* teardown of a temp world: not a verdict */ } }
  if (KEEP !== true) { try { rmSync(home, { recursive: true, force: true }) } catch (error) { /* a leftover temp dir is not a verdict */ } }
  return {
    spec, routeBound: route !== undefined && capability.status?.bound === true, status: answered === null ? null : answered.status,
    document: answered === null || answered.document === null ? null : subject.finish(answered.document),
    face: face === null ? null : subject.finish(face)?.messages ?? null,
    records: rows.length, messageRows: messages.length, messageStates: messages.map((row) => row.payload?.state ?? null),
  }
}

// The readings. Pure over the subject, so a mutant is judged by the same six questions.
const measure = async (subject, root) => {
  const rows = []
  const record = (id, ok, detail) => { rows.push({ id, ok: ok === true, detail }); return ok === true }
  const judged = (problems, evidence) => [...problems.map((one) => 'FAILED: ' + one), ...evidence].join(' | ')
  /** Does one record carry the named fields? Paths are 'field' for the record and 'payload.field' for its payload. */
  const fields = (value, wanted) => {
    const problems = []
    const source = value !== null && typeof value === 'object' ? value : {}
    const payload = source.payload !== null && typeof source.payload === 'object' ? source.payload : {}
    const got = {}
    for (const [path, want] of Object.entries(wanted)) {
      const [head, tail] = path.split('.')
      const seen = tail === undefined ? source[head] : payload[tail]
      got[path] = seen
      if (seen !== want) problems.push(path + ' is ' + show(seen) + ', this gate requires ' + show(want))
    }
    return { problems, got }
  }

  // 1 ---------------------------------------------------------------- the legacy line still maps
  {
    const problems = []
    const evidence = []
    const queued = fields(subject.mapEvent(legacyQueued('msg-q-1')), { kind: 'team.message', 'payload.state': 'queued', 'payload.id': 'msg-q-1', 'payload.senderId': SENDER, 'payload.targetId': TARGET, actor: 'lead', subject: TARGET })
    const delivered = fields(subject.mapEvent(legacyDelivered('msg-d-1')), { kind: 'team.message', 'payload.state': 'delivered', 'payload.id': 'msg-d-1', 'payload.targetId': TARGET, subject: TARGET })
    problems.push(...queued.problems.map((one) => 'queued: ' + one), ...delivered.problems.map((one) => 'delivered: ' + one))
    evidence.push('team/message/queued -> ' + show(queued.got), 'team/message/delivered -> ' + show(delivered.got))
    record(R1, problems.length === 0, judged(problems, evidence))
  }

  // 2 ---------------------------------------------- the alpha.5 line maps, and the target is not a rule
  {
    const problems = []
    const evidence = []
    for (const target of ['next-turn', 'next-step', 'a-target-the-producer-never-saw']) {
      const sender = 'sess-sender-for-' + target
      const measured = fields(subject.mapEvent(splice(target, [relayMessage('msg-' + target, sender)])), {
        kind: 'team.message', 'payload.id': 'msg-' + target, 'payload.state': 'accepted', 'payload.scope': 'this-end',
        'payload.senderId': sender, actor: sender, 'payload.target': target, subject: target,
      })
      problems.push(...measured.problems.map((one) => 'splice on ' + target + ': ' + one))
      evidence.push('agent/inbox/spliced(target=' + target + ') -> ' + show(measured.got))
    }
    record(R2, problems.length === 0, judged(problems, evidence))
  }

  // 3 ------------------------------------------- every other splice is refused, and the SECOND one counts
  {
    const problems = []
    const evidence = []
    const refusals = [
      ['a user steer', splice('next-turn', [steerMessage('msg-u-1')])],
      ['a message with no source at all', splice('next-turn', [{ id: 'msg-u-2', role: 'user', content: [] }])],
      ['a splice that inserted nothing', splice('next-turn', [])],
      ['a splice whose inserted array is not an array', { type: 'agent/inbox/spliced', data: { target: 'next-turn', inserted: null } }],
      ['an event the recorder never knew', { type: 'user/message', data: { role: 'user', content: [] } }],
    ]
    for (const [label, event] of refusals) {
      const got = subject.mapEvent(event)
      if (got !== null) problems.push(label + ' mapped to ' + show(got) + ' instead of null, so it would enter the bus ledger as team traffic')
      evidence.push(label + ' -> ' + show(got))
    }
    // The second inserted message is the relay: a producer that only looks at inserted[0] records the
    // user steer and misses the team message. WHICH message was taken is this reading's question; the
    // state and scope it carries are reading 2's, so a lie about them does not redden this one too.
    const second = fields(subject.mapEvent(splice('next-step', [steerMessage('msg-t1'), relayMessage('msg-t2', SENDER)])), { kind: 'team.message', 'payload.id': 'msg-t2' })
    problems.push(...second.problems.map((one) => 'two inserted, only the second a relay: ' + one))
    evidence.push('two inserted, only the second a relay -> ' + show(second.got))
    record(R3, problems.length === 0, judged(problems, evidence))
  }

  // 4 ------------------------------------------------------ the status document names its source
  const worlds = []
  for (const spec of WORLD_SPECS) worlds.push(await buildWorld(subject, spec, root))
  {
    const problems = []
    const evidence = []
    for (const world of worlds) {
      const document = world.document
      const measured = document === null || typeof document.messages !== 'object' ? null : document.messages
      const want = world.spec.expect
      evidence.push(world.spec.name + ' (' + world.spec.why + '): route ' + show(world.status) + ', ledger ' + String(world.records) + ' row(s) '
        + show(world.messageStates) + ' -> messages ' + show(measured) + ', this gate requires ' + show(want))
      if (document === null || document.ok !== true) { problems.push(world.spec.name + ': the status route answered no ok document (status ' + show(world.status) + ')'); continue }
      if (document.path !== STATUS_PATH) problems.push(world.spec.name + ': the document answers on ' + show(document.path) + ', not ' + show(STATUS_PATH))
      if (measured === null) { problems.push(world.spec.name + ': the document carries no messages object at all, so the source is unnamed'); continue }
      for (const field of ['journal', 'inbox', 'source', 'scope']) {
        if (measured[field] !== want[field]) problems.push(world.spec.name + ': messages.' + field + ' is ' + show(measured[field]) + ', this gate requires ' + show(want[field]))
      }
      if (measured.journal + measured.inbox !== world.messageRows) problems.push(world.spec.name + ': the document counts ' + String(measured.journal + measured.inbox) + ' message(s); the ledger holds ' + String(world.messageRows))
      if (world.routeBound !== true) problems.push(world.spec.name + ': the status route is not bound, so the panel has nothing to read')
      if (world.face !== null && show(world.face) !== show(measured)) problems.push(world.spec.name + ': the route answers ' + show(measured) + ' and linkCollab.status.read() answers ' + show(world.face))
    }
    evidence.push('busStatus is ' + typeof host.busStatus + ' among the exports, so the document is read where the panel reads it (the bound route) and cross-checked against the host face that wraps the same builder')
    record(R4, problems.length === 0, judged(problems, evidence))
  }

  // 5 ------------------------------------------------------------- the row says what was measured
  {
    const problems = []
    const evidence = []
    const numbers = { teams: 3, members: 2, records: 11, relayBound: false, path: STATUS_PATH }
    for (const language of ['zh', 'en']) {
      const t = translate(language)
      const thisEnd = t('panel.status.messagesThisEnd')
      const none = t('panel.status.messagesNone')
      for (const [key, suffix] of [['panel.status.messagesThisEnd', thisEnd], ['panel.status.messagesNone', none]]) {
        if (suffix === key) problems.push(language + ': the dictionary answers the key ' + show(key) + ' instead of a template, so the row would draw a key name')
        if (suffix.trim() === '') problems.push(language + ': ' + key + ' is empty, so the row would say nothing')
      }
      if (thisEnd === none) problems.push(language + ': both scopes translate to the same words (' + show(thisEnd) + '), so the row cannot say either')
      const base = subject.body({ ...numbers, messagesScope: 'both-directions' }, null, t)
      for (const [scope, suffix] of [['this-end-only', thisEnd], ['none', none], ['both-directions', ''], ['unknown', '']]) {
        const body = subject.body({ ...numbers, messagesScope: scope }, null, t)
        evidence.push(language + ' scope ' + show(scope) + ' -> ' + show(body) + (suffix === '' ? ' (nothing appended)' : ' = body + ' + show(suffix)))
        if (body !== base + suffix) problems.push(language + ' scope ' + show(scope) + ': the row reads ' + show(body) + ', this gate requires ' + show(base + suffix))
      }
    }
    // The chain the panel actually walks: the document the route answered -> readAnswer -> the row.
    const t = translate('zh')
    const suffixOf = (scope) => scope === 'this-end-only' ? t('panel.status.messagesThisEnd') : scope === 'none' ? t('panel.status.messagesNone') : ''
    const documents = worlds.map((world) => ({ name: world.spec.name, document: world.document }))
    documents.push({ name: 'a-route-that-publishes-no-scope', document: { ok: true, path: STATUS_PATH, ledger: { records: 4 }, world: { teams: 1, members: 1 }, relay: { bound: false } } })
    for (const entry of documents) {
      if (entry.document === null) { problems.push(entry.name + ': no document to read'); continue }
      const read = subject.read({ status: 200, text: JSON.stringify(entry.document), transport: null })
      if (read.failure !== null) { problems.push(entry.name + ': readAnswer refused the document: ' + show(read.failure)); continue }
      const said = entry.document.messages?.scope
      const scope = said === 'both-directions' || said === 'this-end-only' || said === 'none' ? said : 'unknown'
      if (read.reading.messagesScope !== scope) problems.push(entry.name + ': the document says scope ' + show(said) + ' and the row read it as ' + show(read.reading.messagesScope))
      const base = subject.body({ ...read.reading, messagesScope: 'both-directions' }, null, t)
      const body = subject.body(read.reading, null, t)
      evidence.push('row from the ' + entry.name + ' document: recorded scope ' + show(read.reading.messagesScope) + ' -> ' + show(body))
      if (body !== base + suffixOf(scope)) problems.push(entry.name + ': the row reads ' + show(body) + ' for scope ' + show(scope) + ', this gate requires ' + show(base + suffixOf(scope)))
    }
    record(R5, problems.length === 0, judged(problems, evidence))
  }

  // 6 -------------------------------------------------------- declared readings == produced readings
  record(R6, rows.length + 1 === DECLARED, 'declared=' + String(DECLARED) + ' produced=' + String(rows.length + 1))
  return rows
}

/**
 * One fact rewritten per mutant, at the seam this gate reads and over the shipped function. Each
 * declares the readings that must redden - written before the mutant was run - and --self-attack
 * fails when what reddens is not exactly that list.
 */
/** A mapping that records one state where the kernel said another: one fact, rewritten. */
const lieAboutState = (from, to) => (subject) => {
  subject.mapEvent = (event) => {
    const record = host.teamEventToRecord(event)
    return record !== null && record.payload?.state === from ? { ...record, payload: { ...record.payload, state: to } } : record
  }
}

const MUTANTS = [
  { name: 'a-legacy-message-records-the-wrong-state', declared: [R1], apply: lieAboutState('queued', 'delivered') },
  {
    name: 'a-relay-splice-records-the-wrong-state',
    // 4 reddens too, and honestly: the ledger worlds are built through this same mapping, so an
    // 'accepted' row that reads as 'delivered' is counted as journal flow and the document names the
    // wrong source. One lie, two readings - and the mutant line below says both.
    declared: [R2, R4],
    apply: lieAboutState('accepted', 'delivered'),
  },
  {
    name: 'a-user-steer-becomes-a-team-message',
    declared: [R3, R4],
    apply: (subject) => {
      subject.mapEvent = (event) => {
        const record = host.teamEventToRecord(event)
        if (record !== null) return record
        if (event?.type !== 'agent/inbox/spliced') return null
        const first = Array.isArray(event.data?.inserted) ? event.data.inserted[0] : undefined
        if (first === undefined) return null
        return { kind: 'team.message', payload: { id: String(first.id ?? 'msg-unknown'), state: 'accepted', scope: 'this-end' } }
      }
    },
  },
  {
    name: 'a-journal-ledger-is-answered-none',
    declared: [R4],
    apply: (subject) => {
      subject.finish = (document) => document !== null && document.messages?.source === 'journal'
        ? { ...document, messages: { journal: 0, inbox: 0, source: 'none', scope: 'none' } }
        : document
    },
  },
  {
    name: 'the-row-drops-its-scope-suffix',
    declared: [R5],
    apply: (subject) => {
      subject.body = (reading, failure, t) => client.bodyText(reading === null ? null : { ...reading, messagesScope: 'both-directions' }, failure, t)
    },
  },
]

const main = async () => {
  const root = mkdtempSync(join(tmpdir(), 'r217-message-sources-'))
  const tidy = () => { if (KEEP !== true) { try { rmSync(root, { recursive: true, force: true }) } catch (error) { /* a leftover temp dir is not a verdict */ } } }
  const run = async (subject) => { try { return await measure(subject, root) } catch (error) { tidy(); if (error.missing === true) notMeasured(msg(error)); throw error } }
  const baseline = await run(makeSubject())
  const red = baseline.filter((row) => row.ok !== true).map((row) => row.id)
  if (SELF_ATTACK) {
    console.log('  ' + (red.length === 0 ? 'ok  ' : 'FAIL') + '  baseline: the shipped halves judged as they are -> red=' + show(red))
    let failures = red.length === 0 ? 0 : 1
    for (const mutant of MUTANTS) {
      const subject = makeSubject()
      mutant.apply(subject)
      const seen = (await run(subject)).filter((row) => row.ok !== true).map((row) => row.id)
      const same = seen.length === mutant.declared.length && seen.every((one) => mutant.declared.includes(one))
      if (same !== true) failures += 1
      console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + show(seen) + ' declared=' + show(mutant.declared))
    }
    tidy()
    const total = MUTANTS.length + 1
    console.log(failures === 0
      ? '  self-attack: baseline clean and ' + String(total - 1) + ' of ' + String(total - 1) + ' mutant(s) landed where they declared'
      : '  self-attack: ' + String(failures) + ' of ' + String(total) + ' world(s) (baseline included) did NOT land where they declared')
    return failures === 0 ? 0 : 1
  }
  tidy()
  for (const row of baseline) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + '  |  ' + row.detail)
  console.log('')
  console.log(String(baseline.length) + ' readings, ' + String(baseline.length - red.length) + ' held, ' + String(red.length) + ' failed' + (red.length === 0 ? '' : ': ' + red.join(', ')))
  return red.length === 0 ? 0 : 1
}

process.exitCode = await main()
