#!/usr/bin/env node
/**
 * dsh-link-panel client half self-check (producer-owned, R189 P2).
 *
 *   node plugins/dsh-link-panel/test/panel-client-view.spec.mjs
 *   node plugins/dsh-link-panel/test/panel-client-view.spec.mjs --self-attack
 *
 * Needs no browser, no DSH and no socket. Three planes are measured, each with what it must be able to
 * FAIL on:
 *
 *   the pure plane (src/client/view.ts, imported as source: no React, no I/O)
 *     V1  the marker of a live view: mounted, this tab, the route's items VERBATIM, the note count and
 *         the ROUTE's own limits
 *     V2  two ARRIVAL ORDERS of the same two answers fold to byte-identical views
 *     V3  a body that is not JSON is a NAMED client failure, and the slot reads "failed", not "empty"
 *     V4  a body with the wrong fields is "response-shape", naming the field and the keys that arrived
 *         (the pane must not translate a broken registry into an empty one)
 *     V5  a body the ROUTE refused keeps the route's own code and message, and says so (from: route)
 *     V6  the ledger's rows and its thresholds travel verbatim
 *     V7  a ledger answer without its thresholds is a named failure, not an empty ledger
 *     V8  a note row that is not a note is a named failure naming its index, not a shorter ledger
 *     V9  folding both failures gives two named failures, both slots failed, and a failed marker
 *     V10..V12 the three frozen note codes arrive verbatim (once each), and a fourth code is NOT
 *         translated into one of the three
 *     V13 the request sends the text VERBATIM: over-limit, blank and non-string alike are not refused
 *         here and not trimmed, because those refusals belong to the route (no second rule)
 *     V14 the frozen names (paths, tab id, kind pane, author user)
 *     V15 every reader is total: hostile values come back as named failures and nothing is thrown
 *     V16 the fold copies: the view handed in is never mutated
 *
 *   the wiring plane (src/client/register.ts + load.ts, over stubs)
 *     W1  one definition: id, kind pane, extension band, no address claim, one guide entry
 *     W2  the three registrations land on the real slot names, keyed by the definition id
 *     W3  the marker is filled by the READS, with no panel operation and no body rendered
 *     W4  a route that is not there leaves the marker with the true text and the half mounted
 *     W5  taking the half down writes the disposed marker and runs every disposer
 *     W6  a registration that throws does not throw, and the failure text is the error's own
 *
 *   the artifact plane (lib/client.js, the bytes the web shell serves)
 *     A1  the built bundle is the module-loader wrapper for dsh-link-panel
 *     A2  loading it and calling apply() fills the marker with the route's items and limits — the
 *         reading the live gate takes, taken here without a browser
 *
 *   the seam plane (src/client/contributions.ts + the marker's new field, R192)
 *     P1  two claimants of one id are BOTH refused (PANEL_DUP_ID), never one of them
 *     P2  an unknown kind is refused by name and NEVER translated to the nearest known kind
 *     P3  a source that says nothing is refused (PANEL_EMPTY_SOURCE)
 *     P4  what the three names do not cover keeps its own text and code: null (a non-finite order, a
 *         body that is neither a string nor a function), and a missing order is the documented zero
 *     P5  two ARRIVAL ORDERS of the same declarations project to byte-identical rows and refusals
 *     P6  the disposer takes that exact declaration out; a repeated dispose is a no-op
 *     P7  an empty seam answers two empty arrays (not an error) and notifies once per change
 *     P8  ONE VOCABULARY: the closed set and the three codes are the host registry's own, and both
 *         projections refuse the same five declarations with the same names
 *     P9  the body is the declaration's own text: a string, a function read at projection, a function
 *         that throws (its own error text), a non-string answer (its own spelling)
 *     P10 the marker: `items` still the route's rows byte for byte (held against the pre-R192 view.ts
 *         read out of git), with the seam reported BESIDE them in `contributed`
 *     P11 a declaration that lands after the reads republishes the marker and tells the pane in the
 *         same step; a disposed loader lets the seam go
 *     P12 the built bundle provides 'linkPanel', and the pane body DRAWS one row per contribution,
 *         each carrying its kind, its source, its title and its body (rendered with a JSX stub)
 *     P13 the reading MOVED: the same claim, projected again, answers the new text (nothing is
 *         cached: the projection is taken on every read), and notify() is the named path a provider
 *         takes for it — every subscriber hears the call, and no second declaration is invented
 *     P14 an ACTION without a callable invoke keeps its own text and code null (no fourth refusal
 *         name), and the rows around the hole are byte-identical across it
 *     P15 one press is ONE call of the declaration's own invoke, with the declaration as its receiver;
 *         a press that names nothing drawn (an unknown id, a row of another kind) calls nothing
 *     P16 the provider's throw is CONTAINED: press() does not throw, the text that travels is the
 *         ORIGINAL message, and the row it belongs to is still drawn
 *     P17 the marker's contributed rows report hasInvoke as a BOOLEAN and carry no function at all
 *     P18 a row of kind 'action' is drawn as a BUTTON labelled with the provider's own title; a row of
 *         another kind is not a button, and an unpressed row shows no failure
 *     P19 ONE CLICK of that button calls the provider's own invoke EXACTLY ONCE and leaves every other
 *         row byte-identical (the tree is re-rendered the way React would, so the click is driven)
 *     P20 an invoke that throws is caught, nothing escapes the click handler, and the provider's own
 *         text is drawn ON THAT ROW while every other row stays byte-identical
 *
 * --self-attack stages copies of view.ts under .tmp/r189-p2/ with the failure this round exists to
 * refuse — "translate a bad response into the nearest good one (an empty list)" — and demands that
 * exactly the declared readings move. Two more staged copies of contributions.ts carry the two
 * failures this round's seam exists to refuse: a closed-set gate that stops refusing an unknown kind,
 * and a claim table in which the later declaration for an id replaces the earlier one, and three more
 * aim at the R193 action field: a press that calls the item's invoke twice (P15), a press that stops
 * containing what the provider threw (P16), and a seam that admits an action carrying no callable
 * invoke instead of refusing it by its own text (P14). A mutant that moves nothing, or moves more than
 * it declared, fails: that is the counter-proof that these readings can be red.
 *
 * Exit: 0 held (with --self-attack: pristine held AND each mutant moved exactly its declared
 * readings); 1 a reading failed; 3 NOT MEASURED (no built artifact, or a mutant anchor that is gone).
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const PROJECT = resolve(PACKAGE, '..', '..')
const ARTIFACT = join(PACKAGE, 'lib', 'client.js')
const SCRATCH = join(PROJECT, '.tmp', 'r189-p2', 'stage')
const SELF_ATTACK = process.argv.slice(2).includes('--self-attack')

const results = []
const check = (id, ok, detail) => {
  results.push({ id, ok: ok === true, detail: String(detail) })
  console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + ' — ' + detail)
}
const show = (value) => JSON.stringify(value)
const notMeasured = (why) => { console.log('NOT MEASURED: ' + why); process.exit(3) }

// ------------------------------------------------------------------------------------ fixtures
const ITEM_A = { id: 'teams', kind: 'pane', title: 'Agent Teams', source: 'dsh-link-teams', order: 20 }
const ITEM_B = { id: 'lan', kind: 'status', title: 'LAN', source: 'dsh-link-lan-bridge', order: 200 }
const REFUSAL = { id: 'chat', code: 'PANEL_UNKNOWN_KIND', detail: 'unknown kind "chat"; the closed set is pane, action, status', entry: { id: 'chat', kind: 'chat', title: 'Chat', source: 'somebody', order: 5 } }
const PANEL_BODY = {
  ok: true,
  at: 1,
  path: '/api/dsh-link-panel/state',
  readOnly: true,
  registry: {
    entries: 2,
    kinds: ['pane', 'action', 'status'],
    sinks: ['right-rail', 'header'],
    kindSinks: { pane: 'right-rail', action: 'right-rail', status: 'header' },
    sinksMounted: ['right-rail'],
    route: '/api/dsh-link-panel/state',
  },
  declared: { visible: [ITEM_A, ITEM_B], rejected: [REFUSAL] },
  mounted: { visible: [ITEM_A], rejected: [] },
  served: 1,
}
const NOTES_BODY = {
  ok: true,
  at: 2,
  path: '/api/dsh-link-notes/state',
  readOnly: true,
  limits: { maxNotes: 200, maxChars: 100 },
  counts: { notes: 1, open: 1, done: 0, deleted: 0, malformed: 0 },
  notes: [{ id: 'n-1', text: 'the ledger remembers this', tags: ['handoff'], state: 'open', author: 'user', at: 3, seq: 4 }],
}
const HTTP = (status, body, text) => ({ status, body, text: text ?? JSON.stringify(body), transport: null })
const TRANSPORT = (why) => ({ status: null, body: null, text: '', transport: why })
const PANEL_ANSWER = HTTP(200, PANEL_BODY)
const NOTES_ANSWER = HTTP(200, NOTES_BODY)
/** The two declarations every seam reading below declares into the seam. */
const SEAM_PANE = { id: 'teams-pane', kind: 'pane', title: 'Agent Teams', source: 'dsh-link-teams', order: 20, body: () => 'three agents at work' }
const SEAM_STATUS = { id: 'lan-status', kind: 'status', title: 'LAN bridge', source: 'dsh-link-lan-bridge', order: 200, body: 'connected on 192.168.1.7' }
/**
 * The same two rows as the seam publishes them: the row's own key order, the body resolved, and
 * `hasInvoke` - the R193 field that reports whether the declaration carries a callable `invoke` as a
 * BOOLEAN (the function itself never travels in a row). Neither of these two declares one.
 */
const SEAM_ROWS = [
  { id: 'teams-pane', kind: 'pane', title: 'Agent Teams', source: 'dsh-link-teams', order: 20, body: 'three agents at work', hasInvoke: false },
  { id: 'lan-status', kind: 'status', title: 'LAN bridge', source: 'dsh-link-lan-bridge', order: 200, body: 'connected on 192.168.1.7', hasInvoke: false },
]
/** One arrival, in the shape the loader folds. */
const arrivalOf = (mod, source, answer) => (source === 'panel'
  ? { source, read: mod.readPanelState(answer) }
  : { source, read: mod.readNotesState(answer) })

// ------------------------------------------------------------------------------------- pure plane
/** The pure readings. Returns the rows, so the self-attack can run the same battery on a mutant. */
function pureBattery(mod, id = 'V') {
  const rows = []
  const record = (suffix, ok, detail) => {
    rows.push({ id: id + suffix, ok: ok === true, detail: String(detail) })
    return ok === true
  }
  const folded = mod.foldArrivals([arrivalOf(mod, 'panel', PANEL_ANSWER), arrivalOf(mod, 'notes', NOTES_ANSWER)])
  const marker = mod.markerFrom(folded)

  record('1', marker.mounted === true && marker.failed === null && marker.tabId === 'dsh-link-panel'
    && show(marker.items) === show([ITEM_A, ITEM_B])
    && show(marker.notes) === show({ count: 1, limits: { maxNotes: 200, maxChars: 100 } }),
  'the live marker: ' + show(marker))

  const other = mod.foldArrivals([arrivalOf(mod, 'notes', NOTES_ANSWER), arrivalOf(mod, 'panel', PANEL_ANSWER)])
  record('2', mod.canonicalJson(folded) === mod.canonicalJson(other)
    && folded.items === PANEL_BODY.declared.visible && other.items === PANEL_BODY.declared.visible
    && folded.reads.panel === 'ok' && folded.reads.notes === 'ok',
  'two arrival orders -> ' + String(mod.canonicalJson(folded) === mod.canonicalJson(other)) + '; the items are the route\'s own rows, uncopied: ' + String(folded.items === PANEL_BODY.declared.visible))

  const notJson = mod.readPanelState(HTTP(404, null, '<html>not found</html>'))
  const foldedBad = mod.foldArrivals([arrivalOf(mod, 'panel', HTTP(404, null, '<html>not found</html>'))])
  record('3', notJson.ok === false && notJson.code === mod.CLIENT_FAILURES.UNREADABLE && notJson.from === 'client'
    && notJson.detail.includes('<html>not found</html>')
    && foldedBad.reads.panel === 'failed' && foldedBad.items.length === 0 && foldedBad.failures.length === 1,
  'a non-JSON body: ' + show(notJson))

  const wrongField = mod.readPanelState(HTTP(200, { ok: true, declared: { visible: { teams: ITEM_A }, rejected: [] } }))
  record('4', wrongField.ok === false && wrongField.code === mod.CLIENT_FAILURES.SHAPE
    && wrongField.detail.includes('declared.visible must be an array') && wrongField.detail.includes('teams')
    && wrongField.detail.includes('GET /api/dsh-link-panel/state'),
  'a wrong field: ' + show(wrongField))

  const routeRefusal = mod.readPanelState(HTTP(500, { ok: false, error: { code: 'SNAPSHOT_FAILED', message: 'the projection threw: order is not a number' } }))
  record('5', routeRefusal.ok === false && routeRefusal.code === 'SNAPSHOT_FAILED' && routeRefusal.from === 'route'
    && routeRefusal.detail === 'the projection threw: order is not a number',
  'the route\'s own words: ' + show(routeRefusal))

  const notesRead = mod.readNotesState(NOTES_ANSWER)
  record('6', notesRead.ok === true && show(notesRead.rows) === show([{ id: 'n-1', text: 'the ledger remembers this', tags: ['handoff'], author: 'user', state: 'open' }])
    && show(notesRead.limits) === show({ maxNotes: 200, maxChars: 100 }) && show(notesRead.counts) === show(NOTES_BODY.counts),
  'the ledger read: ' + show(notesRead))

  const notAList = mod.readNotesState(HTTP(200, { ok: true, limits: { maxNotes: 200, maxChars: 100 }, notes: 'not a list' }))
  record('7', notAList.ok === false && notAList.code === mod.CLIENT_FAILURES.SHAPE
    && notAList.detail.includes('notes must be an array') && notAList.detail.includes('top-level keys: limits, notes, ok'),
  'a ledger whose list is not a list: ' + show(notAList))
  const noLimits = mod.readNotesState(HTTP(200, { ok: true, notes: [] }))
  record('7b', noLimits.ok === false && noLimits.code === mod.CLIENT_FAILURES.SHAPE && noLimits.detail.includes('limits must be an object'),
    'a ledger without thresholds: ' + show(noLimits))

  const badRow = mod.readNotesState(HTTP(200, { ok: true, limits: { maxNotes: 200, maxChars: 100 }, notes: [{ id: 'n-1' }, 'not a note'] }))
  record('8', badRow.ok === false && badRow.code === mod.CLIENT_FAILURES.SHAPE && badRow.detail.includes('notes[0]'),
    'a row that is not a note: ' + show(badRow))

  const bothBad = mod.foldArrivals([
    arrivalOf(mod, 'panel', HTTP(200, { ok: true, declared: { visible: { teams: ITEM_A }, rejected: [] } })),
    arrivalOf(mod, 'notes', HTTP(503, { ok: false, error: { code: 'NOTES_LEDGER_UNREADABLE', message: 'the ledger file could not be read' } })),
  ])
  const badMarker = mod.markerFrom(bothBad)
  record('9', bothBad.reads.panel === 'failed' && bothBad.reads.notes === 'failed' && bothBad.failures.length === 2
    && badMarker.mounted === true && typeof badMarker.failed === 'string' && badMarker.failed.includes('NOTES_LEDGER_UNREADABLE')
    && badMarker.items === undefined,
  'both slots failed: ' + show(badMarker))

  const three = ['NOTES_INPUT', 'NOTES_TOO_LONG', 'NOTES_FULL']
  const seen = three.map((code) => mod.readSubmit(HTTP(400, { ok: false, error: { code, message: code + ': refused by ' + code.toLowerCase() } })))
  record('10', seen.every((outcome, index) => outcome.ok === false && outcome.code === three[index] && outcome.from === 'route'
    && outcome.detail === three[index] + ': refused by ' + three[index].toLowerCase()),
  'the three frozen codes arrive verbatim: ' + show(seen.map((outcome) => outcome.code)))

  const fourth = mod.readSubmit(HTTP(400, { ok: false, error: { code: 'NOTES_WEIRD', message: 'a code from a newer round' } }))
  record('11', fourth.ok === false && fourth.code === 'NOTES_WEIRD' && fourth.from === 'route' && fourth.code !== three[0] && fourth.code !== three[1],
  'a fourth code is not translated: ' + show(fourth))

  const accepted = mod.readSubmit(HTTP(200, { ok: true, id: 'n-2', seq: 9 }))
  const acceptedSeqOnly = mod.readSubmit(HTTP(200, { ok: true, seq: 12, notes: 3 }))
  record('12', accepted.ok === true && accepted.code === 'added' && accepted.detail === 'note n-2 (seq 9)'
    && acceptedSeqOnly.ok === true && acceptedSeqOnly.detail === 'the route accepted the note (seq 12)',
  'an accepted note: ' + show(accepted) + ' / ' + show(acceptedSeqOnly))

  const over = 'x'.repeat(300)
  const requests = [over, '', 42].map((text) => mod.noteRequest(text))
  const wanted = [over, '', 42].map((text) => JSON.stringify({ text, author: 'user' }))
  record('13', requests.every((request, index) => request.path === '/api/dsh-link-notes/add' && request.body === wanted[index])
    && requests[0].body.includes(over),
  'the request sends the text as typed (300 > maxChars=100, blank, and a non-string alike): ' + String(requests[0].body.length) + ' bytes')

  record('14', mod.PANEL_TAB_ID === 'dsh-link-panel' && mod.PANEL_TAB_KIND === 'pane'
    && mod.PANEL_STATE_PATH === '/api/dsh-link-panel/state' && mod.NOTES_STATE_PATH === '/api/dsh-link-notes/state'
    && mod.NOTES_ADD_PATH === '/api/dsh-link-notes/add' && mod.USER_AUTHOR === 'user',
  'the frozen names: ' + show([mod.PANEL_TAB_ID, mod.PANEL_TAB_KIND, mod.NOTES_ADD_PATH, mod.USER_AUTHOR]))

  const hostile = ['not an answer', null, 42, Symbol('x'), [], { get ok() { throw new Error('a getter threw this') } }]
  let thrown = null
  let named = 0
  try {
    for (const value of hostile) {
      for (const read of [mod.readPanelState, mod.readNotesState, mod.readSubmit]) {
        const outcome = read(value)
        if (outcome.ok === false && typeof outcome.code === 'string' && outcome.code !== '' && typeof outcome.detail === 'string') named += 1
      }
    }
  } catch (error) {
    thrown = error
  }
  record('15', thrown === null && named === hostile.length * 3,
    'hostile values: ' + String(named) + ' named failures, thrown=' + show(thrown === null ? null : String(thrown)))

  const snapshot = mod.canonicalJson(folded)
  const after = mod.withArrival(folded, arrivalOf(mod, 'notes', HTTP(200, { ...NOTES_BODY, notes: [] })))
  record('16', mod.canonicalJson(folded) === snapshot && after !== folded && after.notes.rows.length === 0 && folded.notes.rows.length === 1,
  'the fold hands back a new view and leaves the one it was given alone: ' + String(mod.canonicalJson(folded) === snapshot))

  return rows
}

// ----------------------------------------------------------------------------------- wiring plane
async function wireBattery(mod, load, register, copy) {
  const rows = []
  const record = (id, ok, detail) => {
    rows.push({ id, ok: ok === true, detail: String(detail) })
    console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + ' — ' + detail)
    return ok === true
  }
  const fakeHost = (options = {}) => {
    const seen = { definitions: [], slots: [], effects: [], localeNamespaces: [], released: 0 }
    const host = {
      effect(callback, label) { seen.effects.push(label); return callback() },
      sidebarRightTabs: {
        register(definition) {
          if (options.failRegister === true) throw new Error(options.failRegisterWith ?? 'sidebarRight: boom')
          seen.definitions.push(definition)
          return () => { seen.released += 1 }
        },
      },
      slots: {
        inject(name, factory) { seen.slots.push(name); return factory() },
        register(registration) {
          seen.slots.push(registration.name + '#' + registration.key)
          seen.localeNamespaces.push(registration.locale)
          return () => { seen.released += 1 }
        },
      },
    }
    return { host, seen }
  }
  const tick = () => new Promise((done) => setTimeout(done, 0))

  const definition = register.panelDefinition(copy.t, copy.icon)
  const plain = fakeHost()
  const globals = {}
  const answerFor = (path) => (path === mod.NOTES_STATE_PATH
    ? { status: 200, body: NOTES_BODY, text: JSON.stringify(NOTES_BODY), transport: null }
    : { status: 200, body: PANEL_BODY, text: JSON.stringify(PANEL_BODY), transport: null })
  const loader = load.createLoader({ ask: async (path) => answerFor(path), globals })
  const dispose = register.registerPanelTab(plain.host, {
    body: () => null,
    title: () => null,
    load: loader.load,
    initial: loader.current,
    add: async () => ({ ok: true, code: 'added', detail: 'never called here', from: 'route' }),
    icon: copy.icon,
    t: copy.t,
    globals,
  })
  record('W1', definition.id === 'dsh-link-panel' && definition.kind === 'pane' && definition.priority === 'extension'
    && definition.patterns === undefined && definition.guide.length === 1 && definition.guide[0].id === 'panel'
    && definition.title('sidebar://pane') === 'LINK panel',
  'one definition: ' + show({ id: definition.id, kind: definition.kind, priority: definition.priority, patterns: definition.patterns, guide: definition.guide.map((entry) => entry.id) }))
  // W7  the chip text and the guide entry are dictionary thunks, read again on every use: the same
  //     definition built over zh answers in zh, and the one over en carries the frozen English.
  const zhDefinition = register.panelDefinition(copy.bind('zh'), copy.icon)
  const enDefinition = register.panelDefinition(copy.bind('en'), copy.icon)
  record('W7', zhDefinition.title('sidebar://pane') === copy.zh['tab.title']
    && enDefinition.title('sidebar://pane') === 'LINK panel'
    && zhDefinition.guide[0].description() === copy.zh['guide.description']
    && enDefinition.guide[0].description() === 'What the panel registry declares — its visible items, the items it refused by name — and the note ledger, with a box to add one note.'
    && zhDefinition.guide[0].icon === copy.icon && typeof zhDefinition.guide[0].icon === 'function',
  'the chip and the guide entry in two languages: zh=' + show(zhDefinition.title('sidebar://pane')) + ' en=' + show(enDefinition.title('sidebar://pane')) + '; glyph=' + show(zhDefinition.guide[0].icon === copy.icon))

  record('W2', show(plain.seen.slots) === show([
    'sidebar.right.pane.tab', 'sidebar.right.pane.tab#dsh-link-panel',
    'sidebar.right.pane.tab.title', 'sidebar.right.pane.tab.title#dsh-link-panel',
  ]) && plain.seen.effects.length === 3 && show(plain.seen.localeNamespaces) === show(['dsh-link-panel', 'dsh-link-panel']),
  'the seats: ' + show(plain.seen.slots) + '; declared locales: ' + show(plain.seen.localeNamespaces))

  await tick()
  const marker = globals[register.MARKER_KEY]
  record('W3', marker !== undefined && marker.mounted === true && marker.failed === null
    && show(marker.items) === show([ITEM_A, ITEM_B]) && show(marker.notes) === show({ count: 1, limits: { maxNotes: 200, maxChars: 100 } }),
  'the marker after the reads, with no panel operation: ' + show(marker))

  const deadGlobals = {}
  const dead = load.createLoader({
    ask: async () => ({ status: 404, body: null, text: 'no route', transport: null }),
    globals: deadGlobals,
  })
  const deadHost = fakeHost()
  register.registerPanelTab(deadHost.host, {
    body: () => null, title: () => null, load: dead.load, initial: dead.current, add: dead.add,
    icon: copy.icon, t: copy.t, globals: deadGlobals,
  })
  await tick()
  const deadMarker = deadGlobals[register.MARKER_KEY]
  // Both routes are dead here, and the marker carries the canonically FIRST failure by slot name
  // ('notes' before 'panel'): which one wins is data, not arrival order.
  record('W4', deadMarker !== undefined && deadMarker.mounted === true
    && deadMarker.failed === 'response-unreadable: GET /api/dsh-link-notes/state: HTTP 404 and the body is not a JSON object: no route',
  'a route that is not there, and the failure the marker carries: ' + show(deadMarker))

  dispose()
  record('W5', plain.seen.released === 3 && globals[register.MARKER_KEY].mounted === false && globals[register.MARKER_KEY].disposed === true,
  'taken down: ' + show(globals[register.MARKER_KEY]) + '; disposers released=' + String(plain.seen.released))

  const brokenGlobals = {}
  const broken = fakeHost({ failRegister: true, failRegisterWith: 'sidebarRight: tab type id "dsh-link-panel" is already registered' })
  let thrown = null
  let brokenDispose = null
  try {
    brokenDispose = register.registerPanelTab(broken.host, {
      body: () => null, title: () => null, load: async () => mod.emptyView(), initial: () => mod.emptyView(), add: async () => null,
      icon: copy.icon, t: copy.t, globals: brokenGlobals,
    })
  } catch (error) {
    thrown = error
  }
  record('W6', thrown === null && typeof brokenDispose === 'function'
    && show(brokenGlobals[register.MARKER_KEY]) === show({ mounted: true, failed: 'sidebarRight: tab type id "dsh-link-panel" is already registered' }),
  'a registration that throws: ' + show(brokenGlobals[register.MARKER_KEY]))

  return rows
}

// ----------------------------------------------------------------------------------- the seam plane (R192)
/** Where this round's staged copies live: the pre-R192 view module, and the seam mutants. */
const SCRATCH_P1 = join(PROJECT, '.tmp', 'r192-p1')
const SEAM_HEAD = join(SCRATCH_P1, 'head')

/**
 * The view module as it stood BEFORE this round, read out of git rather than out of the tree.
 *
 * The marker reading below is not "the marker still looks right": it is "every field the pre-seam
 * module wrote for the same inputs is byte-identical, and the seam arrives as a NEW field". A copy of
 * the tree could not prove that (the tree has already moved), so the old module is staged from HEAD
 * into this round's scratch directory and imported.
 * @returns where it was staged, the revision it came from, or why it could not be read.
 */
function preSeamView() {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT, encoding: 'utf8' }).trim()
    // The plugin sits under the project, and the project is not always the repository root: the path
    // git wants is the one from the root, so the prefix is asked for instead of guessed.
    const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: PROJECT, encoding: 'utf8' }).trim()
    const bytes = execFileSync('git', ['show', 'HEAD:' + prefix + 'plugins/dsh-link-panel/src/client/view.ts'], { cwd: PROJECT, encoding: 'utf8' })
    mkdirSync(SEAM_HEAD, { recursive: true })
    const staged = join(SEAM_HEAD, 'view.ts')
    writeFileSync(staged, bytes)
    return { path: staged, revision, error: null }
  } catch (error) {
    return { path: null, revision: null, error: String(error && error.message ? error.message : error) }
  }
}

/**
 * The seam plane over one module: the package own contributions.ts, or a staged mutant of it.
 *
 * Reading ids: P1 both claimants, P2 the closed set, P3 the source, P4 everything else by its own text,
 * P5 arrival orders, P6 the disposer, P7 an empty seam and its listeners, P8 one vocabulary with the
 * host registry, P9 the body, P10 the marker, P11 a declaration that lands after the reads,
 * P13 a reading that moves.
 * @param contrib - the seam module to measure.
 * @param viewMod - the view module.
 * @param loadMod - the loader module.
 * @param host - the host half, imported as a module, for the vocabulary and the parity readings.
 * @param id - the reading id prefix.
 * @returns the readings.
 */
async function seamBattery(contrib, viewMod, loadMod, host, id = 'P') {
  const rows = []
  const record = (suffix, ok, detail) => {
    rows.push({ id: id + suffix, ok: ok === true, detail: String(detail) })
    console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + suffix + ' — ' + detail)
    return ok === true
  }

  // P1  two claimants of one id: BOTH refused and neither drawn. Keeping one of them is the
  //     arbitration the host registry refuses, and arrival order is what would decide it.
  const pair = contrib.createLinkPanelService()
  const firstClaim = pair.declare({ ...SEAM_STATUS })
  const secondClaim = pair.declare({ ...SEAM_STATUS, title: 'LAN bridge, second claimant' })
  const bothRefused = pair.rejected()
  record('1', pair.entries().length === 0 && bothRefused.length === 2
    && bothRefused.every((row) => row.code === contrib.CONTRIBUTION_REJECT.DUP_ID)
    && bothRefused.every((row) => row.detail.includes('"lan-status"') && row.detail.includes('every claimant is refused'))
    && bothRefused.map((row) => row.id).join(',') === 'lan-status,lan-status',
  'two claimants of one id are both refused and neither wins: entries=' + show(pair.entries()) + ', refusals=' + show(bothRefused.map((row) => [row.id, row.code])))
  firstClaim()
  secondClaim()

  // P2  an unknown kind is refused BY NAME and never translated to the nearest kind this build knows.
  const unknown = contrib.createLinkPanelService()
  unknown.declare({ id: 'chat', kind: 'chat', title: 'Chat', source: 'somebody', order: 5, body: 'not drawn' })
  const unknownRefusal = unknown.rejected()[0]
  record('2', unknown.entries().length === 0 && unknown.rejected().length === 1
    && unknownRefusal.code === contrib.CONTRIBUTION_REJECT.UNKNOWN_KIND && unknownRefusal.detail.includes('"chat"')
    && unknownRefusal.detail.includes(contrib.CONTRIBUTION_KINDS.join(', ')),
  'an unknown kind is refused by name and never translated: ' + show(unknownRefusal))

  // P3  a source that cannot say where the item comes from.
  const sources = contrib.createLinkPanelService()
  sources.declare({ id: 'blank', kind: 'status', title: 'Blank', source: '   ', order: 1 })
  sources.declare({ id: 'nullish', kind: 'status', title: 'Nullish', source: null, order: 2 })
  record('3', sources.entries().length === 0 && sources.rejected().length === 2
    && sources.rejected().every((row) => row.code === contrib.CONTRIBUTION_REJECT.EMPTY_SOURCE),
  'a source that says nothing is refused by name: ' + show(sources.rejected().map((row) => [row.id, row.code])))

  // P4  what the three names do not cover keeps its OWN text and `code: null`; the one field with a
  //     default (a missing order) is the documented zero rather than a refusal.
  const rest = contrib.createLinkPanelService()
  rest.declare({ id: 'infinite', kind: 'pane', title: 'Infinite', source: 'x', order: Number.POSITIVE_INFINITY })
  rest.declare({ id: 'not-a-number', kind: 'pane', title: 'NaN', source: 'x', order: Number.NaN })
  rest.declare({ id: 'bad-body', kind: 'pane', title: 'Bad body', source: 'x', order: 3, body: 42 })
  rest.declare({ id: 'no-order', kind: 'pane', title: 'No order', source: 'x' })
  const restRefused = rest.rejected()
  record('4', restRefused.length === 3 && restRefused.every((row) => row.code === null)
    && restRefused.filter((row) => row.detail.includes('order must be a finite number')).length === 2
    && restRefused.filter((row) => row.detail.includes('body must be a string or a function')).length === 1
    && show(rest.entries()) === show([{ id: 'no-order', kind: 'pane', title: 'No order', source: 'x', order: 0, body: '', hasInvoke: false }]),
  'what the three names do not cover keeps its own text and code null: ' + show(restRefused.map((row) => [row.id, row.code])))

  // P5  the same three declarations, two arrival orders, byte-identical rows and refusals.
  const forward = contrib.createLinkPanelService()
  const backward = contrib.createLinkPanelService()
  const sourceless = { id: 'sourceless', kind: 'status', title: 'Sourceless', source: '   ', order: 7 }
  forward.declare({ ...SEAM_STATUS }); forward.declare({ ...SEAM_PANE }); forward.declare({ ...sourceless })
  backward.declare({ ...sourceless }); backward.declare({ ...SEAM_PANE }); backward.declare({ ...SEAM_STATUS })
  const flat = (service) => show({ entries: service.entries(), refused: service.rejected() })
  record('5', flat(forward) === flat(backward) && forward.entries().map((row) => row.id).join(',') === 'teams-pane,lan-status'
    && forward.rejected().length === 1 && forward.rejected()[0].code === contrib.CONTRIBUTION_REJECT.EMPTY_SOURCE,
  'two arrival orders of the same three declarations are byte-identical (sorted by order, ties by the row own JSON), and the refused one is refused in both: ' + flat(forward))

  // P6  the disposer takes that exact declaration out, and a repeated dispose is a no-op.
  const taken = contrib.createLinkPanelService()
  const drop = taken.declare({ ...SEAM_PANE })
  const drawn = taken.entries().length
  drop()
  const gone = taken.entries().length
  drop()
  record('6', drawn === 1 && gone === 0 && taken.entries().length === 0 && taken.rejected().length === 0,
  'the disposer takes that exact declaration out: ' + show({ drawn, gone, after: taken.entries() }))

  // P7  an empty seam is an empty seam, not an error, and it tells its listeners once per change.
  const quiet = contrib.createLinkPanelService()
  let heard = 0
  const stopHearing = quiet.subscribe(() => { heard += 1 })
  const emptySeam = quiet.entries().length === 0 && quiet.rejected().length === 0
  const put = quiet.declare({ ...SEAM_PANE })
  const afterDeclare = heard
  put()
  const afterDispose = heard
  stopHearing()
  quiet.declare({ ...SEAM_STATUS })
  record('7', emptySeam && afterDeclare === 1 && afterDispose === 2 && heard === 2,
  'an empty seam answers two empty arrays and notifies once per change (and stops when told): ' + show({ emptySeam, heard: [afterDeclare, afterDispose, heard] }))

  // P8  ONE VOCABULARY: the closed set and the three codes are the host registry's own, and both
  //     projections refuse the same five declarations with the same names. Two halves, one rule.
  const five = [
    { id: 'a', kind: 'pane', title: 'A', source: 'somebody', order: 20 },
    { id: 'b', kind: 'status', title: 'B', source: 'somebody else', order: 200 },
    { id: 'a', kind: 'action', title: 'A again', source: 'a third one', order: 20 },
    { id: 'c', kind: 'status', title: 'C', source: '  ', order: 5 },
    { id: 'd', kind: 'chat', title: 'D', source: 'a fourth one', order: 1 },
  ]
  const mine = contrib.projectContributions(five)
  const theirs = host.projectPanel(five, { sinks: host.PANEL_SINKS })
  const fiveFields = (list) => list.map((row) => ({ id: row.id, kind: row.kind, title: row.title, source: row.source, order: row.order }))
  const named = (list) => list.map((row) => [row.id, row.code])
  record('8', show(contrib.CONTRIBUTION_KINDS) === show(host.PANEL_KINDS) && show(contrib.CONTRIBUTION_REJECT) === show(host.PANEL_REJECT)
    && show(fiveFields(mine.visible)) === show(theirs.visible) && show(named(mine.rejected)) === show(named(theirs.rejected)),
  'one vocabulary with the host registry (' + show(contrib.CONTRIBUTION_KINDS) + ' / ' + show(contrib.CONTRIBUTION_REJECT) + '): the same five declarations project to the same rows and the same refusal names — seam ' + show({ visible: mine.visible.map((row) => row.id), refused: named(mine.rejected) }) + ' vs host ' + show({ visible: theirs.visible.map((row) => row.id), refused: named(theirs.rejected) }))

  // P9  the text a declaration carries is its own - a title (a feature's own dictionary word) or a
  //     body - read without letting a provider throw through.
  const bodies = contrib.createLinkPanelService()
  bodies.declare({ id: 's', kind: 'status', title: 'S', source: 'x', order: 1, body: 'plain text' })
  bodies.declare({ id: 't', kind: 'status', title: () => 'title read at projection', source: 'x', order: 2, body: () => 'read at projection' })
  bodies.declare({ id: 'h', kind: 'status', title: 'H', source: 'x', order: 3, body: () => { throw new Error('the provider blew up') } })
  bodies.declare({ id: 'n', kind: 'status', title: 'N', source: 'x', order: 4, body: () => 4711 })
  const said = Object.fromEntries(bodies.entries().map((row) => [row.id, row.body]))
  const titled = Object.fromEntries(bodies.entries().map((row) => [row.id, row.title]))
  record('9', said.s === 'plain text' && said.t === 'read at projection' && said.h === 'the provider blew up' && said.n === '4711'
    && titled.s === 'S' && titled.t === 'title read at projection',
  'a title or a body is the declaration own text - a string, or a function read at projection (a throwing one carries its own error text): ' + show({ titles: titled, bodies: said }))

  // P10 the marker: the route's rows stay the route's rows, byte for byte, and the seam is NEW.
  const arrivals = [arrivalOf(viewMod, 'panel', PANEL_ANSWER), arrivalOf(viewMod, 'notes', NOTES_ANSWER)]
  const withSeam = contrib.createLinkPanelService()
  withSeam.declare({ ...SEAM_PANE })
  withSeam.declare({ ...SEAM_STATUS })
  const folded = viewMod.withContributions(viewMod.foldArrivals(arrivals), withSeam.entries(), withSeam.rejected())
  const marker = viewMod.markerFrom(folded)
  const staged = preSeamView()
  let pre = null
  let why = staged.error
  if (staged.path !== null) {
    try { pre = await import(pathToFileURL(staged.path).href) } catch (error) { why = String(error && error.message ? error.message : error) }
  }
  const frozen = (value) => show({ mounted: value.mounted, tabId: value.tabId, items: value.items, notes: value.notes, failed: value.failed })
  const old = pre === null ? null : pre.markerFrom(pre.foldArrivals(arrivals))
  const added = old === null ? [] : Object.keys(marker).filter((key) => key in old === false)
  const dropped = old === null ? [] : Object.keys(old).filter((key) => key in marker === false)
  record('10', show(marker.items) === show(PANEL_BODY.declared.visible) && show(marker.contributed) === show(SEAM_ROWS)
    && (old === null || (frozen(old) === frozen(marker) && dropped.length === 0 && (added.length === 0 || (added.length === 1 && added[0] === 'contributed')))),
  'the marker keeps items as the ROUTE own rows byte for byte (' + String(marker.items.length) + ' row(s)) and reports the seam BESIDE them in the new contributed field (' + String(marker.contributed.length) + ' row(s))'
    + (old === null
      ? ' — NOT APPLICABLE (named): the pre-R192 view.ts could not be read back from git, so the byte comparison did not run: ' + show(why)
      : '; every pre-R192 field is byte-identical to what ' + String(staged.revision) + ' wrote for the same inputs, fields added=' + show(added) + ', dropped=' + show(dropped)))

  // P11 a declaration landing AFTER the reads: the marker and the pane hear about it in the same step.
  const late = contrib.createLinkPanelService()
  const globals = {}
  const loader = loadMod.createLoader({
    ask: async (path) => (path === viewMod.NOTES_STATE_PATH ? NOTES_ANSWER : PANEL_ANSWER),
    globals,
    panel: late,
  })
  await loader.load()
  const beforeLanding = globals[register.MARKER_KEY] === undefined ? null : globals[register.MARKER_KEY].contributed.length
  const heardOf = []
  const stopWatching = loader.watch((next) => { heardOf.push(next.contributed.length) })
  const claim = late.declare({ ...SEAM_STATUS })
  const landed = globals[register.MARKER_KEY]
  loader.dispose()
  claim()
  record('11', beforeLanding === 0 && landed.contributed.length === 1 && landed.contributed[0].source === 'dsh-link-lan-bridge'
    && heardOf.length === 1 && heardOf[0] === 1 && globals[register.MARKER_KEY].contributed.length === 1
    && show(landed.items) === show(PANEL_BODY.declared.visible),
  'a declaration that lands after the reads reaches the marker and the pane in the same step, and a disposed loader lets the seam go: '
    + show({ before: beforeLanding, landed: landed.contributed.map((row) => row.id), heard: heardOf, afterDispose: globals[register.MARKER_KEY].contributed.length }))
  stopWatching()

  // P13 the reading MOVED, and the same claim is projected again. This is the defect R192 was
  //     opened for: the provider's own store already held the new reading while the panel went
  //     on drawing the text the item had answered once, at declare time. Two things are
  //     measured here, and neither is a count of calls:
  //       * a projection is taken on EVERY entries() call - the row read BEFORE notify() is
  //         already the moved text, so nothing is cached; a seam that froze its first projection
  //         answers the old text here and is red;
  //       * notify() is the named path a provider takes when its reading moved - every
  //         subscriber hears it once, and it re-declares nothing (one claim in, one row out).
  const live = contrib.createLinkPanelService()
  let reading = 'connected on 192.168.1.7'
  let word = 'Connection status'
  const releaseLive = live.declare({
    id: 'live-reading', kind: 'status', source: 'dsh-link-lan-bridge', order: 200,
    title: () => word, body: () => reading,
  })
  const firstDrawn = live.entries()[0]
  let heardLive = 0
  const stopLive = live.subscribe(() => { heardLive += 1 })
  reading = 'connected on 10.0.0.9'
  word = 'Connection status (moved)'
  const beforeTheCall = live.entries()[0]
  live.notify()
  const afterTheCall = live.entries()[0]
  stopLive()
  releaseLive()
  record('13', firstDrawn.body === 'connected on 192.168.1.7' && firstDrawn.title === 'Connection status'
    && beforeTheCall.body === 'connected on 10.0.0.9' && beforeTheCall.title === 'Connection status (moved)'
    && afterTheCall.body === 'connected on 10.0.0.9' && afterTheCall.title === 'Connection status (moved)'
    && afterTheCall.id === firstDrawn.id && heardLive === 1
    && live.entries().length === 0 && live.rejected().length === 0,
  'one claim, projected again, answers the MOVED reading - no cached first projection and no second declaration - and notify() is the named path that tells every subscriber a projection is due: '
    + show({ first: [firstDrawn.title, firstDrawn.body], moved: [beforeTheCall.title, beforeTheCall.body], heard: heardLive, thenReleased: live.entries().length }))

  // P14 the action's ONE REQUIREMENT (R193-contract.md section 1.1, 1.2): a row of kind 'action'
  //     without a CALLABLE invoke is refused through the same passthrough channel a non-finite order
  //     uses - code null and the original text, naming the field and what arrived - so no fourth
  //     refusal name is invented for it. A field that is present and is not a function refuses any row
  //     by its own text. The rows around the hole are held BYTE FOR BYTE: one broken action is that
  //     action's own hole, never a shorter panel.
  const actions = contrib.createLinkPanelService()
  const pressableAction = { id: 'browser-open', kind: 'action', title: 'Open the browser panel', source: 'dsh-browser', order: 30, invoke: () => 'not called by this reading' }
  actions.declare({ ...pressableAction })
  actions.declare({ ...SEAM_STATUS })
  const beforeTheHoles = show(actions.entries())
  actions.declare({ id: 'browser-blind', kind: 'action', title: 'An action with no invoke', source: 'dsh-browser', order: 31 })
  actions.declare({ id: 'browser-wrong', kind: 'action', title: 'An action whose invoke is not a function', source: 'dsh-browser', order: 32, invoke: 42 })
  const holes = actions.rejected()
  const holeTexts = holes.map((row) => row.detail)
  record('14', beforeTheHoles === show(actions.entries()) && actions.entries().length === 2
    && holes.length === 2 && holes.every((row) => row.code === null)
    && holeTexts.some((text) => text.includes('kind action needs a callable invoke (got undefined)'))
    && holeTexts.some((text) => text.includes('invoke must be a function (got 42)')),
  'an action without a callable invoke keeps its own text and code null (no fourth name), and the rows around it are untouched: '
    + show({ drawn: actions.entries().map((row) => [row.id, row.hasInvoke]), refused: holes.map((row) => [row.id, row.code, row.detail]) }))

  // P15 ONE PRESS, ONE CALL. The seam calls the declaration's own invoke EXACTLY ONCE, with the
  //     declaration as the receiver (a feature's own method keeps its own `this`), and answers ok with
  //     nothing to show. A press that names nothing drawn - an id no row carries, or a row of another
  //     kind - is refused by this seam's own sentence and calls NOTHING: what is pressed is what is
  //     drawn, never a declaration the panel is not showing.
  const oneCall = contrib.createLinkPanelService()
  const receivers = []
  oneCall.declare({ id: 'browser-open', kind: 'action', title: 'Open the browser panel', source: 'dsh-browser', order: 30, invoke: function () { receivers.push(this) } })
  oneCall.declare({ ...SEAM_STATUS })
  const pressed = oneCall.press('browser-open')
  const unknownPress = oneCall.press('nothing-draws-this')
  const readingPress = oneCall.press(SEAM_STATUS.id)
  record('15', receivers.length === 1 && receivers[0].id === 'browser-open' && pressed.ok === true && pressed.detail === ''
    && unknownPress.ok === false && unknownPress.detail.includes('nothing-draws-this')
    && readingPress.ok === false && readingPress.detail.includes(SEAM_STATUS.id) && readingPress.detail.includes('status'),
  'one press is one call of the provider own invoke, with the declaration as its receiver; a press that names nothing drawn is refused by text and calls nothing: '
    + show({ calls: receivers.length, receiver: receivers.length === 0 ? null : receivers[0].id, answered: pressed, unknown: unknownPress, reading: readingPress }))

  // P16 A THROW IS CONTAINED AND THE PROVIDER'S OWN TEXT IS WHAT TRAVELS. The one caller-supplied
  //     function on this path runs inside one catch: press() does not throw, the row it belongs to is
  //     still drawn (a press that failed is not a broken item), and the detail is the ORIGINAL message
  //     rather than a sentence of this seam's about it.
  const angry = contrib.createLinkPanelService()
  angry.declare({ id: 'browser-open', kind: 'action', title: 'Open the browser panel', source: 'dsh-browser', order: 30, invoke: () => { throw new Error('the browser tab would not open') } })
  let escaped = null
  let angryAnswer = null
  try { angryAnswer = angry.press('browser-open') } catch (error) { escaped = String(error && error.message ? error.message : error) }
  record('16', escaped === null && angryAnswer !== null && angryAnswer.ok === false && angryAnswer.detail === 'the browser tab would not open'
    && angry.entries().length === 1 && angry.rejected().length === 0 && angry.entries()[0].hasInvoke === true,
  'the provider own throw is caught, travels back as its own text, and leaves the row drawn: '
    + show({ escaped, answered: angryAnswer, drawn: angry.entries().map((row) => [row.id, row.hasInvoke]) }))

  // P17 THE MARKER REPORTS hasInvoke AND CARRIES NO FUNCTION (R193-contract.md section 1.4). The
  //     marker's contributed rows are readable data: each says whether its declaration carries a
  //     callable invoke as a BOOLEAN, and not one row holds the function itself. What the marker's
  //     other fields are is P10's reading, not this one.
  const marked = contrib.createLinkPanelService()
  marked.declare({ id: 'browser-open', kind: 'action', title: 'Open the browser panel', source: 'dsh-browser', order: 30, invoke: () => {} })
  marked.declare({ ...SEAM_STATUS })
  const actionMarker = viewMod.markerFrom(viewMod.withContributions(viewMod.foldArrivals(arrivals), marked.entries(), marked.rejected()))
  const flags = actionMarker.contributed.map((row) => [row.id, row.hasInvoke])
  const heldFunctions = []
  for (const row of actionMarker.contributed) {
    for (const key of Object.keys(row)) if (typeof row[key] === 'function') heldFunctions.push(row.id + '.' + key)
  }
  record('17', show(flags) === show([['browser-open', true], ['lan-status', false]])
    && heldFunctions.length === 0 && actionMarker.contributed.every((row) => row.invoke === undefined)
    && viewMod.canonicalJson(actionMarker).includes('"hasInvoke":true'),
  'the marker reports hasInvoke per row as a boolean and carries no function at all: '
    + show({ flags, functions: heldFunctions, bytes: viewMod.canonicalJson(actionMarker).length }))

  return rows
}

// --------------------------------------------------------------------------------- artifact plane
/** Load the built bundle the web shell serves, with the module table stubbed to react and nothing else. */
function loadArtifact(path) {
  let captured = null
  const window = { __ModuleLoader__: { load: (registration) => { captured = registration } } }
  new Function('window', readFileSync(path, 'utf8'))(window)
  if (captured === null || captured.id !== 'dsh-link-panel' || typeof captured.factory !== 'function') {
    return { error: 'the bundle did not register a dsh-link-panel factory: ' + show(captured === null ? null : captured.id) }
  }
  const asked = []
  const require = (name) => {
    asked.push(name)
    if (name === 'react') return { useState: (value) => [typeof value === 'function' ? value() : value, () => {}], useEffect: () => {} }
    if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: null }
    // The shell's own module table (kernel packages/client/web/src/platform.ts PLATFORM_MODULES, and
    // compat/host-modules.json clientBaseline): the bundle leaves it external and the page supplies it.
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return { IconFlatListOutlineRegular: () => null }
    }
    throw new Error('the bundle asked for ' + name + ', which is not in the module table')
  }
  try {
    return { asked, exports: captured.factory(require) }
  } catch (error) {
    return { asked, error: String(error && error.message ? error.message : error) }
  }
}

/**
 * The same bundle, loaded with a JSX stub that KEEPS the tree, so a reading can see what the pane
 * would draw instead of trusting that it draws something. Hooks are stubs: one render, no re-render.
 * @param path - the built browser half.
 * @returns {@link render}, which builds one tree from one component and one props object, or the error.
 */
function loadArtifactTree(path) {
  let captured = null
  const window = { __ModuleLoader__: { load: (registration) => { captured = registration } } }
  new Function('window', readFileSync(path, 'utf8'))(window)
  if (captured === null || typeof captured.factory !== 'function') return { error: 'the bundle did not register a dsh-link-panel factory: ' + show(captured === null ? null : captured.id) }
  let cells = []
  let at = 0
  let current = null
  let once = null
  // A hook slot per call, and a state change RE-RENDERS the way React does. Without that, a reading
  // could only ever see the tree a handler was drawn on and never what the pane draws AFTER a click -
  // which is exactly what an action row's failure text is.
  const draw = () => { at = 0; current = once() }
  const react = {
    useState: (initial) => {
      const index = at
      at += 1
      if (index >= cells.length) cells.push(typeof initial === 'function' ? initial() : initial)
      const set = (next) => { cells[index] = typeof next === 'function' ? next(cells[index]) : next; draw() }
      return [cells[index], set]
    },
    useEffect: () => {},
  }
  const element = (type, props) => ({ type, props: props ?? {} })
  const require = (name) => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: null }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconFlatListOutlineRegular: () => null }
    throw new Error('the bundle asked for ' + name + ', which is not in the module table')
  }
  try {
    const exports = captured.factory(require)
    return {
      exports,
      render: (component, props) => { cells = []; at = 0; once = () => component(props); draw(); return current },
      /** The tree as it stands NOW: a click that changed the pane's state is visible here. */
      drawn: () => current,
    }
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) }
  }
}

/** Every element a {@link loadArtifactTree} render built, depth-first. */
function elementsOf(tree, out = []) {
  if (Array.isArray(tree)) {
    for (const child of tree) elementsOf(child, out)
    return out
  }
  if (tree === null || typeof tree !== 'object' || tree.props === undefined) return out
  out.push(tree)
  elementsOf(tree.props.children, out)
  return out
}

// --------------------------------------------------------------------------- the copy plane (R190)
// R190 contract 1.2: this half's own copy is a locale namespace (dictionary + the seat's t), the
// glyph comes from the first-party icon set. Nothing in plugins/** was guarded before this, so these
// readings are the guard. What they can FAIL on is stated per reading; what they cannot see is named
// in the details (the residual hole is the route's own diagnostics in view.ts/load.ts, which are data).
const COPY_PAGE = join(PROJECT, 'docs', 'dev', 'notes-ui.md')
const PRIMITIVES_ICONS = join(PROJECT, 'core', 'deepseek-harness', 'packages', 'client', 'ui-primitives', 'src', 'icons', 'index.tsx')
const SCRATCH_R190 = join(PROJECT, '.tmp', 'r190-p1', 'stage')
const TICK = String.fromCharCode(96)

/** The page's frozen cells, by the anchor id it names them with: which dictionary key holds each. */
const FROZEN_KEY_OF = {
  'panel-client-title': ['tab.title'],
  'panel-client-guide': ['guide.description'],
  'panel-client-readonly-chip': ['panel.readonly'],
  'panel-client-reads-text': ['panel.reads'],
  'panel-client-items-empty': ['items.empty'],
  'panel-client-refused-empty': ['refused.empty'],
  'panel-client-count': ['notes.count'],
  'panel-client-limits-text': ['notes.limits'],
  'panel-client-limits-unread': ['notes.limitsUnread'],
  'panel-client-notes-empty': ['notes.empty'],
  'panel-client-input': ['input.label'],
  'panel-client-submit': ['submit.idle', 'submit.busy'],
  'panel-client-failure-line': ['failure.line'],
  'panel-client-result-line': ['copy.format.line'],
  'panel-client-no-code': ['refusal.noCode'],
}

/** Literals a chrome file may spell out: names, discriminants, route field names, punctuation. */
const NON_COPY_LITERALS = new Set([
  '', ':', ', ', 'panel:', ' notes:',
  'items', 'refused', 'notes', 'no-id', 'no-code', 'panel', 'extension', 'submit',
  'id', 'kind', 'title', 'order', 'source', 'text', 'maxNotes', 'maxChars',
  'client', 'route', 'function', 'string', 'number', 'object',
  'slots', 'sidebarRightTabs', 'locale', '__dshLinkPanel', 'dsh-link-panel: dictionaries',
  'this pane was mounted without a way to write',
])
const NON_COPY_PATTERNS = [
  /^dsh-link-panel(-[a-z0-9-]+)?$/, /^sidebar\.[a-z.]+$/, /^dsh-link-panel: [a-z ]+$/, /^data-[a-z-]+$/, /^\.\/[a-z]+\.ts$/, /^(@[a-z-]+\/)?[a-z-]+$/,
]

/** Every file under one root's browser half, sorted, so two roots compare by name. */
function clientFiles(root) {
  const base = join(root, 'src', 'client')
  if (existsSync(base) === false) return []
  const walk = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
  return walk(base).sort()
}

/** Source with comments blanked, so a comment can neither be scanned as copy nor hide a literal. */
function stripComments(source) {
  const blocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  return blocks.split('\n').map((line) => {
    const at = line.indexOf('//')
    if (at < 0) return line
    const quotes = (line.slice(0, at).match(/['"]/g) ?? []).length
    return quotes % 2 === 0 ? line.slice(0, at) : line
  }).join('\n')
}

/** The kernel's substitution form (locale/src/client/index.ts:466), mirrored for a dictionary-only read. */
function placeholdersOf(text) {
  const found = []
  for (const match of text.matchAll(/\{(\w+)\}/g)) found.push(match[1])
  return found
}
function translate(dict, key, params) {
  const template = dict[key]
  if (typeof template !== 'string') return key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

/** The page's frozen verbatim cells, read from the shipped page rather than restated here. */
function frozenCells() {
  const text = readFileSync(COPY_PAGE, 'utf8')
  const at = text.indexOf('| 位置 | 逐字（原样） | 锚 |')
  if (at < 0) return null
  const ticked = (cell) => [...cell.matchAll(new RegExp(TICK + '([^' + TICK + ']+)' + TICK, 'g'))].map((match) => match[1])
  const rows = []
  for (const line of text.slice(at).split('\n').slice(1)) {
    if (line.startsWith('|') === false) break
    if (/^\|[-: |]+\|$/.test(line)) continue
    const cells = line.split('|')
    // A rule row quotes a source line (`:397`) rather than a product string: those are not copy.
    const literals = ticked(cells[2] ?? '').filter((token) => /^:?\d+$/.test(token) === false && /^[^<]*\.(ts|mjs|md|json)(:\d+)?$/.test(token) === false)
    const anchors = ticked(cells[3] ?? '')
    if (literals.length === 0 || anchors.length === 0) continue
    rows.push({ anchor: anchors[0], literals })
  }
  return rows
}

/**
 * The measured rules for a self-drawn glyph, by its bytes (R190 contract 1.2): 16x16, currentColor,
 * a one-pixel or 1.3 pixel stroke, and no fixed colour anywhere. Returns one line per finding.
 */
function svgFindings(bytes) {
  const found = []
  if (/<svg/.test(bytes) === false) return found
  if (/viewBox="0 0 16 16"/.test(bytes) === false) found.push('no 16x16 viewBox')
  if (bytes.includes('currentColor') === false) found.push('no currentColor')
  if (/strokeWidth=\{(ICON_REGULAR_STROKE|ICON_MEDIUM_STROKE)\}/.test(bytes) === false
    && /stroke-width="(1|1\.3)"/.test(bytes) === false) found.push('stroke width is not 1 or 1.3')
  if (/#[0-9a-fA-F]{3,8}/.test(bytes)) found.push('a fixed hex colour')
  if (/(rgb|hsl)\(/.test(bytes) || /url\(#/.test(bytes)) found.push('a fixed colour or gradient')
  if (/\b(width|height)="(?!16)\d+"/.test(bytes)) found.push('a size other than 16')
  return found
}

/**
 * The copy plane over one root (the package, or a staged copy of it under .tmp/r190-p1).
 * Reading ids: C1 keys, C2 placeholders, C3 the page's frozen cells, C4 parameters, C5 hardcoded copy,
 * C6 key closure, C7 the glyph, C8 the locale wiring.
 * @param root - the package root to measure.
 * @param id - the reading id prefix.
 * @returns the readings.
 */
async function copyBattery(root, id = 'C') {
  const rows = []
  const check = (suffix, ok, detail) => {
    rows.push({ id: id + suffix, ok: ok === true, detail: String(detail) })
    console.log('  ' + (ok === true ? 'ok  ' : 'FAIL') + '  ' + id + suffix + ' — ' + detail)
  }
  const files = clientFiles(root)
  const sources = new Map(files.map((path) => [path, readFileSync(path, 'utf8')]))
  const locales = await import(pathToFileURL(join(root, 'src', 'client', 'locales.ts')).href)
  const zhKeys = Object.keys(locales.zh).sort()
  const enKeys = Object.keys(locales.en).sort()
  const chrome = files.filter((path) => /(index\.tsx|register\.ts)$/.test(path))

  check('1', files.length > 0 && JSON.stringify(zhKeys) === JSON.stringify(enKeys),
    'zh and en key sets: ' + String(zhKeys.length) + ' vs ' + String(enKeys.length) + ', equal=' + String(JSON.stringify(zhKeys) === JSON.stringify(enKeys))
      + (JSON.stringify(zhKeys) === JSON.stringify(enKeys) ? '' : '; zh-only=' + show(zhKeys.filter((key) => enKeys.includes(key) === false)) + ' en-only=' + show(enKeys.filter((key) => zhKeys.includes(key) === false))))

  const mismatched = zhKeys.filter((key) => show(placeholdersOf(locales.zh[key])) !== show(placeholdersOf(locales.en[key] ?? '')))
  const unresolved = zhKeys.filter((key) => typeof locales.zh[key] !== 'string' || locales.zh[key] === '' || locales.zh[key] === key)
    .concat(enKeys.filter((key) => typeof locales.en[key] !== 'string' || locales.en[key] === '' || locales.en[key] === key))
  check('2', mismatched.length === 0 && unresolved.length === 0,
    'placeholder names per key: ' + String(zhKeys.length - mismatched.length) + '/' + String(zhKeys.length) + ' identical; keys that do not resolve: ' + show(unresolved)
      + (mismatched.length === 0 ? '' : '; mismatched: ' + show(mismatched.map((key) => key + ' ' + show(placeholdersOf(locales.zh[key])) + ' vs ' + show(placeholdersOf(locales.en[key] ?? ''))))))

  const cells = frozenCells()
  const normalized = (text) => text.replace(/<[^>]*>/g, '@').replace(/\{\w+\}/g, '@')
  const frozen = []
  if (cells === null) frozen.push('the page carries no 4.2 table at ' + COPY_PAGE)
  else {
    for (const cell of cells) {
      const keys = FROZEN_KEY_OF[cell.anchor]
      if (keys === undefined) { frozen.push('no dictionary key is mapped to the page anchor ' + cell.anchor); continue }
      if (keys.length !== cell.literals.length) { frozen.push(cell.anchor + ' freezes ' + String(cell.literals.length) + ' string(s) and ' + String(keys.length) + ' key(s) are mapped to it'); continue }
      for (const [at, key] of keys.entries()) {
        const value = locales.en[key]
        if (typeof value !== 'string') { frozen.push(cell.anchor + ' -> ' + key + ' is not in the en dictionary'); continue }
        if (normalized(value) !== normalized(cell.literals[at])) frozen.push(cell.anchor + ' -> ' + key + ': the page froze ' + show(cell.literals[at]) + ' and the dictionary holds ' + show(value))
      }
    }
    const anchors = cells.map((cell) => cell.anchor).sort()
    const mapped = Object.keys(FROZEN_KEY_OF).sort()
    const missing = mapped.filter((anchor) => anchors.includes(anchor) === false)
    if (missing.length > 0) frozen.push('the page no longer carries ' + show(missing))
  }
  check('3', frozen.length === 0,
    'the frozen cells of the page are the en dictionary, placeholder for placeholder: ' + String(cells === null ? 0 : cells.length) + ' row(s) read, ' + String(Object.keys(FROZEN_KEY_OF).length) + ' anchor(s) mapped'
      + (frozen.length === 0 ? '' : '; ' + frozen.join(' | ')))

  const parameterised = zhKeys.filter((key) => placeholdersOf(locales.en[key]).length > 0)
  const dropped = []
  for (const key of parameterised) {
    const names = placeholdersOf(locales.en[key])
    const params = {}
    for (const name of names) params[name] = 'V-' + name
    const spoken = translate(locales.en, key, params)
    for (const name of names) if (spoken.includes('V-' + name) === false) dropped.push(key + ' drops {' + name + '}')
  }
  const counted = translate(locales.en, 'notes.count', { count: 7 })
  const limited = translate(locales.en, 'notes.limits', { maxNotes: 200, maxChars: 100 })
  check('4', parameterised.length >= 2 && dropped.length === 0 && counted.includes('7') && limited.includes('200') && limited.includes('100'),
    String(parameterised.length) + ' parameterised key(s) ' + show(parameterised) + '; count -> ' + show(counted) + '; thresholds -> ' + show(limited) + '; dropped=' + show(dropped))

  const textFindings = []
  const literalFindings = []
  for (const path of files) {
    const relative = path.slice(root.length + 1).replaceAll('\\', '/')
    const text = stripComments(sources.get(path))
    for (const [at, line] of text.split('\n').entries()) {
      if (line.trimStart().startsWith('import ')) continue
      const tags = [...line.matchAll(new RegExp('(^|[^A-Za-z0-9_$])<([A-Z][A-Za-z0-9]*|[a-z][a-z0-9-]*)(\\s[^<>]*)?>', 'g'))]
      for (const tag of tags) {
        const at2 = tag.index + tag[0].length
        const after = line.slice(at2, at2 + 1)
        if (after !== '' && /[A-Za-z0-9_$\u4e00-\u9fff]/.test(after)) textFindings.push(relative + ':' + String(at + 1) + ' a word is drawn straight after a tag: ' + show(line.slice(at2, at2 + 16)))
      }
      const attrs = [...line.matchAll(/(?<![\w-])(placeholder|aria-label|title|alt)\s*=\s*["']/g)]
      for (const attr of attrs) textFindings.push(relative + ':' + String(at + 1) + ' a quoted ' + attr[1] + ' attribute')
    }
    if (/(locales\.ts)$/.test(path) === false && /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text)) {
      textFindings.push(relative + ' carries a Chinese character outside locales.ts')
    }
    if (chrome.includes(path)) {
      const specifiers = new Set([...text.matchAll(/^\s*(?:import|export)[^\n]*?from\s*'([^']+)'|^\s*import\s*'([^']+)'/gm)].flatMap((match) => [match[1], match[2]]).filter((value) => value !== undefined))
      for (const match of text.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
        if (specifiers.has(match[1] ?? match[2])) continue
        const value = match[1] ?? match[2]
        if (NON_COPY_LITERALS.has(value)) continue
        if (enKeys.includes(value)) continue
        if (NON_COPY_PATTERNS.some((pattern) => pattern.test(value))) continue
        literalFindings.push(relative + ' spells out ' + show(value))
      }
    }
  }
  check('5', textFindings.length === 0 && literalFindings.length === 0,
    'no user-visible string is written into the source: ' + String(files.length) + ' file(s) scanned, ' + String(textFindings.length + literalFindings.length) + ' finding(s)'
      + (textFindings.length + literalFindings.length === 0 ? ' (the diagnostics in view.ts/load.ts carry the route own text and are data, not chrome)' : '; ' + [...textFindings, ...literalFindings].join(' | ')))

  const used = new Set()
  for (const path of files) {
    const text = stripComments(sources.get(path))
    for (const match of text.matchAll(/t\('([^']+)'\)/g)) used.add(match[1])
    if (/(index\.tsx)$/.test(path)) {
      for (const match of text.matchAll(/'([a-z][a-zA-Z0-9]*\.[A-Za-z0-9.]+)'/g)) used.add(match[1])
    }
  }
  const usedList = [...used].sort()
  const unknown = usedList.filter((key) => enKeys.includes(key) === false)
  const unused = enKeys.filter((key) => usedList.includes(key) === false)
  check('6', unknown.length === 0 && unused.length === 0,
    'the dictionary is exactly what this half reads: ' + String(usedList.length) + ' key(s) used, ' + String(enKeys.length) + ' in the dictionary, unknown=' + show(unknown) + ', unused=' + show(unused))

  const indexBytes = sources.get(join(root, 'src', 'client', 'index.tsx')) ?? ''
  const imported = [...indexBytes.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
  const iconImports = imported.filter((match) => match[2] === '@deepseek-ai/dsh-client-ui-primitives')
  const names = iconImports.flatMap((match) => match[1].split(',').map((name) => name.trim()).filter((name) => name !== ''))
  const named = names.length === 1 && /^Icon[A-Za-z0-9]+(Regular|Medium)$/.test(names[0]) ? names[0] : null
  const alias = named === null ? null : new RegExp('const ([A-Z][A-Z0-9_]*) = ' + named).exec(indexBytes)
  const glyphName = alias === null ? named : alias[1]
  const iconWired = glyphName === null ? false : new RegExp('icon: ' + glyphName + ',').test(indexBytes)
  const kernelExports = existsSync(PRIMITIVES_ICONS) ? readFileSync(PRIMITIVES_ICONS, 'utf8') : null
  const kernelKnows = kernelExports === null || named === null ? null : new RegExp('export const ' + named + ' = ').test(kernelExports)
  const svg = files.map((path) => [path, sources.get(path)]).flatMap(([path, text]) => (text.includes('<svg') ? [[path.slice(root.length + 1).replaceAll('\\', '/'), text]] : []))
  const svgProblems = svg.flatMap(([path, bytes]) => svgFindings(bytes).map((finding) => path + ': ' + finding))
  check('7', named !== null && iconWired && svgProblems.length === 0,
    'the glyph: ' + String(names.length) + ' import(s) from @deepseek-ai/dsh-client-ui-primitives, name=' + show(named) + ', passed to the guide entry=' + String(iconWired)
      + ', exported by the pinned kernel icon module=' + show(kernelKnows === null ? 'NOT READ (' + (kernelExports === null ? 'the kernel file is missing' : 'no name was resolved') + ')' : kernelKnows)
      + ', self-drawn <svg> in this half=' + String(svg.length) + (svgProblems.length === 0 ? '' : '; ' + svgProblems.join(' | ')))

  const injected = /export const inject = \[([^\]]*)\]/.exec(indexBytes)
  const services = injected === null ? [] : injected[1].split(',').map((name) => name.trim().replaceAll("'", ''))
  const registered = /ctx\.effect\(\(\) => ctx\.locale\.register\(NS, \{ zh, en \}\), '([^']+)'\)/.test(indexBytes)
  const seatLocales = [...(sources.get(join(root, 'src', 'client', 'register.ts')) ?? '').matchAll(/locale: NS\s*[,}]/g)].length
  check('8', services.includes('locale') && registered && seatLocales === 2 && locales.NS === 'dsh-link-panel',
    'the locale wiring: inject=' + show(services) + ', dictionaries registered at effect=' + String(registered) + ', seats declaring locale: NS=' + String(seatLocales) + ', namespace=' + show(locales.NS))

  return rows
}
// ------------------------------------------------------------------------------------------ run
const view = await import(pathToFileURL(join(PACKAGE, 'src', 'client', 'view.ts')).href)
const load = await import(pathToFileURL(join(PACKAGE, 'src', 'client', 'load.ts')).href)
const register = await import(pathToFileURL(join(PACKAGE, 'src', 'client', 'register.ts')).href)

const contributions = await import(pathToFileURL(join(PACKAGE, 'src', 'client', 'contributions.ts')).href)
// The HOST half, imported as a module: the seam's vocabulary is held to it, not restated here.
const host = await import(pathToFileURL(join(PACKAGE, 'src', 'index.ts')).href)
const copyModule = await import(pathToFileURL(join(PACKAGE, 'src', 'client', 'locales.ts')).href)
// The same substitution rule the kernel applies, over the dictionaries this half registers, so the
// wiring plane can drive the definition without a page (translate() is the mirror defined above).
const copy = {
  zh: copyModule.zh,
  bind: (locale) => (key, params) => translate(locale === 'zh' ? copyModule.zh : copyModule.en, key, params),
  icon: () => null,
}
copy.t = copy.bind('en')

const pureRows = pureBattery(view)
for (const row of pureRows) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + ' — ' + row.detail)
const wireRows = await wireBattery(view, load, register, copy)
const copyRows = await copyBattery(PACKAGE)
const seamRows = await seamBattery(contributions, view, load, host)
const rows = [...pureRows, ...wireRows, ...copyRows, ...seamRows]

if (existsSync(ARTIFACT) === false) {
  for (const row of rows) if (row.ok === false) console.log('  (a reading above is red; the artifact plane is below)')
  console.log((SELF_ATTACK ? 'NOT MEASURED: ' : 'NOT MEASURED: ') + 'the built artifact is missing at ' + ARTIFACT + ' (build it: node plugins/build.mjs)')
  process.exit(3)
}
const built = loadArtifact(ARTIFACT)
check('A1', built.error === undefined && built.exports !== null && typeof built.exports === 'object' && typeof built.exports.apply === 'function' && built.exports.inject.includes('sidebarRightTabs'),
  'the bundle registered id dsh-link-panel and hands out apply() + inject: ' + show(built.error ?? built.exports.inject))

if (built.error === undefined) {
  // The bundle reads the page's own fetch and writes the page's own marker, exactly as it does in the
  // live shell; this battery hands it both, so the reading is the one gate 124 will take.
  const realFetch = globalThis.fetch
  const asked = []
  globalThis.fetch = async (path) => {
    asked.push(path)
    return { status: 200, text: async () => JSON.stringify(path === view.NOTES_STATE_PATH ? NOTES_BODY : PANEL_BODY) }
  }
  try {
    built.exports.apply({
      effect: (work) => work(),
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (name, factory) => factory(), register: () => () => {} },
      // The locale service the web-app bundle always composes (kernel
      // packages/bundle/web-app/cordis.patch.yml: the `locale` row): register hands back a disposer,
      // bind answers with the namespace-bound translate.
      locale: { register: () => () => {}, bind: () => (key) => key },
      get: () => undefined,
    })
  } finally {
    globalThis.fetch = realFetch
  }
  await new Promise((done) => setTimeout(done, 0))
  const marker = globalThis.__dshLinkPanel
  check('A2', marker !== undefined && marker.mounted === true && marker.failed === null
    && JSON.stringify(marker.items) === JSON.stringify([ITEM_A, ITEM_B])
    && JSON.stringify(marker.notes) === JSON.stringify({ count: 1, limits: { maxNotes: 200, maxChars: 100 } })
    && asked.includes(view.PANEL_STATE_PATH) && asked.includes(view.NOTES_STATE_PATH),
  'apply() on the built bundle read ' + show(asked) + ' and filled the marker: ' + show(marker))
  delete globalThis.__dshLinkPanel
} else {
  check('A2', false, 'the bundle could not be loaded: ' + show(built.error))
}

// ---------------------------------------------------------------------- the seam's row, drawn (P12)
// The built half provides 'linkPanel' (the seam other features inject), and the pane body it registers
// DRAWS every declared row: its title, its kind, its source and its own body. The tree comes from a JSX
// stub, so this is a reading of the render function - not a pixel. A pixel needs the pane open in a
// window, which is gate 128's act.
if (built.error === undefined) {
  const tree = loadArtifactTree(ARTIFACT)
  const provided = []
  let seam = null
  let registered = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ status: 200, text: async () => JSON.stringify(PANEL_BODY) })
  try {
    tree.exports.apply({
      effect: (work) => work(),
      provide: (name, value) => { provided.push(name); if (name === 'linkPanel') seam = value; return () => {} },
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (name, factory) => factory(), register: (registration, component) => { registered.push({ registration, component }); return () => {} } },
      locale: { register: () => () => {}, bind: () => copy.t },
      get: () => undefined,
    })
  } finally {
    globalThis.fetch = realFetch
  }
  delete globalThis.__dshLinkPanel
  const pane = registered.find((entry) => entry.registration.name === 'sidebar.right.pane.tab')
  if (tree.error !== undefined) check('P12', false, 'the bundle could not be loaded for a render reading: ' + show(tree.error))
  else if (seam === null) check('P12', false, 'the built half provided no seam at all (provided=' + show(provided) + ')')
  else if (pane === undefined) check('P12', false, 'the built half registered no pane body: ' + show(registered.map((entry) => entry.registration.name)))
  else {
    const drops = [seam.declare({ ...SEAM_PANE }), seam.declare({ ...SEAM_STATUS })]
    const folded = view.withContributions(view.foldArrivals([arrivalOf(view, 'panel', PANEL_ANSWER), arrivalOf(view, 'notes', NOTES_ANSWER)]), seam.entries(), seam.rejected())
    const drawn = elementsOf(tree.render(pane.component, { ...pane.registration.inject(), panelView: folded, t: copy.t }))
    const lineOf = (node) => {
      const inner = elementsOf(node.props.children)
      const cell = (mark) => {
        const found = inner.find((child) => child.props[mark] !== undefined)
        return found === undefined ? null : found.props.children
      }
      return { id: node.props['data-panel-contributed-row'], kind: node.props['data-panel-contributed-kind'], source: node.props['data-panel-contributed-source'], title: cell('data-panel-contributed-title'), body: cell('data-panel-contributed-body') }
    }
    const lines = drawn.filter((node) => node.props['data-panel-contributed-row'] !== undefined).map(lineOf)
    const wanted = SEAM_ROWS.map((row) => ({ id: row.id, kind: row.kind, source: row.source, title: row.title, body: row.body }))
    const empties = elementsOf(tree.render(pane.component, { ...pane.registration.inject(), panelView: view.emptyView(), t: copy.t }))
      .filter((node) => node.props['data-panel-empty'] === 'contributed')
    check('P12', lines.length === 2 && show(lines) === show(wanted) && empties.length === 1 && empties[0].props.children === copy.t('contrib.empty'),
    'the built half provides ' + show(provided) + ' and its pane draws one row per declared contribution, each with its own title, kind, source and body: ' + show(lines) + '; an empty seam draws ' + show(copy.t('contrib.empty')))
    for (const drop of drops) drop()
  }
}
// ------------------------------------------------------- the action row, pressed (R193: P18..P20)
// The seam gained one OPTIONAL field of code - `invoke` - and a row of kind `action` is drawn as a
// BUTTON: one click presses that item's own invoke exactly once, and a throw is caught and drawn ON
// THAT ROW as the provider's own text while the rows around it do not move. The tree comes from the JSX
// stub above, which re-renders on a state change, so the click handler is driven for real and what the
// pane draws afterwards is read back. The invoke this reading counts is the PROVIDER'S OWN function,
// declared into the seam the BUILT HALF provides - not a stub of this reading's own.
if (built.error === undefined) {
  const ACTION_ID = 'gate-r193-action'
  const THROWING_ID = 'gate-r193-action-throws'
  const THROWN_TEXT = 'the browser tab would not open'
  let calls = 0
  const live = loadArtifactTree(ARTIFACT)
  const provided = []
  const registered = []
  let seam = null
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ status: 200, text: async () => JSON.stringify(PANEL_BODY) })
  try {
    live.exports.apply({
      effect: (work) => work(),
      provide: (name, value) => { provided.push(name); if (name === 'linkPanel') seam = value; return () => {} },
      sidebarRightTabs: { register: () => () => {} },
      slots: { inject: (name, factory) => factory(), register: (registration, component) => { registered.push({ registration, component }); return () => {} } },
      locale: { register: () => () => {}, bind: () => copy.t },
      get: () => undefined,
    })
  } finally {
    globalThis.fetch = realFetch
  }
  delete globalThis.__dshLinkPanel
  const pane = registered.find((entry) => entry.registration.name === 'sidebar.right.pane.tab')
  if (live.error !== undefined) check('P18', false, 'the bundle could not be loaded for the press reading: ' + show(live.error))
  else if (seam === null) check('P18', false, 'the built half provided no seam, so no action can be declared: provided=' + show(provided))
  else if (pane === undefined) check('P18', false, 'the built half registered no pane body: ' + show(registered.map((entry) => entry.registration.name)))
  else {
    const drops = [
      seam.declare({ id: ACTION_ID, kind: 'action', title: 'OPEN THE BROWSER PANEL', source: 'dsh-browser', order: 30, invoke: () => { calls += 1 } }),
      seam.declare({ id: THROWING_ID, kind: 'action', title: 'AN ACTION THAT FAILS', source: 'dsh-browser', order: 31, invoke: () => { throw new Error(THROWN_TEXT) } }),
      seam.declare({ id: 'gate-r193-blind-action', kind: 'action', title: 'AN ACTION NOBODY CAN PRESS', source: 'dsh-browser', order: 32 }),
      seam.declare({ ...SEAM_STATUS }),
    ]
    // The fourth declaration is an action with no invoke at all: the BUILT seam must refuse it through
    // the passthrough channel (code null, its own text) and the pane must draw a HOLE where a button
    // would have been - a row nobody can press is not a row drawn as if it could be.
    const blind = seam.rejected().find((row) => row.id === 'gate-r193-blind-action') ?? null
    const mounted = seam.entries().length
    const mount = () => {
      const folded = view.withContributions(view.foldArrivals([arrivalOf(view, 'panel', PANEL_ANSWER), arrivalOf(view, 'notes', NOTES_ANSWER)]), seam.entries(), seam.rejected())
      return live.render(pane.component, { ...pane.registration.inject(), panelView: folded, t: copy.t })
    }
    /** Every contributed row a tree draws, as the cells a reader can hold. */
    const rowsOf = (tree) => elementsOf(tree).filter((node) => node.props['data-panel-contributed-row'] !== undefined)
    const readingOf = (node) => {
      const inner = elementsOf(node.props.children)
      const cell = (mark) => {
        const found = inner.find((child) => child.props[mark] !== undefined)
        return found === undefined ? null : { type: found.type, children: found.props.children, carries: found.props[mark], onClick: found.props.onClick }
      }
      return {
        id: node.props['data-panel-contributed-row'], kind: node.props['data-panel-contributed-kind'],
        source: node.props['data-panel-contributed-source'], hasInvoke: node.props['data-panel-contributed-has-invoke'],
        title: cell('data-panel-contributed-title'), body: cell('data-panel-contributed-body'), error: cell('data-panel-contributed-error'),
      }
    }
    const drawnRows = rowsOf(mount()).map(readingOf)
    const actionRow = drawnRows.find((row) => row.id === ACTION_ID)
    const throwingRow = drawnRows.find((row) => row.id === THROWING_ID)
    const statusRow = drawnRows.find((row) => row.id === SEAM_STATUS.id)
    const isButton = (row) => row !== undefined && row.title !== null && row.title.type === 'button'
    check('P18', drawnRows.length === 3 && mounted === 3 && seam.rejected().length === 1
      && blind !== null && blind.code === null && blind.detail.includes('kind action needs a callable invoke (got undefined)')
      && drawnRows.every((row) => row.id !== 'gate-r193-blind-action')
      && isButton(actionRow) && actionRow.kind === 'action' && actionRow.hasInvoke === 'true'
      && actionRow.title.children === 'OPEN THE BROWSER PANEL' && typeof actionRow.title.onClick === 'function'
      && isButton(throwingRow) && throwingRow.kind === 'action'
      && statusRow !== undefined && statusRow.kind === 'status' && statusRow.hasInvoke === 'false'
      && statusRow.title !== null && statusRow.title.type === 'span' && statusRow.title.onClick === undefined
      && actionRow.error === null && throwingRow.error === null && statusRow.error === null,
    'a row of kind action is drawn as a BUTTON labelled with the provider own title, its kind and its hasInvoke are readable on the row, a reading row is NOT a button, an action nobody can press is a refused HOLE rather than a button, and an unpressed row shows no failure: '
      + show({ rows: drawnRows.map((row) => [row.id, row.kind, row.title === null ? null : row.title.type, row.hasInvoke]), refused: blind }))

    // P19 ONE CLICK IS ONE CALL of the provider's own invoke, and a press that held leaves nothing behind.
    let clickThrew = null
    try { actionRow.title.onClick() } catch (error) { clickThrew = error }
    const afterClick = rowsOf(live.drawn()).map(readingOf)
    const clickedRow = afterClick.find((row) => row.id === ACTION_ID)
    check('P19', clickThrew === null && calls === 1 && clickedRow !== undefined && clickedRow.error === null
      && show(afterClick.filter((row) => row.id !== ACTION_ID)) === show(drawnRows.filter((row) => row.id !== ACTION_ID)),
    'one click called the provider own invoke EXACTLY once (' + String(calls) + ' call(s)), drew nothing on that row, and left every other row byte-identical: '
      + show({ calls, clicked: clickedRow === undefined ? null : [clickedRow.id, clickedRow.error] }))

    // P20 THE THROW IS CONTAINED, ON THAT ROW, IN THE PROVIDER'S OWN WORDS - and the rows around it do
    //     not move. This is the containment the pane promises: nothing escapes the click handler, the
    //     failure is named on the row it belongs to, and the text is the original one, not a summary.
    const before = rowsOf(live.drawn()).map(readingOf)
    const callsBefore = calls
    const beforeThrow = before.find((row) => row.id === THROWING_ID)
    let escaped = null
    try { beforeThrow.title.onClick() } catch (error) { escaped = error }
    const after = rowsOf(live.drawn()).map(readingOf)
    const failedRow = after.find((row) => row.id === THROWING_ID)
    const wantedLine = copy.t('copy.format.line', { code: copy.t('refusal.noCode'), detail: THROWN_TEXT })
    check('P20', escaped === null && calls === callsBefore
      && failedRow !== undefined && failedRow.error !== null && failedRow.error.children === wantedLine
      && show(after.filter((row) => row.id !== THROWING_ID)) === show(before.filter((row) => row.id !== THROWING_ID)),
    'the invoke threw, nothing escaped the click handler, the provider own text is drawn ON THAT ROW, and every other row is byte-identical: '
      + show({ escaped: escaped === null ? null : String(escaped), calls, drawn: failedRow === undefined || failedRow.error === null ? null : failedRow.error.children, expected: wantedLine }))
    for (const drop of drops) drop()
  }
}
// ------------------------------------------------------- the neighbouring half's frozen paths
// A byte reading of the ledger half's built artifact: its two exported route paths are the two strings
// this half reads. What it does NOT prove: that a route is bound or that an answer has the consumed
// fields — that is the live window's reading (gates 123/124), and this half's own readers are pinned by
// V1..V16 above against the shape the contract froze.
const NOTES_ARTIFACT = join(PROJECT, 'plugins', 'dsh-link-notes', 'lib', 'index.js')
const unmeasured = []
if (existsSync(NOTES_ARTIFACT) === false) {
  unmeasured.push('X1')
  console.log('  -?-  X1 — NOT MEASURED: ' + NOTES_ARTIFACT + ' is not built')
} else {
  const bytes = readFileSync(NOTES_ARTIFACT, 'utf8')
  check('X1', bytes.includes(JSON.stringify(view.NOTES_STATE_PATH)) && bytes.includes(JSON.stringify(view.NOTES_ADD_PATH)),
    'the ledger half\u2019s built artifact carries ' + show([view.NOTES_STATE_PATH, view.NOTES_ADD_PATH]))
}

rows.push(...results.splice(0))
const failed = rows.filter((row) => !row.ok)
console.log('')
console.log(String(rows.length) + ' readings, ' + String(rows.length - failed.length) + ' held, ' + String(failed.length) + ' failed'
  + (unmeasured.length === 0 ? '' : ', ' + String(unmeasured.length) + ' not measured: ' + show(unmeasured)))

if (SELF_ATTACK === false) {
  process.exitCode = failed.length === 0 ? 0 : 1
} else {
  // ------------------------------------------------------------------- the declared mutants
  const MUTANTS = {
    'panel-lenient': {
      from: "    return shapeFailure(subject, 'declared.visible must be an array (got ' + show(visible) + ')')",
      to: '    return { ok: true, items: [], refused: [], registry: null }',
      expect: ['V4', 'V9'],
    },
    'notes-lenient': {
      from: "    return shapeFailure(subject, 'notes must be an array (got ' + show(list) + '; top-level keys: ' + keysOf(answer.body) + ')')",
      to: '    return { ok: true, rows: [], limits: null, counts: null }',
      expect: ['V7'],
    },
  }
  const source = readFileSync(join(PACKAGE, 'src', 'client', 'view.ts'), 'utf8')
  mkdirSync(SCRATCH, { recursive: true })
  let exactAll = true
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    if (source.includes(mutant.from) === false) {
      notMeasured('the mutant anchor for ' + name + ' is not in view.ts any more: ' + show(mutant.from))
    }
    const staged = join(SCRATCH, 'mutant-' + name + '.ts')
    writeFileSync(staged, source.split(mutant.from).join(mutant.to))
    const attacked = await import(pathToFileURL(staged).href)
    const attackedFailed = pureBattery(attacked, 'V').filter((row) => !row.ok).map((row) => row.id).sort()
    const declared = [...mutant.expect].sort()
    const exact = JSON.stringify(attackedFailed) === JSON.stringify(declared)
    exactAll = exactAll && exact && attackedFailed.length > 0
    console.log('')
    console.log('self-attack ' + name + ': ' + show(mutant.from) + '  ->  ' + show(mutant.to))
    console.log('  moved (failed readings): ' + show(attackedFailed))
    console.log('  declared:                ' + show(declared))
    const line = pureBattery(attacked, 'V').filter((row) => !row.ok).map((row) => row.id + ': ' + row.detail)
    for (const entry of line) console.log('  ' + entry)
  }
  // --------------------------------------------------- the three paired counter-proofs (R190 2.2)
  // Each stages a copy of the browser half under .tmp/r190-p1 and demands that EXACTLY the declared
  // readings move. The declared sets are what the rules say must move; the run prints the observed
  // ones, so a rule that cannot fail (or a rule that fails for the wrong reason) is visible.
  const COPY_MUTANTS = [
    {
      name: 'zh-key-deleted',
      why: 'a key deleted from zh: the two key sets are no longer equal (C1)',
      expect: ['C1'],
      edits: [[join('src', 'client', 'locales.ts'), "  'notes.empty': '账本里没有便条',\n", '']],
    },
    {
      name: 'copy-hardcoded',
      why: 'the items empty state written into the JSX instead of read from the dictionary: a word is drawn straight after a tag (C5) and the key is no longer used (C6)',
      expect: ['C5', 'C6'],
      edits: [[join('src', 'client', 'index.tsx'),
        '? <li className="dsh-link-panel-empty" data-panel-empty="items">{t(\'items.empty\')}</li>',
        '? <li className="dsh-link-panel-empty" data-panel-empty="items">没有条目</li>']],
    },
    {
      name: 'brand-glyph',
      why: 'the first-party glyph replaced by an inline 36x36 fixed-fill SVG: the icon rule reddens (C7) and the glyph colours and sizes are spelled out as literals (C5)',
      expect: ['C5', 'C7'],
      edits: [
        [join('src', 'client', 'index.tsx'), "import { IconFlatListOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'\n", ''],
        [join('src', 'client', 'index.tsx'), 'const PANEL_GUIDE_ICON = IconFlatListOutlineRegular',
          'const PANEL_GUIDE_ICON = () => <svg width="36" height="36" viewBox="0 0 36 36" fill="#7c3aed"><rect width="36" height="36" /></svg>'],
      ],
    },
  ]
  let copyExact = true
  for (const mutant of COPY_MUTANTS) {
    const stagedRoot = join(SCRATCH_R190, mutant.name)
    rmSync(stagedRoot, { recursive: true, force: true })
    mkdirSync(join(stagedRoot, 'src'), { recursive: true })
    cpSync(join(PACKAGE, 'src', 'client'), join(stagedRoot, 'src', 'client'), { recursive: true })
    const applied = []
    for (const [relative, from, to] of mutant.edits) {
      const path = join(stagedRoot, relative)
      const before = readFileSync(path, 'utf8')
      if (before.includes(from) === false) notMeasured('the anchor for ' + mutant.name + ' is not in ' + relative + ' any more: ' + show(from))
      writeFileSync(path, before.split(from).join(to))
      applied.push(relative)
    }
    const attackedRows = await copyBattery(stagedRoot, 'C')
    const moved = attackedRows.filter((row) => !row.ok).map((row) => row.id).sort()
    const declared = [...mutant.expect].sort()
    const exact = show(moved) === show(declared) && moved.length > 0
    copyExact = copyExact && exact
    console.log('')
    console.log('counter-proof ' + mutant.name + ': ' + mutant.why)
    console.log('  instrument moved: ' + String(applied.length) + ' edit(s) in ' + show(applied))
    console.log('  moved (failed readings): ' + show(moved))
    console.log('  declared:                ' + show(declared) + '  exact=' + String(exact))
    for (const row of attackedRows.filter((entry) => !entry.ok)) console.log('  ' + row.id + ': ' + row.detail)
  }
  // ------------------------------------------- the three seam counter-proofs this round exists for
  // Each stages a copy of the browser half under .tmp/r192-p1 and demands that EXACTLY the declared
  // readings move: the closed-set gate removed (an unknown kind is drawn instead of refused), a claim
  // table in which the later declaration for an id replaces the earlier one, and the marker's items
  // made to carry the seam's rows as well — the three failures R192-contract.md §1.1, §1.3 and §2
  // name by hand.
  const SEAM_MUTANTS = [
    {
      name: 'seam-kind-not-refused',
      why: 'the closed-set gate removed: an unknown kind is drawn as itself instead of being refused by name. The parity reading moves with it, which is what running the host and the seam over one fixture buys',
      from: 'if (!KIND_SET.has(row.kind)) return CONTRIBUTION_REJECT.UNKNOWN_KIND',
      to: 'if (!KIND_SET.has(row.kind)) return null',
      expect: ['P2', 'P8'],
    },
    {
      name: 'seam-later-claimant-wins',
      why: 'a later declaration for an id already claimed replaces the earlier one: arrival order decides what the panel shows',
      from: 'claims.set(key, definition)\n      announce()',
      to: 'claims.set(key, definition)\n      const idOf = (value) => (value !== null && typeof value === \'object\' && typeof value.id === \'string\' ? value.id : null)\n      for (const [other, held] of [...claims]) if (other !== key && idOf(held) !== null && idOf(held) === idOf(definition)) claims.delete(other)\n      announce()',
      expect: ['P1'],
    },
    {
      name: 'seam-merges-contributions-into-items',
      in: 'view.ts',
      why: 'the one thing R192-contract.md section 1.3 forbids, and the fact gate 124 byte-compares: the marker items is made to carry the seam rows as well, so the two sources the panel keeps apart are merged into the one field a live reader holds to the real route (measured by P10, which reads the marker of the edited module directly: P11 drives the tree own loader, whose marker is not built by the edited copy)',
      from: '    contributed: view.contributed,\n    failed: null,',
      to: '    contributed: view.contributed,\n    items: view.items.concat(view.contributed),\n    failed: null,',
      expect: ['P10'],
    },
    {
      name: 'seam-presses-an-action-twice',
      why: 'the action field pressed twice: the declaration\'s own invoke is called two times for one press, so "one click is one call" is gone even though the row still appears and still answers ok',
      from: '          (invoked as (this: unknown) => unknown).call(claim)',
      to: '          (invoked as (this: unknown) => unknown).call(claim);\n          (invoked as (this: unknown) => unknown).call(claim);',
      expect: ['P15'],
    },
    {
      name: 'seam-lets-the-invoke-throw-through',
      why: 'the containment removed: what the provider threw leaves press() instead of travelling back as its own text, so the row a person pressed can never show why nothing happened',
      from: '        } catch (error) {',
      to: '        } catch (error) { throw error;',
      expect: ['P16'],
    },
    {
      name: 'seam-admits-an-action-with-no-invoke',
      why: 'the closed requirement opened: an action carrying no callable invoke is drawn as if it were pressable, instead of being refused through the passthrough channel by its own text',
      from: "  if (carried.kind === 'action' && invoke === null) {",
      to: '  if (false) {',
      expect: ['P14'],
    },
  ]
  let seamExact = true
  for (const mutant of SEAM_MUTANTS) {
    const stagedRoot = join(SCRATCH_P1, mutant.name)
    rmSync(stagedRoot, { recursive: true, force: true })
    mkdirSync(join(stagedRoot, 'src'), { recursive: true })
    cpSync(join(PACKAGE, 'src', 'client'), join(stagedRoot, 'src', 'client'), { recursive: true })
    const edited = join(stagedRoot, 'src', 'client', mutant.in === undefined ? 'contributions.ts' : mutant.in)
    const before = readFileSync(edited, 'utf8')
    if (before.includes(mutant.from) === false) notMeasured('the mutant anchor for ' + mutant.name + ' is not in ' + (mutant.in === undefined ? 'contributions.ts' : mutant.in) + ' any more: ' + show(mutant.from))
    writeFileSync(edited, before.split(mutant.from).join(mutant.to))
    const stagedContrib = await import(pathToFileURL(join(stagedRoot, 'src', 'client', 'contributions.ts')).href)
    const stagedView = await import(pathToFileURL(join(stagedRoot, 'src', 'client', 'view.ts')).href)
    // The battery runs over the module the mutant edited; every other module stays the tree's own.
    const attackedRows = await seamBattery(mutant.in === 'view.ts' ? contributions : stagedContrib, mutant.in === 'view.ts' ? stagedView : view, load, host)
    const moved = attackedRows.filter((row) => !row.ok).map((row) => row.id).sort()
    const declared = [...mutant.expect].sort()
    const exact = show(moved) === show(declared) && moved.length > 0
    seamExact = seamExact && exact
    console.log('')
    console.log('seam counter-proof ' + mutant.name + ': ' + mutant.why)
    console.log('  mutation: ' + mutant.from + '  ->  ' + mutant.to)
    console.log('  moved (failed readings): ' + show(moved))
    console.log('  declared:                ' + show(declared) + '  exact=' + String(exact))
    for (const row of attackedRows.filter((entry) => !entry.ok)) console.log('  ' + row.id + ': ' + row.detail)
  }
  console.log('')
  console.log('pristine held: ' + String(failed.length === 0) + '; every mutant moved exactly its declared set: ' + String(exactAll)
    + '; every counter-proof moved exactly its declared set: ' + String(copyExact && seamExact))
  process.exitCode = failed.length === 0 && exactAll && copyExact && seamExact ? 0 : 1
}
