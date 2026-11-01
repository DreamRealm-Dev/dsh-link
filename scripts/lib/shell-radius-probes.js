/**
 * Instruments shared by the shell-radius gate.
 *
 * Two things here are deliberately not guesses. The corner radius is a
 * *quantity* — it is read off rendered pixels by fitting the quarter-circle the
 * corner draws, not by looking at it — and the app-side checks are answered by
 * the DOM, which is the only place a computed radius exists.
 */

/** A quarter-circle row model: where the paint boundary sits at row `y`. */
const boundary = (radius, y) => {
  const centre = radius - (y + 0.5)
  if (centre <= 0) return 0
  return radius - Math.sqrt(Math.max(0, radius * radius - centre * centre))
}

/**
 * Measure where a backdrop ends, one row at a time, in one corner.
 *
 * @param image - a decoded PNG.
 * @param corner - 'tl' | 'tr' | 'bl' | 'br'.
 * @param isBackdrop - predicate over [r, g, b] that is true for the colour the
 * corner is cut out of (magenta under an override, the desktop on a screen shot).
 * @param limit - how many device pixels of the corner to profile.
 * @returns the first non-backdrop column per row, in the corner's own frame.
 * A row with no non-backdrop pixel within `limit` reports `limit`.
 */
export function cornerProfile(image, corner, isBackdrop, limit = 44) {
  // The alpha travels with the sample. A window whose corners are transparent
  // comes back from a capture as RGBA with alpha 0 outside the rounding — and a
  // capture with nothing transparent in it comes back as RGB, which is itself
  // evidence. A predicate that only looked at colour would call both "painted".
  const at = (x, y) => {
    const i = (y * image.width + x) * image.channels
    return image.channels === 4
      ? [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2], image.pixels[i + 3]]
      : [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2], undefined]
  }
  const rows = []
  for (let row = 0; row < limit; row += 1) {
    let found = limit
    for (let step = 0; step < limit; step += 1) {
      const x = corner === 'tl' || corner === 'bl' ? step : image.width - 1 - step
      const y = corner === 'tl' || corner === 'tr' ? row : image.height - 1 - row
      if (!isBackdrop(at(x, y))) { found = step; break }
    }
    rows.push(found)
  }
  return rows
}

/**
 * Fit a radius to a corner profile and report the residuals.
 *
 * Two parameters, not one. A clipped corner's anti-aliased edge puts the first
 * pixel that is *not* backdrop about a pixel outside the ideal circle, and a
 * one-parameter fit pays for that bias by shrinking the radius it reports: it
 * read 14.73 CSS px for a controlled 16 px corner and 27.23 for 28, which is a
 * wrong number rather than a rounding. The `edge` term absorbs that convention,
 * so the radius that comes out is the radius that was rendered.
 *
 * @param rows - the profile from {@link cornerProfile}.
 * @param limit - the same `limit` the profile used.
 * @returns the fitted radius in device pixels, the edge bias, and residuals.
 */
export function fitRadius(rows, limit = 44) {
  let best = { radius: 0, edge: 0, total: Infinity }
  for (let radius = 0; radius <= limit - 2.5; radius += 0.05) {
    for (let edge = -2; edge <= 4.0001; edge += 0.1) {
      let error = 0
      for (let y = 0; y < rows.length; y += 1) {
        const model = rows[y] >= limit
          ? limit
          : Math.min(limit, Math.max(0, boundary(radius, y) - edge))
        error += Math.abs(model - rows[y])
      }
      if (error < best.total - 1e-9) best = { radius, edge, total: error }
    }
  }
  let worst = 0
  for (let y = 0; y < rows.length; y += 1) {
    const model = rows[y] >= limit ? limit : Math.min(limit, Math.max(0, boundary(best.radius, y) - best.edge))
    worst = Math.max(worst, Math.abs(model - rows[y]))
  }
  return {
    radius: Number(best.radius.toFixed(2)),
    edge: Number(best.edge.toFixed(1)),
    worstRow: Number(worst.toFixed(2)),
    total: Number(best.total.toFixed(1)),
  }
}

/**
 * How many pixels of a corner square are backdrop at all.
 *
 * A corner that reports zero backdrop is either a square corner or an
 * instrument looking at the wrong layer, and those two must not be confused:
 * this count is what tells them apart.
 *
 * @param image - a decoded PNG.
 * @param corner - 'tl' | 'tr' | 'bl' | 'br'.
 * @param isBackdrop - the backdrop predicate.
 * @param limit - the side of the corner square.
 * @returns the count of backdrop pixels inside that square.
 */
export function cornerBackdropCount(image, corner, isBackdrop, limit = 44) {
  return cornerProfile(image, corner, isBackdrop, limit)
    .map(row => (row >= limit ? limit : row))
    .reduce((sum, row) => sum + row, 0)
}

/**
 * The colour a region is mostly made of.
 *
 * The backdrop of a page is not where a layout happens to leave a gap: a boot
 * page that draws its own titlebar and a centred card has ink at the top and in
 * the middle, so any fixed band is a guess about someone else's layout. The
 * colour that dominates the whole region is the surface, whatever is drawn on
 * it, and the share says whether that reading is a flat surface at all.
 *
 * @param image - a decoded PNG.
 * @param x - left edge, in device pixels.
 * @param y - top edge, in device pixels.
 * @param width - region width.
 * @param height - region height.
 * @returns the dominant colour as '#rrggbb', its share of the region, how many
 * distinct colours are in it, and the region's mean for comparison.
 */
export function dominantColor(image, x = 0, y = 0, width = image.width - x, height = image.height - y) {
  const counts = new Map()
  let count = 0
  let r = 0
  let g = 0
  let b = 0
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const i = (row * image.width + column) * image.channels
      const red = image.pixels[i]
      const green = image.pixels[i + 1]
      const blue = image.pixels[i + 2]
      const key = (red << 16) | (green << 8) | blue
      counts.set(key, (counts.get(key) ?? 0) + 1)
      r += red
      g += green
      b += blue
      count += 1
    }
  }
  let dominant = 0
  let best = 0
  for (const [key, value] of counts) if (value > best) { best = value; dominant = key }
  const hex = (value) => Math.round(value).toString(16).padStart(2, '0')
  return {
    color: '#' + dominant.toString(16).padStart(6, '0'),
    share: Number((best / count).toFixed(3)),
    distinct: counts.size,
    mean: '#' + hex(r / count) + hex(g / count) + hex(b / count),
    pixels: count,
  }
}

/** True when a pixel is fully transparent: the window paints nothing there. */
export const isTransparent = ([, , , alpha]) => alpha === 0

/** True when a pixel is either transparent or the magenta the compositor was told to paint. */
export const isCut = (pixel) => isTransparent(pixel) || isMagenta(pixel)

/** True when a pixel is the magenta the compositor was told to paint. */
export const isMagenta = ([r, g, b]) => Math.abs(r - 255) <= 10 && g <= 10 && Math.abs(b - 255) <= 10

/** Corner order used everywhere in the report. */
export const CORNERS = ['tl', 'tr', 'bl', 'br']

/**
 * The app-side survey: the three tokens, and one element per grade.
 *
 * Element choice follows the skin's own selectors rather than a private guess:
 * `[data-lg-popover]` is what material.css rounds as a panel, `[data-composer-card]`
 * is the composer's card, `[data-lg-wide]` is the sidebar column the skin reshapes
 * and `[data-lg-square]` is a control it rounds with the control token.
 */
export const TOKEN_SURVEY = `(async () => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  // What the shell says about itself, next to what the app computed: the frame's
  // own radius token and palette marker are the shell's claim, and the pixels are
  // what has to agree with it.
  const shellState = () => {
    const root = getComputedStyle(document.documentElement)
    return {
      radiusToken: root.getPropertyValue('--dsh-shell-radius').trim(),
      palette: document.documentElement.getAttribute('data-shell-palette') || document.body.getAttribute('data-shell-palette') || '',
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      availableWidth: window.screen.availWidth,
      availableHeight: window.screen.availHeight,
      maximized: window.innerWidth >= window.screen.availWidth - 2 && window.innerHeight >= window.screen.availHeight - 2,
      frameStyle: !!document.querySelector('style[data-shell-frame], link[href*="frame.css"]'),
    }
  }
  const round = (node) => {
    const style = getComputedStyle(node)
    return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]
  }
  const describe = (role, node, expectedToken) => {
    const rect = node.getBoundingClientRect()
    return {
      role,
      expectedToken,
      tag: node.tagName.toLowerCase(),
      id: node.id || '',
      cls: String(node.className || '').slice(0, 70),
      attributes: Array.from(node.attributes).filter(a => a.name.startsWith('data-')).map(a => a.name).join(','),
      rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
      radius: round(node),
    }
  }
  const notes = []

  // The bridge panel is the one surface this gate has to open for itself: it
  // renders only while its own control is on.
  let openedPanel = false
  if (!document.querySelector('[data-bridge-panel="open"]')) {
    const slot = document.querySelector('[data-slot="sidebar.footer.action"]')
    const control = slot ? (slot.querySelector('button') || slot) : null
    if (control) {
      control.click()
      openedPanel = true
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && !document.querySelector('[data-bridge-panel="open"]')) await wait(100)
    } else {
      notes.push('no [data-slot="sidebar.footer.action"] control to open the bridge panel with')
    }
  }

  const probes = []
  const push = (role, node, token) => { if (node) probes.push(describe(role, node, token)); else notes.push('no element matched for ' + role) }

  push('lan-panel', document.querySelector('[data-bridge-panel="open"]') || document.querySelector('[data-bridge-panel]'), '--lg-radius-panel')
  push('composer-card', document.querySelector('[data-composer-card]'), '--lg-radius-panel')

  // The sidebar: the skin reshapes the column, and the surface it rounds is the
  // column's first child. Both are reported, so a mismatch says which one moved.
  const column = document.querySelector('[data-lg-wide]')
  const sidebar = column ? column.querySelector('[data-slot="sidebar"]') : null
  const sidebarSurface = sidebar ? sidebar.firstElementChild : null
  if (column) probes.push(describe('sidebar-column', column, '(none)'))
  push('sidebar-surface', sidebarSurface, '--lg-radius-panel')

  const control = document.querySelector('[data-lg-square]') || document.querySelector('[data-lg-seat]')
  push('control', control, '--lg-radius-control')

  const root = getComputedStyle(document.documentElement)
  const tokens = {}
  for (const name of ['--lg-radius-window', '--lg-radius-panel', '--lg-radius-control']) {
    tokens[name] = root.getPropertyValue(name).trim()
  }
  return {
    openedPanel,
    notes,
    probes,
    tokens,
    shell: shellState(),
    style: document.documentElement.getAttribute('data-lg-style'),
    inlineTokens: document.documentElement.getAttribute('style') || '',
  }
})()`

/** Read the three tokens, and the radius of every probe, on demand. */
export const TOKEN_READBACK = `(() => {
  const root = getComputedStyle(document.documentElement)
  const round = (node) => { const s = getComputedStyle(node); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius] }
  const of = (selector) => { const node = document.querySelector(selector); return node ? round(node) : null }
  return {
    shell: {
      radiusToken: root.getPropertyValue('--dsh-shell-radius').trim(),
      palette: document.documentElement.getAttribute('data-shell-palette') || document.body.getAttribute('data-shell-palette') || '',
      maximized: window.innerWidth >= window.screen.availWidth - 2 && window.innerHeight >= window.screen.availHeight - 2,
    },
    tokens: {
      window: root.getPropertyValue('--lg-radius-window').trim(),
      panel: root.getPropertyValue('--lg-radius-panel').trim(),
      control: root.getPropertyValue('--lg-radius-control').trim(),
    },
    radius: {
      'lan-panel': of('[data-bridge-panel="open"]'),
      'composer-card': of('[data-composer-card]'),
      'sidebar-surface': of('[data-lg-wide] [data-slot="sidebar"] > *'),
      control: of('[data-lg-square]') || of('[data-lg-seat]'),
    },
    inline: document.documentElement.getAttribute('style') || '',
  }
})()`
