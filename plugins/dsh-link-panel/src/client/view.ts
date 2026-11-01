/**
 * The panel tab's view model, as pure functions.
 *
 * Two route answers fold into one view:
 *
 *   GET /api/dsh-link-panel/state   the registry's visible items and its named refusals
 *   GET /api/dsh-link-notes/state   the ledger, folded, with its thresholds and its counts
 *
 * Neither answer is translated into a plausible one. A body this module cannot read (no answer, not
 * JSON, the wrong fields) becomes a NAMED client failure that keeps the original text; a body the
 * route itself refused keeps the route's own code and message VERBATIM, because a second name for a
 * fact that already has a name is a second opinion about that fact.
 *
 * The fold is order-independent by construction: the two slots are disjoint, the failure list is
 * sorted by data (never by arrival), and the view is rebuilt in a fixed key order, so the two arrival
 * orders of the same two answers produce byte-identical views. The self-check compares them.
 *
 * Nothing here reads a clock, the environment, the DOM or the network, and nothing here throws: every
 * reader is total over its input, including values a route would never send.
 */

/** This implementation's identity in the tab system, and the key its body and title register under. */
export const PANEL_TAB_ID = 'dsh-link-panel'

/**
 * The tab type's kind: `pane`, the one kind of dsh-link-panel's closed set whose sink is the right
 * rail. The kind is the registry's word for "a place with content", not a new name invented here.
 */
export const PANEL_TAB_KIND = 'pane'

/** Where the registry answers (the host half's default route; a row that renames it is not consulted). */
export const PANEL_STATE_PATH = '/api/dsh-link-panel/state'

/** Where the ledger answers, read-only. */
export const NOTES_STATE_PATH = '/api/dsh-link-notes/state'

/** Where one note is written. The only write this pane performs, and it is one note at a time. */
export const NOTES_ADD_PATH = '/api/dsh-link-notes/add'

/**
 * Who a note written in this pane is attributed to: the person at the keyboard, which is exactly the
 * write path R189 §1 opened for the user (the Agent's own writes go through the `notes_add` tool and
 * its approval, and never through this route).
 */
export const USER_AUTHOR = 'user'

/**
 * The two names this half owns. They say what the CLIENT saw — "the route did not answer" and "the
 * answer is not the registered shape" — and are never used to re-name a fact the route already named.
 * A route error (`NOTES_TOO_LONG`, `METHOD_NOT_ALLOWED`, …) travels with its own code.
 */
export const CLIENT_FAILURES = Object.freeze({
  UNREADABLE: 'response-unreadable',
  SHAPE: 'response-shape',
})

/** How much of a non-JSON body is quoted, and the quote says so: nothing is silently truncated. */
const QUOTE_LIMIT = 200

/** One answer as the client half received it: the status, the parsed body, the raw text, or why there was none. */
export interface RouteAnswer {
  /** HTTP status, or null when the request never produced one. */
  readonly status: number | null
  /** The parsed body when it was JSON, else null. */
  readonly body: unknown
  /** The body as text, verbatim. */
  readonly text: string
  /** Why there was no answer at all (fetch rejected, no fetch), else null. */
  readonly transport: string | null
}

/** A read that could not be taken: a named code, the original text, and who named it. */
export interface ReadFailure {
  readonly ok: false
  /** A route code verbatim, or one of {@link CLIENT_FAILURES}. */
  readonly code: string
  /** The original message; for a client failure, one sentence plus a verbatim quote. */
  readonly detail: string
  readonly from: 'route' | 'client'
}

/** One refused registry item, as the route reports it: the code is the route's, or null. */
export interface PanelRefusal {
  readonly id: string | null
  readonly code: string | null
  readonly detail: string
}

/**
 * One contributed row as the pane draws it: the contribution seam's own row (contributions.ts), declared
 * here so this module keeps importing nothing. The two interfaces are structurally the same seven
 * fields - `hasInvoke` is the seam's report of whether the declaration carries a callable `invoke`, a
 * BOOLEAN (the function itself never travels in a row, and so never into the marker either).
 */
export interface PanelContributionRow {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly source: string
  readonly order: number
  readonly body: string
  readonly hasInvoke: boolean
}

/** One declaration the seam refused, as the seam reports it: its code is the seam's own, or null. */
export interface PanelContributionRefusalRow {
  readonly id: string | null
  readonly code: string | null
  readonly detail: string
}

/** The registry facts the pane reads out of the same answer, carried verbatim. */
export interface PanelRegistry {
  readonly kinds: unknown
  readonly sinks: unknown
  readonly kindSinks: unknown
  readonly sinksMounted: unknown
  readonly entries: unknown
}

/** A registry answer that could be read: the route's own rows, verbatim. */
export interface PanelReadOk {
  readonly ok: true
  /** `declared.visible` exactly as it arrived: the pane never adds, drops or reorders a field. */
  readonly items: readonly unknown[]
  readonly refused: readonly PanelRefusal[]
  readonly registry: PanelRegistry | null
}

/** One note as the pane draws it: the route's own fields, or null where the route carried none. */
export interface NoteRow {
  readonly id: string | null
  readonly text: string
  readonly tags: readonly string[] | null
  readonly author: string | null
  readonly state: string | null
}

/** A ledger answer that could be read. */
export interface NotesReadOk {
  readonly ok: true
  readonly rows: readonly NoteRow[]
  /** The route's own `limits` object, verbatim: this half does not re-derive a threshold. */
  readonly limits: unknown
  /** The route's own `counts` object, verbatim, or null when it carries none. */
  readonly counts: unknown
}

/** Whether a slot has been read yet. "pending" is not "empty": the pane says which one it is. */
export type ReadState = 'pending' | 'ok' | 'failed'

/** One failure inside the folded view, with the slot it came from. */
export interface ViewFailure {
  readonly source: 'panel' | 'notes'
  readonly code: string
  readonly detail: string
  readonly from: 'route' | 'client'
}

/** The one view the pane draws and the marker reports. */
export interface PanelViewModel {
  readonly tabId: string
  readonly reads: { readonly panel: ReadState; readonly notes: ReadState }
  readonly items: readonly unknown[]
  readonly refused: readonly PanelRefusal[]
  readonly registry: PanelRegistry | null
  readonly notes: { readonly rows: readonly NoteRow[]; readonly limits: unknown; readonly counts: unknown }
  /** The seam's rows, drawn beside the route's items and never mixed into `items` (R192-contract.md §1.3). */
  readonly contributed: readonly PanelContributionRow[]
  /** The declarations the seam refused, each with its own name; drawn where a person reads refusals. */
  readonly contributedRefused: readonly PanelContributionRefusalRow[]
  /** Every failure so far, sorted by data, so two arrival orders give the same bytes. */
  readonly failures: readonly ViewFailure[]
}

/** One route's answer folded into the view. */
export type Arrival =
  | { readonly source: 'panel'; readonly read: PanelReadOk | ReadFailure }
  | { readonly source: 'notes'; readonly read: NotesReadOk | ReadFailure }

/** The marker while the half is mounted and has no unanswered failure. */
export interface PanelMarkerLive {
  readonly mounted: true
  readonly tabId: string
  readonly items: readonly unknown[]
  readonly notes: { readonly count: number; readonly limits: unknown }
  /** The seam's rows (contributions.ts). `items` stays the ROUTE's visible rows, verbatim. */
  readonly contributed: readonly PanelContributionRow[]
  readonly failed: null
}

/** The marker after a failure; the text is the original one, never a summary of it. */
export interface PanelMarkerFailed {
  readonly mounted: true
  readonly failed: string
}

/** The marker once the half is taken down again. */
export interface PanelMarkerDisposed {
  readonly mounted: false
  readonly disposed: true
}

/** What one submission settled to, as the pane shows it. */
export interface SubmitOutcome {
  readonly ok: boolean
  /** A route code verbatim (`NOTES_TOO_LONG`, …), `added`, or one of {@link CLIENT_FAILURES}. */
  readonly code: string
  /** The original message, or the one line a success is described with. */
  readonly detail: string
  readonly from: 'route' | 'client'
}

/** One readable line for anything thrown. Used by every half, so a failure says the same thing everywhere. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error !== null && typeof error === 'object') {
    const message = field(error, 'message')
    if (typeof message === 'string' && message !== '') return message
  }
  return String(error)
}

/** JSON for every value a reader may meet; a value JSON cannot print is printed as itself. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value) === false) return String(value)
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text
  } catch {
    // The only throwers are a `toJSON` that threw and a cyclic value; both are shown as themselves.
    return String(value)
  }
}

/** Code-unit order. Not localeCompare: a view whose order depends on the machine's locale is not pure. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Quote a body that is not JSON, saying how much of it this is. */
function quote(text: string): string {
  return text.length <= QUOTE_LIMIT
    ? text
    : text.slice(0, QUOTE_LIMIT) + '… (' + String(text.length) + ' characters in all; the first ' + String(QUOTE_LIMIT) + ' are quoted)'
}

/** The value at a key, or undefined when the holder is not an object or the getter threw. */
function field(holder: unknown, key: string): unknown {
  const target = holder !== null && (typeof holder === 'object' || typeof holder === 'function') ? holder as Record<string, unknown> : null
  if (target === null) return undefined
  try {
    return target[key]
  } catch {
    // A field whose getter threw is a value this reader does not have; the shape check names it.
    return undefined
  }
}

/** Whether a value is an object (not null, not an array) or a function: something fields can hang off. */
function isHolder(value: unknown): boolean {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/** A string field, or null when the route carried none there. */
function textAt(holder: unknown, key: string): string | null {
  const value = field(holder, key)
  return typeof value === 'string' ? value : null
}

/** The keys a body actually carries, in code-unit order, so a shape failure can name them. */
function keysOf(holder: unknown): string {
  if (!isHolder(holder)) return '(not an object)'
  try {
    return Object.keys(holder as Record<string, unknown>).sort(compareText).join(', ')
  } catch {
    return '(unreadable)'
  }
}

/** A named client failure: the answer is not the registered shape. */
function shapeFailure(subject: string, detail: string): ReadFailure {
  return { ok: false, code: CLIENT_FAILURES.SHAPE, detail: subject + ': ' + detail, from: 'client' }
}

/**
 * Read the envelope both routes share, and name everything that is not a readable answer.
 *
 * Returns the failure, or null when the answer carries a JSON body with `ok` not false and may be
 * read further. `subject` is the request as the client made it (`GET /api/…`), so a failure reads as
 * one sentence about one request.
 */
function envelopeFailure(answer: RouteAnswer, subject: string): ReadFailure | null {
  if (answer === null || typeof answer !== 'object') {
    return { ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: subject + ': no answer object at all: ' + show(answer), from: 'client' }
  }
  if (typeof answer.transport === 'string' && answer.transport !== '') {
    return { ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: subject + ': no answer — ' + answer.transport, from: 'client' }
  }
  if (typeof answer.status !== 'number') {
    return { ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: subject + ': the request was never sent (no status, no transport error)', from: 'client' }
  }
  if (!isHolder(answer.body)) {
    return {
      ok: false,
      code: CLIENT_FAILURES.UNREADABLE,
      detail: subject + ': HTTP ' + String(answer.status) + ' and the body is not a JSON object: ' + quote(typeof answer.text === 'string' ? answer.text : ''),
      from: 'client',
    }
  }
  if (field(answer.body, 'ok') === false) {
    const error = field(answer.body, 'error')
    const code = textAt(error, 'code')
    const message = textAt(error, 'message')
    return {
      ok: false,
      code: code === null || code === '' ? CLIENT_FAILURES.SHAPE : code,
      detail: message ?? subject + ': HTTP ' + String(answer.status) + ' refused without naming a code, and its body carries no message: ' + quote(String(answer.text)),
      from: code === null || code === '' ? 'client' : 'route',
    }
  }
  return null
}

/**
 * Read `GET /api/dsh-link-panel/state` into the pane's items, refusals and registry facts.
 *
 * The visible rows travel VERBATIM: the marker must report the route's own items, and an item this
 * half rewrote would be a second opinion about the registry. A row that is not an object is a named
 * failure rather than a row to skip — dropping it would make a broken registry look like a shorter one.
 * @param answer - what the route answered.
 * @returns the read, or a named failure.
 */
export function readPanelState(answer: RouteAnswer): PanelReadOk | ReadFailure {
  const subject = 'GET ' + PANEL_STATE_PATH
  const refused = envelopeFailure(answer, subject)
  if (refused !== null) return refused
  const declared = field(answer.body, 'declared')
  if (!isHolder(declared)) {
    return shapeFailure(subject, 'declared is missing or not an object (top-level keys: ' + keysOf(answer.body) + ')')
  }
  const visible = field(declared, 'visible')
  if (Array.isArray(visible) === false) {
    return shapeFailure(subject, 'declared.visible must be an array (got ' + show(visible) + ')')
  }
  for (let index = 0; index < visible.length; index += 1) {
    if (!isHolder(visible[index])) {
      return shapeFailure(subject, 'declared.visible[' + String(index) + '] is not an item object: ' + show(visible[index])
        + ' — an item this pane cannot read is a failure with a name, not an item to skip')
    }
  }
  const rejected = field(declared, 'rejected')
  if (Array.isArray(rejected) === false) {
    return shapeFailure(subject, 'declared.rejected must be an array (got ' + show(rejected) + ')')
  }
  const refusals: PanelRefusal[] = []
  for (let index = 0; index < rejected.length; index += 1) {
    const row = rejected[index]
    if (!isHolder(row)) {
      return shapeFailure(subject, 'declared.rejected[' + String(index) + '] is not a refusal object: ' + show(row))
    }
    refusals.push({
      id: textAt(row, 'id'),
      code: textAt(row, 'code'),
      detail: textAt(row, 'detail') ?? show(row),
    })
  }
  const registryRaw = field(answer.body, 'registry')
  const registry: PanelRegistry | null = isHolder(registryRaw)
    ? {
      kinds: field(registryRaw, 'kinds'),
      sinks: field(registryRaw, 'sinks'),
      kindSinks: field(registryRaw, 'kindSinks'),
      sinksMounted: field(registryRaw, 'sinksMounted'),
      entries: field(registryRaw, 'entries'),
    }
    : null
  return { ok: true, items: visible, refused: refusals, registry }
}

/**
 * Read `GET /api/dsh-link-notes/state` into the pane's note rows, and carry its thresholds verbatim.
 *
 * `limits` is required and carried as the route spelled it: this half shows the threshold, and never
 * applies one of its own. A row whose body is not a string is a named failure, for the reason the
 * panel reader gives: a ledger read must not quietly become a shorter ledger.
 * @param answer - what the route answered.
 * @returns the read, or a named failure.
 */
export function readNotesState(answer: RouteAnswer): NotesReadOk | ReadFailure {
  const subject = 'GET ' + NOTES_STATE_PATH
  const refused = envelopeFailure(answer, subject)
  if (refused !== null) return refused
  const limits = field(answer.body, 'limits')
  if (!isHolder(limits) || typeof field(limits, 'maxNotes') !== 'number' || typeof field(limits, 'maxChars') !== 'number') {
    return shapeFailure(subject, 'limits must be an object carrying maxNotes and maxChars as numbers (got ' + show(limits) + ')'
      + ' — the pane shows the thresholds the route reports and must not invent one')
  }
  const list = field(answer.body, 'notes')
  if (Array.isArray(list) === false) {
    return shapeFailure(subject, 'notes must be an array (got ' + show(list) + '; top-level keys: ' + keysOf(answer.body) + ')')
  }
  const rows: NoteRow[] = []
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index]
    if (!isHolder(row) || typeof field(row, 'text') !== 'string') {
      return shapeFailure(subject, 'notes[' + String(index) + '] is not a note object with a string text: ' + show(row))
    }
    const tags = field(row, 'tags')
    rows.push({
      id: textAt(row, 'id'),
      text: field(row, 'text') as string,
      tags: Array.isArray(tags) && tags.every((tag) => typeof tag === 'string') ? tags as string[] : null,
      author: textAt(row, 'author'),
      state: textAt(row, 'state'),
    })
  }
  return { ok: true, rows, limits, counts: field(answer.body, 'counts') ?? null }
}

/**
 * The request body one submission sends.
 *
 * The text is sent VERBATIM: not trimmed, not clipped to a threshold, not refused here for being empty
 * or too long. Those three refusals belong to the route (NOTES_INPUT / NOTES_TOO_LONG / NOTES_FULL),
 * and a client-side copy of the rule would be a second rule — the thing R189 §4.1 forbids.
 * @param text - what the person typed.
 * @returns the path and the JSON body to POST.
 */
export function noteRequest(text: unknown): { readonly path: string; readonly body: string } {
  return { path: NOTES_ADD_PATH, body: JSON.stringify({ text, author: USER_AUTHOR }) }
}

/**
 * Read the answer to one submission.
 *
 * A refusal is carried with the route's own code and message, which is what the pane shows: the three
 * frozen names arrive here as themselves, and a fourth name would arrive as itself too — a code this
 * half does not know is not translated into one it does. Only an answer that carries no code at all
 * gets one of the two client names.
 * @param answer - what the route answered.
 * @returns what the pane shows under the input box.
 */
export function readSubmit(answer: RouteAnswer): SubmitOutcome {
  const subject = 'POST ' + NOTES_ADD_PATH
  const refused = envelopeFailure(answer, subject)
  if (refused !== null) return { ok: false, code: refused.code, detail: refused.detail, from: refused.from }
  const id = textAt(answer.body, 'id')
  const seq = field(answer.body, 'seq')
  const at = typeof seq === 'number' ? ' (seq ' + String(seq) + ')' : ''
  return {
    ok: true,
    code: 'added',
    detail: id === null ? 'the route accepted the note' + at : 'note ' + id + at,
    from: 'route',
  }
}

/** An empty view: both slots pending, nothing claimed. */
export function emptyView(tabId: string = PANEL_TAB_ID): PanelViewModel {
  return {
    tabId,
    reads: { panel: 'pending', notes: 'pending' },
    items: [],
    refused: [],
    registry: null,
    notes: { rows: [], limits: null, counts: null },
    contributed: [],
    contributedRefused: [],
    failures: [],
  }
}

/** Failures sorted by data, so the view's bytes never depend on which answer came back first. */
function sortFailures(failures: readonly ViewFailure[]): ViewFailure[] {
  return [...failures].sort((left, right) =>
    compareText(left.source, right.source) || compareText(left.code, right.code) || compareText(left.detail, right.detail))
}

/**
 * Fold one arrival into the view. Pure: the same view and arrival give the same result, and the two
 * arrival orders of the same two answers give byte-identical views.
 * @param view - the fold so far.
 * @param arrival - the answer that just landed.
 * @returns the view with that slot settled.
 */
export function withArrival(view: PanelViewModel, arrival: Arrival): PanelViewModel {
  const failures = arrival.read.ok
    ? view.failures
    : [...view.failures, { source: arrival.source, code: arrival.read.code, detail: arrival.read.detail, from: arrival.read.from }]
  const slots = arrival.source === 'panel'
    ? {
      reads: { panel: arrival.read.ok ? 'ok' as ReadState : 'failed' as ReadState, notes: view.reads.notes },
      items: arrival.read.ok ? arrival.read.items : [],
      refused: arrival.read.ok ? arrival.read.refused : view.refused,
      registry: arrival.read.ok ? arrival.read.registry : view.registry,
      notes: view.notes,
      contributed: view.contributed,
      contributedRefused: view.contributedRefused,
    }
    : {
      reads: { panel: view.reads.panel, notes: arrival.read.ok ? 'ok' as ReadState : 'failed' as ReadState },
      items: view.items,
      refused: view.refused,
      registry: view.registry,
      notes: arrival.read.ok ? { rows: arrival.read.rows, limits: arrival.read.limits, counts: arrival.read.counts } : view.notes,
      contributed: view.contributed,
      contributedRefused: view.contributedRefused,
    }
  // Built here, in this order, so the key order is the same whatever arrived first.
  return {
    tabId: view.tabId,
    reads: slots.reads,
    items: slots.items,
    refused: slots.refused,
    registry: slots.registry,
    notes: slots.notes,
    contributed: slots.contributed,
    contributedRefused: slots.contributedRefused,
    failures: sortFailures(failures),
  }
}

/**
 * Fold the seam's current rows into the view.
 *
 * Pure, and separate from the arrival fold on purpose: the route's rows and the seam's rows are two
 * sources, and only this function touches the seam's two slots. `items` and the note ledger travel
 * through untouched, so what the marker reports as `items` can still be held to the route byte for byte.
 * @param view - the view folded so far.
 * @param contributed - the seam's visible rows, already sorted by the seam.
 * @param refused - the declarations the seam refused, by name.
 * @returns the view with the seam's slots settled.
 */
export function withContributions(view: PanelViewModel, contributed: readonly PanelContributionRow[], refused: readonly PanelContributionRefusalRow[]): PanelViewModel {
  return {
    tabId: view.tabId,
    reads: view.reads,
    items: view.items,
    refused: view.refused,
    registry: view.registry,
    notes: view.notes,
    contributed,
    contributedRefused: refused,
    failures: view.failures,
  }
}

/**
 * Fold every arrival, in the order they landed.
 * @param arrivals - the answers that have landed.
 * @param tabId - the tab the view belongs to.
 * @returns the folded view.
 */
export function foldArrivals(arrivals: readonly Arrival[], tabId: string = PANEL_TAB_ID): PanelViewModel {
  let view = emptyView(tabId)
  for (const arrival of arrivals) view = withArrival(view, arrival)
  return view
}

/**
 * The marker while the half is mounted: the route's items, the note count the pane drew, and the
 * route's own thresholds. A failure takes the whole marker (see {@link markerFrom}).
 */
export function markerFrom(view: PanelViewModel): PanelMarkerLive | PanelMarkerFailed {
  if (view.failures.length > 0) {
    const first = sortFailures(view.failures)[0]
    return { mounted: true, failed: first.code + ': ' + first.detail }
  }
  return {
    mounted: true,
    tabId: view.tabId,
    items: view.items,
    notes: { count: view.notes.rows.length, limits: view.notes.limits },
    contributed: view.contributed,
    failed: null,
  }
}

/**
 * The canonical spelling of a view: keys sorted at every level, so "same bytes" is a claim a reader
 * can check with one string comparison rather than by eye.
 * @param value - any view value.
 * @returns its canonical JSON.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/** Sorted-key, total clone: a value JSON cannot represent is spelled out rather than dropped. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry))
  if (isHolder(value)) {
    const out: Record<string, unknown> = {}
    let keys: string[] = []
    try {
      keys = Object.keys(value as Record<string, unknown>).sort(compareText)
    } catch {
      keys = []
    }
    for (const key of keys) out[key] = canonicalize(field(value, key))
    return out
  }
  if (typeof value === 'number' && Number.isFinite(value) === false) return String(value)
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') return String(value)
  return value === undefined ? null : value
}
