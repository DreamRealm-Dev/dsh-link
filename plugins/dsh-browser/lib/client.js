/**
 * dsh-browser — Client half: the right-sidebar browser panel.
 *
 * Bundled by `dsh-client-modules` as a browser module. The bundle MUST register
 * itself through `window.__ModuleLoader__.load({ id, factory })`: the loader
 * executes a client bundle only to REGISTER its factory, then materializes it on
 * first import. A bundle that just runs its body and assigns `exports` never
 * registers anything, and the loader rejects it with
 * `bundle <url> loaded without registering "<id>" via __ModuleLoader__.load`
 * — which is exactly the "Failed to load plugins" failure this file used to
 * produce. `dsh-lan-bridge/lib/client.js` is the reference shape.
 *
 * Inside the factory, `require` is the module-table lookup bound by the loader
 * (NOT Node's `require`), so every specifier must be a module-table word:
 * `react`, the optional `@deepseek-ai/dsh-client-ui-primitives`, and so on.
 *
 * The panel is deliberately a *viewer plus controls*, not a second driver:
 * every action goes through the same host RPC the model tools use, so the panel
 * and the agent see one shared set of instances and either side can open or
 * recycle the other's.
 *
 * The image is captured at the zoom the panel renders it at, so it is always
 * shown 1:1 inside a native scroll container: the browser viewport stays pinned
 * while the user zooms and pans with the container's own scrollbars.
 */
window.__ModuleLoader__.load({
  id: 'dsh-browser',
  factory: (require) => {
    // The host half serves this prefix as a webServer route, exactly like
    // dsh-better-sidebar's /sidebar/api. The connection RPC carrier is NOT
    // usable here: its host-side handle() registers through the connection
    // service's own ctx, which has no `webServer` injected, so it throws
    // "cannot get property webServer without inject" and the client then falls
    // back to a transport with no route to hit (HTTP 405).
    const API_PATH = '/browser/api'
    const TAB_KIND = 'browser'
    const TAB_ID = 'dsh-browser:panel'
    const POLL_MS = 1300
    const ZOOMS = [0.25, 0.4, 0.5, 0.67, 0.8, 1]
    // R178-A (the user's ruling): the right column's browser pane is a SURFACE for our own browser shell,
    // not a viewer with a control row. The old Chrome controls - open / close / refresh / fit / 100% - are
    // kept below, but they render only when this switch is on, so the design stays reversible in one line.
    // What replaces them is the anchor: one element that publishes WHERE the pane body is, so the shell can
    // put its native child webview exactly over it (the shell used to cover the whole rail, including the
    // tab strip, which is why this exists).
    const SHOW_CHROME_CONTROLS = false

/* ------------------------------------------------------------------ *
 * The panel action (R193), and this half's own locale namespace.
 *
 * WHERE openTab LIVES, read off the shipped kernel instead of assumed:
 *   core/deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts:150
 *     ctx.reflect.provide('sidebarRightTabs', tabs)      the registry: register() only
 *   core/deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts:151
 *     ctx.reflect.provide('sidebarRight', controller)    the column itself
 *   core/deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts:196
 *     openTab: (kind, options) => { controller.openTab(kind, options) }
 *   core/deepseek-harness/packages/client/ui-sidebar-right/src/client/service.ts:332
 *     openTab<K extends string>(kind: K, options = {})   the KIND, not the type's id
 *   core/deepseek-harness/packages/client/ui-sidebar-right/src/client/tab-registry.ts:103
 *     "Type discriminator: what the tabs of this type are, and what `openTab` names"
 * So the action calls openTab on sidebarRight; sidebarRightTabs is NOT the one.
 *
 * Four rules this section obeys:
 *
 *   its own words    the item's copy is this package's own locale namespace,
 *                    registered through the kernel's locale service
 *                    (core/.../packages/client/locale/src/client/index.ts:581
 *                    provides `locale`; :400 register(ns, { zh, en }); :456
 *                    bind(ns)) and read through `t`. A page with no locale
 *                    service answers from the SAME dictionary.
 *   read, not copy   the kind handed to `openTab` is READ out of the one object
 *                    this half hands `sidebarRightTabs.register`. A second
 *                    spelling of "browser" inside `invoke` would be a second
 *                    answer to the same question, free to drift from the tab
 *                    type the panel row claims to open.
 *   fail-closed      no `linkPanel`, no `sidebarRight`, a `declare` that throws
 *                    and an `openTab` that throws are each caught and named in
 *                    THIS package's own marker (`globalThis.__dshBrowserPanel`),
 *                    and none of them is thrown: the tab type, the two slots and
 *                    the page keep working either way.
 *   no cadence       a language switch is announced to the seam through its own
 *                    refresh path `notify()`, on the locale service's own
 *                    subscription - never on a timer of this half's.
 * ------------------------------------------------------------------ */

/** This half's dictionary namespace, registered with the kernel's locale service. */
const LOCALE_NS = 'dsh-browser'
/** The client-face service the panel publishes: declare(definition) -> disposer. */
const LINK_PANEL_SERVICE = 'linkPanel'
/** The client-face service that owns the right column; openTab(kind) is its method. */
const SIDEBAR_RIGHT_SERVICE = 'sidebarRight'
/** This package's one contribution. Namespaced, so two packages cannot collide on an id. */
const PANEL_ITEM_ID = 'dsh-browser:open-panel'
/** The panel's word for "something to do" - its closed kind set is pane/action/status. */
const PANEL_ITEM_KIND = 'action'
/** Who the item belongs to: this package, spelled as its package name. */
const PANEL_ITEM_SOURCE = 'dsh-browser'
/** After the bridge's reading (20), before the panel's own guide entry (40). */
const PANEL_ITEM_ORDER = 30
/** Where this half records what its contribution did; the panel's marker is the panel's. */
const PANEL_MARKER = '__dshBrowserPanel'

/**
 * The words this half adds, in both languages, with the SAME key set.
 *
 * tab.title / tab.description are the tab type's own copy, moved here from the
 * registration's string literals so the rail's capsule answers in the language the
 * page is in. Their zh values are byte-identical to the literals they replace, so
 * nothing drawn moves.
 */
const COPY_ZH = {
  'tab.title': '浏览器',
  'tab.description': '打开受控 Chrome 的实时画面：恒定分辨率，可缩放、可拖动滚动条，可多开与回收。',
  'panel.item.title': '打开浏览器面板',
}
const COPY_EN = {
  'tab.title': 'Browser',
  'tab.description': 'Open the live view of the controlled Chrome: a pinned resolution you can zoom and scroll, with more than one instance and recycling.',
  'panel.item.title': 'Open the browser panel',
}

/** The translate bound to this package's namespace, or null when the service is absent. */
let T = null
/** The page's active locale id, read once in apply(); empty means "zh first". */
let LOCALE_ID = ''
/** How many times the panel's action was asked for, in this page. */
let INVOKES = 0

/** Run a step that must not be able to take the page down; fallback answers when it throws. */
function safe(step, fallback) {
  try {
    return step()
  } catch {
    return fallback
  }
}

/** One error's own words, whatever shape it arrived in. */
function messageOf(error) {
  return error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error)
}

/** The kernel's own placeholder form: {name}, left alone when the parameter is missing. */
function substitute(template, params) {
  if (params === null || typeof params !== 'object') return String(template)
  return String(template).replace(/\{(\w+)\}/g, function (match, name) {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  })
}

/**
 * The page's locale service, or null when this page has none.
 *
 * ctx.get is the strict read (the service store); ctx.locale covers a ctx that is
 * a plain object. Neither read may throw: a page without the locale service is a
 * page whose words come from this package's own dictionary.
 */
function localeService(ctx) {
  const fromGet = safe(function () {
    return ctx && typeof ctx.get === 'function' ? ctx.get('locale') : null
  }, null)
  if (fromGet && typeof fromGet.register === 'function') return fromGet
  const direct = safe(function () { return ctx ? ctx.locale : null }, null)
  return direct && typeof direct.register === 'function' ? direct : null
}

/**
 * Register this package's dictionaries through the kernel locale service and bind t.
 *
 * A second registration of the same (namespace, locale) throws in the service's
 * own words; that refusal is caught here and never reaches the shell.
 * @returns the locale service, or null when this page has none.
 */
function bindTranslate(ctx) {
  const service = localeService(ctx)
  if (service !== null) {
    safe(function () { service.register(LOCALE_NS, { zh: COPY_ZH, en: COPY_EN }) }, null)
  }
  const bound = service !== null && typeof service.bind === 'function'
    ? safe(function () { return service.bind(LOCALE_NS) }, null)
    : null
  if (typeof bound === 'function') T = bound
  LOCALE_ID = safe(function () {
    if (service === null || typeof service.getLocale !== 'function') return ''
    const snapshot = service.getLocale()
    if (typeof snapshot === 'string') return snapshot
    if (snapshot === null || typeof snapshot !== 'object') return ''
    return String(snapshot.active || snapshot.id || snapshot.locale || '')
  }, '') || ''
  return service
}

/** Whether the page's language is English; zh is the fallback when nothing says otherwise. */
function pageIsEnglish() {
  return String(LOCALE_ID).toLowerCase().indexOf('en') === 0
}

/**
 * One of this half's own words.
 *
 * Through the kernel's translator when there is one - it reads the active locale
 * at call time, so a language switch needs no re-declaration; otherwise the SAME
 * dictionary answers. An unknown key arrives as itself, like the kernel's own
 * lookup chain does for an unanswered key.
 */
function t(key, params) {
  if (typeof T === 'function') return T(key, params)
  const dictionary = pageIsEnglish() ? COPY_EN : COPY_ZH
  const template = Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key
  return substitute(template, params)
}

/** This half's own record of what the contribution did; never throws, never carries a function. */
function markPanel(fields) {
  safe(function () {
    if (typeof globalThis === 'undefined') return
    const held = globalThis[PANEL_MARKER]
    const base = held !== null && typeof held === 'object' ? held : {}
    globalThis[PANEL_MARKER] = Object.assign({}, base, fields, { mounted: true })
  }, undefined)
}

/** The static face of this half's contribution, as data a reader can check without calling anything. */
function markDeclaration(declared, failed, tabType) {
  markPanel({
    id: PANEL_ITEM_ID,
    kind: PANEL_ITEM_KIND,
    source: PANEL_ITEM_SOURCE,
    ns: LOCALE_NS,
    tabId: TAB_ID,
    tabKind: tabType && typeof tabType.kind === 'string' ? tabType.kind : null,
    declared: declared,
    failed: failed,
  })
}

/** Record one ask of the panel's action, in this package's own marker. */
function markInvoke(result) {
  INVOKES += 1
  markPanel({ invokes: INVOKES, lastInvoke: result })
}

/**
 * The panel's contribution service, or null when this page has none.
 *
 * ctx.get is the strict read (the service store); ctx.linkPanel covers a ctx that
 * is a plain object. Neither read may throw: a page without the panel is a page
 * this half must leave alone.
 */
function linkPanelService(ctx) {
  const fromGet = safe(function () {
    return ctx && typeof ctx.get === 'function' ? ctx.get(LINK_PANEL_SERVICE) : null
  }, null)
  if (fromGet && typeof fromGet.declare === 'function') return fromGet
  const direct = safe(function () { return ctx ? ctx[LINK_PANEL_SERVICE] : null }, null)
  return direct && typeof direct.declare === 'function' ? direct : null
}

/** The right column's service, or null when this page has none; openTab is what it is read for. */
function sidebarRightService(ctx) {
  const fromGet = safe(function () {
    return ctx && typeof ctx.get === 'function' ? ctx.get(SIDEBAR_RIGHT_SERVICE) : null
  }, null)
  if (fromGet && typeof fromGet.openTab === 'function') return fromGet
  const direct = safe(function () { return ctx ? ctx[SIDEBAR_RIGHT_SERVICE] : null }, null)
  return direct && typeof direct.openTab === 'function' ? direct : null
}

/**
 * Open this half's own tab type - the kind READ out of the registration object.
 *
 * Nothing here may throw: the click lands on a page whose right column may have no
 * session surface mounted at all ("sidebarRight: no session surface is mounted",
 * service.ts:730), or may not be there, and neither is the panel's fault.
 * @param ctx - the plugin's context.
 * @param tabType - the object this half handed sidebarRightTabs.register.
 */
function openOwnPanel(ctx, tabType) {
  const service = sidebarRightService(ctx)
  if (service === null) {
    markInvoke({ ok: false, kind: tabType.kind, failed: 'sidebarRight-unavailable: this page offers no ' + SIDEBAR_RIGHT_SERVICE + ' service, so the browser panel was not opened' })
    return
  }
  try {
    service.openTab(tabType.kind)
    markInvoke({ ok: true, kind: tabType.kind, failed: null })
  } catch (error) {
    markInvoke({ ok: false, kind: tabType.kind, failed: 'openTab-refused: ' + messageOf(error) })
  }
}

/**
 * The one definition this half declares.
 *
 * An action carries no body: it is not a reading, it is a thing to do. The title
 * is a thunk over this package's dictionary, so a language switch is a
 * re-projection rather than a re-declaration.
 * @param ctx - the plugin's context.
 * @param tabType - the type this half registered; the action opens THAT kind.
 * @returns the item: the registry's identity fields plus the action's own invoke.
 */
function panelItemDefinition(ctx, tabType) {
  return {
    id: PANEL_ITEM_ID,
    kind: PANEL_ITEM_KIND,
    source: PANEL_ITEM_SOURCE,
    order: PANEL_ITEM_ORDER,
    title: function () { return t('panel.item.title') },
    invoke: function () { openOwnPanel(ctx, tabType) },
  }
}

/** Run the seam's disposer, whatever shape it came back in; never throws. */
function releasePanelItem(disposer) {
  safe(function () {
    if (typeof disposer === 'function') {
      disposer()
      return
    }
    if (disposer !== null && typeof disposer === 'object' && typeof disposer.dispose === 'function') disposer.dispose()
  }, undefined)
}

/**
 * Declare this package's one item, fail-closed, and bind the panel's refresh to
 * this page's language.
 *
 * @returns the disposer that takes the item back out and drops the language
 *   subscription, or null when there is no panel to declare to or the panel
 *   refused the item - in which case this package's own marker names which of the
 *   two it was, and every other registration of this half stands.
 */
function declarePanelItem(ctx, tabType, locale) {
  const service = linkPanelService(ctx)
  if (service === null) {
    markDeclaration(false, 'linkPanel-unavailable: this page offers no ' + LINK_PANEL_SERVICE + ' service, so the browser panel action was not declared', tabType)
    return null
  }
  let disposer = null
  try {
    disposer = service.declare(panelItemDefinition(ctx, tabType))
  } catch (error) {
    markDeclaration(false, 'linkPanel-declare-refused: ' + messageOf(error), tabType)
    return null
  }
  markDeclaration(true, null, tabType)
  // The drawn row carries this half's words, and a word can move without the item
  // being re-declared: the locale service says when the language moved, and the
  // seam's own notify() asks the panel to take a fresh projection. An event, not a
  // cadence - this half starts no timer.
  let off = null
  if (locale !== null && typeof locale.subscribe === 'function') {
    safe(function () {
      off = locale.subscribe(function () {
        safe(function () { if (typeof service.notify === 'function') service.notify() }, undefined)
      })
    }, undefined)
  }
  return function () {
    const unsubscribe = off
    off = null
    safe(function () { if (typeof unsubscribe === 'function') unsubscribe() }, undefined)
    releasePanelItem(disposer)
  }
}

/**
 * Bind the contribution to this plugin's lifetime through ctx.effect, with the
 * fallback the slot registrations use: a runtime without an effect API still gets
 * the item, and a runtime whose effect API throws does not get it twice.
 */
function registerPanelItem(ctx, tabType, locale) {
  if (typeof ctx.effect === 'function') {
    let ran = false
    try {
      ctx.effect(function () {
        ran = true
        const disposer = declarePanelItem(ctx, tabType, locale)
        return function () { releasePanelItem(disposer) }
      }, 'dsh-browser: panel action')
      return
    } catch (error) {
      if (ran) return
      safe(function () { console.warn('[dsh-browser] ctx.effect failed for the panel action', messageOf(error)) }, undefined)
    }
  }
  safe(function () { declarePanelItem(ctx, tabType, locale) }, undefined)
}

function createPanel(ctx, react) {
  const h = react.createElement
  let primitives = null
  try {
    primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  } catch {
    primitives = null
  }

  function Glyph(props) {
    const size = props && props.size
    const className = props && props.className
    const Icon = primitives && (primitives.IconGlobe16 || primitives.IconBrowser16 || primitives.IconWindow16)
    if (Icon) return h(Icon, { size, className })
    return h('span', { className, style: { fontSize: 14, lineHeight: 1 } }, '🌐')
  }

  async function call(op, args) {
    const response = await fetch(`${API_PATH}/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args || {}),
      credentials: 'same-origin',
    })
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok || !payload || payload.ok !== true) {
      const message = payload && payload.error ? payload.error.message : `HTTP ${response.status}`
      throw new Error(message)
    }
    return payload.result
  }

  const S = {
    root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 6, padding: '6px 8px', fontSize: 12 },
    row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    chip: (active) => ({
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 10, cursor: 'pointer',
      border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
      background: active ? 'var(--dsw-alias-interactive-bg-active, #2d3a4d)' : 'transparent',
      color: 'var(--dsw-alias-label-primary, #ddd)',
    }),
    btn: {
      padding: '3px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
      border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
      background: 'transparent', color: 'var(--dsw-alias-label-primary, #ddd)',
    },
    input: {
      flex: '1 1 160px', minWidth: 120, padding: '3px 6px', borderRadius: 7, fontSize: 12,
      border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
      background: 'var(--dsw-alias-fill-l1, #1b1b1b)', color: 'var(--dsw-alias-label-primary, #ddd)',
    },
    viewport: {
      flex: '1 1 auto', minHeight: 140, overflow: 'auto', borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)', background: '#000',
      scrollbarGutter: 'stable both-edges',
    },
    meta: { color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: 11, lineHeight: 1.5, wordBreak: 'break-all' },
    err: { color: '#ff8a8a', fontSize: 11, wordBreak: 'break-all' },
  }

  function BrowserBody() {
    const [state, setState] = react.useState(null)
    const [activeId, setActiveId] = react.useState(null)
    const [frame, setFrame] = react.useState(null)
    const [zoom, setZoom] = react.useState(0.5)
    const [auto, setAuto] = react.useState(true)
    const [error, setError] = react.useState(null)
    const [pathDraft, setPathDraft] = react.useState(null)
    const [busy, setBusy] = react.useState(false)
    const frameSeq = react.useRef(0)

    const refreshState = react.useCallback(async () => {
      try {
        const next = await call('state')
        setState(next)
        setError(null)
        setActiveId((current) => {
          if (current && next.instances.some((i) => i.id === current)) return current
          return next.instances.length > 0 ? next.instances[0].id : null
        })
      } catch (e) {
        setError(e && e.message ? e.message : String(e))
      }
    }, [])

    react.useEffect(() => {
      void refreshState()
    }, [refreshState])

    const grabFrame = react.useCallback(async () => {
      if (!activeId) {
        setFrame(null)
        return
      }
      try {
        const next = await call('frame', { id: activeId, scale: zoom })
        frameSeq.current += 1
        setFrame(next)
        setError(null)
      } catch (e) {
        setError(e && e.message ? e.message : String(e))
      }
    }, [activeId, zoom])

    react.useEffect(() => {
      // Nothing renders the captured frame when the control row is off, so the 1.3s screenshot loop would
      // be pure cost: it is gated on the same switch rather than left running invisibly.
      if (SHOW_CHROME_CONTROLS !== true) return undefined
      void grabFrame()
    }, [grabFrame])

    react.useEffect(() => {
      if (SHOW_CHROME_CONTROLS !== true) return undefined
      if (!auto || !activeId || typeof setInterval !== 'function') return undefined
      const timer = setInterval(() => {
        void grabFrame()
      }, POLL_MS)
      return () => clearInterval(timer)
    }, [auto, activeId, grabFrame])

    async function run(label, fn) {
      setBusy(true)
      try {
        await fn()
        await refreshState()
        await grabFrame()
        setError(null)
      } catch (e) {
        setError(`${label}: ${e && e.message ? e.message : String(e)}`)
      } finally {
        setBusy(false)
      }
    }

    // The contract when the controls are off, and the whole of it: one anchor that fills the pane body.
    // It carries no size of its own (absolute + inset 0), so it collapses with its container when DSH parks
    // an inactive pane body at 0x0 instead of holding the pane open.
    if (SHOW_CHROME_CONTROLS !== true) {
      return h('div', { 'data-dsh-link-surface': 'true', style: { position: 'absolute', inset: 0 } })
    }

    if (!state) {
      return h('div', { style: S.root }, h('div', { style: S.meta }, error ? `加载失败: ${error}` : '读取浏览器状态…'))
    }

    const instances = state.instances || []
    const active = instances.find((i) => i.id === activeId) || null
    const zoomIndex = Math.max(0, ZOOMS.indexOf(zoom))

    return h(
      'div',
      { style: S.root },
      // instance chips
      h(
        'div',
        { style: S.row },
        instances.length === 0
          ? h('span', { style: S.meta }, '没有打开的浏览器')
          : instances.map((i) =>
              h(
                'span',
                { key: i.id, style: S.chip(i.id === activeId), onClick: () => setActiveId(i.id), title: i.url },
                h('span', null, i.id),
                h('span', { style: { opacity: 0.6 } }, i.viewport),
              ),
            ),
      ),
      // actions
      h(
        'div',
        { style: S.row },
        h('button', { style: S.btn, disabled: busy, onClick: () => run('打开', () => call('open', {})) }, '＋ 打开'),
        h('button', { style: S.btn, disabled: busy || !activeId, onClick: () => run('关闭', () => call('close', { id: activeId, kill: true })) }, '✕ 关闭'),
        h('button', { style: S.btn, disabled: busy || instances.length === 0, onClick: () => run('全部关闭', () => call('close', { all: true, kill: true })) }, '全部关闭'),
        h('button', { style: S.btn, disabled: busy || !activeId, onClick: () => void grabFrame() }, '刷新画面'),
        h(
          'label',
          { style: { ...S.meta, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: auto, onChange: (e) => setAuto(e.target.checked) }),
          '自动',
        ),
      ),
      // zoom
      h(
        'div',
        { style: S.row },
        h('span', { style: S.meta }, '缩放'),
        h(
          'button',
          { style: S.btn, onClick: () => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)]) },
          '−',
        ),
        h('span', { style: { ...S.meta, minWidth: 36, textAlign: 'center' } }, `${Math.round(zoom * 100)}%`),
        h(
          'button',
          { style: S.btn, onClick: () => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)]) },
          '＋',
        ),
        h('button', { style: S.btn, onClick: () => setZoom(0.5) }, '适应'),
        h('button', { style: S.btn, onClick: () => setZoom(1) }, '100%'),
      ),
      // viewport
      h(
        'div',
        { style: S.viewport },
        frame
          ? h('img', {
              src: frame.dataUrl,
              alt: 'browser viewport',
              style: { width: frame.width, height: frame.height, display: 'block', imageRendering: zoom >= 1 ? 'pixelated' : 'auto' },
            })
          : h('div', { style: { ...S.meta, padding: 10 } }, activeId ? '抓取画面…' : '打开一个浏览器实例以查看画面'),
      ),
      // meta
      h(
        'div',
        { style: S.meta },
        frame
          ? `${frame.url}\n视口 ${frame.viewportWidth}×${frame.viewportHeight}（恒定），显示 ${frame.width}×${frame.height}，捕获 #${frame.seq}`
          : active
            ? `${active.url}`
            : '—',
      ),
      error ? h('div', { style: S.err }, error) : null,
      // settings: chrome path
      h(
        'div',
        { style: S.row },
        h('input', {
          style: S.input,
          placeholder: 'Chrome 路径（留空 = 自动探测）',
          value: pathDraft === null ? (state.config.browserExecutable || '') : pathDraft,
          onChange: (e) => setPathDraft(e.target.value),
        }),
        h(
          'button',
          {
            style: S.btn,
            disabled: busy,
            onClick: () =>
              void run('保存路径', async () => {
                await call('config', { patch: { browserExecutable: pathDraft === null ? (state.config.browserExecutable || '') : pathDraft } })
                setPathDraft(null)
              }),
          },
          '保存',
        ),
      ),
      h(
        'div',
        { style: S.meta },
        `生效路径: ${state.resolvedExecutable || '（未找到）'}${state.executableError ? ` — ${state.executableError}` : ''}\n默认视口 ${state.config.viewport.width}×${state.config.viewport.height} · 可见 ${state.config.visible ? '是' : '否（headless）'}\n配置文件: ${state.baseDir}`,
      ),
    )
  }

  function BrowserTitle() {
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, h(Glyph, { size: 14 }), '浏览器')
  }

  return { BrowserBody, BrowserTitle, Glyph }
}

    // `connection` is deliberately NOT injected any more: the panel talks to the
    // host over the /browser/api route, which needs no client service at all.
    //
    // `locale` and `linkPanel` ARE injected: the first is where this half's own words
    // live, the second is the contribution seam R192 opened. `sidebarRight` is
    // deliberately NOT injected even though `openTab` lives on it: injecting a service
    // makes the WHOLE half wait for it, and this half's tab type must not wait for the
    // right column. It is read with `ctx.get` at the moment the action is invoked, and
    // its absence is recorded there rather than awaited here.
    const inject = ['slots', 'sidebarRightTabs', 'locale', 'linkPanel']

    function apply(ctx) {
      const react = require('react')
      const panel = createPanel(ctx, react)
      // The words this half contributes come from its own locale namespace; a page
      // with no locale service answers from the same dictionary.
      const locale = bindTranslate(ctx)

      // ONE object, with two readers: sidebarRightTabs.register takes it, and the
      // panel's action reads the KIND IT MUST OPEN out of it (never a second copy of
      // the word). The registration's own fields - id / kind / priority / title /
      // guide - and its values are the ones the delivered tab face has always had;
      // the two guide strings are this package's dictionary's, and their zh values
      // are byte-identical to the literals they replace.
      const tabType = {
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'builtin',
        title: () => t('tab.title'),
        guide: [
          {
            order: 20,
            title: () => t('tab.title'),
            description: () => t('tab.description'),
            icon: panel.Glyph,
          },
        ],
      }

      ctx.effect(
        () => ctx.sidebarRightTabs.register(tabType),
        'dsh-browser: browser tab type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, panel.BrowserBody),
          ),
        'dsh-browser: browser tab body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, panel.BrowserTitle),
          ),
        'dsh-browser: browser tab title',
      )

      // The panel action (R193): one `action` item, declared fail-closed. A page with no
      // panel service, no right column or no mounted session surface keeps its tab type,
      // its two slots and its page.
      registerPanelItem(ctx, tabType, locale)
    }

    return { name: 'dsh-browser', inject, apply }
  },
})
