#!/usr/bin/env node
/**
 * Gate 113 (R184-G1) - browser-tabs-offline: THE AI'S HALF OF THE TAB FACE, JUDGED IN A WORLD THIS
 * GATE BUILT ITSELF.
 *
 * Subject: plugins/dsh-browser/lib/** as shipped by R184-P1 (the R184 contract sections 3.1-3.5 and the
 * P1 row of section 4.1, plus the Lead's rulings in appendix 3). This package has no src/: lib/** IS the
 * source, and every reading below drives it through apply() in a ctx that publishes a tools registry the
 * way the kernel composes one - never by reading the code and believing it.
 *
 * THE WORLD IS NOT THE PRODUCER'S. This gate starts its own faithful fake of the shell's panel HTTP
 * surface (POST /__shell/panel and POST /__shell/panel/cdp) and anchors it in the SHELL ITSELF: reading
 * 1 reads src-tauri/src/core/sidebar_panel.rs, pulls the op=state format string and the tab-row format
 * string out of the Rust source, and compares their key sets AND KEY ORDER with the bytes this world
 * answers. Every refusal this world speaks is transcribed from that same file (the cap at
 * sidebar_panel.rs:1682-1690, an unknown id at :1722-1726 / :1757-1761, an unmounted browser at
 * :1673-1675, a missing surface at :1679-1681, somebody else's lease at :790-798), and what this world
 * does NOT model it refuses BY NAME (FAKE_UNSUPPORTED / FAKE_INPUT) instead of answering a silent 200.
 * The producer's own test/fake-panel.mjs is never imported, executed or edited: two liars agreeing is
 * exactly the failure this world has to avoid.
 *
 * NO LIVE PORT IS TOUCHED. 31761 (the shell), 31760 (the kernel) and 9222 (CDP) are never dialled: every
 * world points at a fake on an ephemeral port of this process, except the two readings about the default
 * origin, which are measured from what apply() LOGS at startup and from the shipped class constructor -
 * both without a single connection. That is deliberate: this gate is offline by contract, and it says so
 * in writing rather than pretending a dial that never happened.
 *
 * TOOL NAMES ARE DISCOVERED BY BEHAVIOUR, NOT HARD-CODED (the house style of verify-collab-peer.mjs). A
 * throwaway probe world calls every registered tool with hand-written shapes, with each tool's OWN
 * declared schema, and with that schema plus a named tab; the tools are then identified by what they DID
 * to the shell - the one that sent op=tab-new, the one that sent op=tab-close, the one that sent
 * op=tab-activate, the one that sent op=tab-goto for the tab it was handed, and the ones that read the
 * panel and nothing else while naming every tab the shell held. The navigating tool is also sought in the
 * registry's own schema (a url AND a tab), so a build that stopped using op=tab-goto is still FOUND and
 * judged rather than quietly becoming unmeasurable. The spellings R184 froze are reported as evidence,
 * never used as the only reason to believe a behaviour happened.
 *
 * Nine readings, each of which can fail on its own evidence:
 *
 *   1-the-worlds-op-state-report-is-anchored-in-the-shells-own-format-string
 *                                            The world this gate measures against must not be its own
 *                                            paraphrase. The op=state key ORDER and the tab-row key
 *                                            ORDER the fake answers with are compared, one by one,
 *                                            with the two format strings in sidebar_panel.rs, and the
 *                                            fake's tab cap is compared with MAX_TABS parsed from the
 *                                            same file. A world that drifts from the shell reddens here
 *                                            instead of quietly licensing the other eight readings.
 *   2-the-tab-set-is-read-from-the-shell-on-every-call-and-never-cached
 *                                            Every discovered tab-set reader is called on a world with
 *                                            three tabs; then the GATE changes the shell's own tab set
 *                                            behind the plugin's back (a fourth tab, a new active tab,
 *                                            a moved URL) and calls the same readers again. The second
 *                                            answers must carry the new facts - the gate compares them
 *                                            with the state IT set, not with what the plugin said it
 *                                            asked for. A cached list, or a count computed from a
 *                                            remembered row set, cannot pass both halves.
 *   3-a-named-tab-travels-verbatim-into-every-cdp-request-and-an-omitted-one-sends-no-field
 *                                            Every tool whose own schema declares a 'tab' is called
 *                                            with one named tab: every request that reaches
 *                                            /__shell/panel/cdp in that call must carry that tab
 *                                            VERBATIM (character for character, no renumbering into an
 *                                            index), and the same tools called with the argument left
 *                                            out must send a body with NO tab field at all - not null,
 *                                            not an empty string, not the active tab's id. One tool is
 *                                            called with two different tabs in a row, so a single client
 *                                            that keeps the first tab it was given reddens here.
 *   4-goto-walks-the-shells-per-tab-op-and-reports-where-that-tab-itself-landed
 *                                            browser_goto on the panel channel must go through
 *                                            op=tab-goto for ONE tab, never Page.navigate on whatever is
 *                                            active: the gate names a tab that is NOT the active one, sets
 *                                            a world where the site redirects, and requires (a) a
 *                                            tab-goto body for that id, (b) not one Page.navigate, (c) the
 *                                            active tab's own document and the shell's record for it
 *                                            untouched, and (d) the reply to carry the URL read from the
 *                                            TAB ITSELF, which is the landing URL and not the request.
 *                                            Paired: with no tab named, the active tab is the one that
 *                                            moves - the shell's own rule for an omitted tab.
 *   5-the-four-tab-tools-do-what-their-own-words-say
 *                                            The four behaviours R184 added are found by behaviour and
 *                                            then each is judged against the shell: the reader's numbers
 *                                            equal the shell's own count/ids/active (this gate's
 *                                            arithmetic), a new tab is the id the SHELL created and
 *                                            becomes active, closing the ACTIVE tab puts the LEFT
 *                                            neighbour in front (a world built so "left" is NOT "the first
 *                                            tab"), activating one moves the shell's active id. Every
 *                                            write is followed by a read-back: a state report arrives
 *                                            AFTER the write in the same call.
 *   6-a-refusal-is-the-shells-own-sentence-and-the-tab-set-does-not-move
 *                                            Four refusals - the cap, an unknown id on close, an unknown
 *                                            id on activate, and a lease held by somebody else - must
 *                                            arrive BYTE FOR BYTE as the shell's own sentence, and the
 *                                            gate recomputes that sentence itself from the inputs the
 *                                            world recorded when it refused. The world's own sentence is
 *                                            checked against the same recomputation, so a drifting fake
 *                                            cannot make a rewritten refusal look faithful. Paired:
 *                                            the shell's tab set is byte-identical before and after each
 *                                            refusal.
 *   7-a-panel-that-is-not-there-is-refused-by-name-and-nothing-is-written
 *                                            Three worlds without a usable panel: nothing listening at
 *                                            all (a port this gate reserved and gave back), a shell that
 *                                            answers exists=false/mounted=false, and the same shell with
 *                                            the panel up. The first two must be refused with the
 *                                            PACKAGE'S OWN named refusal (TABS_NO_PANEL - there is no shell
 *                                            sentence to quote when the shell is not there), the refusal
 *                                            must name the origin the plugin was pointed at, and no write
 *                                            op may be sent. The third world is the paired control: the
 *                                            same call, same code, with the panel up, works - so the two
 *                                            refusals are a branch and not a blanket failure.
 *   8-the-model-visible-words-are-conditional-on-the-channel
 *                                            On the panel channel, no model-visible text - tool
 *                                            descriptions and parameter descriptions, both channels
 *                                            read out of the same build - may claim several instances
 *                                            or a window each: the three sentences that said so before
 *                                            R184 are searched for verbatim, and no panel-channel ANSWER
 *                                            may call its handle an instance either. Paired: the SAME
 *                                            build on the chrome channel still carries those sentences;
 *                                            there the tab reader refuses by name (TABS_CHANNEL) and the
 *                                            instance list answers about instances, while on the panel
 *                                            channel both answer the shell's tab set - the difference is
 *                                            the channel, not a sentence deleted from the code.
 *   9-the-panel-origin-seam-is-wired-and-the-default-is-not-touched
 *                                            Row config panelOrigin and DSH_BROWSER_PANEL_ORIGIN each
 *                                            have to reach the very same code: the row-config world is
 *                                            this gate's whole measurement (proved by the fake's own
 *                                            request log), and the env world is a SECOND fake with a
 *                                            different tab set that answers a world configured with no
 *                                            panelOrigin at all. The default is measured where it is
 *                                            read - the line apply() logs with the resolved origin, and
 *                                            the shipped constructor - and must still be
 *                                            http://127.0.0.1:31761, with no connection made to it.
 *
 * Self-attack: --self-attack measures the world ONCE and then mutates THAT measured world in memory, one
 * mutation per mutant, asserting each mutant reddens exactly its declared readings and nothing else, plus
 * a control mutant that changes nothing. It prints the Chinese sentence declaration == observation for
 * every mutant and then the COVERAGE MATRIX: how many mutants declare each reading, with every reading
 * required to be covered by at least one. The baseline must be fully green AND fully measured before the
 * attack starts, so a reading that cannot be measured is never silently excluded from the coverage count.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject could not be measured here: the module
 * does not import, apply() registers no tool at all (so there is no browser face to drive), the shell's
 * own source cannot be read (so the world would have nothing to anchor it), or the tab face is not in
 * this build. A reading that cannot be measured is a named third state, never green.
 *
 * Usage: node scripts/verify-browser-tabs-offline.mjs [--module <path>] [--shell-source <path>]
 *        [--self-attack] [--keep]
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'plugins', 'dsh-browser', 'lib', 'index.js'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..')
})()

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}
const SELF_ATTACK = has('--self-attack')
const KEEP = has('--keep')
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-browser', 'lib', 'index.js')))
const SHELL_SOURCE = resolve(option('--shell-source', join(PROJECT, 'src-tauri', 'src', 'core', 'sidebar_panel.rs')))

/** The one origin this gate must NOT dial, and the value the default has to keep. */
const DEFAULT_ORIGIN = 'http://127.0.0.1:31761'
const FORBIDDEN_PORTS = [31761, 31760, 9222]

/** The named tab this gate addresses in the measured world. It exists in that world's tab set. */
const MARKER_TAB = 't5'
/** The URL browser_goto is asked for, and where the fake world's site really lands it. Two different strings. */
const REQUESTED_URL = 'https://deep.example/req'
const LANDED_URL = 'https://deep.example/real'
const LATE_URL = 'https://deep.example/late'

/** The sentences R184 removed from the panel channel's words; the R184 record quotes them as the before-state. */
const OLD_SENTENCES = Object.freeze([
  'Multiple instances can be open at once, each with its own window, profile, and pinned viewport',
  'List every open browser instance with its id, url, title, viewport, and process',
  'Browser instance id. Omit to use the most recently used one.',
])
/** Every op that WRITES to the panel: a call that sent one of these changed the world. */
const WRITE_OPS = Object.freeze(['mount', 'open', 'unmount', 'close', 'surface', 'set-bounds', 'tab-new', 'tab-close', 'tab-activate', 'tab-goto'])

const show = (value) => {
  try {
    const text = JSON.stringify(value === undefined ? null : value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}
const clip = (text, width) => {
  const s = String(text === undefined || text === null ? '' : text)
  return s.length <= width ? s : s.slice(0, width) + '...'
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const errorNameOf = (error) => (error !== null && error !== undefined && error.name !== undefined ? String(error.name) : null)

/** The first place two ordered lists differ, or null when they are the same list. */
const firstListDifference = (left, right) => {
  const a = Array.isArray(left) ? left : []
  const b = Array.isArray(right) ? right : []
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) {
      return { at: index, left: a[index] === undefined ? '(absent)' : a[index], right: b[index] === undefined ? '(absent)' : b[index] }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// The shell's own sentences and shapes, transcribed from src-tauri/src/core/sidebar_panel.rs
// ---------------------------------------------------------------------------

/**
 * Every sentence below is a transcription of the shell's own source, with the line it comes from. The
 * fake world speaks these and nothing else, and reading 1 checks the two SHAPES against that file, so a
 * drift between this transcription and the Rust text is a failing reading rather than a shared delusion.
 */
const SHELL = Object.freeze({
  /** sidebar_panel.rs:103 - pub const MAX_TABS: usize = 4; */
  MAX_TABS: 4,
  /** sidebar_panel.rs:1684-1689 */
  cap: (nextId, limit, ids) =>
    'named refusal: op=tab-new is not opening tab t' + nextId + ' because the limit is ' + limit + ' tabs and ' + ids.length + ' are live (' + ids.join(', ') + '); close one first',
  /** sidebar_panel.rs:1722-1725 and :1757-1760 - Rust's debug-quoting of an ASCII id is this JSON quoting. */
  unknownTab: (op, id, ids) => 'named refusal: op=' + op + ' for tab ' + JSON.stringify(id) + ', which is not one of [' + ids.join(', ') + ']',
  /** sidebar_panel.rs:1674 */
  notMounted: 'tab-new needs a mounted browser: call op=mount first',
  /** sidebar_panel.rs:1680 */
  noSurface: 'tab-new needs a surface: declare one with op=surface first',
  /** sidebar_panel.rs:1950 */
  noActiveTab: 'no active tab: mount a browser with a tab before asking it anything',
  /** sidebar_panel.rs:794-797 */
  leased: (other, holder) =>
    'the panel is leased by ' + other + ' and not by ' + (holder === undefined || holder === null || holder === '' ? 'nobody' : holder) + ': the placement was refused',
  /** This world's own two refusals: it says what it cannot model instead of answering a silent 200. */
  unsupported: (what) => 'FAKE_UNSUPPORTED: ' + what,
  input: (what) => 'FAKE_INPUT: ' + what,
})

/** A 1x1 PNG, so Page.captureScreenshot answers something a caller can decode. */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// ---------------------------------------------------------------------------
// The world: a faithful fake of the shell's panel HTTP surface, built by this gate
// ---------------------------------------------------------------------------

/**
 * Start a fake panel world.
 *
 * options:
 *   tabs      [{ id, url }] the tab set to start with (the shell's ids count from 1 and never repeat)
 *   next      the shell's own id counter, so the NEXT created tab has the id the real shell would give it
 *   active    the active tab id (default: the first tab)
 *   limit     the cap the report carries (default MAX_TABS)
 *   exists    the user's right column is open (default true)
 *   mounted   the browser is up (default true)
 *   surface   a page host declared a surface (default true)
 *   redirect  (requestedUrl) => landedUrl: where a site REALLY lands. The shell records the REQUESTED
 *             url (sidebar_panel.rs:1790-1793), so the two must differ for reading 4 to mean anything.
 */
const createFakeShell = (options = {}) => {
  const limit = Number.isFinite(options.limit) ? options.limit : SHELL.MAX_TABS
  const redirect = typeof options.redirect === 'function' ? options.redirect : (url) => url
  const world = {
    exists: options.exists !== false,
    mounted: options.mounted !== false,
    surface: options.surface !== false,
    active: null,
    next: Number.isFinite(options.next) ? options.next : 0,
    lease: null,
    tabs: [],
  }
  const requests = []
  const refusals = []
  let cdpSeq = 0

  const addTab = (url, id) => {
    let assigned = id
    if (typeof assigned !== 'string' || assigned === '') {
      world.next += 1
      assigned = 't' + world.next
    } else {
      const number = Number(String(assigned).replace(/[^0-9]/g, ''))
      if (Number.isFinite(number)) world.next = Math.max(world.next, number)
    }
    const tab = {
      id: assigned,
      label: 'sidebar-browser-tab-' + String(assigned).replace(/[^0-9]/g, ''),
      record: String(url),
      own: String(url),
      title: 'Tab ' + assigned,
      live: true,
    }
    world.tabs.push(tab)
    return tab
  }

  const seed = Array.isArray(options.tabs) ? options.tabs : []
  for (const entry of seed) addTab(typeof entry === 'string' ? entry : entry.url, typeof entry === 'string' ? undefined : entry.id)
  if (world.tabs.length === 0 && options.empty !== true) addTab('about:blank')
  world.active = typeof options.active === 'string' ? options.active : world.tabs[0]?.id ?? null

  const activeTab = () => world.tabs.find((tab) => tab.id === world.active) ?? null
  const ids = () => world.tabs.map((tab) => tab.id)

  /** The shell's own report, with the key set and KEY ORDER of sidebar_panel.rs:538. */
  const state = () => {
    const live = activeTab()
    const held = world.lease !== null && world.lease.expiresAt > Date.now()
    return {
      exists: world.exists,
      label: 'sidebar-browser-chrome',
      bounds: world.exists ? { x: 0, y: 0, w: 612, h: 900 } : null,
      dataDir: 'C:\\gate113\\data',
      url: 'http://127.0.0.1:31761/__shell/browser',
      lastError: null,
      pending: false,
      pageUrl: live === null ? null : live.own,
      content: live === null ? null : { href: live.own, title: live.title, text: 'the gate fake panel world', focus: true, errors: [] },
      contentReports: live === null ? 0 : 1,
      lease: {
        held,
        holder: held ? world.lease.holder : null,
        expiresInMs: held ? Math.max(0, world.lease.expiresAt - Date.now()) : 0,
        revokedBy: null,
        revokedHolder: null,
        revokedKind: null,
      },
      mounted: world.mounted,
      chromeH: 36,
      chinH: 12,
      chromeLabel: 'sidebar-browser-chrome',
      surface: world.surface ? { units: 'logical', x: 0, y: 0, w: 612, h: 900 } : null,
      chromePane: { units: 'logical', x: 0, y: 0, w: 612, h: 108 },
      contentPane: { units: 'logical', x: 0, y: 108, w: 612, h: 780 },
      active: world.active,
      count: world.tabs.length,
      limit,
      tabs: world.tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        url: tab.record,
        live: tab.live,
        active: tab.id === world.active,
        title: tab.id === world.active ? tab.title : null,
        bounds: null,
      })),
      mode: 'fixed',
      modeApplied: world.mounted,
      modeError: null,
      viewport: { w: 1280, h: 800 },
      scale: 0.5,
      hiddenStyle: 'zero',
      chromeBounds: { x: 0, y: 0, w: 612, h: 108 },
      lastUserInput: null,
      userInputReports: 0,
      deckPane: { units: 'logical', x: 0, y: 0, w: 612, h: 888 },
      bayPane: { units: 'logical', x: 0, y: 108, w: 612, h: 780 },
      screenPane: { units: 'logical', x: 0, y: 108, w: 612, h: 382.5 },
      viewportPreset: '1280x800',
      presets: [{ name: '1280x800', w: 1280, h: 800, label: 'default WXGA' }],
      prefsPath: 'C:\\gate113\\browser.json',
    }
  }

  /** What this world holds right now, as THIS GATE reads it - never as the plugin reports it. */
  const snapshot = () => ({
    exists: world.exists,
    mounted: world.mounted,
    surface: world.surface,
    limit,
    next: world.next,
    active: world.active,
    count: world.tabs.length,
    ids: ids(),
    tabs: world.tabs.map((tab) => ({ id: tab.id, record: tab.record, own: tab.own, live: tab.live })),
  })

  const refuse = (record, sentence, info) => {
    refusals.push({ at: Date.now(), sentence, info })
    record.error = sentence
    return { status: 400, payload: { error: sentence, state: state() } }
  }

  /** enforce_lease, to the depth these ops reach (sidebar_panel.rs:777-811). */
  const leaseRefusal = (holder) => {
    if (world.lease !== null && world.lease.expiresAt <= Date.now()) world.lease = null
    if (world.lease === null) return null
    if (world.lease.holder === holder) return null
    return SHELL.leased(world.lease.holder, holder)
  }

  const envelope = (inner) => {
    cdpSeq += 1
    return JSON.stringify({ id: cdpSeq, result: inner })
  }

  /** One protocol call against the tab the request reached (sidebar_panel.rs:1934-1954). */
  const cdpCall = (tab, method, params) => {
    const shellPage = { id: 'chrome', own: 'http://127.0.0.1:31761/__shell/browser', title: 'browser bar' }
    let target
    if (tab === 'chrome') target = shellPage
    else if (tab === undefined) target = activeTab()
    else target = world.tabs.find((entry) => entry.id === tab) ?? null
    if (target === null && tab === undefined) return { error: SHELL.noActiveTab }
    if (target === null) return { error: SHELL.unknownTab('cdp', tab, ids()) }
    if (method === 'Runtime.evaluate') {
      const expression = typeof params?.expression === 'string' ? params.expression : ''
      if (expression.includes('devicePixelRatio')) {
        return { result: envelope({ result: { type: 'string', value: JSON.stringify({ w: 1280, h: 800, dpr: 1, href: target.own, title: target.title }) } }) }
      }
      if (expression.includes('controls')) {
        return { result: envelope({ result: { type: 'object', value: { vw: 1280, vh: 800, controls: [{ r: 'button', t: 'Go', b: [10, 10, 80, 24] }] } } }) }
      }
      if (expression.includes('location.href')) {
        return { result: envelope({ result: { type: 'string', value: JSON.stringify({ href: target.own, title: target.title, ready: 'complete' }) } }) }
      }
      if (expression === 'document.readyState') return { result: envelope({ result: { type: 'string', value: 'complete' } }) }
      if (expression === 'location.href') return { result: envelope({ result: { type: 'string', value: target.own } }) }
      return { error: SHELL.unsupported('Runtime.evaluate expression not modelled: ' + clip(expression, 120)) }
    }
    if (method === 'Page.captureScreenshot') return { result: envelope({ data: PNG_1X1 }) }
    if (method === 'Page.navigate') {
      // The shell hands the URL to the window this call reached; with no tab field that is the ACTIVE
      // tab, which is exactly why R184 took browser_goto off this method.
      target.record = String(params?.url ?? '')
      target.own = redirect(String(params?.url ?? ''))
      target.title = 'Landed ' + target.id
      return { result: envelope({ frameId: target.id }) }
    }
    if (typeof method === 'string' && method.startsWith('Input.')) return { result: envelope({}) }
    if (method === 'Page.enable' || method === 'Emulation.setDeviceMetricsOverride') return { result: envelope({}) }
    return { error: SHELL.unsupported('CDP method not modelled: ' + String(method)) }
  }

  /** One panel op, as the shell answers it (proxy.rs:230-373). */
  const panelOp = (body, record) => {
    const op = typeof body?.op === 'string' ? body.op : ''
    const holder = typeof body?.holder === 'string' ? body.holder : undefined
    if (op === 'state') return { status: 200, payload: state() }
    if (op === 'lease') {
      const leaseOp = typeof body.leaseOp === 'string' ? body.leaseOp : 'status'
      if (leaseOp === 'claim') world.lease = { holder: String(body.holder ?? ''), expiresAt: Date.now() + (Number.isFinite(body.ttlMs) ? body.ttlMs : 30000) }
      else if (leaseOp === 'release') world.lease = null
      else if (leaseOp !== 'status') return refuse(record, SHELL.unsupported('lease op ' + leaseOp), { kind: 'unsupported' })
      return { status: 200, payload: { lease: state().lease, state: state() } }
    }
    if (op === 'mount' || op === 'open') {
      const denied = leaseRefusal(holder)
      if (denied !== null) return refuse(record, denied, { kind: 'lease', other: world.lease?.holder ?? null, holder })
      // sidebar_panel.rs:1540-1614: the chrome window and every tab window exist again - and the tab SET
      // (ids and urls) is kept, because unmount kept it.
      world.exists = true
      world.mounted = true
      if (world.tabs.length === 0) {
        const tab = addTab(typeof body.url === 'string' && body.url !== '' ? body.url : 'about:blank')
        world.active = tab.id
      }
      for (const tab of world.tabs) tab.live = true
      return { status: 200, payload: state() }
    }
    if (op === 'unmount' || op === 'close') {
      // sidebar_panel.rs:1620-1648: every window is closed, so `exists` (which sidebar_panel.rs:513
      // computes from the live webviews) goes false while the tab set stays.
      world.exists = false
      world.mounted = false
      for (const tab of world.tabs) tab.live = false
      return { status: 200, payload: state() }
    }
    if (op === 'surface' || op === 'set-bounds') {
      const denied = leaseRefusal(holder)
      if (denied !== null) return refuse(record, denied, { kind: 'lease', other: world.lease?.holder ?? null, holder })
      world.surface = true
      return { status: 200, payload: state() }
    }
    if (op === 'tab-new') {
      const denied = leaseRefusal(holder)
      if (denied !== null) return refuse(record, denied, { kind: 'lease', other: world.lease?.holder ?? null, holder })
      if (world.mounted !== true) return refuse(record, SHELL.notMounted, { kind: 'notMounted' })
      if (world.surface !== true) return refuse(record, SHELL.noSurface, { kind: 'noSurface' })
      if (world.tabs.length >= limit) {
        const info = { kind: 'cap', nextId: world.next + 1, limit, ids: ids() }
        return refuse(record, SHELL.cap(info.nextId, info.limit, info.ids), info)
      }
      const tab = addTab(typeof body.url === 'string' && body.url !== '' ? body.url : 'about:blank')
      world.active = tab.id
      return { status: 200, payload: { ok: true, tab: tab.id, state: state() } }
    }
    if (op === 'tab-close' || op === 'tab-activate') {
      const denied = leaseRefusal(holder)
      if (denied !== null) return refuse(record, denied, { kind: 'lease', other: world.lease?.holder ?? null, holder })
      const id = typeof body.id === 'string' ? body.id : ''
      const index = world.tabs.findIndex((entry) => entry.id === id)
      if (index < 0) return refuse(record, SHELL.unknownTab(op, id, ids()), { kind: 'unknownTab', op, id, ids: ids() })
      if (op === 'tab-close') {
        const wasActive = world.active === id
        world.tabs.splice(index, 1)
        if (wasActive) {
          const remaining = world.tabs
          world.active = remaining.length === 0 ? null : remaining[Math.max(0, Math.min(index - 1, remaining.length - 1))].id
        }
      } else {
        world.active = id
      }
      return { status: 200, payload: state() }
    }
    if (op === 'tab-goto') {
      const denied = leaseRefusal(holder)
      if (denied !== null) return refuse(record, denied, { kind: 'lease', other: world.lease?.holder ?? null, holder })
      const id = typeof body.id === 'string' ? body.id : ''
      const url = typeof body.url === 'string' ? body.url : ''
      const target = world.tabs.find((entry) => entry.id === id) ?? null
      if (target === null) return refuse(record, SHELL.unknownTab('tab-goto', id, ids()), { kind: 'unknownTab', op: 'tab-goto', id, ids: ids() })
      // The shell records the URL it was ASKED for; the window's own document is where the site landed.
      target.record = url
      target.own = redirect(url)
      target.title = 'Landed ' + target.id
      return { status: 200, payload: state() }
    }
    if (op === 'cdp') {
      const answer = cdpCall(typeof body.tab === 'string' ? body.tab : undefined, body.method, body.params ?? {})
      if (answer.error !== undefined) return { status: 502, payload: { ok: false, method: body.method, error: answer.error } }
      return { status: 200, payload: { ok: true, cdp: answer.result, state: state() } }
    }
    return refuse(record, SHELL.unsupported('panel op not modelled: ' + JSON.stringify(op)), { kind: 'unsupported' })
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      let body = null
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
      const record = { path: req.url, method: req.method, body, at: Date.now(), status: 0, error: null }
      requests.push(record)
      const send = (status, payload) => {
        record.status = status
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
      }
      if (req.method !== 'POST') {
        record.error = SHELL.input('this route only answers POST, not ' + String(req.method))
        return send(405, { error: record.error })
      }
      if (body === null) {
        record.error = SHELL.input('the body is not JSON')
        return send(400, { error: record.error })
      }
      if (req.url === '/__shell/panel') {
        const outcome = panelOp(body, record)
        return send(outcome.status, outcome.payload)
      }
      if (req.url === '/__shell/panel/cdp') {
        const method = typeof body.method === 'string' ? body.method : ''
        if (method === '') {
          record.error = SHELL.input('a cdp call needs a method')
          return send(400, { error: record.error })
        }
        const answer = cdpCall(typeof body.tab === 'string' ? body.tab : undefined, method, body.params ?? {})
        if (answer.error !== undefined) {
          record.error = answer.error
          return send(502, { ok: false, method, error: answer.error })
        }
        return send(200, { ok: true, method, result: answer.result })
      }
      record.error = SHELL.unsupported('route not modelled: ' + String(req.url))
      return send(404, { error: record.error })
    })
  })

  return {
    world,
    requests,
    refusals,
    snapshot,
    state,
    ids,
    addTab,
    activate: (id) => {
      world.active = id
    },
    moveRecord: (id, url) => {
      const tab = world.tabs.find((entry) => entry.id === id)
      if (tab !== undefined) tab.record = url
    },
    claimLease: (holder, ttlMs) => {
      world.lease = { holder, expiresAt: Date.now() + (Number.isFinite(ttlMs) ? ttlMs : 60000) }
    },
    releaseLease: () => {
      world.lease = null
    },
    listen: () =>
      new Promise((resolveListen) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address()
          // unref is the second net: an in-flight exchange still holds its socket, but a forgotten server
          // can no longer be the reason this process never exits.
          server.unref()
          resolveListen({ origin: 'http://127.0.0.1:' + address.port, port: address.port })
        })
      }),
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose())
      }),
  }
}
// ---------------------------------------------------------------------------
// The subject: the shipped plugin, driven through apply() the way the kernel composes it
// ---------------------------------------------------------------------------

const importSubject = async (label) => import(pathToFileURL(MODULE_PATH).href + '?gate113=' + label)

/** A counting stand-in for the host's attachment store: it answers what the tool asks for, and nothing else. */
let attachmentSeq = 0

/**
 * Every fake this run opened, so that no exit path can leave one listening.
 *
 * This is not tidiness: a listening server keeps Node's event loop alive, so a gate that returns a NAMED
 * third state while its fakes are still bound never exits at all - and the suite that runs gates as child
 * processes would wait forever instead of reading the exit code.
 */
const openServers = []
const shutdownWorlds = async () => {
  for (const fake of openServers.splice(0)) {
    try {
      await fake.close()
    } catch {
      /* the world is disposable */
    }
  }
}

/** The plugin logs through console; those lines are evidence, so they are captured rather than printed. */
const captureConsole = async (fn) => {
  const lines = []
  const saved = { log: console.log, warn: console.warn, error: console.error }
  const record = (...args) => lines.push(args.map((value) => (value instanceof Error ? value.stack ?? value.message : String(value))).join(' '))
  console.log = record
  console.warn = record
  console.error = record
  try {
    return { value: await fn(), lines }
  } finally {
    console.log = saved.log
    console.warn = saved.warn
    console.error = saved.error
  }
}

/**
 * Import the shipped module in a fresh URL (so each world gets its own USE_PANEL/PANEL_ORIGIN, both of
 * which the module reads once) and apply it with a ctx that publishes a tools registry. The env is set
 * only around the import and the apply, and restored afterwards: a variable this gate sets must not leak
 * into another world's import.
 */
const buildSubject = async (label, { env = {}, config = {} } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'r184-g1-' + label + '-'))
  const savedEnv = {}
  for (const [key, value] of Object.entries(env)) {
    savedEnv[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const registry = new Map()
  const disposers = []
  const provided = new Map()
  const ctx = {
    get(name) {
      if (name === 'tools') {
        return {
          register(definition) {
            registry.set(definition.name, definition)
            return () => {
              registry.delete(definition.name)
            }
          },
        }
      }
      if (name === 'webServer') return { register() { return () => {} } }
      // The real host composes an attachments service; without one browser_shot refuses before it ever
      // reaches the page, which would leave the family reading short of a tool the model can really use.
      if (name === 'attachments') {
        return {
          async saveImage(input) {
            attachmentSeq += 1
            return {
              attachmentId: 'gate113-attachment-' + String(attachmentSeq),
              mediaType: input?.mediaType ?? 'image/png',
              bytes: input?.data?.length ?? 0,
              width: 1,
              height: 1,
              ...(input?.name === undefined ? {} : { name: input.name }),
            }
          },
        }
      }
      if (name === 'dshHomePath') return (sub) => join(root, sub)
      return provided.get(name)
    },
    inject(_dependencies, callback) {
      try {
        callback({ get: (name) => ctx.get(name) })
      } catch {
        /* the plugin logs and carries on when a late composition fails */
      }
    },
    provide(name, value) {
      provided.set(name, value)
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    on() {
      return () => {}
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  const built = {
    label,
    root,
    baseDir: join(root, 'browser'),
    registry,
    disposers,
    logs: [],
    imported: false,
    applied: false,
    applyError: null,
    module: null,
    config: { baseDir: join(root, 'browser'), ...config },
  }
  const captured = await captureConsole(async () => {
    try {
      built.module = await importSubject(label)
      built.imported = true
    } catch (error) {
      built.applyError = describe(error)
      return
    }
    try {
      built.module.apply(ctx, built.config)
      built.applied = true
    } catch (error) {
      built.applyError = describe(error)
    }
  })
  built.logs = captured.lines.map((line) => clip(line, 300))
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  built.names = [...registry.keys()].sort()
  built.startupLine = built.logs.find((line) => line.includes('browser tools drive the shell panel at')) ?? null
  return built
}

const closeSubject = (built) => {
  for (const dispose of built?.disposers ?? []) {
    try {
      dispose()
    } catch {
      /* the world is being thrown away */
    }
  }
}

/** A fake-less window bookkeeping stand-in, for the calls this gate makes where no world is dialled at all. */
const nullFake = {
  requests: [],
  refusals: [],
  snapshot: () => ({ exists: null, mounted: null, surface: null, limit: null, next: null, active: null, count: 0, ids: [], tabs: [] }),
}

const opsOf = (fake, from) =>
  fake.requests
    .slice(from)
    .filter((entry) => entry.path === '/__shell/panel')
    .map((entry) => ({
      op: typeof entry.body?.op === 'string' ? entry.body.op : null,
      id: typeof entry.body?.id === 'string' ? entry.body.id : null,
      url: typeof entry.body?.url === 'string' ? entry.body.url : null,
      holder: typeof entry.body?.holder === 'string' ? entry.body.holder : null,
      write: WRITE_OPS.includes(typeof entry.body?.op === 'string' ? entry.body.op : ''),
      status: entry.status,
    }))

const cdpOf = (fake, from) =>
  fake.requests
    .slice(from)
    .filter((entry) => entry.path === '/__shell/panel/cdp')
    .map((entry) => ({
      method: typeof entry.body?.method === 'string' ? entry.body.method : null,
      tabPresent: entry.body !== null && typeof entry.body === 'object' && Object.prototype.hasOwnProperty.call(entry.body, 'tab'),
      tab: entry.body === null || typeof entry.body !== 'object' || entry.body.tab === undefined ? null : entry.body.tab,
      status: entry.status,
    }))

/** One tool call, with everything the judge needs to say what the world DID in reply. */
const callTool = async (built, tool, args, { fake = nullFake } = {}) => {
  const record = {
    tool,
    args: args === undefined ? {} : args,
    ok: false,
    error: null,
    errorName: null,
    text: null,
    logs: [],
    ops: [],
    cdp: [],
    refusals: [],
    fake: { before: fake.snapshot(), after: null },
  }
  const definition = built.registry.get(tool)
  if (definition === undefined) {
    record.error = 'no tool named ' + tool + ' is registered in this world'
    record.fake.after = fake.snapshot()
    return record
  }
  const from = fake.requests.length
  const refusalFrom = fake.refusals.length
  const captured = await captureConsole(async () => {
    try {
      return { ok: true, value: await definition.execute(record.args, {}) }
    } catch (error) {
      return { ok: false, error: describe(error), errorName: errorNameOf(error) }
    }
  })
  const outcome = captured.value
  record.logs = captured.lines.map((line) => clip(line, 200))
  record.fake.after = fake.snapshot()
  record.ops = opsOf(fake, from)
  record.cdp = cdpOf(fake, from)
  record.refusals = fake.refusals.slice(refusalFrom).map((entry) => ({ sentence: entry.sentence, info: entry.info }))
  if (outcome.ok === true) {
    record.ok = true
    record.text = typeof outcome.value?.text === 'string' ? outcome.value.text : show(outcome.value)
    record.image = outcome.value !== null && typeof outcome.value === 'object' && outcome.value.image !== undefined
  } else {
    record.error = outcome.error
    record.errorName = outcome.errorName
  }
  return record
}

// ---------------------------------------------------------------------------
// Behavioural discovery: which tool does what, found by what it did to the shell
// ---------------------------------------------------------------------------

/** Does this text name that id as a word? Substrings inside another word do not count. */
const mentionsId = (text, id) => new RegExp('\\b' + String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(String(text ?? ''))

/** One plausible value per declared parameter name, or nothing when this gate cannot guess one. */
const schemaValue = (name) => {
  const key = String(name).toLowerCase()
  if (key === 'tab') return undefined
  if (/^(x|y|width|height|max|click_count|dx|dy)$/.test(key)) return 8
  if (/^(n|index|repeat)$/.test(key)) return 1
  if (/^(markers|visible)$/.test(key)) return false
  if (/^key$/.test(key)) return 'Enter'
  if (/^text$/.test(key)) return 'gate-113'
  if (/^url$/.test(key)) return REQUESTED_URL
  return undefined
}

const schemaArgs = (definition) => {
  const properties = definition?.parameters?.properties
  const args = {}
  if (properties === null || typeof properties !== 'object') return args
  for (const key of Object.keys(properties)) {
    const value = schemaValue(key)
    if (value !== undefined) args[key] = value
  }
  return args
}

/** Three shapes per tool: nothing, its OWN declared schema, and that schema plus a named tab. */
const probeShapes = (definition) => {
  const declared = schemaArgs(definition)
  const out = [{ id: 'empty', args: {} }]
  if (Object.keys(declared).length > 0) out.push({ id: 'declared-schema', args: declared })
  out.push({ id: 'named-tab', args: { ...declared, tab: MARKER_TAB } })
  return out
}

/**
 * Probe every registered tool in a throwaway world and keep what it DID. A role is only accepted when
 * exactly one tool performed it: two tools sending op=tab-new is an ambiguity this gate names rather
 * than guessing through.
 */
const discover = async (built, fake) => {
  const names = [...built.registry.keys()].sort()
  const probes = []
  const opsByTool = {}
  const gotoByTool = {}
  const readers = []
  for (const name of names) {
    for (const shape of probeShapes(built.registry.get(name))) {
      const record = await callTool(built, name, shape.args, { fake })
      const ops = record.ops.map((entry) => entry.op)
      opsByTool[name] = [...new Set([...(opsByTool[name] ?? []), ...ops])]
      const wrote = record.ops.some((entry) => entry.write === true)
      // A tab-set reader reads the panel and nothing else: no write, NO protocol call, and every id the
      // shell held named as a word. Dropping any one of those three let a broken page tool (whose reply
      // mixed the tab it was handed with the ACTIVE tab it really reached) pass itself off as a reader.
      const everyIdListed =
        record.fake.before.ids.length >= 2 && record.ok === true && record.cdp.length === 0 && record.fake.before.ids.every((id) => mentionsId(record.text, id))
      if (everyIdListed === true && wrote === false && readers.includes(name) === false) readers.push(name)
      if (record.ops.some((entry) => entry.op === 'tab-goto' && entry.id === MARKER_TAB)) gotoByTool[name] = (gotoByTool[name] ?? 0) + 1
      probes.push({
        tool: name,
        shape: shape.id,
        ok: record.ok,
        error: clip(record.error ?? '', 90),
        ops,
        writes: record.ops.filter((entry) => entry.write === true).map((entry) => entry.op),
        cdpTabs: record.cdp.map((entry) => (entry.tabPresent ? show(entry.tab) : '(no tab field)')),
        text: clip(record.text ?? '', 110),
      })
    }
  }
  const one = (predicate) => {
    const found = names.filter(predicate)
    return found.length === 1 ? found[0] : null
  }
  const byOp = (op) => one((name) => (opsByTool[name] ?? []).includes(op))
  const gotoWriters = names.filter((name) => gotoByTool[name] !== undefined)
  /** The tool whose OWN schema takes both a url and a tab: the candidate the behaviour above then judges. */
  const bySchema = names.filter((name) => {
    const properties = built.registry.get(name)?.parameters?.properties
    if (properties === null || typeof properties !== 'object') return false
    return properties.url !== undefined && properties.tab !== undefined
  })
  const ambiguous = {
    new: names.filter((name) => (opsByTool[name] ?? []).includes('tab-new')),
    close: names.filter((name) => (opsByTool[name] ?? []).includes('tab-close')),
    activate: names.filter((name) => (opsByTool[name] ?? []).includes('tab-activate')),
    goto: { byBehaviour: gotoWriters, bySchema },
  }
  return {
    names,
    probes,
    readers,
    newTool: byOp('tab-new'),
    closeTool: byOp('tab-close'),
    activateTool: byOp('tab-activate'),
    // By schema when the build has exactly one such tool - so a build whose navigation no longer uses
    // op=tab-goto is still FOUND and judged (reading 4 reddens) instead of quietly becoming unmeasured.
    gotoTool: bySchema.length === 1 ? bySchema[0] : gotoWriters.length === 1 ? gotoWriters[0] : null,
    gotoDiscoveredBy: bySchema.length === 1 ? 'schema' : gotoWriters.length === 1 ? 'behaviour' : null,
    tabParamTools: names.filter((name) => {
      const properties = built.registry.get(name)?.parameters?.properties
      return properties !== null && typeof properties === 'object' && properties.tab !== undefined
    }),
    ambiguous,
  }
}

// ---------------------------------------------------------------------------
// The shell's own source: the anchor reading 1 judges this gate's world against
// ---------------------------------------------------------------------------

const readFormat = (text, marker) => {
  const at = text.indexOf('r#"' + marker)
  if (at < 0) return null
  const open = at + 3
  const close = text.indexOf('"#', open)
  if (close < 0) return null
  const literal = text.slice(open, close)
  const keys = [...literal.matchAll(/"([A-Za-z][A-Za-z0-9]*)":/g)].map((match) => match[1])
  return { literal, keys, line: text.slice(0, at).split(/\r?\n/).length }
}

const readShellSource = () => {
  let text = null
  let error = null
  try {
    text = readFileSync(SHELL_SOURCE, 'utf8')
  } catch (caught) {
    error = describe(caught)
  }
  if (text === null) return { path: SHELL_SOURCE, present: false, error, state: null, tabs: null, maxTabs: null }
  const maxMatch = /pub const MAX_TABS: usize = (\d+);/.exec(text)
  return {
    path: SHELL_SOURCE,
    present: true,
    error: null,
    state: readFormat(text, '{{"exists"'),
    tabs: readFormat(text, '{{"id"'),
    maxTabs: maxMatch === null ? null : Number(maxMatch[1]),
  }
}

/** One JSON POST this gate makes itself - the report reading 1 judges is read over HTTP, not from the fake's memory. */
const postJson = (origin, path, payload) =>
  new Promise((resolvePost) => {
    let url
    try {
      url = new URL(path, origin)
    } catch (caught) {
      resolvePost({ ok: false, error: describe(caught) })
      return
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    const request = http.request(
      { protocol: url.protocol, hostname: url.hostname, port: url.port === '' ? 80 : Number(url.port), path: url.pathname, method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': body.length } },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = null
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = null
          }
          resolvePost({ ok: true, status: response.statusCode ?? 0, body: parsed, text })
        })
      },
    )
    request.setTimeout(8000, () => request.destroy(new Error('the gate own probe timed out')))
    request.on('error', (error) => resolvePost({ ok: false, error: describe(error) }))
    request.end(body)
  })

/** Reserve a port and give it back: a dead origin this gate owns, so nothing live is ever dialled. */
const reserveDeadOrigin = () =>
  new Promise((resolveReserve) => {
    const probe = http.createServer(() => {})
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const origin = 'http://127.0.0.1:' + address.port
      probe.close(() => resolveReserve({ origin, port: address.port }))
    })
  })

// ---------------------------------------------------------------------------
// Collection: one measured world, plus the worlds that bite it one fact at a time
// ---------------------------------------------------------------------------

/** The words a model would read on one channel: every tool description and every parameter description. */
const wordsOf = (built) => ({
  descriptions: Object.fromEntries(built.names.map((name) => [name, String(built.registry.get(name)?.description ?? '')])),
  params: Object.fromEntries(
    built.names.map((name) => {
      const properties = built.registry.get(name)?.parameters?.properties
      const entries = properties === null || typeof properties !== 'object' ? [] : Object.keys(properties).map((key) => [key, String(properties[key]?.description ?? '')])
      return [name, Object.fromEntries(entries)]
    }),
  ),
})

/** The origin apply() logged, which is the value the plugins actually resolved (no connection is made). */
const loggedOrigin = (line) => {
  const match = /browser tools drive the shell panel at (\S+)/.exec(String(line ?? ''))
  return match === null ? null : match[1]
}

const collect = async () => {
  const progress = []
  const roots = []
  const world = {
    module: MODULE_PATH,
    shellSourcePath: SHELL_SOURCE,
    at: Date.now(),
    fatal: null,
    // Bound to the SAME array from the first line on: an early return (a named third state) must still be
    // able to clean up the temp worlds it had already made.
    roots,
    ambient: { DSH_BROWSER_PANEL: process.env.DSH_BROWSER_PANEL ?? null, DSH_BROWSER_PANEL_ORIGIN: process.env.DSH_BROWSER_PANEL_ORIGIN ?? null },
    progress,
  }

  // 0 -- the anchor in the shell's own source -------------------------------------------------------
  world.source = readShellSource()
  if (world.source.present !== true || world.source.state === null || world.source.tabs === null || world.source.maxTabs === null) {
    return {
      world,
      progress,
      fatal:
        'the shell own op=state format could not be read from ' + world.source.path + ' (' + show(world.source.error ?? 'the format string was not found') +
        '), so this gate world would be a paraphrase with nothing to anchor it',
    }
  }
  progress.push(
    'anchor: ' + world.source.path + ':' + world.source.state.line + ' (' + world.source.state.keys.length + ' op=state keys in order) and :' + world.source.tabs.line +
      ' (' + world.source.tabs.keys.length + ' tab-row keys), MAX_TABS=' + world.source.maxTabs,
  )
  progress.push('ambient environment at gate start: DSH_BROWSER_PANEL=' + show(world.ambient.DSH_BROWSER_PANEL) + ', DSH_BROWSER_PANEL_ORIGIN=' + show(world.ambient.DSH_BROWSER_PANEL_ORIGIN))

  // 1 -- the worlds ---------------------------------------------------------------------------------
  const fakeMain = createFakeShell({
    tabs: [{ id: 't2', url: 'https://a.test/2' }, { id: 't5', url: 'https://a.test/5' }, { id: 't9', url: 'https://a.test/9' }],
    next: 9,
    active: 't2',
    redirect: (url) => (url === REQUESTED_URL ? LANDED_URL : url === LATE_URL ? 'https://deep.example/late-landed' : url),
  })
  const fakeProbe = createFakeShell({ tabs: [{ id: 't2', url: 'https://probe.test/2' }, { id: 't5', url: 'https://probe.test/5' }], next: 5, active: 't2' })
  const fakeAway = createFakeShell({ empty: true, next: 0, exists: false, mounted: false })
  const fakePresent = createFakeShell({ tabs: [{ id: 't2', url: 'https://present.test/2' }], next: 2 })
  const fakeEnv = createFakeShell({ tabs: [{ id: 't41', url: 'https://env.test/41' }], next: 41 })
  const fakes = [fakeMain, fakeProbe, fakeAway, fakePresent, fakeEnv]
  const fakeLabels = ['main', 'probe', 'away', 'present', 'env']
  for (const [index, fake] of fakes.entries()) {
    const at = await fake.listen()
    fake.origin = at.origin
    fake.port = at.port
    fake.label = fakeLabels[index]
    openServers.push(fake)
  }
  const dead = await reserveDeadOrigin()
  const fakePorts = fakes.map((fake) => fake.port)
  const forbidden = fakePorts.filter((port) => FORBIDDEN_PORTS.includes(port))
  if (forbidden.length > 0) {
    return { world, progress, fatal: 'this gate was handed a fake on a LIVE port (' + show(forbidden) + '); it refuses to measure rather than touch the live world' }
  }
  progress.push('worlds: ' + fakes.map((fake) => fake.label + '=' + fake.origin).join(', ') + ', dead=' + dead.origin + ' (all ephemeral ports of this process)')

  // 2 -- the subjects -------------------------------------------------------------------------------
  const panelEnv = { DSH_BROWSER_PANEL: undefined, DSH_BROWSER_PANEL_ORIGIN: undefined }
  const subjectMain = await buildSubject('main', { env: panelEnv, config: { panelOrigin: fakeMain.origin } })
  const subjectProbe = await buildSubject('probe', { env: panelEnv, config: { panelOrigin: fakeProbe.origin } })
  roots.push(subjectMain.root, subjectProbe.root)
  world.subject = {
    applied: subjectMain.applied,
    applyError: subjectMain.applyError,
    names: subjectMain.names,
    startupLine: subjectMain.startupLine,
    logs: subjectMain.logs,
  }
  if (subjectMain.applied !== true || subjectMain.names.length === 0) {
    return {
      world,
      progress,
      fatal:
        'apply() on ' + MODULE_PATH + ' registered no tool at all (' + show(subjectMain.applyError ?? 'it returned without registering') +
        '), so there is no browser tool face to drive here' + (subjectMain.logs.length === 0 ? '' : '; it logged: ' + show(subjectMain.logs.slice(0, 3))),
    }
  }
  progress.push('subject: apply() registered ' + subjectMain.names.length + ' tool(s): ' + subjectMain.names.join(', '))

  // 3 -- discovery by behaviour ---------------------------------------------------------------------
  world.discovery = await discover(subjectProbe, fakeProbe)
  progress.push(
    'discovery: readers=' + show(world.discovery.readers) + ', tab-new=' + show(world.discovery.newTool) + ', tab-close=' + show(world.discovery.closeTool) +
      ', tab-activate=' + show(world.discovery.activateTool) + ', tab-goto=' + show(world.discovery.gotoTool) + ', tools declaring a tab=' + show(world.discovery.tabParamTools),
  )
  const readers = world.discovery.readers
  const readerTool = readers[0] ?? null
  const tabNew = world.discovery.newTool
  const tabClose = world.discovery.closeTool

  // 4 -- the report this gate reads itself, over HTTP ------------------------------------------------
  const anchor = await postJson(fakeMain.origin, '/__shell/panel', { op: 'state' })
  world.shell = {
    origin: fakeMain.origin,
    status: anchor.status ?? 0,
    reportKeys: anchor.body !== null && typeof anchor.body === 'object' ? Object.keys(anchor.body) : [],
    reportTabKeys: Array.isArray(anchor.body?.tabs) && anchor.body.tabs.length > 0 ? Object.keys(anchor.body.tabs[0]) : [],
    reportLimit: anchor.body?.limit ?? null,
    reportCount: anchor.body?.count ?? null,
    reportActive: anchor.body?.active ?? null,
    reportIds: Array.isArray(anchor.body?.tabs) ? anchor.body.tabs.map((row) => row.id) : [],
    reportExists: anchor.body?.exists ?? null,
    reportMounted: anchor.body?.mounted ?? null,
  }
  progress.push('the world reports: ' + show(world.shell.reportIds) + ' active=' + show(world.shell.reportActive) + ' limit=' + show(world.shell.reportLimit))

  // 5 -- the measured sequence -----------------------------------------------------------------------
  world.calls = {}
  const readAll = async () => {
    const out = []
    for (const tool of readers) out.push(await callTool(subjectMain, tool, {}, { fake: fakeMain }))
    return out
  }
  world.calls.readers1 = await readAll()
  const beforeMutation = fakeMain.snapshot()
  // Behind the plugin's back: the GATE changes the shell. No notification, no call, no cache to update.
  fakeMain.addTab('https://b.test/10')
  fakeMain.activate('t10')
  fakeMain.moveRecord('t5', 'https://b.test/moved')
  world.calls.mutation = { before: beforeMutation, after: fakeMain.snapshot() }
  world.calls.readers2 = await readAll()
  if (world.discovery.activateTool !== null) world.calls.activate = await callTool(subjectMain, world.discovery.activateTool, { tab: 't9' }, { fake: fakeMain })
  if (tabClose !== null) world.calls.closeTab = await callTool(subjectMain, tabClose, { tab: 't9' }, { fake: fakeMain })
  if (tabNew !== null) world.calls.newTab = await callTool(subjectMain, tabNew, {}, { fake: fakeMain })
  world.calls.readers3 = await readAll()
  if (tabNew !== null) world.calls.refusalCap = await callTool(subjectMain, tabNew, {}, { fake: fakeMain })
  if (tabClose !== null) world.calls.refusalUnknownClose = await callTool(subjectMain, tabClose, { tab: 't404' }, { fake: fakeMain })
  if (world.discovery.activateTool !== null) world.calls.refusalUnknownActivate = await callTool(subjectMain, world.discovery.activateTool, { tab: 't404' }, { fake: fakeMain })
  fakeMain.claimLease('gate-113', 60000)
  if (tabNew !== null) world.calls.refusalLease = await callTool(subjectMain, tabNew, {}, { fake: fakeMain })
  fakeMain.releaseLease()
  progress.push(
    'the four tab writes: new=' + show(world.calls.newTab?.ok) + ' close=' + show(world.calls.closeTab?.ok) + ' activate=' + show(world.calls.activate?.ok) +
      '; refusals: cap=' + show(world.calls.refusalCap?.error !== undefined && world.calls.refusalCap?.error !== null) + ' unknownClose=' + show(world.calls.refusalUnknownClose?.ok === false) +
      ' unknownActivate=' + show(world.calls.refusalUnknownActivate?.ok === false) + ' lease=' + show(world.calls.refusalLease?.ok === false),
  )

  // 6 -- the whole family, with a tab and without one ------------------------------------------------
  world.calls.family = []
  // Out of the page family: the tool that navigates through op=tab-goto (reading 4 judges it on its own),
  // and the three tools that CHANGE the tab set (reading 5 judges those). Discovered by behaviour, not by
  // name, so a differently-spelled build is still measured the same way.
  const familyExcluded = [world.discovery.gotoTool, world.discovery.newTool, world.discovery.closeTool, world.discovery.activateTool].filter((name) => name !== null)
  world.calls.familyExcluded = familyExcluded
  const familyTools = world.discovery.tabParamTools.filter((name) => familyExcluded.includes(name) === false)
  for (const tool of familyTools) {
    const base = schemaArgs(subjectMain.registry.get(tool))
    const entry = { tool, args: base, withTab: await callTool(subjectMain, tool, { ...base, tab: MARKER_TAB }, { fake: fakeMain }), withoutTab: null }
    world.calls.family.push(entry)
  }
  for (const entry of world.calls.family) entry.withoutTab = await callTool(subjectMain, entry.tool, { ...entry.args }, { fake: fakeMain })
  const switched = world.calls.family.find((entry) => entry.withTab.ok === true && entry.withTab.cdp.length > 0) ?? null
  const switchTab = fakeMain.ids().find((id) => id !== MARKER_TAB) ?? MARKER_TAB
  world.calls.familySwitch = switched === null ? null : { tool: switched.tool, tab: switchTab, call: await callTool(subjectMain, switched.tool, { ...switched.args, tab: switchTab }, { fake: fakeMain }) }
  progress.push(
    'family: ' + world.calls.family.length + ' tool(s) declare a tab; ' + world.calls.family.filter((entry) => entry.withTab.cdp.length > 0).length +
      ' of them reached the page with the tab named, ' + world.calls.family.filter((entry) => entry.withoutTab.cdp.length > 0).length + ' reached it with the tab omitted',
  )

  // 7 -- browser_goto -------------------------------------------------------------------------------
  if (world.discovery.gotoTool !== null) {
    world.calls.gotoNamed = await callTool(subjectMain, world.discovery.gotoTool, { tab: MARKER_TAB, url: REQUESTED_URL }, { fake: fakeMain })
    world.calls.gotoOmitted = await callTool(subjectMain, world.discovery.gotoTool, { url: LATE_URL }, { fake: fakeMain })
    progress.push('goto: named tab=' + show(world.calls.gotoNamed.ok) + ' omitted tab=' + show(world.calls.gotoOmitted.ok))
  }

  // 8 -- worlds without a usable panel ----------------------------------------------------------------
  const subjectAway = await buildSubject('away', { env: panelEnv, config: { panelOrigin: fakeAway.origin } })
  const subjectPresent = await buildSubject('present', { env: panelEnv, config: { panelOrigin: fakePresent.origin } })
  const subjectDead = await buildSubject('dead', { env: panelEnv, config: { panelOrigin: dead.origin } })
  roots.push(subjectAway.root, subjectPresent.root, subjectDead.root)
  const awayReader = readerTool === null ? null : await callTool(subjectAway, readerTool, {}, { fake: fakeAway })
  const awayClose = tabClose === null ? null : await callTool(subjectAway, tabClose, {}, { fake: fakeAway })
  const presentClose = tabClose === null ? null : await callTool(subjectPresent, tabClose, {}, { fake: fakePresent })
  const deadReader = readerTool === null ? null : await callTool(subjectDead, readerTool, {}, {})
  const deadClose = tabClose === null ? null : await callTool(subjectDead, tabClose, {}, {})
  world.absent = {
    dead: { origin: dead.origin, reader: deadReader, closeNoTab: deadClose },
    away: { origin: fakeAway.origin, reader: awayReader, closeNoTab: awayClose },
    present: { origin: fakePresent.origin, closeNoTab: presentClose },
  }
  progress.push('no panel: dead origin answered ' + show(deadReader?.ok === false) + ' (threw), exists=false answered ' + show(awayReader?.ok === false) + ', the control with the panel up answered ' + show(presentClose?.ok === true))

  // 9 -- the two channels' model-visible words --------------------------------------------------------
  // The chrome channel is the one channel where a tool call CAN start a browser. This gate therefore
  // points that world at an executable that does not exist (chrome.js:30-33 throws on a missing explicit
  // path instead of falling back to auto-detection): if anything on that channel tries to open an
  // instance, it fails loudly here rather than leaving a Chrome running behind an offline gate.
  const subjectChrome = await buildSubject('chrome', {
    env: { DSH_BROWSER_PANEL: '0', DSH_BROWSER_PANEL_ORIGIN: undefined },
    config: { browserExecutable: join(tmpdir(), 'gate113-no-browser-here.exe') },
  })
  roots.push(subjectChrome.root)
  const chromeReaders = []
  for (const tool of readers) chromeReaders.push({ tool, call: await callTool(subjectChrome, tool, {}, {}) })
  // The panel side of the SAME pair, called here on purpose: reading 8 owns these two calls, so a mutant
  // that rewrites them cannot be mistaken for a change in the readings that measure the tab facts.
  const panelReaders = []
  for (const tool of readers) panelReaders.push({ tool, call: await callTool(subjectMain, tool, {}, { fake: fakeMain }) })
  world.words = {
    panel: { ...wordsOf(subjectMain), startupLine: subjectMain.startupLine, readers: panelReaders, profileDir: existsSync(join(subjectMain.baseDir, 'profiles')) },
    chrome: {
      ...wordsOf(subjectChrome),
      startupLine: subjectChrome.startupLine,
      readers: chromeReaders,
      readerTool,
      browserExecutable: join(tmpdir(), 'gate113-no-browser-here.exe'),
      // The other half of the channel switch, said by the plugin itself at startup.
      startupLines: subjectChrome.logs.filter((line) => line.includes('browser tools')),
      // A profile directory appears the moment a call tries to OPEN an instance (registry.open creates it
      // before anything is launched). No Chrome may be started behind an offline gate, so its absence is
      // measured rather than assumed.
      profileDir: existsSync(join(subjectChrome.baseDir, 'profiles')),
    },
  }
  progress.push('chrome channel readers: ' + chromeReaders.map((entry) => entry.tool + ' -> ' + clip(entry.call.error ?? entry.call.text ?? '(nothing)', 60)).join(' | '))
  progress.push('words: ' + subjectMain.names.length + ' tool(s) on the panel channel, ' + subjectChrome.names.length + ' on the chrome channel (same build)')

  // 10 -- the panelOrigin seam and the default --------------------------------------------------------
  const subjectDefault = await buildSubject('default', { env: panelEnv, config: {} })
  const subjectEnv = await buildSubject('env', { env: { DSH_BROWSER_PANEL: undefined, DSH_BROWSER_PANEL_ORIGIN: fakeEnv.origin }, config: {} })
  roots.push(subjectDefault.root, subjectEnv.root)
  const envOrigin = loggedOrigin(subjectEnv.startupLine)
  // The safety valve: the env seam is only BELIEVED - and only driven - once apply() has itself said the
  // resolved origin is this gate's fake. Otherwise nothing is called and the reading reds by name.
  const envReader = envOrigin === fakeEnv.origin && readerTool !== null ? await callTool(subjectEnv, readerTool, {}, { fake: fakeEnv }) : null
  const registryModule = await import(pathToFileURL(join(PROJECT, 'plugins', 'dsh-browser', 'lib', 'registry.js')).href)
  const ctorGiven = 'http://127.0.0.1:39999'
  world.seam = {
    rowConfig: { origin: loggedOrigin(subjectMain.startupLine), fake: fakeMain.origin, startupLine: subjectMain.startupLine, fakeRequests: fakeMain.requests.length },
    env: { origin: envOrigin, fake: fakeEnv.origin, startupLine: subjectEnv.startupLine, readerCalled: envReader !== null, reader: envReader, fakeRequests: fakeEnv.requests.length },
    default: { origin: loggedOrigin(subjectDefault.startupLine), startupLine: subjectDefault.startupLine, toolCalls: 0 },
    ctor: {
      given: ctorGiven,
      defaultOrigin: new registryModule.BrowserRegistry({ baseDir: join(subjectMain.root, 'ctor'), usePanel: true }).panelOrigin ?? null,
      givenOrigin: new registryModule.BrowserRegistry({ baseDir: join(subjectMain.root, 'ctor'), usePanel: true, panelOrigin: ctorGiven }).panelOrigin ?? null,
    },
  }
  progress.push('seam: row config -> ' + show(world.seam.rowConfig.origin) + ', env -> ' + show(world.seam.env.origin) + ', neither -> ' + show(world.seam.default.origin) + ', constructor -> ' + show(world.seam.ctor.defaultOrigin))

  world.guard = { fakePorts, deadPort: dead.port, forbiddenPorts: FORBIDDEN_PORTS, defaultWorldToolCalls: world.seam.default.toolCalls }
  world.roots = roots

  // The judge below works on the numbers above and calls nothing; the fakes are closed by shutdownWorlds()
  // on EVERY exit path (see the finally in main).
  for (const subject of [subjectMain, subjectProbe, subjectAway, subjectPresent, subjectDead, subjectChrome, subjectDefault, subjectEnv]) closeSubject(subject)
  return { world, progress, fatal: null }
}
// ---------------------------------------------------------------------------
// The judge: pure over the measured world above, so a mutant can rewrite one fact of it
// ---------------------------------------------------------------------------

/** The shell's own sentence for a refusal this world recorded, recomputed by the gate. */
const expectedRefusal = (info) => {
  if (info === null || info === undefined) return null
  if (info.kind === 'cap') return SHELL.cap(info.nextId, info.limit, info.ids)
  if (info.kind === 'unknownTab') return SHELL.unknownTab(info.op, info.id, info.ids)
  if (info.kind === 'lease') return SHELL.leased(info.other, info.holder)
  return null
}

const judge = (world) => {
  const readings = []
  const add = (id, ok, detail, evidence) => readings.push({ id, ok, detail, evidence: Array.isArray(evidence) ? evidence : [] })
  const missing = (id, what) => add(id, null, 'NOT MEASURED: ' + what, [])
  const calls = world.calls ?? {}
  const problemsOf = (problems) => problems.length === 0 ? null : problems.join(' | ')

  // 1 -----------------------------------------------------------------------------------------------
  {
    const id = '1-the-worlds-op-state-report-is-anchored-in-the-shells-own-format-string'
    const source = world.source
    const shell = world.shell
    if (source?.state?.keys === undefined || shell === undefined || (shell.reportKeys ?? []).length === 0) {
      missing(id, 'the shell own format string or the world own report is not here, so this gate world could not be anchored in the shell')
    } else {
      const problems = []
      const stateDiff = firstListDifference(shell.reportKeys, source.state.keys)
      if (stateDiff !== null) {
        problems.push('op=state key #' + stateDiff.at + ' is ' + show(stateDiff.left) + ' where the shell format string has ' + show(stateDiff.right))
      }
      const tabDiff = firstListDifference(shell.reportTabKeys, source.tabs.keys)
      if (tabDiff !== null) {
        problems.push('the tab row key #' + tabDiff.at + ' is ' + show(tabDiff.left) + ' where the shell format string has ' + show(tabDiff.right))
      }
      if (source.maxTabs === null) problems.push('MAX_TABS could not be parsed out of ' + source.path)
      else if (shell.reportLimit !== source.maxTabs) problems.push('this world caps tabs at ' + show(shell.reportLimit) + ' where the shell says ' + show(source.maxTabs))
      if (shell.reportExists !== true || shell.reportMounted !== true) problems.push('this world did not report itself up (exists=' + show(shell.reportExists) + ', mounted=' + show(shell.reportMounted) + ')')
      add(id, problems.length === 0, problems.length === 0
        ? 'the world answers op=state with the shell own ' + source.state.keys.length + ' keys in the shell own order, and its tab rows carry the shell own ' + source.tabs.keys.length + ' keys; the cap is MAX_TABS=' + show(source.maxTabs) + ' from the same file'
        : problemsOf(problems), [
        'anchor source: ' + source.path + ':' + source.state.line + ' and :' + source.tabs.line,
        'shell format string keys (in order): ' + show(source.state.keys),
        'this world report keys (in order):     ' + show(shell.reportKeys),
        'shell tab-row keys: ' + show(source.tabs.keys) + ' | this world tab-row keys: ' + show(shell.reportTabKeys) + ' | cap: shell ' + show(source.maxTabs) + ', world ' + show(shell.reportLimit),
      ])
    }
  }

  // 2 -----------------------------------------------------------------------------------------------
  {
    const id = '2-the-tab-set-is-read-from-the-shell-on-every-call-and-never-cached'
    const first = calls.readers1 ?? []
    const second = calls.readers2 ?? []
    const mutation = calls.mutation
    if (first.length === 0 || second.length === 0 || mutation === undefined) {
      missing(id, 'no tab-set reader was discovered (or no second read happened), so nothing here can show the shell is re-read')
    } else {
      const problems = []
      for (const call of first) {
        if (call.ok !== true) {
          problems.push(call.tool + ' refused the first read: ' + clip(call.error, 130))
          continue
        }
        for (const tab of call.fake.before.tabs) if (String(call.text).includes(tab.id) === false) problems.push(call.tool + ' did not list ' + tab.id + ' although the shell held it')
        if (String(call.text).includes(String(call.fake.before.count)) === false) problems.push(call.tool + ' did not carry the shell count ' + call.fake.before.count)
        if (call.fake.before.active !== null && String(call.text).includes(String(call.fake.before.active)) === false) problems.push(call.tool + ' did not carry the shell active tab ' + show(call.fake.before.active))
      }
      if (same(second[0].fake.before.ids, mutation.after.ids) === false) problems.push('the second read did not start on the set this gate had just set')
      for (const call of second) {
        if (call.ok !== true) {
          problems.push(call.tool + ' refused the second read: ' + clip(call.error, 130))
          continue
        }
        for (const tab of mutation.after.tabs) if (String(call.text).includes(tab.id) === false) problems.push(call.tool + ' did not carry the tab ' + tab.id + ' this gate added behind its back')
        if (String(call.text).includes('https://b.test/moved') === false) problems.push(call.tool + ' did not carry the url this gate moved behind its back (https://b.test/moved)')
        if (String(call.text).includes(String(mutation.after.active)) === false) problems.push(call.tool + ' did not carry the active tab this gate set behind its back (' + show(mutation.after.active) + ')')
      }
      for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
        if (first[index].text === second[index].text) problems.push(first[index].tool + ' answered the same bytes before and after the shell changed: that is a cache, not a read')
      }
      add(id, problems.length === 0, problems.length === 0
        ? 'every reader answered the FIRST set (' + show(mutation.before.ids) + ' active ' + show(mutation.before.active) + ') and then the set this gate changed behind its back (' + show(mutation.after.ids) + ' active ' + show(mutation.after.active) + ', t5 moved to https://b.test/moved)'
        : problemsOf(problems), [
        'read 1, from the world: ' + show(mutation.before.ids) + ' active=' + show(mutation.before.active) + ' count=' + mutation.before.count,
        'the gate then changed the shell with no call to the plugin: ' + show(mutation.after.ids) + ' active=' + show(mutation.after.active) + ' count=' + mutation.after.count,
        ...first.map((call) => 'answer 1 [' + call.tool + ']: ' + clip(call.text, 220)),
        ...second.map((call) => 'answer 2 [' + call.tool + ']: ' + clip(call.text, 220)),
      ])
    }
  }

  // 3 -----------------------------------------------------------------------------------------------
  {
    const id = '3-a-named-tab-travels-verbatim-into-every-cdp-request-and-an-omitted-one-sends-no-field'
    const family = calls.family ?? []
    const withBodies = family.filter((entry) => entry.withTab.ok === true && entry.withTab.cdp.length > 0)
    const withoutBodies = family.filter((entry) => entry.withoutTab.ok === true && entry.withoutTab.cdp.length > 0)
    if (family.length === 0) {
      missing(id, 'no tool in this build declares a tab parameter, so the family this reading is about is not here')
    } else if (withBodies.length === 0) {
      missing(id, 'no tool that declares a tab reached the page at all (' + family.map((entry) => entry.tool + ': ' + clip(entry.withTab.error ?? '', 50)).join('; ') + ')')
    } else if (withoutBodies.length === 0) {
      missing(id, 'no tool that declares a tab reached the page with the tab OMITTED, so "an omitted tab sends no field" has nothing to be read from')
    } else {
      const problems = []
      for (const entry of withBodies) {
        for (const body of entry.withTab.cdp) {
          if (body.tabPresent !== true || body.tab !== MARKER_TAB) {
            problems.push(entry.tool + ' sent ' + show(body.method) + ' with tab=' + (body.tabPresent === true ? show(body.tab) : '(no tab field)') + ' although the caller named ' + MARKER_TAB)
          }
        }
      }
      for (const entry of withoutBodies) {
        for (const body of entry.withoutTab.cdp) {
          if (body.tabPresent === true) problems.push(entry.tool + ' sent ' + show(body.method) + ' with a tab field (' + show(body.tab) + ') although the caller named no tab')
        }
      }
      const switched = calls.familySwitch
      if (switched === null || switched === undefined) problems.push('no tool could be called with two different tabs in a row, so a client that keeps the first tab it was given would not be caught')
      else if (switched.tab === MARKER_TAB) problems.push('the second call could not be given a tab other than ' + MARKER_TAB + ', so the switch was never exercised')
      else if (switched.call.ok !== true || switched.call.cdp.length === 0) problems.push('the second call of ' + switched.tool + ' with ' + show(switched.tab) + ' reached no page: ' + clip(switched.call.error ?? '(no cdp request)', 130))
      else {
        for (const body of switched.call.cdp) {
          if (body.tabPresent !== true || body.tab !== switched.tab) problems.push('the same tool, asked for ' + show(switched.tab) + ' after ' + MARKER_TAB + ', sent ' + show(body.method) + ' with tab=' + (body.tabPresent === true ? show(body.tab) : '(no tab field)'))
        }
      }
      add(id, problems.length === 0, problems.length === 0
        ? 'all ' + withBodies.length + ' tool(s) that reached the page with a tab named put that tab in EVERY cdp request verbatim; all ' + withoutBodies.length + ' that reached it with the tab omitted sent no tab field at all, and the same tool asked for two different tabs sent each of them'
        : problemsOf(problems), [
        'tools that declare a tab: ' + show(family.map((entry) => entry.tool)),
        ...withBodies.map((entry) => entry.tool + ' {tab:' + MARKER_TAB + '} -> ' + entry.withTab.cdp.length + ' cdp request(s), tabs=' + show(entry.withTab.cdp.map((body) => (body.tabPresent ? body.tab : '(none)')) ) + ' methods=' + show(entry.withTab.cdp.map((body) => body.method))),
        ...withoutBodies.map((entry) => entry.tool + ' {} -> ' + entry.withoutTab.cdp.length + ' cdp request(s), tab field present=' + show(entry.withoutTab.cdp.map((body) => body.tabPresent)) + ' methods=' + show(entry.withoutTab.cdp.map((body) => body.method))),
        switched === null || switched === undefined ? 'no two-tab switch was possible' : 'switch: ' + switched.tool + ' {tab:' + MARKER_TAB + '} then {tab:' + show(switched.tab) + '}; the second answered with tabs=' + show(switched.call.cdp.map((body) => (body.tabPresent ? body.tab : '(none)'))),
        'kept out of the page family (they change the tab set, or navigate through tab-goto, and have readings of their own): ' + show(calls.familyExcluded ?? []),
        ...family.filter((entry) => entry.withTab.ok !== true || entry.withTab.cdp.length === 0).map((entry) => 'not counted: ' + entry.tool + ' -> ' + clip(entry.withTab.error ?? entry.withTab.text ?? '(nothing)', 110)),
      ])
    }
  }

  // 4 -----------------------------------------------------------------------------------------------
  {
    const id = '4-goto-walks-the-shells-per-tab-op-and-reports-where-that-tab-itself-landed'
    const named = calls.gotoNamed
    const omitted = calls.gotoOmitted
    if (named === undefined || omitted === undefined) {
      missing(id, 'the tool that navigates a named tab through op=tab-goto was not discovered, so the panel-channel navigation cannot be judged')
    } else {
      const problems = []
      const before = named.fake.before
      const after = named.fake.after
      if (named.ok !== true) problems.push('the named-tab navigation refused: ' + clip(named.error, 150))
      const gotos = named.ops.filter((entry) => entry.op === 'tab-goto')
      if (gotos.length === 0) problems.push('no op=tab-goto reached the shell: the panel channel navigation did not use the shell per-tab op')
      else {
        if (gotos.some((entry) => entry.id !== MARKER_TAB)) problems.push('op=tab-goto carried id=' + show(gotos.map((entry) => entry.id)) + ' where the caller named ' + MARKER_TAB)
        if (gotos.some((entry) => entry.url !== REQUESTED_URL)) problems.push('op=tab-goto carried url=' + show(gotos.map((entry) => entry.url)) + ' where the caller asked for ' + REQUESTED_URL)
      }
      const navigates = named.cdp.filter((body) => body.method === 'Page.navigate')
      if (navigates.length > 0) problems.push('Page.navigate was sent ' + navigates.length + ' time(s) during a panel-channel navigation: with no tab field the shell hands that to the ACTIVE tab, the page the user is looking at')
      if (before.active === MARKER_TAB) problems.push('the named tab WAS the active one in this world, so this reading could not tell "the tab I named" from "the tab on screen"')
      const activeBefore = before.tabs.find((tab) => tab.id === before.active) ?? null
      const activeAfter = after.tabs.find((tab) => tab.id === before.active) ?? null
      if (activeBefore === null || activeAfter === null) problems.push('the active tab is missing from one of the world snapshots')
      else if (activeBefore.record !== activeAfter.record || activeBefore.own !== activeAfter.own) {
        problems.push('the ACTIVE tab moved too: its record ' + show(activeBefore.record) + ' -> ' + show(activeAfter.record) + ' and its own document ' + show(activeBefore.own) + ' -> ' + show(activeAfter.own))
      }
      const targetBefore = before.tabs.find((tab) => tab.id === MARKER_TAB) ?? null
      const targetAfter = after.tabs.find((tab) => tab.id === MARKER_TAB) ?? null
      if (targetBefore === null || targetAfter === null) problems.push('the named tab is missing from one of the world snapshots')
      else {
        if (targetAfter.record !== REQUESTED_URL) problems.push('the shell record of ' + MARKER_TAB + ' is ' + show(targetAfter.record) + ': the url the caller asked for did not reach that tab')
        if (targetAfter.own !== LANDED_URL) problems.push('that tab own document is ' + show(targetAfter.own) + ', not the landing url ' + LANDED_URL + ' this world redirects to')
        if (targetAfter.own === targetBefore.own) problems.push('that tab own document did not move at all')
      }
      if (REQUESTED_URL === LANDED_URL) problems.push('this world does not tell the requested url from the landing url, so a reply that echoed the request could not be told apart')
      if (String(named.text).includes(LANDED_URL) === false) problems.push('the reply does not carry the url read from the TAB ITSELF (' + LANDED_URL + '); a tool that echoed what it asked for would look the same')
      if (String(named.text).includes(MARKER_TAB) === false) problems.push('the reply does not say which tab it navigated')
      const omittedGotos = omitted.ops.filter((entry) => entry.op === 'tab-goto')
      if (omitted.ok !== true) problems.push('the same tool with NO tab named refused: ' + clip(omitted.error, 140))
      else if (omittedGotos.length === 0) problems.push('with no tab named, no op=tab-goto reached the shell')
      else if (omittedGotos.some((entry) => entry.id !== omitted.fake.before.active)) problems.push('with no tab named, op=tab-goto carried id=' + show(omittedGotos.map((entry) => entry.id)) + ' where the shell active tab was ' + show(omitted.fake.before.active))
      else {
        const moved = omitted.fake.after.tabs.find((tab) => tab.id === omitted.fake.before.active) ?? null
        if (moved === null || moved.record !== LATE_URL) problems.push('the active tab record is ' + show(moved?.record ?? null) + ' after the second navigation, not ' + LATE_URL)
      }
      add(id, problems.length === 0, problems.length === 0
        ? 'the panel-channel navigation sent op=tab-goto for exactly ' + MARKER_TAB + ' (+ no Page.navigate), left the active tab ' + show(before.active) + ' untouched, and reported ' + LANDED_URL + ', the url read from that tab itself, while the shell record kept the requested ' + REQUESTED_URL
        : problemsOf(problems), [
        'named call ops: ' + show(named.ops.map((entry) => entry.op + (entry.id === null ? '' : ':' + entry.id))),
        'named call cdp methods: ' + show(named.cdp.map((body) => body.method + ' tab=' + (body.tabPresent ? show(body.tab) : '(none)'))),
        'world around it: active ' + show(before.active) + ' record/own ' + show(before.tabs.find((tab) => tab.id === before.active)?.record) + ' / ' + show(before.tabs.find((tab) => tab.id === before.active)?.own) + ' -> ' + show(after.tabs.find((tab) => tab.id === before.active)?.record) + ' / ' + show(after.tabs.find((tab) => tab.id === before.active)?.own),
        'the named tab ' + MARKER_TAB + ': record ' + show(targetBefore?.record) + ' -> ' + show(targetAfter?.record) + ', own document ' + show(targetBefore?.own) + ' -> ' + show(targetAfter?.own),
        'reply: ' + clip(named.text, 300),
        'omitted call: ops ' + show(omitted.ops.map((entry) => entry.op + (entry.id === null ? '' : ':' + entry.id))) + ' (active was ' + show(omitted.fake.before.active) + '), reply ' + clip(omitted.text ?? omitted.error, 140),
      ])
    }
  }

  // 5 -----------------------------------------------------------------------------------------------
  {
    const id = '5-the-four-tab-tools-do-what-their-own-words-say'
    const created = calls.newTab
    const closed = calls.closeTab
    const activated = calls.activate
    const readers = calls.readers3 ?? []
    if (created === undefined || closed === undefined || activated === undefined) {
      missing(id, 'the four tab behaviours were not all discovered: new=' + show(world.discovery?.newTool ?? null) + ' close=' + show(world.discovery?.closeTool ?? null) + ' activate=' + show(world.discovery?.activateTool ?? null))
    } else if (readers.length === 0) {
      missing(id, 'no tab-set reader was discovered, so the numbers the tools report cannot be compared with the shell')
    } else {
      const problems = []
      for (const call of readers) {
        if (call.ok !== true) {
          problems.push(call.tool + ' refused: ' + clip(call.error, 120))
          continue
        }
        const state = call.fake.before
        for (const tab of state.tabs) if (String(call.text).includes(tab.id) === false) problems.push(call.tool + ' did not list the tab ' + tab.id + ' the shell held')
        if (String(call.text).includes(String(state.count)) === false) problems.push(call.tool + ' did not carry the shell count ' + state.count)
        if (state.active !== null && String(call.text).includes(String(state.active)) === false) problems.push(call.tool + ' did not carry the shell active tab ' + show(state.active))
      }
      const newBefore = created.fake.before
      const newAfter = created.fake.after
      if (created.ok !== true) problems.push('the tab-new tool refused: ' + clip(created.error, 140))
      const gained = newAfter.ids.filter((tabId) => newBefore.ids.includes(tabId) === false)
      if (gained.length !== 1 || newAfter.count !== newBefore.count + 1) {
        problems.push('the shell gained ' + show(gained) + ' tab(s) (count ' + newBefore.count + ' -> ' + newAfter.count + '), so exactly one tab was not created')
      } else {
        if (newAfter.active !== gained[0]) problems.push('the created tab ' + gained[0] + ' is not the shell active one (' + show(newAfter.active) + ')')
        if (String(created.text).includes(gained[0]) === false) problems.push('the reply does not carry ' + gained[0] + ', the id the SHELL created')
      }
      const newOps = created.ops.map((entry) => entry.op)
      const writeAt = newOps.indexOf('tab-new')
      if (writeAt < 0) problems.push('no op=tab-new reached the shell')
      else if (newOps.slice(writeAt + 1).includes('state') === false) problems.push('no op=state arrived after the write: the answer was not read back from the shell (' + show(newOps) + ')')
      const closeBefore = closed.fake.before
      const closeAfter = closed.fake.after
      const closedId = closed.args?.tab
      if (closed.ok !== true) problems.push('the tab-close tool refused: ' + clip(closed.error, 140))
      if (closeBefore.active !== closedId) problems.push('the tab the gate closed (' + show(closedId) + ') was not the shell active one (' + show(closeBefore.active) + '), so the left-neighbour rule was never exercised')
      const remaining = closeBefore.tabs.filter((tab) => tab.id !== closedId)
      const at = closeBefore.tabs.findIndex((tab) => tab.id === closedId)
      const expected = remaining.length === 0 ? null : remaining[Math.max(0, Math.min(at - 1, remaining.length - 1))].id
      if (expected !== null && expected === remaining[0]?.id) problems.push('this world was built so the left neighbour IS the first tab, so "left" and "first" could not be told apart')
      if (closeAfter.active !== expected) problems.push('after closing ' + show(closedId) + ' the shell made ' + show(closeAfter.active) + ' active, not the left neighbour ' + show(expected))
      if (expected !== null && String(closed.text).includes(String(expected)) === false) problems.push('the reply does not report the tab the shell made active (' + show(expected) + ')')
      const activateBefore = activated.fake.before
      const activateAfter = activated.fake.after
      const wanted = activated.args?.tab
      if (activated.ok !== true) problems.push('the tab-activate tool refused: ' + clip(activated.error, 140))
      if (activateBefore.active === wanted) problems.push('the tab the gate activated was already active, so this half proves nothing')
      if (activateAfter.active !== wanted) problems.push('after the activate call the shell active tab is ' + show(activateAfter.active) + ', not ' + show(wanted))
      if (String(activated.text).includes(String(wanted)) === false) problems.push('the reply does not report ' + show(wanted) + ' as the active tab')
      add(id, problems.length === 0, problems.length === 0
        ? 'the readers carry the shell own count/ids/active; the new tab is the id the SHELL made and becomes active with a state read AFTER the write; closing the active tab puts its left neighbour ' + show(expected) + ' in front (not the first tab ' + show(remaining[0]?.id) + '); activating moves the shell active tab'
        : problemsOf(problems), [
        ...readers.map((call) => 'reader [' + call.tool + '] against the shell ' + show(call.fake.before.ids) + ' active=' + show(call.fake.before.active) + ': ' + clip(call.text, 200)),
        'new: ops ' + show(created.ops.map((entry) => entry.op)) + ' | shell ' + show(newBefore.ids) + ' -> ' + show(newAfter.ids) + ', active ' + show(newBefore.active) + ' -> ' + show(newAfter.active) + ' | reply ' + clip(created.text, 160),
        'close: ops ' + show(closed.ops.map((entry) => entry.op)) + ' | closed ' + show(closedId) + ' (active was ' + show(closeBefore.active) + '), remaining ' + show(remaining.map((tab) => tab.id)) + ', left neighbour ' + show(expected) + ' vs first ' + show(remaining[0]?.id ?? null) + ' | reply ' + clip(closed.text, 160),
        'activate: ops ' + show(activated.ops.map((entry) => entry.op)) + ' | active ' + show(activateBefore.active) + ' -> ' + show(activateAfter.active) + ' | reply ' + clip(activated.text, 160),
      ])
    }
  }

  // 6 -----------------------------------------------------------------------------------------------
  {
    const id = '6-a-refusal-is-the-shells-own-sentence-and-the-tab-set-does-not-move'
    const cases = [
      { label: 'the cap', call: calls.refusalCap },
      { label: 'an unknown id on close', call: calls.refusalUnknownClose },
      { label: 'an unknown id on activate', call: calls.refusalUnknownActivate },
      { label: 'a lease held by somebody else', call: calls.refusalLease },
    ]
    if (cases.every((entry) => entry.call === undefined)) {
      missing(id, 'none of the four refusals could be attempted (the tools they belong to were not discovered)')
    } else {
      const problems = []
      for (const entry of cases) {
        const call = entry.call
        if (call === undefined) {
          problems.push(entry.label + ': the call could not be made')
          continue
        }
        const refusals = call.refusals ?? []
        if (refusals.length !== 1) {
          problems.push(entry.label + ': the shell refused ' + refusals.length + ' time(s) in that call, so there is no single sentence to compare')
          continue
        }
        const expected = expectedRefusal(refusals[0].info)
        if (expected === null) problems.push(entry.label + ': this gate has no sentence for the refusal kind ' + show(refusals[0].info?.kind))
        else if (refusals[0].sentence !== expected) problems.push(entry.label + ': this world refused with ' + show(clip(refusals[0].sentence, 90)) + ' where the shell own sentence is ' + show(clip(expected, 90)))
        if (call.ok !== false) problems.push(entry.label + ': the tool did NOT refuse; it answered ' + clip(call.text, 110))
        else if (call.error !== expected) problems.push(entry.label + ': the tool surfaced ' + show(clip(call.error, 130)) + ' instead of the shell own sentence ' + show(clip(expected, 130)))
        if (call.fake.before.count !== call.fake.after.count || same(call.fake.before.ids, call.fake.after.ids) === false || call.fake.before.active !== call.fake.after.active) {
          problems.push(entry.label + ': the shell tab set moved anyway (' + show(call.fake.before.ids) + ' active ' + show(call.fake.before.active) + ' -> ' + show(call.fake.after.ids) + ' active ' + show(call.fake.after.active) + ')')
        }
      }
      add(id, problems.length === 0, problems.length === 0
        ? 'all four refusals arrived byte for byte as the sentences this gate recomputed from the shell own source, and the shell tab set was identical before and after each one'
        : problemsOf(problems), cases.map((entry) => {
        const call = entry.call
        if (call === undefined) return entry.label + ': not attempted'
        const info = call.refusals?.[0]?.info ?? null
        return entry.label + ': the shell said ' + show(clip(call.refusals?.[0]?.sentence ?? '(nothing)', 150)) + ' | this gate recomputed ' + show(clip(expectedRefusal(info) ?? '(none)', 150)) + ' | the tool surfaced ' + show(clip(call.error ?? call.text ?? '(nothing)', 150))
      }).concat(cases.map((entry) => entry.label + ': tab set ' + show(entry.call?.fake.before.ids ?? null) + ' -> ' + show(entry.call?.fake.after.ids ?? null))))
    }
  }

  // 7 -----------------------------------------------------------------------------------------------
  {
    const id = '7-a-panel-that-is-not-there-is-refused-by-name-and-nothing-is-written'
    const absent = world.absent
    if (absent === undefined) {
      missing(id, 'the worlds without a panel were not built')
    } else {
      const problems = []
      const pairs = [
        ['nothing is listening at all', absent.dead],
        ['the shell answers exists=false and mounted=false', absent.away],
      ]
      for (const [label, entry] of pairs) {
        for (const [what, call] of [['the tab-set reader', entry.reader], ['the tab-close tool with no tab named', entry.closeNoTab]]) {
          if (call === null || call === undefined) {
            problems.push(label + ' / ' + what + ': the call could not be made')
            continue
          }
          if (call.ok !== false) {
            problems.push(label + ' / ' + what + ': did NOT refuse; it answered ' + clip(call.text, 110))
            continue
          }
          if (String(call.error).startsWith('TABS_NO_PANEL') === false) problems.push(label + ' / ' + what + ': the refusal is not the package own named refusal: ' + clip(call.error, 150))
          if (String(call.error).includes(entry.origin) === false) problems.push(label + ' / ' + what + ': the refusal does not name the origin this gate pointed the plugin at (' + entry.origin + ')')
          const writes = call.ops.filter((op) => op.write === true)
          if (writes.length > 0) problems.push(label + ' / ' + what + ': sent a WRITE (' + show(writes.map((op) => op.op)) + ') while the panel was not there')
        }
      }
      const control = absent.present?.closeNoTab
      if (control === undefined || control.ok !== true) problems.push('the paired control failed: with the panel up the same call answered ' + clip(control?.error ?? control?.text ?? '(nothing)', 140))
      else if (control.ops.some((op) => op.op === 'tab-close') === false) problems.push('the paired control did not send op=tab-close, so it did not exercise the same path')
      add(id, problems.length === 0, problems.length === 0
        ? 'with nothing listening and with the shell reporting no panel, both the reader and the tab-close tool refused with the package own named refusal (TABS_NO_PANEL, naming the origin) and sent no write; the same call with the panel up worked'
        : problemsOf(problems), [
        'dead origin call: ' + show(absent.dead?.reader?.error ?? absent.dead?.reader?.text ?? '(not made)'),
        'exists=false reader: ' + show(absent.away?.reader?.error ?? absent.away?.reader?.text ?? '(not made)'),
        'exists=false close (no tab named): ' + show(absent.away?.closeNoTab?.error ?? absent.away?.closeNoTab?.text ?? '(not made)'),
        'ops sent while the panel was not there: dead=' + show((absent.dead?.reader?.ops ?? []).map((op) => op.op).concat((absent.dead?.closeNoTab?.ops ?? []).map((op) => op.op))) + ', away=' + show((absent.away?.reader?.ops ?? []).map((op) => op.op).concat((absent.away?.closeNoTab?.ops ?? []).map((op) => op.op))),
        'paired control (panel up): ok=' + show(control?.ok) + ' ops=' + show((control?.ops ?? []).map((op) => op.op)) + ' reply ' + clip(control?.text ?? control?.error ?? '(nothing)', 140),
      ])
    }
  }

  // 8 -----------------------------------------------------------------------------------------------
  {
    const id = '8-the-model-visible-words-are-conditional-on-the-channel'
    const panel = world.words?.panel
    const chrome = world.words?.chrome
    if (panel === undefined || chrome === undefined || Object.keys(chrome.descriptions ?? {}).length === 0) {
      missing(id, 'the two channels could not both be read out of this build, so the words cannot be compared')
    } else {
      const problems = []
      const textsOf = (side) => [...Object.values(side.descriptions ?? {}), ...Object.values(side.params ?? {}).flatMap((entry) => Object.values(entry ?? {}))]
      const panelTexts = textsOf(panel)
      const chromeTexts = textsOf(chrome)
      for (const sentence of OLD_SENTENCES) {
        if (panelTexts.some((text) => String(text).includes(sentence))) problems.push('the panel channel still carries the sentence ' + show(clip(sentence, 56)))
      }
      if (panelTexts.some((text) => /multiple instances/i.test(String(text)))) problems.push('the panel channel still says "multiple instances"')
      if (panelTexts.some((text) => /each with its own window/i.test(String(text)))) problems.push('the panel channel still says "each with its own window"')
      const carried = OLD_SENTENCES.filter((sentence) => chromeTexts.some((text) => String(text).includes(sentence)))
      if (carried.length === 0) problems.push('the chrome channel of this SAME build carries none of the three sentences either, so "the panel channel does not say it" cannot be told from "the words were dropped from the build"')
      const chromeReaders = chrome.readers ?? []
      const panelReaders = panel.readers ?? []
      if (chromeReaders.length === 0) problems.push('the tab-set readers could not be called on the chrome channel')
      if (panelReaders.length === 0) problems.push('no tab-set reader was called on the panel channel')
      let refusedByChannel = 0
      for (const entry of chromeReaders) {
        const call = entry.call
        if (call !== null && call !== undefined && call.ok === false && String(call.error).startsWith('TABS_CHANNEL')) {
          refusedByChannel += 1
          continue
        }
        // The other legitimate answer on that channel: the INSTANCES list (this build's browser_list really
        // is about instances there). A tab set listed on the chrome channel is neither.
        const said = String(call?.text ?? call?.error ?? '')
        if (/instance/i.test(said) === false) {
          problems.push('on the chrome channel ' + entry.tool + ' answered ' + clip(said, 130) + ' - neither the package own TABS_CHANNEL nor the instances list this channel really has')
        }
      }
      if (chromeReaders.length > 0 && refusedByChannel === 0) problems.push('no reader refused with TABS_CHANNEL on the chrome channel, so the tab face is not refused by name there')
      if (chrome.profileDir === true) {
        problems.push('a call on the chrome channel tried to OPEN a browser instance (a profile directory appeared under this world); this gate will not drive that channel as far as starting one')
      }
      for (const entry of panelReaders) {
        const call = entry.call
        if (call === null || call === undefined || call.ok !== true) problems.push('on the panel channel the reader ' + entry.tool + ' did not answer the shell tab set: ' + clip(call?.error ?? '(not called)', 130))
        else if (/\binstances\b/i.test(String(call.text))) problems.push('on the panel channel ' + entry.tool + ' answered an instances list: ' + clip(call.text, 130))
      }
      add(id, problems.length === 0, problems.length === 0
        ? 'no panel-channel text or answer carries the three sentences that claimed several instances (' + carried.length + ' of them are still on the chrome channel of the same build); on that channel the tab reader refuses with TABS_CHANNEL and the other reader answers the instances list, while both answer the shell tab set here'
        : problemsOf(problems), [
        'panel / browser_open: ' + clip(panel.descriptions?.browser_open ?? '(no such tool)', 200),
        'chrome / browser_open: ' + clip(chrome.descriptions?.browser_open ?? '(no such tool)', 200),
        'chrome sentences still carried: ' + show(carried.map((sentence) => clip(sentence, 56))),
        'panel channel startup line: ' + show(panel.startupLine),
        'chrome channel startup line: ' + show(chrome.startupLine) + ' (its own channel sentence is ' + show(chrome.startupLines ?? []) + ')',
        'chrome channel reader calls: ' + show((chrome.readers ?? []).map((entry) => entry.tool + ' -> ' + clip(entry.call?.error ?? entry.call?.text ?? '(nothing)', 90))),
        'panel channel reader calls: ' + show((panel.readers ?? []).map((entry) => entry.tool + ' -> ' + clip(entry.call?.text ?? entry.call?.error ?? '(nothing)', 90))),
        'no browser was opened behind this offline gate: chrome-channel profile dir=' + show(chrome.profileDir) + ', panel-channel profile dir=' + show(panel.profileDir) + ' (the chrome world points at ' + show(chrome.browserExecutable) + ', which does not exist)',
      ])
    }
  }

  // 9 -----------------------------------------------------------------------------------------------
  {
    const id = '9-the-panel-origin-seam-is-wired-and-the-default-is-not-touched'
    const seam = world.seam
    if (seam === undefined) {
      missing(id, 'the worlds that read where the plugin points were not built')
    } else {
      const problems = []
      if (seam.rowConfig.origin !== seam.rowConfig.fake) problems.push('with row config panelOrigin set, apply() logged ' + show(seam.rowConfig.origin) + ' instead of this gate fake ' + show(seam.rowConfig.fake))
      if (seam.rowConfig.fakeRequests <= 0) problems.push('no request reached the row-config fake, so that world was never driven through the seam')
      if (seam.env.origin !== seam.env.fake) problems.push('with DSH_BROWSER_PANEL_ORIGIN set, apply() logged ' + show(seam.env.origin) + ' instead of this gate second fake ' + show(seam.env.fake))
      if (seam.env.readerCalled !== true) problems.push('the env world was not driven: this gate only calls a tool there once apply() itself has said the resolved origin is its fake (' + show(seam.env.origin) + ')')
      else {
        if (seam.env.reader.ok !== true) problems.push('the reader in the env world refused: ' + clip(seam.env.reader.error, 130))
        else if (String(seam.env.reader.text).includes('t41') === false) problems.push('the reader in the env world did not answer the second fake own tab set (t41)')
        if (seam.env.fakeRequests <= 0) problems.push('the second fake was never asked anything, so the env value did not reach the transport')
      }
      if (seam.default.origin !== DEFAULT_ORIGIN) problems.push('with neither seam set, apply() logged ' + show(seam.default.origin) + ' where the unchanged default is ' + DEFAULT_ORIGIN)
      if (seam.default.origin === seam.rowConfig.fake) problems.push('with neither seam set the plugin pointed at this gate fake anyway, so the default was not really measured')
      if (seam.default.toolCalls !== 0) problems.push('the world with the default origin made tool calls, which would dial the live shell')
      if (seam.ctor.defaultOrigin !== DEFAULT_ORIGIN) problems.push('the shipped BrowserRegistry constructor defaults to ' + show(seam.ctor.defaultOrigin) + ' where the unchanged default is ' + DEFAULT_ORIGIN)
      if (seam.ctor.givenOrigin !== seam.ctor.given) problems.push('the shipped BrowserRegistry constructor ignored panelOrigin=' + show(seam.ctor.given) + ' and answered ' + show(seam.ctor.givenOrigin))
      add(id, problems.length === 0, problems.length === 0
        ? 'row config panelOrigin and DSH_BROWSER_PANEL_ORIGIN both reached the transport (two different fakes answered), and with neither set the resolved origin is still ' + DEFAULT_ORIGIN + ' - measured where it is read, with no connection made to it'
        : problemsOf(problems), [
        'row config: ' + show(seam.rowConfig.origin) + ' (fake ' + show(seam.rowConfig.fake) + '), ' + seam.rowConfig.fakeRequests + ' request(s) recorded by that fake',
        'env: ' + show(seam.env.origin) + ' (fake ' + show(seam.env.fake) + '), reader called=' + show(seam.env.readerCalled) + ', ' + seam.env.fakeRequests + ' request(s) recorded by that fake | ' + clip(seam.env.reader?.text ?? seam.env.reader?.error ?? '(not called)', 130),
        'neither: ' + show(seam.default.origin) + ' from the line ' + show(seam.default.startupLine),
        'constructor: default ' + show(seam.ctor.defaultOrigin) + ', given ' + show(seam.ctor.given) + ' -> ' + show(seam.ctor.givenOrigin),
        'guard: fake ports ' + show(world.guard?.fakePorts ?? []) + ', forbidden ' + show(world.guard?.forbiddenPorts ?? []) + ', the default world made ' + show(seam.default.toolCalls) + ' tool call(s)',
      ])
    }
  }

  return readings
}
// ---------------------------------------------------------------------------
// The self-attack: mutate the MEASURED world, one reading per mutant
// ---------------------------------------------------------------------------

const mutants = (world) => {
  const clone = () => structuredClone(world)
  const R1 = '1-the-worlds-op-state-report-is-anchored-in-the-shells-own-format-string'
  const R2 = '2-the-tab-set-is-read-from-the-shell-on-every-call-and-never-cached'
  const R3 = '3-a-named-tab-travels-verbatim-into-every-cdp-request-and-an-omitted-one-sends-no-field'
  const R4 = '4-goto-walks-the-shells-per-tab-op-and-reports-where-that-tab-itself-landed'
  const R5 = '5-the-four-tab-tools-do-what-their-own-words-say'
  const R6 = '6-a-refusal-is-the-shells-own-sentence-and-the-tab-set-does-not-move'
  const R7 = '7-a-panel-that-is-not-there-is-refused-by-name-and-nothing-is-written'
  const R8 = '8-the-model-visible-words-are-conditional-on-the-channel'
  const R9 = '9-the-panel-origin-seam-is-wired-and-the-default-is-not-touched'
  const familyWithBodies = (next) => (next.calls?.family ?? []).filter((entry) => entry.withTab.ok === true && entry.withTab.cdp.length > 0)
  const familyWithoutBodies = (next) => (next.calls?.family ?? []).filter((entry) => entry.withoutTab.ok === true && entry.withoutTab.cdp.length > 0)
  return [
    {
      name: 'the-worlds-report-drops-the-limit-key',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.shell.reportKeys = next.shell.reportKeys.filter((key) => key !== 'limit'); return next })(),
    },
    {
      name: 'the-worlds-report-reorders-two-keys',
      mustRedden: [R1],
      world: (() => {
        const next = clone()
        const keys = next.shell.reportKeys
        const at = keys.indexOf('active')
        const swap = keys[at]
        keys[at] = keys[at + 1]
        keys[at + 1] = swap
        return next
      })(),
    },
    {
      name: 'a-tab-row-loses-its-bounds-field',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.shell.reportTabKeys = next.shell.reportTabKeys.filter((key) => key !== 'bounds'); return next })(),
    },
    {
      name: 'the-world-caps-tabs-above-the-shells-own-constant',
      mustRedden: [R1],
      world: (() => { const next = clone(); next.shell.reportLimit = 5; return next })(),
    },
    {
      name: 'the-second-read-answers-the-first-answer',
      mustRedden: [R2],
      world: (() => {
        const next = clone()
        for (let index = 0; index < next.calls.readers2.length; index += 1) next.calls.readers2[index].text = next.calls.readers1[index].text
        return next
      })(),
    },
    {
      name: 'a-cdp-request-loses-the-named-tab',
      mustRedden: [R3],
      world: (() => {
        const next = clone()
        const entry = familyWithBodies(next)[0]
        entry.withTab.cdp[0].tab = null
        entry.withTab.cdp[0].tabPresent = false
        return next
      })(),
    },
    {
      name: 'a-cdp-request-answers-a-different-tab',
      mustRedden: [R3],
      world: (() => {
        const next = clone()
        const entry = familyWithBodies(next)[0]
        entry.withTab.cdp[0].tab = 't2'
        return next
      })(),
    },
    {
      name: 'an-omitted-tab-arrives-as-an-empty-string',
      mustRedden: [R3],
      world: (() => {
        const next = clone()
        const entry = familyWithoutBodies(next)[0]
        entry.withoutTab.cdp[0].tab = ''
        entry.withoutTab.cdp[0].tabPresent = true
        return next
      })(),
    },
    {
      name: 'goto-still-navigates-the-active-tab',
      mustRedden: [R4],
      world: (() => {
        const next = clone()
        const call = next.calls.gotoNamed
        call.ops = call.ops.filter((entry) => entry.op !== 'tab-goto')
        call.cdp = call.cdp.concat([{ method: 'Page.navigate', tabPresent: false, tab: null, status: 200 }])
        return next
      })(),
    },
    {
      name: 'goto-reports-the-url-it-asked-for-as-where-the-tab-landed',
      mustRedden: [R4],
      world: (() => {
        const next = clone()
        next.calls.gotoNamed.text = String(next.calls.gotoNamed.text).split(LANDED_URL).join(REQUESTED_URL)
        return next
      })(),
    },
    {
      name: 'a-world-that-does-not-redirect-so-the-two-urls-are-one',
      mustRedden: [R4],
      world: (() => {
        const next = clone()
        const tab = next.calls.gotoNamed.fake.after.tabs.find((entry) => entry.id === MARKER_TAB)
        tab.own = REQUESTED_URL
        return next
      })(),
    },
    {
      name: 'the-created-tab-id-is-invented',
      mustRedden: [R5],
      world: (() => {
        const next = clone()
        next.calls.newTab.text = 'opened tab t99 (it is the active one now)\ntabs (4 of 4); "*" marks the active tab t99'
        return next
      })(),
    },
    {
      name: 'closing-the-active-tab-puts-the-first-tab-in-front',
      mustRedden: [R5],
      world: (() => {
        const next = clone()
        const call = next.calls.closeTab
        const remaining = call.fake.before.tabs.filter((entry) => entry.id !== call.args.tab)
        call.fake.after.active = remaining[0].id
        return next
      })(),
    },
    {
      name: 'the-writer-reports-the-count-it-asked-for',
      mustRedden: [R5],
      world: (() => { const next = clone(); next.calls.newTab.fake.after.count = next.calls.newTab.fake.before.count; return next })(),
    },
    {
      name: 'the-cap-refusal-loses-the-list-of-live-tabs',
      mustRedden: [R6],
      world: (() => { const next = clone(); next.calls.refusalCap.error = 'named refusal: too many tabs are open; close one first'; return next })(),
    },
    {
      name: 'the-unknown-id-refusal-is-rewritten-in-our-own-words',
      mustRedden: [R6],
      world: (() => { const next = clone(); next.calls.refusalUnknownClose.error = 'TABS_INPUT: browser_tab_close needs a tab id from browser_tabs'; return next })(),
    },
    {
      name: 'a-refusal-opened-a-tab-anyway',
      mustRedden: [R6],
      world: (() => {
        const next = clone()
        const call = next.calls.refusalCap
        call.fake.after = { ...call.fake.after, count: call.fake.after.count + 1, ids: call.fake.after.ids.concat(['t12']) }
        return next
      })(),
    },
    {
      name: 'the-lease-refusal-becomes-our-own-code',
      mustRedden: [R6],
      world: (() => { const next = clone(); next.calls.refusalLease.error = 'TABS_LEASED: the panel is held by somebody else'; return next })(),
    },
    {
      name: 'the-absent-panel-refusal-loses-its-name',
      mustRedden: [R7],
      world: (() => { const next = clone(); next.absent.away.reader.error = 'the user right column is not open'; return next })(),
    },
    {
      name: 'the-absent-panel-refusal-sent-a-write-anyway',
      mustRedden: [R7],
      world: (() => {
        const next = clone()
        next.absent.away.closeNoTab.ops = next.absent.away.closeNoTab.ops.concat([{ op: 'tab-close', id: 't2', url: null, holder: 'dsh-browser', write: true, status: 200 }])
        return next
      })(),
    },
    {
      name: 'the-panel-channel-puts-the-multi-instance-sentence-back',
      mustRedden: [R8],
      world: (() => {
        const next = clone()
        next.words.panel.descriptions.browser_open = String(next.words.panel.descriptions.browser_open) + ' Multiple instances can be open at once, each with its own window, profile, and pinned viewport.'
        return next
      })(),
    },
    {
      name: 'the-panel-channel-calls-its-handle-an-instance-id',
      mustRedden: [R8],
      world: (() => { const next = clone(); next.words.panel.params.browser_open.id = 'Browser instance id. Omit to use the most recently used one.'; return next })(),
    },
    {
      name: 'the-chrome-channel-loses-the-sentence-as-well',
      mustRedden: [R8],
      world: (() => {
        const next = clone()
        const carries = (text) => OLD_SENTENCES.some((sentence) => String(text).includes(sentence))
        for (const [name, text] of Object.entries(next.words.chrome.descriptions)) {
          if (carries(text)) next.words.chrome.descriptions[name] = next.words.panel.descriptions[name] ?? '(nothing to say)'
        }
        for (const [name, params] of Object.entries(next.words.chrome.params)) {
          for (const key of Object.keys(params)) {
            if (carries(params[key])) params[key] = next.words.panel.params[name]?.[key] ?? '(nothing to say)'
          }
        }
        return next
      })(),
    },
    {
      name: 'the-chrome-channel-readers-answer-the-tab-set-instead-of-refusing',
      mustRedden: [R8],
      world: (() => {
        const next = clone()
        for (const entry of next.words.chrome.readers) entry.call = { tool: entry.tool, ok: true, error: null, text: 'tabs (1 of 4); "*" marks the active tab t2' }
        return next
      })(),
    },
    {
      name: 'the-panel-channel-answers-an-instances-list',
      mustRedden: [R8],
      world: (() => {
        const next = clone()
        for (const entry of next.words.panel.readers) entry.call.text = 'instances (1); "*" marks the default target\n* b1  1280x800  live=true  about:blank'
        return next
      })(),
    },
    {
      name: 'the-panel-channel-takes-the-chrome-list-sentence',
      mustRedden: [R8],
      world: (() => { const next = clone(); next.words.panel.descriptions.browser_list = 'List every open browser instance with its id, url, title, viewport, and process. Use this to find the id to pass to other tools.'; return next })(),
    },
    {
      name: 'the-default-origin-changes',
      mustRedden: [R9],
      world: (() => { const next = clone(); next.seam.default.origin = 'http://127.0.0.1:31760'; return next })(),
    },
    {
      name: 'the-env-seam-is-not-read',
      mustRedden: [R9],
      world: (() => { const next = clone(); next.seam.env.origin = next.seam.default.origin; return next })(),
    },
    {
      name: 'the-row-config-seam-is-not-read',
      mustRedden: [R9],
      world: (() => { const next = clone(); next.seam.rowConfig.origin = DEFAULT_ORIGIN; return next })(),
    },
    {
      name: 'control-nothing-changed',
      mustRedden: [],
      world: clone(),
    },
  ]
}

const cleanup = (world, keep) => {
  if (keep === true) {
    console.log('        kept: ' + show(world.roots ?? []))
    return
  }
  for (const root of world.roots ?? []) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* the temp world is disposable */
    }
  }
}

const runSelfAttack = async (started) => {
  const collected = await collect()
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) {
    console.log('SKIP: ' + collected.fatal)
    cleanup(collected.world, KEEP)
    return 3
  }
  const world = collected.world
  const base = judge(world)
  const baseRed = base.filter((reading) => reading.ok === false).map((reading) => reading.id)
  const baseNull = base.filter((reading) => reading.ok === null).map((reading) => reading.id)
  console.log('  baseline in this world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' failed, ' + String(baseNull.length) + ' not measured')
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed) + ' (a mutant declared against a reading that is already red proves nothing)')
    for (const reading of base.filter((entry) => entry.ok === false)) console.log('        ' + reading.id + '. ' + reading.detail)
    cleanup(world, KEEP)
    return 1
  }
  if (baseNull.length > 0) {
    console.log('  SKIP: the attack needs every reading measured; not measured here: ' + show(baseNull))
    cleanup(world, KEEP)
    return 3
  }
  console.log('  each mutant below rewrites ONE fact of that measured world and is judged by the same judge:')
  let failures = 0
  const built = mutants(world)
  for (const mutant of built) {
    const observed = judge(mutant.world).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const declared = mutant.mustRedden
    const precise = observed.length === declared.length && declared.every((id) => observed.includes(id))
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' \u2014 \u58f0\u660e\u96c6 == \u89c2\u6d4b\u96c6: declared=' + show(declared) + ' observed=' + show(observed))
  }
  const coverage = new Map()
  for (const mutant of built) for (const id of mutant.mustRedden) coverage.set(id, (coverage.get(id) ?? 0) + 1)
  let uncovered = 0
  console.log('  coverage matrix (every reading must be declared by at least one mutant):')
  for (const reading of base) {
    const count = coverage.get(reading.id) ?? 0
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id)
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log(
    '  ' + String(built.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(built.filter((mutant) => mutant.mustRedden.length > 0).length) +
      ' of them declare a target, ' + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's',
  )
  console.log('  note: the mutants attack the JUDGE over the world measured in this run; the measurement itself is not repeated per mutant.')
  cleanup(world, KEEP)
  return failures === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const started = Date.now()
  try {
    return await run(started)
  } finally {
    await shutdownWorlds()
  }
}

const run = async (started) => {
  if (SELF_ATTACK) return await runSelfAttack(started)
  const collected = await collect()
  for (const line of collected.progress) console.log('        ' + line)
  if (collected.fatal !== null) {
    console.log('SKIP: ' + collected.fatal)
    cleanup(collected.world, KEEP)
    return 3
  }
  const world = collected.world
  console.log('  subject: ' + MODULE_PATH + ' driven through apply() in ' + String(world.subject.names.length) + ' registered tool(s); worlds: this gate own fakes, no live port touched')
  const readings = judge(world)
  for (const reading of readings) {
    const verdict = reading.ok === true ? 'ok  ' : reading.ok === false ? 'FAIL' : 'n/a '
    console.log('  ' + verdict + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  const unmeasured = readings.filter((reading) => reading.ok === null)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(unmeasured.length) + ' not measured | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  cleanup(world, KEEP)
  if (failed.length > 0) return 1
  if (unmeasured.length > 0) {
    console.log('SKIP: ' + String(unmeasured.length) + ' reading(s) could not be measured here: ' + unmeasured.map((reading) => reading.id).join(', '))
    return 3
  }
  return 0
}

process.exitCode = await main()
