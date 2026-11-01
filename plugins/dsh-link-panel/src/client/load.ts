/**
 * The panel tab's reads, wired to a page and to the marker.
 *
 * Two things matter here and nowhere else:
 *
 *   1  Nothing rejects. `fetch` rejecting, a body that is not JSON, a route that is not there: each is
 *      a value this module hands back as a named failure, because the marker and the pane both have to
 *      be able to say what happened rather than fall over.
 *   2  The reads happen when the client half mounts, not when a person opens the tab. The marker is
 *      read by a live page with zero panel operations, so the fold must not wait for a click.
 *
 * The two requests are issued together and folded as they land, in whatever order that is: the fold is
 * order-independent (view.ts), so the view does not depend on which route answered first.
 *
 * The third source is the contribution seam (contributions.ts). Its rows are folded in BESIDE the
 * route's, never into them: `items` stays the route's own visible rows verbatim, so a live reader can
 * still hold the marker to the route byte for byte, and a contribution that arrives while the pane is
 * open republishes the marker and tells the pane in the same step it lands.
 */
import { errorText, emptyView, foldArrivals, noteRequest, readNotesState, readPanelState, readSubmit, withContributions, NOTES_STATE_PATH, PANEL_STATE_PATH, PANEL_TAB_ID, type Arrival, type PanelViewModel, type RouteAnswer, type SubmitOutcome } from './view.ts'
import { markView } from './register.ts'
import type { LinkPanelService, PanelActionResult } from './contributions.ts'

/** One request as this half makes it: a path, and at most a method and a JSON body. */
export type Ask = (path: string, init?: { readonly method?: string; readonly body?: string }) => Promise<RouteAnswer>

/** What a request threw, or why it could not be sent at all, as an answer this half can fold. */
function noAnswer(reason: string): RouteAnswer {
  return { status: null, body: null, text: '', transport: reason }
}

/**
 * The answer of a pane mounted with no seam to press through: a named sentence, never a throw.
 *
 * It lives in this module on purpose. The pane's own words are copy (read from the dictionary and
 * scanned as copy by the self-check); a sentence about a mount that handed in no seat is a diagnostic,
 * and this module is where this half keeps its diagnostics (the route's own text travels through here
 * too, as data).
 * @param id - the id of the row that was pressed.
 * @returns the failure the row shows.
 */
export function noPressSeat(id: string): PanelActionResult {
  return { ok: false, detail: 'this pane was mounted without a seam to press ' + JSON.stringify(id) + ' through' }
}

/**
 * Bind the reads to a page's `fetch`.
 *
 * The page's own `fetch` is used, so the requests are same-origin by construction and carry no
 * credential of their own. A page without one is reported rather than assumed.
 * @param fetchLike - the page's fetch, or anything else.
 * @param base - a prefix for the paths (empty in the page; a test drives a real socket with it).
 * @returns the request this half makes.
 */
export function askWithFetch(fetchLike: unknown, base: string = ''): Ask {
  return async (path, init) => {
    if (typeof fetchLike !== 'function') {
      return noAnswer('this page has no fetch to send ' + path + ' with')
    }
    try {
      const send = fetchLike as (url: string, options?: unknown) => Promise<unknown>
      const answer = await send(base + path, init?.body === undefined
        ? { method: 'GET' }
        : { method: init.method ?? 'POST', body: init.body, headers: { 'content-type': 'application/json' } })
      const holder = answer !== null && typeof answer === 'object' ? answer as Record<string, unknown> : {}
      const read = holder['text']
      const text = typeof read === 'function' ? String(await (read as () => Promise<unknown>).call(answer)) : ''
      let body: unknown = null
      try {
        body = JSON.parse(text)
      } catch {
        // The only thrower is JSON.parse, and its verdict IS the reading: this body is not JSON.
        body = null
      }
      const status = holder['status']
      return { status: typeof status === 'number' ? status : null, body, text, transport: null }
    } catch (error) {
      return noAnswer('the request threw: ' + errorText(error))
    }
  }
}

/** The reads, the write, the contribution seam, and the view they leave behind. */
export interface PanelLoader {
  /** Read both routes once, fold them with the seam's rows, publish the marker, and answer the view. Never rejects. */
  load(): Promise<PanelViewModel>
  /** The last folded view (an empty, pending view before the first fold completes). */
  current(): PanelViewModel
  /** Write one note through the narrow route. Never rejects: a refusal is a value. */
  add(text: unknown): Promise<SubmitOutcome>
  /**
   * Press one drawn action through the seam this loader was given: one call, and the seam's own answer
   * (the provider's original text when its `invoke` threw). Never rejects.
   */
  press(id: string): PanelActionResult
  /** Hear about every view this loader publishes (a read landing, a contribution arriving or leaving). */
  watch(listener: (view: PanelViewModel) => void): () => void
  /** Let the seam go; idempotent, and safe on a loader that was never given one. */
  dispose(): void
}

/**
 * Build the loader over one way of asking.
 * @param options - how to ask, the marker target, and this tab's id.
 * @returns the loader.
 */
export function createLoader(options: {
  readonly ask: Ask
  readonly globals: Record<string, unknown>
  readonly tabId?: string
  /** The contribution seam, when the half that mounted this loader provides one. */
  readonly panel?: LinkPanelService | null
}): PanelLoader {
  const tabId = options.tabId ?? PANEL_TAB_ID
  const panel = options.panel ?? null
  const watchers = new Set<(view: PanelViewModel) => void>()
  let view = emptyView(tabId)
  let release: (() => void) | null = null

  /**
   * Publish one view: it becomes the current one, the marker is written in the same step, and the
   * watchers hear about it. Whoever rebuilds the view republishes it here rather than leaving a stale
   * marker behind (the shell's own rule for a published value).
   * @param next - the view to publish.
   */
  function publish(next: PanelViewModel): void {
    view = next
    markView(options.globals, view)
    for (const watcher of [...watchers]) {
      try {
        watcher(view)
      } catch (error) {
        // A watcher's own failure is the pane's to report, not this loader's: publishing goes on.
        console.error('dsh-link-panel: a view watcher threw: ' + errorText(error))
      }
    }
  }

  /** Fold the seam's current rows into the current view and publish, in one step. */
  function adoptContributions(): void {
    if (panel === null) return
    publish(withContributions(view, panel.entries(), panel.rejected()))
  }

  // A declaration that lands while the pane is mounted must reach the pane and the marker without
  // waiting for the next read, so the seam is watched from the moment the loader exists.
  if (panel !== null) release = panel.subscribe(() => { adoptContributions() })

  /** Ask one route and hand back the arrival it produced. A rejecting `ask` is an answer too. */
  async function askOne(source: 'panel' | 'notes', path: string): Promise<Arrival> {
    let answer: RouteAnswer
    try {
      answer = await options.ask(path)
    } catch (error) {
      answer = noAnswer('the request threw: ' + errorText(error))
    }
    return source === 'panel' ? { source, read: readPanelState(answer) } : { source, read: readNotesState(answer) }
  }

  return {
    async load(): Promise<PanelViewModel> {
      const arrivals = await Promise.all([askOne('panel', PANEL_STATE_PATH), askOne('notes', NOTES_STATE_PATH)])
      publish(withContributions(foldArrivals(arrivals, tabId), panel?.entries() ?? [], panel?.rejected() ?? []))
      return view
    },
    current(): PanelViewModel {
      return view
    },
    watch(listener: (view: PanelViewModel) => void): () => void {
      watchers.add(listener)
      return () => {
        watchers.delete(listener)
      }
    },
    dispose(): void {
      if (release !== null) release()
      release = null
      watchers.clear()
    },
    async add(text: unknown): Promise<SubmitOutcome> {
      const request = noteRequest(text)
      let answer: RouteAnswer
      try {
        answer = await options.ask(request.path, { method: 'POST', body: request.body })
      } catch (error) {
        answer = noAnswer('the request threw: ' + errorText(error))
      }
      return readSubmit(answer)
    },
    press(id: string): PanelActionResult {
      // The seam owns the one catch on this path: it is the one place a provider's own function runs,
      // and what that function threw travels back as its own text. A second catch here would be a
      // second opinion about a failure that already has its own words - and a loader with no seam at
      // all (a hand-driven mount) answers with a named sentence rather than throwing at a person.
      if (panel === null) return noPressSeat(id)
      return panel.press(id)
    },
  }
}
