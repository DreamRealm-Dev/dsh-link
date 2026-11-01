window.__ModuleLoader__.load({ id: "dsh-link-panel", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/dsh-link-panel/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");

// plugins/dsh-link-panel/src/client/view.ts
var PANEL_TAB_ID = "dsh-link-panel";
var PANEL_TAB_KIND = "pane";
var PANEL_STATE_PATH = "/api/dsh-link-panel/state";
var NOTES_STATE_PATH = "/api/dsh-link-notes/state";
var NOTES_ADD_PATH = "/api/dsh-link-notes/add";
var USER_AUTHOR = "user";
var CLIENT_FAILURES = Object.freeze({
  UNREADABLE: "response-unreadable",
  SHAPE: "response-shape"
});
var QUOTE_LIMIT = 200;
function errorText(error) {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object") {
    const message = field(error, "message");
    if (typeof message === "string" && message !== "") return message;
  }
  return String(error);
}
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value) === false) return String(value);
  try {
    const text = JSON.stringify(value);
    return text === void 0 ? String(value) : text;
  } catch {
    return String(value);
  }
}
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function quote(text) {
  return text.length <= QUOTE_LIMIT ? text : text.slice(0, QUOTE_LIMIT) + "\u2026 (" + String(text.length) + " characters in all; the first " + String(QUOTE_LIMIT) + " are quoted)";
}
function field(holder, key) {
  const target = holder !== null && (typeof holder === "object" || typeof holder === "function") ? holder : null;
  if (target === null) return void 0;
  try {
    return target[key];
  } catch {
    return void 0;
  }
}
function isHolder(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}
function textAt(holder, key) {
  const value = field(holder, key);
  return typeof value === "string" ? value : null;
}
function keysOf(holder) {
  if (!isHolder(holder)) return "(not an object)";
  try {
    return Object.keys(holder).sort(compareText).join(", ");
  } catch {
    return "(unreadable)";
  }
}
function shapeFailure(subject, detail) {
  return { ok: false, code: CLIENT_FAILURES.SHAPE, detail: subject + ": " + detail, from: "client" };
}
function envelopeFailure(answer, subject) {
  if (answer === null || typeof answer !== "object") {
    return { ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: subject + ": no answer object at all: " + show(answer), from: "client" };
  }
  if (typeof answer.transport === "string" && answer.transport !== "") {
    return { ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: subject + ": no answer \u2014 " + answer.transport, from: "client" };
  }
  if (typeof answer.status !== "number") {
    return { ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: subject + ": the request was never sent (no status, no transport error)", from: "client" };
  }
  if (!isHolder(answer.body)) {
    return {
      ok: false,
      code: CLIENT_FAILURES.UNREADABLE,
      detail: subject + ": HTTP " + String(answer.status) + " and the body is not a JSON object: " + quote(typeof answer.text === "string" ? answer.text : ""),
      from: "client"
    };
  }
  if (field(answer.body, "ok") === false) {
    const error = field(answer.body, "error");
    const code = textAt(error, "code");
    const message = textAt(error, "message");
    return {
      ok: false,
      code: code === null || code === "" ? CLIENT_FAILURES.SHAPE : code,
      detail: message ?? subject + ": HTTP " + String(answer.status) + " refused without naming a code, and its body carries no message: " + quote(String(answer.text)),
      from: code === null || code === "" ? "client" : "route"
    };
  }
  return null;
}
function readPanelState(answer) {
  const subject = "GET " + PANEL_STATE_PATH;
  const refused = envelopeFailure(answer, subject);
  if (refused !== null) return refused;
  const declared = field(answer.body, "declared");
  if (!isHolder(declared)) {
    return shapeFailure(subject, "declared is missing or not an object (top-level keys: " + keysOf(answer.body) + ")");
  }
  const visible = field(declared, "visible");
  if (Array.isArray(visible) === false) {
    return shapeFailure(subject, "declared.visible must be an array (got " + show(visible) + ")");
  }
  for (let index = 0; index < visible.length; index += 1) {
    if (!isHolder(visible[index])) {
      return shapeFailure(subject, "declared.visible[" + String(index) + "] is not an item object: " + show(visible[index]) + " \u2014 an item this pane cannot read is a failure with a name, not an item to skip");
    }
  }
  const rejected = field(declared, "rejected");
  if (Array.isArray(rejected) === false) {
    return shapeFailure(subject, "declared.rejected must be an array (got " + show(rejected) + ")");
  }
  const refusals = [];
  for (let index = 0; index < rejected.length; index += 1) {
    const row = rejected[index];
    if (!isHolder(row)) {
      return shapeFailure(subject, "declared.rejected[" + String(index) + "] is not a refusal object: " + show(row));
    }
    refusals.push({
      id: textAt(row, "id"),
      code: textAt(row, "code"),
      detail: textAt(row, "detail") ?? show(row)
    });
  }
  const registryRaw = field(answer.body, "registry");
  const registry = isHolder(registryRaw) ? {
    kinds: field(registryRaw, "kinds"),
    sinks: field(registryRaw, "sinks"),
    kindSinks: field(registryRaw, "kindSinks"),
    sinksMounted: field(registryRaw, "sinksMounted"),
    entries: field(registryRaw, "entries")
  } : null;
  return { ok: true, items: visible, refused: refusals, registry };
}
function readNotesState(answer) {
  const subject = "GET " + NOTES_STATE_PATH;
  const refused = envelopeFailure(answer, subject);
  if (refused !== null) return refused;
  const limits = field(answer.body, "limits");
  if (!isHolder(limits) || typeof field(limits, "maxNotes") !== "number" || typeof field(limits, "maxChars") !== "number") {
    return shapeFailure(subject, "limits must be an object carrying maxNotes and maxChars as numbers (got " + show(limits) + ") \u2014 the pane shows the thresholds the route reports and must not invent one");
  }
  const list = field(answer.body, "notes");
  if (Array.isArray(list) === false) {
    return shapeFailure(subject, "notes must be an array (got " + show(list) + "; top-level keys: " + keysOf(answer.body) + ")");
  }
  const rows = [];
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index];
    if (!isHolder(row) || typeof field(row, "text") !== "string") {
      return shapeFailure(subject, "notes[" + String(index) + "] is not a note object with a string text: " + show(row));
    }
    const tags = field(row, "tags");
    rows.push({
      id: textAt(row, "id"),
      text: field(row, "text"),
      tags: Array.isArray(tags) && tags.every((tag) => typeof tag === "string") ? tags : null,
      author: textAt(row, "author"),
      state: textAt(row, "state")
    });
  }
  return { ok: true, rows, limits, counts: field(answer.body, "counts") ?? null };
}
function noteRequest(text) {
  return { path: NOTES_ADD_PATH, body: JSON.stringify({ text, author: USER_AUTHOR }) };
}
function readSubmit(answer) {
  const subject = "POST " + NOTES_ADD_PATH;
  const refused = envelopeFailure(answer, subject);
  if (refused !== null) return { ok: false, code: refused.code, detail: refused.detail, from: refused.from };
  const id = textAt(answer.body, "id");
  const seq = field(answer.body, "seq");
  const at = typeof seq === "number" ? " (seq " + String(seq) + ")" : "";
  return {
    ok: true,
    code: "added",
    detail: id === null ? "the route accepted the note" + at : "note " + id + at,
    from: "route"
  };
}
function emptyView(tabId = PANEL_TAB_ID) {
  return {
    tabId,
    reads: { panel: "pending", notes: "pending" },
    items: [],
    refused: [],
    registry: null,
    notes: { rows: [], limits: null, counts: null },
    contributed: [],
    contributedRefused: [],
    failures: []
  };
}
function sortFailures(failures) {
  return [...failures].sort((left, right) => compareText(left.source, right.source) || compareText(left.code, right.code) || compareText(left.detail, right.detail));
}
function withArrival(view, arrival) {
  const failures = arrival.read.ok ? view.failures : [...view.failures, { source: arrival.source, code: arrival.read.code, detail: arrival.read.detail, from: arrival.read.from }];
  const slots = arrival.source === "panel" ? {
    reads: { panel: arrival.read.ok ? "ok" : "failed", notes: view.reads.notes },
    items: arrival.read.ok ? arrival.read.items : [],
    refused: arrival.read.ok ? arrival.read.refused : view.refused,
    registry: arrival.read.ok ? arrival.read.registry : view.registry,
    notes: view.notes,
    contributed: view.contributed,
    contributedRefused: view.contributedRefused
  } : {
    reads: { panel: view.reads.panel, notes: arrival.read.ok ? "ok" : "failed" },
    items: view.items,
    refused: view.refused,
    registry: view.registry,
    notes: arrival.read.ok ? { rows: arrival.read.rows, limits: arrival.read.limits, counts: arrival.read.counts } : view.notes,
    contributed: view.contributed,
    contributedRefused: view.contributedRefused
  };
  return {
    tabId: view.tabId,
    reads: slots.reads,
    items: slots.items,
    refused: slots.refused,
    registry: slots.registry,
    notes: slots.notes,
    contributed: slots.contributed,
    contributedRefused: slots.contributedRefused,
    failures: sortFailures(failures)
  };
}
function withContributions(view, contributed, refused) {
  return {
    tabId: view.tabId,
    reads: view.reads,
    items: view.items,
    refused: view.refused,
    registry: view.registry,
    notes: view.notes,
    contributed,
    contributedRefused: refused,
    failures: view.failures
  };
}
function foldArrivals(arrivals, tabId = PANEL_TAB_ID) {
  let view = emptyView(tabId);
  for (const arrival of arrivals) view = withArrival(view, arrival);
  return view;
}
function markerFrom(view) {
  if (view.failures.length > 0) {
    const first = sortFailures(view.failures)[0];
    return { mounted: true, failed: first.code + ": " + first.detail };
  }
  return {
    mounted: true,
    tabId: view.tabId,
    items: view.items,
    notes: { count: view.notes.rows.length, limits: view.notes.limits },
    contributed: view.contributed,
    failed: null
  };
}

// plugins/dsh-link-panel/src/client/contributions.ts
var LINK_PANEL_SERVICE = "linkPanel";
var CONTRIBUTION_KINDS = Object.freeze(["pane", "action", "status"]);
var CONTRIBUTION_REJECT = Object.freeze({
  DUP_ID: "PANEL_DUP_ID",
  UNKNOWN_KIND: "PANEL_UNKNOWN_KIND",
  EMPTY_SOURCE: "PANEL_EMPTY_SOURCE"
});
var KIND_SET = new Set(CONTRIBUTION_KINDS);
var PRECEDENCE = Object.freeze([CONTRIBUTION_REJECT.UNKNOWN_KIND, CONTRIBUTION_REJECT.EMPTY_SOURCE, CONTRIBUTION_REJECT.DUP_ID]);
var FIELDS = Object.freeze(["id", "kind", "source"]);
function show2(value) {
  if (typeof value === "number" && Number.isFinite(value) === false) return String(value);
  try {
    const text = JSON.stringify(value);
    return text === void 0 ? String(value) : text;
  } catch {
    return String(value);
  }
}
function compareText2(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function readField(holder, key) {
  if (holder === null || typeof holder !== "object" && typeof holder !== "function") return { value: void 0, error: null };
  try {
    return { value: holder[key], error: null };
  } catch (error) {
    return { value: void 0, error: "reading " + key + " threw: " + errorText(error) };
  }
}
function portable(value, key, errors) {
  if (value === null || value === void 0) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") {
    if (Number.isFinite(value)) return value;
    errors.push(key + ": a field is a scalar and this number is not finite; it is carried as null: " + show2(value));
    return null;
  }
  errors.push(key + ": a field is a scalar and this one is not; it is carried as null: " + show2(value));
  return null;
}
function readText(value, key, errors) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "function") {
    errors.push(key + " must be a string or a function returning one (got " + show2(value) + "); a row is refused rather than given text nobody wrote");
    return "";
  }
  try {
    const answer = value();
    return typeof answer === "string" ? answer : show2(answer);
  } catch (error) {
    return errorText(error);
  }
}
function readDeclaration(raw) {
  const errors = [];
  const holder = raw !== null && (typeof raw === "object" || typeof raw === "function") ? raw : null;
  if (holder === null) errors.push("the declaration is not an object: " + show2(raw));
  const carried = {};
  for (const key of FIELDS) {
    const held = readField(holder, key);
    if (held.error !== null) errors.push(held.error);
    carried[key] = portable(held.value, key, errors);
  }
  if (typeof carried.id !== "string" || carried.id.trim() === "") errors.push("id must be a non-empty string (got " + show2(carried.id) + ")");
  const spelledTitle = readField(holder, "title");
  if (spelledTitle.error !== null) errors.push(spelledTitle.error);
  const title = readText(spelledTitle.value, "title", errors);
  if (title.trim() === "") errors.push("title must be a non-empty string, or a function answering one (got " + show2(spelledTitle.value) + ")");
  const spelled = readField(holder, "order");
  if (spelled.error !== null) errors.push(spelled.error);
  const declaredOrder = spelled.value === null || spelled.value === void 0 ? 0 : spelled.value;
  if (typeof declaredOrder !== "number" || Number.isFinite(declaredOrder) === false) errors.push("order must be a finite number (got " + show2(spelled.value) + ")");
  const body = readField(holder, "body");
  if (body.error !== null) errors.push(body.error);
  const spelledInvoke = readField(holder, "invoke");
  if (spelledInvoke.error !== null) errors.push(spelledInvoke.error);
  const invoke = typeof spelledInvoke.value === "function" ? spelledInvoke.value : null;
  if (invoke === null && spelledInvoke.value !== null && spelledInvoke.value !== void 0) {
    errors.push("invoke must be a function (got " + show2(spelledInvoke.value) + "); a field that is neither a function nor absent refuses the row rather than promising a press nobody can make");
  }
  if (carried.kind === "action" && invoke === null) {
    errors.push("kind action needs a callable invoke (got " + show2(spelledInvoke.value) + "); an action nobody can press is refused by its own text rather than drawn as a reading");
  }
  const row = {
    id: carried.id,
    kind: carried.kind,
    title,
    source: carried.source,
    order: typeof declaredOrder === "number" && Number.isFinite(declaredOrder) ? declaredOrder : 0,
    body: readText(body.value, "body", errors),
    hasInvoke: invoke !== null
  };
  return { row, errors };
}
function refusalOfKind(row) {
  if (!KIND_SET.has(row.kind)) return CONTRIBUTION_REJECT.UNKNOWN_KIND;
  return null;
}
function refusalOf(row, issues) {
  const code = PRECEDENCE.find((name) => issues.some((issue) => issue.code === name)) ?? null;
  const id = typeof row.id === "string" && row.id.trim() !== "" ? row.id : null;
  return Object.freeze({ id, code, detail: issues.map((issue) => issue.detail).join("; ") });
}
function projectContributions(claims) {
  if (Array.isArray(claims) === false) {
    throw new TypeError("projectContributions: the declarations must be an array (got " + show2(claims) + ") - a caller that hands it something else has a bug, not a refused declaration");
  }
  const read = claims.map((raw) => readDeclaration(raw));
  const claimants = /* @__PURE__ */ new Map();
  for (const item of read) {
    const id = item.row.id;
    if (typeof id !== "string" || id.trim() === "") continue;
    const list = claimants.get(id) ?? [];
    list.push(String(item.row.order));
    claimants.set(id, list);
  }
  const visible = [];
  const rejected = [];
  for (const item of read) {
    const row = item.row;
    const issues = [];
    for (const detail of item.errors) issues.push({ code: null, detail });
    const unknownKind = refusalOfKind(row);
    if (unknownKind !== null) issues.push({ code: unknownKind, detail: "unknown kind " + show2(row.kind) + "; the closed set is " + CONTRIBUTION_KINDS.join(", ") });
    if (typeof row.source !== "string" || row.source.trim() === "") {
      issues.push({ code: CONTRIBUTION_REJECT.EMPTY_SOURCE, detail: "source is empty (got " + show2(row.source) + "): an item that cannot say where it comes from is not showable" });
    }
    const claimed = claimants.get(row.id) ?? [];
    if (claimed.length > 1) {
      issues.push({
        code: CONTRIBUTION_REJECT.DUP_ID,
        detail: "duplicate id " + show2(row.id) + ": " + String(claimed.length) + " declarations claim it (order " + [...claimed].sort(compareText2).join(", ") + "); every claimant is refused, because keeping one would let arrival order decide what the panel shows"
      });
    }
    if (issues.length === 0) visible.push(row);
    else rejected.push(refusalOf(row, issues));
  }
  visible.sort((left, right) => left.order - right.order || compareText2(show2(left), show2(right)));
  rejected.sort((left, right) => compareText2(show2(left), show2(right)));
  return { visible: Object.freeze(visible), rejected: Object.freeze(rejected) };
}
function createLinkPanelService() {
  const claims = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  function project() {
    const projected = projectContributions([...claims.values()]);
    return {
      visible: Object.freeze(projected.visible.map((row) => Object.freeze({ ...row }))),
      rejected: projected.rejected
    };
  }
  function announce() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("dsh-link-panel: a contribution listener threw: " + errorText(error));
      }
    }
  }
  return {
    declare(definition) {
      const key = Symbol("dsh-link-panel-contribution");
      claims.set(key, definition);
      announce();
      let live = true;
      return () => {
        if (live === false) return;
        live = false;
        claims.delete(key);
        announce();
      };
    },
    entries() {
      return project().visible;
    },
    rejected() {
      return project().rejected;
    },
    press(id) {
      const row = project().visible.find((entry) => entry.id === id);
      if (row === void 0) return { ok: false, detail: "no drawn row carries id " + show2(id) + ", so there is no action to press" };
      if (row.kind !== "action") return { ok: false, detail: "the drawn row " + show2(id) + " is kind " + show2(row.kind) + "; only an action is pressed, and this row is a reading" };
      for (const claim of claims.values()) {
        if (readField(claim, "id").value !== id || readField(claim, "kind").value !== "action") continue;
        const invoked = readField(claim, "invoke").value;
        if (typeof invoked !== "function") continue;
        try {
          invoked.call(claim);
          return { ok: true, detail: "" };
        } catch (error) {
          return { ok: false, detail: errorText(error) };
        }
      }
      return { ok: false, detail: "the declaration drawn as " + show2(id) + " carries no callable invoke, so there is nothing to press" };
    },
    notify() {
      announce();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

// plugins/dsh-link-panel/src/client/locales.ts
var NS = "dsh-link-panel";
var zh = {
  "tab.title": "LINK \u9762\u677F",
  "guide.description": "\u9762\u677F\u6CE8\u518C\u8868\u58F0\u660E\u4E86\u4EC0\u4E48 \u2014\u2014 \u53EF\u89C1\u6761\u76EE\u3001\u6309\u540D\u62D2\u7EDD\u7684\u6761\u76EE \u2014\u2014 \u4EE5\u53CA\u4FBF\u6761\u8D26\u672C\uFF0C\u8FD8\u6709\u4E00\u4E2A\u6BCF\u6B21\u5199\u4E00\u6761\u4FBF\u6761\u7684\u8F93\u5165\u6846\u3002",
  "panel.readonly": "\u53EA\u8BFB",
  "panel.reads": "\u6CE8\u518C\u8868 {panel} \xB7 \u8D26\u672C {notes}",
  "state.pending": "\u5F85\u8BFB",
  "state.ok": "\u5DF2\u8BFB",
  "state.failed": "\u8BFB\u53D6\u5931\u8D25",
  "items.empty": "\u6CA1\u6709\u53EF\u89C1\u6761\u76EE",
  "item.meta": "\u7C7B\u578B {kind} \xB7 \u843D\u70B9 {sink} \xB7 \u6B21\u5E8F {order} \xB7 {source}",
  "contrib.title": "\u8D21\u732E\u9879",
  "registry.summary": "\u6CE8\u518C\u8868\u539F\u59CB\u884C",
  "contrib.empty": "\u6CA1\u6709\u8D21\u732E\u9879",
  "contrib.noBody": "\u6CA1\u6709\u6B63\u6587",
  "refused.empty": "\u6CA1\u6709\u62D2\u7EDD\u9879",
  "notes.count": "{count} \u6761\u4FBF\u6761",
  "notes.limits": "\u9650\u989D\uFF1A{maxNotes} \u6761\u6D3B\u4FBF\u6761\uFF0C\u6BCF\u6761 {maxChars} \u4E2A\u5B57\u7B26",
  "notes.limitsUnread": "\u9650\u989D\uFF1A\u672A\u8BFB\u5230",
  "notes.empty": "\u8D26\u672C\u91CC\u6CA1\u6709\u4FBF\u6761",
  "input.label": "\u4E00\u6761\u4FBF\u6761",
  "submit.idle": "\u6DFB\u52A0\u4FBF\u6761",
  "submit.busy": "\u6B63\u5728\u6DFB\u52A0\u2026",
  "failure.line": "{slot}: {code}: {detail}",
  "copy.format.line": "{code}: {detail}",
  "refusal.noCode": "\u6CA1\u6709\u7801"
};
var en = {
  "tab.title": "LINK panel",
  "guide.description": "What the panel registry declares \u2014 its visible items, the items it refused by name \u2014 and the note ledger, with a box to add one note.",
  "panel.readonly": "read-only",
  "panel.reads": "registry {panel} \xB7 ledger {notes}",
  "state.pending": "pending",
  "state.ok": "ok",
  "state.failed": "failed",
  "items.empty": "no visible item",
  "item.meta": "kind {kind} \xB7 sink {sink} \xB7 order {order} \xB7 {source}",
  "contrib.title": "contributions",
  "registry.summary": "registry rows",
  "contrib.empty": "no contribution",
  "contrib.noBody": "no body",
  "refused.empty": "nothing refused",
  "notes.count": "{count} note(s)",
  "notes.limits": "limits: {maxNotes} live note(s), {maxChars} character(s) each",
  "notes.limitsUnread": "limits: not read",
  "notes.empty": "no note in the ledger",
  "input.label": "one note",
  "submit.idle": "add note",
  "submit.busy": "adding\u2026",
  "failure.line": "{slot}: {code}: {detail}",
  "copy.format.line": "{code}: {detail}",
  "refusal.noCode": "no code"
};

// plugins/dsh-link-panel/src/client/register.ts
var MARKER_KEY = "__dshLinkPanel";
function panelDefinition(t, icon) {
  return {
    id: PANEL_TAB_ID,
    kind: PANEL_TAB_KIND,
    priority: "extension",
    title: () => t("tab.title"),
    guide: [{
      id: "panel",
      order: 40,
      title: () => t("tab.title"),
      description: () => t("guide.description"),
      icon
    }]
  };
}
function markView(globals, view) {
  globals[MARKER_KEY] = markerFrom(view);
}
function markFailed(globals, error) {
  const marker = { mounted: true, failed: errorText(error) };
  globals[MARKER_KEY] = marker;
}
function markDisposed(globals) {
  const marker = { mounted: false, disposed: true };
  globals[MARKER_KEY] = marker;
}
function release(disposer) {
  if (typeof disposer === "function") {
    disposer();
    return;
  }
  if (disposer !== null && typeof disposer === "object") {
    const dispose = Reflect.get(disposer, Symbol.dispose);
    if (typeof dispose === "function") {
      dispose.call(disposer);
    }
  }
}
function registerPanelTab(ctx, face) {
  const globals = face.globals ?? globalThis;
  const disposers = [];
  try {
    disposers.push(ctx.effect(() => ctx.sidebarRightTabs.register(panelDefinition(face.t, face.icon)), "dsh-link-panel: pane tab type"));
    disposers.push(ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: PANEL_TAB_ID,
        locale: NS,
        inject: () => ({ panelLoad: face.load, panelAdd: face.add, panelPress: face.press, panelView: face.initial(), panelWatch: face.watch })
      },
      face.body
    )), "dsh-link-panel: pane tab body"));
    disposers.push(ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register(
      { name: "sidebar.right.pane.tab.title", key: PANEL_TAB_ID, locale: NS },
      face.title
    )), "dsh-link-panel: pane tab title"));
  } catch (error) {
    markFailed(globals, error);
    return () => {
    };
  }
  markView(globals, face.initial());
  void face.load().then(() => {
  }, (error) => {
    markFailed(globals, error);
  });
  return () => {
    for (const disposer of disposers) release(disposer);
    markDisposed(globals);
  };
}

// plugins/dsh-link-panel/src/client/load.ts
function noAnswer(reason) {
  return { status: null, body: null, text: "", transport: reason };
}
function noPressSeat(id) {
  return { ok: false, detail: "this pane was mounted without a seam to press " + JSON.stringify(id) + " through" };
}
function askWithFetch(fetchLike, base = "") {
  return async (path, init) => {
    if (typeof fetchLike !== "function") {
      return noAnswer("this page has no fetch to send " + path + " with");
    }
    try {
      const send = fetchLike;
      const answer = await send(base + path, init?.body === void 0 ? { method: "GET" } : { method: init.method ?? "POST", body: init.body, headers: { "content-type": "application/json" } });
      const holder = answer !== null && typeof answer === "object" ? answer : {};
      const read = holder["text"];
      const text = typeof read === "function" ? String(await read.call(answer)) : "";
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      const status = holder["status"];
      return { status: typeof status === "number" ? status : null, body, text, transport: null };
    } catch (error) {
      return noAnswer("the request threw: " + errorText(error));
    }
  };
}
function createLoader(options) {
  const tabId = options.tabId ?? PANEL_TAB_ID;
  const panel = options.panel ?? null;
  const watchers = /* @__PURE__ */ new Set();
  let view = emptyView(tabId);
  let release2 = null;
  function publish(next) {
    view = next;
    markView(options.globals, view);
    for (const watcher of [...watchers]) {
      try {
        watcher(view);
      } catch (error) {
        console.error("dsh-link-panel: a view watcher threw: " + errorText(error));
      }
    }
  }
  function adoptContributions() {
    if (panel === null) return;
    publish(withContributions(view, panel.entries(), panel.rejected()));
  }
  if (panel !== null) release2 = panel.subscribe(() => {
    adoptContributions();
  });
  async function askOne(source, path) {
    let answer;
    try {
      answer = await options.ask(path);
    } catch (error) {
      answer = noAnswer("the request threw: " + errorText(error));
    }
    return source === "panel" ? { source, read: readPanelState(answer) } : { source, read: readNotesState(answer) };
  }
  return {
    async load() {
      const arrivals = await Promise.all([askOne("panel", PANEL_STATE_PATH), askOne("notes", NOTES_STATE_PATH)]);
      publish(withContributions(foldArrivals(arrivals, tabId), panel?.entries() ?? [], panel?.rejected() ?? []));
      return view;
    },
    current() {
      return view;
    },
    watch(listener) {
      watchers.add(listener);
      return () => {
        watchers.delete(listener);
      };
    },
    dispose() {
      if (release2 !== null) release2();
      release2 = null;
      watchers.clear();
    },
    async add(text) {
      const request = noteRequest(text);
      let answer;
      try {
        answer = await options.ask(request.path, { method: "POST", body: request.body });
      } catch (error) {
        answer = noAnswer("the request threw: " + errorText(error));
      }
      return readSubmit(answer);
    },
    press(id) {
      if (panel === null) return noPressSeat(id);
      return panel.press(id);
    }
  };
}

// plugins/dsh-link-panel/src/client/device-net.ts
var DEG = Math.PI / 180;
function ringLayout(devices, options = {}) {
  const size = options.size ?? 240;
  const radius = options.radius ?? size * 0.36;
  const cx = size / 2;
  const cy = size / 2;
  const localId = options.localId ?? null;
  const withKind = devices.map((device, index) => ({
    id: device.id,
    label: device.label,
    kind: device.kind ?? "unknown",
    online: device.online !== false,
    lastSeenAt: device.lastSeenAt ?? null,
    index
  }));
  const localAt = withKind.findIndex((device) => device.kind === "local" || localId !== null && device.id === localId);
  const local = localAt >= 0 ? withKind[localAt] : null;
  const rest = withKind.filter((device) => device !== local);
  const ordered = local === null ? rest : [local, ...rest];
  const count = Math.max(ordered.length, 1);
  const step = ordered.length > 1 ? 360 / count : 0;
  const nodes = ordered.map((device, slot) => {
    const angle = slot * step;
    return {
      id: device.id,
      label: device.label,
      kind: device.kind,
      online: device.online,
      lastSeenAt: device.lastSeenAt,
      angle,
      x: cx + radius * Math.sin(angle * DEG),
      y: cy - radius * Math.cos(angle * DEG)
    };
  });
  const online = nodes.filter((node) => node.online).length;
  const offline = nodes.length - online;
  return {
    cx,
    cy,
    radius,
    centreLabel: options.centreLabel ?? "\u5C40\u57DF\u7F51 \xB7 \u4E92\u8054\u5C42",
    nodes,
    online,
    offline,
    note: nodes.length <= 1 ? "\u73AF\u4E0A\u53EA\u6709\u672C\u673A\uFF1A\u76EE\u524D\u6CA1\u6709\u5176\u4ED6\u8BBE\u5907\u8FDE\u4E0A\u4E92\u8054\u5C42" : null
  };
}

// plugins/dsh-link-panel/src/client/device-net-view.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function DeviceNet({ devices, note }) {
  const ring = ringLayout(devices, { size: 240 });
  const line = note ?? ring.note;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-link-devices", "data-device-ring": "", "data-device-online": ring.online, "data-device-offline": ring.offline, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 240 240", width: "240", height: "240", role: "img", "aria-label": "\u8BBE\u5907\u7F51", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: ring.cx, cy: ring.cy, r: ring.radius, fill: "none", stroke: "var(--dsw-alias-border-l2, #2a2a2a)", strokeDasharray: "3 5" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: ring.cx, cy: ring.cy, r: 34, fill: "var(--dsw-alias-bg-layer-2, #1b1b1c)", stroke: "var(--dsw-alias-border-l2, #2a2a2a)" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", { x: ring.cx, y: ring.cy + 4, textAnchor: "middle", fontSize: "10", fill: "var(--dsw-alias-label-tertiary, #979da6)", children: "\u4E92\u8054\u5C42" }),
      ring.nodes.map((node) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { "data-device-node": node.id, "data-device-online": node.online ? "true" : "false", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: ring.cx, y1: ring.cy, x2: node.x, y2: node.y, stroke: "var(--dsw-alias-border-l1, #1f1f1f)" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "circle",
          {
            cx: node.x,
            cy: node.y,
            r: 11,
            fill: node.online ? "var(--dsw-alias-bg-layer-2, #1b1b1c)" : "var(--dsw-alias-bg-layer-1, #0f1115)",
            stroke: node.online ? "var(--dsw-alias-state-success, #22c55e)" : "var(--dsw-alias-state-idle-primary, #d4d4d4)",
            strokeWidth: 2,
            opacity: node.online ? 1 : 0.5
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "text",
          {
            x: node.x,
            y: node.y + 24,
            textAnchor: "middle",
            fontSize: "9",
            fill: node.online ? "var(--dsw-alias-label-secondary, #b8bec8)" : "var(--dsw-alias-state-idle-primary, #d4d4d4)",
            opacity: node.online ? 1 : 0.6,
            children: node.label
          }
        )
      ] }, node.id))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-link-devices-note", "data-device-note": "", children: line ?? "\u5728\u7EBF " + String(ring.online) + " \xB7 \u79BB\u7EBF " + String(ring.offline) })
  ] });
}

// plugins/dsh-link-panel/src/client/panel.css
var panel_default = `/* The LINK pane's own sheet. Tokens only: no literal colour, no literal radius, no image, no font file,
 * no network. Every rule is scoped under .dsh-link-panel and the sheet is installed and removed with
 * this plugin's fiber (index.tsx: installStyles), so it can only restyle the pane it belongs to. */

.dsh-link-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
  padding: 12px;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
}

.dsh-link-panel * { box-sizing: border-box; }

/* Header, and the two reads as one status line whose lamp colour is the only thing that changes: the
 * words are the route's own state names, drawn from the dictionary by the component. */
.dsh-link-panel .dsh-link-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}

.dsh-link-panel .dsh-link-panel-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.dsh-link-panel .dsh-link-panel-mode {
  flex: none;
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  letter-spacing: 0.04em;
}

.dsh-link-panel .dsh-link-panel-reads {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
}

.dsh-link-panel .dsh-link-panel-reads::before {
  content: "";
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-state-idle-primary);
}

.dsh-link-panel[data-panel-health="ok"] .dsh-link-panel-reads::before { background: var(--dsw-alias-state-success-primary); }
.dsh-link-panel[data-panel-health="failed"] .dsh-link-panel-reads::before { background: var(--dsw-alias-state-error-primary); }

/* One raised card per section: the only elevated surface in the pane. The two sections that already
 * carry the data attribute the render gates read are styled by it, so a section has ONE name on it. */
.dsh-link-panel .dsh-link-panel-card,
.dsh-link-panel [data-panel-contributed],
.dsh-link-panel [data-notes] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft);
}

.dsh-link-panel .dsh-link-panel-card-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.dsh-link-panel .dsh-link-panel-contributed-head {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Contributions: one row per declared item; an action row is drawn as the button it is. */
.dsh-link-panel .dsh-link-panel-contributed-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-link-panel .dsh-link-panel-contributed-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
}

.dsh-link-panel .dsh-link-panel-contributed-title {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
  font-weight: 600;
}

.dsh-link-panel .dsh-link-panel-contributed-meta,
.dsh-link-panel .dsh-link-panel-contributed-body {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
}

.dsh-link-panel .dsh-link-panel-contributed-meta { color: var(--dsw-alias-label-tertiary); }

.dsh-link-panel .dsh-link-panel-contributed-action {
  align-self: flex-start;
  max-width: 100%;
  padding: 5px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
  font-weight: 600;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.dsh-link-panel .dsh-link-panel-contributed-action:hover { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-interactive-bg-hover); }

.dsh-link-panel .dsh-link-panel-contributed-error {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-state-error-primary);
  font: var(--dsw-font-xxs-12);
}

/* Notes: the count and the route's thresholds, the ledger, and the one box this pane writes through. */
.dsh-link-panel .dsh-link-panel-notes-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.dsh-link-panel .dsh-link-panel-notes-count {
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
  font-weight: 600;
}

.dsh-link-panel .dsh-link-panel-notes-limits {
  min-width: 0;
  margin-left: auto;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
  text-align: right;
}

.dsh-link-panel .dsh-link-panel-notes-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}

.dsh-link-panel .dsh-link-panel-note {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  min-width: 0;
  padding: 7px 9px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
}

.dsh-link-panel .dsh-link-panel-note-text {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
}

.dsh-link-panel .dsh-link-panel-note-author {
  color: var(--dsw-alias-label-caption);
  font: var(--dsw-font-xxs-12);
}

.dsh-link-panel .dsh-link-panel-note-tags {
  padding: 1px 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-xl);
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
}

.dsh-link-panel .dsh-link-panel-add {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.dsh-link-panel .dsh-link-panel-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}

.dsh-link-panel .dsh-link-panel-input::placeholder { color: var(--dsw-alias-label-caption); }

.dsh-link-panel .dsh-link-panel-input:focus {
  outline: none;
  border-color: var(--dsw-alias-border-l3);
  box-shadow: 0 0 0 var(--dsw-focus-ring-width) var(--dsw-focus-ring-color);
}

.dsh-link-panel .dsh-link-panel-submit {
  flex: none;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font: var(--dsw-font-xxs-12);
  font-weight: 600;
  cursor: pointer;
}

.dsh-link-panel .dsh-link-panel-submit:hover:enabled { background: var(--dsw-alias-button-primary-hover); }

.dsh-link-panel .dsh-link-panel-submit:disabled {
  background: var(--dsw-alias-button-primary-dimmed);
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}

.dsh-link-panel .dsh-link-panel-result {
  margin: 0;
  padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  overflow-wrap: anywhere;
}

.dsh-link-panel .dsh-link-panel-result[data-notes-result-ok="true"] { color: var(--dsw-alias-state-success-primary); }
.dsh-link-panel .dsh-link-panel-result[data-notes-result-ok="false"] { color: var(--dsw-alias-state-error-primary); }

/* A read that did not hold, and a refusal: the same raised strip. The ink is the WARN pair, not the error
 * pair: a route that is not mounted is a fact about the deployment, and the strip says it in its own words. */
.dsh-link-panel .dsh-link-panel-failure {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-left: 2px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
  overflow-wrap: anywhere;
}

.dsh-link-panel .dsh-link-panel-refused {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-link-panel .dsh-link-panel-refusal {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-state-warn-label);
  font: var(--dsw-font-xxs-12);
}

.dsh-link-panel .dsh-link-panel-empty {
  min-width: 0;
  padding: 2px 0;
  color: var(--dsw-alias-label-caption);
  font: var(--dsw-font-xxs-12);
  list-style: none;
}

/* The registry's raw rows: present, collapsible, closed by default. */
.dsh-link-panel .dsh-link-panel-registry {
  padding-top: 2px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}

.dsh-link-panel .dsh-link-panel-registry-summary {
  padding: 7px 0 2px;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}

.dsh-link-panel .dsh-link-panel-registry-summary:hover { color: var(--dsw-alias-label-secondary); }

.dsh-link-panel .dsh-link-panel-registry-summary:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);
  outline-offset: 2px;
}

.dsh-link-panel .dsh-link-panel-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.dsh-link-panel .dsh-link-panel-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-link-panel .dsh-link-panel-item-title {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
}

.dsh-link-panel .dsh-link-panel-item-meta {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-caption);
  font: var(--dsw-font-xxs-12);
}
`;

// plugins/dsh-link-panel/src/client/index.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var inject = ["slots", "sidebarRightTabs", "locale"];
var PANEL_GUIDE_ICON = import_dsh_client_ui_primitives.IconFlatListOutlineRegular;
var STATE_KEYS = {
  pending: "state.pending",
  ok: "state.ok",
  failed: "state.failed"
};
function shown(row, key) {
  if (row === null || typeof row !== "object") return "";
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
function sinkOf(view, kind) {
  const map = view.registry === null ? null : view.registry.kindSinks;
  if (map === null || typeof map !== "object") return "";
  const sink = map[kind];
  return typeof sink === "string" ? sink : "";
}
function limitsLine(limits, t) {
  if (limits === null || typeof limits !== "object") return t("notes.limitsUnread");
  const spelled = limits;
  const notes = spelled["maxNotes"];
  const chars = spelled["maxChars"];
  if (typeof notes !== "number" || typeof chars !== "number") return t("notes.limitsUnread");
  return t("notes.limits", { maxNotes: notes, maxChars: chars });
}
function refusalLine(row, t) {
  return t("copy.format.line", { code: row.code ?? t("refusal.noCode"), detail: row.detail });
}
function actionErrorLine(settled, t, id) {
  if (settled === void 0 || settled.ok === true) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-contributed-error", "data-panel-contributed-error": id, children: refusalLine({ code: null, detail: settled.detail }, t) });
}
var PLUGIN_ID = "dsh-link-panel";
var STYLE_TAG = "style";
function installStyles(ctx) {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const tag = document.createElement(STYLE_TAG);
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = `${PLUGIN_ID}/panel.css`;
    tag.textContent = panel_default;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "dsh-link-panel: pane stylesheet");
}
function readHealth(reads) {
  if (reads.panel === "ok" && reads.notes === "ok") return "ok";
  if (reads.panel === "failed" || reads.notes === "failed") return "failed";
  return "pending";
}
var NO_TAB_INFO = () => null;
function tabIsVisible(read) {
  const info = (read ?? NO_TAB_INFO)();
  if (info === null || typeof info !== "object") return false;
  const tab = Reflect.get(info, "tab");
  return tab !== null && typeof tab === "object" && Reflect.get(tab, "visible") === true;
}
function NoteLine({ row }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "dsh-link-panel-note", "data-note-row": row.id ?? "", "data-note-state": row.state ?? "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-note-text", "data-note-text": "", children: row.text }),
    row.author === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-link-panel-note-author", "data-note-author": "", children: [
      " \u2014 ",
      row.author
    ] }),
    row.tags === null || row.tags.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-link-panel-note-tags", "data-note-tags": "", children: [
      " [",
      row.tags.join(", "),
      "]"
    ] })
  ] });
}
function PanelBody(props) {
  const t = props.t ?? ((key) => key);
  const readNow = async () => props.panelLoad === void 0 ? props.panelView ?? emptyView() : props.panelLoad();
  const add = props.panelAdd ?? (async () => ({ ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: "this pane was mounted without a way to write", from: "client" }));
  const press = props.panelPress ?? noPressSeat;
  const [view, setView] = (0, import_react.useState)(() => props.panelView ?? emptyView());
  const [draft, setDraft] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [outcome, setOutcome] = (0, import_react.useState)(null);
  const [outcomes, setOutcomes] = (0, import_react.useState)({});
  const limitsText = (limits) => limitsLine(limits, t);
  (0, import_react.useEffect)(() => {
    let live = true;
    void readNow().then((next) => {
      if (live) setView(next);
    }, () => {
    });
    return () => {
      live = false;
    };
  }, [props.panelLoad, props.panelView]);
  const visible = tabIsVisible(props.useTabInfo);
  const [wasVisible, setWasVisible] = (0, import_react.useState)(visible);
  (0, import_react.useEffect)(() => {
    if (wasVisible === visible) return void 0;
    setWasVisible(visible);
    if (visible !== true) return void 0;
    let live = true;
    void readNow().then((next) => {
      if (live) setView(next);
    }, () => {
    });
    return () => {
      live = false;
    };
  }, [visible, wasVisible, props.panelLoad, props.panelView]);
  const watch = props.panelWatch;
  (0, import_react.useEffect)(() => {
    if (typeof watch !== "function") return void 0;
    return watch((next) => {
      setView(next);
    });
  }, [watch]);
  const submit = (event) => {
    if (typeof event.preventDefault === "function") event.preventDefault();
    setBusy(true);
    void (async () => {
      try {
        const settled = await add(draft);
        setOutcome(settled);
        if (settled.ok === true) setDraft("");
        setView(await readNow());
      } catch (error) {
        setOutcome({ ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: errorText(error), from: "client" });
      } finally {
        setBusy(false);
      }
    })();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-link-panel", "data-panel-tab": view.tabId, "data-panel-health": readHealth(view.reads), children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-link-panel-head", "data-panel-head": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-title", children: t("tab.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-mode", "data-panel-readonly": "", children: t("panel.readonly") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-link-panel-reads", "data-panel-reads": "panel:" + view.reads.panel + " notes:" + view.reads.notes, children: t("panel.reads", { panel: t(STATE_KEYS[view.reads.panel]), notes: t(STATE_KEYS[view.reads.notes]) }) }),
    view.failures.length === 0 ? null : view.failures.map((failure) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "p",
      {
        className: "dsh-link-panel-failure",
        "data-panel-failure": failure.code,
        "data-panel-failure-from": failure.from,
        "data-panel-failure-slot": failure.source,
        children: t("failure.line", { slot: failure.source, code: failure.code, detail: failure.detail })
      },
      failure.source + ":" + failure.code + ":" + failure.detail
    )),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DeviceNet, { devices: [{ id: "local", label: "\u672C\u673A", kind: "local", online: true }] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-link-panel-contributed", "data-panel-contributed": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-link-panel-card-head", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-link-panel-contributed-head", "data-panel-contributed-head": "", children: t("contrib.title") }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dsh-link-panel-contributed-list", "data-panel-contributed-list": "", children: view.contributed.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { className: "dsh-link-panel-empty", "data-panel-empty": "contributed", children: t("contrib.empty") }) : view.contributed.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "li",
        {
          className: "dsh-link-panel-contributed-row",
          "data-panel-contributed-row": row.id,
          "data-panel-contributed-kind": row.kind,
          "data-panel-contributed-source": row.source,
          "data-panel-contributed-has-invoke": String(row.hasInvoke),
          children: [
            row.kind === "action" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                className: "dsh-link-panel-contributed-action",
                "data-panel-contributed-title": "",
                "data-panel-contributed-action": "",
                type: "button",
                onClick: () => {
                  const settled = press(row.id);
                  setOutcomes((held) => ({ ...held, [row.id]: settled }));
                },
                children: row.title
              }
            ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-contributed-title", "data-panel-contributed-title": "", children: row.title }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-contributed-meta", "data-panel-contributed-meta": "", children: t("item.meta", { kind: row.kind, sink: sinkOf(view, row.kind), order: row.order, source: row.source }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-contributed-body", "data-panel-contributed-body": "", children: row.body === "" ? t("contrib.noBody") : row.body }),
            actionErrorLine(outcomes[row.id], t, row.id)
          ]
        },
        row.id
      )) }),
      view.contributedRefused.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dsh-link-panel-contributed-refused", "data-panel-contributed-refused": "", children: view.contributedRefused.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { className: "dsh-link-panel-refusal", "data-panel-refusal": row.code ?? "no-code", children: refusalLine(row, t) }, (row.id ?? "no-id") + ":" + String(index))) })
    ] }),
    view.refused.length === 0 && view.contributedRefused.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-link-panel-empty", "data-panel-empty": "refused", children: t("refused.empty") }) : null,
    view.refused.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-link-panel-card", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dsh-link-panel-refused", "data-panel-refused": "", children: view.refused.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "li",
      {
        className: "dsh-link-panel-refusal",
        "data-panel-refusal": row.code ?? "no-code",
        children: t("copy.format.line", { code: row.code ?? t("refusal.noCode"), detail: row.detail })
      },
      (row.id ?? "no-id") + ":" + String(index)
    )) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-link-panel-notes", "data-notes": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-link-panel-notes-head", "data-notes-head": "", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-notes-count", "data-notes-count": String(view.notes.rows.length), children: t("notes.count", { count: view.notes.rows.length }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-notes-limits", "data-notes-limits": "", children: limitsText(view.notes.limits) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dsh-link-panel-notes-list", "data-notes-list": "", children: view.notes.rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { className: "dsh-link-panel-empty", "data-panel-empty": "notes", children: t("notes.empty") }) : view.notes.rows.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(NoteLine, { row }, row.id === null ? String(index) : row.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("form", { className: "dsh-link-panel-add", "data-notes-add": "", onSubmit: submit, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "input",
          {
            className: "dsh-link-panel-input",
            "data-notes-input": "",
            type: "text",
            value: draft,
            placeholder: t("input.label"),
            "aria-label": t("input.label"),
            onChange: (event) => {
              setDraft(event.target.value);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "dsh-link-panel-submit", "data-notes-submit": "", type: "submit", disabled: busy, children: busy ? t("submit.busy") : t("submit.idle") })
      ] }),
      outcome === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "p",
        {
          className: "dsh-link-panel-result",
          "data-notes-result": outcome.code,
          "data-notes-result-from": outcome.from,
          "data-notes-result-ok": String(outcome.ok),
          children: t("copy.format.line", { code: outcome.code, detail: outcome.detail })
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dsh-link-panel-registry", "data-panel-registry": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { className: "dsh-link-panel-registry-summary", children: t("registry.summary") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dsh-link-panel-items", "data-panel-items": "", children: view.items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { className: "dsh-link-panel-empty", "data-panel-empty": "items", children: t("items.empty") }) : view.items.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "li",
        {
          className: "dsh-link-panel-item",
          "data-panel-item": shown(item, "id"),
          "data-panel-item-kind": shown(item, "kind"),
          "data-panel-item-sink": sinkOf(view, shown(item, "kind")),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-item-title", "data-panel-item-title": "", children: shown(item, "title") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-item-meta", "data-panel-item-meta": "", children: t("item.meta", { kind: shown(item, "kind"), sink: sinkOf(view, shown(item, "kind")), order: shown(item, "order"), source: shown(item, "source") }) })
          ]
        },
        shown(item, "id") === "" ? String(index) : shown(item, "id")
      )) })
    ] })
  ] });
}
function PanelTitle(props) {
  const t = props.t ?? ((key) => key);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-link-panel-title", "data-panel-title": "", children: t("tab.title") });
}
function apply(ctx) {
  const globals = globalThis;
  try {
    installStyles(ctx);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-link-panel: dictionaries");
    const t = ctx.locale.bind(NS);
    const contributions = createLinkPanelService();
    const host = ctx;
    if (typeof host.provide === "function") host.provide(LINK_PANEL_SERVICE, contributions);
    const loader = createLoader({ ask: askWithFetch(globals.fetch), globals, panel: contributions });
    ctx.effect(() => () => {
      loader.dispose();
    }, "dsh-link-panel: contribution subscription");
    registerPanelTab(ctx, {
      body: PanelBody,
      title: PanelTitle,
      load: loader.load,
      initial: loader.current,
      add: loader.add,
      press: loader.press,
      watch: loader.watch,
      icon: PANEL_GUIDE_ICON,
      t,
      globals
    });
  } catch (error) {
    globals["__dshLinkPanel"] = { mounted: true, failed: errorText(error) };
  }
}

return module.exports; } });
