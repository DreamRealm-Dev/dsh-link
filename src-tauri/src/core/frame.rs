//! The shell's self-drawn window frame.
//!
//! The window is undecorated and transparent (see [`super::shellprefs`]), so the title
//! bar, the border and the rounded corners are drawn by the document the window shows.
//! That document is either the official client — which the shell does not own — or the
//! shell's boot page, so the frame is two assets that are injected into both:
//!
//! - [`FRAME_CSS`], served at `/__shell/frame.css`, and
//! - [`FRAME_JS`], served at `/__shell/frame.js`.
//!
//! Both are also *inlined* when the page has to render with nothing else available: the
//! boot page is a single self-contained document by design (the kernel, and therefore
//! every other asset, may not exist when it is served), and [`super::shellpage`] stamps
//! it with the current radius and palette so the first paint is already right.
//!
//! Three things are worth knowing about how the frame works:
//!
//! **The transparent window needs the canvas to stay clear.** A page's `body` background
//! is propagated to the canvas when the root element paints none, and that canvas is a
//! square rectangle that no `border-radius` clips. So this clears both, and paints the
//! surface the user reads as "the window" on `#dsh-shell-surface` — a fixed element
//! behind everything, with the radius the shell was told to use. The rounded corner is
//! therefore antialiased by the compositor rather than by the OS: no black corner, no
//! stair-stepping, and no dependence on a DWM corner preference that only knows three
//! discrete radii.
//!
//! **The radius is CSS state, not window state.** `--dsh-shell-radius` carries it, so
//! the control endpoint's change is one property write — nothing is rebuilt, and the
//! window keeps its size, its position and its session. A maximized window draws a
//! square corner because a rounded maximized window is a bug, not a preference.
//!
//! **The corner is a shape, and it is this frame's token.** A radius says how far a
//! corner reaches; `corner-shape` says what curve gets there. This application is cut
//! with a continuous corner everywhere else (`superellipse(1.5)`, the client's own
//! `--dsw-corner-shape`), so the window's own edge is declared here — `--dsh-shell-corner-shape`
//! — and the skin reads `var(--dsh-shell-corner-shape)` for its own surfaces: one token,
//! one curve, and no way for the window's corner to be a different one from the surfaces
//! inside it. The clip that enforces it is `--dsh-shell-corner-clip`: a rounded
//! `inset()` is circular *by definition* and cannot express a shape, so the frame script
//! builds a `path()` from the radius, the shape and the window's size, and what the
//! stylesheet declares is the circular corner this window has always had — which is also
//! what an engine that cannot draw a continuous corner keeps, under `@supports not`.
//!
//! **The frame is the window's own edge.** `clip-path` on the body means nothing the
//! client draws can reach past the corner, and the drag strip and the three buttons sit
//! above the client's own stacking order so they cannot be covered by it.

/// The frame's stylesheet. Served at `/__shell/frame.css`, inlined by the boot page.
pub const FRAME_CSS: &str = r##"/* The shell's window frame. */
:root {
  --dsh-shell-radius: 12px;
  /* The corner's shape. `superellipse(k)` is |x/a|^(2k) + |y/b|^(2k) = 1 — the
     continuous corner this application is cut from on every surface inside the window —
     and `round` is the circular arc a plain `border-radius` draws. The skin reads this
     same token for its surfaces (`--lg-corner-shape`), so there is one shape in the
     document rather than two. */
  --dsh-shell-corner-shape: superellipse(1.5);
  /* How everything the document paints is clipped to that corner. `inset(… round …)` is
     circular by definition, so it cannot follow the shape above: it is where the window
     used to disagree with every surface inside it. The frame script replaces this value
     with a `path()` built from the radius, the shape and the window's own size; what is
     written here is what a document that has not been scripted yet wears, and it is the
     corner this window has always had. */
  --dsh-shell-corner-clip: inset(0 round var(--dsh-shell-radius));
  --dsh-shell-fill: #151517;
  --dsh-shell-fg: #adb2b8;
  --dsh-shell-hover: rgb(255 255 255 / 9%);
  --dsh-shell-close-hover: #e81123;
  --dsh-shell-chrome: 24px;
  --dsh-shell-gap: 12px;
  /* The panel's shadow. There is no system drop shadow: an undecorated transparent
     window has none to give, and DWM's own would be painted outside a surface that is
     not there. The depth therefore falls *inside* the window, on the band the gap opens,
     which is why this is a shadow of the client's viewport rather than of the window.
     The spread is deliberately smaller than the y-offset: a shadow that starts inside
     the panel's own box is hidden by the opaque client viewport above it and lands in
     the band as nothing at all, which is what these numbers were chosen against. */
  --dsh-shell-shadow: 0 10px 34px -6px rgb(0 0 0 / 78%), 0 2px 8px -2px rgb(0 0 0 / 50%);
}
/* The window is transparent, so the canvas must stay clear: a body background is
   propagated to it, and that canvas is a square rectangle nothing rounds. The surface
   the user reads as "the window" is #dsh-shell-surface instead. */
html, body { background: transparent !important; }
/* Everything the document draws is clipped to the frame, so a surface the client paints
   edge to edge cannot poke a square corner out of the rounded window.

   The gap is the frame the window no longer has. The client's own panels sit 12px inside
   its viewport, so without this the sidebar's edge *is* the window's edge; the distance
   the user used to see came from the system title bar and border, and it has to come from
   here now. `box-sizing: border-box` is what keeps the client's viewport inside the
   padding instead of overflowing the bottom edge, and the top also carries the drag
   strip, so no part of the client is under the title bar. */
body {
  clip-path: var(--dsh-shell-corner-clip);
  box-sizing: border-box;
  padding: calc(var(--dsh-shell-chrome) + var(--dsh-shell-gap)) var(--dsh-shell-gap)
    var(--dsh-shell-gap) var(--dsh-shell-gap);
}
#dsh-shell-surface {
  position: fixed;
  inset: 0;
  z-index: -2147483647;
  pointer-events: none;
  background: var(--dsh-shell-fill);
  border-radius: var(--dsh-shell-radius);
  /* The surface *is* the window's corner: it is what the transparent window paints where
     the corner is, one layer behind everything the client draws. It takes the shape from
     the same token as the rest of the application. An engine that does not know the
     property drops this declaration and keeps the circular `border-radius` above — which
     is exactly the corner the fallback clip below draws. */
  corner-shape: var(--dsh-shell-corner-shape);
}
/* The client's viewport, outlined by nothing but its shadow: the box the frame would have
   drawn around it if the window still had a frame. It is positioned, transparent and
   inert — the shadow is the only thing it paints — so the client's own layout is
   untouched and the depth lands in the gap band instead of outside the window. */
#dsh-shell-panel {
  position: fixed;
  top: calc(var(--dsh-shell-chrome) + var(--dsh-shell-gap));
  right: var(--dsh-shell-gap);
  bottom: var(--dsh-shell-gap);
  left: var(--dsh-shell-gap);
  z-index: -1;
  pointer-events: none;
  box-shadow: var(--dsh-shell-shadow);
}
/* The top strip is the window's title bar: the client has nothing interactive there, and
   the frame has no other way to be moved. */
#dsh-shell-drag {
  position: fixed;
  top: 0;
  left: 0;
  right: 130px;
  height: var(--dsh-shell-chrome);
  z-index: 2147483646;
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
}
#dsh-shell-chrome {
  position: fixed;
  top: 0;
  right: 0;
  height: var(--dsh-shell-chrome);
  display: flex;
  align-items: stretch;
  z-index: 2147483647;
}
#dsh-shell-chrome button {
  width: 42px;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsh-shell-fg);
  display: grid;
  place-items: center;
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
}
#dsh-shell-chrome button:hover { background: var(--dsh-shell-hover); }
#dsh-shell-chrome button:active { background: var(--dsh-shell-hover); }
#dsh-shell-chrome button:focus-visible { outline: 1px solid var(--dsh-shell-fg); outline-offset: -3px; }
#dsh-shell-chrome #dsh-shell-close:hover { background: var(--dsh-shell-close-hover); color: #ffffff; }
#dsh-shell-chrome svg { width: 11px; height: 11px; display: block; pointer-events: none; }
/* Applied by the frame script to the client's own full-viewport surface, which rounds
   itself for the same corner this frame now owns. Two roundings on one corner never
   agree — the visible arc is the smaller of the two, so a shell radius of 0 would still
   show the backdrop's 8px — and the backdrop is a rectangle inside this clip either way. */
/* The broken-backdrop rule's own corner is square for the same reason, and it is stated
   with the other corner facts rather than with the client's. */
.dsh-shell-flat { border-radius: 0 !important; }
/* An engine that cannot draw a continuous corner keeps the circular one: the same radius,
   the same clip this frame has always used, so the fallback is never worse than the window
   people already have. The *shape* is what the script reads, so a fallback document hands
   it no shape to draw and the clip above stands as written. */
@supports not (corner-shape: superellipse(1.5)) {
  :root {
    --dsh-shell-corner-shape: round;
    --dsh-shell-corner-clip: inset(0 round var(--dsh-shell-radius));
  }
}
"##;

/// The frame's behaviour. Served at `/__shell/frame.js`, inlined by the boot page.
///
/// One script serves both documents: the boot page carries the role `boot` and only
/// paints what the shell hands it, while the client's document carries `client`, which
/// additionally reports the application's own palette back so the shell's boot page can
/// follow the client rather than the operating system.
pub const FRAME_JS: &str = r##"/* The shell's window frame. See core::frame in this shell's source. */
(function () {
  'use strict'
  if (window.__dshShellFrame) { return }

  var ROLE = typeof window.__DSH_SHELL_FRAME_ROLE === 'string' ? window.__DSH_SHELL_FRAME_ROLE : 'boot'
  var MAX_RADIUS = 28
  var DEFAULT_RADIUS = 12
  var MAX_GAP = 64
  var DEFAULT_GAP = 12
  // The two boot surfaces the client's own overlay paints, so the frame, the boot page
  // and the handover between them are one colour.
  var INK = {
    dark: {
      fill: '#151517',
      fg: '#adb2b8',
      hover: 'rgb(255 255 255 / 9%)',
      // A black shadow on a near-black surface only reads if it is deep enough to be a
      // gradient rather than a line.
      shadow: '0 10px 34px -6px rgb(0 0 0 / 78%), 0 2px 8px -2px rgb(0 0 0 / 50%)'
    },
    light: {
      fill: '#ffffff',
      fg: '#61666b',
      hover: 'rgb(0 0 0 / 7%)',
      shadow: '0 10px 34px -6px rgb(0 0 0 / 40%), 0 2px 8px -2px rgb(0 0 0 / 18%)'
    }
  }
  var GLYPH = {
    minimize: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
    maximize: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
    restore: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="4" width="6.5" height="6.5" rx="1" stroke="currentColor" stroke-width="1" fill="none"/><path d="M4 4V2.5a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1H8" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
    close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1" fill="none"/></svg>'
  }

  var html = document.documentElement
  var state = { radius: DEFAULT_RADIUS, gap: DEFAULT_GAP, palette: 'dark', maximized: false }
  var maximizeButton = null
  var reported = null
  var flat = null

  function clampRadius(value) {
    var number = Number(value)
    if (!isFinite(number)) { return DEFAULT_RADIUS }
    return Math.min(MAX_RADIUS, Math.max(0, number))
  }

  /** The gap falls back to the default when it is missing or unusable, exactly as the
   *  endpoint does: the two must not disagree about what a value means. */
  function clampGap(value) {
    var number = Number(value)
    if (!isFinite(number) || number < 0 || number > MAX_GAP) { return DEFAULT_GAP }
    return number
  }

  function note(error) {
    if (error) { console.warn('[shell] frame: ' + error) }
  }

  /** How many points one corner of the clip is drawn with. A corner is ~quarter of a circle
   *  of the shell's own radius (12px by default), and 24 chords over that span sit within
   *  0.01px of the curve they approximate — far below one device pixel at any scale. */
  var CORNER_STEPS = 24

  /**
   * The exponent of the superellipse family a `corner-shape` names.
   *
   * The property's values are a shape function applied to the radius: `round` is the
   * circular arc a plain `border-radius` draws, which is n = 2 of the family
   * |x/a|^n + |y/b|^n = 1, and `superellipse(k)` is n = 2k — the continuous corner.
   * Zero means "a shape this script cannot draw", and the clip is then left to the
   * stylesheet, which is what an engine without the property gets.
   */
  function cornerExponent(shape) {
    var text = String(shape || '').trim().toLowerCase()
    if (text === 'round') { return 2 }
    var match = /^superellipse\(\s*([0-9]*\.?[0-9]+)\s*\)$/.exec(text)
    var k = match ? Number(match[1]) : NaN
    return isFinite(k) && k > 0 ? 2 * k : 0
  }

  /**
   * The window's corner as a clip path: a rounded rectangle whose corner spans are
   * superellipse arcs of the given exponent.
   *
   * `clip-path: inset(0 round …)` cannot express this — `round` is circular by definition,
   * and a circular clip cuts a continuous corner wherever the two disagree. A `path()` can,
   * so the shape is built here as a polygon of `CORNER_STEPS` chords per corner. The four
   * corners are the same arc mirrored into each quadrant: a point at parameter t is
   * (r - r·cos^p, r - r·sin^p) from the corner's centre, with p = 2/n, which is the
   * superellipse written in closed form.
   */
  function cornerPath(width, height, radius, exponent) {
    var power = 2 / exponent
    var points = ['M ' + radius.toFixed(2) + ' 0', 'L ' + (width - radius).toFixed(2) + ' 0']
    // mx: the corner hangs off the right edge; my: off the bottom one. from/to is the
    // parameter the perimeter enters and leaves that corner on, walking clockwise from the
    // top-left corner's top edge — the point the path starts at.
    var corners = [
      { mx: 1, my: 0, from: Math.PI / 2, to: 0 },
      { mx: 1, my: 1, from: 0, to: Math.PI / 2 },
      { mx: 0, my: 1, from: Math.PI / 2, to: 0 },
      { mx: 0, my: 0, from: 0, to: Math.PI / 2 }
    ]
    for (var c = 0; c < corners.length; c += 1) {
      var corner = corners[c]
      for (var step = 0; step <= CORNER_STEPS; step += 1) {
        var t = corner.from + (corner.to - corner.from) * (step / CORNER_STEPS)
        var dx = radius - radius * Math.pow(Math.cos(t), power)
        var dy = radius - radius * Math.pow(Math.sin(t), power)
        points.push('L ' + (corner.mx ? width - dx : dx).toFixed(2) + ' ' + (corner.my ? height - dy : dy).toFixed(2))
      }
    }
    points.push('Z')
    return points.join(' ')
  }

  /**
   * Write the clip that cuts the document to the window's corner.
   *
   * The shape is read from `--dsh-shell-corner-shape`, not decided here: that token is the
   * stylesheet's, it is the same one the skin cuts its surfaces from, and the fallback an
   * engine needs is its value under `@supports not` (`round`). A circular corner, a square
   * one (a zero radius, or a maximized window) and a radius too large for its own box are
   * all cases where the stylesheet's own clip is already exactly right, so the property is
   * removed and the declaration stands; only a continuous shape is a `path()`.
   */
  function clipCorner(radius) {
    var shape = ''
    try { shape = String(getComputedStyle(html).getPropertyValue('--dsh-shell-corner-shape') || '') } catch (error) { shape = '' }
    var exponent = cornerExponent(shape)
    // The corner is the *window's*, so the clip is measured in the window's own terms: the
    // viewport, not the document's box. Both are the same size in the documents this shell
    // draws into, and where they are not, the window is the one to follow -- a
    // document-sized clip would cut the frame's own fixed surfaces to the document's box,
    // and those surfaces cover the window by definition.
    if (exponent <= 2 || radius <= 0 || radius * 2 > innerWidth || radius * 2 > innerHeight) {
      html.style.removeProperty('--dsh-shell-corner-clip')
      return
    }
    html.style.setProperty('--dsh-shell-corner-clip', 'path("' + cornerPath(innerWidth, innerHeight, radius, exponent) + '")')
  }

  function snapshot() {
    return { radius: state.radius, gap: state.gap, palette: state.palette, maximized: state.maximized }
  }

  /** Write the current values onto the document. The radius is a property, not a window. */
  function paint() {
    var ink = INK[state.palette] || INK.dark
    var radius = state.maximized ? 0 : state.radius
    html.style.setProperty('--dsh-shell-radius', radius + 'px')
    html.style.setProperty('--dsh-shell-gap', state.gap + 'px')
    html.style.setProperty('--dsh-shell-fill', ink.fill)
    html.style.setProperty('--dsh-shell-fg', ink.fg)
    html.style.setProperty('--dsh-shell-hover', ink.hover)
    html.style.setProperty('--dsh-shell-shadow', ink.shadow)
    html.setAttribute('data-shell-palette', state.palette)
    html.setAttribute('data-shell-maximized', state.maximized ? '1' : '0')
    clipCorner(radius)
    flattenBackdrop()
  }

  /** Take what the shell handed over, and answer with what is now in force. */
  function apply(next) {
    if (next) {
      if (next.radius !== undefined && next.radius !== null) { state.radius = clampRadius(next.radius) }
      if (next.gap !== undefined && next.gap !== null) { state.gap = clampGap(next.gap) }
      if (next.palette === 'light' || next.palette === 'dark') { state.palette = next.palette }
      paint()
    }
    return snapshot()
  }

  /**
   * Drop the rounding the document's own full-viewport surface applies.
   *
   * The official client rounds its backdrop for exactly the corner this frame draws, and
   * the two roundings would fight: the visible arc is the smaller of them, so a shell
   * radius of 0 would still show the client's 8px and a larger one would show a softer
   * edge than either. Only the outermost element that covers the viewport is touched, so
   * a rounded surface *inside* the client keeps its own corners.
   */
  function flattenBackdrop() {
    if (!document.body) { return }
    var found = null
    var candidates = document.body.querySelectorAll('div')
    for (var i = 0; i < candidates.length; i += 1) {
      var element = candidates[i]
      // This surface is the frame's own, not the client's backdrop. It carries the
      // window's corner itself (radius + shape), so flattening it takes away the one
      // thing that still draws the corner when the script's `path()` clip is not
      // available — an engine without `clip-path: path()` would then show a square
      // window. Measured before this guard: the surface's computed radius was 0px and
      // the only element this loop matched was the surface itself, so the flatten bought
      // the client nothing and cost the frame its fallback.
      if (element.id === 'dsh-shell-surface') { continue }
      var rect = element.getBoundingClientRect()
      if (rect.width < innerWidth * 0.95 || rect.height < innerHeight * 0.95) { continue }
      if (getComputedStyle(element).borderRadius === '0px') { continue }
      found = element
      break
    }
    if (found === flat) { return }
    if (flat) { flat.classList.remove('dsh-shell-flat') }
    flat = found
    if (flat) { flat.classList.add('dsh-shell-flat') }
  }

  /** Read the persisted values back, for a document that was not stamped with them. */
  function refresh() {
    return fetch('/__shell/window', { credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) { throw new Error('GET /__shell/window: HTTP ' + response.status) }
        return response.json()
      })
      .then(function (current) { return apply(current) }, function (error) { note(error); return snapshot() })
  }

  function invoke(command) {
    var internals = window.__TAURI_INTERNALS__
    if (!internals || typeof internals.invoke !== 'function') {
      return Promise.reject(new Error('the shell IPC is not available'))
    }
    return Promise.resolve(internals.invoke(command))
  }

  function button(id, label, glyph) {
    var element = document.createElement('button')
    element.id = id
    element.type = 'button'
    element.title = label
    element.setAttribute('aria-label', label)
    element.innerHTML = glyph
    return element
  }

  /** A maximized window draws square corners: the radius is a frame, not a crop. */
  function syncMaximized() {
    return invoke('plugin:window|is_maximized').then(function (maximized) {
      state.maximized = !!maximized
      if (maximizeButton) {
        maximizeButton.innerHTML = state.maximized ? GLYPH.restore : GLYPH.maximize
        maximizeButton.title = state.maximized ? '还原' : '最大化'
        maximizeButton.setAttribute('aria-label', maximizeButton.title)
      }
      paint()
    }, function () { paint() })
  }

  function build() {
    if (!document.body || document.getElementById('dsh-shell-chrome')) { return }

    var surface = document.createElement('div')
    surface.id = 'dsh-shell-surface'

    var panel = document.createElement('div')
    panel.id = 'dsh-shell-panel'

    var drag = document.createElement('div')
    drag.id = 'dsh-shell-drag'
    // The drag itself is the platform's: the window is undecorated, so there is no
    // non-client area left to grab, and Tauri's own drag command is the one gesture that
    // behaves like a title bar (snapping, multi-monitor, the system move loop).
    drag.addEventListener('mousedown', function (event) {
      if (event.button !== 0) { return }
      event.preventDefault()
      invoke('plugin:window|start_dragging').catch(note)
    })
    drag.addEventListener('dblclick', function () {
      invoke('plugin:window|toggle_maximize').then(syncMaximized, note)
    })

    var chrome = document.createElement('div')
    chrome.id = 'dsh-shell-chrome'
    var minimize = button('dsh-shell-minimize', '最小化', GLYPH.minimize)
    maximizeButton = button('dsh-shell-maximize', '最大化', GLYPH.maximize)
    var close = button('dsh-shell-close', '关闭', GLYPH.close)
    minimize.addEventListener('click', function () { invoke('plugin:window|minimize').catch(note) })
    maximizeButton.addEventListener('click', function () {
      invoke('plugin:window|toggle_maximize').then(syncMaximized, note)
    })
    // Closing hides the window to the tray rather than ending the session — the same
    // contract the native close button has always had here.
    close.addEventListener('click', function () { invoke('plugin:window|close').catch(note) })
    chrome.appendChild(minimize)
    chrome.appendChild(maximizeButton)
    chrome.appendChild(close)

    document.body.insertBefore(surface, document.body.firstChild)
    document.body.insertBefore(panel, surface.nextSibling)
    document.body.appendChild(drag)
    document.body.appendChild(chrome)
    syncMaximized()
  }

  /** The application's palette, as the client's own theme toggle left it. */
  function readAppPalette() {
    var body = document.body
    if (!body) { return null }
    if (body.hasAttribute('data-ds-dark-theme')) { return 'dark' }
    var scheme = ''
    try { scheme = String(getComputedStyle(body).colorScheme || '') } catch (error) { scheme = '' }
    if (scheme.indexOf('dark') >= 0 && scheme.indexOf('light') < 0) { return 'dark' }
    if (scheme.indexOf('light') >= 0 && scheme.indexOf('dark') < 0) { return 'light' }
    // Neither is spelled out: the client is showing its own default surface, which is
    // the light one unless it says otherwise.
    return 'light'
  }

  /** Tell the shell which palette the application is in, so its boot page can follow it. */
  function report() {
    if (ROLE !== 'client' || !document.body) { return }
    var palette = readAppPalette()
    if (!palette || palette === reported) { return }
    reported = palette
    fetch('/__shell/window', {
      method: 'PUT',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ radius: state.radius, palette: palette })
    }).then(function (response) {
      if (!response.ok) { throw new Error('PUT /__shell/window: HTTP ' + response.status) }
      return response.json()
    }).then(function (applied) {
      reported = applied.palette
      apply(applied)
    }, function (error) {
      reported = null
      note(error)
    })
  }

  function start() {
    build()
    flattenBackdrop()
    // A maximize the shell did not initiate — the keyboard, Snap, a double-click on the
    // window's own edge — arrives as a resize, and the corner has to follow it.
    var pending = null
    window.addEventListener('resize', function () {
      if (pending) { clearTimeout(pending) }
      pending = setTimeout(syncMaximized, 120)
    })
    if (ROLE !== 'client') { return }
    report()
    // The client's theme toggle is a body attribute, and the palette it sets is the one
    // the shell's boot page must show on the next start. The same tick re-checks the
    // backdrop, because the client re-renders itself and a new node arrives unmarked.
    setInterval(function () { report(); flattenBackdrop() }, 800)
    if (window.MutationObserver) {
      new MutationObserver(report).observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-ds-dark-theme']
      })
    }
  }

  window.__dshShellFrame = {
    version: 1,
    apply: apply,
    get: snapshot,
    refresh: refresh,
    build: build,
    role: ROLE
  }

  // A stamped document (the boot page) already carries the values, so its first paint
  // needs no request: that is what keeps the page rendering when the kernel — and every
  // other asset — is missing. A document that is not stamped asks the shell.
  var stampedRadius = html.getAttribute('data-shell-radius')
  var stampedPalette = html.getAttribute('data-shell-palette')
  apply({
    radius: stampedRadius === null ? DEFAULT_RADIUS : stampedRadius,
    gap: html.getAttribute('data-shell-gap'),
    palette: stampedPalette === null ? state.palette : stampedPalette
  })
  if (stampedRadius === null || stampedPalette === null) { refresh() }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
"##;

/// The tag that installs the frame into the client's own document.
///
/// The role is a separate inline script rather than an attribute on the tag, because
/// [`FRAME_JS`] reads it as it runs — and both tags have to precede it. The stylesheet
/// comes first so the rounded corners are in force before the client paints anything.
pub const FRAME_TAG: &str = r##"<link rel="stylesheet" href="/__shell/frame.css"><script>window.__DSH_SHELL_FRAME_ROLE='client'</script><script src="/__shell/frame.js" ></script>"##;
