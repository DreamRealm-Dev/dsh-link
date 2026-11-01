window.__ModuleLoader__.load({
  id: "dsh-lan-bridge",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    let react = require("react")
    let primitives = null
    try { primitives = require("@deepseek-ai/dsh-client-ui-primitives") } catch (e) { primitives = null }

    // The primitives package is optional (0.1.5 and 0.2.0 disagree about its
    // shape), so its exports are probed one by one and every surface falls back
    // to the plain-React element built from the same theme tokens.
    const h = react.createElement
    const hasPrimitives = primitives !== null && typeof primitives === "object"

    /* ------------------------------------------------------------------ *
     * Constants
     * ------------------------------------------------------------------ */

    const API_PATH = "/dsh-lan-bridge/api"
    // Our route inside DSH's browser-trust fence: the fence authenticates the caller.
    const FENCED_PATH = "/api/dsh-lan-bridge"
    // Bumped whenever the bundle changes: the panel prints it, so "which build is
    // this page actually running" stops being a guess.
    const CLIENT_BUILD = "2026-10-03.3"
    const CHANNEL = "/dsh-lan-bridge"
    const UI_HEADER = "X-DSH-Bridge-UI"
    const POLL_MS = 1500
    const AUDIT_ROWS = 20
    const SLOT_ID = "dsh-lan-bridge"
    const PANEL_SLOT_ID = "dsh-lan-bridge-panel"
    const TOAST_SLOT_ID = "dsh-lan-bridge-toast"
    /** Closed-panel poll period: half the rate, still fast enough for a request. */
    const IDLE_POLL_MS = 3000
    const LOCALE_NS = "dsh-lan-bridge"
    const LOG = "[dsh-lan-bridge]"

    /* ------------------------------------------------------------------ *
     * Theme tokens with hard fallbacks: an unknown variable name still
     * renders readable text instead of an invisible surface.
     *
     * Every name below is defined by @deepseek-ai/dsh-client-ui-theme in this
     * build. The first block is the alias palette this panel is specified
     * against; the second block is the interaction palette the shipped chrome
     * itself uses for the same states, quoted from its own CSS modules:
     *   --dsw-alias-interactive-bg-hover   sidebar .iconButton:hover,
     *                                      .panelRow:hover, settings .trigger:hover
     *   --dsw-alias-interactive-bg-active  sidebar .panelRow.panelActive
     *   --dsw-alias-button-primary-hover   primitives Button .primary:hover
     *   --dsw-alias-label-primary-foreground  primitives Button .primary text
     * ------------------------------------------------------------------ */

    /*
     * Colours are `var(--token, <fallback>)` pairs, never bare token names.
     *
     * DSH defines its design tokens on `body`, and this panel renders into the
     * shell overlay. If that subtree ever sits outside the element carrying the
     * variables, every token resolves to nothing and the FALLBACK is what the
     * user actually sees — with light-only fallbacks that reads as "fine in light
     * mode, washed-out white in dark mode". Keeping the token first means DSH's
     * live value still wins whenever inheritance does work; making the fallback
     * follow the active colour scheme keeps the panel correct when it does not.
     */
    const TOKEN_SPECS = {
      // Surfaces. `--dsw-alias-bg-overlay` is a SCRIM (light #e9ecf2, dark #61666b),
      // NOT a panel background — using it as one is exactly what made the panel read
      // as washed-out grey in dark mode while the cards inside it went dark. DSH's
      // own floating menus use `--dsw-specific-menu` (= bg-layer-3), so this does too.
      surface: ["--dsw-specific-menu", "#ffffff", "#353638"],
      // Cards and inputs sit one step below the menu surface. That is white on white
      // in light mode, which is why every card and field also carries a border.
      card: ["--dsw-specific-input-major", "#ffffff", "#2c2c2e"],
      field: ["--dsw-specific-input-major", "#ffffff", "#2c2c2e"],
      chip: ["--dsw-specific-bubble", "#edf3fe", "#2c2c2e"],
      text: ["--dsw-alias-label-primary", "#0f1115", "#f9fafb"],
      muted: ["--dsw-alias-label-secondary", "#61666b", "#cfd3d6"],
      border: ["--dsw-alias-border-l1", "rgba(0, 0, 0, 0.04)", "rgba(255, 255, 255, 0.06)"],
      borderStrong: ["--dsw-alias-border-l2", "rgba(0, 0, 0, 0.1)", "rgba(255, 255, 255, 0.12)"],
      accent: ["--dsw-alias-brand-primary", "#0f1115", "#f9fafb"],
      onAccent: ["--dsw-alias-label-primary-foreground", "#ffffff", "#0f1115"],
      accentHover: ["--dsw-alias-button-primary-hover", "#43454a", "#e7e9ee"],
      hover: ["--dsw-alias-interactive-bg-hover", "rgba(38, 49, 72, 0.06)", "rgba(255, 255, 255, 0.08)"],
      active: ["--dsw-alias-interactive-bg-active", "rgba(38, 49, 72, 0.1)", "rgba(255, 255, 255, 0.14)"],
      danger: ["--dsw-alias-state-error-primary", "#ec1313", "#f25a5a"],
      ok: ["--dsw-alias-state-success-primary", "#22c55e", "#22c55e"],
      warn: ["--dsw-alias-state-warn-primary", "#f59e0b", "#f59e0b"],
    }
    const C = { mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }
    /** Which scheme the fallbacks currently assume. */
    let SCHEME = null

    /** The active colour scheme: DSH's own answer first, the OS media query second. */
    function currentScheme(ctx) {
      const declared = safe(function () {
        const theme = ctx && typeof ctx.get === "function" ? ctx.get("theme") : null
        const snapshot = theme && typeof theme.getTheme === "function" ? theme.getTheme() : null
        const scheme = snapshot && typeof snapshot.colorScheme === "string" ? snapshot.colorScheme : null
        return scheme === "dark" || scheme === "light" ? scheme : null
      }, null)
      if (declared !== null) return declared
      const media = safe(function () {
        return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null
      }, null)
      return media !== null && media.matches === true ? "dark" : "light"
    }

    /**
     * Rebuild every colour string for the active scheme.
     *
     * Called at apply() and on every poll tick, so a theme switch lands within the
     * panel's own refresh cadence instead of depending on a theme-change event the
     * client plane does not offer.
     */
    function applyScheme(ctx) {
      const scheme = currentScheme(ctx)
      if (scheme === SCHEME) return
      SCHEME = scheme
      const dark = scheme === "dark"
      for (const key of Object.keys(TOKEN_SPECS)) {
        const spec = TOKEN_SPECS[key]
        C[key] = "var(" + spec[0] + ", " + (dark ? spec[2] : spec[1]) + ")"
      }
      C.idle = C.muted
    }

    /** Dot colour for a plugin state, read live so a scheme refresh is picked up. */
    function dotColor(state) {
      if (state === "connected") return C.ok
      if (state === "busy") return C.warn
      if (state === "error") return C.danger
      return C.idle
    }
    // The four plugin states mapped onto the states DSH's own StateDot knows.
    const DOT_STATE = { idle: "idle", busy: "warning", connected: "done", error: "error" }
    // `both` is GONE: every role is both. The two postures are the whole list,
    // and the host refuses anything else (`ROLES` in lib/core/service.js).
    const ROLES = ["agent", "bridge"]

    /* ------------------------------------------------------------------ *
     * Geometry, copied from the shipped DSH chrome rather than invented.
     *
     * Sidebar column and foot
     *   dsh-client-ui-sidebar/lib/client.js  (SidebarRoot.module.css)
     *     .root          padding 6px 12px, font-size 14px, --dsw-specific-sidebar-fill
     *     .footArea      flex column, flex:none
     *     .footerActions display:flex, width:100%, min-width:0  <- our slot's box
     *     .collapsed     rail padding 18px 10px 6px; centered rows are 36x36
     *     .panelRow      min-height 36, gap 8, padding 7px 8px, radius 8, 14/22
     *     .iconButton    28x28 circle, label-secondary, hover interactive-bg-hover
     *
     * The 设置 control we must sit beside
     *   dsh-client-ui-settings-general/lib/client.js  (SettingsRoot.module.css)
     *     .triggerRow    flex, gap 8, width calc(100% + 4px), margin 4px -2px
     *     .trigger       height 42, radius 12, gap 8, padding 0 10px 0 8px,
     *                    14px/22px, label-primary, hover interactive-bg-hover
     *     .trigger.rail  36x36 circle, justify-content:center, gap 0, padding 0
     *     trigger content: wide 16px icon, rail 18px icon
     *
     * Cards and headings inside a floating surface
     *   dsh-client-ui-primitives/lib/Menu.module.css
     *     .item          min-height 40, radius 10, padding 8px 10px, gap 8, 14/22
     *     .label heading 12px/16px, padding 8px 10px
     *     .compactList .item  min-height 26, padding 3px 7px, radius 5, 12/18
     * ------------------------------------------------------------------ */

    const ROW_H = 42            // settings .trigger
    const ROW_H_RAIL = 36       // settings .trigger.rail / sidebar collapsed row
    const ROW_R = 12            // settings .trigger radius
    const ROW_PAD = "0 10px 0 8px"
    const ROW_GAP = 8
    const ROW_FONT = "14px"
    const ROW_LINE = "22px"
    const ICON = 16             // trigger content, wide
    const ICON_RAIL = 18        // trigger content, rail
    const DOT_SIZE = 10         // StateDot default, "the figma size"
    const DOT_RAIL = 8
    const CARD_R = "10px"
    const CELL_R = "8px"
    const CELL_H = "36px"
    const BTN_R = "8px"
    const PANEL_R = "10px"

    /**
     * The corner the panel and its toast are drawn with.
     *
     * Under the skin the radius is not this file's to choose. The skin owns every in-app
     * radius through `--lg-radius-panel` — the one value the theme control moves — and a
     * panel that rounded itself with its own number would be the single corner in the window
     * that ignored the control. So under the skin the token is *named*, as a custom-property
     * reference in the inline style: that resolves against the value on `html` at paint
     * time, so dragging the slider moves this corner with no re-render and no rebuild.
     *
     * Without the skin the panel keeps the 10px it has always had, because then nothing else
     * draws a pane for it and there is no token to follow.
     * @returns a CSS border-radius value.
     */
    function panelRadius() {
      // The fallback is not decoration: the skin can be switched off while this panel is
      // already rendered, and an inline `var()` that no longer resolves makes the whole
      // declaration invalid at computed-value time — the corner would collapse to square
      // until the next re-render. With the fallback it is the panel's own 10px immediately.
      return skinActive() ? "var(--lg-radius-panel, " + PANEL_R + ")" : PANEL_R
    }

    /* ------------------------------------------------------------------ *
     * Tiny utilities. Every one of them is total: no input makes it throw.
     * ------------------------------------------------------------------ */

    function safe(fn, fallback) {
      try { return fn() } catch (e) { return fallback }
    }

    function log(level, message, detail) {
      safe(function () {
        if (typeof console === "undefined" || console === null) return
        const sink = typeof console[level] === "function" ? console[level] : console.log
        if (typeof sink !== "function") return
        if (detail === undefined) sink.call(console, LOG + " " + message)
        else sink.call(console, LOG + " " + message, detail)
      }, undefined)
    }

    function msgOf(err) {
      if (err === null || err === undefined) return ""
      if (typeof err === "string") return err
      if (typeof err.message === "string" && err.message) return err.message
      return safe(function () { return String(err) }, "")
    }

    function isObj(v) { return v !== null && typeof v === "object" && Array.isArray(v) === false }

    function asArray(v) { return Array.isArray(v) ? v : [] }

    function asStr(v, fallback) {
      if (typeof v === "string") return v
      if (typeof v === "number" && isFinite(v)) return String(v)
      // 0.2.x 的 RPC 失败契约是结构化的（{code,message,details}）；取 message。
      if (v !== null && typeof v === "object" && typeof v.message === "string" && v.message !== "") return v.message
      return fallback === undefined ? "" : fallback
    }

    function asNum(v, fallback) {
      if (typeof v === "number" && isFinite(v)) return v
      if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v)
      return fallback
    }

    function numText(v, fallback) {
      const n = asNum(v, fallback)
      return n === undefined || n === null ? "" : String(n)
    }

    // A field named `*Ms` may arrive either as an epoch timestamp or as a plain
    // age in milliseconds. Anything at or above 1e11 is unambiguously an epoch
    // value (1973-03-03 and later); everything below is treated as an age.
    function elapsedMs(value) {
      const n = asNum(value, null)
      if (n === null || n < 0) return null
      if (n >= 1e11) return Math.max(0, Date.now() - n)
      return n
    }

    // The same idea for a deadline: the host sends `expiresAtMs` (a future
    // timestamp), while an `expiresInMs`-style field is already a remaining age.
    function remainingMs(value) {
      const n = asNum(value, null)
      if (n === null || n < 0) return null
      if (n >= 1e11) return Math.max(0, n - Date.now())
      return n
    }

    /* ------------------------------------------------------------------ *
     * Multi-device lookups.
     *
     * `snapshot()` v2 describes the same peer from several angles — the
     * discovery row (`peers`), the outbound link (`links`) and the inbound
     * session (`sessions`) — and each carries only the fields its own half of
     * the host knows. These three readers join them, so a row can show a
     * device's address and platform no matter which list it came from.
     * ------------------------------------------------------------------ */

    /** deviceId -> discovery row, for the platform/address a link does not carry. */
    function peerIndex(snapshot) {
      const out = {}
      const peers = asArray(snapshot && snapshot.peers)
      for (let i = 0; i < peers.length; i++) {
        const peer = isObj(peers[i]) ? peers[i] : null
        if (peer === null) continue
        const id = asStr(peer.deviceId, "")
        if (id !== "") out[id] = peer
      }
      return out
    }

    function lookupLink(snapshot, deviceId) {
      const id = asStr(deviceId, "")
      if (id === "") return null
      const links = asArray(snapshot && snapshot.links)
      for (let i = 0; i < links.length; i++) {
        const link = isObj(links[i]) ? links[i] : null
        if (link !== null && asStr(link.deviceId, "") === id) return link
      }
      return null
    }

    /**
     * "os/arch" for a device, from whichever list actually carries it.
     *
     * `links[]` and `sessions[]` keep no platform of their own (the bridge side
     * learns it per request, not per connection), so the discovery row and the
     * peer's own advertised target are the honest sources; with neither, the
     * caller is told nothing rather than shown a guess.
     */
    function platformOf(source, index) {
      const row = isObj(source) ? source : {}
      const direct = [asStr(row.os, ""), asStr(row.arch, "")].filter(Boolean).join("/")
      if (direct !== "") return direct
      const id = asStr(row.deviceId, "")
      const peer = id !== "" && isObj(index) ? index[id] : null
      if (peer) {
        const fromPeer = [asStr(peer.os, ""), asStr(peer.arch, "")].filter(Boolean).join("/")
        if (fromPeer !== "") return fromPeer
      }
      const devices = asArray(row.devices)
      for (let i = 0; i < devices.length; i++) {
        const device = isObj(devices[i]) ? devices[i] : null
        if (device === null || device.kind !== "direct") continue
        const local = [asStr(device.os, ""), asStr(device.arch, "")].filter(Boolean).join("/")
        if (local !== "") return local
      }
      return ""
    }

    function stateTextOf(state) {
      const value = asStr(state, "")
      if (value === "connecting") return pick("连接中", "connecting")
      if (value === "pairing") return pick("配对中", "pairing")
      if (value === "connected") return pick("已连接", "connected")
      if (value === "error") return pick("错误", "error")
      if (value === "closed") return pick("已关闭", "closed")
      return value
    }

    function stateDotFor(state) {
      const value = asStr(state, "")
      if (value === "connected") return "connected"
      if (value === "connecting" || value === "pairing") return "busy"
      return "error"
    }

    /** A bare duration, for labels like 有效期 / 已连接 that supply their own wording. */
    function durationText(ms) {
      const n = asNum(ms, null)
      if (n === null || n < 0) return ""
      const sec = Math.floor(n / 1000)
      if (sec < 2) return pick("刚刚", "just now")
      if (sec < 60) return sec + pick(" 秒", "s")
      const min = Math.floor(sec / 60)
      if (min < 60) return min + pick(" 分钟", " min")
      const hour = Math.floor(min / 60)
      if (hour < 24) return hour + pick(" 小时", " h")
      return Math.floor(hour / 24) + pick(" 天", " d")
    }

    /**
     * A COMPLETE "x ago" phrase.
     *
     * Separate from durationText on purpose: the "前"/" ago" suffix belongs to
     * this phrasing, not to the duration. Gluing it onto a bare duration printed
     * 刚刚前 and "just now ago", because 刚刚 ("just now") already IS the phrase
     * for the under-two-seconds case.
     */
    function agoText(ms) {
      const n = asNum(ms, null)
      if (n === null || n < 0) return ""
      const sec = Math.floor(n / 1000)
      if (sec < 2) return pick("刚刚", "just now")
      if (sec < 60) return sec + pick(" 秒前", "s ago")
      const min = Math.floor(sec / 60)
      if (min < 60) return min + pick(" 分钟前", " min ago")
      const hour = Math.floor(min / 60)
      if (hour < 24) return hour + pick(" 小时前", " h ago")
      return Math.floor(hour / 24) + pick(" 天前", " d ago")
    }

    function clockText(tsMs) {
      const n = asNum(tsMs, null)
      if (n === null || n <= 0) return ""
      return safe(function () {
        const d = new Date(n)
        const two = function (v) { return v < 10 ? "0" + v : String(v) }
        return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds())
      }, "")
    }

    function shortId(id) {
      const s = asStr(id, "")
      if (s.length <= 16) return s
      return s.slice(0, 8) + "…" + s.slice(-4)
    }

    function sx() {
      const out = {}
      for (let i = 0; i < arguments.length; i++) {
        const part = arguments[i]
        if (!isObj(part)) continue
        for (const key in part) {
          if (Object.prototype.hasOwnProperty.call(part, key) && part[key] !== undefined) out[key] = part[key]
        }
      }
      return out
    }

    function styleObject() {
      return {
        color: C.danger,
        border: "1px solid " + C.border,
        background: C.card,
        borderRadius: CARD_R,
        padding: "10px 12px",
        fontSize: "13px",
        lineHeight: "20px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }
    }

    /* ------------------------------------------------------------------ *
     * Locale: read once at apply() time, Simplified Chinese first.
     * ------------------------------------------------------------------ */

    let LOCALE_ID = ""

    // DSH hands the locale service out through ctx.get("locale"); older or
    // stripped hosts still expose it as ctx.locale. Neither read may throw, and
    // an empty result simply means "zh first".
    function localeService(ctx) {
      const fromGet = safe(function () {
        return ctx && typeof ctx.get === "function" ? ctx.get("locale") : null
      }, null)
      if (fromGet && typeof fromGet.getLocale === "function") return fromGet
      return ctx && ctx.locale ? ctx.locale : null
    }

    function readLocale(ctx) {
      LOCALE_ID = safe(function () {
        const service = localeService(ctx)
        if (!service || typeof service.getLocale !== "function") return ""
        const snap = service.getLocale()
        if (typeof snap === "string") return snap
        if (!isObj(snap)) return ""
        return asStr(snap.active, "") || asStr(snap.id, "") || asStr(snap.locale, "")
      }, "") || ""
    }

    /**
 * Whether the Liquid Glass skin is painting this window's controls.
 *
 * The bridge panel is a *surface*: under the skin, the pane it sits on — its fill, its rim,
 * and the lens that bends what is behind it — is the skin's to draw, and the skin can only
 * draw it if the panel stops painting its own. Inline styles beat any stylesheet, so leaving
 * the fill, border and shadow in this panel's `style` object left it with nothing but the
 * blur and the transparency of the skin's backdrop filter: measured on this very panel, its
 * computed background and box-shadow were still its own while the fill and rim of the skin's
 * rule never applied. Without the skin the panel keeps the look it has always had, because
 * then nothing else draws a pane for it.
 * @returns true when the skin is on.
 */
function skinActive() {
  try {
    return document.documentElement.getAttribute("data-lg-style") === "liquid-glass"
  } catch (error) {
    return false
  }
}

function isEnglish() {
      return String(LOCALE_ID).toLowerCase().indexOf("en") === 0
    }

    function pick(zh, en) { return isEnglish() ? en : zh }

    /* ------------------------------------------------------------------ *
     * Host RPC — POST /dsh-lan-bridge/api (same origin, relative URL).
     * ------------------------------------------------------------------ */

    function uiToken() {
      const fromPage = safe(function () {
        if (typeof window === "undefined" || window === null) return ""
        const injected = window.__DSH_LAN_BRIDGE_UI__
        if (!isObj(injected)) return ""
        return asStr(injected.token, "")
      }, "")
      return fromPage || ""
    }

    function rpcViaFetch(op, args, path, tokenOptional) {
      void tokenOptional
      return new Promise(function (resolve, reject) {
        const send = safe(function () { return typeof fetch === "function" ? fetch : null }, null)
        if (typeof send !== "function") {
          reject(new Error(pick("当前环境没有可用的 fetch", "fetch is unavailable in this environment")))
          return
        }
        const headers = { "content-type": "application/json" }
        headers[UI_HEADER] = uiToken()
        const body = JSON.stringify({ op: String(op), args: isObj(args) ? args : {} })
        let pending = null
        try {
          pending = send(path, {
            method: "POST",
            headers: headers,
            body: body,
            credentials: "same-origin",
            cache: "no-store",
          })
        } catch (err) {
          reject(new Error(pick("无法发送请求：", "Could not send the request: ") + msgOf(err)))
          return
        }
        Promise.resolve(pending).then(function (response) {
          const status = response && response.status ? response.status : 0
          const httpOk = response !== null && response !== undefined && response.ok === true
          // The envelope is authoritative: a failing op may arrive as a 200 with
          // `ok:false` or as a 4xx whose body still carries the reason, so the
          // body is read first and the HTTP status is only the fallback text.
          return Promise.resolve(safe(function () { return response.json() }, null)).then(function (payload) {
            if (isObj(payload)) {
              if (payload.ok === true) {
                resolve(payload.value)
                return
              }
              // The carrier WORKED and the host refused this one op: the reason
              // belongs on screen, and another carrier must not be tried (a
              // second attempt would just be refused again, and the real message
              // would be replaced by a transport complaint).
              var refused = new Error(asStr(payload.error, "") ||
                pick("Host 接口返回 HTTP ", "Host endpoint returned HTTP ") + status)
              refused.carrierOk = true
              reject(refused)
              return
            }
            if (!httpOk) {
              reject(new Error(pick("Host 接口返回 HTTP ", "Host endpoint returned HTTP ") + status))
              return
            }
            reject(new Error(pick("Host 接口返回了无法解析的响应", "Host endpoint returned an unreadable response")))
          })
        }, function (err) {
          reject(new Error(pick("无法连接 Host 接口：", "Could not reach the host endpoint: ") + msgOf(err)))
        }).catch(function (err) {
          reject(err instanceof Error ? err : new Error(msgOf(err)))
        })
      })
    }

    /*
     * Three carriers, one op table. The order matters and is chosen per call:
     *
     *   fence      our route INSIDE DSH's browser-trust fence. The fence answers
     *              only a caller that already holds the fenced auth cookie, so
     *              this carrier needs no shared secret — it works even on a build
     *              whose index never carries our injected global (which is how the
     *              Mac side hit "missing or wrong X-DSH-Bridge-UI token").
     *   route      our own token-guarded route, for a host where `/api` is not
     *              fenced.
     *   connection the sanctioned generic RPC, when the host composes it.
     *
     * The first carrier that answers wins and sticks for the session.
     */
    let hostCtx = null
    /** Sticky after the first answer: 'fence' | 'route' | 'connection' | null. */
    let carrierChoice = null

    function injectedDescriptor() {
      return safe(function () {
        if (typeof window === "undefined" || window === null) return null
        const value = window.__DSH_LAN_BRIDGE_UI__
        return isObj(value) ? value : null
      }, null)
    }

    function fencePath() {
      return safe(function () {
        const descriptor = injectedDescriptor()
        const declared = descriptor && typeof descriptor.fence === "string" ? descriptor.fence : ""
        return declared !== "" ? declared : FENCED_PATH
      }, FENCED_PATH)
    }

    function rpcViaFence(op, args) {
      return rpcViaFetch(op, args, fencePath(), true)
    }

    function rpcViaTokenRoute(op, args) {
      return rpcViaFetch(op, args, API_PATH, false)
    }

    function rpcViaConnection(op, args) {
      const connectionRpc = safe(function () {
        const face = hostCtx && hostCtx.connection && hostCtx.connection.rpc
        return face && typeof face.call === "function" ? face : null
      }, null)
      if (connectionRpc === null) return Promise.reject(new Error("connection RPC is not composed in this host"))
      return new Promise(function (resolve, reject) {
        let pending = null
        try {
          pending = connectionRpc.call(CHANNEL, String(op), isObj(args) ? args : {}, undefined)
        } catch (err) {
          pending = Promise.reject(err)
        }
        Promise.resolve(pending).then(function (payload) {
          if (isObj(payload) && payload.ok === true) {
            resolve(payload.value)
            return
          }
          var refused = new Error(isObj(payload)
            ? (asStr(payload.error, "") || "the host refused the request")
            : pick("Host 接口返回了无法解析的响应", "Host endpoint returned an unreadable response"))
          // A well-formed refusal means the carrier worked; only a transport
          // failure (a rejected call, a 405 from a static fallback) may fall
          // through to the next carrier.
          if (isObj(payload)) refused.carrierOk = true
          reject(refused)
        }, function (err) {
          reject(err instanceof Error ? err : new Error(msgOf(err)))
        })
      })
    }

    function carrierFor(name) {
      if (name === "fence") return rpcViaFence
      if (name === "route") return rpcViaTokenRoute
      return rpcViaConnection
    }

    function carrierOrder() {
      const descriptor = injectedDescriptor()
      const declared = descriptor && typeof descriptor.carrier === "string" ? descriptor.carrier : null
      const hasToken = uiToken() !== ""
      if (declared === "fence") return ["fence", "route", "connection"]
      if (declared === "route" && hasToken) return ["route", "fence", "connection"]
      if (declared === "connection") return ["connection", "fence", "route"]
      // No descriptor at all: the fenced path is the only one that needs no
      // secret, so try it first rather than failing on a missing token.
      return ["fence", "route", "connection"]
    }

    function rpc(op, args) {
      if (carrierChoice !== null) return carrierFor(carrierChoice)(op, args)
      const order = carrierOrder()
      let index = 0
      const failures = []
      function attempt() {
        const name = order[index]
        return carrierFor(name)(op, args).then(function (value) {
          carrierChoice = name
          return value
        }, function (err) {
          // A refusal from a working carrier is the host's answer: surface it.
          if (err && err.carrierOk === true) return Promise.reject(err)
          failures.push(name + " " + msgOf(err))
          index += 1
          if (index < order.length) return attempt()
          // Every carrier failed at the transport level. Say so in one line that
          // names what was tried, instead of quoting whichever error happened to
          // come last (which is how a 405 from a fallback path used to look like
          // the whole story).
          const hint = pick(
            "面板连不上主机侧的桥接插件。最常见原因是 DSH 装完插件后没有重启（主机代码由进程加载）；其次是页面拿的是旧的客户端包。请退出 DSH 再打开后重试。",
            "The panel cannot reach the host plugin. The usual cause is DSH not having been restarted after installing the plugin (host code is loaded per process); the second is a stale client bundle. Quit DSH, reopen, and retry.",
          )
          return Promise.reject(new Error(pick("桥接面板无法连接主机：", "Bridge panel cannot reach the host: ") +
            failures.join(" · ") + pick("。", ". ") + hint))
        })
      }
      return attempt()
    }

    /* ------------------------------------------------------------------ *
     * Store shared by the footer control and the panel.
     * ------------------------------------------------------------------ */

    function createStore() {
      const listeners = new Set()
      let open = false
      let snapshot = null
      let busy = 0
      let error = null
      let notice = null

      function notify() {
        const each = Array.from(listeners)
        for (let i = 0; i < each.length; i++) {
          safe(function () { each[i]() }, undefined)
        }
      }

      return {
        subscribe(listener) {
          if (typeof listener !== "function") return function () {}
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
        read() {
          return { open: open, snapshot: snapshot, busy: busy > 0, error: error, notice: notice }
        },
        toggle() { open = !open; notify() },
        close() { if (open) { open = false; notify() } },
        setSnapshot(value) { snapshot = isObj(value) ? value : null; notify() },
        setError(value) {
          const next = value === null || value === undefined || value === "" ? null : String(value)
          if (next === error) return
          error = next
          if (next !== null) log("warn", next)
          notify()
        },
        setNotice(value) {
          const next = value === null || value === undefined || value === "" ? null : String(value)
          if (next !== notice) { notice = next; notify() }
        },
        begin() { busy += 1; notify() },
        end() { busy = busy > 0 ? busy - 1 : 0; notify() },
      }
    }

    let STORE = null

    function getStore() {
      if (STORE === null) STORE = createStore()
      return STORE
    }

    // Run one RPC with the shared flight counter, error banner and notice line.
    function run(store, op, args, options) {
      const opts = isObj(options) ? options : {}
      store.begin()
      if (opts.keepError !== true) store.setError(null)
      if (opts.notice !== undefined) store.setNotice(null)
      return rpc(op, args).then(function (value) {
        if (opts.notice !== undefined) {
          store.setNotice(typeof opts.notice === "function" ? opts.notice(value) : opts.notice)
        }
        store.setError(null)
        if (typeof opts.after === "function") safe(function () { opts.after(value) }, undefined)
        return value
      }, function (err) {
        store.setError(msgOf(err))
        return undefined
      }).then(function (value) {
        store.end()
        return value
      }, function (err) {
        store.end()
        log("warn", "unexpected failure while running " + op, err)
        return undefined
      })
    }

    /* ------------------------------------------------------------------ *
     * Derived view state.
     * ------------------------------------------------------------------ */

    function normalizeRole(value) {
      const role = asStr(value, "")
      return ROLES.indexOf(role) === -1 ? "agent" : role
    }

    /* ------------------------------------------------------------------ *
     * Host shape — the panel is served from disk, the host is loaded at
     * process start.
     *
     * This plugin is installed as a junction to the source tree, so every page
     * load serves the CURRENT `lib/client.js` while the running DSH process
     * keeps whatever host code it booted with. A mismatch is therefore the
     * EXPECTED state during development, not an error, and it must be legible:
     * a new panel talking to an old host has no `links`/`sessions`/`targets`/
     * `requests` at all and would otherwise render an empty, half-dead panel
     * that reads as a regression.
     *
     * `Array.isArray(snapshot.links)` is the cheap, unambiguous test: the v2
     * snapshot always carries it, and no older host ever did. Everything below
     * either reads the v2 shape or falls back to the legacy aliases the old
     * host DOES send (`connection`, `peersConnected`, `request`), so the user
     * can still see and act on the one connection they have.
     * ------------------------------------------------------------------ */

    /** 'v2' when the host speaks the multi-device snapshot, 'legacy' otherwise. */
    function hostShape(snapshot) {
      if (!isObj(snapshot)) return "none"
      return Array.isArray(snapshot.links) ? "v2" : "legacy"
    }

    function isLegacyHost(snapshot) {
      return hostShape(snapshot) === "legacy"
    }

    /** The legacy single connection, or null. */
    function legacyConnection(snapshot) {
      return isObj(snapshot && snapshot.connection) ? snapshot.connection : null
    }

    /** The legacy inbound list (alias of `sessions` on an old host). */
    function legacySessions(snapshot) {
      return asArray(snapshot && snapshot.peersConnected).filter(isObj)
    }

    /**
     * Pending approvals, from either shape.
     *
     * A new panel against an old host MUST still be able to approve: the old
     * host sends the single `request` alias and nothing else, and dropping it
     * would silently remove the one control that unblocks the other machine.
     */
    function pendingRequests(snapshot) {
      if (hostShape(snapshot) === "v2") return asArray(snapshot.requests).filter(isObj)
      const legacy = isObj(snapshot && snapshot.request) ? snapshot.request : null
      return legacy === null ? [] : [legacy]
    }

    function dotState(snapshot, error) {
      if (error) return "error"
      if (isLegacyHost(snapshot)) {
        const conn = legacyConnection(snapshot)
        if (conn !== null) {
          if (asStr(conn.error, "")) return "error"
          if (conn.state === "connected") return "connected"
          if (conn.state === "connecting" || conn.state === "pairing") return "busy"
        }
        if (pendingRequests(snapshot).length > 0 || isObj(snapshot && snapshot.pairing)) return "busy"
        return "idle"
      }
      const links = asArray(snapshot && snapshot.links).filter(isObj)
      if (links.some(function (link) { return asStr(link.error, "") !== "" || link.state === "error" })) return "error"
      if (links.some(function (link) { return link.state === "connected" })) return "connected"
      if (links.some(function (link) { return link.state === "connecting" || link.state === "pairing" })) return "busy"
      if (pendingRequests(snapshot).length > 0) return "busy"
      if (snapshot && isObj(snapshot.pairing)) return "busy"
      return "idle"
    }

    function roleLabel(role) {
      if (role === "bridge") return pick("桥接侧", "Bridge side")
      if (role === "agent") return pick("Agent 侧", "Agent side")
      return pick("未知角色", "Unknown role")
    }

    /** How many links are in one state, for the footer's one-line summary. */
    function linksInState(snapshot, state) {
      return asArray(snapshot && snapshot.links).filter(function (link) {
        return isObj(link) && link.state === state
      })
    }

    function statusLabel(snapshot, dot) {
      if (dot === "error") return pick("错误", "Error")
      if (isLegacyHost(snapshot)) {
        // The old host only ever knows about one connection; say that plainly
        // instead of reporting "not connected" while it is up.
        const conn = legacyConnection(snapshot)
        if (conn !== null && conn.state === "connected") {
          return pick("已连接 ", "connected ") +
            (asStr(conn.peerName, "") || shortId(conn.peerDeviceId) || pick("对端", "peer"))
        }
        if (conn !== null && conn.state === "connecting") return pick("连接中", "connecting")
        if (conn !== null && conn.state === "pairing") return pick("配对中", "pairing")
        if (pendingRequests(snapshot).length > 0) return pick("待批准", "approval pending")
        if (isObj(snapshot && snapshot.pairing)) return pick("配对中", "pairing")
        if (dot === "busy") return pick("处理中", "working")
        return pick("未连接", "not connected")
      }
      const connected = linksInState(snapshot, "connected")
      const names = connected.map(function (link) {
        return asStr(link.name, "") || shortId(link.deviceId) || pick("对端", "peer")
      })
      if (names.length === 1) return pick("已连接 ", "connected ") + names[0]
      if (names.length > 1) return pick("已连接 ", "connected ") + names.length + pick(" 台设备", " devices")
      if (linksInState(snapshot, "connecting").length > 0) return pick("连接中", "connecting")
      if (linksInState(snapshot, "pairing").length > 0) return pick("配对中", "pairing")
      if (pendingRequests(snapshot).length > 0) return pick("待批准", "approval pending")
      if (snapshot && isObj(snapshot.pairing)) return pick("配对中", "pairing")
      if (dot === "busy") return pick("处理中", "working")
      return pick("未连接", "not connected")
    }

    function footerText(snapshot, dot) {
      const role = normalizeRole(snapshot && snapshot.role)
      // `accepts` (listening) and `discoverable` (announcing) are two separate
      // facts — see the identity section — so only an EXPLICIT false may make
      // this line say "not accepting". A missing field (an older host) says
      // nothing rather than inventing a refusal.
      const refuses = isObj(snapshot) && snapshot.accepts === false
      const suffix = refuses ? pick(" · 不接收连接", " · not accepting") : ""
      return roleLabel(role) + " · " + statusLabel(snapshot, dot) + suffix
    }

    function normalizeAudit(value) {
      if (Array.isArray(value)) return value
      if (!isObj(value)) return []
      if (Array.isArray(value.rows)) return value.rows
      if (Array.isArray(value.audit)) return value.audit
      if (Array.isArray(value.entries)) return value.entries
      return []
    }

    function grantOf(source) {
      const grant = isObj(source) ? source : {}
      return {
        roots: asArray(grant.roots).map(function (r) { return asStr(r, "") }).filter(Boolean),
        write: grant.write === true,
        shell: grant.shell === true,
        // Relaying is granted unless the host says otherwise; an explicit false
        // has to survive the round trip or turning it off would silently come
        // back on (`sanitizeGrant` in lib/core/policy.js makes the same call).
        relay: grant.relay === undefined ? true : grant.relay === true,
        relayPeers: asArray(grant.relayPeers).map(function (p) { return asStr(p, "") }).filter(Boolean),
        timeoutMs: asNum(grant.timeoutMs, 30000),
        maxOutputBytes: asNum(grant.maxOutputBytes, 262144),
      }
    }

    function grantSummary(grant) {
      const g = grantOf(grant)
      const parts = []
      parts.push(pick("根目录 ", "roots ") + g.roots.length)
      parts.push(g.write ? pick("可写", "write") : pick("只读", "read-only"))
      parts.push("Shell " + (g.shell ? pick("开", "on") : pick("关", "off")))
      if (g.relay !== true) {
        parts.push(pick("中转 关", "relay off"))
      } else if (g.relayPeers.length > 0) {
        parts.push(pick("中转 ", "relay ") + g.relayPeers.length + pick(" 台", " devices"))
      }
      return parts.join(" · ")
    }

    function capsOf(value) {
      return asArray(value).map(function (c) { return asStr(c, "") }).filter(Boolean)
    }

    function parseAddress(text) {
      const raw = asStr(text, "").trim()
      if (!raw) return null
      let host = ""
      let port = 0
      const bracketed = /^\[([^\]]+)\]:(\d{1,5})$/.exec(raw)
      if (bracketed) {
        host = bracketed[1]
        port = Number(bracketed[2])
      } else {
        const at = raw.lastIndexOf(":")
        if (at <= 0) {
          host = raw
        } else {
          host = raw.slice(0, at)
          port = Number(raw.slice(at + 1))
        }
      }
      host = host.trim()
      if (!host) return null
      if (!isFinite(port) || port <= 0 || port > 65535) return null
      return { host: host, port: port }
    }

    /* ------------------------------------------------------------------ *
     * DSH primitives, probed by name.
     *
     * Used only where the export is a pure, self-contained renderer:
     *   StateDot            the state dot, sizes 10/8 exactly as shipped
     *   Tag                 the read-only chip
     *   IconLinkOutline16   the row glyph, so the control carries DSH's icon
     * Everything else (Button, Input, Pill, Switch, Tooltip) either owns
     * geometry that fights this dense panel or mounts its own DOM, so those
     * surfaces are plain elements styled from the tokens above.
     * ------------------------------------------------------------------ */

    function primitivesExport(name) {
      if (hasPrimitives !== true) return null
      const value = safe(function () { return primitives[name] }, null)
      return typeof value === "function" ? value : null
    }

    // DSH's own 16px outline icons are filled paths on currentColor, which is
    // how the colour below reaches the glyph.
    function bridgeGlyph(size, color) {
      const Icon = primitivesExport("IconLinkOutline16")
      if (Icon !== null) {
        const drawn = safe(function () {
          return h("span", {
            style: { display: "inline-flex", flex: "0 0 auto", alignItems: "center", color: color },
          }, h(Icon, { size: size }))
        }, null)
        if (drawn) return drawn
      }
      return bridgeIcon(size, color)
    }

    function bridgeIcon(size, color) {
      return h("svg", {
        width: size, height: size, viewBox: "0 0 16 16", fill: "none",
        "aria-hidden": "true", focusable: "false",
        style: { display: "block", flex: "0 0 auto", color: color },
      },
        h("path", {
          key: "a", d: "M6.4 3.6 3.7 6.3a2.9 2.9 0 0 0 0 4.1l.2.2a2.9 2.9 0 0 0 4.1 0l1-1",
          stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round",
        }),
        h("path", {
          key: "b", d: "M9.6 12.4l2.7-2.7a2.9 2.9 0 0 0 0-4.1l-.2-.2a2.9 2.9 0 0 0-4.1 0l-1 1",
          stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round",
        }),
        h("circle", { key: "c", cx: 8, cy: 8, r: 1.5, fill: "currentColor" }))
    }

    function plainDot(state, size) {
      return h("span", {
        "data-bridge-dot": state,
        "aria-hidden": "true",
        style: {
          display: "inline-block",
          flex: "0 0 auto",
          width: size, height: size,
          borderRadius: "50%",
          background: dotColor(state) || C.idle,
        },
      })
    }

    function statusDot(state, size) {
      const px = asNum(size, DOT_SIZE) || DOT_SIZE
      const Dot = primitivesExport("StateDot")
      if (Dot !== null) {
        const drawn = safe(function () {
          return h(Dot, { state: DOT_STATE[state] || "idle", size: px })
        }, null)
        if (drawn) return drawn
      }
      return plainDot(state, px)
    }

    function plainChip(text, key, tone) {
      return h("span", {
        key: key,
        style: {
          display: "inline-flex",
          alignItems: "center",
          fontSize: "11px",
          lineHeight: "17px",
          fontWeight: 500,
          padding: "1px 8px",
          borderRadius: "999px",
          border: "0.5px solid " + (tone === "success" ? C.ok : C.borderStrong),
          background: C.chip,
          color: tone === "success" ? C.ok : C.muted,
          whiteSpace: "nowrap",
        },
      }, text)
    }

    function chip(text, key, tone) {
      const Tag = primitivesExport("Tag")
      const name = tone === undefined ? "outline" : tone
      if (Tag !== null) {
        const drawn = safe(function () { return h(Tag, { key: key, tone: name }, text) }, null)
        if (drawn) return drawn
      }
      return plainChip(text, key, name)
    }

    /* ------------------------------------------------------------------ *
     * Interaction state.
     *
     * DSH expresses its hover and active fills as CSS pseudo-classes on its own
     * class names; an inline style cannot, so the very same tokens are applied
     * from React state instead. The smoke harness never fires these events and
     * simply keeps the resting fill.
     * ------------------------------------------------------------------ */

    function useHoverFill() {
      const state = react.useState(false)
      const set = function (value) {
        if (typeof state[1] === "function") state[1](value)
      }
      return {
        active: state[0] === true,
        on: function () { set(true) },
        off: function () { set(false) },
      }
    }

    function hoverProps(hover, disabled) {
      if (disabled === true || !isObj(hover)) return {}
      return {
        onMouseEnter: hover.on,
        onMouseLeave: hover.off,
        onFocus: hover.on,
        onBlur: hover.off,
      }
    }

    // The keyboard focus ring DSH's own inputs draw from :focus-within, applied
    // imperatively because an inline style cannot express a pseudo-class.
    function focusRing(event, color) {
      safe(function () {
        const target = event && event.target
        if (target && target.style) target.style.borderColor = color
      }, undefined)
    }

    /* ------------------------------------------------------------------ *
     * Shared presentation pieces.
     * ------------------------------------------------------------------ */

    function buttonStyle(kind, disabled, hovered) {
      const base = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        boxSizing: "border-box",
        height: "30px",
        flex: "0 0 auto",
        padding: "0 12px",
        border: "1px solid transparent",
        borderRadius: BTN_R,
        background: "transparent",
        color: C.text,
        font: "inherit",
        fontSize: "13px",
        lineHeight: "20px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }
      if (kind === "primary") {
        return sx(base, {
          background: hovered ? C.accentHover : C.accent,
          borderColor: hovered ? C.accentHover : C.accent,
          color: C.onAccent,
        })
      }
      if (kind === "danger") {
        return sx(base, {
          borderColor: C.borderStrong,
          color: C.danger,
          background: hovered ? C.hover : "transparent",
        })
      }
      return sx(base, {
        borderColor: C.borderStrong,
        background: hovered ? C.hover : "transparent",
      })
    }

    function BridgeButton(props) {
      const p = isObj(props) ? props : {}
      const disabled = p.disabled === true
      const hover = useHoverFill()
      return h("button", sx({
        type: "button",
        disabled: disabled,
        title: p.title === undefined ? p.label : p.title,
        "data-bridge-action": p.action,
        onClick: disabled ? undefined : p.onClick,
        style: sx(buttonStyle(p.kind, disabled, hover.active === true && disabled !== true), p.style),
      }, hoverProps(hover, disabled)), p.label)
    }

    function button(key, label, onClick, options) {
      const opts = isObj(options) ? options : {}
      return h(BridgeButton, {
        key: key,
        label: label,
        action: key,
        onClick: onClick,
        disabled: opts.disabled === true,
        title: opts.title,
        kind: opts.kind,
        style: opts.style,
      })
    }

    // DSH's 28x28 circular icon button (sidebar .iconButton, settings .close).
    function BridgeIconButton(props) {
      const p = isObj(props) ? props : {}
      const disabled = p.disabled === true
      const hover = useHoverFill()
      return h("button", sx({
        type: "button",
        disabled: disabled,
        title: p.title,
        "aria-label": p.label,
        "data-bridge-action": p.action,
        onClick: disabled ? undefined : p.onClick,
        style: sx({
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          width: "28px",
          height: "28px",
          flex: "0 0 auto",
          padding: 0,
          border: "none",
          borderRadius: "50%",
          background: hover.active === true && disabled !== true ? C.hover : "transparent",
          color: C.text,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
        }, p.style),
      }, hoverProps(hover, disabled)),
        h("svg", {
          width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
          "aria-hidden": "true", focusable: "false", style: { display: "block", color: C.muted },
        },
          h("path", {
            key: "x1", d: "M13.5 3.2 12.8 2.5 8 7.3 3.2 2.5l-.7.7L7.3 8l-4.8 4.8.7.7L8 8.7l4.8 4.8.7-.7L8.7 8z",
            fill: "currentColor",
          })))
    }

    // DSH's own selectable row (sidebar .panelRow / settings .navCell): a
    // 36px cell that is label-secondary at rest and label-primary on the active
    // fill, with the shared hover fill in between.
    function RowCell(props) {
      const p = isObj(props) ? props : {}
      const disabled = p.disabled === true
      const active = p.active === true
      const hover = useHoverFill()
      const filled = active || (hover.active === true && disabled !== true)
      return h("button", sx({
        type: "button",
        disabled: disabled,
        title: p.title,
        "aria-pressed": p.active === undefined ? undefined : active,
        "data-bridge-role": p.role,
        onClick: disabled ? undefined : p.onClick,
        style: sx({
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: ROW_GAP + "px",
          boxSizing: "border-box",
          width: "100%",
          minWidth: 0,
          minHeight: CELL_H,
          padding: "7px 8px",
          border: "none",
          borderRadius: CELL_R,
          background: filled ? (active ? C.active : C.hover) : "transparent",
          color: active ? C.text : C.muted,
          font: "inherit",
          fontSize: ROW_FONT,
          lineHeight: ROW_LINE,
          fontWeight: active ? 500 : 400,
          textAlign: "left",
          whiteSpace: "nowrap",
          overflow: "hidden",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
        }, p.style),
      }, hoverProps(hover, disabled)), p.label)
    }

    function inputStyle(extra) {
      return sx({
        boxSizing: "border-box",
        font: "inherit",
        fontSize: "13px",
        lineHeight: "20px",
        height: "30px",
        padding: "0 8px",
        borderRadius: CELL_R,
        background: C.field,
        color: C.text,
        border: "1px solid " + C.borderStrong,
        outline: "none",
        minWidth: 0,
      }, extra)
    }

    function inputRingProps() {
      return {
        onFocus: function (event) { focusRing(event, C.accent) },
        onBlur: function (event) { focusRing(event, C.borderStrong) },
      }
    }

    function cardStyle(extra) {
      return sx({
        boxSizing: "border-box",
        border: "1px solid " + C.border,
        borderRadius: CARD_R,
        background: C.card,
      }, extra)
    }

    function sectionTitle(text, right) {
      // The key is derived from the label: several section headings share one
      // parent array, and a fixed key would be duplicated there.
      return h("div", {
        key: "title-" + text,
        style: {
          display: "flex", alignItems: "center", gap: ROW_GAP + "px",
          minHeight: "28px",
          margin: "14px 0 6px",
          fontSize: "12px", lineHeight: "16px", fontWeight: 500,
          color: C.muted,
        },
      },
        h("span", { key: "t", style: { flex: "1 1 auto" } }, text),
        right === undefined ? null : right)
    }

    /**
     * One labelled section.
     *
     * Every section carries BOTH a stable `id` and a `data-bridge-section`
     * marker: the id makes the panel addressable (deep links, a future test, a
     * screenshot annotation), and the attribute gives the smoke harness a
     * selector that does not depend on this file's CSS-in-JS decisions.
     */
    function sectionBlock(id, children) {
      return h("div", {
        id: id,
        "data-bridge-section": id,
        style: { marginTop: "2px" },
      }, children)
    }

    // The small read-only chip, DSH's 12px label geometry with this file's own
    // padding (the primitives Tag is probed first, exactly like every other
    // shared surface).
    function tagStyle(tone) {
      return {
        display: "inline-flex",
        alignItems: "center",
        flex: "0 0 auto",
        fontSize: "11px",
        lineHeight: "17px",
        fontWeight: 500,
        padding: "1px 8px",
        borderRadius: "999px",
        border: "0.5px solid " + (tone === "success" ? C.ok : C.borderStrong),
        background: C.chip,
        color: tone === "success" ? C.ok : C.muted,
        whiteSpace: "nowrap",
      }
    }

    function stateChip(state) {
      const tone = state === "connected" ? "success" : undefined
      return chip(stateTextOf(state), "state", tone)
    }

    // The 中转 badge. A relayed call is answered by a THIRD machine, and the
    // grant it runs under is the minimum of both hops — the two facts a user
    // must see before trusting the row. This is not decoration, so it is drawn
    // in the warn colour rather than in the muted chip fill every other label
    // uses, and it always names the machine the call goes through.
    function relayTag(label, key) {
      return h("span", {
        key: key,
        "data-bridge-chip": "relay",
        style: {
          display: "inline-flex",
          alignItems: "center",
          flex: "0 0 auto",
          fontSize: "11px",
          lineHeight: "17px",
          fontWeight: 600,
          padding: "1px 8px",
          borderRadius: "999px",
          border: "0.5px solid " + C.warn,
          background: C.chip,
          color: C.warn,
          whiteSpace: "nowrap",
        },
      }, label)
    }

    /**
     * Who (and what) a relayed target goes through.
     *
     * `path` is the provenance the host builds hop by hop, so its LAST entry is
     * the next hop this machine actually talks to — the only machine named here
     * that the user can check. When the peer announced no path, the link that
     * carried the advertisement is the honest answer instead of a blank.
     */
    function viaInfo(target, snapshot) {
      const id = asStr(target && target.linkDeviceId, "")
      const link = lookupLink(snapshot, id)
      const index = peerIndex(snapshot)
      const path = asArray(target && target.path).map(function (hop) { return asStr(hop, "") }).filter(Boolean)
      const viaId = path.length > 0 ? path[path.length - 1] : id
      const viaPeer = viaId !== "" && isObj(index[viaId]) ? index[viaId] : null
      const linkName = asStr(link && link.name, "")
      const viaName = asStr(viaPeer && viaPeer.name, "") || linkName || shortId(viaId) || pick("未知中转设备", "unknown relay")
      return {
        id: viaId,
        name: viaName,
        link: link,
        hops: asNum(target && target.hops, null),
        path: path,
        peers: isObj(viaPeer) && asNum(viaPeer.relayDevices, 0) > 0 ? asNum(viaPeer.relayDevices, 0) : null,
      }
    }

    function relayNotice(target, snapshot, hint) {
      const info = viaInfo(target, snapshot)
      const parts = []
      if (info.hops !== null && info.hops > 1) parts.push(info.hops + pick(" 跳", " hops"))
      if (info.peers !== null) parts.push(pick("该机中转 ", "relays ") + info.peers + pick(" 台设备", " devices"))
      if (hint !== undefined) parts.push(hint)
      return h("div", {
        key: "relay-notice",
        "data-bridge-field": "relay-notice",
        style: { marginTop: "6px" },
      },
        relayTag(pick("中转 ", "relay via ") + info.name, "via"),
        parts.length === 0 ? null : h("span", {
          key: "detail",
          style: { marginLeft: "6px", fontSize: "12px", lineHeight: "18px", color: C.muted },
        }, parts.join(" · ")))
    }

    function kvRow(key, label, value) {
      return h("div", { key: key, style: { display: "flex", gap: "12px", fontSize: "13px", lineHeight: "22px" } },
        h("span", { key: "l", style: { color: C.muted, flex: "0 0 auto", minWidth: "76px" } }, label),
        h("span", { key: "v", style: { flex: "1 1 auto", color: C.text, wordBreak: "break-all" } }, value))
    }

    function checkboxRow(key, label, checked, onChange, disabled, field) {
      return h("label", {
        key: key,
        style: {
          display: "flex", alignItems: "center", gap: ROW_GAP + "px",
          fontSize: "13px", lineHeight: "20px",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
        },
      },
        h("input", {
          type: "checkbox",
          checked: checked === true,
          disabled: disabled === true,
          "data-bridge-field": field === undefined ? key : field,
          onChange: function (event) { onChange(event && event.target ? event.target.checked === true : false) },
          style: { margin: 0, accentColor: C.accent, cursor: "inherit" },
        }),
        h("span", null, label))
    }

    // One grant editor shared by the approval card and the per-peer editor.
    function grantEditor(spec) {
      const s = isObj(spec) ? spec : {}
      const busy = s.busy === true
      const rows = []
      rows.push(h("div", { key: "roots-label", style: { fontSize: "12px", lineHeight: "16px", color: C.muted, margin: "2px 0 6px" } },
        pick("允许的根目录（每行一个）", "Allowed roots (one per line)")))
      rows.push(h("textarea", sx({
        key: "roots",
        value: asStr(s.rootsText, ""),
        spellCheck: false,
        rows: 3,
        disabled: busy,
        "data-bridge-field": "roots",
        placeholder: pick("例如 H:\\mod", "for example /home/me/project"),
        onChange: function (event) { s.onPatch({ rootsText: event && event.target ? asStr(event.target.value, "") : "" }) },
        style: inputStyle({
          width: "100%", height: "auto", padding: "6px 8px", lineHeight: "20px",
          resize: "vertical", fontFamily: C.mono,
        }),
      }, inputRingProps())))
      rows.push(h("div", { key: "flags", style: { display: "flex", gap: "16px", flexWrap: "wrap", margin: "10px 0 2px" } },
        checkboxRow("write", pick("允许写入", "Allow writes"), s.write, function (v) { s.onPatch({ write: v }) }, busy),
        checkboxRow("shell", pick("允许执行 Shell", "Allow shell execution"), s.shell, function (v) { s.onPatch({ shell: v }) }, busy)))
      // 允许中转 is what lets THIS peer be used as a stepping stone to the
      // devices behind it, so it is a separate, explicit decision — and the
      // optional allowlist narrows which of those devices may be reached.
      rows.push(h("div", { key: "relay", style: cardStyle({ padding: "8px 10px", marginTop: "10px" }) },
        h("div", { key: "t", style: { display: "flex", alignItems: "center", gap: ROW_GAP + "px" } },
          h("span", { key: "a", "data-bridge-chip": "relay", style: tagStyle(undefined) }, pick("中转", "Relay")),
          h("span", { key: "b", style: { flex: "1 1 auto", minWidth: 0, fontSize: "12px", lineHeight: "18px", color: C.muted } },
            pick("允许本设备经此机器继续中转", "Allow relaying beyond this peer")),
          checkboxRow("relay", pick("允许中转", "Allow relay"), s.relay, function (v) { s.onPatch({ relay: v }) }, busy, "relay")),
        s.relay === false ? null : h("div", { key: "peers", style: { marginTop: "8px" } },
          h("div", { key: "l", style: { fontSize: "12px", lineHeight: "16px", color: C.muted, marginBottom: "4px" } },
            pick("只允许中转给这些设备（每行一个设备 ID，留空 = 全部允许）",
              "Relay only to these devices (one device id per line; empty = all allowed)")),
          h("textarea", sx({
            key: "list",
            value: asStr(s.relayPeersText, ""),
            spellCheck: false,
            rows: 2,
            disabled: busy,
            "data-bridge-field": "relayPeers",
            placeholder: pick("例如 dev-linux-9c4412", "for example dev-linux-9c4412"),
            onChange: function (event) { s.onPatch({ relayPeersText: event && event.target ? asStr(event.target.value, "") : "" }) },
            style: inputStyle({
              width: "100%", height: "auto", padding: "6px 8px", lineHeight: "20px",
              resize: "vertical", fontFamily: C.mono,
            }),
          }, inputRingProps())))))
      rows.push(h("div", { key: "limits", style: { display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "10px" } },
        h("label", { key: "t", style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", lineHeight: "18px", color: C.muted } },
          pick("超时(ms)", "Timeout (ms)"),
          h("input", sx({
            type: "number", min: 1000, step: 1000,
            value: numText(s.timeoutMs, 30000), disabled: busy,
            "data-bridge-field": "timeoutMs",
            onChange: function (event) { s.onPatch({ timeoutMs: event && event.target ? event.target.value : "" }) },
            style: inputStyle({ width: "92px" }),
          }, inputRingProps()))),
        h("label", { key: "o", style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", lineHeight: "18px", color: C.muted } },
          pick("输出上限(字节)", "Output cap (bytes)"),
          h("input", sx({
            type: "number", min: 1024, step: 1024,
            value: numText(s.maxOutputBytes, 262144), disabled: busy,
            "data-bridge-field": "maxOutputBytes",
            onChange: function (event) { s.onPatch({ maxOutputBytes: event && event.target ? event.target.value : "" }) },
            style: inputStyle({ width: "104px" }),
          }, inputRingProps())))))
      if (s.showRemember === true) {
        rows.push(h("div", { key: "remember", style: { marginTop: "10px" } },
          checkboxRow("remember", pick("记住此设备", "Remember this device"), s.remember, function (v) { s.onPatch({ remember: v }) }, busy)))
      }
      return rows
    }

    /** One line-per-entry list out of a textarea, trimmed and de-duplicated. */
    function linesOf(text) {
      return asStr(text, "")
        .split(/\r?\n/)
        .map(function (line) { return line.trim() })
        .filter(Boolean)
        .filter(function (value, index, all) { return all.indexOf(value) === index })
    }

    function grantFromDraft(draft) {
      return {
        roots: linesOf(draft && draft.rootsText),
        write: !!(draft && draft.write === true),
        shell: !!(draft && draft.shell === true),
        relay: !(draft && draft.relay === false),
        relayPeers: linesOf(draft && draft.relayPeersText),
        timeoutMs: Math.max(1000, Math.round(asNum(draft && draft.timeoutMs, 30000))),
        maxOutputBytes: Math.max(1024, Math.round(asNum(draft && draft.maxOutputBytes, 262144))),
      }
    }

    function draftFromGrant(id, grant, remember) {
      const g = grantOf(grant)
      return {
        forId: id,
        rootsText: g.roots.join("\n"),
        write: g.write,
        shell: g.shell,
        relay: g.relay,
        relayPeersText: g.relayPeers.join("\n"),
        timeoutMs: String(g.timeoutMs),
        maxOutputBytes: String(g.maxOutputBytes),
        remember: remember === true,
      }
    }

    function useDraft(state, id, source, remember) {
      // `state` is a [value, setValue] pair from react.useState. The draft is
      // keyed by the id it was edited for, so a new request or a re-poll that
      // reorders peers still shows authored edits instead of a stale snapshot.
      const current = state[0]
      if (isObj(current) && current.forId === id) return current
      return draftFromGrant(id, source, remember)
    }

    function errorText(text) {
      if (!text) return null
      return h("div", {
        style: { color: C.danger, fontSize: "12px", lineHeight: "18px", margin: "6px 0 0", wordBreak: "break-word" },
      }, text)
    }

    /* ------------------------------------------------------------------ *
     * Sidebar footer control — one row, the peer of the 设置 trigger.
     * ------------------------------------------------------------------ */

    const FOOT_LABEL = {
      flex: "1 1 auto",
      minWidth: 0,
      color: C.text,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }

    function footerRowStyle(wide, hovered, extra) {
      return sx({
        display: "flex",
        alignItems: "center",
        justifyContent: wide ? "flex-start" : "center",
        gap: wide ? ROW_GAP + "px" : "0",
        position: wide ? "static" : "relative",
        boxSizing: "border-box",
        width: wide ? "100%" : ROW_H_RAIL + "px",
        minWidth: 0,
        height: (wide ? ROW_H : ROW_H_RAIL) + "px",
        flex: wide ? "1 1 auto" : "0 0 auto",
        padding: wide ? ROW_PAD : "0",
        border: "none",
        borderRadius: wide ? ROW_R + "px" : "50%",
        background: hovered ? C.hover : "transparent",
        color: C.text,
        font: "inherit",
        fontSize: ROW_FONT,
        lineHeight: ROW_LINE,
        textAlign: "left",
        cursor: "pointer",
        overflow: "hidden",
      }, extra)
    }

    // The status dot is trailing so the label starts at the same x as the 设置
    // label (8px padding + 16px icon + 8px gap); in the rail it rides the icon's
    // bottom-right corner and leaves the 18px glyph centred.
    function footerDot(dot, wide) {
      if (wide) {
        return h("span", {
          key: "dot",
          style: { display: "inline-flex", flex: "0 0 auto", marginLeft: "auto", paddingLeft: "6px", alignItems: "center" },
        }, statusDot(dot, DOT_SIZE))
      }
      return h("span", {
        key: "dot",
        style: { position: "absolute", right: "5px", bottom: "5px", display: "inline-flex", lineHeight: 0 },
      }, statusDot(dot, DOT_RAIL))
    }

    // Both rows below are plain builders: the one hook lives in BridgeFooter, so
    // the degraded path cannot change the hook order.
    function footerRow(props, onClick, hovered) {
      const p = isObj(props) ? props : {}
      const wide = p.wide !== false
      return h("button", sx({
        type: "button",
        title: p.title,
        "aria-label": p.label,
        "aria-expanded": p.expanded,
        "data-bridge-footer": p.dot,
        onClick: onClick,
        style: footerRowStyle(wide, hovered === true, p.style),
      }, hoverProps(p, false)),
        bridgeGlyph(wide ? ICON : ICON_RAIL, C.muted),
        wide ? h("span", { key: "label", style: FOOT_LABEL }, p.label) : null,
        footerDot(p.dot, wide))
    }

    function BridgeFooter(props) {
      const hover = useHoverFill()
      let store = null
      let hookError = null
      try { store = useBridgeStore() } catch (err) { hookError = err }
      const wide = !(props && props.wide === false)
      if (hookError !== null || store === null) {
        const label = pick("桥接", "Bridge")
        return footerRow({
          wide: wide,
          dot: "error",
          label: label,
          title: label + (hookError ? " · " + msgOf(hookError) : ""),
          on: hover.on,
          off: hover.off,
        }, function () { safe(function () { getStore().toggle() }, undefined) }, hover.active)
      }
      try {
        const state = store.read()
        const dot = dotState(state.snapshot, state.error)
        const text = footerText(state.snapshot, dot)
        const title = text + (state.open ? pick("（点击收起面板）", " (click to close the panel)") : pick("（点击展开面板）", " (click to open the panel)"))
        return footerRow({
          wide: wide,
          dot: dot,
          label: text,
          title: title,
          expanded: state.open === true,
          on: hover.on,
          off: hover.off,
        }, function () { safe(function () { store.toggle() }, undefined) }, hover.active)
      } catch (err) {
        const label = pick("桥接", "Bridge")
        return footerRow({
          wide: wide,
          dot: "error",
          label: label,
          title: label + " · " + msgOf(err),
          on: hover.on,
          off: hover.off,
        }, function () { safe(function () { getStore().toggle() }, undefined) }, hover.active)
      }
    }

    /* ------------------------------------------------------------------ *
     * Panel.
     * ------------------------------------------------------------------ */

    function metaText(value) {
      return h("div", { key: "meta", style: { fontSize: "12px", lineHeight: "18px", color: C.muted, marginTop: "4px", wordBreak: "break-all" } }, value)
    }

    /**
     * Identity: the posture of THIS machine.
     *
     * `both` is gone — every role is both — so this is two options and a
     * discoverability toggle, not a capability switch. `accepts` is the fact
     * that decides whether any peer can reach this machine at all
     * (`accepts = listener !== null && discoverable`), and on the Agent side it
     * is false until a pairing window is opened, which is why the notice below
     * carries the 开启配对窗口 button instead of merely reporting the state.
     */
    function renderIdentitySection(store, state, snapshot) {
      const busy = state.busy === true
      const role = normalizeRole(snapshot && snapshot.role)
      const discoverable = snapshot ? snapshot.discoverable === true : false
      // R203: `discoverable` is now the CLAIM the host can support with a recorded egress, and
      // `discoverableRequested` is what the user asked for. The TOGGLE must follow the request — a machine
      // that asked to announce and recorded no working egress is requested:true / discoverable:false, and a
      // toggle wired to the claim could never be turned off again. A host older than this panel sends no
      // request field, so the claim is the only fact it has and the toggle falls back to it.
      const discoverRequested = isObj(snapshot) && typeof snapshot.discoverableRequested === "boolean"
        ? snapshot.discoverableRequested
        : discoverable
      // `accepts` may be ABSENT entirely on a host older than this panel. A
      // missing field is not a false one: claiming "not accepting" from it
      // would invent a fact about a machine we simply have no report from.
      const acceptsKnown = isObj(snapshot) && typeof snapshot.accepts === "boolean"
      const accepts = acceptsKnown && snapshot.accepts === true
      const acceptsText = acceptsKnown
        ? (accepts
          ? pick("正在监听，可以接收连接", "Listening; connections are accepted")
          : pick("没有在监听，不接收连接", "Not listening; connections are refused"))
        : pick("旧版主机未报告是否接收连接", "The older host does not report whether it accepts connections")
      const rows = []
      rows.push(sectionTitle(pick("身份", "Identity")))
      rows.push(h("div", { key: "identity", style: cardStyle({ padding: "10px 12px" }) },
        h("div", { key: "top", style: { display: "flex", alignItems: "center", gap: ROW_GAP + "px", flexWrap: "wrap" } },
          h("div", { key: "role", style: { flex: "1 1 auto", minWidth: "120px" } }, renderRoleSwitch(store, role, busy)),
          h("div", { key: "discover", style: { display: "flex", alignItems: "center", gap: "6px" } },
            h("span", { key: "l", style: { fontSize: "12px", lineHeight: "18px", color: C.muted } }, pick("可被发现", "Discoverable")),
            button("toggle-discover", discoverRequested ? pick("已开启", "On") : pick("已关闭", "Off"), function () {
              void run(store, "discover.set", { enabled: discoverRequested !== true },
                { notice: discoverRequested ? pick("已停止广播", "Broadcast stopped") : pick("已开始广播", "Broadcasting") })
            }, { kind: discoverRequested ? "plain" : "primary", disabled: busy }))),
        h("div", { key: "accepts", style: { display: "flex", alignItems: "center", gap: ROW_GAP + "px", marginTop: "8px" } },
          statusDot(accepts ? "connected" : "busy", DOT_RAIL),
          h("span", {
            key: "t",
            "data-bridge-field": "accepts",
            style: { flex: "1 1 auto", fontSize: "12px", lineHeight: "18px", color: C.muted },
          }, acceptsText)),
        // `accepts` (listening) and `discoverable` (announcing) are INDEPENDENT
        // facts and are never inferred from one another: a machine can be
        // discoverable:false / accepts:true — reachable at an address someone
        // handed out, simply not advertising itself. Each state gets its own
        // sentence so neither can be misread as the other.
        h("div", { key: "discover-state", style: { display: "flex", alignItems: "center", gap: ROW_GAP + "px", marginTop: "4px" } },
          statusDot(discoverable ? "connected" : "idle", DOT_RAIL),
          h("span", {
            key: "t",
            "data-bridge-field": "discoverable",
            style: { flex: "1 1 auto", fontSize: "12px", lineHeight: "18px", color: C.muted },
          }, discoverable
            ? pick("正在广播本机，对端可自动发现", "Announcing this machine; peers can find it automatically")
            : pick("未广播本机；已知本机地址的对端仍可连接", "Not announcing; a peer that knows this address can still connect"))),
        accepts ? null : h("div", {
          key: "accepts-note",
          style: { marginTop: "8px", borderTop: "1px solid " + C.border, paddingTop: "8px" },
        },
          h("div", { key: "why", style: { fontSize: "12px", lineHeight: "18px", color: C.muted } },
            acceptsKnown === false
              ? pick("无法确认本机是否在监听（旧版主机未报告）；开启配对窗口可以确保对端连得上。",
                "Cannot tell whether this machine is listening (the older host does not report it); opening a pairing window makes sure a peer can connect.")
              : role === "agent"
                ? pick("Agent 侧默认不监听：开启配对窗口后本机才开始接收连接。「可被发现」只决定是否广播，不影响能否连上。",
                  "An Agent-side machine does not listen by default: open a pairing window to start accepting connections. “Discoverable” only decides whether this machine announces itself — it does not change whether a peer can connect.")
                : pick("当前没有在监听，也没有可用的配对窗口；开启一个窗口即可重新接收连接。",
                  "This machine is not listening and has no open pairing window; open one to accept connections again.")),
          h("div", { key: "open", style: { display: "flex", gap: "8px", marginTop: "8px" } },
            button("open-pairing-window", pick("开启配对窗口", "Open pairing window"), function () {
              void run(store, "pair.open", {}, { notice: pick("已开启配对窗口", "Pairing window opened") })
            }, { kind: "primary", disabled: busy })))))
      return rows
    }

    /**
     * The old host, said out loud.
     *
     * Nothing here is a warning about something the user did: the panel came
     * from disk and the host came from process start, so during development they
     * routinely disagree. The one useful action is restarting DSH, and the one
     * useless outcome is an empty list with no explanation — so this is a plain
     * notice plus the legacy view of whatever the old host still reports.
     */
    function renderLegacyNotice() {
      return h("div", {
        key: "legacy-notice",
        "data-bridge-field": "host-mismatch",
        style: cardStyle({ padding: "10px 12px", borderColor: C.warn, marginTop: "8px" }),
      },
        h("div", { key: "t", style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", lineHeight: "20px", fontWeight: 500 } },
          statusDot("busy", DOT_RAIL),
          h("span", null, pick("主机侧是旧版本", "The host half is an older build"))),
        h("div", { key: "b", style: { marginTop: "6px", fontSize: "12px", lineHeight: "18px", color: C.muted } },
          pick("浏览器面板是从磁盘读取的，主机代码在 DSH 启动时载入，所以两边版本可能不一致。请退出 DSH 再打开（退出 App 再打开）以载入新的主机代码；在那之前，本面板只能显示旧版主机提供的内容。",
            "The browser panel is read from disk while the host code is loaded when DSH starts, so the two can disagree. Quit DSH and open it again to load the new host code; until then this panel can only show what the older host provides.")),
        h("div", { key: "c", style: { marginTop: "6px", fontSize: "12px", lineHeight: "18px", color: C.muted } },
          pick("下方是旧版主机报告的内容（单个连接与已连接对端）。",
            "Below is what the older host reports (a single connection and its connected peers).")))
    }

    /**
     * The legacy single-connection card, for a new panel against an old host.
     *
     * This is the old panel's "当前连接" block, kept so the one connection the
     * old host knows about stays visible and disconnectable instead of the
     * panel simply going blank.
     */
    function renderLegacyConnection(store, state, snapshot) {
      const busy = state.busy === true
      const conn = legacyConnection(snapshot)
      const rows = []
      if (conn === null) return rows
      const peerName = asStr(conn.peerName, "") || shortId(conn.peerDeviceId) || pick("对端", "peer")
      const since = elapsedMs(conn.sinceMs)
      const meta = [
        stateTextOf(asStr(conn.state, "")),
        since === null ? "" : durationText(since),
        asNum(conn.rttMs, null) === null ? "" : "RTT " + Math.round(asNum(conn.rttMs, 0)) + "ms",
      ].filter(Boolean).join(" · ")
      rows.push(h("div", {
        key: "legacy-conn",
        "data-bridge-legacy": "connection",
        style: cardStyle({ padding: "10px 12px", marginBottom: "6px" }),
      },
        h("div", { key: "top", style: { display: "flex", alignItems: "center", gap: ROW_GAP + "px", flexWrap: "wrap" } },
          h("div", { key: "i", style: { flex: "1 1 auto", minWidth: 0 } },
            h("div", { key: "n", style: { fontSize: "14px", lineHeight: "22px", fontWeight: 500, wordBreak: "break-word" } }, peerName),
            metaText(meta)),
          button("disconnect", pick("断开", "Disconnect"), function () {
            void run(store, "disconnect", {}, { notice: pick("已断开连接", "Disconnected") })
          }, { kind: "danger", disabled: busy })),
        conn.peerDeviceId ? metaText(shortId(conn.peerDeviceId)) : null,
        errorText(asStr(conn.error, ""))))
      return rows
    }

    /**
     * The legacy inbound list, for a new panel against an old host.
     *
     * Same purpose as `renderLegacyConnection`: the old host's `peersConnected`
     * alias still carries the devices driving this machine, with their grants —
     * so grant editing and revoke keep working while the host is stale.
     */
    function renderLegacySessions(store, state, snapshot, ui) {
      const busy = state.busy === true
      const sessions = legacySessions(snapshot)
      const rows = []
      for (let i = 0; i < sessions.length; i++) {
        const peer = sessions[i]
        const id = asStr(peer.deviceId, "")
        const name = asStr(peer.name, "") || shortId(id) || pick("未知设备", "unknown device")
        const rowKey = id || ("l#" + i)
        const since = elapsedMs(peer.sinceMs)
        const editing = asStr(ui.sessionEditFor, "") === rowKey
        rows.push(h("div", {
          key: "legacy-session-" + rowKey,
          "data-bridge-legacy": "session",
          "data-bridge-session": id,
          style: cardStyle({ padding: "10px 12px", marginBottom: "6px" }),
        },
          h("div", { key: "top", style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
            h("span", { key: "name", style: { fontSize: "14px", lineHeight: "22px", fontWeight: 500, flex: "1 1 auto", minWidth: "90px", wordBreak: "break-word" } }, name),
            chip(pick("对方驱动本机", "driving this machine"), "dir", undefined)),
          metaText(since === null ? "" : pick("已连接 ", "connected ") + durationText(since)),
          metaText(pick("已授予本机 ", "granted here ") + grantSummary(peer.grant)),
          editing ? h("div", { key: "editor", style: { marginTop: "10px", borderTop: "1px solid " + C.border, paddingTop: "10px" } },
            deviceGrantEditor(ui, ui.sessionDraftState, rowKey, peer.grant, busy),
            h("div", { key: "save", style: { display: "flex", gap: "8px", marginTop: "10px" } },
              button("session-save", pick("保存授权", "Save grant"), function () {
                const pair = ui.sessionDraftState[0]
                const draft = isObj(pair) && pair.forId === rowKey
                  ? pair
                  : draftFromGrant(rowKey, peer.grant, false)
                const grant = grantFromDraft(draft)
                if (grant.roots.length === 0) {
                  store.setError(pick("至少填写一个允许的根目录", "Provide at least one allowed root"))
                  return
                }
                void run(store, "grant.set", { deviceId: id, grant: grant }, { notice: pick("授权已更新", "Grant updated") })
              }, { kind: "primary", disabled: busy }),
              button("session-cancel", pick("取消", "Cancel"), function () { ui.setSessionEditFor("") }, { disabled: busy }))) : null,
          h("div", { key: "actions", style: { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" } },
            button("session-edit", editing ? pick("收起", "Collapse") : pick("授权…", "Grant…"), function () {
              ui.setSessionEditFor(editing ? "" : rowKey)
            }, { disabled: busy }),
            editing ? null : button("session-revoke", pick("撤销授权", "Revoke grant"), function () {
              void run(store, "grant.revoke", { deviceId: id }, { notice: pick("已撤销授权", "Grant revoked") })
            }, { kind: "danger", disabled: busy }),
            editing ? null : button("session-disconnect", pick("断开", "Disconnect"), function () {
              void run(store, "peers.disconnect", { deviceId: id }, { notice: pick("已断开 ", "Disconnected ") + name })
            }, { disabled: busy }))))
      }
      return rows
    }

    /**
     * The pairing section is shared by BOTH roles.
     *
     * The bridge side must be able to display, issue and re-issue a code (codes
     * are single-use, and a fresh start opens no window at all), while the agent
     * side must be able to type the code the peer shows. Keeping this inside one
     * role section made the other role unable to ever pair, so it is its own
     * section rendered unconditionally.
     */
    function renderPairingSection(store, state, snapshot, ui) {
      const busy = state.busy === true
      const rows = []
      const pairing = isObj(snapshot && snapshot.pairing) ? snapshot.pairing : null
      const code = pairing === null ? "" : asStr(pairing.code, "")
      const role = normalizeRole(snapshot && snapshot.role)
      const accepts = snapshot !== null && snapshot !== undefined && snapshot.accepts === true
      // The host sends `expiresAtMs`; `expiresInMs` is accepted as well.
      const expiresIn = pairing === null
        ? null
        : (asNum(pairing.expiresInMs, null) !== null
          ? remainingMs(pairing.expiresInMs)
          : remainingMs(pairing.expiresAtMs))
      // Either role may own a window: opening one in Agent 侧 is exactly what
      // `openPairingWindow` turns into a listener, which is the only way an
      // Agent-side machine becomes connectable. A machine that is NOT accepting
      // gets its 开启配对窗口 affordance from the identity section instead, so
      // this button carries the code-specific wording and the two never say the
      // same thing twice.
      const header = button("pair-open", code === ""
        ? (accepts ? pick("生成配对码", "Issue a pairing code") : pick("开启配对窗口", "Open pairing window"))
        : pick("刷新配对码", "New pairing code"), function () {
        void run(store, "pair.open", {}, {
          notice: code === ""
            ? pick("已开启配对窗口", "Pairing window opened")
            : pick("已生成新的配对码", "New pairing code issued"),
        })
      }, { kind: code === "" ? "primary" : "plain", disabled: busy })
      /**
       * A code can only be submitted INTO a connection attempt that is already in
       * flight, and the attempt is started from the device list.
       *
       * The button used to be enabled always, so a user who read the code box
       * first — which is what the layout invited, since the list was below it —
       * typed a code, pressed 提交, and got a host error telling them to pick a
       * device. That is the panel's fault, not theirs: an enabled control that
       * cannot possibly succeed is a lie. It is now disabled with the reason and
       * the next step printed underneath it.
       */
      const pendingLink = (Array.isArray(snapshot && snapshot.links) ? snapshot.links : [])
        .find(function (link) { return isObj(link) && link.state !== "connected" })
      // R320c: a MANUAL connect that only lacked the code is also an attempt in flight - the service remembers where
      // the code has to go and says so in `awaitingCode`. Without this the panel kept its own submit button
      // DISABLED right after the manual connect asked for a code (measured against the real phone: "submit-disabled"),
      // which made the two-step flow impossible from the UI even though the service could finish it.
      const awaiting = isObj(snapshot && snapshot.awaitingCode) ? snapshot.awaitingCode : null
      const awaitingLabel = awaiting === null ? "" : asStr(awaiting.host, "") + ":" + String(asNum(awaiting.port, 0))
      const pendingName = pendingLink === undefined ? awaitingLabel : asStr(pendingLink.name, "")
      rows.push(sectionTitle(pick("配对码", "Pairing code"), header))
      rows.push(h("div", {
        key: "pairing",
        style: cardStyle({ padding: "12px", textAlign: "center" }),
      },
        code
          ? h("div", {
            key: "code",
            style: {
              fontSize: "24px", lineHeight: "32px", fontWeight: 600, letterSpacing: "0.28em",
              fontFamily: C.mono,
              color: C.text, margin: "2px 0 6px",
            },
          }, code)
          : null,
        h("div", { key: "meta", style: { fontSize: "12px", lineHeight: "18px", color: C.muted } },
          [
            roleLabel(role),
            pairing && pairing.role ? pick("角色：", "role: ") + asStr(pairing.role, "") : "",
            pairing === null || asNum(pairing.attemptsLeft, null) === null ? "" : pick("剩余尝试 ", "attempts left ") + asNum(pairing.attemptsLeft, 0),
            expiresIn === null ? "" : pick("有效期 ", "expires in ") + durationText(expiresIn),
          ].filter(Boolean).join(" · ")),
        // A machine that can connect out uses this to type the peer's code.
        // It is shown for every role: the role switch lives in this same panel,
        // so hiding it the moment the user picks 桥接侧 would make the control
        // disappear while they are still looking at it.
        h("div", { key: "submit", style: { display: "flex", gap: "8px", marginTop: "10px" } },
          h("input", sx({
            key: "input",
            type: "text",
            inputMode: "numeric",
            maxLength: 6,
            value: asStr(ui.pairCode, ""),
            disabled: busy,
            placeholder: "000000",
            "aria-label": pick("6 位配对码", "6-digit pairing code"),
            "data-bridge-field": "pair-code",
            onChange: function (event) {
              const raw = event && event.target ? asStr(event.target.value, "") : ""
              ui.setPairCode(raw.replace(/[^0-9]/g, "").slice(0, 6))
            },
            style: inputStyle({
              flex: "1 1 auto", textAlign: "center", letterSpacing: "0.3em",
              fontFamily: C.mono,
            }),
          }, inputRingProps())),
          button("pair-submit", pick("提交配对码", "Submit code"), function () {
            const value = asStr(ui.pairCode, "").trim()
            if (/^\d{6}$/.test(value) === false) {
              store.setError(pick("请输入 6 位数字配对码", "Enter the 6-digit pairing code"))
              return
            }
            void run(store, "pair.submit", { code: value }, { notice: pick("已提交配对码", "Pairing code submitted") })
          }, { kind: "primary", disabled: busy || (pendingLink === undefined && awaiting === null) }))),
        h("div", { key: "hint", style: { fontSize: "12px", lineHeight: "18px", color: C.muted, marginTop: "8px", textAlign: "left" } },
          pendingLink === undefined && awaiting === null
            ? pick("先在下方「设备」列表里点某台设备的「连接」——配对码要提交给一次正在进行中的连接，没有连接时这个按钮不起作用。",
              "Start from the 设备 list below: click 连接 on a device first. A pairing code is submitted into a connection attempt that is already in flight, so this button does nothing until one exists.")
            : pick("正在连接 " + pendingName + "：填入它显示的 6 位配对码。",
              "Connecting to " + pendingName + ": enter the 6 digits it shows.")))
      return rows
    }

    /**
     * One grant editor, wired to a draft keyed by the device it was edited for.
     *
     * `draftState` is a `[value, setValue]` pair owned by BridgePanel; the draft
     * is re-seeded whenever the key changes, so a re-poll or a reorder never
     * throws away what the user just typed.
     */
    function deviceGrantEditor(ui, draftState, key, source, busy) {
      const draft = useDraft(draftState, key, source, false)
      return grantEditor({
        rootsText: draft.rootsText,
        write: draft.write,
        shell: draft.shell,
        relay: draft.relay,
        relayPeersText: draft.relayPeersText,
        timeoutMs: draft.timeoutMs,
        maxOutputBytes: draft.maxOutputBytes,
        showRemember: false,
        busy: busy,
        onPatch: function (part) {
          const pair = draftState[1]
          if (typeof pair !== "function") return
          // Rebase onto the draft as it stands NOW, not onto the one this
          // closure captured: two controls patched in the same tick would
          // otherwise each write a copy of the same old object and the second
          // one would silently undo the first.
          const current = draftState[0]
          const base = isObj(current) && current.forId === key ? current : draft
          pair(sx(base, part, { forId: key }))
        },
      })
    }

    /**
     * The per-request grant editor inside the toast.
     *
     * Same rows as the panel's device editor (roots, write, shell, 允许中转 and
     * its allowlist) because it is literally the same builder — only the
     * remember checkbox is left out, since a request answered from a
     * notification is always remembered.
     */
    function toastGrantEditor(draft, patch, busy) {
      return grantEditor({
        rootsText: draft.rootsText,
        write: draft.write,
        shell: draft.shell,
        relay: draft.relay,
        relayPeersText: draft.relayPeersText,
        timeoutMs: draft.timeoutMs,
        maxOutputBytes: draft.maxOutputBytes,
        showRemember: false,
        busy: busy,
        onPatch: patch,
      })
    }

    /** Why a row offers nothing to click, phrased the way the contract states it. */
    function acceptsRefusal(peer) {
      const role = asStr(peer && peer.role, "unknown")
      const side = role === "bridge"
        ? pick("桥接侧", "Bridge side")
        : role === "agent" ? pick("Agent 侧", "Agent side") : pick("未知角色", "Unknown role")
      return side + pick(" · 未开启配对窗口", " · no pairing window open")
    }

    /** One outbound link: a device THIS machine drives. */
    function renderLinkRow(store, snapshot, busy, ui, link, index) {
      const id = asStr(link.deviceId, "")
      const name = asStr(link.name, "") || shortId(id) || pick("未知设备", "unknown device")
      const rowKey = id || ("#" + index)
      const state = asStr(link.state, "") || "closed"
      const connected = state === "connected"
      const host = asStr(link.host, "")
      const port = asNum(link.port, null)
      const address = host === "" ? "" : host + (port === null ? "" : ":" + port)
      const platform = platformOf(link, peerIndex(snapshot))
      const sas = asStr(link.sas, "")
      const since = connected ? elapsedMs(link.sinceMs) : null
      const proto = asStr(link.protocolVersion, "")
      const trust = asStr(link.trust, "")
      const editing = asStr(ui.grantEditFor, "") === rowKey
      const devices = asArray(link.devices).filter(isObj)
      const reconnect = isObj(link.reconnect) ? link.reconnect : null
      const attempts = reconnect === null ? 0 : Math.round(asNum(reconnect.attempts, 0))
      const rows = []
      rows.push(h("div", {
        key: "line-0",
        style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
      },
        h("span", {
          key: "name",
          "data-bridge-field": "link-name",
          style: { fontSize: "14px", lineHeight: "22px", fontWeight: 500, flex: "1 1 auto", minWidth: "90px", wordBreak: "break-word" },
        }, name),
        stateChip(state),
        link.relaySupported === true ? relayTag(pick("可中转", "relay-capable"), "relay-capable") : null))
      if (address !== "") rows.push(metaText(address))
      rows.push(metaText([
        platform,
        proto ? pick("协议 ", "protocol ") + proto : "",
        since === null ? "" : pick("已连接 ", "connected ") + durationText(since),
        devices.length === 0 ? "" : pick("可见设备 ", "devices ") + devices.length,
      ].filter(Boolean).join(" · ")))
      if (sas !== "") {
        rows.push(h("div", { key: "sas", style: { marginTop: "4px", fontSize: "12px", lineHeight: "18px" } },
          h("span", { key: "l", style: { color: C.muted } }, pick("安全码 ", "safety code ")),
          h("span", {
            key: "v",
            "data-bridge-field": "link-sas",
            style: { fontFamily: C.mono, fontWeight: 600, letterSpacing: "0.18em" },
          }, sas)))
      }
      rows.push(metaText([
        grantSummary(link.grant),
        trust === "" ? "" : pick("信任 ", "trust ") + trust,
      ].filter(Boolean).join(" · ")))
      if (attempts > 0 && connected !== true) {
        rows.push(metaText(pick("重连尝试 ", "reconnect attempts ") + attempts))
      }
      rows.push(errorText(asStr(link.error, "")))
      if (editing) {
        rows.push(h("div", { key: "editor", style: { marginTop: "10px", borderTop: "1px solid " + C.border, paddingTop: "10px" } },
          deviceGrantEditor(ui, ui.linkDraftState, rowKey, link.grant, busy),
          h("div", { key: "save", style: { display: "flex", gap: "8px", marginTop: "10px" } },
            button("link-save", pick("保存授权", "Save grant"), function () {
              const pair = ui.linkDraftState[0]
              const draft = isObj(pair) && pair.forId === rowKey
                ? pair
                : draftFromGrant(rowKey, link.grant, false)
              const grant = grantFromDraft(draft)
              if (grant.roots.length === 0) {
                store.setError(pick("至少填写一个允许的根目录", "Provide at least one allowed root"))
                return
              }
              void run(store, "grant.set", { deviceId: id, grant: grant }, { notice: pick("授权已更新", "Grant updated") })
            }, { kind: "primary", disabled: busy }),
            button("link-cancel", pick("取消", "Cancel"), function () { ui.setGrantEditFor("") }, { disabled: busy }))))
      }
      rows.push(h("div", { key: "actions", style: { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" } },
        button("link-edit", editing ? pick("收起", "Collapse") : pick("授权…", "Grant…"), function () {
          ui.setGrantEditFor(editing ? "" : rowKey)
        }, { disabled: busy }),
        editing ? null : button("link-disconnect", pick("断开", "Disconnect"), function () {
          void run(store, "disconnect", { deviceId: id }, { notice: pick("已断开 ", "Disconnected ") + name })
        }, { kind: "danger", disabled: busy })))
      return h("div", {
        key: "link-" + rowKey,
        id: "dsh-lan-bridge-link-" + rowKey,
        "data-bridge-link": id,
        "data-bridge-link-state": state,
        style: cardStyle({ padding: "10px 12px", marginBottom: "6px" }),
      }, rows)
    }

    /** Devices THIS machine drives — one row each, never just the first. */
    function renderLinksSection(store, state, snapshot, ui) {
      const busy = state.busy === true
      const links = asArray(snapshot && snapshot.links).filter(isObj)
      const rows = [sectionTitle(
        pick("本机驱动的设备", "Devices this machine drives"),
        button("disconnect-all", pick("全部断开", "Disconnect all"), function () {
          void run(store, "disconnect", {}, { notice: pick("已断开全部连接", "All links closed") })
        }, { kind: "danger", disabled: busy || links.length === 0, title: pick("断开本机发起的全部连接", "Close every outbound link") }))]
      if (links.length === 0) {
        rows.push(h("div", { key: "empty", style: { fontSize: "13px", lineHeight: "20px", color: C.muted } },
          pick("当前没有本机发起的连接。在下方「可连接的设备」中选择一台开始。",
            "No outbound link is open. Pick a device under “Devices you can connect to” below.")))
      } else {
        for (let i = 0; i < links.length; i++) rows.push(renderLinkRow(store, snapshot, busy, ui, links[i], i))
      }
      return rows
    }

    /** Devices driving THIS machine: inbound sessions, one row each. */
    function renderSessionsSection(store, state, snapshot, ui) {
      const busy = state.busy === true
      const sessions = asArray(snapshot && snapshot.sessions).filter(isObj)
      const rows = [sectionTitle(pick("正在驱动本机的设备", "Devices driving this machine"))]
      if (sessions.length === 0) {
        rows.push(h("div", { key: "empty", style: { fontSize: "13px", lineHeight: "20px", color: C.muted } },
          pick("当前没有对端连接。", "No peer is connected.")))
      }
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i]
        const id = asStr(session.deviceId, "")
        const name = asStr(session.name, "") || shortId(id) || pick("未知设备", "unknown device")
        const rowKey = id || ("s#" + i)
        const since = elapsedMs(session.sinceMs)
        const sas = asStr(session.sas, "")
        const exposes = asArray(session.exposes).filter(isObj)
        const editing = asStr(ui.sessionEditFor, "") === rowKey
        // Where the peer connects FROM: the bridge side has the inbound socket,
        // and "something is driving this machine" without "from where" is not
        // enough to act on. `null` when the socket has no remote.
        const remoteHost = asStr(session.host, "")
        const remotePort = asNum(session.port, null)
        const remote = remoteHost === "" ? "" : remoteHost + (remotePort === null ? "" : ":" + remotePort)
        const body = [
          metaText([
            remote,
            platformOf(session, peerIndex(snapshot)),
            since === null ? "" : pick("已连接 ", "connected ") + durationText(since),
            exposes.length === 0 ? "" : pick("对外暴露 ", "exposes ") + exposes.length,
          ].filter(Boolean).join(" · ")),
        ]
        if (sas !== "") {
          body.push(h("div", { key: "sas", style: { marginTop: "4px", fontSize: "12px", lineHeight: "18px" } },
            h("span", { key: "l", style: { color: C.muted } }, pick("安全码 ", "safety code ")),
            h("span", {
              key: "v",
              "data-bridge-field": "session-sas",
              style: { fontFamily: C.mono, fontWeight: 600, letterSpacing: "0.18em" },
            }, sas)))
        }
        body.push(metaText(pick("已授予本机 ", "granted here ") + grantSummary(session.grant)))
        if (exposes.length > 0) {
          body.push(h("div", {
            key: "exposes",
            "data-bridge-field": "session-exposes",
            style: { marginTop: "6px", borderTop: "1px solid " + C.border, paddingTop: "6px" },
          }, exposes.map(function (target, index) {
            const key = asStr(target.key, "") || String(index)
            return h("div", {
              key: "expose-" + key,
              style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", fontSize: "12px", lineHeight: "18px", marginTop: index === 0 ? "0" : "4px" },
            },
              h("span", { key: "n", style: { flex: "1 1 auto", minWidth: 0, wordBreak: "break-all" } },
                asStr(target.name, "") || key),
              target.kind === "relay"
                ? relayTag(pick("中转 → ", "relay → ") + (relayViaLabel(snapshot, target) || pick("对端的中转", "peer relay")), "expose-via")
                : chip(pick("本机", "local"), "local", undefined),
              // `exposes[].path` names the machines a relayed expose goes
              // through, so the row can say which peer is carrying it instead of
              // a bare "peer relay".
              target.kind === "relay" && viaChainText(snapshot, target) !== ""
                ? h("span", { key: "hops", style: { color: C.muted } }, viaChainText(snapshot, target))
                : null)
          })))
        }
        if (editing) {
          body.push(h("div", { key: "editor", style: { marginTop: "10px", borderTop: "1px solid " + C.border, paddingTop: "10px" } },
            deviceGrantEditor(ui, ui.sessionDraftState, rowKey, session.grant, busy),
            h("div", { key: "save", style: { display: "flex", gap: "8px", marginTop: "10px" } },
              button("session-save", pick("保存授权", "Save grant"), function () {
                const pair = ui.sessionDraftState[0]
                const draft = isObj(pair) && pair.forId === rowKey
                  ? pair
                  : draftFromGrant(rowKey, session.grant, false)
                const grant = grantFromDraft(draft)
                if (grant.roots.length === 0) {
                  store.setError(pick("至少填写一个允许的根目录", "Provide at least one allowed root"))
                  return
                }
                void run(store, "grant.set", { deviceId: id, grant: grant }, { notice: pick("授权已更新", "Grant updated") })
              }, { kind: "primary", disabled: busy }),
              button("session-cancel", pick("取消", "Cancel"), function () { ui.setSessionEditFor("") }, { disabled: busy }))))
        }
        body.push(h("div", { key: "actions", style: { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" } },
          button("session-edit", editing ? pick("收起", "Collapse") : pick("授权…", "Grant…"), function () {
            ui.setSessionEditFor(editing ? "" : rowKey)
          }, { disabled: busy }),
          editing ? null : button("session-revoke", pick("撤销授权", "Revoke grant"), function () {
            void run(store, "grant.revoke", { deviceId: id }, { notice: pick("已撤销授权", "Grant revoked") })
          }, { kind: "danger", disabled: busy }),
          editing ? null : button("session-disconnect", pick("断开", "Disconnect"), function () {
            void run(store, "peers.disconnect", { deviceId: id }, { notice: pick("已断开 ", "Disconnected ") + name })
          }, { disabled: busy })))
        rows.push(h("div", {
          key: "session-" + rowKey,
          id: "dsh-lan-bridge-session-" + rowKey,
          "data-bridge-session": id,
          style: cardStyle({ padding: "10px 12px", marginBottom: "6px" }),
        },
          h("div", { key: "top", style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
            h("span", { key: "name", style: { fontSize: "14px", lineHeight: "22px", fontWeight: 500, flex: "1 1 auto", minWidth: "90px", wordBreak: "break-word" } }, name),
            chip(pick("对方驱动本机", "driving this machine"), "dir", undefined)),
          body))
      }
      return rows
    }

    /** The machine a relayed target's call goes through, when the host knows it. */
    function relayViaLabel(snapshot, target) {
      const via = viaInfo(target, snapshot)
      return via.name
    }

    /** A second relay label used only for the two-line description of a row. */
    function viaChainText(snapshot, target) {
      const via = viaInfo(target, snapshot)
      const seen = isObj(peerIndex(snapshot)[via.id]) ? peerIndex(snapshot)[via.id] : null
      return via.path.length > 1 ? pick("链路 ", "chain ") + via.path.length + pick(" 段", " legs") : ""
    }


    /* ------------------------------------------------------------------ *
     * The DEVICE NETWORK, as a board (R314).
     *
     * The complaint this answers is product-shaped: the panel had every fact about the device net - peers, links,
     * sessions, relay paths, grants - and drew them as sections of text, so a person opening it could not see the
     * SHAPE of the net: which machines this one talks to, which direction, which ones go through a relay and how many
     * hops. The sections stay exactly as they are (they are the control surface, and the gates read them); this is
     * the picture above them, and it is clickable.
     *
     * The fold invents nothing: a device appears once, merged across the rows that mention it, and each fact on the
     * card comes from the row that owns it (a session is inbound, a link is outbound, a relay target carries its
     * chain). A device the host merely knows about keeps the platform facts discovery gave it and nothing else.
     * ------------------------------------------------------------------ */
    function deviceNet(snapshot) {
      const sessions = asArray(snapshot && snapshot.sessions).filter(isObj)
      const links = asArray(snapshot && snapshot.links).filter(isObj)
      const targets = asArray(snapshot && snapshot.targets).filter(isObj)
      const index = peerIndex(snapshot)
      const byId = {}
      const order = []
      const touch = function (id, name) {
        if (id === "") return null
        if (byId[id] === undefined) {
          byId[id] = {
            id: id, name: "", platform: "", inbound: false, outbound: false, relay: false, known: false,
            grant: null, exposes: 0, callables: [], chain: "", address: "", remote: "",
          }
          order.push(id)
        }
        const node = byId[id]
        if (name !== "" && node.name === "") node.name = name
        return node
      }
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i]
        const node = touch(asStr(session.deviceId, ""), asStr(session.name, ""))
        if (node === null) continue
        node.inbound = true
        node.grant = session.grant
        const exposed = asArray(session.exposes).filter(isObj)
        node.exposes = exposed.length
        // R321: the card lists WHAT the device offers, not only how many: a number a person cannot act on is a
        // dashboard, and this board is meant to be operable.
        node.callables = exposed.map(function (target) {
          return { name: asStr(target.name, "") || asStr(target.key, ""), kind: asStr(target.kind, ""), hops: asNum(target.hops, null) }
        })
        const host = asStr(session.host, "")
        const port = asNum(session.port, null)
        if (host !== "") node.remote = host + (port === null ? "" : ":" + port)
      }
      for (let i = 0; i < links.length; i++) {
        const node = touch(asStr(links[i].deviceId, ""), asStr(links[i].name, ""))
        if (node === null) continue
        node.outbound = true
        const devices = asArray(links[i].devices).filter(isObj)
        // R325: the card must read the SAME grant the self test reads (`targets[].grant`, which comes from the peer own
        // answer to sys.info/grant), or the card says "no grant disclosed" while the test it sits next to uses the
        // roots happily - measured on the phone in R324.
        const own = devices.filter(function (device) { return asStr(device.deviceId, '') === asStr(links[i].deviceId, '') || asStr(device.key, '') === asStr(links[i].deviceId, '') })[0]
        node.grant = (own !== undefined && isObj(own.grant) ? own.grant : null) ?? (isObj(links[i].grant) ? links[i].grant : null)
        node.callables = devices.map(function (device) {
          return { name: asStr(device.name, "") || asStr(device.deviceId, ""), kind: asStr(device.kind, ""), hops: asNum(device.hops, null) }
        })
      }
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]
        const node = touch(asStr(target.deviceId, "") || asStr(target.key, ""), asStr(target.name, ""))
        if (node === null) continue
        if (asStr(target.kind, "") === "relay") {
          node.relay = true
          node.chain = viaChainText(snapshot, target)
        }
        const via = viaInfo(target, snapshot)
        if (node.address === "" && via.path.length > 1) node.address = via.path.join(" → ")
      }
      // Discovery rows are devices this machine can SEE but has no link to: they belong on the board as its own
      // kind, or the picture would show only the machines already in use and call that the network.
      const discovered = Object.keys(index)
      for (let i = 0; i < discovered.length; i++) {
        const peer = index[discovered[i]]
        const node = touch(discovered[i], asStr(peer && peer.name, ""))
        if (node !== null) node.known = true
      }
      for (let i = 0; i < order.length; i++) {
        const peer = isObj(index[order[i]]) ? index[order[i]] : null
        if (peer === null) continue
        byId[order[i]].known = true
        byId[order[i]].platform = platformOf(peer, index)
      }
      const nodes = order.map(function (id) { return byId[id] })
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].name === "") nodes[i].name = shortId(nodes[i].id) || pick("未知设备", "unknown device")
      }
      return {
        nodes: nodes,
        inbound: sessions.length,
        outbound: links.length,
        relays: nodes.filter(function (node) { return node.relay === true }).length,
      }
    }

    /** One node of the device board: a button, so the picture is operable and not a poster. */
    function renderNetNode(node, picked, onPick) {
      const direction = node.inbound && node.outbound
        ? pick("双向", "both ways")
        : node.inbound ? pick("驱动本机", "drives here")
          : node.outbound ? pick("本机驱动", "driven here")
            : node.relay ? pick("经中继", "via relay") : pick("已发现", "discovered")
      const tone = node.inbound || node.outbound ? "success" : undefined
      const dotColour = node.inbound || node.outbound ? C.ok : node.relay ? C.warn : C.borderStrong
      return h("button", {
        key: "net-" + node.id,
        type: "button",
        "data-bridge-net-node": node.id,
        "data-bridge-net-state": node.inbound || node.outbound ? "connected" : node.relay ? "relay" : "known",
        onClick: function () { onPick(node.id) },
        style: sx(cardStyle({
          padding: "8px 10px",
          minWidth: "168px",
          maxWidth: "240px",
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          alignItems: "stretch",
          textAlign: "left",
          cursor: "pointer",
          borderColor: picked === node.id ? C.accent : C.borderStrong,
        })),
      }, [
        h("span", { key: "top", style: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 } }, [
          h("span", {
            key: "dot",
            style: { width: "7px", height: "7px", borderRadius: "50%", background: dotColour, flex: "0 0 auto" },
          }),
          h("span", {
            key: "name",
            style: { fontSize: "13px", lineHeight: "19px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
          }, node.name),
          chip(direction, "dir-" + node.id, tone),
        ]),
        h("span", { key: "meta", style: { fontSize: "11px", lineHeight: "16px", color: C.muted } },
          metaText([node.platform, node.chain, node.exposes > 0 ? pick("暴露 " + node.exposes, "exposes " + node.exposes) : ""].filter(Boolean).join(context_sep()))),
      ])
    }


    /**
     * 便条 - what the team asked the ledger to remember, read and written from the panel.
     *
     * R339: the backend has had /api/dsh-link-notes/state and /api/dsh-link-notes/add since R189 and the panel had no
     * way to see or write a note at all (the user: "后端跟上了，前端没有"). This is that half: the last few notes in
     * plain words (who wrote it, when, what it says), and one box to add one. It talks to the notes routes directly -
     * same origin, so the shell proxy attaches the session credential - and never to the model.
     */
    function renderNotesSection(store, state, ui, snapshot) {
      const notes = Array.isArray(ui.notes) ? ui.notes : []
      const counts = isObj(ui.noteCounts) ? ui.noteCounts : null
      const rows = [sectionTitle(pick("便条", "Notes"), counts === null ? null : chip(
        pick(String(counts.notes ?? 0) + " 条 · 未完成 " + String(counts.open ?? 0), String(counts.notes ?? 0) + " · open " + String(counts.open ?? 0)),
        "note-count"))]
      const busy = ui.noteBusy === true
      // One line per note, newest first: 谁 · 时间 · 内容. A note nobody can read is not a note.
      const who = function (author) {
        const value = asStr(author, "")
        if (value === "user") return pick("你", "you")
        if (value === "agent") return "Agent"
        return value === "" ? pick("某人", "someone") : value
      }
      const when = function (at) {
        const then = typeof at === "number" ? at : Date.parse(asStr(at, ""))
        if (Number.isFinite(then) !== true) return ""
        const delta = Date.now() - then
        if (delta < 60000) return pick("刚刚", "just now")
        if (delta < 3600000) return pick(String(Math.round(delta / 60000)) + " 分钟前", String(Math.round(delta / 60000)) + " min ago")
        if (delta < 86400000) return pick(String(Math.round(delta / 3600000)) + " 小时前", String(Math.round(delta / 3600000)) + " h ago")
        return new Date(then).toLocaleDateString()
      }
      // R343: the ledger also holds what our own gates wrote into it - 72 of 72 notes in the live ledger were rows like
      // "R187LIVEGATE-... note appended by r187-live-gate". A person asked for notes and got test output, which is the
      // complaint this section exists to answer. Gate rows are counted, not shown, by the same rule the teams pane uses.
      const isGateNote = function (note) {
        const author = asStr(note && note.author, "")
        const body = asStr(note && note.text, "")
        const marked = /(LIVEGATE)|(G\d{3})|(^r\d+[-_])|([-_]gate$)/i
        return marked.test(author) === true || marked.test(body) === true
      }
      const visible = notes.filter(function (note) { return isGateNote(note) === false })
      const hidden = notes.length - visible.length
      const list = visible.slice(0, 8)
      if (list.length === 0) {
        rows.push(h("div", { key: "empty", style: { fontSize: "12px", lineHeight: "18px", color: C.muted } },
          busy ? pick("正在读取…", "reading…")
            : (hidden > 0
              ? pick("账本里只有 " + String(hidden) + " 条自动验收写进来的测试便条，已经藏起来了。下面写一条你自己的。",
                "The ledger holds only " + String(hidden) + " test notes written by the automated checks; they are hidden. Write one of your own below.")
              : pick("还没有便条。下面写一条，团队和 Agent 都能看到。", "No notes yet. Write one below; the team and the Agent can see it."))))
      }
      for (let index = 0; index < list.length; index += 1) {
        const note = list[index]
        rows.push(h("div", {
          key: "note-" + String(note.id ?? index),
          "data-bridge-note": asStr(note.id, String(index)),
          style: { display: "flex", flexDirection: "column", gap: "2px", padding: "6px 0", borderTop: index === 0 ? "none" : "1px solid " + C.border },
        }, [
          h("div", { key: "text", style: { fontSize: "13px", lineHeight: "20px", wordBreak: "break-word" } }, asStr(note.text, "")),
          h("div", { key: "meta", style: { fontSize: "11px", lineHeight: "16px", color: C.muted } },
            [who(note.author), when(note.at), asStr(note.state, "") === "done" ? pick("已完成", "done") : ""].filter(Boolean).join(" · ")),
        ]))
      }
      if (hidden > 0 && list.length > 0) {
        rows.push(h("div", { key: "hidden", style: { fontSize: "11px", lineHeight: "16px", color: C.muted, marginTop: "4px" } },
          pick("另有 " + String(hidden) + " 条测试便条没有显示（自动验收写的，不是人记的）。",
            String(hidden) + " test note(s) are not shown (written by the automated checks, not by a person).")))
      }
      rows.push(h("div", { key: "write", style: { display: "flex", gap: "8px", marginTop: "8px", alignItems: "flex-start" } }, [
        h("textarea", sx({
          key: "input",
          value: asStr(ui.noteDraft, ""),
          rows: 2,
          placeholder: pick("记一条便条…（Ctrl+Enter 保存）", "Write a note… (Ctrl+Enter saves)"),
          "data-bridge-field": "note-draft",
          onInput: function (event) { ui.setNoteDraft(asStr(event && event.target ? event.target.value : "", "")) },
          onKeyDown: function (event) {
            if (event && event.key === "Enter" && (event.ctrlKey === true || event.metaKey === true)) {
              event.preventDefault()
              ui.addNote()
            }
          },
          style: inputStyle({ flex: "1 1 auto", minHeight: "48px", resize: "vertical", fontFamily: "inherit" }),
        }, inputRingProps())),
        button("note-add", pick("记一条", "Add"), function () { ui.addNote() }, { kind: "primary", disabled: busy || asStr(ui.noteDraft, "").trim() === "" }),
      ]))
      return rows
    }

    /**
     * The OFM offer: "this machine has the OFM desktop app - join its hybrid model service?"
     *
     * R376: the requirement is "detect, ASK, and join only when the user says yes". The detector and the join are two shell
     * routes (`/__shell/ofm`, `/__shell/ofm/join`); this is the asking half, and it is deliberately one line with two
     * buttons - a background service that wires itself into somebody model traffic without being asked is exactly what the
     * requirement forbids.
     */
    function renderOfmOffer(store, ui) {
      const ofm = isObj(ui.ofm) ? ui.ofm : null
      if (ofm === null || ofm.detected !== true) return null
      const result = isObj(ui.ofmJoin) ? ui.ofmJoin : null
      const busy = ui.ofmBusy === true
      const lines = [
        h("div", { key: "ask", style: { fontSize: "13px", lineHeight: "20px" } },
          pick("发现 OFM 桌面端（" + asStr(ofm.signal, "") + (ofm.port === null || ofm.port === undefined ? "" : "，端口 " + String(ofm.port)) + "）。要接入它的混合模型服务吗？",
            "The OFM desktop app is on this machine (" + asStr(ofm.signal, "") + (ofm.port === null || ofm.port === undefined ? "" : ", port " + String(ofm.port)) + "). Join its hybrid model service?")),
        result === null ? null : h("div", {
          key: "result",
          "data-bridge-ofm-result": result.ok === true ? "joined" : "refused",
          style: { fontSize: "12px", lineHeight: "18px", marginTop: "4px", color: result.ok === true ? C.ok : C.warn, wordBreak: "break-word" },
        }, result.ok === true
          ? pick("已接入：" + asStr(result.base_url, "") + (typeof result.models === "number" ? "（它自报 " + String(result.models) + " 个模型）" : ""),
            "joined " + asStr(result.base_url, "") + (typeof result.models === "number" ? " (" + String(result.models) + " models reported)" : ""))
          : asStr(result.detail, "")),
        h("div", { key: "actions", style: { display: "flex", gap: "8px", marginTop: "6px" } }, [
          button("ofm-join", pick("接入", "Join"), function () { ui.joinOfm() }, { kind: "primary", disabled: busy }),
          button("ofm-later", pick("以后再说", "Not now"), function () { ui.dismissOfm() }, { disabled: busy }),
        ]),
      ]
      return h("div", {
        key: "ofm",
        "data-bridge-ofm": asStr(ofm.signal, ""),
        style: cardStyle({ padding: "10px 12px", marginTop: "8px", borderColor: C.accent }),
      }, lines.filter(Boolean))
    }
    /** The board plus the card for whichever node is picked, and nothing else: the sections below stay the controls. */
    function renderDeviceNet(store, state, snapshot, ui) {
      const net = deviceNet(snapshot)
      const busy = state.busy === true
      const picked = asStr(ui.netPick, "")
      const rows = [sectionTitle(pick("设备网", "Device network"), chip(
        pick(net.nodes.length + " 台设备 · 入 " + net.inbound + " · 出 " + net.outbound + " · 中继 " + net.relays,
          net.nodes.length + " device(s) · in " + net.inbound + " · out " + net.outbound + " · relay " + net.relays),
        "net-count"))]
      // This machine is always the first node: a network picture with no "here" in it is a list of strangers.
      const selfName = asStr(snapshot && snapshot.name, "") || pick("本机", "this machine")
      const selfId = asStr(snapshot && snapshot.deviceId, "")
      const selfNode = h("div", {
        key: "net-self",
        "data-bridge-net-self": selfId,
        style: sx(cardStyle({ padding: "8px 10px", minWidth: "150px", maxWidth: "220px", borderColor: C.accent })),
      }, [
        h("span", { key: "top", style: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 } }, [
          h("span", { key: "dot", style: { width: "7px", height: "7px", borderRadius: "50%", background: C.ok, flex: "0 0 auto" } }),
          h("span", { key: "name", style: { fontSize: "13px", lineHeight: "19px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, selfName),
          chip(pick("本机", "here"), "net-self-chip", "success"),
        ]),
        h("span", { key: "meta", style: { fontSize: "11px", lineHeight: "16px", color: C.muted } },
          metaText([platformOf(snapshot || {}, peerIndex(snapshot)), roleLabel(normalizeRole(snapshot && snapshot.role))].filter(Boolean).join(context_sep()))),
      ])
      rows.push(h("div", {
        key: "board",
        "data-bridge-net": "board",
        style: { display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "6px", alignItems: "flex-start" },
      }, [selfNode].concat(net.nodes.map(function (node) {
        return renderNetNode(node, picked, function (id) { ui.setNetPick(id === picked ? "" : id) })
      }))))
      if (net.nodes.length === 0) {
        rows.push(h("div", { key: "empty", style: { fontSize: "12px", lineHeight: "18px", color: C.muted } },
          pick("现在只有本机：配对或发现一台设备后，这里会画出它的方向、跳数和授权。",
            "Only this machine so far: once a device is paired or discovered, its direction, hops and grant are drawn here.")))
      }
      rows.push(h("div", { key: "hint", style: { fontSize: "11px", lineHeight: "16px", color: C.muted } },
        pick("点一台设备看它的完整身份、方向和授权；下面的分区仍是完整的控制面（配对、授权、断开）。",
          "Click a device for its identity, direction and grant; the sections below stay the full control surface.")))
      const node = net.nodes.filter(function (candidate) { return candidate.id === picked })[0]
      if (node === undefined) return rows
      const copy = ui.netCopied
      rows.push(h("div", {
        key: "detail",
        "data-bridge-net-detail": node.id,
        style: sx(cardStyle({ padding: "10px 12px", borderColor: C.accent })),
      }, [
        h("div", { key: "head", style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } }, [
          h("span", { key: "name", style: { fontSize: "14px", lineHeight: "22px", fontWeight: 600, flex: "1 1 auto", minWidth: "100px" } }, node.name),
          node.inbound ? chip(pick("对方驱动本机", "driving this machine"), "d-in", "success") : null,
          node.outbound ? chip(pick("本机驱动对方", "driven from here"), "d-out") : null,
          node.relay ? relayTag(pick("经中继", "via relay"), "d-relay") : null,
          button("net-clear", pick("取消选择", "Clear"), function () { ui.setNetPick("") }, { disabled: busy }),
        ]),
        h("div", { key: "id", style: { marginTop: "4px", fontSize: "12px", lineHeight: "18px", color: C.muted, wordBreak: "break-all" } },
          node.id),
        h("div", { key: "facts", style: { marginTop: "2px", fontSize: "12px", lineHeight: "18px" } },
          metaText([node.platform, node.remote === "" ? "" : pick("来自 ", "from ") + node.remote, node.chain].filter(Boolean).join(context_sep()))),
        h("div", { key: "grant", style: { marginTop: "2px", fontSize: "12px", lineHeight: "18px", color: C.muted } },
          node.grant === null ? pick("本机没有披露它的授权", "no grant is disclosed here") : grantSummary(node.grant)),
        // The rows are built as an ARRAY first: `h()` returns an element, so chaining `.concat` onto it is a runtime
        // TypeError inside the renderer (measured: "h(...).concat is not a function", panel failed to render).
        // A connected device that advertises nothing is a FACT worth saying: the Android app implements fs.read/fs.list
        // itself and answers sys.info with a reserved refusal, so there is no target list to draw - the card says that
        // instead of leaving a blank where a picture was promised.
        node.callables.length === 0 && (node.inbound || node.outbound) ? h("div", {
          key: "no-callables",
          "data-bridge-net-callables-empty": node.id,
          style: { marginTop: "4px", fontSize: "11px", lineHeight: "16px", color: C.muted },
        }, pick("这台设备没有公布可调用的目标（它只回答自己的 fs.read / fs.list），所以这里没有列表。",
          "This device advertises no callable target (it answers only its own fs.read / fs.list), so there is no list here.")) : null,
        node.callables.length === 0 ? null : (function () {
          const callableRows = [h("div", { key: "head", style: { fontSize: "11px", lineHeight: "16px", color: C.muted } },
            pick("它对外暴露的目标（点「自检」真的调用一次）", "what it offers (自检 really calls it once)"))]
          node.callables.slice(0, 8).forEach(function (target, index) {
            callableRows.push(h("div", {
              key: "c-" + String(index),
              style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", lineHeight: "18px", marginTop: "2px" },
            }, [
              h("span", { key: "n", style: { flex: "1 1 auto", minWidth: 0, wordBreak: "break-all" } }, target.name),
              target.kind === "" ? null : chip(target.kind, "ck-" + String(index)),
              target.hops === null ? null : h("span", { key: "h", style: { color: C.muted } }, String(target.hops) + pick(" 跳", " hop(s)")),
            ]))
          })
          if (node.callables.length > 8) {
            callableRows.push(h("div", { key: "more", style: { fontSize: "11px", color: C.muted } },
              pick("还有 " + String(node.callables.length - 8) + " 个", String(node.callables.length - 8) + " more")))
          }
          return h("div", {
            key: "callables",
            "data-bridge-net-callables": node.id,
            style: { marginTop: "4px", borderTop: "1px solid " + C.border, paddingTop: "4px" },
          }, callableRows)
        })(),
        isObj(ui.netList) && Array.isArray(ui.netList.entries) && ui.netList.device && ui.netList.device.key === node.id ? h("div", {
          key: "net-list-result",
          "data-bridge-net-list": node.id,
          style: { marginTop: "6px", borderTop: "1px solid " + C.border, paddingTop: "4px" },
        }, [h("div", { key: "head", style: { fontSize: "11px", lineHeight: "16px", color: C.muted } },
          pick("列目录结果：", "directory listing: ") + String(ui.netList.root ?? "") + " · " + String(ui.netList.count ?? 0) + pick(" 项", " entries"))]
          .concat(ui.netList.entries.slice(0, 6).map(function (entry, index) {
            return h("div", { key: "e-" + String(index), style: { fontSize: "12px", lineHeight: "18px", color: C.muted } },
              (entry.type === "dir" ? "▸ " : "· ") + String(entry.name))
          }))) : null,
        isObj(ui.netCapture) && ui.netCapture.device && ui.netCapture.device.key === node.id ? h("div", {
          key: "net-capture-result",
          "data-bridge-net-capture": node.id,
          style: { marginTop: "6px", borderTop: "1px solid " + C.border, paddingTop: "4px", fontSize: "11px", lineHeight: "16px", color: C.muted, wordBreak: "break-all" },
        }, pick("已录下：", "recorded: ") + String(ui.netCapture.bytes ?? "?") + pick(" 字节 · ", " bytes · ")
          + String(ui.netCapture.kind ?? "") + pick(" · ", " · ") + String(ui.netCapture.path ?? "")) : null,
        h("div", { key: "actions", style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" } }, [
          button("net-copy", copy === node.id ? pick("已复制", "copied") : pick("复制 deviceId", "Copy deviceId"), function () {
            try {
              if (typeof navigator === "undefined" || navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== "function") {
                store.setError(pick("这个 webview 不给剪贴板", "this webview grants no clipboard"))
                return
              }
              void navigator.clipboard.writeText(node.id).then(function () { ui.setNetCopied(node.id) })
            } catch (err) {
              store.setError(msgOf(err))
            }
          }, { disabled: false }),
          node.inbound || node.outbound ? button("net-list", pick("列一次目录", "List a directory"), function () {
            // The one READ the phone implements, as a button: it lists the target first granted root and shows the first
            // names in this card. `target.list` is a narrow service op (one directory, 12 names), not a general call.
            void run(store, "target.list", { device: node.id }, {
              notice: function (value) {
                const count = isObj(value) && typeof value.count === "number" ? value.count : 0
                const root = isObj(value) && typeof value.root === "string" ? value.root : ""
                return pick("已列出 " + root + "：" + String(count) + " 项", "listed " + root + ": " + String(count) + " entries")
              },
              after: function (value) { ui.setNetList(isObj(value) ? value : null) },
            })
          }, { disabled: busy }) : null,
          node.inbound || node.outbound ? button("net-capture", pick("录一段声音", "Record audio"), function () {
            // R333: the phone is a microphone of the device net. The device records (only it has a microphone) and
            // writes the artifact where this machine already reads; what comes back names the file and its size, so the
            // notice states what landed instead of "done".
            void run(store, "target.capture", { device: node.id, ms: 2000 }, {
              notice: function (value) {
                const bytes = isObj(value) && typeof value.bytes === "number" ? value.bytes : null
                const path = isObj(value) && typeof value.path === "string" ? value.path : ""
                return bytes === null
                  ? pick("设备没有回报录音的大小", "the device reported no size for the recording")
                  : pick("已录下 " + String(bytes) + " 字节：" + path, "recorded " + String(bytes) + " bytes: " + path)
              },
              after: function (value) { ui.setNetCapture(isObj(value) ? value : null) },
            })
          }, { disabled: busy, title: pick("设备端录音并写进它的共享存储，随后可在这里列出来", "records on the device and writes it into its shared storage, which can then be listed here") }) : null,
          node.inbound || node.outbound ? button("net-photo", pick("拍一张", "Take a photo"), function () {
            // R380: the phone is a camera of the device net too. Same wire op, same artifact route; what comes back
            // names the file, its size and (when the page reported one) the frame dimensions.
            void run(store, "target.capture", { device: node.id, kind: "photo" }, {
              notice: function (value) {
                const bytes = isObj(value) && typeof value.bytes === "number" ? value.bytes : null
                const path = isObj(value) && typeof value.path === "string" ? value.path : ""
                const size = isObj(value) && typeof value.size === "string" ? value.size : null
                return bytes === null
                  ? pick("设备没有回报照片的大小", "the device reported no size for the photo")
                  : pick("已拍下 " + String(bytes) + " 字节" + (size === null ? "" : "（" + size + "）") + "：" + path, "took " + String(bytes) + " bytes" + (size === null ? "" : " (" + size + ")") + ": " + path)
              },
              after: function (value) { ui.setNetCapture(isObj(value) ? value : null) },
            })
          }, { disabled: busy, title: pick("让设备拍一张照片，写进它的共享存储，随后可在这里列出来", "takes one photo on the device and writes it into its shared storage, which can then be listed here") }) : null,
          node.inbound || node.outbound ? button("net-selftest", pick("自检这条链路", "Self-test this link"), function () {
            // The notice is a FUNCTION of the answer: a self test that reports "link works" while a step failed would be
            // the same fake green the rest of this project spends its rounds removing. A read-only grant is not a
            // failure (the host marks fs.write/shell.exec as skipped, not failed) and the sentence says which steps did
            // not run at all.
            void run(store, "link.selftest", { device: node.id }, {
              notice: function (value) {
                const failed = isObj(value) && Array.isArray(value.failed) ? value.failed.map(function (name) { return String(name) }) : []
                const list = failed.length === 0 ? pick("无", "none") : failed.join(pick("、", ", "))
                const ok = isObj(value) && value.ok === true
                return ok
                  ? pick("自检通过：链路可用（未执行的步骤：" + list + "）", "Self-test passed: the link works (steps not run: " + list + ")")
                  : pick("自检未全通：失败步骤 " + list, "Self-test did not pass: failed steps " + list)
              },
            })
          }, { kind: "primary", disabled: busy, title: pick("真的发起一次调用：写/读一个标记文件并跑一次 shell", "Really makes a call: writes and reads a marker file and runs one shell") }) : null,
          node.inbound || node.outbound ? button("net-disconnect", pick("断开", "Disconnect"), function () {
            void run(store, "peers.disconnect", { deviceId: node.id }, { notice: pick("已断开 ", "Disconnected ") + node.name })
          }, { kind: "danger", disabled: busy }) : null,
        ]),
      ]))
      return rows
    }

    /** The separator the panel already uses between facts on one line. */
    function context_sep() {
      return pick(" · ", " · ")
    }

    /**
     * Every device reachable from here, with the relay fact impossible to miss.
     *
     * A relayed target is answered by a third machine under the intersection of
     * both grants, so the row states the machine, the hop count and the
     * effective grant rather than styling it as an ordinary device.
     */
    function renderTargetsSection(snapshot) {
      const targets = asArray(snapshot && snapshot.targets).filter(isObj)
      const relay = isObj(snapshot && snapshot.relay) ? snapshot.relay : null
      // `relay.supported` is the host's CAPABILITY statement (can this build
      // relay at all); whether a given peer may relay is per-peer on that
      // peer's grant (`relay` / `relayPeers`), which is the part that varies.
      // A host that does not report the flag says nothing about it: absence is
      // not a capability statement either way.
      const supportedKnown = relay !== null && typeof relay.supported === "boolean"
      const summary = relay === null
        ? ""
        : [
          supportedKnown
            ? (relay.supported === true ? pick("中转 支持", "relay supported") : pick("中转 不支持", "relay unsupported"))
            : "",
          pick("上限 ", "max ") + numText(relay.maxHops, "?") + pick(" 跳", " hops"),
          pick("可达 ", "reachable ") + numText(relay.reachable, targets.length),
        ].filter(Boolean).join(" · ")
      const rows = [sectionTitle(pick("可调用的设备", "Devices you can call"),
        relay === null ? undefined : chip(summary, "relay-summary", relay.supported === true ? "success" : undefined))]
      if (targets.length === 0) {
        rows.push(h("div", { key: "empty", style: { fontSize: "13px", lineHeight: "20px", color: C.muted } },
          pick("当前没有可调用的设备：先连接一台对端。", "No device is reachable yet: connect a peer first.")))
        return rows
      }
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]
        const key = asStr(target.key, "") || String(i)
        const name = asStr(target.name, "") || shortId(key) || pick("未知设备", "unknown device")
        const relayed = target.kind === "relay"
        const hops = asNum(target.hops, null)
        rows.push(h("div", {
          key: "target-" + key,
          "data-bridge-target": key,
          "data-bridge-target-kind": relayed ? "relay" : "direct",
          style: cardStyle({ padding: "10px 12px", marginBottom: "6px" }),
        },
          h("div", { key: "top", style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
            h("span", { key: "n", style: { fontSize: "14px", lineHeight: "22px", fontWeight: 500, flex: "1 1 auto", minWidth: "90px", wordBreak: "break-word" } }, name),
            chip(relayed ? pick("经中转", "relayed") : pick("直连", "direct"), "kind", relayed ? "warning" : "success")),
          metaText([
            platformOf(target, peerIndex(snapshot)),
            shortId(key),
            hops === null ? "" : hops + pick(" 跳", " hops"),
          ].filter(Boolean).join(" · ")),
          relayed ? relayNotice(target, snapshot, viaChainText(snapshot, target)) : null,
          metaText(pick("生效授权 ", "effective grant ") + grantSummary(target.grant)),
          relayed ? metaText(pick("该授权是两跳授权的最小值（交集中的更小者）。",
            "That grant is the minimum of both hops — the narrower side wins.")) : null))
      }
      return rows
    }

    /** Devices this machine may connect OUT to, with the refusal reason inline. */
    function renderPeersSection(store, state, snapshot, ui) {
      const busy = state.busy === true
      const peers = asArray(snapshot && snapshot.peers).filter(isObj)
      const rows = [sectionTitle(
        pick("可连接的设备", "Devices you can connect to"),
        button("probe", busy ? pick("扫描中…", "scanning…") : pick("重新扫描", "Rescan"),
          function () { void run(store, "discover.probe", {}, { notice: pick("已发送发现探测", "Discovery probe sent") }) },
          { disabled: busy, title: pick("主动探测局域网中的对端", "Probe the LAN for peers") }))]
      if (peers.length === 0) {
        rows.push(h("div", { key: "empty", style: { fontSize: "13px", lineHeight: "20px", color: C.muted, padding: "2px 0" } },
          pick("未发现设备。请确认对端已开启「可被发现」，或使用下方的手动地址。",
            "No devices found. Make sure the peer enabled “discoverable”, or use the manual address below.")))
      } else {
        for (let i = 0; i < peers.length; i++) {
          const peer = peers[i]
          const id = asStr(peer.deviceId, "")
          const name = asStr(peer.name, "") || shortId(id) || pick("未知设备", "unknown device")
          const host = asStr(peer.host, "")
          const port = asNum(peer.port, null)
          const accepts = peer.accepts !== false
          const role = asStr(peer.role, "unknown")
          const seen = agoText(elapsedMs(peer.lastSeenMs))
          const relays = Math.round(asNum(peer.relayDevices, 0))
          const meta = [
            [asStr(peer.os, ""), asStr(peer.arch, "")].filter(Boolean).join("/"),
            host ? host + (port === null ? "" : ":" + port) : "",
            seen ? pick("最后发现 ", "seen ") + seen : "",
            peer.connected === true ? pick("已连接", "connected") : "",
          ].filter(Boolean).join(" · ")
          rows.push(h("div", {
            key: "peer-" + (id || i),
            "data-bridge-peer": id,
            "data-bridge-accepts": accepts ? "1" : "0",
            "data-bridge-trusted": peer.trusted === true ? "1" : "0",
            style: cardStyle({
              display: "flex", alignItems: "center", gap: ROW_GAP + "px", padding: "8px 10px", marginBottom: "6px",
              // An unreachable peer is greyed out AND labelled: the dimming says
              // "not now", the 连接 affordance says why in words.
              opacity: accepts ? 1 : 0.55,
            }),
          },
            h("div", { key: "info", style: { flex: "1 1 auto", minWidth: 0 } },
              h("div", { key: "n", style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", fontSize: "14px", lineHeight: "22px" } },
                h("span", { key: "name", style: { fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, name),
                chip(roleLabel(role === "unknown" ? null : role), "role", undefined),
                peer.trusted === true ? chip(pick("已信任", "trusted"), "trusted", "success") : chip(pick("未信任", "not trusted"), "untrusted", undefined),
                relays > 0 ? relayTag(pick("中转 ", "relays ") + relays + pick(" 台", " devices"), "relay-count") : null),
              metaText(meta),
              accepts ? null : h("div", {
                key: "refusal",
                "data-bridge-field": "peer-refusal",
                style: { fontSize: "12px", lineHeight: "18px", color: C.warn, marginTop: "2px" },
              }, acceptsRefusal(peer))),
            accepts
              ? button("connect", pick("连接", "Connect"), function () {
                void run(store, "connect", { deviceId: id }, { notice: pick("正在连接 ", "Connecting to ") + name })
              }, { kind: "primary", disabled: busy })
              : button("connect", pick("连接", "Connect"), function () {},
                { kind: "plain", disabled: true, title: acceptsRefusal(peer) })))
        }
      }

      rows.push(sectionTitle(pick("手动地址", "Manual address")))
      rows.push(h("div", { key: "manual", style: { display: "flex", gap: "8px" } },
        h("input", sx({
          key: "addr",
          type: "text",
          value: asStr(ui.manualAddr, ""),
          spellCheck: false,
          disabled: busy,
          placeholder: "host:port",
          "aria-label": pick("对端地址", "peer address"),
          "data-bridge-field": "manual-address",
          onChange: function (event) { ui.setManualAddr(event && event.target ? asStr(event.target.value, "") : "") },
          onKeyDown: function (event) {
            if (event && event.key === "Enter") connectManual()
          },
          style: inputStyle({ flex: "1 1 auto", height: "30px" }),
        }, inputRingProps())),
        button("manual-connect", pick("连接", "Connect"), connectManual, { kind: "primary", disabled: busy })))

      function connectManual() {
        const target = parseAddress(ui.manualAddr)
        if (target === null) {
          store.setError(pick("请输入 host:port 形式的手动地址，例如 192.168.1.20:7331", "Enter a host:port address, for example 192.168.1.20:7331"))
          return
        }
        void run(store, "connect", { host: target.host, port: target.port },
          { notice: pick("正在连接 ", "Connecting to ") + target.host + ":" + target.port })
      }

      return rows
    }

    /** The audit ring, shared by both roles. */
    function renderAuditSection(store, state, ui) {
      const busy = state.busy === true
      const snapshot = isObj(state.snapshot) ? state.snapshot : null
      const rows = []
      const auditRows = normalizeAudit(ui.auditOverride !== null ? ui.auditOverride : (snapshot ? snapshot.audit : null))
      rows.push(sectionTitle(
        pick("审计日志", "Audit log"),
        button("audit-refresh", pick("刷新", "Refresh"), function () {
          void run(store, "audit.tail", { limit: AUDIT_ROWS }, {
            notice: pick("审计已刷新", "Audit refreshed"),
            after: function (value) { ui.setAuditOverride(normalizeAudit(value)) },
          })
        }, { disabled: busy })))
      if (auditRows.length === 0) {
        rows.push(h("div", { key: "no-audit", style: { fontSize: "13px", lineHeight: "20px", color: C.muted } }, pick("暂无审计记录。", "No audit entries yet.")))
      } else {
        // The host returns the audit newest-first (`snapshot().audit` and
        // `audit.tail` both reverse the ring), so the newest row stays on top.
        const tail = auditRows.slice(0, AUDIT_ROWS)
        rows.push(h("div", {
          key: "audit",
          style: cardStyle({ maxHeight: "176px", overflow: "auto" }),
        }, tail.map(function (entry, i) {
          const row = isObj(entry) ? entry : {}
          const allowed = row.allowed === true
          const detail = asStr(row.detail, "")
          return h("div", {
            key: "a-" + i,
            style: {
              display: "flex", gap: ROW_GAP + "px", alignItems: "center",
              padding: "6px 10px", fontSize: "12px", lineHeight: "18px",
              borderTop: i === 0 ? "none" : "1px solid " + C.border,
            },
          },
            statusDot(allowed ? "connected" : "error", DOT_RAIL),
            h("span", { key: "t", style: { color: C.muted, flex: "0 0 auto", fontVariantNumeric: "tabular-nums" } }, clockText(row.tsMs)),
            h("span", { key: "a", style: { flex: "1 1 auto", color: allowed ? C.ok : C.danger, wordBreak: "break-all" } }, asStr(row.action, "")),
            h("span", {
              key: "peer",
              style: { color: C.muted, flex: "0 0 auto", maxWidth: "96px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            }, shortId(row.peer)),
            detail ? h("span", {
              key: "d",
              style: { color: C.muted, flex: "1 1 auto", minWidth: 0, wordBreak: "break-all" },
            }, detail) : null)
        })))
      }
      return rows
    }
    function renderRoleSwitch(store, role, busy) {
      // Exactly two postures. `both` was removed from ROLES, so there is no
      // third cell to render: a 双侧 option would be a lie about a role the host
      // refuses.
      const labels = {
        agent: pick("Agent 侧", "Agent side"),
        bridge: pick("桥接侧", "Bridge side"),
      }
      return h("div", {
        key: "role",
        role: "group",
        "aria-label": pick("角色", "Role"),
        "data-bridge-field": "role",
        style: { display: "flex", gap: "4px" },
      }, ROLES.map(function (candidate) {
        return h(RowCell, {
          key: candidate,
          role: candidate,
          label: labels[candidate],
          active: candidate === role,
          disabled: busy,
          onClick: function () {
            void run(store, "role.set", { role: candidate },
              { notice: pick("角色已切换为 ", "Role switched to ") + labels[candidate] })
          },
        })
      }))
    }

    function renderPanel(store, state) {
      const snapshot = isObj(state.snapshot) ? state.snapshot : null
      const role = normalizeRole(snapshot && snapshot.role)
      const accepts = snapshot !== null && snapshot.accepts === true
      const dot = dotState(snapshot, state.error)
      const busy = state.busy === true
      const ui = state.ui
      const children = []

      children.push(h("div", {
        key: "header",
        style: { display: "flex", alignItems: "center", gap: ROW_GAP + "px" },
      },
        statusDot(dot, DOT_SIZE),
        h("div", { key: "title", style: { flex: "1 1 auto", minWidth: 0 } },
          h("div", { key: "t", style: { fontSize: "16px", lineHeight: "24px", fontWeight: 500 } }, pick("局域网桥接", "LAN bridge")),
          h("div", { key: "s", style: { fontSize: "12px", lineHeight: "18px", color: C.muted, marginTop: "1px" } },
            roleLabel(role) + " · " + statusLabel(snapshot, dot) +
            (accepts ? "" : pick(" · 不接收连接", " · not accepting")))),
        busy ? h("span", {
          key: "busy",
          "data-bridge-busy": "1",
          title: pick("请求进行中", "request in flight"),
          style: {
            width: "14px", height: "14px", flex: "0 0 auto",
            borderRadius: "50%",
            border: "2px solid " + C.borderStrong,
            borderTopColor: C.accent,
            display: "inline-block",
          },
        }) : null,
        h(BridgeIconButton, {
          key: "close",
          action: "close",
          label: pick("收起面板", "Close the panel"),
          title: pick("收起面板", "Close the panel"),
          onClick: function () { store.close() },
        })))

      if (state.notice) {
        children.push(h("div", {
          key: "notice",
          style: { fontSize: "12px", lineHeight: "18px", color: C.ok, marginTop: "8px", wordBreak: "break-word" },
        }, state.notice))
      }
      if (state.error) {
        children.push(h("div", { key: "error", style: sx(styleObject(), { marginTop: "8px" }) }, state.error))
      }

      // Identity and pairing come first: which posture this machine has and
      // whether it can be reached at all is what every list below depends on.
      const pairingSection = sectionBlock("dsh-lan-bridge-pairing", renderPairingSection(store, state, snapshot, ui))
      const peersSection = sectionBlock("dsh-lan-bridge-peers", renderPeersSection(store, state, snapshot, ui))
      // R314: the network board is the FIRST thing in the panel. It is the picture a person opens the panel for;
      // the identity/pairing/links sections under it stay the control surface, unchanged.
      children.push(sectionBlock("dsh-lan-bridge-net", renderDeviceNet(store, state, snapshot, ui)))
      // 便条 sits right under the board: it is what a person opens the panel to read and add, not a settings surface.
      const ofmOffer = renderOfmOffer(store, ui)
      if (ofmOffer !== null) children.push(sectionBlock("dsh-lan-bridge-ofm", [ofmOffer]))
      children.push(sectionBlock("dsh-lan-bridge-notes", renderNotesSection(store, state, ui, snapshot)))
      children.push(sectionBlock("dsh-lan-bridge-identity", renderIdentitySection(store, state, snapshot)))
      // Then order by what this posture can actually DO. A 桥接侧 machine's job is
      // to show its code; an Agent 侧 machine's job is to pick a device and press
      // 连接. Putting the code box first on an Agent-side machine is precisely how
      // a user ends up typing a code into a connection that does not exist yet.
      if (normalizeRole(snapshot && snapshot.role) === "bridge") {
        children.push(pairingSection)
        children.push(peersSection)
      } else {
        children.push(peersSection)
        children.push(pairingSection)
      }

      if (isLegacyHost(snapshot)) {
        // A new panel against an old host: say so, then show the one connection
        // the old host actually reports. The v2 lists are omitted rather than
        // rendered empty — an empty list next to no explanation is exactly the
        // "looks broken" outcome this branch exists to prevent.
        children.push(sectionBlock("dsh-lan-bridge-host", [renderLegacyNotice()]))
        children.push(sectionBlock("dsh-lan-bridge-links", [
          sectionTitle(pick("当前连接（旧版主机）", "Current connection (older host)")),
          renderLegacyConnection(store, state, snapshot),
        ]))
        children.push(sectionBlock("dsh-lan-bridge-sessions", [
          sectionTitle(pick("正在驱动本机的设备（旧版主机）", "Devices driving this machine (older host)")),
          legacySessions(snapshot).length === 0
            ? h("div", { key: "empty", style: { fontSize: "13px", lineHeight: "20px", color: C.muted } },
              pick("当前没有对端连接。", "No peer is connected."))
            : renderLegacySessions(store, state, snapshot, ui),
        ]))
      } else {
        // The two device lists the contract describes, in the direction the user
        // reads them: what this machine drives, then what drives this machine.
        children.push(sectionBlock("dsh-lan-bridge-links", renderLinksSection(store, state, snapshot, ui)))
        children.push(sectionBlock("dsh-lan-bridge-sessions", renderSessionsSection(store, state, snapshot, ui)))
        children.push(sectionBlock("dsh-lan-bridge-targets", renderTargetsSection(snapshot)))
      }
      children.push(sectionBlock("dsh-lan-bridge-audit", renderAuditSection(store, state, ui)))
      children.push(sectionBlock("dsh-lan-bridge-device", renderLocalInfo(snapshot)))

      children.push(h("div", {
        key: "foot",
        style: { fontSize: "12px", lineHeight: "18px", color: C.muted, marginTop: "12px" },
      }, pick("数据每 1.5 秒自动刷新（仅面板展开时）。", "State refreshes every 1.5 s while this panel is open.")))

      const glassed = skinActive()
      const attributes = {
        "data-bridge-panel": "open",
        "data-bridge-primitives": hasPrimitives ? "1" : "0",
        lang: isEnglish() ? "en" : "zh-CN",
      }
      // The opt-ins the skin documents: this panel is a surface it may draw, and it floats, so it
      // asks for the popover grade of the material rather than the panel grade.
      if (glassed) {
        attributes["data-lg-surface"] = ""
        attributes["data-lg-popover"] = ""
      }
      return h("div", {
        ...attributes,
        style: {
          position: "fixed",
          left: "12px",
          bottom: "52px",
          width: "360px",
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "60vh",
          overflow: "auto",
          zIndex: 40,
          pointerEvents: "auto",
          boxSizing: "border-box",
          padding: "12px 14px 14px",
          borderRadius: panelRadius(),
          color: C.text,
          fontSize: ROW_FONT,
          lineHeight: ROW_LINE,
          textAlign: "left",
          // Geometry only under the skin; the pane is the skin's. See `skinActive`.
          ...(glassed ? {} : {
            border: "1px solid " + C.border,
            background: C.surface,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08)",
          }),
        },
      }, children)
    }

    function renderLocalInfo(snapshot) {
      const rows = [sectionTitle(pick("本机", "This device"))]
      const body = [
        kvRow("id", pick("设备 ID", "Device ID"), asStr(snapshot && snapshot.deviceId, "") || pick("（未知）", "(unknown)")),
        kvRow("port", pick("端口", "Port"), asNum(snapshot && snapshot.port, null) === null ? pick("（未知）", "(unknown)") : String(asNum(snapshot.port, 0))),
        kvRow("proto", pick("协议版本", "Protocol"), asStr(snapshot && snapshot.protocolVersion, "") || pick("（未知）", "(unknown)")),
      ]
      const name = asStr(snapshot && snapshot.deviceName, "")
      const platform = [asStr(snapshot && snapshot.os, ""), asStr(snapshot && snapshot.arch, "")].filter(Boolean).join("/")
      if (name || platform) {
        body.unshift(kvRow("name", pick("名称", "Name"), [name, platform].filter(Boolean).join(" · ")))
      }
      // A listener that could not bind its port leaves every other row healthy,
      // so the reason has to be stated explicitly.
      const listenError = asStr(snapshot && snapshot.listenError, "")
      if (listenError !== "") {
        body.push(h("div", {
          key: "listen-error",
          "data-bridge-field": "listen-error",
          style: { color: C.danger, fontSize: "12px", lineHeight: "18px", marginTop: "6px", wordBreak: "break-word" },
        }, pick("监听失败：", "Listen failed: ") + listenError))
      }
      // Whether the data-plane tools are registered is the user-visible half of
      // "can I actually drive a device right now": `toolsAvailable` is exactly
      // `targets.length > 0`. The control-plane tools (`controlTools`) are
      // registered unconditionally per §6, so that flag never varies and there
      // is nothing to render for it; this line states the part that does.
      if (isObj(snapshot) && typeof snapshot.toolsAvailable === "boolean") {
        body.push(h("div", {
          key: "tools",
          "data-bridge-field": "tools",
          style: { color: C.muted, fontSize: "12px", lineHeight: "18px", marginTop: "6px" },
        }, snapshot.toolsAvailable === true
          ? pick("数据面工具已解锁：可以直接操作对端设备。", "Data-plane tools are unlocked: peers can be driven directly.")
          : pick("数据面工具未注册：当前没有可操作的设备。", "Data-plane tools are not registered: no device is reachable.")))
      }
      // Both builds, side by side: a stale browser bundle against a fresh host (or
      // the reverse) is the first thing to rule out when the panel and the host
      // disagree, and it is otherwise impossible to judge from the UI.
      const hostBuild = asStr(snapshot && snapshot.hostBuild, "")
      body.push(h("div", {
        key: "builds",
        "data-bridge-field": "builds",
        style: { color: C.muted, fontSize: "12px", lineHeight: "18px", marginTop: "6px" },
      }, pick("客户端 ", "client ") + CLIENT_BUILD + (hostBuild === "" ? "" : pick(" · 主机 ", " · host ") + hostBuild)))
      rows.push(h("div", {
        key: "local",
        style: cardStyle({ padding: "10px 12px" }),
      }, body))
      return rows
    }

    /**
     * The notification toast: a floating card that appears without the panel
     * being open, exactly where a system notification would.
     *
     * Why it exists: a connection request used to be rendered inside the panel,
     * below the pairing block — so the one time-critical control in this plugin
     * sat below the fold and the person on the bridge side had to scroll to find
     * 同意 while the other machine waited on a handshake. A request is an event,
     * not a section: it announces itself and carries its own 同意 / 拒绝.
     *
     * Several machines can be waiting at once (`snapshot().requests` is a list),
     * so the card stacks one block per pending request, each with its own device
     * name, safety code and decision buttons. A single × dismisses the card as
     * it stands — `dismissed` is keyed by request id, so a request that arrives
     * afterwards still announces itself.
     */
    function BridgeToast() {
      let store = null
      let hookError = null
      try { store = useBridgeStore() } catch (err) { hookError = err }
      const hidden = react.useState(null)
      const dismissed = Array.isArray(hidden[0]) ? hidden[0] : []
      const setDismissed = hidden[1]
      // One request's grant can be adjusted inline; the draft is keyed by the
      // request id, so switching between two pending requests never shows the
      // other one's roots. A single slot is enough: only one is open at a time.
      const editState = react.useState("")
      const grantState = react.useState(null)
      const remember = function (next) {
        if (typeof setDismissed === "function") setDismissed(next)
      }
      // Poll even with the panel closed: a notification that only arrives while
      // you are looking at the panel is not a notification.
      useBridgePolling(store, false)
      if (hookError !== null || store === null) return null
      const state = store.read()
      const snapshot = isObj(state.snapshot) ? state.snapshot : null
      // `pendingRequests` reads the v2 list, or the legacy single `request`
      // alias when the host is older than this panel — the approval must keep
      // working either way, because it is the control that unblocks the other
      // machine.
      const requests = pendingRequests(snapshot).filter(function (request) {
        const id = asStr(request.id, "")
        return id === "" || dismissed.indexOf(id) === -1
      })
      // A freshly established link is worth one quiet line; it is not a decision.
      const conn = legacyConnection(snapshot)
      const links = asArray(snapshot && snapshot.links).filter(isObj)
      const fresh = links.filter(function (link) {
        if (link.state !== "connected") return false
        const since = elapsedMs(link.sinceMs)
        return since !== null && since < 12000
      })
      const legacyFresh = conn !== null && asStr(conn.state, "") === "connected" &&
        elapsedMs(conn.sinceMs) !== null && elapsedMs(conn.sinceMs) < 12000
      const announceConnection = requests.length === 0 && (fresh.length > 0 || legacyFresh)
      if (requests.length === 0 && announceConnection !== true) return null
      const busy = state.busy === true
      const clear = function () {
        const ids = requests.map(function (request) { return asStr(request.id, "") }).filter(Boolean)
        remember(ids.length > 0 ? dismissed.concat(ids) : ["*"])
      }
      const shell = function (kind, children) {
        return h("div", {
          "data-bridge-toast": kind,
          "data-bridge-toast-count": String(requests.length),
          lang: isEnglish() ? "en" : "zh-CN",
          style: {
            position: "fixed",
            top: "16px",
            right: "16px",
            width: "340px",
            maxWidth: "calc(100vw - 32px)",
            zIndex: 60,
            pointerEvents: "auto",
            boxSizing: "border-box",
            padding: "12px 14px",
            borderRadius: panelRadius(),
            border: "1px solid " + C.borderStrong,
            background: C.surface,
            color: C.text,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12)",
            fontSize: ROW_FONT,
            lineHeight: ROW_LINE,
            textAlign: "left",
          },
        }, children)
      }
      const close = h(BridgeIconButton, {
        key: "x",
        action: "toast-close",
        label: pick("隐藏这条通知", "Hide this notification"),
        title: pick("隐藏这条通知", "Hide this notification"),
        onClick: clear,
      })
      if (requests.length > 0) {
        const blocks = [h("div", { key: "head", style: { display: "flex", alignItems: "center", gap: ROW_GAP + "px" } },
          statusDot("busy", DOT_SIZE),
          h("div", { key: "t", style: { flex: "1 1 auto", minWidth: 0, fontSize: "14px", lineHeight: "22px", fontWeight: 500 } },
            requests.length === 1
              ? pick("连接请求", "Connection request")
              : pick("连接请求 ", "Connection requests ") + requests.length),
          close)]
        for (let i = 0; i < requests.length; i++) {
          const request = requests[i]
          const name = asStr(request.name, "") || shortId(request.deviceId) || pick("未知设备", "unknown device")
          const sas = asStr(request.sas, "")
          const reason = asStr(request.reason, "")
          const expiresAt = remainingMs(request.expiresAtMs)
          const requestId = asStr(request.id, "") || String(i)
          const editing = asStr(editState[0], "") === requestId
          const saved = isObj(grantState[0]) && grantState[0].forId === requestId ? grantState[0] : null
          const draft = saved !== null ? saved : draftFromGrant(requestId, request.defaultGrant, true)
          const patchDraft = function (part) {
            if (typeof grantState[1] === "function") grantState[1](sx(draft, part, { forId: requestId }))
          }
          blocks.push(h("div", {
            key: "req-" + requestId,
            "data-bridge-request": requestId,
            style: { marginTop: "10px", borderTop: "1px solid " + C.border, paddingTop: "10px" },
          },
            h("div", { key: "n", style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
              h("span", { key: "name", style: { fontSize: "14px", lineHeight: "22px", fontWeight: 500, flex: "1 1 auto", minWidth: "90px", wordBreak: "break-word" } }, name),
              chip(pick("请求连接", "wants in"), "dir", undefined)),
            h("div", { key: "meta", style: { marginTop: "2px", fontSize: "12px", lineHeight: "18px", color: C.muted } },
              [
                asStr(request.os, ""),
                shortId(request.deviceId),
                expiresAt === null ? "" : pick("有效期 ", "expires in ") + durationText(expiresAt),
              ].filter(Boolean).join(" · ")),
            reason === "" ? null : h("div", { key: "reason", style: { marginTop: "4px", fontSize: "12px", lineHeight: "18px", color: C.muted, wordBreak: "break-word" } }, reason),
            sas === "" ? null : h("div", { key: "sas", style: { marginTop: "4px", fontSize: "12px", lineHeight: "18px" } },
              h("span", { key: "l", style: { color: C.muted } }, pick("安全码 ", "safety code ")),
              h("span", {
                key: "v",
                "data-bridge-field": "toast-sas",
                style: { fontFamily: C.mono, fontWeight: 600, letterSpacing: "0.18em" },
              }, sas),
              h("span", { key: "h", style: { color: C.muted, marginLeft: "6px" } },
                pick("与对端显示相同才同意", "must match the peer"))),
            requestId === "" ? null : h("div", {
              key: "grant",
              style: { marginTop: "8px", borderTop: "1px solid " + C.border, paddingTop: "8px" },
            },
              h("div", { key: "summary", style: { fontSize: "12px", lineHeight: "18px", color: C.muted } },
                pick("将授予 ", "would grant ") + grantSummary(request.defaultGrant)),
              h("div", { key: "edit-row", style: { display: "flex", gap: "8px", marginTop: "8px" } },
                button("toast-grant", editing ? pick("收起授权", "Collapse grant") : pick("调整授权…", "Adjust grant…"), function () {
                  if (typeof editState[1] === "function") editState[1](editing ? "" : requestId)
                }, { disabled: busy })),
              editing ? h("div", { key: "editor", style: { marginTop: "10px" } }, toastGrantEditor(draft, patchDraft, busy)) : null),
            h("div", { key: "actions", style: { display: "flex", gap: "8px", marginTop: "8px" } },
              button("toast-allow", pick("同意", "Allow"), function () {
                void run(store, "approve", {
                  id: requestId,
                  decision: "allow",
                  grant: grantFromDraft(draft),
                  remember: true,
                }, { notice: pick("已同意该连接请求", "Request allowed") })
              }, { kind: "primary", disabled: busy, style: { flex: "1 1 auto" } }),
              button("toast-deny", pick("拒绝", "Deny"), function () {
                void run(store, "approve", { id: requestId, decision: "deny" },
                  { notice: pick("已拒绝该请求", "Request denied") })
              }, { kind: "danger", disabled: busy, style: { flex: "1 1 auto" } }))))
        }
        blocks.push(h("div", { key: "hint", style: { fontSize: "12px", lineHeight: "18px", color: C.muted, marginTop: "10px" } },
          pick("同意即按默认授权放行；想调整目录、Shell 或中转权限，请打开侧边栏面板。",
            "Allowing uses the default grant. Open the sidebar panel to adjust roots, shell or relay access.")))
        return shell("request", blocks)
      }
      const peerName = asStr(fresh.length > 0 && fresh[0].name, "") ||
        asStr(conn && conn.peerName, "") || pick("对端", "peer")
      return shell("connected", [
        h("div", { key: "head", style: { display: "flex", alignItems: "center", gap: ROW_GAP + "px" } },
          statusDot("connected", DOT_SIZE),
          h("div", { key: "t", style: { flex: "1 1 auto", minWidth: 0, fontSize: "14px", lineHeight: "22px", fontWeight: 500 } },
            pick("已连接 ", "connected ") + peerName),
          close),
        h("div", { key: "sub", style: { marginTop: "4px", fontSize: "12px", lineHeight: "18px", color: C.muted } },
          pick("工具已解锁，可以直接操作对端。", "Tools are unlocked; the peer is ready.")),
      ])
    }
    function BridgePanel() {
      let store = null
      let hookError = null
      const ui = {}
      try {
        store = useBridgeStore()
        const manual = react.useState("")
        const code = react.useState("")
        const draft = react.useState(null)
        const linkDraft = react.useState(null)
        const sessionDraft = react.useState(null)
        const grantEditFor = react.useState("")
        const sessionEditFor = react.useState("")
        const auditOverride = react.useState(null)
        // R314: which device of the board is picked, and which deviceId was last copied (the board's own state).
        const netPick = react.useState("")
        const netCopied = react.useState("")
        // R325: the directory listing a person asked for, kept per card (keyed by the device it belongs to).
        const netList = react.useState(null)
        // R333: the last recording a person asked for, so the card can say what landed and where.
        const netCapture = react.useState(null)
        ui.manualAddr = manual[0]
        ui.setManualAddr = manual[1]
        ui.pairCode = code[0]
        ui.setPairCode = code[1]
        ui.draftState = draft
        // A draft per device, for the two device lists and the approval card.
        // They are separate slots because a link and a session can name the SAME
        // deviceId with different grants (this machine's grant on the far side vs
        // the far side's grant here), and sharing one slot would cross the two.
        ui.linkDraftState = linkDraft
        ui.sessionDraftState = sessionDraft
        ui.grantEditFor = grantEditFor[0]
        ui.setGrantEditFor = grantEditFor[1]
        ui.sessionEditFor = sessionEditFor[0]
        ui.setSessionEditFor = sessionEditFor[1]
        ui.auditOverride = auditOverride[0]
        ui.setAuditOverride = auditOverride[1]
        ui.netPick = netPick[0]
        ui.setNetPick = netPick[1]
        ui.netCopied = netCopied[0]
        ui.setNetCopied = netCopied[1]
        ui.netList = netList[0]
        ui.setNetList = netList[1]
        ui.netCapture = netCapture[0]
        ui.setNetCapture = netCapture[1]
        // R339: the notes ledger, read and written from the panel (the backend routes existed, the UI did not).
        const notesState = react.useState([])
        const noteCounts = react.useState(null)
        const noteDraft = react.useState("")
        const noteBusy = react.useState(false)
        ui.notes = notesState[0]
        ui.noteCounts = noteCounts[0]
        ui.noteDraft = noteDraft[0]
        ui.noteBusy = noteBusy[0]
        ui.setNoteDraft = noteDraft[1]
        ui.reloadNotes = function () {
          noteBusy[1](true)
          fetch('/api/dsh-link-notes/state', { headers: { accept: 'application/json' } })
            .then(function (answer) { return answer.json() })
            .then(function (body) {
              notesState[1](Array.isArray(body && body.notes) ? body.notes : [])
              noteCounts[1](isObj(body) && isObj(body.counts) ? body.counts : null)
            })
            .catch(function () { /* the panel keeps the previous list rather than blanking */ })
            .then(function () { noteBusy[1](false) })
        }
        ui.addNote = function () {
          const text = asStr(noteDraft[0], '').trim()
          if (text === '') return
          noteBusy[1](true)
          fetch('/api/dsh-link-notes/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text }) })
            .then(function (answer) { return answer.json() })
            .then(function (body) {
              if (body && body.ok === true) { noteDraft[1](''); ui.reloadNotes() }
              else store.setError(pick('便条没有写进去：', 'the note was not saved: ') + asStr(body && body.refusal, '') )
            })
            .catch(function (error) { store.setError(String(error && error.message ? error.message : error)) })
            .then(function () { noteBusy[1](false) })
        }
        // Read the ledger once when the panel comes up; every write refreshes it.
        // R376: the OFM offer. Detection is read once when the panel opens; the answer is POSTed only when the user presses
        // 接入, and "以后再说" remembers the dismissal so the panel does not keep asking.
        const ofmPresence = react.useState(null)
        const ofmJoin = react.useState(null)
        const ofmBusy = react.useState(false)
        ui.ofm = ofmPresence[0]
        ui.ofmJoin = ofmJoin[0]
        ui.ofmBusy = ofmBusy[0]
        ui.joinOfm = function () {
          ofmBusy[1](true)
          fetch('/__shell/ofm/join', { method: 'POST' })
            .then(function (answer) { return answer.json() })
            .then(function (body) { ofmJoin[1](isObj(body) ? body : null) })
            .catch(function (error) { ofmJoin[1]({ ok: false, detail: String(error && error.message ? error.message : error) }) })
            .then(function () { ofmBusy[1](false) })
        }
        ui.dismissOfm = function () {
          try { window.localStorage.setItem('dsh-ofm-later', 'true') } catch (error) { /* a browser without storage still means no */ }
          ofmPresence[1](null)
        }
        react.useEffect(function () {
          if (ui.reloadNotes !== undefined) ui.reloadNotes()
          var later = null
          try { later = window.localStorage.getItem('dsh-ofm-later') } catch (error) { later = null }
          if (later === 'true') return
          fetch('/__shell/ofm')
            .then(function (answer) { return answer.json() })
            .then(function (body) { ofmPresence[1](isObj(body) && body.detected === true ? body : null) })
            .catch(function () { /* no detector here is not an error worth a banner */ })
        }, [])
      } catch (err) {
        hookError = err
      }
      if (hookError === null && store !== null) {
        try { useBridgePolling(store, store.read().open) } catch (err) { hookError = err }
      }
      if (hookError !== null || store === null) {
        return h("div", {
          "data-bridge-panel": "error",
          style: sx(styleObject(), {
            position: "fixed", left: "12px", bottom: "52px", width: "360px",
            maxWidth: "calc(100vw - 24px)", zIndex: 40, pointerEvents: "auto", boxSizing: "border-box",
            background: C.surface, borderColor: C.danger,
          }),
        }, pick("桥接面板初始化失败：", "The bridge panel failed to initialize: ") + msgOf(hookError))
      }
      const state = store.read()
      state.ui = ui
      if (state.open !== true) {
        return h("div", {
          "data-bridge-panel": "closed",
          "aria-hidden": "true",
          style: { display: "none" },
        })
      }
      try {
        return renderPanel(store, state)
      } catch (err) {
        log("error", "panel render failed", err)
        return h("div", {
          "data-bridge-panel": "error",
          style: sx(styleObject(), {
            position: "fixed", left: "12px", bottom: "52px", width: "360px",
            maxWidth: "calc(100vw - 24px)", maxHeight: "60vh", overflow: "auto", zIndex: 40,
            pointerEvents: "auto", boxSizing: "border-box", background: C.surface, borderColor: C.danger,
          }),
        }, pick("桥接面板渲染失败：", "The bridge panel failed to render: ") + msgOf(err))
      }
    }

    /* ------------------------------------------------------------------ *
     * Hooks.
     * ------------------------------------------------------------------ */

    function useBridgeStore() {
      const store = getStore()
      const rev = react.useRef(0)
      const setter = react.useState(0)
      react.useEffect(function () {
        let alive = true
        const off = store.subscribe(function () {
          if (!alive) return
          rev.current = (asNum(rev.current, 0) || 0) + 1
          if (typeof setter[1] === "function") setter[1](rev.current)
        })
        return function () {
          alive = false
          safe(function () { off() }, undefined)
        }
      }, [])
      return store
    }

    // Polls `state` every 1500 ms while the panel is open, and only then.
    /**
     * Poll the host.
     *
     * Runs even with the panel closed, because the notification toast must learn
     * that a connection request arrived without the user having opened anything —
     * that is the whole point of a notification. Closed-panel polling is slower,
     * so an idle page costs half as much.
     */
    function useBridgePolling(store, open) {
      react.useEffect(function () {
        if (store === null) return undefined
        let stopped = false
        let inFlight = false
        const tick = function () {
          if (stopped || inFlight) return
          // A theme switch must land on the next refresh, and the client plane
          // offers no theme-change event, so the panel's own cadence carries it.
          applyScheme(hostCtx)
          inFlight = true
          const done = function () { inFlight = false }
          rpc("state", {}).then(function (value) {
            done()
            if (stopped) return
            store.setSnapshot(value)
            store.setError(null)
          }, function (err) {
            done()
            if (stopped) return
            store.setError(msgOf(err))
          })
        }
        tick()
        if (typeof setInterval !== "function") {
          return function () { stopped = true }
        }
        const timer = setInterval(tick, open === true ? POLL_MS : IDLE_POLL_MS)
        return function () {
          stopped = true
          if (typeof clearInterval === "function") safe(function () { clearInterval(timer) }, undefined)
        }
      }, [open])
    }

    /* ------------------------------------------------------------------ *
     * The panel contribution (R192).
     *
     * The panel publishes a client-face service, `linkPanel`, whose
     * `declare(definition)` registers one item and returns its disposer. This half
     * contributes exactly ONE item — the bridge's own connection reading — under
     * its own locale namespace.
     *
     * Four rules this section obeys:
     *
     *   fail-closed     a page with no `linkPanel` service (or one that refuses the
     *                   item) must not throw and must not take the footer, the panel
     *                   or the toast down with it: the refusal is caught, named in
     *                   THIS package's own marker, and the rest of apply() runs
     *                   exactly as before.
     *   its own words   the item's copy is this package's locale namespace,
     *                   registered through the kernel's own locale service and read
     *                   through `t`; the body is the reading this package already
     *                   shows in its footer, verbatim — no number is invented here.
     *   data, live      `title` and `body` are thunks, read again on every
     *                   projection (the kernel's own rule for registry copy:
     *                   "Thunked copy; read again"), so a language switch and a
     *                   connection state change both land without re-declaring the
     *                   item.
     *   refresh, named  a thunk is only half of it: the panel draws the projection it
     *                   last TOOK, so the store change is also announced through the
     *                   seam's named refresh path, `notify()` — an event on the store
     *                   notification, never a timer of this half's own, and released
     *                   with the item's own disposer.
     * ------------------------------------------------------------------ */

    /** The client-face service the panel publishes: `declare(definition) -> disposer`. */
    const LINK_PANEL_SERVICE = "linkPanel"
    /** This package's one contribution. Namespaced, so two packages cannot collide on an id. */
    const PANEL_ITEM_ID = "dsh-lan-bridge:connection"
    /** The registry's word for "a state a person should see" — the panel's own closed set. */
    const PANEL_ITEM_KIND = "status"
    /** Who the item belongs to: this package, spelled as its package name. */
    const PANEL_ITEM_SOURCE = "dsh-lan-bridge"
    /** Below the panel's own guide entry (40): a contribution never claims the first slot. */
    const PANEL_ITEM_ORDER = 20
    /** Where this half records what its contribution did; the panel's marker is the panel's. */
    const PANEL_ITEM_MARKER = "__dshLanBridgePanel"

    /**
     * The words this contribution adds, in both languages, with the SAME key set.
     *
     * The reading itself is not here: it is the package's existing connection reading
     * (`footerText`), which is data about the world rather than copy about this item.
     */
    const COPY_ZH = {
      "panel.item.title": "连接状态",
      "panel.item.pending": "连接读数还没回来",
      "panel.item.error": "读数失败：{detail}",
    }
    const COPY_EN = {
      "panel.item.title": "Connection status",
      "panel.item.pending": "the connection reading has not arrived yet",
      "panel.item.error": "reading failed: {detail}",
    }

    /** The translate bound to this package's namespace, or null when the service is absent. */
    let T = null

    /** The kernel's own placeholder form: `{name}`, left alone when the parameter is missing. */
    function substitute(template, params) {
      if (!isObj(params)) return String(template)
      return String(template).replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      })
    }

    /**
     * Register this package's dictionaries through the kernel locale service and bind `t`.
     *
     * A second registration of the same (namespace, locale) throws in the service's own
     * words; that refusal is caught here (the dictionary is already owned by this half)
     * and never reaches the shell. A page with no locale service at all is not a failure:
     * `t` then answers from the same dictionary.
     */
    function bindTranslate(ctx) {
      const service = localeService(ctx)
      if (service !== null && typeof service.register === "function") {
        safe(function () { service.register(LOCALE_NS, { zh: COPY_ZH, en: COPY_EN }) }, null)
      }
      const bound = service !== null && typeof service.bind === "function"
        ? safe(function () { return service.bind(LOCALE_NS) }, null)
        : null
      if (typeof bound === "function") T = bound
      return T
    }

    /**
     * One of this contribution's own words.
     *
     * Through the kernel's translator when the locale service is there; otherwise the
     * SAME dictionary answers — the words are the dictionary's either way, never a
     * sentence spelled out at the call site. An unknown key arrives as itself, like the
     * kernel's own lookup chain does for an unanswered key.
     */
    function t(key, params) {
      if (typeof T === "function") return T(key, params)
      const dictionary = isEnglish() ? COPY_EN : COPY_ZH
      const template = Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key
      return substitute(template, params)
    }

    /**
     * The connection reading the item shows.
     *
     * It is the package's own: the footer line the user already sees, from the same store
     * and the same snapshot, with the host's own error text when the read failed. Nothing
     * here counts, averages or estimates — an unread state says so instead of showing a
     * zero that would read as "not connected".
     */
    function connectionReading(store) {
      const state = store.read()
      if (state.error !== null && state.error !== undefined) return t("panel.item.error", { detail: state.error })
      if (!isObj(state.snapshot)) return t("panel.item.pending")
      return footerText(state.snapshot, dotState(state.snapshot, null))
    }

    /**
     * The one definition this half declares.
     * @returns the item: the registry's five fields plus the two live thunks.
     */
    function panelItemDefinition(store) {
      return {
        id: PANEL_ITEM_ID,
        kind: PANEL_ITEM_KIND,
        source: PANEL_ITEM_SOURCE,
        order: PANEL_ITEM_ORDER,
        title: function () { return t("panel.item.title") },
        body: function () { return connectionReading(store) },
      }
    }

    /** Record what the contribution did in this package's own marker; never throws. */
    function markPanelItem(store, declared, failed) {
      safe(function () {
        if (typeof globalThis === "undefined") return
        globalThis[PANEL_ITEM_MARKER] = {
          mounted: true,
          id: PANEL_ITEM_ID,
          kind: PANEL_ITEM_KIND,
          source: PANEL_ITEM_SOURCE,
          ns: LOCALE_NS,
          declared: declared,
          title: t("panel.item.title"),
          body: connectionReading(store),
          failed: failed,
        }
      }, undefined)
    }

    /**
     * The panel's contribution service, or null when this page has none.
     *
     * `ctx.get` is the strict read (the service store); `ctx.linkPanel` covers a ctx that
     * is a plain object. Neither read may throw: a page without the panel is a page this
     * half must leave alone.
     */
    function linkPanelService(ctx) {
      const fromGet = safe(function () {
        return ctx && typeof ctx.get === "function" ? ctx.get(LINK_PANEL_SERVICE) : null
      }, null)
      if (fromGet && typeof fromGet.declare === "function") return fromGet
      const direct = safe(function () { return ctx ? ctx[LINK_PANEL_SERVICE] : null }, null)
      return direct && typeof direct.declare === "function" ? direct : null
    }

    /**
     * Declare this package's item, fail-closed, and bind its refresh to the store.
     *
     * @returns the disposer that takes the item back out AND stops the refresh, or null
     *   when there is no service to declare to or the service refused the item — in which
     *   case the marker names which of the two it was, and the shell keeps every other
     *   registration this half made.
     */
    function declarePanelItem(ctx, store) {
      const service = linkPanelService(ctx)
      if (service === null) {
        markPanelItem(store, false, "linkPanel-unavailable: this page offers no " + LINK_PANEL_SERVICE + " service, so the connection status item was not declared")
        log("info", "no " + LINK_PANEL_SERVICE + " service in this page: the connection status item was not declared")
        return null
      }
      let disposer = null
      try {
        disposer = service.declare(panelItemDefinition(store))
      } catch (err) {
        markPanelItem(store, false, "linkPanel-declare-refused: " + msgOf(err))
        log("warn", "the panel refused the connection status item", err)
        return null
      }
      markPanelItem(store, true, null)
      // The reading moves with the store: each poll tick, each error and each language
      // switch lands in the item's thunks and in this half's marker, with no re-declaring.
      // Thunks alone are not enough, though: the panel draws the text of the projection it
      // last TOOK, so a store change is also passed on through the seam's named refresh
      // path — `notify()`, "my reading moved, take a fresh projection" — which is what
      // makes the drawn row move with the reading and not a step behind it.
      //
      // An event, not a cadence. This half starts no timer here: `notify()` is called when
      // the store says it changed, and only then (R191: a second clock racing the panel's
      // own judgement is how a reading and the row drawn from it drift apart). A page whose
      // seam has no `notify` (an older panel) still gets the item; only the refresh is
      // missing, and that is not an error.
      function refreshPanelItem() {
        markPanelItem(store, true, null)
        safe(function () {
          if (typeof service.notify === "function") service.notify()
        }, undefined)
      }
      // The subscription is released by the disposer THIS function returns, and released
      // BEFORE the seam's own disposer runs: once the item is gone, a store change must not
      // reach the panel at all.
      let off = null
      safe(function () { off = store.subscribe(refreshPanelItem) }, undefined)
      return function () {
        const unsubscribe = off
        off = null
        safe(function () { if (typeof unsubscribe === "function") unsubscribe() }, undefined)
        releasePanelItem(disposer)
      }
    }

    /** Run the seam's disposer, whatever shape it came back in; never throws. */
    function releasePanelItem(disposer) {
      safe(function () {
        if (typeof disposer === "function") { disposer(); return }
        if (disposer !== null && typeof disposer === "object" && typeof disposer.dispose === "function") disposer.dispose()
      }, undefined)
    }

    /**
     * Bind the contribution to this plugin's lifetime through ctx.effect, with the same
     * fallback the slot registrations use: a runtime without an effect API still gets the
     * item, and a runtime whose effect API throws does not get it twice.
     */
    function registerPanelItem(ctx, store) {
      if (typeof ctx.effect === "function") {
        let ran = false
        try {
          ctx.effect(function () {
            ran = true
            const disposer = declarePanelItem(ctx, store)
            return function () { releasePanelItem(disposer) }
          }, "dsh-lan-bridge: panel contribution")
          return
        } catch (err) {
          log("warn", "ctx.effect failed for the panel contribution", err)
          if (ran) return
        }
      }
      safe(function () { declarePanelItem(ctx, store) }, undefined)
    }

    /* ------------------------------------------------------------------ *
     * Plugin.
     * ------------------------------------------------------------------ */

    function apply(ctx) {
      hostCtx = ctx
      // Pick the light or dark fallback set before the first render.
      applyScheme(ctx)
      readLocale(ctx)
      // The words this half contributes to the panel come from its own locale namespace.
      bindTranslate(ctx)
      const store = getStore()

      registerSlot(ctx, "sidebar.footer.action", "dsh-lan-bridge: sidebar footer control", function () {
        return ctx.slots.register({
          name: "sidebar.footer.action",
          id: SLOT_ID,
          order: 0.5,
          locale: LOCALE_NS,
        }, BridgeFooter)
      })

      registerSlot(ctx, "shell.overlay", "dsh-lan-bridge: bridge panel overlay", function () {
        return ctx.slots.register({
          name: "shell.overlay",
          id: PANEL_SLOT_ID,
          order: 50,
        }, BridgePanel)
      })

      // The notification toast: a connection request has a deadline, so it must
      // find the user instead of waiting, folded away, at the bottom of a panel.
      registerSlot(ctx, "shell.overlay", "dsh-lan-bridge: notification toast", function () {
        return ctx.slots.register({
          name: "shell.overlay",
          id: TOAST_SLOT_ID,
          order: 60,
        }, BridgeToast)
      })

      // The footer cannot poll (polling belongs to the open panel), so seed the
      // shared store once for a meaningful dot and label on first paint.
      safe(function () {
        rpc("state", {}).then(function (value) {
          store.setSnapshot(value)
          store.setError(null)
        }, function (err) {
          store.setError(msgOf(err))
        })
      }, undefined)

      // The panel contribution (R192): one `status` item, declared fail-closed — a page
      // with no panel service keeps its footer, its overlay and its toast.
      registerPanelItem(ctx, store)

      try {
        ctx.effect(function () {
          return function () { store.close() }
        }, "dsh-lan-bridge: close the panel on dispose")
      } catch (err) {
        log("error", "could not register the dispose hook", err)
      }

      log("info", "client half ready (primitives " + (hasPrimitives ? "available" : "absent") + ", locale " + (LOCALE_ID || "default") + ")")
    }

    // Bind a slot registration to this plugin's lifetime through ctx.effect,
    // falling back to a plain registration only when the runtime has no effect
    // API at all (and only if the factory never ran).
    function registerSlot(ctx, slotName, label, factory) {
      // `slots.inject` is REQUIRED for a third-party bundle: the owning slot may
      // mount after this plugin does, and registering into an undeclared slot
      // throws. The fallback keeps older/host-specific shapes working.
      function install() {
        const slots = ctx.slots
        if (slots && typeof slots.inject === "function") return slots.inject(slotName, factory)
        return factory()
      }
      if (typeof ctx.effect === "function") {
        let ran = false
        try {
          ctx.effect(function () {
            ran = true
            return install()
          }, label)
          return
        } catch (err) {
          log("warn", "ctx.effect failed for " + label, err)
          if (ran) return
        }
      }
      try {
        install()
      } catch (err) {
        log("error", "could not register " + label, err)
      }
    }

    const inject = ["slots", "connection", "locale", "linkPanel"]
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})


