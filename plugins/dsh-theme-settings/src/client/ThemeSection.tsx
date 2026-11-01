/**
 * The Theme section: how the client's controls are drawn, which arrangement of
 * the liquid glass skin is worn, and how transparent that skin's glass is. Every
 * row is shaped like the client's own Appearance row — a section that adds a
 * setting should look like the settings that were already there.
 *
 * The selection follows the persisted preference, never the applied material, so
 * a style the document names but this build cannot register still shows as
 * selected rather than silently reverting.
 *
 * Progressive disclosure is the section's one structural rule: the presets are
 * the liquid glass skin's own vocabulary, so they are offered (disabled, with the
 * reason) while another control style is worn; and the transparency axis belongs
 * to Golden Gate alone — Apple's single slider ships with macOS 27, and 26's
 * material had two fixed presets instead — so its row exists only while that
 * preset is selected.
 */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CONTROL_STYLES, GLASS_PRESETS, GLASS_TRANSPARENCY_STEPS, RADIUS_MAX, RADIUS_MIN, TRANSPARENCY_PRESET,
  type ControlStyle, type GlassPreset, type GlassTransparency,
} from '../settings.ts'
import type { ThemeKey } from './locales.ts'
import type { createControlStyleStore } from './control-style-store.ts'

/** Injected business face: the preference writes (t rides the standard locale seat). */
export interface ThemeSectionInjected {
  /** Persist a control style; resolves false when the Host refused the write. */
  setControlStyle: (id: ControlStyle) => Promise<boolean>
  /** Persist the unified corner radius, in CSS pixels. */
  setRadius: (value: number) => Promise<boolean>
  /** Preview a radius without persisting it — the shell and the stylesheet follow. */
  previewRadius: (value: number | null) => void
  /** Persist a liquid glass preset. */
  setGlassPreset: (id: GlassPreset) => Promise<boolean>
  /** Persist a transparency step. */
  setGlassTransparency: (step: GlassTransparency) => Promise<boolean>
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type ThemeSectionComponentProps = PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createControlStyleStore>>
  & PropsLocale<'settings.theme-style'>
  & InjectFace<ThemeSectionInjected>

/** One cube: the control style id, and the copy naming it. */
const CUBES: readonly { id: ControlStyle; title: ThemeKey; hint: ThemeKey }[] = [
  { id: 'official', title: 'controlStyle.official', hint: 'controlStyle.officialHint' },
  { id: 'liquid-glass', title: 'controlStyle.liquidGlass', hint: 'controlStyle.liquidGlassHint' },
]

/**
 * One preset cube: the preset id, its copy, and the layout modifier of its
 * preview — a floating pane for Tahoe, a flush one for Golden Gate. The modifier
 * is what the preview shows, so a reader picks the arrangement by looking.
 */
const PRESETS: readonly { id: GlassPreset; title: ThemeKey; hint: ThemeKey; preview: string }[] = [
  { id: 'tahoe', title: 'glassPreset.tahoe', hint: 'glassPreset.tahoeHint', preview: 'tahoe' },
  { id: 'golden-gate', title: 'glassPreset.goldenGate', hint: 'glassPreset.goldenGateHint', preview: 'edge' },
]

/** One transparency step, and the copy naming it. */
const STEPS: readonly { id: GlassTransparency; label: ThemeKey }[] = [
  { id: 'clear', label: 'transparency.clear' },
  { id: 'default', label: 'transparency.default' },
  { id: 'tinted', label: 'transparency.tinted' },
]

/** The row whose write failed last, so each group reports its own failure. */
type FailedRow = 'style' | 'preset' | 'transparency'

/**
 * Render the Theme section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function ThemeSection({
  t, setControlStyle, setRadius, previewRadius, setGlassPreset, setGlassTransparency, useStore,
}: ThemeSectionComponentProps) {
  const styleId = useStore(state => state.styleId)
  const radius = useStore(state => state.radius)
  const preset = useStore(state => state.preset)
  const transparency = useStore(state => state.transparency)
  const [failed, setFailed] = useState<FailedRow | null>(null)
  // While the pointer is down the row shows (and the interface wears) the dragged value; the
  // preference is written once, on release, so a drag is not a burst of settings commits.
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? radius
  const glass = styleId === 'liquid-glass'
  /**
   * Run one row's write and report a refusal on that row.
   *
   * A write has two ways to not happen: the Host answers "no" (a resolved false) and the call
   * itself fails (a rejection — the entry it addresses is no longer configurable, or the
   * revision moved underneath it). Both have to land on the row, because a control that
   * silently keeps showing the old value while the document keeps the old preference is the one
   * outcome the user cannot act on.
   */
  const commit = (row: FailedRow, write: () => Promise<boolean>): void => {
    setFailed(null)
    void write().then(accepted => { if (!accepted) setFailed(row) }, () => setFailed(row))
  }
  const commitRadius = (value: number): void => {
    setDragging(null)
    commit('style', () => setRadius(value))
  }
  return (
    <div className="dsh-theme-section">
      <div className="dsh-theme-group">
        <div className="dsh-theme-title">{t('controlStyle.title')}</div>
        <div className="dsh-theme-cubes">
          {CUBES.map(({ id, title, hint }) => (
            <button
              key={id}
              type="button"
              className={styleId === id ? 'dsh-theme-cube dsh-theme-cube--selected' : 'dsh-theme-cube'}
              aria-pressed={styleId === id}
              onClick={() => commit('style', () => setControlStyle(id))}
            >
              <span className={id === 'liquid-glass' ? 'dsh-theme-preview dsh-theme-preview--glass' : 'dsh-theme-preview dsh-theme-preview--flat'} aria-hidden="true">
                <span className="dsh-theme-preview-bar" />
                <span className="dsh-theme-preview-button" />
              </span>
              <span className="dsh-theme-cube-title">{t(title)}</span>
              <span className="dsh-theme-cube-hint">{t(hint)}</span>
            </button>
          ))}
        </div>
        <div className="dsh-theme-description">{t('controlStyle.description')}</div>
        {failed === 'style' && <div className="dsh-theme-error" role="alert">{t('controlStyle.failed')}</div>}
      </div>
      <div className="dsh-theme-group">
        <div className="dsh-theme-title">{t('glassPreset.title')}</div>
        <div className="dsh-theme-cubes dsh-theme-cubes--presets">
          {PRESETS.map(({ id, title, hint, preview }) => (
            <button
              key={id}
              type="button"
              className={preset === id ? 'dsh-theme-cube dsh-theme-cube--selected' : 'dsh-theme-cube'}
              aria-pressed={preset === id}
              disabled={!glass}
              onClick={() => commit('preset', () => setGlassPreset(id))}
            >
              <span className={'dsh-theme-preview dsh-theme-preview--preset dsh-theme-preview--' + preview} aria-hidden="true">
                <span className="dsh-theme-preview-sidebar" />
                <span className="dsh-theme-preview-line dsh-theme-preview-line--a" />
                <span className="dsh-theme-preview-line dsh-theme-preview-line--b" />
              </span>
              <span className="dsh-theme-cube-title">{t(title)}</span>
              <span className="dsh-theme-cube-hint">{t(hint)}</span>
            </button>
          ))}
        </div>
        <div className="dsh-theme-description">{glass ? t('glassPreset.description') : t('glassPreset.skinOff')}</div>
        {failed === 'preset' && <div className="dsh-theme-error" role="alert">{t('glassPreset.failed')}</div>}
      </div>
      {glass && preset === TRANSPARENCY_PRESET && (
        <div className="dsh-theme-group">
          <div className="dsh-theme-title">{t('transparency.title')}</div>
          <div className="dsh-theme-steps" role="group" aria-label={t('transparency.title')}>
            {STEPS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={transparency === id ? 'dsh-theme-step dsh-theme-step--selected' : 'dsh-theme-step'}
                aria-pressed={transparency === id}
                onClick={() => commit('transparency', () => setGlassTransparency(id))}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <div className="dsh-theme-description">{t('transparency.description')}</div>
          {failed === 'transparency' && <div className="dsh-theme-error" role="alert">{t('transparency.failed')}</div>}
        </div>
      )}
      <div className="dsh-theme-group">
        <div className="dsh-theme-title">{t('radius.title')}</div>
        <div className="dsh-theme-slider-row">
          <input
            className="dsh-theme-slider"
            type="range"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={1}
            value={shown}
            aria-label={t('radius.title')}
            onChange={(event) => {
              const next = Number(event.target.value)
              setDragging(next)
              previewRadius(next)
            }}
            onPointerUp={() => commitRadius(shown)}
            onKeyUp={() => commitRadius(shown)}
            onBlur={() => { if (dragging !== null) commitRadius(shown) }}
          />
          <span className="dsh-theme-slider-value">{shown} px</span>
        </div>
        <div className="dsh-theme-description">{t('radius.description')}</div>
      </div>
    </div>
  )
}

/** Style ids this build knows, for the caller that validates a document value. */
export const KNOWN_CONTROL_STYLES = CONTROL_STYLES

/** Preset ids this build knows, for the caller that validates a document value. */
export const KNOWN_GLASS_PRESETS = GLASS_PRESETS

/** Transparency steps this build knows. */
export const KNOWN_GLASS_TRANSPARENCY_STEPS = GLASS_TRANSPARENCY_STEPS
