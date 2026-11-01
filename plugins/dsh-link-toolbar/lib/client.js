window.__ModuleLoader__.load({ id: "dsh-link-toolbar", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/dsh-link-toolbar/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  TOOLBAR_ACTIONS_PRIORITY: () => TOOLBAR_ACTIONS_PRIORITY,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");

// plugins/dsh-link-toolbar/src/client/locales.ts
var NS = "dsh-link-toolbar";
var zh = {
  "toolbar.open": "DSH LINK",
  "toolbar.openHint": "\u6253\u5F00 DSH LINK \u72B6\u6001",
  "toolbar.menu": "DSH LINK \u72B6\u6001",
  "toolbar.close": "\u5173\u95ED",
  "item.layout": "\u54CD\u5E94\u5F0F\u6863\u4F4D",
  "item.notes": "\u4FBF\u6761",
  "item.glass": "\u73BB\u7483\u76AE\u80A4",
  "item.browser": "\u5185\u7F6E\u6D4F\u89C8\u5668",
  "reason.not-mounted": "\u672A\u88C5\u8F7D",
  "reason.empty-value": "\u5DF2\u88C5\u8F7D\u4F46\u672A\u7ED9\u503C",
  "state.on": "\u5DF2\u5C31\u7EEA",
  "state.off": "\u4E0D\u53EF\u7528"
};
var en = {
  "toolbar.open": "DSH LINK",
  "toolbar.openHint": "Open DSH LINK status",
  "toolbar.menu": "DSH LINK status",
  "toolbar.close": "Close",
  "item.layout": "Responsive band",
  "item.notes": "Notes",
  "item.glass": "Glass skin",
  "item.browser": "Built-in browser",
  "reason.not-mounted": "Not mounted",
  "reason.empty-value": "Mounted with no value",
  "state.on": "Ready",
  "state.off": "Unavailable"
};

// plugins/dsh-link-toolbar/src/client/toolbar-items.ts
var MARKERS = [
  { id: "layout", attribute: "data-dsh-link-layout" },
  { id: "notes", attribute: "data-dsh-link-notes" },
  { id: "glass", attribute: "data-dsh-link-glass" },
  { id: "browser", attribute: "data-dsh-browser" }
];
function toolbarItems(source) {
  return MARKERS.map((marker) => {
    const raw = source === null || source === void 0 ? null : source.getAttribute(marker.attribute);
    if (raw === null || raw === void 0) {
      return { id: marker.id, labelKey: "item." + marker.id, enabled: false, reason: "not-mounted", value: null };
    }
    if (raw === "") {
      return { id: marker.id, labelKey: "item." + marker.id, enabled: false, reason: "empty-value", value: null };
    }
    return { id: marker.id, labelKey: "item." + marker.id, enabled: true, reason: null, value: raw };
  });
}
var MARKER_ATTRIBUTES = MARKERS.map((marker) => marker.attribute);

// plugins/dsh-link-toolbar/src/client/toolbar.css
var toolbar_default = `/* The toolbar entry's own styles. Tokens only: no literal colour, no literal radius. */
.dsh-link-toolbar-button {
  border: 1px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  padding: 2px 8px;
}

.dsh-link-toolbar-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-link-toolbar-menu {
  background: var(--dsw-alias-bg-module-platform);
  border: 1px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
}

.dsh-link-toolbar-item {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--dsw-alias-label-primary);
  display: flex;
  font: inherit;
  gap: var(--dsw-radius-md);
  justify-content: space-between;
  padding: 4px 10px;
  text-align: left;
  width: 100%;
}

.dsh-link-toolbar-item[data-enabled="true"]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-link-toolbar-item[data-enabled="false"] {
  color: var(--dsw-alias-label-secondary);
}

.dsh-link-toolbar-detail {
  color: var(--dsw-alias-label-secondary);
}
`;

// plugins/dsh-link-toolbar/src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var PLUGIN_ID = "dsh-link-toolbar";
var TOOLBAR_ACTIONS_PRIORITY = 100;
var inject = ["slots", "locale"];
function Row({ item, t }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "menuitem", className: "dsh-link-toolbar-item", "data-enabled": String(item.enabled), "data-item": item.id, disabled: !item.enabled, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-link-toolbar-label", children: t(item.labelKey) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-link-toolbar-detail", children: item.enabled ? item.value : t("reason." + item.reason) })
  ] });
}
function ToolbarAction({ t }) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const root = typeof document === "undefined" ? null : document.documentElement;
  const items = toolbarItems({ getAttribute: (name) => root === null ? null : root.getAttribute(name) });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.Menu,
    {
      open,
      listClassName: "dsh-link-toolbar-menu",
      anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-link-toolbar-button", title: t("toolbar.openHint"), "aria-expanded": String(open), onClick: () => setOpen(!open), children: t("toolbar.open") }),
      onClose: () => setOpen(false),
      children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, { item, t }, item.id))
    }
  );
}
function installStyles(ctx) {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = `${PLUGIN_ID}/toolbar.css`;
    tag.textContent = toolbar_default;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "dsh-link-toolbar: entry stylesheet");
}
function apply(ctx) {
  installStyles(ctx);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-link-toolbar: dictionaries");
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({ name: "conversation.session.header.actions", priority: TOOLBAR_ACTIONS_PRIORITY, locale: NS }, ToolbarAction));
}

return module.exports; } });
