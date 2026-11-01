/**
 * The paged-window policy for the Chat event window (R493 B2), as pure functions.
 *
 * The problem this file decides around: a Session's client event window is the client's only
 * source of conversation nodes, and today it only ever grows — the first page is bounded by
 * 500 MESSAGES (HISTORY_PAGE_OPTIONS), but every live append and every paged-in older page is
 * retained forever. The measured consequences (R493 live audit, 31,953 DOM elements at 10.6k
 * events) scale with the window, not with what a user can see.
 *
 * The policy is deliberately small data plus pure transitions so the kernel half and the
 * measurement harness exercise the same decisions:
 *
 *   - a live tail cap (windowEvents) with a slack band (slackEvents): trim only when the window
 *     crosses cap + slack, down to cap. Trimming once per slack appends keeps the amortized
 *     cost O(1) instead of one rebuild per append.
 *   - a paged prefix is never trimmed while it is being loaded (loadingOlder/jump guard);
 *     it is dropped oldest-first when the live tail grows again, which is what makes an old
 *     page "on demand" rather than "retained forever".
 *   - fold state is keyed by the node key the Chat store already uses (turn + answer step for
 *     a turn process). Retained keys keep their fold state across a trim, so a fold is not
 *     rebuilt by window maintenance; only nodes that actually leave the window lose it.
 *
 * This module is imported by the host half, the client half and the benchmark; it has no
 * dependencies and no DOM access.
 */

/** Entry shape the policy needs: a durable Session seq used for baseSeq bookkeeping. */
export interface WindowEntry {
  readonly event: {
    readonly seq: number
  }
}

/** One leaf of the session-controller's event window tree. */
export interface WindowLeaf<Entry> {
  readonly kind: 'leaf'
  readonly entries: readonly Entry[]
  readonly length: number
}

/** One concatenation node of the session-controller's event window tree. */
export interface WindowConcat<Entry> {
  readonly kind: 'concat'
  readonly left: WindowNode<Entry>
  readonly right: WindowNode<Entry>
  readonly length: number
}

/** Structural mirror of the event window tree (leaf/concat, right-leaning for appends). */
export type WindowNode<Entry> = WindowLeaf<Entry> | WindowConcat<Entry>

/** Policy numbers: a 500-entry live tail with a 125-entry slack band. */
export const DEFAULT_WINDOW_POLICY = Object.freeze({
  windowEvents: 500,
  slackEvents: 125,
})

/** Validated policy numbers. */
export interface WindowPolicyNumbers {
  /** Entries retained after a trim. */
  readonly windowEvents: number
  /** Appends allowed above the cap before the next trim. */
  readonly slackEvents: number
}

/** What one append decision asks the window owner to do. */
export interface TrimDecision {
  /** Keep only this many most-recent entries. */
  readonly trimTo: number
  /** Entries dropped by this trim. */
  readonly dropped: number
}

/** Running counters a policy keeps for its own diagnostics and for the benchmark. */
export interface WindowPolicyStats {
  /** Live appends observed. */
  readonly appends: number
  /** Paged-in older pages observed. */
  readonly pages: number
  /** Trims performed. */
  readonly trims: number
  /** Durable entries dropped by trims. */
  readonly dropped: number
}

/**
 * Take the last `count` entries of a window tree without materializing the whole tree.
 *
 * Walks the concatenation tree right-first and stops as soon as `count` entries are collected,
 * so a right-leaning append tree costs O(count + tree depth) rather than O(window length).
 * This is the trim primitive the kernel seam would add next to `materialize()`.
 *
 * @param node - window tree root.
 * @param count - entries to keep from the tail.
 * @returns retained entries in ascending order.
 */
export function takeWindowTail<Entry>(node: WindowNode<Entry>, count: number): readonly Entry[] {
  if (count <= 0 || node.length === 0) return []
  const keep = Math.min(count, node.length)
  const blocks: (readonly Entry[])[] = []
  let want = keep
  const pending: WindowNode<Entry>[] = [node]
  while (pending.length > 0 && want > 0) {
    const current = pending.pop() as WindowNode<Entry>
    if (current.kind === 'concat') {
      pending.push(current.left, current.right)
      continue
    }
    const take = Math.min(current.length, want)
    const from = current.length - take
    const block: Entry[] = []
    for (let index = from; index < current.entries.length; index += 1) {
      const entry = current.entries[index]
      if (entry !== undefined) block.push(entry)
    }
    blocks.push(block)
    want -= take
  }
  const out: Entry[] = []
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block === undefined) continue
    for (const entry of block) out.push(entry)
  }
  return out
}

/**
 * The window policy state machine.
 *
 * One instance belongs to one Session. It is intentionally not a service: the kernel seam keeps
 * its state beside `Session.baseSeq`, and the benchmark drives it directly.
 */
export class TailWindowPolicy {
  private readonly numbers: WindowPolicyNumbers
  private appends = 0
  private pages = 0
  private trims = 0
  private dropped = 0
  private folds = new Map<string, boolean>()

  /**
   * @param numbers - validated policy numbers; omission keeps {@link DEFAULT_WINDOW_POLICY}.
   */
  constructor(numbers: WindowPolicyNumbers = DEFAULT_WINDOW_POLICY) {
    if (!Number.isSafeInteger(numbers.windowEvents) || numbers.windowEvents <= 0) {
      throw new Error('windowEvents must be a positive safe integer')
    }
    if (!Number.isSafeInteger(numbers.slackEvents) || numbers.slackEvents < 0) {
      throw new Error('slackEvents must be a non-negative safe integer')
    }
    this.numbers = numbers
  }

  /** The validated numbers this instance was built with. */
  get config(): WindowPolicyNumbers {
    return this.numbers
  }

  /** Current counters. */
  get stats(): WindowPolicyStats {
    return { appends: this.appends, pages: this.pages, trims: this.trims, dropped: this.dropped }
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
  onAppend(windowLength: number, loadingOlder: boolean): TrimDecision | null {
    this.appends += 1
    if (loadingOlder) return null
    const limit = this.numbers.windowEvents + this.numbers.slackEvents
    if (windowLength <= limit) return null
    const trimTo = this.numbers.windowEvents
    const decision = { trimTo, dropped: windowLength - trimTo }
    this.trims += 1
    this.dropped += decision.dropped
    return decision
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
  onInstall(windowLength: number): TrimDecision | null {
    const trimTo = this.numbers.windowEvents
    if (windowLength <= trimTo) return null
    const decision = { trimTo, dropped: windowLength - trimTo }
    this.trims += 1
    this.dropped += decision.dropped
    return decision
  }

  /**
   * Record one paged-in older page. A page never trims; it is the guard state that keeps the
   * append decision quiet until the page has landed.
   */
  onPageIn(): void {
    this.pages += 1
  }

  /**
   * Set the fold state of one retained node key.
   *
   * @param key - Chat node key (stable across trims for retained nodes).
   * @param open - whether the folded row is expanded.
   */
  setFold(key: string, open: boolean): void {
    this.folds.set(key, open)
  }

  /**
   * Read one retained fold state.
   *
   * @param key - Chat node key.
   * @returns the fold state, or undefined when the node is not retained or was never folded.
   */
  foldOf(key: string): boolean | undefined {
    return this.folds.get(key)
  }

  /**
   * Keep fold state only for the keys still retained after a trim and return how many were
   * dropped.
   *
   * @param retainedKeys - keys present in the retained tail.
   * @returns number of fold records discarded.
   */
  retainFolds(retainedKeys: Iterable<string>): number {
    const keep = new Set(retainedKeys)
    let dropped = 0
    for (const key of [...this.folds.keys()]) {
      if (keep.has(key)) continue
      this.folds.delete(key)
      dropped += 1
    }
    return dropped
  }

  /** Number of fold records currently retained. */
  get foldCount(): number {
    return this.folds.size
  }
}

/**
 * Read the runtime window tree off an event source.
 *
 * The session-controller class keeps the tree in a TypeScript-private field that is a plain
 * runtime property; the kernel seam added for this policy would expose a trim method instead.
 * Reading it structurally here is what lets the prototype measure/carry the exact algorithm
 * while the kernel stays unmodified.
 *
 * @param source - object that carries the window tree.
 * @returns the tree when present, otherwise null.
 */
export function readWindowTree<Entry>(source: object): WindowNode<Entry> | null {
  const descriptor = Object.getOwnPropertyDescriptor(source, 'window')
  const tree = descriptor?.value as WindowNode<Entry> | undefined
  if (tree === undefined || typeof tree !== 'object' || tree === null) return null
  return tree
}
