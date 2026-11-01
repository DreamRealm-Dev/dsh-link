window.__ModuleLoader__.load({ id: "dsh-continue-button", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/dsh-continue-button/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "sessions"];
var SLOT_TURN_TAIL = "conversation.chat.turnTail";
var SLOT_ASSISTANT_ACTIONS = "conversation.chat.assistant-actions";
var PLUGIN_ID = "dsh-continue-button";
var PROMPT_TEXT = "\u7EE7\u7EED";
var BUTTON_CSS = `
.${PLUGIN_ID} {
  appearance: none;
  border: 1px solid var(--dsh-border, var(--border-color, rgba(255,255,255,0.16)));
  background: var(--dsh-surface, rgba(255,255,255,0.04));
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  opacity: 0.82;
  margin: 2px 0;
}
.${PLUGIN_ID}:hover { opacity: 1; background: rgba(255,255,255,0.10); }
.${PLUGIN_ID}:active { transform: translateY(1px); }
.${PLUGIN_ID}:disabled { opacity: 0.5; cursor: default; }
`;
var tailRenderedTurns = /* @__PURE__ */ new Map();
function hasUnclosedFence(text) {
  return (text.match(/```/g) ?? []).length % 2 === 1;
}
function tailDatas(chat) {
  const values = chat?.nodes?.values?.();
  if (typeof values !== "object" || values === null) return [];
  const out = [];
  for (const node of values) {
    if (node?.kind === "turn-tail" && node?.data !== void 0 && node?.data !== null) out.push(node.data);
  }
  return out;
}
function isTextBlock(block) {
  return (block?.kind === "text" || block?.type === "text") && typeof block?.text === "string";
}
function closingTextOf(closing) {
  if (closing === null || closing === void 0) return void 0;
  const blocks = closing.blocks;
  if (!Array.isArray(blocks)) return void 0;
  return blocks.filter((block) => isTextBlock(block)).map((block) => block.text).join("");
}
function locationData(loc, key) {
  try {
    return loc?.data?.get?.(key);
  } catch {
    return void 0;
  }
}
function hasInterruptedStep(loc) {
  const steps = loc?.steps;
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (locationData(step, "assistant-step")?.status === "interrupted") return true;
  }
  return false;
}
function deliverablesClaim(loc, seq) {
  const data = locationData(loc, "deliverables");
  if (data === null || data === void 0) return false;
  const produced = Array.isArray(data.produced) ? data.produced : [];
  const presented = Array.isArray(data.presented) ? data.presented : [];
  const bound = typeof seq === "number" ? seq : Number.POSITIVE_INFINITY;
  return produced.some((entry) => !(typeof entry?.seq === "number" && entry.seq > bound)) || presented.some((file) => !(typeof file?.seq === "number" && file.seq >= bound));
}
function selectFrozenTail(owner) {
  try {
    const loc = owner?.turn;
    const tail = locationData(loc, "turn-tail");
    if (tail === null || tail === void 0) return null;
    const closing = tail.closing;
    if (closing !== null && closing !== void 0 && closing?.finalNode?.messageId !== void 0) return null;
    if (deliverablesClaim(loc, owner?.seq)) return null;
    return { turn: tail.turn, frozen: closing === null || closing === void 0 };
  } catch {
    return null;
  }
}
function apply(ctx) {
  const sessions = ctx.sessions;
  if (typeof document !== "undefined") {
    ctx.effect(() => {
      const tag = document.createElement("style");
      tag.dataset.plugin = PLUGIN_ID;
      tag.textContent = BUTTON_CSS;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }, "dsh-continue-button: stylesheet");
  }
  const label = /^zh/i.test(typeof navigator !== "undefined" ? navigator.language : "zh") ? "\u7EE7\u7EED\u751F\u6210" : "Continue";
  const makeButton = (variant) => (props) => {
    const sessionId = typeof props?.sessionId === "string" ? props.sessionId : "";
    const matched = variant === "tail" && props?.matched !== null && props?.matched !== void 0 ? props.matched : void 0;
    const owner = variant === "tail" && matched === void 0 ? props?.turn : void 0;
    const ownerTurn = typeof owner === "number" ? owner : typeof owner?.turn === "number" ? owner.turn : void 0;
    let ownerReason;
    if (owner !== null && typeof owner === "object") {
      const kind = owner?.end?.data?.reason?.kind;
      if (typeof kind === "string") ownerReason = kind;
    }
    const messageId = typeof props?.messageId === "string" ? props.messageId : void 0;
    const running = props.useSession?.((snapshot) => snapshot?.running ?? false) ?? false;
    let myTurn = typeof matched?.turn === "number" ? matched.turn : -1;
    let maxTurn = -1;
    let lastOrderTurn = -1;
    let endReason;
    let text;
    try {
      myTurn = props.useChat?.((chat) => {
        if (typeof matched?.turn === "number") return matched.turn;
        if (ownerTurn !== void 0) return ownerTurn;
        if (messageId !== void 0) {
          for (const data of tailDatas(chat)) {
            const mid = data?.closing?.finalNode?.messageId ?? data?.closing?.messageId;
            if (mid === messageId && typeof data?.turn === "number") return data.turn;
          }
        }
        return -1;
      }) ?? myTurn;
      maxTurn = props.useChat?.((chat) => {
        let m = -1;
        for (const data of tailDatas(chat)) {
          if (data?.closing === null || data?.closing === void 0) continue;
          if (typeof data?.turn === "number" && data.turn > m) m = data.turn;
        }
        return m;
      }) ?? -1;
      lastOrderTurn = props.useChat?.((chat) => {
        const order = chat?.timeline?.turnOrder;
        return Array.isArray(order) && order.length > 0 ? order[order.length - 1] : -1;
      }) ?? -1;
      if (ownerReason === void 0 && myTurn >= 0) {
        endReason = props.useChat?.((chat) => {
          const kind = chat?.timeline?.turns?.get?.(myTurn)?.end?.data?.reason?.kind;
          return typeof kind === "string" ? kind : void 0;
        });
      } else {
        props.useChat?.(() => void 0);
      }
      text = props.useChat?.((chat) => {
        if (myTurn < 0) return void 0;
        for (const data of tailDatas(chat)) {
          if (data?.turn === myTurn) return closingTextOf(data?.closing);
        }
        return void 0;
      });
    } catch {
    }
    if (running || myTurn < 0) return null;
    const dedupeKey = sessionId + "/" + myTurn;
    if (variant === "actions" && tailRenderedTurns.has(dedupeKey)) return null;
    let reason;
    if (matched !== void 0) {
      if (lastOrderTurn >= 0 && myTurn !== lastOrderTurn) return null;
      const abnormal = endReason !== void 0 && endReason !== "completed";
      if (!abnormal && !hasInterruptedStep(props?.turn) && text !== "") return null;
      reason = matched.frozen === true ? "\u601D\u8003\u9636\u6BB5\u88AB\u622A\u65AD" : "\u8F93\u51FA\u88AB\u622A\u65AD";
    } else {
      if (maxTurn >= 0 && myTurn !== maxTurn) return null;
      const laterEmptyTurns = lastOrderTurn > myTurn;
      const incomplete = endReason !== void 0 && endReason !== "completed" || typeof text === "string" && text.length === 0 || laterEmptyTurns || text !== void 0 && hasUnclosedFence(text);
      if (!incomplete) return null;
      reason = endReason !== void 0 && endReason !== "completed" ? `\u672C\u8F6E\u7ED3\u675F\u539F\u56E0 ${endReason}` : "\u672C\u8F6E\u6D41\u5F0F\u8F93\u51FA\u88AB\u622A\u65AD";
    }
    const send = () => {
      try {
        const session = sessions?.binding?.(sessionId)?.session;
        void session?.prompt?.([{ type: "text", text: PROMPT_TEXT }], "queue");
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] \u53D1\u9001\u300C${PROMPT_TEXT}\u300D\u5931\u8D25\uFF1A`, error);
      }
    };
    if (variant === "tail") {
      tailRenderedTurns.set(dedupeKey, true);
      if (tailRenderedTurns.size > 64) tailRenderedTurns.clear();
    }
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: PLUGIN_ID,
        title: `${reason}\u2014\u2014\u5411\u4F1A\u8BDD\u53D1\u9001\u300C${PROMPT_TEXT}\u300D`,
        onClick: send,
        children: label
      }
    );
  };
  ctx.slots.inject(SLOT_TURN_TAIL, () => ctx.slots.register({
    name: SLOT_TURN_TAIL,
    id: "continue-generation",
    select: selectFrozenTail,
    order: 0
  }, makeButton("tail")));
  ctx.slots.inject(SLOT_ASSISTANT_ACTIONS, () => ctx.slots.register({
    name: SLOT_ASSISTANT_ACTIONS,
    id: "continue-generation-actions",
    order: 0
  }, makeButton("actions")));
}

return module.exports; } });
