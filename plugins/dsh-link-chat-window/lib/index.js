// plugins/dsh-link-chat-window/src/index.ts
import z from "@deepseek-ai/schemastery";

// plugins/dsh-link-chat-window/src/policy.ts
var DEFAULT_WINDOW_POLICY = Object.freeze({
  windowEvents: 500,
  slackEvents: 125
});
function takeWindowTail(node, count) {
  if (count <= 0 || node.length === 0) return [];
  const keep = Math.min(count, node.length);
  const blocks = [];
  let want = keep;
  const pending = [node];
  while (pending.length > 0 && want > 0) {
    const current = pending.pop();
    if (current.kind === "concat") {
      pending.push(current.left, current.right);
      continue;
    }
    const take = Math.min(current.length, want);
    const from = current.length - take;
    const block = [];
    for (let index = from; index < current.entries.length; index += 1) {
      const entry = current.entries[index];
      if (entry !== void 0) block.push(entry);
    }
    blocks.push(block);
    want -= take;
  }
  const out = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block === void 0) continue;
    for (const entry of block) out.push(entry);
  }
  return out;
}
var TailWindowPolicy = class {
  numbers;
  appends = 0;
  pages = 0;
  trims = 0;
  dropped = 0;
  folds = /* @__PURE__ */ new Map();
  /**
   * @param numbers - validated policy numbers; omission keeps {@link DEFAULT_WINDOW_POLICY}.
   */
  constructor(numbers = DEFAULT_WINDOW_POLICY) {
    if (!Number.isSafeInteger(numbers.windowEvents) || numbers.windowEvents <= 0) {
      throw new Error("windowEvents must be a positive safe integer");
    }
    if (!Number.isSafeInteger(numbers.slackEvents) || numbers.slackEvents < 0) {
      throw new Error("slackEvents must be a non-negative safe integer");
    }
    this.numbers = numbers;
  }
  /** The validated numbers this instance was built with. */
  get config() {
    return this.numbers;
  }
  /** Current counters. */
  get stats() {
    return { appends: this.appends, pages: this.pages, trims: this.trims, dropped: this.dropped };
  }
  /**
   * Decide one live append.
   *
   * The guard is the page-in/jump window: while the owner is loading a page (or jumping turns)
   * the policy never trims, because dropping the front mid-load would discard entries the
   * pending page is about to be joined to.
   *
   * @param windowLength - entries in the window after this append.
   * @param loadingOlder - whether the owner is paging history right now.
   * @returns the trim to apply, or null when the window is still within cap + slack.
   */
  onAppend(windowLength, loadingOlder) {
    this.appends += 1;
    if (loadingOlder) return null;
    const limit = this.numbers.windowEvents + this.numbers.slackEvents;
    if (windowLength <= limit) return null;
    const trimTo = this.numbers.windowEvents;
    const decision = { trimTo, dropped: windowLength - trimTo };
    this.trims += 1;
    this.dropped += decision.dropped;
    return decision;
  }
  /**
   * Decide the second truncation of an opening page.
   *
   * A history page is capped by MESSAGES (500) and can inflate to thousands of events (R495 C5:
   * 3,772 events / 8.9 MB measured). When the policy's owner wants the first paint bounded by the
   * event window too, this trims the page to the tail cap up front. The page's own turn alignment
   * is then recovered through the existing loadOlder()/loadThrough() paths, not reimplemented.
   *
   * @param windowLength - entries in the page that was just installed.
   * @returns the trim to apply, or null when the page already fits the window.
   */
  onInstall(windowLength) {
    const trimTo = this.numbers.windowEvents;
    if (windowLength <= trimTo) return null;
    const decision = { trimTo, dropped: windowLength - trimTo };
    this.trims += 1;
    this.dropped += decision.dropped;
    return decision;
  }
  /**
   * Record one paged-in older page. A page never trims; it is the guard state that keeps the
   * append decision quiet until the page has landed.
   */
  onPageIn() {
    this.pages += 1;
  }
  /**
   * Set the fold state of one retained node key.
   *
   * @param key - Chat node key (stable across trims for retained nodes).
   * @param open - whether the folded row is expanded.
   */
  setFold(key, open) {
    this.folds.set(key, open);
  }
  /**
   * Read one retained fold state.
   *
   * @param key - Chat node key.
   * @returns the fold state, or undefined when the node is not retained or was never folded.
   */
  foldOf(key) {
    return this.folds.get(key);
  }
  /**
   * Keep fold state only for the keys still retained after a trim and return how many were
   * dropped.
   *
   * @param retainedKeys - keys present in the retained tail.
   * @returns number of fold records discarded.
   */
  retainFolds(retainedKeys) {
    const keep = new Set(retainedKeys);
    let dropped = 0;
    for (const key of [...this.folds.keys()]) {
      if (keep.has(key)) continue;
      this.folds.delete(key);
      dropped += 1;
    }
    return dropped;
  }
  /** Number of fold records currently retained. */
  get foldCount() {
    return this.folds.size;
  }
};
function readWindowTree(source) {
  const descriptor = Object.getOwnPropertyDescriptor(source, "window");
  const tree = descriptor?.value;
  if (tree === void 0 || typeof tree !== "object" || tree === null) return null;
  return tree;
}

// plugins/dsh-link-chat-window/src/tail-window.ts
var TailWindow = class {
  source;
  policy;
  base = null;
  more = false;
  tri = 0;
  /**
   * @param source - the Session event source (the real `MutableSessionEventSource` in the bench).
   * @param policy - validated policy numbers; omission keeps the 500/125 default.
   */
  constructor(source, policy = new TailWindowPolicy(DEFAULT_WINDOW_POLICY)) {
    this.source = source;
    this.policy = policy;
  }
  /** The policy instance (fold ledger + counters). */
  get windowPolicy() {
    return this.policy;
  }
  /** Entries currently in the window, read structurally (no materialization). */
  get length() {
    const tree = readWindowTree(this.source);
    return tree === null ? this.source.getSnapshot().entries.length : tree.length;
  }
  /** First retained durable seq, or null when the window is empty. */
  get baseSeq() {
    return this.base;
  }
  /** Whether older history remains; true after any trim. */
  get hasMore() {
    return this.more;
  }
  /** Current window + policy snapshot. */
  get snapshot() {
    return { length: this.length, baseSeq: this.base, hasMore: this.more, stats: this.policy.stats };
  }
  /**
   * Record the window state an open/replace installed (the Session's installWindow equivalent)
   * and apply the policy's opening second truncation when the page inflates past the cap.
   *
   * A page is capped by messages, not events (R495 C5), so an opening page can still be several
   * thousand events. Trimming it here is the client-side second truncation R495 §6.2.2 asks for;
   * the trimmed prefix stays reachable through the existing loadOlder() path because the trim
   * only drops a prefix and keeps `hasMore` true.
   *
   * @param entries - the complete window now installed.
   * @param hasMore - whether older history remains.
   * @returns the applied opening trim, or null when the page already fits the window.
   */
  install(entries, hasMore) {
    this.base = entries[0] === void 0 ? null : entries[0].event.seq;
    this.more = hasMore;
    const decision = this.policy.onInstall(entries.length);
    if (decision === null) return null;
    this.trimTo(decision.trimTo);
    return decision;
  }
  /**
   * Append one live entry and apply the policy's trim when one is due.
   *
   * @param entry - live window entry.
   * @param loadingOlder - true while the owner is paging history (trim guard).
   * @returns the applied trim decision, or null when the window is within cap + slack.
   */
  appendLive(entry, loadingOlder = false) {
    if (this.more === false) this.more = this.source.getSnapshot().hasMore;
    this.source.append(entry);
    const decision = this.policy.onAppend(this.length, loadingOlder);
    if (decision === null) return null;
    this.trimTo(decision.trimTo);
    return decision;
  }
  /**
   * Prepend one older contiguous page and record it in the policy.
   *
   * @param entries - older page entries, ascending.
   * @param hasMore - whether history still precedes the expanded window.
   */
  pageIn(entries, hasMore) {
    this.policy.onPageIn();
    this.source.prepend(entries, hasMore);
    this.more = hasMore;
    const first = entries[0];
    if (first !== void 0) this.base = first.event.seq;
  }
  /**
   * Keep only the last `count` entries (the trim primitive).
   *
   * @param count - entries to retain from the tail.
   * @returns how many entries were dropped.
   */
  trimTo(count) {
    const tree = readWindowTree(this.source);
    const retained = tree === null ? this.source.getSnapshot().entries.slice(-count) : takeWindowTail(tree, count);
    const dropped = this.length - retained.length;
    if (dropped <= 0) return 0;
    this.source.replace(retained, true);
    this.base = retained[0] === void 0 ? this.base : retained[0].event.seq;
    this.more = true;
    this.tri += 1;
    return dropped;
  }
  /** Number of trims this controller performed. */
  get trims() {
    return this.tri;
  }
};

// plugins/dsh-link-chat-window/src/index.ts
var name = "dsh-link-chat-window";
var inject = [];
var DEFAULT_CHAT_WINDOW_CONFIG = Object.freeze({
  enabled: false,
  windowEvents: DEFAULT_WINDOW_POLICY.windowEvents,
  slackEvents: DEFAULT_WINDOW_POLICY.slackEvents,
  trimOpeningPage: false
});
var Config = z.object({
  enabled: z.boolean().default(DEFAULT_CHAT_WINDOW_CONFIG.enabled),
  windowEvents: z.number().default(DEFAULT_CHAT_WINDOW_CONFIG.windowEvents),
  slackEvents: z.number().default(DEFAULT_CHAT_WINDOW_CONFIG.slackEvents),
  trimOpeningPage: z.boolean().default(DEFAULT_CHAT_WINDOW_CONFIG.trimOpeningPage)
});
function apply(ctx, config = DEFAULT_CHAT_WINDOW_CONFIG) {
  if (!config.enabled) return;
  const facade = {
    seam: "R510-b2-tail-window",
    status: "prototype-awaiting-kernel-seam",
    numbers: { windowEvents: config.windowEvents, slackEvents: config.slackEvents },
    describe: () => "dsh-link-chat-window: windowEvents=" + String(config.windowEvents) + " slackEvents=" + String(config.slackEvents) + " trimOpeningPage=" + String(config.trimOpeningPage) + " \u2014 needs docs/kernel-patches/R510-draft.patch for runtime effect"
  };
  ctx.provide("linkChatWindow", facade);
  console.log("[link-chat-window] " + facade.describe());
}
export {
  Config,
  DEFAULT_CHAT_WINDOW_CONFIG,
  DEFAULT_WINDOW_POLICY,
  TailWindow,
  TailWindowPolicy,
  apply,
  inject,
  name,
  takeWindowTail
};
