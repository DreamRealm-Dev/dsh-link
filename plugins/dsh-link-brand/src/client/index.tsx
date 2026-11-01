/**
 * Browser half of dsh-link-brand: the marks this desktop edition presents as its
 * own identity.
 *
 * One lettering per surface. The wordmark already integrates the symbol — the whale
 * sits in the bowl of its `d` — so drawing the badge beside it would say LINK twice,
 * once in the badge's plain ring type. The badge is therefore only drawn where the
 * surface is square and stands alone: the collapsed sidebar rail and the conversation
 * hero. The app icon, tray and installer use the same badge as a bitmap.
 *
 * The priority is the other load-bearing detail: a `single` slot renders its
 * lowest-priority entry and throws on a second registration at the same priority, so
 * -1 shadows the official occupants in an official-profile build and is conflict-free
 * in the local-profile build this application runs, where the slots are otherwise
 * left to their fallbacks (the official fish mark, and the official wordmark).
 *
 * The artwork is this project's own (see assets/PROVENANCE.md); the official DeepSeek
 * Harness marks are deliberately not used, per BRAND_GUIDELINES.zh.md.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DshBrandMark, DshBrandName } from './marks.tsx'
import brandCss from './brand.css'

const PLUGIN_ID = 'dsh-link-brand'

/** Shadowing rank for every registration here (lowest renders). */
const BRAND_PRIORITY = -1

/**
 * Mount this plugin's own stylesheet for exactly its lifetime.
 * @param ctx - owning plugin context.
 */
function installBrandStyles(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/brand.css`
    tag.textContent = brandCss
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-link-brand: brand stylesheet')
}

/**
 * The sidebar mark, drawn only where it stands alone.
 *
 * The declaring surface passes the same owner props to both occurrences, so the one
 * difference is the box it was mounted in: the collapsed rail wraps it in its own
 * `railMark`, the expanded row in `brandMark` beside the wordmark. The check runs in
 * a layout effect, so the rail never paints an empty box first.
 * @param props - the box the declaring surface asks for.
 * @returns the badge in the rail, and nothing in the expanded row.
 */
function SidebarMark({ size }: { size?: number }) {
  const host = useRef<HTMLSpanElement | null>(null)
  const [standalone, setStandalone] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    setStandalone(host.current?.closest('[class*="railMark"]') !== null)
  }, [])
  // The first commit is a bare probe the effect reads; it is replaced before paint, so
  // neither branch paints the wrong mark. Returning nothing in the row is what leaves
  // the client's own mark box empty: the box is the flex item, so it has to collapse
  // for the wordmark to sit flush with the sidebar's own text column.
  if (standalone === null) return <span ref={host} className="dsh-link-brand-probe" />
  return standalone ? <DshBrandMark size={size ?? 24} /> : null
}

/**
 * The conversation hero's mark, replacing the declaring package's animated fish.
 * @param props - the box and the hero's own class for it.
 * @returns the badge at that size.
 */
function HeroMark({ size, className }: { size?: number; className?: string }) {
  return <DshBrandMark size={size ?? 34} className={className} />
}

/**
 * The wordmark beside the sidebar mark.
 * @returns the wordmark, sized to the brand row's text.
 */
function SidebarName() {
  return <DshBrandName />
}

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the brand slots, waiting for each declaration so the registration is removed
 * when its declaring surface goes away.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  installBrandStyles(ctx)
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: BRAND_PRIORITY }, SidebarMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', priority: BRAND_PRIORITY }, SidebarName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: BRAND_PRIORITY }, HeroMark))
}
