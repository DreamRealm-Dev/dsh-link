/**
 * One browser session: a visible Chrome plus a LONG-LIVED CDP connection.
 *
 * The connection is held open on purpose. DevTools emulation overrides are
 * scoped to the CDP session, so a connect-per-call client silently loses the
 * fixed viewport between calls and every screenshot comes back at whatever size
 * the OS window happens to be. Holding one connection is what makes the
 * viewport — and therefore the screenshot-to-click coordinate mapping — stable.
 */
import { CdpClient } from './cdp.js'
import { ensureBrowser, listTargets, resolvePageTarget } from './chrome.js'
import {
  MARKER_REMOVE_EXPRESSION,
  extractionExpression,
  jitteredPoint,
  markerExpression,
  markerPaintExpression,
} from './controls.js'
import {
  DEFAULT_PANEL_ORIGIN,
  PANEL_HOLDER,
  TAB_REFUSAL,
  TabRefusal,
  assertPanelChannel,
  panelRequest,
  panelTabs,
  panelUp,
  panelWrite,
  shellPost,
  tabArgument,
} from './panel.js'

// Re-exported for callers that have always reached the panel transport through this file.
export { DEFAULT_PANEL_ORIGIN, shellPost }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The shell's own panel channel (R178-N).
 *
 * The user's sidebar panel IS the browser now: one native child WebView that the
 * human and these tools both look at, so browser_shot shows the model the pixels
 * the user actually has on screen instead of a second, invisible Chrome.
 *
 * The shell owns geometry and the DevTools endpoint; this file only speaks to it:
 *
 *   POST <origin>/__shell/panel      { op: 'state' | 'open' | 'close' | ... }
 *   POST <origin>/__shell/panel/cdp  { method, params }   ->  { ok, result }
 *
 * ROLLBACK: the old path is one switch away. Start the kernel with
 * DSH_BROWSER_PANEL=0 (see lib/index.js, USE_PANEL) and every browser_* tool goes
 * back to spawning its own Chrome, with no code change.
 *
 * Transport is node:http with agent:false (see lib/panel.js, which owns it now).
 * Never global fetch here: the plugin runs inside the kernel host process, where a
 * fetch failure takes the host down instead of rejecting a promise.
 */

/**
 * A CDP client whose transport is the shell instead of a websocket to Chrome.
 *
 * It keeps the same send(method, params, timeoutMs) surface as CdpClient, so
 * every session method above/below - screenshot, click, key, scroll, navigate -
 * keeps its code and only changes who it talks to.
 *
 * R184: one client per addressed TAB. Every tab of the panel is a native child
 * webview of its own, so the shell can deliver the call to any of them; the tab
 * id is put in the request body VERBATIM (never translated into an index), and a
 * client built without one sends no tab field at all - which the shell defines
 * as "the active tab".
 */
export class PanelCdpClient {
  constructor({ origin, log, timeoutMs = 30000, tab } = {}) {
    this.origin = origin
    this.log = log
    this.timeoutMs = timeoutMs
    /** The tab this client addresses, or undefined for the shell's active tab. */
    this.tab = typeof tab === 'string' && tab !== '' ? tab : undefined
    this.closed = false
    /** Every CDP method this client has actually sent, in order (readings read it). */
    this.sent = []
  }

  on() {
    // No event stream over this transport; callers only ever subscribe to
    // navigation events, and status() re-reads the URL from the renderer anyway.
    return this
  }

  close(reason) {
    if (this.closed === true) return
    this.closed = true
    this.log?.info('panel CDP detached (' + String(reason ?? 'closed') + ')')
  }

  /**
   * The event promise CdpClient hands out, for the one thing goto() uses it for.
   *
   * There is no event stream over this transport, so "wait for the load event" is
   * a bounded poll of the document's own readyState. Without this, browser_goto in
   * panel mode died with "client.waitFor is not a function" - found by the live
   * reading, not by reading the code.
   */
  async waitFor(method, timeoutMs = 15000) {
    if (method !== 'Page.loadEventFired') return undefined
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      try {
        const seen = await this.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
        if (seen?.result?.value === 'complete') return {}
      } catch {
        /* the renderer is mid-navigation; ask again */
      }
      await sleep(150)
    }
    return undefined
  }

  async send(method, params = {}, timeoutMs = this.timeoutMs) {
    if (this.closed === true) throw new Error('the panel CDP client is closed; call ensure() again')
    const payload = { method, params, timeoutMs }
    // Only when one was named: an omitted tab is the shell's own word for the active tab.
    if (this.tab !== undefined) payload.tab = this.tab
    const answer = await shellPost(this.origin, '/__shell/panel/cdp', payload)
    if (answer.status !== 200) {
      throw new Error('panel CDP ' + method + ' failed: HTTP ' + answer.status + ' ' + answer.text.slice(0, 200))
    }
    if (answer.body === null) throw new Error('panel CDP ' + method + ' answered with something that is not JSON: ' + answer.text.slice(0, 200))
    if (answer.body.ok !== true) throw new Error('panel CDP ' + method + ' refused: ' + String(answer.body.error ?? 'no reason given'))
    const raw = answer.body.result
    let parsed = raw
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error('panel CDP ' + method + ' returned a result that is not JSON: ' + raw.slice(0, 200))
      }
    }
    this.sent.push(method)
    // The shell may hand back the whole protocol envelope ({"id":..,"result":{..}})
    // or the inner result alone; callers want the inner result either way.
    if (parsed !== null && typeof parsed === 'object' && parsed.id !== undefined && parsed.result !== undefined) return parsed.result
    if (parsed !== null && typeof parsed === 'object' && parsed.error !== undefined && parsed.result === undefined) {
      throw new Error('panel CDP ' + method + ' returned an error: ' + JSON.stringify(parsed.error))
    }
    return parsed
  }
}

export class BrowserSession {
  constructor({ id, browserExecutable, userDataDir, viewport, extraArgs, log, startUrl, visible, usePanel = false, panelOrigin = DEFAULT_PANEL_ORIGIN } = {}) {
    this.id = id ?? 'b1'
    /**
     * true: this session drives the SHELL's sidebar panel - one browser, shared
     * with the human. false: the plugin spawns and owns its own Chrome.
     */
    this.usePanel = usePanel === true
    this.panelOrigin = panelOrigin
    this.channel = this.usePanel === true ? 'panel' : 'chrome'
    /** What the caller asked for; the shell still owns the panel's real size. */
    this.wantedViewport = undefined
    /** Last op:state answer from the shell (readings read it). */
    this.panelState = undefined
    this.browserExecutable = browserExecutable
    this.userDataDir = userDataDir
    this.viewport = { width: viewport?.width ?? 1280, height: viewport?.height ?? 800 }
    this.extraArgs = extraArgs ?? []
    this.startUrl = startUrl ?? 'about:blank'
    this.visible = visible !== false
    this.log = log
    this.client = null
    /**
     * R184: one PanelCdpClient per addressed tab id, recreated with the base client.
     * Nothing here is a source of truth about WHICH tabs exist - it is only the
     * transport for a tab id the caller already has.
     */
    this.panelClients = new Map()
    this.port = undefined
    this.targetId = undefined
    this.spawnedPid = undefined
    this.lastUrl = 'about:blank'
    this.connecting = null
    /** Latest control snapshot; a pick is validated against its id. */
    this.controlSnapshot = undefined
    this.snapshotSeq = 0
  }

  get ready() {
    return this.client !== null && !this.client.closed
  }

  /** Attach to (or start) the browser and return a live CDP client. */
  async ensure() {
    if (this.ready) return this.client
    if (this.connecting !== null) return await this.connecting
    this.connecting = this.#connect().finally(() => {
      this.connecting = null
    })
    return await this.connecting
  }

  async #connect() {
    this.client?.close('reconnecting')
    this.client = null
    if (this.usePanel === true) return await this.#connectPanel()

    const { port, spawned, pid } = await ensureBrowser({
      browserExecutable: this.browserExecutable,
      userDataDir: this.userDataDir,
      viewport: this.viewport,
      startUrl: this.startUrl,
      extraArgs: this.extraArgs,
      visible: this.visible,
    })
    this.port = port
    if (spawned) this.spawnedPid = pid

    const target = await resolvePageTarget(port)
    this.targetId = target.id
    this.lastUrl = target.url ?? 'about:blank'

    const client = await CdpClient.connect(target.webSocketDebuggerUrl)
    client.on('Page.frameNavigated', (params) => {
      if (params?.frame?.parentId === undefined && params?.frame?.url) this.lastUrl = params.frame.url
    })
    await client.send('Page.enable')
    this.client = client
    await this.setViewport(this.viewport.width, this.viewport.height)
    this.log?.info(`attached to Chrome on port ${port} (target ${this.targetId})`)
    return client
  }

  /**
   * The panel path: no Chrome process, no websocket, no emulation override.
   *
   * The panel only exists while the user's right column is open, so it is opened
   * through the shell's own op (the same op the official open-right-sidebar button
   * ends up in) and then polled until the shell reports it. Nothing here moves a
   * window: placement belongs to the page host and to the shell.
   *
   * Presence is read tolerantly on purpose: R178-G is changing op:state's shape
   * (mounted/surface/... are being added, exists is kept), so "is it up" accepts
   * either name instead of hard-coding today's one.
   */
  async #connectPanel() {
    const origin = this.panelOrigin
    const first = await shellPost(origin, '/__shell/panel', { op: 'state' })
    if (first.status !== 200 || first.body === null) {
      throw new Error('the shell panel did not report its state (HTTP ' + first.status + '); is the DSH shell running at ' + origin + '?')
    }
    if (panelUp(first.body) === false) {
      const opened = await shellPost(origin, '/__shell/panel', { op: 'open', url: this.startUrl })
      if (opened.status !== 200) {
        throw new Error('the shell refused to open the panel (HTTP ' + opened.status + ' ' + opened.text.slice(0, 200) + ')')
      }
    }
    const until = Date.now() + 20000
    let last = first.body
    while (Date.now() < until) {
      if (panelUp(last) === true) break
      await sleep(250)
      const now = await shellPost(origin, '/__shell/panel', { op: 'state' })
      last = now.body ?? last
    }
    if (panelUp(last) === false) {
      throw new Error('the shell panel never reported itself up within 20 s; last op:state was ' + JSON.stringify(last).slice(0, 300))
    }
    this.panelState = last
    for (const client of this.panelClients.values()) client.close('reconnecting')
    this.panelClients.clear()
    this.client = new PanelCdpClient({ origin, log: this.log })
    const measured = await this.#measurePanelViewport()
    this.viewport = { width: measured.width, height: measured.height }
    this.lastUrl = measured.url
    this.log?.info(
      'attached to the shell panel at ' + origin + ' (its own viewport ' + measured.width + 'x' + measured.height + ' at dpr ' + measured.dpr + ')',
    )
    return this.client
  }

  /**
   * The shell's tab set, read NOW (R184).
   *
   * This is the plugin's entry point for "which tabs exist and which one is active": one op=state,
   * projected by lib/panel.js. Nothing is remembered between calls on purpose - a cache would be a
   * second answer to a question the shell already answers, and the first thing a stale answer costs
   * is the model acting on a tab that no longer exists.
   */
  async readPanelTabs() {
    assertPanelChannel(this.usePanel, 'reading the tab set')
    const { state } = await panelRequest(this.panelOrigin, { op: 'state' }, { timeoutMs: 8000 })
    if (state === null) throw new TabRefusal(TAB_REFUSAL.NO_PANEL, 'the shell panel answered op=state with no report')
    this.panelState = state
    const tabs = panelTabs(state)
    if (tabs.up !== true) {
      throw new TabRefusal(
        TAB_REFUSAL.NO_PANEL,
        'the shell panel at ' + this.panelOrigin + ' reports no panel (exists and mounted are both false); the user\'s right column is not open',
      )
    }
    return { state, tabs }
  }

  /** A tab id as the caller wrote it, refused here when this channel has no tab set at all. */
  #namedTab(tab, tool) {
    const named = tabArgument(tab, tool)
    if (named !== undefined) assertPanelChannel(this.usePanel, tool + ' with a tab id')
    return named
  }

  /**
   * What an explicitly addressed tab IS, said in the reply.
   *
   * Read from the same op=state the call itself uses, so the sentence cannot describe a world the
   * rest of the answer disagrees with. A parked tab is the case worth naming: the shell keeps exactly
   * one tab in the content area and parks the others off-screen (0x0/1x1), so pixels addressed at a
   * parked tab are that parked window - not the page the user has in front of them.
   */
  async tabLine(tab) {
    const { tabs } = await this.readPanelTabs()
    const row = tabs.tabs.find((entry) => entry.id === tab)
    if (row === undefined) {
      const known = tabs.tabs.map((entry) => entry.id)
      return 'tab ' + tab + ': not one of the shell\'s tabs [' + known.join(', ') + ']; the shell refuses a call for it by name'
    }
    const parts = ['tab ' + row.id + (row.active === true ? ' (active)' : ' (NOT the active tab)')]
    if (row.live !== true) parts.push('live=false (the shell\'s own record; the shell has no crash detection)')
    if (row.active !== true) {
      parts.push('the shell parks a non-active tab off-screen, so a capture or an input aimed at it lands in that parked window (browser_tab_activate brings it into the content area)')
    }
    return parts.join('; ')
  }

  /** One panel write plus the shell's read-back of the tab set afterwards. */
  async panelWrite(payload, { timeoutMs = 20000 } = {}) {
    assertPanelChannel(this.usePanel, 'writing to the panel')
    const { answer, state } = await panelWrite(this.panelOrigin, payload, { timeoutMs })
    this.panelState = state ?? this.panelState
    return { answer, state, tabs: panelTabs(state) }
  }

  /**
   * The CDP client a call should talk through: the tab-addressed one when a tab was named, and the
   * base client (the shell's ACTIVE tab) when none was.
   *
   * The tab id is never translated: it is the shell's name for a window, and it goes into the request
   * body as written.
   */
  async clientFor(tab) {
    const named = this.#namedTab(tab, 'a tab-addressed browser call')
    const base = await this.ensure()
    if (named === undefined) return base
    let client = this.panelClients.get(named)
    if (client === undefined || client.closed === true) {
      client = new PanelCdpClient({ origin: this.panelOrigin, log: this.log, tab: named })
      this.panelClients.set(named, client)
    }
    return client
  }

  /**
   * One tab's own document, read from that tab. Metadata only (href/title/readyState) - the same class
   * of fact status() has always reported. Works for a tab that is not active, because every tab is a
   * renderer of its own; op=state's tabs[].url is only the shell's record of what it was asked for.
   */
  async #readTabDocument(tab) {
    const raw = await this.evaluate(
      'JSON.stringify({href: location.href, title: document.title, ready: document.readyState})',
      { tab },
    )
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return {
      href: typeof parsed?.href === 'string' ? parsed.href : '',
      title: typeof parsed?.title === 'string' ? parsed.title : '',
      ready: typeof parsed?.ready === 'string' ? parsed.ready : '',
    }
  }

  /**
   * Wait for a tab to land on a document that is not the one it was on before.
   *
   * The shell's op=tab-goto hands the URL to the webview and records the URL it was ASKED for; it does
   * not wait for a load. So the wait happens here, against the tab's own renderer, and the answer says
   * where the tab REALLY is. A tab that never answers is reported as such instead of being filled in
   * from the shell's record.
   */
  async #waitForTab(tab, { previous, timeoutMs = 20000 } = {}) {
    const until = Date.now() + timeoutMs
    let last
    let failure
    while (Date.now() < until) {
      try {
        const seen = await this.#readTabDocument(tab)
        last = seen
        if (seen.ready === 'complete' && seen.href !== '' && seen.href !== 'about:blank' && seen.href !== previous) break
      } catch (error) {
        failure = error?.message ?? String(error)
      }
      await sleep(200)
    }
    // A short settle, then one more read: a page that is complete and then redirects would otherwise be
    // reported at the intermediate URL.
    if (last !== undefined) {
      await sleep(250)
      try {
        last = await this.#readTabDocument(tab)
        failure = undefined
      } catch (error) {
        failure = error?.message ?? String(error)
      }
    }
    return { document: last, failure, waitedMs: timeoutMs - Math.max(0, until - Date.now()) }
  }

  /**
   * R184: navigate a tab through the shell's own op (op=tab-goto), never through Page.navigate on
   * whatever happens to be active.
   *
   * Page.navigate on the panel channel goes to the ACTIVE tab - the page the user is looking at -
   * which is why "let the AI browse" and "do not take the user's page away" used to be exclusive.
   * op=tab-goto hands the URL to one named tab's own webview instead, so a tab of the model's own is
   * enough to have both.
   */
  async #panelGoto(url, tab) {
    const { tabs } = await this.readPanelTabs()
    const target = tab ?? tabs.active
    if (typeof target !== 'string' || target === '') {
      throw new TabRefusal(
        TAB_REFUSAL.INPUT,
        'browser_goto has no tab to navigate: the shell reports ' + tabs.count + ' tab(s) and no active tab; open one with browser_tab_new',
      )
    }
    // Where the tab is BEFORE the op, so the wait below can tell "still the old document" from "landed".
    const before = await this.#readTabDocument(target).catch(() => undefined)
    await panelWrite(this.panelOrigin, { op: 'tab-goto', id: target, url }, { timeoutMs: 20000 })
    const { tabs: after } = await this.readPanelTabs()
    const record = after.tabs.find((entry) => entry.id === target) ?? null
    const landed = await this.#waitForTab(target, { previous: before?.href, timeoutMs: 20000 })
    // Keep lastUrl meaning "where that tab really is" for callers that read it (the sidebar RPC op does).
    if (typeof landed?.document?.href === 'string' && landed.document.href !== '') this.lastUrl = landed.document.href
    return { tab: target, requested: url, record, landed, tabs: after, before }
  }

  /**
   * The panel's own CSS viewport, as its renderer sees it.
   *
   * Metadata only (innerWidth/innerHeight/devicePixelRatio/href/title) - the same
   * class of fact status() has always reported, never page text or site source.
   */
  async #measurePanelViewport() {
    const raw = await this.evaluate(
      'JSON.stringify({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, href: location.href, title: document.title})',
    )
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const dpr = Number.isFinite(parsed?.dpr) === true && parsed.dpr > 0 ? parsed.dpr : 1
    return {
      width: Math.round(Number(parsed?.w ?? 0)),
      height: Math.round(Number(parsed?.h ?? 0)),
      dpr,
      url: typeof parsed?.href === 'string' && parsed.href !== '' ? parsed.href : this.lastUrl,
      title: typeof parsed?.title === 'string' ? parsed.title : '',
    }
  }

  /**
   * Convert a page CSS point into the point the panel's input channel expects.
   *
   * MEASURED, not assumed: with the panel in fixed mode (page viewport 1280x800
   * emulated at dsf 1, fit scale 0.4781 into a 612x766 content pane), passing
   * Input.dispatchMouseEvent x=130,y=152 made the page receive a mousedown at
   * (271,317) - i.e. the channel DIVIDES by the fit scale, so the caller must
   * multiply by it: this.send sees pane-local coordinates, not page CSS ones.
   *
   *   page CSS (130,152)  x scale 0.4781  ->  (62,73)  ->  page receives (130,152)
   *
   * The scale is re-read from op:state before every input call, because the contract
   * says the basis moves (the user drags the divider, the mode switches) and a cached
   * constant would silently click the wrong place. Wheel DELTAS are not scaled: a
   * dy of 800 with this same state moved scrollY by exactly 800.
   */
  async #inputPoint(x, y) {
    const state = await shellPost(this.panelOrigin, '/__shell/panel', { op: 'state' })
    this.panelState = state.body ?? this.panelState
    const scale = Number(this.panelState?.scale)
    const factor = Number.isFinite(scale) === true && scale > 0 ? scale : 1
    this.panelScaleUsed = factor
    const mode = this.panelState?.mode ?? null
    if (mode === 'fit' && factor !== 1) {
      this.log?.warn('the panel reports fit mode with scale ' + factor + '; using it as the input factor')
    }
    const px = Number.isFinite(x) === true ? Math.round(x * factor) : x
    const py = Number.isFinite(y) === true ? Math.round(y * factor) : y
    return { x: px, y: py, factor, mode }
  }

  /**
   * Status for the panel path.
   *
   * Without a tab this is the ACTIVE tab's own numbers, read from its renderer (the panel's document
   * IS the active tab's document). With a tab it is that tab's own document, read from that tab, plus
   * the panel-level viewport the shell reports - the shell keeps ONE page viewport for the whole panel
   * (R184 freezes that), so a non-active tab must not be described with the size of its parked window.
   */
  async #panelStatus(tab) {
    const { state, tabs } = await this.readPanelTabs()
    const width = state?.viewport?.w
    const height = state?.viewport?.h
    const base = {
      channel: 'panel',
      shared: true,
      port: undefined,
      pid: undefined,
      tab: tab ?? tabs.active,
      tabActive: tab === undefined ? true : (tabs.tabs.find((entry) => entry.id === tab)?.active ?? null),
      tabs,
      mode: typeof state?.mode === 'string' ? state.mode : null,
      panelViewport: Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null,
    }
    if (tab !== undefined) {
      const row = tabs.tabs.find((entry) => entry.id === tab)
      let document
      let failure
      try {
        document = await this.#readTabDocument(tab)
      } catch (error) {
        failure = error?.message ?? String(error)
      }
      return {
        ...base,
        record: row ?? null,
        document,
        documentError: failure,
        url: document?.href ?? row?.url ?? '',
        title: document?.title ?? row?.title ?? '',
        width: Number.isFinite(width) ? width : this.viewport.width,
        height: Number.isFinite(height) ? height : this.viewport.height,
        configuredWidth: Number.isFinite(this.wantedViewport?.width) === true ? this.wantedViewport.width : Number.isFinite(width) ? width : this.viewport.width,
        configuredHeight: Number.isFinite(this.wantedViewport?.height) === true ? this.wantedViewport.height : Number.isFinite(height) ? height : this.viewport.height,
        dpr: undefined,
      }
    }
    await this.ensure()
    const measured = await this.#measurePanelViewport()
    this.viewport = { width: measured.width, height: measured.height }
    this.lastUrl = measured.url
    return {
      ...base,
      url: measured.url,
      title: measured.title,
      width: measured.width,
      height: measured.height,
      configuredWidth: Number.isFinite(this.wantedViewport?.width) === true ? this.wantedViewport.width : measured.width,
      configuredHeight: Number.isFinite(this.wantedViewport?.height) === true ? this.wantedViewport.height : measured.height,
      dpr: measured.dpr,
    }
  }

  /** Pin the CSS viewport. Screenshot pixels then equal CSS pixels 1:1. */
  async setViewport(width, height) {
    if (this.usePanel === true) {
      // The panel's size is the shell's and the user's (they drag the divider, they
      // open and close the column). An emulation override here would fight the
      // human's own view, so the request is only remembered and the panel's real
      // viewport is what comes back.
      this.wantedViewport = { width, height }
      await this.ensure()
      return { width: this.viewport.width, height: this.viewport.height, requested: { width, height }, ownedBy: 'shell' }
    }
    const client = await this.ensure()
    const w = Math.max(200, Math.round(width))
    const h = Math.max(200, Math.round(height))
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: w,
      screenHeight: h,
    })
    this.viewport = { width: w, height: h }
    return this.viewport
  }

  /**
   * Navigate. On the panel channel this is op=tab-goto against ONE tab (the active one unless a tab is
   * named) - see #panelGoto; on the chrome channel it is Page.navigate on the instance's own page.
   */
  async goto(url, { tab } = {}) {
    if (typeof url !== 'string' || url.trim() === '') throw new Error('url must be a non-empty string')
    const named = this.#namedTab(tab, 'browser_goto')
    if (this.usePanel === true) return await this.#panelGoto(url, named)
    const client = await this.ensure()
    const loaded = client.waitFor('Page.loadEventFired', 30000).catch(() => undefined)
    const result = await client.send('Page.navigate', { url })
    if (result?.errorText !== undefined && result.errorText !== null && result.errorText !== '') {
      throw new Error(`navigation failed: ${result.errorText}`)
    }
    await Promise.race([loaded, sleep(15000)])
    await sleep(350)
    // Report where the page itself landed, not what we asked for: sites redirect, and the reading that
    // matters is the renderer's own location.href.
    try {
      const href = await this.evaluate('location.href')
      if (typeof href === 'string' && href !== '') this.lastUrl = href
    } catch (error) {
      this.log?.warn('could not re-read the URL after navigating', error?.message ?? String(error))
      this.lastUrl = url
    }
    return this.lastUrl
  }

  /**
   * Capture the viewport (or a clipped region) as PNG bytes.
   *
   * In panel mode this is Page.captureScreenshot over the shell's CDP op, so the
   * pixels are the panel's own - the same rendering the user is looking at, at
   * the panel's device pixel ratio (not a fixed 1:1 with CSS pixels; status()
   * reports the dpr that relates the two).
   */
  async shotBytes({ x, y, width, height, scale, tab } = {}) {
    const client = await this.clientFor(tab)
    const params = { format: 'png', captureBeyondViewport: false }
    const hasClip = [x, y, width, height].every((v) => Number.isFinite(v))
    if (hasClip) {
      params.clip = {
        x,
        y,
        width,
        height,
        scale: Number.isFinite(scale) ? scale : 1,
      }
    }
    const result = await client.send('Page.captureScreenshot', params, 60000)
    return Buffer.from(result.data, 'base64')
  }

  async click({ x, y, button = 'left', clickCount = 1, tab }) {
    const client = await this.clientFor(tab)
    if (this.usePanel === true) ({ x, y } = await this.#inputPoint(x, y))
    const base = { x, y, button, buttons: 1, clickCount, pointerType: 'mouse' }
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' })
    await sleep(50)
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await sleep(60)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 })
    await sleep(120)
  }

  async hover({ x, y, tab }) {
    const client = await this.clientFor(tab)
    if (this.usePanel === true) ({ x, y } = await this.#inputPoint(x, y))
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' })
  }

  async insertText(text, { tab } = {}) {
    const client = await this.clientFor(tab)
    await client.send('Input.insertText', { text })
    await sleep(80)
  }

  async pressKey({ key, code, windowsVirtualKeyCode, text, tab }) {
    const client = await this.clientFor(tab)
    const base = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode }
    await client.send('Input.dispatchKeyEvent', { type: text === undefined ? 'rawKeyDown' : 'keyDown', ...base, text })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(120)
  }

  async scroll({ dy = 0, dx = 0, x, y, tab }) {
    const client = await this.clientFor(tab)
    let cx = Number.isFinite(x) ? x : Math.round(this.viewport.width / 2)
    let cy = Number.isFinite(y) ? y : Math.round(this.viewport.height / 2)
    // The wheel DELTA is page CSS already (dy 800 moved scrollY by 800); only the
    // point the wheel is sent at goes through the panel's input basis.
    if (this.usePanel === true) ({ x: cx, y: cy } = await this.#inputPoint(cx, cy))
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0, pointerType: 'mouse' })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: dx, deltaY: dy, pointerType: 'mouse' })
    await sleep(250)
  }

  /** Read-only status: no page text, no DOM — url/title/viewport only. */
  async status({ tab } = {}) {
    const named = this.#namedTab(tab, 'browser_status')
    if (this.usePanel === true) return await this.#panelStatus(named)
    const client = await this.ensure()
    const metrics = await client.send('Page.getLayoutMetrics')
    let url = this.lastUrl
    let title = ''
    try {
      const targets = await listTargets(this.port)
      const self = targets.find((t) => t.id === this.targetId)
      if (self !== undefined) {
        url = self.url ?? url
        title = self.title ?? ''
      }
    } catch {
      /* the browser may be mid-navigation */
    }
    return {
      url,
      title,
      width: metrics.cssLayoutViewport?.clientWidth ?? this.viewport.width,
      height: metrics.cssLayoutViewport?.clientHeight ?? this.viewport.height,
      configuredWidth: this.viewport.width,
      configuredHeight: this.viewport.height,
      port: this.port,
      pid: this.spawnedPid,
    }
  }

  /**
   * Evaluate one expression in the page and return its JSON value.
   *
   * Used ONLY by the control-extraction feature: the expressions this package
   * evaluates are the ones built in `controls.js`, which return roles, labels,
   * and boxes — never page source, text content, or storage.
   */
  async evaluate(expression, { timeoutMs = 20000, tab } = {}) {
    const client = await this.clientFor(tab)
    const result = await client.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: false, userGesture: true },
      timeoutMs,
    )
    if (result?.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'unknown error'
      throw new Error(`page evaluation failed: ${String(text).split('\n')[0]}`)
    }
    return result?.result?.value
  }

  /**
   * Extract interactive controls, number them, and optionally capture the
   * page with numbered markers painted on top.
   *
   * The returned snapshot is remembered; `pick` refuses stale numbers.
   */
  async controls({ markers = false, maxControls = 150, tab } = {}) {
    const named = this.#namedTab(tab, 'browser_controls')
    const raw = await this.evaluate(extractionExpression(maxControls), { tab: named })
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.controls)) {
      throw new Error('control extraction returned no usable data')
    }
    this.snapshotSeq += 1
    const snapshotId = `${this.id}:${this.snapshotSeq}`
    this.controlSnapshot = {
      id: snapshotId,
      at: Date.now(),
      /** The tab this snapshot was read from; a pick goes back to the same one (R184). */
      tab: named,
      viewport: { width: raw.vw, height: raw.vh },
      controls: raw.controls,
    }
    let image
    if (markers) {
      await this.evaluate(markerExpression(raw.controls.length), { tab: named })
      await this.evaluate(markerPaintExpression(raw.controls), { tab: named })
      await sleep(140)
      try {
        image = await this.shotBytes({ tab: named })
      } finally {
        // The overlay must never survive the capture: a later clean screenshot
        // would otherwise show stale badges.
        await this.evaluate(MARKER_REMOVE_EXPRESSION, { tab: named }).catch(() => undefined)
      }
    }
    return { snapshot: this.controlSnapshot, image }
  }

  /**
   * Click control number `n` from the current (or named) snapshot.
   *
   * The point is jittered inside the control's own box, and the mouse approaches
   * in two steps with randomized timing, so the interaction is not a
   * geometrically perfect synthetic click.
   */
  async pick({ n, snapshot, tab }) {
    const current = this.controlSnapshot
    if (current === undefined) throw new Error('no control snapshot yet; call browser_controls first')
    if (typeof snapshot === 'string' && snapshot !== '' && snapshot !== current.id) {
      throw new Error(`control snapshot ${snapshot} is stale (current is ${current.id}); call browser_controls again before picking`)
    }
    // R184: a number only means something in the tab it was read from, so the snapshot carries its tab
    // and the pick goes back there unless the caller names the same one.
    const named = this.#namedTab(tab, 'browser_pick')
    if (named !== undefined && named !== current.tab) {
      throw new Error(
        `control snapshot ${current.id} was read from tab ${current.tab ?? "(active)"}, but browser_pick was given tab ${JSON.stringify(named)}; read the controls again with that tab`,
      )
    }
    const index = Number(n) - 1
    const entry = current.controls[index]
    if (entry === undefined) {
      throw new Error(`control ${n} does not exist; the current snapshot has ${current.controls.length} controls`)
    }
    const point = jitteredPoint(entry.b)
    await this.humanClick(point, { tab: named ?? current.tab })
    return { entry, point, snapshot: current.id, tab: named ?? current.tab }
  }

  /** A click with human-like approach and timing. */
  async humanClick([x, y], { tab } = {}) {
    const client = await this.clientFor(tab)
    if (this.usePanel === true) ({ x, y } = await this.#inputPoint(x, y))
    const approachX = Math.round(x + (Math.random() * 10 - 5))
    const approachY = Math.round(y + (Math.random() * 10 - 5))
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: approachX, y: approachY, button: 'none', buttons: 0, pointerType: 'mouse',
    })
    await sleep(25 + Math.random() * 45)
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse',
    })
    await sleep(35 + Math.random() * 55)
    const base = { x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' }
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await sleep(45 + Math.random() * 65)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 })
    await sleep(110)
  }

  /** Focus a control by number without committing a click (single jittered click). */
  async focusControl(n, snapshot) {
    const result = await this.pick({ n, snapshot })
    return result
  }

  /** Scroll a control into view by number, then re-extract is the caller's job. */
  async scrollControlIntoView(n, snapshot) {
    const current = this.controlSnapshot
    if (current === undefined) throw new Error('no control snapshot yet; call browser_controls first')
    if (typeof snapshot === 'string' && snapshot !== '' && snapshot !== current.id) {
      throw new Error(`control snapshot ${snapshot} is stale (current is ${current.id}); call browser_controls again`)
    }
    const entry = current.controls[Number(n) - 1]
    if (entry === undefined) throw new Error(`control ${n} does not exist; the current snapshot has ${current.controls.length} controls`)
    const [, y, , h] = entry.b
    const center = y + h / 2
    const delta = center - this.viewport.height / 2
    await this.scroll({ dy: -delta, tab: current.tab })
    return entry
  }

  async close({ kill = false } = {}) {
    if (this.usePanel === true) {
      this.client?.close('session closed')
      this.client = null
      for (const client of this.panelClients.values()) client.close('session closed')
      this.panelClients.clear()
      // Detach is the default and touches nothing: this panel is the user's own
      // right column, and closing it on an unrelated browser_close would take the
      // page out from under them. kill=true is the only case that takes the
      // browser down, and even then through the shell's op (close = unmount)
      // rather than by killing a process this plugin does not own.
      if (kill === true) {
        try {
          const answer = await shellPost(this.panelOrigin, '/__shell/panel', { op: 'close' })
          if (answer.status !== 200) this.log?.warn('the shell refused to close the panel (HTTP ' + answer.status + ')')
        } catch (error) {
          this.log?.warn('closing the panel failed', error?.message ?? String(error))
        }
      }
      return { killed: kill === true, channel: 'panel' }
    }
    const port = this.port
    const pid = this.spawnedPid
    this.client?.close('session closed')
    this.client = null
    this.targetId = undefined
    if (!kill) return { killed: false }
    if (port !== undefined) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
        const version = await response.json()
        if (version?.webSocketDebuggerUrl) {
          const browser = await CdpClient.connect(version.webSocketDebuggerUrl, { timeoutMs: 5000 })
          await browser.send('Browser.close', {}, 5000).catch(() => undefined)
          browser.close('closing browser')
        }
      } catch {
        /* browser already gone */
      }
    }
    if (pid !== undefined) {
      try {
        process.kill(pid)
      } catch {
        /* already gone */
      }
    }
    this.port = undefined
    this.spawnedPid = undefined
    return { killed: true }
  }
}
