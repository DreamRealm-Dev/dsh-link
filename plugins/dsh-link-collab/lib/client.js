window.__ModuleLoader__.load({ id: "dsh-link-collab", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/dsh-link-collab/src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// plugins/dsh-link-collab/src/status-path.ts
var STATUS_PATH = "/api/dsh-link-collab/status";

// plugins/dsh-link-collab/src/client/locales.ts
var NS = "dsh-link-collab";
var zh = {
  "panel.status.title": "\u534F\u4F5C\u603B\u7EBF",
  "panel.status.body": "\u56E2\u961F {teams} \xB7 \u6210\u5458 {members} \xB7 \u8D26\u672C {records} \u6761 \xB7 \u4E2D\u7EE7 {relay}",
  // R217: the message count means different things on the two supported kernel lines, so the row says
  // which one it is. Both strings carry their own separator: the body is a template and the suffix is
  // only appended when the scope makes the count mean less than it looks.
  "panel.status.messagesThisEnd": " \xB7 \u6D88\u606F\u4EC5\u672C\u7AEF\u6536\u4EF6",
  "panel.status.messagesNone": " \xB7 \u672C\u5185\u6838\u4E0D\u8BB0\u6D88\u606F\u961F\u5217",
  "panel.status.relayBound": "\u5DF2\u7ED1\u5B9A",
  "panel.status.relayUnbound": "\u672A\u7ED1\u5B9A",
  "panel.status.unread": "\u603B\u7EBF\u8BFB\u6570\u5C1A\u672A\u5230\u8FBE",
  "panel.status.failed": "\u8BFB\u4E0D\u5230\u603B\u7EBF\uFF1A{code} \xB7 {detail}",
  "panel.status.noCode": "\u65E0\u4EE3\u7801"
};
var en = {
  "panel.status.title": "Collaboration bus",
  "panel.status.body": "teams {teams} \xB7 members {members} \xB7 ledger {records} \xB7 relay {relay}",
  "panel.status.messagesThisEnd": " \xB7 messages: this end only",
  "panel.status.messagesNone": " \xB7 this kernel journals no message queue",
  "panel.status.relayBound": "bound",
  "panel.status.relayUnbound": "not bound",
  "panel.status.unread": "the bus reading has not arrived yet",
  "panel.status.failed": "the bus cannot be read: {code} \xB7 {detail}",
  "panel.status.noCode": "no code"
};

// plugins/dsh-link-collab/src/client/status.ts
function numberOf(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function fieldOf(value, key) {
  if (value === null || typeof value !== "object") return void 0;
  try {
    return value[key];
  } catch {
    return void 0;
  }
}
function scopeOf(value) {
  return value === "both-directions" || value === "this-end-only" || value === "none" ? value : "unknown";
}
function readAnswer(input) {
  if (input.transport !== null) return { reading: null, failure: { code: "route-unreachable", detail: input.transport } };
  let document = null;
  try {
    document = JSON.parse(input.text);
  } catch {
    return { reading: null, failure: { code: "body-not-json", detail: "the answer was not JSON (" + String(input.text.length) + " bytes, HTTP " + String(input.status) + ")" } };
  }
  if (fieldOf(document, "ok") !== true) {
    const error = fieldOf(document, "error");
    const code = fieldOf(error, "code");
    const message = fieldOf(error, "message");
    const fallback = "the route refused the reading (HTTP " + String(input.status) + ")";
    return {
      reading: null,
      failure: {
        code: typeof code === "string" && code !== "" ? code : null,
        detail: typeof message === "string" && message !== "" ? message : fallback
      }
    };
  }
  const ledger = fieldOf(document, "ledger");
  const world = fieldOf(document, "world");
  const relay = fieldOf(document, "relay");
  const records = numberOf(fieldOf(ledger, "records"));
  const teams = numberOf(fieldOf(world, "teams"));
  const members = numberOf(fieldOf(world, "members"));
  const path = fieldOf(document, "path");
  if (records === null || teams === null || members === null) {
    return { reading: null, failure: { code: "reading-incomplete", detail: "the answer carried no ledger/world counts (HTTP " + String(input.status) + "): " + String(input.text).slice(0, 200) } };
  }
  return {
    reading: {
      teams,
      members,
      records,
      relayBound: fieldOf(relay, "bound") === true,
      path: typeof path === "string" ? path : "",
      messagesScope: scopeOf(fieldOf(fieldOf(document, "messages"), "scope"))
    },
    failure: null
  };
}
function bodyText(reading, failure, t) {
  if (reading !== null) {
    const line = t("panel.status.body", {
      teams: reading.teams,
      members: reading.members,
      records: reading.records,
      relay: t(reading.relayBound ? "panel.status.relayBound" : "panel.status.relayUnbound")
    });
    if (reading.messagesScope === "this-end-only") return line + t("panel.status.messagesThisEnd");
    if (reading.messagesScope === "none") return line + t("panel.status.messagesNone");
    return line;
  }
  if (failure !== null) {
    return t("panel.status.failed", { code: failure.code ?? t("panel.status.noCode"), detail: failure.detail });
  }
  return t("panel.status.unread");
}

// plugins/dsh-link-collab/src/client/index.ts
var PANEL_ITEM_ID = "dsh-link-collab:bus-status";
var PANEL_ITEM_KIND = "status";
var PANEL_ITEM_SOURCE = "dsh-link-collab";
var PANEL_ITEM_ORDER = 26;
var LINK_PANEL_SERVICE = "linkPanel";
var PANEL_MARKER = "__dshLinkCollabPanel";
var inject = [];
var STATE = { reading: null, failure: null, published: "", reads: 0, notifies: 0 };
function safe(step, fallback) {
  try {
    return step();
  } catch {
    return fallback;
  }
}
function messageOf(error) {
  const held = error;
  return held !== null && held !== void 0 && held.message !== void 0 ? String(held.message) : String(error);
}
function substitute(template, params) {
  if (params === void 0) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}
function mark(fields) {
  safe(() => {
    const globals = globalThis;
    const held = globals[PANEL_MARKER];
    const base = held !== null && typeof held === "object" ? held : {};
    globals[PANEL_MARKER] = Object.assign({}, base, fields, { mounted: true });
  }, void 0);
}
function serviceOf(ctx, name, method) {
  const read = (value) => {
    if (value === null || value === void 0 || typeof value !== "object") return null;
    const held = value;
    return typeof held[method] === "function" ? held : null;
  };
  const strict = safe(() => typeof ctx.get === "function" ? ctx.get(name) : null, null);
  const viaGet = read(strict);
  if (viaGet !== null) return viaGet;
  return read(safe(() => ctx[name], null));
}
function localeService(ctx) {
  const held = serviceOf(ctx, "locale", "register");
  return held === null ? null : held;
}
function bindTranslate(locale) {
  if (locale !== null) {
    const bound = safe(() => locale.bind(NS), null);
    if (typeof bound === "function") return bound;
  }
  return (key, params) => substitute(zh[key] ?? key, params);
}
function body(t) {
  return bodyText(STATE.reading, STATE.failure, t);
}
function definition(t) {
  return {
    id: PANEL_ITEM_ID,
    kind: PANEL_ITEM_KIND,
    source: PANEL_ITEM_SOURCE,
    order: PANEL_ITEM_ORDER,
    title: () => t("panel.status.title"),
    body: () => body(t)
  };
}
function release(disposer) {
  safe(() => {
    if (typeof disposer === "function") {
      disposer();
      return;
    }
    const loose = disposer;
    if (loose !== null && typeof loose === "object" && typeof loose.dispose === "function") loose.dispose();
  }, void 0);
}
function publishIfMoved(seam, t) {
  const next = body(t);
  mark({ body: next, reading: STATE.reading, failure: STATE.failure });
  if (next === STATE.published) return;
  STATE.published = next;
  const notify = seam.notify;
  if (typeof notify !== "function") {
    mark({ notifies: STATE.notifies, refresh: "linkPanel-notify-unavailable: the seam on this page carries no notify(), so the row keeps the text it was declared with" });
    return;
  }
  STATE.notifies += 1;
  safe(() => notify.call(seam), void 0);
  mark({ notifies: STATE.notifies });
}
async function refresh(seam, t) {
  STATE.reads += 1;
  const globals = globalThis;
  const send = globals.fetch;
  if (typeof send !== "function") {
    STATE.reading = null;
    STATE.failure = { code: "no-fetch", detail: "this page has no fetch to read " + STATUS_PATH + " with" };
    mark({ reads: STATE.reads });
    publishIfMoved(seam, t);
    return;
  }
  try {
    const answer = await send(STATUS_PATH, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    });
    const status = typeof answer.status === "number" ? answer.status : null;
    let text = "";
    try {
      text = String(await answer.text());
    } catch (error) {
      text = "";
      STATE.reading = null;
      STATE.failure = { code: "body-unreadable", detail: "the answer body could not be read: " + messageOf(error) };
      mark({ reads: STATE.reads, failure: STATE.failure });
      publishIfMoved(seam, t);
      return;
    }
    const read = readAnswer({ status, text, transport: null });
    STATE.reading = read.reading;
    STATE.failure = read.failure;
  } catch (error) {
    STATE.reading = null;
    STATE.failure = { code: "route-unreachable", detail: "reading " + STATUS_PATH + " threw: " + messageOf(error) };
  }
  mark({ reads: STATE.reads, at: Date.now() });
  publishIfMoved(seam, t);
}
function installDueEvents(due) {
  const globals = globalThis;
  const off = [];
  const doc = globals.document;
  if (doc !== void 0 && doc !== null && typeof doc.addEventListener === "function") {
    const listener = () => {
      if (doc.visibilityState === "hidden") return;
      due();
    };
    safe(() => doc.addEventListener("visibilitychange", listener), void 0);
    off.push(() => safe(() => {
      if (typeof doc.removeEventListener !== "function") return void 0;
      return doc.removeEventListener("visibilitychange", listener);
    }, void 0));
  }
  const win = globals.window;
  if (win !== void 0 && win !== null && typeof win.addEventListener === "function") {
    const listener = () => {
      due();
    };
    safe(() => win.addEventListener("focus", listener), void 0);
    off.push(() => safe(() => {
      if (typeof win.removeEventListener !== "function") return void 0;
      return win.removeEventListener("focus", listener);
    }, void 0));
  }
  return () => {
    for (const stop of off) stop();
  };
}
function mount(ctx, t, locale, seam) {
  if (seam === null) {
    mark({ declared: false, failed: "linkPanel-unavailable: this page offers no " + LINK_PANEL_SERVICE + " service, so the collaboration bus status row was not declared" });
    return null;
  }
  let disposer = null;
  try {
    disposer = seam.declare(definition(t));
  } catch (error) {
    mark({ declared: false, failed: "linkPanel-declare-refused: " + messageOf(error) });
    return null;
  }
  STATE.published = body(t);
  mark({ declared: true, failed: null, body: STATE.published });
  const offEvents = installDueEvents(() => {
    void refresh(seam, t);
  });
  const subscribe = locale === null ? void 0 : locale.subscribe;
  const offLocale = typeof subscribe === "function" ? safe(() => subscribe.call(locale, () => {
    publishIfMoved(seam, t);
  }), null) : null;
  void refresh(seam, t);
  return () => {
    const unsubscribe = offLocale;
    safe(() => {
      if (unsubscribe !== null && typeof unsubscribe === "function") unsubscribe();
    }, void 0);
    offEvents();
    release(disposer);
  };
}
function apply(raw) {
  const ctx = raw !== null && typeof raw === "object" ? raw : {};
  try {
    mark({ id: PANEL_ITEM_ID, kind: PANEL_ITEM_KIND, source: PANEL_ITEM_SOURCE, ns: NS, path: STATUS_PATH, reads: 0, notifies: 0 });
    const locale = localeService(ctx);
    const t = bindTranslate(locale);
    const dictionaries = locale === null ? "locale-unavailable: this page offers no locale service, so this package dictionaries were not registered; its words come from the same zh dictionary" : safe(() => {
      locale.register(NS, { zh, en });
      return "registered";
    }, "locale-register-refused: the locale service refused this package dictionaries; its words come from the same zh dictionary");
    mark({ dictionaries });
    const seam = serviceOf(ctx, LINK_PANEL_SERVICE, "declare");
    if (typeof ctx.effect === "function") {
      let ran = false;
      try {
        ctx.effect(() => {
          ran = true;
          const dispose = mount(ctx, t, locale, seam);
          return dispose === null ? void 0 : dispose;
        }, "dsh-link-collab: bus status row");
        return;
      } catch (error) {
        if (ran) return;
        mark({ effect: "ctx-effect-refused: " + messageOf(error) });
      }
    }
    mount(ctx, t, locale, seam);
  } catch (error) {
    mark({ mounted: true, failed: messageOf(error) });
  }
}

return module.exports; } });
