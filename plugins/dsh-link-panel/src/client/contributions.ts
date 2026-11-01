/**
 * The panel's contribution seam, on the client plane: the table other LINK features declare into.
 *
 * WHAT THIS IS. A half that provides 'linkPanel' publishes one service with three faces:
 *
 *   declare(definition) -> disposer   a feature hands in { id, kind, title, source, order?, body? }
 *                                     and takes it back out again with the returned disposer.
 *   entries() / rejected()            read-only views of what the seam draws now and of the
 *                                     declarations it refused, each refusal carrying its own name.
 *   notify()                          the named refresh path: "my reading moved, project again" -
 *                                     the provider's half of the live-reading rule below.
 *
 * ONE VOCABULARY, NOT TWO (R192-contract.md §1.1). The refusal codes are the host registry's own
 * three names - PANEL_DUP_ID / PANEL_UNKNOWN_KIND / PANEL_EMPTY_SOURCE - and the closed kind set is
 * the host's set. Everything else that is refused keeps its own text and carries `code: null`. The
 * package's self-check holds the two halves together: it imports the host half as a module, compares
 * the vocabulary byte for byte, and runs both projections over the same declarations.
 *
 * NO ARRIVAL INDEX. The visible rows are sorted by `order`, ties broken by the row's own canonical
 * JSON, and a duplicated id refuses EVERY claimant - so two arrival orders of the same declarations
 * project to the same bytes, and nothing here can decide what the panel shows.
 *
 * NEVER THROWS. A refused declaration is RECORDED, not raised: the host projection refuses the same
 * way (a refused item is named, and an empty panel is legal while a thrown error is not), and two
 * claimants of one id have no loser to blame on the way in. A provider that wants to know what
 * happened reads `rejected()`; the pane draws every refusal by name.
 *
 * A ROW IS THE DECLARATION PLUS ITS TEXT. `title` and `body` are each a string, or a function read
 * again on EVERY projection: a feature's title comes from its OWN dictionary
 * (`() => t('panel.item.title')`, the thunk rule this package uses for its own tab type, so a language
 * switch needs no re-declaration) and a body can be a live reading. Text that throws is carried as its
 * own error text, and text that is neither a string nor a function refuses the row by its own text: a
 * provider must not be able to take the panel down.
 *
 * AN ACTION IS A ROW SOMEONE PRESSES (R193-contract.md §1.2, §1.4). A row of kind 'action' carries
 * one OPTIONAL field of code rather than data, `invoke` - a function the pane presses and this seam
 * calls EXACTLY ONCE, with the declaration itself as the receiver (`invoke.call(declaration)`), so a
 * feature's own method keeps its own `this`. A throw is CONTAINED here and travels back as its OWN text
 * (never renamed, never re-thrown), and an action WITHOUT a callable `invoke` is refused through the
 * passthrough channel a non-finite order already uses: `code: null` and the original text, because
 * inventing a fourth refusal name is exactly what R192 §1.1 forbids. The function never travels into a
 * row - a row reports `hasInvoke`, a boolean, and that boolean is what the marker (readable data)
 * carries; the pane presses a DRAWN row by id (see `press`) rather than holding a function of its own.
 *
 * NO CACHED PROJECTION (R192 defect fix). What this seam holds is the CLAIMS. A projection is taken
 * when it is read - `entries()` and `rejected()` each project the live claims, thunks included - so a
 * row drawn after the provider's reading moved carries the reading as it is NOW rather than the text
 * the item answered when it was declared. The defect this replaced was a projection frozen at
 * `declare` time: the provider's own marker moved with its store while the panel went on drawing the
 * placeholder it had read once, because nothing asked the seam to look again.
 *
 * THE NAMED REFRESH PATH. `notify()` is how a provider says "my reading moved, take a fresh
 * projection": it is not a timer (this seam owns no clock and polls nothing - R191's lesson is a
 * cadence racing its own judgement) and not a re-declaration (the item stays exactly as declared; no
 * second item is invented). It tells every listener that a projection is due, and the pane's loader is
 * one of them, so the marker and the drawn row move in the same step as the notification.
 */
import { errorText } from './view.ts'

/** The service name a consumer injects: `export const inject = ['linkPanel', ...]`. */
export const LINK_PANEL_SERVICE = 'linkPanel'

/**
 * The closed set of item kinds - the HOST registry's own list, spelled the same way on purpose.
 *
 * Closed means closed: a kind outside this set is refused BY NAME (PANEL_UNKNOWN_KIND) and is never
 * translated to the nearest kind this build happens to know. A newer feature declaring a kind from a
 * newer round must appear as a HOLE, not as an item drawn in the wrong place.
 */
export const CONTRIBUTION_KINDS: readonly string[] = Object.freeze(['pane', 'action', 'status'])

/**
 * The named refusals - the WHOLE family, and the same three names the host registry uses (R192 §1.1).
 *
 * These three names are the vocabulary a provider, a reader and the pane share. This file refuses to
 * invent a fourth, so everything else that is refused carries the original text and `code: null`.
 */
export const CONTRIBUTION_REJECT = Object.freeze({
  DUP_ID: 'PANEL_DUP_ID',
  UNKNOWN_KIND: 'PANEL_UNKNOWN_KIND',
  EMPTY_SOURCE: 'PANEL_EMPTY_SOURCE',
})

const KIND_SET: Set<string> = new Set(CONTRIBUTION_KINDS)
/** The host's own precedence, so two halves reporting one declaration agree on which code wins. */
const PRECEDENCE: readonly string[] = Object.freeze([CONTRIBUTION_REJECT.UNKNOWN_KIND, CONTRIBUTION_REJECT.EMPTY_SOURCE, CONTRIBUTION_REJECT.DUP_ID])
/** The three identity fields the scalar rule reads; `title` and `body` are text and `order` has its own rule. */
const FIELDS: readonly string[] = Object.freeze(['id', 'kind', 'source'])

/** One contributed row, as the seam publishes it and the pane draws it. */
export interface PanelContribution {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly source: string
  readonly order: number
  /** The item's own text: the declaration's `body` string, or what its function answered. */
  readonly body: string
  /**
   * Whether the declaration carries a callable `invoke` - a BOOLEAN, never the function itself: a row
   * is data a reader (and the marker) can hold, and a function in it would be a row nobody can compare.
   * `kind: 'action'` rows are drawn as buttons and are pressed through {@link LinkPanelService.press}.
   */
  readonly hasInvoke: boolean
}

/**
 * What one press settled to.
 *
 * `ok: false` carries the PROVIDER'S OWN text when its `invoke` threw - the original message, never a
 * summary of it and never a code, because the press has no code of this seam's own; the other two
 * refusals (an id nothing draws, a row that is not an action) carry this seam's own sentence about the
 * press it could not take.
 */
export interface PanelActionResult {
  readonly ok: boolean
  /** The text the row shows after the press; '' when the press held. */
  readonly detail: string
}

/** One refused declaration: what it claimed, the named code (or null when the text is the whole story), and why. */
export interface PanelContributionRefusal {
  readonly id: string | null
  readonly code: string | null
  readonly detail: string
}

/** What a provider declares into, and what the pane and the provider read back. */
export interface LinkPanelService {
  /**
   * Hand one declaration in.
   * @param definition - `{ id, kind, title, source, order?, body? }`; a refused one is named in `rejected()`.
   * @returns an idempotent disposer that takes this exact declaration back out.
   */
  declare(definition: unknown): () => void
  /**
   * The rows the seam draws now: sorted, frozen, and projected from the live claims ON THIS CALL, so
   * every `title`/`body` thunk is read again here. Two calls answer two separate arrays.
   */
  entries(): readonly PanelContribution[]
  /** Every declaration refused over the current claims, sorted by data, projected on this call too. */
  rejected(): readonly PanelContributionRefusal[]
  /**
   * THE NAMED REFRESH PATH: "my reading moved - take a fresh projection".
   *
   * A provider whose `body`/`title` thunk answers a live value calls this when that value moves
   * (a store change, a language switch, a reading landing). Every listener hears it - the pane's
   * loader among them - and the next projection reads the thunks again, so the drawn row and the
   * marker carry the new reading. It is not a re-declaration (the declaration is untouched) and not a
   * poll (no clock, no interval, no cadence of this seam's own). Never throws.
   */
  /**
   * PRESS ONE DRAWN ACTION: call the declaration behind `id` exactly ONCE, as its own receiver.
   *
   * The id is looked up in a projection taken NOW, so what is pressed is what is drawn: an id nothing
   * draws (a disposed item, a refused one, a duplicate - every claimant of a duplicated id is refused),
   * or a row whose kind is not 'action', is a press this seam REFUSES BY ITS OWN TEXT rather than a
   * call the provider never asked for. A declaration whose `invoke` throws does not take the caller
   * down: its own message travels back as `detail` and the row it belongs to is untouched.
   * @param id - the id of a drawn row of kind 'action'.
   * @returns `{ ok: true, detail: '' }` when the provider's `invoke` returned, or the original text of
   *   what went wrong. Never throws (the one caller-supplied function on this path runs inside a catch).
   */
  press(id: string): PanelActionResult
  notify(): void
  /** Hear about every refresh (`declare`, a disposer, `notify`); returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

// The service on the client context, so a consumer's typed code reads `ctx.linkPanel` the way it reads
// `ctx.locale`: the same seam shape as the kernel's own client-side services (dsh-liquid-glass does the
// same for its registry). Nothing here reaches the browser bundle: it is a declaration, not code.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The panel's contribution seam, provided by dsh-link-panel's client half. */
    linkPanel: LinkPanelService
  }
}

/** JSON for every value a reader may meet, with NaN/Infinity printed as themselves rather than as null. */
function show(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) === false) return String(value)
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text
  } catch {
    // The only throwers are a `toJSON` that threw and a cyclic value; both are shown as themselves.
    return String(value)
  }
}

/** Code-unit order. Not localeCompare: a projection whose order depends on the machine's locale is not pure. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** One field read without letting a getter's own throw escape as anything but the text it threw. */
function readField(holder: unknown, key: string): { value: unknown; error: string | null } {
  if (holder === null || (typeof holder !== 'object' && typeof holder !== 'function')) return { value: undefined, error: null }
  try {
    return { value: (holder as Record<string, unknown>)[key], error: null }
  } catch (error) {
    return { value: undefined, error: 'reading ' + key + ' threw: ' + errorText(error) }
  }
}

/**
 * Carry one field value into the projection.
 *
 * The five fields are SCALARS, so only what a field can legitimately hold travels as itself: a string,
 * a finite number, a boolean, null. Everything else is carried as null AND named in the refusal text -
 * carrying a structured value as its own String() would launder it into a string that then passes the
 * "non-empty source" check, which is how a seam starts accepting things nobody validated.
 * @param value - the field as the declaration carried it.
 * @param key - its name, for the refusal text.
 * @param errors - the list this reading is appended to.
 * @returns what travels into the row.
 */
function portable(value: unknown, key: string, errors: string[]): unknown {
  if (value === null || value === undefined) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') {
    if (Number.isFinite(value as number)) return value
    errors.push(key + ': a field is a scalar and this number is not finite; it is carried as null: ' + show(value))
    return null
  }
  errors.push(key + ': a field is a scalar and this one is not; it is carried as null: ' + show(value))
  return null
}

/**
 * One text a declaration carries - its `title` or its `body` - read without letting a provider throw.
 *
 * A string is the text; a function is READ ONCE PER PROJECTION, which is what lets a feature show a word
 * from its own dictionary (`title: () => t('panel.item.title')` - the same thunk rule this package's own
 * tab type uses, so a language switch needs no re-declaration) or a live reading. A function that throws
 * answers with its own error text, and anything that is neither a string nor a function refuses the row
 * by its own text.
 * @param value - the field as the declaration carried it.
 * @param key - its name, for the refusal text.
 * @param errors - the list this reading is appended to.
 * @returns the text the row carries, or '' when the field said nothing.
 */
function readText(value: unknown, key: string, errors: string[]): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'function') {
    errors.push(key + ' must be a string or a function returning one (got ' + show(value) + '); a row is refused rather than given text nobody wrote')
    return ''
  }
  try {
    const answer = (value as () => unknown)()
    return typeof answer === 'string' ? answer : show(answer)
  } catch (error) {
    return errorText(error)
  }
}

interface ReadDeclaration {
  row: PanelContribution
  errors: string[]
}

/** Read one declaration into the six fields a row carries, collecting every reason it is not one. Never throws. */
function readDeclaration(raw: unknown): ReadDeclaration {
  const errors: string[] = []
  const holder = raw !== null && (typeof raw === 'object' || typeof raw === 'function') ? raw : null
  if (holder === null) errors.push('the declaration is not an object: ' + show(raw))
  const carried: Record<string, unknown> = {}
  for (const key of FIELDS) {
    const held = readField(holder, key)
    if (held.error !== null) errors.push(held.error)
    carried[key] = portable(held.value, key, errors)
  }
  if (typeof carried.id !== 'string' || carried.id.trim() === '') errors.push('id must be a non-empty string (got ' + show(carried.id) + ')')
  // `title` is text, not an identity: a string, or the feature's own thunk over its dictionary.
  const spelledTitle = readField(holder, 'title')
  if (spelledTitle.error !== null) errors.push(spelledTitle.error)
  const title = readText(spelledTitle.value, 'title', errors)
  if (title.trim() === '') errors.push('title must be a non-empty string, or a function answering one (got ' + show(spelledTitle.value) + ')')
  // `order` is the one field with a default - a feature that does not care where it stands stands first
  // - and it is read OUTSIDE the scalar rule so that a declared non-finite order is refused instead of
  // silently becoming the default: "no order" and "an order that is not a number" are two facts.
  const spelled = readField(holder, 'order')
  if (spelled.error !== null) errors.push(spelled.error)
  const declaredOrder = spelled.value === null || spelled.value === undefined ? 0 : spelled.value
  if (typeof declaredOrder !== 'number' || Number.isFinite(declaredOrder) === false) errors.push('order must be a finite number (got ' + show(spelled.value) + ')')
  const body = readField(holder, 'body')
  if (body.error !== null) errors.push(body.error)
  // `invoke` is the one field that is CODE rather than data, so it is read OUTSIDE the scalar rule
  // (a function is exactly what it is allowed to be) and it is never carried into the row: the row
  // reports `hasInvoke`. Two refusals live here and they are told apart on purpose: a field that is
  // there and is not a function refuses ANY row by its own text, while an 'action' with NO callable
  // `invoke` is refused because an action nobody can press must be a HOLE, not a reading drawn where a
  // button was promised. Both keep `code: null`: this seam owns three refusal names and invents none.
  const spelledInvoke = readField(holder, 'invoke')
  if (spelledInvoke.error !== null) errors.push(spelledInvoke.error)
  const invoke = typeof spelledInvoke.value === 'function' ? spelledInvoke.value as (this: unknown) => unknown : null
  if (invoke === null && spelledInvoke.value !== null && spelledInvoke.value !== undefined) {
    errors.push('invoke must be a function (got ' + show(spelledInvoke.value) + '); a field that is neither a function nor absent refuses the row rather than promising a press nobody can make')
  }
  if (carried.kind === 'action' && invoke === null) {
    errors.push('kind action needs a callable invoke (got ' + show(spelledInvoke.value) + '); an action nobody can press is refused by its own text rather than drawn as a reading')
  }
  const row = {
    id: carried.id,
    kind: carried.kind,
    title,
    source: carried.source,
    order: typeof declaredOrder === 'number' && Number.isFinite(declaredOrder) ? declaredOrder : 0,
    body: readText(body.value, 'body', errors),
    hasInvoke: invoke !== null,
  } as unknown as PanelContribution
  return { row, errors }
}

/**
 * The closed-set gate for one declaration's kind - written as ONE statement, on purpose.
 *
 * This is the line an unknown kind must fail at, and the line a mutant aims at when it stops refusing
 * one: a guard that cannot be made to fail was never a guard.
 * @param row - the declaration being projected.
 * @returns the named refusal, or null when the kind is inside the closed set.
 */
function refusalOfKind(row: PanelContribution): string | null {
  if (!KIND_SET.has(row.kind)) return CONTRIBUTION_REJECT.UNKNOWN_KIND
  return null
}

interface Issue {
  code: string | null
  detail: string
}

/** Fold one declaration's issues into the single refusal the seam reports for it. */
function refusalOf(row: PanelContribution, issues: readonly Issue[]): PanelContributionRefusal {
  const code = PRECEDENCE.find((name) => issues.some((issue) => issue.code === name)) ?? null
  const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id : null
  return Object.freeze({ id, code, detail: issues.map((issue) => issue.detail).join('; ') })
}

/**
 * Project declarations into what the pane draws and what it refuses, by name.
 *
 * Pure: no clock, no environment, no locale, no I/O. Same declarations in, same bytes out - including
 * for two different ARRIVAL ORDERS of the same declarations, which is why the sort keys are data
 * (order, then the row's own JSON) and why a duplicated id refuses every claimant instead of letting
 * the first one win.
 * @param claims - the declarations, in any order.
 * @returns the sorted visible rows and every refusal, each carrying its name when it has one.
 */
export function projectContributions(claims: readonly unknown[]): { visible: readonly PanelContribution[]; rejected: readonly PanelContributionRefusal[] } {
  if (Array.isArray(claims) === false) {
    throw new TypeError('projectContributions: the declarations must be an array (got ' + show(claims) + ') - a caller that hands it something else has a bug, not a refused declaration')
  }
  const read = claims.map((raw) => readDeclaration(raw))
  const claimants = new Map<string, string[]>()
  for (const item of read) {
    const id = item.row.id
    if (typeof id !== 'string' || id.trim() === '') continue
    const list = claimants.get(id) ?? []
    list.push(String(item.row.order))
    claimants.set(id, list)
  }
  const visible: PanelContribution[] = []
  const rejected: PanelContributionRefusal[] = []
  for (const item of read) {
    const row = item.row
    const issues: Issue[] = []
    for (const detail of item.errors) issues.push({ code: null, detail })
    const unknownKind = refusalOfKind(row)
    if (unknownKind !== null) issues.push({ code: unknownKind, detail: 'unknown kind ' + show(row.kind) + '; the closed set is ' + CONTRIBUTION_KINDS.join(', ') })
    if (typeof row.source !== 'string' || row.source.trim() === '') {
      issues.push({ code: CONTRIBUTION_REJECT.EMPTY_SOURCE, detail: 'source is empty (got ' + show(row.source) + '): an item that cannot say where it comes from is not showable' })
    }
    const claimed = claimants.get(row.id) ?? []
    if (claimed.length > 1) {
      issues.push({
        code: CONTRIBUTION_REJECT.DUP_ID,
        detail: 'duplicate id ' + show(row.id) + ': ' + String(claimed.length) + ' declarations claim it (order ' + [...claimed].sort(compareText).join(', ')
          + '); every claimant is refused, because keeping one would let arrival order decide what the panel shows',
      })
    }
    if (issues.length === 0) visible.push(row)
    else rejected.push(refusalOf(row, issues))
  }
  visible.sort((left, right) => (left.order - right.order) || compareText(show(left), show(right)))
  rejected.sort((left, right) => compareText(show(left), show(right)))
  return { visible: Object.freeze(visible), rejected: Object.freeze(rejected) }
}

/**
 * The seam itself: a table of CLAIMS, a projection taken on every read, and a named refresh path.
 *
 * The claims are held by an opaque key rather than by id, because two declarations of one id must both
 * stay in the table: dropping one on the way in is the arbitration this seam does not do.
 *
 * The only thing cached here is the claims. `project()` runs on every `entries()`/`rejected()` call,
 * so those two answer a FRESH projection - every live `title`/`body` thunk read again - and a reading
 * that moved is drawn as it is now, not as it was when the item was declared. `notify()` is the
 * named path a provider calls when its own reading moved: it reads nothing itself (a projection
 * nobody takes is a projection nobody needs) and tells every listener that one is due.
 * @returns the service a `provide('linkPanel', ...)` hands to consumers.
 */
export function createLinkPanelService(): LinkPanelService {
  const claims = new Map<symbol, unknown>()
  const listeners = new Set<() => void>()

  /**
   * Take the projection NOW, from the live claims: every `title`/`body` thunk is read here, which is
   * why a re-read answers the current reading rather than the declaration's.
   * @returns the sorted visible rows and every refusal, both frozen.
   */
  function project(): { visible: readonly PanelContribution[]; rejected: readonly PanelContributionRefusal[] } {
    const projected = projectContributions([...claims.values()])
    return {
      visible: Object.freeze(projected.visible.map((row) => Object.freeze({ ...row }))),
      rejected: projected.rejected,
    }
  }

  /**
   * Tell every listener that a projection is due: a declaration arrived or left, or a provider called
   * the named refresh path. One throwing listener must not strand the rest (the locale service's rule).
   */
  function announce(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('dsh-link-panel: a contribution listener threw: ' + errorText(error))
      }
    }
  }

  return {
    declare(definition: unknown): () => void {
      const key = Symbol('dsh-link-panel-contribution')
      claims.set(key, definition)
      announce()
      let live = true
      return () => {
        if (live === false) return
        live = false
        claims.delete(key)
        announce()
      }
    },
    entries(): readonly PanelContribution[] {
      return project().visible
    },
    rejected(): readonly PanelContributionRefusal[] {
      return project().rejected
    },
    press(id: string): PanelActionResult {
      // What is pressed is what is DRAWN: the projection is taken here, so an id that no row carries
      // any more (disposed, refused, or the second claimant of a duplicated id) is a named refusal of
      // the press rather than a call into a declaration nothing shows.
      const row = project().visible.find((entry) => entry.id === id)
      if (row === undefined) return { ok: false, detail: 'no drawn row carries id ' + show(id) + ', so there is no action to press' }
      if (row.kind !== 'action') return { ok: false, detail: 'the drawn row ' + show(id) + ' is kind ' + show(row.kind) + '; only an action is pressed, and this row is a reading' }
      for (const claim of claims.values()) {
        if (readField(claim, 'id').value !== id || readField(claim, 'kind').value !== 'action') continue
        const invoked = readField(claim, 'invoke').value
        if (typeof invoked !== 'function') continue
        // EXACTLY ONCE, and the first claim that can be pressed answers: a drawn row's id has one
        // claimant (two claimants of one id are both refused), so this loop cannot double-call.
        try {
          (invoked as (this: unknown) => unknown).call(claim)
          return { ok: true, detail: '' }
        } catch (error) {
          // THE PROVIDER'S OWN TEXT, not a name of this seam's: the one place a caller's code runs is
          // the one place it may throw, and what it threw is what the row shows.
          return { ok: false, detail: errorText(error) }
        }
      }
      return { ok: false, detail: 'the declaration drawn as ' + show(id) + ' carries no callable invoke, so there is nothing to press' }
    },
    notify(): void {
      announce()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
