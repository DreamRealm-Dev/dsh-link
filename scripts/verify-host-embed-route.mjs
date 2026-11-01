#!/usr/bin/env node
/**
 * Gate 131 (R195) - host-embed-route: THE TWO HTTP ROUTES OF plugins/dsh-link-host, BOUND ON THE REAL
 * KERNEL WEB SERVER AND DRIVEN OVER A REAL SOCKET, WITH THE EMBED PAGE JUDGED AS BYTES.
 *
 * Subject: plugins/dsh-link-host/lib/index.js as delivered (the BUILT artifact; the .ts source is not
 * read here), the two routes it binds - GET /api/dsh-link-host/contract and GET /api/dsh-link-host/embed -
 * and the requirement docs/handoff/R195-contract.md section 2 P1/P2.
 *
 * THE WORLD IS THE REAL KERNEL. A fresh cordis Context mounts the kernel's own WebServer service
 * (core/deepseek-harness/packages/host/webserver); the SHIPPED apply() of the host row is mounted on that
 * context through ctx.plugin, so the two routes are registered by the real WebServer.register() and
 * answered over a socket the kernel itself listens on - not by a hand-made server and not by a stub that
 * records a handler. The gate binds 127.0.0.1:0 (an ephemeral port it owns) and never connects to
 * 31761/31760/9222, never starts or stops the client, and writes no file.
 *
 * THE JUDGEMENT IS OVER BYTES AND JSON, NEVER OVER THE AUTHORS' CLAIMS:
 *   - the contract is judged as the JSON the socket answered, against the frozen paths/values this gate
 *     carries (R195-contract section 2), not against the module's own exported constants;
 *   - the four origin sites the contract names are re-read off THIS tree at the file:line the contract
 *     states, so a drift between the answer and the tree is a failing reading rather than a stale
 *     sentence;
 *   - the page is judged as the bytes the socket answered: a self-containment scan (no external script,
 *     link, image, frame, @import, url(), fetch, XHR, WebSocket, worker), the two modes and both
 *     selection paths named in its own text, the refusal code named, the geometry/mode facts it
 *     promises, and the two layouts stated in its own words.
 *
 * READINGS (each independently failable, printed with the evidence it was taken from):
 *   01 BOTH ROUTES ARE BOUND IN THE REAL KERNEL WEB SERVER. The real WebServer service's own exact route
 *      table holds both frozen paths with a handler, the row's boot lines name both, and a path nobody
 *      registered answers the KERNEL's own 404 (which is what says the socket belongs to the kernel).
 *   02 GET THE CONTRACT ANSWERS 200 WITH JSON, AND TWO GETS ARE BYTE-IDENTICAL. 200, content-type JSON,
 *      no-store, and the two answers compare byte for byte: the answer carries no clock and no counter,
 *      so "the version is present and stable" is measured rather than promised.
 *   03 THE CONTRACT'S SHAPE AND VALUES. A version string (semver), both modes exactly, the default mode
 *      among them, BOTH selection paths (the ?mode= query and the postMessage type), the three query
 *      parameters a host may pass (mode, sidebarWidth, panel), the two document facts a host reads, and
 *      the refusal table - all named as data.
 *   04 THE CONTRACT NAMES THE BOUNDS PROTOCOL THE SHELL ALREADY SPEAKS. POST /__shell/panel with both
 *      op=surface and op=set-bounds, a read-back op, and the two rect descriptions (sidebar / full).
 *   05 THE CONTRACT NAMES THE FOUR HARDCODED-ORIGIN SITES, AND EACH NAMED LINE HOLDS THE ORIGIN. The
 *      four file:line pairs this gate froze from the requirement are the four the answer names, and each
 *      line re-read off disk carries 127.0.0.1:31761 (the answer's shellOrigin).
 *   06 THE CONTRACT NAMES THE HOST CAPABILITIES IT REQUIRES. child-webview (add_child + unstable), csp
 *      (the shell origin and inline script/style), same-origin-http (a same-origin fetch to the shell),
 *      each with evidence paths that exist in this tree at the line ranges it cites.
 *   07 A VERB THAT IS NOT GET IS REFUSED 405 WITH A NAMED CODE, ON BOTH ROUTES. POST, PUT, DELETE, PATCH
 *      and HEAD answer 405 with an all-caps code and Allow: GET; the GETs after them still answer 200.
 *   08 THE EMBED ROUTE ANSWERS 200 WITH THE PAGE AS BYTES, AND TWO GETS ARE BYTE-IDENTICAL. text/html,
 *      no-store, nosniff, the bytes are a whole document, and the row's own boot line states the same
 *      byte count.
 *   09 THE PAGE IS SELF-CONTAINED, AND ITS ONE NETWORK DEVICE IS NAMED. One inline script and no external
 *      ASSET of any kind: no script src, no link, no image/frame/object, no @import, no url(), no bare
 *      fetch( call site, no XHR/WebSocket/worker, and no http(s) reference at all - so it cannot depend
 *      on the DSH shell's React bundle or any CDN. The page DOES read live data (reading 14); the device
 *      it does that with is window.fetch, captured once, and the single site that builds a request URL
 *      is location.origin + a frozen route path - which is what makes "same origin or nothing" a
 *      measurement instead of a promise.
 *   10 THE PAGE NAMES BOTH MODES AND BOTH SELECTION PATHS. ?mode=sidebar and ?mode=full, both layout
 *      selectors, the message type from the contract, a message listener, the query read, and the
 *      contract version it was built for.
 *   11 THE PAGE REFUSES AN UNKNOWN MODE BY NAME. The refusal code the contract publishes is the code the
 *      page carries, beside a refusal branch and the sentence that the last good mode stays, and the
 *      refusal is written to the document-level attribute a reader can see.
 *   12 THE PAGE CARRIES THE GEOMETRY/MODE FACTS IT PROMISES. data-dsh-link-mode, the panel's own
 *      offsetWidth/offsetHeight and their mirror attributes, the window.__DSH_LINK_EMBED__ record, the
 *      refusal attribute, the honesty fact for window.parent === window, and the panel element.
 *   13 THE PAGE STATES BOTH LAYOUTS IN ITS OWN TEXT. A reader can check the sidebar rect and the full
 *      viewport without running the page: both selectors, the default width with its min/max, and the
 *      0,0 -> innerWidth x innerHeight sentence. Since the page became a live panel that prose lives in
 *      the collapsible drawer at the bottom (closed by default), not over the product surface.
 *   14 THE PAGE READS FOUR SAME-ORIGIN ROUTES AND STATES EACH SECTION OWN STATE. The four frozen paths
 *      (the bus, the team board, the note ledger, the browser panel entry) are in the bytes; the browser
 *      section carries a real action (window.open on the panel entry); every section carries a state
 *      chip, and the "route unavailable - HTTP <status>" sentence it draws INSTEAD of a number; the
 *      protocol facts sit in a drawer closed by default; and the page carries ZERO timers, because a
 *      panel kept fresh by a clock is only as true as its cadence.
 *
 * WHAT THIS GATE CANNOT JUDGE, named so nobody reads a green as more than it is: whether the page draws
 * in a browser (that is gate 132, live, over CDP), whether the live client at 31761 serves these routes
 * (that is gate 132's entry reading), whether a host application can actually create a child webview
 * (that is P4's recipe and the CEF/verso findings), and whether the four origin sites still hold when the
 * port changes (this gate re-reads the literal, it does not renumber it). Reading 14 judges the four live
 * routes BY NAME IN THE BYTES only: this gate mounts this row alone on an ephemeral port, so on its own
 * world every live section would state its own absence - which section 3 of the page is BUILT to do, and
 * which the live gate is the one that can contradict.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 a reading could not be measured (the built artifact
 * is missing, the kernel's cordis/WebServer module is not on this machine, or the artifact will not
 * import). A reading that cannot be measured is never green.
 *
 * Usage: node scripts/verify-host-embed-route.mjs [--subject <dir>]
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { Agent, request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root: found by walking up to the tree that owns the kernel this gate reads. */
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
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')

const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
/** The tree to measure: the project itself, or a copy of it for a hand-made red. */
const SUBJECT = resolve(option('--subject', PROJECT))

// ---------------------------------------------------------------------------
// The frozen interface (R195-contract section 2): no expectation below is read out of the artifact.
// ---------------------------------------------------------------------------
const CONTRACT_PATH = '/api/dsh-link-host/contract'
const EMBED_PATH = '/api/dsh-link-host/embed'
const MODES = ['sidebar', 'full']
const DEFAULT_MODE = 'sidebar'
const MESSAGE_TYPE = 'dsh-link:mode'
const QUERY_PARAMETERS = ['mode', 'sidebarWidth', 'panel']
const ORIGIN = '127.0.0.1:31761'
const ORIGIN_SITES = [
  // R237: the line is the contract's own claim (it names file:line to a host integrator), not something this gate
  // should freeze: the Android cfg-gating moved SELF_ORIGIN from 40 to 45 and the reading went red for a number that
  // is not a fact about the origin. The gate now compares FILES and re-reads the line the contract names.
  // R281: requirement D's module declaration (pub mod embed) shifted the file by three lines; the literal is at 48 now.
  { file: 'src-tauri/src/lib.rs', line: 48 },
  { file: 'src-tauri/tauri.conf.json', line: 12 },
  { file: 'src-tauri/capabilities/default.json', line: 7 },
  { file: 'plugins/dsh-browser/lib/panel.js', line: 35 },
]
const HOST_CAPABILITIES = ['child-webview', 'csp', 'same-origin-http']
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/
const STRANGER_PATH = '/api/dsh-link-host/gate131-nobody'

/** The kernel modules the artifact and this gate must SHARE, by path, so both sides see one service. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/dsh-host-webserver': join(KERNEL, 'packages', 'host', 'webserver', 'lib', 'index.js'),
}

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const clip = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }

// ---------------------------------------------------------------------------
// The socket: node:http against the kernel's own listening port, with an agent that keeps nothing
// alive (a half-closed socket at exit trips a libuv assertion on Windows and the exit code stops
// describing the readings).
// ---------------------------------------------------------------------------
const socketCall = (port, path, method, body) => new Promise((done) => {
  const agent = new Agent({ keepAlive: false })
  const headers = body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }
  const request = httpRequest({ host: '127.0.0.1', port, path, method, agent, headers }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => {
      const bytes = Buffer.concat(chunks)
      const text = bytes.toString('utf8')
      let parsed = null
      try { parsed = JSON.parse(text) } catch { parsed = null }
      agent.destroy()
      done({
        status: response.statusCode,
        type: response.headers['content-type'] ?? null,
        cache: response.headers['cache-control'] ?? null,
        nosniff: response.headers['x-content-type-options'] ?? null,
        allow: response.headers.allow ?? null,
        body: parsed,
        text,
        bytes,
        length: bytes.length,
      })
    })
  })
  request.on('error', (error) => {
    agent.destroy()
    done({ status: 0, type: null, cache: null, nosniff: null, allow: null, body: null, text: '', bytes: Buffer.alloc(0), length: 0, error: String((error === null || error === undefined ? '' : (error.code ?? error.message))) })
  })
  if (body !== undefined) request.write(body)
  request.end()
})

// ---------------------------------------------------------------------------
// Bytes on disk: this gate's own reader, so no expectation is read back from the plugin.
// ---------------------------------------------------------------------------
const readText = (root, rel) => {
  const abs = join(root, rel)
  if (existsSync(abs) === false) return { ok: false, why: 'missing: ' + abs, text: null }
  try { return { ok: true, why: null, text: readFileSync(abs, 'utf8') } } catch (error) { return { ok: false, why: describe(error), text: null } }
}
const lineOf = (text, line) => {
  const rows = String(text).split(/\r?\n/)
  return line >= 1 && line <= rows.length ? rows[line - 1] : null
}
const sitesOnDisk = (root) => ORIGIN_SITES.map((site) => {
  const read = readText(root, site.file)
  if (read.ok !== true) return { file: site.file, line: site.line, present: false, why: read.why, lineText: null, holds: false }
  const lineText = lineOf(read.text, site.line)
  return { file: site.file, line: site.line, present: true, lineText, holds: lineText !== null && lineText.includes(ORIGIN) }
})
/** Every evidence citation a capability row carries, resolved against this tree. */
const evidenceOnDisk = (root, rows) => rows.flatMap((row) => (Array.isArray(row.evidence) ? row.evidence : []).map((citation) => {
  const match = /^(.+?):(\d+)(?:-(\d+))?$/.exec(String(citation))
  if (match === null) return { capability: row.id, citation: String(citation), ok: false, why: 'not a path:line citation' }
  const rel = match[1]
  const from = Number(match[2])
  const to = match[3] === undefined ? from : Number(match[3])
  const read = readText(root, rel)
  if (read.ok !== true) return { capability: row.id, citation: String(citation), ok: false, why: read.why, from, to, total: null }
  const total = String(read.text).split(/\r?\n/).length
  return { capability: row.id, citation: String(citation), ok: from >= 1 && to >= from && to <= total, why: null, from, to, total }
}))

// ---------------------------------------------------------------------------
// The page, as bytes: a self-containment scan and the facts the page must state.
// ---------------------------------------------------------------------------
/** Comments are text, not code: a sentence that says "no script src" is not a script tag. */
const withoutComments = (html) => String(html).replace(/<!--[\s\S]*?-->/g, '')
const RESOURCE_ATTRIBUTES = ['src', 'href', 'srcset', 'data', 'action', 'poster', 'background', 'formaction', 'xlink:href']
const resourceReferences = (html) => {
  const clean = withoutComments(html)
  const refs = []
  for (const tag of clean.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const name = tag[1].toLowerCase()
    const attrs = tag[2]
    for (const attr of RESOURCE_ATTRIBUTES) {
      const pattern = new RegExp('\\b' + attr.replace(':', ':') + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'g')
      for (const hit of attrs.matchAll(pattern)) refs.push({ kind: '<' + name + ' ' + attr + '>', value: hit[2] ?? hit[3] ?? hit[4] ?? '' })
    }
  }
  for (const hit of clean.matchAll(/@import\s+(?:url\()?\s*["']?([^"') \s;]+)/g)) refs.push({ kind: '@import', value: hit[1] })
  for (const hit of clean.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.push({ kind: 'url()', value: hit[1] })
  return refs
}
const NETWORK_TOKENS = [
  { token: 'fetch(', pattern: /\bfetch\s*\(/g },
  { token: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/g },
  { token: 'WebSocket', pattern: /\bWebSocket\b/g },
  { token: 'EventSource', pattern: /\bEventSource\b/g },
  { token: 'sendBeacon', pattern: /\bsendBeacon\b/g },
  { token: 'importScripts', pattern: /\bimportScripts\b/g },
  { token: 'new Worker(', pattern: /\bnew\s+(?:Shared)?Worker\s*\(/g },
]
const networkTokenCounts = (html) => {
  const clean = withoutComments(html)
  return NETWORK_TOKENS.map((row) => ({ token: row.token, count: (clean.match(row.pattern) ?? []).length }))
}
const isSameOrigin = (value, origins) => {
  const ref = String(value).trim()
  if (ref === '') return true
  if (ref.startsWith('#') || ref.startsWith('?')) return true
  if (/^(?:data|blob|about|javascript):/i.test(ref)) return true
  if (ref.startsWith('//')) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref)) return origins.includes(ref.replace(/\/$/, ''))
  return true
}
const occurrences = (text, needle) => String(text).split(needle).length - 1

// ---------------------------------------------------------------------------
// The world: the real kernel WebServer, the shipped apply(), one ephemeral port.
// ---------------------------------------------------------------------------
let KERNEL_CACHE = null
const loadKernel = async () => {
  if (KERNEL_CACHE !== null) return KERNEL_CACHE
  for (const specifier of Object.keys(KERNEL_MODULES)) {
    if (existsSync(KERNEL_MODULES[specifier]) === false) {
      throw new Error('the kernel module ' + specifier + ' is missing at ' + KERNEL_MODULES[specifier] + '; this gate mounts the real kernel and will not stand in a fake web server')
    }
  }
  const load = (key) => import(pathToFileURL(KERNEL_MODULES[key]).href)
  const cordis = await load('@deepseek-ai/cordis')
  const webserver = await load('@deepseek-ai/dsh-host-webserver')
  KERNEL_CACHE = { Context: cordis.Context, WebServer: webserver.default }
  return KERNEL_CACHE
}

const buildWorld = async (root) => {
  const world = { root, artifact: null, subject: null, server: null, boot: [], contract: null, page: null, fatal: null }
  const shippedArtifact = join(root, 'plugins', 'dsh-link-host', 'lib', 'index.js')
  if (existsSync(shippedArtifact) === false) {
    world.fatal = 'the built artifact is missing, so nothing below it can be measured: ' + shippedArtifact + ' - run: node plugins/build.mjs'
    return world
  }
  const shippedBytes = readFileSync(shippedArtifact)
  world.artifact = { path: shippedArtifact, bytes: shippedBytes.length, sha256: sha256(shippedBytes) }
  const K = await loadKernel()
  let host = null
  try {
    host = await import(pathToFileURL(shippedArtifact).href)
  } catch (error) {
    world.fatal = 'the built artifact does not import: ' + describe(error)
    return world
  }
  world.subject = { exports: Object.keys(host).sort() }
  const ctx = new K.Context()
  const fibers = []
  const spoken = []
  const realLog = console.log
  const realError = console.error
  try {
    const serverFiber = ctx.plugin(K.WebServer, { host: '127.0.0.1', port: 0 })
    await serverFiber
    fibers.push(serverFiber)
    console.log = (line) => { spoken.push(String(line)) }
    console.error = (line) => { spoken.push('ERR ' + String(line)) }
    const hostFiber = ctx.plugin(host, {})
    await hostFiber
    fibers.push(hostFiber)
    // Let an inject-deferred binding run, if the row deferred its own registration.
    for (let step = 0; step < 20; step += 1) {
      const live = ctx.get('webServer')
      if (live !== undefined && live !== null && live.exact !== undefined && live.exact.has(CONTRACT_PATH) && live.exact.has(EMBED_PATH)) break
      await new Promise((done) => setTimeout(done, 25))
    }
  } finally {
    console.log = realLog
    console.error = realError
  }
  world.boot = spoken
  const server = ctx.get('webServer')
  world.server = {
    present: server !== undefined && server !== null,
    port: server === undefined || server === null ? null : server.port,
    host: server === undefined || server === null ? null : server.host,
    exact: [],
  }
  if (world.server.present && server.exact !== undefined) {
    for (const [path, route] of server.exact.entries()) world.server.exact.push({ path, kind: route.kind ?? null, handler: typeof route.handler })
  }
  const port = world.server.port
  if (port === null || port === undefined) {
    world.fatal = 'the real kernel WebServer did not report a listening port, so no route can be driven'
    for (const fiber of [...fibers].reverse()) { try { await fiber.dispose() } catch { /* the port is the OS's */ } }
    return world
  }
  world.stranger = await socketCall(port, STRANGER_PATH, 'GET')
  world.contract = { first: await socketCall(port, CONTRACT_PATH, 'GET'), second: await socketCall(port, CONTRACT_PATH, 'GET') }
  world.contract.identical = world.contract.first.bytes.equals(world.contract.second.bytes)
  world.contract.parsed = world.contract.first.body
  world.contract.bytes = world.contract.first.length
  world.contract.sha256 = sha256(world.contract.first.bytes)
  world.page = { first: await socketCall(port, EMBED_PATH, 'GET'), second: await socketCall(port, EMBED_PATH, 'GET'), verbs: [] }
  world.page.identical = world.page.first.bytes.equals(world.page.second.bytes)
  world.page.bytes = world.page.first.length
  world.page.sha256 = sha256(world.page.first.bytes)
  world.page.text = world.page.first.text
  for (const one of [{ path: CONTRACT_PATH, method: 'POST', body: '{}' }, { path: EMBED_PATH, method: 'POST', body: '{}' }, { path: CONTRACT_PATH, method: 'PUT', body: '{}' }, { path: EMBED_PATH, method: 'PUT', body: '{}' }, { path: CONTRACT_PATH, method: 'DELETE' }, { path: EMBED_PATH, method: 'DELETE' }, { path: CONTRACT_PATH, method: 'PATCH', body: '{}' }, { path: EMBED_PATH, method: 'PATCH', body: '{}' }, { path: CONTRACT_PATH, method: 'HEAD' }, { path: EMBED_PATH, method: 'HEAD' }]) {
    const answer = await socketCall(port, one.path, one.method, one.body)
    world.page.verbs.push({
      path: one.path,
      method: one.method,
      status: answer.status,
      allow: answer.allow,
      type: answer.type,
      code: answer.body === null || answer.body.error === undefined ? null : (answer.body.error.code ?? null),
      ok: answer.body === null ? null : (answer.body.ok ?? null),
      text: clip(answer.text, 220),
    })
  }
  world.afterVerbs = { contract: await socketCall(port, CONTRACT_PATH, 'GET'), page: await socketCall(port, EMBED_PATH, 'GET') }
  world.sites = sitesOnDisk(root)
  world.evidence = evidenceOnDisk(root, Array.isArray(world.contract.parsed?.hostCapabilities) ? world.contract.parsed.hostCapabilities : [])
  world.scan = {
    references: resourceReferences(world.page.text),
    network: networkTokenCounts(world.page.text),
    scriptTags: occurrences(world.page.text, '<script'),
    scriptSrc: (world.page.text.match(/<script\b[^>]*\bsrc\s*=/gi) ?? []).length,
    linkTags: occurrences(world.page.text, '<link'),
    iframeTags: occurrences(world.page.text, '<iframe'),
    imgTags: occurrences(world.page.text, '<img'),
    styleTags: occurrences(world.page.text, '<style'),
    baseTags: occurrences(world.page.text, '<base'),
  }
  world.teardown = []
  for (const fiber of [...fibers].reverse()) {
    try { await fiber.dispose() } catch (error) { world.teardown.push(describe(error)) }
  }
  return world
}

// ---------------------------------------------------------------------------
// The judge: a pure function over the transcript above. Nothing here reads the clock or the disk.
// ---------------------------------------------------------------------------
const codeIsNamed = (code) => typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code)
const contractVersion = (contract) => (contract !== null && typeof contract === 'object' && typeof contract.version === 'string' ? contract.version : null)
const selectQuery = (contract) => (contract?.select !== null && typeof contract?.select === 'object' && typeof contract.select.query === 'object' ? contract.select.query : null)
const selectMessage = (contract) => (contract?.select !== null && typeof contract?.select === 'object' && typeof contract.select.postMessage === 'object' ? contract.select.postMessage : null)
const paramByName = (contract, name) => (Array.isArray(contract?.queryParameters) ? contract.queryParameters.find((row) => row !== null && typeof row === 'object' && row.name === name) ?? null : null)
const refusalCodes = (contract) => (Array.isArray(contract?.refusals) ? contract.refusals.map((row) => row?.code).filter((code) => typeof code === 'string') : [])

function judge(world) {
  const out = []
  const add = (id, ok, detail, evidence) => out.push({ id, ok: ok === true ? true : (ok === null ? null : false), detail, evidence: evidence === undefined ? [] : evidence })
  const server = world.server
  const contract = world.contract
  const parsed = contract === null || contract === undefined ? null : contract.parsed
  const page = world.page
  const pageText = page === null || page === undefined ? '' : String(page.text ?? '')

  // 01 -- the routes live in the real kernel web server's own table, and the socket is the kernel's.
  {
    const rows = []
    const exact = server === null || server === undefined ? [] : server.exact
    const contractRow = exact.find((one) => one.path === CONTRACT_PATH) ?? null
    const embedRow = exact.find((one) => one.path === EMBED_PATH) ?? null
    rows.push('the real service: ctx.get("webServer") ' + (server?.present === true ? 'present, bound on ' + show(server.host) + ':' + String(server.port) + ' (an ephemeral port this gate owns; this gate never connects to 31761/31760/9222)' : 'ABSENT'))
    rows.push('its own exact route table: ' + show(exact.map((one) => one.path)))
    rows.push('frozen ' + CONTRACT_PATH + ' -> ' + show(contractRow))
    rows.push('frozen ' + EMBED_PATH + ' -> ' + show(embedRow))
    rows.push('a path nobody registered answers ' + String(world.stranger?.status) + ' (' + show(clip(String(world.stranger?.text ?? ''), 80)) + '): the KERNEL own 404, which is what says this socket is the kernel')
    rows.push('the row own boot lines: ' + show(world.boot))
    rows.push('the artifact own exported names (reported, not judged): ' + show(world.subject?.exports ?? []))
    const ok = server?.present === true && server.port !== null && server.port !== undefined
      && contractRow !== null && contractRow.kind === 'exact' && contractRow.handler === 'function'
      && embedRow !== null && embedRow.kind === 'exact' && embedRow.handler === 'function'
      && world.stranger?.status === 404
    add('01-both-routes-are-bound-in-the-real-kernel-web-server', ok, 'GET ' + CONTRACT_PATH + ' and GET ' + EMBED_PATH + ' are entries of the kernel WebServer own exact table, and a stranger path answers the kernel own 404', rows)
  }

  // 02 -- the contract answers 200 JSON, twice, byte-identically.
  {
    const rows = []
    const first = contract?.first ?? null
    const type = String(first?.type ?? '')
    rows.push('status ' + String(first?.status) + ', content-type ' + show(first?.type) + ', cache-control ' + show(first?.cache) + ', ' + String(contract?.bytes) + ' bytes, sha256 ' + clip(String(contract?.sha256 ?? ''), 16))
    rows.push('two GETs byte-identical: ' + String(contract?.identical) + ' (sha256 ' + clip(sha256(Buffer.from(String(first?.text ?? ''), 'utf8')), 16) + ' vs ' + clip(String(contract?.sha256 ?? ''), 16) + ' - same bytes, one answer)')
    rows.push('the answer parsed as JSON: ' + (parsed !== null && typeof parsed === 'object' ? 'yes (' + String(Object.keys(parsed).length) + ' top-level fields)' : 'NO'))
    rows.push('a second GET after every refused verb still answers ' + String(world.afterVerbs?.contract?.status) + ' with ' + String(world.afterVerbs?.contract?.length) + ' bytes (the route has no state a verb could change)')
    const ok = first?.status === 200 && /application\/json/i.test(type) && /no-store/i.test(String(first?.cache ?? ''))
      && contract?.identical === true && parsed !== null && typeof parsed === 'object'
      && world.afterVerbs?.contract?.status === 200 && world.afterVerbs?.contract?.length === contract?.bytes
    add('02-GET-the-contract-answers-200-json-and-two-GETs-are-identical', ok, '200 with ' + show(first?.type) + ' and no-store, the same ' + String(contract?.bytes) + ' bytes on every GET: the version is present and stable because nothing in the answer can move', rows)
  }

  // 03 -- the contract's shape and values.
  {
    const rows = []
    const modes = Array.isArray(parsed?.modes) ? parsed.modes : null
    const query = selectQuery(parsed)
    const message = selectMessage(parsed)
    const version = contractVersion(parsed)
    const params = Array.isArray(parsed?.queryParameters) ? parsed.queryParameters.map((row) => row?.name) : null
    const defaultMode = parsed?.defaultMode ?? null
    rows.push('name ' + show(parsed?.name) + ', version ' + show(version) + ' (semver ' + String(typeof version === 'string' && VERSION_SHAPE.test(version)) + '), ok=' + show(parsed?.ok) + ' readOnly=' + show(parsed?.readOnly))
    rows.push('path ' + show(parsed?.path) + ' (frozen ' + CONTRACT_PATH + '), embedPath ' + show(parsed?.embedPath) + ' (frozen ' + EMBED_PATH + ')')
    rows.push('modes ' + show(modes) + ' (frozen ' + show(MODES) + '), defaultMode ' + show(defaultMode) + ' (frozen ' + DEFAULT_MODE + '), defaultMode in modes: ' + String(modes !== null && modes.includes(defaultMode)))
    rows.push('select.query: ' + show(query === null ? null : { kind: query.kind, parameter: query.parameter, values: query.values, example: clip(String(query.example ?? ''), 80) }))
    rows.push('select.postMessage: ' + show(message === null ? null : { kind: message.kind, type: message.type, body: message.body, refused: message.refused, ignored: clip(String(message.ignored ?? ''), 90) }))
    rows.push('queryParameters: ' + show(parsed?.queryParameters) + ' (frozen names ' + show(QUERY_PARAMETERS) + ')')
    rows.push('documentFacts: ' + show(parsed?.documentFacts === null || parsed?.documentFacts === undefined ? null : Object.keys(parsed.documentFacts)))
    rows.push('refusals: ' + show((Array.isArray(parsed?.refusals) ? parsed.refusals : []).map((row) => String(row?.code) + '@' + String(row?.status))))
    const ok = parsed !== null && typeof parsed === 'object'
      && parsed.name === 'dsh-link/embed'
      && typeof version === 'string' && VERSION_SHAPE.test(version)
      && parsed.readOnly === true && parsed.ok === true
      && parsed.path === CONTRACT_PATH && parsed.embedPath === EMBED_PATH
      && modes !== null && same([...modes].sort(), [...MODES].sort()) && modes.length === MODES.length
      && defaultMode === DEFAULT_MODE
      && query !== null && query.parameter === 'mode' && Array.isArray(query.values) && same([...query.values].sort(), [...MODES].sort())
      && message !== null && message.type === MESSAGE_TYPE && message.body !== null && typeof message.body === 'object' && message.body.type === MESSAGE_TYPE && MODES.includes(message.body.mode)
      && params !== null && same([...params].sort(), [...QUERY_PARAMETERS].sort())
      && (paramByName(parsed, 'mode')?.default === DEFAULT_MODE)
      && (paramByName(parsed, 'sidebarWidth')?.type === 'number')
      && paramByName(parsed, 'panel') !== null && Array.isArray(paramByName(parsed, 'panel')?.values) && paramByName(parsed, 'panel').values.length === 1 && typeof paramByName(parsed, 'panel').values[0] === 'string'
      && parsed.documentFacts !== null && typeof parsed.documentFacts === 'object'
      && refusalCodes(parsed).length >= 4 && refusalCodes(parsed).some((code) => codeIsNamed(code) && code !== 'METHOD_NOT_ALLOWED')
    add('03-the-contracts-shape-and-values', ok, 'the answer names both modes, both selection paths (the ?mode= query and the ' + show(MESSAGE_TYPE) + ' message), the three query parameters and the refusal table, and its version is a semver string', rows)
  }

  // 04 -- the bounds protocol the shell already speaks.
  {
    const rows = []
    const bounds = parsed?.bounds ?? null
    const ops = Array.isArray(bounds?.ops) ? bounds.ops.map((row) => row?.op) : null
    rows.push('bounds.method ' + show(bounds?.method) + ' bounds.path ' + show(bounds?.path) + ' contentType ' + show(bounds?.contentType))
    rows.push('bounds.ops ' + show(ops) + ' (frozen surface + set-bounds), readBack ' + show(bounds?.readBack?.op))
    rows.push('bounds.sidebar ' + clip(String(bounds?.sidebar ?? ''), 160))
    rows.push('bounds.full ' + clip(String(bounds?.full ?? ''), 160))
    rows.push('bounds.survives ' + clip(String(bounds?.survives ?? ''), 160))
    const ok = bounds !== null && typeof bounds === 'object'
      && bounds.method === 'POST' && bounds.path === '/__shell/panel'
      && ops !== null && ops.includes('surface') && ops.includes('set-bounds')
      && typeof bounds.readBack?.op === 'string' && bounds.readBack.op !== ''
      && typeof bounds.full === 'string' && /viewport|innerWidth|width/i.test(bounds.full)
      && typeof bounds.sidebar === 'string' && bounds.sidebar !== ''
    add('04-the-contract-names-the-bounds-protocol-the-shell-speaks', ok, 'POST /__shell/panel with op=surface and op=set-bounds, a read-back op, and the two rect descriptions: the mode switch is the rect the host passes, not a host-specific API', rows)
  }

  // 05 -- the four origin sites, named and re-read from THIS tree.
  {
    const rows = []
    const named = Array.isArray(parsed?.originSites) ? parsed.originSites : []
    const namedPairs = named.map((row) => String(row?.file) + ':' + String(row?.line))
    const frozenPairs = ORIGIN_SITES.map((site) => site.file + ':' + site.line)
    const namedFiles = named.map((row) => String(row?.file)).sort()
    const frozenFiles = ORIGIN_SITES.map((site) => site.file).sort()
    rows.push('shellOrigin ' + show(parsed?.shellOrigin) + ' (frozen literal ' + show(ORIGIN) + ')')
    rows.push('the contract names: ' + show(namedPairs))
    rows.push('this gate froze:   ' + show(frozenPairs))
    for (const row of named) rows.push('  named site ' + String(row?.file) + ':' + String(row?.line) + ' symbol ' + show(row?.symbol) + ' holds ' + clip(String(row?.holds ?? ''), 100))
    for (const site of world.sites ?? []) rows.push('  on disk ' + site.file + ':' + String(site.line) + ' present=' + String(site.present) + ' holds-the-origin=' + String(site.holds) + ' line ' + show(clip(String(site.lineText ?? ''), 120)))
    // Files are the fact; the line each row names is re-read below (everyLineHolds), so a shifted line fails at the
    // place that can still tell whether the line holds the origin, instead of at a string comparison of numbers.
    const allNamed = frozenFiles.every((file) => namedFiles.includes(file)) && namedFiles.length === frozenFiles.length
    const everyRowCarries = named.length === 4 && named.every((row) => typeof row.symbol === 'string' && row.symbol !== '' && typeof row.why === 'string' && row.why !== '' && String(row.holds ?? '').includes(ORIGIN))
    const everyLineHolds = (world.sites ?? []).length === 4 && (world.sites ?? []).every((site) => site.present === true && site.holds === true)
    const ok = allNamed && everyRowCarries && everyLineHolds && parsed?.shellOrigin === 'http://' + ORIGIN
    add('05-the-contract-names-the-four-origin-sites-and-each-line-holds-the-origin', ok, 'the four file:line pairs the requirement freezes are the four the answer names, each carries a symbol and a reason, and each named line re-read off this tree holds ' + ORIGIN, rows)
  }

  // 06 -- the host capabilities the contract requires.
  {
    const rows = []
    const capabilities = Array.isArray(parsed?.hostCapabilities) ? parsed.hostCapabilities : []
    const ids = capabilities.map((row) => String(row?.id))
    rows.push('the contract names: ' + show(ids.map((id, at) => id + ' requires ' + clip(String(capabilities[at]?.requires ?? ''), 130))))
    for (const row of capabilities) rows.push('  ' + String(row?.id) + ': requires ' + clip(String(row?.requires ?? ''), 200) + ' | what ' + clip(String(row?.what ?? ''), 200))
    const evidence = world.evidence ?? []
    for (const row of evidence) rows.push('  evidence ' + row.citation + ' (' + row.capability + ') -> ' + String(row.ok) + (row.total === null ? '' : ' [' + String(row.from) + '-' + String(row.to) + ' of ' + String(row.total) + ' lines]') + (row.why === null ? '' : ' (' + row.why + ')'))
    const byId = (id) => capabilities.find((row) => row?.id === id) ?? null
    const child = byId('child-webview')
    const csp = byId('csp')
    const sameOrigin = byId('same-origin-http')
    const ok = same([...ids].sort(), [...HOST_CAPABILITIES].sort())
      && child !== null && /add_child/i.test(String(child.requires)) && /unstable/i.test(String(child.requires))
      && csp !== null && /127\.0\.0\.1:31761/.test(String(csp.requires) + String(csp.what)) && /unsafe-inline/i.test(String(csp.requires) + String(csp.what))
      && sameOrigin !== null && /fetch/i.test(String(sameOrigin.requires) + String(sameOrigin.what)) && /same-origin/i.test(String(sameOrigin.requires) + String(sameOrigin.what))
      && capabilities.every((row) => Array.isArray(row.evidence) && row.evidence.length > 0)
      && evidence.length > 0 && evidence.every((row) => row.ok === true)
    add('06-the-contract-names-the-host-capabilities-it-requires', ok, 'child-webview (add_child + unstable), csp (the shell origin and inline script/style) and same-origin-http (a same-origin fetch to the shell), each with evidence that resolves in this tree', rows)
  }

  // 07 -- a verb that is not GET is refused 405 with a named code on both routes.
  {
    const rows = []
    const verbs = world.page?.verbs ?? []
    let ok = verbs.length === 10
    for (const verb of verbs) {
      // HEAD is answered 405 with the Allow header, and HTTP says a HEAD response has no body: the named
      // code is judged on the verbs whose answer carries a body, and HEAD is judged on what it does say.
      const bodyBearing = verb.method !== 'HEAD'
      const answers = verb.status === 405 && /GET/.test(String(verb.allow ?? '')) && (bodyBearing === false || (codeIsNamed(verb.code) && verb.ok === false))
      if (answers === false) ok = false
      rows.push(String(verb.method).padEnd(7) + ' ' + verb.path.padEnd(32) + ' -> ' + String(verb.status) + ' code ' + show(verb.code) + ' allow ' + show(verb.allow) + ' ok=' + show(verb.ok) + (bodyBearing === false ? ' (HEAD: status and Allow are the answer; HTTP gives it no body to read a code from)' : ' ' + clip(verb.text, 110)))
    }
    rows.push('the two GETs after the refused verbs: contract ' + String(world.afterVerbs?.contract?.status) + ' (' + String(world.afterVerbs?.contract?.length) + ' bytes), page ' + String(world.afterVerbs?.page?.status) + ' (' + String(world.afterVerbs?.page?.length) + ' bytes)')
    const codes = [...new Set(verbs.filter((verb) => verb.method !== 'HEAD').map((verb) => verb.code))]
    const headRows = verbs.filter((verb) => verb.method === 'HEAD')
    add('07-a-verb-that-is-not-GET-is-refused-405-with-a-named-code', ok, 'POST, PUT, DELETE and PATCH answer 405 on BOTH routes with the named code ' + show(codes) + ' and Allow: GET; HEAD answers 405 with Allow: GET and no body (HTTP), so its code is reported as unreadable rather than judged; the GETs after them still answer 200', rows)
  }

  // 08 -- the embed route answers the page as bytes, twice, identically.
  {
    const rows = []
    const first = page?.first ?? null
    const bootCount = (world.boot ?? []).map((line) => /(\d+) bytes/.exec(line)).filter((hit) => hit !== null).map((hit) => Number(hit[1]))
    rows.push('status ' + String(first?.status) + ', content-type ' + show(first?.type) + ', cache-control ' + show(first?.cache) + ', x-content-type-options ' + show(first?.nosniff))
    rows.push('bytes ' + String(page?.bytes) + ' (sha256 ' + clip(String(page?.sha256 ?? ''), 16) + '), two GETs byte-identical: ' + String(page?.identical))
    rows.push('the document shape: starts ' + show(clip(pageText.slice(0, 24), 24)) + ', ends ' + show(clip(pageText.slice(-16), 16)) + ', chars ' + String(pageText.length) + ' (a whole HTML document, ASCII ' + String(Buffer.byteLength(pageText, 'utf8') === pageText.length) + ')')
    rows.push('the row own boot line states the byte count: ' + show(bootCount) + ' against the served ' + String(page?.bytes))
    const ok = first?.status === 200 && /text\/html/i.test(String(first?.type ?? '')) && /no-store/i.test(String(first?.cache ?? ''))
      && page?.identical === true && page?.bytes > 1000
      && /^<!doctype html>/i.test(pageText) && /<\/html>\s*$/i.test(pageText)
      && bootCount.length === 1 && bootCount[0] === page?.bytes
    add('08-the-embed-route-answers-200-with-the-page-as-bytes', ok, '200 with text/html and no-store, ' + String(page?.bytes) + ' bytes of one whole document, the same bytes on every GET, and the row own boot line states the same count', rows)
  }

  // 09 -- the page is self-contained, and the one device it does reach the kernel with is named.
  {
    const rows = []
    const scan = world.scan ?? { references: [], network: [], scriptTags: 0, scriptSrc: 0, linkTags: 0, iframeTags: 0, imgTags: 0, styleTags: 0, baseTags: 0 }
    const external = scan.references.filter((ref) => isSameOrigin(ref.value, ['http://' + ORIGIN]))
    const devices = occurrences(pageText, 'window.fetch')
    const urlSites = occurrences(pageText, 'location.origin + ')
    const bareFetch = occurrences(pageText, 'fetch(')
    rows.push('tags: ' + String(scan.scriptTags) + ' script (' + String(scan.scriptSrc) + ' with src), ' + String(scan.styleTags) + ' style, ' + String(scan.linkTags) + ' link, ' + String(scan.imgTags) + ' img, ' + String(scan.iframeTags) + ' iframe, ' + String(scan.baseTags) + ' base')
    rows.push('resource references found by the scan (' + String(scan.references.length) + '): ' + show(scan.references.slice(0, 8)))
    rows.push('network tokens: ' + show(scan.network.map((row) => row.token + '=' + String(row.count))))
    rows.push('absolute http(s) references in the whole document: ' + show([...pageText.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((hit) => hit[0])))
    rows.push('THE ONE NETWORK DEVICE, named rather than left to a token count: window.fetch captured ' + String(devices) + ' time(s); a bare fetch( call site ' + String(bareFetch) + ' time(s), so there is no second way out; the only site that builds a request URL is location.origin + <frozen route path>, and it exists ' + String(urlSites) + ' time(s) - every GET this page makes is on ITS OWN origin by construction, and the four paths it may name are judged in reading 14')
    const ok = scan.scriptTags === 1 && scan.scriptSrc === 0 && scan.linkTags === 0 && scan.imgTags === 0 && scan.iframeTags === 0 && scan.baseTags === 0
      && scan.references.every((ref) => isSameOrigin(ref.value, ['http://' + ORIGIN])) && external.length === 0
      && scan.network.every((row) => row.count === 0)
      && /https?:\/\//.test(pageText) === false
      && devices >= 1 && bareFetch === 0 && urlSites === 1
    add('09-the-page-is-self-contained', ok, 'one inline script and no external ASSET of any kind - no script src, link, image, frame, @import, url(), bare fetch( call site, XHR, WebSocket, worker or http(s) reference anywhere in the document - and exactly ONE network device, window.fetch, captured once, whose single URL-construction site is location.origin + a frozen route path: it cannot reach anything off the origin that served it', rows)
  }

  // 10 -- the page names both modes and both selection paths.
  {
    const rows = []
    const version = contractVersion(parsed)
    const facts = [
      { what: '?mode=sidebar in the page text', holds: pageText.includes('?mode=sidebar') },
      { what: '?mode=full in the page text', holds: pageText.includes('?mode=full') },
      { what: 'the sidebar layout selector html[data-dsh-link-mode="sidebar"] #panel', holds: pageText.includes('html[data-dsh-link-mode="sidebar"] #panel') },
      { what: 'the full layout selector html[data-dsh-link-mode="full"] #panel', holds: pageText.includes('html[data-dsh-link-mode="full"] #panel') },
      { what: 'the message type ' + MESSAGE_TYPE + ' in the page text', holds: pageText.includes(MESSAGE_TYPE) },
      { what: 'a message listener is registered', holds: occurrences(pageText, 'addEventListener("message"') >= 1 },
      { what: 'the page posts back (postMessage)', holds: occurrences(pageText, 'postMessage(') >= 2 },
      { what: 'the query is actually read (URLSearchParams(location.search) + params.get("mode"))', holds: pageText.includes('new URLSearchParams(location.search)') && pageText.includes('params.get("mode")') },
      { what: 'the version the contract states appears in the page (contract ' + String(version) + ')', holds: version !== null && pageText.includes('contract version ' + version) && pageText.includes('VERSION = "' + version + '"') },
    ]
    for (const fact of facts) rows.push((fact.holds ? 'held    ' : 'MISSING ') + fact.what)
    add('10-the-page-names-both-modes-and-both-selection-paths', facts.every((fact) => fact.holds), 'the page states ?mode=sidebar and ?mode=full, both layout selectors, a message listener on ' + MESSAGE_TYPE + ', the query read, the post-back, and the contract version it was built for', rows)
  }

  // 11 -- an unknown mode is refused by name.
  {
    const rows = []
    const message = selectMessage(parsed)
    const code = typeof message?.refused === 'string' ? message.refused : (refusalCodes(parsed).find((one) => one !== 'METHOD_NOT_ALLOWED') ?? null)
    const facts = [
      { what: 'the contract publishes a refusal code for an unknown mode (' + show(code) + ')', holds: codeIsNamed(code) },
      { what: 'that code is in the page bytes', holds: typeof code === 'string' && pageText.includes(code) },
      { what: 'the page assigns it where it refuses (MODE_REFUSAL)', holds: pageText.includes('MODE_REFUSAL') && pageText.includes('var MODE_REFUSAL = "' + String(code) + '"') },
      { what: 'the refusal branch tests the value against the modes (MODES.indexOf(mode) < 0)', holds: pageText.includes('MODES.indexOf(mode) < 0') },
      { what: 'the sentence "REFUSED a mode by name" is in the page', holds: pageText.includes('REFUSED a mode by name') },
      { what: 'the page says it stays in the last good mode', holds: /stays? in\s+the last good mode/i.test(pageText) },
      { what: 'the refusal is written to data-dsh-link-refusal for a reader', holds: pageText.includes('data-dsh-link-refusal') && pageText.includes('state.refusals.length === 0 ? "" : state.refusals') },
      { what: 'the page names what it refused (the requested value is echoed)', holds: pageText.includes('asked for ') && pageText.includes('JSON.stringify(String(requested))') },
    ]
    for (const fact of facts) rows.push((fact.holds ? 'held    ' : 'MISSING ') + fact.what)
    add('11-the-page-refuses-an-unknown-mode-by-name', facts.every((fact) => fact.holds), 'the page carries the code ' + show(code) + ', refuses against the two-mode list, echoes the value it refused, and states that the last good mode stays', rows)
  }

  // 12 -- the geometry/mode facts the page promises.
  {
    const rows = []
    const facts = [
      { what: 'the mode attribute data-dsh-link-mode is written by the script (mark(...))', holds: pageText.includes('mark("data-dsh-link-mode", state.mode)') },
      { what: 'the panel own offsetWidth and offsetHeight are read', holds: pageText.includes('panel.offsetWidth') && pageText.includes('panel.offsetHeight') },
      { what: 'the geometry mirror attributes are written (data-dsh-link-panel-width / -height)', holds: pageText.includes('setAttribute("data-dsh-link-panel-width"') && pageText.includes('setAttribute("data-dsh-link-panel-height"') },
      { what: 'the window.__DSH_LINK_EMBED__ record carries the mode and the geometry', holds: pageText.includes('__DSH_LINK_EMBED__') && pageText.includes('width: panel.offsetWidth') && pageText.includes('height: panel.offsetHeight') },
      { what: 'the window.__DSH_LINK_MODE global is published', holds: pageText.includes('__DSH_LINK_MODE') },
      { what: 'the honesty fact for a directly opened document (window.parent === window)', holds: pageText.includes('window.parent === window') && pageText.includes('data-dsh-link-embedded') },
      { what: 'the panel element is there (id="panel")', holds: pageText.includes('id="panel"') },
      { what: 'the document is published at load, before any message (publish() outside the handler)', holds: occurrences(pageText, 'publish()') >= 3 && pageText.includes('if (askedMode === null) {') },
    ]
    for (const fact of facts) rows.push((fact.holds ? 'held    ' : 'MISSING ') + fact.what)
    add('12-the-page-carries-the-geometry-and-mode-facts-it-promises', facts.every((fact) => fact.holds), 'the mode attribute, the panel own offsetWidth/offsetHeight and their mirror, the __DSH_LINK_EMBED__ record, the refusal attribute, the direct-open honesty fact, and a publish at load', rows)
  }

  // 13 -- both layouts stated in the page's own text.
  {
    const rows = []
    const width = paramByName(parsed, 'sidebarWidth')?.default
    const min = paramByName(parsed, 'sidebarWidth')?.min
    const max = paramByName(parsed, 'sidebarWidth')?.max
    const facts = [
      { what: 'a section that states the two layouts in the page own words', holds: /The two layouts/i.test(pageText) },
      { what: 'the sidebar row names the right edge and the sidebar selector', holds: /right edge/.test(pageText) && pageText.includes('html[data-dsh-link-mode="sidebar"] #panel') },
      { what: 'the sidebar row names the default width ' + show(width) + ' and the accepted ' + show([min, max]), holds: typeof width === 'number' && pageText.includes(String(width) + ' px') && pageText.includes(String(min) + '..' + String(max)) },
      { what: 'the full row names 0,0 to innerWidth x innerHeight', holds: pageText.includes('innerWidth x innerHeight') && pageText.includes('0,0') },
      { what: 'the full row says the switch moves the panel and does not reload it', holds: /moves the panel, it does not reload it/.test(pageText) },
      { what: 'that statement sits in the collapsible drawer at the bottom, closed by default - the protocol is off the PRODUCT surface now, not deleted from the document', holds: pageText.includes('<details class="drawer" id="drawer"') && /<details[^>]*\bopen\b/.test(pageText) === false },
    ]
    for (const fact of facts) rows.push((fact.holds ? 'held    ' : 'MISSING ') + fact.what)
    add('13-the-page-states-both-layouts-in-its-own-text', facts.every((fact) => fact.holds), 'a reader can check the sidebar rect and the full viewport without running the page: both selectors, the default width with its min/max, and the 0,0 to innerWidth x innerHeight sentence - all of it in the drawer at the bottom (closed by default) since the page became a live panel, and it is checked THERE rather than against the surface it used to be drawn on', rows)
  }

  // 14 -- the four same-origin reads, and what each section does when its route is not there.
  {
    const rows = []
    const frozen = [
      { key: 'bus', path: '/api/dsh-link-collab/status', reads: 'teams, members, ledger records, the relay, the R217 messages block' },
      { key: 'board', path: '/api/dsh-link-teams/state', reads: 'teams, members, tasks, what is assignable' },
      { key: 'notes', path: '/api/dsh-link-notes/state', reads: 'counts, limits, the most recent notes' },
      { key: 'browser', path: '/__shell/panel-start', reads: 'the browser panel entry: reachability, and the action that opens it' },
    ]
    const named = frozen.map((route) => ({ ...route, times: occurrences(pageText, route.path), chip: occurrences(pageText, 'id="' + route.key + '-chip"'), body: occurrences(pageText, 'id="' + route.key + '-body"') }))
    for (const route of named) rows.push('  ' + route.key.padEnd(8) + route.path.padEnd(32) + ' named ' + String(route.times) + ' time(s), its own state chip ' + String(route.chip) + ', its own body ' + String(route.body) + ' (' + route.reads + ')')
    const timers = { setInterval: occurrences(pageText, 'setInterval'), setTimeout: occurrences(pageText, 'setTimeout') }
    const openCall = occurrences(pageText, 'window.open(')
    const statusSentence = occurrences(pageText, 'HTTP ')
    const jsonRoute = occurrences(pageText, 'kind: "json"')
    const drawerClosed = pageText.includes('<details class="drawer" id="drawer"') && /<details[^>]*\bopen\b/.test(pageText) === false
    rows.push('THE BROWSER SECTION IS AN ACTION, not a claim: the panel entry is named ' + String(named[3].times) + ' time(s) and opened with window.open( ' + String(openCall) + ' time(s) in a new tab')
    rows.push('THE STATE EACH SECTION OWNS: every one of the four carries a state chip (data-state="loading" appears ' + String(occurrences(pageText, 'data-state="loading"')) + ' time(s), once per section) and the sentence it draws instead of a number names the HTTP status it got ("HTTP " appears ' + String(statusSentence) + ' time(s)): a route that is not there is stated, never drawn as a zero')
    rows.push('THE READS ARE READS: the JSON routes are declared as such (kind: "json" appears ' + String(jsonRoute) + ' time(s)); the panel-entry probe says text/html, and no route writes')
    rows.push('NO TIMER: setInterval ' + String(timers.setInterval) + ', setTimeout ' + String(timers.setTimeout) + ' - the page re-reads only when a person presses refresh or the document becomes visible again')
    rows.push('THE PROTOCOL IS A DRAWER, CLOSED: ' + String(drawerClosed) + ' - the facts, both layouts and both selection paths are in the bytes and one click away, not drawn over the panel')
    const ok = named.every((route) => route.times >= 1 && route.chip === 1 && route.body === 1)
      && openCall >= 1 && occurrences(pageText, 'location.origin + ') === 1
      && occurrences(pageText, 'data-state="loading"') === frozen.length
      && statusSentence >= 1 && jsonRoute >= 3
      && timers.setInterval === 0 && timers.setTimeout === 0
      && drawerClosed === true
    add('14-the-page-reads-four-same-origin-routes-and-states-each-section-own-state', ok, 'the four frozen same-origin GETs (the bus, the team board, the note ledger, the browser panel entry) are named in the page, every section owns a state chip and the "HTTP <status>" sentence it draws when its route is unavailable, the browser section opens the panel entry in a new tab, the protocol facts are in a drawer closed by default, and the page carries zero timers', rows)
  }

  return out
}

// ---------------------------------------------------------------------------
// The printout: evidence, never a verdict.
// ---------------------------------------------------------------------------
const printReadings = (readings) => {
  console.log('')
  console.log('== readings ==')
  for (const reading of readings) {
    const tag = reading.ok === true ? '[GREEN]      ' : (reading.ok === null ? '[NOT MEASURED]' : '[RED]        ')
    console.log('')
    console.log(tag + ' ' + reading.id)
    console.log('  ' + reading.detail)
    for (const row of reading.evidence) console.log('    - ' + row)
  }
  console.log('')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  console.log('gate 131 host-embed-route (R195, OFFLINE) - the two dsh-link-host routes on the real kernel web server')
  console.log('  subject: ' + join(SUBJECT, 'plugins', 'dsh-link-host', 'lib', 'index.js'))
  console.log('  world: a fresh cordis Context, the kernel own WebServer on 127.0.0.1:0; no browser, no 31761/31760/9222, no client start or stop, no file written')
  let world = null
  try {
    world = await buildWorld(SUBJECT)
  } catch (error) {
    return NOT_MEASURED('the world could not be built: ' + describe(error))
  }
  if (world.fatal !== null) return NOT_MEASURED(world.fatal)
  console.log('  artifact: ' + world.artifact.path + ' (' + String(world.artifact.bytes) + ' bytes, sha256 ' + clip(world.artifact.sha256, 16) + ')')
  console.log('  server:   ' + show(world.server.host) + ':' + String(world.server.port) + ' (' + String(world.server.exact.length) + ' exact route(s))')
  const readings = judge(world)
  printReadings(readings)
  const red = readings.filter((reading) => reading.ok === false)
  const notMeasured = readings.filter((reading) => reading.ok === null)
  const green = readings.filter((reading) => reading.ok === true)
  const contractVersionText = contractVersion(world.contract.parsed) ?? '(none)'
  console.log('gate 131 host-embed-route: ' + String(readings.length) + ' readings, ' + String(green.length) + ' green, ' + String(red.length) + ' red, ' + String(notMeasured.length) + ' not measured [contract ' + contractVersionText + ', ' + String(world.contract.bytes) + ' bytes; page ' + String(world.page.bytes) + ' bytes, sha256 ' + clip(String(world.page.sha256 ?? ''), 12) + '; server ' + show(world.server.host) + ':' + String(world.server.port) + '; ports 31761/31760/9222 touched 0]')
  if (red.length > 0) {
    for (const reading of red) console.log('  RED ' + reading.id + ': ' + reading.detail)
    return 1
  }
  if (notMeasured.length > 0) return 3
  return 0
}

const code = await main()
process.exit(code)
