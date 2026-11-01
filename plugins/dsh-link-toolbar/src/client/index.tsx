/**
 * The LINK entry in the conversation header.
 *
 * One trigger, one menu, and nothing that only looks clickable: every row comes from toolbarItems, so a
 * row is enabled exactly when the marker it reports is mounted and has a value, and every disabled row
 * says why. The menu itself is the kernel's own Menu from the baseline client primitives — the module
 * table already carries it, so importing it costs this package no module-graph request, and a
 * hand-rolled overlay would have been a second menu surface pretending to be theirs.
 *
 * The words are not this file's. locales.ts owns the copy, the entry declares that namespace at its
 * registration (`locale: NS`), and every visible string is read from the `t` seat the shell binds for
 * it — so the trigger and the rows follow the active language, and the component still passes
 * dictionary keys rather than sentences, which is what lets a check see that no product text is
 * written into it. `inject` names the locale service next to the slot registry for the same reason:
 * a shell that composed no dictionaries would leave this entry unmounted rather than mount one that
 * draws nothing.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import { en, NS, zh, type ToolbarCopyKey, type Translate } from './locales.ts'
import { toolbarItems, type ToolbarItem } from './toolbar-items.ts'
import toolbarCss from './toolbar.css'

/** This package's name, used to tag the stylesheet it owns in the document head. */
const PLUGIN_ID = 'dsh-link-toolbar'

/**
 * Where this entry sits among the header's actions.
 *
 * The slot is an ascending list. The kernel's own actions are the important ones and sit low; 100
 * leaves the whole range below for them, and leaves room above for a later plugin that has to follow
 * this one. The number is a position in a list, so it is written down once, here.
 */
export const TOOLBAR_ACTIONS_PRIORITY = 100

/** Required services: the UI slot registry, and the dictionaries the seat draws from. */
export const inject = ['slots', 'locale']

/** The props the seat hands this action: the namespace-bound translate, plus the shares this one ignores. */
interface ToolbarActionProps {
  readonly t: Translate
}

/**
 * One row: the marker's name, and either its value or the reason it has none.
 * @param props - the row to render and the translate seat it draws its words from.
 * @returns the row.
 */
function Row({ item, t }: { item: ToolbarItem, t: Translate }) {
  return (
    <button type="button" role="menuitem" className="dsh-link-toolbar-item" data-enabled={String(item.enabled)} data-item={item.id} disabled={!item.enabled}>
      <span className="dsh-link-toolbar-label">{t(item.labelKey as ToolbarCopyKey)}</span>
      <span className="dsh-link-toolbar-detail">{item.enabled ? item.value : t(('reason.' + item.reason) as ToolbarCopyKey)}</span>
    </button>
  )
}

/**
 * The header action: the trigger, and the menu while it is open.
 * @param props - the seat's props for this entry.
 * @returns the entry.
 */
function ToolbarAction({ t }: ToolbarActionProps) {
  const [open, setOpen] = useState(false)
  const root = typeof document === 'undefined' ? null : document.documentElement
  const items = toolbarItems({ getAttribute: (name) => (root === null ? null : root.getAttribute(name)) })
  return (
    <Menu
      open={open}
      listClassName="dsh-link-toolbar-menu"
      anchor={
        <button type="button" className="dsh-link-toolbar-button" title={t('toolbar.openHint')} aria-expanded={String(open)} onClick={() => setOpen(!open)}>
          {t('toolbar.open')}
        </button>
      }
      onClose={() => setOpen(false)}
    >
      {items.map((item) => <Row key={item.id} item={item} t={t} />)}
    </Menu>
  )
}

/**
 * Mount this entry's stylesheet for exactly this plugin's lifetime.
 *
 * The stylesheet is a `<style>` element this plugin owns, installed through `ctx.effect` so its
 * disposer removes it when the fiber goes away. It is deliberately not installed through a service:
 * no `styles` service exists in the captured client surface (39 services, `slots` and `theme` among
 * them), and a cast to reach one would have shipped an entry whose CSS never loaded while every
 * offline reading stayed green. `dsh-link-brand` installs its own sheet the same way, for the same
 * reason.
 * @param ctx - owning plugin context.
 */
function installStyles(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/toolbar.css`
    tag.textContent = toolbarCss
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-link-toolbar: entry stylesheet')
}

/**
 * Register the LINK entry into the conversation header's action slot.
 *
 * The dictionaries are registered as an effect so they leave with this fiber, and the registration
 * declares the same namespace the seat reads, which is what puts the `t` seat on the component's
 * props. Nothing else about the entry moved: one contribution, the same slot, the same priority.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  installStyles(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-toolbar: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({ name: 'conversation.session.header.actions', priority: TOOLBAR_ACTIONS_PRIORITY, locale: NS }, ToolbarAction))
}
