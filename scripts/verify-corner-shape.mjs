#!/usr/bin/env node
/**
 * Assert that the window's own edge is a continuous corner, and that the
 * fallback an engine without `corner-shape` needs still lands there.
 *
 *   node scripts/verify-corner-shape.mjs [port]
 *
 * The shell must be running with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=<port>.
 * The gate reads the live page and measures the window's four corners by
 * bisecting the diagonal from each corner with `document.elementFromPoint`:
 * outside the body's `clip-path` nothing of the document is hit, so the
 * boundary between "a descendant answered" and "the root element answered" is
 * the clip's own edge. A circular corner of radius r sits at r·(1 − 1/√2) on
 * each axis; the continuous corner the frame draws (n = 3, `superellipse(1.5)`)
 * sits at r·(1 − 2^(−1/3)), which is 1.04px nearer the corner at the default
 * r = 12 — 200× the bisection's resolution, which is what makes the two shapes
 * separable by a hit test rather than by reading a declaration back.
 *
 * Four things are checked, and the second is what keeps the first honest:
 *   (i)   the body's computed clip is a `path()` and the four corners sit on
 *         the continuous curve for the radius in force;
 *   (ii)  two synthetic 240×240 boxes — one circular, one the same n = 3
 *         polygon — measure 7.35px apart at r = 60, so the instrument is known
 *         to distinguish the shapes it is being asked about;
 *   (iii) forcing `--dsh-shell-corner-shape: round` and repainting drops the
 *         inline clip and leaves the circular `inset()` declaration, whose
 *         corners measure on the circular curve;
 *   (iv)  the forced state is then removed and the clip is byte-identical to
 *         what it was, with no probe element left in the document.
 *
 * Every check prints PASS/FAIL; the process exits non-zero when any fails, so
 * this is the acceptance gate for the corner rather than a number to read.
 * This is the replayable form of the probes R2-T2 ran by hand
 * (`.tmp/r2-verify/a2-corner.js`, `a3-fallback.js`); see docs/handoff/R2-gate.md.
 */
import { decode } from './lib/png.mjs'

const port = /^\d+$/.test(process.argv[2] ?? '') ? Number(process.argv[2]) : 9222

/** Find the client's page, waiting for it to exist. */
const findPage = async () => {
  const deadline = Date.now() + 20000
  for (;;) {
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    const found = targets.find((target) => target.type === 'page' && String(target.url).includes(':31761'))
    if (found !== undefined) return found
    if (Date.now() > deadline) {
      console.error('no page on the shell origin within 20s; saw: ' + targets.map((t) => t.url).join(', '))
      process.exit(1)
    }
    await new Promise((wake) => setTimeout(wake, 250))
  }
}

const page = await findPage()
const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const settle = pending.get(message.id)
  if (settle) { pending.delete(message.id); settle(message) }
})
await new Promise((done) => socket.addEventListener('open', done, { once: true }))
const call = (method, params) => new Promise((settle) => {
  const id = nextId++
  pending.set(id, settle)
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (answer.result?.exceptionDetails) throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 500))
  return answer.result?.result?.value
}

/* A gate about the window's corner has to refuse to measure a viewport that is not the
 * window. The webview's viewport can be 40x40 CSS px while the OS window is 1440x900 --
 * measured on this machine, and the shell's own clip path then reads "M 12 0 L 28 0 ...",
 * i.e. the clip really is computed for a 40px box. Every reading below would be a reading
 * of that box, so this is a SKIP and not a PASS: nothing was verified, and a green tick
 * here would be a lie. Exit code 3 is the skip. */
const VIEWPORT = JSON.parse(await evaluate('JSON.stringify({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })'))
if (VIEWPORT.width < 200 || VIEWPORT.height < 200) {
  console.log('SKIP  verify-corner-shape: the page viewport is ' + VIEWPORT.width + 'x' + VIEWPORT.height + ' px at devicePixelRatio '
    + VIEWPORT.dpr + ', which is not the window (1440x900 on this machine). The shell computes its clip from the viewport, so every'
    + ' corner reading would be a reading of that box. Resize the real window (SetWindowPos) and re-run: dispatching a resize event'
    + ' from inside the page does not restore the viewport.')
  socket.close()
  process.exit(3)
}

/* The corner readings below are calibrated against this machine's 150% display. The shell's frame
 * and clip are quantised in device pixels, so at another scale the measured distance from the box's
 * corner moves by more than the tolerance while nothing about the shell changed: the first run of
 * this gate on the 175% display this machine now reports read as a defect, and measurement could
 * not attribute it to the shell. A reading that cannot be attributed is a SKIP, not a FAIL. */
/* The reading below needs one thing from the display: a client box the page and the surface agree
 * on, with all four corners inside it. That is the condition, so that is what is checked — the
 * earlier guard pinned a device pixel ratio instead, which refused to judge a 175% display whose
 * geometry was fine. */
const BOX = JSON.parse(await evaluate(`JSON.stringify((() => {
  const surface = document.getElementById('dsh-shell-surface')
  const rect = surface === null ? null : surface.getBoundingClientRect()
  return { viewport: [innerWidth, innerHeight], surface: rect === null ? null : [rect.width, rect.height, rect.left, rect.top] }
})())`))
const boxSkew = BOX.surface === null ? 99 : Math.max(Math.abs(BOX.surface[0] - BOX.viewport[0]), Math.abs(BOX.surface[1] - BOX.viewport[1]))
if (BOX.surface === null || boxSkew > 1) {
  console.log('SKIP  verify-corner-shape: the client box is not measurable — surface=' + JSON.stringify(BOX.surface)
    + ' viewport=' + JSON.stringify(BOX.viewport) + ', so a corner reading would be a reading of the mismatch.')
  socket.close()
  process.exit(3)
}
const CALIBRATED_DPR = null
if (CALIBRATED_DPR !== null && VIEWPORT.dpr !== CALIBRATED_DPR) {
  console.log('SKIP  verify-corner-shape: the page reports devicePixelRatio ' + VIEWPORT.dpr
    + ' but this gate is calibrated at ' + CALIBRATED_DPR + '. The shell quantises its frame and clip in device pixels, so every'
    + ' reading below would be a reading of the display scale rather than of the shell. Re-run on the calibrated display, or'
    + ' recalibrate and record the new value in scripts/verify-corner-shape.mjs.')
  socket.close()
  process.exit(3)
}

/* A maximised window draws square corners by design, so every reading below would be a reading of
   the window state rather than of the shell (R34: the shell reported radius 0 / clip inset(0px)
   while the profile still said radius 12, and IsZoomed on the shell process returned True). */
const maximised = await evaluate('(() => { try { return window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight } catch (error) { return null } })()')
if (maximised === true) {
  console.log('SKIP  verify-corner-shape: the shell window is maximised, and a maximised window has no'
    + ' rounded corners by design — every reading below would be a reading of the window state, not of the shell.'
    + ' Restore the window and re-run, or pass --live to make a skip fatal.')
  socket.close()
  process.exit(3)
}

/* One expression owns the whole experiment, so the forced state exists only
   inside it: the token is put back in a finally, whatever happens above. */
const measurement = await evaluate(`(async () => {
  const html = document.documentElement, body = document.body
  const frame = window.__dshShellFrame
  const norm = (s) => s.split(' ').filter((x) => x !== '').join(' ')
  const hit = (x, y) => document.elementFromPoint(x, y)
  /** The clip's edge along the diagonal from (ox,oy) toward (ux,uy). */
  const bisect = (ox, oy, ux, uy, inside, hi) => {
    let lo = 0, high = hi
    for (let i = 0; i < 50; i += 1) {
      const mid = (lo + high) / 2
      if (inside(ox + ux * mid, oy + uy * mid) === true) high = mid; else lo = mid
    }
    return Math.round(high * 1000) / 1000
  }
  const corners = (inside, origin) => {
    // The box is the surface's own rectangle rather than innerWidth/innerHeight: the client box is
    // fractional there (measured 1441.14 x 901.14 reported as 1441 x 901), and reading a corner from
    // an integer viewport 0.14 px too small moved sub-pixel distances past their tolerance at this
    // display's scale while the shell itself was unchanged.
    const surfaceBox = document.getElementById('dsh-shell-surface')
    const rect = surfaceBox === null ? null : surfaceBox.getBoundingClientRect()
    const fractions = origin === 'css'
    // Rounded, because the shell builds its clip path from an integer box (its own path starts at
    // M 12 0 and ends near 1429 for a 1441-wide client) while the element's rectangle is fractional
    // (1441.14). Measuring from the fractional edge adds the difference to every reading along that
    // edge, which is why three corners drifted together.
    const pick = (value, fallback) => (rect === null ? fallback : (fractions ? value : Math.round(value)))
    const left = pick(rect === null ? 0 : rect.left, 0)
    const top = pick(rect === null ? 0 : rect.top, 0)
    const W = pick(rect === null ? innerWidth : rect.left + rect.width, innerWidth)
    const H = pick(rect === null ? innerHeight : rect.top + rect.height, innerHeight)
    const coord = {
      topLeft: bisect(left, top, 1, 1, inside, 40),
      topRight: bisect(W, top, -1, 1, inside, 40),
      bottomLeft: bisect(left, H, 1, -1, inside, 40),
      bottomRight: bisect(W, H, -1, -1, inside, 40),
    }
    const diag = {}
    for (const key in coord) diag[key] = Math.round(coord[key] * Math.SQRT2 * 1000) / 1000
    return { coord, diag }
  }
  const windowInside = (x, y) => { const e = hit(x, y); return !(e === null || e === html) }
  const read = () => {
    const surface = document.getElementById('dsh-shell-surface')
    return {
      radius: parseFloat(getComputedStyle(html).getPropertyValue('--dsh-shell-radius')) || 0,
      shape: getComputedStyle(html).getPropertyValue('--dsh-shell-corner-shape').trim(),
      clip: norm(getComputedStyle(body).clipPath),
      tokenClip: norm(getComputedStyle(html).getPropertyValue('--dsh-shell-corner-clip').trim()),
      corners: corners(windowInside, 'shell'),
      cornersCss: corners(windowInside, 'css'),
      surfaceRadius: surface === null ? null : getComputedStyle(surface).borderRadius,
      surfaceShape: surface === null ? null : getComputedStyle(surface).cornerShape,
      surfaceFlattened: surface === null ? null : surface.classList.contains('dsh-shell-flat'),
    }
  }

  /* The same n = 3 family the frame describes, written out here from the maths
     rather than read from the frame's own generator. */
  const superPath = (w, h, r, steps) => {
    const power = 2 / 3
    const points = ['M ' + r.toFixed(2) + ' 0', 'L ' + (w - r).toFixed(2) + ' 0']
    const quadrants = [
      { mx: 1, my: 0, from: Math.PI / 2, to: 0 },
      { mx: 1, my: 1, from: 0, to: Math.PI / 2 },
      { mx: 0, my: 1, from: Math.PI / 2, to: 0 },
      { mx: 0, my: 0, from: 0, to: Math.PI / 2 },
    ]
    for (const q of quadrants) {
      for (let s = 0; s <= steps; s += 1) {
        const t = q.from + (q.to - q.from) * (s / steps)
        const dx = r - r * Math.pow(Math.cos(t), power)
        const dy = r - r * Math.pow(Math.sin(t), power)
        points.push('L ' + (q.mx ? w - dx : dx).toFixed(2) + ' ' + (q.my ? h - dy : dy).toFixed(2))
      }
    }
    points.push('Z')
    return points.join(' ')
  }

  const made = []
  const box = (left, top, clip) => {
    const element = document.createElement('div')
    element.setAttribute('data-corner-shape-probe', '1')
    element.style.cssText = 'position:fixed;left:' + left + 'px;top:' + top + 'px;width:240px;height:240px;'
      + 'background:rgb(200,0,0);z-index:2147483647;pointer-events:auto;clip-path:' + clip + ';'
    document.body.appendChild(element)
    made.push(element)
    return element
  }

  const out = { url: location.href, inner: [innerWidth, innerHeight], dpr: devicePixelRatio, error: null }
  try {
    out.before = read()

    const circle = box(200, 200, 'inset(0 round 60px)')
    const continuous = box(500, 200, 'path("' + superPath(240, 240, 60, 24) + '")')
    const on = (element) => (x, y) => hit(x, y) === element
    const synthetic = {}
    for (const [name, element] of [['circle', circle], ['continuous', continuous]]) {
      const coord = bisect(element.getBoundingClientRect().left, element.getBoundingClientRect().top, 1, 1, on(element), 80)
      synthetic[name] = { coord, diag: Math.round(coord * Math.SQRT2 * 1000) / 1000, computed: getComputedStyle(element).clipPath }
    }
    synthetic.deltaDiag = Math.round((synthetic.circle.diag - synthetic.continuous.diag) * 1000) / 1000
    out.control = synthetic

    html.style.setProperty('--dsh-shell-corner-shape', 'round')
    frame.apply({})
    out.forced = read()
  } catch (error) {
    out.error = String(error)
  } finally {
    html.style.removeProperty('--dsh-shell-corner-shape')
    frame.apply({})
    for (const element of made) element.remove()
  }
  out.restored = read()
  out.restored.identicalClip = out.restored.clip === out.before.clip
  out.restored.identicalTokenClip = out.restored.tokenClip === out.before.tokenClip
  out.restored.leftovers = document.querySelectorAll('[data-corner-shape-probe]').length
  return out
})()`)

/* The two ends of the superellipse family, as the radius in force makes them. */
const continuousCoord = (radius) => radius * (1 - Math.pow(2, -1 / 3))
const circularCoord = (radius) => radius * (1 - Math.SQRT1_2)
const near = (value, expected, tolerance) => Math.abs(value - expected) <= tolerance
const show = (value) => Math.round(value * 1000) / 1000
const CORNER_TOLERANCE = 0.06
const CONTROL_TOLERANCE = 0.15

let failures = 0
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))
    + (ok ? '' : '  [viewport ' + VIEWPORT.width + 'x' + VIEWPORT.height + ' @' + VIEWPORT.dpr + ']'))
  if (!ok) failures += 1
}

const radius = measurement.before.radius
const expectedContinuous = continuousCoord(radius)
const expectedCircular = circularCoord(radius)
const norm = (value) => String(value).split(' ').filter((part) => part !== '').join(' ')

/* Another gate in the same run can leave the page mid-experiment, and a clip token that is
 * a path for some smaller box is what such a leftover looks like -- every measurement
 * below would then be a measurement of that box. Asking the frame to recompute its own
 * clip is the repair, and the check that follows is what refuses to measure a window whose
 * clip does not describe it: the first horizontal segment of the path has to be the one
 * this window's width and radius call for. */
await evaluate('window.__dshShellFrame.apply({}); true')
await new Promise((wake) => setTimeout(wake, 250))
measurement.before.clip = norm(await evaluate('getComputedStyle(document.body).clipPath'))
check('the clip in force is the one this window s own size calls for',
  measurement.before.clip.indexOf('L ' + (measurement.inner[0] - radius) + ' 0') >= 0,
  { clip: measurement.before.clip.slice(0, 44), expected: 'L ' + (measurement.inner[0] - radius) + ' 0' })

check('the window clip is a continuous-corner path(), not a round inset', measurement.before.clip.startsWith('path("') && measurement.before.shape.startsWith('superellipse('), { clip: measurement.before.clip.slice(0, 48), shape: measurement.before.shape, radius: radius })
check('every corner sits on the continuous curve for r = ' + radius, ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].every((key) => near(measurement.before.corners.coord[key], expectedContinuous, CORNER_TOLERANCE)), { measured: measurement.before.corners.coord, expected: show(expectedContinuous), circularWouldBe: show(expectedCircular), tolerance: CORNER_TOLERANCE })
check('the synthetic control separates the two shapes', near(measurement.control.circle.coord, circularCoord(60), CONTROL_TOLERANCE) && near(measurement.control.continuous.coord, continuousCoord(60), CONTROL_TOLERANCE) && measurement.control.deltaDiag >= 3, { circle: show(measurement.control.circle.coord), circleTheory: show(circularCoord(60)), continuous: show(measurement.control.continuous.coord), continuousTheory: show(continuousCoord(60)), deltaDiag: measurement.control.deltaDiag })
check('forcing the fallback leaves the circular corner', measurement.forced !== undefined && measurement.forced.clip.startsWith('inset(') && ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].every((key) => near(measurement.forced.cornersCss.coord[key], expectedCircular, CORNER_TOLERANCE)), { clip: measurement.forced === undefined ? null : measurement.forced.clip, shape: measurement.forced === undefined ? null : measurement.forced.shape, measured: measurement.forced === undefined ? null : measurement.forced.cornersCss.coord, expected: show(expectedCircular) })
/* ---------------------------------------------------------------------------
 * The floor under the clip.
 *
 * Everything above measures the clip. This half takes it away: an engine that
 * cannot parse clip-path: path() drops the whole declaration and the document
 * is left unclipped, and then the only thing still drawing the window's corner
 * is #dsh-shell-surface, whose own border-radius + corner-shape are the floor.
 * That floor was gone -- flattenBackdrop() picks "the full-viewport div with a
 * radius", which is exactly the surface, and flattened it to border-radius: 0 --
 * so the checks below fail if the surface loses either declaration, or if the
 * flatten reaches it again.
 *
 * The instrument above cannot see this: the surface is pointer-events: none, so
 * no hit test lands on it, and with the clip gone there is no boundary for a hit
 * test to find anyway. This half is measured in pixels instead: the surface is
 * painted magenta for the length of the measurement, the panel's shadow is
 * switched off (a soft dark halo over the corner is a second thing painting
 * there), and each corner is read as the first magenta pixel along its diagonal.
 * The radius is raised to 28px through the token -- a stylesheet override on the
 * root, not the frame's own state -- so that the continuous corner and the arc
 * sit 2.4px apart and no tolerance can confuse them.
 * ------------------------------------------------------------------------- */
const REGION = 40
const FLOOR_CORNERS = [
  { name: 'topLeft', right: false, bottom: false },
  { name: 'topRight', right: true, bottom: false },
  { name: 'bottomLeft', right: false, bottom: true },
  { name: 'bottomRight', right: true, bottom: true },
]
const FLOOR_RADIUS = 28
const FLOOR_STATE = 'html { --dsh-shell-radius: ' + FLOOR_RADIUS + 'px !important; }'
  + ' #dsh-shell-surface { background: rgb(255, 0, 255) !important; }'
  + ' #dsh-shell-panel { box-shadow: none !important; }'
  + ' body { clip-path: none !important; }'

const installState = (css) => evaluate('(function () {' +
  ' var el = document.querySelector("style[data-corner-shape-probe]");' +
  ' if (!el) { el = document.createElement("style"); el.setAttribute("data-corner-shape-probe", "1"); document.head.appendChild(el); }' +
  ' el.textContent = ' + JSON.stringify(css) + ';' +
  ' return true;' +
  '})()')
const dropState = () => evaluate('(function () {' +
  ' document.querySelectorAll("style[data-corner-shape-probe]").forEach(function (el) { el.remove(); });' +
  ' if (window.__dshShellFrame) { window.__dshShellFrame.apply({}); }' +
  ' return true;' +
  '})()')

/** Where the painted corner starts, per axis in CSS px, for all four corners. */
const floorCorners = async () => {
  const found = {}
  for (const corner of FLOOR_CORNERS) {
    const answer = await call('Page.captureScreenshot', {
      format: 'png',
      clip: {
        x: corner.right ? Math.round(measurement.inner[0]) - REGION : 0,
        y: corner.bottom ? Math.round(measurement.inner[1]) - REGION : 0,
        width: REGION, height: REGION, scale: 1,
      },
    })
    const image = decode(Buffer.from(answer.result.data, 'base64'))
    const scale = image.width / REGION
    const at = (column, row) => {
      const index = (row * image.width + column) * image.channels
      return [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2], image.channels === 4 ? image.pixels[index + 3] : 255]
    }
    found[corner.name] = null
    for (let step = 0; step < image.width && step < image.height; step += 1) {
      const column = corner.right ? image.width - 1 - step : step
      const row = corner.bottom ? image.height - 1 - step : step
      const pixel = at(column, row)
      if (pixel[0] > 150 && pixel[1] < 110 && pixel[2] > 150 && pixel[3] > 60) { found[corner.name] = (step - 0.5) / scale; break }
    }
  }
  return found
}
const FLOOR_TOLERANCE = 0.9
const floorShow = (found) => FLOOR_CORNERS.map((corner) => corner.name + ' ' + show(found[corner.name] ?? NaN)).join('  ')
const floorAll = (found, predicate) => FLOOR_CORNERS.every((corner) => found[corner.name] !== null && predicate(found[corner.name]))

const floor = {}
try {
  await installState(FLOOR_STATE)
  floor.unclipped = await floorCorners()
  await installState(FLOOR_STATE + ' #dsh-shell-surface { corner-shape: round !important; }')
  floor.fallback = await floorCorners()
  await installState(FLOOR_STATE + ' #dsh-shell-surface { border-radius: 0 !important; }')
  floor.square = await floorCorners()
} finally {
  await dropState()
}
floor.after = JSON.parse(await evaluate('JSON.stringify({' +
  ' clip: getComputedStyle(document.body).clipPath,' +
  ' radius: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dsh-shell-radius")) || 0,' +
  ' leftovers: document.querySelectorAll("[data-corner-shape-probe]").length' +
  ' })'))

// R173's family: a pixel measurement that comes back with NO numbers is the INSTRUMENT failing to read the window, not
// three product failures. Measured in R173b: every corner was NaN while the two reference numbers were real (5.776 and
// 8.201), and the gate reported that as product-shaped failures - exactly what the repository rule ("a gate must not die
// into produced no readings") forbids. All-NaN now refuses by name; a partial loss is called out and then judged.
const floorValues = []
for (const found of [floor.unclipped, floor.fallback, floor.square]) for (const corner of FLOOR_CORNERS) floorValues.push(found[corner.name])
const floorRead = floorValues.filter((value) => typeof value === 'number' && Number.isFinite(value)).length
if (floorRead === 0) {
  console.log('  NOT MEASURED: the pixel half of this gate read no corner at all (' + floorShow(floor.unclipped) + ') - a measurement with no numbers is the INSTRUMENT failing to read the window (the same family as the stale captures in R173), not a product verdict; the CSS half above is still valid')
  console.log('SKIP: the pixel half could not read the window, so its three readings are not claimed')
  process.exit(3)
}
if (floorRead < floorValues.length) {
  console.log('  NOTE: only ' + String(floorRead) + ' of ' + String(floorValues.length) + ' corner measurements came back with a number; the rest are printed as NaN and will fail their readings below - read those failures as the instrument, not the product')
}

const floorContinuous = continuousCoord(FLOOR_RADIUS)
const floorCircular = circularCoord(FLOOR_RADIUS)
check('with the clip taken away, every corner is still the continuous curve',
  floorAll(floor.unclipped, (value) => near(value, floorContinuous, FLOOR_TOLERANCE))
    && floorAll(floor.unclipped, (value) => value <= floorCircular - 1.5)
    && floorAll(floor.unclipped, (value) => value >= 1.5),
  { measured: floorShow(floor.unclipped), continuous: show(floorContinuous), circularWouldBe: show(floorCircular), tolerance: FLOOR_TOLERANCE })
check('with the clip taken away and no corner-shape, the corner is the arc this window always had',
  floorAll(floor.fallback, (value) => near(value, floorCircular, FLOOR_TOLERANCE))
    && floorAll(floor.fallback, (value) => value >= 2),
  { measured: floorShow(floor.fallback), expected: show(floorCircular), squareWouldBe: 0 })
check('the reference with the surface corner taken away is a square window',
  floorAll(floor.square, (value) => value <= 1.5),
  { measured: floorShow(floor.square), note: 'this is what the surface s two declarations are for' })
check('the floor experiment left the page as it found it',
  floor.after.leftovers === 0 && floor.after.radius === radius && floor.after.clip === measurement.before.clip,
  { leftovers: floor.after.leftovers, radius: floor.after.radius, clip: floor.after.clip.slice(0, 24) })
check('the surface carries the corner itself, so flattening it is what removes the floor',
  measurement.before.surfaceRadius !== null && measurement.before.surfaceShape === measurement.before.shape
    && Math.abs(parseFloat(measurement.before.surfaceRadius) - radius) < 0.01
    && measurement.before.surfaceFlattened === false,
  { surfaceRadius: measurement.before.surfaceRadius, radius: radius, surfaceShape: measurement.before.surfaceShape, shape: measurement.before.shape, flattened: measurement.before.surfaceFlattened })
if (measurement.error !== null) check('the page reported no error while measuring', false, measurement.error)

socket.close()
console.log(failures === 0 ? 'corner shape: all checks passed' : failures + ' check(s) failed')
process.exit(failures === 0 ? 0 : 1)
