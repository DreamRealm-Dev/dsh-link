/**
 * Theme row store: a mirror of the durable preferences. The plugin's form
 * subscription is the only writer; the section reads through useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import {
  DEFAULT_CONTROL_STYLE, DEFAULT_GLASS_PRESET, DEFAULT_GLASS_TRANSPARENCY, DEFAULT_RADIUS,
  type ControlStyle, type GlassPreset, type GlassTransparency,
} from '../settings.ts'

/** Store state mirrored from the settings document. */
export interface ControlStyleState {
  /** Persisted style id (the selection reads this, never the applied material). */
  styleId: ControlStyle
  /** Persisted unified corner radius, in CSS pixels. */
  radius: number
  /** Persisted liquid glass preset id. */
  preset: GlassPreset
  /** Persisted transparency step id. */
  transparency: GlassTransparency
  /** Settings revision; -1 until the first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type ControlStyleActions = {
  sync: (
    draft: ControlStyleState,
    styleId: ControlStyle,
    radius: number,
    preset: GlassPreset,
    transparency: GlassTransparency,
    revision: number,
  ) => void
}

/**
 * Declares the theme row state and write surface.
 * @returns the store handle.
 */
export function createControlStyleStore(): EngineStoreHandle<ControlStyleState, ControlStyleActions> {
  return defineStore({
    init: (): ControlStyleState => ({
      styleId: DEFAULT_CONTROL_STYLE,
      radius: DEFAULT_RADIUS,
      preset: DEFAULT_GLASS_PRESET,
      transparency: DEFAULT_GLASS_TRANSPARENCY,
      revision: -1,
    }),
    actions: {
      sync: (draft, styleId, radius, preset, transparency, revision) => {
        if (revision <= draft.revision) return
        draft.styleId = styleId
        draft.radius = radius
        draft.preset = preset
        draft.transparency = transparency
        draft.revision = revision
      },
    },
  })
}
