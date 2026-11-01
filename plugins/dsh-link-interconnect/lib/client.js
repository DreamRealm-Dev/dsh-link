window.__ModuleLoader__.load({ id: "dsh-link-interconnect", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/dsh-link-interconnect/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  COPY: () => COPY,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");

// plugins/dsh-link-interconnect/src/client/interconnect.css
var interconnect_default = `/* dsh-link-interconnect: the client half's material.
 *
 * Scoped under the dli- prefix and mounted for this plugin's lifetime (see apply()). It wears the
 * shell's own tokens - no literal palette - and the same glass treatment the sidebar uses, so the
 * consent card reads as part of the product rather than a banner from elsewhere.
 */

/* ---------------------------------------------------------------- consent stack */

.dli-consentStack {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 360px;
  max-width: calc(100vw - 28px);
  pointer-events: none;
}

.dli-consent {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  padding: 12px 14px 13px;
  border-radius: var(--dsw-radius-lg, 16px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #212226) 78%, transparent);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  backdrop-filter: blur(28px) saturate(160%);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.14);
  color: var(--dsw-alias-label-primary, #ededee);
  font: var(--dsw-font-xs-13, 13px/20px system-ui, sans-serif);
}

.dli-consentHead {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.dli-consentTitle {
  flex: 1 1 auto;
  min-width: 0;
  font: var(--dsw-font-sm-14, 14px/22px system-ui, sans-serif);
  font-weight: 600;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dli-risk {
  flex: 0 0 auto;
  margin-top: 2px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  font-weight: 600;
  white-space: nowrap;
}

.dli-risk-low {
  color: var(--dsw-alias-label-success, #4caf7d);
  border-color: color-mix(in srgb, var(--dsw-alias-label-success, #4caf7d) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-success, #4caf7d) 14%, transparent);
}

.dli-risk-medium {
  color: var(--dsw-alias-label-warning, #d9a03c);
  border-color: color-mix(in srgb, var(--dsw-alias-label-warning, #d9a03c) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-warning, #d9a03c) 14%, transparent);
}

.dli-risk-high {
  color: var(--dsw-alias-label-danger, #e05252);
  border-color: color-mix(in srgb, var(--dsw-alias-label-danger, #e05252) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-danger, #e05252) 14%, transparent);
}

.dli-consentPeer {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--dsw-alias-label-secondary, #b7bbc2);
}

.dli-peerName {
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #ededee);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dli-consentActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

/* ---------------------------------------------------------------- shared bits */

.dli-dim {
  color: var(--dsw-alias-label-tertiary, #8b929c);
}

.dli-mono {
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8b929c);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14em;
}

.dli-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.dli-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  height: 20px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: var(--dsw-alias-bg-l1, rgba(255, 255, 255, 0.04));
  color: var(--dsw-alias-label-secondary, #b7bbc2);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  white-space: nowrap;
}

.dli-chipOk {
  color: var(--dsw-alias-label-success, #4caf7d);
  border-color: color-mix(in srgb, var(--dsw-alias-label-success, #4caf7d) 40%, transparent);
}

.dli-chipMuted {
  color: var(--dsw-alias-label-tertiary, #8b929c);
}

.dli-chipState {
  color: var(--dsw-alias-label-primary, #ededee);
}

.dli-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: color-mix(in srgb, var(--dsw-alias-bg-l1, #ffffff) 40%, transparent);
}

.dli-detailRow {
  display: flex;
  gap: 8px;
  min-width: 0;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
}

.dli-detailRow dt {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, #8b929c);
}

.dli-detailRow dd {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-secondary, #b7bbc2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- buttons */

.dli-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 14px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid transparent;
  font: var(--dsw-font-xs-13, 13px/20px system-ui, sans-serif);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.dli-btn:disabled {
  cursor: default;
  opacity: 0.55;
}

/* The accent fill and its label must never resolve to the same colour. This skin resolves both
 * --dsw-alias-button-primary-fill and --dsw-alias-brand-primary-invert to #f9fafb, which painted
 * the label white on a white pill; the label now comes from the theme's layer colour, so it is
 * dark on the light accent fill in the dark theme and light on the dark accent fill in the light
 * theme. Same pair on hover, where the fill only shifts one step. */
.dli-btnPrimary {
  background: var(--dsw-alias-button-primary-fill, #e8e8e8);
  color: var(--dsw-alias-bg-layer-1, #101010);
  font-weight: 600;
}

.dli-btnPrimary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, #ffffff);
  color: var(--dsw-alias-bg-layer-1, #101010);
}

.dli-btnGhost {
  background: transparent;
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16));
  color: var(--dsw-alias-label-primary, #ededee);
}

.dli-btnGhost:hover:not(:disabled) {
  background: var(--dsw-alias-bg-l1, rgba(255, 255, 255, 0.06));
}

.dli-btnSmall {
  height: 24px;
  padding: 0 10px;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
}

/* ---------------------------------------------------------------- sidebar footer entry */

.dli-footerBtn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b7bbc2);
  font: var(--dsw-font-xs-13, 13px/20px system-ui, sans-serif);
  cursor: pointer;
  text-align: left;
}

.dli-footerBtn:hover,
.dli-footerBtn[data-open="true"] {
  background: var(--dsw-alias-bg-l1, rgba(255, 255, 255, 0.06));
  color: var(--dsw-alias-label-primary, #ededee);
}

.dli-footerBtn[data-link-footer-wide="false"] {
  justify-content: center;
  padding: 0;
}

.dli-footerIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.dli-footerLabel {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dli-footerCount {
  flex: 0 0 auto;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--dsw-alias-label-danger, #e05252);
  color: #fff;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  font-weight: 600;
  text-align: center;
}

/* ---------------------------------------------------------------- peers surface */

.dli-panelHidden {
  display: none;
}

/* The panel's anchored box. The panel itself is a surface the skin dresses with its own rules
 * (it sets position: relative on it), so position: fixed, the offsets and the stacking order live
 * on this un-dressed host: no skin rule can turn the anchor back into an in-flow box, and the
 * body-level portal in peers.tsx puts it above the sidebar's glass instead of under it. */
.dli-panelHost {
  position: fixed;
  left: 12px;
  bottom: 52px;
  z-index: 2147483000;
  display: flex;
  width: 384px;
  max-width: calc(100vw - 24px);
  max-height: min(72vh, calc(100vh - 100px));
  pointer-events: auto;
}

.dli-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: var(--dsw-radius-lg, 16px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #212226) 82%, transparent);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  backdrop-filter: blur(28px) saturate(160%);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.14);
  color: var(--dsw-alias-label-primary, #ededee);
  font: var(--dsw-font-xs-13, 13px/20px system-ui, sans-serif);
}

.dli-panelHead {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px 8px;
}

.dli-panelTitles {
  flex: 1 1 auto;
  min-width: 0;
}

.dli-panelTitle {
  margin: 0;
  font: var(--dsw-font-sm-14, 14px/22px system-ui, sans-serif);
  font-weight: 600;
}

.dli-panelSub {
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary, #8b929c);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
}

.dli-iconBtn {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #b7bbc2);
  font-size: 16px;
  line-height: 26px;
  cursor: pointer;
}

.dli-iconBtn:hover {
  background: var(--dsw-alias-bg-l1, rgba(255, 255, 255, 0.06));
  color: var(--dsw-alias-label-primary, #ededee);
}

.dli-identity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px 8px;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
}

.dli-routeNote,
.dli-actionError {
  margin: 0 14px 8px;
  padding: 6px 9px;
  border-radius: var(--dsw-radius-sm, 8px);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
}

.dli-routeNote {
  color: var(--dsw-alias-label-tertiary, #8b929c);
  background: var(--dsw-alias-bg-l1, rgba(255, 255, 255, 0.04));
}

.dli-actionError {
  color: var(--dsw-alias-label-danger, #e05252);
  background: color-mix(in srgb, var(--dsw-alias-label-danger, #e05252) 12%, transparent);
}

.dli-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dli-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.03));
}

.dli-sectionHead {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dli-sectionTitle {
  flex: 1 1 auto;
  font-weight: 600;
}

.dli-sectionCount {
  color: var(--dsw-alias-label-tertiary, #8b929c);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
}

.dli-empty {
  color: var(--dsw-alias-label-tertiary, #8b929c);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  padding: 2px 0;
}

.dli-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dli-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 9px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: color-mix(in srgb, var(--dsw-alias-bg-l1, #ffffff) 45%, transparent);
}

.dli-rowMain {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.dli-rowName {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 15em;
}

.dli-rowSub {
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  color: var(--dsw-alias-label-secondary, #b7bbc2);
}

.dli-rowActions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.dli-auditRow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
}

.dli-ok {
  color: var(--dsw-alias-label-success, #4caf7d);
}

.dli-fail {
  color: var(--dsw-alias-label-danger, #e05252);
}

.dli-panelFoot {
  flex: 0 0 auto;
  padding: 8px 14px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  color: var(--dsw-alias-label-tertiary, #8b929c);
  font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
  text-align: right;
}
`;

// plugins/dsh-link-interconnect/src/protocol/types.ts
var LINK_PREFIX = "/link/v1";
var API_PREFIX = "/api/dsh-link-interconnect";
var ROUTES = Object.freeze({
  // software-facing, forwarded by the shell from /link/*
  contract: LINK_PREFIX + "/contract",
  handshake: LINK_PREFIX + "/handshake",
  handshakeConfirm: LINK_PREFIX + "/handshake/confirm",
  invoke: LINK_PREFIX + "/invoke",
  events: LINK_PREFIX + "/events",
  embedToken: LINK_PREFIX + "/embed/token",
  embedSession: LINK_PREFIX + "/embed/session",
  openaiPrefix: LINK_PREFIX + "/openai",
  anthropicPrefix: LINK_PREFIX + "/anthropic",
  // LINK's own declaration, so software can discover LINK by the same channel (the shell's static
  // catch-all forwards this GET to the kernel; no /link forwarding needed for it).
  wellKnown: "/.well-known/link-interconnect.json",
  // in-app (the client half polls these; all cookie-gated /api paths)
  state: API_PREFIX + "/state",
  consent: API_PREFIX + "/consent",
  adapters: API_PREFIX + "/adapters",
  audit: API_PREFIX + "/audit",
  settings: API_PREFIX + "/settings"
});
var SCOPES = Object.freeze([
  "models.provide",
  "models.proxy",
  "tools.expose",
  "embed.session",
  "consent.manage",
  "audit.read"
]);
var CAPS = Object.freeze({
  modelsProvide: "models.provide",
  toolsExpose: "tools.expose",
  sessionEmbed: "session.embed",
  modelsProxy: "models.proxy"
});
var ERROR_CODES = Object.freeze({
  unauthorized: "link/unauthorized",
  scopeMissing: "link/scope-missing",
  versionUnsupported: "link/version-unsupported",
  consentRequired: "link/consent-required",
  peerUnavailable: "link/peer-unavailable",
  rateLimited: "link/rate-limited",
  payloadTooLarge: "link/payload-too-large",
  idempotencyConflict: "link/idempotency-conflict",
  badRequest: "link/bad-request",
  notFound: "link/not-found",
  internal: "link/internal",
  methodNotAllowed: "link/method-not-allowed"
});
var LIMITS = Object.freeze({
  /** Largest request body any /link/v1 route reads, in bytes. */
  bodyBytes: 1024 * 1024,
  /** Largest event backlog / SSE replay window, in events. */
  eventBacklog: 200,
  /** Idempotency records live this long, in ms. */
  idempotencyMs: 10 * 60 * 1e3,
  /** access token lifetime, ms. */
  accessTokenMs: 15 * 60 * 1e3,
  /** refresh token lifetime, ms. */
  refreshTokenMs: 30 * 24 * 60 * 60 * 1e3,
  /** embed token lifetime, ms (aud = origin). */
  embedTokenMs: 10 * 60 * 1e3,
  /** Default requests-per-minute cap for an adapter/peer when the declaration names none. */
  rpm: 60,
  /** Default upstream timeout for one adapter request, ms. */
  timeoutMs: 15e3,
  /** Health check period and consecutive failures before unavailable. */
  healthMs: 6e4,
  healthFailures: 3
});

// plugins/dsh-link-interconnect/src/client/state.ts
var POLL_INTERVAL_MS = 3e3;
function pendingConsentOf(data) {
  return data === null ? [] : data.pendingConsent;
}
function shortLinkId(linkId) {
  if (linkId.length <= 12) return linkId;
  return linkId.slice(0, 10) + "\u2026";
}
function messageOf(error) {
  const held = error;
  if (held !== null && typeof held === "object" && held.message !== void 0) return String(held.message);
  return String(error);
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function isPluginSnapshot(value) {
  if (!isRecord(value)) return false;
  return typeof value.protocol === "string" && typeof value.linkId === "string" && Array.isArray(value.peers) && Array.isArray(value.grants) && Array.isArray(value.pendingConsent) && Array.isArray(value.bindings) && Array.isArray(value.adapters) && Array.isArray(value.audit) && isRecord(value.counts);
}
function isAbortError(error) {
  return isRecord(error) && error.name === "AbortError";
}
function refusalOf(payload, status) {
  if (isRecord(payload) && isRecord(payload.error)) {
    const code = typeof payload.error.code === "string" ? payload.error.code : void 0;
    const message = typeof payload.error.message === "string" ? payload.error.message : "HTTP " + String(status);
    return code === void 0 ? { message } : { code, message };
  }
  return { message: "HTTP " + String(status) };
}
var EMPTY_STATE = Object.freeze({
  data: null,
  route: "unknown",
  lastAt: null,
  open: false,
  busy: Object.freeze([]),
  actionError: null
});
function createClientState(options = {}) {
  return new InterconnectClientState(options);
}
var InterconnectClientState = class {
  current = EMPTY_STATE;
  listeners = /* @__PURE__ */ new Set();
  intervalMs;
  fetcher;
  running = false;
  timer = null;
  controller = null;
  polling = false;
  again = false;
  actions;
  constructor(options) {
    this.intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
    this.fetcher = options.fetchImpl ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : void 0);
    this.actions = Object.freeze({
      decideConsent: (id, decision) => this.write("consent:" + id, ROUTES.consent, { id, decision }),
      adapterOp: (op, id) => this.write("adapter:" + op + ":" + id, ROUTES.adapters, { op, id }),
      revokePeer: (peerLinkId) => this.write("revoke:" + peerLinkId, ROUTES.adapters, { op: "revoke-peer", id: peerLinkId }),
      openPanel: () => {
        this.patch({ open: true });
      },
      closePanel: () => {
        this.patch({ open: false });
      },
      togglePanel: () => {
        this.patch({ open: !this.current.open });
      }
    });
  }
  snapshot() {
    return this.current;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  start() {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }
  stop() {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const controller = this.controller;
    this.controller = null;
    if (controller !== null) controller.abort();
  }
  pollNow() {
    if (!this.running) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.polling) {
      this.again = true;
      return;
    }
    void this.poll();
  }
  /** One state read. Keeps the last good document on every failure, by design. */
  async poll() {
    if (!this.running) return;
    if (this.fetcher === void 0) {
      this.patch({ route: "absent", lastAt: Date.now() });
      return;
    }
    this.polling = true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const response = await this.fetcher(ROUTES.state, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "same-origin",
        signal: controller.signal
      });
      if (!this.running) return;
      if (response.status === 404 || response.status >= 500) {
        this.patch({ route: "absent", lastAt: Date.now() });
        return;
      }
      if (!response.ok) {
        this.patch({ route: "error", lastAt: Date.now(), actionError: "state HTTP " + String(response.status) });
        return;
      }
      const payload = await response.json();
      if (!this.running) return;
      if (!isPluginSnapshot(payload)) {
        this.patch({ route: "error", lastAt: Date.now(), actionError: "state document failed the wire check" });
        return;
      }
      this.patch({ data: payload, route: "live", lastAt: Date.now() });
    } catch (error) {
      if (isAbortError(error) || !this.running) return;
      this.patch({ route: "error", lastAt: Date.now(), actionError: messageOf(error) });
    } finally {
      if (this.controller === controller) this.controller = null;
      this.polling = false;
      this.schedule();
    }
  }
  /** The single scheduler: one timer, never two, and none after stop(). */
  schedule() {
    if (!this.running) return;
    if (this.again) {
      this.again = false;
      void this.poll();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, this.intervalMs);
  }
  /** One JSON write; the poll is refreshed as soon as the write settles. */
  async write(key, path, body) {
    this.patch({ busy: this.busyWith(key), actionError: null });
    if (this.fetcher === void 0) {
      this.patch({ busy: this.busyWithout(key), actionError: "fetch is unavailable on this page" });
      return { ok: false, error: { message: "fetch is unavailable on this page" } };
    }
    try {
      const response = await this.fetcher(path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body)
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        void error;
      }
      const ok = response.status >= 200 && response.status < 300 && isRecord(payload) && payload.ok === true;
      if (!ok) {
        const refusal = refusalOf(payload, response.status);
        this.patch({ busy: this.busyWithout(key), actionError: refusal.message });
        return { ok: false, error: refusal };
      }
      this.patch({ busy: this.busyWithout(key), actionError: null });
      this.pollNow();
      return { ok: true, result: isRecord(payload) ? payload.result : void 0 };
    } catch (error) {
      const message = messageOf(error);
      this.patch({ busy: this.busyWithout(key), actionError: message });
      return { ok: false, error: { message } };
    }
  }
  busyWith(key) {
    return this.current.busy.includes(key) ? this.current.busy : Object.freeze([...this.current.busy, key]);
  }
  busyWithout(key) {
    return Object.freeze(this.current.busy.filter((held) => held !== key));
  }
  patch(partial) {
    this.current = Object.freeze({ ...this.current, ...partial });
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (error) {
        void error;
      }
    }
  }
};

// plugins/dsh-link-interconnect/src/client/consent.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var MAX_VISIBLE_CARDS = 3;
function ConsentStack(props) {
  const cards = props.pending.slice(0, MAX_VISIBLE_CARDS);
  if (cards.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      className: "dli-consentStack",
      "data-link-consent-stack": String(cards.length),
      "data-link-pending": String(props.pending.length),
      children: cards.map((request) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ConsentCard,
        {
          copy: props.copy,
          request,
          busy: props.busy.includes("consent:" + request.id),
          onDecide: props.onDecide
        },
        request.id
      ))
    }
  );
}
function ConsentCard(props) {
  const { copy, request } = props;
  const details = detailRows(request.detail);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      className: "dli-consent",
      role: "group",
      "aria-label": copy.consentAria,
      "data-link-consent-card": request.id,
      "data-link-consent-peer": request.peerLinkId,
      "data-link-consent-risk": request.risk,
      "data-link-consent-busy": props.busy ? "true" : "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dli-consentHead", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dli-risk dli-risk-" + request.risk, "data-link-consent-risk-badge": request.risk, children: riskLabel(copy, request.risk) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dli-consentTitle", title: request.title, children: request.title })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dli-consentPeer", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dli-dim", children: copy.consentPeer }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dli-peerName", title: request.peerName, children: request.peerName }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dli-mono", title: request.peerLinkId, children: shortLinkId(request.peerLinkId) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dli-chips", "data-link-consent-scopes": request.scopes.join(" "), children: request.scopes.map((scope) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dli-chip", children: scope }, scope)) }),
        details.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", { className: "dli-details", children: details.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dli-detailRow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: row.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { title: row.value, children: row.value })
        ] }, row.label)) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dli-consentActions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "dli-btn dli-btnGhost",
              disabled: props.busy,
              "data-link-consent-decision": "denied",
              onClick: () => props.onDecide(request.id, "denied"),
              children: props.busy ? copy.deciding : copy.deny
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "dli-btn dli-btnPrimary",
              disabled: props.busy,
              "data-link-consent-decision": "granted",
              onClick: () => props.onDecide(request.id, "granted"),
              children: props.busy ? copy.deciding : copy.allow
            }
          )
        ] })
      ]
    }
  );
}
function riskLabel(copy, risk) {
  if (risk === "high") return copy.riskHigh;
  if (risk === "medium") return copy.riskMedium;
  return copy.riskLow;
}
function detailRows(detail) {
  if (detail === void 0) return [];
  const rows = [];
  for (const label of Object.keys(detail)) {
    if (rows.length >= 4) break;
    rows.push({ label, value: String(detail[label]) });
  }
  return rows;
}

// plugins/dsh-link-interconnect/src/client/peers.tsx
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime2 = require("react/jsx-runtime");
function InterconnectFooter(props) {
  const pending = props.pending;
  const title = pending > 0 ? props.copy.footerLabel + "\uFF1A" + String(pending) + props.copy.footerPendingSuffix : props.copy.footerTitle;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "button",
    {
      type: "button",
      className: "dli-footerBtn",
      "data-link-footer": props.open ? "open" : "closed",
      "data-link-footer-wide": props.wide ? "true" : "false",
      "data-link-footer-route": props.route,
      "data-link-pending": String(pending),
      "data-link-footer-peers": String(props.peers),
      "data-open": props.open ? "true" : "false",
      title,
      "aria-label": props.copy.footerLabel,
      "aria-pressed": props.open,
      onClick: props.onToggle,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-footerIcon", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconLinkOutlineRegular, { size: 16 }) }),
        props.wide ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-footerLabel", children: props.copy.footerLabel }) : null,
        pending > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-footerCount", "data-link-footer-count": String(pending), children: pending }) : null
      ]
    }
  );
}
function PeersPanel(props) {
  const { copy, data } = props;
  if (!props.open) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-panelHidden", "data-link-panel": "closed", "aria-hidden": "true" });
  const peers = data === null ? [] : data.peers;
  const grants = data === null ? [] : data.grants;
  const adapters = data === null ? [] : data.adapters;
  const bindings = data === null ? [] : data.bindings;
  const audit = data === null ? [] : data.audit;
  const grantOf = (linkId) => grants.find((grant) => grant.peerLinkId === linkId);
  const bindingOf = (adapterId) => bindings.find((binding) => binding.adapterId === adapterId);
  const content = /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-panelHost", "data-link-panel": "open", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("aside", { className: "dli-panel", role: "dialog", "aria-label": copy.panelTitle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "dli-panelHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-panelTitles", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { className: "dli-panelTitle", children: copy.panelTitle }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-panelSub", children: copy.panelSubtitle })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dli-iconBtn", "data-link-panel-close": "", title: copy.close, "aria-label": copy.close, onClick: props.onClose, children: "\xD7" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-identity", "data-link-own-id": data === null ? "" : data.linkId, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-dim", children: copy.ownId }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-mono", title: data === null ? "" : data.linkId, children: data === null ? "\u2014" : shortLinkId(data.linkId) })
    ] }),
    props.route === "live" ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-routeNote", "data-link-route": props.route, children: props.route === "absent" ? copy.routePending : copy.routeStale }),
    props.actionError === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-actionError", "data-link-action-error": "", children: props.actionError }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-scroll", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Section, { copy, kind: "peers", title: copy.peersTitle, count: peers.length, empty: copy.peersEmpty, children: peers.map((peer) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        PeerRow,
        {
          copy,
          peer,
          grant: grantOf(peer.linkId),
          busy: props.busy.includes("revoke:" + peer.linkId),
          onRevoke: props.onRevoke
        },
        peer.linkId
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Section, { copy, kind: "adapters", title: copy.adaptersTitle, count: adapters.length, empty: copy.adaptersEmpty, children: adapters.map((adapter) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        AdapterRow,
        {
          copy,
          adapter,
          binding: adapter.binding ?? bindingOf(adapter.id),
          busy: props.busy,
          onOp: props.onAdapterOp
        },
        adapter.id
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Section, { copy, kind: "grants", title: copy.grantsTitle, count: grants.length, empty: copy.grantsEmpty, children: grants.map((grant) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-row", "data-link-grant": grant.peerLinkId, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-rowMain", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-mono", title: grant.peerLinkId, children: shortLinkId(grant.peerLinkId) }),
          grant.rpm === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-dim", children: String(grant.rpm) + copy.rpmSuffix })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-chips", children: grant.scopes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-dim", children: copy.peerScopesEmpty }) : grant.scopes.map((scope) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-chip", children: scope }, scope)) })
      ] }, grant.peerLinkId)) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Section, { copy, kind: "audit", title: copy.auditTitle, count: audit.length, empty: copy.auditEmpty, children: audit.slice(0, 8).map((record, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(AuditRow, { copy, record }, record.at + ":" + String(index))) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("footer", { className: "dli-panelFoot", children: props.lastAt === null ? copy.noData : copy.updatedAt + " " + formatClock(props.lastAt) + " \xB7 " + copy.refreshing })
  ] }) });
  return typeof document === "undefined" ? content : (0, import_react_dom.createPortal)(content, document.body);
}
function Section(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dli-section", "data-link-section": props.kind, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-sectionHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-sectionTitle", children: props.title }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-sectionCount", "data-link-section-count": String(props.count), children: String(props.count) })
    ] }),
    props.count === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-empty", "data-link-empty": props.kind, children: props.empty }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-rows", children: props.children })
  ] });
}
function PeerRow(props) {
  const scopes = props.grant === void 0 ? props.peer.scopes : props.grant.scopes;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-row", "data-link-peer": props.peer.linkId, "data-link-peer-status": props.peer.status, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-rowMain", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-rowName", title: props.peer.name, children: props.peer.name }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-mono", title: props.peer.linkId, children: shortLinkId(props.peer.linkId) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-chip dli-chipState", children: peerStatusLabel(props.copy, props.peer.status) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-chips", children: scopes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-dim", children: props.copy.peerScopesEmpty }) : scopes.map((scope) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-chip", children: scope }, scope)) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-rowActions", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        type: "button",
        className: "dli-btn dli-btnGhost dli-btnSmall",
        disabled: props.busy,
        "data-link-revoke": props.peer.linkId,
        onClick: () => props.onRevoke(props.peer.linkId),
        children: props.busy ? props.copy.revoking : props.copy.revoke
      }
    ) })
  ] });
}
function AdapterRow(props) {
  const detected = props.adapter.detected === true;
  const binding = props.binding;
  const opBusy = props.busy.some((key) => key.startsWith("adapter:") && key.endsWith(":" + props.adapter.id));
  const reason = props.adapter.reason ?? props.adapter.reasonCode ?? props.copy.adapterMissing;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      className: "dli-row",
      "data-link-adapter": props.adapter.id,
      "data-link-adapter-detected": detected ? "true" : "false",
      "data-link-adapter-binding": binding === void 0 ? "none" : binding.status,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-rowMain", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-rowName", title: props.adapter.name, children: props.adapter.name }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-chip " + (detected ? "dli-chipOk" : "dli-chipMuted"), "data-link-adapter-detection": detected ? "detected" : "missing", children: detected ? props.copy.adapterDetected : props.copy.adapterMissing }),
          binding === void 0 || binding.providerId === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-mono", "data-link-adapter-provider": binding.providerId, title: binding.providerId, children: binding.providerId })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dli-rowSub", children: detected ? binding === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-dim", children: props.copy.adapterNoBinding }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "data-link-adapter-status": binding.status, children: bindingStatusLabel(props.copy, binding.status) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-dim", "data-link-adapter-reason": props.adapter.reasonCode ?? "", children: reason }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-rowActions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              className: "dli-btn dli-btnGhost dli-btnSmall",
              disabled: opBusy,
              "data-link-adapter-op": "probe",
              onClick: () => props.onOp("probe", props.adapter.id),
              children: opBusy ? props.copy.adapterBusy : props.copy.adapterProbe
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              className: "dli-btn dli-btnPrimary dli-btnSmall",
              disabled: opBusy || !detected || binding !== void 0 && binding.status === "active",
              "data-link-adapter-op": "connect",
              onClick: () => props.onOp("connect", props.adapter.id),
              children: props.copy.adapterConnect
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              className: "dli-btn dli-btnGhost dli-btnSmall",
              disabled: opBusy || binding === void 0,
              "data-link-adapter-op": "disconnect",
              onClick: () => props.onOp("disconnect", props.adapter.id),
              children: props.copy.adapterDisconnect
            }
          )
        ] })
      ]
    }
  );
}
function AuditRow(props) {
  const record = props.record;
  const peer = record.peer === void 0 ? null : shortLinkId(record.peer);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dli-auditRow", "data-link-audit": record.kind, "data-link-audit-ok": record.ok ? "true" : "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-chip dli-chipMuted", children: record.kind }),
    peer === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-mono", title: record.peer, children: peer }),
    record.cap === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-dim", children: record.cap }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: record.ok ? "dli-ok" : "dli-fail", children: record.ok ? props.copy.auditOk : props.copy.auditFail }),
    record.ms === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dli-dim", children: String(record.ms) + "ms" })
  ] });
}
function peerStatusLabel(copy, status) {
  if (status === "active") return copy.statusActive;
  if (status === "pending") return copy.statusPending;
  if (status === "unavailable") return copy.statusUnavailable;
  if (status === "rejoin-required") return copy.statusRejoin;
  return copy.statusRevoked;
}
function bindingStatusLabel(copy, status) {
  if (status === "active") return copy.bindingActive;
  if (status === "unavailable") return copy.bindingUnavailable;
  if (status === "rejoin-required") return copy.bindingRejoin;
  return copy.bindingRevoked;
}
function formatClock(at) {
  const date = new Date(at);
  const pad = (value) => value < 10 ? "0" + String(value) : String(value);
  return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

// plugins/dsh-link-interconnect/src/client/index.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var inject = ["slots"];
var PLUGIN_ID = "dsh-link-interconnect";
var CONSENT_SLOT_ID = "link-interconnect-consent";
var PANEL_SLOT_ID = "link-interconnect-peers";
var FOOTER_SLOT_ID = "link-interconnect-footer";
var CONSENT_ORDER = 55;
var PANEL_ORDER = 54;
var FOOTER_ORDER = 2;
var MARKER = "__dshLinkInterconnectClient";
var COPY = {
  footerLabel: "\u8F6F\u4EF6\u4E92\u8054",
  footerTitle: "\u8F6F\u4EF6\u4E92\u8054\uFF1A\u5916\u90E8\u8F6F\u4EF6\u7684\u63A5\u5165\u3001\u6388\u6743\u4E0E\u5BA1\u8BA1",
  footerPendingSuffix: " \u4E2A\u5F85\u786E\u8BA4",
  panelTitle: "\u8F6F\u4EF6\u4E92\u8054",
  panelSubtitle: "\u5916\u90E8\u8F6F\u4EF6\u4E0E\u672C\u673A\u7684\u8FDE\u63A5\u3001\u6388\u6743\u4E0E\u5BA1\u8BA1",
  close: "\u5173\u95ED",
  ownId: "\u672C\u673A\u6807\u8BC6",
  peersTitle: "\u5DF2\u63A5\u5165\u8F6F\u4EF6",
  peersEmpty: "\u6682\u65E0\u5916\u90E8\u8F6F\u4EF6\u63A5\u5165",
  peerScopesEmpty: "\u672A\u6388\u4E88\u8303\u56F4",
  revoke: "\u64A4\u9500",
  revoking: "\u64A4\u9500\u4E2D\u2026",
  adaptersTitle: "\u53EF\u63A5\u5165\u8F6F\u4EF6",
  adaptersEmpty: "\u6682\u65E0\u9002\u914D\u5668\u58F0\u660E",
  adapterDetected: "\u5DF2\u53D1\u73B0",
  adapterMissing: "\u672A\u53D1\u73B0",
  adapterProbe: "\u63A2\u6D4B",
  adapterConnect: "\u63A5\u5165",
  adapterDisconnect: "\u65AD\u5F00",
  adapterBusy: "\u5904\u7406\u4E2D\u2026",
  adapterNoBinding: "\u672A\u63A5\u5165",
  grantsTitle: "\u6388\u6743\u8303\u56F4",
  grantsEmpty: "\u6682\u65E0\u6388\u6743",
  auditTitle: "\u6700\u8FD1\u5BA1\u8BA1",
  auditEmpty: "\u6682\u65E0\u5BA1\u8BA1\u8BB0\u5F55",
  auditOk: "\u6210\u529F",
  auditFail: "\u5931\u8D25",
  riskLow: "\u4F4E\u98CE\u9669",
  riskMedium: "\u4E2D\u98CE\u9669",
  riskHigh: "\u9AD8\u98CE\u9669",
  allow: "\u5141\u8BB8",
  deny: "\u62D2\u7EDD",
  deciding: "\u5904\u7406\u4E2D\u2026",
  consentAria: "\u5916\u90E8\u8F6F\u4EF6\u63A5\u5165\u8BF7\u6C42",
  consentPeer: "\u6765\u6E90",
  routePending: "\u4E3B\u673A\u8DEF\u7531\u5C1A\u672A\u5C31\u7EEA\uFF0C\u6B63\u5728\u7B49\u5F85\u2026",
  routeStale: "\u6682\u65F6\u8BFB\u4E0D\u5230\u4E3B\u673A\u72B6\u6001\uFF0C\u663E\u793A\u4E0A\u4E00\u6B21\u8BFB\u6570",
  updatedAt: "\u66F4\u65B0\u4E8E",
  refreshing: "\u6BCF 3 \u79D2\u5237\u65B0",
  noData: "\u6B63\u5728\u8BFB\u53D6\u2026",
  rpmSuffix: " \u6B21/\u5206",
  statusActive: "\u5DF2\u8FDE\u63A5",
  statusPending: "\u5F85\u786E\u8BA4",
  statusUnavailable: "\u4E0D\u53EF\u7528",
  statusRejoin: "\u9700\u91CD\u65B0\u63A5\u5165",
  statusRevoked: "\u5DF2\u64A4\u9500",
  bindingActive: "\u5DF2\u63A5\u5165",
  bindingUnavailable: "\u4E0D\u53EF\u7528",
  bindingRejoin: "\u9700\u91CD\u65B0\u63A5\u5165",
  bindingRevoked: "\u5DF2\u64A4\u9500"
};
function useClientSnapshot(state) {
  const [, setVersion] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => state.subscribe(() => setVersion((version) => version + 1)), [state]);
  return state.snapshot();
}
function createSlotComponents(state) {
  function ConsentSlot() {
    const current = useClientSnapshot(state);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      ConsentStack,
      {
        copy: COPY,
        pending: pendingConsentOf(current.data),
        busy: current.busy,
        onDecide: (id, decision) => {
          void state.actions.decideConsent(id, decision);
        }
      }
    );
  }
  function PanelSlot() {
    const current = useClientSnapshot(state);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      PeersPanel,
      {
        copy: COPY,
        data: current.data,
        route: current.route,
        lastAt: current.lastAt,
        open: current.open,
        busy: current.busy,
        actionError: current.actionError,
        onClose: state.actions.closePanel,
        onAdapterOp: (op, id) => {
          void state.actions.adapterOp(op, id);
        },
        onRevoke: (peerLinkId) => {
          void state.actions.revokePeer(peerLinkId);
        }
      }
    );
  }
  function FooterSlot(props) {
    const current = useClientSnapshot(state);
    const counts = current.data === null ? null : current.data.counts;
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      InterconnectFooter,
      {
        copy: COPY,
        wide: props.wide !== false,
        open: current.open,
        route: current.route,
        pending: counts === null ? 0 : counts.pendingConsent,
        peers: counts === null ? 0 : counts.peers,
        onToggle: state.actions.togglePanel
      }
    );
  }
  return { consent: ConsentSlot, panel: PanelSlot, footer: FooterSlot };
}
function installStyles(ctx) {
  ctx.effect((() => {
    if (typeof document === "undefined") return void 0;
    const tag = document.createElement("style");
    tag.dataset.pluginCss = PLUGIN_ID + "/interconnect.css";
    tag.textContent = interconnect_default;
    document.head.appendChild(tag);
    return () => {
      try {
        tag.remove();
      } catch (error) {
        void error;
      }
    };
  }), "dsh-link-interconnect: stylesheet");
}
function markClient(fields) {
  try {
    const globals = globalThis;
    const held = globals[MARKER];
    const base = held !== null && typeof held === "object" ? held : {};
    globals[MARKER] = Object.assign({}, base, fields, { mounted: true });
  } catch (error) {
    void error;
  }
}
function publishMarker(current) {
  const data = current.data;
  markClient({
    route: current.route,
    lastAt: current.lastAt,
    open: current.open,
    busy: current.busy.length,
    linkId: data === null ? null : data.linkId,
    pendingConsent: data === null ? 0 : data.counts.pendingConsent,
    peers: data === null ? 0 : data.counts.peers,
    activePeers: data === null ? 0 : data.counts.activePeers,
    adapters: data === null ? 0 : data.adapters.length,
    bindings: data === null ? 0 : data.counts.bindings,
    audit: data === null ? 0 : data.audit.length,
    actionError: current.actionError
  });
}
function apply(ctx) {
  installStyles(ctx);
  const state = createClientState();
  ctx.effect(() => {
    state.start();
    return () => {
      state.stop();
    };
  }, "dsh-link-interconnect: state poller");
  ctx.effect(() => {
    publishMarker(state.snapshot());
    return state.subscribe(() => {
      publishMarker(state.snapshot());
    });
  }, "dsh-link-interconnect: client marker");
  const components = createSlotComponents(state);
  ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register(
    { name: "shell.overlay", id: CONSENT_SLOT_ID, order: CONSENT_ORDER },
    components.consent
  )), "dsh-link-interconnect: consent card");
  ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register(
    { name: "shell.overlay", id: PANEL_SLOT_ID, order: PANEL_ORDER },
    components.panel
  )), "dsh-link-interconnect: peers surface");
  ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
    { name: "sidebar.footer.action", id: FOOTER_SLOT_ID, order: FOOTER_ORDER },
    components.footer
  )), "dsh-link-interconnect: sidebar footer entry");
  markClient({
    slotIds: { consent: CONSENT_SLOT_ID, panel: PANEL_SLOT_ID, footer: FOOTER_SLOT_ID },
    pollIntervalMs: 3e3
  });
}

return module.exports; } });
