window.__ModuleLoader__.load({ id: "dsh-theme-settings", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/dsh-theme-settings/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  SETTINGS_NS: () => SETTINGS_NS,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// plugins/dsh-theme-settings/src/settings.ts
var SETTINGS_NAMESPACE = "theme-settings";
var CONTROL_STYLE_FIELD = "controlStyle";
var RADIUS_FIELD = "radius";
var RADIUS_MIN = 0;
var RADIUS_MAX = 28;
var DEFAULT_RADIUS = 12;
function clampRadius(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return DEFAULT_RADIUS;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(parsed)));
}
var CONTROL_STYLES = ["official", "liquid-glass"];
var DEFAULT_CONTROL_STYLE = "official";
function isControlStyle(value) {
  return CONTROL_STYLES.some((style) => style === value);
}
var GLASS_PRESETS = ["tahoe", "golden-gate"];
var DEFAULT_GLASS_PRESET = "tahoe";
function isGlassPreset(value) {
  return GLASS_PRESETS.some((preset) => preset === value);
}
var GLASS_TRANSPARENCY_STEPS = ["clear", "default", "tinted"];
var DEFAULT_GLASS_TRANSPARENCY = "default";
var TRANSPARENCY_PRESET = "golden-gate";
function isGlassTransparency(value) {
  return GLASS_TRANSPARENCY_STEPS.some((step) => step === value);
}
var GLASS_PRESET_FIELD = "glassPreset";
var GLASS_TRANSPARENCY_FIELD = "glassTransparency";
var GLASS_PRESET_ATTRIBUTE = "data-lg-preset";
var GLASS_TRANSPARENCY_ATTRIBUTE = "data-lg-transparency";

// plugins/dsh-theme-settings/src/client/control-style-store.ts
var import_dsh_client_store = require("@deepseek-ai/dsh-client-store");
function createControlStyleStore() {
  return (0, import_dsh_client_store.defineStore)({
    init: () => ({
      styleId: DEFAULT_CONTROL_STYLE,
      radius: DEFAULT_RADIUS,
      preset: DEFAULT_GLASS_PRESET,
      transparency: DEFAULT_GLASS_TRANSPARENCY,
      revision: -1
    }),
    actions: {
      sync: (draft, styleId, radius, preset, transparency, revision) => {
        if (revision <= draft.revision) return;
        draft.styleId = styleId;
        draft.radius = radius;
        draft.preset = preset;
        draft.transparency = transparency;
        draft.revision = revision;
      }
    }
  });
}

// plugins/dsh-theme-settings/src/client/radius-apply.ts
var RADIUS_APPLY_IDLE_MS = 3e3;
var PANEL_RADIUS_STEP = 6;
function writeRadiusTokens(owner, radius) {
  owner.style.setProperty("--lg-radius-window", `${radius}px`);
  owner.style.setProperty("--lg-radius-panel", `${radius + PANEL_RADIUS_STEP}px`);
}
function lgSweep(host) {
  const hook = host?.__lgSweep;
  if (hook === void 0 || typeof hook.sweep !== "function") return void 0;
  const sweep = hook.sweep.bind(hook);
  return () => {
    sweep();
  };
}
function createRadiusApplier(steps, idleMs = RADIUS_APPLY_IDLE_MS) {
  let timer;
  let pending;
  let applied;
  const stop = () => {
    if (timer === void 0) return;
    clearTimeout(timer);
    timer = void 0;
  };
  const run = () => {
    timer = void 0;
    const radius = pending;
    pending = void 0;
    if (radius === void 0 || radius === applied) return;
    applied = radius;
    steps.applyTokens(radius);
    steps.redressSurfaces();
  };
  return {
    note: (radius) => {
      stop();
      if (radius === applied) {
        pending = void 0;
        return;
      }
      pending = radius;
      timer = setTimeout(run, idleMs);
    },
    applied: () => applied,
    cancel: () => {
      stop();
      pending = void 0;
    }
  };
}

// plugins/dsh-theme-settings/src/client/ThemeSection.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var CUBES = [
  { id: "official", title: "controlStyle.official", hint: "controlStyle.officialHint" },
  { id: "liquid-glass", title: "controlStyle.liquidGlass", hint: "controlStyle.liquidGlassHint" }
];
var PRESETS = [
  { id: "tahoe", title: "glassPreset.tahoe", hint: "glassPreset.tahoeHint", preview: "tahoe" },
  { id: "golden-gate", title: "glassPreset.goldenGate", hint: "glassPreset.goldenGateHint", preview: "edge" }
];
var STEPS = [
  { id: "clear", label: "transparency.clear" },
  { id: "default", label: "transparency.default" },
  { id: "tinted", label: "transparency.tinted" }
];
function ThemeSection({
  t,
  setControlStyle,
  setRadius,
  previewRadius,
  setGlassPreset,
  setGlassTransparency,
  useStore
}) {
  const styleId = useStore((state) => state.styleId);
  const radius = useStore((state) => state.radius);
  const preset = useStore((state) => state.preset);
  const transparency = useStore((state) => state.transparency);
  const [failed, setFailed] = (0, import_react.useState)(null);
  const [dragging, setDragging] = (0, import_react.useState)(null);
  const shown = dragging ?? radius;
  const glass = styleId === "liquid-glass";
  const commit = (row, write) => {
    setFailed(null);
    void write().then((accepted) => {
      if (!accepted) setFailed(row);
    }, () => setFailed(row));
  };
  const commitRadius = (value) => {
    setDragging(null);
    commit("style", () => setRadius(value));
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-theme-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-theme-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-title", children: t("controlStyle.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-cubes", children: CUBES.map(({ id, title, hint }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: styleId === id ? "dsh-theme-cube dsh-theme-cube--selected" : "dsh-theme-cube",
          "aria-pressed": styleId === id,
          onClick: () => commit("style", () => setControlStyle(id)),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: id === "liquid-glass" ? "dsh-theme-preview dsh-theme-preview--glass" : "dsh-theme-preview dsh-theme-preview--flat", "aria-hidden": "true", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-preview-bar" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-preview-button" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-cube-title", children: t(title) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-cube-hint", children: t(hint) })
          ]
        },
        id
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-description", children: t("controlStyle.description") }),
      failed === "style" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-error", role: "alert", children: t("controlStyle.failed") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-theme-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-title", children: t("glassPreset.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-cubes dsh-theme-cubes--presets", children: PRESETS.map(({ id, title, hint, preview }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: preset === id ? "dsh-theme-cube dsh-theme-cube--selected" : "dsh-theme-cube",
          "aria-pressed": preset === id,
          disabled: !glass,
          onClick: () => commit("preset", () => setGlassPreset(id)),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-theme-preview dsh-theme-preview--preset dsh-theme-preview--" + preview, "aria-hidden": "true", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-preview-sidebar" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-preview-line dsh-theme-preview-line--a" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-preview-line dsh-theme-preview-line--b" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-cube-title", children: t(title) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-theme-cube-hint", children: t(hint) })
          ]
        },
        id
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-description", children: glass ? t("glassPreset.description") : t("glassPreset.skinOff") }),
      failed === "preset" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-error", role: "alert", children: t("glassPreset.failed") })
    ] }),
    glass && preset === TRANSPARENCY_PRESET && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-theme-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-title", children: t("transparency.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-steps", role: "group", "aria-label": t("transparency.title"), children: STEPS.map(({ id, label }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: transparency === id ? "dsh-theme-step dsh-theme-step--selected" : "dsh-theme-step",
          "aria-pressed": transparency === id,
          onClick: () => commit("transparency", () => setGlassTransparency(id)),
          children: t(label)
        },
        id
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-description", children: t("transparency.description") }),
      failed === "transparency" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-error", role: "alert", children: t("transparency.failed") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-theme-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-title", children: t("radius.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-theme-slider-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "dsh-theme-slider",
            type: "range",
            min: RADIUS_MIN,
            max: RADIUS_MAX,
            step: 1,
            value: shown,
            "aria-label": t("radius.title"),
            onChange: (event) => {
              const next = Number(event.target.value);
              setDragging(next);
              previewRadius(next);
            },
            onPointerUp: () => commitRadius(shown),
            onKeyUp: () => commitRadius(shown),
            onBlur: () => {
              if (dragging !== null) commitRadius(shown);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-theme-slider-value", children: [
          shown,
          " px"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-theme-description", children: t("radius.description") })
    ] })
  ] });
}

// plugins/dsh-theme-settings/src/client/locales.ts
var zh = {
  "nav": "\u4E3B\u9898",
  "controlStyle.title": "\u63A7\u4EF6\u98CE\u683C",
  "controlStyle.description": "\u6309\u94AE\u3001\u8F93\u5165\u6846\u4E0E\u6D6E\u52A8\u9762\u677F\u7684\u6750\u8D28\u3002\u5207\u6362\u7ACB\u5373\u751F\u6548\uFF0C\u754C\u9762\u5176\u4F59\u90E8\u5206\u4FDD\u6301\u4E0D\u53D8\u3002",
  "controlStyle.official": "\u5B98\u65B9\u9ED8\u8BA4",
  "controlStyle.officialHint": "\u5BA2\u6237\u7AEF\u81EA\u5E26\u6750\u8D28",
  "controlStyle.liquidGlass": "\u6DB2\u6001\u73BB\u7483",
  "controlStyle.liquidGlassHint": "Apple Liquid Glass",
  "controlStyle.failed": "\u672A\u80FD\u4FDD\u5B58\uFF0C\u98CE\u683C\u4FDD\u6301\u4E0D\u53D8",
  "glassPreset.title": "\u76AE\u80A4\u9884\u8BBE",
  "glassPreset.description": "\u6DB2\u6001\u73BB\u7483\u76AE\u80A4\u7684\u4E24\u79CD\u6392\u5E03\u3002Tahoe \u8BA9\u4FA7\u8FB9\u680F\u6D6E\u5728\u5185\u5BB9\u4E4B\u5916\uFF0CGolden Gate \u8BA9\u5B83\u4E0E\u5185\u5BB9\u9F50\u5E73\u3002\u5207\u6362\u7ACB\u5373\u751F\u6548\uFF0C\u5DF2\u6253\u5F00\u7684\u83DC\u5355\u4E0E\u5BF9\u8BDD\u6846\u4E00\u5E76\u8DDF\u968F\u3002",
  "glassPreset.tahoe": "Tahoe",
  "glassPreset.tahoeHint": "macOS 26 \xB7 \u6D6E\u8D77\u7684\u73BB\u7483\u5C42",
  "glassPreset.goldenGate": "Golden Gate",
  "glassPreset.goldenGateHint": "macOS 27 \xB7 \u4E0E\u5185\u5BB9\u9F50\u5E73\u4E00\u4F53",
  "glassPreset.failed": "\u672A\u80FD\u4FDD\u5B58\uFF0C\u9884\u8BBE\u4FDD\u6301\u4E0D\u53D8",
  "glassPreset.skinOff": "\u9884\u8BBE\u5C5E\u4E8E\u6DB2\u6001\u73BB\u7483\u76AE\u80A4\uFF1A\u9009\u62E9\u300C\u6DB2\u6001\u73BB\u7483\u300D\u540E\u53EF\u5207\u6362\u3002",
  "transparency.title": "\u900F\u660E\u5EA6",
  "transparency.description": "Golden Gate \u7684\u4E09\u6863\u900F\u660E\u5EA6\uFF0C\u4F5C\u7528\u5728\u73BB\u7483\u7684\u586B\u5145\u4E0E\u6A21\u7CCA\u4E0A\uFF0C\u4E0D\u6539\u53D8\u4EFB\u4F55\u51E0\u4F55\u53C2\u6570\u3002\u4E2D\u95F4\u4E00\u6863\u662F\u9ED8\u8BA4\u503C\u3002",
  "transparency.clear": "\u6E05\u6670",
  "transparency.default": "\u9ED8\u8BA4",
  "transparency.tinted": "\u52A0\u6D53",
  "transparency.failed": "\u672A\u80FD\u4FDD\u5B58\uFF0C\u900F\u660E\u5EA6\u4FDD\u6301\u4E0D\u53D8",
  "radius.title": "\u7EDF\u4E00\u5706\u89D2",
  "radius.description": "\u7A97\u53E3\u4E0E\u7A97\u53E3\u5185\u6240\u6709\u9762\u677F\u5171\u7528\u540C\u4E00\u4E2A\u5706\u89D2\u3002\u62D6\u52A8\u65F6\u5373\u65F6\u9884\u89C8\uFF0C\u677E\u624B\u5373\u4FDD\u5B58\uFF0C\u5E76\u540C\u6B65\u5230\u7A97\u53E3\u5916\u58F3\u7684\u81EA\u7ED8\u5706\u89D2\u3002"
};
var en = {
  "nav": "Theme",
  "controlStyle.title": "Control style",
  "controlStyle.description": "The material of buttons, inputs and floating panels. Switching applies at once; nothing else about the interface changes.",
  "controlStyle.official": "Official",
  "controlStyle.officialHint": "The client\u2019s own material",
  "controlStyle.liquidGlass": "Liquid Glass",
  "controlStyle.liquidGlassHint": "Apple Liquid Glass",
  "controlStyle.failed": "Not saved; the current style is unchanged",
  "glassPreset.title": "Skin preset",
  "glassPreset.description": "Two arrangements of the liquid glass skin. Tahoe floats the sidebar outside the content; Golden Gate runs it flush into the content. Switching applies at once, open menus and dialogs included.",
  "glassPreset.tahoe": "Tahoe",
  "glassPreset.tahoeHint": "macOS 26 \xB7 a floating glass layer",
  "glassPreset.goldenGate": "Golden Gate",
  "glassPreset.goldenGateHint": "macOS 27 \xB7 edge-to-edge with the content",
  "glassPreset.failed": "Not saved; the current preset is unchanged",
  "glassPreset.skinOff": "Presets belong to the liquid glass skin: pick Liquid Glass to switch them.",
  "transparency.title": "Transparency",
  "transparency.description": "Golden Gate\u2019s three transparency steps, applied to the glass\u2019s fill and blur \u2014 never to a geometric token. The middle step is the default.",
  "transparency.clear": "Clear",
  "transparency.default": "Default",
  "transparency.tinted": "Tinted",
  "transparency.failed": "Not saved; the current step is unchanged",
  "radius.title": "Corner radius",
  "radius.description": "One radius for the window and every panel inside it. Dragging previews it at once; releasing saves it and syncs the shell\u2019s own corner."
};

// plugins/dsh-theme-settings/src/client/section.css
var section_default = "/*\n * The Theme section's own chrome: the same metrics as the client's Appearance\n * row (title over a cube row, 16px padding, one hairline), so a setting this\n * plugin adds is indistinguishable from a setting that shipped with the client.\n * Colours are the official `--dsw-*` tokens only.\n */\n\n.dsh-theme-section {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n}\n\n.dsh-theme-group {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 16px 0;\n}\n\n.dsh-theme-title {\n  font-size: 14px;\n  font-weight: 400;\n  line-height: 22px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dsh-theme-description {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dsh-theme-error {\n  color: var(--dsw-alias-state-error-secondary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dsh-theme-cubes {\n  display: flex;\n  align-items: stretch;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n/* The official Appearance cube: transparent until hovered or selected. */\n.dsh-theme-cube {\n  box-sizing: border-box;\n  flex: 1 1 200px;\n  display: flex;\n  flex-direction: column;\n  align-items: stretch;\n  gap: 6px;\n  padding: 12px;\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  border-radius: var(--dsw-radius-xl);\n  background: transparent;\n  font: inherit;\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n}\n\n.dsh-theme-cube:hover:not(.dsh-theme-cube--selected) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-theme-cube--selected {\n  background: var(--dsw-alias-bg-module-platform);\n  border-color: var(--dsw-static-neutral-bluish-400);\n}\n\n.dsh-theme-cube:focus-visible {\n  outline: var(--dsw-focus-ring-width) solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.dsh-theme-cube-title {\n  font-size: 14px;\n  line-height: 22px;\n}\n\n.dsh-theme-cube-hint {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n/* ---------------------------------------------------------------------------\n * The cube's preview: the same two controls over the same backdrop, so the\n * choice is made by looking rather than by reading. The preview carries its own\n * backdrop and its own material: it shows what each style does, not what the\n * client is currently wearing.\n * ------------------------------------------------------------------------- */\n.dsh-theme-preview {\n  position: relative;\n  display: block;\n  height: 68px;\n  border-radius: var(--dsw-radius-md);\n  overflow: hidden;\n  background-color: #101018;\n  background-image:\n    radial-gradient(62% 76% at 16% 10%, #4a6cd6 0%, transparent 66%),\n    radial-gradient(58% 70% at 86% 18%, #8a4abe 0%, transparent 68%),\n    radial-gradient(84% 64% at 48% 104%, #268088 0%, transparent 72%);\n}\n\n.dsh-theme-preview-bar,\n.dsh-theme-preview-button {\n  position: absolute;\n  display: block;\n}\n\n.dsh-theme-preview-bar {\n  left: 12px;\n  right: 12px;\n  top: 12px;\n  height: 20px;\n}\n\n.dsh-theme-preview-button {\n  left: 12px;\n  top: 40px;\n  width: 46px;\n  height: 16px;\n}\n\n/* Official: opaque fills, flat corners, no rim. */\n.dsh-theme-preview--flat .dsh-theme-preview-bar {\n  background-color: #2c2c2e;\n  border-radius: 6px;\n  box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 10%);\n}\n\n.dsh-theme-preview--flat .dsh-theme-preview-button {\n  background-color: #43454a;\n  border-radius: 4px;\n}\n\n/* Liquid Glass: the backdrop shows through, the rim catches the light. */\n.dsh-theme-preview--glass .dsh-theme-preview-bar {\n  background-color: rgb(255 255 255 / 14%);\n  -webkit-backdrop-filter: blur(7px) saturate(180%);\n  backdrop-filter: blur(7px) saturate(180%);\n  border-radius: 10px;\n  box-shadow:\n    inset 0 1px 0 0 rgb(255 255 255 / 45%),\n    inset 0 0 0 0.5px rgb(255 255 255 / 22%),\n    0 10px 18px -10px rgb(0 0 0 / 70%);\n}\n\n.dsh-theme-preview--glass .dsh-theme-preview-button {\n  background-color: rgb(255 255 255 / 18%);\n  -webkit-backdrop-filter: blur(6px) saturate(180%);\n  backdrop-filter: blur(6px) saturate(180%);\n  border-radius: 999px;\n  box-shadow:\n    inset 0 1px 0 0 rgb(255 255 255 / 50%),\n    inset 0 0 0 0.5px rgb(255 255 255 / 25%);\n}\n\n/* The unified-radius row: one slider, on the metrics of the rows the client draws itself. */\n.dsh-theme-slider-row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin-top: 8px;\n}\n\n.dsh-theme-slider {\n  flex: 1 1 auto;\n  height: 20px;\n  margin: 0;\n  accent-color: var(--dsw-alias-brand-primary, #4d6bfe);\n  cursor: pointer;\n}\n\n.dsh-theme-slider:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);\n  outline-offset: 2px;\n  border-radius: 4px;\n}\n\n.dsh-theme-slider-value {\n  min-width: 48px;\n  text-align: right;\n  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary, #61666b);\n  font-variant-numeric: tabular-nums;\n}\n\n/* ---------------------------------------------------------------------------\n * The preset row: a layout preview, not a material one.\n *\n * The two presets are the same glass in two arrangements, so what distinguishes\n * the cubes has to be the arrangement: Tahoe's sidebar is a rounded pane inset\n * in its own gutter and carrying its own float shadow, Golden Gate's is a flush\n * full-height pane with no corner of its own and no shadow. Both previews draw\n * the real properties (radius, shadow, frost) rather than an illustration of\n * them, so a reader picks the arrangement by looking.\n * ------------------------------------------------------------------------- */\n.dsh-theme-cubes--presets .dsh-theme-cube {\n  flex: 1 1 180px;\n}\n\n.dsh-theme-cube:disabled {\n  cursor: not-allowed;\n  opacity: 0.55;\n}\n\n.dsh-theme-cube:disabled:hover {\n  background: transparent;\n}\n\n.dsh-theme-preview-sidebar,\n.dsh-theme-preview-line {\n  position: absolute;\n  display: block;\n}\n\n/* Tahoe: floating \u2014 a gutter all round, the panel's own corner, its own shadow. */\n.dsh-theme-preview--tahoe .dsh-theme-preview-sidebar {\n  left: 7px;\n  top: 7px;\n  bottom: 7px;\n  width: 34%;\n  border-radius: 9px;\n  background-color: rgb(255 255 255 / 14%);\n  -webkit-backdrop-filter: blur(7px) saturate(180%);\n  backdrop-filter: blur(7px) saturate(180%);\n  box-shadow:\n    inset 0 1px 0 0 rgb(255 255 255 / 45%),\n    inset 0 0 0 0.5px rgb(255 255 255 / 22%),\n    0 8px 16px -8px rgb(0 0 0 / 70%);\n}\n\n/* Golden Gate: edge-to-edge \u2014 no gutter, no corner, no shadow, the frost runs on. */\n.dsh-theme-preview--edge .dsh-theme-preview-sidebar {\n  left: 0;\n  top: 0;\n  bottom: 0;\n  width: 38%;\n  border-radius: 0;\n  background-color: rgb(255 255 255 / 22%);\n  -webkit-backdrop-filter: blur(10px) saturate(140%);\n  backdrop-filter: blur(10px) saturate(140%);\n  box-shadow: inset -1px 0 0 0 rgb(255 255 255 / 24%);\n}\n\n/* The content beside it: two lines, so the sidebar reads as a column of a layout. */\n.dsh-theme-preview-line {\n  height: 6px;\n  border-radius: 3px;\n  background-color: rgb(255 255 255 / 26%);\n}\n\n.dsh-theme-preview-line--a {\n  left: 52%;\n  right: 10px;\n  top: 20px;\n}\n\n.dsh-theme-preview-line--b {\n  left: 52%;\n  right: 30%;\n  top: 34px;\n}\n\n/* ---------------------------------------------------------------------------\n * The transparency row: three steps on one scale.\n *\n * A segmented control rather than a slider, because the preference is the three\n * grades Apple's axis actually has room for here, and a segmented control states\n * which grade is current without the reader having to aim at it.\n * ------------------------------------------------------------------------- */\n.dsh-theme-steps {\n  display: inline-flex;\n  align-self: flex-start;\n  gap: 2px;\n  padding: 2px;\n  border: 0.5px solid var(--dsw-alias-border-l4);\n  border-radius: var(--dsw-radius-xl, 12px);\n}\n\n.dsh-theme-step {\n  min-width: 76px;\n  padding: 6px 14px;\n  border: 0;\n  border-radius: 10px;\n  background: transparent;\n  font: inherit;\n  font-size: 13px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n}\n\n.dsh-theme-step:hover:not(.dsh-theme-step--selected) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-theme-step--selected {\n  background: var(--dsw-alias-bg-module-platform);\n  color: var(--dsw-alias-label-primary);\n  box-shadow: inset 0 0 0 0.5px var(--dsw-static-neutral-bluish-400);\n}\n\n.dsh-theme-step:focus-visible {\n  outline: var(--dsw-focus-ring-width) solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n";

// plugins/dsh-theme-settings/src/client/index.tsx
var PLUGIN_ID = "dsh-theme-settings";
var SETTINGS_NS = "settings.theme-style";
var inject = ["slots", "locale", "remote", "configForms", "liquidGlass"];
function installSectionStyles(ctx) {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = `${PLUGIN_ID}/section.css`;
    tag.textContent = section_default;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "dsh-theme-settings: section stylesheet");
}
function apply(ctx) {
  installSectionStyles(ctx);
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), "dsh-theme-settings: section dictionaries");
  const t = ctx.locale.bind(SETTINGS_NS);
  const form = ctx.configForms.get(SETTINGS_NAMESPACE);
  const store = createControlStyleStore();
  let bound;
  const applyRadius = (radius) => {
    if (typeof document !== "undefined") writeRadiusTokens(document.documentElement, radius);
    const scheme = typeof document === "undefined" ? "light" : getComputedStyle(document.body).colorScheme;
    void fetch("/__shell/window", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ radius, palette: scheme.includes("dark") ? "dark" : "light" })
    }).catch(() => void 0);
  };
  const writeGlassAttributes = (preset, transparency) => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute(GLASS_PRESET_ATTRIBUTE, preset);
    document.documentElement.setAttribute(GLASS_TRANSPARENCY_ATTRIBUTE, transparency);
  };
  let adoptedPreset;
  const adoptPreset = (preset, transparency) => {
    const pair = preset + "/" + transparency;
    if (pair === adoptedPreset) return;
    adoptedPreset = pair;
    redressEverySurface();
  };
  const redressEverySurface = () => {
    const sweep = typeof window === "undefined" ? void 0 : lgSweep(window);
    if (sweep !== void 0) {
      sweep();
      return;
    }
    try {
      ctx.liquidGlass.dressRefractingSurfaces?.();
    } catch (error) {
      ctx.logger.warn(`dsh-theme-settings: the material engine could not re-dress its surfaces: %s`, error);
    }
  };
  const applier = createRadiusApplier({ applyTokens: applyRadius, redressSurfaces: redressEverySurface });
  ctx.effect(() => () => applier.cancel(), "dsh-theme-settings: deferred radius apply");
  const adopt = () => {
    const snapshot = form.getSnapshot();
    const value = snapshot.value;
    if (value === void 0) return;
    const styleId = isControlStyle(value.controlStyle) ? value.controlStyle : DEFAULT_CONTROL_STYLE;
    const radius = clampRadius(value.radius ?? DEFAULT_RADIUS);
    const preset = isGlassPreset(value.glassPreset) ? value.glassPreset : DEFAULT_GLASS_PRESET;
    const transparency = isGlassTransparency(value.glassTransparency) ? value.glassTransparency : DEFAULT_GLASS_TRANSPARENCY;
    bound?.sync(styleId, radius, preset, transparency, snapshot.revision ?? -1);
    writeGlassAttributes(preset, transparency);
    applyRadius(radius);
    adoptPreset(preset, transparency);
    applier.note(radius);
    try {
      ctx.liquidGlass.setStyle(styleId);
    } catch (error) {
      ctx.logger.warn(`dsh-theme-settings: %s`, error);
    }
  };
  ctx.effect(() => form.subscribe(adopt), "dsh-theme-settings: durable preference adoption");
  adopt();
  const injected = (actions) => {
    bound = actions;
    adopt();
    return {
      setControlStyle: (id) => form.set(CONTROL_STYLE_FIELD, id),
      setRadius: (value) => form.set(RADIUS_FIELD, clampRadius(value)),
      setGlassPreset: (id) => form.set(GLASS_PRESET_FIELD, id),
      setGlassTransparency: (step) => form.set(GLASS_TRANSPARENCY_FIELD, step),
      // The drag previews through the same path the committed value takes, so what the slider
      // shows while dragging is what the interface and the shell are already wearing.
      previewRadius: (value) => {
        if (value === null) return;
        const radius = clampRadius(value);
        applyRadius(radius);
        applier.note(radius);
      }
    };
  };
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "theme",
    order: 5,
    label: () => t("nav"),
    locale: SETTINGS_NS,
    store,
    inject: injected
  }, ThemeSection));
}

return module.exports; } });
