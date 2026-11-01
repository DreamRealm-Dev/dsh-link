#!/usr/bin/env node
/**
 * Gate 134 (R198) - teams-pane-truth: does the right rail show the REAL team?
 *
 * Contract: docs/handoff/R198-contract.md section P1. Subject: the live route
 * GET /api/dsh-link-teams/state (plugins/dsh-link-teams/src/index.ts, composing through
 * src/world.ts) and the right-rail pane that polls it. The gauntlet measured the live route
 * answering teams = [gate-r180-alpha-root, gate-r180-alpha-team] - teams a GATE invented - while the
 * real session's team was absent from the tree, counts.teams = 3 against a 2-node tree, and task-1
 * appeared twice. R196 P5 fixed the composition (src/world.ts:102: a node is every team the fold
 * declares OR NAMES, fixtures withheld AND counted). This gate is the falsification that fix has to
 * survive, written by an author who did not write the plugin, from the payload contract and the live
 * client - never from the source comments of the thing it judges.
 *
 * THE DRIVE, and its one cost: create ONE session through the shell's own API (session/create), send
 * ONE prompt that asks the model to call spawn_teammate exactly once, and then read - read-only - the
 * ledger it wrote, the route it answers with, and the pane it is drawn in. One session, one prompt,
 * one model round; the teammate the model spawns is the product's own teammate and the rows it writes
 * are the witness. Nothing is restarted, and this gate writes nothing into any product store.
 *
 * FIVE READINGS (the contract's), each able to fail on its own evidence:
 *
 *   1-ledger-holds-a-row-of-the-real-team
 *        At least one control row APPENDED by this round belongs to the real team: some field of the
 *        row (actor, subject, or a payload team/id/name/senderId/targetId/from/to) carries the id of
 *        the session this gate created - a session id prefix match, which is exact on this machine
 *        (measured: the kernel names a session's team with that session's id). The row is reported
 *        with its OWN seq and kind, and the rows that appeared WITHOUT carrying it are named too, so
 *        "a new row appeared" can never be mistaken for attribution.
 *   2-route-lists-the-real-team
 *        GET /api/dsh-link-teams/state lists a team whose id carries that session's prefix, and the
 *        fields that made it a node are read out (declared / observed / tasks / members).
 *   3-three-numbers-agree
 *        FOUR numbers, three of them the contract's: the ROUTE tree length (teams.teams.length), the
 *        route's own counts.teams, the pane's own team chip read from the DOM after the gate opened
 *        the teams tab the way a user opens it, and the number of team rows the pane actually DREW.
 *        All four must be the same number, and the drawn ids must be the route's ids - a canned
 *        document that draws the same count of different teams is red here, not green.
 *   4-no-invented-world
 *        Zero tree nodes carry a gate- / r18x- prefix, and teams.withheld is a NUMBER: the fixture
 *        rows in the ledger are counted rather than hidden (and rather than drawn as live work).
 *   5-world-left-put-back
 *        The rail is back on the tab it was on when this gate started, the panel lease is released,
 *        and the session this gate created is still NAMED in session/list - left open as the evidence,
 *        the way gate 117 leaves its session.
 *
 * Reading 0 is the drive's own premise, and it is why this gate can end in a third state:
 *
 *   0-the-model-spawned-one-teammate
 *        This reading is never red. The model's compliance is not a fact about the product, so a
 *        model that never called spawn_teammate (or called it twice, or was refused by name) leaves
 *        reading 0 NOT MEASURED and readings 1-2 NOT MEASURED with it - a named exit 3. Readings 3-5
 *        are still measured, because the pane, the world it draws and the rail this gate put back do
 *        not depend on the teammate existing.
 *
 * WHAT THIS GATE DOES NOT DO: no pixels or geometry beyond the pane's own box and text, no approval
 * driving, no second prompt, no restart of the client or the kernel (it NAMES a restart as a third
 * state instead), no writes into the ledger, no --self-attack over the product.
 *
 * THE LEASE. Other live gates drive the same client, so this gate claims the shell's panel lease
 * (POST /__shell/panel {op:"lease", leaseOp:"claim"}) before it touches anything, retries while
 * somebody else holds it for up to 180 s, and exits 3 naming the holder if it never gets it. The
 * release is part of reading 5, not housekeeping: it is read back and judged.
 *
 * --replay <file> judges a transcript this gate wrote (ZERO live reads: no shell call, no CDP, no
 * lease), which is how the verdict can be re-taken without spending a round. The transcript is
 * written to %TEMP%/r198-g134-teams-pane-truth/ by default (--dump <file> to put it elsewhere); this
 * gate writes no file inside the repository.
 *
 * Exit 0 all readings held | 1 a measured reading failed | 3 this gate could not measure here: the
 * shell, the kernel route or the CDP page is not there, another live consumer holds the lease, the
 * shell API declined (no session, prompt refused), the round never ended, the pane could not be
 * reached, or the model did not spawn the teammate the message named. A reading that cannot be
 * measured is a named third state, never green.
 *
 * Usage: node scripts/verify-teams-pane-truth.mjs [--port 31761] [--kernel-port 31760]
 *          [--cdp-port 9222] [--deadline-ms 240000] [--lease-wait-ms 180000]
 *          [--dump <file>] [--replay <file>]
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { callEndpoint, requestJson } from './lib/http.mjs'
import { COLUMN_PROBE, connect as connectCdp } from './cdp-drive.mjs'

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}

const PORT = Number(option('--port', '31761'))
const KERNEL_PORT = Number(option('--kernel-port', '31760'))
const CDP_PORT = Number(option('--cdp-port', '9222'))
const REPLAY_PATH = option('--replay', null)
const DUMP_OPTION = option('--dump', null)
const DEADLINE_MS = Number(option('--deadline-ms', '240000'))
const LEASE_WAIT_MS = Number(option('--lease-wait-ms', '180000'))
/** The lease outlives the whole run on purpose: a gate that dies must not leave the next one waiting. */
const LEASE_TTL_MS = 420000
const POLL_MS = 3000
/** The pane re-reads the route on its own timer (plugins/dsh-link-teams/src/client/index.tsx:53). */
const PANE_POLL_MS = 2000
const ORIGIN = 'http://127.0.0.1:' + String(PORT)
const ROUTE = '/api/dsh-link-teams/state'
const HOLDER = 'verify-teams-pane-truth'
const LEDGER_FILE = 'control.jsonl'
/** The pane's own title, the tab kind the guide entry carries, and the tree card's header. */
const TAB_TITLE = '智能体团队'
const TAB_KIND = 'link-teams'
const TREE_TITLE = '团队树（分形）'
const RAIL_OPEN_LABEL = '打开右侧边栏'
const RAIL_CLOSE_LABEL = '收起右侧边栏'
/** The tool the one message asks for, and the fixture naming contract src/world.ts withholds. */
const SPAWN_TOOL = 'spawn_teammate'
const FIXTURE_ID = /^(?:gate-|r18(?:\d|x)-)/i
const SCHEMA = 'r198-g134-transcript/1'

const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const show = (value) => {
  try {
    const text = JSON.stringify(value === undefined ? null : value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}
const clip = (text, width) => {
  const value = String(text === undefined || text === null ? '' : text)
  return value.length <= width ? value : value.slice(0, width) + '...'
}
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)

/** One pwsh read, and one identity: a client RESTART is a third state, never a silent world change. */
const pwshOnce = (command, timeoutMs = 30000) => {
  try {
    return spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
  } catch (error) {
    return { status: -1, stdout: '', stderr: describe(error) }
  }
}

/** The identity of the desktop client: pid@start-time. Gate 117's rule, and this gate pays one call for it. */
const clientIdentity = () => {
  const done = pwshOnce("[string](Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id.ToString() + '@' + $_.StartTime.ToUniversalTime().ToString('o') })")
  if (done.status !== 0) return null
  const text = String(done.stdout ?? '').trim()
  return text === '' ? null : text
}

class NotMeasured extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'NotMeasured'
  }
}

/** The teammate name this run asks for: unique per session, lower-kebab-case as the tool requires. */
const teammateName = 'g134-witness-' + Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')

/** THE one message. It names the tool, the arguments and the stop condition - nothing else. */
const MESSAGE = [
  '这是一次产品自检，只做一件事，不要做别的：请调用一次 spawn_teammate（只要这一次）。',
  '参数严格如下：name = "' + teammateName + '"，description = "R198 gate 134 witness"，prompt = "只回复 done，不要调用任何工具，也不要再派生任何人。"',
  '它返回之后，用一句话说明它返回了什么，然后立刻停止：不要再调用 spawn_teammate，也不要调用其它工具。',
].join('\n')

// ---------------------------------------------------------------------------
// Measurement: the ledger file, the route and the shell's own API
// ---------------------------------------------------------------------------

/**
 * Every string a control row can use to name a team.
 *
 * The recorder copies the kernel's own teamId into the row's actor and the member/task id into its
 * subject (plugins/dsh-link-collab/src/index.ts:7046-7135), so a row is attributed from the row
 * ITSELF and never from "it appeared while we were running".
 */
const rowNames = (row) => {
  const payload = row !== null && typeof row === 'object' && row.payload !== null && typeof row.payload === 'object' ? row.payload : {}
  const out = []
  for (const key of ['actor', 'subject']) {
    if (typeof row[key] === 'string' && row[key] !== '') out.push({ field: key, value: row[key] })
  }
  for (const key of ['team', 'id', 'name', 'senderId', 'targetId', 'from', 'to', 'owner']) {
    if (typeof payload[key] === 'string' && payload[key] !== '') out.push({ field: 'payload.' + key, value: payload[key] })
  }
  return out
}

/**
 * Does this string carry the session id? The team the kernel composes for a session is named by that
 * session's id on this machine (measured: every team node in the live tree is a session id), so the
 * three forms below are one rule: equal, prefixed, or containing.
 */
const carriesSession = (value, sessionId) =>
  typeof value === 'string' && value !== '' && typeof sessionId === 'string' && sessionId !== ''
    && (value === sessionId || value.startsWith(sessionId) || value.includes(sessionId))

/** Read and count <directory>/control.jsonl. The gate's own arithmetic, never the payload's. */
const readLedger = (directory) => {
  if (typeof directory !== 'string' || directory === '') {
    return { ok: false, path: null, rows: null, parsed: [], unreadable: 0, maxSeq: null, why: 'the route named no ledger directory' }
  }
  const path = join(directory, LEDGER_FILE)
  try {
    const text = readFileSync(path, 'utf8')
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
    const parsed = []
    let unreadable = 0
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line))
      } catch {
        unreadable += 1
      }
    }
    const seqs = parsed.map((row) => Number(row?.seq)).filter((seq) => Number.isFinite(seq))
    return { ok: true, path, rows: lines.length, parsed, unreadable, maxSeq: seqs.length === 0 ? null : Math.max.apply(null, seqs), why: null }
  } catch (error) {
    return { ok: false, path, rows: null, parsed: [], unreadable: 0, maxSeq: null, why: describe(error) }
  }
}

const readRoute = async (port) => {
  try {
    const reply = await requestJson('http://127.0.0.1:' + String(port) + ROUTE, { method: 'GET' })
    let body = null
    try {
      body = JSON.parse(reply.text)
    } catch {
      body = null
    }
    return { port, status: reply.status, body, ok: reply.status === 200 && body !== null && body.ok === true, why: null }
  } catch (error) {
    return { port, status: 0, body: null, ok: false, why: describe(error) }
  }
}

/** One call through the shell's own api, in the shell's own envelope. */
const callApi = async (method, args) => {
  try {
    return { ok: true, value: await callEndpoint(ORIGIN, method, args), why: null }
  } catch (error) {
    return { ok: false, value: null, why: describe(error) }
  }
}

const sessionRows = async () => {
  const answer = await callApi('session/list', { _request: {} })
  if (answer.ok !== true) return { ok: false, rows: [], count: 0, why: answer.why }
  const items = Array.isArray(answer.value?.items) ? answer.value.items : []
  return {
    ok: true,
    count: items.length,
    rows: items.map((item) => ({
      sessionId: String(item?.sessionId ?? ''),
      asOfSeq: Number(item?.projections?.asOfSeq ?? 0),
      running: item?.running === true,
      blank: item?.blank === true,
    })),
    why: null,
  }
}

/** The lease, in the shell's own words. A claim by somebody else is refused BY NAME (sidebar_panel.rs:836-839). */
const leaseCall = async (payload) => {
  try {
    const reply = await requestJson(ORIGIN + '/__shell/panel', { body: { op: 'lease', ...payload } })
    let body = null
    try {
      body = JSON.parse(reply.text)
    } catch {
      body = null
    }
    return {
      status: reply.status,
      lease: body !== null && body.lease !== undefined ? body.lease : null,
      error: body !== null && typeof body.error === 'string' ? body.error : null,
    }
  } catch (error) {
    return { status: 0, lease: null, error: describe(error) }
  }
}

/**
 * Claim the lease, waiting while another live gate holds it.
 *
 * The refusal names the holder ("the panel is leased by <holder>"), and that name is what this gate
 * reports when the wait is up: the next action belongs to whoever is holding it.
 */
const claimLease = async (progress) => {
  const startedAt = Date.now()
  const until = startedAt + LEASE_WAIT_MS
  let last = null
  let waited = 0
  while (Date.now() < until) {
    const answer = await leaseCall({ leaseOp: 'claim', holder: HOLDER, ttlMs: LEASE_TTL_MS })
    const held = answer.lease !== null && answer.lease.held === true && answer.lease.holder === HOLDER
    if (held === true) return { held: true, waitedMs: Date.now() - startedAt, holder: null, fatal: null }
    last = answer
    const holder = answer.lease !== null && typeof answer.lease.holder === 'string' ? answer.lease.holder : null
    const busy = answer.error !== null && answer.error.includes('leased by')
    if (busy !== true) {
      // Not a competing gate: the shell refused for another reason, or answered something this gate
      // cannot read. That is a world this gate declines, not a lease to wait out.
      return { held: false, waitedMs: Date.now() - startedAt, holder, fatal: answer.error === null ? ('the lease claim answered status ' + String(answer.status) + ' with no holder') : answer.error }
    }
    if (progress.length === 0) progress.push('the panel lease is held by ' + show(holder) + '; this gate waits for it (up to ' + String(LEASE_WAIT_MS) + ' ms)')
    await sleep(POLL_MS)
    waited = Date.now() - startedAt
  }
  const holder = last !== null && last.lease !== null && typeof last.lease.holder === 'string' ? last.lease.holder : null
  return { held: false, waitedMs: waited, holder, fatal: null }
}

// ---------------------------------------------------------------------------
// Measurement: the pane, through CDP, the way a user gets there
//
// The probes are real functions shipped into the page through toString(), the way cdp-drive.mjs does
// it: the labels are Chinese and the expressions are full of quotes, and quoting an expression by
// hand is how a probe silently stops matching.
// ---------------------------------------------------------------------------

/** One DOM read of the rail: the column, the tab chips, the + control, the guide entries. */
function railProbe(title) {
  const box = (node) => { const b = node.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
  const want = String(title)
  const col = document.querySelector('[data-rightbar-col]')
  const tabs = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]')).map((tab) => {
    const node = tab.querySelector('[data-dockkit-tab-title]')
    // R381: the chip's own close control, so a restore can close the tab this gate opened with a REAL click (the
    // guide-entry door replaces the guide chip, and closing the opened tab is what puts the guide world back).
    const shut = tab.querySelector('[data-dockkit-tab-close]')
    return { tab: tab.getAttribute('data-dockkit-tab'), title: node === null ? null : node.textContent, sel: tab.getAttribute('aria-selected') === 'true', box: box(tab), close: shut === null ? null : box(shut) }
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

/**
 * One DOM read of the pane body, of the count chips in its head, and of the tree it drew.
 *
 * The chip is read as a TOKEN rather than as a number somewhere in the text: the pane's head carries
 * one chip per count (member / task / team / record, client/view.ts:154-164) and this build has
 * exactly two spellings of the one this reading is about. The tree's rows are read STRUCTURALLY -
 * the card whose own first text run is the tree header, then one row per node, each row's first span
 * carrying that node's id as its title attribute - so "how many teams are on screen" is counted from
 * the drawing and not from a sentence.
 */
function paneProbe(title, treeTitle) {
  const box = (node) => { const b = node.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
  const want = String(title)
  const treeWant = String(treeTitle)
  const tabs = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]'))
  const titles = tabs.map((tab) => { const node = tab.querySelector('[data-dockkit-tab-title]'); return node === null ? null : node.textContent })
  const match = tabs.filter((tab, index) => titles[index] !== null && String(titles[index]).includes(want))
  const selected = match.filter((tab) => tab.getAttribute('aria-selected') === 'true')[0] || null
  const target = selected === null ? (match[0] || null) : selected
  const id = target === null ? null : target.getAttribute('data-dockkit-tab')
  const content = id === null ? null : document.querySelector('[data-dockkit-content="' + id + '"]')
  const text = content === null ? null : String(content.innerText === undefined ? content.textContent : content.innerText)
  const chips = []
  if (text !== null) {
    const pattern = /(?:团队|Teams)[ \u00a0]+(\d+)/g
    let found = pattern.exec(text)
    while (found !== null) {
      chips.push({ token: found[0], n: Number(found[1]) })
      found = pattern.exec(text)
    }
  }
  const tree = { header: false, rows: [] }
  if (content !== null) {
    const every = Array.from(content.querySelectorAll('div'))
    const header = every.filter((node) => node.firstChild !== null && node.firstChild.nodeType === 3 && String(node.firstChild.data).trim() === treeWant)[0] || null
    if (header !== null) {
      tree.header = true
      const card = header.parentElement
      // R283: a row is drawn when the card holds a `.dlt-treeRow` carrying an id title - whether it sits in the main list
      // or inside the pane's own fold for the teams that only appear in task/member rows. A COLLAPSED FOLD IS STILL A
      // DRAWN ROW (one click away, and in the DOM the whole time), and the reading's claim is "the pane draws the teams
      // the route serves", not "the pane prints them all expanded".
      const rows = card === null ? [] : Array.from(card.querySelectorAll('.dlt-treeRow')).filter((node) => node.firstElementChild !== null && node.firstElementChild.tagName === 'SPAN' && node.firstElementChild.hasAttribute('title'))
      for (const row of rows) {
        const label = row.firstElementChild
        const labelText = String(label.textContent === undefined ? '' : label.textContent)
        tree.rows.push({
          id: label.getAttribute('title'),
          label: labelText,
          chips: Array.from(row.querySelectorAll('span')).map((span) => String(span.textContent === undefined ? '' : span.textContent)).filter((one) => one !== labelText),
        })
      }
    }
  }
  return JSON.stringify({
    found: match.length > 0,
    selected: selected !== null,
    tab: id,
    titles: titles.filter((value) => value !== null),
    box: content === null ? null : box(content),
    text: text === null ? null : text.slice(0, 6000),
    textLength: text === null ? null : text.length,
    chips,
    tree,
  })
}

const RAIL_STATE = '(' + railProbe.toString() + ')(' + JSON.stringify(TAB_TITLE) + ')'
const PANE_READ = '(' + paneProbe.toString() + ')(' + JSON.stringify(TAB_TITLE) + ', ' + JSON.stringify(TREE_TITLE) + ')'

const centre = (box) => ({ x: box[0] + Math.round(box[2] / 2), y: box[1] + Math.round(box[3] / 2) })

/** The pane anchor and the column, read as the RESTORE's result. */
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
 * Put the rail back the way this gate FOUND it, as a reading and not as housekeeping (R181-C
 * measured what leaving it costs: the world the next gate reads is the one this gate created).
 */
const restoreRail = async (cdp, entry, progress) => {
  const rail = async () => {
    const seen = await cdp.json(RAIL_STATE)
    return seen.ok === true ? seen.value : null
  }
  const notes = []
  let state = await rail()
  if (state === null || state.tabs === undefined) return { ok: null, wanted: entry.title, on: null, why: 'the rail probe did not answer, so the rail could not be put back', notes }
  if (entry.tab === null) {
    return { ok: null, wanted: null, on: null, why: 'the rail had no selected tab when this gate started, so there was no selection to put back', notes }
  }
  const target = state.tabs.filter((tab) => tab.tab === entry.tab)[0]
  if (target === undefined) {
    // R381: the tab this gate found selected was the GUIDE, and picking a guide entry REPLACES it - so the entry tab is
    // gone by construction, not by accident. Closing the tab this gate opened empties the pane and the shipped guide
    // re-seeds itself as the sole docked tab: that IS the world this gate found, and this is how it gets it back.
    const opened = state.tabs.filter((tab) => String(tab.title || '').includes(TAB_TITLE))[0]
    if (opened !== undefined && opened.close !== null && opened.close !== undefined) {
      notes.push('the entry tab ' + show(entry.title) + ' was replaced by the guide entry, so the restore closes the tab this gate opened (' + show(opened.title) + ') through its own close control at ' + show(opened.close))
      if (opened.sel !== true) {
        await cdp.click(centre(opened.box))
        await sleep(600)
      }
      await cdp.click(centre(opened.close))
      const backUntil = Date.now() + 9000
      while (Date.now() < backUntil) {
        await sleep(500)
        state = await rail()
        if (state === null) break
        if (state.tabs.some((tab) => String(tab.title || '').includes(TAB_TITLE)) !== true) break
      }
      // R381: an emptied pane does NOT re-seed the guide by itself (measured: the rail stayed at [] for 2.5 s after the
      // last chip was closed). The shipped collapse/expand pair is what brings it back, so the restore uses it - the same
      // two controls a person would.
      let guideBack = state === null ? false : state.tabs.some((tab) => String(tab.title || '').includes('开始'))
      if (guideBack !== true) {
        const controls = await cdp.json(COLUMN_PROBE)
        const found = controls.ok === true ? (controls.value.buttons || []) : []
        const collapse = found.filter((row) => row.label === RAIL_CLOSE_LABEL)[0]
        const expand = found.filter((row) => row.label === RAIL_OPEN_LABEL)[0]
        if (collapse !== undefined) {
          await cdp.click({ x: collapse.x, y: collapse.y })
          notes.push('the emptied pane held no guide, so the restore collapsed the rail (' + show(RAIL_CLOSE_LABEL) + ')')
          await sleep(1200)
          const again = await cdp.json(COLUMN_PROBE)
          const reopen = again.ok === true ? (again.value.buttons || []).filter((row) => row.label === RAIL_OPEN_LABEL)[0] : undefined
          if (reopen !== undefined) {
            await cdp.click({ x: reopen.x, y: reopen.y })
            notes.push('and expanded it again (' + show(RAIL_OPEN_LABEL) + '), which is what re-seeds the guide')
          }
          const until = Date.now() + 8000
          while (Date.now() < until) {
            await sleep(500)
            state = await rail()
            if (state === null) break
            if (state.tabs.some((tab) => String(tab.title || '').includes('开始'))) break
          }
          guideBack = state === null ? false : state.tabs.some((tab) => String(tab.title || '').includes('开始'))
        } else if (expand !== undefined) {
          await cdp.click({ x: expand.x, y: expand.y })
          await sleep(1500)
          state = await rail()
          guideBack = state === null ? false : state.tabs.some((tab) => String(tab.title || '').includes('开始'))
        }
      }
      notes.push('after closing it the rail holds ' + show(state === null ? null : state.tabs.map((tab) => tab.title)) + ' (guide back = ' + String(guideBack) + ')')
      return { ok: guideBack === true, wanted: entry.title, on: state === null ? null : (state.tabs.filter((tab) => tab.sel === true)[0] || {}).title || null, why: guideBack === true ? null : 'the tab this gate opened was closed but the guide did not come back', notes }
    }
    return { ok: false, wanted: entry.title, on: (state.tabs.filter((tab) => tab.sel === true)[0] || {}).title || null, why: 'the tab this gate found selected (' + show(entry.title) + ' / ' + show(entry.tab) + ') is no longer in the rail, so the selection it found cannot be put back', notes }
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
  await sleep(1200)
  const seen = await cdp.json(AFTER_READ)
  const after = seen.ok === true ? seen.value : null
  const selected = state === null ? [] : state.tabs.filter((tab) => tab.sel === true)
  const on = selected.length === 0 ? null : selected[0].title
  if (selected.length === 0) notes.push('the rail now reports no selected tab at all')
  for (const note of notes) progress.push('restore: ' + note)
  return {
    ok: selected.length === 1 && selected[0].tab === entry.tab,
    wanted: entry.title,
    on,
    entry: { tab: entry.tab, title: entry.title, columnWidth: entry.columnWidth, collapsed: entry.collapsed },
    columnWidth,
    surfaceCount: after === null ? null : after.surfaceCount,
    anchor: after === null ? null : after.anchor,
    notes,
  }
}

/**
 * Open the teams tab the way a user opens one, read the pane, then put the rail back.
 *
 * The pane is read against the ROUTE snapshot this gate took a moment earlier: the pane re-reads the
 * route on its own 2 s timer, so a read can be one poll stale, and this gate waits for the next poll
 * (bounded) rather than reading a number it knows is behind. The final read is the one judged.
 */
const collectPane = async (cdp, treeIds) => {
  const progress = []
  const rail = async () => {
    const seen = await cdp.json(RAIL_STATE)
    return seen.ok === true ? seen.value : null
  }
  let state = await rail()
  if (state === null) return { skip: 'the page probe did not answer, so the right rail could not be read', progress }
  if (state.column === null) return { skip: 'this client is showing a screen without the right rail ([data-rightbar-col] is absent, i.e. no session is open)', progress }
  const selectedAtEntry = state.tabs.filter((tab) => tab.sel === true)[0] || null
  const entry = {
    columnWidth: state.column[2],
    collapsed: state.column[2] < 400,
    tab: selectedAtEntry === null ? null : selectedAtEntry.tab,
    title: selectedAtEntry === null ? null : selectedAtEntry.title,
    tabs: state.tabs.map((tab) => tab.title),
  }
  progress.push('entry rail: ' + show(state.column) + 'px wide, selected tab ' + show(entry.title) + ' (' + show(entry.tab) + '), tab titles ' + show(entry.tabs))
  if (state.column[2] < 400) {
    const seen = await cdp.json(COLUMN_PROBE)
    const button = seen.ok === true ? (seen.value.buttons || []).filter((row) => row.label === RAIL_OPEN_LABEL)[0] : undefined
    if (button === undefined) return { skip: 'the right rail is collapsed and the page offers no ' + show(RAIL_OPEN_LABEL) + ' control, so the pane could not be reached the way a user reaches it', entry, progress }
    progress.push('the rail started collapsed (' + String(state.column[2]) + 'px wide); the gate clicked ' + show(RAIL_OPEN_LABEL))
    await cdp.click({ x: button.x, y: button.y })
    const until = Date.now() + 8000
    while (Date.now() < until) {
      await sleep(500)
      state = await rail()
      if (state !== null && state.column !== null && state.column[2] >= 400) break
    }
  }
  /**
   * Activate the teams tab and CONFIRM it is selected.
   *
   * Measured in this round: one press/release pair sent at the chip's centre left the tab unselected
   * for the whole 12 s read window (the pane body stayed the inactive placeholder, 0x0 with no text),
   * while the identical click taken by hand a minute later selected it. A gate that cannot tell "the
   * pane never mounted" from "the pane drew the wrong world" would judge the second as the first, so
   * the activation is verified and retried, and every attempt carries the geometry it used.
   */
  const activate = async () => {
    const attempts = []
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      state = await rail()
      if (state === null) return { ok: false, attempts, why: 'the rail probe stopped answering while the teams tab was being opened' }
      const tab = state.tabs.filter((candidate) => String(candidate.title || '').includes(TAB_TITLE))[0] || null
      if (tab === null) return { ok: false, attempts, why: 'no tab whose title contains ' + show(TAB_TITLE) + ' exists on the rail (titles: ' + show(state.tabs.map((one) => one.title)) + ')' }
      if (tab.sel === true) return { ok: true, attempts, tab: tab.tab, box: tab.box }
      const spot = centre(tab.box)
      attempts.push({ at: Date.now(), tab: tab.tab, box: tab.box, spot })
      // A whole gesture: move, press, release (a press/release pair with no move before it is the
      // shape a client surface can swallow).
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y, button: 'none', buttons: 0, pointerType: 'mouse' })
      await sleep(120)
      await cdp.click(spot)
      await sleep(1300)
      const after = await rail()
      if (after !== null && after.tabs.some((one) => one.tab === tab.tab && one.sel === true)) return { ok: true, attempts, tab: tab.tab, box: tab.box }
    }
    return { ok: false, attempts, why: 'the ' + show(TAB_TITLE) + ' tab exists but never became selected after ' + String(attempts.length) + ' activation attempt(s) at ' + show(attempts.map((one) => one.spot)) }
  }

  const existing = state === null ? null : (state.tabs.filter((tab) => String(tab.title || '').includes(TAB_TITLE))[0] || null)
  let via = existing === null ? 'rail-plus-then-guide-entry' : 'existing-tab'
  if (existing === null) {
    // R381: the strip's add control exists only on an EMPTY pane (measured in R377: a rail holding any chip offers no
    // [data-dockkit-add-tab] at all), so requiring it made this gate decline in every ordinary world. The guide tab
    // carries the same entry list a person uses when the + is not there: select it, then click the entry.
    if (state === null || state.add === null) {
      const guideTab = state === null ? null : (state.tabs.filter((tab) => String(tab.title || '').includes('开始'))[0] || null)
      if (guideTab === null) return { skip: 'the rail offers neither a [data-dockkit-add-tab] control nor a guide tab, so the ' + show(TAB_TITLE) + ' pane cannot be opened the way a user opens one', entry, progress }
      progress.push('no ' + show(TAB_TITLE) + ' tab and no + control; the gate selects the guide tab and will click the ' + show(TAB_KIND) + ' entry')
      await cdp.click(centre(guideTab.box))
      await sleep(900)
      let entryBox = null
      const listedByGuide = Date.now() + 6000
      while (Date.now() < listedByGuide) {
        await sleep(350)
        const now = await rail()
        if (now === null) break
        const hit = now.entries.filter((candidate) => candidate.kind === TAB_KIND)[0]
        if (hit !== undefined) { entryBox = hit.box; break }
      }
      if (entryBox === null) return { skip: 'the guide tab listed no ' + show(TAB_KIND) + ' entry, so the ' + show(TAB_TITLE) + ' pane could not be opened', entry, progress }
      progress.push('the guide tab listed a ' + show(TAB_KIND) + ' entry at ' + show(entryBox) + '; the gate clicked its centre')
      await cdp.click(centre(entryBox))
      await sleep(600)
      via = 'guide-tab-entry'
    } else {
      progress.push('no ' + show(TAB_TITLE) + ' tab existed; the gate clicked the rail + control and will pick the ' + show(TAB_KIND) + ' guide entry')
      await cdp.click(centre(state.add))
      let guide = null
      const listed = Date.now() + 6000
      while (Date.now() < listed) {
        await sleep(400)
        state = await rail()
        if (state === null) break
        guide = state.entries.filter((candidate) => candidate.kind === TAB_KIND)[0] || null
        if (guide !== null || state.titled.length > 0) break
      }
      if (guide !== null) {
        progress.push('the + control listed a ' + show(TAB_KIND) + ' guide entry at ' + show(guide.box) + '; the gate clicked its centre')
        await cdp.click(centre(guide.box))
        await sleep(600)
      } else if (state !== null && state.titled.length === 0) {
        return { skip: 'clicking + produced neither a ' + show(TAB_KIND) + ' guide entry nor a ' + show(TAB_TITLE) + ' tab, so the pane could not be opened', entry, progress }
      }
    }
  } else if (existing.sel !== true) {
    progress.push('a ' + show(TAB_TITLE) + ' tab already existed (' + String(existing.tab) + ') and was not selected; the gate clicks its chip')
  } else {
    via = 'existing-tab-selected'
    progress.push('a selected ' + show(TAB_TITLE) + ' tab was already on screen; nothing had to be clicked')
  }
  const activated = await activate()
  if (activated.ok !== true) {
    const back = await restoreRail(cdp, entry, progress)
    return { skip: activated.why, entry, restored: back, progress, activation: activated }
  }
  progress.push('the ' + show(TAB_TITLE) + ' tab is selected (' + show(activated.tab) + ') after ' + String(activated.attempts.length) + ' click(s)')
  // Read the pane against the route this gate just took, waiting out the pane's own poll timer.
  const treeLength = treeIds === null ? null : treeIds.length
  const history = []
  let pane = null
  const until = Date.now() + Math.max(14000, PANE_POLL_MS * 3)
  while (Date.now() < until) {
    const seen = await cdp.json(PANE_READ)
    pane = seen.ok === true ? seen.value : null
    if (pane !== null && typeof pane.text === 'string' && pane.text !== '') {
      const chip = pane.chips.length === 0 ? null : pane.chips[0].n
      history.push({ at: Date.now(), chip, drawn: pane.tree.rows.length, text: pane.textLength })
      if (pane.selected === true && treeLength !== null && chip === treeLength && pane.tree.rows.length === treeLength) break
    }
    await sleep(PANE_POLL_MS / 2)
  }
  const restored = await restoreRail(cdp, entry, progress)
  if (pane === null) return { skip: 'the pane read did not answer, so nothing about the pane could be measured', entry, restored, progress }
  if (restored.ok === false) progress.push('the restore FAILED: ' + show(restored.on) + ' instead of ' + show(restored.wanted))
  return { skip: null, via, entry, restored, progress, pane, history, railTitles: state === null ? null : state.tabs.map((tab) => tab.title) }
}

// ---------------------------------------------------------------------------
// The measured world: claim, one session, one prompt, read the log, open the pane, put it back
// ---------------------------------------------------------------------------

const readSessionPage = async (sessionId) => {
  const list = await sessionRows()
  if (list.ok !== true) return { ok: false, page: null, asOfSeq: 0, why: list.why }
  const row = list.rows.filter((one) => one.sessionId === sessionId)[0] || null
  if (row === null || row.asOfSeq === 0) return { ok: true, page: null, asOfSeq: 0, why: null }
  const answer = await callApi('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: row.asOfSeq, maxMessages: 800 } })
  if (answer.ok !== true) return { ok: false, page: null, asOfSeq: row.asOfSeq, why: answer.why }
  return { ok: true, page: answer.value ?? null, asOfSeq: row.asOfSeq, why: null }
}

/** The events of one session log, folded to the two things this gate reads: calls and their results. */
const foldLog = (page) => {
  const records = Array.isArray(page?.records) ? page.records : []
  const events = records.map((record) => record?.event).filter((event) => event !== null && typeof event === 'object')
  const textOf = (message) => {
    const content = Array.isArray(message?.content) ? message.content : []
    return content.map((part) => (part?.type === 'text' ? String(part.text ?? '') : '[' + String(part?.type) + ']')).join('\n')
  }
  const calls = events
    .filter((event) => event.type === 'tool/call')
    .map((event) => ({
      seq: Number(event.seq ?? -1),
      turn: Number(event.data?.turn ?? -1),
      step: Number(event.data?.step ?? -1),
      name: String(event.data?.name ?? ''),
      arguments: clip(String(event.data?.arguments ?? ''), 400),
      callId: String(event.data?.callId ?? ''),
    }))
  const results = events
    .filter((event) => event.type === 'tool/result')
    .map((event) => ({
      seq: Number(event.seq ?? -1),
      callId: String(event.data?.message?.toolCallId ?? ''),
      isError: event.data?.message?.isError === true,
      text: clip(textOf(event.data?.message), 600),
    }))
  const turnEnds = events.filter((event) => event.type === 'turn/end')
  const last = turnEnds[turnEnds.length - 1] ?? null
  return {
    records: records.length,
    calls,
    results,
    turnEnded: last !== null,
    turnEnd: last === null ? null : { seq: Number(last.seq ?? -1), kind: String(last.data?.reason?.kind ?? '') },
    assistantTexts: events.filter((event) => event.type === 'assistant/message').map((event) => clip(textOf(event.data?.message), 200)).filter((one) => one !== ''),
  }
}

const runWorld = async (bag) => {
  const transcript = {
    schema: SCHEMA,
    startedAt: new Date().toISOString(),
    port: PORT,
    kernelPort: KERNEL_PORT,
    cdpPort: CDP_PORT,
    shellOrigin: ORIGIN,
    route: ROUTE,
    holder: HOLDER,
    message: MESSAGE,
    teammateName,
    progress: [],
    lease: { claim: null, after: null },
    entry: { at: null, client: null, route: null, routeKernel: null, ledger: null, sessions: null },
    session: { sessionId: null, created: false, requestId: null, promptCount: 0, accepted: null, polls: 0, deadlineMs: DEADLINE_MS, log: null },
    ledger: { before: null, after: null, waitedMs: null, attributed: [], newRows: [] },
    routeAfter: null,
    pane: null,
    exit: { at: null, client: null, sessions: null },
    notes: [],
    problems: [],
  }
  bag.transcript = transcript
  const progress = transcript.progress

  // --- the lease: the coordination, taken before this gate touches anything -------------------------
  const claim = await claimLease(progress)
  transcript.lease.claim = { held: claim.held, waitedMs: claim.waitedMs, holder: claim.holder, fatal: claim.fatal }
  if (claim.held !== true) {
    if (claim.fatal !== null) throw new NotMeasured('the shell would not answer the lease claim: ' + String(claim.fatal))
    throw new NotMeasured('the panel lease is held by ' + show(claim.holder) + ' and was not released within ' + String(LEASE_WAIT_MS) + ' ms, so this gate would be reading somebody else\'s world')
  }
  progress.push('the panel lease is held by ' + HOLDER + ' (waited ' + String(claim.waitedMs) + ' ms)')

  const cdp = await connectCdp({ port: CDP_PORT })
  if (cdp === null) throw new NotMeasured('CDP on port ' + String(CDP_PORT) + ' has no page target, so the right rail cannot be read')
  transcript.page_url = cdp.page
  transcript.entry.client = clientIdentity()

  try {
    // --- the world this gate found ---------------------------------------------------------------
    transcript.entry.at = new Date().toISOString()
    transcript.entry.routeKernel = await readRoute(KERNEL_PORT)
    transcript.entry.route = await readRoute(PORT)
    if (transcript.entry.route.ok !== true) {
      throw new NotMeasured('GET ' + ROUTE + ' on the shell port answered status=' + String(transcript.entry.route.status) + (transcript.entry.route.why === null ? '' : ' (' + transcript.entry.route.why + ')') + ', so there is no live teams surface to judge')
    }
    if (transcript.entry.routeKernel.ok !== true) {
      throw new NotMeasured('GET ' + ROUTE + ' on the kernel port ' + String(KERNEL_PORT) + ' answered status=' + String(transcript.entry.routeKernel.status) + ', so the surface the pane polls is not up')
    }
    const directory = transcript.entry.route.body?.ledger?.directory ?? null
    const before = readLedger(directory)
    transcript.entry.ledger = { ok: before.ok, path: before.path, rows: before.rows, maxSeq: before.maxSeq, unreadable: before.unreadable, why: before.why }
    if (before.ok !== true) {
      throw new NotMeasured('the control ledger this route names (' + show(directory) + ') could not be read: ' + String(before.why))
    }
    const entrySessions = await sessionRows()
    if (entrySessions.ok !== true) throw new NotMeasured('session/list could not be read, so the fingerprint of the world would be a guess: ' + String(entrySessions.why))
    transcript.entry.sessions = entrySessions
    progress.push('entry: route ' + String((transcript.entry.route.body?.teams?.teams ?? []).length) + ' tree node(s), ledger ' + String(before.rows) + ' row(s) at seq ' + show(before.maxSeq) + ', ' + String(entrySessions.count) + ' session(s) on record')

    // --- ONE session and ONE prompt ---------------------------------------------------------------
    const created = await callApi('session/create', { request: {} })
    const sessionId = created.ok === true ? String(created.value?.sessionId ?? '') : ''
    if (sessionId === '') {
      throw new NotMeasured('the shell declined to create the session this gate drives (' + show(created.ok === true ? created.value : created.why) + ')')
    }
    transcript.session.sessionId = sessionId
    transcript.session.created = true
    const requestId = crypto.randomUUID()
    transcript.session.requestId = requestId
    const accepted = await callApi('session/prompt', { request: { requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: MESSAGE }] } })
    transcript.session.promptCount += 1
    transcript.session.accepted = accepted.ok === true && accepted.value?.accepted === true
    if (transcript.session.accepted !== true) {
      throw new NotMeasured('the one prompt this gate sends was not accepted (' + show(accepted.ok === true ? accepted.value : accepted.why) + ')')
    }
    progress.push('one prompt sent to session ' + sessionId + ' (requestId ' + requestId + ')')

    // --- read-only from here: wait for the round to end, then keep the log -------------------------
    const until = Date.now() + DEADLINE_MS
    let page = null
    while (Date.now() < until) {
      transcript.session.polls += 1
      const read = await readSessionPage(sessionId)
      if (read.page !== null) {
        page = read.page
        const types = (page.records ?? []).map((record) => record?.event?.type)
        if (types.includes('turn/end') === true) break
      }
      await sleep(POLL_MS)
    }
    transcript.session.log = page === null ? null : foldLog(page)
    if (page === null) throw new NotMeasured('the session this gate created was polled ' + String(transcript.session.polls) + ' time(s) and had no readable log within ' + String(DEADLINE_MS) + ' ms')
    if (transcript.session.log.turnEnded !== true) {
      transcript.notes.push('NOT MEASURED in the world: the round logged ' + String(transcript.session.log.records) + ' event(s) but never reached turn/end within ' + String(DEADLINE_MS) + ' ms')
    }
    const spawnCalls = transcript.session.log.calls.filter((call) => call.name === SPAWN_TOOL)
    progress.push('the round ended: ' + String(transcript.session.log.records) + ' event(s), ' + String(spawnCalls.length) + ' ' + SPAWN_TOOL + ' call(s)')

    // --- the ledger the spawn wrote: the recorder appends fire-and-forget, so wait a bounded moment
    const ledgerUntil = Date.now() + 20000
    const attributedOf = (snapshot) => snapshot.ok !== true
      ? []
      : snapshot.parsed
        .filter((row) => Number(row?.seq) > (before.maxSeq ?? 0))
        .map((row) => ({
          seq: Number(row?.seq),
          kind: typeof row?.kind === 'string' ? row.kind : null,
          by: rowNames(row).filter((one) => carriesSession(one.value, sessionId)),
        }))
        .filter((row) => row.by.length > 0)
    let after = readLedger(directory)
    while (Date.now() < ledgerUntil && attributedOf(after).length === 0) {
      await sleep(1000)
      after = readLedger(directory)
    }
    transcript.ledger.waitedMs = Math.max(0, 20000 - (ledgerUntil - Date.now()))
    transcript.ledger.after = { ok: after.ok, path: after.path, rows: after.rows, maxSeq: after.maxSeq, unreadable: after.unreadable, why: after.why }
    transcript.ledger.newRows = after.ok === true
      ? after.parsed.filter((row) => Number(row?.seq) > (before.maxSeq ?? 0)).map((row) => ({ seq: Number(row?.seq), kind: typeof row?.kind === 'string' ? row.kind : null }))
      : []
    transcript.ledger.attributed = attributedOf(after)

    // --- the route, after the round ----------------------------------------------------------------
    transcript.routeAfter = await readRoute(PORT)
    const tree = transcript.routeAfter.body === null || transcript.routeAfter.body === undefined || transcript.routeAfter.body.teams === undefined ? null : transcript.routeAfter.body.teams
    const treeIds = tree !== null && Array.isArray(tree.teams) ? tree.teams.map((node) => String(node?.id ?? '')) : []
    progress.push('after the round: route ' + String(treeIds.length) + ' tree node(s), ledger ' + String(after.rows) + ' row(s), ' + String(transcript.ledger.attributed.length) + ' of the new row(s) carry the session id')

    // --- the pane: opened the way a user opens it, read, and put back ------------------------------
    transcript.pane = await collectPane(cdp, treeIds)
    for (const line of transcript.pane.progress ?? []) progress.push(line)
  } catch (error) {
    if (error instanceof NotMeasured) transcript.notes.push('NOT MEASURED in the world: ' + error.message)
    else transcript.problems.push('the drive stopped on an unexpected error: ' + describe(error) + (error?.stack === undefined ? '' : '\n' + String(error.stack).split('\n').slice(0, 4).join('\n')))
  } finally {
    // --- reading 5's two halves that are this gate's own to do: give the lease back, name the session
    try {
      await leaseCall({ leaseOp: 'release', holder: HOLDER })
      const read = await leaseCall({ leaseOp: 'status', holder: HOLDER })
      transcript.lease.after = read.lease === null ? null : { held: read.lease.held === true, holder: read.lease.holder ?? null, status: read.status, error: read.error }
      transcript.exit.sessions = await sessionRows()
      transcript.exit.client = clientIdentity()
      transcript.exit.at = new Date().toISOString()
      if (transcript.entry.client !== null && transcript.exit.client !== null && transcript.entry.client !== transcript.exit.client) {
        transcript.notes.push('NOT MEASURED in the world: the client was RESTARTED while this gate was running (' + String(transcript.entry.client) + ' -> ' + String(transcript.exit.client) + '), so the client this gate measured no longer exists')
      }
    } catch (error) {
      transcript.problems.push('the exit fingerprint could not be read: ' + describe(error))
    }
    try {
      cdp.close()
    } catch {
      /* a socket that is already gone is not a reading */
    }
  }
  return transcript
}

// ---------------------------------------------------------------------------
// The judge: a pure function of the transcript, so --replay re-takes the verdict
// ---------------------------------------------------------------------------

const OK = (detail, evidence) => ({ ok: true, notMeasured: false, detail, evidence: evidence || [] })
const BAD = (detail, evidence) => ({ ok: false, notMeasured: false, detail, evidence: evidence || [] })
const NA = (detail, evidence) => ({ ok: false, notMeasured: true, detail, evidence: evidence || [] })

const READING_IDS = [
  '0-the-model-spawned-one-teammate',
  '1-ledger-holds-a-row-of-the-real-team',
  '2-route-lists-the-real-team',
  '3-three-numbers-agree',
  '4-no-invented-world',
  '5-world-left-put-back',
]

const judge = (t) => {
  const readings = {}
  const sessionId = t?.session?.sessionId ?? null
  const log = t?.session?.log ?? null
  const spawnCalls = log === null ? [] : log.calls.filter((call) => call.name === SPAWN_TOOL)
  const spawnDriven = log !== null && spawnCalls.length === 1
  const spawnResult = (() => {
    if (spawnCalls.length === 0) return null
    const call = spawnCalls[0]
    const byId = call.callId === '' ? null : (log.results.filter((result) => result.callId !== '' && result.callId === call.callId)[0] ?? null)
    if (byId !== null) return byId
    return log.results.filter((result) => result.seq > call.seq).sort((left, right) => left.seq - right.seq)[0] ?? null
  })()

  // 0 ---------------------------------------------------------------- the drive's premise, never red
  {
    const id = READING_IDS[0]
    const evidence = [
      'session ' + show(sessionId) + ', prompt(s) sent ' + String(t?.session?.promptCount ?? 0) + ', accepted ' + show(t?.session?.accepted) + ', poll(s) ' + String(t?.session?.polls ?? 0),
      'tool/call event(s) in that session log: ' + show((log === null ? [] : log.calls).map((call) => ({ seq: call.seq, name: call.name }))),
      'the one message asks for exactly one ' + SPAWN_TOOL + ' named ' + show(t?.teammateName ?? null) + '; compliance is a fact about the model, so no branch of this reading is red',
    ]
    if (sessionId === null) readings[id] = NA('NOT MEASURED: this gate created no session, so no model round was paid for', evidence)
    else if (t.session.created !== true) readings[id] = NA('NOT MEASURED: the shell declined to create the session this gate drives', evidence)
    else if (log === null) readings[id] = NA('NOT MEASURED: the session log could not be read, so what the model did is unknown', evidence)
    else if (spawnCalls.length === 0) readings[id] = NA('NOT MEASURED: the model never called ' + SPAWN_TOOL + ' in the one round this gate paid for, so readings 1-2 have no drive', evidence)
    else if (spawnCalls.length > 1) readings[id] = NA('NOT MEASURED: the model called ' + SPAWN_TOOL + ' ' + String(spawnCalls.length) + ' times; this gate asked for exactly one, so which teammate is the witness is not decided', evidence)
    else if (spawnResult !== null && spawnResult.isError === true) readings[id] = NA('NOT MEASURED: ' + SPAWN_TOOL + ' was refused by name: ' + clip(spawnResult.text, 200), evidence)
    else readings[id] = OK('the model called ' + SPAWN_TOOL + ' exactly once (seq ' + String(spawnCalls[0].seq) + ') and the call was not refused: ' + clip(spawnResult === null ? '(no result row in the log yet)' : spawnResult.text, 160), evidence)
  }

  // 1 ---------------------------------------------------------------- the ledger, row by row
  {
    const id = READING_IDS[1]
    const before = t?.entry?.ledger ?? null
    const after = t?.ledger?.after ?? null
    const attributed = Array.isArray(t?.ledger?.attributed) ? t.ledger.attributed : []
    const newRows = Array.isArray(t?.ledger?.newRows) ? t.ledger.newRows : []
    const evidence = [
      'control.jsonl counted by this gate: ' + show(before === null ? null : before.path) + ' -> ' + show(before === null ? null : before.rows) + ' row(s) at entry (highest seq ' + show(before === null ? null : before.maxSeq) + '), ' + show(after === null ? null : after.rows) + ' row(s) after the round (highest seq ' + show(after === null ? null : after.maxSeq) + ')',
      'row(s) the round appended: ' + show(newRows.map((row) => ({ seq: row.seq, kind: row.kind }))),
      'row(s) of those that carry the session id ' + show(sessionId) + ': ' + show(attributed.map((row) => ({ seq: row.seq, kind: row.kind, by: row.by.map((one) => one.field + '=' + one.value) }))),
      'the attribution rule: a row is the real team\'s only when one of its OWN fields (actor / subject / payload team,id,name,senderId,targetId,from,to) equals, starts with or contains the id of the session this gate created - the kernel names a session\'s team with that session\'s id on this machine',
    ]
    if (spawnDriven !== true) readings[id] = NA('NOT MEASURED: the drive that would write the row did not happen (the model did not spawn exactly one teammate)', evidence)
    else if (before === null || before.ok !== true) readings[id] = NA('NOT MEASURED: the ledger could not be counted before the round, so "appended by this round" has no baseline', evidence)
    else if (after === null || after.ok !== true) readings[id] = NA('NOT MEASURED: the ledger could not be read after the round (' + show(after === null ? null : after.why) + ')', evidence)
    else if (attributed.length === 0) {
      readings[id] = BAD('the ledger gained ' + String(newRows.length) + ' row(s) after seq ' + show(before.maxSeq) + ' (' + show(newRows.map((row) => row.kind)) + ') and NONE of them names the real team ' + show(sessionId) + ': a new row is not an attributed row', evidence)
    } else readings[id] = OK('the ledger holds ' + String(attributed.length) + ' row(s) of the real team: first is seq=' + String(attributed[0].seq) + ' kind=' + show(attributed[0].kind) + ' via ' + attributed[0].by.map((one) => one.field).join('+'), evidence)
  }

  // 2 ---------------------------------------------------------------- the route's own tree
  {
    const id = READING_IDS[2]
    const after = t?.routeAfter ?? null
    const body = after === null ? null : after.body
    const tree = body !== null && body !== undefined && body.teams !== undefined ? body.teams : null
    const nodes = tree !== null && Array.isArray(tree.teams) ? tree.teams : []
    const matches = nodes.filter((node) => carriesSession(String(node?.id ?? ''), sessionId))
    const evidence = [
      'GET ' + ROUTE + ' on the shell port after the round: status=' + show(after === null ? null : after.status) + ' ok=' + show(body === null ? null : body.ok) + (after !== null && after.why !== null ? ' (' + after.why + ')' : ''),
      'teams.teams (' + String(nodes.length) + '): ' + show(nodes.map((node) => ({ id: node?.id, declared: node?.declared, observed: node?.observed, tasks: node?.tasks, members: node?.members }))),
      'the team this reading looks for: an id carrying ' + show(sessionId),
    ]
    if (spawnDriven !== true) readings[id] = NA('NOT MEASURED: no teammate was spawned by the drive, so no team of this session could appear in the tree', evidence)
    else if (after === null || after.status === 0) readings[id] = NA('NOT MEASURED: the route did not answer after the round (' + show(after === null ? null : after.why) + ')', evidence)
    else if (after.ok !== true) readings[id] = BAD('GET ' + ROUTE + ' answered status=' + String(after.status) + ' ok=' + show(body === null ? null : body.ok) + ', so the surface the pane polls is not serving a world at all', evidence)
    else if (matches.length === 0) readings[id] = BAD('the route lists ' + String(nodes.length) + ' team(s) ' + show(nodes.map((node) => node?.id)) + ' and NONE of them carries the session prefix ' + show(sessionId) + ': the real team is absent from the tree', evidence)
    else readings[id] = OK('the route lists the real team ' + show(matches.map((node) => node.id)) + ' (declared ' + show(matches.map((node) => node.declared)) + ', observed ' + show(matches.map((node) => node.observed)) + ')', evidence)
  }

  // 3 ---------------------------------------------------------------- four numbers, one world
  {
    const id = READING_IDS[3]
    const after = t?.routeAfter ?? null
    const body = after === null ? null : after.body
    const tree = body !== null && body !== undefined && body.teams !== undefined ? body.teams : null
    const nodes = tree !== null && Array.isArray(tree.teams) ? tree.teams : []
    const routeTree = nodes.length
    const routeCounts = body !== null && body !== undefined && body.counts !== undefined && body.counts !== null ? body.counts.teams : null
    const pane = t?.pane ?? null
    // R277: `pane.pane` is an OPTIONAL property of the transcript, so a pane that was never read leaves it
    // ABSENT - and the twelve readings below ask `read === null`. That test is false for undefined, so the
    // very first one (`!Array.isArray(read.chips)`) threw a TypeError and the gate died with a stack instead
    // of naming a third state. Normalising the absence here is the fix; every downstream test keeps reading
    // null and means null.
    const read = pane === null || pane.pane === undefined || pane.pane === null ? null : pane.pane
    const chips = read === null || !Array.isArray(read.chips) ? [] : read.chips
    const chip = chips.length === 0 ? null : chips[0].n
    const drawn = read === null || read.tree === undefined || !Array.isArray(read.tree.rows) ? null : read.tree.rows.length
    const drawnIds = read === null || read.tree === undefined || !Array.isArray(read.tree.rows) ? [] : read.tree.rows.map((row) => String(row.id))
    const evidence = [
      'the ROUTE tree: teams.teams.length=' + show(routeTree) + ' (' + show(nodes.map((node) => node.id)) + '), counts.teams=' + show(routeCounts),
      'the PANE: ' + (read === null ? '(not read)' : 'tab ' + show(read.tab) + ' via ' + show(pane.via) + ', body box ' + show(read.box) + ', text ' + String(read.textLength) + ' chars') + ', count tokens read from the DOM ' + show(chips),
      'the PANE tree card ' + show(TREE_TITLE) + ': header drawn ' + show(read === null || read.tree === undefined ? null : read.tree.header) + ', row(s) drawn ' + show(drawn) + ' ' + show(drawnIds),
      'the reads this gate saw while the pane caught up: ' + show((pane === null || !Array.isArray(pane.history) ? [] : pane.history).slice(-4)),
    ]
    if (pane === null) readings[id] = NA('NOT MEASURED: the pane was never opened, so its numbers cannot be compared with the route', evidence)
    else if (pane.skip) readings[id] = NA('NOT MEASURED: the pane was not read (' + show(pane.skip) + ')', evidence)
    else if (after === null || after.ok !== true) readings[id] = NA('NOT MEASURED: the route did not answer, so there is nothing to compare the pane with', evidence)
    else if (read === null || read.found !== true) readings[id] = BAD('no tab whose title contains ' + show(TAB_TITLE) + ' exists (titles on screen: ' + show(read === null ? null : read.titles) + ')', evidence)
    else if (read.selected !== true) readings[id] = BAD('the ' + show(TAB_TITLE) + ' tab exists but is not the selected tab (aria-selected=' + show(read.selected) + '), so the element read is the inactive placeholder: box ' + show(read.box) + ', ' + String(read.textLength) + ' characters of text', evidence)
    else if (Array.isArray(read.box) && (read.box[2] <= 0 || read.box[3] <= 0)) readings[id] = BAD('the pane body is ' + String(read.box[2]) + 'x' + String(read.box[3]) + ', i.e. not drawn', evidence)
    else if (read.tree === undefined || read.tree.header !== true) readings[id] = BAD('the pane carries no ' + show(TREE_TITLE) + ' card, so the tree it draws cannot be counted (' + clip(read.text, 160) + ')', evidence)
    else {
      const problems = []
      if (routeTree !== routeCounts) problems.push('the route disagrees with itself: teams.teams.length=' + String(routeTree) + ' but counts.teams=' + show(routeCounts))
      if (chip === null) problems.push('the pane drew no count chip at all (tokens looked for: the team chip in either spelling)')
      else if (chip !== routeTree) problems.push('the pane says ' + show(chips[0].token) + ' while the route tree has ' + String(routeTree) + ' node(s)')
      if (drawn === null) problems.push('the pane tree card has no rows to count')
      else if (drawn !== routeTree) problems.push('the pane DREW ' + String(drawn) + ' tree row(s) while the route tree has ' + String(routeTree) + ' node(s)')
      const sortedRoute = nodes.map((node) => String(node?.id ?? '')).slice().sort()
      const sortedDrawn = drawnIds.slice().sort()
      if (JSON.stringify(sortedRoute) !== JSON.stringify(sortedDrawn)) {
        problems.push('the pane drew different teams than the route serves: route ' + show(sortedRoute) + ' vs pane ' + show(sortedDrawn))
      }
      readings[id] = problems.length === 0
        ? OK('teams.teams.length=' + String(routeTree) + ' == counts.teams=' + show(routeCounts) + ' == the pane\'s own ' + show(chips[0].token) + ' == the ' + String(drawn) + ' row(s) the tree card DREW, and the drawn ids are the served ids', evidence)
        : BAD(problems.join('; '), evidence)
    }
  }

  // 4 ---------------------------------------------------------------- no invented world
  {
    const id = READING_IDS[4]
    const after = t?.routeAfter ?? null
    const body = after === null ? null : after.body
    const tree = body !== null && body !== undefined && body.teams !== undefined ? body.teams : null
    const nodes = tree !== null && Array.isArray(tree.teams) ? tree.teams : []
    const fixtures = nodes.map((node) => String(node?.id ?? '')).filter((nodeId) => FIXTURE_ID.test(nodeId))
    const withheld = tree === null ? null : tree.withheld
    const census = body !== null && body !== undefined && body.fixtures !== undefined ? body.fixtures : null
    const evidence = [
      'the tree serves ' + String(nodes.length) + ' node(s): ' + show(nodes.map((node) => node.id)),
      'node id(s) matching ' + show(String(FIXTURE_ID)) + ': ' + show(fixtures),
      'teams.withheld=' + show(withheld) + ' (type ' + (withheld === null ? 'null' : typeof withheld) + '), teams.declared=' + show(tree === null ? null : tree.declared) + ', named=' + show(tree === null ? null : tree.named) + ', observed=' + show(tree === null ? null : tree.observed),
      'the ledger census the same answer carries: ' + show(census) + ' (counts of fixture-named rows the file still holds; the world withholds the ids, not the facts)',
    ]
    if (after === null || after.ok !== true) readings[id] = NA('NOT MEASURED: the route did not answer, so the world it composes cannot be read', evidence)
    else {
      const problems = []
      if (fixtures.length > 0) problems.push('the tree serves ' + String(fixtures.length) + ' node(s) carrying a fixture prefix: ' + show(fixtures))
      if (typeof withheld !== 'number') problems.push('teams.withheld is ' + (withheld === null ? 'null' : typeof withheld) + ' (' + show(withheld) + '), not a NUMBER: the fixture teams would be hidden rather than counted')
      readings[id] = problems.length === 0
        ? OK('zero of the ' + String(nodes.length) + ' tree node(s) carry a gate-/r18x- prefix, and teams.withheld is the number ' + String(withheld) + ' - the fixtures are counted, not drawn and not hidden', evidence)
        : BAD(problems.join('; '), evidence)
    }
  }

  // 5 ---------------------------------------------------------------- the world put back
  {
    const id = READING_IDS[5]
    const pane = t?.pane ?? null
    // R277: the same absence as above, one level deeper - a pane record that exists but carries no `restored`
    // (the pane was opened and never restored because it was never read) leaves this undefined, and the tests
    // below all ask `restored === null`. Normalised here, for the same reason as `read`.
    const restored = pane === null || pane.restored === undefined || pane.restored === null ? null : pane.restored
    const lease = t?.lease?.after ?? null
    const claim = t?.lease?.claim ?? null
    const exitRows = t?.exit?.sessions ?? null
    const stillThere = exitRows !== null && exitRows.ok === true && sessionId !== null && exitRows.rows.some((row) => row.sessionId === sessionId)
    const evidence = [
      'the rail: entry tab ' + show(restored === null ? null : restored.wanted) + ' / ' + show(restored === null || restored.entry === undefined ? null : restored.entry.tab) + ' -> now on ' + show(restored === null ? null : restored.on) + ' (restored.ok=' + show(restored === null ? null : restored.ok) + ')',
      'the lease: claimed ' + show(claim === null ? null : claim.holder) + ', after release ' + show(lease),
      'the session this gate created: ' + show(sessionId) + ', still in session/list: ' + show(stillThere) + ' (session/list held ' + String(exitRows === null || exitRows.ok !== true ? 0 : exitRows.count) + ' row(s) at the end)',
      'this session is LEFT OPEN as the evidence, the way gate 117 leaves its session',
    ]
    const problems = []
    if (lease === null) problems.push('the lease could not be read back after the release, so "released" is unproven')
    else if (lease.held === true) problems.push('the panel lease is STILL held by ' + show(lease.holder) + ' after the release')
    if (sessionId === null) problems.push('no session was created, so there is no evidence to leave open')
    else if (stillThere !== true) problems.push('the session this gate created (' + show(sessionId) + ') is not in session/list at the end, so the evidence it left is gone')
    if (problems.length > 0) readings[id] = BAD(problems.join('; '), evidence)
    else if (restored === null) readings[id] = NA('NOT MEASURED: the rail was never read, so the put-back cannot be confirmed (the lease and the session are as this gate left them)', evidence)
    else if (restored.ok === null) readings[id] = NA('NOT MEASURED for the rail half: ' + String(restored.why) + ' - the lease and the session are as this gate left them', evidence)
    else if (restored.ok !== true) readings[id] = BAD('the rail is on ' + show(restored.on) + ' instead of the tab this gate found selected (' + show(restored.wanted) + ')', evidence)
    else readings[id] = OK('the rail is back on ' + show(restored.wanted) + ', the lease was released (held=' + show(lease === null ? null : lease.held) + ') and session ' + show(sessionId) + ' is left open as the evidence', evidence)
  }

  return READING_IDS.map((id) => ({ id, ...readings[id] }))
}

/**
 * Exit codes, in the house order: a MEASURED red outranks a skip (a red is evidence about the
 * product, a skip is this gate admitting it did not measure), and a world that stopped being
 * measurable - a restart, a round with no end - is a named third state even when no reading reddened.
 */
const exitCodeOf = (verdicts, stopped) => {
  const failed = verdicts.filter((verdict) => verdict.ok !== true && verdict.notMeasured !== true)
  const skipped = verdicts.filter((verdict) => verdict.notMeasured === true)
  if (failed.length > 0) return 1
  if (stopped > 0) return 3
  if (skipped.length > 0) return 3
  return 0
}

// ---------------------------------------------------------------------------
// The printout: evidence, never a verdict
// ---------------------------------------------------------------------------

const printTranscript = (t) => {
  const log = t.session?.log ?? null
  const tree = t.routeAfter?.body?.teams ?? null
  const read = t.pane?.pane ?? null
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell ' + ORIGIN + ' through CDP ' + String(CDP_PORT) + ' (page ' + String(t.page_url ?? '(unread)') + '); kernel route on ' + String(KERNEL_PORT) + ' - the client was already running, and this gate never starts or stops it')
  console.log('  lease: holder ' + HOLDER + ', claimed after ' + String(t.lease?.claim?.waitedMs ?? '?') + ' ms, released after the pane read')
  console.log('  client: ' + String(t.entry?.client ?? '(unread)') + ' at entry, ' + String(t.exit?.client ?? '(unread)') + ' at the end (a restart is a third state, not a verdict)')
  console.log('  one session, one prompt: ' + String(t.session?.sessionId ?? '(none)') + ', requestId ' + String(t.session?.requestId ?? '(none)') + ', accepted ' + show(t.session?.accepted) + ', prompt(s) ' + String(t.session?.promptCount ?? 0) + ', poll(s) ' + String(t.session?.polls ?? 0) + ', turn/end ' + show(log === null ? null : log.turnEnded))
  console.log('  the message: ' + JSON.stringify(t.message).slice(0, 240) + ' ...')
  console.log('  the model\'s calls (' + String(log === null ? 0 : log.calls.length) + '):')
  for (const call of log === null ? [] : log.calls) console.log('    seq=' + String(call.seq) + ' turn ' + String(call.turn) + ' step ' + String(call.step) + ' ' + call.name + ' ' + clip(call.arguments, 180))
  console.log('  tool/result(s) (' + String(log === null ? 0 : log.results.length) + '):')
  for (const result of log === null ? [] : log.results) console.log('    seq=' + String(result.seq) + ' isError=' + String(result.isError) + ' ' + JSON.stringify(clip(result.text, 220)))
  console.log('  the model said: ' + show(log === null ? [] : (log.assistantTexts ?? []).slice(-2)))
  console.log('  ledger: ' + show(t.entry?.ledger?.path) + ' -> ' + show(t.entry?.ledger?.rows) + ' row(s) at seq ' + show(t.entry?.ledger?.maxSeq) + ', then ' + show(t.ledger?.after?.rows) + ' row(s) at seq ' + show(t.ledger?.after?.maxSeq) + ' (waited ' + String(t.ledger?.waitedMs ?? 0) + ' ms for the recorder)')
  console.log('  row(s) the round appended: ' + show((t.ledger?.newRows ?? []).map((row) => String(row.seq) + ':' + String(row.kind))))
  console.log('  row(s) of the real team ' + show(t.session?.sessionId) + ': ' + show((t.ledger?.attributed ?? []).map((row) => String(row.seq) + ':' + String(row.kind) + '@' + row.by.map((one) => one.field).join('+'))))
  console.log('  route after: status=' + show(t.routeAfter?.status) + ' ok=' + show(t.routeAfter?.body?.ok) + ' counts.teams=' + show(t.routeAfter?.body?.counts?.teams) + ' teams.withheld=' + show(tree?.withheld) + ' fixtures=' + show(t.routeAfter?.body?.fixtures))
  console.log('  teams.teams: ' + show((tree?.teams ?? []).map((node) => ({ id: node?.id, declared: node?.declared, observed: node?.observed, tasks: node?.tasks, members: node?.members }))))
  console.log('  pane: ' + (read === null ? '(not read)' : 'tab ' + show(read.tab) + ' via ' + show(t.pane?.via) + ', box ' + show(read.box) + ', count tokens ' + show(read.chips) + ', tree header ' + show(read.tree?.header) + ', rows drawn ' + show((read.tree?.rows ?? []).map((row) => row.id))))
  for (const line of t.pane?.progress ?? []) console.log('    ' + line)
  for (const note of t.notes ?? []) console.log('  ' + note)
  for (const problem of t.problems ?? []) console.log('  PROBLEM ' + problem)
}

const printReadings = (verdicts) => {
  console.log('')
  console.log('== readings ==')
  for (const verdict of verdicts) {
    const mark = verdict.ok === true ? 'ok   ' : verdict.notMeasured === true ? 'n/a  ' : 'FAIL '
    console.log('  ' + mark + verdict.id)
    console.log('        ' + verdict.detail)
    for (const line of verdict.evidence ?? []) console.log('        - ' + line)
  }
}

const writeTranscript = (t) => {
  const dir = DUMP_OPTION === null ? join(tmpdir(), 'r198-g134-teams-pane-truth') : dirname(resolve(DUMP_OPTION))
  const path = DUMP_OPTION === null ? join(dir, 'transcript-' + String(t.session?.sessionId ?? 'none') + '.json') : resolve(DUMP_OPTION)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(t, null, 1))
    return path
  } catch (error) {
    console.log('  (the transcript could not be written: ' + describe(error) + ' - the readings are unaffected, but --replay has nothing to read)')
    return null
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('gate 134 teams-pane-truth - the real team in the ledger, in the route and in the pane (shell ' + ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  one session, ONE prompt, read-only afterwards; --replay re-takes the verdict with zero live reads')
  let transcript = null
  if (REPLAY_PATH !== null) {
    const path = resolve(REPLAY_PATH)
    let text = null
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      console.log('')
      console.log('SKIP: the transcript to replay could not be read at ' + path + ' (' + describe(error) + ')')
      return 3
    }
    try {
      transcript = JSON.parse(text)
    } catch (error) {
      console.log('')
      console.log('SKIP: the transcript at ' + path + ' is not JSON (' + describe(error) + ')')
      return 3
    }
    if (transcript?.schema !== SCHEMA || transcript.session === undefined || transcript.routeAfter === undefined) {
      console.log('')
      console.log('SKIP: the file at ' + path + ' is not a transcript this gate wrote (schema ' + show(transcript?.schema) + ')')
      return 3
    }
    console.log('  replay: judging ' + path + ' - the world is NOT touched: no shell call, no CDP, no lease, no prompt')
  } else {
    const bag = {}
    try {
      transcript = await runWorld(bag)
    } catch (error) {
      const partial = bag.transcript ?? null
      if (partial !== null) {
        try {
          printTranscript(partial)
        } catch {
          console.log('  (the partial printout failed; the readings below do not exist)')
        }
      }
      console.log('')
      console.log('SKIP: ' + describe(error))
      console.log('teams-pane-truth: 0 readings, 0 failed, 0 measured - this gate declined to measure [exit 3]')
      return 3
    }
    transcript.dumpPath = writeTranscript(transcript)
  }
  if ((transcript.problems ?? []).length > 0) {
    console.log('')
    console.log('== the drive did not complete ==')
    for (const problem of transcript.problems) console.log('  ' + problem)
    for (const note of transcript.notes ?? []) console.log('  ' + note)
    console.log('teams-pane-truth: the world could not be driven to the end, so nothing was judged (exit 3)')
    return 3
  }
  try {
    printTranscript(transcript)
  } catch (error) {
    console.log('  (the printout of the measured transcript failed: ' + describe(error) + ' - the readings are unaffected)')
  }
  const verdicts = judge(transcript)
  printReadings(verdicts)
  const stopped = (transcript.notes ?? []).filter((note) => String(note).startsWith('NOT MEASURED in the world'))
  const exit = exitCodeOf(verdicts, stopped.length)
  const failed = verdicts.filter((verdict) => verdict.ok !== true && verdict.notMeasured !== true)
  const skipped = verdicts.filter((verdict) => verdict.notMeasured === true)
  const session = transcript.session?.sessionId ?? null
  console.log('')
  console.log('teams-pane-truth: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(skipped.length) + ' not measured [exit ' + String(exit) + ']')
  console.log('  prompt(s) sent ' + String(transcript.session?.promptCount ?? 0) + '; lease released ' + show(transcript.lease?.after === null || transcript.lease?.after === undefined ? null : transcript.lease.after.held === false) + '; session left open as the evidence: ' + String(session ?? '(none)'))
  console.log('  the judged record: ' + String(transcript.dumpPath ?? '(replayed, not written)'))
  if (skipped.length > 0) for (const verdict of skipped) console.log('SKIP: ' + verdict.id + ' -> ' + clip(verdict.detail, 300))
  for (const note of stopped) console.log('SKIP: ' + clip(note, 300))
  return exit
}

process.exitCode = await main()

