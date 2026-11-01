/**
 * Browser half of dsh-liquid-glass: the control-material engine.
 *
 * The engine owns one thing — which material the document is wearing — and
 * nothing about where that choice comes from. A style is a named stylesheet plus
 * the document attribute that gates it; `official` is the empty style and means
 * "the client's own material, untouched". Switching styles is one attribute
 * write, one stylesheet swap and (for a refracting style) one SVG filter, so the
 * change is immediate and needs no reload.
 *
 * The preference that selects a style lives with dsh-theme-settings, the plugin
 * whose entry id is the settings namespace.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import materialCss from './material.css'
import { buildDisplacementMap, CORNER_EXPONENT, cornerExponentOf, type LensGeometry } from './displacement.ts'

/** Document attribute naming the active style: `html[data-lg-style="<id>"]`. */
export const STYLE_ATTRIBUTE = 'data-lg-style'

/** Style id that means "nothing of ours is applied". */
export const OFFICIAL_STYLE_ID = 'official'

/** Prefix of the SVG filters the stylesheets wear through `backdrop-filter: url(#…)`. */
export const REFRACTION_FILTER_ID = 'dsh-lg-refract'

/** Custom property carrying one surface's own filter, as the stylesheet asks for it. */
export const REFRACTION_PROPERTY = '--lg-refraction'

/**
 * The property the corner's *shape* is read from, and the shape this engine bakes.
 *
 * CSS now draws a border-radius corner as a continuous curve (`corner-shape: superellipse(k)`,
 * the shape this client declares once for the whole application), and the lens has to be baked
 * from the same curve — a circular distance field under a continuous boundary is a glass corner
 * and a box corner that visibly differ, which is exactly the defect this reads for. So the
 * exponent is taken from the element's *own* computed `corner-shape` rather than assumed, and
 * the surface is dressed with the curve it is actually cut from, on whatever engine it runs.
 */
export const CORNER_SHAPE_PROPERTY = 'corner-shape'

/**
 * Custom property the corner exponent is published on, per surface.
 *
 * Readable from a probe next to the corner it describes, which is how "the lens and the boundary
 * are one shape" stays checkable from outside.
 */
export const CORNER_EXPONENT_PROPERTY = '--lg-corner-exponent'

/**
 * Custom property carrying the corner radius the engine actually baked, in pixels.
 *
 * The stylesheet names the radius as a token — \`calc(var(--lg-radius-panel) + 10px)\` is the card's,
 * and a custom property is substituted as a token rather than computed to a length, so the number
 * the corner was cut at is not readable from it. This is that number, written on the element the
 * corner belongs to: a probe (and \`.tmp/corners/probe-corner.mjs\`) compares it against the radius
 * its own fit recovers, which is how "the lens and the box are one corner" stays checkable.
 */
export const CORNER_NOMINAL_PROPERTY = '--lg-corner-nominal'

/**
 * Custom property carrying the room's light, as an angle.
 *
 * 0deg is above the surface, 90deg to its right, 180deg below it — the stylesheet derives the
 * rim's own offsets from it (see "The pointer" in material.css). It is written on the document
 * element rather than on a surface, because the material reads a *direction*: one light in the
 * room is one angle every surface agrees on, where a nearer light would need a position per
 * surface and therefore a write per surface per frame.
 */
export const LIGHT_PROPERTY = '--lg-light-a'
/** R467: where the pointer IS, in viewport pixels, so the material can light a disc around it. */
export const POINTER_X_PROPERTY = '--lg-pointer-x'
/** R469: the surfaces the skin dresses, i.e. where an edge light may appear. */
export const SURFACE_SELECTOR = '[data-composer-card],[data-lg-surface],[data-lg-refract],[role="dialog"][aria-modal="true"]'
/** R467: see {@link POINTER_X_PROPERTY}. */
export const POINTER_Y_PROPERTY = '--lg-pointer-y'

/**
 * How far the light must move before it is worth a write, in degrees.
 *
 * A fifth of a degree at the rim is a few hundredths of a pixel of the hairline's own offset,
 * which is far inside one device pixel: below it the write cannot change a painted pixel that
 * the previous write did not already change, so a pointer jittering in place costs no writes.
 */
const LIGHT_DEADBAND = 0.2

/** Band width, in pixels, for a surface whose stylesheet does not name one. */
const REFRACTION_BAND = 24

/** Bend at the rim, in pixels, for a surface whose stylesheet does not name one. */
const REFRACTION_BEND = 16

/** Share of the bend by which the red and blue passes separate at the rim. */
const REFRACTION_CHROMA = 0.06

/** Geometry quantum, in pixels: a surface resized by less than this keeps its own map. */
const REFRACTION_QUANTUM = 8

/** Filters kept alive at once, oldest dropped first. */
const REFRACTION_CACHE = 24

/** Rasters kept alive at once, oldest dropped first; a filter's raster is never dropped. */
const REFRACTION_MAP_CACHE = 24

/**
 * How far a bake's own box may sit from the box a surface is asking for and still be that
 * surface's lens, in pixels.
 *
 * Half a pixel is the whole budget: the acceptance for the settled lens is that it equals the
 * control's box within 0.5px, and the cache key is quantised eight whole pixels, so a key that
 * matches says nothing about whether the bake does.
 */
const REFRACTION_FIT_SLACK = 0.5

/**
 * How long a surface whose box changed keeps counting as *moving*, in milliseconds.
 *
 * A layout animation changes the box on every frame, and a bake blocks the frame it runs in —
 * measured at ~30ms for a 307x124 map — so a moving surface is dressed from the cache and only a
 * box that has been still for this long is baked for exactly. A resize that happens in one step
 * (which is what a menu whose row is removed is) has no previous change at all and is baked for
 * exactly on the spot, so this window costs a settled box nothing.
 */
const REFRACTION_HOLD_MS = 120

/** Revision of this vault's caching, published on the host SVG so a probe can name the build. */
const LENS_REVISION = '4'

/**
 * The surfaces the material refracts — the same list the stylesheet materialises. It has
 * to be written twice, because a stylesheet cannot say which of its own rules want a
 * filter and the engine cannot bake one from a selector; the two are held together by
 * `data-lg-refract`, which every dressed surface carries, and by
 * `scripts/probe-edge.mjs`, which fails if a surface wears a glass backdrop filter and
 * no filter id.
 */
const REFRACTING_SURFACES = [
  '[data-composer-card]',
  '[role="dialog"][aria-modal="true"]',
  '[data-lg-surface]',
  // The client's own popup material, which the stylesheet materialises with its own rule.
  '[class*="_material_"]',
  '[data-lg-wide] > [data-slot="sidebar"] > *',
  'section:has([data-slot="sidebar.right.pane.tab"])',
].join(', ')

const PLUGIN_ID = 'dsh-liquid-glass'

/** One selectable material, as the settings surface needs it. */
export interface LiquidGlassStyleInfo {
  /** Stable id written to {@link STYLE_ATTRIBUTE} and persisted by the owner. */
  id: string
  /** Localized display text, resolved by the registrant that owns the copy. */
  label: () => string
}

/** Immutable material state published on every change. */
export interface LiquidGlassSnapshot {
  /** Id of the active style. */
  styleId: string
  /** Registered styles in registration order; the first is {@link OFFICIAL_STYLE_ID}. */
  styles: readonly LiquidGlassStyleInfo[]
}

/** What a registrant supplies for one style. */
export interface LiquidGlassStyleInput {
  /** Unique id; registering an id twice throws. */
  id: string
  /** Localized display text. */
  label: () => string
  /** Stylesheet mounted while the style is active; empty for the official style. */
  css: string
  /** Whether the stylesheet refracts through {@link REFRACTION_FILTER_ID}. */
  refraction?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    liquidGlass: LiquidGlassRuntime
  }
  interface Events {
    /**
     * The active material or the style registry changed.
     * @param snapshot - Current immutable material snapshot.
     * @mode emit
     */
    'liquid-glass/change'(snapshot: LiquidGlassSnapshot): void
  }
}

interface StyleDefinition extends LiquidGlassStyleInput {
  refraction: boolean
}

const OFFICIAL_STYLE: StyleDefinition = {
  id: OFFICIAL_STYLE_ID,
  label: () => OFFICIAL_STYLE_ID,
  css: '',
  refraction: false,
}

/**
 * Style registry, active-style owner, and the only writer of the document
 * attribute. A style's stylesheet is mounted for exactly as long as the style is
 * active, so a page can never wear two materials at once.
 */
export class LiquidGlassRuntime {
  private readonly ctx: ClientContext
  private styles: StyleDefinition[] = [OFFICIAL_STYLE]
  private styleId: string = OFFICIAL_STYLE_ID
  private snapshot: LiquidGlassSnapshot
  private styleTag: HTMLStyleElement | undefined
  private vault: RefractionVault | undefined
  private mountedId: string | undefined

  /**
   * @param ctx - owning plugin context; teardown is registered through it.
   */
  constructor(ctx: ClientContext) {
    this.ctx = ctx
    this.snapshot = this.buildSnapshot()
    ctx.effect(() => () => { this.unmount() }, 'dsh-liquid-glass: material teardown')
  }

  /**
   * Read the current material state.
   * @returns the current snapshot, stable until the next change.
   */
  getSnapshot(): LiquidGlassSnapshot {
    return this.snapshot
  }

  /**
   * Register one style. The first registrant of an id owns it.
   * @param input - id, localized label, stylesheet, and whether it refracts.
   * @returns the disposer removing the style; disposing the active style falls
   * back to the official material.
   */
  register(input: LiquidGlassStyleInput): () => void {
    if (this.styles.some(style => style.id === input.id)) {
      throw new Error(`liquid glass style "${input.id}" is already registered`)
    }
    const definition: StyleDefinition = { ...input, refraction: input.refraction ?? false }
    this.styles = [...this.styles, definition]
    if (definition.id === this.styleId) this.mount()
    this.publish()
    return () => {
      if (!this.styles.some(style => style.id === definition.id)) return
      this.styles = this.styles.filter(style => style.id !== definition.id)
      if (this.styleId === definition.id) {
        this.styleId = OFFICIAL_STYLE_ID
        this.mount()
      }
      this.publish()
    }
  }

  /**
   * Switch the active style — the only material write entry.
   * @param id - a registered style id; unknown ids throw.
   */
  setStyle(id: string): void {
    if (!this.styles.some(style => style.id === id)) {
      throw new Error(`liquid glass style "${id}" is not registered`)
    }
    if (this.styleId === id) return
    this.styleId = id
    this.mount()
    this.publish()
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    this.ctx.emit('liquid-glass/change', this.snapshot)
  }

  private buildSnapshot(): LiquidGlassSnapshot {
    return Object.freeze({
      styleId: this.styleId,
      styles: Object.freeze(this.styles.map(style => Object.freeze({ id: style.id, label: style.label }))),
    })
  }

  /**
   * Bring the document in line with the active style: the attribute, the
   * stylesheet, and the refraction filter. Runs on every style write and on
   * registration of the active style, and is idempotent.
   */
  private mount(): void {
    /* v8 ignore next -- node e2e boots the client tree without a document */
    if (typeof document === 'undefined') return
    const active = this.styles.find(style => style.id === this.styleId)
    /* v8 ignore next -- setStyle/register keep the id resolvable */
    if (active === undefined) return
    document.documentElement.setAttribute(STYLE_ATTRIBUTE, active.id)
    /* The corner exponent, published where the stylesheet and every probe can read it. It is one
     * constant for the whole stack — the same number the drawn boundary and the lens are both
     * generated from — and this is what keeps the CSS from owning a second copy of it. */
    document.documentElement.style.setProperty(CORNER_EXPONENT_PROPERTY, String(CORNER_EXPONENT))
    this.mountedId = active.id
    this.unmountAssets()
    if (active.css !== '') {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${active.id}`
      tag.textContent = active.css
      document.head.appendChild(tag)
      this.styleTag = tag
    }
    if (active.refraction) {
      this.vault = new RefractionVault()
      // Dressed at once, not at the next sweep: a surface that is on screen now would
      // otherwise wear frost without its lens for as long as the sweep's debounce.
      this.vault.dressAll()
    }
  }

  /**
   * Dress every refracting surface for its current geometry.
   *
   * Called from the layout sweep rather than from the style's mount: a surface's filter
   * belongs to the shape it currently has, and shapes change — the composer grows as it is
   * typed into, the sidebar column animates, a dialog opens at whatever size the client
   * chose. Doing nothing without a vault is deliberate: the official style refracts
   * nothing, so it dresses nothing.
   */
  dressRefractingSurfaces(): void {
    this.vault?.dressAll()
  }

  /**
   * Pass the pointer light's own write on to the active vault, so its token mutation is not read
   * as a surface whose shape moved. Does nothing without a vault: the official style refracts
   * nothing, and nothing of the material reads the light either.
   * @param styleText - the document element's inline style text right after the write.
   */
  noteLightWrite(styleText: string): void {
    this.vault?.noteLightWrite(styleText)
  }

  private unmount(): void {
    /* v8 ignore next -- node e2e boots the client tree without a document */
    if (typeof document === 'undefined') return
    document.documentElement.removeAttribute(STYLE_ATTRIBUTE)
    this.unmountAssets()
  }

  private unmountAssets(): void {
    this.styleTag?.remove()
    this.styleTag = undefined
    this.vault?.destroy()
    this.vault = undefined
    this.mountedId = undefined
  }
}

/** One baked raster: the map's pixels, and the exact box they were baked for. */
interface RefractionMap {
  /** The map as a PNG data URL, or '' when the canvas was unavailable. */
  url: string
  /** The exact box the map was baked for, so a stale bake can be told from a fitting one. */
  geometry: LensGeometry
}

/**
 * One filter element: the id the stylesheet wears, and the raster it samples.
 *
 * The filter is cached apart from the raster because the two answer different questions. The raster
 * is a function of the surface's *shape*; the filter's primitives carry the *optics* — the bend,
 * the fringe, the frost, the saturate. Changing one optics value used to re-key the whole entry,
 * which re-baked a pixel-identical map, encoded it, waited for the decode and dropped the surface
 * to plain frost while it waited.
 */
interface RefractionEntry {
  id: string
  /** The raster this filter samples; an entry whose raster has been replaced is rebuilt. */
  map: RefractionMap
}

/**
 * Whether a bake made for one box is still the lens for another.
 *
 * The cache key is quantised, the bake is not: the map is placed over the element's *exact*
 * box, so a key that matches a settled surface and a bake that does not is a lens that
 * overhangs its control — measured at 6.7px on the sidebar account menu, whose settled box
 * (76px tall) shares the vault's own quantised cell with the 82.67px box it was baked for
 * mid-animation.
 * @param baked - the box the cached bake was made for.
 * @param box - the box the surface is asking for now.
 * @param tolerance - how far off the bake may be and still be this box's lens. A settled box is
 *   held to {@link REFRACTION_FIT_SLACK}; a box that is still moving is allowed the cache key's
 *   own {@link REFRACTION_QUANTUM}, because a lens that tracks a resize within one cell of travel
 *   is what keeps the bake rate at one raster per cell instead of one per frame.
 * @returns true when the bake is this box's lens.
 */
function fitsLens(baked: LensGeometry, box: LensGeometry, tolerance: number): boolean {
  return Math.abs(baked.width - box.width) <= tolerance
    && Math.abs(baked.height - box.height) <= tolerance
}

/**
 * The two map inputs a box change cannot report: the corner the surface is cut from, and the band
 * its lens bends across.
 *
 * Neither is a size, so no `ResizeObserver` sees either one move — and the corner is the skin's own
 * radius control, which rewrites `--lg-radius-panel` on `html` and moves every surface at once with
 * no resize anywhere. This signature is what such a change is compared against, so only the surfaces
 * whose corner actually moved are re-dressed.
 *
 * The corner in it is the radius the surface is cut at, and the third part is the corner's own
 * *shape*: the exponent the lens is baked with. A shape is not a size either — this client
 * declares it globally, so a page that switches its `corner-shape` moves every lens in the
 * document with no resize anywhere — and a lens baked from the wrong exponent is the near-miss
 * this whole path exists to prevent, so a shape change re-dresses the surfaces the same way a
 * radius change does.
 * @param corner - the corner radius, in CSS pixels.
 * @param band - the width of the bending band, in CSS pixels.
 * @param exponent - the corner exponent the lens is baked with.
 * @returns the corner, on the half-pixel grid the map key uses, the band width and the exponent.
 */
function lensSignature(corner: number, band: number, exponent: number): string {
  return `${Math.max(0, Math.round(corner * 2) / 2)}/${band}/${exponent}`
}

/**
 * The alpha of a computed background colour.
 *
 * Reading the last comma-separated component is only right for `rgba()`. The client's own
 * tokens compute to the modern `color(srgb r g b)` form, which carries no alpha component at
 * all — so the last one was the *blue* channel: the LAN bridge panel, an opaque card at
 * `color(srgb 0.21 0.21 0.22)`, measured as 22% opaque and was skipped by the overlay
 * detector for it, which is why that panel never received the material and read as plain
 * transparency. Both forms carry four components when they do have an alpha.
 * @param value - a computed background colour.
 * @returns its alpha, or 1 when the colour is opaque or unparseable.
 */
function backgroundAlpha(value: string): number {
  const open = value.indexOf('(')
  if (open < 0) return 1
  const parts = value.slice(open + 1, value.lastIndexOf(')')).split(/[,s/]+/).filter((piece) => piece.length > 0)
  const alpha = parts.length > 3 ? Number.parseFloat(parts[3]) : 1
  return Number.isFinite(alpha) ? alpha : 1
}

/** Read a numeric custom property off a computed style, falling back when it is unset. */
function styleNumber(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const parsed = Number.parseFloat(style.getPropertyValue(name))
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * The lenses the refracting surfaces wear, one per geometry.
 *
 * A lens map belongs to a *shape*. The band has to be the same width all the way round
 * the rounded rectangle the surface actually is, so a sidebar and a composer card cannot
 * share one map — a square map stretched over a wide card bends the middle of its long
 * edges and its corners by different amounts, which reads as a wobble rather than an
 * edge. A card that grows as it is typed into cannot keep one map either. So the map, and
 * the filter that samples it, are baked per geometry, quantised to a few pixels so that a
 * resize does not bake a map per pixel, and the stylesheet is handed the id through an
 * inline `--lg-refraction` on the element itself. A box that changes *after* it was
 * dressed is re-dressed by one shared observer, so the lens follows the box it belongs to
 * and not the first box the surface happened to have — and a *corner* that changes without its
 * box, which is what the skin's one radius control does, is re-dressed by the token watch
 * below, because a radius is not a size and the observer never reports it.
 *
 * The numbers come back *out* of the stylesheet — `--lg-refract-band`,
 * `--lg-refract-bend` and `--lg-refract-chroma` are read from the element's computed
 * style — so the design stays in CSS and only the geometry comes from here.
 */
class RefractionVault {
  private readonly entries = new Map<string, RefractionEntry>()

  /**
   * The rasters, keyed by the surface's shape alone: the box, the corner radius and the band.
   *
   * Nothing an optics value can change appears in this key and nothing else can change the map, so
   * every optics tuple over one shape shares one raster.
   */
  private readonly maps = new Map<string, RefractionMap>()

  /** Maps whose image has decoded, so handing one over cannot draw nothing. */
  private readonly decoded = new Set<string>()

  /** Maps currently decoding, so one burst of surfaces shares a single decode. */
  private readonly decoding = new Map<string, Promise<void>>()

  /** The one observer every dressed surface is registered with. */
  private watcher: ResizeObserver | undefined

  /** Surfaces whose box changed, waiting for this frame's single re-dress. */
  private readonly pending = new Set<HTMLElement>()

  /**
   * What the resize path has seen of each surface: when its box last changed, and how many
   * changes in a row.
   *
   * One change is a resize and is dressed exactly, on the spot. A second change inside the hold
   * window means the box is still moving, so the surface tracks its box from the cache instead —
   * one raster per quantisation cell of travel rather than one per frame. The record is what makes
   * that decision, and every writer of a lens reads it, so a sweep that happens to land mid-
   * animation cannot make the surface bake for the box it is passing through.
   */
  private readonly seen = new Map<HTMLElement, { at: number; burst: number }>()

  /**
   * The corner and band each dressed surface was last dressed for.
   *
   * This map is also the set the radius path re-reads: every surface the vault has ever dressed is
   * in it, and one that has left the document is dropped from it in the same pass, so the set
   * cannot grow with the menus a session opens and closes.
   */
  private readonly worn = new Map<HTMLElement, string>()

  /** What re-reads the corners: a radius is not a box, so no `ResizeObserver` reports it moving. */
  private tokenWatch: MutationObserver | undefined

  /** Frame handle for that pass; nothing schedules one when nothing changed. */
  private pendingFrame: number | undefined
  private host: SVGElement | undefined
  private serial = 0

  constructor() {
    this.watchTokens()
  }

  /**
   * Watch the two places a radius token can move: the document element, which carries the skin's
   * tokens inline (the theme control writes them there, and so does the shell's own frame), and the
   * head, where a stylesheet that redefines them is mounted.
   *
   * The callback re-reads a computed corner per dressed surface and schedules a pass only when one
   * of them differs from the corner its lens was baked for, so a mutation that moved no geometry
   * costs a style read and arms no frame of its own.
   */
  private watchTokens(): void {
    /* v8 ignore next -- node e2e boots the client tree without a document */
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    this.tokenWatch = new MutationObserver(() => { this.onTokenMutation() })
    const hosts: Array<Element | null> = [document.documentElement, document.body]
    for (const host of hosts) {
      /* v8 ignore next -- a document with no body has no dressed surface in it either */
      if (host !== null) this.tokenWatch.observe(host, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] })
    }
    if (document.head !== null) this.tokenWatch.observe(document.head, { childList: true, subtree: true, characterData: true })
  }

  /**
   * The document element's inline style text the light writer last left there, or undefined when
   * the last style mutation was not the light's.
   *
   * The pointer light rewrites one custom property on the document element every frame it moves,
   * and a style mutation on `html` is also how the theme's radius control and the shell's own
   * frame arrive — so the cheap discriminator runs first, and the full pass below only runs when
   * the document element's inline style is not the string the light wrote. While the pointer
   * moves, that is one string comparison per frame instead of a computed corner per dressed
   * surface, which is what keeps a moving pointer off the lens path entirely.
   */
  private lightWrite: string | undefined

  /**
   * Record the light's own write, so its next mutation is recognised as its own.
   * @param styleText - the document element's inline style text right after the write.
   */
  noteLightWrite(styleText: string): void {
    this.lightWrite = styleText
  }

  /** One token mutation: the light's own writes are not a geometry change, everything else is. */
  private onTokenMutation(): void {
    if (this.lightWrite !== undefined && document.documentElement.getAttribute('style') === this.lightWrite) return
    this.lightWrite = undefined
    this.redressForShape()
  }

  /**
   * Re-dress the surfaces whose corner or band is no longer the one their lens was baked for.
   *
   * Read-only until something differs: a corner comes out of the computed style, which costs no
   * layout, so this cannot turn an unrelated mutation into a bake. The surfaces that did move are
   * handed to the same one-pass-per-frame path a resize uses.
   */
  private redressForShape(): void {
    for (const [element, signature] of [...this.worn]) {
      if (!element.isConnected) { this.worn.delete(element); continue }
      if (this.signatureOf(getComputedStyle(element)) !== signature) this.pending.add(element)
    }
    this.schedule()
  }

  /**
   * The corner and band a surface is cut at *now*.
   *
   * The corner is the nominal radius the stylesheet names, because a shaped surface's own
   * `border-radius` has stood down to zero; a surface that names none — the client's dialog — falls
   * back to the radius it was first dressed at, and only a surface that has never been dressed falls
   * back to its computed `border-radius`. Reading this costs no layout, which is what keeps the
   * token watch read-only until something actually differs.
   * @param element - the surface.
   * @param style - its computed style.
   * @returns the signature compared against {@link worn}.
   */
  private signatureOf(style: CSSStyleDeclaration): string {
    return lensSignature(
      Number.parseFloat(style.borderTopLeftRadius) || 0,
      styleNumber(style, '--lg-refract-band', REFRACTION_BAND),
      cornerExponentOf(style.getPropertyValue(CORNER_SHAPE_PROPERTY)),
    )
  }

  /** Ensure every refracting surface in the document wears a lens of its own shape. */
  dressAll(): void {
    /* v8 ignore next -- node e2e boots the client tree without a document */
    if (typeof document === 'undefined') return
    for (const element of document.querySelectorAll<HTMLElement>(REFRACTING_SURFACES)) this.dress(element)
  }

  /** Ensure one surface wears a lens of its current shape and parameters. */
  dress(element: HTMLElement): void {
    this.dressElement(element)
  }

  /**
   * Ensure one surface wears a lens for the box it has now.
   *
   * @param element - the surface to dress.
   */
  private dressElement(element: HTMLElement): void {
    const box = element.getBoundingClientRect()
    if (box.width < 12 || box.height < 12) return
    const style = getComputedStyle(element)
    const band = styleNumber(style, '--lg-refract-band', REFRACTION_BAND)
    const bend = styleNumber(style, '--lg-refract-bend', REFRACTION_BEND)
    const chroma = styleNumber(style, '--lg-refract-chroma', REFRACTION_CHROMA)
    const blur = styleNumber(style, '--lg-blur', 0)
    const saturate = styleNumber(style, '--lg-saturate', 100) / 100
    /* The corner this surface is cut at, as the stylesheet draws it: its radius, and the *shape* of
     * it — the exponent of the continuous family `corner-shape` names, or 2 on an engine that does
     * not know the property, where the corner really is a circular arc. Reading both here is what
     * makes the lens follow the boundary instead of the other way round: the client declares one
     * shape for the whole application, so this is the same number for every surface, and a page
     * that changes it re-dresses every surface through the token watch below. */
    const radius = Math.min(Number.parseFloat(style.borderTopLeftRadius) || 0, Math.min(box.width, box.height) / 2)
    const exponent = cornerExponentOf(style.getPropertyValue(CORNER_SHAPE_PROPERTY))
    /* What this element is dressed for, so a later mutation can tell whether its corner moved. */
    this.worn.set(element, lensSignature(radius, band, exponent))
    /* The map is baked for the element's *exact* box and placed over that same box; only the
     * cache key is rounded.
     *
     * Baking for a rounded box — which is what this did at a quantum of eight pixels — put the
     * map's own boundary up to 4px away from the element's. Measured: the composer card is
     * really 774.40x114.00 while its map was placed at 776x112, so the rim overhung the right
     * edge by 1.6px, stopped 2px short of the bottom edge, and reached the bottom corners as an
     * arc of the wrong radius — which is exactly what "the edge does not line up at the
     * corners" is. The radius was rounded to a 4px grid on top of that, so a 14px corner was
     * drawn as a 12px one.
     *
     * The key stays coarse so that a dragged window does not bake a filter per pixel; two
     * surfaces inside one quantum then share a bake, which at a quantum of two pixels is a
     * sub-pixel difference rather than a visible one. */
    const quantise = (value: number): number => Math.max(REFRACTION_QUANTUM, Math.round(value / REFRACTION_QUANTUM) * REFRACTION_QUANTUM)
    const geometry = { width: box.width, height: box.height,
      radius: Math.max(0, Math.round(radius * 2) / 2), band, exponent }
    const shape = `${quantise(box.width)}x${quantise(box.height)}r${Math.round(radius * 2) / 2}b${band}`
    const key = `${shape}q${bend}c${chroma}f${blur}s${saturate}`
    const record = this.seen.get(element)
    /* A surface the resize path has watched move more than once, and move recently, is mid-
     * animation: it is handed the cache's own quantisation, so one raster covers the whole cell it
     * is passing through. Everything else — a box that changed once, a box that settled, a surface
     * that was never resized, every sweep's own pass — is held to a pixel of nothing. */
    const tolerance = record !== undefined && record.burst > 1
      && performance.now() - record.at <= REFRACTION_HOLD_MS
      ? REFRACTION_QUANTUM
      : REFRACTION_FIT_SLACK
    const map = this.mapFor(shape, geometry, tolerance)
    /* What the lens was baked for, published on the surface beside the corner it describes: a probe
     * reads these two numbers off the element (and off its computed style) and compares them with
     * the fit it recovers from the corner's own pixels. Two writes that only happen when the number
     * moves, so a static surface pays nothing. */
    const nominalLabel = `${geometry.radius}px`
    if (element.style.getPropertyValue(CORNER_NOMINAL_PROPERTY) !== nominalLabel) element.style.setProperty(CORNER_NOMINAL_PROPERTY, nominalLabel)
    const exponentLabel = String(exponent)
    if (element.style.getPropertyValue(CORNER_EXPONENT_PROPERTY) !== exponentLabel) element.style.setProperty(CORNER_EXPONENT_PROPERTY, exponentLabel)
    let entry = this.entries.get(key)
    /* A matching key is a *shape family*, not this box. The quantisation exists so a dragged
     * edge does not bake a filter per pixel, which means a settled surface routinely shares its
     * key with the box it was baked for while it was still moving — and the map is placed over
     * the exact box, not the quantised one. So a cached bake that no longer fits is re-baked
     * under the same key rather than handed over: the key keeps the cache bounded (one entry per
     * family, so this replaces the entry in use instead of evicting it), and the bake is what
     * makes the lens equal the control. Measured on the sidebar account menu before this: the
     * settled 76px box wore the 144x82.67 map baked for the 82.67px box the animation passed
     * through, a 6.7px overhang that no later dress could correct, because the later dress was
     * a key hit on that same stale bake. */
    /* The filter is rebuilt when it is missing, and when the raster under it has been replaced —
     * an optics change finds both the key and the raster it names already there, so the surface
     * swaps to a filter that samples the map it is already wearing, in the same frame, with no
     * bake, no encode and no decode in between. */
    if (entry === undefined || entry.map !== map) {
      entry = this.buildFilter(geometry, map, bend, chroma, blur, saturate)
      this.entries.set(key, entry)
      // Oldest first: a window dragged around bakes a filter per step it passes, and only
      // the shapes still on screen are worth keeping.
      while (this.entries.size > REFRACTION_CACHE) {
        const oldest = this.entries.keys().next()
        if (oldest.done === true) break
        this.entries.delete(oldest.value)
      }
    }
    const value = `url(#${entry.id})`
    // R349: only write the marker when it is not already there. This runs for every dressed surface on every frame, and
    // an unguarded `dataset.x = ''` is a DOM mutation even when the value is identical: measured in the live page, the
    // rail alone took 2,340 `data-lg-square` and 390 `data-lg-refract` attribute writes in 6 s (~450/s). Writes nobody can
    // see are not free - each one invalidates style and can make a title re-render look like it flickers.
    if (element.hasAttribute('data-lg-refract') === false) element.dataset.lgRefract = ''
    /* The lens is a `data:` PNG inside an SVG filter, and a resource that has not decoded yet
     * draws *nothing* — the whole filter's output is empty, so the surface is not merely
     * un-bent, it is flat. Handing the declaration over before the map can be drawn therefore
     * replaces the surface's frost with nothing for as long as the decode takes, and the
     * surface visibly pops: the sidebar's "more" flyout was captured opening as a flat panel
     * and turning to glass a moment later, which is what "the refraction arrives late" is.
     *
     * So the property is only set once the map is decoded. Until then a surface that has no
     * lens yet keeps the plain frost the stylesheet gives it — the same material minus the bend
     * — and one that already wears a lens keeps *that* lens, however stale its box, because a
     * lens that overhangs by a few pixels is a lens and no lens at all is a pop-in. Once a map
     * has decoded, every later surface that shares it switches in the same frame. */
    if (entry.map.url === '' || this.decoded.has(entry.map.url)) {
      if (element.style.getPropertyValue(REFRACTION_PROPERTY) !== value) element.style.setProperty(REFRACTION_PROPERTY, value)
      this.watch(element)
      return
    }
    /* A surface whose box settled keeps the lens it already wears until the new map can be
     * drawn — it is never taken away. That is the same gate from the other side: the property
     * still only ever carries a decoded map, and now a re-dress cannot cost a surface its lens
     * for the frames the decode takes. Measured on a surface grown 20px: one frame of plain
     * frost with the property removed, none without it. */
    if (!this.decoding.has(entry.map.url)) {
      const probe = new Image()
      probe.src = entry.map.url
      const ready = typeof probe.decode === 'function' ? probe.decode().catch(() => undefined) : Promise.resolve()
      this.decoding.set(entry.map.url, ready.then(() => { this.decoded.add(entry.map.url); this.decoding.delete(entry.map.url) }))
    }
    void this.decoding.get(entry.map.url)?.then(() => {
      if (!element.isConnected) return
      if (element.style.getPropertyValue(REFRACTION_PROPERTY) !== value) element.style.setProperty(REFRACTION_PROPERTY, value)
    })
    this.watch(element)
  }

  /**
   * Register a dressed surface with the one observer, so a box that changes later re-dresses it.
   *
   * Called from {@link dress} rather than from a sweep of its own: every surface the vault has
   * ever dressed is exactly the set whose box a lens belongs to, and an element that has left
   * the document is unobserved by the callback below, so the observer's own size is the size of
   * the material on screen.
   * @param element - the surface just dressed.
   */
  private watch(element: HTMLElement): void {
    /* v8 ignore next -- node e2e boots the client tree without a document, and in a document without a ResizeObserver there is no resize path to have */
    if (typeof ResizeObserver === 'undefined') return
    if (this.watcher === undefined) this.watcher = new ResizeObserver(entries => { this.onResize(entries) })
    this.watcher.observe(element)
  }

  /**
   * Collect the surfaces whose box changed, and re-dress them once, on the next frame.
   *
   * A resize callback runs inside the same rendering update as the frame's animation callbacks
   * and before the paint, so a surface marked here is dressed again in the frame its box changed.
   * The set is what makes this one pass per frame rather than one per record — a layout animation
   * that moves a box on every frame collapses into a single pass for that frame — and nothing
   * schedules a frame while the set is empty, so this adds no loop of its own: the observer
   * callback is the only new trigger.
   * @param entries - the boxes that changed since the last pass.
   */
  private onResize(entries: readonly ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const element = entry.target as HTMLElement
      /* A surface that has left the document reports a zero box, and holding it here would hold
       * it in memory: the lens of a panel that is gone is not worth re-baking. */
      if (!element.isConnected) { this.watcher?.unobserve(element); continue }
      this.pending.add(element)
    }
    this.schedule()
  }

  /** Arm one pass for the next frame, while there is anything left for it to do. */
  private schedule(): void {
    if (this.pendingFrame !== undefined) return
    if (this.pending.size === 0 && this.seen.size === 0) return
    /* v8 ignore next -- a document with a ResizeObserver has requestAnimationFrame */
    if (typeof requestAnimationFrame !== 'function') { this.flushPending(); return }
    this.pendingFrame = requestAnimationFrame(() => { this.pendingFrame = undefined; this.flushPending() })
  }

  /**
   * One pass over the surfaces whose box changed, and over those that have stopped changing.
   *
   * A surface that reports a box on two consecutive passes is mid-animation and holds the lens it
   * wears; one whose box moved and then stopped is dressed for the box it has. The pass re-arms
   * itself only while something is still moving, so a resize that has settled costs one bake —
   * for its settled box — and leaves no frame loop behind.
   */
  private flushPending(): void {
    const reported = [...this.pending]
    this.pending.clear()
    const now = performance.now()
    const seenNow = new Set<HTMLElement>()
    for (const element of reported) {
      if (!element.isConnected) { this.watcher?.unobserve(element); this.seen.delete(element); continue }
      const previous = this.seen.get(element)
      this.seen.set(element, previous !== undefined && now - previous.at <= REFRACTION_HOLD_MS
        ? { at: now, burst: previous.burst + 1 }
        : { at: now, burst: 1 })
      seenNow.add(element)
      this.dressElement(element)
    }
    for (const [element, record] of [...this.seen]) {
      if (seenNow.has(element) || now - record.at <= REFRACTION_HOLD_MS) continue
      /* Out of the window and not moving any more: the record is dropped *before* the dress, so
       * this pass — the first that knows the box has settled — is the one that bakes for it
       * exactly. That bake is the fix for the measured 6.7px overhang. */
      this.seen.delete(element)
      if (!element.isConnected) { this.watcher?.unobserve(element); continue }
      this.dressElement(element)
    }
    this.schedule()
  }

  /** The `<defs>` every filter and map image is appended to, created on first use. */
  private defsHost(): Element | undefined {
    return this.host?.firstElementChild ?? undefined
  }

  /** Remove every lens, and every trace of one from the surfaces that wore it. */
  destroy(): void {
    /* v8 ignore next -- node e2e boots the client tree without a document */
    if (typeof document === 'undefined') return
    for (const element of document.querySelectorAll<HTMLElement>('[data-lg-refract]')) {
      delete element.dataset.lgRefract
      element.style.removeProperty(REFRACTION_PROPERTY)
      element.style.removeProperty(CORNER_NOMINAL_PROPERTY)
      element.style.removeProperty(CORNER_EXPONENT_PROPERTY)
    }
    this.host?.remove()
    this.host = undefined
    this.entries.clear()
    this.maps.clear()
    this.pending.clear()
    this.seen.clear()
    this.worn.clear()
    this.tokenWatch?.disconnect()
    this.tokenWatch = undefined
    if (this.pendingFrame !== undefined) {
      /* v8 ignore next -- paired with the requestAnimationFrame above */
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.pendingFrame)
      this.pendingFrame = undefined
    }
    this.watcher?.disconnect()
    this.watcher = undefined
  }

  /**
   * The raster for one shape, baked once and shared by every optics tuple placed over it.
   *
   * The map is a function of the box, the corner radius and the band — the displacement profile
   * reads nothing else — so an optics change reuses the map it already has, and only a box the
   * cached raster no longer fits is baked again.
   * @param key - the shape's cache key, which carries no optics.
   * @param geometry - the box to bake for, when a bake is needed.
   * @param tolerance - how far the cached raster may be from this box and still fit it.
   * @returns the raster, cached or freshly baked.
   */
  private mapFor(key: string, geometry: LensGeometry, tolerance: number): RefractionMap {
    const existing = this.maps.get(key)
    if (existing !== undefined && fitsLens(existing.geometry, geometry, tolerance)) return existing
    const map: RefractionMap = { url: buildDisplacementMap(geometry).url, geometry }
    this.maps.set(key, map)
    /* Oldest first, but never the raster just baked and never one a live filter still samples: a
     * re-dress that replaces a raster must not take the entry in use out from under the surface
     * still wearing it. */
    while (this.maps.size > REFRACTION_MAP_CACHE) {
      let dropped = false
      for (const [candidate, value] of this.maps) {
        if (value === map || this.filterUses(value)) continue
        this.maps.delete(candidate)
        dropped = true
        break
      }
      if (!dropped) break
    }
    return map
  }

  /** Whether a live filter still samples one raster. */
  private filterUses(map: RefractionMap): boolean {
    for (const entry of this.entries.values()) if (entry.map === map) return true
    return false
  }

  /**
   * Build one lens filter: the graph that bends the backdrop with this shape's raster.
   *
   * The graph bends the backdrop three times, once per channel, by slightly different
   * amounts — the fringing that gives a thick pane away, and the one cue a blurred
   * backdrop cannot imitate. Its *centre* is left untouched: the map's blue channel is the
   * bend's magnitude, which is what the graph reads to build the rim's mask, so the bend
   * and the fringe both stop where the pane stops bending and the flat middle is the
   * backdrop the rest of the material was tuned against.
   */
  private buildFilter(geometry: LensGeometry, map: RefractionMap, bend: number, chroma: number, blur: number, saturate: number): RefractionEntry {
    const ns = 'http://www.w3.org/2000/svg'
    if (this.host === undefined) {
      const host = document.createElementNS(ns, 'svg')
      host.setAttribute('width', '0')
      host.setAttribute('height', '0')
      host.setAttribute('aria-hidden', 'true')
      host.setAttribute('data-plugin', PLUGIN_ID)
      /* Which vault served this page, readable from a probe: the client bundle is served from
       * disk on every load, so "did the reload pick up my edit" is otherwise a guess. */
      host.setAttribute('data-lg-lens-revision', LENS_REVISION)
      host.style.position = 'fixed'
      host.style.pointerEvents = 'none'
      const defs = document.createElementNS(ns, 'defs')
      host.appendChild(defs)
      /* Deliberately *not* hidden: a filter's `<image>` map is a resource the renderer has
       * to load, and a hidden subtree does not load it — the map arrives empty, the
       * displacement becomes a no-op and the pane keeps its frost while the lens silently
       * does nothing. Zero-sized, off the flow and non-interactive is enough. */
      document.body.appendChild(host)
      this.host = host
    }
    const id = `${REFRACTION_FILTER_ID}-${this.serial += 1}`
    const filter = document.createElementNS(ns, 'filter')
    filter.setAttribute('id', id)
    // The region is the element's own box: the map is stretched over exactly that, so a
    // widened region would scale the map with it and move the rim off the edge.
    filter.setAttribute('x', '0%')
    filter.setAttribute('y', '0%')
    filter.setAttribute('width', '100%')
    filter.setAttribute('height', '100%')
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    /* The primitives below place the map by numbers in the surface's own coordinate system,
     * so say so explicitly rather than lean on the attribute default. */
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse')
    const round = (value: number): number => Math.round(value * 100) / 100
    const make = (tag: string, attributes: Record<string, string>): SVGElement => {
      const node = document.createElementNS(ns, tag)
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
      return node
    }
    /* The map is placed by *numbers in the surface's own user space*, and that placement is
     * the whole difference between a lens and a plain pane. `feImage` has no intrinsic idea
     * of the element it filters, and with `primitiveUnits="userSpaceOnUse"` a percentage in
     * its `width`/`height` resolves against the viewport of the SVG that holds the defs —
     * which is the `0 0` box this module mounts on `body`. The map therefore arrived as a
     * degenerate subregion: the whole bending branch of the filter produced nothing while the
     * frost, a CSS-level stage, still ran, so the material looked plausible and only the lens
     * was missing. Measured on the composer card, one row across the rim, same map and same
     * bend, only this attribute changed: `100%` moves the backdrop edge 0.0px, the numbers
     * `0 0 <width> <height>` move it with the bend. `xlink:href` is set beside `href`
     * because a filter's image reference is written that way in every example of this
     * technique worth copying. */
    const xlink = 'http://www.w3.org/1999/xlink'
    const channel = (from: string, into: string, colour: number): string =>
      `<feColorMatrix in="${from}" type="matrix" values="${colour === 0 ? 1 : 0} 0 0 0 0  0 ${colour === 1 ? 1 : 0} 0 0 0  0 0 ${colour === 2 ? 1 : 0} 0 0  0 0 0 1 0" result="${into}"/>`
    if (map.url !== '') {
      /* Every primitive is created in the SVG namespace. This is the whole reason the
       * refraction did nothing for so long: the graph used to be assigned through
       * `filter.innerHTML`, and `innerHTML` on an SVG element parses its markup as HTML —
       * the filter primitives came out in the HTML namespace, the renderer ignored them,
       * and the filter behaved as an empty one, i.e. as the identity. The material still
       * looked plausible because everything else in the declaration (frost, saturate) is a
       * CSS filter function, and only the SVG half was silently missing. Measured: the same
       * graph built with `createElementNS` bends the backdrop where `innerHTML` did not. */
      const primitives: Array<[string, Record<string, string>]> = [
        /* The frost and the colour are stages of *this* filter, not functions beside it in the
         * CSS declaration. That is not tidiness: on the surface the browser renders, a
         * `backdrop-filter` whose list is `blur() saturate() url(#…)` applies the two CSS
         * functions and silently ignores the filter, so the lens never ran — while the same
         * filter as `url(#…)` alone moves the backdrop. Measured on the composer card, one
         * region, toggling one declaration: `url(#flatMapShift)` alone changes the pixels,
         * the identical url inside the chain does not. */
        ['feGaussianBlur', { in: 'SourceGraphic', stdDeviation: `${round(Math.max(0, blur) / 2)}`, result: 'frost' }],
        ['feColorMatrix', { in: 'frost', type: 'saturate', values: `${round(saturate)}`, result: 'tinted' }],
        ['feImage', { href: map.url, x: '0', y: '0', width: `${round(geometry.width)}`, height: `${round(geometry.height)}`, preserveAspectRatio: 'none', result: 'map' }],
        ['feDisplacementMap', { in: 'tinted', in2: 'map', scale: `${round(bend * (1 + chroma))}`, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bentRed' }],
        ['feDisplacementMap', { in: 'tinted', in2: 'map', scale: `${round(bend)}`, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bentGreen' }],
        ['feDisplacementMap', { in: 'tinted', in2: 'map', scale: `${round(bend * (1 - chroma))}`, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bentBlue' }],
        ['feColorMatrix', { in: 'bentRed', type: 'matrix', values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'redChannel' }],
        ['feColorMatrix', { in: 'bentGreen', type: 'matrix', values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'greenChannel' }],
        ['feColorMatrix', { in: 'bentBlue', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', result: 'blueChannel' }],
        ['feBlend', { in: 'greenChannel', in2: 'blueChannel', mode: 'screen', result: 'cyanChannel' }],
        ['feBlend', { in: 'redChannel', in2: 'cyanChannel', mode: 'screen', result: 'bent' }],
        /* The bent glass is the whole output, and the edge highlight is *not* in this filter.
         *
         * It used to be: a line read from the map's edge channel and screened on top. The
         * problem is resolution. The map is raster — 512 texels across a 774px card is about
         * 1.5px per texel, so a 28px corner spans roughly eighteen texels, and a highlight
         * traced through it is visibly stepped however finely it is baked. A stylesheet can
         * draw the same line vectorially with an inset ring, which follows any radius exactly
         * at any size, and the material already had one. So the filter keeps what only a filter
         * can do — bend the backdrop — and the rim comes from the surface's own inset ring. */
      ]
      for (const [tag, attributes] of primitives) {
        const node = make(tag, attributes)
        if (tag === 'feImage') node.setAttributeNS(xlink, 'xlink:href', map.url)
        filter.appendChild(node)
      }
    }
    this.host.firstElementChild?.appendChild(filter)
    return { id, map }
  }
}

/** Delay before a mutation burst is followed by one layout sweep. */
const SWEEP_DELAY_MS = 400

/** Widest box still treated as a one-to-one control rather than a text button. */
const SQUARE_MAX_EDGE = 48

/** Attribute tagging the composer's seat, the element whose own fade the material replaces. */
const SEAT_FLAG = 'lgSeat'

/** Custom property carrying the measured lip below the composer card, in pixels. */
const SEAT_LIP_PROPERTY = '--lg-composer-lip'

/**
 * A menu surface, by the two semantic hooks the client gives one: the ARIA role, and the
 * `data-menu-material` flag its own `MenuSurface` writes on the same element. Never a
 * generated class name — a rebuild renames those, and the stylesheet's own menu rule keys on
 * `data-menu-material` for the same reason.
 */
const MENU_SURFACES = '[role="menu"], [data-menu-material]'

/** The three roles a menu row can carry. */
const MENU_ROWS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'

/**
 * Custom property carrying one menu row's measured inset from its own menu, in pixels.
 *
 * A geometry, not a radius: the stylesheet reads it beside `--lg-radius-panel` and computes the
 * concentric corner itself, so the theme's radius control moves the rows with the panel without
 * this engine running at all.
 */
const MENU_INSET_PROPERTY = '--lg-menu-inset'

/**
 * The modal dialog, by the semantic hook the stylesheet uses for the same element.
 *
 * `aria-modal="true"` is what tells this client's settings dialog — the one surface the skin
 * materialises that is a *container* rather than a pane — apart from every other `role="dialog"` it
 * draws, the 会话统计 popover among them. The stylesheet's own rules key on the same pair of
 * attributes, so the sweep has to as well: entry for entry, the two lists describe one set.
 */
const MODAL_DIALOGS = '[role="dialog"][aria-modal="true"]'

/** What inside a modal dialog can carry a corner of its own: the dialog's own chrome controls. */
const DIALOG_CONTROLS = 'button, a[href], input, select, textarea'

/**
 * Custom property carrying one dialog control's measured ring inset inside its dialog, in pixels.
 *
 * A geometry, not a radius, for the same reason {@link MENU_INSET_PROPERTY} is one: the stylesheet
 * reads it beside `--lg-radius-card` and computes the concentric corner itself, so the theme's
 * radius control moves the dialog's chrome with the dialog without this engine running at all.
 */
const DIALOG_INSET_PROPERTY = '--lg-dialog-inset'

/**
 * Attribute marking a control the concentric rule covers, written beside {@link DIALOG_INSET_PROPERTY}.
 *
 * Presence is membership, and membership is the measurement: a control inside the dialog's own
 * chrome ring. The attribute exists because a stylesheet cannot select on a custom property.
 */
const DIALOG_INSET_FLAG = 'lgDialogInset'

/**
 * Widest ring inset still inside a modal dialog's own chrome.
 *
 * The chrome is measured, not assumed: the dialog's navigation rows sit 12px inside its left edge,
 * its header's action button 20px inside its top edge, its close button 14px inside its right edge —
 * while the pages it shows put their content inside a scrolling column, whose controls measure rings
 * of 5..17px that move with the scroll offset rather than with the layout. 20px is the widest of the
 * chrome's own insets, so it is where the chrome ends and the content begins.
 */
const DIALOG_RING_MAX = 20

/** Column width, in pixels, at or above which the sidebar is in its expanded layout. */
const SIDEBAR_WIDE_MIN = 120

/** Attribute marking an overlay panel the material would cover: measured now, styled when it is trusted. */
const OVERLAY_FLAG = 'lgOverlay'

/**
 * Attribute marking a panel that brought glass of its own, so the stylesheet *adapts* it.
 *
 * Written beside {@link OVERLAY_FLAG} and read by one rule of the stylesheet, which gives such
 * a panel the skin's corner, the skin's popover grade and a lens rather than leaving the
 * client's own material on a surface every skinned surface around it disagrees with. It is
 * sticky, for the reason {@link overlayCandidate} records.
 */
const CLIENT_GLASS_FLAG = 'lgClientGlass'

/**
 * Whether a panel is written inside a surface this stylesheet already covers, and stays
 * within it.
 *
 * A `fixed` panel is positioned against the viewport rather than against its parent, so
 * "whose child is it" says nothing about what it floats over — being *inside* a covered
 * surface's own box does. The distinction is not academic: plugins portal their popovers
 * into containers of their own instead of into `body`, and those panels matched neither of
 * the two popover tests, so they were never tagged — they came out translucent and nothing
 * else, which is exactly how the LAN bridge panel read. Measured on that panel (fixed,
 * 360x529, fill `rgba(248,249,250,0.58)`, no backdrop filter of its own): before this test
 * it carried no `data-lg-surface` and no lens at all.
 * @param node - the panel.
 * @param box - its own box, already measured by the caller.
 * @returns true when a covered ancestor's box contains the panel.
 */
function insideCoveredSurface(node: HTMLElement, box: DOMRect): boolean {
  const host = node.parentElement?.closest<HTMLElement>(COVERED_SURFACES) ?? null
  if (host === null) return false
  const outer = host.getBoundingClientRect()
  const slack = 1
  return box.left >= outer.left - slack && box.right <= outer.right + slack
    && box.top >= outer.top - slack && box.bottom <= outer.bottom + slack
}

/**
 * What one sweep makes of a panel.
 *
 * `plain` is the panel this material draws from nothing, `client-glass` is a panel that
 * arrived already wearing a filter of the client's own and is therefore adapted rather than
 * repainted, and `undefined` is not a panel at all.
 */
type OverlayKind = 'plain' | 'client-glass' | undefined

/** Smallest overlay panel worth materialising, in CSS pixels. */
const OVERLAY_MIN_WIDTH = 140

/** Shortest overlay panel worth materialising, in CSS pixels. */
const OVERLAY_MIN_HEIGHT = 100

/**
 * Least opaque a candidate's own fill may be and still count as a panel.
 *
 * The test exists to separate a panel from a layout container, and half-opaque was too strict a
 * way to draw that line: the client's own popup tokens resolve to a *45%* fill, and plugins that
 * borrow them inherit it — the LAN bridge panel is exactly that, `rgba(67, 69, 74, 0.45)`, and
 * it was skipped for it. That panel is one of ours, and it read as "just transparency" because
 * the material never arrived: no fill of ours, no frost, no lens. A third of the backdrop is
 * enough to make the panel the thing being looked at rather than the page behind it.
 */
const OVERLAY_MIN_ALPHA = 0.3

/**
 * Whether an absolutely positioned panel leaves the surface it is nested in.
 *
 * The nearest surface this stylesheet covers is the box the panel was written inside, so a
 * panel that stays within it is part of that surface — a pane, a field, a preview — and one
 * that leaves it is floating over the surface, which is a popover. Nothing about class
 * names or roles is needed for that, only two rectangles.
 * @param node - the panel.
 * @param box - its own box, already measured by the caller.
 * @returns true when its box is not contained by its host surface's box.
 */
function escapesItsSurface(node: HTMLElement, box: DOMRect): boolean {
  const host = node.parentElement?.closest<HTMLElement>(COVERED_SURFACES) ?? null
  if (host === null) return false
  const outer = host.getBoundingClientRect()
  const slack = 1
  return box.left < outer.left - slack || box.right > outer.right + slack
    || box.top < outer.top - slack || box.bottom > outer.bottom + slack
}

/**
 * Everything a rule of this stylesheet already covers, so nothing is glassed inside glass.
 *
 * This list must mirror the stylesheet's own surface list, character for character where it
 * matters: entry for entry, `[role="dialog"][aria-modal="true"]` is what the stylesheet
 * materialises, and writing the bare `[role="dialog"]` here made the OpenCode Go usage
 * panel skip itself — it is a non-modal `role="dialog"`, so the sweep counted it as already
 * covered while no rule of ours was touching it.
 */
const COVERED_SURFACES = [
  '[data-composer-card]',
  '[data-slot="sidebar"]',
  '[role="dialog"][aria-modal="true"]',
  '[data-lg-surface]',
  '[class*="_material_"]',
  '[class*="scrollBody"]',
].join(', ')

/**
 * The room's light: the pointer's direction, written on the document as one angle.
 *
 * The engine's whole share of it is one property. A pointer move only records two coordinates —
 * no style work, no measurement — and arms at most one animation frame for the burst; that frame
 * computes one angle from the pointer to the middle of the window, and writes {@link LIGHT_PROPERTY}
 * once, and only when the direction has actually moved. A still pointer therefore costs a
 * listener and nothing else, and a moving one costs one style write per frame whatever the
 * pointer's own event rate is. Everything the material does with it — the lit edge's side, the
 * highlight's offset, the occlusion line on the opposite edge — is derived in the stylesheet, so
 * this is the top of the cost as well as the bottom.
 *
 * A *direction* and not a position, deliberately: one light in the room means every surface
 * agrees on which of its edges is lit, which is what a write on the document element can express.
 * The alternative — each surface lit from the pointer's own direction to itself — needs a write
 * per surface per frame, and makes two panes side by side disagree about where the light is.
 *
 * The vault's token watch is told about its writes (see {@link RefractionVault.noteLightWrite}),
 * so a frame spent on the light can never be mistaken for a surface whose shape moved.
 */

/**
 * R468 - the pointer's own light as ONE page-level disc.
 *
 * The first attempt painted a radial gradient on each surface's ::after with background-attachment: fixed. That cannot
 * work here: every surface carries backdrop-filter, and a filter (or backdrop-filter) turns its element into the
 * containing block for fixed-position and fixed-attachment descendants - so the gradient centre was resolved in the
 * surface's own box (measured: the composer's ::after had the gradient, and two captures with the pointer in different
 * places were pixel-identical).
 *
 * One overlay instead: a fixed, pointer-events-none disc that follows the cursor with a transform (compositor-only, no
 * layout), blended with plus-lighter so it adds light rather than covering content. It is centred exactly on the
 * pointer - the person's words: 以鼠标为中心，一定半径圈内的边缘有相关效果.
 */
/**
 * R469 - the light a glass surface may show is an EDGE light, never a fill.
 *
 * R468 put a page-level disc under the cursor; it added light to the middle of surfaces too, which is wrong for this
 * material ("非边缘地区永不发光才对"). This class therefore does the opposite: it never draws anything itself. It tells
 * each surface two numbers - where the pointer is in the surface's own box, and how close it is to any edge - and the
 * stylesheet turns those into an inset rim highlight masked by distance. The interior cannot glow because the paint is
 * an inset box-shadow (edge band only) and the mask fades to transparent away from the pointer.
 *
 * Cost: n getBoundingClientRect reads and 3 custom-property writes per surface per animation frame, n = the handful of
 * surfaces the skin dresses. No layout is forced (no style is read back), and a still pointer costs one listener.
 */
class PointerRimLight {
  /** Events seen, frames run, surfaces written, readable from a probe. */
  readonly counters = { moves: 0, frames: 0, surfaces: 0 }

  private frame: number | undefined
  private x = 0
  private y = 0

  private readonly onMove = (event: PointerEvent): void => {
    this.counters.moves += 1
    this.x = event.clientX
    this.y = event.clientY
    if (this.frame === undefined) this.frame = requestAnimationFrame(this.flush)
  }

  private readonly flush = (): void => {
    this.frame = undefined
    this.counters.frames += 1
    const attribute = document.documentElement.getAttribute(STYLE_ATTRIBUTE)
    if (attribute === null || attribute === OFFICIAL_STYLE_ID) return
    if (typeof document === 'undefined') return
    const surfaces = document.querySelectorAll<HTMLElement>(SURFACE_SELECTOR)
    const radius = 220
    for (const surface of surfaces) {
      const rect = surface.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      if (rect.bottom < -radius || rect.top > window.innerHeight + radius || rect.right < -radius || rect.left > window.innerWidth + radius) continue
      const localX = this.x - rect.left
      const localY = this.y - rect.top
      /* Distance to the nearest edge, floored at 0: outside the box the rim still lights the facing edge for one
       * radius, which is what makes the highlight travel along an edge as the pointer approaches it. */
      const dx = Math.max(0, -localX, localX - rect.width)
      const dy = Math.max(0, -localY, localY - rect.height)
      const distance = Math.hypot(dx, dy)
      const near = Math.max(0, Math.min(1, 1 - distance / radius))
      surface.style.setProperty('--lg-pointer-lx', localX.toFixed(1) + 'px')
      surface.style.setProperty('--lg-pointer-ly', localY.toFixed(1) + 'px')
      surface.style.setProperty('--lg-near', near.toFixed(3))
      this.counters.surfaces += 1
    }
  }

  /** Follow the pointer for as long as the plugin is applied. */
  install(): () => void {
    if (typeof window === 'undefined') return () => {}
    window.addEventListener('pointermove', this.onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', this.onMove)
      if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    }
  }
}

class PointerLight {
  /** What the pointer cost, readable from a probe: events seen, frames run, properties written. */
  readonly counters = { moves: 0, frames: 0, writes: 0, skipped: 0, disabled: 0 }

  private frame: number | undefined
  private x = 0
  private y = 0
  private written: number | undefined
  /** Last coordinates actually written as the pointer position (R467). */
  private pointerX: number | undefined
  private pointerY: number | undefined

  /**
   * @param note - told the document element's inline style text after each write, so the vault can
   *   tell the light's own writes from a style change that moved a geometry.
   */
  constructor(private readonly note: (styleText: string) => void) {}

  private readonly onMove = (event: PointerEvent): void => {
    this.counters.moves += 1
    this.x = event.clientX
    this.y = event.clientY
    /* At most one frame per burst: the coordinates are overwritten until it runs, so a pointer
     * reporting at 500Hz costs the same as one reporting at 60. */
    if (this.frame === undefined) this.frame = requestAnimationFrame(this.flush)
  }

  private readonly flush = (): void => {
    this.frame = undefined
    this.counters.frames += 1
    /* Nothing reads the light while another material is worn, so nothing is written for one. */
    const attribute = document.documentElement.getAttribute(STYLE_ATTRIBUTE)
    if (attribute === null || attribute === OFFICIAL_STYLE_ID) { this.counters.disabled += 1; return }
    /* R467: the pointer's POSITION goes out before the direction, and it is written even when the direction has not
     * moved: the material now lights a disc around the cursor (a fixed-attachment radial gradient reading these two
     * lengths), so a pointer travelling along the same angle still has to move its light. One style write each, only
     * past a 1px threshold. */
    if (this.pointerX === undefined || Math.abs(this.x - this.pointerX) >= 1 || this.pointerY === undefined || Math.abs(this.y - (this.pointerY ?? 0)) >= 1) {
      this.pointerX = this.x
      this.pointerY = this.y
      document.documentElement.style.setProperty(POINTER_X_PROPERTY, this.x + 'px')
      document.documentElement.style.setProperty(POINTER_Y_PROPERTY, this.y + 'px')
      this.counters.writes += 1
    }
    const angle = Math.atan2(this.x - window.innerWidth / 2, window.innerHeight / 2 - this.y) * 180 / Math.PI
    if (this.written !== undefined && Math.abs(angle - this.written) < LIGHT_DEADBAND) { this.counters.skipped += 1; return }
    this.written = angle
    document.documentElement.style.setProperty(LIGHT_PROPERTY, `${Math.round(angle * 100) / 100}deg`)
    this.counters.writes += 1
    this.note(document.documentElement.getAttribute('style') ?? '')
  }

  /**
   * Start following the pointer.
   * @returns the disposer removing the listener, the counters and the global they are read from.
   */
  install(): () => void {
    /* v8 ignore next -- node e2e boots the client tree without a window */
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
    /* Passive: the light never wants the event's default, and claiming otherwise would put this
     * listener in the way of the client's own scrolling. */
    window.addEventListener('pointermove', this.onMove, { passive: true })
    const host = window as unknown as Record<string, unknown>
    host.__lgLight = this.counters
    return () => {
      window.removeEventListener('pointermove', this.onMove)
      // v8 ignore next -- paired with the requestAnimationFrame in onMove
      if (this.frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame)
      this.frame = undefined
      delete host.__lgLight
    }
  }
}

/**
 * Tag the layout facts the stylesheet cannot express, and keep them current.
 *
 * Three facts, each measured rather than matched against a generated class name:
 *
 * - **Square controls** get `data-lg-square`, so one-to-one controls are round
 *   instead of carrying whatever radius their own module happened to set. A
 *   control's shape is a property of the rendered layout, and a new icon button
 *   would otherwise keep a square corner beside rounded ones.
 * - **The sidebar's expanded column** gets `data-lg-wide`. The float and its gutter
 *   apply only there: the 56px rail lays out 36px control boxes against 10px of
 *   padding, so any gutter at all would clip them. The tag is measured because the
 *   rail class arrives only after the collapse settles, and the column is
 *   re-resolved on every sweep because it does not exist yet when this plugin
 *   applies — the client mounts its shell afterwards.
 * - **The composer's seat** gets `data-lg-seat` and a measured
 *   `--lg-composer-lip` — how far the card's bottom sits above the seat's own.
 *   The seat is the element that fades the conversation out before it reaches the
 *   composer, a gradient that only makes sense over an opaque card and that a
 *   translucent one turns into a visible seam (see the stylesheet). Replacing it
 *   needs the lip, and no stylesheet can read a descendant's box: the seat is
 *   found from the card and its geometry is published for the stylesheet to
 *   consume. The card is watched directly, because a composer that grows under a
 *   typed line changes the lip without a child-list mutation.
 *
 * The page is a live conversation: nodes arrive continuously while a response
 * streams, so a burst of mutations is followed by one batched sweep rather than
 * one sweep per mutation.
 * @returns the disposer stopping the sweep.
 */
function trackLayoutFacts(dressRefraction: () => void): () => void {
  /* v8 ignore next -- node e2e boots the client tree without a document */
  if (typeof document === 'undefined') return () => {}
  let observed: HTMLElement | undefined
  let resize: ResizeObserver | undefined

  let observedCard: HTMLElement | undefined
  let seatResize: ResizeObserver | undefined

  const sidebarColumn = (): HTMLElement | undefined =>
    document.querySelector<HTMLElement>('[data-slot="sidebar"]')?.parentElement ?? undefined

  const composerCard = (): HTMLElement | undefined =>
    document.querySelector<HTMLElement>('[data-composer-card]') ?? undefined

  /**
   * Mark the seat the composer floats on and publish the lip under the card.
   *
   * The seat paints the client's own fade — transparent to the opaque page colour
   * across its first 36px — and it carries no stable attribute of its own, so it is
   * located from the card's hook by measurement: the nearest ancestor carrying a
   * background *image* is the wrapper the fade is declared on, because the fade is a
   * gradient and the client's own wrappers between the card and it paint nothing.
   * scripts/probe-composer-fade.mjs asserts that the element found this way is the one
   * the client's rule names, so a wrapper that started painting a gradient of its own
   * would fail the gate rather than quietly take the material's rule.
   *
   * The lip is the part of the seat the card does not cover. The stylesheet keeps the
   * client's fade only there, where it is a fade and not a seam.
   */
  const markComposerSeat = (): void => {
    const card = composerCard()
    if (card === undefined) return
    let seat: HTMLElement | null = card.parentElement
    while (seat !== null && seat !== document.body && getComputedStyle(seat).backgroundImage === 'none') {
      seat = seat.parentElement
    }
    if (seat === null || seat === document.body) return
    seat.dataset[SEAT_FLAG] = ''
    const lip = seat.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom
    seat.style.setProperty(SEAT_LIP_PROPERTY, `${Math.max(0, Math.round(lip))}px`)
  }

  /** Watch the card itself, so a composer growing under a typed line keeps its lip. */
  const watchCard = (): void => {
    if (typeof ResizeObserver === 'undefined') return
    const card = composerCard()
    if (card === undefined || card === observedCard) return
    seatResize?.disconnect()
    seatResize = new ResizeObserver(() => { markComposerSeat(); dressRefraction() })
    seatResize.observe(card)
    observedCard = card
  }

  const markWidth = (): void => {
    const column = sidebarColumn()
    if (column === undefined) return
    const wide = column.getBoundingClientRect().width >= SIDEBAR_WIDE_MIN
    if (wide) column.dataset.lgWide = ''
    else delete column.dataset.lgWide
    // The column animates between the two widths without a child-list mutation, so
    // its own size is watched directly; the watch follows the element if the shell
    // ever replaces it.
    if (column !== observed && typeof ResizeObserver !== 'undefined') {
      resize?.disconnect()
      resize = new ResizeObserver(() => { markWidth() })
      resize.observe(column)
      observed = column
    }
  }

  const markSquares = (): void => {
    for (const node of document.querySelectorAll<HTMLElement>('button, [role="button"]')) {
      const box = node.getBoundingClientRect()
      const square = box.width > 0 && box.width <= SQUARE_MAX_EDGE && Math.abs(box.width - box.height) <= 2
      if (square) {
        if (node.hasAttribute('data-lg-square') === false) node.dataset.lgSquare = ''
      } else if (node.hasAttribute('data-lg-square') === true) {
        delete node.dataset.lgSquare
      }
    }
  }

  /**
   * Publish each menu row's own inset from its menu, so the stylesheet can cut the row
   * concentric with the panel it sits in.
   *
   * A menu surface owns the skin's corner, and a row inside it should be that corner pulled in by
   * the row's inset — Apple's concentricity rule, inner = max(0, outer − inset). The *inset* is
   * the one number a stylesheet cannot read, because it is a child's box measured against its
   * parent's, so the fact is measured here and published as `--lg-menu-inset`; the radius stays a
   * `var()` of the theme token in the stylesheet, which is what makes the user's own radius
   * control move the rows with the panel without a pass of this engine.
   *
   * The inset taken is the horizontal one — `min(left, right)` — because a row is a wide box
   * whose corners are cut at its own left and right edges; the client's menus pad uniformly, so
   * left and right agree. Measuring instead of assuming 4px is what keeps the rule true of a menu
   * that does not pad like the account menu; measured, both the account menu and the sidebar's
   * 更多 flyout are a `padding: 4px` surface whose rows are inset 4px on every side, and the
   * account menu's `signedOutMenu` variant — which pads its own rows 8px 10px — sits in the same
   * `padding: 4px` surface.
   * @param root - the subtree to mark, or the document for a full pass.
   * @param includeRoot - whether `root` itself may be a menu surface.
   */
  const markMenuRows = (root: ParentNode, includeRoot = false): void => {
    const menus = [...root.querySelectorAll<HTMLElement>(MENU_SURFACES)]
    if (includeRoot && root instanceof HTMLElement && root.matches(MENU_SURFACES)) menus.unshift(root)
    for (const menu of menus) {
      const box = menu.getBoundingClientRect()
      /* A collapsed or not-yet-laid-out menu measures nothing, and an inset of 0 would be read
       * as "the row is the panel" — so a box smaller than a row is skipped rather than published. */
      if (box.width < 1 || box.height < 1) continue
      for (const row of menu.querySelectorAll<HTMLElement>(MENU_ROWS)) {
        const item = row.getBoundingClientRect()
        const inset = Math.max(0, Math.min(item.left - box.left, box.right - item.right))
        const value = `${Math.round(inset * 10) / 10}px`
        if (row.style.getPropertyValue(MENU_INSET_PROPERTY) !== value) row.style.setProperty(MENU_INSET_PROPERTY, value)
      }
    }
  }

  /**
   * Publish each of a dialog's own controls' ring inset, so the stylesheet can cut them concentric
   * with the dialog they sit in.
   *
   * The dialog follows the skin's corner — the card term — and a control it lays out at its own edge
   * has to be that corner pulled in by the control's own inset: Apple's concentricity rule,
   * inner = max(0, outer − inset), the same relation {@link markMenuRows} publishes the fact for. The
   * inset is the smallest distance from the control's box to the dialog's — the ring the control's
   * corners are cut in — and it is the one number a stylesheet cannot read, because it is a child's
   * box measured against its parent's.
   *
   * Membership is that measurement rather than a class name. A control whose ring is wider than
   * {@link DIALOG_RING_MAX} is a page's *content* rather than the dialog's chrome, and a control
   * inside a box that really scrolls is content by construction: its ring is a function of the scroll
   * offset, so refitting it would cut a corner that changed while the page was scrolled. Both keep
   * the radius their own design gives them — which is what every settings page's cards, tiles and
   * fields measured.
   * @param root - the subtree to mark, or the document for a full pass.
   * @param includeRoot - whether `root` itself may be a modal dialog.
   */
  const markDialogControls = (root: ParentNode, includeRoot = false): void => {
    const dialogs = [...root.querySelectorAll<HTMLElement>(MODAL_DIALOGS)]
    if (includeRoot && root instanceof HTMLElement && root.matches(MODAL_DIALOGS)) dialogs.unshift(root)
    for (const dialog of dialogs) {
      const box = dialog.getBoundingClientRect()
      /* A dialog that is not laid out measures nothing, and a ring measured against a degenerate box
       * would be a number about nothing. */
      if (box.width < 1 || box.height < 1) continue
      for (const control of dialog.querySelectorAll<HTMLElement>(DIALOG_CONTROLS)) {
        const own = control.getBoundingClientRect()
        const inset = own.width < 4 || own.height < 4
          ? Number.NaN
          : Math.min(own.left - box.left, box.right - own.right, own.top - box.top, box.bottom - own.bottom)
        if (!Number.isFinite(inset) || inset < 0 || inset > DIALOG_RING_MAX || scrollsBetween(control, dialog)) {
          /* Only what this pass wrote is ever taken back, so a control the stylesheet cut for
           * another reason is left alone. */
          if (control.hasAttribute(DIALOG_INSET_FLAG)) {
            delete control.dataset[DIALOG_INSET_FLAG]
            control.style.removeProperty(DIALOG_INSET_PROPERTY)
          }
          continue
        }
        const value = `${Math.round(inset * 10) / 10}px`
        if (!control.hasAttribute(DIALOG_INSET_FLAG)) control.dataset[DIALOG_INSET_FLAG] = ''
        if (control.style.getPropertyValue(DIALOG_INSET_PROPERTY) !== value) control.style.setProperty(DIALOG_INSET_PROPERTY, value)
      }
    }
  }

  /**
   * Whether a box that scrolls sits between a control and the dialog it is in.
   *
   * The client lays a dialog's pages out in a scrolling column, so a control inside one has no fixed
   * relation to the dialog's corner at all: its ring is whatever the scroll offset makes it, and
   * marking it would cut a corner that changed while the page was scrolled. Only a box that really
   * scrolls counts — the navigation's list is `overflow: auto` too and measures the same client height
   * and scroll height, so its rows are chrome.
   * @param control - the control being measured.
   * @param dialog - the dialog it is inside.
   * @returns true when a scrolling box sits between them.
   */
  const scrollsBetween = (control: HTMLElement, dialog: HTMLElement): boolean => {
    const scrolling = /^(auto|scroll|hidden)$/
    for (let node = control.parentElement; node !== null && node !== dialog; node = node.parentElement) {
      if (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1) continue
      const style = getComputedStyle(node)
      if (scrolling.test(style.overflowY) || scrolling.test(style.overflowX)) return true
    }
    return false
  }

  /**
   * Tag the overlay panels the material would cover.
   *
   * The surfaces this stylesheet names are the ones the client is known to draw glass
   * with; other plugins bring their own popovers, titled panels and readers, and those
   * arrive with a plain opaque fill and no material at all. Rather than guess their
   * class names, the *fact* is measured: a panel is an element that is positioned, sits
   * above the page, is big enough to be a panel rather than a pill or a tooltip, paints
   * a fill that currently hides what is behind it, carries no backdrop filter of its own,
   * and contains nothing this stylesheet already covers — so a candidate can never be a
   * layout container, and nothing is ever glassed inside glass.
   *
   * The client's own glass is the one panel that test still misses, and it misses it by
   * construction: a panel that arrives with a `backdrop-filter` of its own fails the
   * "carries no filter" line, so the engine walked past it and left it wearing the client's
   * material and radius while every skinned surface beside it wore the skin's. It is not
   * repainted — that is what once replaced an official glass with an invented darker one —
   * but adapted, and {@link classifyOverlay} is where the class is measured.
   *
   * Tagged, not styled: `data-lg-overlay` is a report, and a probe lists what it caught
   * before any of it is given a fill. Flipping the tag to `data-lg-surface` is the one
   * line that turns the report into coverage.
   */
  const markOverlaysIn = (root: HTMLElement, depth = 4): boolean => {
    let tagged = false
    const visit = (node: HTMLElement, level: number): void => {
      const kind = classifyOverlay(node)
      if (kind !== undefined) { tagOverlay(node, kind); tagged = true }
      if (level >= depth) return
      for (const child of node.children) visit(child as HTMLElement, level + 1)
    }
    visit(root, 0)
    return tagged
  }

  /** Write the tags one verdict stands for: the report, the coverage, and the class. */
  const tagOverlay = (node: HTMLElement, kind: OverlayKind): void => {
    node.dataset[OVERLAY_FLAG] = ''
    /* The report is also the coverage: an element tagged here wears the same rule any named
     * surface wears. The report flag stays so that `[data-lg-overlay]` can be listed — by a
     * probe, or by the user asking what got glassed — and so that only tags *this* sweep
     * wrote are ever removed again. */
    node.dataset.lgSurface = ''
    if (kind === 'client-glass') node.dataset[CLIENT_GLASS_FLAG] = ''
  }

  /**
   * What this sweep makes of one panel: nothing, a plain panel, or the client's own glass.
   *
   * The second class is the one the fill/backdrop tests below were never written for. A panel
   * that brings a `backdrop-filter` of its own is already glass, so it is not repainted from
   * scratch — the stylesheet adapts it — and the fact that has to travel to the stylesheet is
   * exactly the one a stylesheet cannot read: whether the element had a filter before we
   * dressed it.
   *
   * The class is named by measurement and by semantics, never by a generated class hash:
   * measured on the 会话统计 popover, it is `div.LdaeEa_panel`, `position: fixed` with `body`
   * for a parent, 300x159, `role="dialog"` with no `aria-modal`, fill `rgba(67,69,74,0.45)`,
   * `blur(40px) saturate(1.5)`, corners 16/16/16/16 — and not one `data-lg-*` anywhere on it,
   * which is why it kept the client's material and radius while every skinned surface around it
   * used the skin's. The modal dialog exemption is untouched: `aria-modal="true"` is the
   * settings dialog, and it fails this test by its own attribute.
   * @param node - the candidate.
   * @returns its class, or undefined when it is not a panel this material covers.
   */
  const classifyOverlay = (node: HTMLElement): OverlayKind => {
    const box = node.getBoundingClientRect()
    if (box.width < OVERLAY_MIN_WIDTH || box.height < OVERLAY_MIN_HEIGHT) return undefined
    if (box.width * box.height > window.innerWidth * window.innerHeight * 0.9) return undefined
    const style = getComputedStyle(node)
    /* A panel this sweep has already tagged is judged on its *shape* from then on, not on
     * those of its own properties the material itself changes.
     *
     * The three tests below are how a plain opaque popover is recognised, and the material
     * breaks all three of them the moment it is applied: the fill stops being the client's
     * opaque one and becomes ours (22% by default, 68% for a popover), and a backdrop filter
     * appears where there was none. Re-testing them would therefore revoke the tag one sweep
     * after granting it — and since the fill, the frost and the lens are all scoped to the
     * tag, the panel would fall back to whatever the client drew on its own: measured on the
     * plugin panels (the OpenCode Go usage panel and the LAN bridge panel), a translucent
     * rectangle with no frost at all, which is precisely how they read. */
    const ours = node.hasAttribute('data-lg-overlay')
    const above = Number.parseInt(style.zIndex, 10) > 0 || ours
    const opaque = backgroundAlpha(style.backgroundColor) >= OVERLAY_MIN_ALPHA || ours
    const bare = style.backdropFilter === 'none' || ours
    /* `covered` keeps glass out of glass: an element that *is* a named surface, or that
     * contains one, is not a popover of its own. The element's own `data-lg-surface` has to be
     * excluded from that test, because it is the tag this function grants — counting it made the
     * panel covered by itself, so the tag was revoked on the next pass and granted on the one
     * after: measured by asking for the verdict of the LAN bridge panel once it was tagged, it
     * had gone back to `false` with its own tag as the only reason. A panel that flickers
     * between materialised and plain is what that looks like from outside. */
    const covered = (node.matches(COVERED_SURFACES) && !node.hasAttribute('data-lg-surface'))
      || node.querySelector(COVERED_SURFACES) !== null
    /* A fixed panel is a popover when it floats *over* the page rather than sitting inside a
     * surface: portalled to the body, or written in a container of its own that is not inside a
     * covered surface, or drawn across a covered surface's edge. That last case is the LAN
     * bridge panel — fixed, 360px wide, rendered inside a narrower sidebar — and being measured
     * as "inside the sidebar" was what kept the material off it entirely: no fill of ours, no
     * frost, no lens, which is exactly how it read. What makes a panel part of a surface is
     * being contained by it, and this one is not. */
    const popover = (style.position === 'fixed'
        && (node.parentElement === document.body || !insideCoveredSurface(node, box) || escapesItsSurface(node, box)))
      || (style.position === 'absolute' && escapesItsSurface(node, box))
    /* The client's own glass: a panel that floats over the page, says it is a dialog, is not
     * the modal one, and paints a filter of its own — its own, not ours, so a surface this sweep
     * has already dressed cannot re-classify itself on the next pass.
     *
     * The fill and z-index tests are deliberately absent here: they exist to tell a panel from a
     * layout container, and a panel that brings a backdrop filter *and* a dialog role has
     * already told us which it is. What still has to hold is the two-glass guard and the
     * floating-over-the-page test, which is what keeps the client's sidebar-anchored popovers —
     * positioned inside the panel, contained by it — out of this class. */
    const clientGlass = node.getAttribute('role') === 'dialog'
      && node.getAttribute('aria-modal') !== 'true'
      && ((style.backdropFilter !== 'none' && !ours) || node.hasAttribute(CLIENT_GLASS_FLAG))
    if (popover && !covered) {
      if (bare && above && opaque) return 'plain'
      if (clientGlass) return 'client-glass'
    }
    if (node.hasAttribute(OVERLAY_FLAG)) {
      delete node.dataset[OVERLAY_FLAG]
      delete node.dataset.lgSurface
      delete node.dataset[CLIENT_GLASS_FLAG]
    }
    return undefined
  }

  /**
   * Whether a panel is one the material would cover. Retained as the boolean view of
   * {@link classifyOverlay} for the probes that ask the engine for one element's verdict.
   */
  const overlayCandidate = (node: HTMLElement): boolean => classifyOverlay(node) !== undefined

  const markOverlays = (): void => {
    /* The candidate test lives in one place — `overlayCandidate` below. This loop used to carry
     * its own copy of it, and the copy is what went stale: the LAN bridge panel was accepted by
     * `overlayCandidate` and refused by this loop, whose `popover` test still knew only the two
     * original routes. Measured by asking the engine directly — the panel's verdict was `true`
     * and a sweep left zero tags. A rule written twice is a rule that is wrong once. */
    for (const node of document.querySelectorAll<HTMLElement>('*')) {
      const kind = classifyOverlay(node)
      if (kind === undefined) continue
      tagOverlay(node, kind)
    }
  }

  const sweep = (): void => {
    markSquares()
    markMenuRows(document)
    markDialogControls(document)
    markWidth()
    markComposerSeat()
    watchCard()
    // Overlays first, then the lenses: a panel tagged in this pass has to be dressed in the
    // same pass, or it spends one debounce wearing whatever `--lg-refraction` it inherits
    // from the surface it happens to be nested in — the composer's lens, sized for the
    // composer, on a panel of a different shape.
    markOverlays()
    dressRefraction()
  }
  sweep()

  let scheduled = false
  const mutations = new MutationObserver(records => {
    /* Fast path, on the observer's own microtask — which runs before the next paint, so a
     * panel that has just been inserted wears its material on its first frame. Without it
     * the material arrived with the debounced sweep and the user watched a plain opaque
     * panel turn into glass a moment later. Only the inserted subtrees are examined, and
     * only to a few levels deep: that is where a popover's own box is, and a streaming
     * conversation adds nodes constantly, so this path has to stay cheap. */
    let tagged = false
    let shown = false
    /* A panel can also arrive by *appearing* rather than by being added. The LAN bridge panel is
     * mounted once and merely becomes visible when its button is pressed, so nothing is ever
     * inserted and a childList observer never hears about it: measured on that panel, every
     * tagging test passed — fixed, 360x497, a 45% fill, no backdrop filter of its own, no
     * covered ancestor — and it stayed untagged, with no material, only because no pass ever
     * ran. So an attribute change on an untagged element that is at least panel-sized is
     * treated as a panel appearing. The size gate is what keeps this cheap: a caret or a
     * progress bar changes its style far more often than a panel appears, and neither is a
     * panel's size. */
    for (const record of records) {
      if (record.type !== 'attributes') continue
      const target = record.target as HTMLElement
      if (target.nodeType !== 1 || !target.isConnected) continue
      if (target.hasAttribute('data-lg-overlay') || target.hasAttribute('data-lg-refract')) continue
      const box = target.getBoundingClientRect()
      if (box.width < OVERLAY_MIN_WIDTH || box.height < OVERLAY_MIN_HEIGHT) continue
      shown = true
    }
    /* A surface can also arrive *without* being a candidate for tagging, and the client's own
     * popup material is the case that matters: `_material_` already wears a `backdrop-filter`
     * of its own, so the tagging pass skips it by design and `tagged` stays false. Measured
     * on the sidebar's "more" flyout, that cost half a second: the panel appeared at 80ms with
     * the client's plain `blur(8px) saturate(…)`, the tagging pass found nothing to tag, and
     * the lens only arrived with the debounced sweep — a lens that lands after the panel it
     * belongs to is exactly what "the refraction is applied late" looks like. So the added
     * subtree is checked against the dressable list as well, and the dress runs in the same
     * microtask when either test matches. The check is on the added subtree only, so a
     * streaming conversation does not pay for a full pass on every token. */
    let dressable = false
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue
        const element = node as HTMLElement
        tagged = markOverlaysIn(element) || tagged
        /* A menu's rows are marked in this same microtask, so a flyout is already concentric on
         * its first frame instead of wearing the client's own 12px for the debounce the sweep
         * waits. Either the added node is the menu, or it is something written inside one — a row
         * that the client renders a beat after the surface. */
        const host = element.closest<HTMLElement>(MENU_SURFACES)
        if (host !== null) markMenuRows(host)
        else if (element.matches(MENU_SURFACES) || element.querySelector(MENU_SURFACES) !== null) markMenuRows(element, true)
        /* A dialog's own chrome is marked in this same microtask, so a dialog that has just been
         * opened is already concentric with its own corner on its first frame instead of wearing the
         * client's numbers for the debounce the sweep waits. */
        const modal = element.closest<HTMLElement>(MODAL_DIALOGS)
        if (modal !== null) markDialogControls(modal)
        else if (element.matches(MODAL_DIALOGS) || element.querySelector(MODAL_DIALOGS) !== null) markDialogControls(element, true)
        if (!dressable && (element.matches(REFRACTING_SURFACES) || element.querySelector(REFRACTING_SURFACES) !== null)) dressable = true
      }
    }
    if (tagged || dressable) dressRefraction()
    if (scheduled) return
    scheduled = true
    window.setTimeout(() => { scheduled = false; sweep() }, shown ? 0 : SWEEP_DELAY_MS)
  })
  /* Attributes are observed for the appearing-panel case above; they are not a reason to sweep
   * on their own, which is why the debounce is skipped only when a panel-sized element changed
   * without being added. */
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true })
  /* The sweep, reachable from the console. A panel that does not materialise is a question
   * about *this* code — which test it failed, and whether a pass ran at all — and answering it
   * from outside meant re-implementing the tests in a probe and getting a different answer.
   * Asking the engine directly is the only version of that question worth asking. */
  const debugHost = window as unknown as Record<string, unknown>
  debugHost.__lgSweep = { sweep, markOverlays, overlayCandidate, markOverlaysIn, dressRefraction, markDialogControls }
  window.addEventListener('resize', sweep)
  return () => {
    mutations.disconnect()
    resize?.disconnect()
    seatResize?.disconnect()
    window.removeEventListener('resize', sweep)
    delete sidebarColumn()?.dataset.lgWide
    for (const seat of document.querySelectorAll<HTMLElement>('[data-lg-seat]')) {
      delete seat.dataset[SEAT_FLAG]
      seat.style.removeProperty(SEAT_LIP_PROPERTY)
    }
    for (const overlay of document.querySelectorAll<HTMLElement>('[data-lg-overlay]')) {
      delete overlay.dataset[OVERLAY_FLAG]
      delete overlay.dataset.lgSurface
      delete overlay.dataset[CLIENT_GLASS_FLAG]
    }
    for (const row of document.querySelectorAll<HTMLElement>(MENU_ROWS)) row.style.removeProperty(MENU_INSET_PROPERTY)
    for (const control of document.querySelectorAll<HTMLElement>('[data-lg-dialog-inset]')) {
      delete control.dataset[DIALOG_INSET_FLAG]
      control.style.removeProperty(DIALOG_INSET_PROPERTY)
    }
  }
}

/**
 * The controls a press is listened for on.
 *
 * The set the stylesheet already treats as this material's controls — a square control the
 * sweep measured ({@link markSquares}), the client's icon and toggle buttons, and a switch —
 * so the response and the paint name one set instead of two.
 */
const PRESS_CONTROLS = [
  '[data-lg-square]',
  '[role="switch"]',
  '[class*="_iconButton"]',
  '[class*="_toggle"]',
  '[class*="_searchButton"]',
].join(', ')

/**
 * The controls a drag may *commit*: a two-state control that publishes its own state and moves a
 * thumb along a track. A press on one of these is a gesture about its value, not just about the
 * material, so the drag follows the pointer and the release decides the state.
 *
 * The set is smaller than {@link PRESS_CONTROLS} on purpose. A control with no thumb and no track
 * (the client's icon buttons, its feedback and theme buttons) has nothing to move and no half-way
 * to measure against, so a drag there is left exactly as it was: the material still deforms it,
 * and the client's own click is still the only thing that changes its state.
 */
const PRESS_TOGGLES = '[role="switch"][aria-checked], [role="checkbox"][aria-checked]'

/**
 * The token a two-state control publishes its thumb's travel along the track with.
 *
 * One number, two readers: the stylesheet paints the thumb's resting positions with it, and the
 * half-way test below measures the drag against it. A control that publishes no travel is not a
 * toggle to this engine — which is why the property is read rather than assumed.
 */
const TOGGLE_TRAVEL_PROPERTY = '--lg-switch-travel'

/**
 * Custom property carrying a dragged two-state control's thumb offset, in pixels from the
 * position its own state asks for. Positive is the way the thumb travels when it is turning on.
 */
export const PRESS_DRAG_PROPERTY = '--lg-drag-x'

/** Custom property carrying the press curve, 0 at rest and 1 while the control is held. */
export const PRESS_PROPERTY = '--lg-press'

/** Custom properties carrying how far the press has been dragged, in pixels. */
export const PRESS_X_PROPERTY = '--lg-press-x'
export const PRESS_Y_PROPERTY = '--lg-press-y'

/** Custom properties carrying the control's own scale, which the drag's velocity drives. */
export const PRESS_SX_PROPERTY = '--lg-press-sx'
export const PRESS_SY_PROPERTY = '--lg-press-sy'

/** Attribute marking the one control a press currently belongs to. */
export const PRESS_ATTRIBUTE = 'data-lg-pressing'

/**
 * Attribute marking a two-state control whose thumb this engine is currently dragging.
 *
 * It exists for one reason and is the honest one: the client's own thumb eases its transform
 * over 120ms (measured: `transition-property: transform`, `transition-duration: 0.12s`), which
 * is right for a thumb that jumps between two ends and wrong for one under a pointer — the
 * painted thumb would trail the travel by most of the drag. It is worn from the moment the
 * gesture passes the slop until the springs settle, so a tap keeps the client's easing whole.
 */
export const DRAG_ATTRIBUTE = 'data-lg-dragged'

/**
 * How far the pointer may travel and still be a press rather than a drag, in CSS pixels.
 *
 * Three, taken from the reference (液态玻璃.html line 565: `if (!moved && Math.abs(dx) > 3)`):
 * below it the pointer is a finger resting on a control, and the control must not answer, or
 * every click would carry a twitch of travel into the material.
 */
const PRESS_SLOP = 3

/**
 * How far a dragged control follows the pointer, as a share of its own size.
 *
 * The reference's own mapping is `size * Math.tanh(0.05 * travel / size)` (line 664) — a
 * control answers the first few pixels of a drag almost one-for-one and then stops moving,
 * which is what makes a long drag read as the material refusing to leave its seat rather
 * than as the control sliding away under the finger.
 */
const PRESS_FOLLOW = 0.05

/**
 * How much of its own size a held control takes as lift — the reference's `K = 4 / 48`
 * (line 640), which is the number that makes a 48px button grow 4px and a 28px control grow
 * a tenth as much in absolute terms but the same amount in proportion.
 */
const PRESS_LIFT = 4 / 48

/** Critical spring for position and press: `W = sqrt(1000)` (reference lines 408-409). */
const SPRING_POSITION = Math.sqrt(1000)

/** How fast the tracked velocity follows the measured one, per frame (reference line 495). */
const VELOCITY_SMOOTHING = 0.5

/**
 * What a velocity is divided by before it becomes a stretch.
 *
 * The reference reads it twice — `VELOCITY_DIVISOR = 10` over a per-100px-per-second velocity
 * (line 804) — and the two together put a full-stretch drag at about 1000 px/s, which is a
 * fast flick of the wrist and not a slow drag.
 */
const VELOCITY_DIVISOR = 1000

/** The largest stretch a velocity may ask for, either way (reference lines 510-511). */
const VELOCITY_STRETCH = 0.2

/**
 * One step of a critically damped spring, in closed form.
 *
 * Position and velocity after `dt` seconds, for a value `x` moving at `v` towards `target`
 * with stiffness `w`. Closed form rather than integration because the frame interval is
 * whatever the machine gives — a stepped spring's own step is the frame's, so the material
 * would move differently on a 120Hz display than on a 60Hz one.
 * @param x - current value.
 * @param v - current velocity, in units per second.
 * @param target - value the spring is heading for.
 * @param dt - frame interval, in seconds.
 * @param w - stiffness.
 * @returns the next value and velocity.
 */
function criticalStep(x: number, v: number, target: number, dt: number, w: number): [number, number] {
  const offset = x - target
  const decay = Math.exp(-w * dt)
  return [
    target + (offset * decay + (v + w * offset) * dt * decay),
    -w * offset * decay + (v + w * offset) * (decay - w * dt * decay),
  ]
}

/**
 * The press, and the drag that follows it, as one event-driven response.
 *
 * Ported from 液态玻璃.html — the state machine that file runs on every control it draws
 * (the switch at lines 487-590, the slider at 800-868, the button at 661-712, the tab lens at
 * 992-1051). What is taken is the *interaction*, not the optics: this material's light, rim
 * and lens are its own and measured, and the reference's own author describes its mouse
 * behaviour as unfinished.
 *
 * What a press does here is the one thing the material did not have: it *moves*. The control
 * lifts by {@link PRESS_LIFT} of its own size, follows the pointer by {@link PRESS_FOLLOW},
 * and stretches along the drag by the velocity it is carrying, all of it through the same
 * three springs — critical for position, the reference's own `under()` for the stretch — and
 * all of it published as custom properties, so the paint stays in the stylesheet.
 *
 * Three things are deliberately not the reference's:
 *
 * - **It never claims the pointer.** No `setPointerCapture` and no `preventDefault` on a press:
 *   the client's own focus, drag and text selection are untouched, so a press that turns into a
 *   drag still ends in whatever the client would have done without this material, and a control
 *   whose computed `transform` is not `none` is skipped outright rather than having its own
 *   motion overwritten. The one event this engine ever stops is a drag's own trailing click --
 *   see the third point, and {@link PressResponse.onClick}.
 * - **A drag on a two-state control decides its state.** Past the slop the thumb follows the
 *   pointer one for one, clamped to the track, and the release snaps by the reference's own
 *   half-way test (lines 573-577): when it crosses, the control's *own* activation is dispatched
 *   so the client, and not this material, owns the new state, and the browser's trailing click
 *   is swallowed so the state changes exactly once ({@link PressResponse.dragEnds}). A tap is
 *   untouched -- under the slop the client's own click is the whole of the answer -- and a
 *   control with no track to measure, or one that is disabled, is left alone entirely.
 * - **The loop sleeps.** The reference re-arms its frame for as long as the pointer is down
 *   (its switch `idle()` requires `!dragging && tPress === 0`, lines 520-527 and 538-539), so
 *   holding a control still costs 60 frames a second for the whole hold. Here the frame runs
 *   only while one of the springs is actually moving and is armed again by the next pointer
 *   event, so a hold that moves nothing costs no frames at all.
 */
class PressResponse {
  /** What this response cost, readable from a probe: presses, drags, frames, and holds that slept. */
  readonly counters = {
    presses: 0, drags: 0, moves: 0, frames: 0, writes: 0, slept: 0, skipped: 0,
    /** State changes dispatched through the control's own activation. */
    commits: 0,
    /** Trailing clicks of a drag, swallowed so they cannot change the state a second time. */
    swallowed: 0,
  }

  /** The control the current press belongs to; held until the springs settle. */
  private control: HTMLElement | undefined
  private pointerId = -1
  private originX = 0
  private originY = 0
  /** Where the drag asks the control to sit, in pixels from the press point. */
  private targetX = 0
  private targetY = 0
  private x = 0
  private y = 0
  private vx = 0
  private vy = 0
  /** The press curve, its velocity, and what it is heading for. */
  private press = 0
  private pressV = 0
  private targetPress = 0
  /** The drag's own velocity, smoothed, in pixels per second. */
  private speed = 0
  private speedX = 0
  private speedY = 0
  private tracking = false
  private lastX = 0
  private lastY = 0
  /** The two-state control this press may commit: its track, and the end it started from. */
  private toggle: { travel: number; base: number } | undefined
  /** Whether the next trusted click is this drag's own trailing click. */
  private swallow = false
  /** Whether the last release decided to cross the half-way line. */
  private crossed = false
  /** The control's smaller edge: the size its lift and its follow are proportions of. */
  private size = 16
  private frame: number | undefined
  private last = 0
  private reduced = false

  /**
   * @param still - whether motion is switched off for this user, measured once at install.
   */
  constructor(private readonly still: boolean) {
    this.reduced = still
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    /* One press at a time: a second pointer arriving mid-drag is the client's business, not
     * the material's, and answering it would need a second spring set. */
    if (this.control !== undefined) return
    /* Nothing reads the response while another material is worn, so nothing is started for one. */
    const attribute = document.documentElement.getAttribute(STYLE_ATTRIBUTE)
    if (attribute === null || attribute === OFFICIAL_STYLE_ID) { this.counters.skipped += 1; return }
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>(PRESS_CONTROLS) : null
    if (node === null || !node.isConnected) return
    /* A control that refuses interaction refuses the material too, and a two-state control that
     * cannot be activated must not be dragged into a state it could not be clicked into. */
    if (inert(node)) { this.counters.skipped += 1; return }
    /* A control that already carries its own transform is left alone: this response moves an
     * element that is still, and writing over a centring translate or a client animation would
     * be a defect the press could not undo. Measured, not assumed — and only the *outermost*
     * match is considered, so a control inside a transformed seat is not exempted by it. */
    if (getComputedStyle(node).transform !== 'none') { this.counters.skipped += 1; return }
    const box = node.getBoundingClientRect()
    if (box.width < 8 || box.height < 8) return
    this.counters.presses += 1
    this.control = node
    this.pointerId = event.pointerId
    this.originX = event.clientX
    this.originY = event.clientY
    this.targetX = 0
    this.targetY = 0
    this.targetPress = 1
    this.size = Math.min(box.width, box.height)
    this.lastX = this.x
    this.lastY = this.y
    this.tracking = false
    /* A new press owns the next click, so a swallow left over from a drag whose trailing click
     * never arrived cannot eat this one. */
    this.swallow = false
    this.crossed = false
    this.toggle = readToggle(node)
    node.setAttribute(PRESS_ATTRIBUTE, '')
    /* With motion switched off the pressed state is the whole response, and it is written once
     * rather than animated to: a spring the user has asked not to see is still a spring. */
    if (this.reduced) {
      this.press = 1
      this.render()
      return
    }
    this.kick()
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (this.control === undefined || event.pointerId !== this.pointerId) return
    this.counters.moves += 1
    const dx = event.clientX - this.originX
    const dy = event.clientY - this.originY
    if (!this.tracking) {
      if (Math.abs(dx) < PRESS_SLOP && Math.abs(dy) < PRESS_SLOP) return
      this.tracking = true
      this.counters.drags += 1
      /* A dragged two-state control stops easing: the thumb is under the pointer now, and the
       * engine's own spring finishes whatever the release decides. */
      if (this.toggle !== undefined) this.control?.setAttribute(DRAG_ATTRIBUTE, '')
    }
    this.targetX = dx
    this.targetY = dy
    if (this.reduced) { this.render(); return }
    this.kick()
  }

  private readonly onUp = (event: PointerEvent): void => {
    if (this.control === undefined || event.pointerId !== this.pointerId) return
    this.release(true)
  }

  /**
   * A gesture the browser took away — a cancelled pointer, a blurred window.
   *
   * It ends the press without deciding anything: a cancel is not a release, and a control that
   * was dragged half-way and then cancelled must be exactly where it was.
   */
  private readonly onCancel = (event?: PointerEvent): void => {
    if (this.control === undefined) return
    if (event !== undefined && event.pointerId !== this.pointerId) return
    this.release(false)
  }

  /**
   * End the press and let the springs take the control home.
   * @param commit - whether a drag on a two-state control may decide its state here.
   */
  private release(commit: boolean): void {
    /* Where the pointer left the control, read before the springs are told to go home: the
     * half-way test below is about the gesture that just ended, not about the return. */
    const travelled = this.targetX
    const dragging = this.tracking
    this.pointerId = -1
    this.targetPress = 0
    this.targetX = 0
    this.targetY = 0
    this.tracking = false
    if (commit && this.toggle !== undefined) this.dragEnds(dragging, travelled)
    if (this.reduced) { this.press = 0; this.settle(); return }
    this.kick()
  }

  /**
   * The end of a drag on a two-state control.
   *
   * Three things happen here and nowhere else, and they are the whole of the gesture:
   *
   * - **The half-way test decides the state.** Where the pointer asked the thumb to be is the
   *   reference's own `tf` — its starting end plus the drag, clamped to the track (line 567) —
   *   and the release snaps by the same test the reference snaps its switch by (lines 573-577:
   *   the thumb's fraction of the track, rounded by `>= 0.5` to an end). Half-way exactly
   *   *keeps* the state the control is already in, which is what that comparison means there
   *   and what it means here.
   * - **The client's own activation changes it.** The engine never writes `aria-checked`: it
   *   dispatches the same click the control already answers, so the state that changes is the
   *   client's, taken through the client's own handler — and a control that ignores clicks
   *   simply does not change.
   * - **The browser's trailing click is swallowed.** A drag that ends on the control would
   *   otherwise arrive as a click and change the state a second time — or, when the drag never
   *   crossed, change it at all. The click belongs to this gesture, so this gesture answers
   *   for it.
   *
   * The thumb is handed to the spring from where it stands, measured against the home its *new*
   * state gives it, so a commit reads as the thumb finishing its travel instead of jumping the
   * last few pixels.
   * @param dragging - whether the pointer ever travelled past the slop.
   * @param travelled - how far the pointer went, in pixels, when the press ended.
   */
  private dragEnds(dragging: boolean, travelled: number): void {
    const control = this.control
    const toggle = this.toggle
    if (control === undefined || toggle === undefined) return
    /* A tap is not a drag: below the slop the client's own click is the whole of the answer,
     * and nothing here has anything to add to it. */
    if (!dragging) return
    const travel = toggle.travel
    const asked = Math.max(0, Math.min(travel, toggle.base + travelled))
    const next = asked / travel >= 0.5 ? travel : 0
    this.crossed = next !== toggle.base
    this.x = asked - next
    this.lastX = this.x
    this.vx = 0
    this.swallow = true
    if (!this.crossed) return
    this.counters.commits += 1
    control.click()
  }

  /**
   * Swallow the trailing click of a drag.
   *
   * Capture on the window, so the click never reaches the client's own listeners: React answers
   * clicks at the root container, and stopping the event here happens before it travels down to
   * it. Only a *trusted* click that carries a click count is a pointer's click — the activation
   * this engine dispatches itself is untrusted, and a keyboard's Space or Enter arrives with a
   * count of zero — so neither can be mistaken for one and swallowed.
   */
  private readonly onClick = (event: MouseEvent): void => {
    if (!this.swallow) return
    if (!event.isTrusted || event.detail === 0) return
    this.swallow = false
    this.counters.swallowed += 1
    event.stopPropagation()
    event.preventDefault()
  }

  /** A keyboard activation is never a drag's trailing click. */
  private readonly onKey = (): void => {
    this.swallow = false
  }

  private readonly onBlur = (): void => {
    if (this.control !== undefined) this.release(false)
  }

  private readonly onFrame = (now: number): void => {
    this.frame = undefined
    const dt = Math.min((now - this.last) / 1000, 0.05)
    this.last = now
    this.counters.frames += 1
    this.step(dt)
    this.render()
    if (!this.idle()) { this.kick(); return }
    /* Settled: the springs are at their targets and nothing is moving. A press that is still
     * held keeps its pressed state — the loop simply stops until the pointer says otherwise,
     * which is the whole difference from the reference's frame-per-frame hold. */
    if (this.targetPress === 0) this.settle()
    else this.counters.slept += 1
  }

  private step(dt: number): void {
    const position = criticalStep(this.press, this.pressV, this.targetPress, dt, SPRING_POSITION)
    this.press = position[0]
    this.pressV = position[1]
    const along = criticalStep(this.x, this.vx, this.targetX, dt, SPRING_POSITION)
    this.x = along[0]
    this.vx = along[1]
    const across = criticalStep(this.y, this.vy, this.targetY, dt, SPRING_POSITION)
    this.y = across[0]
    this.vy = across[1]
    /* The velocity the stretch is made of is the *control's* own motion, smoothed the way the
     * reference smooths it (line 495) so that one jittery frame cannot flick the material. */
    const now = performance.now()
    if (this.tracking || this.pointerId !== -1) {
      const dx = (this.x - this.lastX) / dt
      const dy = (this.y - this.lastY) / dt
      this.speedX += (dx - this.speedX) * VELOCITY_SMOOTHING
      this.speedY += (dy - this.speedY) * VELOCITY_SMOOTHING
      this.speed = Math.hypot(this.speedX, this.speedY) * Math.sign(this.speedX === 0 ? 1 : this.speedX)
    } else {
      this.speedX = 0
      this.speedY = 0
      this.speed = 0
    }
    this.lastX = this.x
    this.lastY = this.y
    /* A press released mid-drag loses its velocity the way the reference's does, so the
     * control comes home rather than arriving stretched. */
    if (this.pointerId === -1 && this.targetX === 0 && this.targetY === 0) {
      this.speedX *= 0.6
      this.speedY *= 0.6
      this.speed *= 0.6
    }
  }

  /** One frame's worth of paint, as properties on the control. */
  private render(): void {
    const control = this.control
    if (control === undefined) return
    const press = Math.max(0, Math.min(1, this.press))
    const stretch = Math.max(-VELOCITY_STRETCH, Math.min(VELOCITY_STRETCH, 0.75 * this.speed / VELOCITY_DIVISOR))
    const squash = Math.max(-VELOCITY_STRETCH, Math.min(VELOCITY_STRETCH, 0.25 * this.speed / VELOCITY_DIVISOR))
    const scale = 1 + PRESS_LIFT * press
    const offsetX = this.size * Math.tanh(PRESS_FOLLOW * this.x / this.size)
    const offsetY = this.size * Math.tanh(PRESS_FOLLOW * this.y / this.size)
    control.style.setProperty(PRESS_PROPERTY, press.toFixed(3))
    control.style.setProperty(PRESS_X_PROPERTY, `${offsetX.toFixed(2)}px`)
    control.style.setProperty(PRESS_Y_PROPERTY, `${offsetY.toFixed(2)}px`)
    control.style.setProperty(PRESS_SX_PROPERTY, (scale / (1 - stretch)).toFixed(4))
    control.style.setProperty(PRESS_SY_PROPERTY, (scale * (1 - squash)).toFixed(4))
    if (this.toggle !== undefined) {
      control.style.setProperty(PRESS_DRAG_PROPERTY, this.toggleOffset().toFixed(2) + 'px')
    }
    this.counters.writes += 1
  }

  /**
   * How far the thumb of a two-state control sits from the place its own state asks for, in
   * pixels, clamped to the track.
   *
   * While the pointer is down the answer is the pointer's own travel — the drag follows the
   * finger one for one and the track is what stops it, which is what makes the control read as
   * being dragged rather than as being deformed. The way home is read against the *current*
   * state on every frame, so a commit moves the thumb's own end and leaves the rest to the
   * spring.
   * @returns the offset in pixels.
   */
  private toggleOffset(): number {
    const toggle = this.toggle
    if (toggle === undefined) return 0
    const home = this.controlHome()
    const asked = this.pointerId !== -1 && this.tracking ? this.targetX : this.x
    return Math.max(-home, Math.min(toggle.travel - home, asked))
  }

  /** Where the control's own state puts its thumb: the far end of the track, or the near one. */
  private controlHome(): number {
    const toggle = this.toggle
    if (toggle === undefined) return 0
    return this.control?.getAttribute('aria-checked') === 'true' ? toggle.travel : 0
  }

  /** Whether every spring is at its target and nothing is moving. */
  private idle(): boolean {
    return Math.abs(this.press - this.targetPress) < 0.002 && Math.abs(this.pressV) < 0.02
      && Math.abs(this.x - this.targetX) < 0.1 && Math.abs(this.y - this.targetY) < 0.1
      && Math.abs(this.vx) < 0.5 && Math.abs(this.vy) < 0.5
      && Math.abs(this.speedX) < 2 && Math.abs(this.speedY) < 2
  }

  /** Put the control back exactly as it was found, and forget it. */
  private settle(): void {
    const control = this.control
    this.control = undefined
    this.press = 0
    this.pressV = 0
    this.x = 0
    this.y = 0
    this.vx = 0
    this.vy = 0
    this.speed = 0
    this.speedX = 0
    this.speedY = 0
    if (control === undefined) return
    this.toggle = undefined
    control.removeAttribute(PRESS_ATTRIBUTE)
    control.removeAttribute(DRAG_ATTRIBUTE)
    control.style.removeProperty(PRESS_PROPERTY)
    control.style.removeProperty(PRESS_X_PROPERTY)
    control.style.removeProperty(PRESS_Y_PROPERTY)
    control.style.removeProperty(PRESS_SX_PROPERTY)
    control.style.removeProperty(PRESS_SY_PROPERTY)
    control.style.removeProperty(PRESS_DRAG_PROPERTY)
  }

  /** Arm the one frame, if it is not already armed. */
  private kick(): void {
    if (this.frame !== undefined) return
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.onFrame)
  }

  /** The current state, for a probe that has to name what a press is doing. */
  state(): Record<string, number | string | boolean> {
    return {
      press: this.press, x: this.x, y: this.y, speed: this.speed,
      sx: this.control?.style.getPropertyValue(PRESS_SX_PROPERTY) ?? '',
      sy: this.control?.style.getPropertyValue(PRESS_SY_PROPERTY) ?? '',
      dragging: this.tracking, held: this.pointerId !== -1,
      /* The two-state side of the response: what the drag may commit, where the thumb is
       * painted against its own state, and what the last release decided. */
      toggle: this.toggle === undefined ? '' : this.toggle.travel,
      home: this.controlHome(),
      thumb: this.toggle === undefined ? '' : this.toggleOffset(),
      crossed: this.crossed, swallow: this.swallow,
      /* The spring terms the loop's own sleep test reads, so a probe can name the one that kept
       * a frame alive instead of guessing at it. */
      dPress: this.press - this.targetPress, pressV: this.pressV,
      dX: this.x - this.targetX, vx: this.vx,
      speedX: this.speedX, speedY: this.speedY,
      control: this.control === undefined ? '' : `${this.control.tagName.toLowerCase()}.${String(this.control.className).slice(0, 30)}`,
    }
  }

  /**
   * Start answering presses.
   * @returns the disposer removing the listeners, the counters and the global they are read from.
   */
  install(): () => void {
    /* v8 ignore next -- node e2e boots the client tree without a window */
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
    document.addEventListener('pointerdown', this.onDown, { passive: true })
    window.addEventListener('pointermove', this.onMove, { passive: true })
    window.addEventListener('pointerup', this.onUp, { passive: true })
    window.addEventListener('pointercancel', this.onCancel, { passive: true })
    window.addEventListener('blur', this.onBlur)
    /* The one click this material ever answers: a drag's own trailing click, which would
     * otherwise be a second state change. Capture, so the client never sees it. */
    window.addEventListener('click', this.onClick, true)
    window.addEventListener('keydown', this.onKey, true)
    const host = window as unknown as Record<string, unknown>
    host.__lgPress = { counters: this.counters, state: () => this.state() }
    return () => {
      document.removeEventListener('pointerdown', this.onDown)
      window.removeEventListener('pointermove', this.onMove)
      window.removeEventListener('pointerup', this.onUp)
      window.removeEventListener('pointercancel', this.onCancel)
      window.removeEventListener('blur', this.onBlur)
      window.removeEventListener('click', this.onClick, true)
      window.removeEventListener('keydown', this.onKey, true)
      // v8 ignore next -- paired with the requestAnimationFrame in kick
      if (this.frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame)
      this.frame = undefined
      this.settle()
      delete host.__lgPress
    }
  }
}

/**
 * Whether a control refuses interaction.
 *
 * A disabled control is not a control: the browser will not focus it, click it, or let it be
 * activated, so the material must not move it either — and a two-state control that cannot be
 * activated must never be dragged into a state the client would not have written.
 * @param node - the control a press landed on.
 * @returns true when the control is disabled, aria-disabled, or read-only.
 */
function inert(node: HTMLElement): boolean {
  if (node.getAttribute('aria-disabled') === 'true') return true
  if (node.hasAttribute('disabled')) return true
  return (node as HTMLInputElement).readOnly === true
}

/**
 * The track a two-state control drags along, or undefined when it publishes none.
 *
 * The travel is read from the stylesheet's own token rather than from geometry, because the
 * stylesheet is where the thumb's two ends are decided: measuring the box back would be a second
 * opinion about the same number, and the two would drift the first time either moved. A control
 * that publishes no travel has no track this engine can measure a half-way against, and is left
 * to the client's own click.
 * @param node - the control a press landed on.
 * @returns its travel and the end its current state sits at, or undefined.
 */
function readToggle(node: HTMLElement): { travel: number; base: number } | undefined {
  if (!node.matches(PRESS_TOGGLES)) return undefined
  const travel = Number.parseFloat(getComputedStyle(node).getPropertyValue(TOGGLE_TRAVEL_PROPERTY))
  if (!Number.isFinite(travel) || travel <= 0) return undefined
  return { travel, base: node.getAttribute('aria-checked') === 'true' ? travel : 0 }
}

/**
 * Whether motion is switched off for this user.
 *
 * Read once at install rather than per frame: the answer decides whether the response animates
 * to its state or simply wears it, and a press that changed its mind halfway through is a press
 * with two behaviours.
 * @returns true when the platform asks for reduced motion.
 */
function quietMotion(): boolean {
  /* v8 ignore next -- node e2e boots the client tree without a window */
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Services this plugin needs: none beyond its own context. */
export const inject: string[] = []

/**
 * Client plugin body: provide the material service and register the built-in
 * Liquid Glass style. The style is registered here rather than by a consumer so
 * the material travels with the package that documents it.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const runtime = new LiquidGlassRuntime(ctx)
  ctx.provide('liquidGlass', runtime)
  ctx.effect(() => trackLayoutFacts(() => runtime.dressRefractingSurfaces()), 'dsh-liquid-glass: layout sweep')
  /* The room's light follows the pointer for as long as this plugin is applied. It is not tied to
   * the *active* style: the token is only read by the skin's own stylesheet, and a document
   * wearing another material is skipped at the write itself (see PointerLight.flush). */
  ctx.effect(() => new PointerLight(text => runtime.noteLightWrite(text)).install(), 'dsh-liquid-glass: pointer light')
  /* R468: the local disc under the cursor (see PointerGlow for why it is an overlay, not a per-surface gradient). */
  ctx.effect(() => new PointerRimLight().install(), 'dsh-liquid-glass: pointer rim light')
  /* The press, and the drag that follows it — the only part of this material that *moves*, and
   * the port of the reference's own interaction. Like the light, it is not tied to the active
   * style: a press arriving while another material is worn is skipped at the press itself. */
  ctx.effect(() => new PressResponse(quietMotion()).install(), 'dsh-liquid-glass: press response')
  ctx.effect(() => runtime.register({
    id: 'liquid-glass',
    label: () => 'liquid-glass',
    css: materialCss,
    refraction: true,
  }), 'dsh-liquid-glass: built-in style')
}