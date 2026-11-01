window.__ModuleLoader__.load({ id: "dsh-link-markdown", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/dsh-link-markdown/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");

// plugins/dsh-link-markdown/src/client/claim.ts
var MARKDOWN_TAB_ID = "dsh-link-markdown";
var MARKDOWN_KIND = "markdown";
var MARKDOWN_PATTERNS = Object.freeze(["*.md", "*.markdown"]);
var FILE_ADDRESS_PREFIX = "dsh-resource://file/";
var MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;
var REFUSAL_DISPOSITIONS = Object.freeze({
  notFileAddress: "not-a-dsh-resource-file-address",
  malformed: "malformed-file-address",
  unknownScope: "unknown-file-address-scope",
  absoluteScope: "absolute-scope-carries-no-session",
  notMarkdown: "not-a-markdown-extension"
});
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return void 0;
  }
}
function fileTargetOf(address) {
  if (typeof address !== "string" || !address.startsWith(FILE_ADDRESS_PREFIX)) {
    return { ok: false, reason: REFUSAL_DISPOSITIONS.notFileAddress, detail: `not a dsh-resource://file/ address: ${String(address)}` };
  }
  const end = address.search(/[?#]/);
  const segments = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? void 0 : end).split("/");
  const scope = segments.shift();
  if (scope === "session") {
    const id = segments.shift();
    if (id === void 0 || id === "" || segments.length === 0) {
      return { ok: false, reason: REFUSAL_DISPOSITIONS.malformed, detail: `session address without an id or a path: ${address}` };
    }
    const sessionId = decodeSegment(id);
    const decoded = segments.map(decodeSegment);
    if (sessionId === void 0 || decoded.some((segment) => segment === void 0)) {
      return { ok: false, reason: REFUSAL_DISPOSITIONS.malformed, detail: `address segment is not validly encoded: ${address}` };
    }
    return { ok: true, scope: "session", sessionId, path: decoded.join("/") };
  }
  if (scope === "absolute") {
    return { ok: false, reason: REFUSAL_DISPOSITIONS.absoluteScope, detail: `an absolute file address carries no Session to read through: ${address}` };
  }
  return { ok: false, reason: REFUSAL_DISPOSITIONS.unknownScope, detail: `unknown file address scope "${String(scope)}": ${address}` };
}
function isMarkdownAddress(address) {
  const target = fileTargetOf(address);
  if (target.ok !== true) return false;
  const end = target.path.search(/[?#]/);
  return MARKDOWN_EXTENSION.test(end === -1 ? target.path : target.path.slice(0, end));
}
function basenameOf(address) {
  const target = fileTargetOf(address);
  const path = target.ok === true ? target.path : typeof address === "string" ? address : "";
  const segments = path.split(/[\\/]/).filter((segment) => segment !== "");
  return segments.length === 0 ? "" : segments[segments.length - 1];
}
function titleFor(address) {
  const name = basenameOf(address);
  return name === "" ? address : name;
}

// plugins/dsh-link-markdown/src/client/failure.ts
var REASON_KEYS = /* @__PURE__ */ new Map([
  [REFUSAL_DISPOSITIONS.notFileAddress, "failure.reason.notFileAddress"],
  [REFUSAL_DISPOSITIONS.malformed, "failure.reason.malformed"],
  [REFUSAL_DISPOSITIONS.unknownScope, "failure.reason.unknownScope"],
  [REFUSAL_DISPOSITIONS.absoluteScope, "failure.reason.absoluteScope"],
  [REFUSAL_DISPOSITIONS.notMarkdown, "failure.reason.notMarkdown"],
  ["read-rejected", "failure.reason.readRejected"],
  ["page-made-no-progress", "failure.reason.noProgress"],
  ["unreadable-file", "failure.reason.unreadable"]
]);
var NAMED_FAILURE_CODES = Object.freeze([...REASON_KEYS.keys()]);
function failureReasonKey(code) {
  return REASON_KEYS.get(code);
}

// plugins/dsh-link-markdown/src/client/locales.ts
var NS = "dsh-link-markdown";
var zh = {
  "body.readonly": "\u53EA\u8BFB",
  "empty.noAddress": "\u8FD9\u4E2A\u6807\u7B7E\u6CA1\u6709\u53EF\u8BFB\u7684\u5730\u5740",
  "failure.reason.notFileAddress": "\u4E0D\u662F dsh-resource://file/ \u5730\u5740",
  "failure.reason.malformed": "\u5730\u5740\u4E0D\u5B8C\u6574\uFF08\u7F3A session id \u6216\u8DEF\u5F84\uFF0C\u6216\u8F6C\u4E49\u4E0D\u5408\u6CD5\uFF09",
  "failure.reason.unknownScope": "\u4E0D\u8BA4\u8BC6\u7684\u5730\u5740\u8303\u56F4",
  "failure.reason.absoluteScope": "\u7EDD\u5BF9\u8DEF\u5F84\u5730\u5740\u4E0D\u5E26 Session\uFF0C\u8BFB\u4E0D\u4E86",
  "failure.reason.notMarkdown": "\u4E0D\u662F .md / .markdown \u6587\u4EF6",
  "failure.reason.readRejected": "\u8BFB\u53D6\u8BF7\u6C42\u88AB\u62D2\u7EDD",
  "failure.reason.noProgress": "\u5206\u9875\u505C\u5728\u539F\u5730\uFF1A\u540C\u4E00 offset \u8FD4\u56DE 0 \u884C\u4E14\u6CA1\u6709 eof",
  "failure.reason.unreadable": "\u8FD9\u4E2A\u6587\u4EF6\u6CA1\u80FD\u8BFB\u51FA\u6765",
  "body.edit": "\u7F16\u8F91",
  "body.preview": "\u9884\u89C8",
  "body.save": "\u4FDD\u5B58",
  "body.saved": "\u5DF2\u4FDD\u5B58",
  "body.dirty": "\u672A\u4FDD\u5B58",
  "body.saveHint": "Ctrl+S \u4FDD\u5B58\uFF1B\u4FDD\u5B58\u524D\u4E0D\u4F1A\u5199\u5165\u78C1\u76D8",
  "body.savedHint": "\u5DF2\u5199\u5165\u78C1\u76D8",
  "body.stale": "\u6587\u4EF6\u5728\u4F60\u7F16\u8F91\u671F\u95F4\u88AB\u6539\u8FC7\uFF0C\u4FDD\u5B58\u5DF2\u62D2\u7EDD\uFF1A\u5148\u91CD\u65B0\u6253\u5F00\u518D\u6539",
  "body.refused": "\u4FDD\u5B58\u88AB\u62D2\u7EDD\uFF08\u539F\u56E0\u89C1\u6587\u4EF6\u540D\u53F3\u4FA7\u72B6\u6001\uFF09",
  "markdown.copy": "\u590D\u5236",
  "markdown.copied": "\u5DF2\u590D\u5236",
  "markdown.footnotes": "\u811A\u6CE8"
};
var en = {
  "body.readonly": "read-only",
  "empty.noAddress": "This tab carries no readable address",
  "failure.reason.notFileAddress": "Not a dsh-resource://file/ address",
  "failure.reason.malformed": "The address is incomplete (no session id or path, or a bad escape)",
  "failure.reason.unknownScope": "Unknown address scope",
  "failure.reason.absoluteScope": "An absolute-path address carries no Session to read through",
  "failure.reason.notMarkdown": "Not a .md / .markdown file",
  "failure.reason.readRejected": "The read request was rejected",
  "failure.reason.noProgress": "Paging stopped where it stood: one offset returned 0 lines without eof",
  "failure.reason.unreadable": "This file could not be read",
  "body.edit": "Edit",
  "body.preview": "Preview",
  "body.save": "Save",
  "body.saved": "Saved",
  "body.dirty": "unsaved changes",
  "body.saveHint": "Ctrl+S saves; nothing is written until you do",
  "body.savedHint": "written to disk",
  "body.stale": "The file changed while you were editing, so the save was refused - reopen it and edit again",
  "body.refused": "The save was refused (the status beside the file name says why)",
  "markdown.copy": "Copy",
  "markdown.copied": "Copied",
  "markdown.footnotes": "Footnotes"
};

// plugins/dsh-link-markdown/src/client/read.ts
function startDocument(address) {
  return { address, lines: [], nextOffset: 1, eof: false, pages: 0, failure: null, version: void 0, absolutePath: void 0 };
}
function documentText(document2) {
  return document2.lines.join("\n");
}
function appendPage(document2, page) {
  const lines = page.lines > 0 ? page.text.split("\n") : [];
  return {
    ...document2,
    lines: [...document2.lines, ...lines],
    nextOffset: page.offset + page.lines,
    eof: page.eof === true,
    pages: document2.pages + 1,
    failure: null,
    version: page.version ?? document2.version,
    absolutePath: page.absolutePath ?? document2.absolutePath
  };
}
function failureText(error) {
  if (error !== null && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message !== "") return message;
  }
  return String(error);
}
function failDocument(document2, failure) {
  return { ...document2, failure: { code: String(failure.code), message: String(failure.message) } };
}
function failureOf(error) {
  const code = error !== null && typeof error === "object" ? Reflect.get(error, "code") : void 0;
  return { code: typeof code === "string" && code !== "" ? code : "unreadable-file", message: failureText(error) };
}
function createPageReader(remote) {
  return (sessionId, path, range, signal) => remote.workspaceFiles.read(sessionId, path, range, signal);
}
async function readAllPages(readPage, address, signal, onPage) {
  let document2 = startDocument(address);
  onPage(document2);
  const target = fileTargetOf(address);
  if (target.ok !== true) {
    const failed = failDocument(document2, { code: target.reason, message: target.detail });
    onPage(failed);
    return failed;
  }
  for (; ; ) {
    let result;
    try {
      result = await readPage(target.sessionId, target.path, { offset: document2.nextOffset }, signal);
    } catch (error) {
      const failed = failDocument(document2, { code: "read-rejected", message: failureText(error) });
      onPage(failed);
      return failed;
    }
    if (result.ok !== true) {
      const failed = failDocument(document2, failureOf(result.error));
      onPage(failed);
      return failed;
    }
    const page = result.value;
    document2 = appendPage(document2, page);
    onPage(document2);
    if (document2.eof) return document2;
    if (!(page.lines > 0)) {
      const failed = failDocument(document2, { code: "page-made-no-progress", message: `offset ${page.offset} returned 0 lines without eof` });
      onPage(failed);
      return failed;
    }
  }
}

// plugins/dsh-link-markdown/src/client/save.ts
var SAVE_PATH = "/api/dsh-link-markdown/write";
function canEdit(document2) {
  if (document2.failure !== null) return false;
  const path = document2.absolutePath;
  return typeof path === "string" && path !== "";
}
function isDirty(original, draft) {
  return original !== draft;
}
async function saveDocument(document2, text, request) {
  const path = document2.absolutePath;
  if (typeof path !== "string" || path === "") return { kind: "refused", code: "NO_PATH", detail: "" };
  const answer = await request(SAVE_PATH, { path, text, expectedVersion: document2.version, sessionId: document2.sessionId });
  const body = answer.body === null || typeof answer.body !== "object" ? {} : answer.body;
  if (answer.status === 200 && body.ok === true) {
    return { kind: "saved", version: typeof body.version === "string" ? body.version : null, bytes: typeof body.bytes === "number" ? body.bytes : null };
  }
  if (answer.status === 409) return { kind: "stale", version: typeof body.version === "string" ? body.version : null };
  return { kind: "refused", code: typeof body.code === "string" ? body.code : "HTTP_" + String(answer.status), detail: typeof body.error === "string" ? body.error : "" };
}

// plugins/dsh-link-markdown/src/client/register.ts
var MARKER_KEY = "__dshLinkMarkdown";
function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
function markRegistered(globals, patterns = MARKDOWN_PATTERNS) {
  const marker = { kind: MARKDOWN_KIND, patterns: [...patterns], registered: true };
  globals[MARKER_KEY] = marker;
}
function markFailed(globals, error) {
  globals[MARKER_KEY] = { registered: false, failed: errorText(error) };
}
function markDisposed(globals) {
  globals[MARKER_KEY] = { registered: false, disposed: true };
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
function markdownDefinition(titleText) {
  return {
    id: MARKDOWN_TAB_ID,
    kind: MARKDOWN_KIND,
    priority: "extension",
    patterns: [...MARKDOWN_PATTERNS],
    canOpen: isMarkdownAddress,
    title: titleText
  };
}
function registerMarkdown(ctx, face) {
  const globals = face.globals ?? globalThis;
  const disposers = [];
  try {
    disposers.push(ctx.effect(() => ctx.sidebarRightTabs.register(markdownDefinition(face.titleText)), "dsh-link-markdown: markdown tab type"));
    disposers.push(ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
      // `locale` is the namespace the body's `t` seat reads; the title seat has no copy of its
      // own (its text is the file name), so it declares none.
      { name: "sidebar.right.pane.tab", key: MARKDOWN_TAB_ID, locale: NS, inject: () => ({ readPage: face.readPage }) },
      face.body
    )), "dsh-link-markdown: markdown tab body"));
    disposers.push(ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register(
      { name: "sidebar.right.pane.tab.title", key: MARKDOWN_TAB_ID },
      face.title
    )), "dsh-link-markdown: markdown tab title"));
  } catch (error) {
    markFailed(globals, error);
    return () => {
    };
  }
  markRegistered(globals);
  return () => {
    for (const disposer of disposers) release(disposer);
    markDisposed(globals);
  };
}

// plugins/dsh-link-markdown/src/client/markdown.css
var markdown_default = "/* dsh-link-markdown: the right Sidebar's markdown tab body.\n *\n * The shell hands every tab body a `.tabBody`: display flex, column, height 100%, min-height 0, overflow hidden\n * (ui-sidebar-right/src/client/shell/SidebarRight.module.css:168-175). R480: this pane shipped with no sheet at\n * all, so the document was clipped by that hidden overflow (no scrollbar: only the wheel worked when it happened to\n * be over the body) and the text ran into the pane's edges (no gutter). The rules below are this pane's own layout:\n * the root claims the space, the head stays put, and the document gets its own scroller and a real gutter.\n *\n * Tokens only (the same --dsw-alias-* the shell carries), scoped under .dsh-link-markdown, mounted for this plugin's\n * lifetime from apply().\n */\n\n.dsh-link-markdown {\n  display: flex;\n  flex: 1 1 auto;\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  height: 100%;\n  overflow: hidden;\n  color: var(--dsw-alias-label-primary);\n  font: var(--dsw-font-xs-13, 13px/1.6 system-ui);\n}\n\n/* The head: the file name (ellipsized, it is the tab's own address), then the read-only / edit control and the\n   dirty mark. It is the one row that does not scroll. */\n.dsh-link-markdown-head {\n  display: flex;\n  flex: none;\n  align-items: center;\n  gap: 8px;\n  box-sizing: border-box;\n  min-height: 0;\n  padding: 8px 14px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n  font: var(--dsw-font-xxs-12, 12px);\n}\n\n.dsh-link-markdown-path {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-primary);\n  font-weight: 600;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n.dsh-link-markdown-mode {\n  flex: none;\n  padding: 3px 10px;\n  color: var(--dsw-alias-label-secondary);\n  font: var(--dsw-font-xxs-12, 12px);\n  background: transparent;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  cursor: default;\n}\n\nbutton.dsh-link-markdown-mode {\n  cursor: pointer;\n}\n\nbutton.dsh-link-markdown-mode:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-l1);\n}\n\n.dsh-link-markdown-dirty {\n  flex: none;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-xxs-12, 12px);\n}\n\n/* The document: the pane's scroller. The gutter is the point of the report - 18px each side, and room at the bottom\n   so the last line is not glued to the pane's edge either. */\n.dsh-link-markdown-body {\n  flex: 1 1 auto;\n  min-width: 0;\n  min-height: 0;\n  overflow: auto;\n  overscroll-behavior: contain;\n  padding: 14px 18px 28px;\n  box-sizing: border-box;\n  scrollbar-gutter: stable;\n}\n\n/* The kernel's markdown renderer owns the typography; this only keeps wide material inside the gutter: code fences\n   and tables get their own horizontal scroller, media shrinks, and long unbroken tokens (hashes, paths) wrap. */\n.dsh-link-markdown-body :where(pre) {\n  max-width: 100%;\n  overflow-x: auto;\n}\n\n.dsh-link-markdown-body :where(img, svg, video, table) {\n  max-width: 100%;\n}\n\n.dsh-link-markdown-body :where(p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote) {\n  overflow-wrap: anywhere;\n}\n\n/* Editing keeps the same frame: the textarea takes the scroller's share, the toolbar stays visible under it. */\n.dsh-link-markdown-editor {\n  display: flex;\n  flex: 1 1 auto;\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n}\n\n.dsh-link-markdown-area {\n  flex: 1 1 auto;\n  box-sizing: border-box;\n  width: 100%;\n  min-width: 0;\n  min-height: 0;\n  padding: 14px 18px;\n  color: var(--dsw-alias-label-primary);\n  font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  tab-size: 2;\n  background: transparent;\n  border: 0;\n  outline: none;\n  resize: none;\n}\n\n.dsh-link-markdown-toolbar {\n  display: flex;\n  flex: none;\n  align-items: center;\n  gap: 10px;\n  padding: 8px 14px;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n  font: var(--dsw-font-xxs-12, 12px);\n}\n\n.dsh-link-markdown-toolbar button {\n  padding: 4px 12px;\n  color: var(--dsw-alias-label-primary);\n  font: var(--dsw-font-xxs-12, 12px);\n  background: var(--dsw-alias-bg-l1);\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n}\n\n.dsh-link-markdown-toolbar button:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-link-markdown-toolbar button:disabled {\n  color: var(--dsw-alias-label-tertiary);\n  background: transparent;\n  cursor: default;\n}\n\n.dsh-link-markdown-status {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  text-overflow: ellipsis;\n}\n\n/* Empty state and the named failure page: both are the whole body, so they carry the same gutter. */\n.dsh-link-markdown-empty,\n.dsh-link-markdown-failure {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow: auto;\n  margin: 0;\n  padding: 16px 18px;\n  color: var(--dsw-alias-label-secondary);\n  font: var(--dsw-font-xxs-12, 12px);\n}\n\n.dsh-link-markdown-reason {\n  display: block;\n  color: var(--dsw-alias-label-primary);\n  font-weight: 600;\n}\n\n.dsh-link-markdown-detail {\n  display: block;\n  margin-top: 6px;\n  overflow-wrap: anywhere;\n  color: var(--dsw-alias-label-tertiary);\n}\n";

// plugins/dsh-link-markdown/src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "sidebarRightTabs", "remote", "remote.workspaceFiles", "locale"];
var PLUGIN_ID = "dsh-link-markdown";
function installStyles(ctx) {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = PLUGIN_ID + "/markdown.css";
    tag.textContent = markdown_default;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "dsh-link-markdown: pane stylesheet");
}
function addressOf(info) {
  const tab = info !== null && typeof info === "object" ? Reflect.get(info, "tab") : void 0;
  if (tab === null || typeof tab !== "object") return "";
  const navigation = Reflect.get(tab, "navigation");
  const fromNavigation = navigation !== null && typeof navigation === "object" ? Reflect.get(navigation, "address") : void 0;
  if (typeof fromNavigation === "string" && fromNavigation !== "") return fromNavigation;
  const contentId = Reflect.get(tab, "contentId");
  return typeof contentId === "string" ? contentId : "";
}
function MarkdownBody(props) {
  const { t } = props;
  const info = props.useTabInfo();
  const address = addressOf(info);
  const resource = props.useResource(address);
  const version = resource?.value?.version;
  const [document2, setDocument] = (0, import_react.useState)(() => startDocument(address));
  const labels = (0, import_react.useMemo)(() => ({
    code: { copyLabel: t("markdown.copy"), copiedLabel: t("markdown.copied") },
    footnotes: t("markdown.footnotes")
  }), [t]);
  const [editing, setEditing] = (0, import_react.useState)(false);
  const [draft, setDraft] = (0, import_react.useState)("");
  const [outcome, setOutcome] = (0, import_react.useState)(null);
  const [reload, setReload] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    const target = fileTargetOf(address);
    if (target.ok !== true) {
      setDocument(failDocument(startDocument(address), { code: target.reason, message: target.detail }));
      return;
    }
    const controller = new AbortController();
    setDocument(startDocument(address));
    void readAllPages(props.readPage, address, controller.signal, setDocument);
    return () => controller.abort();
  }, [address, version, reload, props.readPage]);
  const text = documentText(document2);
  const editable = canEdit(document2);
  const dirty = editing && isDirty(text, draft);
  const beginEdit = () => {
    setDraft(text);
    setOutcome(null);
    setEditing(true);
  };
  const postJson = async (path, body) => {
    const answer = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const parsed = await answer.json().catch(() => null);
    return { status: answer.status, body: parsed };
  };
  const commit = async () => {
    if (dirty === false) {
      setEditing(false);
      return;
    }
    const target = fileTargetOf(address);
    const sessionId = target.ok === true ? target.sessionId : void 0;
    const result = await saveDocument({ absolutePath: document2.absolutePath, version: document2.version, sessionId }, draft, postJson);
    setOutcome(result);
    if (result.kind === "saved") {
      setReload(reload + 1);
    }
  };
  const name = basenameOf(address);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-link-markdown", "data-markdown-address": address, "data-markdown-name": name, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-link-markdown-head", "data-markdown-head": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-link-markdown-path", title: address, children: name === "" ? address : name }),
      editable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "dsh-link-markdown-mode",
          "data-markdown-edit-toggle": "",
          "data-markdown-editing": editing ? "true" : "false",
          onClick: () => {
            if (editing) {
              setEditing(false);
              setOutcome(null);
            } else {
              beginEdit();
            }
          },
          children: editing ? t("body.preview") : t("body.edit")
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-link-markdown-mode", "data-markdown-readonly": "", children: t("body.readonly") }),
      dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-link-markdown-dirty", "data-markdown-dirty": "", children: t("body.dirty") }) : null
    ] }),
    address === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-link-markdown-empty", "data-markdown-empty": "", children: t("empty.noAddress") }) : document2.failure === null ? editing ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-link-markdown-editor", "data-markdown-editor": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          className: "dsh-link-markdown-area",
          "data-markdown-area": "",
          value: draft,
          spellCheck: false,
          onChange: (event) => {
            setDraft(event.target.value);
            setOutcome(null);
          },
          onKeyDown: (event) => {
            if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
              event.preventDefault();
              void commit();
            }
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-link-markdown-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-markdown-save": "", disabled: dirty === false, onClick: () => {
          void commit();
        }, children: outcome !== null && outcome.kind === "saved" ? t("body.saved") : t("body.save") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            className: "dsh-link-markdown-status",
            "data-markdown-status": outcome === null ? "idle" : outcome.kind,
            "data-markdown-code": outcome !== null && outcome.kind === "refused" ? outcome.code : void 0,
            title: outcome !== null && outcome.kind === "refused" && outcome.detail !== "" ? outcome.detail : void 0,
            children: outcome === null ? t("body.saveHint") : outcome.kind === "saved" ? t("body.savedHint") : outcome.kind === "stale" ? t("body.stale") : t("body.refused")
          }
        )
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-link-markdown-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text, labels }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dsh-link-markdown-failure", "data-markdown-failure": document2.failure.code, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-link-markdown-reason", children: t(failureReasonKey(document2.failure.code) ?? "failure.reason.unreadable") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-link-markdown-detail", children: [
        document2.failure.code,
        ": ",
        document2.failure.message
      ] })
    ] })
  ] });
}
function MarkdownTitle(props) {
  const address = addressOf(props.useTabInfo());
  const name = basenameOf(address);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-link-markdown-title", title: address, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.FileTypeIcon, { kind: "markdown", size: 16, className: "dsh-link-markdown-title-icon" }),
    name === "" ? address : name
  ] });
}
function apply(ctx) {
  installStyles(ctx);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-link-markdown: dictionaries");
  const readPage = createPageReader(ctx.remote);
  registerMarkdown(ctx, {
    body: MarkdownBody,
    title: MarkdownTitle,
    titleText: titleFor,
    readPage
  });
}

return module.exports; } });
