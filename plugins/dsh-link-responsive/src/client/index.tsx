/**
 * The client half: watch the viewport, decide, write — and decide nothing on its own.
 *
 * Every decision here comes from planLayout and every write from applyLayout. This file owns only the
 * two things a document-side caller must own: when to look (a resize, debounced, because a drag
 * produces a resize per frame) and what it means to look now (the current innerWidth, planned against
 * the shipped band table, applied over the plan that is already in force).
 *
 * The band table is imported as data. It is not re-declared here, and it is not re-read from the
 * decisions: bands.json is the authority on what the bands are.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import bandsData from '../../bands.json'
import { loadBands, planLayout, type Bands, type LayoutPlan } from './layout-plan.ts'
import { applyLayout } from './apply-layout.ts'

/** How long the viewport has to hold still before the layout is re-decided. */
export const LAYOUT_SETTLE_MS = 120

/** The band table this plugin ships, or null when the shipped table is not readable. */
export function shippedBands(raw: unknown = bandsData): Bands | null {
  const loaded = loadBands(raw)
  return loaded.ok ? loaded.bands : null
}

/** One running applier, with the state a resize handler has to keep between events. */
export interface LayoutWatcher {
  /** Look at one width right now, deciding and writing. Returns the plan in force. */
  look: (width: number) => LayoutPlan | null
  /** Stop watching. */
  dispose: () => void
}

/**
 * Watch the viewport width and keep the document root's layout decisions current.
 *
 * The debounce is not an optimisation, it is the difference between one plan per drag and one per
 * frame; the apply itself is idempotent either way, which is why a burst costs writes, not damage.
 * @param view - the document and its window, as the client half finds them.
 * @returns the watcher, so a caller can look by hand or stop.
 */
export function watchLayout(view: { document: Document, window: Window }): LayoutWatcher {
  const bands = shippedBands()
  const root = view.document.documentElement
  let current: LayoutPlan | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const look = (width: number): LayoutPlan | null => {
    if (bands === null) return null
    const planned = planLayout(width, bands)
    if (!planned.ok || planned.plan === null) return current
    const result = applyLayout({ setAttribute: (name, value) => root.setAttribute(name, value), style: root.style }, planned.plan, current)
    void result
    current = planned.plan
    return current
  }
  const onResize = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; look(view.window.innerWidth) }, LAYOUT_SETTLE_MS)
  }
  look(view.window.innerWidth)
  view.window.addEventListener('resize', onResize)
  return {
    look,
    dispose: () => {
      if (timer !== null) clearTimeout(timer)
      view.window.removeEventListener('resize', onResize)
    },
  }
}

/**
 * Install the watcher for the lifetime of this client plugin.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const watcher = watchLayout({ document, window })
  ctx.effect?.(() => () => watcher.dispose())
}
