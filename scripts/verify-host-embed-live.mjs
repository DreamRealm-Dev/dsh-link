#!/usr/bin/env node
/**
 * Gate 132 (R195) - host-embed-live: THE EMBED PAGE DRIVEN IN THE RUNNING SHELL, IN A NEW TAB OF ITS OWN.
 *
 * Subject: GET /api/dsh-link-host/embed on the live shell origin (127.0.0.1:31761, which the shell proxy
 * carries to the kernel on 127.0.0.1:31760), reached over CDP (9222) against the webview the client
 * already runs. The requirement is docs/handoff/R195-contract.md section 2 P3.
 *
 * THE WORLD IS NOT THIS GATE'S TO REBUILD. The client and the kernel are already running; this gate never
 * starts, stops or restarts either of them. It takes the SINGLE-RUN LEASE the other live gates take
 * (POST /__shell/panel leaseOp=claim, scripts/panel-lease.mjs), so a second live consumer cannot drive the
 * same client at the same time; if the lease is busy it retries for three minutes and then exits 3 naming
 * the holder. It opens the page in a NEW TAB - the world entry tab is never navigated (the gate records
 * every CDP method it sends to each target, and Page.navigate is only ever sent to the new tab) - and it
 * closes that tab again, then proves the world is back: the same target set, the entry tab at the same
 * URL, title, readyState and navigation-history position with no embed global in it, the lease released,
 * and the client/kernel pids identical.
 *
 * READINGS (each independently failable, printed with the raw numbers it was taken from):
 *   01 THE WORLD IS FIT, THE SURFACE IS LIVE, AND THIS GATE HOLDS THE SINGLE-RUN LEASE. CDP answers, the
 *      world entry tab is identified, the contract answers 200 with both modes, the frozen message type
 *      and a named unknown-mode refusal, the embed route answers 200 text/html, the panel API answers
 *      op=state, the lease is claimed under this gate own holder, and the client/kernel pids are read.
 *   02 THE PAGE LOADED IN A NEW TAB, NOT IN THE WORLD ENTRY TAB. A second page target appears (entry
 *      count + 1), its id differs from the entry tab, the document at that target is the embed URL with
 *      ?mode=sidebar and is complete with the panel element, and Page.navigate was sent to the new tab
 *      ONLY - the entry tab received no navigation and its URL is unchanged while the tab is open.
 *   03 SIDEBAR MODE AT LOAD: the mode attribute reads sidebar on the html element, the body and the panel;
 *      the panel is the contract default width x the viewport height, strictly narrower than the viewport;
 *      the geometry mirror and the __DSH_LINK_EMBED__ record agree; the source is the URL; nothing is
 *      refused. A URL-only host needs nothing else, and nothing was posted yet.
 *   04 POSTING full THROUGH Runtime.evaluate GREW THE PANEL TO THE VIEWPORT: the posted message is the
 *      contract message type, the page answers mode full, the panel width becomes the viewport width and
 *      the height the viewport height, the growth in px is printed, and the page own accepted counter
 *      moved by one.
 *   05 POSTING sidebar RETURNED THE PANEL TO THE SIDEBAR RECT: mode sidebar again, width and height back
 *      to reading 03 within a css pixel, still narrower than the viewport, accepted counter +1.
 *   06 AN UNKNOWN MODE IS REFUSED BY NAME AND THE LAST GOOD MODE STAYED: after posting a mode nobody
 *      defines, the document-level refusal attribute names an all-caps code (the code the contract
 *      publishes), the refusal echoes the value that was refused, the mode attribute still reads sidebar,
 *      the geometry is exactly reading 05, and the page own counters say one refusal, no acceptance.
 *   07 THE TAB WAS CLOSED AND THE WORLD IS BACK: the target set is the entry set again, the entry tab
 *      keeps its URL, title, readyState and navigation-history position and still carries no embed global,
 *      the lease is released, the client and kernel pids are identical to entry, and both routes still
 *      answer 200.
 *
 * --replay <file> re-judges a transcript this gate wrote and touches nothing (no CDP read, no tab, no
 * lease); --replay with no file re-judges the newest transcript under the scratch path. The transcript is
 * written to .tmp/r195-g132/<stamp>/host-embed-live.json and is the only file this gate writes.
 *
 * WHAT THIS GATE CANNOT JUDGE, named so nobody reads a green as more than it is: whether a HOST
 * application can create a child webview and carry this page (that is P4's recipe and the CEF/verso
 * findings), whether the page is legible (no pixel is read here), whether the panel lease would be
 * honoured by a host that does not take it, and whether the two routes survive a client restart (this
 * gate measures the world it found).
 *
 * Exit 0 every reading held | 1 a reading failed | 3 a reading could not be measured: the world is not
 * fit (CDP or the shell panel API does not answer, no entry tab, no pid fingerprint), the embed surface is
 * not live on this shell, the lease stayed busy for three minutes (the holder is named), a tab could not
 * be opened or closed, or a transcript to replay is missing/unreadable. A reading that cannot be measured
 * is never green.
 *
 * Usage: node scripts/verify-host-embed-live.mjs [--port 31761] [--kernel-port 31760] [--cdp 9222]
 *          [--replay [file]] [--deadline-ms 180000] [--scratch <dir>]
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { claimLease, panelPost, releaseLease } from './panel-lease.mjs'

/** The project root: found by walking up to the tree that owns the kernel and the plugins. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'core', 'deepseek-harness', 'package.json')) && existsSync(join(at, 'plugins'))) return at
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
  if (at === -1) return fallback
  const next = argv[at + 1]
  return next === undefined || next.startsWith('--') ? fallback : next
}
const PORT = Number(option('--port', '31761'))
const KERNEL_PORT = Number(option('--kernel-port', '31760'))
const CDP_PORT = Number(option('--cdp', '9222'))
const DEADLINE_MS = Number(option('--deadline-ms', '180000'))
const POLL_MS = 3000
const REPLAY = has('--replay') ? (option('--replay', null) ?? 'latest') : null
const SCRATCH = resolve(option('--scratch', join(PROJECT, '.tmp', 'r195-g132')))
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)
const KERNEL_ORIGIN = 'http://127.0.0.1:' + String(KERNEL_PORT)
const CDP_ORIGIN = 'http://127.0.0.1:' + String(CDP_PORT)

// ---------------------------------------------------------------------------
// The frozen interface (R195-contract section 2): no expectation is read out of the live answer first.
// ---------------------------------------------------------------------------
const CONTRACT_PATH = '/api/dsh-link-host/contract'
const EMBED_PATH = '/api/dsh-link-host/embed'
const MODES = ['sidebar', 'full']
const DEFAULT_MODE = 'sidebar'
const MESSAGE_TYPE = 'dsh-link:mode'
const UNKNOWN_MODE = 'gigantic-' + randomUUID().replace(/-/gu, '').slice(0, 8)
const GATE_HOLDER = 'gate-132-host-embed-live'
const SCHEMA = 'r195-g132-transcript/1'
const TOLERANCE_PX = 1
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/
const NAMED_CODE = /^[A-Z][A-Z0-9_]*$/
/** The seven readings this gate publishes, in the order they are judged. */
const READING_IDS = [
  '01-the-world-is-fit-and-this-gate-holds-the-single-run-lease',
  '02-the-page-loaded-in-a-new-tab-not-in-the-world-entry-tab',
  '03-sidebar-mode-at-load',
  '04-posting-full-grew-the-panel-to-the-viewport',
  '05-posting-sidebar-returned-the-panel-to-the-sidebar-rect',
  '06-an-unknown-mode-is-refused-by-name-and-the-last-good-mode-stayed',
  '07-the-tab-was-closed-and-the-world-is-back',
]

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const clip = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }
const NOT_MEASURED = (why) => { console.log(''); console.log('SKIP (not measured): ' + why); return 3 }

// ---------------------------------------------------------------------------
// Local process reads: the pid fingerprint. This gate reads the machine; it does not assume it.
// ---------------------------------------------------------------------------
const pwsh = (command, timeout = 30000) => {
  const done = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout, windowsHide: true })
  if (done.error !== undefined && done.error !== null) return { status: null, stdout: '', stderr: String(done.error.message ?? done.error), why: describe(done.error) }
  return { status: done.status, stdout: String(done.stdout ?? ''), stderr: String(done.stderr ?? '') }
}
/** The pid fingerprint: which process listens on the shell port and on the kernel port, and when it started. */
const pidFingerprint = () => {
  const query = [
    '$out = @()',
    'foreach ($port in @(' + String(PORT) + ',' + String(KERNEL_PORT) + ')) {',
    '  $row = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1',
    '  if ($row -eq $null) { $out += ($port.ToString() + "|||") ; continue }',
    '  $proc = Get-Process -Id $row.OwningProcess -ErrorAction SilentlyContinue',
    '  $name = ""; $start = ""',
    '  if ($proc -ne $null) { $name = $proc.ProcessName; $start = $proc.StartTime.ToUniversalTime().ToString("o") }',
    '  $out += ($port.ToString() + "|" + $row.OwningProcess.ToString() + "|" + $name + "|" + $start)',
    '}',
    '$out -join ([string][char]10)',
  ].join('\n')
  const done = pwsh(query)
  if (done.status !== 0) return { ok: false, why: clip(String(done.stderr ?? done.why ?? 'pwsh exited ' + String(done.status)), 240), rows: [] }
  const rows = String(done.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '').map((line) => {
    const [port, pid, name, start] = line.split('|')
    return { port: Number(port), pid: pid === '' ? null : Number(pid), name: name === '' ? null : name, start: start === '' ? null : start }
  })
  return { ok: true, why: null, rows }
}
const pidRows = (fingerprint) => {
  const rows = fingerprint !== null && fingerprint.ok === true && Array.isArray(fingerprint.rows) ? fingerprint.rows : []
  return { rows, client: rows.find((row) => row.port === PORT) ?? null, kernel: rows.find((row) => row.port === KERNEL_PORT) ?? null }
}
const pidText = (row) => (row === null || row === undefined || row.pid === null ? '(not read)' : 'pid ' + String(row.pid) + ' ' + String(row.name) + ' since ' + String(row.start))

// ---------------------------------------------------------------------------
// The live reads: plain HTTP to the shell, and CDP to the webview that runs it.
// ---------------------------------------------------------------------------
const httpGet = async (url, timeoutMs = 12000) => {
  try {
    const answer = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const text = await answer.text()
    return { ok: answer.status === 200, status: answer.status, type: answer.headers.get('content-type'), text, bytes: Buffer.byteLength(text, 'utf8'), why: answer.status === 200 ? null : 'HTTP ' + String(answer.status) }
  } catch (error) {
    return { ok: false, status: null, type: null, text: '', bytes: 0, why: describe(error) }
  }
}
const httpPut = async (url, timeoutMs = 12000) => {
  try {
    const answer = await fetch(url, { method: 'PUT', signal: AbortSignal.timeout(timeoutMs) })
    const text = await answer.text()
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text, why: answer.status >= 200 && answer.status < 300 ? null : 'HTTP ' + String(answer.status) }
  } catch (error) {
    return { ok: false, status: null, text: '', why: describe(error) }
  }
}
/** Every page target CDP knows, as this gate reads it. */
const cdpPages = async () => {
  const answer = await httpGet(CDP_ORIGIN + '/json/list', 8000)
  if (answer.ok !== true) return { ok: false, why: 'CDP ' + String(CDP_PORT) + ' did not answer /json/list (' + String(answer.why) + ')', pages: [] }
  let targets = null
  try { targets = JSON.parse(answer.text) } catch (error) { return { ok: false, why: 'CDP /json/list answered something that is not JSON (' + describe(error) + ')', pages: [] } }
  const pages = (Array.isArray(targets) ? targets : []).filter((target) => target?.type === 'page').map((target) => ({ id: String(target.id), url: String(target.url), title: String(target.title ?? ''), ws: String(target.webSocketDebuggerUrl ?? '') }))
  return { ok: true, why: null, pages }
}
const targetSet = (pages) => pages.map((page) => page.id + '|' + page.url).sort()
const isShellPage = (page) => page.url === SHELL_ORIGIN || page.url === SHELL_ORIGIN + '/' || page.url.startsWith(SHELL_ORIGIN + '/')

/** One CDP session over the target own websocket. Every method sent is recorded, so "never navigated" is a fact. */
const connectCdp = async (wsUrl, label) => {
  const socket = new WebSocket(wsUrl)
  const opened = await new Promise((settle) => {
    socket.addEventListener('open', () => settle(true), { once: true })
    socket.addEventListener('error', () => settle(false), { once: true })
    setTimeout(() => settle(false), 12000)
  })
  if (opened !== true) { try { socket.close() } catch { /* the OS reaps it */ } return { ok: false, why: 'the CDP socket of the ' + label + ' did not open' } }
  let nextId = 1
  const pending = new Map()
  const methods = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const settle = pending.get(message.id)
    if (settle !== undefined) { pending.delete(message.id); settle(message) }
  })
  const send = async (method, params, timeoutMs = 12000) => {
    const id = nextId
    nextId += 1
    methods.push(method)
    const answer = await new Promise((settle) => {
      pending.set(id, settle)
      socket.send(JSON.stringify({ id, method, params: params === undefined ? {} : params }))
      setTimeout(() => settle(null), timeoutMs)
    })
    if (answer === null) return { ok: false, why: method + ' never answered', result: null }
    if (answer.error !== undefined) return { ok: false, why: method + ' answered an error: ' + clip(describe(answer.error.message ?? answer.error), 200), result: null }
    return { ok: true, why: null, result: answer.result }
  }
  const evaluate = async (expression, timeoutMs = 12000) => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs)
    if (answer.ok !== true) return { ok: false, why: answer.why, value: null }
    const details = answer.result?.exceptionDetails ?? null
    const exception = details === null ? null : String(details.exception?.description ?? details.text ?? 'exception')
    if (exception !== null) return { ok: false, why: 'the evaluation threw: ' + clip(exception, 240), value: null }
    return { ok: true, why: null, value: answer.result?.result?.value }
  }
  const close = () => { try { socket.close() } catch { /* the OS reaps it */ } }
  return { ok: true, why: null, send, evaluate, close, methods, label }
}

/** What the page itself states, read in one evaluation: the attributes, the measured geometry and the record. */
const READ_EXPRESSION = [
  '(() => {',
  '  const panel = document.getElementById("panel")',
  '  const record = window.__DSH_LINK_EMBED__ === undefined ? null : window.__DSH_LINK_EMBED__',
  '  return JSON.stringify({',
  '    href: String(location.href),',
  '    readyState: String(document.readyState),',
  '    hasPanel: panel !== null,',
  '    mode: { html: document.documentElement.getAttribute("data-dsh-link-mode"), body: document.body === null ? null : document.body.getAttribute("data-dsh-link-mode"), panel: panel === null ? null : panel.getAttribute("data-dsh-link-mode") },',
  '    width: panel === null ? null : panel.offsetWidth,',
  '    height: panel === null ? null : panel.offsetHeight,',
  '    innerWidth: window.innerWidth,',
  '    innerHeight: window.innerHeight,',
  '    mirror: { width: document.documentElement.getAttribute("data-dsh-link-panel-width"), height: document.documentElement.getAttribute("data-dsh-link-panel-height") },',
  '    refusal: document.documentElement.getAttribute("data-dsh-link-refusal"),',
  '    embedded: document.documentElement.getAttribute("data-dsh-link-embedded"),',
  '    frameIsSelf: window.parent === window,',
  '    globals: { mode: window.__DSH_LINK_MODE === undefined ? null : window.__DSH_LINK_MODE, embedded: window.__DSH_LINK_EMBEDDED === undefined ? null : window.__DSH_LINK_EMBEDDED },',
  '    record: record === null ? null : { version: record.version, mode: record.mode, width: record.width, height: record.height, source: record.source, frame: record.frame, accepted: record.accepted, ignored: record.ignored, refused: record.refused, refusals: record.refusals, last: record.last },',
  '    factMode: (document.getElementById("fact-mode") || {}).textContent || null,',
  '    factGeometry: (document.getElementById("fact-geometry") || {}).textContent || null,',
  '    factLast: (document.getElementById("fact-last") || {}).textContent || null,',
  '    badge: (document.getElementById("mode-badge") || {}).textContent || null',
  '  })',
  '})()',
].join('\n')
const readPageState = async (session) => {
  const answer = await session.evaluate(READ_EXPRESSION)
  if (answer.ok !== true) return { ok: false, why: answer.why, state: null }
  let state = null
  try { state = JSON.parse(String(answer.value)) } catch (error) { return { ok: false, why: 'the page state did not parse (' + describe(error) + ')', state: null } }
  return { ok: true, why: null, state }
}
/** The one way this gate changes a mode: the contract own message, posted into the page own window. */
const postMode = async (session, mode) => {
  const expression = [
    '(async () => {',
    '  window.postMessage({ type: ' + JSON.stringify(MESSAGE_TYPE) + ', mode: ' + JSON.stringify(String(mode)) + ' }, "*")',
    '  await new Promise((done) => setTimeout(done, 240))',
    '  return "posted"',
    '})()',
  ].join('\n')
  const answer = await session.evaluate(expression)
  return { ok: answer.ok === true, why: answer.ok === true ? null : answer.why }
}
/** The world entry tab fingerprint: where it is, what it says, and how far its navigation history has gone. */
const entryFingerprint = async (page) => {
  const session = await connectCdp(page.ws, 'world entry tab')
  if (session.ok !== true) return { ok: false, why: session.why, methods: [], href: null, title: null, readyState: null, embedGlobal: null, modeGlobal: null, history: null }
  try {
    await session.send('Page.enable', {})
    const history = await session.send('Page.getNavigationHistory', {})
    const stated = await session.evaluate('JSON.stringify({ href: String(location.href), title: String(document.title), ready: String(document.readyState), embedGlobal: typeof window.__DSH_LINK_MODE, modeGlobal: typeof window.__DSH_LINK_EMBED__ })')
    let value = null
    try { value = stated.ok === true ? JSON.parse(String(stated.value)) : null } catch { value = null }
    const rows = history.ok === true && Array.isArray(history.result?.entries) ? history.result.entries : null
    return {
      ok: stated.ok === true,
      why: stated.ok === true ? null : stated.why,
      methods: session.methods.slice(),
      href: value === null ? null : value.href,
      title: value === null ? null : value.title,
      readyState: value === null ? null : value.ready,
      embedGlobal: value === null ? null : value.embedGlobal,
      modeGlobal: value === null ? null : value.modeGlobal,
      history: rows === null ? null : { entries: rows.length, currentIndex: history.result?.currentIndex ?? null, last: String(rows[rows.length - 1]?.url ?? '') },
    }
  } finally {
    session.close()
  }
}

// ---------------------------------------------------------------------------
// The transcript this gate judges (and --replay re-judges): only what was measured, never a claim.
// ---------------------------------------------------------------------------
const transcript = {
  schema: SCHEMA,
  gate: 'host-embed-live',
  startedAt: new Date().toISOString(),
  shellOrigin: SHELL_ORIGIN,
  kernelOrigin: KERNEL_ORIGIN,
  cdpPort: CDP_PORT,
  port: PORT,
  kernelPort: KERNEL_PORT,
  embedPath: EMBED_PATH,
  contractPath: CONTRACT_PATH,
  messageType: MESSAGE_TYPE,
  unknownMode: UNKNOWN_MODE,
  holder: GATE_HOLDER,
  world: { entry: null, exit: null },
  contract: { status: null, bytes: null, version: null, modes: null, defaultMode: null, messageType: null, refusalCode: null, sidebarWidthDefault: null, embedPath: null },
  page: { status: null, type: null, bytes: null },
  lease: { claimed: null, refusedDetail: null, entryHolder: null, exit: null, released: null, waitMs: null, attempts: 0 },
  tab: { created: null, duringCount: null, entryCount: null, navigate: null, loaded: null, closed: null },
  reads: { sidebar: null, full: null, sidebarAgain: null, unknown: null },
  posts: { full: null, sidebar: null, unknown: null },
  entryTab: { before: null, after: null },
  newTabMethods: [],
  exitContractStatus: null,
  problems: [],
}

const readContract = async () => {
  const answer = await httpGet(SHELL_ORIGIN + CONTRACT_PATH)
  transcript.contract.status = answer.status
  transcript.contract.bytes = answer.bytes
  if (answer.ok !== true) return { ok: false, why: 'GET ' + CONTRACT_PATH + ' on ' + SHELL_ORIGIN + ' answered ' + String(answer.status) + ' (' + String(answer.why) + ')' }
  let body = null
  try { body = JSON.parse(answer.text) } catch (error) { return { ok: false, why: 'the contract is not JSON (' + describe(error) + ')' } }
  const params = Array.isArray(body?.queryParameters) ? body.queryParameters : []
  const width = params.find((row) => row?.name === 'sidebarWidth') ?? null
  transcript.contract.version = typeof body?.version === 'string' ? body.version : null
  transcript.contract.modes = Array.isArray(body?.modes) ? body.modes : null
  transcript.contract.defaultMode = body?.defaultMode ?? null
  transcript.contract.messageType = body?.select?.postMessage?.type ?? null
  transcript.contract.refusalCode = body?.select?.postMessage?.refused ?? null
  transcript.contract.sidebarWidthDefault = typeof width?.default === 'number' ? width.default : null
  transcript.contract.embedPath = body?.embedPath ?? null
  return { ok: true, why: null, body }
}

/** Take the single-run lease, waiting up to the deadline for another consumer to let go. */
const takeLease = async () => {
  const started = Date.now()
  const quiet = async (fn) => {
    const real = console.log
    const lines = []
    console.log = (line) => { lines.push(String(line)) }
    try { return { value: await fn(), lines } } finally { console.log = real }
  }
  for (;;) {
    transcript.lease.attempts += 1
    const attempt = await quiet(() => claimLease(PORT, GATE_HOLDER, 180000))
    if (attempt.value === true) {
      transcript.lease.claimed = true
      transcript.lease.waitMs = Date.now() - started
      return { ok: true, why: null }
    }
    const panelState = await panelPost(PORT, { op: 'state' })
    const holder = panelState?.lease?.holder ?? null
    transcript.lease.entryHolder = holder
    transcript.lease.refusedDetail = clip(String((attempt.lines ?? []).slice(-1)[0] ?? (panelState === null ? 'the panel API did not answer' : 'lease held by ' + String(holder))).trim(), 240)
    if (Date.now() - started >= DEADLINE_MS) {
      transcript.lease.claimed = false
      transcript.lease.waitMs = Date.now() - started
      return { ok: false, why: 'the single-run lease stayed busy for ' + String(Math.round((Date.now() - started) / 1000)) + 's: it is held by ' + show(holder) + ', and this gate does not take it from anybody' }
    }
    await sleep(POLL_MS)
  }
}

const runWorld = async () => {
  // --- the world before anything is touched -------------------------------------------------------
  const entryPages = await cdpPages()
  if (entryPages.ok !== true) throw new Error('the world is not fit: ' + entryPages.why)
  const entryTab = entryPages.pages.find(isShellPage) ?? null
  if (entryTab === null) throw new Error('the world is not fit: CDP ' + String(CDP_PORT) + ' has no page target on ' + SHELL_ORIGIN + ' (targets: ' + show(entryPages.pages.map((page) => page.url)) + ')')
  const entryPids = pidFingerprint()
  const pidsAtEntry = pidRows(entryPids)
  if (pidsAtEntry.client === null || pidsAtEntry.client.pid === null || pidsAtEntry.kernel === null || pidsAtEntry.kernel.pid === null) {
    throw new Error('the world is not fit: the client/kernel pid fingerprint could not be read (' + String(entryPids.why ?? 'no listener on ' + String(PORT) + ' or ' + String(KERNEL_PORT)) + ')')
  }
  const panelState = await panelPost(PORT, { op: 'state' })
  if (panelState === null) throw new Error('the world is not fit: the shell panel API did not answer op=state on ' + SHELL_ORIGIN + ', so the single-run lease cannot be held')
  const contract = await readContract()
  if (contract.ok !== true) throw new Error('the embed surface is not live on this shell: ' + contract.why)
  const pageAnswer = await httpGet(SHELL_ORIGIN + EMBED_PATH)
  transcript.page = { status: pageAnswer.status, type: pageAnswer.type, bytes: pageAnswer.bytes }
  if (pageAnswer.ok !== true) throw new Error('the embed surface is not live on this shell: GET ' + EMBED_PATH + ' answered ' + String(pageAnswer.status) + ' (' + String(pageAnswer.why) + ')')
  transcript.world.entry = {
    at: new Date().toISOString(),
    pages: entryPages.pages,
    entryTab,
    pids: { ok: entryPids.ok, why: entryPids.why, rows: pidsAtEntry.rows },
    lease: { held: panelState?.lease?.held === true, holder: panelState?.lease?.holder ?? null },
  }
  transcript.entryTab.before = await entryFingerprint(entryTab)
  transcript.tab.entryCount = entryPages.pages.length

  // --- the lease ----------------------------------------------------------------------------------
  const lease = await takeLease()
  if (lease.ok !== true) throw new Error(lease.why)

  // --- a NEW tab, navigated by this gate; the entry tab is never navigated -------------------------
  const created = await httpPut(CDP_ORIGIN + '/json/new?url=' + encodeURIComponent('about:blank'))
  if (created.ok !== true) throw new Error('a new tab could not be opened over CDP (/json/new answered ' + String(created.status) + ': ' + String(created.why) + ')')
  let createdTarget = null
  try { createdTarget = JSON.parse(created.text) } catch { createdTarget = null }
  const createdId = createdTarget?.id === undefined ? null : String(createdTarget.id)
  if (createdId === null) throw new Error('CDP /json/new answered without a target id (' + clip(created.text, 200) + ')')
  transcript.tab.created = { id: createdId, url: String(createdTarget?.url ?? ''), sameAsEntry: createdId === entryTab.id }
  const afterCreate = await cdpPages()
  const duringPage = afterCreate.ok === true ? afterCreate.pages.find((page) => page.id === createdId) ?? null : null
  transcript.tab.duringCount = afterCreate.ok === true ? afterCreate.pages.length : null
  if (duringPage === null) throw new Error('the new tab (' + createdId + ') never appeared as a CDP page target')
  const session = await connectCdp(duringPage.ws, 'new tab')
  if (session.ok !== true) throw new Error('the new tab could not be driven over CDP: ' + session.why)
  try {
    const navigate = await session.send('Page.navigate', { url: SHELL_ORIGIN + EMBED_PATH + '?mode=' + DEFAULT_MODE })
    transcript.tab.navigate = { ok: navigate.ok === true, why: navigate.why, url: SHELL_ORIGIN + EMBED_PATH + '?mode=' + DEFAULT_MODE }
    if (navigate.ok !== true) throw new Error('the embed page could not be navigated into the new tab: ' + navigate.why)
    const loadStarted = Date.now()
    let loaded = null
    let attempts = 0
    let lastRead = null
    while (Date.now() - loadStarted < 20000) {
      attempts += 1
      const read = await readPageState(session)
      lastRead = read.ok === true ? { ok: true, why: null, state: read.state } : { ok: false, why: read.why, state: null }
      if (read.ok === true && read.state !== null && read.state.readyState === 'complete' && read.state.hasPanel === true && String(read.state.href).includes(EMBED_PATH)) { loaded = read.state; break }
      await sleep(250)
    }
    transcript.newTabMethods = session.methods.slice()
    transcript.tab.loaded = loaded === null
      ? { ok: false, waitedMs: Date.now() - loadStarted, attempts, state: null, lastRead }
      : { ok: true, waitedMs: Date.now() - loadStarted, attempts, state: loaded }
    if (loaded === null) throw new Error('the embed page never reached readyState complete with a panel in the new tab (' + String(attempts) + ' polls over ' + String(Date.now() - loadStarted) + 'ms)')

    // --- reading 03: sidebar at load ---------------------------------------------------------------
    transcript.reads.sidebar = await readPageState(session)
    // --- reading 04: post full, read ----------------------------------------------------------------
    transcript.posts.full = await postMode(session, 'full')
    transcript.reads.full = await readPageState(session)
    if (transcript.posts.full.ok !== true) transcript.problems.push('the full-mode postMessage could not be evaluated: ' + String(transcript.posts.full.why))
    // --- reading 05: post sidebar, read -------------------------------------------------------------
    transcript.posts.sidebar = await postMode(session, 'sidebar')
    transcript.reads.sidebarAgain = await readPageState(session)
    if (transcript.posts.sidebar.ok !== true) transcript.problems.push('the sidebar-mode postMessage could not be evaluated: ' + String(transcript.posts.sidebar.why))
    // --- reading 06: post an unknown mode, read -----------------------------------------------------
    transcript.posts.unknown = await postMode(session, UNKNOWN_MODE)
    transcript.reads.unknown = await readPageState(session)
    if (transcript.posts.unknown.ok !== true) transcript.problems.push('the unknown-mode postMessage could not be evaluated: ' + String(transcript.posts.unknown.why))
    transcript.newTabMethods = session.methods.slice()
  } finally {
    session.close()
  }
}

const closeTab = async (id) => {
  const started = Date.now()
  const closed = await httpGet(CDP_ORIGIN + '/json/close/' + id, 8000)
  let gone = false
  while (Date.now() - started < 8000) {
    const pages = await cdpPages()
    if (pages.ok === true && pages.pages.every((page) => page.id !== id)) { gone = true; break }
    await sleep(200)
  }
  transcript.tab.closed = { status: closed.status, gone, ms: Date.now() - started }
  return gone
}

const runExit = async (entryTab) => {
  const pages = await cdpPages()
  const pids = pidFingerprint()
  const leaseState = await panelPost(PORT, { op: 'state' })
  const contractAtExit = await httpGet(SHELL_ORIGIN + CONTRACT_PATH)
  transcript.exitContractStatus = contractAtExit.status
  transcript.world.exit = {
    at: new Date().toISOString(),
    pages: pages.ok === true ? pages.pages : null,
    pids: { ok: pids.ok, why: pids.why, rows: pidRows(pids).rows },
    lease: leaseState === null ? null : { held: leaseState?.lease?.held === true, holder: leaseState?.lease?.holder ?? null },
  }
  transcript.lease.exit = transcript.world.exit.lease
  if (pages.ok === true && entryTab !== null && entryTab !== undefined) {
    const refreshed = pages.pages.find((page) => page.id === entryTab.id) ?? entryTab
    transcript.entryTab.after = await entryFingerprint(refreshed)
  }
}

// ---------------------------------------------------------------------------
// The judge: a pure function over the transcript. Nothing here reads the clock or the disk.
// ---------------------------------------------------------------------------
const readingOf = (id, ok, detail, evidence) => ({ id, ok: ok === true ? true : (ok === null ? null : false), detail, evidence: evidence === undefined ? [] : evidence })
const stateOf = (read) => (read !== null && read !== undefined && read.ok === true ? read.state : null)
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const near = (left, right) => num(left) !== null && num(right) !== null && Math.abs(left - right) <= TOLERANCE_PX
const namedCodeOf = (text) => {
  const match = /^\s*([A-Z][A-Z0-9_]*)\s*:/.exec(String(text ?? ''))
  return match === null ? null : match[1]
}

function judge(t) {
  const out = []
  // A run that never reached a measurement is reported as unmeasured, never as a passed or failed judgement.
  if (typeof t.fatal === 'string' && t.fatal !== '') {
    const why = 'not measured - the gate never reached a measurement: ' + t.fatal
    for (const id of READING_IDS) out.push(readingOf(id, null, why, []))
    return out
  }
  const entry = t.world.entry
  const exit = t.world.exit
  const entryPidRows = pidRows({ ok: entry?.pids?.ok === true, rows: entry?.pids?.rows ?? [] })
  const exitPidRows = pidRows({ ok: exit?.pids?.ok === true, rows: exit?.pids?.rows ?? [] })
  const contract = t.contract

  // 01 -- the world is fit, the surface is live, and this gate holds the lease.
  {
    const rows = []
    rows.push('CDP ' + String(t.cdpPort) + ': ' + String(entry?.pages?.length ?? 0) + ' page target(s); the world entry tab ' + String(entry?.entryTab?.id ?? '(none)') + ' ' + show(entry?.entryTab?.url ?? null) + ' title ' + show(clip(String(entry?.entryTab?.title ?? ''), 60)))
    rows.push('the entry tab fingerprint: ' + show(t.entryTab.before === null ? null : { href: t.entryTab.before.href, title: clip(String(t.entryTab.before.title ?? ''), 60), ready: t.entryTab.before.readyState, embedGlobal: t.entryTab.before.embedGlobal, history: t.entryTab.before.history }))
    rows.push('contract: GET ' + CONTRACT_PATH + ' -> ' + String(contract.status) + ', ' + String(contract.bytes) + ' bytes, version ' + show(contract.version) + ', modes ' + show(contract.modes) + ', defaultMode ' + show(contract.defaultMode))
    rows.push('contract message type ' + show(contract.messageType) + ', refusal code ' + show(contract.refusalCode) + ', sidebarWidth default ' + show(contract.sidebarWidthDefault) + ', embedPath ' + show(contract.embedPath))
    rows.push('embed: GET ' + EMBED_PATH + ' -> ' + String(t.page.status) + ', ' + show(t.page.type) + ', ' + String(t.page.bytes) + ' bytes')
    rows.push('the panel API op=state answered: lease held=' + String(entry?.lease?.held) + ' holder=' + show(entry?.lease?.holder))
    rows.push('the single-run lease: claimed=' + String(t.lease.claimed) + ' by ' + show(t.holder) + ' after ' + String(t.lease.attempts) + ' attempt(s) and ' + String(t.lease.waitMs) + 'ms')
    rows.push('pids at entry: client ' + pidText(entryPidRows.client) + '; kernel ' + pidText(entryPidRows.kernel))
    const ok = entry !== null && entry !== undefined
      && Array.isArray(entry.pages) && entry.pages.length >= 1
      && entryPidRows.client !== null && entryPidRows.client.pid !== null && entryPidRows.kernel !== null && entryPidRows.kernel.pid !== null
      && contract.status === 200 && typeof contract.version === 'string' && VERSION_SHAPE.test(contract.version)
      && Array.isArray(contract.modes) && contract.modes.length === 2 && MODES.every((mode) => contract.modes.includes(mode))
      && contract.defaultMode === DEFAULT_MODE && contract.messageType === MESSAGE_TYPE
      && typeof contract.refusalCode === 'string' && NAMED_CODE.test(contract.refusalCode)
      && contract.embedPath === EMBED_PATH && num(contract.sidebarWidthDefault) !== null
      && t.page.status === 200 && /text\/html/i.test(String(t.page.type ?? '')) && t.page.bytes > 1000
      && t.lease.claimed === true
    out.push(readingOf('01-the-world-is-fit-and-this-gate-holds-the-single-run-lease', ok, 'the world at entry: ' + String(entry?.pages?.length ?? 0) + ' page target(s), entry tab ' + String(entry?.entryTab?.id ?? '(none)') + ' at ' + show(entry?.entryTab?.url ?? null) + '; contract ' + String(contract.status) + ' version ' + show(contract.version) + ' with modes ' + show(contract.modes) + '; embed ' + String(t.page.status) + ' ' + String(t.page.bytes) + ' bytes of ' + show(t.page.type) + '; lease claimed ' + String(t.lease.claimed) + ' by ' + show(t.holder) + ' in ' + String(t.lease.attempts) + ' attempt(s)/' + String(t.lease.waitMs) + 'ms; pids client ' + pidText(entryPidRows.client) + ' kernel ' + pidText(entryPidRows.kernel), rows))
  }

  // 02 -- the page loaded in a NEW tab; the entry tab was never navigated.
  {
    const rows = []
    const loaded = t.tab.loaded ?? null
    const loadedState = loaded !== null && loaded.ok === true ? loaded.state : null
    const before = t.entryTab.before
    rows.push('the tab this gate opened: ' + show(t.tab.created?.id) + ' (same as the entry tab: ' + String(t.tab.created?.sameAsEntry) + '); page targets during the run ' + String(t.tab.duringCount) + ' against ' + String(t.tab.entryCount) + ' at entry')
    rows.push('Page.navigate sent to the new tab: ' + show(t.tab.navigate))
    rows.push('the document at that target: ' + String(loaded === null ? '' : String(loaded.waitedMs) + 'ms after navigate, ' + String(loaded.attempts) + ' poll(s)') + ' -> ' + show(loadedState === null ? (loaded === null || loaded === undefined ? null : loaded.lastRead) : { href: loadedState.href, ready: loadedState.readyState, hasPanel: loadedState.hasPanel, frameIsSelf: loadedState.frameIsSelf, embedded: loadedState.embedded }))
    rows.push('CDP methods this gate sent to the NEW tab: ' + show(t.newTabMethods))
    rows.push('CDP methods this gate sent to the ENTRY tab: ' + show(before?.methods ?? []))
    rows.push('the entry tab while the new tab was open: ' + show(before === null ? null : { href: before.href, title: clip(String(before.title ?? ''), 60), ready: before.readyState, embedGlobal: before.embedGlobal }))
    const ok = t.tab.created !== null && t.tab.created.sameAsEntry === false
      && t.tab.duringCount === t.tab.entryCount + 1
      && t.tab.navigate?.ok === true
      && loadedState !== null && String(loadedState.href).startsWith(SHELL_ORIGIN + EMBED_PATH) && String(loadedState.href).includes('mode=' + DEFAULT_MODE)
      && loadedState.readyState === 'complete' && loadedState.hasPanel === true
      && Array.isArray(t.newTabMethods) && t.newTabMethods.includes('Page.navigate')
      && Array.isArray(before?.methods) && before.methods.includes('Page.navigate') === false
      && before?.href === SHELL_ORIGIN + '/' && before?.embedGlobal === 'undefined'
    out.push(readingOf('02-the-page-loaded-in-a-new-tab-not-in-the-world-entry-tab', ok, 'the tab this gate opened: ' + show(t.tab.created?.id) + ' (same as the entry tab: ' + String(t.tab.created?.sameAsEntry) + '); page targets ' + String(t.tab.duringCount) + ' during the run against ' + String(t.tab.entryCount) + ' at entry; Page.navigate answered ok=' + String(t.tab.navigate?.ok) + ' for ' + show(t.tab.navigate?.url) + '; the document ' + String(loaded === null || loaded === undefined ? '' : String(loaded.waitedMs) + 'ms and ' + String(loaded.attempts) + ' poll(s) later') + ': ' + show(loadedState === null ? (loaded === null || loaded === undefined ? null : loaded.lastRead) : { href: loadedState.href, ready: loadedState.readyState, hasPanel: loadedState.hasPanel }) + '; methods to the new tab ' + show(t.newTabMethods) + ' vs the entry tab ' + show(before?.methods ?? []), rows))
  }

  // 03 -- sidebar at load.
  {
    const rows = []
    const read = t.reads.sidebar
    const sidebar = stateOf(read)
    const expected = num(contract.sidebarWidthDefault)
    rows.push('the read: ' + (read === null || read.ok !== true ? 'FAILED (' + String(read?.why ?? 'not taken') + ')' : show({ mode: sidebar.mode, width: sidebar.width, height: sidebar.height, innerWidth: sidebar.innerWidth, innerHeight: sidebar.innerHeight, mirror: sidebar.mirror, refusal: sidebar.refusal, globals: sidebar.globals, record: sidebar.record === null ? null : { mode: sidebar.record.mode, width: sidebar.record.width, height: sidebar.record.height, source: sidebar.record.source, accepted: sidebar.record.accepted } })))
    rows.push('the page own facts: ' + show(sidebar === null ? null : { factMode: sidebar.factMode, factGeometry: sidebar.factGeometry, badge: sidebar.badge, embedded: sidebar.embedded, frameIsSelf: sidebar.frameIsSelf }))
    rows.push('the contract default sidebar width: ' + show(expected) + '; the panel measured ' + show(sidebar?.width) + ' css px')
    const widthOk = expected === null ? (num(sidebar?.width) !== null && sidebar.width >= 200) : near(sidebar?.width, expected)
    const ok = sidebar !== null
      && sidebar.mode?.html === 'sidebar' && sidebar.mode?.body === 'sidebar' && sidebar.mode?.panel === 'sidebar'
      && widthOk
      && near(sidebar.height, sidebar.innerHeight)
      && num(sidebar.width) !== null && num(sidebar.innerWidth) !== null && sidebar.width < sidebar.innerWidth
      && String(sidebar.mirror?.width) === String(sidebar.width) && String(sidebar.mirror?.height) === String(sidebar.height)
      && sidebar.globals?.mode === 'sidebar' && sidebar.globals?.embedded === false
      && sidebar.record !== null && sidebar.record.mode === 'sidebar' && sidebar.record.width === sidebar.width && sidebar.record.height === sidebar.height
      && /URL/i.test(String(sidebar.record.source))
      && String(sidebar.refusal ?? '') === ''
      && sidebar.record.accepted === 1
    out.push(readingOf('03-sidebar-mode-at-load', ok, 'at load, with nothing posted yet: mode attribute on html/body/panel ' + show(sidebar === null ? null : [sidebar.mode.html, sidebar.mode.body, sidebar.mode.panel]) + ', panel ' + show(sidebar?.width) + 'x' + show(sidebar?.height) + ' css px against a ' + show(sidebar?.innerWidth) + 'x' + show(sidebar?.innerHeight) + ' viewport, contract default width ' + show(expected) + ', source ' + show(sidebar?.record?.source) + ', refusal ' + show(sidebar === null ? null : clip(String(sidebar.refusal ?? ''), 80)), rows))
  }

  // 04 -- posting full grew the panel to the viewport.
  {
    const rows = []
    const sidebar = stateOf(t.reads.sidebar)
    const read = t.reads.full
    const full = stateOf(read)
    const post = t.posts.full
    const delta = full !== null && sidebar !== null && num(full.width) !== null && num(sidebar.width) !== null ? full.width - sidebar.width : null
    rows.push('the post: ' + show({ ok: post?.ok, why: post?.why, message: { type: MESSAGE_TYPE, mode: 'full' } }))
    rows.push('the read: ' + (read === null || read.ok !== true ? 'FAILED (' + String(read?.why ?? 'not taken') + ')' : show({ mode: full.mode, width: full.width, height: full.height, innerWidth: full.innerWidth, innerHeight: full.innerHeight, mirror: full.mirror, refusal: full.refusal, globals: full.globals, record: full.record === null ? null : { mode: full.record.mode, width: full.record.width, height: full.record.height, source: full.record.source, accepted: full.record.accepted } })))
    rows.push('growth: ' + show(sidebar?.width) + ' -> ' + show(full?.width) + ' css px (' + show(delta) + ' px wider); viewport ' + show(full?.innerWidth) + ' x ' + show(full?.innerHeight))
    const narrow = sidebar === null || full === null || num(sidebar.width) === null || num(full.innerWidth) === null || sidebar.width + TOLERANCE_PX >= full.innerWidth
    if (narrow) {
      out.push(readingOf('04-posting-full-grew-the-panel-to-the-viewport', null, 'the tab viewport (' + show(full?.innerWidth) + ' x ' + show(full?.innerHeight) + ') is not wider than the sidebar rect (' + show(sidebar?.width) + ' px), so growth toward the viewport cannot be demonstrated in this world', rows))
    } else {
      const ok = post?.ok === true && full !== null
        && full.mode?.html === 'full' && full.mode?.body === 'full' && full.mode?.panel === 'full'
        && near(full.width, full.innerWidth) && near(full.height, full.innerHeight)
        && delta !== null && delta > 0
        && String(full.mirror?.width) === String(full.width) && String(full.mirror?.height) === String(full.height)
        && full.globals?.mode === 'full'
        && full.record !== null && full.record.mode === 'full' && full.record.width === full.width && full.record.height === full.height
        && sidebar !== null && sidebar.record !== null && full.record.accepted === sidebar.record.accepted + 1
        && String(full.refusal ?? '') === ''
      out.push(readingOf('04-posting-full-grew-the-panel-to-the-viewport', ok, 'after posting ' + show({ type: MESSAGE_TYPE, mode: 'full' }) + ' through Runtime.evaluate: mode attribute ' + show(full === null ? null : [full.mode.html, full.mode.body, full.mode.panel]) + ', panel ' + show(full?.width) + 'x' + show(full?.height) + ' css px against a ' + show(full?.innerWidth) + 'x' + show(full?.innerHeight) + ' viewport, growth ' + show(delta) + ' css px over the sidebar rect', rows))
    }
  }

  // 05 -- posting sidebar returned the panel to the sidebar rect.
  {
    const rows = []
    const sidebar = stateOf(t.reads.sidebar)
    const full = stateOf(t.reads.full)
    const read = t.reads.sidebarAgain
    const again = stateOf(read)
    const post = t.posts.sidebar
    rows.push('the post: ' + show({ ok: post?.ok, why: post?.why, message: { type: MESSAGE_TYPE, mode: 'sidebar' } }))
    rows.push('the read: ' + (read === null || read.ok !== true ? 'FAILED (' + String(read?.why ?? 'not taken') + ')' : show({ mode: again.mode, width: again.width, height: again.height, innerWidth: again.innerWidth, innerHeight: again.innerHeight, mirror: again.mirror, globals: again.globals, record: again.record === null ? null : { mode: again.record.mode, width: again.record.width, height: again.record.height, source: again.record.source, accepted: again.record.accepted } })))
    rows.push('the return: load ' + show(sidebar?.width) + 'x' + show(sidebar?.height) + ' -> full ' + show(full?.width) + 'x' + show(full?.height) + ' -> sidebar ' + show(again?.width) + 'x' + show(again?.height) + ' css px')
    const ok = post?.ok === true && again !== null && sidebar !== null && full !== null
      && again.mode?.html === 'sidebar' && again.mode?.body === 'sidebar' && again.mode?.panel === 'sidebar'
      && near(again.width, sidebar.width) && near(again.height, sidebar.height)
      && again.width < again.innerWidth
      && again.globals?.mode === 'sidebar'
      && again.record !== null && again.record.mode === 'sidebar' && again.record.width === again.width
      && full.record !== null && again.record.accepted === full.record.accepted + 1
      && String(again.refusal ?? '') === ''
    out.push(readingOf('05-posting-sidebar-returned-the-panel-to-the-sidebar-rect', ok, 'after posting ' + show({ type: MESSAGE_TYPE, mode: 'sidebar' }) + ': mode attribute ' + show(again === null ? null : [again.mode.html, again.mode.body, again.mode.panel]) + ', panel ' + show(again?.width) + 'x' + show(again?.height) + ' css px, against the load rect ' + show(sidebar?.width) + 'x' + show(sidebar?.height) + ' and the full rect ' + show(full?.width) + 'x' + show(full?.height) + ' (tolerance ' + String(TOLERANCE_PX) + ' px)', rows))
  }

  // 06 -- an unknown mode is refused by name; the last good mode stayed.
  {
    const rows = []
    const again = stateOf(t.reads.sidebarAgain)
    const read = t.reads.unknown
    const refused = stateOf(read)
    const post = t.posts.unknown
    const code = namedCodeOf(refused?.refusal)
    const contractCode = typeof contract.refusalCode === 'string' ? contract.refusalCode : null
    rows.push('the post: ' + show({ ok: post?.ok, why: post?.why, message: { type: MESSAGE_TYPE, mode: t.unknownMode } }))
    rows.push('the read: ' + (read === null || read.ok !== true ? 'FAILED (' + String(read?.why ?? 'not taken') + ')' : show({ mode: refused.mode, width: refused.width, height: refused.height, refusal: clip(String(refused.refusal ?? ''), 240), globals: refused.globals, record: refused.record === null ? null : { mode: refused.record.mode, accepted: refused.record.accepted, refused: refused.record.refused, refusals: refused.record.refusals }, factLast: clip(String(refused.factLast ?? ''), 200) })))
    rows.push('the named code in the refusal: ' + show(code) + ' (the contract publishes ' + show(contractCode) + '); the refusal names the value it refused: ' + String(String(refused?.refusal ?? '').includes(t.unknownMode)))
    const ok = post?.ok === true && refused !== null && again !== null
      && code !== null && NAMED_CODE.test(code) && (contractCode === null || code === contractCode)
      && String(refused.refusal ?? '').includes(t.unknownMode)
      && refused.mode?.html === 'sidebar' && refused.mode?.body === 'sidebar' && refused.mode?.panel === 'sidebar'
      && refused.width === again.width && refused.height === again.height
      && refused.globals?.mode === 'sidebar'
      && refused.record !== null && again.record !== null
      && refused.record.accepted === again.record.accepted
      && refused.record.refused === again.record.refused + 1
      && Array.isArray(refused.record.refusals) && refused.record.refusals.some((row) => String(row).includes(code)) && refused.record.refusals.some((row) => String(row).includes(t.unknownMode))
      && /REFUSED a mode by name/i.test(String(refused.factLast ?? ''))
    out.push(readingOf('06-an-unknown-mode-is-refused-by-name-and-the-last-good-mode-stayed', ok, 'after posting ' + show(t.unknownMode) + ': refusal ' + show(clip(String(refused?.refusal ?? ''), 120)) + ', named code ' + show(code) + ', mode attribute ' + show(refused === null ? null : [refused.mode.html, refused.mode.body, refused.mode.panel]) + ', geometry ' + show(refused?.width) + 'x' + show(refused?.height) + ' against reading 05 at ' + show(again?.width) + 'x' + show(again?.height) + ', counters ' + show(refused?.record === null || refused?.record === undefined ? null : { accepted: refused.record.accepted, refused: refused.record.refused }) + ' against ' + show(again?.record === null || again?.record === undefined ? null : { accepted: again.record.accepted, refused: again.record.refused }), rows))
  }

  // 07 -- the tab was closed and the world is back.
  {
    const rows = []
    const before = t.entryTab.before
    const after = t.entryTab.after
    const entryPages = entry?.pages ?? []
    const exitPages = exit?.pages
    const sameSet = Array.isArray(exitPages) && JSON.stringify(targetSet(exitPages)) === JSON.stringify(targetSet(entryPages))
    const historySame = before === null || after === null || before.history === null || before.history === undefined || after.history === null || after.history === undefined
      ? null
      : (before.history.entries === after.history.entries && before.history.currentIndex === after.history.currentIndex)
    rows.push('the close: ' + show(t.tab.closed) + ' (the tab this gate opened: ' + show(t.tab.created?.id) + ')')
    rows.push('targets at entry: ' + show(entryPages.map((page) => page.id + ' ' + page.url)))
    rows.push('targets at exit:  ' + show(Array.isArray(exitPages) ? exitPages.map((page) => page.id + ' ' + page.url) : null) + '; identical to entry: ' + String(sameSet) + '; extra tab: ' + String(Array.isArray(exitPages) ? exitPages.filter((page) => entryPages.some((one) => one.id === page.id) === false).length : null))
    rows.push('the entry tab before: ' + show(before === null ? null : { href: before.href, title: clip(String(before.title ?? ''), 60), ready: before.readyState, embedGlobal: before.embedGlobal, history: before.history }))
    rows.push('the entry tab after:  ' + show(after === null ? null : { href: after.href, title: clip(String(after.title ?? ''), 60), ready: after.readyState, embedGlobal: after.embedGlobal, history: after.history }))
    rows.push('the lease: ' + show(t.lease.exit) + ' (released by this gate: ' + String(t.lease.released) + ')')
    rows.push('pids at entry: client ' + pidText(entryPidRows.client) + '; kernel ' + pidText(entryPidRows.kernel))
    rows.push('pids at exit:  client ' + pidText(exitPidRows.client) + '; kernel ' + pidText(exitPidRows.kernel))
    rows.push('both routes at exit: contract ' + String(t.exitContractStatus) + ', embed page bytes ' + String(t.page.bytes))
    const pidsSame = entryPidRows.client !== null && exitPidRows.client !== null && entryPidRows.client.pid === exitPidRows.client.pid && entryPidRows.client.start === exitPidRows.client.start
      && entryPidRows.kernel !== null && exitPidRows.kernel !== null && entryPidRows.kernel.pid === exitPidRows.kernel.pid
    const ok = t.tab.closed !== null && t.tab.closed.gone === true
      && sameSet === true && Array.isArray(exitPages) && exitPages.length === entryPages.length
      && before !== null && after !== null && after.ok === true
      && before.href === after.href && before.title === after.title && before.readyState === after.readyState
      && after.embedGlobal === 'undefined' && after.modeGlobal === 'undefined'
      && historySame !== false
      && t.lease.exit !== null && t.lease.exit.held === false
      && pidsSame === true
      && t.exitContractStatus === 200
    out.push(readingOf('07-the-tab-was-closed-and-the-world-is-back', ok, 'the close: ' + show(t.tab.closed) + '; targets at exit ' + String(Array.isArray(exitPages) ? exitPages.length : 'unread') + ' against ' + String(entryPages.length) + ' at entry (identical: ' + String(sameSet) + ', extra tab: ' + String(Array.isArray(exitPages) ? exitPages.filter((page) => entryPages.some((one) => one.id === page.id) === false).length : 'unread') + '); the entry tab ' + show(before?.href ?? null) + ' -> ' + show(after?.href ?? null) + ', title unchanged: ' + String(before !== null && after !== null && before.title === after.title) + ', ready ' + show(after?.readyState ?? null) + ', embed global after ' + show(after?.embedGlobal ?? null) + ', history ' + show(before?.history ?? null) + ' -> ' + show(after?.history ?? null) + '; lease at exit ' + show(t.lease.exit) + ' (released ' + String(t.lease.released) + '); pids identical: ' + String(pidsSame) + ' (' + pidText(exitPidRows.client) + ' / ' + pidText(exitPidRows.kernel) + ')', rows))
  }

  return out
}

// ---------------------------------------------------------------------------
// The printout: evidence, never a verdict.
// ---------------------------------------------------------------------------
const printTranscript = (t) => {
  const entryPidRows = pidRows({ ok: t.world.entry?.pids?.ok === true, rows: t.world.entry?.pids?.rows ?? [] })
  const exitPidRows = pidRows({ ok: t.world.exit?.pids?.ok === true, rows: t.world.exit?.pids?.rows ?? [] })
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell: ' + t.shellOrigin + ' (embed ' + t.embedPath + ', contract ' + t.contractPath + '); kernel: ' + t.kernelOrigin + '; CDP ' + String(t.cdpPort) + ' (the client was already running - this gate never starts or stops it)')
  console.log('  entry tab: ' + String(t.world.entry?.entryTab?.id ?? '(none)') + ' ' + show(t.world.entry?.entryTab?.url ?? null) + ' title ' + show(clip(String(t.world.entry?.entryTab?.title ?? ''), 60)))
  console.log('  pids at entry: client ' + pidText(entryPidRows.client) + '; kernel ' + pidText(entryPidRows.kernel))
  console.log('  pids at exit:  client ' + pidText(exitPidRows.client) + '; kernel ' + pidText(exitPidRows.kernel))
  console.log('  the single-run lease: claimed ' + String(t.lease.claimed) + ' by ' + show(t.holder) + ' after ' + String(t.lease.attempts) + ' attempt(s) / ' + String(t.lease.waitMs) + 'ms; at exit ' + show(t.lease.exit) + '; released ' + String(t.lease.released))
  console.log('  the tab: ' + show(t.tab.created?.id) + ' (entry tab ' + show(t.world.entry?.entryTab?.id) + '); targets ' + String(t.tab.entryCount) + ' at entry, ' + String(t.tab.duringCount) + ' during the run, ' + String(t.world.exit?.pages === null || t.world.exit?.pages === undefined ? null : t.world.exit.pages.length) + ' at exit; closed ' + show(t.tab.closed))
  console.log('  the unknown mode this gate posted: ' + show(t.unknownMode) + ' (a name nothing defines)')
  const fatal = t.fatal === undefined ? null : t.fatal
  if (fatal !== null) console.log('  FATAL ' + fatal)
  for (const problem of t.problems) console.log('  PROBLEM ' + problem)
}
const printReadings = (readings) => {
  console.log('')
  console.log('== readings ==')
  for (const reading of readings) {
    const tag = reading.ok === true ? '[GREEN]        ' : (reading.ok === null ? '[NOT MEASURED] ' : '[RED]          ')
    console.log('')
    console.log(tag + reading.id)
    console.log('  ' + reading.detail)
    for (const row of reading.evidence) console.log('    - ' + row)
  }
  console.log('')
}
const summarise = (t, readings) => {
  const red = readings.filter((reading) => reading.ok === false)
  const notMeasured = readings.filter((reading) => reading.ok === null)
  const green = readings.filter((reading) => reading.ok === true)
  console.log('gate 132 host-embed-live: ' + String(readings.length) + ' readings, ' + String(green.length) + ' green, ' + String(red.length) + ' red, ' + String(notMeasured.length) + ' not measured [shell ' + t.shellOrigin + ', CDP ' + String(t.cdpPort) + '; ' + (t.tab.created === null || t.tab.created === undefined ? 'no tab was opened' : 'one tab opened and closed (' + String(t.tab.created.id) + ')') + '; lease ' + (t.lease.claimed === true ? 'held then released' : 'not taken') + '; model turns 0; client starts/stops 0]')
  for (const reading of red) console.log('  RED ' + reading.id + ': ' + reading.detail)
  if (notMeasured.length === readings.length && notMeasured.length > 0) {
    console.log('  every reading is NOT MEASURED: ' + String(notMeasured[0]?.detail ?? ''))
  } else {
    for (const reading of notMeasured) console.log('  NOT MEASURED ' + reading.id + ': ' + reading.detail)
  }
  return red.length > 0 ? 1 : (notMeasured.length > 0 ? 3 : 0)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const stampOf = () => new Date().toISOString().replace(/[:.]/gu, '-')
const writeTranscript = () => {
  const dir = join(SCRATCH, stampOf())
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'host-embed-live.json')
  writeFileSync(path, JSON.stringify(transcript, null, 2))
  return path
}
const newestTranscript = () => {
  if (existsSync(SCRATCH) === false) return null
  for (const stamp of readdirSync(SCRATCH).sort().reverse()) {
    const candidate = join(SCRATCH, stamp, 'host-embed-live.json')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const main = async () => {
  console.log('gate 132 host-embed-live (R195, LIVE) - the embed page driven in a NEW TAB of the running shell')
  console.log('  shell ' + SHELL_ORIGIN + ', CDP ' + String(CDP_PORT) + ', lease holder ' + show(GATE_HOLDER) + '; the world entry tab is never navigated and the client is never started or stopped')

  if (REPLAY !== null) {
    const path = REPLAY === 'latest' ? newestTranscript() : resolve(REPLAY)
    if (path === null || path === undefined || existsSync(path) === false) return NOT_MEASURED('no transcript to replay at ' + String(path ?? SCRATCH))
    let parsed = null
    try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { return NOT_MEASURED('the transcript at ' + path + ' is not JSON (' + describe(error) + ')') }
    if (parsed?.schema !== SCHEMA) return NOT_MEASURED('the file at ' + path + ' is not a transcript this gate wrote (schema ' + show(parsed?.schema) + ')')
    console.log('  replay: judging ' + path + ' - the world is NOT touched (no CDP read, no tab, no lease, no HTTP)')
    const readings = judge(parsed)
    printTranscript(parsed)
    printReadings(readings)
    return summarise(parsed, readings)
  }

  let entryTab = null
  let leaseTaken = false
  let tabId = null
  let fatal = null
  try {
    await runWorld()
    entryTab = transcript.world.entry.entryTab
    leaseTaken = transcript.lease.claimed === true
    tabId = transcript.tab.created?.id ?? null
  } catch (error) {
    fatal = describe(error)
    console.log('')
    console.log('SKIP (not measured): ' + fatal)
    tabId = transcript.tab.created?.id ?? null
  } finally {
    // The world is put back the way it was found, whatever happened above.
    if (tabId !== null) {
      try { await closeTab(tabId) } catch (error) { transcript.problems.push('the tab could not be closed: ' + describe(error)) }
    }
    if (leaseTaken === true || transcript.lease.claimed === true) {
      try {
        await releaseLease(PORT, GATE_HOLDER)
        transcript.lease.released = true
      } catch (error) {
        transcript.lease.released = false
        transcript.problems.push('the lease could not be released: ' + describe(error))
      }
    }
    if (entryTab === null && transcript.world.entry !== null) entryTab = transcript.world.entry.entryTab
    try { await runExit(entryTab) } catch (error) { transcript.problems.push('the exit fingerprint could not be read: ' + describe(error)) }
    transcript.fatal = fatal
    const written = writeTranscript()
    console.log('  transcript: ' + written)
  }

  const readings = judge(transcript)
  printTranscript(transcript)
  printReadings(readings)
  const code = summarise(transcript, readings)
  // A gate that could not measure its subject exits 3 and says why, whatever the readings above say.
  if (fatal !== null) {
    console.log('  the run did not reach a measurement: ' + fatal)
    return 3
  }
  return code
}

const code = await main()
process.exit(code)
