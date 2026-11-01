window.__ModuleLoader__.load({ id: "dsh-link-brand", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/dsh-link-brand/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react2 = require("react");

// plugins/dsh-link-brand/src/client/marks.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function DshBrandMark({ size = 24, className }) {
  const mask = "dsh-link-brand-" + (0, import_react.useId)().replace(/[^A-Za-z0-9_-]/g, "");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 96 96", width: size, height: size, className, fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mask", { id: mask, maskUnits: "userSpaceOnUse", x: "0", y: "0", width: "96", height: "96", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "0", y: "0", width: "96", height: "96", fill: "#fff" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 34.730,43.761 C 34.730,42.301 35.912,41.119 37.372,41.119 C 38.831,41.119 40.013,42.301 40.013,43.761 C 40.013,45.220 38.831,46.402 37.372,46.402 C 35.912,46.402 34.730,45.220 34.730,43.761 Z", fill: "#000" })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { mask: "url(#" + mask + ")", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 15.760,48.563 C 15.760,32.555 26.966,23.750 41.374,22.949 C 54.981,22.149 66.187,28.552 74.192,38.158 C 78.194,42.960 78.994,50.164 75.792,54.967 C 70.189,61.370 57.382,63.771 44.576,62.971 C 30.168,62.171 17.361,57.368 15.760,48.563 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M42.674,53.642L50.475,68.747C41.250,67.883 35.989,52.030 38.054,56.028Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M74.760,43.000L69.509,17.282C76.363,22.081 81.415,29.035 83.861,37.036Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.000,48.000C4.000,23.699 23.699,4.000 48.000,4.000C72.301,4.000 92.000,23.699 92.000,48.000C92.000,72.301 72.301,92.000 48.000,92.000C23.699,92.000 4.000,72.301 4.000,48.000ZM10.500,48.000C10.500,27.289 27.289,10.500 48.000,10.500C68.711,10.500 85.500,27.289 85.500,48.000C85.500,68.711 68.711,85.500 48.000,85.500C27.289,85.500 10.500,68.711 10.500,48.000Z", fill: "#4D6BFE", fillRule: "evenodd" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 26.824,72.250 L 26.824,60.750 L 28.959,60.750 L 28.959,70.443 L 34.972,70.443 L 34.972,72.250 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 37.814,72.250 L 37.814,60.750 L 39.950,60.750 L 39.950,72.250 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 44.205,72.250 L 44.205,60.750 L 45.963,60.750 L 53.175,69.605 L 52.304,69.605 L 52.304,60.750 L 54.424,60.750 L 54.424,72.250 L 52.666,72.250 L 45.454,63.395 L 46.324,63.395 L 46.324,72.250 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 60.568,69.539 60.453,67.009 66.482,60.750 L 68.881,60.750 L 63.870,66.073 L 62.687,67.371 Z M 58.662,72.250 L 58.662,60.750 L 60.798,60.750 L 60.798,72.250 Z M 66.679,72.250 62.276,67.009 63.689,65.449 69.176,72.250 Z", fill: "currentColor" })
    ] })
  ] });
}
function DshBrandName({ height = 16, className }) {
  const mask = "dsh-link-brand-" + (0, import_react.useId)().replace(/[^A-Za-z0-9_-]/g, "");
  const width = Math.round(height * 141.43 / 27.9 * 100) / 100;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 141.43 27.9", width, height, className, fill: "none", "aria-hidden": "true", focusable: "false", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mask", { id: mask, maskUnits: "userSpaceOnUse", x: "0", y: "0", width: "141.43", height: "27.9", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "0", y: "0", width: "141.43", height: "27.9", fill: "#fff" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 4.675,17.068 C 4.675,16.801 4.891,16.584 5.158,16.584 C 5.426,16.584 5.642,16.801 5.642,17.068 C 5.642,17.336 5.426,17.552 5.158,17.552 C 4.891,17.552 4.675,17.336 4.675,17.068 Z", fill: "#000" })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { mask: "url(#" + mask + ")", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 2.762,17.282 C 2.762,12.393 6.756,8.429 11.682,8.429 C 16.608,8.429 20.602,12.393 20.602,17.282 C 20.602,22.171 16.608,26.135 11.682,26.135 C 6.756,26.135 2.762,22.171 2.762,17.282 Z M 6.808,17.282 C 6.808,14.627 8.990,12.475 11.682,12.475 C 14.374,12.475 16.556,14.627 16.556,17.282 C 16.556,19.937 14.374,22.089 11.682,22.089 C 8.990,22.089 6.808,19.937 6.808,17.282 Z", fill: "#4D6BFE", fillRule: "evenodd" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 1.200,17.948 C 1.200,15.016 3.253,13.403 5.891,13.257 C 8.384,13.110 10.436,14.283 11.902,16.042 C 12.635,16.922 12.782,18.241 12.196,19.121 C 11.169,20.294 8.824,20.733 6.478,20.587 C 3.839,20.440 1.493,19.561 1.200,17.948 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 5.598,19.121 C 6.771,20.294 8.237,21.173 9.410,21.320 C 8.824,20.440 7.944,19.561 7.504,18.681 C 6.918,18.681 6.185,18.828 5.598,19.121 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 11.056,17.704 L 13.970,13.038 C 15.401,13.788 16.360,15.190 16.529,16.780 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 18.125,26.428 L 18.125,22.688 L 18.227,17.248 L 17.887,11.842 L 17.887,1.200 L 23.191,1.200 L 23.191,26.428 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 34.241,26.700 Q 31.895,26.700 29.736,26.139 Q 27.577,25.578 26.319,24.728 L 28.087,20.920 Q 29.345,21.702 31.062,22.195 Q 32.779,22.688 34.445,22.688 Q 36.281,22.688 37.046,22.246 Q 37.811,21.804 37.811,21.022 Q 37.811,20.376 37.216,20.053 Q 36.621,19.730 35.635,19.560 Q 34.649,19.390 33.476,19.220 Q 32.303,19.050 31.113,18.761 Q 29.923,18.472 28.937,17.894 Q 27.951,17.316 27.356,16.330 Q 26.761,15.344 26.761,13.780 Q 26.761,12.046 27.764,10.720 Q 28.767,9.394 30.671,8.629 Q 32.575,7.864 35.227,7.864 Q 37.097,7.864 39.035,8.272 Q 40.973,8.680 42.265,9.462 L 40.497,13.236 Q 39.171,12.454 37.828,12.165 Q 36.485,11.876 35.227,11.876 Q 33.459,11.876 32.643,12.352 Q 31.827,12.828 31.827,13.576 Q 31.827,14.256 32.422,14.596 Q 33.017,14.936 34.003,15.140 Q 34.989,15.344 36.162,15.497 Q 37.335,15.650 38.525,15.956 Q 39.715,16.262 40.684,16.823 Q 41.653,17.384 42.265,18.353 Q 42.877,19.322 42.877,20.886 Q 42.877,22.586 41.857,23.895 Q 40.837,25.204 38.916,25.952 Q 36.995,26.700 34.241,26.700 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 46.141,26.428 L 46.141,1.200 L 51.445,1.200 L 51.445,13.202 L 50.255,11.672 Q 51.241,9.836 53.077,8.850 Q 54.913,7.864 57.259,7.864 Q 59.435,7.864 61.152,8.731 Q 62.869,9.598 63.855,11.383 Q 64.841,13.168 64.841,15.956 L 64.841,26.428 L 59.537,26.428 L 59.537,16.772 Q 59.537,14.562 58.568,13.508 Q 57.599,12.454 55.831,12.454 Q 54.573,12.454 53.570,12.981 Q 52.567,13.508 52.006,14.596 Q 51.445,15.684 51.445,17.384 L 51.445,26.428 Z", fill: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 82.067,26.428 L 82.067,12.428 L 84.667,12.428 L 84.667,24.228 L 91.987,24.228 L 91.987,26.428 Z", fill: "#4D6BFE" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 97.647,26.428 L 97.647,12.428 L 100.247,12.428 L 100.247,26.428 Z", fill: "#4D6BFE" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 107.627,26.428 L 107.627,12.428 L 109.767,12.428 L 118.547,23.208 L 117.487,23.208 L 117.487,12.428 L 120.067,12.428 L 120.067,26.428 L 117.927,26.428 L 109.147,15.648 L 110.207,15.648 L 110.207,26.428 Z", fill: "#4D6BFE" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M 129.747,23.128 129.607,20.048 136.947,12.428 L 139.867,12.428 L 133.767,18.908 L 132.327,20.488 Z M 127.427,26.428 L 127.427,12.428 L 130.027,12.428 L 130.027,26.428 Z M 137.187,26.428 131.827,20.048 133.547,18.148 140.227,26.428 Z", fill: "#4D6BFE" })
    ] })
  ] });
}

// plugins/dsh-link-brand/src/client/brand.css
var brand_default = "/* The expanded sidebar row draws the wordmark alone: it already carries the symbol\n   inside its 'd', so the badge beside it would set LINK twice. The client's mark box is\n   a flex item of the brand row (gap 8px), so it has to disappear rather than merely be\n   empty \u2014 and it cannot match :empty itself, because the slot renderer keeps an empty\n   wrapper div in it. Hiding the box is what puts the wordmark flush with the sidebar's\n   text column. The collapsed rail draws the badge in its own box (railMark), which this\n   rule does not touch. */\n[class*='brandMark']:has(> [data-slot='sidebar.brand.mark']:empty) { display: none; }\n";

// plugins/dsh-link-brand/src/client/index.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var PLUGIN_ID = "dsh-link-brand";
var BRAND_PRIORITY = -1;
function installBrandStyles(ctx) {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = `${PLUGIN_ID}/brand.css`;
    tag.textContent = brand_default;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "dsh-link-brand: brand stylesheet");
}
function SidebarMark({ size }) {
  const host = (0, import_react2.useRef)(null);
  const [standalone, setStandalone] = (0, import_react2.useState)(null);
  (0, import_react2.useLayoutEffect)(() => {
    setStandalone(host.current?.closest('[class*="railMark"]') !== null);
  }, []);
  if (standalone === null) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { ref: host, className: "dsh-link-brand-probe" });
  return standalone ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DshBrandMark, { size: size ?? 24 }) : null;
}
function HeroMark({ size, className }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DshBrandMark, { size: size ?? 34, className });
}
function SidebarName() {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DshBrandName, {});
}
var inject = ["slots"];
function apply(ctx) {
  installBrandStyles(ctx);
  ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", function* () {
    yield ctx.slots.register({ name: "sidebar.brand.mark", priority: BRAND_PRIORITY }, SidebarMark);
    yield ctx.slots.register({ name: "sidebar.brand.name", priority: BRAND_PRIORITY }, SidebarName);
  }));
  ctx.slots.inject("conversation.hero.brand.mark", () => ctx.slots.register({ name: "conversation.hero.brand.mark", priority: BRAND_PRIORITY }, HeroMark));
}

return module.exports; } });
