/**
 * dsh-link-collab - the browser half: the collaboration bus as a STATUS row in the LINK panel.
 *
 * WHAT WAS MISSING AND WHAT THIS IS. The panel had two real entries before this half existed: the
 * browser's action (a press that opens the browser pane) and the team panel's action (a press that
 * opens the team pane). Both are presses. The BUS - the control ledger, the fold, the relay binding,
 * the thing the other two read - had no row at all, so the one layer that holds the facts a person
 * would want first (how many teams, how much ledger, can a peer reach this end) was invisible.
 *
 * This half declares exactly one row, of kind 'status': a reading, not a button. There is no press
 * here because there is nothing to press - the bus has no operation a click would perform that the
 * model-facing tools, the routes and the chat box do not already do, and inventing an action to have
 * something to click is the shape this project keeps finding (present, enabled, doing nothing).
 *
 * WHERE THE NUMBERS COME FROM. The host half of this same package serves ONE read-only route
 * (STATUS_PATH, bound beside the relay) that folds the live ledger and answers the counts; this half
 * reads THAT route and nothing else. No number below is computed in the browser, so the row cannot
 * disagree with the bus it is describing.
 *
 * NO CADENCE (R192's rule, learned in R191). Nothing here starts a timer: no setInterval, no
 * setTimeout, no self-scheduled re-read. A reading is taken when the page can know a person is
 * looking - once when this half mounts, again when the document becomes visible, again on window
 * focus - and every time the resulting text MOVES, the row is republished through the seam's own
 * named refresh path, linkPanel.notify(). The panel's loader is subscribed to that seam, so the
 * drawn row and the marker move in the same step as the notification, and a page that nobody is
 * looking at costs nothing.
 *
 * FAIL-CLOSED, NAMED. Four absences are told apart in this package's own marker
 * (globalThis.__dshLinkCollabPanel) instead of being thrown or silently skipped: no locale service
 * (the words then come from this package's own zh dictionary), no linkPanel service, a declare that
 * threw, and a seam drawn without notify(). Every one of them is a named field, and the half never
 * throws into the shell it runs in.
 */
import { STATUS_PATH } from '../status-path.ts'
import { en, NS, zh, type Translate } from './locales.ts'
import { bodyText, readAnswer, type BusFailure, type BusReading } from './status.ts'

/** This half's one contribution. Namespaced, so two packages cannot collide on an id. */
const PANEL_ITEM_ID = 'dsh-link-collab:bus-status'
/** The seam's word for a reading that is not pressable: its closed kind set is pane / action / status. */
const PANEL_ITEM_KIND = 'status'
/** Who the row belongs to: this package, spelled as its package name. */
const PANEL_ITEM_SOURCE = 'dsh-link-collab'
/** Beside the two presses and the panel guide entry: after the bridge reading (20), before them (30/32/40). */
const PANEL_ITEM_ORDER = 26
/** The client-face service the LINK panel publishes: declare(definition) -> disposer, plus notify(). */
const LINK_PANEL_SERVICE = 'linkPanel'
/** Where this half records what its contribution did; the panel's own marker is the panel's. */
const PANEL_MARKER = '__dshLinkCollabPanel'

/**
 * Nothing is injected, on purpose.
 *
 * Injecting 'linkPanel' or 'locale' would make this whole half WAIT for them, and a half that waits
 * writes no marker and declares no row: the absence would be a silence rather than the named field
 * this half promises. Both services are therefore read with ctx.get at apply time, the way the
 * browser and team halves read the right column.
 */
export const inject: string[] = []

/** The slice of a client context this half uses; a plain object satisfies it, which is what a probe passes. */
interface ClientSurface {
  /** The strict service read. */
  get?: (name: string) => unknown
  /** Runs the body now and keeps the disposer it returns; absent on a hand-driven mount. */
  effect?: (work: () => (() => void) | undefined, label?: string) => unknown
}

/** The locale service's faces, as far as this half reads them. */
interface LocaleFace {
  register(namespace: string, dictionaries: { readonly zh: Record<string, string>, readonly en: Record<string, string> }): unknown
  bind(namespace: string): Translate
  subscribe?(listener: () => void): unknown
}

/** What this half holds from the last read, and what the drawn row currently says. */
interface HalfState {
  /** The reading last taken, or null. */
  reading: BusReading | null
  /** Why there is no reading, or null. */
  failure: BusFailure | null
  /** The text the row was last told about: the comparison that decides whether notify() is due. */
  published: string
  /** How many reads this half has taken. */
  reads: number
  /** How many times the seam's refresh path was used. */
  notifies: number
}

const STATE: HalfState = { reading: null, failure: null, published: '', reads: 0, notifies: 0 }

/** Run a step that must not take the page down; the fallback answers when it throws. */
function safe<T>(step: () => T, fallback: T): T {
  try {
    return step()
  } catch {
    return fallback
  }
}

/** One error's own words, whatever shape it arrived in. */
function messageOf(error: unknown): string {
  const held = error as { message?: unknown } | null
  return held !== null && held !== undefined && held.message !== undefined ? String(held.message) : String(error)
}

/** The kernel's own placeholder form: {name}, left alone when the value is missing. */
function substitute(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/**
 * This half's own record of what its contribution did.
 *
 * Data only, never a function: a reader (and a probe) must be able to hold the marker without
 * executing anything, which is the same rule the seam applies to the rows it draws.
 *
 * @param fields - the readings to merge over what is already there.
 */
function mark(fields: Record<string, unknown>): void {
  safe(() => {
    const globals = globalThis as unknown as Record<string, unknown>
    const held = globals[PANEL_MARKER]
    const base = held !== null && typeof held === 'object' ? held as Record<string, unknown> : {}
    globals[PANEL_MARKER] = Object.assign({}, base, fields, { mounted: true })
  }, undefined)
}

/** One service by its own name and the method the caller is going to use, or null when the page offers none. */
function serviceOf(ctx: ClientSurface, name: string, method: string): Record<string, unknown> | null {
  const read = (value: unknown): Record<string, unknown> | null => {
    if (value === null || value === undefined || typeof value !== 'object') return null
    const held = value as Record<string, unknown>
    return typeof held[method] === 'function' ? held : null
  }
  const strict = safe(() => (typeof ctx.get === 'function' ? ctx.get(name) : null), null)
  const viaGet = read(strict)
  if (viaGet !== null) return viaGet
  return read(safe(() => (ctx as unknown as Record<string, unknown>)[name], null))
}

/** The page's locale service, or null when this page has none. */
function localeService(ctx: ClientSurface): LocaleFace | null {
  const held = serviceOf(ctx, 'locale', 'register')
  return held === null ? null : held as unknown as LocaleFace
}

/**
 * Register this package's dictionaries (one call, both languages) and bind the translate.
 *
 * A page with no locale service answers from the SAME zh dictionary rather than drawing key names.
 *
 * @param locale - the page's locale service, or null.
 * @returns the translate this half reads its own words through.
 */
function bindTranslate(locale: LocaleFace | null): Translate {
  if (locale !== null) {
    const bound = safe(() => locale.bind(NS), null)
    if (typeof bound === 'function') return bound
  }
  return (key, params) => substitute(zh[key] ?? key, params)
}

/** The row's current body, from the reading this half holds now. */
function body(t: Translate): string {
  return bodyText(STATE.reading, STATE.failure, t)
}

/**
 * The one definition this half declares.
 *
 * A status row carries no invoke: it is a reading, and the seam refuses a press on a row that is not
 * an action. Both text fields are thunks over this package's dictionary, so a language switch is a
 * re-projection rather than a re-declaration.
 *
 * @param t - the translate bound to this package's namespace.
 * @returns the item: the identity fields every kind carries, a title, and a live body.
 */
function definition(t: Translate): Record<string, unknown> {
  return {
    id: PANEL_ITEM_ID,
    kind: PANEL_ITEM_KIND,
    source: PANEL_ITEM_SOURCE,
    order: PANEL_ITEM_ORDER,
    title: () => t('panel.status.title'),
    body: () => body(t),
  }
}

/** Run the seam's disposer, whatever shape it came back in; never throws. */
function release(disposer: unknown): void {
  safe(() => {
    if (typeof disposer === 'function') {
      (disposer as () => unknown)()
      return
    }
    const loose = disposer as { dispose?: unknown } | null
    if (loose !== null && typeof loose === 'object' && typeof loose.dispose === 'function') (loose.dispose as () => unknown)()
  }, undefined)
}

/**
 * Publish the row's text through the seam's own refresh path, when - and only when - it moved.
 *
 * This is the half of the no-cadence rule that makes a reading LIVE: the seam holds no clock and
 * polls nothing, so a provider whose own reading moved says so through notify(), and the panel takes
 * a fresh projection in that same step. A text that did not move is not republished: notify() on
 * every read would be a heartbeat dressed as an event.
 *
 * @param seam - the linkPanel service this half declared into.
 * @param t - the translate bound to this package's namespace.
 */
function publishIfMoved(seam: Record<string, unknown>, t: Translate): void {
  const next = body(t)
  mark({ body: next, reading: STATE.reading, failure: STATE.failure })
  if (next === STATE.published) return
  STATE.published = next
  const notify = seam.notify
  if (typeof notify !== 'function') {
    mark({ notifies: STATE.notifies, refresh: 'linkPanel-notify-unavailable: the seam on this page carries no notify(), so the row keeps the text it was declared with' })
    return
  }
  STATE.notifies += 1
  safe(() => (notify as () => unknown).call(seam), undefined)
  mark({ notifies: STATE.notifies })
}

/**
 * Take one reading of the bus's own route.
 *
 * The request is a plain same-origin GET with no body and no credential of this half's own, so what
 * travels is what a person's browser would send. Every failure mode is a value: a page with no fetch,
 * a request that threw, a body that is not JSON and an ok: false answer each land in STATE.failure
 * with the named code this half (or the route) gave them.
 *
 * @param seam - the linkPanel service, so a moved reading reaches the drawn row.
 * @param t - the translate bound to this package's namespace.
 * @returns nothing; the reading (or its named failure) is published on the way out.
 */
async function refresh(seam: Record<string, unknown>, t: Translate): Promise<void> {
  STATE.reads += 1
  const globals = globalThis as unknown as Record<string, unknown>
  const send = globals.fetch
  if (typeof send !== 'function') {
    STATE.reading = null
    STATE.failure = { code: 'no-fetch', detail: 'this page has no fetch to read ' + STATUS_PATH + ' with' }
    mark({ reads: STATE.reads })
    publishIfMoved(seam, t)
    return
  }
  try {
    const answer = await (send as (url: string, init?: unknown) => Promise<Record<string, unknown>>)(STATUS_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    })
    const status = typeof answer.status === 'number' ? answer.status : null
    let text = ''
    try {
      text = String(await (answer as { text: () => Promise<unknown> }).text())
    } catch (error) {
      text = ''
      STATE.reading = null
      STATE.failure = { code: 'body-unreadable', detail: 'the answer body could not be read: ' + messageOf(error) }
      mark({ reads: STATE.reads, failure: STATE.failure })
      publishIfMoved(seam, t)
      return
    }
    const read = readAnswer({ status, text, transport: null })
    STATE.reading = read.reading
    STATE.failure = read.failure
  } catch (error) {
    STATE.reading = null
    STATE.failure = { code: 'route-unreachable', detail: 'reading ' + STATUS_PATH + ' threw: ' + messageOf(error) }
  }
  mark({ reads: STATE.reads, at: Date.now() })
  publishIfMoved(seam, t)
}

/**
 * Install this half's reading-due listeners and return the teardown.
 *
 * Two events, both the page's own, and no timer between them: the document becoming visible again
 * (the person came back to this window) and a window focus. A page offers neither on a hand-driven
 * mount, and then the single read at mount is the whole list rather than an error.
 *
 * @param due - what to run when a reading is due.
 * @returns the unsubscribe that removes both listeners.
 */
function installDueEvents(due: () => void): () => void {
  const globals = globalThis as unknown as Record<string, unknown>
  const off: (() => void)[] = []
  const doc = globals.document as { visibilityState?: unknown, addEventListener?: unknown, removeEventListener?: unknown } | undefined
  if (doc !== undefined && doc !== null && typeof doc.addEventListener === 'function') {
    const listener = (): void => {
      if (doc.visibilityState === 'hidden') return
      due()
    }
    safe(() => (doc.addEventListener as (name: string, fn: () => void) => unknown)('visibilitychange', listener), undefined)
    off.push(() => safe(() => {
      if (typeof doc.removeEventListener !== 'function') return undefined
      return (doc.removeEventListener as (name: string, fn: () => void) => unknown)('visibilitychange', listener)
    }, undefined))
  }
  const win = globals.window as { addEventListener?: unknown, removeEventListener?: unknown } | undefined
  if (win !== undefined && win !== null && typeof win.addEventListener === 'function') {
    const listener = (): void => { due() }
    safe(() => (win.addEventListener as (name: string, fn: () => void) => unknown)('focus', listener), undefined)
    off.push(() => safe(() => {
      if (typeof win.removeEventListener !== 'function') return undefined
      return (win.removeEventListener as (name: string, fn: () => void) => unknown)('focus', listener)
    }, undefined))
  }
  return () => {
    for (const stop of off) stop()
  }
}

/**
 * Declare the row, then wire the reading that keeps it true.
 *
 * @param ctx - the client context this half is applied to.
 * @param t - the translate bound to this package's namespace.
 * @param locale - the page's locale service, or null.
 * @param seam - the linkPanel service, when this page has one.
 * @returns the teardown that takes the row out and stops every listener, or null when there is no
 *   row to take out (no seam, or a seam that refused the declaration).
 */
function mount(ctx: ClientSurface, t: Translate, locale: LocaleFace | null, seam: Record<string, unknown> | null): (() => void) | null {
  if (seam === null) {
    mark({ declared: false, failed: 'linkPanel-unavailable: this page offers no ' + LINK_PANEL_SERVICE + ' service, so the collaboration bus status row was not declared' })
    return null
  }
  let disposer: unknown = null
  try {
    disposer = (seam.declare as (item: unknown) => unknown)(definition(t))
  } catch (error) {
    mark({ declared: false, failed: 'linkPanel-declare-refused: ' + messageOf(error) })
    return null
  }
  STATE.published = body(t)
  mark({ declared: true, failed: null, body: STATE.published })
  const offEvents = installDueEvents(() => { void refresh(seam, t) })
  const subscribe = locale === null ? undefined : locale.subscribe
  const offLocale = typeof subscribe === 'function'
    ? safe(() => subscribe.call(locale, () => { publishIfMoved(seam, t) }), null)
    : null
  // The first reading is taken NOW rather than on the first event: the panel is read by a page with
  // zero panel operations, so the row must not wait for one.
  void refresh(seam, t)
  return () => {
    const unsubscribe = offLocale
    safe(() => {
      if (unsubscribe !== null && typeof unsubscribe === 'function') (unsubscribe as () => unknown)()
    }, undefined)
    offEvents()
    release(disposer)
  }
}

/**
 * Client plugin body: register this package's words, then declare its one status row.
 *
 * Never throws: a client half that fails writes the failure into this package's own marker and
 * leaves the shell it runs in alone. The row is declared through the composition's own effect API
 * when there is one, and mounted directly when there is not (the two registration shapes every other
 * half in this tree uses).
 *
 * @param raw - the client context this half is applied to.
 */
export function apply(raw: unknown): void {
  const ctx = (raw !== null && typeof raw === 'object' ? raw : {}) as ClientSurface
  try {
    mark({ id: PANEL_ITEM_ID, kind: PANEL_ITEM_KIND, source: PANEL_ITEM_SOURCE, ns: NS, path: STATUS_PATH, reads: 0, notifies: 0 })
    const locale = localeService(ctx)
    const t = bindTranslate(locale)
    const dictionaries = locale === null
      ? 'locale-unavailable: this page offers no locale service, so this package dictionaries were not registered; its words come from the same zh dictionary'
      : safe(() => {
        locale.register(NS, { zh, en })
        return 'registered'
      }, 'locale-register-refused: the locale service refused this package dictionaries; its words come from the same zh dictionary')
    mark({ dictionaries })
    const seam = serviceOf(ctx, LINK_PANEL_SERVICE, 'declare')
    if (typeof ctx.effect === 'function') {
      let ran = false
      try {
        ctx.effect(() => {
          ran = true
          const dispose = mount(ctx, t, locale, seam)
          return dispose === null ? undefined : dispose
        }, 'dsh-link-collab: bus status row')
        return
      } catch (error) {
        // An effect API that threw AFTER running the body has already mounted the row: mounting a
        // second time would declare the same id twice, which the seam refuses for every claimant.
        if (ran) return
        mark({ effect: 'ctx-effect-refused: ' + messageOf(error) })
      }
    }
    mount(ctx, t, locale, seam)
  } catch (error) {
    mark({ mounted: true, failed: messageOf(error) })
  }
}
