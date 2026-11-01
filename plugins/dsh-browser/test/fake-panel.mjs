/**
 * A faithful fake of the shell's sidebar panel HTTP surface, for OFFLINE readings (R184).
 *
 * Two rules make this world worth measuring against instead of a tautology:
 *
 * 1. EVERY SHAPE AND EVERY SENTENCE IS TRANSCRIBED from the real shell, and the transcription is
 *    checked by the self-check itself: the op=state key set is compared against the format string in
 *    src-tauri/src/core/sidebar_panel.rs, and the refusals carry the shell's own wording (the cap, an
 *    unknown id, an unmounted browser, somebody else's lease). "Two liars agreeing" is exactly what
 *    this file must not become.
 * 2. WHAT IT DOES NOT MODEL IT REFUSES BY NAME (FAKE_UNSUPPORTED), never a silent 200 - a fake that
 *    answers everything can hide a caller that asked the wrong question.
 *
 * It models the parts of the shell the tab face depends on: the tab set and its cap, the active tab,
 * parking (the shell keeps one tab in the content area and parks the rest), the shell's RECORD of a
 * tab's URL vs. the tab's OWN document, the lease and the user-input takeover, and the CDP route
 * (/__shell/panel/cdp) with its tab field.
 *
 * NOT modelled, on purpose: Tauri rectangles (bounds is null here). R184's tools never read a tab's
 * geometry - the real rect is the R182-G question - so a fake rect would be an invented fact.
 */
import http from 'node:http'

/** The shell's own refusals, and the one constant it publishes. */
export const SHELL = {
  MAX_TABS: 4,
  cap: (nextId, limit, ids) =>
    'named refusal: op=tab-new is not opening tab t' + nextId + ' because the limit is ' + limit + ' tabs and ' + ids.length + ' are live (' + ids.join(', ') + '); close one first',
  unknownTab: (op, id, ids) => 'named refusal: op=' + op + ' for tab ' + JSON.stringify(id) + ', which is not one of [' + ids.join(', ') + ']',
  notMounted: 'tab-new needs a mounted browser: call op=mount first',
  noSurface: 'tab-new needs a surface: declare one with op=surface first',
  leased: (other, holder) => 'the panel is leased by ' + other + ' and not by ' + holder + ': the placement was refused',
  takenNoLease: (by, kind) => 'the panel was TAKEN by ' + by + ' (' + kind + '): no lease was held, so nothing was revoked - claim it (op=lease claim) to continue',
  taken: (holder, by, kind) => 'the lease held by ' + holder + ' was REVOKED by ' + by + ' (' + kind + '): claim the panel again to continue',
  noActiveTab: 'no active tab: mount a browser with a tab before asking it anything',
  unsupported: (what) => 'FAKE_UNSUPPORTED: ' + what,
}

export const USER_SHELL_HOLDER = 'user-chrome'
export const USER_PAGE_HOLDER = 'user-page'
const isUserPage = (holder) => holder === USER_SHELL_HOLDER || holder === USER_PAGE_HOLDER

/** A 1x1 PNG, so Page.captureScreenshot answers something a caller can decode. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * Start a fake panel.
 *
 * options:
 *   urls      seed tab URLs (default one start tab: the real op=mount creates t1 when the set is empty)
 *   limit     the tab cap, as the report carries it
 *   mounted   op=mount already happened
 *   surface   the page host declared a surface
 *   exists    the user's right column is open
 *   redirect  (requestedUrl) => landedUrl: where a site REALLY lands. The shell records the REQUESTED
 *             url, so these two must not be the same string for the landing reading to mean anything.
 *   mutate    a named lie the world tells, so a reading can be shown to go red:
 *             ignore-tab      cdp and tab-goto serve the ACTIVE tab whatever tab was named
 *             ignore-holder   the lease rule and the takeover record are skipped
 *             silent-cap      tab-new at the cap answers 200 without creating anything
 *             no-count        the op=state report drops limit
 *             stale-readback  the first op=state after a write answers the report from BEFORE it
 *             first-tab       closing the active tab activates the first tab instead of the left one
 */
export function createFakePanel(options = {}) {
  const mutate = options.mutate ?? null
  const world = {
    exists: options.exists !== false,
    mounted: options.mounted !== false,
    surface: options.surface !== false,
    limit: Number.isFinite(options.limit) ? options.limit : SHELL.MAX_TABS,
    mode: 'fixed',
    viewport: { w: 1280, h: 800 },
    scale: 0.5,
    next: 0,
    tabs: [],
    active: null,
    lease: null,
    revoked: null,
  }
  const requests = []
  /** For the stale-readback lie: the report as it was before the last write. */
  let preWrite = null
  const WRITES = new Set(['mount', 'open', 'surface', 'set-bounds', 'tab-new', 'tab-close', 'tab-activate', 'tab-goto'])
  const seed = Array.isArray(options.urls) && options.urls.length > 0 ? options.urls : ['https://start.test/']

  function addTab(url) {
    world.next += 1
    const id = 't' + world.next
    const tab = { id, label: 'sidebar-browser-tab-' + world.next, url, live: true, page: { href: url, title: 'Start ' + world.next } }
    world.tabs.push(tab)
    return tab
  }

  function reset(urls) {
    world.tabs = []
    world.next = 0
    world.active = null
    world.lease = null
    world.revoked = null
    for (const url of Array.isArray(urls) && urls.length > 0 ? urls : seed) addTab(url)
    world.active = world.tabs[0]?.id ?? null
  }
  reset(seed)

  const activeTab = () => world.tabs.find((tab) => tab.id === world.active) ?? null
  const ids = () => world.tabs.map((tab) => tab.id)
  /** Where a navigation REALLY lands. The default is "no redirect": the two strings are then equal. */
  const landedUrl = (url) => (typeof options.redirect === "function" ? options.redirect(url) : url)

  function tabsJson() {
    return world.tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      url: tab.url,
      live: tab.live,
      active: tab.id === world.active,
      // The shell has a title for the ACTIVE tab only; the rest are null on purpose.
      title: tab.id === world.active && typeof tab.page.title === 'string' ? tab.page.title : null,
      bounds: null,
    }))
  }

  /**
   * op=state, with the REAL key set and key ORDER (sidebar_panel.rs:538-592). The self-check compares
   * this key list against that format string, so drift on either side is a failing reading.
   */
  function state() {
    const page = activeTab()?.page ?? null
    const report = {
      exists: world.exists,
      label: 'sidebar-browser-chrome',
      bounds: world.exists ? { x: 0, y: 0, w: 612, h: 900 } : null,
      dataDir: 'C:\\fake\\data',
      url: 'http://127.0.0.1:31761/__shell/browser',
      lastError: null,
      pending: false,
      pageUrl: page?.href ?? null,
      content: page === null ? null : { href: page.href, title: page.title, text: 'fake panel', focus: true, errors: [] },
      contentReports: page === null ? 0 : 1,
      lease: leaseJson(),
      mounted: world.mounted,
      chromeH: 36,
      chinH: 12,
      chromeLabel: 'sidebar-browser-chrome',
      surface: world.surface ? { units: 'logical', x: 0, y: 0, w: 612, h: 900 } : null,
      chromePane: { units: 'logical', x: 0, y: 0, w: 612, h: 108 },
      contentPane: { units: 'logical', x: 0, y: 108, w: 612, h: 780 },
      active: world.active,
      count: world.tabs.length,
      limit: world.limit,
      tabs: tabsJson(),
      mode: world.mode,
      modeApplied: world.mounted,
      modeError: null,
      viewport: { w: world.viewport.w, h: world.viewport.h },
      scale: world.scale,
      hiddenStyle: 'zero',
      chromeBounds: { x: 0, y: 0, w: 612, h: 108 },
      lastUserInput: world.revoked === null ? null : world.revoked.kind,
      userInputReports: world.revoked === null ? 0 : 1,
      deckPane: { units: 'logical', x: 0, y: 0, w: 612, h: 888 },
      bayPane: { units: 'logical', x: 0, y: 108, w: 612, h: 780 },
      screenPane: { units: 'logical', x: 0, y: 108, w: 612, h: 382.5 },
      viewportPreset: '1280x800',
      presets: [{ name: '1280x800', w: 1280, h: 800, label: 'default WXGA' }],
      prefsPath: 'C:\\fake\\browser.json',
    }
    if (mutate === 'no-count') delete report.limit
    return report
  }

  function leaseJson() {
    const live = world.lease !== null && world.lease.expiresAt > Date.now() ? world.lease : null
    if (world.lease !== null && live === null) world.lease = null
    return {
      held: live !== null,
      holder: live === null ? null : live.holder,
      expiresInMs: live === null ? 0 : Math.max(0, live.expiresAt - Date.now()),
      revokedBy: world.revoked === null ? null : world.revoked.by,
      revokedHolder: world.revoked === null ? null : world.revoked.holder,
      revokedKind: world.revoked === null ? null : world.revoked.kind,
    }
  }

  /** enforce_lease (sidebar_panel.rs:777-811), to the depth the tab writes reach. */
  function enforceLease(op, holder) {
    if (world.lease !== null && world.lease.expiresAt <= Date.now()) world.lease = null
    const heldByOther = world.lease !== null && world.lease.holder !== holder ? world.lease.holder : null
    if (heldByOther !== null) {
      if (mutate === 'ignore-holder') {
        // the world forgets whose turn it is
      } else if (holder !== USER_SHELL_HOLDER) {
        return SHELL.leased(heldByOther, holder === undefined ? 'nobody' : holder)
      } else {
        takeTurn('shell-control:' + op)
      }
    } else if (holder === USER_SHELL_HOLDER) {
      takeTurn('shell-control:' + op)
    }
    return refuseIfTaken(holder)
  }

  function takeTurn(kind) {
    const previous = world.lease === null ? '' : world.lease.holder
    world.lease = null
    world.revoked = { holder: previous, by: 'user-input', kind }
  }

  function refuseIfTaken(holder) {
    if (world.revoked === null) return null
    if (isUserPage(holder)) return null
    if (mutate === 'ignore-holder') return null
    const record = world.revoked
    if (record.holder === '') return SHELL.takenNoLease(record.by, record.kind)
    return SHELL.taken(record.holder, record.by, record.kind)
  }

  /** The tab a CDP call really reaches, honoring the mutation that forgets the named tab. */
  function cdpTarget(tab) {
    if (mutate === 'ignore-tab') return activeTab()
    if (tab === undefined || tab === null) return activeTab()
    if (tab === 'chrome') return { id: 'chrome', page: { href: 'http://127.0.0.1:31761/__shell/browser', title: 'browser bar' } }
    return world.tabs.find((entry) => entry.id === tab) ?? null
  }

  /**
   * One protocol call, answered the way the shell answers it: the WHOLE protocol envelope
   * ({ id, result }), whose inner result is what a caller wants (proxy.rs:636-639 wraps the shell`s
   * reply string; PanelCdpClient unwraps the envelope).
   */
  let cdpSeq = 0
  function cdpCall(tab, holder, method, params) {
    const taken = refuseIfTaken(holder)
    if (taken !== null) return { error: taken }
    if (method === 'Runtime.evaluate') {
      const expression = typeof params?.expression === 'string' ? params.expression : ''
      const target = cdpTarget(tab)
      if (target === null) return { error: SHELL.unknownTab('cdp', tab, ids()) }
      const page = target.page
      if (expression.includes('devicePixelRatio')) {
        const value = JSON.stringify({ w: world.viewport.w, h: world.viewport.h, dpr: 1, href: page.href, title: page.title })
        return { result: envelope({ result: { type: 'string', value } }) }
      }
      if (expression.includes('readyState')) {
        const value = JSON.stringify({ href: page.href, title: page.title, ready: 'complete' })
        return { result: envelope({ result: { type: 'string', value } }) }
      }
      if (expression === 'location.href') return { result: envelope({ result: { type: 'string', value: page.href } }) }
      if (expression === 'document.readyState') return { result: envelope({ result: { type: 'string', value: 'complete' } }) }
      if (expression.includes('controls')) {
        const value = { controls: [{ r: 'button', t: 'Go', b: [10, 10, 80, 24] }], vw: world.viewport.w, vh: world.viewport.h }
        return { result: envelope({ result: { type: 'object', value } }) }
      }
      return { error: SHELL.unsupported('Runtime.evaluate expression not modelled: ' + expression.slice(0, 120)) }
    }
    if (method === 'Page.captureScreenshot') return { result: envelope({ data: PNG_1X1 }) }
    if (method === 'Page.navigate') {
      const target = cdpTarget(tab)
      if (target === null) return { error: SHELL.unknownTab('cdp', tab, ids()) }
      // Page.navigate goes to whatever the call reached - on the panel channel that is the active tab,
      // which is the whole reason R184 took browser_goto off this method.
      target.page.href = landedUrl(String(params?.url ?? ''))
      target.page.title = 'Landed ' + target.id
      target.url = String(params?.url ?? '')
      return { result: envelope({ frameId: target.id }) }
    }
    if (typeof method === 'string' && method.startsWith('Input.')) return { result: envelope({}) }
    if (method === 'Page.enable' || method === 'Emulation.setDeviceMetricsOverride') return { result: envelope({}) }
    return { error: SHELL.unsupported('CDP method not modelled: ' + String(method)) }
  }

  const envelope = (inner) => {
    cdpSeq += 1
    return JSON.stringify({ id: cdpSeq, result: inner })
  }

  /** One panel op. Returns { status, body }. */
  function panelOp(request) {
    const op = typeof request?.op === 'string' ? request.op : ''
    const holder = typeof request?.holder === 'string' ? request.holder : undefined
    if (mutate === 'stale-readback' && WRITES.has(op) && preWrite === null) preWrite = state()
    if (op === 'state') {
    if (mutate === 'stale-readback' && preWrite !== null) {
      const stale = preWrite
      preWrite = null
      return { status: 200, body: stale }
    }
    return { status: 200, body: state() }
  }
    if (op === 'lease') {
      const leaseOp = typeof request.leaseOp === 'string' ? request.leaseOp : 'status'
      if (leaseOp === 'claim') {
        world.lease = { holder: String(request.holder ?? ''), expiresAt: Date.now() + (Number.isFinite(request.ttlMs) ? request.ttlMs : 30000) }
        world.revoked = null
      } else if (leaseOp === 'release') {
        world.lease = null
      } else if (leaseOp !== 'status') {
        return { status: 400, body: { error: SHELL.unsupported('lease op ' + leaseOp) } }
      }
      return { status: 200, body: { lease: leaseJson(), state: state() } }
    }
    if (op === 'mount' || op === 'open') {
      const failure = enforceLease('mount', holder)
      if (failure !== null) return { status: 400, body: { error: failure, state: state() } }
      world.mounted = true
      if (world.tabs.length === 0) {
        const tab = addTab(typeof request.url === 'string' && request.url !== '' ? request.url : 'about:blank')
        world.active = tab.id
      }
      return { status: 200, body: state() }
    }
    if (op === 'unmount' || op === 'close') {
      world.mounted = false
      return { status: 200, body: state() }
    }
    if (op === 'surface' || op === 'set-bounds') {
      const failure = enforceLease(op, holder)
      if (failure !== null) return { status: 400, body: { error: failure, state: state() } }
      world.surface = true
      return { status: 200, body: state() }
    }
    if (op === 'tab-new') {
      const failure = enforceLease('tab-new', holder)
      if (failure !== null) return { status: 400, body: { error: failure, state: state() } }
      if (world.mounted !== true) return { status: 400, body: { error: SHELL.notMounted, state: state() } }
      if (world.surface !== true) return { status: 400, body: { error: SHELL.noSurface, state: state() } }
      if (world.tabs.length >= world.limit) {
        if (mutate === 'silent-cap') return { status: 200, body: state() }
        return { status: 400, body: { error: SHELL.cap(world.next + 1, world.limit, ids()), state: state() } }
      }
      const tab = addTab(typeof request.url === 'string' && request.url !== '' ? request.url : 'about:blank')
      tab.page.title = 'Tab ' + tab.id
      world.active = tab.id
      return { status: 200, body: { ok: true, tab: tab.id, state: state() } }
    }
    if (op === 'tab-close' || op === 'tab-activate') {
      const failure = enforceLease(op, holder)
      if (failure !== null) return { status: 400, body: { error: failure, state: state() } }
      const id = typeof request.id === 'string' ? request.id : ''
      const index = world.tabs.findIndex((entry) => entry.id === id)
      if (index < 0) return { status: 400, body: { error: SHELL.unknownTab(op, id, ids()), state: state() } }
      if (op === 'tab-close') {
        const wasActive = world.active === id
        world.tabs.splice(index, 1)
        if (wasActive) {
          // The neighbour to the LEFT, as a browser does; the new first tab when there is no left one.
          world.active = world.tabs.length === 0 ? null : world.tabs[Math.max(0, index - 1)].id
        }
        if (mutate === 'first-tab' && world.tabs.length > 0 && world.active !== null) world.active = world.tabs[0].id
      } else {
        world.active = id
      }
      return { status: 200, body: state() }
    }
    if (op === 'tab-goto') {
      const failure = enforceLease('tab-goto', holder)
      if (failure !== null) return { status: 400, body: { error: failure, state: state() } }
      const id = typeof request.id === 'string' ? request.id : ''
      const url = typeof request.url === 'string' ? request.url : ''
      const target = mutate === 'ignore-tab' ? activeTab() : world.tabs.find((entry) => entry.id === id) ?? null
      if (target === null) return { status: 400, body: { error: SHELL.unknownTab('tab-goto', id, ids()), state: state() } }
      // The shell records the URL it was ASKED for (sidebar_panel.rs:1790-1793); the page's own href is
      // where the site really went. Keeping these apart is what makes the landing reading mean something.
      target.url = url
      target.page.href = landedUrl(url)
      target.page.title = 'Landed ' + target.id
      return { status: 200, body: state() }
    }
    if (op === 'cdp') {
      const answer = cdpCall(request.tab, holder, request.method, request.params)
      if (answer.error !== undefined) return { status: 502, body: { ok: false, method: request.method, error: answer.error } }
      return { status: 200, body: { ok: true, cdp: answer.result, state: state() } }
    }
    return { status: 400, body: { error: SHELL.unsupported('panel op not modelled: ' + JSON.stringify(op)), state: state() } }
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      let body = null
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {
        body = null
      }
      const record = { path: req.url, body, at: Date.now() }
      requests.push(record)
      const send = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
        res.end(JSON.stringify(payload))
      }
      if (body === null) return send(400, { error: 'body is not JSON' })
      if (req.url === '/__shell/panel') {
        const outcome = panelOp(body)
        record.status = outcome.status
        return send(outcome.status, outcome.body)
      }
      if (req.url === '/__shell/panel/cdp') {
        // The shell's legacy route (proxy.rs:610-645): op=cdp with a tab field, answered as
        // { ok, method, result } where result is the protocol's own JSON, as a string.
        if (typeof body.method !== 'string' || body.method === '') return send(400, { error: 'a cdp call needs a method' })
        const answer = cdpCall(body.tab, typeof body.holder === 'string' ? body.holder : undefined, body.method, body.params ?? {})
        record.status = answer.error === undefined ? 200 : 502
        if (answer.error !== undefined) return send(502, { ok: false, method: body.method, error: answer.error })
        return send(200, { ok: true, method: body.method, result: answer.result })
      }
      record.status = 404
      send(404, { error: SHELL.unsupported('route not modelled: ' + String(req.url)) })
    })
  })

  return {
    world,
    requests,
    reset,
    /** The panel ops this world was asked for, in order. */
    ops: () => requests.filter((entry) => entry.path === '/__shell/panel').map((entry) => entry.body?.op ?? '(none)'),
    /** The CDP bodies it was asked for, in order. */
    cdp: () => requests.filter((entry) => entry.path === '/__shell/panel/cdp').map((entry) => entry.body),
    listen: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address()
          resolve('http://127.0.0.1:' + address.port)
        })
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
