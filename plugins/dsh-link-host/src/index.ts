/**
 * dsh-link-host — the embed surface: DSH-LINK as a thing ANOTHER Tauri app can carry.
 *
 * ## What this package is
 *
 * DSH-LINK is an application, not a library: it builds its own tauri::Builder (src-tauri/src/lib.rs:212),
 * creates its one window "main" (lib.rs:397), and the panel code looks that window up by a hardcoded
 * label (src-tauri/src/core/sidebar_panel.rs:1491). Nothing here pretends otherwise. What this package
 * publishes is the smallest honest thing a host can integrate against today: a PROTOCOL, served as data
 * and as a page.
 *
 *   GET /api/dsh-link-host/contract   the embed contract as JSON data. A host reads the protocol instead
 *                                     of trusting a document, and verifies its own configuration against
 *                                     the four origin sites named in the answer.
 *   GET /api/dsh-link-host/embed      the self-contained page a host's child webview loads. It reads
 *                                     ?mode=, listens for {type:'dsh-link:mode', mode}, refuses an unknown
 *                                     mode BY NAME, and states the mode and the geometry it chose as
 *                                     document-level facts.
 *
 * Both routes are READ-ONLY and both answer GET and nothing else: anything else is 405 with a named code
 * and an Allow header. Neither route is a tool, neither writes a byte, neither reads a clock, and two
 * calls answer identical bytes - "the contract is read-only" is then a statement about the only thing
 * these handlers can do at all, not a promise about their discipline.
 *
 * ## Why a page, and why it is the point
 *
 * The measured shape of the switch is NOT two windows. It is one rect on one child webview: op=surface /
 * op=set-bounds on POST /__shell/panel (src-tauri/src/core/proxy.rs:234, :332) ends in
 * sidebar_panel::surface() (sidebar_panel.rs:1733) and then in the child webview's own set_bounds
 * (sidebar_panel.rs:1512). The webview is moved, not destroyed, so the tab, the session and the profile
 * survive the switch. A host that owns its own child webview makes the same move with its own bounds
 * call, which is why the sidebar <-> full switch here is a MODE the page accepts, not a host-specific API:
 * the host decides the rect, the page states which mode it is drawing in, and neither has to know the
 * other's runtime.
 *
 * The page therefore depends on nothing: no framework, no build step, no external script or stylesheet,
 * no network call. It must survive being loaded by a host that can ONLY set a URL (that host passes
 * ?mode= and never posts anything), and it must be honest when a person opens it directly rather than a
 * host embedding it.
 *
 * ## What this package does NOT claim
 *
 * Turning the shell into a crate a host links against (run_with, a parameterised window label,
 * #[tauri::command] for the panel ops) is a multi-round refactor of a running application and is named as
 * debt in R195-contract.md section 3, not delivered here. Cross-process webview embedding is not a Tauri
 * capability at all: Window::add_child needs the parent window in the SAME app process (Cargo.toml:17-20
 * with the `unstable` feature, used in production code at sidebar_panel.rs:1499-1502). A host therefore
 * carries this page in a child webview IT creates - it does not acquire DSH-LINK's webview.
 *
 * Every file:line this module serves was read from this tree while writing it; the self-check in
 * test/embed-routes.spec.mjs re-reads the four origin sites from disk, so a drift between this answer and
 * the tree is a failing reading rather than a stale sentence.
 */

/** The plugin name the bundle row mounts. */
export const name = 'dsh-link-host'

/**
 * Nothing is injected at apply time.
 *
 * The web server is looked up lazily through ctx.get('webServer') and waited for through
 * ctx.inject(['webServer'], ...) - the shape plugins/dsh-link-notes/src/index.ts:877-993 landed - so a
 * composition that mounts this row before its web application still binds, and one that never mounts a
 * web server at all is told so on the boot line instead of failing.
 */
export const inject: readonly string[] = Object.freeze([])

/**
 * The contract's version. A host reads this before it reads anything else, and a host that cannot find
 * the version it was written against must not guess at the rest.
 *
 * Bumped when a field changes meaning. The two routes' paths are NOT part of the bump: they are the
 * names a host hardcodes, so they are exported here and never derived.
 */
export const CONTRACT_VERSION = '1.0.0'

/** Where the contract is served. One exported constant, so a host and this route cannot misspell it twice. */
export const CONTRACT_ROUTE_PATH = '/api/dsh-link-host/contract'

/** Where the page is served. This is the URL a host's child webview points at. */
export const EMBED_ROUTE_PATH = '/api/dsh-link-host/embed'

/** The two modes, in the order the page names them. Nothing else is a mode. */
export const MODES: readonly string[] = Object.freeze(['sidebar', 'full'])

/** What a document that was given no instruction draws: the right sidebar. */
export const DEFAULT_MODE = 'sidebar'

/**
 * The message type the page listens for and answers with.
 *
 * One type in both directions on purpose: a host that posts a mode also receives the page's own report
 * under the same name, so "what does the page think it is doing" is one listener, not two.
 */
export const MODE_MESSAGE_TYPE = 'dsh-link:mode'

/** The one surface this build draws. ?panel= may name it; it may not name a panel that does not exist. */
export const PANEL_NAME = 'right-panel'

/**
 * The named refusals.
 *
 * A refusal never leaves an ambiguous state: an unknown mode keeps the last good mode, an unusable width
 * keeps the default, and an unknown panel name keeps the one surface. The code is the name a host reads;
 * the sentence beside it is for the person looking at the page.
 *
 * METHOD_NOT_ALLOWED is deliberately not an EMBED_ name: nothing was refused about an embed, the request
 * was refused a verb - the same spelling plugins/dsh-link-notes/src/index.ts:119 uses for its own.
 */
export const REFUSALS = Object.freeze({
  /** A verb other than GET on either route. Answered 405 with an Allow header. */
  METHOD: 'METHOD_NOT_ALLOWED',
  /** ?mode= or a message named a mode that is not in MODES. The page stays in the last good mode. */
  MODE: 'EMBED_MODE_UNKNOWN',
  /** ?panel= named a surface this build does not have. The one surface is drawn anyway. */
  PANEL: 'EMBED_PANEL_UNKNOWN',
  /** ?sidebarWidth= was not a number in MIN_SIDEBAR_WIDTH..MAX_SIDEBAR_WIDTH. The default stands. */
  WIDTH: 'EMBED_WIDTH_UNUSABLE',
})

/** The sidebar the page draws when the host asks for no width. Row config may change it; the contract says so. */
export const DEFAULT_SIDEBAR_WIDTH = 420

/** Narrower than this is not a sidebar, it is a sliver: the page refuses the number rather than drawing one. */
export const MIN_SIDEBAR_WIDTH = 240

/** Wider than this in sidebar mode is dishonest - full mode is what a host asks for to get more room. */
export const MAX_SIDEBAR_WIDTH = 1200

/**
 * The shell's own origin, as a literal.
 *
 * It is here so a host can compare what it configured against what the shell actually serves, and it is
 * the value four sites in this tree hold between them (see ORIGIN_SITES). Changing the port means
 * changing those four files, not this constant alone.
 */
export const SHELL_ORIGIN = 'http://127.0.0.1:31761'

/**
 * The four places 127.0.0.1:31761 is written down, each with the line it is on.
 *
 * A host that points its webview somewhere else, or that relaxes a policy, has to reconcile all four or
 * it will have reconciled a quarter of them. The self-check reads each of these lines back off disk.
 */
export const ORIGIN_SITES: readonly { readonly file: string, readonly line: number, readonly symbol: string, readonly holds: string, readonly why: string }[] = Object.freeze([
  Object.freeze({
    file: 'src-tauri/src/lib.rs',
    line: 45,
    symbol: 'SELF_ORIGIN',
    holds: 'pub const SELF_ORIGIN: &str = "http://127.0.0.1:31761";',
    why: 'the proxy\'s own origin: the window loads it, the CORS middleware compares every Origin header against it verbatim, and every /__shell/* route lives on it',
  }),
  Object.freeze({
    file: 'src-tauri/tauri.conf.json',
    line: 12,
    symbol: 'app.security.csp',
    holds: "default-src 'self' http://127.0.0.1:31761; connect-src 'self' ws://127.0.0.1:31761 http://127.0.0.1:31761; ... frame-src 'self' blob: data: ...",
    why: 'the CSP of the shell\'s own webview: it admits the origin for default-src and connect-src, and admits NO framed origin (frame-src is self, blob: and data: only)',
  }),
  Object.freeze({
    file: 'src-tauri/capabilities/default.json',
    line: 7,
    symbol: 'remote.urls',
    holds: '"urls": ["http://127.0.0.1:31761"]',
    why: 'the remote origins the "main" window is granted a capability set for',
  }),
  Object.freeze({
    file: 'plugins/dsh-browser/lib/panel.js',
    line: 35,
    symbol: 'DEFAULT_PANEL_ORIGIN',
    holds: "export const DEFAULT_PANEL_ORIGIN = 'http://127.0.0.1:31761'",
    why: 'the plugin that drives the shell panel carries the same origin as its default, overridable by row config or DSH_BROWSER_PANEL_ORIGIN',
  }),
])

/**
 * What a host must ALREADY be able to do before this contract is any use to it.
 *
 * Written as capabilities with their evidence rather than as advice: a host that cannot do one of these
 * is not a host this contract can serve, and the honest answer is to say so before it integrates.
 */
export const HOST_CAPABILITIES: readonly { readonly id: string, readonly requires: string, readonly evidence: readonly string[], readonly what: string }[] = Object.freeze([
  Object.freeze({
    id: 'child-webview',
    requires: 'a child webview it creates itself: Window::add_child, which tauri gates behind its unstable feature',
    evidence: Object.freeze(['src-tauri/Cargo.toml:17-20', 'src-tauri/src/core/sidebar_panel.rs:1499-1502', 'src-tauri/src/core/sidebar_panel.rs:1476-1479']),
    what: 'the page this contract serves is carried by a webview the HOST owns; cross-process embedding of the DSH-LINK webview is not a Tauri capability, and add_child needs the parent window in the same app process',
  }),
  Object.freeze({
    id: 'csp',
    requires: "a CSP that allows the shell origin (default-src / connect-src) and inline script and style (script-src and style-src 'unsafe-inline', which the page needs because it is one inline block)",
    evidence: Object.freeze(['src-tauri/tauri.conf.json:12']),
    what: "the shell\'s own CSP is the worked example: default-src 'self' http://127.0.0.1:31761, connect-src the same plus ws://, script-src 'self' 'unsafe-inline' 'unsafe-eval', style-src 'self' 'unsafe-inline'",
  }),
  Object.freeze({
    id: 'same-origin-http',
    requires: "a same-origin GET/fetch to the shell: the host's own document must be on the shell origin, or the request must be made from a document that is",
    evidence: Object.freeze(['src-tauri/src/lib.rs:38-40', 'src-tauri/src/core/proxy.rs:756-772', 'src-tauri/src/core/proxy.rs:184']),
    what: 'the proxy refuses any request carrying an Origin other than SELF_ORIGIN outright (403), and /api/{*endpoint} is the catch-all that carries this contract to the kernel - so a host page on another origin cannot read it with fetch()',
  }),
])

/** The bounds protocol the shell already speaks, named as data. */
const BOUNDS = Object.freeze({
  method: 'POST',
  path: '/__shell/panel',
  contentType: 'application/json',
  ops: Object.freeze([
    Object.freeze({
      op: 'surface',
      body: Object.freeze({ op: 'surface', x: 0, y: 0, w: 0, h: 0 }),
      does: 'declares the rect, in CSS px, that the panel fills; a width or height of 0 or less means the pane is GONE and the panel is unmounted rather than parked at 0x0',
      evidence: Object.freeze(['src-tauri/src/core/proxy.rs:234', 'src-tauri/src/core/sidebar_panel.rs:1733-1744']),
    }),
    Object.freeze({
      op: 'set-bounds',
      body: Object.freeze({ op: 'set-bounds', x: 0, y: 0, w: 0, h: 0 }),
      does: 'the pre-R178 name for the same call: set_bounds() IS surface() (one implementation, two names)',
      evidence: Object.freeze(['src-tauri/src/core/proxy.rs:332', 'src-tauri/src/core/sidebar_panel.rs:1200-1202', 'src-tauri/src/core/proxy.rs:206-207']),
    }),
  ]),
  readBack: Object.freeze({
    op: 'state',
    does: 'reads the panel back (exists, mounted, tabs, active, bounds) without moving anything',
    evidence: Object.freeze(['src-tauri/src/core/proxy.rs:232']),
  }),
  sidebar: 'the right column rect: the host measures its own column and passes x, y, w, h of it',
  full: 'the whole viewport: surface(0, 0, W, H) with the host\'s own W and H',
  survives: 'the child webview is MOVED, not destroyed: the tab id, the DSH session and the profile directory survive the switch (the switch ends in one set_bounds, sidebar_panel.rs:1512)',
  hostSide: 'a host that owns the child webview makes the same move with its own runtime set_bounds on the same rect. This contract names the shape so the shell protocol and the host protocol are one protocol; it does not hand the host a command channel into DSH-LINK.',
})

/** One row of the refusal table the contract publishes. */
interface RefusalRow {
  /** The named code. */
  readonly code: string
  /** The HTTP status, when the refusal is answered over HTTP; null when it is stated in the page only. */
  readonly status: number | null
  /** When the code is the answer. */
  readonly when: string
}

/**
 * What a host may ask for in the URL, and what happens when it asks for something else.
 * @param sidebarWidth - the row's resolved default width.
 * @returns one entry per accepted query parameter.
 */
function queryParameters(sidebarWidth: number): readonly Record<string, unknown>[] {
  return [
    { name: 'mode', type: 'string', values: [...MODES], default: DEFAULT_MODE, required: false, refused: REFUSALS.MODE, applies: 'the layout this page draws; read once at load, then again on every accepted message' },
    { name: 'sidebarWidth', type: 'number', unit: 'css px', default: sidebarWidth, min: MIN_SIDEBAR_WIDTH, max: MAX_SIDEBAR_WIDTH, required: false, refused: REFUSALS.WIDTH, applies: 'the sidebar width only: full mode is the viewport, and a number outside min..max is refused rather than clamped' },
    { name: 'panel', type: 'string', values: [PANEL_NAME], default: PANEL_NAME, required: false, refused: REFUSALS.PANEL, applies: 'which DSH-LINK surface to draw; this build draws the right panel and refuses any other name' },
  ]
}

/**
 * One configured width, or the default when the row left it out.
 *
 * A value the row did set has to be usable: a width of 10 is not a narrower sidebar, it is a row asking
 * the page to refuse its own default, so the row fails at load with the field named instead.
 * @param value - the configured value, when there is one.
 * @param field - the configuration field, for the message.
 * @returns the resolved width.
 */
function configuredWidth(value: number | undefined, field: string): number {
  if (value === undefined) return DEFAULT_SIDEBAR_WIDTH
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_SIDEBAR_WIDTH || value > MAX_SIDEBAR_WIDTH) {
    throw new TypeError('dsh-link-host: ' + field + ' must be an integer in ' + String(MIN_SIDEBAR_WIDTH) + '..' + String(MAX_SIDEBAR_WIDTH) + ' when set (got '
      + JSON.stringify(value) + ') - a width the page would have to refuse is not a default')
  }
  return value
}

/**
 * The contract, as one JSON value.
 *
 * Pure and exported so the self-check compares the SERVED answer with this function rather than with a
 * copy of the shape, and so a reader of the module can see every field the route can answer with.
 * @param sidebarWidth - the row's resolved default width.
 * @returns the body of GET /api/dsh-link-host/contract, without a clock and without a counter.
 */
export function contractBody(sidebarWidth: number = DEFAULT_SIDEBAR_WIDTH): Record<string, unknown> {
  const refusals: readonly RefusalRow[] = Object.freeze([
    Object.freeze({ code: REFUSALS.METHOD, status: 405, when: 'any verb other than GET on either route; the Allow header names GET' }),
    Object.freeze({ code: REFUSALS.MODE, status: null, when: '?mode= or {type:"' + MODE_MESSAGE_TYPE + '", mode} named a mode that is not one of ' + MODES.join(' / ') + '; the page refuses it BY NAME and stays in the last good mode' }),
    Object.freeze({ code: REFUSALS.PANEL, status: null, when: '?panel= named a surface this build does not draw; the right panel is drawn anyway' }),
    Object.freeze({ code: REFUSALS.WIDTH, status: null, when: '?sidebarWidth= was not a number in ' + String(MIN_SIDEBAR_WIDTH) + '..' + String(MAX_SIDEBAR_WIDTH) + '; the default stands' }),
  ])
  return {
    ok: true,
    readOnly: true,
    path: CONTRACT_ROUTE_PATH,
    name: 'dsh-link/embed',
    version: CONTRACT_VERSION,
    embedPath: EMBED_ROUTE_PATH,
    modes: [...MODES],
    defaultMode: DEFAULT_MODE,
    select: {
      query: {
        kind: 'query',
        parameter: 'mode',
        values: [...MODES],
        example: EMBED_ROUTE_PATH + '?mode=full',
        applies: 'read once at load. A host that can only set a URL needs nothing else, and the page works whether or not it is ever posted to.',
      },
      postMessage: {
        kind: 'postMessage',
        type: MODE_MESSAGE_TYPE,
        body: { type: MODE_MESSAGE_TYPE, mode: 'full' },
        target: 'the page\'s own window: a host that owns the child webview evaluates window.postMessage({type:"' + MODE_MESSAGE_TYPE + '", mode:"full"}, "*") into it, which needs no ancestor frame',
        alsoWorks: 'window.parent.postMessage(...) from an iframe host, and window.opener.postMessage(...) from a browser tab',
        applies: 'any time after load; the last accepted selection wins',
        refused: REFUSALS.MODE,
        ignored: 'a message whose type is not "' + MODE_MESSAGE_TYPE + '" is ignored: no refusal, no state change, counted as ignored in window.__DSH_LINK_EMBED__',
      },
    },
    queryParameters: queryParameters(sidebarWidth),
    messages: {
      fromHost: [{ type: MODE_MESSAGE_TYPE, body: { type: MODE_MESSAGE_TYPE, mode: 'sidebar' } }],
      toHost: [{
        type: MODE_MESSAGE_TYPE,
        body: { type: MODE_MESSAGE_TYPE, mode: 'sidebar', accepted: true, requested: 'sidebar', from: 'load', version: CONTRACT_VERSION },
        where: 'window.opener, or window.parent when it is a different window; a child webview has neither, so there the report is the document itself (data-dsh-link-mode, window.__DSH_LINK_MODE)',
      }],
    },
    documentFacts: {
      mode: 'the data-dsh-link-mode attribute, set on the html element, the body and the panel to the same value',
      panel: 'the data-dsh-link-panel attribute: the surface this build draws',
      geometry: 'the panel\'s own offsetWidth and offsetHeight: the CSS pixels a host hands its own bounds call',
      geometryMirror: 'data-dsh-link-panel-width and data-dsh-link-panel-height on the html element, updated on every accepted mode and on every resize',
      refusal: 'data-dsh-link-refusal on the html element: empty, or the code and sentence of the last refusal',
      globals: ['window.__DSH_LINK_MODE', 'window.__DSH_LINK_EMBEDDED', 'window.__DSH_LINK_EMBED__'],
      direct: 'window.parent === window is stated as-is, in data-dsh-link-embedded. It means "no ancestor frame", NOT "not embedded": a Tauri child webview is a separate document with no parent, and only the host knows which of the two it did.',
    },
    bounds: BOUNDS,
    hostCapabilities: HOST_CAPABILITIES,
    originSites: ORIGIN_SITES,
    shellOrigin: SHELL_ORIGIN,
    refusals,
  }
}

/**
 * The four SAME-ORIGIN GET routes the page reads, named once.
 *
 * The page is not a description of the surface any more: it reads the kernel that serves it. Each
 * route is a read-only GET on this document's own origin, so a host document on another origin could
 * not read it (the shell proxy refuses a foreign Origin outright) - which is exactly why the live
 * sections are mounted here rather than in a host's own page.
 *
 * The fourth row is not a kernel route: '/__shell/panel-start' is the SHELL's own panel start page
 * (src-tauri/src/core/sidebar_panel.rs:1217). It is probed for reachability and opened in a new tab,
 * and the page says in its own text that a foreign host owes that path to nobody.
 */
export const LIVE_ROUTES: readonly { readonly key: string, readonly path: string, readonly kind: 'json' | 'html', readonly reads: string }[] = Object.freeze([
  Object.freeze({ key: 'bus', path: '/api/dsh-link-collab/status', kind: 'json' as const, reads: 'the bus: teams, members, the ledger, the relay, and the R217 messages block' }),
  Object.freeze({ key: 'board', path: '/api/dsh-link-teams/state', kind: 'json' as const, reads: 'the team board: teams, members, tasks, and what is assignable' }),
  Object.freeze({ key: 'notes', path: '/api/dsh-link-notes/state', kind: 'json' as const, reads: 'the note ledger: counts, limits, the most recent notes' }),
  Object.freeze({ key: 'browser', path: '/__shell/panel-start', kind: 'html' as const, reads: 'the browser panel entry: its reachability, and a button that opens it in a new tab' }),
])

/**
 * The embed page, as bytes.
 *
 * One string, built from this module's constants, with no external asset of any kind: no script src, no
 * link, no @import, no url(), no frame, no image. It is served by the kernel, so its ONE network device
 * is window.fetch - captured once, called only with the four frozen same-origin paths in LIVE_ROUTES.
 * That is the whole of what it can reach.
 *
 * The mode protocol, the two layouts and the refusal names are all in the bytes, so a reader can check
 * them without running the page. They are off the visible surface on purpose: the panel is a product
 * surface now, and the protocol is a collapsible drawer at the bottom of it.
 *
 * The two layouts are still two CSS rules selected by the very attribute the page reports. The script
 * therefore never calculates a rectangle: it sets data-dsh-link-mode and reads back what the layout did,
 * which is why the geometry it states is the geometry the browser chose rather than a second opinion
 * about it.
 * @param sidebarWidth - the row's resolved default width, the one ?sidebarWidth= may override.
 * @returns the document, byte-identical for every request.
 */
export function embedPage(sidebarWidth: number = DEFAULT_SIDEBAR_WIDTH): string {
  const width = configuredWidth(sidebarWidth, 'sidebarWidth')
  const head = [
    '<!doctype html>',
    '<!--',
    '  DSH-LINK embed surface, contract version ' + CONTRACT_VERSION + ' - served by GET ' + EMBED_ROUTE_PATH,
    '',
    '  A host carries this page in a child webview it creates itself (Window::add_child, tauri unstable',
    '  feature) and resizes that webview with its own bounds logic. The page draws the DSH-LINK right panel,',
    '  speaks the mode protocol below, states the geometry it chose as document-level facts, and reads four',
    '  SAME-ORIGIN GET routes of the kernel that serves it - so what it shows is the live bus, board and',
    '  ledger rather than a description of the surface.',
    '',
    '  THE MODE PROTOCOL - two ways in, one way out:',
    '    in  ~ ?mode=sidebar | ?mode=full          read once, at load. A URL-only host needs nothing else.',
    '    in  ~ window.postMessage({type:"' + MODE_MESSAGE_TYPE + '", mode:"sidebar"|"full"}, "*")',
    '    out ~ the page posts {type:"' + MODE_MESSAGE_TYPE + '", mode:<current>, accepted:<boolean>,',
    '          requested:<what was asked for>, from:<how>, version:"' + CONTRACT_VERSION + '"} back to',
    '          window.opener, or to window.parent when that is a different window. A Tauri child webview',
    '          has neither - it is a separate document, not a frame - so a host there evaluates the message',
    '          into the child instead, and reads the mode off the document.',
    '',
    '  A mode that is not one of the two is REFUSED BY NAME (' + REFUSALS.MODE + ') and the page stays in',
    '  the last good mode. A message whose type is not "' + MODE_MESSAGE_TYPE + '" is IGNORED. An unusable',
    '  ?sidebarWidth= is refused (' + REFUSALS.WIDTH + ') and the default stands. An unknown ?panel= is',
    '  refused (' + REFUSALS.PANEL + '). Each of those is stated in the page, in data-dsh-link-refusal, and',
    '  in window.__DSH_LINK_EMBED__.',
    '',
    '  THE LIVE SECTIONS - four same-origin GETs, and nothing else on the network:',
    '    GET ' + LIVE_ROUTES[0].path + '        the bus: teams, members, ledger records, the relay, and',
    '                                              the R217 messages block (journal / inbox / source / scope)',
    '    GET ' + LIVE_ROUTES[1].path + '          the team board: teams, members, tasks, and what is assignable',
    '    GET ' + LIVE_ROUTES[2].path + '          the note ledger: counts, limits, the most recent notes',
    '    GET ' + LIVE_ROUTES[3].path + '          the browser panel entry: probed, then opened in a new tab',
    '  A section whose route is unavailable states the HTTP status (or the network failure) in its own',
    '  words and draws NO number for it: a zero would be a reading nobody took. No timer re-reads them -',
    '  a person presses refresh, or the document becomes visible again - because a panel kept fresh by a',
    '  clock is only ever as true as its cadence.',
    '-->',
  ].join('\n')
  const css = [
    '<style>',
    '  /* The four layout/ink tokens are the DSH shell own dark palette (design-platform.css, the dark',
    '     block: bg-base 21,21,23 / layer-1 35,35,36 / label-primary 249,250,251 / brand 122,170,255),',
    '     written as literals because this document inherits nothing from the page that framed it. */',
    '  :root { color-scheme: dark;',
    '    --bg: #151517; --layer: #232324; --layer-2: #1b1b1d;',
    '    --line: rgba(255,255,255,.10); --line-soft: rgba(255,255,255,.06);',
    '    --ink: #f9fafb; --ink-2: #cfd3d6; --ink-3: #adb2b8; --ink-4: #81858c;',
    '    --accent: #7aaaff; --ok: #4ed17e; --warn: #f7ad31; --bad: #f25a5a;',
    '    --mono: ui-monospace, SFMono-Regular, Consolas, monospace; }',
    '  * { box-sizing: border-box; }',
    '  html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--ink-2);',
    '    font: 13px/1.5 ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;',
    '    overflow: hidden; -webkit-font-smoothing: antialiased; }',
    '  [hidden] { display: none !important; }',
    '  #panel { position: fixed; top: 0; overflow: auto; background: var(--bg);',
    '    scrollbar-width: thin; scrollbar-color: #3a3a3d transparent; }',
    '  /* THE LAYOUT SWITCH IS THE ATTRIBUTE, and these two rules are the whole of it: the script only has to',
    '     set data-dsh-link-mode on the html element. Both layouts are in these bytes, so a reader can check',
    '     them without running the page. */',
    '  /* sidebar: the right column - width from ?sidebarWidth= (default ' + String(width) + ' px, accepted',
    '     ' + String(MIN_SIDEBAR_WIDTH) + '..' + String(MAX_SIDEBAR_WIDTH) + ' px), height = the viewport, anchored to the right edge, 1 px left border. */',
    '  html[data-dsh-link-mode="sidebar"] #panel { left: auto; right: 0; top: 0;',
    '    width: var(--dsh-link-sidebar-width, ' + String(width) + 'px); height: 100%;',
    '    border-left: 1px solid var(--line); }',
    '  /* full: the whole window - 0,0 to innerWidth x innerHeight, no border, no frame. */',
    '  html[data-dsh-link-mode="full"] #panel { left: 0; right: 0; top: 0; width: 100%; height: 100%;',
    '    border-left: 0; }',
    '  /* The one thing full mode does BEYOND being a wider rect: two columns of cards instead of one. Same',
    '     document, same webview, one rect wider - which is the point: the switch moves the panel, it does',
    '     not reload it. */',
    '  html[data-dsh-link-mode="full"] .main { grid-template-columns: repeat(2, minmax(0, 1fr)); }',
    '  /* A card whose rows are sentences (the note ledger) and the card that ends in an action take the whole',
    '     width when there is one: two columns are for the two tables of numbers. */',
    '  html[data-dsh-link-mode="full"] .main > #notes-card { grid-column: 1 / -1; }',
    '  html[data-dsh-link-mode="full"] .main > .card:last-child { grid-column: 1 / -1; }',
    '  .topbar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px;',
    '    padding: 11px 14px; background: var(--bg); border-bottom: 1px solid var(--line-soft); }',
    '  .topbar h1 { font-size: 13px; font-weight: 650; letter-spacing: .10em; text-transform: uppercase;',
    '    margin: 0; color: var(--ink); }',
    '  .badge { font: 600 10px/1 var(--mono); letter-spacing: .06em; padding: 4px 8px; border-radius: 999px;',
    '    background: rgba(122,170,255,.12); color: var(--accent); border: 1px solid rgba(122,170,255,.30);',
    '    text-transform: uppercase; }',
    '  .dim { color: var(--ink-4); font: 11px/1 var(--mono); }',
    '  .topbar .dim:last-of-type { margin-left: auto; }',
    '  .btn { font: 600 11px/1 inherit; padding: 6px 10px; border-radius: 7px; cursor: pointer;',
    '    border: 1px solid var(--line); background: var(--layer-2); color: var(--ink-2); }',
    '  .btn:hover { border-color: rgba(255,255,255,.22); color: var(--ink); }',
    '  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '  .honesty { margin: 0; padding: 8px 14px; font-size: 11.5px; line-height: 1.45; color: var(--ink-4);',
    '    background: var(--layer-2); border-bottom: 1px solid var(--line-soft); }',
    '  .main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 12px 14px 22px;',
    '    align-content: start; }',
    '  .card { background: var(--layer); border: 1px solid var(--line-soft); border-radius: 10px;',
    '    padding: 10px 12px 12px; min-width: 0; }',
    '  .card > .head { display: flex; align-items: center; gap: 8px; margin: 0 0 9px; }',
    '  .card h2 { font-size: 12.5px; font-weight: 650; letter-spacing: .01em; margin: 0; color: var(--ink); }',
    '  .chip { margin-left: auto; flex: none; font: 600 9.5px/1 var(--mono); letter-spacing: .08em;',
    '    text-transform: uppercase; padding: 4px 7px; border-radius: 999px;',
    '    border: 1px solid var(--line); color: var(--ink-4); }',
    '  .chip[data-state="live"] { color: var(--ok); border-color: rgba(78,209,126,.32); background: rgba(78,209,126,.10); }',
    '  .chip[data-state="down"] { color: var(--warn); border-color: rgba(247,173,49,.32); background: rgba(247,173,49,.10); }',
    '  .chip[data-state="error"] { color: var(--bad); border-color: rgba(242,90,90,.32); background: rgba(242,90,90,.10); }',
    '  .said { margin: 0 0 8px; font-size: 12px; line-height: 1.45; color: var(--ink-3);',
    '    overflow-wrap: break-word; }',
    '  .said b { color: var(--warn); font-weight: 600; }',
    '  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(62px, 1fr)); gap: 7px; margin: 0 0 9px; }',
    '  .stat { background: var(--layer-2); border-radius: 8px; padding: 7px 9px; min-width: 0; }',
    '  .stat b { display: block; font-size: 17px; line-height: 1.15; font-weight: 650; color: var(--ink);',
    '    font-variant-numeric: tabular-nums; }',
    '  .stat span { display: block; margin-top: 2px; font-size: 9.5px; letter-spacing: .07em;',
    '    text-transform: uppercase; color: var(--ink-4); white-space: nowrap; overflow: hidden;',
    '    text-overflow: ellipsis; }',
    '  ul.rows { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; }',
    '  ul.rows li { display: flex; gap: 8px; align-items: baseline; min-width: 0; }',
    '  ul.rows .k { flex: none; width: 86px; font-size: 11px; color: var(--ink-4); }',
    '  /* Values WRAP rather than truncate: in a 420 px column an ellipsis on the ledger row hides the very',
    '     number the card exists to show. */',
    '  ul.rows .v { min-width: 0; font: 11.5px/1.45 var(--mono); color: var(--ink-2);',
    '    white-space: normal; word-break: keep-all; overflow-wrap: break-word; }',
    '  .note { font-size: 11.5px; line-height: 1.55; color: var(--ink-3); margin: 9px 0 0;',
    '    padding-top: 8px; border-top: 1px solid var(--line-soft); overflow-wrap: break-word; }',
    '  .drawer { margin: 0 14px 18px; border-top: 1px solid var(--line-soft); }',
    '  .drawer > summary { cursor: pointer; padding: 10px 0 2px; font-size: 11px; letter-spacing: .08em;',
    '    text-transform: uppercase; color: var(--ink-4); }',
    '  .drawer > summary:hover { color: var(--ink-2); }',
    '  .drawer > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '  .drawer h2 { font-size: 11px; letter-spacing: .10em; text-transform: uppercase; margin: 16px 0 6px;',
    '    color: var(--ink-3); font-weight: 650; }',
    '  dl.facts { display: grid; grid-template-columns: minmax(120px, 220px) 1fr; gap: 5px 14px; margin: 0; }',
    '  dl.facts dt { color: var(--ink-4); font-size: 11.5px; }',
    '  dl.facts dd { margin: 0; font: 11.5px/1.5 var(--mono); color: var(--ink-2); overflow-wrap: anywhere; }',
    '  .drawer table { width: 100%; border-collapse: collapse; }',
    '  .drawer th, .drawer td { text-align: left; vertical-align: top; padding: 5px 8px 5px 0;',
    '    border-top: 1px solid var(--line-soft); font-size: 11.5px; color: var(--ink-3); }',
    '  .drawer th { color: var(--ink-4); font-weight: 600; white-space: nowrap; }',
    '  .drawer code { font: 11px/1.45 var(--mono); color: var(--accent); overflow-wrap: anywhere; }',
    '  .drawer ol { margin: 0; padding-left: 18px; color: var(--ink-3); font-size: 11.5px; }',
    '  .drawer li { margin: 0 0 5px; }',
    '  .drawer p { margin: 9px 0 0; font-size: 11.5px; line-height: 1.55; color: var(--ink-3); }',
    '</style>',
  ].join('\n')
  const card = (key: string, title: string): string[] => [
    '    <article class="card" id="' + key + '-card">',
    '      <div class="head"><h2 data-i18n="' + key + '.title">' + title + '</h2>',
    '        <span class="chip" id="' + key + '-chip" data-state="loading" data-i18n="state.loading">reading</span></div>',
    '      <p class="said" id="' + key + '-said" hidden></p>',
    '      <div id="' + key + '-body"></div>',
    '    </article>',
  ]
  const markup = [
    '<html lang="en" data-dsh-link-mode="' + DEFAULT_MODE + '" data-dsh-link-panel="' + PANEL_NAME + '"',
    '      data-dsh-link-refusal="" data-dsh-link-embedded="unknown"',
    '      data-dsh-link-panel-width="0" data-dsh-link-panel-height="0"',
    '      style="--dsh-link-sidebar-width:' + String(width) + 'px">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>DSH-LINK</title>',
    css,
    '</head>',
    '<body data-dsh-link-mode="' + DEFAULT_MODE + '">',
    '<section id="panel" data-dsh-link-panel="' + PANEL_NAME + '" data-dsh-link-mode="' + DEFAULT_MODE + '" aria-label="DSH-LINK right panel">',
    '  <header class="topbar">',
    '    <h1>DSH-LINK</h1>',
    '    <span id="mode-badge" class="badge">' + DEFAULT_MODE + '</span>',
    '    <span class="dim">contract ' + CONTRACT_VERSION + '</span>',
    '    <span class="dim" id="read-at"></span>',
    '    <button class="btn" id="refresh" type="button" data-i18n="action.refresh">Refresh</button>',
    '  </header>',
    '',
    '  <p id="honesty" data-dsh-link-honesty class="honesty">No ancestor frame - this document stands on its own. A Tauri child webview looks exactly the same from inside, so this line cannot tell the two apart; the host knows.</p>',
    '',
    '  <main class="main">',
    ...card('bus', 'Bus'),
    ...card('board', 'Team board'),
    ...card('notes', 'Notes'),
    ...card('browser', 'Browser panel'),
    '  </main>',
    '',
    '  <details class="drawer" id="drawer" data-dsh-link-drawer>',
    '    <summary data-i18n="drawer.summary">Protocol &amp; facts / 协议与事实</summary>',
    '',
    '    <h2>Facts this document states</h2>',
    '    <dl class="facts">',
    '      <dt>mode</dt><dd id="fact-mode">' + DEFAULT_MODE + '</dd>',
    '      <dt>panel offsetWidth x offsetHeight</dt><dd id="fact-geometry">measuring...</dd>',
    '      <dt>where the mode came from</dt><dd id="fact-source">the built-in default (a host that sends nothing gets this)</dd>',
    '      <dt>refused by name</dt><dd id="fact-refusal">nothing</dd>',
    '      <dt>messages seen</dt><dd id="fact-messages">0 accepted, 0 ignored, 0 refused</dd>',
    '      <dt>last event</dt><dd id="fact-last">none yet</dd>',
    '      <dt>globals</dt><dd>window.__DSH_LINK_MODE, window.__DSH_LINK_EMBEDDED, window.__DSH_LINK_EMBED__</dd>',
    '    </dl>',
    '    <p><b>window.parent === window</b> is stated as-is, in data-dsh-link-embedded. It means "no ancestor frame",',
    '    NOT "not embedded": a Tauri child webview is a separate document with no parent, so this line cannot tell',
    '    "opened by a person" from "carried by a host". The host knows which of the two it did, and this page treats',
    '    both the same. A frame host may post to window.parent; a tab host to window.opener; a child webview host',
    '    evaluates the same message into the child instead.</p>',
    '',
    '    <h2>The two layouts, in this page\'s own text</h2>',
    '    <table>',
    '      <tr><th>sidebar</th><td>selector <code>html[data-dsh-link-mode="sidebar"] #panel</code>: a column pinned to the',
    '        right edge, width <code>?sidebarWidth=</code> (default ' + String(width) + ' px, accepted ' + String(MIN_SIDEBAR_WIDTH) + '..' + String(MAX_SIDEBAR_WIDTH) + ' px, an unusable',
    '        number is refused), height = the viewport, 1 px left border. This is the mode a document that was',
    '        told nothing draws.</td></tr>',
    '      <tr><th>full</th><td>selector <code>html[data-dsh-link-mode="full"] #panel</code>: the whole window, <code>0,0</code>',
    '        to <code>innerWidth x innerHeight</code>, no border. Same document, same webview, one rect wider - which is',
    '        the point: the switch moves the panel, it does not reload it.</td></tr>',
    '    </table>',
    '',
    '    <h2>How a host selects a mode</h2>',
    '    <ol>',
    '      <li>At load: <code>?mode=sidebar</code> or <code>?mode=full</code>. A host that can only set a URL is a host this page serves.</li>',
    '      <li>Any time after: <code>window.postMessage({type:"' + MODE_MESSAGE_TYPE + '", mode:"full"}, "*")</code> in this document,',
    '        or <code>window.parent.postMessage(...)</code> from a frame, or <code>window.opener.postMessage(...)</code> from a tab.</li>',
    '    </ol>',
    '    <p>An unknown mode is <em>refused by name</em> (<code>' + REFUSALS.MODE + '</code>) and the page stays in the last good',
    '    mode. A message whose type is not <code>' + MODE_MESSAGE_TYPE + '</code> is ignored. An unusable <code>?sidebarWidth=</code>',
    '    is refused (<code>' + REFUSALS.WIDTH + '</code>) and the default stands. An unknown <code>?panel=</code> is refused',
    '    (<code>' + REFUSALS.PANEL + '</code>).</p>',
    '',
    '    <h2>The four GET routes above, as data</h2>',
    '    <table>',
    ...LIVE_ROUTES.map((route) => '      <tr><th>' + route.key + '</th><td><code>' + route.path + '</code> - ' + route.reads + '</td></tr>'),
    '    </table>',
    '    <p>Each of them is read-only and answers GET. The panel states the HTTP status of a route it cannot',
    '    read instead of drawing a number for it, and it re-reads only when a person presses refresh or the',
    '    document becomes visible again.</p>',
    '  </details>',
    '</section>',
  ].join('\n')
  const script = [
    '<script>',
    '/* THE WHOLE PAGE: the mode protocol, and four same-origin reads. No framework, no build step, no',
    '   resource of any kind. THE ONE NETWORK DEVICE is window.fetch, captured once below; every read goes',
    '   through it with one of the four frozen paths, all of them on this document own origin. */',
    '(function () {',
    '  "use strict"',
    '  var VERSION = "' + CONTRACT_VERSION + '"',
    '  var MODES = ["' + MODES.join('", "') + '"]',
    '  var DEFAULT_MODE = "' + DEFAULT_MODE + '"',
    '  var MESSAGE_TYPE = "' + MODE_MESSAGE_TYPE + '"',
    '  var MODE_REFUSAL = "' + REFUSALS.MODE + '"',
    '  var PANEL_REFUSAL = "' + REFUSALS.PANEL + '"',
    '  var WIDTH_REFUSAL = "' + REFUSALS.WIDTH + '"',
    '  var PANELS = ["' + PANEL_NAME + '"]',
    '  var MIN_WIDTH = ' + String(MIN_SIDEBAR_WIDTH),
    '  var MAX_WIDTH = ' + String(MAX_SIDEBAR_WIDTH),
    '  var DEFAULT_WIDTH = ' + String(width),
    '',
    '  /* THE PAGE OWN DICTIONARY. Every product sentence on this surface comes from here, in both',
    '     languages; a key the dictionary does not name falls back to English rather than to a key name.',
    '     A language switch is one pass over [data-i18n] - there is no second copy of these words. */',
    '  var DICT = {',
    '    en: {',
    '      "action.refresh": "Refresh",',
    '      "action.open": "Open the panel entry",',
    '      "state.loading": "reading",',
    '      "state.live": "live",',
    '      "state.down": "unavailable",',
    '      "state.error": "error",',
    '      "bus.title": "Bus",',
    '      "board.title": "Team board",',
    '      "notes.title": "Notes",',
    '      "browser.title": "Browser panel",',
    '      "k.teams": "teams",',
    '      "k.members": "members",',
    '      "k.tasks": "tasks",',
    '      "k.records": "ledger rows",',
    '      "k.assignable": "claimable",',
    '      "k.live": "live notes",',
    '      "k.limit": "note limit",',
    '      "k.deleted": "deleted",',
    '      "k.maxchars": "chars each",',
    '      "k.recent": "recent",',
    '      "r.ledger": "ledger",',
    '      "r.damage": "damage",',
    '      "r.relay": "relay",',
    '      "r.messages": "messages",',
    '      "r.recorded": "recorder",',
    '      "r.teams": "team",',
    '      "r.task": "task",',
    '      "k.fixture": "fixture",',
    '      "k.withheld": "withheld",',
    '      "n.assignable": "the pending rows of this answer",',
    '      "v.intact": "every line parsed",',
    '      "v.broken": "broken lines",',
    '      "v.bound": "bound",',
    '      "v.unbound": "not bound",',
    '      "v.none": "none recorded",',
    '      "say.down": "Route unavailable",',
    '      "say.error": "Network failure",',
    '      "say.unreadable": "The answer is not a JSON object",',
    '      "n.messages": "R217 - where the bus can see message flow:",',
    '      "n.messages.none": "R217 - this kernel journals neither the Team mailbox nor the inbox splice, so the bus sees no message flow at all. That is a named absence, not a zero.",',
    '      "n.notes": "The three most recent live notes, in ledger order. A tombstone is counted above and not listed.",',
    '      "n.browser": "The panel entry on this origin:",',
    '      "n.browser.host": "A foreign host carries this page on ITS own origin, where /__shell/panel-start is a DSH-LINK shell route it owes nobody. The button would then open whatever that origin answers - which is why the reachability line above, not this note, is the answer.",',
    '      "honesty.direct": "No ancestor frame - this document stands on its own. A Tauri child webview looks exactly the same from inside, so this line cannot tell the two apart; the host knows.",',
    '      "honesty.frame": "Embedded - an ancestor frame is present (window.parent !== window), so a host may post to window.parent.",',
    '      "drawer.summary": "Protocol & facts"',
    '    },',
    '    zh: {',
    '      "action.refresh": "刷新",',
    '      "action.open": "打开面板入口",',
    '      "state.loading": "读取中",',
    '      "state.live": "在线",',
    '      "state.down": "不可用",',
    '      "state.error": "读取失败",',
    '      "bus.title": "总线",',
    '      "board.title": "团队看板",',
    '      "notes.title": "笔记",',
    '      "browser.title": "浏览器面板",',
    '      "k.teams": "团队",',
    '      "k.members": "成员",',
    '      "k.tasks": "任务",',
    '      "k.records": "账本条数",',
    '      "k.assignable": "可领取",',
    '      "k.live": "有效笔记",',
    '      "k.limit": "笔记上限",',
    '      "k.deleted": "已删除",',
    '      "k.maxchars": "每条字符",',
    '      "k.recent": "最近",',
    '      "r.ledger": "账本",',
    '      "r.damage": "损坏",',
    '      "r.relay": "中继",',
    '      "r.messages": "消息",',
    '      "r.recorded": "记录器",',
    '      "r.teams": "团队",',
    '      "r.task": "任务",',
    '      "k.fixture": "夹具行",',
    '      "k.withheld": "被扣留",',
    '      "n.assignable": "本次答复里状态为 pending 的行",',
    '      "v.intact": "每一行都可解析",',
    '      "v.broken": "损坏行",',
    '      "v.bound": "已绑定",',
    '      "v.unbound": "未绑定",',
    '      "v.none": "没有记录",',
    '      "say.down": "路由不可用",',
    '      "say.error": "网络失败",',
    '      "say.unreadable": "答复不是 JSON 对象",',
    '      "n.messages": "R217 - 总线能看到的消息流：",',
    '      "n.messages.none": "R217 - 这个内核既不记 Team 信箱，也不记收件箱拼接，总线看不到任何消息流。这是一个具名的缺失，不是一个零。",',
    '      "n.notes": "最近三条有效笔记，按账本顺序。墓碑在上面的计数里，不在这里列出。",',
    '      "n.browser": "本 origin 上的面板入口：",',
    '      "n.browser.host": "外部宿主是在它自己的 origin 上承载这一页的，那里的 /__shell/panel-start 是 DSH-LINK 外壳的路由，宿主并不欠它。此时按钮打开的是那个 origin 给出什么就是什么 - 所以上面那行可达性读数才是答案，不是这段说明。",',
    '      "honesty.direct": "没有祖先框架 - 这是一个独立文档。Tauri 子 webview 从里面看完全一样，所以这一行分不开这两种情况；宿主知道。",',
    '      "honesty.frame": "已嵌入 - 存在祖先框架（window.parent !== window），宿主可以向 window.parent 投递消息。",',
    '      "drawer.summary": "协议与事实"',
    '    }',
    '  }',
    '  var LANG = (typeof navigator === "object" && navigator !== null && /^zh/i.test(String(navigator.language))) ? "zh" : "en"',
    '',
    '  var root = document.documentElement',
    '  var body = document.body',
    '  var panel = document.getElementById("panel")',
    '  var state = {',
    '    mode: DEFAULT_MODE,',
    '    width: DEFAULT_WIDTH,',
    '    source: "the built-in default (a host that sends nothing gets this)",',
    '    refusals: [],',
    '    accepted: 0, ignored: 0, refused: 0,',
    '    reported: false,',
    '    last: "no message has arrived yet: this page works without one.",',
    '    /* HONESTY: a child webview is a separate document, so window.parent === window says "no ancestor',
    '       frame", NOT "not embedded". Both facts are stated rather than collapsed into one guess. */',
    '    frame: window.parent !== window',
    '  }',
    '  function t(key) {',
    '    var pack = DICT[LANG] || DICT.en',
    '    if (pack[key] !== undefined) { return pack[key] }',
    '    if (DICT.en[key] !== undefined) { return DICT.en[key] }',
    '    return key',
    '  }',
    '  function localise() {',
    '    if (typeof document.querySelectorAll !== "function") { return }',
    '    root.setAttribute("lang", LANG === "zh" ? "zh-CN" : "en")',
    '    var nodes = document.querySelectorAll("[data-i18n]")',
    '    for (var i = 0; i < nodes.length; i += 1) {',
    '      var key = nodes[i].getAttribute("data-i18n")',
    '      if (key !== null) { nodes[i].textContent = t(key) }',
    '    }',
    '  }',
    '  function put(id, value) { var node = document.getElementById(id); if (node !== null) { node.textContent = value } }',
    '  function mark(name, value) { root.setAttribute(name, value); body.setAttribute(name, value); panel.setAttribute(name, value) }',
    '',
    '  /* The geometry this page CHOSE, as document-level facts: the attribute a reader needs no script for,',
    '     and the panel own offsetWidth/offsetHeight - the CSS pixels a host hands its own bounds call. */',
    '  function publish() {',
    '    mark("data-dsh-link-mode", state.mode)',
    '    mark("data-dsh-link-panel", PANELS[0])',
    '    root.setAttribute("data-dsh-link-panel-width", String(panel.offsetWidth))',
    '    root.setAttribute("data-dsh-link-panel-height", String(panel.offsetHeight))',
    '    root.setAttribute("data-dsh-link-refusal", state.refusals.length === 0 ? "" : state.refusals[state.refusals.length - 1])',
    '    root.setAttribute("data-dsh-link-embedded", state.frame ? "frame" : "no-ancestor-frame")',
    '    put("mode-badge", state.mode)',
    '    put("fact-mode", state.mode)',
    '    put("fact-geometry", String(panel.offsetWidth) + " x " + String(panel.offsetHeight) + " css px"',
    '      + (state.mode === "full" ? " (the whole viewport)" : " (the right column)"))',
    '    put("fact-source", state.source)',
    '    put("fact-refusal", state.refusals.length === 0 ? "nothing" : state.refusals.join("; "))',
    '    put("fact-messages", String(state.accepted) + " accepted, " + String(state.ignored) + " ignored, " + String(state.refused) + " refused")',
    '    put("fact-last", state.last)',
    '    put("honesty", state.frame ? t("honesty.frame") : t("honesty.direct"))',
    '    window.__DSH_LINK_MODE = state.mode',
    '    window.__DSH_LINK_EMBEDDED = state.frame',
    '    window.__DSH_LINK_EMBED__ = {',
    '      version: VERSION, mode: state.mode, modes: MODES.slice(), panel: PANELS[0],',
    '      width: panel.offsetWidth, height: panel.offsetHeight,',
    '      source: state.source, frame: state.frame, refusals: state.refusals.slice(),',
    '      accepted: state.accepted, ignored: state.ignored, refused: state.refused, last: state.last',
    '    }',
    '  }',
    '',
    '  /* The way back out. A child webview has no opener and no parent window, so there is nothing to post to',
    '     there and the document itself is the report; a closed opener is not this page failure. */',
    '  function report(accepted, requested, how) {',
    '    var target = null',
    '    if (window.opener !== null && typeof window.opener === "object") { target = window.opener }',
    '    else if (state.frame) { target = window.parent }',
    '    if (target === null) { return }',
    '    try {',
    '      target.postMessage({ type: MESSAGE_TYPE, mode: state.mode, accepted: accepted, requested: requested, from: how, version: VERSION }, "*")',
    '      state.reported = true',
    '    } catch (error) {',
    '      state.last = "the opener could not be told (" + String(error && error.message) + "); the document states the mode instead"',
    '    }',
    '  }',
    '',
    '  /* ONE way in for a mode value, whoever asked: the URL at load, a postMessage later. A value that is not',
    '     one of the two modes is REFUSED BY NAME and the last good mode stays. */',
    '  function select(requested, how) {',
    '    var mode = typeof requested === "string" ? requested : ""',
    '    if (MODES.indexOf(mode) < 0) {',
    '      state.refused += 1',
    '      state.refusals.push(MODE_REFUSAL + ": " + how + " asked for " + JSON.stringify(String(requested)) + ", which is not " + MODES.join(" or ") + "; still " + state.mode)',
    '      state.last = "REFUSED a mode by name: " + MODE_REFUSAL + " - " + how + " asked for " + JSON.stringify(String(requested)) + "; this page stayed in " + state.mode',
    '      publish()',
    '      report(false, requested, how)',
    '      return false',
    '    }',
    '    state.mode = mode',
    '    state.source = how',
    '    state.accepted += 1',
    '    state.last = "accepted " + mode + " from " + how',
    '    publish()',
    '    report(true, requested, how)',
    '    return true',
    '  }',
    '',
    '  function usableWidth(raw) {',
    '    if (raw === null || raw === "") { return null }',
    '    var n = Number(raw)',
    '    if (isFinite(n) === false) { return null }',
    '    n = Math.round(n)',
    '    return (n < MIN_WIDTH || n > MAX_WIDTH) ? null : n',
    '  }',
    '',
    '  var params = new URLSearchParams(location.search)',
    '  var askedWidth = params.get("sidebarWidth")',
    '  if (askedWidth !== null) {',
    '    var w = usableWidth(askedWidth)',
    '    if (w === null) {',
    '      state.refusals.push(WIDTH_REFUSAL + ": ?sidebarWidth=" + JSON.stringify(String(askedWidth)) + " is not a number in " + MIN_WIDTH + ".." + MAX_WIDTH + "; the default " + DEFAULT_WIDTH + " stands")',
    '    } else {',
    '      state.width = w',
    '      root.style.setProperty("--dsh-link-sidebar-width", w + "px")',
    '    }',
    '  }',
    '  var askedPanel = params.get("panel")',
    '  if (askedPanel !== null && PANELS.indexOf(askedPanel) < 0) {',
    '      state.refusals.push(PANEL_REFUSAL + ": ?panel=" + JSON.stringify(String(askedPanel)) + " is not a surface this build draws; " + PANELS[0] + " is drawn")',
    '  }',
    '',
    '  var askedMode = params.get("mode")',
    '  if (askedMode === null) {',
    '    publish()',
    '  } else {',
    '    select(askedMode, "the URL (?mode=)")',
    '  }',
    '',
    '  window.addEventListener("message", function (event) {',
    '    var incoming = (event === null || event === undefined) ? null : event.data',
    '    var type = (incoming !== null && typeof incoming === "object") ? incoming.type : null',
    '    if (type !== MESSAGE_TYPE) {',
    '      state.ignored += 1',
    '      state.last = "IGNORED a message of type " + JSON.stringify(String(type)) + ": this page speaks " + MESSAGE_TYPE + " only"',
    '      publish()',
    '      return',
    '    }',
    '    select(incoming.mode, "a postMessage")',
    '  })',
    '',
    '  window.addEventListener("resize", function () { publish() })',
    '',
    '  /* ---------------------------------------------------------------------------------------------',
    '     THE LIVE SECTIONS. Four same-origin GETs, one device, no timer. Nothing below invents a number:',
    '     a route that cannot be read says so in the section it belongs to and draws no figure at all.',
    '     --------------------------------------------------------------------------------------------- */',
    '  var NET = (typeof window.fetch === "function") ? window.fetch.bind(window) : null',
    '  var ROUTES = [',
    ...LIVE_ROUTES.map((route) => '    { key: "' + route.key + '", path: "' + route.path + '", kind: "' + route.kind + '" },'),
    '  ]',
    '  function readOne(route) {',
    '    if (NET === null) { return Promise.resolve({ ok: false, status: null, route: route, body: null, why: "this document has no fetch to read with" }) }',
    '    if (typeof location.origin !== "string" || location.origin === "" || location.origin === "null") { return Promise.resolve({ ok: false, status: null, route: route, body: null, why: "this document has no origin to read from" }) }',
    '    var accept = route.kind === "json" ? "application/json" : "text/html"',
    '    return NET(location.origin + route.path, { method: "GET", cache: "no-store", credentials: "same-origin", headers: { accept: accept } })',
    '      .then(function (answer) {',
    '        return answer.text().then(function (text) {',
    '          var parsed = null',
    '          if (route.kind === "json") { try { parsed = JSON.parse(text) } catch (error) { parsed = null } }',
    '          return { ok: answer.status === 200, status: answer.status, route: route, body: parsed, why: null }',
    '        })',
    '      })',
    '      .catch(function (error) {',
    '        return { ok: false, status: null, route: route, body: null, why: String((error && error.message) || error) }',
    '      })',
    '  }',
    '  function num(value) { return (typeof value === "number" && isFinite(value)) ? value : null }',
    '  function n(value) { var v = num(value); return v === null ? "-" : String(v) }',
    '  function s(value) { return (value === null || value === undefined || value === "") ? "-" : String(value) }',
    '  function short(value) {',
    '    var text = s(value)',
    '    return text.length > 22 ? text.slice(0, 22) + "..." : text',
    '  }',
    '  function el(tag, cls, text) {',
    '    var node = document.createElement(tag)',
    '    if (cls) { node.className = cls }',
    '    if (text !== undefined && text !== null) { node.textContent = String(text) }',
    '    return node',
    '  }',
    '  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild) } }',
    '  function stat(label, value) {',
    '    var box = el("div", "stat")',
    '    box.appendChild(el("b", null, value))',
    '    box.appendChild(el("span", null, label))',
    '    return box',
    '  }',
    '  function stats(host, pairs) {',
    '    var box = el("div", "stats")',
    '    for (var i = 0; i < pairs.length; i += 1) { box.appendChild(stat(pairs[i][0], pairs[i][1])) }',
    '    host.appendChild(box)',
    '  }',
    '  function rows(host, pairs) {',
    '    var list = el("ul", "rows")',
    '    for (var i = 0; i < pairs.length; i += 1) {',
    '      var li = el("li")',
    '      li.appendChild(el("span", "k", pairs[i][0]))',
    '      li.appendChild(el("span", "v", pairs[i][1]))',
    '      list.appendChild(li)',
    '    }',
    '    host.appendChild(list)',
    '  }',
    '',
    '  function renderBus(host, doc) {',
    '    var world = doc.world || {}',
    '    var ledger = doc.ledger || {}',
    '    var relay = doc.relay || {}',
    '    var messages = doc.messages || {}',
    '    var recorded = doc.recorded || {}',
    '    stats(host, [',
    '      [t("k.teams"), n(world.teams)],',
    '      [t("k.members"), n(world.members)],',
    '      [t("k.tasks"), n(world.tasks)],',
    '      [t("k.records"), n(ledger.records)]',
    '    ])',
    '    rows(host, [',
    '      [t("r.ledger"), n(ledger.records) + " / lastSeq " + n(ledger.lastSeq) + " / " + s(ledger.writer) + " @ " + short(ledger.instance)],',
    '      [t("r.damage"), (ledger.damage === null || ledger.damage === undefined) ? t("v.intact") : (t("v.broken") + " " + n(ledger.damage.brokenLines) + " / last good seq " + n(ledger.damage.lastGoodSeq))],',
    '      [t("r.relay"), (relay.bound === true ? t("v.bound") : t("v.unbound")) + " " + s(relay.path) + " / " + n(relay.accepted) + " accepted / " + n(relay.refused) + " refused" + ((relay.lastCode === null || relay.lastCode === undefined) ? "" : " / " + String(relay.lastCode))],',
    '      [t("r.messages"), n(messages.journal) + " journal / " + n(messages.inbox) + " inbox / source " + s(messages.source) + " / scope " + s(messages.scope)],',
    '      [t("r.recorded"), n(recorded.seen) + " seen / " + n(recorded.recorded) + " kept / " + n(recorded.ignored) + " ignored / " + n(recorded.failed) + " failed"]',
    '    ])',
    '    host.appendChild(el("p", "note", (messages.source === "none" || messages.source === undefined) ? t("n.messages.none") : (t("n.messages") + " " + s(messages.source) + " -> " + s(messages.scope))))',
    '  }',
    '',
    '  function renderBoard(host, doc) {',
    '    var counts = doc.counts || {}',
    '    var tree = doc.teams || {}',
    '    var nodes = Array.isArray(tree.teams) ? tree.teams : []',
    '    var tasks = Array.isArray(doc.tasks) ? doc.tasks : []',
    '    var pending = 0',
    '    var fixture = 0',
    '    for (var i = 0; i < tasks.length; i += 1) {',
    '      if (tasks[i] !== null && tasks[i] !== undefined && tasks[i].status === "pending") { pending += 1 }',
    '      if (tasks[i] !== null && tasks[i] !== undefined && tasks[i].fixture === true) { fixture += 1 }',
    '    }',
    '    stats(host, [',
    '      [t("k.teams"), n(counts.teams)],',
    '      [t("k.members"), n(counts.members)],',
    '      [t("k.tasks"), n(counts.tasks)],',
    '      [t("k.assignable"), String(pending)]',
    '    ])',
    '    var list = []',
    '    for (var j = 0; j < nodes.length && j < 4; j += 1) {',
    '      var node = nodes[j] || {}',
    '      list.push([t("r.teams"), short(node.id) + " / " + n(node.tasks) + " " + t("k.tasks") + " / " + n(node.members) + " " + t("k.members") + (node.declared === true ? " / declared" : ""), true])',
    '    }',
    '    if (list.length === 0) { list.push([t("r.teams"), t("v.none"), true]) }',
    '    rows(host, list)',
    '    var tail = []',
    '    for (var k = 0; k < tasks.length && k < 5; k += 1) {',
    '      var task = tasks[k] || {}',
    '      tail.push([t("r.task"), s(task.id) + " / " + s(task.status) + (task.fixture === true ? " / " + t("k.fixture") : "") + " @" + short(task.team)])',
    '    }',
    '    if (tail.length > 0) { rows(host, tail) }',
    '    host.appendChild(el("p", "note", String(pending) + " " + t("k.assignable") + " (" + t("n.assignable") + ") / " + String(fixture) + " " + t("k.fixture") + " / " + n(tree.withheld) + " " + t("k.withheld")))',
    '  }',
    '',
    '  function renderNotes(host, doc) {',
    '    var counts = doc.counts || {}',
    '    var limits = doc.limits || {}',
    '    var notes = Array.isArray(doc.notes) ? doc.notes : []',
    '    stats(host, [',
    '      [t("k.live"), n(counts.live)],',
    '      [t("k.limit"), n(limits.maxNotes)],',
    '      [t("k.deleted"), n(counts.deleted)],',
    '      [t("k.maxchars"), n(limits.maxChars)]',
    '    ])',
    '    var recent = notes.slice(-3).reverse()',
    '    var list = []',
    '    for (var i = 0; i < recent.length; i += 1) {',
    '      var note = recent[i] || {}',
    '      var text = String(note.text === null || note.text === undefined ? "" : note.text)',
    '      if (text.length > 96) { text = text.slice(0, 96) + "..." }',
    '      var tags = (Array.isArray(note.tags) && note.tags.length > 0) ? " #" + note.tags.join(" #") : ""',
    '      list.push([s(note.author), text + tags, true])',
    '    }',
    '    if (list.length === 0) { list.push([t("k.recent"), t("v.none"), true]) }',
    '    rows(host, list)',
    '    host.appendChild(el("p", "note", t("n.notes")))',
    '  }',
    '',
    '  function renderBrowser(host, answer) {',
    '    var origin = (typeof location.origin === "string") ? location.origin : ""',
    '    var entry = origin + ROUTES[3].path',
    '    var button = el("button", "btn", t("action.open"))',
    '    button.setAttribute("type", "button")',
    '    if (answer.ok !== true) { button.setAttribute("disabled", "disabled") }',
    '    button.addEventListener("click", function () {',
    '      if (typeof window.open === "function") { window.open(entry, "_blank", "noopener") }',
    '    })',
    '    host.appendChild(button)',
    '    host.appendChild(el("p", "note", t("n.browser") + " " + entry))',
    '    host.appendChild(el("p", "note", t("n.browser.host")))',
    '  }',
    '',
    '  function paint(route, kind, answer) {',
    '    var chip = document.getElementById(route.key + "-chip")',
    '    var said = document.getElementById(route.key + "-said")',
    '    var host = document.getElementById(route.key + "-body")',
    '    if (chip !== null) { chip.setAttribute("data-state", kind); chip.textContent = t("state." + kind) }',
    '    if (said !== null) {',
    '      if (kind === "live" || kind === "loading") { said.hidden = true; said.textContent = "" }',
    '      else {',
    '        said.hidden = false',
    '        said.textContent = (answer !== null && answer.status === null)',
    '          ? t("say.error") + ": " + String(answer === null ? "" : answer.why)',
    '          : t("say.down") + " - HTTP " + String(answer === null ? "?" : answer.status) + " / GET " + route.path',
    '      }',
    '    }',
    '    if (host === null) { return }',
    '    clear(host)',
    '    if (kind === "loading" || answer === null) { return }',
    '    if (route.key === "browser") { renderBrowser(host, answer); return }',
    '    if (kind !== "live") { return }',
    '    if (answer.body === null || typeof answer.body !== "object") {',
    '      host.appendChild(el("p", "said", t("say.unreadable")))',
    '      return',
    '    }',
    '    if (route.key === "bus") { renderBus(host, answer.body) }',
    '    else if (route.key === "board") { renderBoard(host, answer.body) }',
    '    else if (route.key === "notes") { renderNotes(host, answer.body) }',
    '  }',
    '',
    '  /* The freshest instant the served documents name - a reading of THEIR clock, never of this one. */',
    '  var newest = 0',
    '  function stamp(at) {',
    '    var value = num(at)',
    '    if (value === null || value <= newest) { return }',
    '    newest = value',
    '    put("read-at", "read " + new Date(value).toISOString().slice(11, 19) + "Z")',
    '  }',
    '',
    '  function ask(route) {',
    '    readOne(route).then(function (answer) {',
    '      stamp(answer.body !== null && typeof answer.body === "object" ? answer.body.at : null)',
    '      paint(route, answer.ok === true ? "live" : (answer.status === null ? "error" : "down"), answer)',
    '    })',
    '  }',
    '  function load() {',
    '    var i',
    '    for (i = 0; i < ROUTES.length; i += 1) { paint(ROUTES[i], "loading", null) }',
    '    for (i = 0; i < ROUTES.length; i += 1) { ask(ROUTES[i]) }',
    '  }',
    '',
    '  publish()',
    '  /* A URL-only host that never posts still gets one report, when there is somebody to report to. */',
    '  if (state.reported === false) { report(true, state.mode, "load") }',
    '  localise()',
    '  var refresh = document.getElementById("refresh")',
    '  if (refresh !== null && typeof refresh.addEventListener === "function") {',
    '    refresh.addEventListener("click", function () { load() })',
    '  }',
    '  if (typeof document.addEventListener === "function") {',
    '    document.addEventListener("visibilitychange", function () {',
    '      if (document.visibilityState === "visible") { load() }',
    '    })',
    '  }',
    '  if (typeof location.origin === "string" && location.origin !== "" && location.origin !== "null") { load() }',
    '})();',
    '</script>',
  ].join('\n')
  return [head, markup, script, '</body>', '</html>', ''].join('\n')
}
/** One JSON answer, no-store: this surface is a reading of the contract, never something to cache. */
function sendJson(res: any, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/** One HTML answer. The bytes are the page, so they are sent as the page and never sniffed as anything else. */
function sendHtml(res: any, html: string): void {
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.end(html)
}

/**
 * The named answer for a verb a route does not take.
 *
 * GET is the only verb either route takes: the contract's own words are "anything but GET", so HEAD is
 * refused here too rather than answered with a body nobody asked for. The refused body is drained first,
 * or the socket can be torn down with it half-read and the caller reads that as this server failing
 * rather than as its own verb being refused.
 */
function methodNotAllowed(req: any, res: any, noun: string): void {
  if (typeof req.resume === 'function') req.resume()
  res.setHeader('allow', 'GET')
  sendJson(res, 405, {
    ok: false,
    error: {
      code: REFUSALS.METHOD,
      message: noun + ' takes GET and nothing else, so ' + String(req.method) + ' was refused',
    },
  })
}

/** Row configuration. */
export interface HostConfig {
  /** The sidebar width the page draws when the host asks for none. Defaults to DEFAULT_SIDEBAR_WIDTH. */
  sidebarWidth?: number
}

/**
 * Bind the two routes on this composition's web server, if it has one.
 *
 * The same lazy binding plugins/dsh-link-notes/src/index.ts:877-993 uses: apply() can run before the web
 * application mounts, so the registration is attempted now and again when webServer appears, and the
 * whole thing is disposed with the row through ctx.effect.
 * @param ctx - the cordis context this row was applied to.
 * @param sidebarWidth - the row's resolved default width.
 */
function installRoutes(ctx: any, sidebarWidth: number): void {
  const disposers: Array<() => void> = []
  let bound = false

  /** The contract, built once: this row has no state a request could change. */
  const contract = JSON.stringify(contractBody(sidebarWidth))
  /** The page, built once: every request answers the same bytes, which is what makes two GETs comparable. */
  const page = embedPage(sidebarWidth)

  async function contractHandler(req: any, res: any): Promise<void> {
    if (req.method !== 'GET') {
      methodNotAllowed(req, res, 'dsh-link-host contract')
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(contract)
  }

  async function embedHandler(req: any, res: any): Promise<void> {
    if (req.method !== 'GET') {
      methodNotAllowed(req, res, 'dsh-link-host embed')
      return
    }
    sendHtml(res, page)
  }

  const routes = [
    { kind: 'exact', path: CONTRACT_ROUTE_PATH, handler: contractHandler },
    { kind: 'exact', path: EMBED_ROUTE_PATH, handler: embedHandler },
  ]

  function registerRoutes(): void {
    if (bound) return
    const server = (ctx as { get?: (name: string) => unknown }).get?.('webServer') as { register?: (route: unknown) => () => void } | null | undefined
    if (server === null || server === undefined || typeof server.register !== 'function') return
    try {
      for (const route of routes) disposers.push(server.register(route))
      bound = true
      console.log('[dsh-link-host] contract route bound on ' + CONTRACT_ROUTE_PATH + ' (GET, read-only: version ' + CONTRACT_VERSION + ', modes ' + MODES.join('/') + ', the four origin sites)')
      console.log('[dsh-link-host] embed route bound on ' + EMBED_ROUTE_PATH + ' (GET, one self-contained page, ' + String(Buffer.byteLength(page, 'utf8')) + ' bytes)')
    } catch (error) {
      console.error('[dsh-link-host] could not bind the embed routes: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  registerRoutes()
  if (typeof (ctx as { inject?: unknown }).inject === 'function') {
    ctx.inject(['webServer'], () => registerRoutes())
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        bound = false
        for (const dispose of disposers.splice(0)) {
          try {
            dispose()
          } catch {
            /* a route that is already gone is not an error worth reporting */
          }
        }
      },
      'dsh-link-host: routes',
    )
  }
}

/**
 * Publish the embed surface: the contract as data, and the page a host child webview loads.
 *
 * Neither route reads a request, a clock or a counter, so the answer to "is this surface read-only" is the
 * code itself: there is nothing here that could write.
 * @param ctx - the cordis context this plugin is applied to.
 * @param config - the row's own configuration; an absent width means DEFAULT_SIDEBAR_WIDTH.
 */
export function apply(ctx: any, config: HostConfig = {}): void {
  const sidebarWidth = configuredWidth(config?.sidebarWidth, 'sidebarWidth')
  installRoutes(ctx, sidebarWidth)
  console.log('[dsh-link-host] ready — contract ' + CONTRACT_VERSION + ', modes ' + MODES.join('/') + ', the page draws '
    + PANEL_NAME + ' at ' + String(sidebarWidth) + 'px in sidebar mode')
}

export default { name, inject, apply }
