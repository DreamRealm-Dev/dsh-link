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
    const name2 = typeof entry.name === "string" && entry.name !== "" ? entry.name : null;
    if (name2 === null) return bad("a band has no usable name");
    if (names.has(name2)) return bad("the band name " + JSON.stringify(name2) + " appears twice");
    names.add(name2);
    if (!isPlainObject(entry.decisions)) return bad("the band " + JSON.stringify(name2) + " has no decisions object");
    for (const bound of ["minWidth", "maxWidth"]) {
      const value = entry[bound];
      if (value === void 0) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return bad("the band " + JSON.stringify(name2) + " has a " + bound + " of " + JSON.stringify(value) + ", not a finite width");
    }
    if (entry.catchAll !== void 0 && typeof entry.catchAll !== "boolean") return bad("the band " + JSON.stringify(name2) + " has a catchAll that is not a boolean");
    if (entry.catchAll === true) catchAlls += 1;
    bands.push({
      name: name2,
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

// plugins/dsh-link-responsive/src/index.ts
var name = "dsh-link-responsive";
function apply() {
}
export {
  BANDS_FORMAT,
  BAND_ATTRIBUTE,
  apply,
  applyLayout,
  decisionProperty,
  loadBands,
  name,
  planLayout
};
