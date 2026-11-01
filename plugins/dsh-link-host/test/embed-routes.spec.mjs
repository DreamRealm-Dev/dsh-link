#!/usr/bin/env node
/**
 * dsh-link-host self-check (producer-owned, R195 P1).
 *
 * It measures the BUILT artifact - lib/index.js, the bytes the kernel loads - not src/:
 *
 *   node plugins/dsh-link-host/test/embed-routes.spec.mjs
 *
 * The socket is REAL and the port is EPHEMERAL: the row is mounted on a minimal ctx with a webServer
 * stub, the two routes it registered are served by node:http on port 0, and every reading below is taken
 * over that socket. Nothing here connects to 31761, 31760 or 9222 - the mounted world is the only
 * server, and its origin is printed. (The shape is plugins/dsh-link-notes/test/notes-route.spec.mjs:230-274.)
 *
 * What it must be able to FAIL on, reading by reading:
 *   S1  the exported constants are the contract paths, a semver version, and the two modes and no others
 *   S2  apply() binds exactly TWO exact-path routes, and says so on the boot lines
 *   S3  the artifact imports nothing: no node:fs, no http client, no second module. Nothing here can write.
 *   S4  the row's configured width is ONE value two artifacts read: the contract's default and the
 *       page's default move together, and an unusable configured width fails at load with the field named
 *   C1  GET contract answers 200, json, no-store
 *   C2  the contract JSON names the version, the embed path, both modes and both selection paths
 *   C3  the four origin sites are true OF THE TREE: each named file:line is read back off disk and holds
 *       127.0.0.1:31761, and the served answer lists exactly those four
 *   C4  the three host capabilities are named, each with file:line evidence
 *   C5  the bounds protocol is the shell's own: POST /__shell/panel with op=surface and op=set-bounds
 *   C6  two GETs of the contract are BYTE-IDENTICAL (no clock, no counter: the route is read-only by
 *       construction, and this is what proves the answer cannot carry a per-request value)
 *   C7  POST/PUT/DELETE/HEAD on the contract route are 405 with a named code and Allow: GET
 *   C8  the SERVED contract equals the module's own contractBody(): one shape, not two
 *   E1  GET embed answers 200, text/html, no-store, and starts with <!doctype html>
 *   E2  the page is SELF-CONTAINED and its ONE network device is named: no src=, no href=, no <link, no
 *       @import, no url(), no bare fetch( call site, no XMLHttpRequest, no import( - nothing to LOAD, and
 *       exactly one thing to call (window.fetch, captured once, given only location.origin + a route path)
 *   E3  both layouts are in the bytes: two CSS rules selected by the mode attribute, and the page's own
 *       text describes each with its numbers
 *   E4  an unknown mode is refused BY NAME in the bytes, and the bytes say the last good mode stays
 *   E5  the page reports its mode in data-dsh-link-mode AND posts it back AND sets window.__DSH_LINK_MODE
 *   E6  the page is honest about being opened directly (window.parent !== window is stated, not assumed)
 *   E7  the layout exists before any script runs: the served <html> already carries the default mode and
 *       the default width, so a URL-only host that never posts anything is served
 *   E8  two GETs of the page are byte-identical
 *   E9  POST on the embed route is 405 with a named code
 *   E10 the page and the contract cannot drift: version, mode refusal and default width are the same
 *       values in both answers
 *   P1  the page's own inline script PARSES (compiled, not run), extracted from the served bytes
 *   P2  run in a fake DOM with ?mode=full: the attribute says full and the panel is the whole viewport
 *   P3  a postMessage of mode sidebar flips it back and the panel is the sidebar width again
 *   P4  an UNKNOWN mode is refused by name in the running page, the attribute does not move, and the
 *       page says which mode it refused
 *   P5  a message of an unknown TYPE is ignored: no state change, counted as ignored
 *   P6  with NO ?mode at all the page draws sidebar and needs no message to be correct
 *   P7  with an opener, the page posts its mode back (type, mode, accepted are all checkable)
 *   P8  ?sidebarWidth= is honoured when usable and refused by name when it is not
 *
 *   L1  the page really reads: driven with an origin and a fake window.fetch, it makes exactly the FOUR
 *       frozen same-origin GETs (bus, team board, note ledger, browser panel entry), one each, all GETs,
 *       and every one of them addressed as <this document origin> + a frozen path
 *   L2  a section whose route is missing STATES it and draws no figure, and a section whose route answers
 *       draws the numbers it served: a 404 puts "HTTP 404" in that section own line and leaves its body
 *       empty, an answer puts the served counts on the card. That is the "never fake a number" rule,
 *       measured instead of promised, and no timer re-reads anything
 *
 * P2-P8 run the page's own script against a FAKE DOM, and the fake layout applies the arithmetic of the
 * two CSS rules (sidebar: the width var x the viewport height; full: the viewport x the viewport height).
 * They are readings of the PROTOCOL and of the page's own logic, not of WebView2's layout engine - a real
 * window's geometry is the live gate's job, and nothing here claims to have measured one.
 *
 * Exit: 0 every reading held; 1 a reading failed; 3 NOT MEASURED (no built artifact, or a file an origin
 * site names is gone, so no honest reading of the tree can be taken).
 */
import { createServer, request as httpRequest, Agent } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const PROJECT = resolve(PACKAGE, '..', '..')
const ARTIFACT = join(PACKAGE, 'lib', 'index.js')

const notMeasured = (why) => { console.log('NOT MEASURED: ' + why); process.exit(3) }
if (existsSync(ARTIFACT) === false) notMeasured('the built artifact is missing at ' + ARTIFACT + ' (build it: node plugins/build.mjs)')

const mod = await import(pathToFileURL(ARTIFACT).href)
const shipped = readFileSync(ARTIFACT, 'utf8')

const show = (value) => {
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : text
}
const clipText = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }

/** One row, mounted on a minimal ctx with a web server stub - the seams apply() actually reaches. */
function mountRow(config) {
  const routes = []
  const effects = []
  const server = {
    register: (route) => {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
  const ctx = {
    get: (name) => (name === 'webServer' ? server : undefined),
    provide: () => {},
    effect: (work) => { effects.push(work) },
    on: () => {},
    inject: (_names, work) => work({ get: () => undefined }),
  }
  const spoken = []
  const real = { log: console.log, error: console.error }
  console.log = (line) => { spoken.push(String(line)) }
  console.error = (line) => { spoken.push(String(line)) }
  try {
    mod.apply(ctx, config)
  } finally {
    console.log = real.log
    console.error = real.error
  }
  return {
    routes,
    spoken,
    close: async () => {
      for (const work of effects.splice(0)) {
        const dispose = work()
        if (typeof dispose === 'function') await dispose()
      }
    },
  }
}

/** Serve the bound routes over a REAL socket, at an EPHEMERAL port. */
async function serve(routes) {
  const server = createServer((req, res) => {
    const route = routes.find((entry) => entry.path === req.url)
    if (route === undefined) {
      res.statusCode = 404
      res.end('no route')
      return
    }
    void route.handler(req, res)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = 'http://127.0.0.1:' + String(server.address().port)
  const agent = new Agent({ keepAlive: false })
  const call = (method, path) => new Promise((done) => {
    const request = httpRequest(origin + path, { method, agent }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(text) } catch { parsed = null }
        done({
          status: response.statusCode,
          type: response.headers['content-type'],
          cache: response.headers['cache-control'],
          allow: response.headers.allow,
          text,
          body: parsed,
        })
      })
    })
    request.on('error', (error) => done({ status: 0, type: null, cache: null, allow: null, text: '', body: null, error: String((error && error.code) ?? (error && error.message)) }))
    request.end()
  })
  return {
    origin,
    call,
    stop: async () => {
      agent.destroy()
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise((done) => server.close(done))
    },
  }
}

/* ------------------------------------------------------------------------------------------------
 * The fake DOM: enough of a document for the page's own script, derived from the page's own bytes.
 * ---------------------------------------------------------------------------------------------- */

/** The viewport the fake layout reports. One pair of numbers, so a geometry reading is checkable. */
const VIEWPORT = { w: 1440, h: 900 }

/** One fake element: an id, attributes, children and the two text properties the page writes. */
function fakeElement(tag) {
  const attrs = new Map()
  const node = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    hidden: false,
    childNodes: [],
    attrs,
    style: { setProperty: () => {} },
    setAttribute: (name, value) => { attrs.set(String(name), String(value)) },
    getAttribute: (name) => { const value = attrs.get(String(name)); return value === undefined ? null : value },
    appendChild: (child) => { node.childNodes.push(child); return child },
    removeChild: (child) => { const at = node.childNodes.indexOf(child); if (at !== -1) node.childNodes.splice(at, 1); return child },
    addEventListener: () => {},
  }
  Object.defineProperty(node, 'firstChild', { get: () => (node.childNodes.length === 0 ? null : node.childNodes[0]) })
  return node
}

/** Every leaf textContent under a node, joined: "what this section says", for a reading to read. */
function textOf(node) {
  const parts = []
  const walk = (one) => {
    if (one === null || one === undefined || typeof one !== 'object') return
    const children = Array.isArray(one.childNodes) ? one.childNodes : []
    if (children.length === 0) { if (one.textContent !== undefined && one.textContent !== '') parts.push(String(one.textContent)); return }
    for (const child of children) walk(child)
  }
  walk(node)
  return parts.join(' ')
}

/** A fake document built from the served HTML: every id the page carries becomes a node. */
function fakeDocument(html) {
  const nodes = new Map()
  for (const match of html.matchAll(/id="([^"]+)"/g)) {
    const node = fakeElement('div')
    node.id = match[1]
    nodes.set(match[1], node)
  }
  const vars = new Map()
  const rootAttrs = new Map()
  const bodyAttrs = new Map()
  const panelAttrs = new Map()

  /** The two CSS rules' arithmetic, applied to whatever attributes the page last set. */
  function layout() {
    const mode = rootAttrs.get('data-dsh-link-mode') ?? 'sidebar'
    const raw = vars.get('--dsh-link-sidebar-width')
    const declared = raw === undefined ? Number.NaN : Number(String(raw).replace(/px$/, ''))
    const sidebar = Number.isFinite(declared) ? declared : 420
    return {
      width: mode === 'full' ? VIEWPORT.w : sidebar,
      height: VIEWPORT.h,
      mode,
    }
  }
  const panel = {
    id: 'panel',
    attrs: panelAttrs,
    className: '',
    childNodes: [],
    textContent: '',
    setAttribute: (name, value) => { panelAttrs.set(name, String(value)) },
    appendChild: () => { throw new Error('the panel is not a render target') },
    addEventListener: () => {},
    get offsetWidth() { return layout().width },
    get offsetHeight() { return layout().height },
  }
  nodes.set('panel', panel)
  return {
    documentElement: {
      attrs: rootAttrs,
      setAttribute: (name, value) => { rootAttrs.set(name, String(value)) },
      style: { setProperty: (name, value) => { vars.set(name, String(value)) } },
    },
    body: { attrs: bodyAttrs, setAttribute: (name, value) => { bodyAttrs.set(name, String(value)) }, childNodes: [], appendChild: () => { throw new Error('the body is not a render target') } },
    createElement: (tag) => fakeElement(tag),
    getElementById: (id) => nodes.get(id) ?? null,
    nodes,
    layout,
    vars,
  }
}

/**
 * Run the page's inline script against a fake DOM.
 *
 * The script comes from the SERVED bytes, so what runs is what a host's webview would load. A fake window
 * carries the one flag the honesty line reads (frame) and captures what the page posts back.
 */
function runPage(html, search, options = {}) {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html)
  if (match === null) throw new Error('the served page carries no inline script')
  const code = match[1]
  const document = fakeDocument(html)
  const listeners = new Map()
  const posted = []
  const window = {
    __proto__: null,
    addEventListener: (type, handler) => { listeners.set(type, handler) },
    postMessage: (payload) => { posted.push(payload) },
    /* No fetch unless a reading supplies one: the page skips its live reads when there is no origin. */
    fetch: options.fetch,
  }
  // A child webview has no parent document: parent === window. A frame host gets a second window instead.
  const frameWindow = options.frameWindow ?? null
  window.parent = frameWindow === null ? window : frameWindow
  window.opener = options.opener ?? null
  const location = { search, origin: options.origin }
  // Compiled first: a page whose own script does not parse must not be able to pass any reading below.
  const compiled = new Function('window', 'document', 'location', code)
  compiled(window, document, location)
  return {
    document,
    window,
    posted,
    layout: () => document.layout(),
    attr: (name) => document.documentElement.attrs.get(name) ?? null,
    /** Deliver one message the way the browser would. */
    message: (data) => {
      const handler = listeners.get('message')
      if (handler === undefined) throw new Error('the page registered no message listener')
      handler({ data })
    },
    text: (id) => (document.nodes.get(id)?.textContent ?? ''),
  }
}

/* ------------------------------------------------------------------------------------------------ */

const rows = []
const held = (id, ok, detail) => { rows.push({ id, ok: ok === true, detail: String(detail) }); return ok === true }

/* A: the two routes as a surface ------------------------------------------------------------------ */
held('S1',
  mod.CONTRACT_ROUTE_PATH === '/api/dsh-link-host/contract' && mod.EMBED_ROUTE_PATH === '/api/dsh-link-host/embed'
  && /^\d+\.\d+\.\d+$/.test(String(mod.CONTRACT_VERSION)) && show(mod.MODES) === '["sidebar","full"]'
  && mod.DEFAULT_MODE === 'sidebar' && mod.MODE_MESSAGE_TYPE === 'dsh-link:mode' && mod.PANEL_NAME === 'right-panel',
  'paths=' + show([mod.CONTRACT_ROUTE_PATH, mod.EMBED_ROUTE_PATH]) + ' version=' + show(mod.CONTRACT_VERSION)
  + ' modes=' + show(mod.MODES) + ' default=' + show(mod.DEFAULT_MODE) + ' type=' + show(mod.MODE_MESSAGE_TYPE))

held('S3',
  /from\s+["']node:fs["']/.test(shipped) === false && /require\(/.test(shipped) === false
  && /from\s+["']node:http["']/.test(shipped) === false && /\bwriteFile\b|\bappendFile\b|\bmkdtemp\b|\bcreateWriteStream\b/.test(shipped) === false
  && (shipped.match(/^\s*import\s/gm) ?? []).length === 0,
  'imports=' + String((shipped.match(/^\s*import\s/gm) ?? []).length)
  + ' node:fs=' + String(/from\s+["']node:fs["']/.test(shipped)) + ' writes=' + String(/\bwriteFile\b|\bappendFile\b/.test(shipped)))

const world = mountRow({})
const bound = world.routes.map((route) => ({ kind: route.kind, path: route.path }))
held('S2',
  world.routes.length === 2
  && bound[0].kind === 'exact' && bound[0].path === mod.CONTRACT_ROUTE_PATH
  && bound[1].kind === 'exact' && bound[1].path === mod.EMBED_ROUTE_PATH
  && world.routes.every((route) => typeof route.handler === 'function')
  && world.spoken.some((line) => line.startsWith('[dsh-link-host] contract route bound on ' + mod.CONTRACT_ROUTE_PATH))
  && world.spoken.some((line) => line.startsWith('[dsh-link-host] embed route bound on ' + mod.EMBED_ROUTE_PATH))
  && world.spoken.some((line) => line.startsWith('[dsh-link-host] ready')),
  'bound ' + show(bound) + '; boot lines ' + show(world.spoken))

/**
 * S4: the row's width is ONE value that two artifacts read.
 *
 * The contract advertises it as the default of ?sidebarWidth= and the page draws it as the default
 * width, so a row that configures another number must move both - and a row that configures an
 * unusable one must fail at load with the field named, not serve a default the page would refuse.
 */
let configuredRefusal = 'the row accepted an unusable width'
try {
  mountRow({ sidebarWidth: 5 })
} catch (error) {
  configuredRefusal = String(error && error.message)
}
const customContract = mod.contractBody(900)
const customPage = mod.embedPage(900)
const customWidth = (customContract.queryParameters ?? []).find((parameter) => parameter.name === 'sidebarWidth') ?? {}
held('S4',
  configuredRefusal.includes('sidebarWidth') && configuredRefusal.includes('240..1200')
  && customWidth.default === 900 && customWidth.min === mod.MIN_SIDEBAR_WIDTH && customWidth.max === mod.MAX_SIDEBAR_WIDTH
  && customPage.includes('var DEFAULT_WIDTH = 900') && customPage.includes('--dsh-link-sidebar-width:900px'),
  'row config 900 -> contract default ' + show(customWidth.default) + ', page var DEFAULT_WIDTH = 900: '
  + String(customPage.includes('var DEFAULT_WIDTH = 900')) + '; row config 5 -> ' + show(configuredRefusal))

const socket = await serve(world.routes)
console.log('world: ' + socket.origin + ' (ephemeral loopback port; 31761/31760/9222 are not contacted)')
console.log('')

/* B: the contract route ------------------------------------------------------------------------- */
const first = await socket.call('GET', mod.CONTRACT_ROUTE_PATH)
const second = await socket.call('GET', mod.CONTRACT_ROUTE_PATH)
const contract = first.body ?? {}

held('C1',
  first.status === 200 && String(first.type).startsWith('application/json') && first.cache === 'no-store',
  'GET ' + mod.CONTRACT_ROUTE_PATH + ' -> ' + String(first.status) + ', type ' + show(first.type) + ', cache ' + show(first.cache)
  + ', ' + String(first.text.length) + ' bytes')

held('C2',
  contract.version === mod.CONTRACT_VERSION && contract.embedPath === mod.EMBED_ROUTE_PATH
  && show(contract.modes) === '["sidebar","full"]' && contract.defaultMode === 'sidebar'
  && contract.select?.query?.parameter === 'mode' && show(contract.select?.query?.values) === '["sidebar","full"]'
  && contract.select?.postMessage?.type === mod.MODE_MESSAGE_TYPE && show(contract.select?.postMessage?.body) === '{"type":"dsh-link:mode","mode":"full"}'
  && contract.select?.postMessage?.refused === mod.REFUSALS.MODE,
  'version=' + show(contract.version) + ' embedPath=' + show(contract.embedPath) + ' modes=' + show(contract.modes)
  + ' select.query=' + show(contract.select?.query?.parameter) + ' select.postMessage=' + show(contract.select?.postMessage?.type)
  + ' refused=' + show(contract.select?.postMessage?.refused))

/** Read one file:line back off disk: the origin site a host would reconcile. */
function siteHolds(site) {
  const file = join(PROJECT, String(site.file).replaceAll('/', '\\'))
  if (existsSync(file) === false) return { holds: false, why: 'missing: ' + site.file }
  const lines = readFileSync(file, 'utf8').split('\n')
  const line = lines[site.line - 1]
  if (line === undefined) return { holds: false, why: site.file + ':' + String(site.line) + ' is past the end of the file (' + String(lines.length) + ' lines)' }
  return { holds: line.includes('127.0.0.1:31761'), why: site.file + ':' + String(site.line) + ' = ' + line.trim() }
}
const sites = contract.originSites ?? []
const siteReadings = sites.map((site) => ({ site, reading: siteHolds(site) }))
for (const { site, reading } of siteReadings) {
  if (reading.holds === false && reading.why.startsWith('missing:')) notMeasured('the origin site ' + site.file + ' is gone: ' + reading.why)
}
held('C3',
  sites.length === 4
  && show(sites.map((site) => site.file + ':' + String(site.line))) === show([
    'src-tauri/src/lib.rs:40',
    'src-tauri/tauri.conf.json:12',
    'src-tauri/capabilities/default.json:7',
    'plugins/dsh-browser/lib/panel.js:35',
  ])
  && siteReadings.every(({ reading }) => reading.holds === true)
  && sites.every((site) => typeof site.why === 'string' && site.why !== ''),
  'the four sites, read back off disk: ' + siteReadings.map(({ reading }) => reading.why).join(' | '))

const caps = contract.hostCapabilities ?? []
held('C4',
  show(caps.map((cap) => cap.id)) === '["child-webview","csp","same-origin-http"]'
  && caps.every((cap) => Array.isArray(cap.evidence) && cap.evidence.length > 0 && /:\d+/.test(cap.evidence[0]))
  && caps.every((cap) => typeof cap.requires === 'string' && cap.requires !== ''),
  'capabilities=' + show(caps.map((cap) => cap.id + ' <- ' + cap.evidence[0])))

held('C5',
  contract.bounds?.method === 'POST' && contract.bounds?.path === '/__shell/panel'
  && show((contract.bounds?.ops ?? []).map((op) => op.op)) === '["surface","set-bounds"]'
  && contract.bounds?.readBack?.op === 'state',
  'bounds=' + show(contract.bounds?.path) + ' ops=' + show((contract.bounds?.ops ?? []).map((op) => op.op))
  + ' readBack=' + show(contract.bounds?.readBack?.op))

held('C6',
  first.text === second.text && first.text.length > 1000,
  'two GETs: ' + String(first.text.length) + ' and ' + String(second.text.length) + ' bytes, identical=' + String(first.text === second.text))

/**
 * A refused verb, over the socket.
 *
 * HEAD is read apart from the other three on purpose: HTTP itself forbids a body on a HEAD response, so
 * the named code cannot travel there. The refusal is still named - status 405 and Allow: GET - and the
 * reading says which of the two shapes it took rather than pretending HEAD answered like POST.
 */
const REFUSED_VERBS = ['POST', 'PUT', 'DELETE', 'HEAD']
const verbs = await Promise.all(REFUSED_VERBS.map((method) => socket.call(method, mod.CONTRACT_ROUTE_PATH)))
const bodyNamed = verbs.slice(0, 3).every((answer) => answer.status === 405 && answer.body?.error?.code === mod.REFUSALS.METHOD && answer.allow === 'GET')
const headRefused = verbs[3].status === 405 && verbs[3].allow === 'GET' && (verbs[3].text === '' || verbs[3].text === null || verbs[3].text === undefined)
held('C7',
  bodyNamed && headRefused,
  'verbs: ' + verbs.map((answer, at) => REFUSED_VERBS[at] + ' -> ' + String(answer.status) + ' ' + show(answer.body?.error?.code ?? '(no body: HTTP forbids one on HEAD)') + ' allow=' + show(answer.allow)).join(' | '))

held('C8',
  first.text === JSON.stringify(mod.contractBody(mod.DEFAULT_SIDEBAR_WIDTH)),
  'the served answer equals contractBody(' + String(mod.DEFAULT_SIDEBAR_WIDTH) + ') byte for byte: ' + String(first.text === JSON.stringify(mod.contractBody(mod.DEFAULT_SIDEBAR_WIDTH))))

/* C: the embed page ---------------------------------------------------------------------------- */
const pageA = await socket.call('GET', mod.EMBED_ROUTE_PATH)
const pageB = await socket.call('GET', mod.EMBED_ROUTE_PATH)
const html = pageA.text

held('E1',
  pageA.status === 200 && String(pageA.type).startsWith('text/html') && pageA.cache === 'no-store'
  && html.startsWith('<!doctype html>') && html.trimEnd().endsWith('</html>'),
  'GET ' + mod.EMBED_ROUTE_PATH + ' -> ' + String(pageA.status) + ', type ' + show(pageA.type) + ', cache ' + show(pageA.cache)
  + ', ' + String(Buffer.byteLength(html, 'utf8')) + ' bytes (' + String(html.length) + ' chars, so the row own boot line and this agree: '
  + String(Buffer.byteLength(html, 'utf8') > html.length) + ' tells you the page is not ASCII), doctype=' + String(html.startsWith('<!doctype html>')))

const external = {
  src: (html.match(/\ssrc\s*=/g) ?? []).length,
  href: (html.match(/\shref\s*=/g) ?? []).length,
  link: (html.match(/<link\b/gi) ?? []).length,
  import: (html.match(/@import/g) ?? []).length,
  url: (html.match(/url\(/g) ?? []).length,
  fetch: (html.match(/\bfetch\s*\(/g) ?? []).length,
  xhr: (html.match(/XMLHttpRequest/g) ?? []).length,
  dynamicImport: (html.match(/\bimport\s*\(/g) ?? []).length,
}
/* The page reads live data now, so the zero on "fetch(" is NOT the whole claim: what has to hold is
 * that there is exactly ONE network device and exactly one site that can build a request URL, and that
 * the URL it builds is location.origin + a frozen path (L1 measures that in the running page). */
const fetchDevices = (html.match(/window\.fetch/g) ?? []).length
const urlSites = (html.match(/location\.origin \+ /g) ?? []).length
held('E2',
  Object.values(external).every((count) => count === 0) && fetchDevices >= 1 && urlSites === 1,
  'external ASSETS: ' + show(external) + ' (every count must be 0: nothing to load)'
  + '; the one network device: window.fetch captured ' + String(fetchDevices) + ' time(s), the only site that builds a request URL is location.origin + a route path ('
  + String(urlSites) + ' time(s)), so the page can read the kernel that served it and reach nothing else (L1, L2)')

held('E3',
  html.includes('html[data-dsh-link-mode="sidebar"] #panel') && html.includes('html[data-dsh-link-mode="full"] #panel')
  && /right edge/.test(html) && /the whole window/.test(html)
  && html.includes('?sidebarWidth=') && html.includes(String(mod.MIN_SIDEBAR_WIDTH) + '..' + String(mod.MAX_SIDEBAR_WIDTH))
  && html.includes('innerWidth x innerHeight'),
  'both layout rules in the bytes, and each described: selectors ' + String(html.includes('html[data-dsh-link-mode="sidebar"] #panel'))
  + '/' + String(html.includes('html[data-dsh-link-mode="full"] #panel')) + ', descriptions ' + String(/right edge/.test(html)) + '/' + String(/the whole window/.test(html)))

held('E4',
  html.includes(mod.REFUSALS.MODE) && /refused by name/i.test(html) && /last good/.test(html),
  'refusal named in the bytes: ' + show(mod.REFUSALS.MODE) + ' appears ' + String(html.split(mod.REFUSALS.MODE).length - 1)
  + ' time(s); "refused by name"=' + String(/refused by name/i.test(html)) + '; "last good mode"=' + String(/last good/.test(html)))

held('E5',
  (html.match(/data-dsh-link-mode=/g) ?? []).length >= 3
  && html.includes('postMessage(') && html.includes(mod.MODE_MESSAGE_TYPE)
  && html.includes('window.__DSH_LINK_MODE') && html.includes('data-dsh-link-panel-width'),
  'data-dsh-link-mode appears ' + String((html.match(/data-dsh-link-mode=/g) ?? []).length) + ' time(s) in the markup,'
  + ' postMessage(=' + String(html.includes('postMessage(')) + ', __DSH_LINK_MODE=' + String(html.includes('window.__DSH_LINK_MODE')))

held('E6',
  html.includes('window.parent !== window') && html.includes('data-dsh-link-honesty')
  && /No ancestor frame/.test(html),
  'the honesty line is in the bytes: window.parent !== window=' + String(html.includes('window.parent !== window'))
  + ', data-dsh-link-honesty=' + String(html.includes('data-dsh-link-honesty')))

held('E7',
  /<html[^>]*data-dsh-link-mode="sidebar"/.test(html)
  && /--dsh-link-sidebar-width:\d+px/.test(html),
  'the served <html> already carries the default mode and width: '
  + show((/<html[^>]*data-dsh-link-mode="[a-z]+"/.exec(html) ?? [''])[0].slice(0, 60))
  + ' vars=' + show((/--dsh-link-sidebar-width:\d+px/.exec(html) ?? [''])[0]))

held('E8',
  pageA.text === pageB.text && pageB.status === 200,
  'two GETs of the page: ' + String(pageA.text.length) + ' and ' + String(pageB.text.length) + ' bytes, identical=' + String(pageA.text === pageB.text))

const pagePost = await socket.call('POST', mod.EMBED_ROUTE_PATH)
held('E9',
  pagePost.status === 405 && pagePost.body?.error?.code === mod.REFUSALS.METHOD && pagePost.allow === 'GET',
  'POST ' + mod.EMBED_ROUTE_PATH + ' -> ' + String(pagePost.status) + ' ' + show(pagePost.body?.error?.code) + ' allow=' + show(pagePost.allow))

const widthParameter = (contract.queryParameters ?? []).find((parameter) => parameter.name === 'sidebarWidth') ?? {}
held('E10',
  html.includes('var VERSION = "' + contract.version + '"')
  && html.includes('var MODE_REFUSAL = "' + contract.select.postMessage.refused + '"')
  && html.includes('var DEFAULT_WIDTH = ' + String(widthParameter.default))
  && html.includes('?sidebarWidth=') && html.includes(String(widthParameter.min) + '..' + String(widthParameter.max)),
  'page vs contract: version=' + show(contract.version) + ' refusal=' + show(contract.select.postMessage.refused)
  + ' defaultWidth=' + show(widthParameter.default) + ' range=' + show([widthParameter.min, widthParameter.max]))

/* D: the page's own script, in a fake DOM ----------------------------------------------------- */
const compiled = (() => {
  try {
    const source = /<script>([\s\S]*?)<\/script>/.exec(html)
    if (source === null) return { ok: false, why: 'no inline script in the served bytes' }
    new Function(source[1])
    return { ok: true, why: 'the inline script compiles: ' + String(source[1].length) + ' bytes' }
  } catch (error) {
    return { ok: false, why: String(error && error.message) }
  }
})()
held('P1', compiled.ok, compiled.why)

const full = runPage(html, '?mode=full')
held('P2',
  full.attr('data-dsh-link-mode') === 'full' && full.layout().width === VIEWPORT.w && full.layout().height === VIEWPORT.h,
  '?mode=full: attribute=' + show(full.attr('data-dsh-link-mode')) + ' panel=' + show(full.layout()) + ' viewport=' + show(VIEWPORT))

const back = runPage(html, '?mode=full')
back.message({ type: mod.MODE_MESSAGE_TYPE, mode: 'sidebar' })
held('P3',
  back.attr('data-dsh-link-mode') === 'sidebar' && back.layout().width === mod.DEFAULT_SIDEBAR_WIDTH,
  'postMessage sidebar after full: attribute=' + show(back.attr('data-dsh-link-mode')) + ' panel=' + show(back.layout())
  + ' (default width ' + String(mod.DEFAULT_SIDEBAR_WIDTH) + ')')

const refused = runPage(html, '?mode=sidebar')
refused.message({ type: mod.MODE_MESSAGE_TYPE, mode: 'ultrawide' })
held('P4',
  refused.attr('data-dsh-link-mode') === 'sidebar'
  && String(refused.attr('data-dsh-link-refusal')).includes(mod.REFUSALS.MODE)
  && refused.window.__DSH_LINK_EMBED__.refused === 1
  && /ultrawide/.test(refused.text('fact-last'))
  && /still sidebar|stayed in sidebar/.test(refused.text('fact-last')),
  'unknown mode "ultrawide": attribute=' + show(refused.attr('data-dsh-link-mode')) + ' refusal=' + show(refused.attr('data-dsh-link-refusal'))
  + ' refusedCount=' + show(refused.window.__DSH_LINK_EMBED__?.refused) + ' page says ' + show(refused.text('fact-last')))

const ignored = runPage(html, '?mode=sidebar')
ignored.message({ type: 'dsh-link:windowsize', width: 900 })
held('P5',
  ignored.attr('data-dsh-link-mode') === 'sidebar'
  && ignored.window.__DSH_LINK_EMBED__.ignored === 1
  && ignored.window.__DSH_LINK_EMBED__.refused === 0
  && /IGNORED/.test(ignored.text('fact-last')),
  'unknown type: attribute=' + show(ignored.attr('data-dsh-link-mode')) + ' ignored=' + show(ignored.window.__DSH_LINK_EMBED__?.ignored)
  + ' refused=' + show(ignored.window.__DSH_LINK_EMBED__?.refused) + ' page says ' + show(ignored.text('fact-last')))

const plain = runPage(html, '')
held('P6',
  plain.attr('data-dsh-link-mode') === 'sidebar' && plain.layout().width === mod.DEFAULT_SIDEBAR_WIDTH
  && plain.window.__DSH_LINK_EMBED__.accepted === 0 && plain.attr('data-dsh-link-refusal') === ''
  && plain.window.__DSH_LINK_EMBED__.frame === false,
  'no ?mode= and no message: attribute=' + show(plain.attr('data-dsh-link-mode')) + ' panel=' + show(plain.layout())
  + ' accepted=' + show(plain.window.__DSH_LINK_EMBED__?.accepted) + ' frame=' + show(plain.window.__DSH_LINK_EMBED__?.frame))

const opener = { postMessage: (payload) => { opener.posted.push(payload) }, posted: [] }
const framed = runPage(html, '?mode=full', { opener })
held('P7',
  opener.posted.length === 1
  && opener.posted[0]?.type === mod.MODE_MESSAGE_TYPE
  && opener.posted[0]?.mode === 'full'
  && opener.posted[0]?.accepted === true
  && opener.posted[0]?.version === mod.CONTRACT_VERSION,
  'the page posted back to its opener: ' + show(opener.posted))

const wide = runPage(html, '?mode=sidebar&sidebarWidth=900')
const silly = runPage(html, '?mode=sidebar&sidebarWidth=5')
held('P8',
  wide.layout().width === 900
  && silly.layout().width === mod.DEFAULT_SIDEBAR_WIDTH
  && String(silly.attr('data-dsh-link-refusal')).includes(mod.REFUSALS.WIDTH),
  '?sidebarWidth=900 -> panel ' + show(wide.layout()) + '; ?sidebarWidth=5 -> panel ' + show(silly.layout())
  + ' refusal=' + show(silly.attr('data-dsh-link-refusal')))

/* E: the live reads, driven with an origin and a fake network ------------------------------------- */

/** The origin the fake world answers on: every URL the page builds must start with ITS OWN origin. */
const LIVE_ORIGIN = 'http://embed.test'
const LIVE_PATHS = ['/api/dsh-link-collab/status', '/api/dsh-link-teams/state', '/api/dsh-link-notes/state', '/__shell/panel-start']

/**
 * A table of answers behind a fake window.fetch.
 *
 * A path the table omits answers 404 - which is the ordinary case for a kernel that has not mounted
 * that row - and a URL that is not this document's own origin REJECTS: a page that addressed anything
 * else would fail the reading by name instead of being quietly allowed to.
 */
function fakeNetwork(table, calls) {
  return (url, init) => {
    const target = String(url)
    const onOrigin = target.startsWith(LIVE_ORIGIN)
    const path = onOrigin ? target.slice(LIVE_ORIGIN.length) : target
    calls.push({ url: target, path, method: init === undefined || init === null ? 'GET' : String(init.method) })
    if (onOrigin === false) return Promise.reject(new Error('the page addressed a URL off its own origin: ' + target))
    if (Object.prototype.hasOwnProperty.call(table, path) === false) return Promise.resolve({ status: 404, text: () => Promise.resolve('{"ok":false,"error":{"code":"GATE_NO_ROUTE"}}') })
    const hit = table[path]
    return Promise.resolve({ status: hit.status ?? 200, text: () => Promise.resolve(typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body)) })
  }
}
/** Let the page's promise chains drain: two turns, because each read chains a then and a then. */
const settle = async () => {
  await new Promise((done) => setTimeout(done, 0))
  await new Promise((done) => setTimeout(done, 0))
}
const nodeOf = (page, id) => page.document.nodes.get(id) ?? { getAttribute: () => null, textContent: '' }

/* A bus answer shaped like the route's own document: the numbers are chosen so a reading can find them. */
const BUS_ANSWER = {
  ok: true,
  path: LIVE_PATHS[0],
  at: 1700000000000,
  ledger: { records: 4242, lastSeq: 4242, writer: 'local', instance: 'inst-gate', damage: null },
  world: { teams: 3, members: 7, tasks: 5, folded: 31, unknown: 2 },
  relay: { bound: true, path: '/api/dsh-link-collab/relay', accepted: 11, refused: 1, lastCode: null },
  messages: { journal: 4, inbox: 0, source: 'journal', scope: 'both-directions' },
  recorded: { seen: 40, recorded: 39, ignored: 1, failed: 0 },
}
const liveCalls = []
const live = runPage(html, '?mode=sidebar', { origin: LIVE_ORIGIN, fetch: fakeNetwork({ [LIVE_PATHS[0]]: { body: BUS_ANSWER } }, liveCalls) })
await settle()
held('L1',
  liveCalls.length === 4
  && LIVE_PATHS.every((path) => liveCalls.filter((one) => one.path === path).length === 1)
  && liveCalls.every((one) => one.method === 'GET')
  && liveCalls.every((one) => one.url.startsWith(LIVE_ORIGIN))
  && /\bsetInterval\s*\(|\bsetTimeout\s*\(/.test(html) === false,
  'the reads the page makes with an origin and no help: ' + show(liveCalls.map((one) => one.method + ' ' + one.url))
  + ' (four GETs, one per frozen path, every one on ' + LIVE_ORIGIN + '); timers in the page bytes: '
  + String(/\bsetInterval\s*\(|\bsetTimeout\s*\(/.test(html)))

held('L2',
  String(nodeOf(live, 'bus-chip').getAttribute('data-state')) === 'live'
  && textOf(nodeOf(live, 'bus-body')).includes('4242')
  && textOf(nodeOf(live, 'bus-body')).includes('journal')
  && String(nodeOf(live, 'notes-chip').getAttribute('data-state')) === 'down'
  && /HTTP 404/.test(textOf(nodeOf(live, 'notes-said')))
  && textOf(nodeOf(live, 'notes-body')) === ''
  && /HTTP 404/.test(textOf(nodeOf(live, 'board-said'))),
  'bus (200): chip '
  + show(nodeOf(live, 'bus-chip').getAttribute('data-state')) + ', card says ' + show(clipText(textOf(nodeOf(live, 'bus-body')), 180))
  + '; notes (404, the route is not mounted): chip ' + show(nodeOf(live, 'notes-chip').getAttribute('data-state'))
  + ', the section own line ' + show(textOf(nodeOf(live, 'notes-said'))) + ', the card draws ' + show(textOf(nodeOf(live, 'notes-body')))
  + ' - no number for a route nobody could read')

await socket.stop()
await world.close()

/* ------------------------------------------------------------------------------------------------ */
for (const row of rows) console.log((row.ok ? 'ok   ' : 'FAIL ') + row.id.padEnd(4) + row.detail)
const failed = rows.filter((row) => row.ok === false)
console.log('')
console.log(String(rows.length - failed.length) + '/' + String(rows.length) + ' readings held'
  + (failed.length === 0 ? '' : '; FAILED: ' + failed.map((row) => row.id).join(', ')))
process.exit(failed.length === 0 ? 0 : 1)
