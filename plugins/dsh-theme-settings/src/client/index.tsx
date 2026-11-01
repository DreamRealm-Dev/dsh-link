/**
 * Browser half of dsh-theme-settings: the Theme section, and the one place the
 * durable control-style preference is both read and written.
 *
 * The preferences live in the plugin's own settings namespace (its entry id),
 * so they survive restarts and show up in the settings document like every
 * other preference, and the applied material follows them: the section never
 * writes to the material engine directly from a click, it writes the setting and
 * adopts whatever the document ends up holding. A refused write therefore leaves
 * the interface exactly as it was.
 *
 * Three preferences, two channels. The control style is the material engine's
 * own write (ctx.liquidGlass.setStyle). The radius and the skin's preset are the
 * skin's: the radius writes the two custom properties every corner reads, and the
 * preset writes the two attributes its token blocks are scoped by. Neither needs
 * the skin to know this plugin exists, and neither is a write into another
 * plugin's module graph.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the settings slot declarations plus the ctx.configForms Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  clampRadius, CONTROL_STYLE_FIELD, DEFAULT_CONTROL_STYLE, DEFAULT_GLASS_PRESET, DEFAULT_GLASS_TRANSPARENCY,
  DEFAULT_RADIUS, GLASS_PRESET_ATTRIBUTE, GLASS_PRESET_FIELD, GLASS_TRANSPARENCY_ATTRIBUTE,
  GLASS_TRANSPARENCY_FIELD, isControlStyle, isGlassPreset, isGlassTransparency, RADIUS_FIELD,
  SETTINGS_NAMESPACE, type ControlStyle, type GlassPreset, type GlassTransparency,
} from '../settings.ts'
import { createControlStyleStore } from './control-style-store.ts'
import { createRadiusApplier, lgSweep, writeRadiusTokens } from './radius-apply.ts'
import { ThemeSection, type ThemeSectionInjected } from './ThemeSection.tsx'
import { en, zh, type ThemeKey } from './locales.ts'
import sectionCss from './section.css'

const PLUGIN_ID = 'dsh-theme-settings'

/** Namespace owning this section's copy. */
export const SETTINGS_NS = 'settings.theme-style'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Theme section's copy. */
    'settings.theme-style': ThemeKey
  }
}

/**
 * Required services. `liquidGlass` is the material engine provided by
 * dsh-liquid-glass: injection is what orders this half after that one, and it is
 * the only way the two plugins know each other.
 */
export const inject = ['slots', 'locale', 'remote', 'configForms', 'liquidGlass']

/**
 * Mount this plugin's own stylesheet for exactly its lifetime.
 * @param ctx - owning plugin context.
 */
function installSectionStyles(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/section.css`
    tag.textContent = sectionCss
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-theme-settings: section stylesheet')
}

/**
 * Register the Theme section and keep the material engine on the persisted
 * preference.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  installSectionStyles(ctx)
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'dsh-theme-settings: section dictionaries')
  const t = ctx.locale.bind(SETTINGS_NS)
  const form = ctx.configForms.get<{
    controlStyle: ControlStyle
    radius: number
    glassPreset: GlassPreset
    glassTransparency: GlassTransparency
  }>(SETTINGS_NAMESPACE)
  const store = createControlStyleStore()
  let bound: BoundActions<typeof store> | undefined

  /**
   * Hand one radius to both halves that have to agree on it: the stylesheet, which draws every
   * control inside the window, and the shell, which draws the window's own corner. Two places
   * from one control is the point of the row, and it is why the value is written as an inline
   * custom property: the skin's defaults live in its own stylesheet, and only a value on the
   * root element can move them without the skin having to know this plugin exists.
   * @param radius - the unified radius, in CSS pixels.
   */
  const applyRadius = (radius: number): void => {
    if (typeof document !== 'undefined') writeRadiusTokens(document.documentElement, radius)
    const scheme = typeof document === 'undefined' ? 'light' : getComputedStyle(document.body).colorScheme
    void fetch('/__shell/window', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ radius, palette: scheme.includes('dark') ? 'dark' : 'light' }),
    }).catch(() => undefined)
  }

  /**
   * Write the skin's two preset attributes onto the element its token blocks are scoped by.
   *
   * The same channel as the radius tokens and for the same reason: the value belongs on the
   * root element, and the skin owns everything behind the attribute. Writing it while the
   * official style is applied is harmless — every rule the skin scopes that way also requires
   * `data-lg-style='liquid-glass'` — and it is written unconditionally because the choice is a
   * preference, not a fact about the active material.
   * @param preset - the selected preset id.
   * @param transparency - the selected transparency step id.
   */
  const writeGlassAttributes = (preset: GlassPreset, transparency: GlassTransparency): void => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute(GLASS_PRESET_ATTRIBUTE, preset)
    document.documentElement.setAttribute(GLASS_TRANSPARENCY_ATTRIBUTE, transparency)
  }

  /**
   * The preset pair the document last handed over, so a *change* can be told from a re-adopt.
   *
   * A preset moves tokens a lens is baked from — its band, its bend, its blur, its saturate —
   * and a surface already on screen keeps the filter it was baked for until something
   * re-dresses it. That is the defect this watch exists for: switching a preset had to reach
   * the surfaces that are open, not the ones opened afterwards. The re-dress is immediate
   * rather than debounced because a preset is a discrete choice (there is no drag to absorb),
   * and it is idempotent — a surface whose lens already fits its shape is handed the lens it
   * is already wearing.
   */
  let adoptedPreset: string | undefined

  /**
   * Re-dress the document when, and only when, the preset pair actually moved.
   * @param preset - the selected preset id.
   * @param transparency - the selected transparency step id.
   */
  const adoptPreset = (preset: GlassPreset, transparency: GlassTransparency): void => {
    const pair = preset + '/' + transparency
    if (pair === adoptedPreset) return
    adoptedPreset = pair
    redressEverySurface()
  }

  /**
   * Re-dress every surface in the document that resolves a radius.
   *
   * This is the half a token write cannot do. The engine follows the token by itself for the
   * surfaces it has already dressed, but a panel it has never classified — an overlay popover
   * opened before the material took an interest in it — keeps the client's own corner, and a
   * baked lens is a copy of the radius that only a dress replaces. The engine's own sweep is
   * the one pass that does both: it tags what it has not tagged and then dresses everything.
   * The engine's public dress entry point is the fallback for a composition without the hook;
   * it reaches the surfaces the engine already knows. Both are idempotent — a surface whose
   * lens already fits its shape is handed the filter it is already wearing.
   */
  const redressEverySurface = (): void => {
    const sweep = typeof window === 'undefined' ? undefined : lgSweep(window)
    if (sweep !== undefined) { sweep(); return }
    try {
      (ctx.liquidGlass as unknown as { dressRefractingSurfaces?: () => void }).dressRefractingSurfaces?.()
    } catch (error) {
      ctx.logger.warn(`dsh-theme-settings: the material engine could not re-dress its surfaces: %s`, error)
    }
  }

  /**
   * The idle debounce: while the control moves, only the cheap half runs (the drag previews
   * live); three seconds after the last adjustment the cheap half is re-run — it is idempotent,
   * and it re-asserts the shell's own corner — followed by one global re-dress.
   *
   * The re-dress walks the whole document, which is exactly why it is deferred to the first
   * moment the user has stopped: a burst of slider input costs one pass, not one per step, and
   * nothing on screen waits for it — the cheap half already moved every corner that reads the
   * token.
   */
  const applier = createRadiusApplier({ applyTokens: applyRadius, redressSurfaces: redressEverySurface })
  ctx.effect(() => () => applier.cancel(), 'dsh-theme-settings: deferred radius apply')

  // One adoption path for every source of truth: the durable document. It runs
  // on each commit and once at registration, and it is the only caller of the
  // material engine.
  const adopt = (): void => {
    const snapshot = form.getSnapshot()
    const value = snapshot.value
    if (value === undefined) return
    const styleId = isControlStyle(value.controlStyle) ? value.controlStyle : DEFAULT_CONTROL_STYLE
    const radius = clampRadius(value.radius ?? DEFAULT_RADIUS)
    // A document written before this section had presets carries neither field, and one written
    // by a newer build can carry a preset this build does not register: both fall back to the
    // skin's shipped arrangement rather than leaving the attribute unset.
    const preset = isGlassPreset(value.glassPreset) ? value.glassPreset : DEFAULT_GLASS_PRESET
    const transparency = isGlassTransparency(value.glassTransparency)
      ? value.glassTransparency
      : DEFAULT_GLASS_TRANSPARENCY
    bound?.sync(styleId, radius, preset, transparency, snapshot.revision ?? -1)
    writeGlassAttributes(preset, transparency)
    applyRadius(radius)
    adoptPreset(preset, transparency)
    /* Every write of the tokens arms the idle window, whatever moved them — the slider's own
     * commit, a document edited outside this section, or the first sync at registration. The
     * applier drops a value it has already applied, so a commit that carried no radius change
     * costs nothing. */
    applier.note(radius)
    try {
      ctx.liquidGlass.setStyle(styleId)
    } catch (error) {
      // The document can name a style this composition does not register — a
      // material package removed while the preference stayed behind. The row
      // still shows the persisted choice; the applied material stays as it is.
      ctx.logger.warn(`dsh-theme-settings: %s`, error)
    }
  }
  ctx.effect(() => form.subscribe(adopt), 'dsh-theme-settings: durable preference adoption')
  adopt()

  const injected = (actions: BoundActions<typeof store>): ThemeSectionInjected => {
    bound = actions
    // Re-sync from the getter so nothing is lost between registration and first
    // render (the store's revision guard drops stale duplicates).
    adopt()
    return {
      setControlStyle: id => form.set(CONTROL_STYLE_FIELD, id),
      setRadius: value => form.set(RADIUS_FIELD, clampRadius(value)),
      setGlassPreset: id => form.set(GLASS_PRESET_FIELD, id),
      setGlassTransparency: step => form.set(GLASS_TRANSPARENCY_FIELD, step),
      // The drag previews through the same path the committed value takes, so what the slider
      // shows while dragging is what the interface and the shell are already wearing.
      previewRadius: value => {
        if (value === null) return
        const radius = clampRadius(value)
        applyRadius(radius)
        // A drag never reaches the document until it is released, so each step arms the idle
        // window here: the surface that has to be re-dressed is the one the pointer left.
        applier.note(radius)
      },
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'theme',
    order: 5,
    label: () => t('nav'),
    locale: SETTINGS_NS,
    store,
    inject: injected,
  }, ThemeSection))
}
