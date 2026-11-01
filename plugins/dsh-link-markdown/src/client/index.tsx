/**
 * The browser half: the right Sidebar's `markdown` tab type.
 *
 * The type reaches the Sidebar through its public path only — the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat, and the chip text into
 * `sidebar.right.pane.tab.title`, all under the definition's `id`. Nothing here reaches into the
 * Sidebar's store, its panes, or its sequence, and every import from another client package is a
 * baseline module the shell already preloads.
 *
 * Rendering is the kernel client's own: `MarkdownText` from `ui-primitives` is the markdown pipeline
 * the product renders assistant replies with, so TeX goes through KaTeX and fenced code through Shiki
 * without this package carrying either. The file's metadata comes from the standard `useResource`,
 * served by the `file` provider; the text is this type's own business, read page by page through the
 * injected face. Read-only by design: nothing in this package writes, and nothing claims an address it
 * cannot read.
 *
 * Every word this half shows is a key into the package's own locale namespace (`locales.ts`), which
 * `apply` registers and the registration's `locale` field hands to the components as the framework's
 * `t` seat. The chip glyph is the first-party file sheet the kernel's own file-backed tab types draw
 * in this same seat.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { FileTypeIcon, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the locale plugin's Context merge (ctx.locale) and the namespace table this package
// extends with its own name.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { useEffect, useMemo, useState } from 'react'
import { basenameOf, fileTargetOf, titleFor } from './claim.ts'
import { failureReasonKey } from './failure.ts'
import { NS, en, zh, type MarkdownKey } from './locales.ts'
import { createPageReader, documentText, failDocument, readAllPages, startDocument, type MarkdownDocument } from './read.ts'
import { canEdit, isDirty, saveDocument, type SaveOutcome } from './save.ts'
import { registerMarkdown } from './register.ts'
import markdownCss from './markdown.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This package's copy: the pane chrome, the empty state, and the named failure page. */
    'dsh-link-markdown': MarkdownKey
  }
}

/**
 * Services this half requires: the slot registry, the tab-type registry, the workspace Remote for the
 * paged read, and the locale service whose namespace carries this half's copy. Injection is a wait,
 * not an error: a service that never arrives leaves this half silent rather than half-registered.
 */
export const inject = ['slots', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles', 'locale']

/** The tab type's id: one string for the definition, the two seats, and this sheet's owner. */
const PLUGIN_ID = 'dsh-link-markdown'

/**
 * Mount this pane's stylesheet for exactly this plugin's lifetime.
 *
 * The stylesheet is a `<style>` element the plugin owns, installed through `ctx.effect` so its disposer removes it
 * with the fiber - the same idiom dsh-link-toolbar, dsh-link-teams and dsh-link-panel use (there is no `styles`
 * service in the captured client surface). R480: the pane shipped without one, and the shell's tab body
 * (`display:flex; column; height:100%; overflow:hidden`) clipped the document and left the text touching the
 * panel's edges; the layout that fixes both is in markdown.css.
 * @param ctx - owning plugin context.
 */
function installStyles(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = PLUGIN_ID + '/markdown.css'
    tag.textContent = markdownCss
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-link-markdown: pane stylesheet')
}

/**
 * The address the tab was opened at.
 *
 * `navigation.address` is what an open carried; a record nobody opened by address carries its
 * `contentId` instead, which for a resource tab is the same address.
 * @param info - the seat's live tab information.
 * @returns the address, or the empty string when the tab carries none.
 */
function addressOf(info: unknown): string {
  const tab = info !== null && typeof info === 'object' ? Reflect.get(info, 'tab') : undefined
  if (tab === null || typeof tab !== 'object') return ''
  const navigation = Reflect.get(tab, 'navigation')
  const fromNavigation = navigation !== null && typeof navigation === 'object' ? Reflect.get(navigation, 'address') : undefined
  if (typeof fromNavigation === 'string' && fromNavigation !== '') return fromNavigation
  const contentId = Reflect.get(tab, 'contentId')
  return typeof contentId === 'string' ? contentId : ''
}

/**
 * Props the seat hands a body: the framework-bound tab info, the resource hook, this type's read, and
 * the translate seat its registration's `locale` field declares.
 */
interface MarkdownBodyProps {
  readonly useTabInfo: () => unknown
  readonly useResource: (address: string) => { readonly value?: { readonly version?: string } | undefined } | undefined
  readonly readPage: Parameters<typeof readAllPages>[0]
  readonly t: (key: MarkdownKey, params?: Record<string, unknown>) => string
}

/**
 * The tab body: read the file the tab names, render it as Markdown.
 *
 * A read failure is rendered by name — a localized sentence plus the code and carrier text the read
 * itself recorded — rather than as an empty pane, and the header always states which file is on
 * screen, so a pane that opened the wrong address is visible instead of plausible. A tab that carries
 * no address at all is its own empty state, not a failure: nothing was asked for.
 * @param props - the seat's props for this body.
 * @returns the body.
 */
function MarkdownBody(props: MarkdownBodyProps) {
  const { t } = props
  const info = props.useTabInfo()
  const address = addressOf(info)
  const resource = props.useResource(address)
  const version = resource?.value?.version
  const [document, setDocument] = useState<MarkdownDocument>(() => startDocument(address))
  // A new identity discards the renderer's streaming cache, so this is memoized per locale revision:
  // the framework mints a new t on a locale switch and leaves it stable otherwise.
  const labels = useMemo(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  // R352: editing. The rules live in save.ts (when a save may be offered, what a refusal means); this is the state a
  // person drives: the draft, whether it differs from what was read, and what the last save said. Nothing is written
  // until the person presses 保存, and an unchanged document is never sent at all.
  //
  // R377: this block sits ABOVE the read effect, not below it. It was declared below, and the effect's dependency list
  // reads `reload` — a const still in its temporal dead zone at that point — so every render of this body threw
  // "Cannot access 'reload' before initialization". The tab type was registered and every pure rule was green while no
  // markdown tab had ever drawn a pixel; the click-through in scripts/verify-markdown-live.mjs is what found it.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const target = fileTargetOf(address)
    if (target.ok !== true) {
      setDocument(failDocument(startDocument(address), { code: target.reason, message: target.detail }))
      return
    }
    const controller = new AbortController()
    setDocument(startDocument(address))
    void readAllPages(props.readPage, address, controller.signal, setDocument)
    return () => controller.abort()
  }, [address, version, reload, props.readPage])

  const text = documentText(document)
  const editable = canEdit(document)
  const dirty = editing && isDirty(text, draft)
  const beginEdit = () => {
    setDraft(text)
    setOutcome(null)
    setEditing(true)
  }
  const postJson = async (path: string, body: unknown) => {
    const answer = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const parsed = await answer.json().catch(() => null)
    return { status: answer.status, body: parsed }
  }
  const commit = async () => {
    if (dirty === false) { setEditing(false); return }
    // The address carries the Session; the read carries the path and the version. One save, three facts.
    const target = fileTargetOf(address)
    const sessionId = target.ok === true ? target.sessionId : undefined
    const result = await saveDocument({ absolutePath: document.absolutePath, version: document.version, sessionId }, draft, postJson)
    setOutcome(result)
    if (result.kind === 'saved') { setReload(reload + 1) }
  }
  const name = basenameOf(address)
  return (
    <div className="dsh-link-markdown" data-markdown-address={address} data-markdown-name={name}>
      <div className="dsh-link-markdown-head" data-markdown-head="">
        <span className="dsh-link-markdown-path" title={address}>{name === '' ? address : name}</span>
        {editable
          ? (
            <button
              type="button"
              className="dsh-link-markdown-mode"
              data-markdown-edit-toggle=""
              data-markdown-editing={editing ? 'true' : 'false'}
              onClick={() => { if (editing) { setEditing(false); setOutcome(null) } else { beginEdit() } }}
            >
              {editing ? t('body.preview') : t('body.edit')}
            </button>
            )
          : <span className="dsh-link-markdown-mode" data-markdown-readonly="">{t('body.readonly')}</span>}
        {dirty ? <span className="dsh-link-markdown-dirty" data-markdown-dirty="">{t('body.dirty')}</span> : null}
      </div>
      {address === ''
        ? <p className="dsh-link-markdown-empty" data-markdown-empty="">{t('empty.noAddress')}</p>
        : document.failure === null
          ? (editing
            ? (
              <div className="dsh-link-markdown-editor" data-markdown-editor="">
                <textarea
                  className="dsh-link-markdown-area"
                  data-markdown-area=""
                  value={draft}
                  spellCheck={false}
                  onChange={(event) => { setDraft(event.target.value); setOutcome(null) }}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) { event.preventDefault(); void commit() }
                  }}
                />
                <div className="dsh-link-markdown-toolbar">
                  <button type="button" data-markdown-save="" disabled={dirty === false} onClick={() => { void commit() }}>
                    {outcome !== null && outcome.kind === 'saved' ? t('body.saved') : t('body.save')}
                  </button>
                  {/* The refusal's own code and carrier text ride along as attributes: the sentence is the
                      localized part, and a person (or a gate) that needs the machine reason should not have to
                      read the network tab for it. */}
                  <span
                    className="dsh-link-markdown-status"
                    data-markdown-status={outcome === null ? 'idle' : outcome.kind}
                    data-markdown-code={outcome !== null && outcome.kind === 'refused' ? outcome.code : undefined}
                    title={outcome !== null && outcome.kind === 'refused' && outcome.detail !== '' ? outcome.detail : undefined}
                  >
                    {outcome === null ? t('body.saveHint') : outcome.kind === 'saved' ? t('body.savedHint') : outcome.kind === 'stale' ? t('body.stale') : t('body.refused')}
                  </span>
                </div>
              </div>
              )
            : <div className="dsh-link-markdown-body"><MarkdownText text={text} labels={labels} /></div>)
          : (
            <p className="dsh-link-markdown-failure" data-markdown-failure={document.failure.code}>
              <span className="dsh-link-markdown-reason">
                {t(failureReasonKey(document.failure.code) ?? 'failure.reason.unreadable')}
              </span>
              <span className="dsh-link-markdown-detail">{document.failure.code}: {document.failure.message}</span>
            </p>
            )}
    </div>
  )
}

/**
 * The chip's live text: the file name, and nothing else, behind the file-type sheet the kernel's own
 * file-backed tab types draw in this seat.
 *
 * The record's captured title already carries the name; this seat is declared so a rename inside the
 * workspace re-titles the chip rather than leaving the name it was opened under. The name is the
 * user's own file name and stays verbatim — there is nothing here to translate, which is why this
 * registration declares no `locale` field.
 * @param props - the seat's props for a title.
 * @returns the chip's glyph and text.
 */
function MarkdownTitle(props: { readonly useTabInfo: () => unknown } & Record<string, unknown>) {
  const address = addressOf(props.useTabInfo())
  const name = basenameOf(address)
  return (
    <span className="dsh-link-markdown-title" title={address}>
      <FileTypeIcon kind="markdown" size={16} className="dsh-link-markdown-title-icon" />
      {name === '' ? address : name}
    </span>
  )
}

/**
 * Client plugin body: register the type's dictionaries, then its type, its body, its chip title, and
 * the paged read they use.
 * @param ctx - client root context carrying the registries, the workspace Remote, and the locale service.
 */
export function apply(ctx: ClientContext): void {
  installStyles(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-markdown: dictionaries')
  const readPage = createPageReader(ctx.remote as Parameters<typeof createPageReader>[0])
  registerMarkdown(ctx as unknown as Parameters<typeof registerMarkdown>[0], {
    body: MarkdownBody as unknown as (props: never) => unknown,
    title: MarkdownTitle as unknown as (props: never) => unknown,
    titleText: titleFor,
    readPage,
  })
}
