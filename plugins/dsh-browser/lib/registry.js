/**
 * Multi-instance browser registry.
 *
 * One Chrome process per instance (they cannot share a user-data-dir), each with
 * its own pinned viewport and its own control snapshot. Both the model tools and
 * the sidebar RPC address instances through this one object, so "who is open" has
 * a single answer regardless of which side opened it.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_PANEL_ORIGIN,
  TAB_REFUSAL,
  TabRefusal,
  assertPanelChannel,
  panelRequest,
  panelTabs as projectPanelTabs,
  panelWrite,
  tabArgument,
} from './panel.js'
import { BrowserSession } from './session.js'

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

export class BrowserRegistry {
  constructor({ baseDir, config, log, usePanel = false, panelOrigin } = {}) {
    /**
     * Which channel every instance in this registry runs on. true: the shell's own
     * sidebar panel (one browser, shared with the human). false: a private Chrome
     * per instance, spawned by this plugin (the pre-R178 behaviour).
     */
    this.usePanel = usePanel === true
    /**
     * Where the shell's own panel lives. This is the plugin's ONE seam for pointing the very same code
     * at an offline fixture (row config `panelOrigin` or `DSH_BROWSER_PANEL_ORIGIN`); when neither is
     * given the value is the unchanged default from R178-N, so a deployment that sets nothing behaves
     * exactly as before.
     */
    this.panelOrigin = typeof panelOrigin === 'string' && panelOrigin !== '' ? panelOrigin : DEFAULT_PANEL_ORIGIN
    this.baseDir = baseDir
    this.config = config
    this.log = log
    this.sessions = new Map()
    this.seq = 0
    this.lastUsed = null
  }

  #nextId() {
    do {
      this.seq += 1
    } while (this.sessions.has(`b${this.seq}`))
    return `b${this.seq}`
  }

  /** Accept a caller-chosen id when it is safe, otherwise allocate the next one. */
  #resolveId(requested) {
    if (requested === undefined || requested === null || requested === '') return this.#nextId()
    const id = String(requested).trim().toLowerCase()
    if (!ID_PATTERN.test(id)) {
      throw new Error(`invalid instance id "${requested}"; use 1-32 chars of [a-z0-9_-] starting alphanumeric`)
    }
    if (this.sessions.has(id)) throw new Error(`browser instance "${id}" already exists; close it or choose another id`)
    return id
  }

  ids() {
    return [...this.sessions.keys()]
  }

  /**
   * The shell's tab set, read now (R184).
   *
   * Deliberately NOT a method on a session: "which tabs exist" is a fact about the panel, and it must
   * be readable before any session exists (and without opening one - reading must not mount a browser).
   * No copy is kept; every call is one op=state.
   */
  async panelTabs() {
    assertPanelChannel(this.usePanel, 'reading the tab set')
    const { state } = await panelRequest(this.panelOrigin, { op: 'state' }, { timeoutMs: 8000 })
    if (state === null) throw new TabRefusal(TAB_REFUSAL.NO_PANEL, 'the shell panel answered op=state with no report')
    const tabs = projectPanelTabs(state)
    if (tabs.up !== true) {
      throw new TabRefusal(
        TAB_REFUSAL.NO_PANEL,
        'the shell panel at ' + this.panelOrigin + " reports no panel (exists and mounted are both false); the user's right column is not open",
      )
    }
    return { state, tabs }
  }

  /** One panel write plus the shell's own read-back of the tab set (never an optimistic report). */
  async panelTabOp(payload, { timeoutMs = 20000 } = {}) {
    assertPanelChannel(this.usePanel, 'writing to the panel')
    const { answer, state } = await panelWrite(this.panelOrigin, payload, { timeoutMs })
    return { answer, state, tabs: projectPanelTabs(state) }
  }

  /** The tab a write falls back to when none was named: the shell's own active tab. */
  async #targetTab(tab, tool) {
    const named = tabArgument(tab, tool)
    if (named !== undefined) return named
    const { tabs } = await this.panelTabs()
    if (typeof tabs.active !== 'string' || tabs.active === '') {
      throw new TabRefusal(
        TAB_REFUSAL.INPUT,
        tool + ' needs a tab id: the shell reports ' + tabs.count + ' tab(s) and no active tab; call browser_tabs, or open one with browser_tab_new',
      )
    }
    return tabs.active
  }

  /**
   * op=tab-new. The new tab becomes the active one (the shell's own rule), and the id it answers with
   * is the id the caller must use from then on - it is never invented here.
   */
  async tabNew({ url } = {}) {
    assertPanelChannel(this.usePanel, 'browser_tab_new')
    // A tab needs a mounted browser (the shell's precondition), and mounting is what ensureInstance does
    // for every other tool; the shell still refuses by name if it cannot.
    await this.ensureInstance()
    const payload = typeof url === 'string' && url !== '' ? { op: 'tab-new', url } : { op: 'tab-new' }
    const { answer, tabs } = await this.panelTabOp(payload, { timeoutMs: 30000 })
    // The shell answers op=tab-new with the id it created; a caller cannot name what it was never told.
    return { created: typeof answer?.body?.tab === 'string' ? answer.body.tab : null, tabs }
  }

  async tabClose({ tab } = {}) {
    assertPanelChannel(this.usePanel, 'browser_tab_close')
    const id = await this.#targetTab(tab, 'browser_tab_close')
    const { tabs } = await this.panelTabOp({ op: 'tab-close', id })
    return { closed: id, tabs }
  }

  async tabActivate({ tab } = {}) {
    assertPanelChannel(this.usePanel, 'browser_tab_activate')
    const id = await this.#targetTab(tab, 'browser_tab_activate')
    const { tabs } = await this.panelTabOp({ op: 'tab-activate', id })
    return { activated: id, tabs }
  }

  get(id) {
    if (id === undefined || id === null || id === '') return this.lastUsed === null ? undefined : this.sessions.get(this.lastUsed)
    return this.sessions.get(String(id))
  }

  /** Resolve the target instance, or throw a message that lists what IS open. */
  require(id) {
    const session = this.get(id)
    if (session === undefined) {
      const open = this.ids()
      throw new Error(
        open.length === 0
          ? 'no browser instance is open; call browser_open first'
          : `unknown browser instance "${id ?? '(default)'}"; open instances: ${open.join(', ')}`,
      )
    }
    return session
  }

  /** Open a new instance, or return the existing one when `id` names it. */
  async open({ id, url, viewport, browserExecutable, visible, extraArgs } = {}) {
    let session
    if (typeof id === 'string' && id !== '' && this.sessions.has(id.trim().toLowerCase())) {
      session = this.sessions.get(id.trim().toLowerCase())
    } else {
      const resolvedId = this.#resolveId(id)
      const config = this.config.read()
      // Panel mode needs no profile of its own: the panel is one WebView2 with the
      // shell's single profile, which is exactly what makes "the AI sees the user's
      // browser" true rather than approximate.
      const profileDir = this.usePanel === true ? undefined : join(this.baseDir, 'profiles', resolvedId)
      if (profileDir !== undefined) mkdirSync(profileDir, { recursive: true })
      session = new BrowserSession({
        id: resolvedId,
        userDataDir: profileDir,
        usePanel: this.usePanel,
        panelOrigin: this.panelOrigin,
        viewport: {
          width: viewport?.width ?? config.viewport.width,
          height: viewport?.height ?? config.viewport.height,
        },
        browserExecutable: browserExecutable ?? (config.browserExecutable ?? undefined),
        // (panel mode ignores the executable: the shell's WebView2 is the browser)
        extraArgs: extraArgs ?? config.extraArgs,
        visible: visible ?? config.visible,
        startUrl: typeof url === 'string' && url !== '' ? url : 'about:blank',
        log: this.log,
      })
      this.sessions.set(resolvedId, session)
      this.log?.info(`instance ${resolvedId} registered (${this.usePanel === true ? 'channel panel, no profile' : `profile ${profileDir}`})`)
    }
    if (Number.isFinite(viewport?.width) || Number.isFinite(viewport?.height)) {
      await session.setViewport(viewport.width ?? session.viewport.width, viewport.height ?? session.viewport.height)
    }
    await session.ensure()
    if (typeof url === 'string' && url.trim() !== '' && session.lastUrl !== url) await session.goto(url)
    this.lastUsed = session.id
    return session
  }

  /** Return the addressed instance, auto-opening a default one when none exists. */
  async ensureInstance(id, openOptions = {}) {
    const existing = this.get(id)
    if (existing !== undefined) {
      this.lastUsed = existing.id
      await existing.ensure()
      return existing
    }
    if (id !== undefined && id !== null && id !== '') {
      throw new Error(`unknown browser instance "${id}"; open instances: ${this.ids().join(', ') || '(none)'}`)
    }
    return await this.open(openOptions)
  }

  /** Read-only listing for tools and the sidebar. */
  async list() {
    const out = []
    for (const [id, session] of this.sessions) {
      let status = null
      try {
        status = await session.status()
      } catch (error) {
        status = { url: session.lastUrl, title: '', error: error?.message ?? String(error) }
      }
      out.push({
        id,
        url: status?.url ?? session.lastUrl,
        title: status?.title ?? '',
        viewport: `${session.viewport.width}x${session.viewport.height}`,
        channel: session.channel,
        port: session.port ?? null,
        pid: session.spawnedPid ?? null,
        live: session.ready,
        isDefault: this.lastUsed === id,
      })
    }
    return out
  }

  async close(id, { kill = false } = {}) {
    const session = this.get(id)
    if (session === undefined) return { closed: false, id: id ?? null }
    await session.close({ kill })
    this.sessions.delete(session.id)
    if (this.lastUsed === session.id) this.lastUsed = this.ids()[0] ?? null
    this.log?.info(`instance ${session.id} closed (kill=${kill})`)
    return { closed: true, id: session.id, killed: kill }
  }

  async closeAll({ kill = true } = {}) {
    const closed = []
    for (const id of this.ids()) {
      try {
        await this.close(id, { kill })
        closed.push(id)
      } catch (error) {
        this.log?.warn(`closing instance ${id} failed`, error?.message ?? error)
      }
    }
    return closed
  }

  /** Forget each session without killing the window (plugin teardown). */
  async detachAll() {
    for (const [, session] of this.sessions) {
      try {
        await session.close({ kill: false })
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear()
  }
}
