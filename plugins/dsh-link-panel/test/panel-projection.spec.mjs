#!/usr/bin/env node
/**
 * dsh-link-panel self-check (producer-owned, R188 P2).
 *
 * It measures the BUILT artifact — lib/index.js, the bytes the kernel loads — not src/:
 *
 *   node plugins/dsh-link-panel/test/panel-projection.spec.mjs
 *   node plugins/dsh-link-panel/test/panel-projection.spec.mjs --self-attack
 *
 * What it must be able to FAIL on, reading by reading:
 *   P1   an empty registry projects to an empty list, not to an error
 *   P2   two ARRIVAL ORDERS of the same registry project to byte-identical output (tie-breaks are data)
 *   P3   the same, for the case where arrival order could otherwise pick a winner (duplicate ids)
 *   P4   a kind outside the closed set is refused BY NAME and never reaches the visible list
 *   P5   the strict projection THROWS for it, and the message lists the offender and its kind
 *   P6   the closed set is a SET: near-misses ("pane ", "PANE", "panes", "") are all outside it
 *   P7   an empty/absent/non-string source is PANEL_EMPTY_SOURCE
 *   P8   the four shape defects with no name of their own are refused with code null + their own text
 *   P8b  an item that is not an object is refused (its missing kind IS an unknown kind)
 *   P9   the only codes this build can emit are the three frozen names (no synonyms)
 *   P10  a sink that is not mounted refuses the item WITHOUT a code, and strict does not throw for it
 *   P11  purity: no clock, no randomness, no locale, no environment (four poisoned reads, same bytes)
 *   P12  argument shape errors throw a TypeError, never a PANEL_ code (a caller's bug is not a refused item)
 *   P13  the projection survives JSON round-trip and adds no field to an item
 *   P14  every visible kind is inside the closed set (the invariant a "nearest kind" translation would launder)
 *   P15  this package HAS a client half, in all THREE places that make one: dsh.client.platform,
 *        exports["./client"] pointing at a built lib/client.js (R188 froze the absence; R189 P2 is
 *        the successor reading, and the count is unchanged)
 *   P16  the row patch declares one host row, the sink the client half mounts (right-rail), and the
 *        one registry item this round can honestly declare: the pane itself
 *   P15/P16 read the package's own structural truth; the client half's behaviour has its own self-check
 *        (test/panel-client-view.spec.mjs), so these two stay structural on purpose
 *   R1..R8 the read-only route, over a REAL socket: bound path, GET 200, the served projection is
 *          byte-identical to the pure function's, installed sinks reported honestly, the named
 *          refusal travels over the wire, POST is 405, "no webServer yet" does not throw, and a
 *          malformed row config is refused at mount.
 *
 * --self-attack mutates the ARTIFACT's own bytes with the failure this round exists to refuse —
 * "translate an unknown kind to the nearest one" — and demands that exactly the readings declared
 * in MUTANTS[..].expect move. A mutant that moves nothing, or moves more than it declared, fails.
 *
 * Exit: 0 every reading held (under --self-attack: pristine held AND the mutant moved exactly its
 * declared readings); 1 a reading failed; 3 NOT MEASURED (no built artifact, or a mutant anchor
 * that no longer exists, so no honest reading can be taken).
 */
import { Agent, createServer, request as httpRequest } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const PROJECT = resolve(PACKAGE, '..', '..')
const ARTIFACT = join(PACKAGE, 'lib', 'index.js')
/** The client half's built artifact: what the web shell serves as dsh-link-panel/client.js. */
const CLIENT_ARTIFACT = join(PACKAGE, 'lib', 'client.js')
const SCRATCH = join(PROJECT, '.tmp', 'r188-p2', 'stage')
const argv = process.argv.slice(2)
const SELF_ATTACK = argv.includes('--self-attack')

const notMeasured = (why) => { console.log('NOT MEASURED: ' + why); process.exit(3) }
if (!existsSync(ARTIFACT)) {
  notMeasured('the built artifact is missing at ' + ARTIFACT + ' (build it: node plugins/build.mjs, or the scratch builder in .tmp/r188-p2/)')
}

/**
 * The one mutation this file declares: the guard that names an unknown kind is replaced by a
 * TRANSLATION to the first known kind. "Translate the unknown kind to the nearest one" is the
 * failure mode the registry exists to refuse, so no reading may survive it silently.
 */
const MUTANTS = {
  'nearest-kind': {
    from: 'if (!KIND_SET.has(entry.kind)) return PANEL_REJECT.UNKNOWN_KIND',
    to: 'if (!KIND_SET.has(entry.kind)) entry.kind = FALLBACK_KIND',
    /**
     * The readings this mutation must move, each one justified — a mutant that moves MORE than it
     * declares fails just as loudly as one that moves less:
     *   P4   the unknown kind is refused by name and echoed as itself   -> it is visible, kind laundered
     *   P5   the strict projection throws for it                        -> nothing is thrown
     *   P6   near-misses ("pane ", "PANE", "panes", "") are outside the set -> 9/9 are admitted
     *   P8b  an item that is not an object is refused for its missing kind -> that code becomes EMPTY_SOURCE
     *   P9   the whole frozen family is reachable from a mixed batch     -> PANEL_UNKNOWN_KIND disappears
     *   P14  a mixed batch shows exactly the items it may show           -> one more item becomes visible
     *   R5   the named refusal travels over the wire                     -> nothing is refused on the wire
     *   R8   the boot line counts what was refused                       -> 0 refused, 5 of 5 visible
     */
    expect: ['P4', 'P5', 'P6', 'P8b', 'P9', 'P14', 'R5', 'R8'],
  },
}

const show = (value) => {
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : text
}
const canonical = (value) => show(value)
const copy = (value) => JSON.parse(JSON.stringify(value))

const ITEMS = [
  { id: 'notes', kind: 'pane', title: 'Notes', source: 'dsh-link-notes', order: 300 },
  { id: 'teams', kind: 'pane', title: 'Teams', source: 'dsh-link-teams', order: 100 },
  { id: 'connect', kind: 'action', title: 'Connect', source: 'dsh-link-lan-bridge', order: 200 },
  { id: 'lan', kind: 'status', title: 'LAN', source: 'dsh-link-lan-bridge', order: 200 },
]
/** One item nobody may show: its kind is outside the closed set. */
const UNKNOWN = { id: 'chat', kind: 'chat', title: 'Chat', source: 'somebody', order: 5 }

/** Every reading of the pure projection, plus the two structural ones. Never throws: a throw is a red reading. */
function projectionBattery(mod) {
  const rows = []
  const check = (id, ok, detail) => {
    rows.push({ id, ok: ok === true, detail: String(detail) })
    return ok === true
  }
  const refused = (entry, options) => {
    const result = mod.projectPanel([entry], { sinks: mod.PANEL_SINKS, ...(options ?? {}) })
    return result
  }
  const throwsOf = (work) => {
    try {
      work()
      return null
    } catch (error) {
      return error
    }
  }

  // ---------------------------------------------------------------- the four promises
  const empty = mod.projectPanel([], { sinks: mod.PANEL_SINKS })
  check('P1', canonical(empty) === '{"visible":[],"rejected":[]}', 'an empty registry projects to ' + canonical(empty))

  const forward = mod.projectPanel(ITEMS, { sinks: mod.PANEL_SINKS })
  const backward = mod.projectPanel([...ITEMS].reverse(), { sinks: mod.PANEL_SINKS })
  const shuffled = mod.projectPanel([ITEMS[3], ITEMS[0], ITEMS[2], ITEMS[1]], { sinks: mod.PANEL_SINKS })
  const order = forward.visible.map((item) => item.id).join(',')
  check('P2',
    canonical(forward) === canonical(backward) && canonical(forward) === canonical(shuffled) && order === 'teams,connect,lan,notes',
    'three arrival orders -> ' + String(canonical(forward) === canonical(backward) && canonical(forward) === canonical(shuffled)) + '; order=' + order)

  const dup = [
    { id: 'x', kind: 'pane', title: 'first copy', source: 'somewhere', order: 1 },
    { id: 'x', kind: 'pane', title: 'second copy', source: 'somewhere', order: 2 },
  ]
  const dupForward = mod.projectPanel(dup, { sinks: mod.PANEL_SINKS })
  const dupBackward = mod.projectPanel([...dup].reverse(), { sinks: mod.PANEL_SINKS })
  check('P3',
    canonical(dupForward) === canonical(dupBackward) && dupForward.visible.length === 0 && dupForward.rejected.length === 2
    && dupForward.rejected.every((row) => row.code === 'PANEL_DUP_ID'),
    'both orders -> ' + String(canonical(dupForward) === canonical(dupBackward)) + '; ' + canonical(dupForward))

  const unknown = refused(UNKNOWN)
  check('P4',
    unknown.visible.length === 0 && unknown.rejected.length === 1 && unknown.rejected[0].code === 'PANEL_UNKNOWN_KIND'
    && unknown.rejected[0].detail.includes('"chat"') && unknown.rejected[0].detail.includes('pane, action, status')
    && unknown.rejected[0].entry.kind === 'chat',
    canonical(unknown))

  const strictError = throwsOf(() => mod.projectPanel([UNKNOWN], { sinks: mod.PANEL_SINKS, strict: true }))
  check('P5',
    strictError instanceof Error && strictError.name === 'PanelRefusal' && strictError.code === 'PANEL_UNKNOWN_KIND'
    && strictError.message.includes('id "chat"') && strictError.message.includes('"chat"')
    && Array.isArray(strictError.rejected) && strictError.rejected.length === 1,
    strictError === null ? 'nothing was thrown' : strictError.name + ': ' + strictError.message)

  const nearMisses = ['pane ', ' pane', 'pane\n', 'PANE', 'PanE', 'pane2', 'panes', 'panel', '']
  const nearMissResults = nearMisses.map((kind) => refused({ id: 'k', kind, title: 't', source: 's', order: 1 }))
  check('P6',
    nearMissResults.every((result) => result.visible.length === 0 && result.rejected[0].code === 'PANEL_UNKNOWN_KIND')
    && refused({ id: 'k', kind: 'pane', title: 't', source: 's', order: 1 }).visible.length === 1,
    'near misses refused: ' + String(nearMissResults.filter((result) => result.visible.length === 0).length) + '/' + String(nearMisses.length)
    + '; exact kind visible: ' + String(refused({ id: 'k', kind: 'pane', title: 't', source: 's', order: 1 }).visible.length === 1))

  const sourceCases = ['', '   ', 42, null, undefined, ['s'], { s: 1 }]
  const sourceResults = sourceCases.map((source) => refused({ id: 's', kind: 'pane', title: 't', source, order: 1 }))
  check('P7',
    sourceResults.every((result) => result.visible.length === 0 && result.rejected[0].code === 'PANEL_EMPTY_SOURCE'),
    'sources refused by name: ' + String(sourceResults.filter((result) => result.rejected[0].code === 'PANEL_EMPTY_SOURCE').length) + '/' + String(sourceCases.length)
    + '; first=' + sourceResults[0].rejected[0].detail)

  // ---------------------------------------------------------------- the passthrough family (no new names)
  const shapeCases = [
    { what: 'order NaN', entry: { id: 'a', kind: 'pane', title: 't', source: 's', order: Number.NaN }, needle: 'order must be a finite number' },
    { what: 'order Infinity', entry: { id: 'a', kind: 'pane', title: 't', source: 's', order: Number.POSITIVE_INFINITY }, needle: 'order must be a finite number' },
    { what: 'order as text', entry: { id: 'a', kind: 'pane', title: 't', source: 's', order: '3' }, needle: 'order must be a finite number' },
    { what: 'order missing', entry: { id: 'a', kind: 'pane', title: 't', source: 's' }, needle: 'order must be a finite number' },
    { what: 'title empty', entry: { id: 'a', kind: 'pane', title: '  ', source: 's', order: 1 }, needle: 'title must be a non-empty string' },
    { what: 'id not a string', entry: { id: 42, kind: 'pane', title: 't', source: 's', order: 1 }, needle: 'id must be a non-empty string' },
  ]
  const shapeResults = shapeCases.map((one) => refused(one.entry))
  check('P8',
    shapeResults.every((result, at) => result.visible.length === 0 && result.rejected.length === 1
      && result.rejected[0].code === null && result.rejected[0].detail.includes(shapeCases[at].needle)),
    shapeResults.map((result, at) => shapeCases[at].what + '->' + show(result.rejected[0].code)).join(' '))

  const shapeless = refused('nope')
  check('P8b',
    shapeless.visible.length === 0 && shapeless.rejected.length === 1
    && shapeless.rejected[0].code === 'PANEL_UNKNOWN_KIND'
    && shapeless.rejected[0].detail.includes('the item is not an object'),
    canonical(shapeless.rejected[0]))

  const noSource = { id: 'nosource', kind: 'pane', title: 'No source', source: '', order: 7 }
  const mixed = mod.projectPanel([...ITEMS, UNKNOWN, noSource, ...dup, ...shapeCases.map((one) => one.entry), 'nope', null], { sinks: mod.PANEL_SINKS })
  const codes = [...new Set(mixed.rejected.map((row) => row.code).filter((code) => code !== null))].sort()
  check('P9',
    canonical(codes) === canonical(Object.values(mod.PANEL_REJECT).sort())
    && mixed.rejected.every((row) => row.code === null || Object.values(mod.PANEL_REJECT).includes(row.code)),
    'codes emitted by a mixed batch: ' + canonical(codes) + '; the frozen family: ' + canonical(Object.values(mod.PANEL_REJECT).sort()))

  // ---------------------------------------------------------------- the world refusal
  let worldThrew = null
  const world = (() => {
    try {
      return { result: mod.projectPanel(ITEMS, { sinks: [] }), threw: null }
    } catch (error) {
      return { result: null, threw: String(error && error.message) }
    }
  })()
  worldThrew = throwsOf(() => mod.projectPanel(ITEMS, { sinks: [], strict: true }))
  check('P10',
    world.threw === null && world.result.visible.length === 0 && world.result.rejected.length === ITEMS.length
    && world.result.rejected.every((row) => row.code === null && row.detail.includes('not have mounted'))
    && worldThrew === null,
    'visible=' + String(world.result.visible.length) + ' rejected=' + String(world.result.rejected.length)
    + ' codes=' + canonical([...new Set(world.result.rejected.map((row) => row.code))]) + ' strict threw=' + (worldThrew === null ? 'no' : String(worldThrew.message)))

  // ---------------------------------------------------------------- purity
  const pristine = canonical(mod.projectPanel(ITEMS, { sinks: mod.PANEL_SINKS }))
  const realNow = Date.now
  const realRandom = Math.random
  const realCompare = String.prototype.localeCompare
  let poisoned = null
  let poisonError = null
  try {
    Date.now = () => { throw new Error('the projection read the clock') }
    Math.random = () => { throw new Error('the projection read randomness') }
    String.prototype.localeCompare = () => { throw new Error('the projection read the locale') }
    poisoned = canonical(mod.projectPanel(ITEMS, { sinks: mod.PANEL_SINKS }))
  } catch (error) {
    poisonError = String(error && error.message)
  } finally {
    Date.now = realNow
    Math.random = realRandom
    String.prototype.localeCompare = realCompare
  }
  process.env.DSH_LINK_PANEL_PROBE = 'set-by-the-self-check'
  process.env.TZ = 'Pacific/Kiritimati'
  process.env.LANG = 'tr_TR.UTF-8'
  const afterEnvironment = canonical(mod.projectPanel(ITEMS, { sinks: mod.PANEL_SINKS }))
  check('P11',
    poisonError === null && poisoned === pristine && afterEnvironment === pristine,
    'poisoned=' + String(poisoned === pristine) + ' env-changed=' + String(afterEnvironment === pristine)
    + (poisonError === null ? '' : ' poison-error=' + poisonError))

  // ---------------------------------------------------------------- arguments and output shape
  const argumentErrors = []
  for (const bad of [undefined, null, {}, 'x', 42]) {
    const error = throwsOf(() => mod.projectPanel(bad, { sinks: [] }))
    if (error !== null) argumentErrors.push(error)
  }
  const sinksError = throwsOf(() => mod.projectPanel([], { sinks: 'right-rail' }))
  check('P12',
    argumentErrors.length === 5 && argumentErrors.every((error) => error instanceof TypeError && error.message.includes('PANEL_') === false)
    && sinksError instanceof TypeError && sinksError.message.includes('PANEL_') === false,
    'entries-errors=' + String(argumentErrors.length) + ' first=' + String(argumentErrors[0] && argumentErrors[0].message)
    + '; sinks-error=' + String(sinksError && sinksError.message))

  const nasty = mod.projectPanel([
    { id: 'g', kind: 'pane', title: 't', source: 's', order: 1, extra: { deep: true } },
    { id: 'h', kind: 'pane', title: 't', source: 's', order: 2, extra: () => 1, when: Symbol('x'), big: 1n },
    {
      id: 'i',
      kind: 'pane',
      title: 't',
      source: 's',
      order: 3,
      get boom() { throw new Error('a getter threw this') },
    },
  ], { sinks: mod.PANEL_SINKS })
  const fieldsOfItems = [...nasty.visible, ...nasty.rejected.map((row) => row.entry)].map((item) => Object.keys(item).sort().join(','))
  check('P13',
    canonical(copy(nasty)) === canonical(nasty) && fieldsOfItems.every((keys) => keys === 'id,kind,order,source,title'),
    'json-round-trip=' + String(canonical(copy(nasty)) === canonical(nasty)) + '; item fields=' + canonical([...new Set(fieldsOfItems)]))

  check('P14',
    mixed.visible.every((item) => mod.PANEL_KINDS.includes(item.kind)) && mixed.visible.length === ITEMS.length,
    'visible kinds=' + canonical(mixed.visible.map((item) => item.kind)))

  // ---------------------------------------------------------------- the two structural readings
  const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'))
  const clientExport = manifest.exports === undefined ? undefined : manifest.exports['./client']
  check('P15',
    manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch === './cordis.patch.yml'
    && manifest.dsh.client !== undefined && manifest.dsh.client.platform === 'web'
    && clientExport !== undefined && clientExport !== null && clientExport.default === './lib/client.js'
    && existsSync(ARTIFACT) && existsSync(CLIENT_ARTIFACT),
    'bundle=' + show(manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch) + ' dsh.client=' + show(manifest.dsh.client)
    + ' exports[./client]=' + show(clientExport) + ' lib/client.js=' + String(existsSync(CLIENT_ARTIFACT)))

  const patch = readFileSync(join(PACKAGE, 'cordis.patch.yml'), 'utf8')
  // The three structural facts of the row: it exists, it says the rail is mounted (the client half
  // above IS that rail), and it declares exactly the pane's own item — by data, not by code.
  const entries = patch.split('entries:')[1] ?? ''
  check('P16',
    /- id: link-panel\r?\n\s+name: dsh-link-panel/.test(patch)
    && /sinks:\r?\n\s+- right-rail/.test(patch)
    && (entries.match(/\bid: /g) ?? []).length === 1
    && /id: link-panel\r?\n\s+kind: pane\r?\n\s+title: LINK panel\r?\n\s+source: dsh-link-panel\r?\n\s+order: 10/.test(entries),
    'row=' + show(patch.match(/- id: [\s\S]{0,20}/) && patch.match(/- id: [\s\S]{0,20}/)[0])
    + ' sinks-mounted=' + show(/right-rail/.test(patch)) + ' declared items=' + String((entries.match(/\bid: /g) ?? []).length))

  return rows
}

/** The route, driven over a real socket. Pristine artifact only: this measures the surface, not the guard. */
async function routeBattery(mod) {
  const rows = []
  const check = (id, ok, detail) => {
    rows.push({ id, ok: ok === true, detail: String(detail) })
    return ok === true
  }

  // A row config with one item nobody may show, so the named refusal has to travel over the wire.
  const entries = [...copy(ITEMS), copy(UNKNOWN)]
  let route = null
  const stub = { register: (value) => { route = value; return () => { route = null } } }
  const ctx = {
    get: (name) => (name === 'webServer' ? stub : undefined),
    effect: (work) => { work() },
    inject: (names, work) => work({ get: (name) => (name === 'webServer' ? stub : undefined) }),
  }

  const spoken = []
  const realLog = console.log
  console.log = (line) => { spoken.push(String(line)) }
  try {
    mod.apply(ctx, { entries, sinks: [] })
  } finally {
    console.log = realLog
  }

  check('R1',
    route !== null && route.kind === 'exact' && route.path === mod.PANEL_ROUTE_PATH && typeof route.handler === 'function',
    'route=' + show(route && { kind: route.kind, path: route.path }))
  check('R8',
    spoken.some((line) => line.startsWith('[dsh-link-panel] ready — ')) && spoken.some((line) => line.includes('refused PANEL_UNKNOWN_KIND')),
    'boot lines: ' + canonical(spoken))

  if (route === null) {
    check('R2', false, 'no route to drive: the rest of the route readings cannot be taken')
    return rows
  }

  const server = createServer((req, res) => {
    if (req.url === route.path) { void route.handler(req, res); return }
    res.statusCode = 404
    res.end('no route')
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const url = 'http://127.0.0.1:' + String(server.address().port) + route.path
  // node:http rather than fetch, with an agent that keeps nothing alive: this spec must be able to
  // finish without a socket half-closed underneath it (on Windows, exiting with one trips a libuv
  // assertion and the exit code stops describing the readings).
  const agent = new Agent({ keepAlive: false })
  const call = (method) => new Promise((done) => {
    const request = httpRequest(url, { method, agent }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(body) } catch { parsed = null }
        done({ status: response.statusCode, type: response.headers['content-type'], cache: response.headers['cache-control'], body: parsed })
      })
    })
    request.on('error', (error) => done({ status: 0, type: null, cache: null, body: null, error: String((error && error.code) ?? (error && error.message)) }))
    request.end()
  })
  try {
    const first = await call('GET')
    const body = first.body
    check('R2',
      first.status === 200 && first.type === 'application/json; charset=utf-8'
      && first.cache === 'no-store' && body.ok === true && body.readOnly === true && body.path === route.path,
      'status=' + String(first.status) + ' type=' + show(first.type) + ' cache=' + show(first.cache) + ' ok=' + show(body && body.ok) + ' readOnly=' + show(body && body.readOnly))

    check('R3',
      canonical(body.declared) === canonical(mod.projectPanel(entries, { sinks: mod.PANEL_SINKS })),
      'declared over the wire equals the pure projection of the same items: ' + String(canonical(body.declared) === canonical(mod.projectPanel(entries, { sinks: mod.PANEL_SINKS }))))

    check('R4',
      canonical(body.registry.sinksMounted) === '[]' && canonical(body.mounted) === canonical(mod.projectPanel(entries, { sinks: [] }))
      && body.mounted.visible.length === 0 && body.mounted.rejected.length === entries.length
      && body.registry.entries === entries.length,
      'sinksMounted=' + canonical(body.registry.sinksMounted) + ' mounted.visible=' + String(body.mounted.visible.length)
      + ' mounted.rejected=' + String(body.mounted.rejected.length) + ' declared.visible=' + String(body.declared.visible.length))

    check('R5',
      body.declared.rejected.some((row) => row.code === 'PANEL_UNKNOWN_KIND' && row.detail.includes('"chat"'))
      && body.declared.visible.every((item) => mod.PANEL_KINDS.includes(item.kind)),
      'named refusals on the wire: ' + canonical(body.declared.rejected.map((row) => row.code)))

    const second = await call('GET')
    const post = await call('POST')
    check('R6',
      post.status === 405 && post.body && post.body.error && post.body.error.code === 'METHOD_NOT_ALLOWED'
      && body.served === 1 && second.body.served === 2,
      'POST=' + String(post.status) + '/' + show(post.body && post.body.error && post.body.error.code) + ' served=' + show(body.served) + '->' + show(second.body.served))

    const head = await call('HEAD')
    check('R7', head.status === 200, 'HEAD=' + String(head.status))
  } finally {
    agent.destroy()
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
  return rows
}

/** A row whose own configuration is malformed is refused at MOUNT: an empty panel must not look like a broken one. */
function configBattery(mod) {
  const rows = []
  const check = (id, ok, detail) => {
    rows.push({ id, ok: ok === true, detail: String(detail) })
    return ok === true
  }
  const ctx = { get: () => undefined, effect: (work) => { work() }, inject: (names, work) => work({ get: () => undefined }) }
  const errorOf = (config) => {
    try {
      mod.apply(ctx, config)
      return null
    } catch (error) {
      return error
    }
  }
  const entriesError = errorOf({ entries: { id: 'a' } })
  const sinksError = errorOf({ sinks: ['left-rail'] })
  const okConfig = errorOf({ entries: [{ id: 'a', kind: 'pane', title: 't', source: 's', order: 1 }], sinks: ['right-rail'] })
  check('C1',
    entriesError instanceof Error && entriesError.message.includes('config.entries must be an array')
    && sinksError instanceof Error && sinksError.message.includes('unknown sink "left-rail"')
    && okConfig === null,
    'entries-error=' + show(entriesError && entriesError.message) + '; sinks-error=' + show(sinksError && sinksError.message)
    + '; a good config threw: ' + show(okConfig && okConfig.message))
  return rows
}

// ---------------------------------------------------------------- run
const pristine = await import(pathToFileURL(ARTIFACT).href)
const rows = [...projectionBattery(pristine), ...(await routeBattery(pristine)), ...(await configBattery(pristine))]
for (const row of rows) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + ' — ' + row.detail)
const failed = rows.filter((row) => !row.ok)
console.log('')
console.log(String(rows.length) + ' readings, ' + String(rows.length - failed.length) + ' held, ' + String(failed.length) + ' failed')

if (!SELF_ATTACK) {
  // process.exitCode rather than process.exit(): a spec that dies on the way out reports the wrong thing.
  process.exitCode = failed.length === 0 ? 0 : 1
} else {

  // ---------------------------------------------------------------- the declared mutant
  const mutant = MUTANTS['nearest-kind']
  const bytes = readFileSync(ARTIFACT, 'utf8')
  if (bytes.includes(mutant.from) === false) {
    notMeasured('the mutant anchor is not in ' + ARTIFACT + ' any more: ' + show(mutant.from) + ' (the mutation cannot be built, so no honest attack reading exists)')
  }
  mkdirSync(SCRATCH, { recursive: true })
  const staged = join(SCRATCH, 'panel-nearest-kind.mjs')
  writeFileSync(staged, bytes.split(mutant.from).join(mutant.to))
  const attacked = await import(pathToFileURL(staged).href)
  // The WHOLE battery, not only the pure readings: the route serves the same registry, so a mutation
  // that launders a kind must be visible on the wire as well. The declared set below says which.
  const attackedRows = [...projectionBattery(attacked), ...(await routeBattery(attacked)), ...(await configBattery(attacked))]
  const attackedFailed = attackedRows.filter((row) => !row.ok).map((row) => row.id).sort()
  const declared = [...mutant.expect].sort()
  console.log('')
  console.log('self-attack nearest-kind: ' + show(mutant.from) + '  ->  ' + show(mutant.to))
  console.log('  moved (failed readings): ' + canonical(attackedFailed))
  console.log('  declared:                ' + canonical(declared))
  const coverage = attackedRows.filter((row) => !row.ok).map((row) => row.id + ': ' + row.detail)
  for (const line of coverage) console.log('  ' + line)
  const instrument = bytes !== bytes.split(mutant.from).join(mutant.to)
  const clean = failed.length === 0
  const exact = canonical(attackedFailed) === canonical(declared)
  console.log('')
  console.log('instrument moved: ' + String(instrument) + '; pristine held: ' + String(clean) + '; moved set == declared set: ' + String(exact))
  process.exitCode = clean && instrument && exact ? 0 : 1
}