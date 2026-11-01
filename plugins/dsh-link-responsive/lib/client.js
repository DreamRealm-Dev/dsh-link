window.__ModuleLoader__.load({ id: "dsh-link-responsive", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/dsh-link-responsive/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  LAYOUT_SETTLE_MS: () => LAYOUT_SETTLE_MS,
  apply: () => apply,
  shippedBands: () => shippedBands,
  watchLayout: () => watchLayout
});
module.exports = __toCommonJS(index_exports);

// plugins/dsh-link-responsive/bands.json
var bands_default = {
  format: "dsh-link.responsive-bands/1",
  bands: [
    { name: "narrow", maxWidth: 720, decisions: { sidebar: "drawer", toolbar: "condensed", gap: 4 } },
    { name: "wide", minWidth: 1080, decisions: { sidebar: "docked", toolbar: "full", gap: 12 } },
    { name: "default", catchAll: true, decisions: { sidebar: "docked", toolbar: "compact", gap: 8 } }
  ]
};

// plugins/dsh-link-responsive/src/client/layout-plan.ts
var BANDS_FORMAT = "dsh-link.responsive-bands/1";
var isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function loadBands(raw) {
  const bad = (detail) => ({ ok: false, reason: "bad-bands", bands: null, detail });
  if (!isPlainObject(raw)) return bad("the band table is not an object");
  if (raw.format !== BANDS_FORMAT) return bad("unknown format " + JSON.stringify(raw.format ?? null) + "; this build reads " + BANDS_FORMAT);
  if (!Array.isArray(raw.bands)) return bad("bands is not an array");
  const names = /* @__PURE__ */ new Set();
  let catchAlls = 0;
  const bands = [];
  for (const entry of raw.bands) {
    if (!isPlainObject(entry)) return bad("a band is not an object");
    const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : null;
    if (name === null) return bad("a band has no usable name");
    if (names.has(name)) return bad("the band name " + JSON.stringify(name) + " appears twice");
    names.add(name);
    if (!isPlainObject(entry.decisions)) return bad("the band " + JSON.stringify(name) + " has no decisions object");
    for (const bound of ["minWidth", "maxWidth"]) {
      const value = entry[bound];
      if (value === void 0) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return bad("the band " + JSON.stringify(name) + " has a " + bound + " of " + JSON.stringify(value) + ", not a finite width");
    }
    if (entry.catchAll !== void 0 && typeof entry.catchAll !== "boolean") return bad("the band " + JSON.stringify(name) + " has a catchAll that is not a boolean");
    if (entry.catchAll === true) catchAlls += 1;
    bands.push({
      name,
      ...entry.minWidth === void 0 ? {} : { minWidth: entry.minWidth },
      ...entry.maxWidth === void 0 ? {} : { maxWidth: entry.maxWidth },
      ...entry.catchAll === void 0 ? {} : { catchAll: entry.catchAll },
      decisions: { ...entry.decisions }
    });
  }
  if (catchAlls > 1) return bad("the table carries " + String(catchAlls) + " catch-all bands; at most one can answer for the rest");
  return { ok: true, reason: "ok", bands: { format: BANDS_FORMAT, bands }, detail: null };
}
function planLayout(width, bands) {
  if (typeof width !== "number" || !Number.isFinite(width) || width < 0) {
    throw new TypeError("planLayout: width must be a finite number of CSS pixels that is not negative, got " + JSON.stringify(width));
  }
  for (const band of bands.bands) {
    const matchedBy = band.catchAll === true ? "catchAll" : band.maxWidth !== void 0 && width <= band.maxWidth ? "maxWidth" : band.minWidth !== void 0 && width >= band.minWidth ? "minWidth" : null;
    if (matchedBy === null) continue;
    return { ok: true, reason: "ok", plan: { band: band.name, width, decisions: { ...band.decisions }, matchedBy } };
  }
  return { ok: false, reason: "no-band", plan: null };
}

// plugins/dsh-link-responsive/src/client/apply-layout.ts
var BAND_ATTRIBUTE = "data-dsh-link-layout";
var decisionProperty = (key) => "--dsh-link-" + key;
function applyLayout(target, plan, previous) {
  const wrote = [];
  const removed = [];
  if (previous === null || previous.band !== plan.band) {
    target.setAttribute(BAND_ATTRIBUTE, String(plan.band));
    wrote.push(BAND_ATTRIBUTE);
  }
  const stale = previous === null ? [] : Object.keys(previous.decisions).filter((key) => !Object.prototype.hasOwnProperty.call(plan.decisions, key)).sort();
  if (stale.length > 0 && typeof target.style.removeProperty !== "function") {
    throw new TypeError("applyLayout: the target cannot remove the stale decision(s) " + JSON.stringify(stale) + "; leaving them in place would let the previous band keep winning");
  }
  for (const key of stale) {
    target.style.removeProperty?.(decisionProperty(key));
    removed.push(key);
  }
  for (const key of Object.keys(plan.decisions)) {
    const value = String(plan.decisions[key]);
    if (previous !== null && Object.prototype.hasOwnProperty.call(previous.decisions, key) && String(previous.decisions[key]) === value) continue;
    target.style.setProperty(decisionProperty(key), value);
    wrote.push(decisionProperty(key));
  }
  return { wrote, removed };
}

// plugins/dsh-link-responsive/src/client/index.tsx
var LAYOUT_SETTLE_MS = 120;
function shippedBands(raw = bands_default) {
  const loaded = loadBands(raw);
  return loaded.ok ? loaded.bands : null;
}
function watchLayout(view) {
  const bands = shippedBands();
  const root = view.document.documentElement;
  let current = null;
  let timer = null;
  const look = (width) => {
    if (bands === null) return null;
    const planned = planLayout(width, bands);
    if (!planned.ok || planned.plan === null) return current;
    const result = applyLayout({ setAttribute: (name, value) => root.setAttribute(name, value), style: root.style }, planned.plan, current);
    void result;
    current = planned.plan;
    return current;
  };
  const onResize = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      look(view.window.innerWidth);
    }, LAYOUT_SETTLE_MS);
  };
  look(view.window.innerWidth);
  view.window.addEventListener("resize", onResize);
  return {
    look,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      view.window.removeEventListener("resize", onResize);
    }
  };
}
function apply(ctx) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const watcher = watchLayout({ document, window });
  ctx.effect?.(() => () => watcher.dispose());
}

return module.exports; } });
