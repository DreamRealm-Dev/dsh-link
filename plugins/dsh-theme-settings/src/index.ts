/**
 * Host half of dsh-theme-settings.
 *
 * Its whole job is the Config schema: a settings namespace exists for an entry
 * that has one, and only volatile fields are live-editable. All four fields are
 * volatile because switching material, radius or preset takes effect in the
 * running client without a restart.
 *
 * There is no Host behaviour to run — the material is a browser concern — but
 * the schema has to be published from this half, so the entry exists to carry
 * it.
 */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  clampRadius, CONTROL_STYLES, DEFAULT_CONTROL_STYLE, DEFAULT_GLASS_PRESET, DEFAULT_GLASS_TRANSPARENCY,
  DEFAULT_RADIUS, GLASS_PRESETS, GLASS_TRANSPARENCY_STEPS, RADIUS_FIELD, RADIUS_MAX, RADIUS_MIN,
  type ControlStyle, type GlassPreset, type GlassTransparency,
} from './settings.ts'

export {
  clampRadius, CONTROL_STYLE_FIELD, CONTROL_STYLES, DEFAULT_CONTROL_STYLE, DEFAULT_GLASS_PRESET,
  DEFAULT_GLASS_TRANSPARENCY, DEFAULT_RADIUS, GLASS_PRESET_ATTRIBUTE, GLASS_PRESET_FIELD, GLASS_PRESETS,
  GLASS_TRANSPARENCY_ATTRIBUTE, GLASS_TRANSPARENCY_FIELD, GLASS_TRANSPARENCY_STEPS, isControlStyle,
  isGlassPreset, isGlassTransparency, RADIUS_FIELD, RADIUS_MAX, RADIUS_MIN, SETTINGS_NAMESPACE,
  TRANSPARENCY_PRESET,
} from './settings.ts'
export type { ControlStyle, GlassPreset, GlassTransparency } from './settings.ts'

/** Live theme preferences. */
export interface Config {
  /** Selected control style. */
  controlStyle: Volatile<ControlStyle>
  /**
   * Unified corner radius, in CSS pixels: the window's own corner and every panel inside it.
   * Volatile for the same reason as the style: dragging the row has to be visible at once.
   */
  radius: Volatile<number>
  /**
   * Selected liquid glass preset, naming one token block in the skin's stylesheet. Volatile
   * because switching it re-lays the sidebar's glass while the interface is on screen.
   */
  glassPreset: Volatile<GlassPreset>
  /**
   * Selected transparency step on the Clear–Tinted axis. Volatile for the same reason, and
   * persisted whatever preset is selected, so it survives a detour through Tahoe.
   */
  glassTransparency: Volatile<GlassTransparency>
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const Config: z<Config> = z.object({
  controlStyle: z.union([...CONTROL_STYLES]).default(DEFAULT_CONTROL_STYLE).volatile(),
  radius: z.number().min(RADIUS_MIN).max(RADIUS_MAX).default(DEFAULT_RADIUS).volatile(),
  glassPreset: z.union([...GLASS_PRESETS]).default(DEFAULT_GLASS_PRESET).volatile(),
  glassTransparency: z.union([...GLASS_TRANSPARENCY_STEPS]).default(DEFAULT_GLASS_TRANSPARENCY).volatile(),
})

/** Loader entry name for the diagnostics surface. */
export const name = 'theme-settings'

/** No Host behaviour. */
export function apply(): void {}
