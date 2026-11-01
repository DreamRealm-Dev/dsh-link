/**
 * The shape every corner in the material is cut from, and the map the refraction filter samples.
 *
 * A pane of glass bends what is behind it, and it bends it most where the pane curves —
 * along its rim. The map is therefore built from the *distance to the shape* the surface
 * actually is, not from a radial profile: a radial lens stretched over a wide card puts its
 * whole bend in the middle of the long edges and twice as much in the corners, which is a
 * wobble rather than an edge. With this distance the band is the same width all the way round,
 * whatever the surface's aspect ratio, and the map is baked per surface geometry with the
 * shape's own corner radius.
 *
 * Channels, as `feDisplacementMap` and the filter graph read them: red carries the
 * horizontal displacement, green the vertical, blue the edge — a hairline on the shape's own
 * boundary, which the graph turns into the rim highlight, so the bend and the highlight both
 * come from the same baked geometry.
 *
 * The canvas → `feImage` → `feDisplacementMap` structure follows `liquid-glass-react`
 * (MIT, Copyright 2025 Max Rovensky), which bakes the same kind of map from a rounded-rect
 * distance field; see THIRD_PARTY_NOTICES.md. The per-geometry baking, the profile below,
 * the magnitude channel and the continuous corner below are this package's own.
 */

/**
 * How round a corner is: the exponent *n* of the continuous corner family
 *
 *     |x/a|ⁿ + |y/b|ⁿ = 1
 *
 * with the corner's own quarter of it (a = b = the corner radius) laid into each corner of a
 * rectangle. **This one number is the shape of every corner in this stack**: the baked
 * displacement map reads it, and it is published on the document element as
 * `--lg-corner-exponent` so the stylesheet, a probe and the shell's own frame can name the same
 * shape instead of each keeping their own opinion about what a corner is.
 *
 * **n = 2 is exactly the circular arc** — what CSS `border-radius` draws when nothing else is
 * said, and what every corner in this stack used to be. The family is continuous in n, so the
 * circular case is a limit rather than a special case and every function here reduces to the old
 * circular geometry at n = 2. Above 2 the corner is a *squircle*: at the same nominal radius the
 * curve leaves the box's corner point later and turns more gradually, so the same number of
 * pixels reads as a larger, softer corner.
 *
 * **Where 3 comes from.** This client draws its own corners with the modern CSS `corner-shape`
 * property, and declares the shape once, globally:
 *
 *     @supports (corner-shape: superellipse(1.5)) {
 *       :root { --dsw-corner-shape: superellipse(1.5); }
 *       *, ::before, ::after { corner-shape: var(--dsw-corner-shape); }
 *     }
 *
 * `corner-shape: superellipse(k)` is this family with **n = 2k**, which was measured rather than
 * assumed (a plain `border-radius` box in this renderer follows n = 2.95…3.02 at its nominal
 * radius, rms 0.08px, against 4.25px for the best circular fit; and the painted area of its
 * corner is 801px² where n = 3 predicts 795 and a circle 707). So the stack's declared shape is
 * n = 3, and this is the number the lens is baked with: the material bends along the same curve
 * the surface is cut from, which is the whole of "the glass corner is a different corner" — the
 * map used to be a circular distance field under a continuous boundary.
 *
 * Raising it is one edit: Apple's own system corners are usually described by n in the 4–5 band,
 * and `corner-shape: superellipse(2.25)` in the stylesheet plus this constant is all it takes —
 * every corner in the stack follows, because nothing else names a shape.
 */
export const CORNER_EXPONENT = 3

/** Longest map edge, in texels.
 *
 * The map carries a *normal field*, not a colour: the displacement direction rotates along a
 * rounded corner, and how fast it rotates is set by how many texels the corner spans. At 256
 * texels an 800px dialog gets 3.1 CSS px per texel, which is too coarse for a 28px corner —
 * the normals arrive in visible steps and the backdrop comes out mottled right inside the
 * corner (measured at 6x on the settings dialog: irregular bright patches along the inner
 * side of the arc, gone at 512). Doubling the edge quadruples the bake, which is why this is
 * as high as it is and no higher: the map is a smooth gradient, so it compresses well and
 * the filter cache holds a few of them.
 */
const MAP_MAX = 512

/** Shortest map edge, in texels. */
const MAP_MIN = 16

/** How far, in CSS pixels, the edge highlight reaches in from the shape's boundary. */
const RIM_LINE_WIDTH = 1.6

/** A baked map: where it is, and the pixel size it was baked at. */
export interface LensMap {
  /** The map as a PNG data URL. */
  url: string
  /** Map width in texels. */
  width: number
  /** Map height in texels. */
  height: number
}

/** One surface's geometry, as the map and the drawn corner have to be built for it. */
export interface LensGeometry {
  /** Surface width, in CSS pixels. */
  width: number
  /** Surface height, in CSS pixels. */
  height: number
  /** Corner radius, in CSS pixels; 0 for a square surface. */
  radius: number
  /** Width of the bending band inside the edge, in CSS pixels. */
  band: number
  /** Corner exponent; the continuous shape above, defaulting to {@link CORNER_EXPONENT}. */
  exponent?: number
}

/** The exponent of a geometry, defaulted. */
function exponentOf(geometry: LensGeometry): number {
  const exponent = geometry.exponent
  return Number.isFinite(exponent) && (exponent as number) >= 2 ? (exponent as number) : CORNER_EXPONENT
}

/** The corner radius a geometry can actually use, clamped to half its shortest side. */
export function cornerRadiusOf(geometry: LensGeometry): number {
  return Math.max(0, Math.min(geometry.radius, Math.min(geometry.width, geometry.height) / 2))
}

/**
 * Signed distance to the shape: negative inside, zero on the boundary, positive outside.
 *
 * Straight edges and the circular case are the classic rounded-rectangle distance — the
 * distance to the box inset by the radius, less the radius — and the corner is the
 * superellipse of {@link CORNER_EXPONENT}. In the corner square the boundary is the
 * superellipse itself, and the distance to it is taken *radially* from the corner's own
 * centre (the inner rectangle's corner): a point at (u, v) from that centre lies on the
 * boundary where `(uⁿ + vⁿ)^(1/n) = r`, and the boundary along the same ray is at
 * `r·|(u,v)| / (uⁿ + vⁿ)^(1/n)`.
 *
 * Radial rather than the exact nearest point, on purpose: it is *exact on the boundary*
 * (where `uⁿ + vⁿ = rⁿ`, the form below is zero), which is what the rim hairline and the
 * edge fade read, and it agrees with the normal at the two places the direction matters most —
 * the axes and the diagonal, where the curve is symmetric and radial *is* normal. The
 * difference between the two inside the corner is second order in the angle between them and
 * lands on the smoothstep's shape, not on where the edge is.
 *
 * At n = 2 the corner term collapses to `|(u,v)| - r` and this is exactly the old circular
 * distance field.
 * @param x - point x, in the same units as the box.
 * @param y - point y.
 * @param width - box width.
 * @param height - box height.
 * @param radius - corner radius.
 * @param exponent - corner exponent; 2 is a circular arc.
 * @returns the distance in pixels.
 */
export function shapeDistance(x: number, y: number, width: number, height: number, radius: number, exponent = CORNER_EXPONENT): number {
  const halfWidth = Math.max(0, width / 2 - radius)
  const halfHeight = Math.max(0, height / 2 - radius)
  const qx = Math.abs(x - width / 2) - halfWidth
  const qy = Math.abs(y - height / 2) - halfHeight
  /* Beside a straight edge, or with no corner at all, the classic closed form is exact. */
  if (exponent === 2 || radius <= 0 || qx <= 0 || qy <= 0) {
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
    return outside + Math.min(Math.max(qx, qy), 0) - radius
  }
  /* In the corner square. Normalised by the longer leg first so a surface metres wide cannot
   * overflow the power, and so the result is stable for the big rasters the dialog bakes. */
  const length = Math.hypot(qx, qy)
  const longest = Math.max(qx, qy)
  const ratio = Math.min(qx, qy) / longest
  const norm = longest * Math.pow(1 + Math.pow(ratio, exponent), 1 / exponent)
  return length * (1 - radius / norm)
}

/**
 * The corner exponent of a CSS \`corner-shape\` value.
 *
 * The one place the two spellings of this shape meet. \`corner-shape\` is the modern CSS
 * property (Chrome 139+) that lets a border-radius corner be drawn as a superellipse, and its
 * parameter is half this one — \`superellipse(k)\` is |x/a|^(2k) + |y/b|^(2k) = 1, so k = 1.5
 * is n = 3. That 2k relation was measured in this renderer, not taken from the spec: a plain
 * \`border-radius\` box fits n = 2.95…3.02 at its nominal radius (rms 0.08px) and its painted
 * corner area is 801px² against 795 predicted at n = 3.
 *
 * Anything that is not a continuous curve — \`round\`, \`bevel\`, \`notch\`, or an engine that
 * does not know the property at all (the computed value comes back empty) — is the circular
 * arc, n = 2, which is what such an engine draws. The lens is then baked circular too, so the
 * bend follows the boundary it is actually under on every renderer, old or new.
 * @param value - the computed \`corner-shape\` of the surface, as CSS reports it.
 * @returns the exponent the map is baked with.
 */
export function cornerExponentOf(value: string): number {
  const text = value.trim().toLowerCase()
  const superellipse = /superellipse\(\s*([0-9.]+)\s*\)/.exec(text)
  if (superellipse !== null) {
    const k = Number.parseFloat(superellipse[1])
    if (Number.isFinite(k) && k > 0) return Math.max(2, 2 * k)
  }
  /* The spec's other continuous keyword: \`squircle\` is \`superellipse(2)\`, i.e. n = 4. */
  if (text === 'squircle') return 4
  return 2
}

/**
 * Build one surface's displacement map as a PNG data URL.
 *
 * The bend rises from nothing at the band's inner boundary to its full amount at the
 * edge, following a smoothstep so that the surface and its own rim meet without a step,
 * and is directed along the edge's inward normal: the pane pulls what is behind it
 * towards its middle, which is what a thick piece of glass does.
 * @param geometry - the surface's box, corner radius, band width and corner exponent.
 * @returns the map as a data URL with the size it was baked at, or empty when the canvas
 * is unavailable. The size matters: the caller places the image in the filter's own
 * user space by these dimensions. A percentage there resolves against the viewport
 * of the SVG that holds the defs, which is the 0 0 box this module mounts,
 * so the map arrives degenerate and the bend has no effect at all.
 */
export function buildDisplacementMap(geometry: LensGeometry): LensMap {
  /* v8 ignore next -- node e2e boots the client tree without a document */
  if (typeof document === 'undefined') return { url: '', width: 0, height: 0 }
  const { width, height, band } = geometry
  const exponent = exponentOf(geometry)
  const radius = cornerRadiusOf(geometry)
  const longest = Math.max(width, height)
  const columns = Math.max(MAP_MIN, Math.min(MAP_MAX, Math.round((width / longest) * MAP_MAX)))
  const rows = Math.max(MAP_MIN, Math.min(MAP_MAX, Math.round((height / longest) * MAP_MAX)))
  const canvas = document.createElement('canvas')
  canvas.width = columns
  canvas.height = rows
  const context = canvas.getContext('2d')
  /* v8 ignore next -- a document without a 2D context cannot render the material either */
  if (context === null) return { url: '', width: 0, height: 0 }
  const image = context.createImageData(columns, rows)
  const data = image.data
  /* One texel of the map covers this many CSS pixels, and the ink is faded over that much
   * at the outermost edge so the filter never samples the map across its own boundary. */
  const step1 = longest / Math.max(columns, rows)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = ((column + 0.5) / columns) * width
      const y = ((row + 0.5) / rows) * height
      const distance = shapeDistance(x, y, width, height, radius, exponent)
      // How far into the band this point is: 0 at the band's inside, 1 on the edge.
      const into = Math.max(0, Math.min(1, 1 + distance / band))
      const eased = into * into * (3 - 2 * into)
      const edgeFade = Math.min(1, Math.max(0, -distance) / step1)
      const amount = eased * edgeFade
      // The inward normal, by central difference: the gradient of the distance field.
      const dx = shapeDistance(x + step1, y, width, height, radius, exponent) - shapeDistance(x - step1, y, width, height, radius, exponent)
      const dy = shapeDistance(x, y + step1, width, height, radius, exponent) - shapeDistance(x, y - step1, width, height, radius, exponent)
      const length = Math.hypot(dx, dy) || 1
      const normalX = dx / length
      const normalY = dy / length
      const pixel = (row * columns + column) * 4
      /* The edge line: a hairline that follows the shape, not the band.
       *
       * This channel is what the rim highlight is read from, and it used to carry the same
       * smooth amount as the bend — so the highlight was a veil across the whole band that
       * peaked about 3px *inside* the edge. A pane of glass does not light up like that: it
       * catches a line exactly on its boundary, and Apple's own material shows the same
       * thing. The channel therefore carries the distance in the last RIM_LINE_WIDTH pixels,
       * tapering linearly, which lands the highlight on the edge itself. */
      const line = Math.max(0, Math.min(1, (RIM_LINE_WIDTH - Math.abs(distance)) / RIM_LINE_WIDTH))
      data[pixel] = Math.round((0.5 - normalX * amount * 0.5) * 255)
      data[pixel + 1] = Math.round((0.5 - normalY * amount * 0.5) * 255)
      data[pixel + 2] = Math.round(line * 255)
      data[pixel + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return { url: canvas.toDataURL('image/png'), width: columns, height: rows }
}
