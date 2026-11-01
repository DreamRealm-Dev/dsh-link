window.__ModuleLoader__.load({ id: "dsh-link-chat-window", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
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

// plugins/dsh-link-chat-window/src/client/index.ts
var index_exports = {};
__export(index_exports, {
  EVENT_WINDOW_LIMIT_GLOBAL: () => EVENT_WINDOW_LIMIT_GLOBAL,
  HISTORY_READING_GLOBAL: () => HISTORY_READING_GLOBAL,
  apply: () => apply,
  eventWindowLimitPolicy: () => eventWindowLimitPolicy,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var name = "dsh-link-chat-window";
var inject = [];
var EVENT_WINDOW_LIMIT_GLOBAL = "__DSH_EVENT_WINDOW_LIMIT__";
var HISTORY_READING_GLOBAL = "__DSH_CHAT_HISTORY_READING__";
function eventWindowLimitPolicy(config = {}) {
  const maxEvents = config.windowEvents === void 0 ? 500 : config.windowEvents;
  const slackEvents = config.slackEvents === void 0 ? 125 : config.slackEvents;
  return {
    maxEvents,
    slackEvents,
    trimOpeningPage: config.trimOpeningPage === true,
    setBy: "dsh-link-chat-window",
    version: 1
  };
}
function publishHistoryReading(ctx) {
  const host = globalThis;
  const surface = typeof document === "undefined" ? void 0 : document;
  const following = () => surface !== void 0 && surface.querySelector("[data-chat-following-tail]") !== null;
  const publish = () => {
    const reading = surface !== void 0 && !following();
    if (host[HISTORY_READING_GLOBAL] === reading) return;
    if (reading) host[HISTORY_READING_GLOBAL] = true;
    else delete host[HISTORY_READING_GLOBAL];
  };
  if (surface === void 0) return;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      publish();
    });
  };
  surface.addEventListener("scroll", schedule, { capture: true, passive: true });
  const observer = new MutationObserver(schedule);
  observer.observe(surface.documentElement, { attributes: true, attributeFilter: ["data-chat-following-tail"], subtree: true });
  publish();
  ctx.effect(() => () => {
    surface.removeEventListener("scroll", schedule, { capture: true });
    observer.disconnect();
    delete host[HISTORY_READING_GLOBAL];
  }, "dsh-link-chat-window: reader state");
}
function apply(ctx, config = {}) {
  if (config.enabled !== true) return;
  const policy = eventWindowLimitPolicy(config);
  const host = globalThis;
  host[EVENT_WINDOW_LIMIT_GLOBAL] = policy;
  publishHistoryReading(ctx);
  ctx.effect(() => () => {
    if (host[EVENT_WINDOW_LIMIT_GLOBAL] === policy) delete host[EVENT_WINDOW_LIMIT_GLOBAL];
  }, "dsh-link-chat-window: policy object");
  console.log("[link-chat-window] client policy published: maxEvents=" + String(policy.maxEvents) + " slackEvents=" + String(policy.slackEvents) + " trimOpeningPage=" + String(policy.trimOpeningPage) + " (needs R501 kernel client patch for runtime effect)");
}

return module.exports; } });
