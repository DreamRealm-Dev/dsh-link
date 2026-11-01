/**
 * The live-tail window controller: the drop-in payload of the kernel client seam (R493).
 *
 * A Session today appends live events to its event window and never removes anything (the first
 * page is bounded by 500 messages, everything after it is unbounded). This controller is the
 * piece that closes that: after each live append the policy may ask for a trim, the trim takes
 * the last N entries structurally (see takeWindowTail), replaces the window, and mirrors the
 * two pieces of Session bookkeeping the trim invalidates:
 *
 *   - `baseSeq` becomes the first retained event seq, so `loadOlder()` pages from the new front
 *     (the dropped range is older history, so `hasMore` stays true and paging stays contiguous);
 *   - `hasMore` stays true because a trim only ever drops a prefix.
 *
 * In the kernel patch those two writes are the only lines that must live inside `Session` (it
 * owns the fields); everything else in this file is reusable as-is. Until that patch lands, this
 * controller can only be driven where the concrete event source is reachable — the benchmark
 * drives it against the real kernel class, and the doc records why a dynamic client plugin cannot.
 */
import type { TrimDecision, WindowEntry, WindowPolicyStats } from './policy.ts'
import { DEFAULT_WINDOW_POLICY, TailWindowPolicy, takeWindowTail, readWindowTree } from './policy.ts'

/** The outward snapshot members this controller reads (structural mirror of SessionEventWindow). */
export interface WindowSnapshotView<Entry> {
  readonly entries: readonly Entry[]
  readonly hasMore: boolean
  readonly revision: number
}

/** The source surface the controller needs; the session-controller class satisfies it. */
export interface EventWindowSource<Entry> {
  /** @returns the current window snapshot. */
  getSnapshot(): WindowSnapshotView<Entry>
  /** Replace the complete window; publishes a `replace` change. */
  replace(entries: readonly Entry[], hasMore: boolean): void
  /** Prepend one older contiguous page; publishes a `prepend` change. */
  prepend(entries: readonly Entry[], hasMore: boolean): void
  /** Append one live entry; publishes an `append` change. */
  append(entry: Entry): void
}

/** Public bookkeeping the controller mirrors for its owner. */
export interface TailWindowSnapshot {
  /** Entries currently in the window. */
  readonly length: number
  /** First retained durable seq, or null for an empty window. */
  readonly baseSeq: number | null
  /** Whether older history remains outside the window (always true after a trim). */
  readonly hasMore: boolean
  /** Policy counters. */
  readonly stats: WindowPolicyStats
}

/**
 * Owns one Session's live-tail cap.
 */
export class TailWindow<Entry extends WindowEntry> {
  private readonly source: EventWindowSource<Entry>
  private readonly policy: TailWindowPolicy
  private base: number | null = null
  private more = false
  private tri: number = 0

  /**
   * @param source - the Session event source (the real `MutableSessionEventSource` in the bench).
   * @param policy - validated policy numbers; omission keeps the 500/125 default.
   */
  constructor(source: EventWindowSource<Entry>, policy: TailWindowPolicy = new TailWindowPolicy(DEFAULT_WINDOW_POLICY)) {
    this.source = source
    this.policy = policy
  }

  /** The policy instance (fold ledger + counters). */
  get windowPolicy(): TailWindowPolicy {
    return this.policy
  }

  /** Entries currently in the window, read structurally (no materialization). */
  get length(): number {
    const tree = readWindowTree<Entry>(this.source)
    return tree === null ? this.source.getSnapshot().entries.length : tree.length
  }

  /** First retained durable seq, or null when the window is empty. */
  get baseSeq(): number | null {
    return this.base
  }

  /** Whether older history remains; true after any trim. */
  get hasMore(): boolean {
    return this.more
  }

  /** Current window + policy snapshot. */
  get snapshot(): TailWindowSnapshot {
    return { length: this.length, baseSeq: this.base, hasMore: this.more, stats: this.policy.stats }
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
  install(entries: readonly Entry[], hasMore: boolean): TrimDecision | null {
    this.base = entries[0] === undefined ? null : entries[0].event.seq
    this.more = hasMore
    const decision = this.policy.onInstall(entries.length)
    if (decision === null) return null
    this.trimTo(decision.trimTo)
    return decision
  }

  /**
   * Append one live entry and apply the policy's trim when one is due.
   *
   * @param entry - live window entry.
   * @param loadingOlder - true while the owner is paging history (trim guard).
   * @returns the applied trim decision, or null when the window is within cap + slack.
   */
  appendLive(entry: Entry, loadingOlder: boolean = false): TrimDecision | null {
    if (this.more === false) this.more = this.source.getSnapshot().hasMore
    this.source.append(entry)
    const decision = this.policy.onAppend(this.length, loadingOlder)
    if (decision === null) return null
    this.trimTo(decision.trimTo)
    return decision
  }

  /**
   * Prepend one older contiguous page and record it in the policy.
   *
   * @param entries - older page entries, ascending.
   * @param hasMore - whether history still precedes the expanded window.
   */
  pageIn(entries: readonly Entry[], hasMore: boolean): void {
    this.policy.onPageIn()
    this.source.prepend(entries, hasMore)
    this.more = hasMore
    const first = entries[0]
    if (first !== undefined) this.base = first.event.seq
  }

  /**
   * Keep only the last `count` entries (the trim primitive).
   *
   * @param count - entries to retain from the tail.
   * @returns how many entries were dropped.
   */
  trimTo(count: number): number {
    const tree = readWindowTree<Entry>(this.source)
    const retained = tree === null
      ? this.source.getSnapshot().entries.slice(-count)
      : takeWindowTail(tree, count)
    const dropped = this.length - retained.length
    if (dropped <= 0) return 0
    // Older history still precedes the retained tail: `hasMore` stays true so loadOlder() pages
    // from the new front (baseSeq) and the window stays contiguous.
    this.source.replace(retained, true)
    this.base = retained[0] === undefined ? this.base : retained[0].event.seq
    this.more = true
    this.tri += 1
    return dropped
  }

  /** Number of trims this controller performed. */
  get trims(): number {
    return this.tri
  }
}

export { DEFAULT_WINDOW_POLICY, TailWindowPolicy, takeWindowTail, readWindowTree }
export type { TrimDecision, WindowEntry }
