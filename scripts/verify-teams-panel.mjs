#!/usr/bin/env node
/**
 * Gate (R179-E) — does the RIGHT RAIL really show the collaboration bus?
 *
 * Subject: the R179 plugin "dsh-link-teams" (task-4, handoff docs/handoff/R179-D-teams-panel.md):
 * ONE read-only GET route plus one right-rail tab type. Written by a verifier who did not write the
 * plugin, from the payload contract in that handoff and from the live client — never from the source
 * comments of the thing it judges.
 *
 * Eight readings, each of which can fail on its own evidence:
 *
 *   1-route-numbers-come-from-the-ledger   GET /api/dsh-link-teams/state on the shell port answers 200 with
 *                                          ok=true, and ledger.records equals the row count this gate counts
 *                                          ITSELF in <ledger.directory>/control.jsonl. The stream must be the
 *                                          TAIL of that file: its length is min(40, records), every seq it names
 *                                          exists in the file, and the number of file rows OUTSIDE the stream
 *                                          equals records - stream.length. A payload that invents its own
 *                                          arithmetic cannot pass this.
 *   2-route-refuses-writes-by-name         POST to the same path is 405 with error.code === 'METHOD_NOT_ALLOWED'
 *                                          (named, not a bare 405), PUT and DELETE likewise, and the same path
 *                                          answered 200 to GET in this very run — the paired control, so a route
 *                                          that is simply missing cannot pass by refusing.
 *   3-absent-capability-branch-is-named     The 503 + 'NO_CAPABILITY' branch is the whole point of the surface
 *                                          (an empty board and no bus must not look alike), but the LIVE client
 *                                          has linkCollab mounted and unmounting it is a product change this
 *                                          gate may not make. It is therefore measured on the SHIPPED artifact in
 *                                          this process: apply() is driven with a ctx that publishes webServer
 *                                          and no linkCollab, the handler is called, and the answer must be
 *                                          503 + 'NO_CAPABILITY'; a ctx whose linkCollab publishes no state()
 *                                          reader must answer 503 + 'NO_STATE_READER'; and the SAME harness with
 *                                          a linkCollab stand-in must answer 200 — otherwise the 503s would just
 *                                          be this gate's own world, not a branch. What this reading does NOT
 *                                          show is the live route answering 503; the live route is readings 1-2.
 *   4-pane-shows-the-live-ledger           Windowed and driven through CDP: the right rail is opened if it is
 *                                          collapsed, the rail's own + control is clicked, the link-teams guide
 *                                          entry is clicked, and then a tab whose title contains the pane title
 *                                          must exist, its pane body must be non-0x0, its text must carry the three
 *                                          section words, AND it must carry the ledger directory path that THIS
 *                                          world's payload reports — so a pane rendering a canned document fails.
 *   5-the-worlds-declarations-are-the-panes-declarations   The WORLD decides what is asserted, and the gate
 *                                          names the world it found. No declaration row in the file and none served by
 *                                          the route the pane polls => the pane must SAY so by name ('未声明能力',
 *                                          '树还建不起来') and paint no declared tree. The route serves declarations =>
 *                                          the pane must DRAW them: every served capability of a member the ledger
 *                                          names appears in the pane text, and a served team brings 团队树（分形）
 *                                          and its first-8-character id with it — compared against the ROUTE, never
 *                                          against a fixture, so a canned document cannot pass. Declaration rows in the
 *                                          file that the route serves NONE of => FAILURE, named, with the mechanism:
 *                                          the pane is a view of the kernel's in-memory fold, so a row written into
 *                                          control.jsonl by anything but the live kernel stays invisible until the
 *                                          ledger is re-opened.
 *   6-pane-numbers-equal-the-ledger        The pane's own chips ('记录 N', '成员 M', '任务 T') must equal the
 *                                          ledger this gate counted around the pane read (both route snapshots and
 *                                          both file snapshots), so the visible numbers are the live ledger's and
 *                                          not a stale document served from somewhere else.
 *   7-restored                             The rail is put back the way this gate FOUND it: the tab that was
 *                                          selected when it started, and the column collapsed again if this gate
 *                                          was the one that expanded it. R181-C measured what leaving it costs -
 *                                          prepare ACTIVE (anchor 804,86 612x790, selectedTab=浏览器) -> run this
 *                                          gate -> the world reads AWAY with selectedTab=智能体团队 and NO
 *                                          [data-dsh-link-surface] anchor, so the gates that read the anchor
 *                                          (panel-surface, sidebar-follow, window-transition) were judging a
 *                                          world this gate had created. The entry state is whatever was measured
 *                                          BEFORE this gate touched a control, never a state it would prefer;
 *                                          and when the entry had no selected tab to put back, this reading says
 *                                          so (not measured) instead of passing.
 *   8-peers-card-is-drawn                  The world decides whether there is a card to judge at all: no
 *                                          peer/state row in the fold the route serves => the pane has nothing
 *                                          to draw, and this reading says NOT MEASURED by name rather than
 *                                          passing over a card it never saw. Rows served => the pane must DRAW
 *                                          them: the card title, one arrow row per pair (shortId(from) + ' → ' +
 *                                          shortId(to), the first 8 characters, computed from the ROUTE and
 *                                          never hard-coded) and that pair's own state chip
 *                                          (granted/requested/denied). The chip is read INSIDE the card's slice
 *                                          of the pane text, because the 交流 list prints the same state for the
 *                                          same record (client.js:490): a search over the whole pane could not
 *                                          tell the card's chip from the stream's copy of it.
 *
 * Self-attack: --self-attack measures the live world once and then mutates THAT world in memory, one mutation per
 * reading, asserting each mutant reddens exactly its declared reading and nothing else, plus a control mutant
 * that changes nothing. It prints 声明集 == 观测集 for every mutant. Mutating the measured world rather than a
 * hand-written fixture is deliberate: a fixture only proves the judge agrees with itself.
 *
 * Budget: this gate prints its elapsed time and is expected to finish inside 60s. It never restarts the client
 * and never takes the panel lease: it only drives the rail's own tab strip in the main page (the lease serialises
 * the NATIVE browser panel, which this gate does not open, place or close), and it puts the tab it found
 * selected back before it exits (reading 7) - the suite runs gates one after another, so the world a gate
 * leaves behind is the next gate's premise.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 a named SKIP (no shell, no CDP, the pane could not be
 * reached): a reading that could not be measured is never a pass. When the pane cannot be measured but the
 * other readings could and one of THEM failed, the exit is 1 — a measured red outranks a skip.
 *
 * Usage: node scripts/verify-teams-panel.mjs [--port 31761] [--kernel-port 31760] [--cdp-port 9222] [--self-attack]
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { requestJson } from './lib/http.mjs'
import { COLUMN_PROBE, connect as connectCdp } from './cdp-drive.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const PORT = Number(option('--port', '31761'))
const KERNEL_PORT = Number(option('--kernel-port', '31760'))
const CDP_PORT = Number(option('--cdp-port', '9222'))
const SELF_ATTACK = has('--self-attack')

const ROUTE = '/api/dsh-link-teams/state'
const ARTIFACT = join(PROJECT, 'plugins', 'dsh-link-teams', 'lib', 'index.js')
const LEDGER_FILE = 'control.jsonl'
/** The pane title, its tab kind and the words the pane must carry (from the D handoff, section 3). */
const TAB_TITLE = '\u667a\u80fd\u4f53\u56e2\u961f'
const TAB_KIND = 'link-teams'
const PANE_WORDS = ['\u4efb\u52a1\u677f', '\u6210\u5458', '\u4ea4\u6d41']
const EMPTY_WORDS = ['\u672a\u58f0\u660e\u80fd\u529b', '\u6811\u8fd8\u5efa\u4e0d\u8d77\u6765']
const TREE_HEADER = '\u56e2\u961f\u6811\uff08\u5206\u5f62\uff09'
const RAIL_OPEN_LABEL = '\u6253\u5f00\u53f3\u4fa7\u8fb9\u680f'
const RAIL_CLOSE_LABEL = '\u6536\u8d77\u53f3\u4fa7\u8fb9\u680f'
/** The shipped stream limit (D handoff: the pane's 交流 list carries the latest 40 records). */
const STREAM_LIMIT = 40
/** The kinds whose absence is what reading 5 is about. */
const DECLARATION_KINDS = ['team/state', 'capability/state']
/** The handshake card reading 8 is about: its title, and the arrow between the two ids (:441, :446). */
const PEERS_TITLE = 'Lead \u4e4b\u95f4\u7684\u63e1\u624b'
const PEERS_ARROW = ' \u2192 '
/**
 * Where that card's slice of the pane text ends: the 交流 card follows it. The bound matters because the
 * 交流 list prints the same state for the same record, so "the pane says granted somewhere" is not the chip.
 */
const PEERS_CARD_END = '\u4ea4\u6d41\uff08'

const show = (value) => JSON.stringify(value === undefined ? null : value)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const PROBLEM_SEPARATOR = '; '

// ---------------------------------------------------------------------------
// Measurement: the ledger file, counted here rather than trusted from the payload
// ---------------------------------------------------------------------------

/** Read and count <directory>/control.jsonl. The gate's own arithmetic, not the plugin's. */
const readLedger = (directory) => {
  const path = join(String(directory), LEDGER_FILE)
  try {
    const text = readFileSync(path, 'utf8')
    const rows = text.split(/\r?\n/).filter((line) => line.trim() !== '')
    const parsed = rows.map((line) => { try { return JSON.parse(line) } catch { return null } })
    const seqs = []
    const kinds = {}
    for (const row of parsed) {
      if (row === null) { kinds['(unreadable)'] = (kinds['(unreadable)'] || 0) + 1; continue }
      if (typeof row.seq === 'number') seqs.push(row.seq)
      const kind = typeof row.kind === 'string' ? row.kind : '(no kind)'
      kinds[kind] = (kinds[kind] || 0) + 1
    }
    // `parsed` keeps the row objects themselves: a reading that must compare the file with the ROUTE (which
    // serves ids, not counts) can only do that from the rows, and re-reading the file behind the snapshot
    // would compare two different moments.
    return { ok: true, path, rows: rows.length, parsed, seqs, kinds, maxSeq: seqs.length === 0 ? null : Math.max.apply(null, seqs) }
  } catch (error) {
    return { ok: false, path, rows: null, seqs: [], kinds: {}, maxSeq: null, code: error && error.code ? error.code : null, message: String(error && error.message ? error.message : error) }
  }
}

const readRoute = async (port) => {
  try {
    const reply = await requestJson('http://127.0.0.1:' + String(port) + ROUTE, { method: 'GET' })
    let body = null
    try { body = JSON.parse(reply.text) } catch { body = null }
    return { port, status: reply.status, body, textLength: String(reply.text || '').length }
  } catch (error) {
    return { port, status: 0, body: null, textLength: 0, transport: String(error && error.message ? error.message : error) }
  }
}

const writeVerb = async (port, method) => {
  try {
    const reply = await requestJson('http://127.0.0.1:' + String(port) + ROUTE, { method, body: {} })
    let body = null
    try { body = JSON.parse(reply.text) } catch { body = null }
    return { method, status: reply.status, code: body && body.error ? body.error.code : null, message: body && body.error ? body.error.message : null }
  } catch (error) {
    return { method, status: 0, code: null, message: String(error && error.message ? error.message : error) }
  }
}

// ---------------------------------------------------------------------------
// Measurement: the capability-absent branch of the SHIPPED artifact, in this process
// ---------------------------------------------------------------------------

const emptyResponse = () => ({
  statusCode: 0,
  headers: {},
  setHeader(name, value) { this.headers[name] = value },
  end(text) { this.text = String(text === undefined ? '' : text) },
})

/** Drive one ctx shape through the real apply() and call the route it registers. */
const driveArtifact = async (collab) => {
  const captured = []
  const server = { register(route) { captured.push(route); return () => { /* the route is disposed with the row */ } } }
  const ctx = {
    get: (name) => (name === 'webServer' ? server : name === 'linkCollab' ? collab : undefined),
    inject: () => { /* the route is already bound in this order on purpose */ },
    effect: (fn) => { try { return fn() } catch { return undefined } },
  }
  const quiet = { log: console.log, error: console.error }
  let module = null
  try {
    // The plugin announces itself on apply(); the gate's own output must stay a verdict, so it is muted here.
    console.log = () => {}
    console.error = () => {}
    module = await import(pathToFileURL(ARTIFACT).href)
    const plugin = module.default === undefined ? module : module.default
    plugin.apply(ctx, {})
  } catch (error) {
    return { bound: false, error: String(error && error.message ? error.message : error) }
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  const route = captured[0]
  if (route === undefined) return { bound: false, error: 'apply() registered no route' }
  const answers = {}
  for (const method of ['GET', 'POST']) {
    const res = emptyResponse()
    await route.handler({ method }, res)
    let body = null
    try { body = JSON.parse(res.text) } catch { body = null }
    answers[method] = {
      status: res.statusCode,
      ok: body !== null && body.ok !== undefined ? body.ok : null,
      code: body !== null && body.error !== undefined ? body.error.code : null,
      records: body !== null && body.ledger !== undefined ? body.ledger.records : null,
      path: body !== null && body.path !== undefined ? body.path : null,
    }
  }
  return { bound: true, path: route.path, kind: route.kind, get: answers.GET, post: answers.POST }
}

const STAND_IN_STATE = {
  counts: { folded: 0, unknown: 0, tasks: 0, members: 0, teams: 0, unattributed: 0 },
  through: 0,
  teams: { teams: [], children: {}, roots: [], orphans: [], cycles: [] },
  tasks: [], members: [],
  registry: { members: [], byCapability: {}, declarations: 0, malformed: 0 },
  liveness: { lastHeartbeat: {}, beats: 0, malformed: 0 },
  peers: { pairs: [] },
  board: {},
}
const STAND_IN_COLLAB = {
  state: () => STAND_IN_STATE,
  log: { replay: () => [], directory: '(stand-in)', writer: 'local', instance: 'stand-in', lastSeq: null, damage: null },
}

// ---------------------------------------------------------------------------
// Measurement: the pane, through CDP, the way a user gets there
//
// The probes are real functions shipped into the page through toString(), the way cdp-drive.mjs does it:
// the labels are Chinese and the expressions are full of quotes, and quoting an expression by hand is how a
// probe silently stops matching.
// ---------------------------------------------------------------------------

/** One DOM read of the rail: the column, the tab chips, the + control, the guide entries. */
function railProbe(title) {
  const box = (node) => { const b = node.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
  const want = String(title)
  const col = document.querySelector('[data-rightbar-col]')
  const tabs = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]')).map((tab) => {
    const node = tab.querySelector('[data-dockkit-tab-title]')
    return { tab: tab.getAttribute('data-dockkit-tab'), title: node === null ? null : node.textContent, sel: tab.getAttribute('aria-selected') === 'true', box: box(tab) }
  })
  const add = document.querySelector('[data-dockkit-add-tab]')
  const entries = Array.from(document.querySelectorAll('[data-sidebar-right-guide-entry]')).map((entry) => ({ kind: entry.getAttribute('data-sidebar-right-guide-entry'), box: box(entry) }))
  return JSON.stringify({
    column: col === null ? null : box(col),
    tabs,
    add: add === null ? null : box(add),
    entries,
    titledSelected: tabs.filter((tab) => String(tab.title || '').includes(want) && tab.sel === true).length,
    titled: tabs.filter((tab) => String(tab.title || '').includes(want)).map((tab) => tab.tab),
  })
}

/** One DOM read of the pane body of the tab whose title contains the pane title. */
function paneProbe(title) {
  const box = (node) => { const b = node.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
  const want = String(title)
  const tabs = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]'))
  const titles = tabs.map((tab) => { const node = tab.querySelector('[data-dockkit-tab-title]'); return node === null ? null : node.textContent })
  const match = tabs.filter((tab, index) => titles[index] !== null && String(titles[index]).includes(want))
  const selected = match.filter((tab) => tab.getAttribute('aria-selected') === 'true')[0] || null
  const target = selected === null ? (match[0] || null) : selected
  const id = target === null ? null : target.getAttribute('data-dockkit-tab')
  const content = id === null ? null : document.querySelector('[data-dockkit-content="' + id + '"]')
  return JSON.stringify({
    found: match.length > 0,
    selected: selected !== null,
    tab: id,
    titles: titles.filter((value) => value !== null),
    box: content === null ? null : box(content),
    text: content === null ? null : content.innerText,
  })
}

const RAIL_STATE = '(' + railProbe.toString() + ')(' + JSON.stringify(TAB_TITLE) + ')'
const PANE_READ = '(' + paneProbe.toString() + ')(' + JSON.stringify(TAB_TITLE) + ')'

/**
 * Where the pane's own folds are, so this gate can open them.
 *
 * The pane folds the teams that only task/member rows name behind a <details> (R283), and a CLOSED <details>'s content
 * does not exist as far as innerText is concerned (R291 measured exactly that about this pane). Reading 5 compares the
 * pane with the route, so a fact the comparison needs is never left folded away: the gate opens the pane's folds, one
 * click a reader can make, and says in the reading that it did.
 */
function paneFoldProbe(title) {
  const box = (node) => { const b = node.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
  const want = String(title)
  const tabs = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]'))
  const titles = tabs.map((tab) => { const node = tab.querySelector('[data-dockkit-tab-title]'); return node === null ? null : node.textContent })
  const match = tabs.filter((tab, index) => titles[index] !== null && String(titles[index]).includes(want))
  const selected = match.filter((tab) => tab.getAttribute('aria-selected') === 'true')[0] || null
  const target = selected === null ? (match[0] || null) : selected
  const id = target === null ? null : target.getAttribute('data-dockkit-tab')
  const content = id === null ? null : document.querySelector('[data-dockkit-content="' + id + '"]')
  if (content === null) return JSON.stringify([])
  return JSON.stringify(Array.from(content.querySelectorAll('details')).map((fold) => {
    const summary = fold.querySelector('summary')
    return { open: fold.open === true, box: summary === null ? null : box(summary) }
  }))
}
const PANE_FOLDS = '(' + paneFoldProbe.toString() + ')(' + JSON.stringify(TAB_TITLE) + ')'

const centre = (box) => ({ x: box[0] + Math.round(box[2] / 2), y: box[1] + Math.round(box[3] / 2) })

/**
 * Open every closed fold the pane has, the way a reader would, and answer how many were opened.
 * @param cdp - the CDP driver this gate was handed.
 * @param progress - the measurement log the gate prints.
 * @returns how many folds this opened.
 */
async function openPaneFolds(cdp, progress) {
  const seen = await cdp.json(PANE_FOLDS)
  const folds = seen.ok === true && Array.isArray(seen.value) ? seen.value : []
  let opened = 0
  for (const fold of folds) {
    if (fold.open === true || fold.box === null) continue
    await cdp.click(centre(fold.box))
    opened += 1
  }
  if (opened > 0) {
    await sleep(400)
    progress.push('opened ' + String(opened) + ' closed fold(s) in the pane before reading it (a closed <details> is not in innerText, R291)')
  }
  return opened
}

/** The pane anchor and the column, read as the RESTORE's result (R181-D, C-3). */
function afterProbe() {
  const box = (node) => { const b = node.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
  const surface = document.querySelector('[data-dsh-link-surface="true"]')
  const col = document.querySelector('[data-rightbar-col]')
  return JSON.stringify({
    surfaceCount: document.querySelectorAll('[data-dsh-link-surface]').length,
    anchor: surface === null ? null : box(surface),
    column: col === null ? null : box(col),
  })
}
const AFTER_READ = '(' + afterProbe.toString() + ')()'

/**
 * R181-D (C-3): put the rail back the way this gate FOUND it, as a reading and not as housekeeping. This gate
 * selects its own pane (智能体团队); until now it left it selected, and the browser pane's
 * [data-dsh-link-surface="true"] anchor goes away with that tab - so the world flipped behind the next gate's
 * back (R181-C section 3 C-3, measured: prepare ACTIVE -> this gate -> world read AWAY, selectedTab=智能体团队).
 * What is restored is the ENTRY state measured before the gate touched anything, never a state it prefers.
 */
const restoreRail = async (cdp, entry, progress) => {
  const rail = async () => { const seen = await cdp.json(RAIL_STATE); return seen.ok === true ? seen.value : null }
  const notes = []
  let state = await rail()
  if (state === null || state.tabs === undefined) return { ok: false, wanted: entry.title, on: null, why: 'the rail probe did not answer, so the rail could not be put back', notes: notes }
  if (entry.tab === null) {
    return { ok: null, wanted: null, on: null, why: 'the rail had no selected tab when this gate started, so there was no selection to put back', notes: notes }
  }
  const target = state.tabs.filter((tab) => tab.tab === entry.tab)[0]
  if (target === undefined) {
    return { ok: false, wanted: entry.title, on: (state.tabs.filter((tab) => tab.sel === true)[0] || {}).title || null, why: 'the tab this gate found selected (' + show(entry.title) + ' / ' + show(entry.tab) + ') is no longer in the rail, so the selection it found cannot be put back', notes: notes }
  }
  if (target.sel !== true) {
    notes.push('clicking the entry tab back: ' + show(entry.title) + ' (' + show(entry.tab) + ') at ' + show(target.box))
    await cdp.click(centre(target.box))
  }
  const backUntil = Date.now() + 9000
  while (Date.now() < backUntil) {
    state = await rail()
    if (state === null) break
    const hit = state.tabs.filter((tab) => tab.sel === true)[0]
    if (hit !== undefined && hit.tab === entry.tab) break
    await sleep(500)
  }
  // The column: if THIS gate was the one that expanded a collapsed rail, collapse it again.
  let columnWidth = state === null || state.column === null ? null : state.column[2]
  if (entry.collapsed === true) {
    const probe = await cdp.json(COLUMN_PROBE)
    const button = probe.ok === true ? (probe.value.buttons || []).filter((row) => row.label === RAIL_CLOSE_LABEL)[0] : undefined
    if (button === undefined) notes.push('the rail was collapsed when this gate started and the page offers no ' + show(RAIL_CLOSE_LABEL) + ' control, so it stays open')
    else {
      await cdp.click({ x: button.x, y: button.y })
      const collapsedUntil = Date.now() + 8000
      while (Date.now() < collapsedUntil) {
        await sleep(500)
        state = await rail()
        columnWidth = state === null || state.column === null ? null : state.column[2]
        if (columnWidth !== null && columnWidth < 400) break
      }
      notes.push('collapsed the rail again: ' + show(columnWidth) + 'px wide (it was ' + show(entry.columnWidth) + 'px when this gate started)')
    }
  }
  // The falsifiable half of the restore: with the entry pane back, the world's own anchor comes back with it.
  await sleep(1500)
  const seen = await cdp.json(AFTER_READ)
  const after = seen.ok === true ? seen.value : null
  const selected = state === null ? [] : state.tabs.filter((tab) => tab.sel === true)
  const on = selected.length === 0 ? null : selected[0].title
  if (selected.length === 0) notes.push('the rail now reports no selected tab at all')
  for (const note of notes) progress.push('restore: ' + note)
  return {
    ok: selected.length === 1 && selected[0].tab === entry.tab,
    wanted: entry.title, on: on,
    entry: { tab: entry.tab, title: entry.title, columnWidth: entry.columnWidth, collapsed: entry.collapsed },
    columnWidth: columnWidth,
    surfaceCount: after === null ? null : after.surfaceCount,
    anchor: after === null ? null : after.anchor,
    notes: notes,
  }
}

const collectPane = async (cdp) => {
  const progress = []
  const rail = async () => {
    const seen = await cdp.json(RAIL_STATE)
    return seen.ok === true ? seen.value : null
  }
  let state = await rail()
  if (state === null) return { skip: 'the page probe did not answer, so the right rail could not be read' }
  if (state.column === null) return { skip: 'this client is showing a screen without the right rail ([data-rightbar-col] is absent, i.e. no session is open)' }
  // R181-D (C-3): the ENTRY state, read before this gate touches a single control. Reading 7 puts exactly this
  // back, so a suite that runs gate after gate does not inherit this gate's world.
  const selectedAtEntry = state.tabs.filter((tab) => tab.sel === true)[0] || null
  const entry = {
    columnWidth: state.column[2],
    collapsed: state.column[2] < 400,
    tab: selectedAtEntry === null ? null : selectedAtEntry.tab,
    title: selectedAtEntry === null ? null : selectedAtEntry.title,
    tabs: state.tabs.map((tab) => tab.title),
  }
  progress.push('entry state: rail ' + show(state.column) + 'px wide, selected tab ' + show(entry.title) + ' (' + show(entry.tab) + '), tab titles ' + show(entry.tabs))
  if (state.column[2] < 400) {
    const seen = await cdp.json(COLUMN_PROBE)
    const button = seen.ok === true ? (seen.value.buttons || []).filter((entry) => entry.label === RAIL_OPEN_LABEL)[0] : undefined
    if (button === undefined) return { skip: 'the right rail is collapsed and the page offers no ' + show(RAIL_OPEN_LABEL) + ' control, so the pane could not be reached the way a user reaches it' }
    progress.push('the rail started collapsed (' + state.column[2] + 'px wide); the gate clicked ' + show(RAIL_OPEN_LABEL))
    await cdp.click({ x: button.x, y: button.y })
    const until = Date.now() + 8000
    while (Date.now() < until) {
      await sleep(500)
      state = await rail()
      if (state !== null && state.column !== null && state.column[2] >= 400) break
    }
  }
  let via = 'existing-tab'
  if (state.titledSelected === 0) {
    const existing = state.tabs.filter((tab) => String(tab.title || '').includes(TAB_TITLE))[0]
    if (existing !== undefined) {
      via = 'existing-tab-activated'
      progress.push('a ' + show(TAB_TITLE) + ' tab already existed (' + existing.tab + '); the gate clicked its chip')
      await cdp.click(centre(existing.box))
      await sleep(800)
    } else {
      via = 'rail-plus-then-guide-entry'
      if (state.add === null) return { skip: 'the rail offers no [data-dockkit-add-tab] control, so a new tab cannot be opened the way a user opens one' }
      progress.push('no ' + show(TAB_TITLE) + ' tab existed; the gate clicked the rail + control and will pick the ' + show(TAB_KIND) + ' guide entry')
      await cdp.click(centre(state.add))
      let entry = null
      const listed = Date.now() + 6000
      while (Date.now() < listed) {
        await sleep(400)
        state = await rail()
        if (state === null) break
        entry = state.entries.filter((candidate) => candidate.kind === TAB_KIND)[0] || null
        if (entry !== null || state.titled.length > 0) break
      }
      if (entry !== null) {
        progress.push('the + control listed a ' + show(TAB_KIND) + ' guide entry at ' + show(entry.box) + '; the gate clicked its centre')
        await cdp.click(centre(entry.box))
      } else if (state !== null && state.titled.length === 0) {
        return { skip: 'clicking + produced neither a ' + show(TAB_KIND) + ' guide entry nor a ' + show(TAB_TITLE) + ' tab, so the pane could not be opened' }
      }
    }
  } else {
    progress.push('a selected ' + show(TAB_TITLE) + ' tab was already on screen; nothing had to be clicked')
  }
  // Poll the pane until the document it fetches has arrived (2s poll, first read on mount).
  // R293: wait for the WHOLE signature, and wait longer. Measured: the route answers 200 with a 55 KB body from the
  // page in well under a second, but the pane's own first fold plus its two folds can take longer than the 12 s this
  // loop used to allow - and the loop broke on the FIRST word, so a pane that had rendered its header and the board but
  // not yet the member line counted as ready. Both are the same mistake: reading before the pane can answer.
  const until = Date.now() + 24000
  let pane = null
  while (Date.now() < until) {
    const seen = await cdp.json(PANE_READ)
    pane = seen.ok === true ? seen.value : null
    const ready = pane !== null && pane.selected === true && typeof pane.text === 'string'
      && PANE_WORDS.every((word) => pane.text.includes(word))
    if (ready) break
    await sleep(600)
  }
  // R311: open the pane's own closed folds before reading it. A closed <details>'s content is not in innerText, and
  // reading 5 compares the pane with the route - so a served team the pane folds away would make that comparison a
  // coincidence rather than a measurement. Opening them is one click; the reading says how many were opened.
  const foldsOpened = pane === null ? 0 : await openPaneFolds(cdp, progress)
  if (foldsOpened > 0) {
    const again = await cdp.json(PANE_READ)
    if (again.ok === true && again.value !== null && typeof again.value.text === 'string') pane = again.value
  }
  // R181-D (C-3): the restore happens BEFORE this gate judges anything - it is part of the measurement.
  const restored = await restoreRail(cdp, entry, progress)
  if (pane === null) return { skip: 'the pane read did not answer, so nothing about the pane could be measured', restored, progress }
  if (restored.ok === false) progress.push('the restore FAILED: ' + show(restored.on) + ' instead of ' + show(restored.wanted))
  return { skip: null, via, progress, pane, restored, foldsOpened, railTitles: state === null ? null : state.tabs.map((tab) => tab.title) }
}


// ---------------------------------------------------------------------------
// The judge: pure over the measured world, so --self-attack can mutate the world itself
// ---------------------------------------------------------------------------

const expectations = () => ({
  streamLimit: STREAM_LIMIT,
  paneWords: PANE_WORDS,
  emptyWords: EMPTY_WORDS,
  treeHeader: TREE_HEADER,
  declarationKinds: DECLARATION_KINDS,
})

/** Which part of the ledger directory the pane text carries: full path, its last two segments, or only the name. */
const pathForm = (text, directory) => {
  const body = String(text === null || text === undefined ? '' : text)
  const dir = String(directory === null || directory === undefined ? '' : directory)
  if (dir !== '' && body.includes(dir)) return 'full'
  const parts = dir.split(/[\\/]+/).filter((part) => part !== '')
  if (parts.length >= 2 && body.includes(parts.slice(-2).join('\\'))) return 'tail'
  const base = parts.length === 0 ? '' : parts[parts.length - 1]
  if (base.length >= 3 && body.includes(base)) return 'basename'
  return 'none'
}

/** The first 8 characters, which is how the pane draws an id (client.js:100 shortId). */
const shortId = (value) => (typeof value === 'string' && value.length > 8 ? value.slice(0, 8) : String(value || '?'))

/** The handshake card's slice of the pane text: from its title to the card after it (null when there is no card). */
const peersCardRegion = (text) => {
  const body = String(text === null || text === undefined ? '' : text)
  const at = body.indexOf(PEERS_TITLE)
  if (at === -1) return null
  const found = body.indexOf(PEERS_CARD_END, at + PEERS_TITLE.length)
  const end = found === -1 ? body.length : found
  return { at, end, text: body.slice(at, end) }
}

/** The world the readings are being taken against, so a text reading can first prove WHICH pane it read. */
let judgedWorld = null
const judge = (world, expect) => {
  const readings = []
  judgedWorld = world
  /**
 * The readings that judge the PANE'S TEXT, and the words the teams pane always carries.
 *
 * R292, measured across restarts on the same code: the walk can land on a body that is not ours (or an empty one), and
 * then these four reading redden together with "the pane text is missing 任务板/成员/交流" - four verdicts about a pane
 * nobody proved was the teams pane. The three words are its own signature, so when they are absent every one of these
 * becomes a NAMED THIRD STATE instead of a red. A gate that cannot tell which pane it read cannot judge one.
 */
const TEXT_READINGS = ['4-pane-shows-the-live-ledger', '5-the-worlds-declarations-are-the-panes-declarations', '6-pane-numbers-equal-the-ledger', '8-peers-card-is-drawn']
const PANE_WORDS = ['任务板', '成员', '交流']
const paneSignature = (world) => {
  const pane = world === null || world === undefined ? null : world.pane
  if (pane === null || pane === undefined || pane.skip) return { ours: true, why: 'no pane body was read' }
  const text = String(pane.text === null || pane.text === undefined ? '' : pane.text)
  const missing = PANE_WORDS.filter((word) => text.includes(word) === false)
  return { ours: missing.length === 0, why: 'the body carries ' + String(PANE_WORDS.length - missing.length) + ' of ' + String(PANE_WORDS.length) + ' signature words; missing ' + JSON.stringify(missing) + '; first 120 characters: ' + String(text.slice(0, 120).replace(/\s+/g, ' ')) }
}
const add = (id, ok, detail, evidence) => {
  const signature = paneSignature(judgedWorld)
  if (ok !== null && TEXT_READINGS.includes(id) && signature.ours !== true) {
    readings.push({ id, ok: null, detail: 'NOT MEASURED: NOT-OUR-PANE - ' + signature.why + ' (the reading would have said: ' + String(detail).slice(0, 140) + ')', evidence: [] })
    return
  }
  readings.push({ id, ok, detail, evidence: Array.isArray(evidence) ? evidence : [] })
}
  const route = world.route
  const body = route.body
  const before = world.file.before
  const after = world.file.after
  const records = body !== null && body.ledger !== undefined ? body.ledger.records : null
  const fileRows = after.ok ? after.rows : before.rows
  const snap = after.ok === true && records === after.rows ? after : before
  const directory = body !== null && body.ledger !== undefined ? body.ledger.directory : null
  const stream = body !== null && Array.isArray(body.stream) ? body.stream : null

  // 1 -----------------------------------------------------------------------
  {
    const problems = []
    if (route.status !== 200 || body === null || body.ok !== true) {
      problems.push('the route answered status=' + route.status + ' ok=' + show(body === null ? null : body.ok) + (route.transport ? ' (' + route.transport + ')' : ''))
    } else {
      if (typeof records !== 'number') problems.push('ledger.records is not a number (' + show(records) + ')')
      else if (records !== before.rows && records !== after.rows) problems.push('ledger.records=' + records + ' but this gate counted ' + before.rows + '/' + after.rows + ' rows in control.jsonl')
      if (stream === null) problems.push('stream is not an array')
      else {
        const want = Math.max(0, Math.min(expect.streamLimit, Number(records) || 0))
        if (stream.length !== want) problems.push('the stream carries ' + stream.length + ' rows, expected ' + want + ' = min(' + expect.streamLimit + ', records)')
        const fileSeqs = new Set(snap.seqs.filter((seq) => typeof seq === 'number'))
        const streamSeqs = new Set(stream.map((row) => (row === null || row === undefined ? null : row.seq)))
        const invented = Array.from(streamSeqs).filter((seq) => fileSeqs.has(seq) === false)
        if (invented.length > 0) problems.push(invented.length + ' stream row(s) name a seq the file does not have: ' + show(invented.slice(0, 5)))
        const outside = Array.from(fileSeqs).filter((seq) => streamSeqs.has(seq) === false).length
        const claimed = (Number(fileRows) || 0) - stream.length
        if (outside !== claimed) problems.push('the file has ' + outside + ' row(s) outside the stream but records-stream=' + claimed)
        if (typeof body.ledger.lastSeq === 'number' && snap.maxSeq !== null && body.ledger.lastSeq !== snap.maxSeq) problems.push('ledger.lastSeq=' + body.ledger.lastSeq + ' but the highest seq in the file is ' + snap.maxSeq)
      }
    }
    const outsideCount = stream === null ? null : snap.seqs.filter((seq) => new Set(stream.map((row) => (row === null || row === undefined ? null : row.seq))).has(seq) === false).length
    add('1-route-numbers-come-from-the-ledger', problems.length === 0,
      problems.length === 0
        ? 'GET ' + ROUTE + ' answered 200 ok=true, and its ledger.records agrees with the file this gate counted itself'
        : problems.join(PROBLEM_SEPARATOR),
      ['GET 127.0.0.1:' + String(route.port) + ROUTE + ' -> status=' + route.status + ' ok=' + show(body === null ? null : body.ok) + ' records=' + show(records) + ' lastSeq=' + show(body !== null && body.ledger !== undefined ? body.ledger.lastSeq : null) + ' stream=' + show(stream === null ? null : stream.length),
        'control.jsonl counted by this gate: ' + show(before.path) + ' -> ' + show(before.rows) + ' rows before / ' + show(after.rows) + ' after; highest seq ' + show(snap.maxSeq) + '; rows outside the stream ' + show(outsideCount),
        'the same route on the kernel port ' + String(world.routeKernel.port) + ': status=' + world.routeKernel.status + ' records=' + show(world.routeKernel.body === null ? null : world.routeKernel.body.ledger.records) + ' (the pane fetches through ' + String(PORT) + ', which is this reading\u2019s subject)',
        'the payload cannot supply its own arithmetic: the row count comes from the file'])
  }

  // 2 -----------------------------------------------------------------------
  {
    const problems = []
    if (world.post.status !== 405) problems.push('POST answered ' + world.post.status + ', not 405')
    if (world.post.code !== 'METHOD_NOT_ALLOWED') problems.push('POST was refused with error.code=' + show(world.post.code) + ', not the named METHOD_NOT_ALLOWED')
    for (const verb of [world.put, world.delete]) {
      if (verb.status !== 405) problems.push(verb.method + ' answered ' + verb.status + ', not 405')
      if (verb.code !== 'METHOD_NOT_ALLOWED') problems.push(verb.method + ' was refused with error.code=' + show(verb.code))
    }
    if (route.status !== 200) problems.push('the paired control failed: GET on the same path answered ' + route.status + ' in this run, so a refusal here would prove nothing about the verb')
    add('2-route-refuses-writes-by-name', problems.length === 0,
      problems.length === 0 ? 'POST/PUT/DELETE on ' + ROUTE + ' are all 405 with the named METHOD_NOT_ALLOWED, while GET on the same path answered 200 in this run' : problems.join(PROBLEM_SEPARATOR),
      ['POST -> ' + world.post.status + ' code=' + show(world.post.code) + ' message=' + show(world.post.message),
        'PUT -> ' + world.put.status + ' code=' + show(world.put.code) + ' | DELETE -> ' + world.delete.status + ' code=' + show(world.delete.code),
        'paired control: GET -> ' + route.status + ' (a route that is absent, renamed or wedged could not have answered 200 in reading 1)'])
  }

  // 3 -----------------------------------------------------------------------
  {
    const artifact = world.artifact
    const problems = []
    if (artifact.bound !== true) problems.push('the shipped artifact registered no route: ' + show(artifact.error === undefined ? 'unknown' : artifact.error))
    else {
      if (artifact.absent.status !== 503 || artifact.absent.code !== 'NO_CAPABILITY') problems.push('with no linkCollab the handler answered status=' + show(artifact.absent.status) + ' code=' + show(artifact.absent.code) + ', not 503 + NO_CAPABILITY')
      if (artifact.noReader.status !== 503 || artifact.noReader.code !== 'NO_STATE_READER') problems.push('with a linkCollab that publishes no state() the handler answered status=' + show(artifact.noReader.status) + ' code=' + show(artifact.noReader.code) + ', not 503 + NO_STATE_READER')
      if (artifact.present.status !== 200 || artifact.present.ok !== true) problems.push('the paired control failed: the SAME harness with a linkCollab stand-in answered status=' + show(artifact.present.status) + ' ok=' + show(artifact.present.ok) + ', so the 503s above are not shown to be a branch')
    }
    add('3-absent-capability-branch-is-named', problems.length === 0,
      problems.length === 0 ? 'the shipped handler names a missing bus (503 NO_CAPABILITY), names an unusable bus (503 NO_STATE_READER), and answers a stand-in with 200' : problems.join(PROBLEM_SEPARATOR),
      ['driven in this process: ' + ARTIFACT + ' -> apply() with ctx.get(\'webServer\') published, and ctx.get(\'linkCollab\') absent / present-without-state / a stand-in',
        'no linkCollab -> ' + show(artifact.absent.status) + ' ' + show(artifact.absent.code) + ' | linkCollab without state() -> ' + show(artifact.noReader.status) + ' ' + show(artifact.noReader.code) + ' | stand-in -> ' + show(artifact.present.status) + ' ok=' + show(artifact.present.ok) + ' records=' + show(artifact.present.records),
        'SCOPE, stated rather than hidden: the live client has the bus mounted, so the LIVE route cannot reach this branch without removing a capability (a product change a gate may not make). Readings 1-2 cover the live route; this reading covers the branch the live world cannot show.'])
  }

  // 4 -----------------------------------------------------------------------
  {
    const pane = world.pane
    if (pane === null || pane.skip) {
      add('4-pane-shows-the-live-ledger', null, 'NOT MEASURED: ' + (pane === null ? 'the pane was not read' : pane.skip), [])
    } else {
      const problems = []
      const text = String(pane.text === null || pane.text === undefined ? '' : pane.text)
      if (pane.found !== true) problems.push('no tab whose title contains ' + show(TAB_TITLE) + ' exists (tab titles on screen: ' + show(world.railTitles) + ')')

      const box = Array.isArray(pane.box) ? pane.box : null
      if (box === null) problems.push('the tab has no pane body element ([data-dockkit-content] is absent)')
      else if (box[2] <= 0 || box[3] <= 0) problems.push('the pane body is ' + box[2] + 'x' + box[3] + ', i.e. not drawn')
      const missing = expect.paneWords.filter((word) => text.includes(word) === false)
      if (missing.length > 0) problems.push('the pane text is missing ' + show(missing))
      const form = pathForm(text, directory)
      if (form === 'none' || form === 'basename') problems.push('the pane text does not carry the ledger path this world reports (' + show(directory) + '); the best form found was ' + show(form))
      add('4-pane-shows-the-live-ledger', problems.length === 0,
        problems.length === 0
          ? 'the rail showed a ' + show(TAB_TITLE) + ' tab (' + pane.via + ') whose body is ' + box[2] + 'x' + box[3] + ' and whose text carries 任务板/成员/交流 and this world\u2019s ledger path'
          : problems.join(PROBLEM_SEPARATOR),
        ['tab ' + show(pane.tab) + ' reached via ' + show(pane.via) + ' | body box ' + show(box) + ' | text ' + text.length + ' chars',
          'the ledger path in the pane text: form=' + form + ' for ' + show(directory),
          'tab titles on screen: ' + show(world.railTitles)].concat(pane.progress === undefined ? [] : pane.progress))
    }
  }

  // 5 -----------------------------------------------------------------------
  //
  // The world decides WHICH thing is asserted, and this gate says which world it found. Three worlds are
  // told apart, and none of them may pass silently:
  //
  //   empty     no declaration row in control.jsonl and none served by the route the pane polls: the pane
  //             must name the empty state and paint no declared tree.
  //   declared  the route serves declarations: the pane must draw them \u2014 every capability the route serves
  //             for a member the ledger names must appear in the pane text, and a served team must bring the
  //             declared-tree header and that team with it. Comparing the pane against the ROUTE is what
  //             stops a canned document from passing.
  //   unserved  control.jsonl HAS declaration rows and the route serves NONE of them: the two halves of the
  //             chain disagree. Named, and a failure.
  {
    const pane = world.pane
    const counts = {}
    for (const kind of expect.declarationKinds) counts[kind] = { before: (before.kinds[kind] || 0), after: (after.kinds[kind] || 0) }
    const fileDeclared = expect.declarationKinds.reduce((total, kind) => total + Math.max(counts[kind].before, counts[kind].after), 0)
    const servedRegistry = body !== null && body.registry !== undefined && body.registry !== null ? Number(body.registry.declarations) || 0 : 0
    const servedTeamIds = body !== null && body.teams !== undefined && body.teams !== null && Array.isArray(body.teams.teams) ? body.teams.teams.map((team) => team.id) : []
    const servedCapabilities = body !== null && body.registry !== undefined && body.registry !== null && Array.isArray(body.registry.members)
      ? body.registry.members.flatMap((member) => (Array.isArray(member.capabilities) ? member.capabilities : []))
      : []
    // The pane renders a capability on the row of a member the LEDGER names as a member, and a team as the
    // first 8 characters of its id (client.js:99 shortId, :420 the capability suffix).
    const ledgerMemberIds = new Set(body !== null && body !== undefined && Array.isArray(body.members) ? body.members.map((member) => member.id) : [])
    const drawableCapabilities = body !== null && body.registry !== undefined && body.registry !== null && Array.isArray(body.registry.members)
      ? body.registry.members.filter((member) => ledgerMemberIds.has(member.id)).flatMap((member) => (Array.isArray(member.capabilities) ? member.capabilities : []))
      : []
    const served = servedRegistry > 0 || servedTeamIds.length > 0
    const kind = served ? 'declared' : fileDeclared > 0 ? 'unserved' : 'empty'
    const shortOf = (id) => (typeof id === 'string' && id.length > 8 ? id.slice(0, 8) : String(id))
    const reading = '5-the-worlds-declarations-are-the-panes-declarations'
    if (pane === null || pane.skip) {
      add(reading, null, 'NOT MEASURED: the pane was not read, so it cannot be compared with the declarations this world has (' + kind + ')', [])
    } else {
      const text = String(pane.text === null || pane.text === undefined ? '' : pane.text)
      const problems = []
      const evidence = [
        'this gate counted in control.jsonl: ' + show({ 'team/state': counts['team/state'].after, 'capability/state': counts['capability/state'].after }) + ' (before: ' + show({ 'team/state': counts['team/state'].before, 'capability/state': counts['capability/state'].before }) + ')',
        'the route the pane polls serves: registry.declarations=' + show(servedRegistry) + ' teams=' + show(servedTeamIds.length) + ' (capability names ' + show(servedCapabilities) + ', team ids ' + show(servedTeamIds) + ')',
        'this world is therefore ' + show(kind) + '; the pane text is ' + text.length + ' characters',
        'the pane was read after opening ' + String(world.foldsOpened === undefined ? 0 : world.foldsOpened) + ' of its own closed fold(s): a closed <details> is not in innerText (R291), so the comparison above is made against what the pane shows when its folds are open',
      ]
      if (kind === 'empty') {
        const missing = expect.emptyWords.filter((word) => text.includes(word) === false)
        if (missing.length > 0) problems.push('the pane does not say ' + show(missing) + ' although neither the ledger nor the route has any declaration row')
        if (text.includes(expect.treeHeader)) problems.push('the pane painted ' + show(expect.treeHeader) + ' while no ' + expect.declarationKinds.join('/') + ' row exists anywhere \u2014 an empty tree')
        evidence.push('the pane says ' + show(expect.emptyWords.filter((word) => text.includes(word))) + ' and ' + (text.includes(expect.treeHeader) ? 'DOES' : 'does not') + ' carry ' + show(expect.treeHeader))
      } else if (kind === 'declared') {
        // Never silently: the route must serve at least as much as the file holds, or this branch would pass
        // over exactly the disagreement the third branch is about (one row further along the chain).
        const fileRows = ((after.ok === true ? after : before).parsed ?? []).filter((row) => row !== null && row !== undefined)
        // The count comes from the kind census this reading already took (one notion of "what the file holds"),
        // the ids come from the rows themselves (the route serves ids, not counts).
        const fileCapabilityRows = Math.max(counts['capability/state'].before, counts['capability/state'].after)
        const fileTeamIds = new Set(fileRows.filter((row) => row.kind === 'team/state').map((row) => (row.payload !== null && row.payload !== undefined && typeof row.payload.team === 'string' ? row.payload.team : row.subject)).filter((id) => typeof id === 'string' && id !== ''))
        if (servedRegistry < fileCapabilityRows) problems.push('the route serves ' + String(servedRegistry) + ' capability declaration(s) while control.jsonl holds ' + String(fileCapabilityRows) + ' capability/state row(s)')
        if (servedTeamIds.length < fileTeamIds.size) problems.push('the route serves ' + String(servedTeamIds.length) + ' declared team(s) while control.jsonl declares ' + String(fileTeamIds.size))
        evidence.push('the file holds ' + String(fileCapabilityRows) + ' capability/state row(s) and declares ' + String(fileTeamIds.size) + ' team(s): ' + show(Array.from(fileTeamIds).sort()))
        const undrawable = servedCapabilities.filter((name) => drawableCapabilities.includes(name) === false)
        if (drawableCapabilities.length > 0) {
          const absent = drawableCapabilities.filter((name) => text.includes(name) === false)
          if (absent.length > 0) problems.push('the route serves capability declaration(s) ' + show(absent) + ' for members the ledger names, and the pane text carries none of them')
        } else if (servedRegistry > 0) {
          problems.push('the route serves ' + String(servedRegistry) + ' capability declaration(s) (' + show(servedCapabilities) + ') for member(s) the ledger never named as a member (' + show(Array.from(ledgerMemberIds)) + '), so the pane has no row to draw them on: a declaration nobody can see')
        }
        if (servedTeamIds.length > 0) {
          if (text.includes(expect.treeHeader) === false) problems.push('the route serves ' + show(servedTeamIds.length) + ' declared team(s) and the pane text does not carry ' + show(expect.treeHeader))
          const absentTeams = servedTeamIds.filter((id) => text.includes(shortOf(id)) === false)
          if (absentTeams.length > 0) problems.push('the pane text carries none of ' + show(absentTeams.map(shortOf)) + ' (the first 8 characters, which is how the pane draws a team id)')
        }
        evidence.push('capabilities the pane must carry (declared for members the ledger names): ' + show(drawableCapabilities) + (undrawable.length > 0 ? '; served but undrawable by design (no member row): ' + show(undrawable) : ''))
        evidence.push('team ids the pane must carry: ' + show(servedTeamIds.map(shortOf)))
      } else {
        problems.push('control.jsonl holds ' + String(fileDeclared) + ' declaration row(s) (' + show({ 'team/state': counts['team/state'].after, 'capability/state': counts['capability/state'].after }) + ') and the route the pane polls serves NONE of them (registry.declarations=0, teams=0): the surface is not showing the ledger this world holds')
        evidence.push('MECHANISM, measured in R180-B and stated here: the route answers from the kernel in-memory fold (linkCollab.state() over log.replay(), plugins/dsh-link-collab/lib/index.js:392-394 and :2730-2731), and the ledger is single-writer (openControlLog refuses a second opener while a live process holds .writer, :174-179). A row written into control.jsonl by anything but the live kernel is invisible to this pane until that kernel re-opens the ledger \u2014 a client or kernel restart, not a cache expiration.')
        evidence.push('the same disagreement also reddens reading 6, whose chips are compared with the file this gate counted: the pane can only be as live as the fold behind it')
      }
      add(reading, problems.length === 0,
        problems.length === 0
          ? (kind === 'empty'
            ? 'with 0 declaration rows in the ledger and 0 served by the route the pane names the empty state (' + expect.emptyWords.join(' / ') + ') and paints no declared tree'
            : 'the route serves ' + show(drawableCapabilities.length) + ' capability declaration(s) and ' + show(servedTeamIds.length) + ' team(s), and the pane draws them')
          : problems.join(PROBLEM_SEPARATOR),
        evidence)
    }
  }

  // 6 -----------------------------------------------------------------------
  {
    const pane = world.pane
    if (pane === null || pane.skip) {
      add('6-pane-numbers-equal-the-ledger', null, 'NOT MEASURED: the pane was not read, so its chips cannot be compared with the ledger', [])
    } else {
      const text = String(pane.text === null || pane.text === undefined ? '' : pane.text)
      const first = (pattern) => { const found = text.match(pattern); return found === null ? null : Number(found[1]) }
      const shown = { records: first(/记录\s+(\d+)/), members: first(/成员\s+(\d+)/), tasks: first(/任务\s+(\d+)/) }
      const afterBody = world.routeAfter === null || world.routeAfter === undefined ? null : world.routeAfter.body
      const window = {
        records: [records, afterBody === null ? null : afterBody.ledger.records].filter((value) => typeof value === 'number'),
        members: [body === null || body.counts === undefined ? null : body.counts.members, afterBody === null || afterBody.counts === undefined ? null : afterBody.counts.members].filter((value) => typeof value === 'number'),
        tasks: [body === null || body.counts === undefined ? null : body.counts.tasks, afterBody === null || afterBody.counts === undefined ? null : afterBody.counts.tasks].filter((value) => typeof value === 'number'),
      }
      const problems = []
      for (const key of ['records', 'members', 'tasks']) {
        if (shown[key] === null) problems.push('the pane text carries no ' + key + ' chip')
        else if (window[key].includes(shown[key]) === false) problems.push('the pane shows ' + key + '=' + shown[key] + ' but this run measured ' + show(Array.from(new Set(window[key]))))
      }
      if (typeof shown.records === 'number' && shown.records !== before.rows && shown.records !== after.rows) problems.push('the pane\u2019s 记录 ' + shown.records + ' matches neither file count (' + before.rows + '/' + after.rows + ')')
      add('6-pane-numbers-equal-the-ledger', problems.length === 0,
        problems.length === 0 ? 'the pane chips equal the live ledger read around the pane (' + show(shown) + ')' : problems.join(PROBLEM_SEPARATOR),
        ['the pane shows ' + show(shown),
          'route snapshots around the pane read: records ' + show(window.records) + ', members ' + show(window.members) + ', tasks ' + show(window.tasks),
          'control.jsonl counted around the pane read: ' + show(before.rows) + ' / ' + show(after.rows) + ' rows'])
    }
  }

  { // 7-restored (R181-D, C-3)
    const problems = []
    const restored = world.restored
    if (restored === null || restored === undefined) problems.push('the gate could not say whether it put the rail back')
    else if (restored.ok === false) problems.push('the rail was NOT left on the pane this gate found selected (' + show(restored.wanted) + '): it is on ' + show(restored.on) + (restored.why === undefined ? '' : ' - ' + String(restored.why)))
    const measured = restored !== null && restored !== undefined && restored.ok !== null
    if (measured === false) {
      add('7-restored', null, 'not measured: ' + String(restored === null || restored === undefined ? 'no restore was attempted' : restored.why), ['restored=' + show(restored === undefined ? null : restored)])
    } else {
      add('7-restored', problems.length === 0, problems.length === 0
        ? 'the rail is back on the pane this gate found selected (' + show(restored.wanted) + '), so the world it leaves behind is the world it inherited' + (restored.surfaceCount === null || restored.surfaceCount === undefined ? '' : ' (its own anchor is ' + show(restored.anchor) + ', surfaceCount=' + String(restored.surfaceCount) + ')')
        : 'FAIL: ' + problems.join(' | '), ['restored=' + show(restored)])
    }
  }

  // 8 -----------------------------------------------------------------------
  //
  // The world decides whether there is a card to judge at all, and neither answer passes silently:
  //
  //   no rows   the fold the route serves holds no peer/state row: the pane has nothing to draw, and this
  //             reading says NOT MEASURED by name rather than passing over a card it never saw.
  //   rows      the pane must DRAW them \u2014 the card title, one arrow row per pair and that pair's own state
  //             chip, every string computed from the ROUTE (the first-8-character ids the client itself
  //             draws), so a pane painting handshakes nobody agreed on cannot pass.
  {
    const peers = body === null || body === undefined || body.peers === undefined ? null : body.peers
    const pairs = peers !== null && Array.isArray(peers.pairs) ? peers.pairs : null
    const pane = world.pane
    const text = pane === null || pane === undefined || pane.skip ? null : String(pane.text === null || pane.text === undefined ? '' : pane.text)
    const rows = (pairs === null ? [] : pairs).map((pair) => {
      const one = pair === null || pair === undefined || typeof pair !== 'object' ? {} : pair
      return { from: one.from === undefined ? null : one.from, to: one.to === undefined ? null : one.to, state: String(one.state || '?'), line: shortId(one.from) + PEERS_ARROW + shortId(one.to) }
    })
    const reading = '8-peers-card-is-drawn'
    const at = ROUTE + ' on 127.0.0.1:' + String(route.port)
    const after = world.routeAfter === null || world.routeAfter === undefined || world.routeAfter.body === null || world.routeAfter.body === undefined || world.routeAfter.body.peers === undefined || world.routeAfter.body.peers === null || Array.isArray(world.routeAfter.body.peers.pairs) === false
      ? null
      : world.routeAfter.body.peers.pairs.length
    if (pairs === null) {
      add(reading, null, 'NOT MEASURED: the route this pane polls serves no peers list (peers=' + show(peers) + '), so whether this world\u2019s handshakes are drawn cannot be read from it', [
        'GET ' + at + ' answered status=' + String(route.status) + ' with peers=' + show(peers) + ': there is no fold to compare the pane against',
      ])
    } else if (pairs.length === 0) {
      add(reading, null, 'NOT MEASURED: this world\u2019s ledger holds no peer/state row, so the pane has nothing to draw', [
        'GET ' + at + ' -> peers.pairs=' + show(pairs) + ': the fold the pane polls holds no handshake, and no card may be asserted from a row this gate would have to invent',
        text === null ? 'the pane itself was not read in this run' : 'the pane text (' + String(text.length) + ' chars) carries nothing that could be judged as the card here',
      ])
    } else if (pane === null || pane.skip) {
      add(reading, null, 'NOT MEASURED: the pane was not read, so the ' + String(pairs.length) + ' peer pair(s) the route serves could not be looked for in it', [
        'GET ' + at + ' -> peers.pairs=' + show(rows.map((row) => row.line + ' / ' + row.state)) + ' (the world was ready to be judged; the pane was not reached: ' + String(pane === null ? 'not read' : pane.skip) + ')',
      ])
    } else {
      const problems = []
      const region = peersCardRegion(text)
      if (region === null) problems.push('the pane text does not carry the card title ' + show(PEERS_TITLE) + ', so the handshake(s) this world serves are not drawn as a card at all')
      // Inside the card when it was found: the 交流 list prints the same state for the same record (:490).
      const inside = region === null ? text : region.text
      for (const row of rows) {
        if (inside.includes(row.line) === false) problems.push('the pane does not draw ' + show(row.from) + ' \u2192 ' + show(row.to) + ' the way that card does (' + show(row.line) + ': the first 8 characters of each id)')
        if (inside.includes(row.state) === false) problems.push('the card does not carry the state chip ' + show(row.state) + ' for ' + show(row.from) + ' \u2192 ' + show(row.to) + ' (the state this world\u2019s fold serves for that pair)')
      }
      add(reading, problems.length === 0,
        problems.length === 0
          ? 'the route serves ' + String(pairs.length) + ' peer pair(s) and the pane draws the card ' + show(PEERS_TITLE) + ' with ' + show(rows.map((row) => row.line)) + ' and their chips ' + show(rows.map((row) => row.state))
          : problems.join(PROBLEM_SEPARATOR),
        ['route ' + at + ' -> peers.pairs ' + show(pairs.map((pair) => { const one = pair === null || pair === undefined || typeof pair !== 'object' ? {} : pair; return { from: one.from, to: one.to, request: one.request, state: one.state, seq: one.seq } })),
          'the pane must carry, as the client draws it (:441, :446): ' + show(PEERS_TITLE) + ', then per pair ' + show(rows.map((row) => row.line + ' / ' + row.state)) + ' (' + show(PEERS_ARROW) + ' and the first 8 characters of each id, client.js:100)',
          'the card\u2019s slice of the pane text is ' + String(region === null ? 0 : region.text.length) + ' of ' + String(text.length) + ' chars, ending where ' + show(PEERS_CARD_END) + ' begins: the \u4ea4\u6d41 list prints the same state for the same record (:490), so the chips are read inside the card and not anywhere in the pane',
          'the same route after the pane read reported ' + show(after) + ' pair(s)' + (after !== null && after !== pairs.length ? ' \u2014 the pane polls on its own clock, so a row that landed between the two reads is a red this line explains' : '')])
    }
  }

  return readings
}


// ---------------------------------------------------------------------------
// Collection: one world, measured once
// ---------------------------------------------------------------------------

const collect = async () => {
  const progress = []
  progress.push('shell ' + String(PORT) + ' / kernel ' + String(KERNEL_PORT) + ' / CDP ' + String(CDP_PORT))
  const route = await readRoute(PORT)
  if (route.status === 0) {
    return { world: null, progress, skip: 'nothing answered on 127.0.0.1:' + String(PORT) + ROUTE + ' (' + show(route.transport === undefined ? 'transport failed' : route.transport) + '), so the teams surface measured NOTHING' }
  }
  const routeKernel = await readRoute(KERNEL_PORT)
  const directory = route.body !== null && route.body.ledger !== undefined ? route.body.ledger.directory : null
  if (directory === null) {
    return { world: null, progress, skip: 'the route answered without a ledger directory, so the control.jsonl this gate counts could not be found (status ' + route.status + ')' }
  }
  const fileBefore = readLedger(directory)
  if (fileBefore.ok !== true) {
    return { world: null, progress, skip: 'the ledger file could not be counted by this gate: ' + show(fileBefore.path) + ' -> ' + show(fileBefore.code) + ' ' + show(fileBefore.message) }
  }
  progress.push('the ledger this gate counted: ' + show(fileBefore.path) + ' (' + String(fileBefore.rows) + ' rows)')
  const post = await writeVerb(PORT, 'POST')
  const put = await writeVerb(PORT, 'PUT')
  const del = await writeVerb(PORT, 'DELETE')
  const absent = await driveArtifact(undefined)
  const noReader = await driveArtifact({})
  const present = await driveArtifact(STAND_IN_COLLAB)
  let pane = null
  let restored = null
  let railTitles = null
  // R311: how many of the pane's own closed folds this gate had to open before it could read a served fact.
  let foldsOpened = 0
  const cdp = await connectCdp({ port: CDP_PORT, deadlineMs: 15000 }).catch(() => null)
  if (cdp === null) {
    progress.push('no CDP on ' + String(CDP_PORT) + ': the rail cannot be driven, so readings 4-6 are not measured')
  } else {
    try {
      const seen = await collectPane(cdp)
      restored = seen.restored === undefined ? null : seen.restored
      pane = seen.skip ? { skip: seen.skip } : { skip: null, via: seen.via, progress: seen.progress, found: seen.pane.found, selected: seen.pane.selected, tab: seen.pane.tab, box: seen.pane.box, text: seen.pane.text }
      railTitles = seen.railTitles === undefined ? null : seen.railTitles
      foldsOpened = typeof seen.foldsOpened === 'number' ? seen.foldsOpened : 0
      progress.push.apply(progress, seen.progress === undefined ? [] : seen.progress)
    } catch (error) {
      pane = { skip: 'driving the rail threw: ' + String(error && error.message ? error.message : error) }
    } finally {
      try { cdp.close() } catch { /* the socket is already gone */ }
    }
  }
  const routeAfter = await readRoute(PORT)
  const fileAfter = readLedger(directory)
  if (fileAfter.ok !== true) progress.push('the second ledger read failed: ' + show(fileAfter.code) + ' ' + show(fileAfter.message))
  return {
    world: {
      at: Date.now(),
      route, routeKernel, routeAfter,
      post, put, delete: del,
      file: { before: fileBefore, after: fileAfter.ok === true ? fileAfter : fileBefore },
      artifact: {
        bound: absent.bound === true,
        error: absent.error,
        absent: absent.get === undefined ? { status: null, code: null, ok: null, records: null, path: null } : absent.get,
        noReader: noReader.get === undefined ? { status: null, code: null, ok: null, records: null, path: null } : noReader.get,
        present: present.get === undefined ? { status: null, code: null, ok: null, records: null, path: null } : present.get,
      },
      pane, restored, railTitles, foldsOpened,
      cdp: cdp !== null,
    },
    progress,
    skip: null,
  }
}

// ---------------------------------------------------------------------------
// The self-attack: mutate the MEASURED world, one reading per mutant
// ---------------------------------------------------------------------------

/**
 * Which of the three worlds reading 5 is looking at: no declarations anywhere, declarations served by the
 * route, or declaration rows in the file that the route serves none of.
 */
const branchOf = (world) => {
  const kinds = (world.file.after.ok === true ? world.file.after.kinds : world.file.before.kinds) || {}
  const fileDeclared = DECLARATION_KINDS.reduce((total, kind) => total + (kinds[kind] || 0), 0)
  const body = world.route.body
  const registry = body === null || body === undefined || body.registry === undefined || body.registry === null ? 0 : Number(body.registry.declarations) || 0
  const teams = body !== null && body !== undefined && body.teams !== undefined && body.teams !== null && Array.isArray(body.teams.teams) ? body.teams.teams.length : 0
  if (registry > 0 || teams > 0) return 'declared'
  return fileDeclared > 0 ? 'unserved' : 'empty'
}

/**
 * Reading 5's mutants depend on which world this is: renaming the empty-state wording proves nothing in a
 * world that has declarations, and hiding a served capability proves nothing in a world that serves none.
 * Each world gets the mutants its own reading can fail on, and the control mutant still declares nothing.
 */
const declarationMutants = (world) => {
  const branch = branchOf(world)
  const text = world.pane === null || world.pane === undefined || world.pane.skip ? '' : String(world.pane.text === null || world.pane.text === undefined ? '' : world.pane.text)
  const body = world.route.body
  const ledgerIds = new Set(body !== null && body !== undefined && Array.isArray(body.members) ? body.members.map((member) => member.id) : [])
  const drawable = body !== null && body !== undefined && body.registry !== undefined && body.registry !== null && Array.isArray(body.registry.members)
    ? body.registry.members.filter((member) => ledgerIds.has(member.id)).flatMap((member) => (Array.isArray(member.capabilities) ? member.capabilities : []))
    : []
  const servedTeams = body !== null && body !== undefined && body.teams !== undefined && body.teams !== null && Array.isArray(body.teams.teams) ? body.teams.teams.map((team) => team.id) : []
  const reading = '5-the-worlds-declarations-are-the-panes-declarations'
  const built = []
  if (branch === 'empty') {
    built.push({ name: 'empty-state-word-renamed', mustRedden: [reading], world: (() => { const next = structuredClone(world); next.pane.text = text.split(EMPTY_WORDS[0]).join('待声明'); return next })() })
    built.push({ name: 'empty-tree-drawn', mustRedden: [reading], world: (() => { const next = structuredClone(world); next.pane.text = text + '\n' + TREE_HEADER; return next })() })
    built.push({ name: 'a-ledger-row-the-route-never-serves', mustRedden: [reading], world: (() => { const next = structuredClone(world); next.file.after.kinds = { ...next.file.after.kinds, 'capability/state': (next.file.after.kinds['capability/state'] || 0) + 1 }; return next })() })
  } else if (branch === 'declared') {
    if (drawable.length > 0 && text.includes(drawable[0])) {
      built.push({ name: 'pane-loses-a-served-capability', mustRedden: [reading], world: (() => { const next = structuredClone(world); next.pane.text = text.split(drawable[0]).join('(待声明)'); return next })() })
    }
    if (servedTeams.length > 0 && text.includes(TREE_HEADER)) {
      built.push({ name: 'pane-hides-the-served-tree', mustRedden: [reading], world: (() => {
        const next = structuredClone(world)
        const short = servedTeams[0].length > 8 ? servedTeams[0].slice(0, 8) : servedTeams[0]
        next.pane.text = text.split(TREE_HEADER).join('(树)').split(short).join('(团队)')
        return next
      })() })
    }
    // The other two branches of this same reading, reached by rewriting the world rather than the pane: a
    // saved-away route turns this world into the third branch, and emptying both halves makes it the first.
    built.push({ name: 'the-route-forgets-what-the-file-holds', mustRedden: [reading], world: (() => {
      const next = structuredClone(world)
      next.route.body.registry.declarations = 0
      next.route.body.registry.members = []
      next.route.body.teams.teams = []
      return next
    })() })
    built.push({ name: 'a-file-row-the-route-never-serves', mustRedden: [reading], world: (() => {
      const next = structuredClone(world)
      next.file.after.kinds = { ...next.file.after.kinds, 'capability/state': (next.file.after.kinds['capability/state'] || 0) + 1 }
      return next
    })() })
    built.push({ name: 'no-declarations-anywhere-and-the-pane-still-draws-a-tree', mustRedden: [reading], world: (() => {
      const next = structuredClone(world)
      next.file.after.kinds = { ...next.file.after.kinds, 'capability/state': 0, 'team/state': 0 }
      next.file.before.kinds = { ...next.file.before.kinds, 'capability/state': 0, 'team/state': 0 }
      next.route.body.registry.declarations = 0
      next.route.body.registry.members = []
      next.route.body.teams.teams = []
      return next
    })() })
  } else {
    built.push({ name: 'the-route-serves-what-the-file-holds', mustRedden: [reading], world: (() => { const next = structuredClone(world); next.route.body.registry.declarations = 1; return next })() })
  }
  return built
}

/**
 * Reading 8's mutants: the world's OWN card, dropped or written wrong. Built only when this world has both a
 * card to mutilate and a pane text to read it in - a world with no peer/state row cannot redden reading 8 at
 * all (it is not measured there), and the attack's baseline check refuses such a world before judging anything.
 */
const peerMutants = (world) => {
  const reading = '8-peers-card-is-drawn'
  const body = world.route.body
  const peers = body === null || body === undefined || body.peers === undefined ? null : body.peers
  const pairs = peers !== null && Array.isArray(peers.pairs) ? peers.pairs : []
  const pane = world.pane
  if (pairs.length === 0 || pane === null || pane === undefined || pane.skip) return []
  const text = String(pane.text === null || pane.text === undefined ? '' : pane.text)
  const region = peersCardRegion(text)
  const first = pairs[0] === null || pairs[0] === undefined || typeof pairs[0] !== 'object' ? {} : pairs[0]
  const line = shortId(first.from) + PEERS_ARROW + shortId(first.to)
  const chip = String(first.state || '?')
  const built = []
  if (region !== null && text.includes(line)) {
    built.push({
      name: 'pane-drops-the-handshake-card',
      mustRedden: [reading],
      world: (() => { const next = structuredClone(world); next.pane.text = text.slice(0, region.at) + text.slice(region.end); return next })(),
    })
    built.push({
      name: 'pane-draws-the-handshake-arrow-backwards',
      mustRedden: [reading],
      world: (() => { const next = structuredClone(world); next.pane.text = text.split(line).join(shortId(first.to) + PEERS_ARROW + shortId(first.from)); return next })(),
    })
  }
  if (region !== null && region.text.includes(chip)) {
    built.push({
      name: 'pane-writes-the-handshake-state-wrong',
      mustRedden: [reading],
      world: (() => {
        const next = structuredClone(world)
        // Inside the card only: the 交流 list keeps its own copy of the same state, and a mutation that
        // rewrote both would be a different one (the pane losing the state everywhere).
        next.pane.text = text.slice(0, region.at) + region.text.split(chip).join(chip === 'denied' ? 'granted' : 'denied') + text.slice(region.end)
        return next
      })(),
    })
  }
  return built
}

const mutants = (world) => {
  const clone = () => structuredClone(world)
  const directory = world.route.body === null ? '' : String(world.route.body.ledger.directory)
  const records = world.route.body === null ? 0 : Number(world.route.body.ledger.records)
  return [
    {
      name: 'ledger-records-off-by-one',
      mustRedden: ['1-route-numbers-come-from-the-ledger'],
      world: (() => { const next = clone(); next.route.body.ledger.records = records + 1; return next })(),
    },
    {
      name: 'stream-is-not-the-file-tail',
      mustRedden: ['1-route-numbers-come-from-the-ledger'],
      world: (() => { const next = clone(); next.route.body.stream = next.route.body.stream.slice(5); return next })(),
    },
    {
      name: 'post-accepted',
      mustRedden: ['2-route-refuses-writes-by-name'],
      world: (() => { const next = clone(); next.post = { method: 'POST', status: 200, code: null, message: 'accepted' }; return next })(),
    },
    {
      name: 'absent-capability-branch-dropped',
      mustRedden: ['3-absent-capability-branch-is-named'],
      world: (() => { const next = clone(); next.artifact.absent = { status: 200, ok: true, code: null, records: 0, path: ROUTE }; return next })(),
    },
    {
      name: 'pane-body-collapsed',
      mustRedden: ['4-pane-shows-the-live-ledger'],
      world: (() => { const next = clone(); next.pane.box = [0, 0, 0, 0]; return next })(),
    },
    {
      name: 'pane-hides-the-ledger-path',
      mustRedden: ['4-pane-shows-the-live-ledger'],
      world: (() => { const next = clone(); next.pane.text = String(next.pane.text).split(directory).join('(未知)'); return next })(),
    },
    {
      name: 'pane-numbers-stale',
      mustRedden: ['6-pane-numbers-equal-the-ledger'],
      world: (() => { const next = clone(); next.pane.text = String(next.pane.text).replace(/记录\s+(\d+)/, (all, seen) => '记录 ' + String(Number(seen) + 1000)); return next })(),
    },
    {
      name: 'rail-left-on-its-own-pane',
      mustRedden: ['7-restored'],
      world: (() => { const next = clone(); next.restored = { ...(next.restored === null || next.restored === undefined ? {} : next.restored), ok: false, on: TAB_TITLE }; return next })(),
    },
    {
      name: 'control-nothing-changed',
      mustRedden: [],
      world: clone(),
    },
  ].concat(declarationMutants(world), peerMutants(world))
}

const selfAttack = async (started) => {
  const collected = await collect()
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.world === null) { console.log('SKIP: ' + collected.skip); return 3 }
  const world = collected.world
  const base = judge(world, expectations())
  const baseRed = base.filter((reading) => reading.ok === false).map((reading) => reading.id)
  const baseNull = base.filter((reading) => reading.ok === null).map((reading) => reading.id)
  console.log('  baseline on the live world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' failed, ' + String(baseNull.length) + ' not measured')
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed) + ' (a mutant declared against a reading that is already red proves nothing)')
    return 1
  }
  if (baseNull.length > 0) {
    console.log('  SKIP: the attack needs every reading measured; not measured here: ' + show(baseNull))
    return 3
  }
  console.log('  each mutant below rewrites ONE fact of that measured world and is judged by the same judge:')
  let failures = 0
  const built = mutants(world)
  for (const mutant of built) {
    const observed = judge(mutant.world, expectations()).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const declared = mutant.mustRedden
    const precise = observed.length === declared.length && declared.every((id) => observed.includes(id))
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' \u2014 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed))
  }
  console.log('  ' + String(built.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(built.filter((mutant) => mutant.mustRedden.length > 0).length) + ' of them declare a target | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  console.log('  note: the mutants attack the JUDGE over the world measured in this run; the live measurement itself is not repeated per mutant.')
  return failures === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const started = Date.now()
  if (SELF_ATTACK) return selfAttack(started)
  const collected = await collect()
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.world === null) { console.log('SKIP: ' + collected.skip); return 3 }
  const readings = judge(collected.world, expectations())
  for (const reading of readings) {
    const verdict = reading.ok === true ? 'ok  ' : reading.ok === false ? 'FAIL' : 'n/a '
    console.log('  ' + verdict + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  const unmeasured = readings.filter((reading) => reading.ok === null)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(unmeasured.length) + ' not measured | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  if (failed.length > 0) return 1
  if (unmeasured.length > 0) {
    console.log('SKIP: ' + String(unmeasured.length) + ' reading(s) could not be measured here: ' + unmeasured.map((reading) => reading.id).join(', '))
    return 3
  }
  return 0
}

process.exitCode = await main()
