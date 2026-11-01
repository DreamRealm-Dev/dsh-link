/**
 * The browser half: the right Sidebar's `pane` tab, and the notes box inside it.
 *
 * What it draws, and where each piece comes from:
 *
 *   the registry's visible items   GET /api/dsh-link-panel/state -> declared.visible, verbatim
 *   the items it refused, by name  the same answer -> declared.rejected, each with its own code
 *   the contributions              the 'linkPanel' seam this half provides: what other LINK features
 *                                  declared, each row drawn with its own title, kind, source and body;
 *                                  a row of kind 'action' is drawn as a BUTTON, and one click presses
 *                                  that item's own `invoke` exactly once - what it throws is caught and
 *                                  drawn ON THAT ROW as the provider's own text, never re-named
 *   the note ledger                GET /api/dsh-link-notes/state -> notes, with the route's thresholds
 *   one new note                   POST /api/dsh-link-notes/add, one note, text sent verbatim
 *
 * Read-only with respect to the registry: nothing here writes an item back, and the only write in the
 * whole tab is the one note the person types. The pane applies no rule of its own to that note — not a
 * length, not an emptiness — because those refusals are the route's, and a client-side copy of them
 * would be a second rule that can disagree with the first. What the route refuses is shown with the
 * route's own code and message.
 *
 * Every word this half says about itself is a dictionary key (locales.ts) read through the locale
 * seat: the tab chip, the guide entry, the pane chrome, the two parameterised lines. Everything the
 * ROUTES carry — an item's title, a note's text, a refusal's detail, a code, a path — is data drawn
 * verbatim in its own slot, and is never translated. The line a failure is shown on is copy; the
 * detail inside it is the original text.
 *
 * Rendering is this package's own and it is a real panel: one stylesheet (./panel.css) whose every rule is
 * scoped under `.dsh-link-panel` and which is installed and removed with this plugin's own fiber, a card
 * per section, a lamp beside the two read states, and the registry's raw rows folded into a closed
 * drawer. Every data-* attribute the three render gates parse out of the built artifact is kept, with the
 * value it carried before. The one glyph is the first-party icon set (see PANEL_GUIDE_ICON below).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// The first-party icon set: a baseline module the shell preloads (compat/host-modules.json
// clientBaseline, seeded from the kernel's packages/client/web/src/platform.ts), so this bundle
// leaves the import external and the live page resolves it from the module table.
import { IconFlatListOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createLinkPanelService, LINK_PANEL_SERVICE, type PanelActionResult } from './contributions.ts'
import { askWithFetch, createLoader, noPressSeat } from './load.ts'
import { DeviceNet } from './device-net-view.tsx'
import { en, NS, zh, type Translate } from './locales.ts'
import { registerPanelTab } from './register.ts'
import panelCss from './panel.css'
import { CLIENT_FAILURES, emptyView, errorText, type PanelViewModel, type ReadState, type SubmitOutcome } from './view.ts'

/**
 * Services this half requires: the slot registry, the tab-type registry, and the dictionaries.
 * Injection is a wait, not an error: a service that never arrives leaves this half silent rather than
 * half-registered. `locale` is one the shell always provides — the web-app bundle composes
 * @deepseek-ai/dsh-client-locale, and a registration that declares `locale:` without the installed
 * locale face is an assembly failure rather than a silent key on screen.
 */
export const inject = ['slots', 'sidebarRightTabs', 'locale']

/**
 * The glyph on the pane's guide capsule: the first-party flat-list icon, chosen over the other
 * near-matches because a guide capsule must not look like another one. `IconPanelLeftOutline*` is the
 * shell's own sidebar chrome, `IconDataOutline*` names the model selector, `IconChecklistOutline*`
 * names todos and job rows, and `IconListPenOutline*` is the artwork behind `IconPlanOutline*`, so it
 * would draw the same glyph as the Plan capsule. Nothing in the set is drawn 36x36 or with a fixed
 * fill; this one is 16x16, `currentColor`, one-pixel stroke, and no other feature claims it.
 */
const PANEL_GUIDE_ICON = IconFlatListOutlineRegular

/**
 * The three read states as keys of their own. A table rather than a built key name, so every key this
 * half uses is a literal in this file and a scanner can match them against the dictionary.
 */
const STATE_KEYS: Readonly<Record<ReadState, 'state.pending' | 'state.ok' | 'state.failed'>> = {
  pending: 'state.pending',
  ok: 'state.ok',
  failed: 'state.failed',
}

/** One string field of a row, or the empty string: the pane never draws `undefined`. */
function shown(row: unknown, key: string): string {
  if (row === null || typeof row !== 'object') return ''
  const value = (row as Record<string, unknown>)[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** The sink a kind is shown in, from the registry's own map; empty when the route carried neither. */
function sinkOf(view: PanelViewModel, kind: string): string {
  const map = view.registry === null ? null : view.registry.kindSinks
  if (map === null || typeof map !== 'object') return ''
  const sink = (map as Record<string, unknown>)[kind]
  return typeof sink === 'string' ? sink : ''
}

/**
 * The route's thresholds, as the route spelled them; "not read" when the ledger has not answered.
 * The two numbers are the route's data and travel as parameters: this half shows a threshold, and
 * never invents one of its own.
 */
function limitsLine(limits: unknown, t: Translate): string {
  if (limits === null || typeof limits !== 'object') return t('notes.limitsUnread')
  const spelled = limits as Record<string, unknown>
  const notes = spelled['maxNotes']
  const chars = spelled['maxChars']
  if (typeof notes !== 'number' || typeof chars !== 'number') return t('notes.limitsUnread')
  return t('notes.limits', { maxNotes: notes, maxChars: chars })
}

/**
 * One refused declaration, drawn on the same line the route's refusals use: the route's own call site is
 * a frozen citation (docs/dev/notes-ui.md, panel-client-no-code), so the shared line format lives here
 * once and that site keeps the spelling the page names.
 * @param row - the refusal, with the seam's own code or none.
 * @param t - this package's namespace-bound translate.
 * @returns the one line the pane draws for it.
 */
function refusalLine(row: { readonly code: string | null; readonly detail: string }, t: Translate): string {
  return t('copy.format.line', { code: row.code ?? t('refusal.noCode'), detail: row.detail })
}

/**
 * The line one action row shows after a press that did not hold, or null when there is nothing to say.
 *
 * It is the SAME line a refusal is drawn on, read from the same dictionary keys: the provider's own
 * text is the detail, and the panel's no-code label stands where a code would be, because a press has
 * no code of this half's own and the three refusal names the registry owns must not be stretched over
 * it. Nothing is translated here: what a feature threw is data.
 * @param settled - what the press answered, or undefined when that row has not been pressed yet.
 * @param t - this package's namespace-bound translate.
 * @param id - the id of the row, so the line names the item it belongs to.
 * @returns the line, or null.
 */
function actionErrorLine(settled: PanelActionResult | undefined, t: Translate, id: string): ReactNode {
  if (settled === undefined || settled.ok === true) return null
  return (
    <span className="dsh-link-panel-contributed-error" data-panel-contributed-error={id}>
      {refusalLine({ code: null, detail: settled.detail }, t)}
    </span>
  )
}

/**
 * The props the seat hands this body: the framework shares plus this type's own read and write.
 * `t` is the locale seat the framework binds for a registration that declares `locale:`; a mount
 * without it (hand-driven props) spells the key out rather than throwing, which is what the kernel's
 * own lookup does for a key no dictionary answers.
 */
interface PanelBodyProps {
  readonly t?: Translate
  readonly useTabInfo?: () => unknown
  readonly panelLoad?: () => Promise<PanelViewModel>
  readonly panelAdd?: (text: unknown) => Promise<SubmitOutcome>
  readonly panelView?: PanelViewModel
  /** The seam's republished views, when the half that mounted this pane provides one. */
  readonly panelWatch?: (listener: (view: PanelViewModel) => void) => () => void
  /**
   * Press one drawn action through the seam the half holds. Absent on a mount that handed in no seat,
   * and then the row answers with the loader's own named sentence rather than throwing (load.ts).
   */
  readonly panelPress?: (id: string) => PanelActionResult
}

/** This package's name, used to tag the stylesheet it owns in the document head. */
const PLUGIN_ID = 'dsh-link-panel'

/** The element name of the sheet this half mounts, named once so it is never spelled at a call site. */
const STYLE_TAG = 'style'

/**
 * Mount this pane's stylesheet for exactly this plugin's lifetime.
 *
 * The sheet is a `<style>` element this package owns, installed through `ctx.effect` so its disposer
 * removes it when the fiber goes away. It is deliberately not installed through a service: no `styles`
 * service exists in the captured client surface, and a cast to reach one would ship a pane whose CSS
 * never loaded while every offline reading stayed green. `dsh-link-toolbar`, `dsh-link-brand` and
 * `dsh-theme-settings` install their own sheets the same way.
 * @param ctx - owning client context.
 */
function installStyles(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement(STYLE_TAG)
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/panel.css`
    tag.textContent = panelCss
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-link-panel: pane stylesheet')
}

/**
 * The state the pane's own lamp shows: both reads held, one of them failed, or neither has answered yet.
 * @param reads - the two read states this view carries.
 * @returns the value the root's data-panel-health attribute carries.
 */
function readHealth(reads: PanelViewModel['reads']): 'ok' | 'pending' | 'failed' {
  if (reads.panel === 'ok' && reads.notes === 'ok') return 'ok'
  if (reads.panel === 'failed' || reads.notes === 'failed') return 'failed'
  return 'pending'
}

/** The seat a hand-driven mount gets: it carries no tab, so nothing is known to be on screen. */
const NO_TAB_INFO = (): unknown => null

/**
 * Whether the framework's own tab-info hook says this tab is the one on screen.
 *
 * A rail body stays mounted while another tab is in front of it, so "mounted" is not "just opened"; this
 * is the fact that distinguishes the two. The seat is called unconditionally, and `NO_TAB_INFO` stands in
 * for a mount that was handed no seat, so a hand-driven mount keeps a fixed hook order.
 * @param read - the seat's tab-info hook, when it has one.
 * @returns true only when the tab is visible.
 */
function tabIsVisible(read: (() => unknown) | undefined): boolean {
  const info = (read ?? NO_TAB_INFO)()
  if (info === null || typeof info !== 'object') return false
  const tab = Reflect.get(info, 'tab')
  return tab !== null && typeof tab === 'object' && Reflect.get(tab, 'visible') === true
}

/** One line of the ledger, as the route carries it. The text, the author and the tags are data. */
function NoteLine({ row }: { readonly row: { readonly id: string | null; readonly text: string; readonly tags: readonly string[] | null; readonly author: string | null; readonly state: string | null } }): ReactNode {
  return (
    <li className="dsh-link-panel-note" data-note-row={row.id ?? ''} data-note-state={row.state ?? ''}>
      <span className="dsh-link-panel-note-text" data-note-text="">{row.text}</span>
      {row.author === null ? null : <span className="dsh-link-panel-note-author" data-note-author=""> — {row.author}</span>}
      {row.tags === null || row.tags.length === 0 ? null : <span className="dsh-link-panel-note-tags" data-note-tags=""> [{row.tags.join(', ')}]</span>}
    </li>
  )
}

/**
 * The tab body: read both routes, draw them, and take one note.
 *
 * Every handler is total: a read or a write that throws becomes a named failure under the input box
 * rather than an unhandled rejection inside the shell's render tree.
 * @param props - the seat's props for this body.
 * @returns the body.
 */
function PanelBody(props: PanelBodyProps): ReactNode {
  const t: Translate = props.t ?? ((key) => key)
  // ONE read, built on demand. The seat's own loader when there is one; a hand-driven mount without a
  // seat answers the view it was handed, which is what keeps the pane drawable in a spec. The read
  // effects below depend on the two PROPS, not on this closure, so a render the pane caused itself
  // (a keystroke in the box, a pressed row) never re-reads both routes.
  const readNow = async (): Promise<PanelViewModel> => (props.panelLoad === undefined ? props.panelView ?? emptyView() : props.panelLoad())
  const add = props.panelAdd ?? (async () => ({ ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: 'this pane was mounted without a way to write', from: 'client' as const }))
  const press = props.panelPress ?? noPressSeat
  const [view, setView] = useState<PanelViewModel>(() => props.panelView ?? emptyView())
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null)
  // What each pressed action row answered, by row id: a press that held leaves nothing behind, and a
  // press that did not keeps the provider's own text on ITS OWN row, never on the rows around it.
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, PanelActionResult>>>({})

  // The threshold line closes over this seat's `t`, so the seat it is drawn on stays the same node
  // the contract page cites (panel-client-limits-seat) whatever the language is.
  const limitsText = (limits: unknown): string => limitsLine(limits, t)

  useEffect(() => {
    let live = true
    void readNow().then((next) => { if (live) setView(next) }, () => {})
    return () => { live = false }
  }, [props.panelLoad, props.panelView])

  // OPENING THIS TAB IS A REASON TO READ AGAIN. Measured in the live shell: a docked rail UNMOUNTS this
  // body when another tab is selected and mounts a new one when it is chosen again, so the read above
  // already fires once per open there - one GET of each route per open, and none while another tab is in
  // front. A body that STAYS mounted (a floating pane) would keep the read it took whenever it mounted,
  // and that is what this effect covers: the framework's tab-info says when this tab is the one on
  // screen, and the state below is the previous answer, so becoming visible costs ONE read and becoming
  // hidden costs none.
  const visible = tabIsVisible(props.useTabInfo)
  const [wasVisible, setWasVisible] = useState(visible)
  useEffect(() => {
    if (wasVisible === visible) return undefined
    setWasVisible(visible)
    if (visible !== true) return undefined
    let live = true
    void readNow().then((next) => { if (live) setView(next) }, () => {})
    return () => { live = false }
  }, [visible, wasVisible, props.panelLoad, props.panelView])

  // A contribution that lands while this pane is open is drawn in the same step it lands: the half
  // that mounted the pane republishes the view (and the marker) and hands it here.
  const watch = props.panelWatch
  useEffect(() => {
    if (typeof watch !== 'function') return undefined
    return watch((next: PanelViewModel) => { setView(next) })
  }, [watch])

  const submit = (event: { preventDefault?: () => void }): void => {
    if (typeof event.preventDefault === 'function') event.preventDefault()
    setBusy(true)
    void (async () => {
      try {
        const settled = await add(draft)
        setOutcome(settled)
        // A refusal keeps the text in the box: the person fixes it and tries again, and the route's
        // own words say what was wrong. Only an accepted note clears the box.
        if (settled.ok === true) setDraft('')
        setView(await readNow())
      } catch (error) {
        setOutcome({ ok: false, code: CLIENT_FAILURES.UNREADABLE, detail: errorText(error), from: 'client' })
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="dsh-link-panel" data-panel-tab={view.tabId} data-panel-health={readHealth(view.reads)}>
      <div className="dsh-link-panel-head" data-panel-head="">
        <span className="dsh-link-panel-title">{t('tab.title')}</span>
        <span className="dsh-link-panel-mode" data-panel-readonly="">{t('panel.readonly')}</span>
      </div>
      <p className="dsh-link-panel-reads" data-panel-reads={'panel:' + view.reads.panel + ' notes:' + view.reads.notes}>
        {t('panel.reads', { panel: t(STATE_KEYS[view.reads.panel]), notes: t(STATE_KEYS[view.reads.notes]) })}
      </p>
      {view.failures.length === 0 ? null : view.failures.map((failure) => (
        <p className="dsh-link-panel-failure" key={failure.source + ':' + failure.code + ':' + failure.detail}
          data-panel-failure={failure.code} data-panel-failure-from={failure.from} data-panel-failure-slot={failure.source}>
          {t('failure.line', { slot: failure.source, code: failure.code, detail: failure.detail })}
        </p>
      ))}
      {/* R407: the device ring is the panel's first card: who is on the interconnect right now, with the network itself
          in the middle and this machine pinned at twelve o'clock. Only the local machine can be asserted by the panel
          today (/__shell/bridge reports {"phase":"stopped"}), so that is exactly what it draws. */}
      <DeviceNet devices={[{ id: 'local', label: '本机', kind: 'local', online: true }]} />
      <div className="dsh-link-panel-contributed" data-panel-contributed="">
        <div className="dsh-link-panel-card-head">
          <p className="dsh-link-panel-contributed-head" data-panel-contributed-head="">{t('contrib.title')}</p>
        </div>
        <ul className="dsh-link-panel-contributed-list" data-panel-contributed-list="">
          {view.contributed.length === 0
            ? <li className="dsh-link-panel-empty" data-panel-empty="contributed">{t('contrib.empty')}</li>
            : view.contributed.map((row) => (
              <li className="dsh-link-panel-contributed-row" key={row.id}
                data-panel-contributed-row={row.id} data-panel-contributed-kind={row.kind} data-panel-contributed-source={row.source}
                data-panel-contributed-has-invoke={String(row.hasInvoke)}>
                {row.kind === 'action'
                  ? <button className="dsh-link-panel-contributed-action" data-panel-contributed-title="" data-panel-contributed-action="" type="button"
                    onClick={() => { const settled = press(row.id); setOutcomes((held) => ({ ...held, [row.id]: settled })) }}>{row.title}</button>
                  : <span className="dsh-link-panel-contributed-title" data-panel-contributed-title="">{row.title}</span>}
                <span className="dsh-link-panel-contributed-meta" data-panel-contributed-meta="">
                  {t('item.meta', { kind: row.kind, sink: sinkOf(view, row.kind), order: row.order, source: row.source })}
                </span>
                <span className="dsh-link-panel-contributed-body" data-panel-contributed-body="">{row.body === '' ? t('contrib.noBody') : row.body}</span>
                {actionErrorLine(outcomes[row.id], t, row.id)}
              </li>
            ))}
        </ul>
        {view.contributedRefused.length === 0 ? null : (
          <ul className="dsh-link-panel-contributed-refused" data-panel-contributed-refused="">
            {view.contributedRefused.map((row, index) => (
              <li className="dsh-link-panel-refusal" key={(row.id ?? 'no-id') + ':' + String(index)} data-panel-refusal={row.code ?? 'no-code'}>
                {refusalLine(row, t)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* R277: the refusals live OUTSIDE the contribution card. Their empty marker used to sit inside it, and a
          section that carries a marker for ANOTHER section is a section whose emptiness cannot be read: the
          contribution-render gate, looking for the contribution section's own empty marker while a contribution
          was declared, found ["refused"] and was right to call that a contradiction. */}
      {view.refused.length === 0 && view.contributedRefused.length === 0
        ? <p className="dsh-link-panel-empty" data-panel-empty="refused">{t('refused.empty')}</p>
        : null}
      {view.refused.length === 0 ? null : (
        <div className="dsh-link-panel-card">
          <ul className="dsh-link-panel-refused" data-panel-refused="">
            {view.refused.map((row, index) => (
              <li className="dsh-link-panel-refusal" key={(row.id ?? 'no-id') + ':' + String(index)}
                data-panel-refusal={row.code ?? 'no-code'}>
                {t('copy.format.line', { code: row.code ?? t('refusal.noCode'), detail: row.detail })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="dsh-link-panel-notes" data-notes="">
        <div className="dsh-link-panel-notes-head" data-notes-head="">
          <span className="dsh-link-panel-notes-count" data-notes-count={String(view.notes.rows.length)}>
            {t('notes.count', { count: view.notes.rows.length })}
          </span>
          <span className="dsh-link-panel-notes-limits" data-notes-limits="">{limitsText(view.notes.limits)}</span>
        </div>
        <ul className="dsh-link-panel-notes-list" data-notes-list="">
          {view.notes.rows.length === 0
            ? <li className="dsh-link-panel-empty" data-panel-empty="notes">{t('notes.empty')}</li>
            : view.notes.rows.map((row, index) => <NoteLine key={row.id === null ? String(index) : row.id} row={row} />)}
        </ul>
        <form className="dsh-link-panel-add" data-notes-add="" onSubmit={submit}>
          <input className="dsh-link-panel-input" data-notes-input="" type="text" value={draft}
            placeholder={t('input.label')} aria-label={t('input.label')}
            onChange={(event) => { setDraft(event.target.value) }} />
          <button className="dsh-link-panel-submit" data-notes-submit="" type="submit" disabled={busy}>
            {busy ? t('submit.busy') : t('submit.idle')}
          </button>
        </form>
        {outcome === null ? null : (
          <p className="dsh-link-panel-result" data-notes-result={outcome.code} data-notes-result-from={outcome.from}
            data-notes-result-ok={String(outcome.ok)}>
            {t('copy.format.line', { code: outcome.code, detail: outcome.detail })}
          </p>
        )}
      </div>
      <details className="dsh-link-panel-registry" data-panel-registry="">
        <summary className="dsh-link-panel-registry-summary">{t('registry.summary')}</summary>
        <ul className="dsh-link-panel-items" data-panel-items="">
          {view.items.length === 0
            ? <li className="dsh-link-panel-empty" data-panel-empty="items">{t('items.empty')}</li>
            : view.items.map((item, index) => (
              <li className="dsh-link-panel-item" key={shown(item, 'id') === '' ? String(index) : shown(item, 'id')}
                data-panel-item={shown(item, 'id')} data-panel-item-kind={shown(item, 'kind')} data-panel-item-sink={sinkOf(view, shown(item, 'kind'))}>
                <span className="dsh-link-panel-item-title" data-panel-item-title="">{shown(item, 'title')}</span>
                <span className="dsh-link-panel-item-meta" data-panel-item-meta="">
                  {t('item.meta', { kind: shown(item, 'kind'), sink: sinkOf(view, shown(item, 'kind')), order: shown(item, 'order'), source: shown(item, 'source') })}
                </span>
              </li>
            ))}
        </ul>
      </details>
    </div>
  )
}

/**
 * The chip's text: a page type has no address to name, so this is the pane's own title, read from the
 * dictionary on every use, so a language change needs no re-registration.
 * @param props - the seat's props for this title.
 * @returns the chip text.
 */
function PanelTitle(props: { readonly t?: Translate }): ReactNode {
  const t: Translate = props.t ?? ((key) => key)
  return <span className="dsh-link-panel-title" data-panel-title="">{t('tab.title')}</span>
}

/**
 * Client plugin body: register the dictionaries, the type, its body and its chip title, and start the
 * reads the marker reports. Never throws: a client half that fails writes the failure into the marker
 * and leaves the shell it runs in alone.
 * @param ctx - client root context carrying the three services.
 */
export function apply(ctx: ClientContext): void {
  const globals = globalThis as unknown as Record<string, unknown>
  try {
    installStyles(ctx)
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-panel: dictionaries')
    const t = ctx.locale.bind(NS)
    // The contribution seam is a client-plane service, like `locale`: a feature that injects
    // 'linkPanel' waits for this half and declares its own item into the same pane. A context that
    // cannot provide one (a hand-driven mount) still gets a pane — it just has no seam to hand out.
    const contributions = createLinkPanelService()
    const host = ctx as unknown as { provide?: (name: string, value: unknown) => unknown }
    if (typeof host.provide === 'function') host.provide(LINK_PANEL_SERVICE, contributions)
    const loader = createLoader({ ask: askWithFetch((globals as { fetch?: unknown }).fetch), globals, panel: contributions })
    ctx.effect(() => () => { loader.dispose() }, 'dsh-link-panel: contribution subscription')
    registerPanelTab(ctx as unknown as Parameters<typeof registerPanelTab>[0], {
      body: PanelBody as unknown as (props: never) => unknown,
      title: PanelTitle as unknown as (props: never) => unknown,
      load: loader.load,
      initial: loader.current,
      add: loader.add,
      press: loader.press,
      watch: loader.watch,
      icon: PANEL_GUIDE_ICON,
      t,
      globals,
    })
  } catch (error) {
    globals['__dshLinkPanel'] = { mounted: true, failed: errorText(error) }
  }
}
