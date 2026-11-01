/**
 * The panel tab's registration, and the read-only marker a live page reads.
 *
 * The pane reaches the right rail through the public path only — the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat, the chip text into
 * `sidebar.right.pane.tab.title`, all under this implementation's `id`. The `kind` is `pane`: the one
 * kind of dsh-link-panel's closed set whose sink is the right rail. A page type claims no address, so
 * the type carries no `patterns` and reaches a person through its guide entry.
 *
 * Two things about the copy. The chip text and the guide entry are THUNKS over the dictionary, read
 * again on every use, so a language change needs no re-registration (the registry's own rule for
 * `title`/`guide[].title`/`guide[].description`). And the guide entry is where this package's glyph
 * goes: a tab type carries no `icon` field at all — the registry's only icon seat is the guide
 * entry's, next to the title and the one-line description, and the guide draws its own cube when a
 * type offers none.
 *
 * Nothing here throws, and the marker says which of three things is true: mounted with the view, mounted
 * with the original text of a failure, or taken down again. A client half that fails must leave the
 * shell it runs in alone, so a failed registration is caught and written out with the error's own text,
 * and the marker is filled by the reads themselves — a live page reads it with no panel operation.
 */
import type { PanelActionResult } from './contributions.ts'
import { NS, type Translate } from './locales.ts'
import { errorText, markerFrom, PANEL_TAB_ID, PANEL_TAB_KIND, type PanelMarkerDisposed, type PanelMarkerFailed, type PanelMarkerLive, type PanelViewModel, type SubmitOutcome } from './view.ts'

/** The read-only global marker the live gate reads. */
export const MARKER_KEY = '__dshLinkPanel'

/**
 * One glyph from the first-party icon set: a square drawn in `currentColor`, sized by whoever draws it.
 * Declared structurally rather than imported, so this module stays free of external specifiers (the
 * self-check imports it as source) and the icon itself arrives through the registration face.
 */
export type PanelGuideIcon = (props: { readonly size?: number; readonly className?: string }) => unknown

/** The definition this package registers, held to the frozen spelling by the self-check. */
export interface PanelGuideEntry {
  readonly id: string
  readonly order: number
  /** The capsule's title in the current language, read at use. */
  readonly title: () => string
  /** One line under the title in the current language, read at use. */
  readonly description?: () => string
  /** The glyph drawn before the title; the guide's own cube stands in when a type offers none. */
  readonly icon?: PanelGuideIcon
}

/** The type's static face: what it is, what it claims, and how it reaches a person. */
export interface PanelTabDefinition {
  readonly id: string
  readonly kind: string
  readonly priority: 'extension'
  readonly title: (address: string) => string
  readonly guide: readonly PanelGuideEntry[]
}

/** The services this half requires, as the half addresses them. */
export interface PanelRegistrationHost {
  effect(callback: () => unknown, label?: string): unknown
  sidebarRightTabs: { register(definition: PanelTabDefinition): unknown }
  slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
}

/** What the client half hands in: the two components, the reads, the glyph, and the marker target. */
export interface PanelRegistrationFace {
  readonly body: (props: never) => unknown
  readonly title: (props: never) => unknown
  /** Read both routes once and publish the marker; may reject, and a rejection is caught here. */
  readonly load: () => Promise<PanelViewModel>
  /** The view as it stands, used for the marker written at registration time. */
  readonly initial: () => PanelViewModel
  /** Write one note through the narrow route. */
  readonly add: (text: unknown) => Promise<SubmitOutcome>
  /** Press one drawn action through the seam: one call, and the provider's own text when it threw. */
  readonly press: (id: string) => PanelActionResult
  /** The guide capsule's glyph, from the first-party icon set. */
  readonly icon: PanelGuideIcon
  /** Stage-one copy (the chip text and the guide entry), bound to this package's namespace. */
  readonly t: Translate
  /** Hear about a view republished while this pane is mounted; absent in a hand-driven mount. */
  readonly watch?: (listener: (view: PanelViewModel) => void) => () => void
  /** Marker target; a test passes its own object instead of the page's global. */
  readonly globals?: Record<string, unknown>
}

/**
 * The definition this package registers. Exported so a gate can hold the frozen spelling to the built
 * artifact rather than to prose.
 * @param t - the namespace-bound translate the chip text and the guide entry are read through.
 * @param icon - the guide capsule's glyph, from the first-party icon set.
 * @returns the definition, with no address claim and one guide entry.
 */
export function panelDefinition(t: Translate, icon: PanelGuideIcon): PanelTabDefinition {
  return {
    id: PANEL_TAB_ID,
    kind: PANEL_TAB_KIND,
    priority: 'extension',
    title: () => t('tab.title'),
    guide: [{
      id: 'panel',
      order: 40,
      title: () => t('tab.title'),
      description: () => t('guide.description'),
      icon,
    }],
  }
}

/** Write the mounted marker for a view: the live shape while every read holds, the failure text otherwise. */
export function markView(globals: Record<string, unknown>, view: PanelViewModel): void {
  globals[MARKER_KEY] = markerFrom(view)
}

/** Write the marker for a half that is mounted but has just failed, naming the error's own text. */
export function markFailed(globals: Record<string, unknown>, error: unknown): void {
  const marker: PanelMarkerFailed = { mounted: true, failed: errorText(error) }
  globals[MARKER_KEY] = marker
}

/** Write the marker for a half that was taken down again. */
export function markDisposed(globals: Record<string, unknown>): void {
  const marker: PanelMarkerDisposed = { mounted: false, disposed: true }
  globals[MARKER_KEY] = marker
}

/** Read the marker back, whatever it holds. */
export function markerOf(globals: Record<string, unknown>): PanelMarkerLive | PanelMarkerFailed | PanelMarkerDisposed | unknown {
  return globals[MARKER_KEY]
}

/** Run one cleanup, whatever shape the framework handed back. */
function release(disposer: unknown): void {
  if (typeof disposer === 'function') { (disposer as () => void)(); return }
  if (disposer !== null && typeof disposer === 'object') {
    const dispose = Reflect.get(disposer, Symbol.dispose)
    if (typeof dispose === 'function') { (dispose as () => void).call(disposer) }
  }
}

/**
 * Register the tab type, its body and its title, and start the reads the marker reports; never throws.
 * Both seats declare this package's `locale:` namespace, which is what puts the `t` standard seat on
 * the two components' props.
 * @param ctx - the client root context.
 * @param face - the components, the reads, the glyph, and the marker target.
 * @returns a disposer that takes the three registrations down and records that it did.
 */
export function registerPanelTab(ctx: PanelRegistrationHost, face: PanelRegistrationFace): () => void {
  const globals = face.globals ?? (globalThis as unknown as Record<string, unknown>)
  const disposers: unknown[] = []
  try {
    disposers.push(ctx.effect(() => ctx.sidebarRightTabs.register(panelDefinition(face.t, face.icon)), 'dsh-link-panel: pane tab type'))
    disposers.push(ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab',
        key: PANEL_TAB_ID,
        locale: NS,
        inject: () => ({ panelLoad: face.load, panelAdd: face.add, panelPress: face.press, panelView: face.initial(), panelWatch: face.watch }),
      },
      face.body,
    )), 'dsh-link-panel: pane tab body'))
    disposers.push(ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab.title', key: PANEL_TAB_ID, locale: NS },
      face.title,
    )), 'dsh-link-panel: pane tab title'))
  } catch (error) {
    markFailed(globals, error)
    return () => {}
  }
  // The mounted marker goes out before the first answer lands, so "mounted" is readable from this
  // instant; the reads replace it as they settle (load.ts), and a rejecting read keeps its own text.
  markView(globals, face.initial())
  void face.load().then(() => {}, (error: unknown) => { markFailed(globals, error) })
  return () => {
    for (const disposer of disposers) release(disposer)
    markDisposed(globals)
  }
}
