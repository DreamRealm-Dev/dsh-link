/**
 * Registration, and the two readings a live page can take of it.
 *
 * The tab type, its body and its chip title are three registrations that either all hold or report why
 * they do not. Nothing here throws: a client half that fails must leave the shell it runs in alone, so
 * a failed registration is caught and written into the marker gate 122 reads, with the error's own
 * text — the marker is how "the file was served" is told apart from "it ran".
 *
 * The body registers under the package's own locale namespace (`locales.ts`), which is what puts the
 * framework's `t` seat on its props: the declaration and the dictionary are two halves of one reading.
 */
import { MARKDOWN_KIND, MARKDOWN_PATTERNS, MARKDOWN_TAB_ID, isMarkdownAddress } from './claim.ts'
import { NS } from './locales.ts'

/** The read-only global marker the live gate reads. */
export const MARKER_KEY = '__dshLinkMarkdown'

/** The marker while this type is registered and routing. */
export interface MarkdownMarkerLive {
  readonly kind: string
  readonly patterns: readonly string[]
  readonly registered: true
}

/** The marker when registration failed, or when the registration was disposed. */
export interface MarkdownMarkerDown {
  readonly registered: false
  readonly failed?: string
  readonly disposed?: true
}

/** The tab-type registration shape this module proves before it claims anything. */
export interface MarkdownTabDefinition {
  readonly id: string
  readonly kind: string
  readonly priority: 'extension'
  readonly patterns: readonly string[]
  readonly canOpen: (address: string) => boolean
  readonly title: (address: string) => string
}

/** The services the client half needs, as the client half addresses them. */
export interface MarkdownRegistrationHost {
  effect(callback: () => unknown, label?: string): unknown
  sidebarRightTabs: { register(definition: MarkdownTabDefinition): unknown }
  slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
}

/** What the client half hands in: three registrations' worth of content, plus the read. */
export interface MarkdownRegistrationFace {
  readonly body: (props: never) => unknown
  readonly title: (props: never) => unknown
  readonly titleText: (address: string) => string
  readonly readPage: unknown
  /** Marker target; a test passes its own object instead of the page's global. */
  readonly globals?: Record<string, unknown>
}

/** One message for anything thrown. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Write the live marker. */
export function markRegistered(globals: Record<string, unknown>, patterns: readonly string[] = MARKDOWN_PATTERNS): void {
  const marker: MarkdownMarkerLive = { kind: MARKDOWN_KIND, patterns: [...patterns], registered: true }
  globals[MARKER_KEY] = marker
}

/** Write the failure marker, naming the error's own text. */
export function markFailed(globals: Record<string, unknown>, error: unknown): void {
  globals[MARKER_KEY] = { registered: false, failed: errorText(error) }
}

/** Write the marker for a registration that was taken down again. */
export function markDisposed(globals: Record<string, unknown>): void {
  globals[MARKER_KEY] = { registered: false, disposed: true }
}

/** Read the marker back, whatever it holds. */
export function markerOf(globals: Record<string, unknown>): unknown {
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
 * The definition this package registers. Exported so a gate can hold the frozen spelling — id, kind,
 * extension band, patterns, and the veto — to the built artifact rather than to prose.
 * @param titleText - the chip's initial text.
 * @returns the definition, with the claim decision already applied.
 */
export function markdownDefinition(titleText: (address: string) => string): MarkdownTabDefinition {
  return {
    id: MARKDOWN_TAB_ID,
    kind: MARKDOWN_KIND,
    priority: 'extension',
    patterns: [...MARKDOWN_PATTERNS],
    canOpen: isMarkdownAddress,
    title: titleText,
  }
}

/**
 * Register the tab type, its body and its title; never throws.
 * @param ctx - the client root context.
 * @param face - the body, the title, the chip text, the paged read, and the marker target.
 * @returns a disposer that takes the three registrations down and records that it did.
 */
export function registerMarkdown(ctx: MarkdownRegistrationHost, face: MarkdownRegistrationFace): () => void {
  const globals = face.globals ?? (globalThis as unknown as Record<string, unknown>)
  const disposers: unknown[] = []
  try {
    disposers.push(ctx.effect(() => ctx.sidebarRightTabs.register(markdownDefinition(face.titleText)), 'dsh-link-markdown: markdown tab type'))
    disposers.push(ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
      // `locale` is the namespace the body's `t` seat reads; the title seat has no copy of its
      // own (its text is the file name), so it declares none.
      { name: 'sidebar.right.pane.tab', key: MARKDOWN_TAB_ID, locale: NS, inject: () => ({ readPage: face.readPage }) },
      face.body,
    )), 'dsh-link-markdown: markdown tab body'))
    disposers.push(ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab.title', key: MARKDOWN_TAB_ID },
      face.title,
    )), 'dsh-link-markdown: markdown tab title'))
  } catch (error) {
    markFailed(globals, error)
    return () => {}
  }
  markRegistered(globals)
  return () => {
    for (const disposer of disposers) release(disposer)
    markDisposed(globals)
  }
}
