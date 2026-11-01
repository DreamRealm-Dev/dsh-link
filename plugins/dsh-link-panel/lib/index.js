// plugins/dsh-link-panel/src/index.ts
var name = "dsh-link-panel";
var inject = [];
var PANEL_KINDS = Object.freeze(["pane", "action", "status"]);
var PANEL_REJECT = Object.freeze({
  DUP_ID: "PANEL_DUP_ID",
  UNKNOWN_KIND: "PANEL_UNKNOWN_KIND",
  EMPTY_SOURCE: "PANEL_EMPTY_SOURCE"
});
var PANEL_SINKS = Object.freeze(["right-rail", "header"]);
var PANEL_KIND_SINKS = Object.freeze({
  pane: "right-rail",
  action: "right-rail",
  status: "header"
});
var PANEL_ROUTE_PATH = "/api/dsh-link-panel/state";
var PANEL_VIA_LOADER = "link.compat";
var PANEL_VIA_SERVER = "ctx.server";
var PANEL_COMPAT_ROLE = "http.registerRoute";
function roleWord(role) {
  const at = role.indexOf(".");
  return at === -1 ? role : role.slice(at + 1);
}
var PANEL_COMPAT_MEMBER = roleWord(PANEL_COMPAT_ROLE);
var KIND_SET = new Set(PANEL_KINDS);
var SINK_SET = new Set(PANEL_SINKS);
var FALLBACK_KIND = PANEL_KINDS[0];
var PRECEDENCE = Object.freeze([PANEL_REJECT.UNKNOWN_KIND, PANEL_REJECT.EMPTY_SOURCE, PANEL_REJECT.DUP_ID]);
var FIELDS = Object.freeze(["id", "kind", "title", "source", "order"]);
function show(value) {
  if (typeof value === "number" && Number.isFinite(value) === false) return String(value);
  const text = JSON.stringify(value);
  return text === void 0 ? String(value) : text;
}
function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function canonical(value) {
  const text = JSON.stringify(value);
  return text === void 0 ? String(value) : text;
}
function readField(holder, key) {
  try {
    return { value: holder[key], error: null };
  } catch (error) {
    return { value: null, error: "reading " + key + " threw: " + (error instanceof Error ? error.message : String(error)) };
  }
}
function portable(value) {
  if (value === null || value === void 0) return { value: null, note: null };
  const type = typeof value;
  if (type === "string" || type === "boolean") return { value, note: null };
  if (type === "number") return { value: Number.isFinite(value) ? value : null, note: Number.isFinite(value) ? null : "a field is a scalar and this number is not finite; it is carried as null: " + show(value) };
  return { value: null, note: "a field is a scalar and this one is not; it is carried as null: " + show(value) };
}
function normalizeEntry(raw) {
  const errors = [];
  const holder = raw !== null && (typeof raw === "object" || typeof raw === "function") ? raw : null;
  if (holder === null) errors.push("the item is not an object: " + show(raw));
  const fields = {};
  for (const key of FIELDS) {
    if (holder === null) {
      fields[key] = null;
      continue;
    }
    const read = readField(holder, key);
    if (read.error !== null) errors.push(read.error);
    const carried = portable(read.value);
    if (carried.note !== null) errors.push(key + ": " + carried.note);
    fields[key] = carried.value;
  }
  if (typeof fields.id !== "string" || fields.id.trim() === "") errors.push("id must be a non-empty string (got " + show(fields.id) + ")");
  if (typeof fields.title !== "string" || fields.title.trim() === "") errors.push("title must be a non-empty string (got " + show(fields.title) + ")");
  if (typeof fields.order !== "number" || Number.isFinite(fields.order) === false) errors.push("order must be a finite number (got " + show(fields.order) + ")");
  return { entry: fields, errors };
}
function refusalOfKind(entry) {
  if (!KIND_SET.has(entry.kind)) return PANEL_REJECT.UNKNOWN_KIND;
  return null;
}
function refusalOf(entry, issues) {
  const code = PRECEDENCE.find((name2) => issues.some((issue) => issue.code === name2)) ?? null;
  const id = typeof entry.id === "string" && entry.id.trim() !== "" ? entry.id : null;
  return { id, code, detail: issues.map((issue) => issue.detail).join("; "), entry: { ...entry } };
}
function mountedSet(sinks) {
  if (sinks === void 0 || sinks === null) return new Set(PANEL_SINKS);
  if (Array.isArray(sinks) === false) {
    throw new TypeError("projectPanel: options.sinks must be an array of sink names (got " + show(sinks) + ")");
  }
  return new Set(sinks);
}
var PanelRefusal = class extends Error {
  code;
  rejected;
  constructor(rejected) {
    const code = PRECEDENCE.find((candidate) => rejected.some((row) => row.code === candidate)) ?? null;
    super(
      "panel projection refused " + String(rejected.length) + " item(s)" + (code === null ? " (none of the three named codes: the original text is carried below)" : " by " + code) + ": " + rejected.map((row) => "id " + show(row.id) + " [" + String(row.code ?? "no code") + "] " + row.detail).join(" | ")
    );
    this.name = "PanelRefusal";
    this.code = code;
    this.rejected = rejected;
  }
};
function projectPanel(entries, options = {}) {
  if (Array.isArray(entries) === false) {
    throw new TypeError("projectPanel: entries must be an array (got " + show(entries) + ") \u2014 a registry is data, and a caller that hands it something else has a bug, not a refused item");
  }
  const settings = options !== null && typeof options === "object" ? options : {};
  const mounted = mountedSet(settings.sinks);
  const read = entries.map((raw) => normalizeEntry(raw));
  const claimants = /* @__PURE__ */ new Map();
  for (const item of read) {
    const id = item.entry.id;
    if (typeof id !== "string" || id.trim() === "") continue;
    const list = claimants.get(id) ?? [];
    list.push(String(item.entry.order));
    claimants.set(id, list);
  }
  const visible = [];
  const rejected = [];
  for (const item of read) {
    const entry = item.entry;
    const issues = [];
    for (const text of item.errors) issues.push({ code: null, detail: text });
    const unknownKind = refusalOfKind(entry);
    if (unknownKind !== null) {
      issues.push({ code: unknownKind, detail: "unknown kind " + show(entry.kind) + "; the closed set is " + PANEL_KINDS.join(", ") });
    }
    if (typeof entry.source !== "string" || entry.source.trim() === "") {
      issues.push({
        code: PANEL_REJECT.EMPTY_SOURCE,
        detail: "source is empty (got " + show(entry.source) + "): an item that cannot say where it comes from is not showable"
      });
    }
    const claims = claimants.get(entry.id) ?? [];
    if (claims.length > 1) {
      issues.push({
        code: PANEL_REJECT.DUP_ID,
        detail: "duplicate id " + show(entry.id) + ": " + String(claims.length) + " items claim it (order " + [...claims].sort(compareText).join(", ") + "); every claimant is refused, because keeping one would let arrival order decide what the panel shows"
      });
    }
    if (issues.length === 0) {
      const sink = PANEL_KIND_SINKS[entry.kind] ?? null;
      if (sink === null || mounted.has(sink) === false) {
        issues.push({
          code: null,
          detail: "kind " + show(entry.kind) + " is shown in sink " + show(sink) + ", which this projection does not have mounted (mounted: " + [...mounted].sort(compareText).join(", ") + ")"
        });
      }
    }
    if (issues.length === 0) visible.push(entry);
    else rejected.push(refusalOf(entry, issues));
  }
  visible.sort((a, b) => a.order - b.order || compareText(canonical(a), canonical(b)));
  rejected.sort((a, b) => compareText(canonical(a), canonical(b)));
  if (settings.strict === true) {
    const named = rejected.filter((row) => row.code !== null);
    if (named.length > 0) throw new PanelRefusal(named);
  }
  return { visible, rejected };
}
function admitsPanel(entries, options = {}) {
  try {
    projectPanel(entries, { ...options ?? {}, strict: true });
    return true;
  } catch (error) {
    if (error instanceof PanelRefusal) return error;
    throw error;
  }
}
function readEntries(value) {
  if (value === void 0 || value === null) return [];
  if (Array.isArray(value) === false) {
    throw new Error("dsh-link-panel: config.entries must be an array of panel items, got " + show(value) + " \u2014 a row that declares something else is refused at mount, because an empty panel and a broken one must not look the same");
  }
  return value;
}
function readMounted(value) {
  if (value === void 0 || value === null) return [];
  if (Array.isArray(value) === false) {
    throw new Error("dsh-link-panel: config.sinks must be an array of sink names, got " + show(value));
  }
  for (const entry of value) {
    if (typeof entry !== "string" || SINK_SET.has(entry) === false) {
      throw new Error("dsh-link-panel: config.sinks names an unknown sink " + show(entry) + "; this build knows " + PANEL_SINKS.join(", ") + " \u2014 a misspelled sink would silently show an empty panel, so it is refused");
    }
  }
  return value;
}
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(text);
}
function apply(ctx, config = {}) {
  const settings = config ?? {};
  const path = typeof settings.path === "string" && settings.path.startsWith("/") ? settings.path : PANEL_ROUTE_PATH;
  const items = readEntries(settings.entries);
  const sinksMounted = readMounted(settings.sinks);
  const disposers = [];
  let bound = false;
  let served = 0;
  let refused = 0;
  const binding = {
    present: false,
    via: null,
    role: null,
    refused: null
  };
  function snapshot() {
    const declared = projectPanel(items, { sinks: PANEL_SINKS });
    const mounted = projectPanel(items, { sinks: sinksMounted });
    return {
      status: 200,
      body: {
        ok: true,
        // Only the ROUTE reads a clock; the projection never does, so nothing here can make the
        // projection's own bytes differ between two calls.
        at: Date.now(),
        path,
        readOnly: true,
        registry: {
          entries: items.length,
          kinds: PANEL_KINDS,
          sinks: PANEL_SINKS,
          kindSinks: PANEL_KIND_SINKS,
          sinksMounted,
          route: path
        },
        declared,
        mounted,
        served: served + 1,
        // Which face carries this route (R197). Appended rather than woven in: every field above keeps
        // the bytes it had in R188, which is what gates 124/127/128 compare this answer by.
        compat: {
          present: binding.present,
          via: binding.via,
          role: binding.role,
          refused: binding.refused
        }
      }
    };
  }
  async function handler(req, res) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        refused += 1;
        sendJson(res, 405, {
          ok: false,
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "dsh-link-panel state is read-only: GET is the only verb, and " + String(req.method) + " was refused"
          }
        });
        return;
      }
      const answer = snapshot();
      served += 1;
      sendJson(res, answer.status, answer.body);
    } catch (error) {
      refused += 1;
      sendJson(res, 500, {
        ok: false,
        error: { code: "SNAPSHOT_FAILED", message: error instanceof Error ? error.message : String(error) }
      });
    }
  }
  const route = { kind: "exact", path, handler };
  function loaderFace() {
    let link;
    try {
      link = typeof ctx.get === "function" ? ctx.get("link") : void 0;
    } catch (error) {
      return { compat: null, refused: 'reading ctx.get("link") threw: ' + (error instanceof Error ? error.message : String(error)) };
    }
    const face = link === null || link === void 0 ? void 0 : link.compat;
    if (face === null || face === void 0) return { compat: null, refused: null };
    if (typeof face !== "object" && typeof face !== "function" || typeof face.capability !== "function") {
      return {
        compat: null,
        refused: 'the "link" service on this context carries no compat face with a callable capability member (got ' + show(face) + ")"
      };
    }
    return { compat: face, refused: null };
  }
  function bindThroughLoader(face) {
    try {
      const capability = face.capability("http");
      const register = capability === null || capability === void 0 ? void 0 : capability[PANEL_COMPAT_MEMBER];
      if (typeof register !== "function") {
        return {
          ok: false,
          disposer: null,
          refused: `the loader's "http" capability has no callable "` + PANEL_COMPAT_MEMBER + '" member for role ' + PANEL_COMPAT_ROLE + " (got " + show(register) + ")"
        };
      }
      const disposer = register(route);
      return { ok: true, disposer: typeof disposer === "function" ? disposer : null, refused: null };
    } catch (error) {
      return { ok: false, disposer: null, refused: error instanceof Error ? error.message : String(error) };
    }
  }
  function announceBound() {
    console.log("[dsh-link-panel] state route bound on " + path + " (GET, read-only)");
    console.log("[dsh-link-panel] registration face " + String(binding.via) + ", role " + show(binding.role) + ", loader present " + String(binding.present) + (binding.refused === null ? "" : ", loader refused: " + binding.refused));
  }
  function webServer() {
    const server = ctx.get("webServer");
    return server === void 0 || server === null || typeof server.register !== "function" ? null : server;
  }
  function registerRoute() {
    if (bound) return;
    const server = webServer();
    if (server === null) return;
    const loader = loaderFace();
    binding.present = loader.compat !== null;
    if (loader.compat !== null) {
      const attempt = bindThroughLoader(loader.compat);
      if (attempt.ok) {
        if (attempt.disposer !== null) disposers.push(attempt.disposer);
        bound = true;
        binding.via = PANEL_VIA_LOADER;
        binding.role = PANEL_COMPAT_ROLE;
        binding.refused = null;
        announceBound();
        return;
      }
      binding.refused = attempt.refused;
      console.error("[dsh-link-panel] the loader refused the state route: " + String(attempt.refused) + " \u2014 registering through " + PANEL_VIA_SERVER + " instead");
    } else if (loader.refused !== null) {
      binding.refused = loader.refused;
      console.error("[dsh-link-panel] the loader could not be read: " + loader.refused + " \u2014 registering through " + PANEL_VIA_SERVER + " instead");
    }
    try {
      disposers.push(server.register(route));
      bound = true;
      binding.via = PANEL_VIA_SERVER;
      binding.role = null;
      announceBound();
    } catch (error) {
      console.error("[dsh-link-panel] could not bind the state route: " + (error instanceof Error ? error.message : String(error)));
    }
  }
  registerRoute();
  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], () => registerRoute());
  }
  if (typeof ctx.effect === "function") {
    ctx.effect(
      () => () => {
        bound = false;
        for (const dispose of disposers.splice(0)) {
          try {
            dispose();
          } catch {
          }
        }
      },
      "dsh-link-panel: state route"
    );
  }
  const boot = projectPanel(items, { sinks: PANEL_SINKS });
  for (const row of boot.rejected) {
    console.log("[dsh-link-panel] refused " + String(row.code ?? "(no code)") + ": " + row.detail);
  }
  console.log("[dsh-link-panel] ready \u2014 " + String(items.length) + " panel item(s) declared, " + String(boot.rejected.length) + " refused, " + String(boot.visible.length) + " visible when every sink is mounted; " + String(sinksMounted.length) + " sink(s) mounted here" + (sinksMounted.length === 0 ? " (no client shell this round: every item is declared, none is on screen)" : "") + (bound ? "" : " (route pending webServer)"));
}
var index_default = { name, inject, apply };
export {
  PANEL_COMPAT_MEMBER,
  PANEL_COMPAT_ROLE,
  PANEL_KINDS,
  PANEL_KIND_SINKS,
  PANEL_REJECT,
  PANEL_ROUTE_PATH,
  PANEL_SINKS,
  PANEL_VIA_LOADER,
  PANEL_VIA_SERVER,
  PanelRefusal,
  admitsPanel,
  apply,
  index_default as default,
  inject,
  name,
  projectPanel
};
