/**
 * The preferences this plugin owns. Shared by both halves: the Host half
 * publishes them as the entry's Config schema (which is what makes the entry a
 * settings namespace at all), the browser half writes them through
 * ctx.configForms.get(SETTINGS_NAMESPACE).
 */

/** Profile entry id, settings namespace, and client form id — one identity. */
export const SETTINGS_NAMESPACE = 'theme-settings'

/** Field carrying the selected control style. */
export const CONTROL_STYLE_FIELD = 'controlStyle'

/** Field carrying the unified corner radius, in CSS pixels. */
export const RADIUS_FIELD = 'radius'

/** Smallest corner radius the row offers, in CSS pixels. */
export const RADIUS_MIN = 0

/** Largest corner radius the row offers, in CSS pixels. */
export const RADIUS_MAX = 28

/** Radius the interface wears when the settings document carries no choice. */
export const DEFAULT_RADIUS = 12

/**
 * Narrow one wire or document value to a persistable radius.
 *
 * This number is handed verbatim to two places that cannot check it — the shell, which draws
 * the window's own corner, and the stylesheet, which draws every control inside it — so it is
 * clamped here rather than trusted. A hand-edited document could otherwise ask the shell for a
 * radius it cannot draw, or the stylesheet for a negative one.
 * @param value - value crossing the settings boundary.
 * @returns an integer radius inside the offered range.
 */
export function clampRadius(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return DEFAULT_RADIUS
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(parsed)))
}

/** Control styles a user may select, in display order. */
export const CONTROL_STYLES = ['official', 'liquid-glass'] as const

/** One selectable control style. */
export type ControlStyle = typeof CONTROL_STYLES[number]

/** Style the client wears when the settings document carries no choice. */
export const DEFAULT_CONTROL_STYLE: ControlStyle = 'official'

/**
 * Narrow one wire or document value to a persistable control style.
 * @param value - value crossing the settings boundary.
 * @returns whether the value is a known style id.
 */
export function isControlStyle(value: unknown): value is ControlStyle {
  return CONTROL_STYLES.some(style => style === value)
}

/* ---------------------------------------------------------------------------
 * The liquid glass skin's style presets.
 *
 * A preset is one arrangement of the same material, named after the Apple
 * release it comes from: `tahoe` floats the sidebar as a glass layer separated
 * from the content by its own gutter and shadow (macOS 26), `golden-gate` runs
 * the same glass edge-to-edge into the content with no shadow and no gutter
 * (macOS 27, framed by Apple as readability). The presets are the skin's own
 * vocabulary: they select token blocks in its stylesheet, and this plugin only
 * writes the two document attributes those blocks are scoped by. Tahoe is the
 * material the skin has always shipped, so an unset document and `tahoe` are
 * the same interface.
 * ------------------------------------------------------------------------- */

/** Style presets the liquid glass skin offers, in display order. */
export const GLASS_PRESETS = ['tahoe', 'golden-gate'] as const

/** One selectable liquid glass preset. */
export type GlassPreset = typeof GLASS_PRESETS[number]

/** Preset the skin wears when the settings document carries no choice. */
export const DEFAULT_GLASS_PRESET: GlassPreset = 'tahoe'

/**
 * Narrow one wire or document value to a persistable glass preset.
 * @param value - value crossing the settings boundary.
 * @returns whether the value is a known preset id.
 */
export function isGlassPreset(value: unknown): value is GlassPreset {
  return GLASS_PRESETS.some(preset => preset === value)
}

/* The transparency axis: one scale from Clear to Tinted, three steps wide
 * because that is the whole range the material has to give (Apple shipped two
 * fixed presets in 26.1 and one continuous slider in 27, whose default is the
 * middle of the range). It moves the glass's fill and blur only — never a
 * geometric token — so a step is transparent-and-sharp at one end and dense-and-
 * frosted at the other, always in the same place. */

/** Transparency steps on the Clear–Tinted axis, in display order. */
export const GLASS_TRANSPARENCY_STEPS = ['clear', 'default', 'tinted'] as const

/** One selectable transparency step. */
export type GlassTransparency = typeof GLASS_TRANSPARENCY_STEPS[number]

/** Step the skin wears when the settings document carries no choice: the middle of the axis. */
export const DEFAULT_GLASS_TRANSPARENCY: GlassTransparency = 'default'

/**
 * The one preset the transparency axis belongs to.
 *
 * Apple's single transparency slider ships with macOS 27, and the 26 material had
 * two fixed presets instead — so the axis is Golden Gate's, and its control is
 * offered (and its tokens defined) only while that preset is selected. The value
 * is persisted whatever the selected preset is, so switching back to Golden Gate
 * returns to the step the user chose.
 */
export const TRANSPARENCY_PRESET: GlassPreset = 'golden-gate'

/**
 * Narrow one wire or document value to a persistable transparency step.
 * @param value - value crossing the settings boundary.
 * @returns whether the value is a known step id.
 */
export function isGlassTransparency(value: unknown): value is GlassTransparency {
  return GLASS_TRANSPARENCY_STEPS.some(step => step === value)
}

/** Field carrying the selected liquid glass preset. */
export const GLASS_PRESET_FIELD = 'glassPreset'

/** Field carrying the selected transparency step. */
export const GLASS_TRANSPARENCY_FIELD = 'glassTransparency'

/**
 * Document attributes the skin's preset token blocks are scoped by.
 *
 * They are written on the root element and read by nothing but the material's own
 * stylesheet — the same channel the radius row uses for its two custom
 * properties, and the reason a preset needs no knowledge of this plugin: the skin
 * matches `html[data-lg-style='liquid-glass'][data-lg-preset='…']` and owns every
 * value behind it.
 */
export const GLASS_PRESET_ATTRIBUTE = 'data-lg-preset'

/** Document attribute naming the selected transparency step. */
export const GLASS_TRANSPARENCY_ATTRIBUTE = 'data-lg-transparency'
