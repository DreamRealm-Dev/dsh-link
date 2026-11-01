#!/usr/bin/env node
/**
 * Gate 114 (R184-G2) - browser-tabs-live: THE AI'S TAB HAND, JUDGED IN THE REAL SHELL.
 *
 * Subject: plugins/dsh-browser/lib/** as shipped by R184-P1 (the R184 contract sections 3.1-3.5 and the
 * P1 row of section 4.1). The SHIPPED module is loaded in this process with a ctx that publishes a tools
 * registry the way the kernel composes one, and it is pointed at the REAL shell: the one change is
 * panelOrigin, which R184 turned into the offline seam on purpose (contract appendix 3, ruling 4).
 *
 * WHY THE ORIGIN IS THIS GATE'S OWN TAP, NOT THE SHELL ITSELF
 *   panelOrigin = http://127.0.0.1:<ephemeral>, a byte-forwarding HTTP tap in front of the shell's own
 *   POST /__shell/panel. The tap changes nothing (reading 1 measures that: the same op=state through the
 *   tap and straight at the shell answer the same JSON, and a refusal's status and sentence come through
 *   unchanged), and it is the only way to read WHAT THE TOOLS SENT - which op, which id, which url, which
 *   holder, and whether an op=state read-back followed. Every reading below is written against the shell's
 *   own report and against those request bodies, never against a name a tool calls itself.
 *
 * WHAT THIS GATE DOES NOT DO (the contract's live discipline, R184 section 4.2 / section 5 risk 1):
 *   no pixels, no geometry, no rectangles - it reads op=state, the shell's CDP op for a tab's OWN document,
 *   and its own tap. The open panel is placed at the rect the shell already declared, so the surface it
 *   hands back is the one it found. Nothing in here needs R182-G's pending letterbox ruling.
 *
 * SINGLE RUN. This gate opens the real panel, opens and closes REAL tabs, and takes the panel lease. It is
 * therefore built to be run alone: before touching anything it refuses (exit 3, by name) when another live
 * consumer is running (a verify- or probe- process from scripts/verify-all.mjs's live register) or when
 * somebody else holds the lease. It is not part of any segmented suite run, by contract.
 *
 * TEN READINGS, each able to fail on its own evidence:
 *
 *   1-the-tap-is-transparent-and-the-face-is-the-build-that-is-running
 *                                            The instrument first: the same op=state through the tap and
 *                                            straight at the shell must be the same JSON, and a refusal's
 *                                            HTTP status and sentence must come through the tap unchanged.
 *                                            Then the anchors: the shell's own op=state answers with a tab
 *                                            set, its limit equals MAX_TABS parsed out of
 *                                            src-tauri/src/core/sidebar_panel.rs, the shipped apply()
 *                                            registers the tab face, and the plugin's own startup line names
 *                                            the tap as its panel origin (so the code under test really is
 *                                            pointed here) while DSH_BROWSER_PANEL is not 0.
 *   2-the-tab-set-the-tool-reports-is-the-shells-own-row-for-row
 *                                            Every tab-set reader this build registers answers with the
 *                                            shell's own count, limit, active id and every row's id and url,
 *                                            in the shell's order - compared with an op=state this gate reads
 *                                            itself, never with what the reader says it asked for.
 *   3-the-answers-follow-the-shell-and-are-not-a-copy
 *                                            The gate changes the shell's tab set BEHIND the plugin's back
 *                                            (a tab the shell makes, and a URL the shell moves) and calls the
 *                                            readers again: the second answers must carry the new facts, and
 *                                            must not be byte-identical to the first.
 *   4-writes-go-through-the-shells-own-ops-carrying-the-plugins-own-holder
 *                                            From the tap's own log: every tab write a tool sent is one of
 *                                            the shell's ops, the id and url travel VERBATIM (no renumbering),
 *                                            every write carries the holder the package itself exports, and
 *                                            every accepted write is followed by the shell's own op=state
 *                                            read-back in the same call.
 *   5-opening-a-tab-is-the-shell-opening-it-and-the-shell-names-it
 *                                            browser_tab_new: the id the tool reports must be an id the shell
 *                                            did not have before and does have after, it must be the id the
 *                                            shell itself answered with, and the new tab must be the shell's
 *                                            ACTIVE one. Paired: before the call that id is not in the shell.
 *   6-goto-moves-the-tab-it-was-given-and-leaves-the-users-page-alone
 *                                            The reading the R184 contract was written for (R178-B:56-59):
 *                                            a tab of the tool's own is navigated, and the page the USER was
 *                                            on is read before and after FROM THAT TAB ITSELF - its URL must
 *                                            not move by one character. Paired: with no tab named, the tab that
 *                                            moves is the shell's ACTIVE one (which here is the gate's own),
 *                                            so the fallback rule and the user's safety are both measured.
 *   7-activate-and-close-happen-in-the-shell-including-the-left-neighbour
 *                                            browser_tab_activate moves the shell's active id; browser_tab_close
 *                                            takes one tab out and the count with it; and closing the ACTIVE tab
 *                                            puts the shell's LEFT neighbour in front - in a world built so the
 *                                            left neighbour is NOT the first tab. Every answer is the shell's
 *                                            read-back.
 *   8-the-cap-refusal-is-the-shells-own-sentence-byte-for-byte
 *                                            Driven to the shell's own limit and one past it: the tool's refusal
 *                                            must equal, byte for byte, the sentence the SHELL says when this
 *                                            gate asks it directly, and must match the shell's own format string
 *                                            (read out of sidebar_panel.rs with MAX_TABS from the same file).
 *                                            The tab set does not move across either refusal. Paired: at
 *                                            limit-1 the same call succeeds.
 *   9-without-the-lease-nothing-writes-and-with-it-back-the-same-call-is-accepted
 *                                            While THIS GATE holds the lease, the same browser_tab_new is refused
 *                                            by name with the shell's own sentence (recomputed from the shell's
 *                                            template, naming this gate and the package's own holder), the tab set
 *                                            is untouched, a direct call under a FOREIGN holder gets the same
 *                                            sentence from the shell itself, and no tool call in the probe sweep
 *                                            managed a write either. Paired: the lease is released and the SAME
 *                                            call is accepted.
 *  10-the-world-is-handed-back-as-it-was-found
 *                                            finally: the gate's own tabs are closed, the entry active tab is put
 *                                            back in front, the panel is returned to the state it was found in, the
 *                                            lease is given back, and the returned fingerprint (tabs row-for-row,
 *                                            active, count, limit, viewport, mode, exists/mounted) is compared
 *                                            with the entry one. Anything that could not be restored is NAMED in
 *                                            the reading instead of being passed over.
 *
 * Self-attack: --self-attack drives the live world ONCE, then mutates THAT transcript in memory, one
 * mutation per mutant, asserting each mutant reddens exactly its declared readings and nothing else, plus
 * a control mutant that changes nothing. It prints the Chinese sentence declaration == observation for
 * every mutant and then the COVERAGE MATRIX. The baseline must be fully green AND fully measured before
 * the attack starts.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 this gate could not measure here: no shell on the
 * port, another live consumer (or a lease) already owns the panel, the panel will not open, the module
 * does not import or registers no tab face, or the shell's own source cannot be read. A reading that
 * cannot be measured is a named third state, never green.
 *
 * Usage: node scripts/verify-browser-tabs-live.mjs [--port 31761] [--module <path>] [--self-attack] [--keep]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
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
const PORT = Number(option('--port', '31761'))
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-browser', 'lib', 'index.js')))
const SHELL_SOURCE = resolve(option('--shell-source', join(PROJECT, 'src-tauri', 'src', 'core', 'sidebar_panel.rs')))
const LEASE_HELPER = join(PROJECT, 'scripts', 'panel-lease.mjs')

/** The name this gate writes under while it holds the panel. It is the gate's own, never the package's. */
const GATE_HOLDER = 'browser-tabs-live'
/** A holder name that belongs to nobody: used to make the SHELL say its own refusal out loud. */
const FOREIGN_HOLDER = 'gate-114-foreign-holder'
/** The three URLs this gate drives: all local, all served by the shell, three different location.href. */
const URL_A = SHELL_ORIGIN + '/__shell/panel-start?g2=own-a'
const URL_B = SHELL_ORIGIN + '/__shell/panel-start?g2=own-b'
const URL_C = SHELL_ORIGIN + '/__shell/panel-start?g2=own-c'
const URL_TMP = SHELL_ORIGIN + '/__shell/panel-start?g2=shell-tmp'
const URL_TMP_MOVED = SHELL_ORIGIN + '/__shell/panel-start?g2=shell-tmp-moved'

/** Every op that WRITES to the panel: a call that sent one of these tried to change the world. */
const WRITE_OPS = Object.freeze(['open', 'mount', 'unmount', 'close', 'surface', 'set-bounds', 'tab-new', 'tab-close', 'tab-activate', 'tab-goto', 'viewport', 'mode'])
/** The parameters a tool may declare and still be probed in the live world without touching a page. */
const PROBE_SAFE_PARAMS = new Set(['id', 'tab', 'url', 'kill'])
/** A surface smaller than the shell's own MIN holds no browser (panel_host.js:31). */
const MIN_SURFACE = 48
/** The rect this gate places the panel at when the shell has no usable declared surface of its own. */
const FALLBACK_RECT = Object.freeze({ x: 600, y: 90, w: 420, h: 600 })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
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
const pad = (text, width) => (String(text).length >= width ? String(text) : String(text) + ' '.repeat(width - String(text).length))

/** One JSON POST. The gate's own hand, used for the shell directly and for the tap. */
const post = async (origin, path, payload, timeoutMs = 20000) => {
  try {
    const answer = await fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await answer.text().catch(() => '')
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { status: answer.status, body, text }
  } catch (error) {
    return { status: 0, body: null, text: '', error: describe(error) }
  }
}

/** The shell's own panel report. op=state answers flat (the report IS the body). */
const stateOf = (body) => (body !== null && typeof body === 'object' && body.state !== undefined ? body.state : body)
const readState = async () => {
  const answer = await post(SHELL_ORIGIN, '/__shell/panel', { op: 'state' })
  return { status: answer.status, body: answer.body, state: stateOf(answer.body), error: answer.error }
}

/** A tab row as the shell reports it: the five fields every comparison below is written on. */
const rowsOf = (state) => {
  const rows = state !== null && typeof state === 'object' && Array.isArray(state.tabs) ? state.tabs : []
  return rows.map((row) => ({
    id: typeof row?.id === 'string' ? row.id : null,
    url: typeof row?.url === 'string' ? row.url : null,
    live: row?.live === true,
    active: row?.active === true,
  }))
}
const fingerprintOf = (state) => ({
  exists: state?.exists === true,
  mounted: state?.mounted === true,
  count: Number.isFinite(state?.count) ? state.count : null,
  limit: Number.isFinite(state?.limit) ? state.limit : null,
  active: typeof state?.active === 'string' ? state.active : null,
  tabs: rowsOf(state),
  viewport: state?.viewport === undefined ? null : { w: state.viewport?.w ?? null, h: state.viewport?.h ?? null },
  mode: typeof state?.mode === 'string' ? state.mode : null,
  lease: state?.lease === undefined ? null : { held: state.lease?.held === true, holder: state.lease?.holder ?? null },
})
const printFingerprint = (label, fingerprint) => {
  console.log('  ' + label)
  console.log('    exists=' + String(fingerprint.exists) + ' mounted=' + String(fingerprint.mounted) + ' count=' + String(fingerprint.count) + ' limit=' + String(fingerprint.limit) + ' active=' + String(fingerprint.active))
  console.log('    viewport=' + show(fingerprint.viewport) + ' mode=' + String(fingerprint.mode) + ' lease=' + show(fingerprint.lease))
  if (fingerprint.tabs.length === 0) console.log('    tabs: (none)')
  for (const row of fingerprint.tabs) console.log('    tab ' + pad(row.id, 5) + (row.active ? '* ' : '  ') + 'live=' + String(row.live) + '  ' + String(row.url))
}

/**
 * The shell's own sentences and constants, read out of src-tauri/src/core/sidebar_panel.rs.
 *
 * The gate never trusts its own transcription of a refusal: it REBUILDS the sentence from the shell's
 * own format string with the values it measured, and requires the shell - and then the tool - to say
 * exactly that. A drift between this rebuild and the shell reddens; a paraphrase by the tool reddens.
 */
const readShellSource = () => {
  if (existsSync(SHELL_SOURCE) === false) return { ok: false, why: 'the shell source is not at ' + SHELL_SOURCE }
  const text = readFileSync(SHELL_SOURCE, 'utf8')
  const maxTabs = text.match(/pub const MAX_TABS: usize = (\d+);/)
  if (maxTabs === null) return { ok: false, why: 'sidebar_panel.rs no longer declares MAX_TABS' }
  const cap = text.match(/"(named refusal: op=tab-new is not opening tab t\{\} because the limit is \{MAX_TABS\} tabs and \{\} are live \(\{\}\); close one first)"/)
  if (cap === null) return { ok: false, why: 'sidebar_panel.rs no longer holds the tab cap format string' }
  const leased = text.match(/"the panel is leased by \{other\} and not by \{\}: the placement was refused"/)
  if (leased === null) return { ok: false, why: 'sidebar_panel.rs no longer holds the lease refusal format string' }
  return {
    ok: true,
    maxTabs: Number(maxTabs[1]),
    cap: (nextId, liveCount, ids) =>
      'named refusal: op=tab-new is not opening tab t' + String(nextId) + ' because the limit is ' + String(Number(maxTabs[1])) + ' tabs and ' + String(liveCount) + ' are live (' + ids.join(', ') + '); close one first',
    leased: (other, holder) => 'the panel is leased by ' + String(other) + ' and not by ' + (holder === undefined || holder === null || holder === '' ? 'nobody' : String(holder)) + ': the placement was refused',
    lines: {
      maxTabs: (text.slice(0, maxTabs.index).match(/\n/g) ?? []).length + 1,
      cap: (text.slice(0, cap.index).match(/\n/g) ?? []).length + 1,
      leased: (text.slice(0, leased.index).match(/\n/g) ?? []).length + 1,
    },
  }
}

/**
 * The gate's own CDP read: one call through the shell's legacy /__shell/panel/cdp route, addressed at a
 * tab by id. Metadata only (location.href / document.title / readyState) - never page content, never a
 * rectangle: this is a document read, not a measurement of the page.
 */
const readTabDocument = async (tab) => {
  const answer = await post(SHELL_ORIGIN, '/__shell/panel/cdp', {
    method: 'Runtime.evaluate',
    params: { expression: 'JSON.stringify({href:location.href,title:document.title,ready:document.readyState})', returnByValue: true },
    timeoutMs: 15000,
    ...(tab === undefined ? {} : { tab }),
  })
  if (answer.status !== 200 || answer.body === null || answer.body.ok !== true) {
    return { ok: false, why: 'the shell refused the CDP read (HTTP ' + String(answer.status) + ' ' + clip(show(answer.body), 120) + ')' }
  }
  let outer = answer.body.result
  if (typeof outer === 'string') {
    try {
      outer = JSON.parse(outer)
    } catch {
      return { ok: false, why: 'the shell CDP envelope was not JSON' }
    }
  }
  const inner = outer !== null && typeof outer === 'object' && outer.result !== undefined ? outer.result : outer
  const value = inner !== null && typeof inner === 'object' ? inner.value : undefined
  if (typeof value !== 'string') return { ok: false, why: 'the tab did not answer Runtime.evaluate with a value' }
  try {
    return { ok: true, document: JSON.parse(value) }
  } catch {
    return { ok: false, why: 'the tab answered Runtime.evaluate with non-JSON' }
  }
}
/** The href a tab is really on, read inside that tab. */
const tabHref = async (tab) => {
  const seen = await readTabDocument(tab)
  if (seen.ok !== true) return { ok: false, why: seen.why }
  const href = typeof seen.document?.href === 'string' ? seen.document.href : null
  return href === null ? { ok: false, why: 'the tab did not report a location.href' } : { ok: true, href, ready: seen.document.ready }
}

/** Wait for a tab's own renderer to be on an href (a navigation is asynchronous by nature). */
const waitForHref = async (tab, href, timeoutMs) => {
  const until = Date.now() + timeoutMs
  let last = await tabHref(tab)
  while (Date.now() < until && last.ok === true && last.href !== href) {
    await sleep(250)
    last = await tabHref(tab)
  }
  return last
}

/**
 * The tap: every byte of this gate's panel traffic goes through it, and it records the request bodies.
 * It forwards to the shell with the caller's own content-type and referer (the plugin sends no referer,
 * and that is exactly what makes the shell read it as an outside caller rather than as the user's page).
 */
const startTap = async (upstream) => {
  const url = new URL(upstream)
  const log = []
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks)
      let body = null
      try {
        body = JSON.parse(raw.toString('utf8'))
      } catch {
        body = null
      }
      const entry = { path: request.url, method: request.method, body, raw: clip(raw.toString('utf8'), 4000), status: null, answer: null, error: null, at: Date.now() }
      log.push(entry)
      const headers = { 'content-type': String(request.headers['content-type'] ?? 'application/json'), 'content-length': String(raw.length) }
      if (typeof request.headers.referer === 'string') headers.referer = request.headers.referer
      const forward = http.request(
        { hostname: url.hostname, port: Number(url.port === '' ? 80 : url.port), path: request.url, method: request.method, headers, agent: false },
        (up) => {
          const parts = []
          up.on('data', (chunk) => parts.push(chunk))
          up.on('end', () => {
            const text = Buffer.concat(parts).toString('utf8')
            entry.status = up.statusCode ?? 0
            try {
              entry.answer = JSON.parse(text)
            } catch {
              entry.answer = null
            }
            try {
              response.writeHead(entry.status, { 'content-type': String(up.headers['content-type'] ?? 'application/json'), 'content-length': String(Buffer.byteLength(text)) })
              response.end(text)
            } catch {
              /* the caller went away mid-answer: the log above is still the reading */
            }
          })
        },
      )
      forward.setTimeout(60000, () => forward.destroy(new Error('the tap gave up waiting for the shell')))
      forward.on('error', (error) => {
        entry.error = describe(error)
        try {
          response.writeHead(502, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'the tap could not reach the shell: ' + describe(error) }))
        } catch {
          /* ignore */
        }
      })
      forward.end(raw)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  return {
    origin: 'http://127.0.0.1:' + String(server.address().port),
    log,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  }
}

/** Every panel-shaped request the tap saw since a mark, as the judge reads them. */
const opsSince = (tap, from) =>
  tap.log.slice(from).map((entry) => ({
    path: entry.path,
    op: typeof entry.body?.op === 'string' ? entry.body.op : null,
    id: typeof entry.body?.id === 'string' ? entry.body.id : null,
    url: typeof entry.body?.url === 'string' ? entry.body.url : null,
    holder: typeof entry.body?.holder === 'string' ? entry.body.holder : null,
    holderPresent: entry.body !== null && typeof entry.body === 'object' && Object.prototype.hasOwnProperty.call(entry.body, 'holder'),
    tab: entry.body !== null && typeof entry.body === 'object' && Object.prototype.hasOwnProperty.call(entry.body, 'tab') ? entry.body.tab : null,
    tabPresent: entry.body !== null && typeof entry.body === 'object' && Object.prototype.hasOwnProperty.call(entry.body, 'tab'),
    method: typeof entry.body?.method === 'string' ? entry.body.method : null,
    path2: entry.path === '/__shell/panel/cdp',
    write: WRITE_OPS.includes(typeof entry.body?.op === 'string' ? entry.body.op : ''),
    status: entry.status,
    error: typeof entry.answer?.error === 'string' ? entry.answer.error : null,
    tapError: entry.error,
  }))
const writesIn = (ops) => ops.filter((entry) => entry.path === '/__shell/panel' && entry.write === true)
const stateReadsIn = (ops) => ops.filter((entry) => entry.path === '/__shell/panel' && entry.op === 'state')

/** The tab-set answer, parsed out of the frozen shape the tools print (tabsText in lib/tools.js). */
const parseTabsText = (text) => {
  const raw = String(text ?? '')
  const head = raw.match(/^tabs \((\d+) of (\d+|\?)\); "\*" marks the active tab (\S+)/m)
  if (head === null) return { ok: false, why: 'the answer does not open with the tab-set header: ' + clip(raw, 160), rows: [], other: [] }
  const rows = []
  const other = []
  for (const line of raw.split('\n')) {
    if (line === '' || head[0].startsWith(line)) continue
    const row = line.match(/^([* ]) (\S+)\s+live=(true|false)\s+(\S+)(?:\s+"(.*)")?$/)
    if (row !== null) {
      rows.push({ active: row[1] === '*', id: row[2], live: row[3] === 'true', url: row[4], title: row[5] ?? null })
      continue
    }
    other.push(line)
  }
  return {
    ok: true,
    count: Number(head[1]),
    limit: head[2] === '?' ? null : Number(head[2]),
    active: head[3] === '(none)' ? null : head[3],
    rows,
    other,
  }
}

/** One tool call, with everything the judge needs to say what the WORLD did in reply. */
const callTool = async (subject, tap, tool, args) => {
  const record = { tool, args: args === undefined ? {} : args, ok: false, text: null, error: null, errorName: null, ops: [], logs: [] }
  const definition = subject.registry.get(tool)
  if (definition === undefined) {
    record.error = 'no tool named ' + tool + ' is registered in this build'
    return record
  }
  const from = tap.log.length
  const captured = await captureConsole(async () => {
    try {
      return { ok: true, value: await definition.execute(record.args, {}) }
    } catch (error) {
      return { ok: false, error: describe(error), errorName: error !== null && error !== undefined && error.name !== undefined ? String(error.name) : null }
    }
  })
  const outcome = captured.value
  record.ops = opsSince(tap, from)
  record.console = captured.lines.map((line) => clip(line, 200))
  if (outcome.ok === true) {
    record.ok = true
    record.text = typeof outcome.value?.text === 'string' ? outcome.value.text : show(outcome.value)
  } else {
    record.error = outcome.error
    record.errorName = outcome.errorName
  }
  return record
}

/** Run something with the console captured (the plugin logs through it), so its words are readings too. */
const captureConsole = async (fn) => {
  const saved = { log: console.log, warn: console.warn, error: console.error }
  const lines = []
  const record = (...args) => lines.push(args.map((value) => (value instanceof Error ? (value.stack ?? value.message) : String(value))).join(' '))
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
 * Load the shipped module in a fresh URL and apply it with a ctx that publishes a tools registry the way
 * the kernel composes one. The ONLY thing pointed anywhere unusual is panelOrigin (row config), which is
 * the seam R184 added on purpose: everything else - the ctx shape, the tool definitions, the transport -
 * is the shipped code path, and the origin it ends up with is the tap that forwards to the real shell.
 */
const buildSubject = async ({ origin, baseDir, modulePath }) => {
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
      // The real host composes an attachments service; without one a screenshot tool refuses before it
      // ever reaches the page. This one is a counter, not a picture: no reading below uses pixels.
      if (name === 'attachments') {
        return {
          async saveImage(input) {
            return { attachmentId: 'gate114-attachment', mediaType: input?.mediaType ?? 'image/png', bytes: input?.data?.length ?? 0, width: 1, height: 1 }
          },
        }
      }
      if (name === 'dshHomePath') return (sub) => join(baseDir, 'home', sub)
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
  const built = { registry, disposers, logs: [], imported: false, applied: false, error: null, module: null, names: [] }
  const captured = await captureConsole(async () => {
    try {
      built.module = await import(pathToFileURL(modulePath).href)
      built.imported = true
      built.module.apply(ctx, { baseDir, panelOrigin: origin })
      built.applied = true
    } catch (error) {
      built.error = describe(error)
    }
  })
  built.logs = captured.lines.map((line) => clip(line, 300))
  built.names = [...registry.keys()].sort()
  built.startupLine = built.logs.find((line) => line.includes('browser tools drive the shell panel at')) ?? null
  built.readyLine = built.logs.find((line) => line.includes('browser tools registered:')) ?? null
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

/**
 * Which tool plays which role. Nothing here decides a reading on the strength of a NAME: every role is
 * confirmed by what the tool SENT and by what the shell then reported (readings 4-8), and the name is
 * reported as the basis it was found on. When a frozen name is missing, the gate looks for the behaviour
 * instead - in the lease-held probe, where the shell itself refuses any write, so looking cannot change
 * the world - and says so. A role found by neither route is NOT MEASURED by name, never guessed.
 */
const FROZEN_NAMES = Object.freeze({ reader: ['browser_tabs', 'browser_list'], create: 'browser_tab_new', close: 'browser_tab_close', activate: 'browser_tab_activate', goto: 'browser_goto' })

const isProbeSafe = (definition) => {
  const properties = definition?.parameters?.properties
  if (properties === null || typeof properties !== 'object') return false
  const names = Object.keys(properties)
  if (names.length === 0) return true
  return names.every((name) => PROBE_SAFE_PARAMS.has(name))
}
const probeShapes = (definition, activeTab, safeUrl) => {
  const properties = definition?.parameters?.properties ?? {}
  const out = [{ id: 'empty', args: {} }]
  if (properties.tab !== undefined && activeTab !== null) out.push({ id: 'active-tab', args: { tab: activeTab } })
  if (properties.url !== undefined && safeUrl !== null) out.push({ id: 'safe-url', args: { url: safeUrl, ...(properties.tab === undefined || activeTab === null ? {} : { tab: activeTab }) } })
  return out
}

/**
 * The client's identity, so a world that is RESTARTED under this gate can be named instead of being blamed on
 * the product. One process query per call; the shell's own boot line is the same thing read from the other end
 * (R184-A section 9.3 makes that line the evidence that the running kernel loaded this build).
 */
const clientIdentity = () => {
  const query = "[string](Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id.ToString() + '@' + $_.StartTime.ToUniversalTime().ToString('o') })"
  const done = spawnSync('pwsh', ['-NoProfile', '-Command', query], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  if (done.status !== 0) return null
  const text = String(done.stdout ?? '').trim()
  return text === '' ? null : text
}

/** Another live consumer, by process: the files the register's live gates run, and who is running them. */
const liveGateFiles = () => {
  const path = join(PROJECT, 'scripts', 'verify-all.mjs')
  if (existsSync(path) === false) return { files: [], why: 'scripts/verify-all.mjs is not there' }
  const text = readFileSync(path, 'utf8')
  const files = new Set()
  const rows = text.matchAll(/\{\s*name:\s*'([^']+)',\s*kind:\s*'(offline|live|kernel)',\s*cmd:\s*\[([^\]]*)\]/g)
  let count = 0
  for (const row of rows) {
    count += 1
    if (row[2] !== 'live') continue
    for (const word of row[3].split(',')) {
      const clean = word.trim().replace(/^'|'$/g, '')
      if (/\.mjs$/.test(clean)) files.add(clean.split('/').pop())
    }
  }
  return { files: [...files], why: count === 0 ? 'the register could not be parsed, so every verify-*/probe-* process counts as a live consumer' : null, parsed: count }
}
const runningConsumers = (live) => {
  const query = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ForEach-Object { [string]$_.ProcessId + "|" + [string]$_.ParentProcessId + "|" + [string]$_.CommandLine }'
  const done = spawnSync('pwsh', ['-NoProfile', '-Command', query], { encoding: 'utf8', timeout: 40000, windowsHide: true })
  if (done.status !== 0) return { ok: false, why: 'the process list could not be read: ' + clip(String(done.stderr ?? ''), 160), others: [] }
  const rows = String(done.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
    .map((line) => {
      const at = line.indexOf('|')
      const at2 = line.indexOf('|', at + 1)
      return { pid: line.slice(0, at), ppid: line.slice(at + 1, at2), command: line.slice(at2 + 1) }
    })
  const mine = new Set([String(process.pid), String(process.ppid)])
  // Walk up: everything that is this gate's own ancestor is this gate.
  for (let step = 0; step < 8; step += 1) {
    for (const row of rows) if (mine.has(row.pid) && row.ppid !== '0' && row.ppid !== '') mine.add(row.ppid)
  }
  const selfName = HERE.split(/[\\/]/).pop() === 'r184-g2' ? 'verify-browser-tabs-live.mjs' : null
  const others = rows.filter((row) => {
    if (mine.has(row.pid)) return false
    const command = row.command
    if (selfName !== null && command.includes(selfName)) return false
    if (live.files.length > 0) return live.files.some((file) => command.includes(file))
    return /(verify|probe)-[a-z0-9-]+\.mjs/.test(command)
  })
  return { ok: true, others: others.map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 120)) }
}

// ---------------------------------------------------------------------------
// The world: drive the real shell with the shipped tools, and record what happened
// ---------------------------------------------------------------------------

class NotMeasured extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'NotMeasured'
  }
}

/**
 * The whole live drive. Everything it observes lands in one transcript, and the judge below is a pure
 * function of that transcript - which is what makes --self-attack possible without driving the shell
 * twice: the mutants are applied to the measured world, not to a hand-written fixture.
 */
const runWorld = async () => {
  const transcript = {
    startedAt: new Date().toISOString(),
    port: PORT,
    shellOrigin: SHELL_ORIGIN,
    modulePath: MODULE_PATH,
    holder: GATE_HOLDER,
    urls: { A: URL_A, B: URL_B, C: URL_C, tmp: URL_TMP, tmpMoved: URL_TMP_MOVED },
    entry: null,
    exit: null,
    openedByGate: false,
    entrySurface: null,
    shellSource: null,
    subject: null,
    tap: { origin: null, transparency: null, refusalsPassedThrough: null },
    guard: null,
    roles: null,
    probes: [],
    readers: { tools: [], calls: [] },
    shellChange: null,
    lease: { held: false, refusedWrite: null, foreignWrite: null, stateBefore: null, stateAfter: null, sweepWrites: [], acceptedAfterRelease: null, released: false },
    create: null,
    goto: null,
    gotoDefault: null,
    activate: null,
    close: null,
    cap: null,
    restore: null,
    notes: [],
    problems: [],
  }
  const lease = await import(pathToFileURL(LEASE_HELPER).href).catch((error) => ({ __error: describe(error) }))
  if (lease.__error !== undefined) throw new NotMeasured('the shared lease helper could not be loaded (' + lease.__error + '), so this gate cannot take the panel the way every live gate here does')
  const { claimLease, releaseLease, panelPost, openOwnPanel } = lease

  // --- 0. the shell has to be there before anything else is claimed -------------------------------
  const hello = await readState()
  if (hello.status !== 200 || hello.state === null) {
    throw new NotMeasured('no shell is answering op=state on ' + SHELL_ORIGIN + (hello.error === undefined ? '' : ' (' + hello.error + ')'))
  }
  transcript.entry = fingerprintOf(hello.state)
  transcript.entryStateRaw = hello.state
  transcript.entrySurface = hello.state?.surface === null || hello.state?.surface === undefined ? null : { x: hello.state.surface.x, y: hello.state.surface.y, w: hello.state.surface.w, h: hello.state.surface.h }

  // --- 1. the single-run guard: somebody else's lease, or another live consumer -------------------
  transcript.clientAtEntry = clientIdentity()
  const entryLease = hello.state?.lease ?? null
  if (entryLease !== null && entryLease.held === true) {
    throw new NotMeasured('the panel lease is ALREADY held by ' + String(entryLease.holder) + ', so another live consumer owns this panel; this gate does not take it from anybody')
  }
  if ((hello.state?.userInputReports ?? 0) > 0 && entryLease?.revokedBy != null) {
    transcript.notes.push('note: the shell remembers a takeover (' + show(entryLease.revokedBy) + '), so a fresh claim is the way back in - this gate claims one and the release at the end returns the panel')
  }
  const live = liveGateFiles()
  const consumers = runningConsumers(live)
  transcript.guard = { liveFiles: live.files, registerParsed: live.parsed ?? 0, parseNote: live.why, read: consumers.ok === true, others: consumers.others ?? [], why: consumers.why ?? null }
  if (consumers.ok !== true) throw new NotMeasured('the single-run guard could not read the process list (' + String(consumers.why) + '), so this gate cannot promise it is alone')
  if (consumers.others.length > 0) {
    throw new NotMeasured('another live consumer is running, and this gate must run alone: ' + consumers.others.join(' | '))
  }

  // --- 2. the instrument, then the subject --------------------------------------------------------
  // Declining to measure must not leave anything running: the tap is an open socket, so everything that
  // starts one lives inside this block, and a named refusal below closes it before it is rethrown.
  let tap = null
  let subject = null
  let panelHolder = null
  let baseDir = null
  try {
    tap = await startTap(SHELL_ORIGIN)
    transcript.tap.origin = tap.origin
    baseDir = mkdtempSync(join(tmpdir(), 'r184-g2-'))
    mkdirSync(baseDir, { recursive: true })
    subject = await buildSubject({ origin: tap.origin, baseDir, modulePath: MODULE_PATH })
  } catch (error) {
    if (tap !== null) await tap.close().catch(() => undefined)
    if (subject !== null) closeSubject(subject)
    throw error
  }
  const disposeInstrument = async () => {
    await tap.close().catch(() => undefined)
    closeSubject(subject)
  }
  transcript.subject = {
    imported: subject.imported,
    applied: subject.applied,
    error: subject.error,
    names: subject.names,
    startupLine: subject.startupLine,
    readyLine: subject.readyLine,
    panelEnv: process.env.DSH_BROWSER_PANEL === undefined ? null : String(process.env.DSH_BROWSER_PANEL),
    panelOriginEnv: process.env.DSH_BROWSER_PANEL_ORIGIN === undefined ? null : String(process.env.DSH_BROWSER_PANEL_ORIGIN),
  }
  if (subject.imported !== true || subject.applied !== true) {
    await disposeInstrument()
    throw new NotMeasured('the shipped module would not load and apply in this process: ' + String(subject.error))
  }
  panelHolder = await import(pathToFileURL(join(PROJECT, 'plugins', 'dsh-browser', 'lib', 'panel.js')).href)
    .then((module) => (typeof module.PANEL_HOLDER === 'string' ? module.PANEL_HOLDER : null))
    .catch(() => null)
  transcript.panelHolder = panelHolder

  // Transparency of the tap, measured before any tool runs: the same op=state, two routes.
  const throughTap = await post(tap.origin, '/__shell/panel', { op: 'state' })
  const straight = await readState()
  transcript.tap.transparency = {
    tapStatus: throughTap.status,
    shellStatus: straight.status,
    sameBody: same(throughTap.body, straight.body),
    tapKeys: throughTap.body === null ? null : Object.keys(throughTap.body).length,
  }
  // A refusal has to survive the tap too, or every "the shell said no" below would be the tap's own words.
  // The probe op is one the shell does not know, so this can change nothing in the world.
  const tapUnknown = await post(tap.origin, '/__shell/panel', { op: 'gate-114-no-such-op' })
  const directUnknown = await post(SHELL_ORIGIN, '/__shell/panel', { op: 'gate-114-no-such-op' })
  transcript.tap.refusalPassThrough = {
    tapStatus: tapUnknown.status,
    shellStatus: directUnknown.status,
    sameError: same(tapUnknown.body?.error, directUnknown.body?.error),
    error: typeof tapUnknown.body?.error === 'string' ? tapUnknown.body.error : null,
  }

  // --- the lease, and the panel the gate places itself --------------------------------------------
  let leaseHeld = false
  let openedPanel = false
  // Every named refusal from here on has to hand the instrument back too, so the gate can never hang on
  // its own tap when it decides the world is not measurable.
  const decline = async (reason) => {
    await disposeInstrument()
    throw new NotMeasured(reason)
  }
  const openedEntry = transcript.entry.exists === true
  const rect = transcript.entrySurface !== null && Number(transcript.entrySurface.w) >= MIN_SURFACE && Number(transcript.entrySurface.h) >= MIN_SURFACE
    ? { x: transcript.entrySurface.x, y: transcript.entrySurface.y, w: transcript.entrySurface.w, h: transcript.entrySurface.h }
    : FALLBACK_RECT
  transcript.rect = rect
  try {
    leaseHeld = await claimLease(PORT, GATE_HOLDER, 300000)
    if (leaseHeld !== true) await decline('the panel lease was refused, so this gate cannot own the panel it is about to open')
    const opened = await openOwnPanel(PORT, rect)
    if (opened === null || opened.exists !== true) await decline('the shell would not open the panel, so there is no real shell panel to drive')
    openedPanel = true
    transcript.openedByGate = openedEntry === false
    await sleep(900)
    const openedState = await readState()
    if (openedState.state === null) await decline('the shell stopped answering op=state after the panel opened')
    transcript.afterOpen = fingerprintOf(openedState.state)
    transcript.afterOpenStateRaw = openedState.state

    // The user's page: the tab that was already in the shell's set when this gate arrived. Everything the
    // gate does to "the user's page" is read as a pair (before/after), from that tab ITSELF.
    const afterOpenRows = transcript.afterOpen.tabs
    const userRow = afterOpenRows.find((row) => row.id === transcript.entry.active) ?? afterOpenRows[0] ?? null
    if (userRow === null) await decline('the shell reports no tab at all after the panel opened, so there is no user page to protect')
    transcript.userTab = userRow.id
    transcript.userTabFromEntry = afterOpenRows.some((row) => row.id === transcript.entry.active) && userRow.id === transcript.entry.active

    // --- roles: frozen names first, behaviour second ---------------------------------------------
    const byName = {}
    for (const reader of FROZEN_NAMES.reader) if (subject.registry.has(reader)) byName[reader] = true
    transcript.roles = {
      basis: 'frozen-name',
      reader: FROZEN_NAMES.reader.filter((name) => subject.registry.has(name)),
      create: subject.registry.has(FROZEN_NAMES.create) ? FROZEN_NAMES.create : null,
      close: subject.registry.has(FROZEN_NAMES.close) ? FROZEN_NAMES.close : null,
      activate: subject.registry.has(FROZEN_NAMES.activate) ? FROZEN_NAMES.activate : null,
      goto: subject.registry.has(FROZEN_NAMES.goto) ? FROZEN_NAMES.goto : null,
      declaredTabTools: [...subject.registry.keys()].filter((name) => {
        const properties = subject.registry.get(name)?.parameters?.properties
        return properties !== null && typeof properties === 'object' && properties.tab !== undefined
      }),
    }
    const missing = transcript.roles.reader.length === 0 || ['create', 'close', 'activate', 'goto'].some((role) => transcript.roles[role] === null)
    if (missing === true) {
      // A build that renamed the face is still judged, not skipped: the lease is held, so the shell
      // refuses every write a probe could attempt - looking cannot change this world.
      transcript.roles.basis = 'behaviour (the frozen names are incomplete)'
      const activeRow = afterOpenRows.find((row) => row.active === true) ?? afterOpenRows[0]
      const safeUrl = activeRow?.url ?? null
      const opsByTool = {}
      for (const name of subject.names) {
        const definition = subject.registry.get(name)
        if (isProbeSafe(definition) !== true) continue
        for (const shape of probeShapes(definition, activeRow?.id ?? null, safeUrl)) {
          const record = await callTool(subject, tap, name, shape.args)
          const ops = record.ops.map((entry) => entry.op).filter((op) => op !== null)
          opsByTool[name] = [...new Set([...(opsByTool[name] ?? []), ...ops])]
          transcript.probes.push({ tool: name, shape: shape.id, ok: record.ok, error: clip(record.error ?? '', 120), ops, writes: writesIn(record.ops).map((entry) => entry.op), status: record.ops.filter((entry) => entry.write === true).map((entry) => entry.status) })
        }
      }
      const one = (predicate) => {
        const found = subject.names.filter(predicate)
        return found.length === 1 ? found[0] : null
      }
      const byOp = (op) => one((name) => (opsByTool[name] ?? []).includes(op))
      transcript.roles.behaviour = { opsByTool, create: byOp('tab-new'), close: byOp('tab-close'), activate: byOp('tab-activate'), goto: byOp('tab-goto') }
      if (transcript.roles.create === null) transcript.roles.create = transcript.roles.behaviour.create
      if (transcript.roles.close === null) transcript.roles.close = transcript.roles.behaviour.close
      if (transcript.roles.activate === null) transcript.roles.activate = transcript.roles.behaviour.activate
      if (transcript.roles.goto === null) transcript.roles.goto = transcript.roles.behaviour.goto
      if (transcript.roles.reader.length === 0) {
        transcript.roles.reader = subject.names.filter((name) => {
          const shapes = transcript.probes.filter((probe) => probe.tool === name)
          const readOnly = shapes.length > 0 && shapes.every((probe) => probe.ops.length > 0 && probe.ops.every((op) => op === 'state') && probe.ok === true)
          return readOnly
        })
      }
    }
    if (transcript.roles.create === null) await decline('no tool in this build opens a tab (no frozen name, and no tool sent op=tab-new in the lease-held probe)')

    /**
     * Something else taking this world away mid-run is the third state, never a red.
     *
     * Measured the hard way: another consumer on this machine closed the panel and the lease this gate had
     * claimed while the gate was between phases, and the rest of the run measured a world without a mounted
     * browser - which reads exactly like a product that has stopped working. Asking the shell whether the
     * panel and the lease are still the ones THIS gate made is one op=state per phase, and it is the
     * difference between blaming the product and naming the collision.
     */
    const checkWorld = async (step) => {
      const now = await readState()
      const leaseNow = now.state?.lease ?? null
      if (leaseHeld === true && (leaseNow === null || leaseNow.held !== true || leaseNow.holder !== GATE_HOLDER)) {
        await decline('the panel lease this gate claimed was not held any more at ' + step + ' (the shell now says ' + show(leaseNow) + '): something else took this world while the gate was running, so what follows cannot be attributed to the product')
      }
      if (openedPanel === true && now.state?.exists !== true) {
        await decline('the panel this gate opened was gone at ' + step + ' (op=state says exists=' + show(now.state?.exists) + '): something else closed it while the gate was running, and every reading about tabs needs a mounted browser')
      }
      return now
    }

    // --- the reader, the shell, and the change the plugin cannot have cached ----------------------
    const readerNames = transcript.roles.reader
    if (readerNames.length === 0) await decline('no tab-set reader was found in this build')
    const readerCall = async (tool, phase) => {
      const before = await readState()
      const record = await callTool(subject, tap, tool, {})
      const after = await readState()
      const parsed = record.ok === true ? parseTabsText(record.text) : { ok: false, why: clip(record.error ?? '', 160), rows: [], other: [] }
      const call = {
        tool,
        phase,
        ok: record.ok,
        text: record.text,
        error: record.error,
        parsed,
        shellBefore: fingerprintOf(before.state),
        shellAfter: fingerprintOf(after.state),
        ops: record.ops.map((entry) => ({ op: entry.op, path: entry.path, method: entry.method, tab: entry.tab })),
      }
      transcript.readers.calls.push(call)
      return call
    }
    for (const tool of readerNames) await readerCall(tool, 'first')
    await checkWorld('the reader phase')

    // The shell changes behind the plugin's back. This gate writes under ITS OWN holder, which the shell
    // accepts while it holds the lease - the plugin cannot see any of this except by re-reading op=state.
    const shellNew = await panelPost(PORT, { op: 'tab-new', url: URL_TMP, holder: GATE_HOLDER })
    const shellNewState = await readState()
    const createdByShell = typeof shellNew?.tab === 'string' ? shellNew.tab : null
    await sleep(400)
    for (const tool of readerNames) await readerCall(tool, 'after-shell-added-a-tab')
    const shellMove = createdByShell === null ? null : await panelPost(PORT, { op: 'tab-goto', id: createdByShell, url: URL_TMP_MOVED, holder: GATE_HOLDER })
    await sleep(400)
    const afterMoveRows = rowsOf((await readState()).state)
    for (const tool of readerNames) await readerCall(tool, 'after-shell-moved-that-tabs-url')
    transcript.shellChange = {
      createdByShell,
      shellAddAnswer: shellNew === null ? null : { status: shellNew.ok === true, tab: shellNew.tab ?? null, error: shellNew.error ?? null },
      moveAnswer: shellMove === null ? null : { ok: shellMove.ok === true, error: shellMove.error ?? null },
      rowsAfterMove: afterMoveRows,
    }

    await checkWorld('the gate\'s own change to the shell')

    // --- reading 9, first half: the lease really refuses the tools ---------------------------------
    const leasedStateBefore = (await readState()).state
    const refusedWrite = await callTool(subject, tap, transcript.roles.create, { url: URL_A })
    const leasedStateAfter = (await readState()).state
    const foreignWrite = await panelPost(PORT, { op: 'tab-new', url: URL_A, holder: FOREIGN_HOLDER })
    transcript.lease.refusedWrite = { tool: refusedWrite.tool, args: refusedWrite.args, ok: refusedWrite.ok, text: refusedWrite.text, error: refusedWrite.error, ops: writesIn(refusedWrite.ops) }
    transcript.lease.foreignWrite = { status: foreignWrite === null ? 0 : 200, error: foreignWrite?.error ?? null, tab: foreignWrite?.tab ?? null }
    transcript.lease.stateBefore = fingerprintOf(leasedStateBefore)
    transcript.lease.stateAfter = fingerprintOf(leasedStateAfter)
    transcript.lease.held = true

    // The probe sweep, always (not only when a name is missing): with the lease held the shell refuses
    // every write, so this is the one moment when "look at what the whole face does" is safe here.
    if (transcript.roles.basis === 'frozen-name') {
      const activeRow = transcript.afterOpen.tabs.find((row) => row.active === true) ?? transcript.afterOpen.tabs[0]
      for (const name of subject.names) {
        const definition = subject.registry.get(name)
        if (isProbeSafe(definition) !== true) continue
        for (const shape of probeShapes(definition, activeRow?.id ?? null, activeRow?.url ?? null)) {
          const record = await callTool(subject, tap, name, shape.args)
          const writes = writesIn(record.ops)
          transcript.probes.push({ tool: name, shape: shape.id, ok: record.ok, error: clip(record.error ?? '', 120), ops: record.ops.map((entry) => entry.op ?? entry.method ?? entry.path), writes: writes.map((entry) => entry.op), status: writes.map((entry) => entry.status), refusedByName: writes.every((entry) => entry.status === 400 && typeof entry.error === 'string' && entry.error.includes('leased by')) })
          for (const write of writes) transcript.lease.sweepWrites.push({ tool: name, shape: shape.id, op: write.op, id: write.id, url: write.url, holder: write.holder, status: write.status, error: clip(String(write.error ?? ''), 200) })
        }
      }
    }
    await checkWorld('the lease-held probe sweep')
    transcript.lease.sweptState = fingerprintOf((await readState()).state)

    // --- the lease goes back, and the SAME call is accepted ----------------------------------------
    await releaseLease(PORT, GATE_HOLDER)
    leaseHeld = false
    transcript.lease.released = true
    const accepted = await callTool(subject, tap, transcript.roles.create, { url: URL_A })
    const acceptedState = await readState()
    // The id the shell created is the one the shell answered the write with, taken from the tap's own log.
    const answerTab = (() => {
      const entry = [...tap.log].reverse().find((row) => row.path === '/__shell/panel' && row.body?.op === 'tab-new' && typeof row.answer?.tab === 'string')
      return entry === undefined ? null : entry.answer.tab
    })()
    transcript.lease.acceptedAfterRelease = {
      tool: accepted.tool,
      args: accepted.args,
      ok: accepted.ok,
      text: accepted.text,
      error: accepted.error,
      ops: writesIn(accepted.ops),
      shellActiveAfter: fingerprintOf(acceptedState.state).active,
      shellCountAfter: fingerprintOf(acceptedState.state).count,
      shellIdsAfter: rowsOf(acceptedState.state).map((row) => row.id),
      answerTab,
    }
    const ownTab = answerTab
    transcript.create = {
      tool: accepted.tool,
      args: accepted.args,
      ok: accepted.ok,
      text: accepted.text,
      error: accepted.error,
      created: ownTab,
      shellRowAfter: rowsOf(acceptedState.state).find((row) => row.id === ownTab) ?? null,
      shellActiveAfter: fingerprintOf(acceptedState.state).active,
      shellIdsBefore: transcript.lease.stateBefore.tabs.map((row) => row.id),
      ops: accepted.ops.map((entry) => ({ op: entry.op, id: entry.id, url: entry.url, holder: entry.holder, status: entry.status })),
      document: ownTab === null ? null : await waitForHref(ownTab, URL_A, 12000),
    }
    if (ownTab === null) await decline('the tab write produced no id the shell answered with (the tap saw nothing to take it from), so there is no tab of this gate\'s own to drive')

    await checkWorld('the accepted tab write')

    // --- reading 6: goto addresses ITS OWN tab, and the user's page does not move ------------------
    const userHrefBefore = await tabHref(transcript.userTab)
    const ownHrefBefore = await tabHref(ownTab)
    const userRowBefore = (await readState()).state
    const activeBeforeGoto = rowsOf(userRowBefore).find((row) => row.active === true)?.id ?? null
    const gotoCall = await callTool(subject, tap, transcript.roles.goto, { tab: ownTab, url: URL_B })
    const userHrefAfter = await tabHref(transcript.userTab)
    const ownHrefAfter = await waitForHref(ownTab, URL_B, 12000)
    const afterGotoState = (await readState()).state
    transcript.goto = {
      tool: gotoCall.tool,
      args: gotoCall.args,
      ok: gotoCall.ok,
      text: gotoCall.text,
      error: gotoCall.error,
      ownTab,
      userTab: transcript.userTab,
      ownHrefBefore,
      ownHrefAfter,
      userHrefBefore,
      userHrefAfter,
      userRowBefore: rowsOf(userRowBefore).find((row) => row.id === transcript.userTab) ?? null,
      userRowAfter: rowsOf(afterGotoState).find((row) => row.id === transcript.userTab) ?? null,
      activeBefore: activeBeforeGoto,
      activeAfter: rowsOf(afterGotoState).find((row) => row.active === true)?.id ?? null,
      ops: gotoCall.ops.map((entry) => ({ op: entry.op, method: entry.method, id: entry.id, url: entry.url, tab: entry.tab, tabPresent: entry.tabPresent, status: entry.status })),
      sentPageNavigate: gotoCall.ops.some((entry) => entry.method === 'Page.navigate'),
    }

    // paired: no tab named at all -> the shell's ACTIVE tab moves, which here is the gate's own, not the user's
    const defaultCall = await callTool(subject, tap, transcript.roles.goto, { url: URL_C })
    const userHrefAfterDefault = await tabHref(transcript.userTab)
    const ownHrefAfterDefault = await waitForHref(ownTab, URL_C, 12000)
    const afterDefaultState = (await readState()).state
    transcript.gotoDefault = {
      tool: defaultCall.tool,
      args: defaultCall.args,
      ok: defaultCall.ok,
      text: defaultCall.text,
      error: defaultCall.error,
      ownHref: ownHrefAfterDefault,
      userHref: userHrefAfterDefault,
      activeBefore: transcript.goto.activeAfter,
      activeAfter: rowsOf(afterDefaultState).find((row) => row.active === true)?.id ?? null,
      ops: defaultCall.ops.map((entry) => ({ op: entry.op, method: entry.method, id: entry.id, url: entry.url, tab: entry.tab, tabPresent: entry.tabPresent, status: entry.status })),
    }

    // --- reading 7: activate and close, including the left neighbour -------------------------------
    const beforeActivate = (await readState()).state
    const activateCall = await callTool(subject, tap, transcript.roles.activate, { tab: transcript.userTab })
    const afterActivate = (await readState()).state
    transcript.activate = {
      tool: activateCall.tool,
      args: activateCall.args,
      ok: activateCall.ok,
      text: activateCall.text,
      error: activateCall.error,
      activeBefore: rowsOf(beforeActivate).find((row) => row.active === true)?.id ?? null,
      activeAfter: rowsOf(afterActivate).find((row) => row.active === true)?.id ?? null,
      askedFor: transcript.userTab,
      ops: activateCall.ops.map((entry) => ({ op: entry.op, id: entry.id, holder: entry.holder, status: entry.status })),
    }
    await callTool(subject, tap, transcript.roles.activate, { tab: ownTab })

    // Build a world where "left" is not "the first tab": make sure at least three tabs exist, activate
    // the SECOND row, then close it and require the shell's own left neighbour to come forward.
    let idsNow = rowsOf((await readState()).state).map((row) => row.id)
    for (let step = 0; step < 4 && idsNow.length < 3; step += 1) {
      // The left-neighbour case needs a "left" that is not "the first tab", so the world is built up to
      // three tabs before the close - each one a real tab the shell makes, closed again by the restore.
      const extra = await callTool(subject, tap, transcript.roles.create, { url: URL_TMP })
      await sleep(300)
      transcript.notes.push('note: a tab was opened for the left-neighbour case: ' + clip(String(extra.text ?? extra.error), 120))
      idsNow = rowsOf((await readState()).state).map((row) => row.id)
    }
    const beforeCloseState = (await readState()).state
    const beforeCloseRows = rowsOf(beforeCloseState)
    // Close the LAST tab of three or more: then the tab that must come forward is the one to its left,
    // which is neither the tab that was closed nor the first tab - so "left neighbour" cannot be satisfied
    // by a rule that just picks the first tab in the set.
    const targetIndex = beforeCloseRows.length >= 3 ? beforeCloseRows.length - 1 : 0
    const targetRow = beforeCloseRows[targetIndex]
    await callTool(subject, tap, transcript.roles.activate, { tab: targetRow.id })
    const armedState = (await readState()).state
    const armedRows = rowsOf(armedState)
    const closeCall = await callTool(subject, tap, transcript.roles.close, { tab: targetRow.id })
    const afterCloseState = (await readState()).state
    const afterCloseRows = rowsOf(afterCloseState)
    const expectedNeighbour = armedRows.length >= 2 ? armedRows[Math.max(0, targetIndex - 1)].id : null
    transcript.close = {
      tool: closeCall.tool,
      args: closeCall.args,
      ok: closeCall.ok,
      text: closeCall.text,
      error: closeCall.error,
      idsBefore: armedRows.map((row) => row.id),
      countBefore: fingerprintOf(armedState).count,
      idsAfter: afterCloseRows.map((row) => row.id),
      countAfter: fingerprintOf(afterCloseState).count,
      activeBefore: armedRows.find((row) => row.active === true)?.id ?? null,
      activeAfter: afterCloseRows.find((row) => row.active === true)?.id ?? null,
      closed: targetRow.id,
      expectedNeighbour,
      ops: closeCall.ops.map((entry) => ({ op: entry.op, id: entry.id, holder: entry.holder, status: entry.status })),
    }
    if (ownTab !== null && afterCloseRows.some((row) => row.id === ownTab) === true) {
      await callTool(subject, tap, transcript.roles.activate, { tab: ownTab })
    }

    await checkWorld('activate and close')

    // --- reading 8: the cap is the shell's own sentence --------------------------------------------
    const capAttempts = []
    for (let step = 0; step < 8; step += 1) {
      const now = fingerprintOf((await readState()).state)
      if (now.count !== null && now.limit !== null && now.count >= now.limit) break
      const call = await callTool(subject, tap, transcript.roles.create, { url: URL_TMP })
      await sleep(250)
      capAttempts.push({ text: clip(String(call.text ?? call.error), 120), ok: call.ok })
    }
    const atCapState = (await readState()).state
    const atCap = fingerprintOf(atCapState)
    if (atCap.count === null || atCap.limit === null || atCap.count < atCap.limit) {
      transcript.cap = { reached: false, count: atCap.count, limit: atCap.limit, attempts: capAttempts }
      transcript.notes.push('note: the shell never reached its own tab limit (count ' + String(atCap.count) + ' of ' + String(atCap.limit) + '), so the cap refusal could NOT be measured')
    } else {
      // Paired half: at limit-1 the same call succeeded (that is the last entry of capAttempts).
      const overCall = await callTool(subject, tap, transcript.roles.create, { url: URL_TMP })
      const afterOver = fingerprintOf((await readState()).state)
      const direct = await panelPost(PORT, { op: 'tab-new', url: URL_TMP })
      const afterDirect = fingerprintOf((await readState()).state)
      transcript.cap = {
        reached: true,
        limit: atCap.limit,
        countAtCap: atCap.count,
        idsAtCap: atCap.tabs.map((row) => row.id),
        pairedLastSuccess: capAttempts.length === 0 ? null : capAttempts[capAttempts.length - 1],
        toolOk: overCall.ok,
        toolError: overCall.error,
        toolText: overCall.text,
        toolOps: writesIn(overCall.ops).map((entry) => ({ op: entry.op, id: entry.id, url: entry.url, status: entry.status, error: entry.error })),
        directStatus: direct === null ? 0 : 200,
        directError: direct?.error ?? null,
        directTab: direct?.tab ?? null,
        countAfterToolRefusal: afterOver.count,
        idsAfterToolRefusal: afterOver.tabs.map((row) => row.id),
        countAfterDirectRefusal: afterDirect.count,
        idsAfterDirectRefusal: afterDirect.tabs.map((row) => row.id),
      }
    }

    // --- reading 4's raw material: every accepted tab write the tools sent -------------------------
    transcript.writeOps = tap.log
      .filter((entry) => entry.path === '/__shell/panel' && WRITE_OPS.includes(entry.body?.op))
      .map((entry) => ({ tool: null, op: entry.body.op, id: entry.body.id ?? null, url: entry.body.url ?? null, holder: entry.body.holder ?? null, holderPresent: Object.prototype.hasOwnProperty.call(entry.body, 'holder'), status: entry.status, error: typeof entry.answer?.error === 'string' ? entry.answer.error : null }))
    transcript.readBacks = tap.log
      .filter((entry) => entry.path === '/__shell/panel' && entry.body?.op === 'state')
      .length
  } catch (error) {
    if (error instanceof NotMeasured) {
      transcript.notes.push('NOT MEASURED in the world: ' + error.message)
    } else {
      transcript.problems.push('the drive stopped on an unexpected error: ' + describe(error) + (error !== null && error !== undefined && error.stack !== undefined ? '\n' + String(error.stack).split('\n').slice(0, 4).join('\n') : ''))
    }
  } finally {
    // --- the world goes back the way it was found, and the reading says what came back -------------
    const restore = { closedTabs: [], activated: null, closedPanel: false, surfaceRestored: null, leaseReleased: leaseHeld === false, problems: [] }
    try {
      if (leaseHeld === true) {
        await releaseLease(PORT, GATE_HOLDER)
        restore.leaseReleased = true
      }
      const nowState = (await readState()).state
      const entryIds = new Set(transcript.entry.tabs.map((row) => row.id))
      for (const row of rowsOf(nowState)) {
        if (entryIds.has(row.id) === true) continue
        const closed = await panelPost(PORT, { op: 'tab-close', id: row.id })
        restore.closedTabs.push({ id: row.id, ok: closed !== null && closed.error === undefined })
        await sleep(150)
      }
      const afterClose = (await readState()).state
      const wanted = transcript.entry.active
      if (wanted !== null && rowsOf(afterClose).some((row) => row.id === wanted) === true && rowsOf(afterClose).find((row) => row.active === true)?.id !== wanted) {
        const activated = await panelPost(PORT, { op: 'tab-activate', id: wanted })
        restore.activated = { id: wanted, ok: activated !== null && activated.error === undefined }
      }
      if (openedPanel === true && transcript.entry.exists === false) {
        const closed = await panelPost(PORT, { op: 'close' })
        restore.closedPanel = closed !== null && closed.error === undefined
      }
      if (transcript.entrySurface === null && openedPanel === true) {
        // The shell had declared no surface at all; taking the browser down clears the one this gate declared.
        const cleared = await panelPost(PORT, { op: 'surface', x: 0, y: 0, w: 0, h: 0 })
        restore.surfaceRestored = { cleared: cleared !== null && cleared.error === undefined }
        restore.closedPanel = true
      }
      // Long enough for the shell to settle a close, and long enough for the client's own page host to
      // show its hand if it wants the panel back (its slow beat is every 12th 400 ms tick; a host that
      // reopens it after this window is the host's own rule, and the doc says so).
      await sleep(1500)
      transcript.clientAtExit = clientIdentity()
      if (transcript.clientAtEntry !== null && transcript.clientAtExit !== null && transcript.clientAtEntry !== transcript.clientAtExit) {
        transcript.notes.push('NOT MEASURED in the world: the client was RESTARTED while this gate was running (' + String(transcript.clientAtEntry) + ' -> ' + String(transcript.clientAtExit) + '), so the shell this gate measured no longer exists and nothing here can be attributed to the product')
      }
      const exitState = await readState()
      transcript.exit = fingerprintOf(exitState.state)
      transcript.exitStateRaw = exitState.state
      // A world that stopped answering while this gate was running is the third state, not a red: whatever
      // was measured against a shell that is no longer there cannot be attributed to the product. (Seen for
      // real: the client was killed under this gate mid-run, and a half-filled transcript is not a verdict.)
      if (exitState.status !== 200 || exitState.state === null) {
        transcript.notes.push('NOT MEASURED in the world: the shell at ' + SHELL_ORIGIN + ' stopped answering op=state while this gate was running (' + String(exitState.error ?? 'HTTP ' + exitState.status) + '), so the world was taken away mid-run and nothing measured here can be attributed to the product')
      }
      transcript.restore = restore
    } catch (error) {
      restore.problems.push(describe(error))
      transcript.restore = restore
      transcript.problems.push('the world could not be put back: ' + describe(error))
    }
    await tap.close().catch(() => undefined)
    closeSubject(subject)
    if (KEEP !== true) {
      try {
        rmSync(baseDir, { recursive: true, force: true })
      } catch {
        /* the temp dir is the OS's to clean */
      }
    }
  }
  return transcript
}

// ---------------------------------------------------------------------------
// The judge: a pure function of the transcript
// ---------------------------------------------------------------------------

const OK = (detail) => ({ ok: true, detail })
const BAD = (detail) => ({ ok: false, detail })
const NOT_MEASURED = (detail) => ({ ok: false, notMeasured: true, detail })
const rowKey = (row) => row === null || row === undefined ? '(none)' : String(row.id) + ' live=' + String(row.live) + (row.active ? ' *' : '') + ' ' + String(row.url)
const rowsEqual = (left, right) => same(left.map((row) => [row.id, row.url, row.live, row.active]), right.map((row) => [row.id, row.url, row.live, row.active]))

const READINGS = [
  {
    id: '1-the-tap-is-transparent-and-the-face-is-the-build-that-is-running',
    judge: (t) => {
      if (t.shellSource === null || t.shellSource.ok !== true) return NOT_MEASURED('the shell source could not be read: ' + String(t.shellSource?.why))
      if (t.shellSource.maxTabs !== t.entry.limit) {
        return BAD('the shell reports limit=' + String(t.entry.limit) + ' while its own source says MAX_TABS=' + String(t.shellSource.maxTabs))
      }
      if (t.tap.transparency === null || t.tap.transparency.sameBody !== true || t.tap.transparency.tapStatus !== 200) {
        return BAD('the tap is not transparent: op=state through it answered ' + show(t.tap.transparency))
      }
      const pass = t.tap.refusalPassThrough
      if (pass === null || pass === undefined || pass.tapStatus !== pass.shellStatus || pass.sameError !== true || pass.tapStatus !== 400) {
        return BAD('a refusal does not survive the tap: ' + show(pass))
      }
      if (t.subject.names.length === 0) return BAD('apply() registered no tool at all in this world')
      const face = t.subject.startupLine
      if (face === null) return BAD('the plugin did not log the panel origin it is driving (' + clip(String(t.subject.readyLine), 160) + ')')
      if (face.includes(t.tap.origin) !== true) return BAD('the plugin is driving ' + clip(face, 160) + ' and not this gate\'s tap at ' + String(t.tap.origin))
      if (t.subject.panelEnv === '0') return BAD('DSH_BROWSER_PANEL=0 is set, so this build runs the chrome channel and has no tab face to measure')
      return OK('the tap forwards op=state unchanged (' + String(t.tap.transparency.tapKeys) + ' keys) and passes a refusal through with the shell\'s own ' + String(t.tap.refusalPassThrough.tapStatus) + ' and the same sentence (' + show(t.tap.refusalPassThrough.error) + '), the shell\'s limit ' + String(t.entry.limit) + ' equals MAX_TABS at sidebar_panel.rs:' + String(t.shellSource.lines.maxTabs) + ', apply() registered ' + String(t.subject.names.length) + ' tools, and the plugin\'s own startup line names ' + String(t.tap.origin) + ' as the panel it drives')
    },
  },
  {
    id: '2-the-tab-set-the-tool-reports-is-the-shells-own-row-for-row',
    judge: (t) => {
      if (t.readers.calls.length === 0) return NOT_MEASURED('no tab-set reader was called')
      const first = t.readers.calls.filter((call) => call.phase === 'first')
      if (first.length === 0) return NOT_MEASURED('no reader answered before the shell was changed')
      const problems = []
      const lines = []
      for (const call of first) {
        if (call.ok !== true) { problems.push(call.tool + ' refused: ' + clip(String(call.error), 140)); continue }
        if (call.parsed.ok !== true) { problems.push(call.tool + ': ' + String(call.parsed.why)); continue }
        const shell = call.shellBefore
        if (call.parsed.count !== shell.count) problems.push(call.tool + ' says count ' + String(call.parsed.count) + ' and the shell says ' + String(shell.count))
        if (call.parsed.limit !== shell.limit) problems.push(call.tool + ' says limit ' + String(call.parsed.limit) + ' and the shell says ' + String(shell.limit))
        if (call.parsed.active !== shell.active) problems.push(call.tool + ' says active ' + String(call.parsed.active) + ' and the shell says ' + String(shell.active))
        if (rowsEqual(call.parsed.rows, shell.tabs) !== true) {
          problems.push(call.tool + ' lists different rows than the shell: tool ' + show(call.parsed.rows.map((row) => [row.id, row.url, row.live, row.active])) + ' vs shell ' + show(shell.tabs.map((row) => [row.id, row.url, row.live, row.active])))
        }
        lines.push(call.tool + ' [ ' + call.parsed.rows.map(rowKey).join(' | ') + ' ]')
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK(lines.join(' ; ') + ' -- each read against the op=state this gate took itself')
    },
  },
  {
    id: '3-the-answers-follow-the-shell-and-are-not-a-copy',
    judge: (t) => {
      const change = t.shellChange
      if (change === null) return NOT_MEASURED('the shell was never changed behind the plugin\'s back')
      if (change.createdByShell === null) return BAD('the shell did not answer the gate\'s own op=tab-new with a tab id (' + show(change.shellAddAnswer) + ')')
      const first = t.readers.calls.filter((call) => call.phase === 'first')
      const added = t.readers.calls.filter((call) => call.phase === 'after-shell-added-a-tab')
      const moved = t.readers.calls.filter((call) => call.phase === 'after-shell-moved-that-tabs-url')
      if (added.length === 0 || moved.length === 0) return NOT_MEASURED('the readers were not called on both halves of the change')
      const problems = []
      for (const call of added) {
        if (call.ok !== true || call.parsed.ok !== true) { problems.push(call.tool + ' could not answer after the shell added a tab: ' + clip(String(call.error ?? call.parsed.why), 140)); continue }
        if (call.parsed.rows.some((row) => row.id === change.createdByShell) !== true) problems.push(call.tool + ' did not list the tab the SHELL created (' + change.createdByShell + ')')
        if (call.parsed.count !== call.shellBefore.count) problems.push(call.tool + ' says count ' + String(call.parsed.count) + ' while the shell says ' + String(call.shellBefore.count))
      }
      for (const call of moved) {
        if (call.ok !== true || call.parsed.ok !== true) { problems.push(call.tool + ' could not answer after the URL moved: ' + clip(String(call.error ?? call.parsed.why), 140)); continue }
        const row = call.parsed.rows.find((entry) => entry.id === change.createdByShell)
        if (row === undefined) { problems.push(call.tool + ' lost the tab whose URL moved (' + change.createdByShell + ')'); continue }
        if (row.url !== t.urls.tmpMoved) problems.push(call.tool + ' still reports ' + String(row.url) + ' for ' + change.createdByShell + ' after the shell moved it to ' + t.urls.tmpMoved)
      }
      const before = first[0]
      const after = moved[0]
      if (before !== undefined && after !== undefined && String(before.text) === String(after.text)) problems.push('the answer is byte-identical across a change the shell made, which is what a cache looks like')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('the shell created ' + String(change.createdByShell) + ' behind the plugin\'s back and every reader answered with it, then with its moved URL ' + t.urls.tmpMoved + '; the two answers differ (' + String(String(before?.text ?? '').length) + ' vs ' + String(String(after?.text ?? '').length) + ' bytes)')
    },
  },
  {
    id: '4-writes-go-through-the-shells-own-ops-carrying-the-plugins-own-holder',
    judge: (t) => {
      if (t.writeOps === undefined) return NOT_MEASURED('no request log was collected')
      const accepted = t.writeOps.filter((entry) => entry.status === 200)
      if (accepted.length === 0) return NOT_MEASURED('no tab write was accepted in this run, so there is nothing to judge')
      const problems = []
      for (const write of accepted) {
        if (['tab-new', 'tab-close', 'tab-activate', 'tab-goto'].includes(write.op) !== true) problems.push('an accepted write used the op ' + String(write.op) + ', which is not one of the shell\'s tab ops')
        if (write.holder !== t.panelHolder) problems.push('an accepted ' + String(write.op) + ' carried holder ' + show(write.holder) + ' instead of the name the package exports (' + String(t.panelHolder) + ')')
      }
      const tabWrites = accepted.filter((entry) => ['tab-close', 'tab-activate', 'tab-goto'].includes(entry.op))
      for (const write of tabWrites) {
        if (typeof write.id !== 'string' || write.id === '') problems.push('an accepted ' + String(write.op) + ' carried no tab id')
      }
      // VERBATIM, per call and per op: the tab id this gate handed the tool is the id the shell was sent -
      // no renumbering into "the second tab", no translation of any kind.
      const handed = [
        { what: 'browser_goto { tab }', op: 'tab-goto', id: t.goto?.args?.tab ?? null, url: t.urls.B },
        { what: 'browser_goto with no tab named', op: 'tab-goto', id: t.gotoDefault?.activeBefore ?? null, url: t.urls.C },
        { what: 'browser_tab_activate { tab }', op: 'tab-activate', id: t.activate?.args?.tab ?? null, url: null },
        { what: 'browser_tab_close { tab }', op: 'tab-close', id: t.close?.args?.tab ?? null, url: null },
      ]
      for (const want of handed) {
        if (want.id === null) continue
        const found = accepted.some((write) => write.op === want.op && write.id === want.id && (want.url === null || write.url === want.url))
        if (found !== true) problems.push(want.what + ' was given tab ' + String(want.id) + ' (and ' + String(want.url ?? 'no url') + ') but the shell was never sent that op with that id')
      }
      const asked = tabWrites.map((write) => [write.op, write.id])
      if (t.readBacks === undefined || t.readBacks === 0) problems.push('no op=state read-back reached the shell at all')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK(String(accepted.length) + ' accepted writes, every one of them a shell op carrying holder ' + String(t.panelHolder) + ', and every tab the gate handed the tools went to the shell as that very id (' + show(asked.slice(0, 6)) + '); ' + String(t.readBacks) + ' op=state read-backs through the tap, so no answer is a request echoed back')
    },
  },
  {
    id: '5-opening-a-tab-is-the-shell-opening-it-and-the-shell-names-it',
    judge: (t) => {
      if (t.create === undefined || t.create === null) return NOT_MEASURED('browser_tab_new was never accepted, so no tab was opened by this gate')
      const create = t.create
      if (create.ok !== true) return BAD('the tool reported failure: ' + clip(String(create.error), 160))
      if (typeof create.created !== 'string' || create.created === '') return BAD('the shell never answered an id for the tab the tool asked for')
      const problems = []
      if (create.shellIdsBefore.includes(create.created) === true) problems.push('the id ' + create.created + ' already existed before the call, so it is not a tab the shell just made')
      if (create.shellRowAfter === null) problems.push('the shell does not list ' + create.created + ' after the write')
      if (create.shellActiveAfter !== create.created) problems.push('the shell\'s active tab is ' + String(create.shellActiveAfter) + ' and not the tab it just created (' + create.created + ')')
      if (create.text.includes('opened tab ' + create.created) !== true) problems.push('the tool\'s answer does not name the id the shell created: ' + clip(String(create.text), 160))
      if (create.document?.ok !== true) problems.push('the new tab could not be read back (' + String(create.document?.why) + ')')
      else if (create.document.href !== t.urls.A) problems.push('the new tab is on ' + String(create.document.href) + ' and was asked for ' + t.urls.A)
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('browser_tab_new { url } -> the shell created ' + create.created + ' (not in the set before: ' + show(create.shellIdsBefore) + '), it is the shell\'s ACTIVE tab, the tool reports the shell\'s own id, and that tab\'s own renderer is on ' + String(create.document.href))
    },
  },
  {
    id: '6-goto-moves-the-tab-it-was-given-and-leaves-the-users-page-alone',
    judge: (t) => {
      if (t.goto === null) return NOT_MEASURED('no goto call was made')
      const g = t.goto
      if (g.ok !== true) return BAD('browser_goto failed: ' + clip(String(g.error), 160))
      const problems = []
      if (g.userHrefBefore.ok !== true || g.userHrefAfter.ok !== true) {
        return NOT_MEASURED('the user\'s tab could not be read before and after (' + String(g.userHrefBefore.why ?? g.userHrefAfter.why) + '), so "it did not move" cannot be said')
      }
      if (g.sentPageNavigate === true) problems.push('the call used Page.navigate, which goes to the ACTIVE tab rather than the one it was given')
      if (g.ops.some((op) => op.op === 'tab-goto' && op.id === g.ownTab) !== true) problems.push('no op=tab-goto for ' + String(g.ownTab) + ' reached the shell: ' + show(g.ops.map((op) => [op.op, op.id, op.method])))
      if (g.ownHrefAfter.ok !== true) problems.push('the gate\'s own tab could not be read after the navigation')
      else if (g.ownHrefAfter.href !== t.urls.B) problems.push('the gate\'s own tab is on ' + String(g.ownHrefAfter.href) + ' and was asked for ' + t.urls.B)
      if (g.userHrefAfter.href !== g.userHrefBefore.href) problems.push('THE USER\'S PAGE MOVED: ' + String(g.userHrefBefore.href) + ' -> ' + String(g.userHrefAfter.href))
      if (same(g.userRowBefore, g.userRowAfter) !== true) problems.push('the shell\'s record for the user\'s tab changed (' + show(g.userRowBefore) + ' -> ' + show(g.userRowAfter) + ')')
      if (g.activeBefore !== g.activeAfter) problems.push('navigating changed which tab is active (' + String(g.activeBefore) + ' -> ' + String(g.activeAfter) + '), which the shell\'s op does not do')
      if (String(g.text).includes(t.urls.B) !== true) problems.push('the answer does not report where the tab itself landed')
      const d = t.gotoDefault
      if (d === null) problems.push('the paired call (no tab named) was never made')
      else {
        if (d.userHref.ok !== true) problems.push('the user\'s tab could not be read after the paired call')
        else if (d.userHref.href !== g.userHrefBefore.href) problems.push('the paired call moved the user\'s page too: ' + String(d.userHref.href))
        if (d.ops.some((op) => op.op === 'tab-goto' && op.id === g.ownTab) !== true) problems.push('with no tab named, the shell was not sent op=tab-goto for the ACTIVE tab (' + String(g.ownTab) + '): ' + show(d.ops.map((op) => [op.op, op.id])))
        if (d.ownHref.ok !== true || d.ownHref.href !== t.urls.C) problems.push('with no tab named the ACTIVE tab did not move where asked (' + show(d.ownHref) + ')')
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('goto { tab: ' + g.ownTab + ' } -> op=tab-goto for that one tab, that tab\'s own renderer ' + String(g.ownHrefBefore.href ?? '(unread)') + ' -> ' + String(g.ownHrefAfter.href) + ', while the user\'s tab ' + String(g.userTab) + ' read from ITSELF stayed on ' + String(g.userHrefAfter.href) + ' and the shell\'s record for it is byte-identical; paired: with no tab named the ACTIVE tab (' + String(g.ownTab) + ') moved to ' + String(d?.ownHref?.href) + ' and the user\'s page still did not')
    },
  },
  {
    id: '7-activate-and-close-happen-in-the-shell-including-the-left-neighbour',
    judge: (t) => {
      if (t.activate === null || t.close === null) return NOT_MEASURED('activate and close were not both driven')
      const a = t.activate
      const c = t.close
      const problems = []
      if (a.ok !== true) problems.push('browser_tab_activate failed: ' + clip(String(a.error), 140))
      else {
        if (a.ops.some((op) => op.op === 'tab-activate' && op.id === a.askedFor) !== true) problems.push('no op=tab-activate for ' + String(a.askedFor) + ' reached the shell')
        if (a.activeAfter !== a.askedFor) problems.push('the shell\'s active tab is ' + String(a.activeAfter) + ' after asking for ' + String(a.askedFor))
        if (a.activeBefore === a.activeAfter) problems.push('the gate never built a case where activation changes anything (' + String(a.activeBefore) + ' was already active)')
        if (String(a.text).includes('activated tab ' + a.askedFor) !== true) problems.push('the answer does not report the activation the shell performed')
      }
      if (c.ok !== true) problems.push('browser_tab_close failed: ' + clip(String(c.error), 140))
      else {
        if (c.ops.some((op) => op.op === 'tab-close' && op.id === c.closed) !== true) problems.push('no op=tab-close for ' + String(c.closed) + ' reached the shell')
        if (c.countAfter !== (c.countBefore === null ? null : c.countBefore - 1)) problems.push('the count went ' + String(c.countBefore) + ' -> ' + String(c.countAfter) + ' around a close')
        if (c.idsAfter.includes(c.closed) === true) problems.push('the closed tab ' + c.closed + ' is still in the shell\'s set')
        if (c.activeBefore !== c.closed) problems.push('the close was not aimed at the ACTIVE tab (' + String(c.activeBefore) + ' was active, ' + String(c.closed) + ' was closed), so the left-neighbour rule was not exercised')
        if (c.expectedNeighbour === null) problems.push('the world did not have a left neighbour to fall back to')
        else if (c.activeAfter !== c.expectedNeighbour) problems.push('after closing the active tab the shell made ' + String(c.activeAfter) + ' active while its LEFT neighbour was ' + String(c.expectedNeighbour) + ' (' + show(c.idsBefore) + ' -> ' + show(c.idsAfter) + ')')
        if (c.idsBefore.length >= 3 && (c.closed === c.idsBefore[0] || c.expectedNeighbour === c.idsBefore[0])) {
          problems.push('the world was not built so that "left" is neither "the first tab" nor the closed one: set ' + show(c.idsBefore) + ', closed ' + String(c.closed) + ', neighbour ' + String(c.expectedNeighbour))
        }
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('activate ' + String(a.askedFor) + ': shell active ' + String(a.activeBefore) + ' -> ' + String(a.activeAfter) + '; close ' + String(c.closed) + ': shell set ' + show(c.idsBefore) + ' -> ' + show(c.idsAfter) + ' (count ' + String(c.countBefore) + ' -> ' + String(c.countAfter) + ') and the active tab fell to its LEFT neighbour ' + String(c.expectedNeighbour))
    },
  },
  {
    id: '8-the-cap-refusal-is-the-shells-own-sentence-byte-for-byte',
    judge: (t) => {
      if (t.cap === undefined || t.cap === null) return NOT_MEASURED('the cap was never attempted')
      if (t.cap.reached !== true) return NOT_MEASURED('the shell never reached its own tab limit (count ' + String(t.cap.count) + ' of ' + String(t.cap.limit) + '), so the refusal could not be read')
      const cap = t.cap
      const problems = []
      if (typeof cap.toolError !== 'string' || cap.toolError === '') problems.push('the tool did not refuse at the cap (it answered ' + clip(String(cap.toolText ?? cap.toolError), 140) + ')')
      if (typeof cap.directError !== 'string' || cap.directError === '') problems.push('the shell itself did not refuse when this gate asked it directly at the cap')
      if (problems.length === 0 && cap.toolError !== cap.directError) {
        problems.push('the tool\'s sentence is not the shell\'s: tool ' + show(cap.toolError) + ' vs shell ' + show(cap.directError))
      }
      const expectedShape = t.shellSource !== null && t.shellSource.ok === true
        ? (() => {
            const ids = cap.idsAtCap
            const nextGuess = Number(String(cap.directError ?? cap.toolError).match(/opening tab t(\d+)/)?.[1] ?? NaN)
            return Number.isFinite(nextGuess) ? t.shellSource.cap(nextGuess, ids.length, ids) : null
          })()
        : null
      if (expectedShape !== null && cap.toolError !== expectedShape) {
        problems.push('the refusal does not match the shell\'s own format string rebuilt with the ids the shell held: expected ' + show(expectedShape) + ' and the tool said ' + show(cap.toolError))
      }
      if (cap.countAfterToolRefusal !== cap.countAtCap) problems.push('the refused call changed the shell\'s count: ' + String(cap.countAtCap) + ' -> ' + String(cap.countAfterToolRefusal))
      if (same(cap.idsAfterToolRefusal, cap.idsAtCap) !== true) problems.push('the refused call changed the shell\'s tab set: ' + show(cap.idsAtCap) + ' -> ' + show(cap.idsAfterToolRefusal))
      if (cap.pairedLastSuccess === null || cap.pairedLastSuccess.ok !== true) problems.push('the paired half is missing: the call that brought the set TO the limit did not succeed')
      if (cap.toolOps.length === 0) problems.push('the tap saw no op=tab-new for the refused call')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('at ' + String(cap.countAtCap) + '/' + String(cap.limit) + ' tabs the tool refused with the shell\'s own sentence, byte for byte: ' + show(cap.toolError) + '; the shell, asked directly, said the same; the set did not move (' + show(cap.idsAfterToolRefusal) + ') and the call that reached the limit did succeed')
    },
  },
  {
    id: '9-without-the-lease-nothing-writes-and-with-it-back-the-same-call-is-accepted',
    judge: (t) => {
      const lease = t.lease
      if (lease === null || lease.refusedWrite === null) return NOT_MEASURED('the lease-held write was never attempted')
      const problems = []
      const expected = t.shellSource !== null && t.shellSource.ok === true ? t.shellSource.leased(t.holder, t.panelHolder) : null
      if (lease.refusedWrite.ok === true) problems.push('while this gate held the lease, the tool\'s write WENT THROUGH: ' + clip(String(lease.refusedWrite.text), 140))
      else {
        if (expected !== null && lease.refusedWrite.error !== expected) problems.push('the refusal is not the shell\'s own sentence: expected ' + show(expected) + ' and got ' + show(lease.refusedWrite.error))
        if (lease.refusedWrite.ops.length === 0) problems.push('the tap saw no write attempt at all, so "refused by the shell" cannot be said')
      }
      if (lease.foreignWrite !== null && typeof lease.foreignWrite.error === 'string') {
        const foreignExpected = t.shellSource !== null && t.shellSource.ok === true ? t.shellSource.leased(t.holder, FOREIGN_HOLDER) : null
        if (foreignExpected !== null && lease.foreignWrite.error !== foreignExpected) problems.push('the shell\'s own sentence to a foreign caller differs from the template: ' + show(lease.foreignWrite.error))
      } else {
        problems.push('a call under a FOREIGN holder was not refused by the shell, so the sentence above is not the shell speaking')
      }
      if (same(lease.stateBefore.tabs, lease.stateAfter.tabs) !== true) problems.push('the refused write changed the shell\'s tab set: ' + show(lease.stateBefore.tabs) + ' -> ' + show(lease.stateAfter.tabs))
      const changedBySweep = lease.sweptState !== undefined && lease.sweptState !== null && same(lease.sweptState.tabs, lease.stateAfter?.tabs) !== true
      if (changedBySweep === true) problems.push('the probe sweep changed the shell\'s tab set even though every write it sent was refused: ' + show(lease.stateAfter.tabs) + ' -> ' + show(lease.sweptState.tabs))
      for (const write of lease.sweepWrites ?? []) {
        if (write.status !== 400 || typeof write.error !== 'string' || write.error.includes('leased by') !== true) {
          problems.push('a probe\'s write was not refused while the lease was held: ' + show(write))
        }
      }
      const accepted = lease.acceptedAfterRelease
      if (accepted === null || accepted === undefined) problems.push('the same call was not repeated after the lease was released')
      else {
        if (accepted.ok !== true) problems.push('after the lease was released the SAME call was still refused (' + clip(String(accepted.error), 140) + '), so the refusal above proves nothing about the lease')
        else if (String(accepted.text).includes('opened tab') !== true) problems.push('after the lease was released the call answered something unexpected: ' + clip(String(accepted.text), 140))
        if (accepted.ops.length === 0) problems.push('after the lease was released the tap saw no write')
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('with the lease held by ' + t.holder + ', the same call was refused: ' + show(lease.refusedWrite.error) + ' (the shell says the same to a foreign holder: ' + show(lease.foreignWrite?.error) + '), ' + String((lease.sweepWrites ?? []).length) + ' probe writes were refused too and the tab set did not move; released -> the same call was accepted and the shell created ' + String(accepted.answerTab) + ' (' + String(accepted.shellCountAfter) + ' tabs)')
    },
  },
  {
    id: '10-the-world-is-handed-back-as-it-was-found',
    judge: (t) => {
      if (t.exit === null) return NOT_MEASURED('no exit fingerprint was taken')
      const problems = []
      const residues = []
      if (t.restore === undefined || t.restore === null) return NOT_MEASURED('the restore did not run')
      if (t.restore.problems?.length > 0) problems.push('the restore itself failed: ' + t.restore.problems.join('; '))
      if (same(t.exit.tabs, t.entry.tabs) !== true) {
        const entryIds = t.entry.tabs.map((row) => row.id)
        const exitIds = t.exit.tabs.map((row) => row.id)
        const leftovers = exitIds.filter((id) => entryIds.includes(id) === false)
        if (leftovers.length > 0) {
          // A world with NO tab at all is the one case where a tab at the end is not this gate's doing:
          // mounting the browser makes the shell's own FIRST tab (sidebar_panel.rs:1570-1584), so it would
          // still be there even if this gate had never run. Named as a residue, not counted as a failure -
          // while every other leftover tab is exactly the residue this reading is for.
          if (t.entry.tabs.length === 0 && t.exit.tabs.length === 1) {
            residues.push('the shell held no tab at entry and holds ' + show(exitIds) + ' now: that one is the tab the SHELL makes when a browser mounts, not a tab this gate opened (the shell had nothing to hand back)')
          } else {
            problems.push('tabs this gate opened are still there: ' + show(leftovers) + ' (' + show(entryIds) + ' -> ' + show(exitIds) + ')')
          }
        } else problems.push('the tab set came back different: ' + show(t.entry.tabs) + ' -> ' + show(t.exit.tabs))
      }
      if (t.exit.active !== t.entry.active) problems.push('the active tab was ' + String(t.entry.active) + ' and is now ' + String(t.exit.active))
      if (t.exit.count !== t.entry.count) problems.push('the count was ' + String(t.entry.count) + ' and is now ' + String(t.exit.count))
      if (t.exit.limit !== t.entry.limit) problems.push('the limit was ' + String(t.entry.limit) + ' and is now ' + String(t.exit.limit))
      if (same(t.exit.viewport, t.entry.viewport) !== true) problems.push('the viewport was ' + show(t.entry.viewport) + ' and is now ' + show(t.exit.viewport))
      if (t.exit.mode !== t.entry.mode) problems.push('the mode was ' + String(t.entry.mode) + ' and is now ' + String(t.exit.mode))
      if (t.exit.exists !== t.entry.exists) residues.push('the panel was ' + (t.entry.exists ? 'open' : 'closed') + ' and is now ' + (t.exit.exists ? 'open' : 'closed'))
      if (t.exit.lease.held !== false) problems.push('the lease is still held: ' + show(t.exit.lease))
      else if (same(t.exit.lease, t.entry.lease) !== true) residues.push('the lease read ' + show(t.entry.lease) + ' at entry and ' + show(t.exit.lease) + ' now (released, but the shell\'s record differs)')
      const extra = (t.restore.closedTabs ?? []).filter((row) => row.ok !== true).length + (t.restore.activated !== null && t.restore.activated.ok !== true ? 1 : 0)
      if (extra > 0) problems.push(String(extra) + ' restore step(s) were refused by the shell')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('taken ' + show(t.entry.tabs.map(rowKey)) + ' active ' + String(t.entry.active) + ' count ' + String(t.entry.count) + ' viewport ' + show(t.entry.viewport) + ' mode ' + String(t.entry.mode) + '; returned ' + show(t.exit.tabs.map(rowKey)) + ' active ' + String(t.exit.active) + ' count ' + String(t.exit.count) + ' viewport ' + show(t.exit.viewport) + ' mode ' + String(t.exit.mode) + '; ' + String((t.restore.closedTabs ?? []).length) + ' tab(s) this gate opened were closed, the lease is back to ' + show(t.exit.lease) + (residues.length === 0 ? ', and nothing was left behind' : '; NAMED RESIDUE: ' + residues.join('; ')))
    },
  },
]

const runJudges = (transcript) => READINGS.map((reading) => {
  let verdict
  try {
    verdict = reading.judge(transcript)
  } catch (error) {
    verdict = { ok: false, detail: 'the reading itself threw: ' + describe(error) }
  }
  return { id: reading.id, ...verdict }
})

// ---------------------------------------------------------------------------
// Self-attack: mutate the MEASURED transcript, not a fixture
// ---------------------------------------------------------------------------

/**
 * A deep copy for the mutants that keeps FUNCTIONS by reference.
 *
 * JSON.parse(JSON.stringify(...)) looks like the obvious clone and is the wrong one here: it drops the
 * shell-source helpers (the rebuilt cap and lease sentences), so every mutant would have reddened the
 * reading that rebuilds a refusal - an attack that reddens everything proves nothing about anything.
 */
const clone = (value) => {
  if (Array.isArray(value)) return value.map((entry) => clone(entry))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) out[key] = clone(entry)
    return out
  }
  return value
}
const setIn = (object, path, value) => {
  let at = object
  for (const step of path.slice(0, -1)) at = at[step]
  at[path[path.length - 1]] = value
}
/** The first reader call of a phase, so a mutant can corrupt exactly what that reading reads. */
const readerCallAt = (t, phase, index = 0) => {
  const calls = t.readers.calls.filter((call) => call.phase === phase)
  return calls[index]
}

const MUTANTS = [
  {
    name: 'tap-not-transparent',
    declared: ['1-the-tap-is-transparent-and-the-face-is-the-build-that-is-running'],
    what: 'the instrument would be lying: the tap answers something that is not the shell\'s report',
    apply: (t) => setIn(t, ['tap', 'transparency', 'sameBody'], false),
  },
  {
    name: 'shell-source-drifts-from-the-world',
    declared: ['1-the-tap-is-transparent-and-the-face-is-the-build-that-is-running'],
    what: 'the world and the shell\'s own source disagreeing about MAX_TABS (the anchor would be stale)',
    apply: (t) => setIn(t, ['shellSource', 'maxTabs'], 9),
  },
  {
    name: 'plugin-not-pointed-at-the-tap',
    declared: ['1-the-tap-is-transparent-and-the-face-is-the-build-that-is-running'],
    what: 'the code under test would be driving some other origin than this gate\'s tap',
    apply: (t) => setIn(t, ['subject', 'startupLine'], '[dsh-browser] browser tools drive the shell panel at http://127.0.0.1:31761 (the same browser the user sees, tabs and all)'),
  },
  {
    name: 'reader-count-drift',
    declared: ['2-the-tab-set-the-tool-reports-is-the-shells-own-row-for-row'],
    what: 'a reader that reports a number of its own instead of the shell\'s',
    apply: (t) => setIn(t, ['readers', 'calls', 0, 'parsed', 'count'], (readerCallAt(t, 'first')?.parsed?.count ?? 0) + 1),
  },
  {
    name: 'reader-url-drift',
    declared: ['2-the-tab-set-the-tool-reports-is-the-shells-own-row-for-row'],
    what: 'a reader that fills a URL in from somewhere other than the shell\'s report',
    apply: (t) => setIn(t, ['readers', 'calls', 0, 'parsed', 'rows', 0, 'url'], 'https://wrong.example/'),
  },
  {
    name: 'reader-drops-a-row',
    declared: ['2-the-tab-set-the-tool-reports-is-the-shells-own-row-for-row'],
    what: 'a reader that lists fewer tabs than the shell holds',
    apply: (t) => setIn(t, ['readers', 'calls', 0, 'parsed', 'rows'], (readerCallAt(t, 'first')?.parsed?.rows ?? []).slice(0, -1)),
  },
  {
    name: 'reader-cached-the-answer',
    declared: ['3-the-answers-follow-the-shell-and-are-not-a-copy'],
    what: 'a reader that answered from a copy it made on the first call (the world changed under it)',
    apply: (t) => {
      const first = readerCallAt(t, 'first')
      const moved = readerCallAt(t, 'after-shell-moved-that-tabs-url')
      if (moved === undefined) return
      moved.text = first.text
      moved.parsed = clone(first.parsed)
      moved.shellBefore = clone(first.shellBefore)
    },
  },
  {
    name: 'reader-missed-the-new-tab',
    declared: ['3-the-answers-follow-the-shell-and-are-not-a-copy'],
    what: 'the shell made a tab and the reader never showed it',
    apply: (t) => {
      const added = readerCallAt(t, 'after-shell-added-a-tab')
      if (added === undefined) return
      added.parsed.rows = added.parsed.rows.filter((row) => row.id !== t.shellChange.createdByShell)
    },
  },
  {
    name: 'write-without-holder',
    declared: ['4-writes-go-through-the-shells-own-ops-carrying-the-plugins-own-holder'],
    what: 'a write that does not name its holder, so the lease could not tell it apart from an anonymous caller',
    apply: (t) => {
      const at = t.writeOps.findIndex((entry) => entry.status === 200)
      if (at >= 0) setIn(t, ['writeOps', at, 'holder'], null)
    },
  },
  {
    name: 'write-not-the-shells-op',
    declared: ['4-writes-go-through-the-shells-own-ops-carrying-the-plugins-own-holder'],
    what: 'a write that used something other than the shell\'s own tab ops',
    apply: (t) => {
      const at = t.writeOps.findIndex((entry) => entry.status === 200 && entry.op === 'tab-goto')
      if (at >= 0) setIn(t, ['writeOps', at, 'op'], 'cdp-navigate')
    },
  },
  {
    name: 'no-read-back',
    declared: ['4-writes-go-through-the-shells-own-ops-carrying-the-plugins-own-holder'],
    what: 'a write whose answer is the request rather than the shell\'s own read-back',
    apply: (t) => setIn(t, ['readBacks'], 0),
  },
  {
    name: 'tab-id-not-the-shells',
    declared: ['5-opening-a-tab-is-the-shell-opening-it-and-the-shell-names-it'],
    what: 'a tool that invents the new tab\'s id instead of taking the shell\'s answer',
    apply: (t) => setIn(t, ['create', 'created'], 't999'),
  },
  {
    name: 'new-tab-not-active',
    declared: ['5-opening-a-tab-is-the-shell-opening-it-and-the-shell-names-it'],
    what: 'a world where the shell does not make the new tab the active one',
    apply: (t) => setIn(t, ['create', 'shellActiveAfter'], t.userTab),
  },
  {
    name: 'goto-moved-the-users-page',
    declared: ['6-goto-moves-the-tab-it-was-given-and-leaves-the-users-page-alone'],
    what: 'the R184 defect itself: browse and "do not take the user\'s page away" are exclusive again',
    apply: (t) => setIn(t, ['goto', 'userHrefAfter', 'href'], t.urls.B),
  },
  {
    name: 'goto-did-not-move-its-own-tab',
    declared: ['6-goto-moves-the-tab-it-was-given-and-leaves-the-users-page-alone'],
    what: 'a goto that answered success without navigating the tab it was given',
    apply: (t) => setIn(t, ['goto', 'ownHrefAfter', 'href'], t.urls.A),
  },
  {
    name: 'goto-changed-the-active-tab',
    declared: ['6-goto-moves-the-tab-it-was-given-and-leaves-the-users-page-alone'],
    what: 'a navigation that stole the user\'s view by activating another tab',
    apply: (t) => setIn(t, ['goto', 'activeAfter'], t.userTab),
  },
  {
    name: 'goto-used-page-navigate',
    declared: ['6-goto-moves-the-tab-it-was-given-and-leaves-the-users-page-alone'],
    what: 'the pre-R184 transport: Page.navigate on whatever is active',
    apply: (t) => setIn(t, ['goto', 'sentPageNavigate'], true),
  },
  {
    name: 'activate-not-followed',
    declared: ['7-activate-and-close-happen-in-the-shell-including-the-left-neighbour'],
    what: 'a tool that reports success without the shell changing its active tab',
    apply: (t) => setIn(t, ['activate', 'activeAfter'], t.activate.activeBefore),
  },
  {
    name: 'close-fell-to-the-first-tab',
    declared: ['7-activate-and-close-happen-in-the-shell-including-the-left-neighbour'],
    what: 'closing the active tab putting the FIRST tab in front instead of the LEFT neighbour',
    apply: (t) => setIn(t, ['close', 'activeAfter'], t.close.idsBefore[0]),
  },
  {
    name: 'close-did-not-reduce-the-set',
    declared: ['7-activate-and-close-happen-in-the-shell-including-the-left-neighbour'],
    what: 'a close that leaves the tab in the shell\'s set',
    apply: (t) => {
      setIn(t, ['close', 'countAfter'], t.close.countBefore)
      setIn(t, ['close', 'idsAfter'], t.close.idsBefore)
    },
  },
  {
    name: 'cap-refusal-rewritten',
    declared: ['8-the-cap-refusal-is-the-shells-own-sentence-byte-for-byte'],
    what: 'a tool that paraphrases the shell\'s refusal into words of its own',
    apply: (t) => setIn(t, ['cap', 'toolError'], 'too many tabs open; close one'),
  },
  {
    name: 'cap-was-silent',
    declared: ['8-the-cap-refusal-is-the-shells-own-sentence-byte-for-byte'],
    what: 'a shell that answers the fifth tab with a silent success',
    apply: (t) => {
      setIn(t, ['cap', 'toolError'], null)
      setIn(t, ['cap', 'toolOk'], true)
    },
  },
  {
    name: 'cap-wrote-anyway',
    declared: ['8-the-cap-refusal-is-the-shells-own-sentence-byte-for-byte'],
    what: 'a refusal that changed the world it refused to change',
    apply: (t) => setIn(t, ['cap', 'countAfterToolRefusal'], (t.cap.countAtCap ?? 0) + 1),
  },
  {
    name: 'lease-ignored-by-the-tool',
    declared: ['9-without-the-lease-nothing-writes-and-with-it-back-the-same-call-is-accepted'],
    what: 'a tool that writes while somebody else holds the panel (the lease would be advisory)',
    apply: (t) => {
      setIn(t, ['lease', 'refusedWrite', 'ok'], true)
      setIn(t, ['lease', 'refusedWrite', 'error'], null)
      setIn(t, ['lease', 'refusedWrite', 'text'], 'opened tab t99')
    },
  },
  {
    name: 'lease-sentence-paraphrased',
    declared: ['9-without-the-lease-nothing-writes-and-with-it-back-the-same-call-is-accepted'],
    what: 'a tool that translates the shell\'s refusal instead of passing it on',
    apply: (t) => setIn(t, ['lease', 'refusedWrite', 'error'], 'the panel is busy: the placement was refused'),
  },
  {
    name: 'lease-refused-the-control-too',
    declared: ['9-without-the-lease-nothing-writes-and-with-it-back-the-same-call-is-accepted'],
    what: 'a refusal that is not about the lease at all (it refuses even with the panel free)',
    apply: (t) => {
      setIn(t, ['lease', 'acceptedAfterRelease', 'ok'], false)
      setIn(t, ['lease', 'acceptedAfterRelease', 'error'], t.lease.refusedWrite.error)
    },
  },
  {
    name: 'sweep-wrote-through-the-lease',
    declared: ['9-without-the-lease-nothing-writes-and-with-it-back-the-same-call-is-accepted'],
    what: 'a probe whose write was accepted while the gate held the lease',
    apply: (t) => {
      if ((t.lease.sweepWrites ?? []).length > 0) {
        setIn(t, ['lease', 'sweepWrites', 0, 'status'], 200)
        setIn(t, ['lease', 'sweepWrites', 0, 'error'], null)
      } else {
        t.lease.sweepWrites = [{ tool: 'x', shape: 'empty', op: 'tab-close', id: 't1', url: null, holder: null, status: 200, error: null }]
      }
    },
  },
  {
    name: 'a-tab-of-this-gates-own-was-left-behind',
    declared: ['10-the-world-is-handed-back-as-it-was-found'],
    what: 'the residue R181-D measured: a gate leaving its own tab in the world for the next one',
    apply: (t) => setIn(t, ['exit', 'tabs'], [...t.exit.tabs, { id: 't99', url: t.urls.A, live: true, active: false }]),
  },
  {
    name: 'active-tab-not-put-back',
    declared: ['10-the-world-is-handed-back-as-it-was-found'],
    what: 'a gate that leaves the user looking at a different tab than the one it found (in this world there is only one tab to look at, so the shell reports an id that is not the one it was handed)',
    apply: (t) => {
      const other = t.exit.tabs.map((row) => row.id).find((id) => id !== t.entry.active)
      setIn(t, ['exit', 'active'], other ?? 't-not-the-tab-it-found')
    },
  },
  {
    name: 'lease-never-given-back',
    declared: ['10-the-world-is-handed-back-as-it-was-found'],
    what: 'a gate that keeps the panel it borrowed',
    apply: (t) => setIn(t, ['exit', 'lease'], { held: true, holder: t.holder }),
  },
  {
    name: 'control-nothing-changes',
    declared: [],
    what: 'the control: a transcript nobody touched must redden nothing',
    apply: () => {},
  },
]

const selfAttack = (transcript) => {
  const baseline = runJudges(transcript)
  const green = baseline.filter((entry) => entry.ok === true)
  const red = baseline.filter((entry) => entry.ok !== true)
  console.log('')
  console.log('== self-attack: ' + String(MUTANTS.length) + ' mutants over the MEASURED transcript ==')
  console.log('  baseline: ' + String(green.length) + ' green, ' + String(red.length) + ' not green')
  if (red.length > 0) {
    console.log('  the attack does not start: the baseline is not green, and a mutant over a red baseline proves nothing')
    for (const entry of red) console.log('    ' + entry.id + ' -> ' + clip(entry.detail, 200))
    return 1
  }
  const coverage = new Map(READINGS.map((reading) => [reading.id, 0]))
  let problems = 0
  for (const mutant of MUTANTS) {
    const copy = clone(transcript)
    mutant.apply(copy)
    const verdicts = runJudges(copy)
    const observed = verdicts.filter((entry) => entry.ok !== true).map((entry) => entry.id)
    for (const id of mutant.declared) coverage.set(id, (coverage.get(id) ?? 0) + 1)
    const exact = same([...observed].sort(), [...mutant.declared].sort())
    if (exact !== true) problems += 1
    console.log('  ' + (exact ? 'exact ' : 'OFF   ') + pad(mutant.name, 40) + ' declared=' + show(mutant.declared) + ' observed=' + show(observed))
    console.log('        ' + mutant.what)
    if (exact !== true) {
      const unexpected = observed.filter((id) => mutant.declared.includes(id) === false)
      const missed = mutant.declared.filter((id) => observed.includes(id) === false)
      if (unexpected.length > 0) console.log('        UNEXPECTED red: ' + show(unexpected))
      if (missed.length > 0) console.log('        MISSED red: ' + show(missed))
    }
  }
  console.log('  coverage matrix (mutants declaring each reading; every reading needs at least one):')
  let uncovered = 0
  for (const [id, count] of coverage) {
    if (count === 0) uncovered += 1
    console.log('    ' + pad(String(count), 3) + ' ' + id)
  }
  console.log('  declared sets == observed sets for ' + String(MUTANTS.length - problems) + ' of ' + String(MUTANTS.length) + ' mutants; readings with no mutant: ' + String(uncovered))
  return problems === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const printTranscript = (transcript) => {
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell: ' + SHELL_ORIGIN + ' (the client was already running; this gate never starts or stops it)')
  console.log('  client: ' + String(transcript.clientAtEntry ?? '(not read)') + ' at entry, ' + String(transcript.clientAtExit ?? '(not read)') + ' at the end')
  console.log('  subject: ' + MODULE_PATH)
  console.log('  tap: ' + String(transcript.tap.origin) + ' -> ' + SHELL_ORIGIN + ' (panelOrigin, the R184 seam, read from the plugin\'s own startup line)')
  printFingerprint('ENTRY fingerprint (op=state, taken before anything was written):', transcript.entry)
  if (transcript.guard !== null) {
    console.log('  single-run guard: ' + String(transcript.guard.liveFiles.length) + ' live gate file(s) in the register' + (transcript.guard.parseNote === null ? '' : ' (' + String(transcript.guard.parseNote) + ')') + ', node processes running them: ' + String(transcript.guard.others.length) + (transcript.guard.others.length === 0 ? '' : ' -> ' + transcript.guard.others.join(' | ')))
  }
  if (transcript.roles !== null) {
    console.log('  roles: basis=' + String(transcript.roles.basis) + ' readers=' + show(transcript.roles.reader) + ' create=' + String(transcript.roles.create) + ' close=' + String(transcript.roles.close) + ' activate=' + String(transcript.roles.activate) + ' goto=' + String(transcript.roles.goto))
    console.log('         tools declaring a tab parameter: ' + show(transcript.roles.declaredTabTools))
  }
  if (transcript.afterOpen !== undefined && transcript.afterOpen !== null) {
    printFingerprint('fingerprint AFTER this gate opened and placed the panel at ' + show(transcript.rect) + ':', transcript.afterOpen)
    console.log('  the user\'s page for every paired reading below: tab ' + String(transcript.userTab) + (transcript.userTabFromEntry ? ' (the tab that was active when this gate arrived)' : ' (the first tab the shell held; the entry had no active one)'))
  }
  for (const call of transcript.readers.calls) {
    console.log('  reader ' + pad(call.tool, 14) + ' [' + String(call.phase) + '] ' + (call.ok === true ? 'shell: count ' + String(call.shellBefore.count) + ' limit ' + String(call.shellBefore.limit) + ' active ' + String(call.shellBefore.active) + ' -> answer: ' + clip(String(call.text).replace(/\n/g, ' / '), 220) : 'REFUSED ' + clip(String(call.error), 160)))
  }
  if (transcript.shellChange !== null) {
    console.log('  the shell changed BEHIND the plugin (this gate\'s own writes, holder ' + transcript.holder + '): created ' + String(transcript.shellChange.createdByShell) + ', then moved its url to ' + String(transcript.urls.tmpMoved) + ' -> shell rows now ' + show(transcript.shellChange.rowsAfterMove.map((row) => row.id)))
  }
  console.log('  lease-held phase (the shell refuses every write while this gate holds ' + transcript.holder + '):')
  console.log('    the tool\'s write: ' + (transcript.lease.refusedWrite?.ok === true ? 'ACCEPTED' : 'refused') + ' -> ' + clip(String(transcript.lease.refusedWrite?.error ?? transcript.lease.refusedWrite?.text), 200))
  console.log('    the shell, asked directly under the foreign holder ' + FOREIGN_HOLDER + ': ' + clip(String(transcript.lease.foreignWrite?.error), 200))
  console.log('    the probe sweep: ' + String(transcript.probes.length) + ' call(s), ' + String((transcript.lease.sweepWrites ?? []).length) + ' write attempt(s), all refused by name: ' + String((transcript.lease.sweepWrites ?? []).every((write) => write.status === 400 && String(write.error).includes('leased by'))))
  console.log('    tab set before/after the lease-held phase: ' + show(transcript.lease.stateBefore?.tabs?.map(rowKey) ?? null) + ' -> ' + show(transcript.lease.sweptState?.tabs?.map(rowKey) ?? null))
  if (transcript.create !== null) {
    console.log('  browser_tab_new -> the shell created ' + String(transcript.create.created) + ' (set before: ' + show(transcript.create.shellIdsBefore) + '), active now ' + String(transcript.create.shellActiveAfter) + ', that tab\'s own renderer: ' + show(transcript.create.document))
  }
  if (transcript.goto !== null) {
    console.log('  browser_goto { tab: ' + String(transcript.goto.ownTab) + ' } -> ops sent ' + show(transcript.goto.ops.map((op) => [op.op ?? op.method, op.id, op.tab === null ? '(no tab field)' : op.tab])))
    console.log('    paired readings, each read INSIDE its own tab:')
    console.log('      this gate\'s own tab ' + String(transcript.goto.ownTab) + ': ' + String(transcript.goto.ownHrefBefore.href ?? '(unread)') + ' -> ' + String(transcript.goto.ownHrefAfter.href ?? '(unread)'))
    console.log('      the USER\'S tab ' + String(transcript.goto.userTab) + ': ' + String(transcript.goto.userHrefBefore.href ?? '(unread)') + ' -> ' + String(transcript.goto.userHrefAfter.href ?? '(unread)') + ' (shell record ' + show(transcript.goto.userRowBefore) + ' -> ' + show(transcript.goto.userRowAfter) + ')')
    if (transcript.gotoDefault !== null) console.log('      paired control (no tab named, active is ' + String(transcript.gotoDefault.activeBefore) + '): ops ' + show(transcript.gotoDefault.ops.map((op) => [op.op ?? op.method, op.id])) + ' -> own tab now ' + String(transcript.gotoDefault.ownHref.href ?? '(unread)') + ', the user\'s tab ' + String(transcript.gotoDefault.userHref.href ?? '(unread)'))
  }
  if (transcript.activate !== null) console.log('  browser_tab_activate ' + String(transcript.activate.askedFor) + ': shell active ' + String(transcript.activate.activeBefore) + ' -> ' + String(transcript.activate.activeAfter) + ' (' + clip(String(transcript.activate.text ?? transcript.activate.error).replace(/\n/g, ' / '), 160) + ')')
  if (transcript.close !== null) console.log('  browser_tab_close ' + String(transcript.close.closed) + ': set ' + show(transcript.close.idsBefore) + ' -> ' + show(transcript.close.idsAfter) + ', count ' + String(transcript.close.countBefore) + ' -> ' + String(transcript.close.countAfter) + ', active ' + String(transcript.close.activeBefore) + ' -> ' + String(transcript.close.activeAfter) + ' (left neighbour ' + String(transcript.close.expectedNeighbour) + ')')
  if (transcript.cap !== null) {
    if (transcript.cap.reached === true) {
      console.log('  the cap: ' + String(transcript.cap.countAtCap) + '/' + String(transcript.cap.limit) + ' tabs, ids ' + show(transcript.cap.idsAtCap))
      console.log('    the tool\'s refusal: ' + show(transcript.cap.toolError))
      console.log('    the shell\'s own, asked directly: ' + show(transcript.cap.directError))
      console.log('    set after both refusals: ' + show(transcript.cap.idsAfterToolRefusal) + ' / ' + show(transcript.cap.idsAfterDirectRefusal))
    } else {
      console.log('  the cap: NOT REACHED (count ' + String(transcript.cap.count) + ' of ' + String(transcript.cap.limit) + '), attempts: ' + show(transcript.cap.attempts))
    }
  }
  console.log('  accepted tab writes the tap saw (op / id / url / holder / status):')
  for (const write of (transcript.writeOps ?? []).filter((entry) => entry.status === 200)) {
    console.log('    ' + pad(write.op, 14) + pad(String(write.id ?? '-'), 6) + pad(String(write.url ?? '-'), 52) + pad(String(write.holder), 14) + String(write.status))
  }
  console.log('  write attempts the shell refused:')
  for (const write of (transcript.writeOps ?? []).filter((entry) => entry.status !== 200)) {
    console.log('    ' + pad(write.op, 14) + pad(String(write.id ?? '-'), 6) + pad(write.holder === null ? 'NO HOLDER' : String(write.holder), 14) + String(write.status) + '  ' + clip(String(write.error), 120))
  }
  if (transcript.restore !== null) {
    console.log('  handed back: ' + String(transcript.restore.closedTabs.length) + ' tab(s) this gate opened closed (' + show(transcript.restore.closedTabs) + '), active restored ' + show(transcript.restore.activated) + ', panel closed again ' + String(transcript.restore.closedPanel) + ', lease released ' + String(transcript.restore.leaseReleased))
  }
  printFingerprint('RETURNED fingerprint (op=state, after the finally block):', transcript.exit ?? { exists: null, mounted: null, count: null, limit: null, active: null, tabs: [], viewport: null, mode: null, lease: null })
  for (const note of transcript.notes) console.log('  ' + note)
  for (const problem of transcript.problems) console.log('  PROBLEM ' + problem)
}

const main = async () => {
  console.log('gate 114 browser-tabs-live - the AI\'s tab hand, in the real shell (port ' + String(PORT) + ')')
  console.log('  no pixels, no geometry: this gate reads op=state, the shell\'s own CDP op for a tab\'s document, and its own tap')
  const source = readShellSource()
  // A world this gate cannot measure is a named third state, not a crash and never a green: the reason is
  // printed as the SKIP line the suite's runner looks for, and the exit code is 3.
  let transcript = null
  try {
    transcript = await runWorld()
  } catch (error) {
    if (error instanceof NotMeasured) {
      console.log('')
      console.log('SKIP: ' + error.message)
      console.log('browser-tabs-live: 0 readings, 0 failed, 0 measured - this gate declined to measure [exit 3]')
      return 3
    }
    console.log('')
    console.log('SKIP: the gate could not run at all: ' + describe(error))
    console.log(String(error?.stack ?? '').split('\n').slice(0, 5).join('\n'))
    return 3
  }
  transcript.shellSource = source
  if (transcript.problems.length > 0) {
    console.log('')
    console.log('== the drive did not complete ==')
    for (const problem of transcript.problems) console.log('  ' + problem)
    for (const note of transcript.notes) console.log('  ' + note)
    console.log('browser-tabs-live: the world could not be driven to the end, so nothing was judged (exit 3)')
    return 3
  }
  // The printout is evidence, never a verdict: a bug in it must not decide what this gate says. (It did
  // once: when the client was killed mid-run, the transcript was half-filled and the printer threw on a
  // field the drive never reached, turning "not measured" into an uncaught TypeError and exit 1.)
  try {
    printTranscript(transcript)
  } catch (error) {
    console.log('  (the printout of the measured transcript failed: ' + describe(error) + ' - the readings below are unaffected)')
  }
  const verdicts = runJudges(transcript)
  console.log('')
  console.log('== readings ==')
  for (const verdict of verdicts) {
    const mark = verdict.ok === true ? 'ok   ' : verdict.notMeasured === true ? 'n/a  ' : 'FAIL '
    console.log('  ' + mark + verdict.id)
    console.log('        ' + verdict.detail)
  }
  const failed = verdicts.filter((verdict) => verdict.ok !== true && verdict.notMeasured !== true)
  const notMeasured = verdicts.filter((verdict) => verdict.notMeasured === true)
  const held = verdicts.filter((verdict) => verdict.ok === true)
  // Declared BEFORE the verdicts are acted on: a 'const' read from above its own line is a ReferenceError,
  // not a false - and a third-state check that throws is worse than no check at all (it did, once, in the
  // self-attack branch: the baseline was not green for a collision, and the gate died instead of saying so).
  const stopped = transcript.notes.filter((note) => note.startsWith('NOT MEASURED in the world'))
  console.log('')
  if (SELF_ATTACK === true) {
    if (stopped.length > 0 || failed.length > 0 || notMeasured.length > 0) {
      console.log('browser-tabs-live: ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured - the self-attack does not start on a baseline that is not green and measured')
      return 1
    }
    const attack = selfAttack(transcript)
    console.log('browser-tabs-live --self-attack: ' + String(MUTANTS.length) + ' mutants, ' + (attack === 0 ? 'every declared set == observed set' : 'SOME MUTANTS DID NOT LAND WHERE DECLARED'))
    return attack === 0 ? 0 : 1
  }
  console.log('browser-tabs-live: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured [live shell at ' + SHELL_ORIGIN + ']')
  // A drive that stopped half way is a third state even if the readings it did reach came out green: what
  // was never measured must not be read as a pass.
  
  // A drive that stopped early is the THIRD state, and it is checked FIRST: when the world was taken away
  // mid-run (the client was killed under this gate once, and another consumer took the panel another time),
  // half-filled readings look red for a reason that is not the product's, and reporting that as a failure
  // would be a false red.
  if (stopped.length > 0) {
    for (const note of stopped) console.log('SKIP: ' + note)
    return 3
  }
  if (failed.length > 0) return 1
  if (notMeasured.length > 0) {
    for (const note of stopped) console.log('SKIP: ' + note)
    for (const verdict of notMeasured) console.log('SKIP: ' + verdict.id + ' -> ' + clip(verdict.detail, 200))
    return 3
  }
  return 0
}

process.exitCode = await main()
