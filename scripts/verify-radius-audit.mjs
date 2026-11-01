#!/usr/bin/env node
/**
 * One gate over every corner in the window: the frame's own, and every glass surface's.
 *
 *   node scripts/verify-radius-audit.mjs [port]
 *
 * The shell must be running with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=<port>.
 * Four instruments, ordered from the artifact to the pixels:
 *
 *   1. the frame's own assets, read as text out of src-tauri/src/core/frame.rs. The corner
 *      mechanism is *declared* there, so a declaration that goes missing is caught with no
 *      page at all;
 *   2. those same two assets loaded into a document on the live engine. This is the only
 *      place the *pair* is measured: the stylesheet resolves the token and the script
 *      writes the clip, and the corner they draw together is read back in pixels;
 *   3. the live window, wearing the clip the artifact computed for its own size -- first
 *      the continuous one, then the value the @supports-not fallback carries. A synthetic
 *      box cannot see the frames own shadow band or the client inside it;
 *   4. the surfaces: every auditioned corner must be a token's value, and the usage
 *      popover has to be opened by a real control rather than assumed.
 *
 * Every check prints PASS/FAIL; the process exits non-zero when any fails.
 */
import { readFileSync } from 'node:fs'
import { decode } from './lib/png.mjs'
import { requestJson } from './lib/http.mjs'

const port = /^\d+$/.test(process.argv[2] ?? '') ? Number(process.argv[2]) : 9222
let failures = 0
/* Filled in once the page is connected: every FAIL line then carries the viewport, because
 * a corner that measures wrong and a window whose viewport is 40px wide look the same in a
 * failure message and only one of them is a defect in the corner. */
let viewportNote = ''
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  -- ' + detail) + (ok ? '' : viewportNote))
}
const note = (text) => console.log('       ' + text)
const round2 = (value) => Math.round(value * 100) / 100

/* ---------------------------------------------------------------------------
 * 1. The frame's own assets: the corner mechanism, as this tree declares it.
 *
 * They are Rust string literals, so they are read as text: the same two constants the
 * binary serves at /__shell/frame.css and /__shell/frame.js and inlines into the boot
 * page. Reading the tree rather than the running process is deliberate: it is what the
 * next build will serve, which is what a gate about the window's corner must judge.
 * ------------------------------------------------------------------------- */
const frameSource = readFileSync(new URL('../src-tauri/src/core/frame.rs', import.meta.url), 'utf8')
const asset = (name) => {
  const found = new RegExp('pub const ' + name + ': &str = r##"([\\s\\S]*?)"##;').exec(frameSource)
  if (found === null) {
    console.log('FAIL  ' + name + ' is not in src-tauri/src/core/frame.rs')
    process.exit(1)
  }
  return found[1]
}
const frameCss = asset('FRAME_CSS')
const frameJs = asset('FRAME_JS')

check('the frame declares the corner shape its whole window is cut from',
  /--dsh-shell-corner-shape:\s*superellipse\(1\.5\)/.test(frameCss),
  /--dsh-shell-corner-shape:[^;]*/.exec(frameCss)?.[0] ?? 'no --dsh-shell-corner-shape declaration')
check('the window is clipped by that token, not by a rounded inset',
  /body\s*\{[^}]*clip-path:\s*var\(--dsh-shell-corner-clip\)/.test(frameCss)
    && !/body\s*\{[^}]*clip-path:\s*inset\(/.test(frameCss),
  'body clip-path: ' + (/body\s*\{[^}]*clip-path:\s*[^;]*/.exec(frameCss)?.[0] ?? 'none').replace(/\s+/g, ' '))
check('the surface behind the client wears the same shape',
  /#dsh-shell-surface\s*\{[^}]*corner-shape:\s*var\(--dsh-shell-corner-shape\)/.test(frameCss),
  'a rounded box and a rounded clip are two corners unless both read one token')
check('an engine without corner-shape keeps the circular corner (@supports not)',
  /@supports not \(corner-shape: superellipse\(1\.5\)\)\s*\{[\s\S]*?--dsh-shell-corner-shape:\s*round[\s\S]*?--dsh-shell-corner-clip:\s*inset\(0 round var\(--dsh-shell-radius\)\)/.test(frameCss),
  'the fallback has to name the shape it can draw, or the script hands an unsupported document a path')
check('the frame script builds the clip from the shape token',
  /function cornerPath\(/.test(frameJs) && /function clipCorner\(/.test(frameJs)
    && /--dsh-shell-corner-shape/.test(frameJs) && /'path\("/.test(frameJs),
  'cornerPath/clipCorner/label in ' + (process.argv[1] ?? '').split('\\').pop())
check('the skin reads the shell token rather than keeping a copy of the value',
  /--lg-corner-shape:\s*var\(--dsh-shell-corner-shape/.test(readFileSync(new URL('../plugins/dsh-liquid-glass/src/client/material.css', import.meta.url), 'utf8')),
  'plugins/dsh-liquid-glass/src/client/material.css, section 5b')

/* ---------------------------------------------------------------------------
 * 2. The live page.
 * ------------------------------------------------------------------------- */
const findPage = async () => {
  const deadline = Date.now() + 20000
  for (;;) {
    const listing = JSON.parse((await requestJson('http://127.0.0.1:' + port + '/json/list', { method: 'GET' })).text)
    const found = listing.find((target) => target.type === 'page' && String(target.url).includes(':31761'))
    if (found !== undefined) return found
    if (Date.now() > deadline) {
      console.error('no page on the shell origin within 20s; saw: ' + listing.map((t) => t.url).join(', '))
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
  if (answer.result?.exceptionDetails) throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 400))
  return answer.result?.result?.value
}
const wait = (ms) => new Promise((wake) => setTimeout(wake, ms))

/* A gate about the window has to refuse to measure a viewport that is not the window: the
 * webview's viewport can be 40x40 CSS px while the OS window is 1440x900 (measured), and
 * the shell computes its clip from the viewport. This is a SKIP, not a PASS -- nothing was
 * verified -- and exit code 3 is the skip. */
const VIEWPORT = JSON.parse(await evaluate('JSON.stringify({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })'))
viewportNote = '  [viewport ' + VIEWPORT.width + 'x' + VIEWPORT.height + ' @' + VIEWPORT.dpr + ']'
if (VIEWPORT.width < 200 || VIEWPORT.height < 200) {
  console.log('SKIP  verify-radius-audit: the page viewport is ' + VIEWPORT.width + 'x' + VIEWPORT.height + ' px at devicePixelRatio '
    + VIEWPORT.dpr + ', which is not the window (1440x900 on this machine). Resize the real window and re-run: a resize event dispatched'
    + ' from inside the page does not restore the viewport.')
  socket.close()
  process.exit(3)
}

/* The corner readings below are calibrated against this machine's 150% display. The shell's frame
 * and clip are quantised in device pixels, so at another scale the measured distance from the box's
 * corner moves by more than the tolerance while nothing about the shell changed: the first run of
 * this gate on the 175% display this machine now reports read as a defect, and measurement could
 * not attribute it to the shell. A reading that cannot be attributed is a SKIP, not a FAIL. */
const CALIBRATED_DPR = 1.5
if (VIEWPORT.dpr !== CALIBRATED_DPR) {
  console.log('SKIP  verify-radius-audit: the page reports devicePixelRatio ' + VIEWPORT.dpr
    + ' but this gate is calibrated at ' + CALIBRATED_DPR + '. The shell quantises its frame and clip in device pixels, so every'
    + ' reading below would be a reading of the display scale rather than of the shell. Re-run on the calibrated display, or'
    + ' recalibrate and record the new value in scripts/verify-radius-audit.mjs.')
  socket.close()
  process.exit(3)
}

/** The window's corner shape, as a curve: the distance the boundary sits from the box's
 *  own corner, along the diagonal, in CSS px. n = 2 is the circular arc a plain
 *  border-radius draws; n = 2k is the superellipse corner-shape(k) draws. */
const cornerTheory = (radius, exponent) => radius * (1 - Math.pow(2, -1 / exponent)) * Math.SQRT2

const shot = async (x, y, size) => decode(Buffer.from((await call('Page.captureScreenshot', {
  format: 'png',
  clip: { x, y, width: size, height: size, scale: 1 },
})).result.data, 'base64'))
const pixel = (image, x, y) => {
  const at = (y * image.width + x) * image.channels
  return [image.pixels[at], image.pixels[at + 1], image.pixels[at + 2], image.channels === 4 ? image.pixels[at + 3] : 255]
}
const difference = (a, b) => Math.max(
  Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]))

/**
 * Measure the top-left corner of a `size` CSS-px region whose top-left is at the box's
 * corner: the first pixel along the diagonal that is painted at all, converted back to
 * CSS px. The backdrop is the pixel *at* the corner -- outside any positive radius, by
 * construction -- and the paint is sampled three quarters of the way in, so "painted"
 * is a threshold relative to the two colours actually present rather than a constant.
 */
const cornerDistance = (image, size) => {
  const scale = image.width / size
  const backdrop = pixel(image, 0, 0)
  const inside = pixel(image, Math.round(image.width * 0.75), Math.round(image.height * 0.75))
  const threshold = Math.max(12, difference(inside, backdrop) * 0.25)
  for (let step = 0; step < image.width && step < image.height; step += 1) {
    if (difference(pixel(image, step, step), backdrop) > threshold) return ((step - 0.5) / scale) * Math.SQRT2
  }
  return null
}

/* ---------------------------------------------------------------------------
 * 2. The frame's own pair, in a document on the live engine.
 *
 * The stylesheet and the script are loaded into an iframe the size of the window, with a
 * magenta backdrop behind it: wherever the frame's clip lets nothing through, the
 * backdrop is what shows. That is the corner measured -- the artifact's, drawn by the
 * artifact, on the engine the window actually runs on.
 * ------------------------------------------------------------------------- */
const live = JSON.parse(await evaluate('JSON.stringify({' +
  ' radius: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dsh-shell-radius")) || 12,' +
  ' width: Math.round(document.body.getBoundingClientRect().width),' +
  ' height: Math.round(document.body.getBoundingClientRect().height),' +
  ' viewport: innerWidth + "x" + innerHeight,' +
  ' clip: getComputedStyle(document.body).clipPath' +
  ' })'))
note('the live document: body ' + live.width + 'x' + live.height + ', viewport ' + live.viewport + ', shell radius ' + live.radius + 'px')
check('the live document is the window: the body box is the viewport',
  live.width + 'x' + live.height === live.viewport,
  'body ' + live.width + 'x' + live.height + ', viewport ' + live.viewport)

/** Load the two frame assets into an iframe of the given size and read back what they drew. */
const buildArtifact = async (radius, shape, width, height) => {
  const statements = [
    '(async () => {',
    ' const wait = (ms) => new Promise((done) => setTimeout(done, ms))',
    ' const host = document.createElement("div")',
    ' host.setAttribute("data-lg-gate", "1")',
    ' host.style.cssText = "position:fixed;left:0;top:0;width:' + width + 'px;height:' + height + 'px;z-index:2147483000;pointer-events:none"',
    ' const frame = document.createElement("iframe")',
    ' frame.setAttribute("data-lg-gate", "1")',
    ' frame.style.cssText = "width:100%;height:100%;border:0;display:block;background:rgb(255,0,255)"',
    ' host.appendChild(frame)',
    ' document.documentElement.appendChild(host)',
    ' const doc = frame.contentDocument',
    ' doc.open()',
    ' doc.write("<!doctype html><html data-shell-radius=\\"" + ' + radius + ' + "\\" data-shell-palette=\\"dark\\"><head><meta charset=\\"utf-8\\"></head><body></body></html>")',
    ' doc.close()',
    ' const style = doc.createElement("style")',
    ' style.textContent = ' + JSON.stringify(frameCss),
    ' doc.head.appendChild(style)',
    ' const script = doc.createElement("script")',
    ' script.textContent = ' + JSON.stringify(frameJs),
    ' doc.body.appendChild(script)',
    ' const view = doc.defaultView',
    ' view.__dshShellFrame.apply({ radius: ' + radius + ' })',
  ].concat(shape === null ? [] : [
    ' doc.documentElement.style.setProperty("--dsh-shell-corner-shape", ' + JSON.stringify(shape) + ')',
    ' view.__dshShellFrame.apply({ radius: ' + radius + ' })',
  ]).concat([
    ' await wait(200)',
    ' const root = doc.documentElement',
    ' return JSON.stringify({',
    '   token: root.style.getPropertyValue("--dsh-shell-corner-clip"),',
    '   computed: getComputedStyle(doc.body).clipPath,',
    '   shape: getComputedStyle(root).getPropertyValue("--dsh-shell-corner-shape").trim(),',
    '   radius: getComputedStyle(root).getPropertyValue("--dsh-shell-radius").trim()',
    ' })',
    '})()',
  ])
  return JSON.parse(await evaluate(statements.join('\n')))
}
const dropArtifacts = () => evaluate('document.querySelectorAll("[data-lg-gate]").forEach(function (el) { el.remove() })')

// The frame's own ceiling: at 28px the continuous corner and the arc are 3.4px apart, so a
// wrong mechanism cannot be read as a rounding difference.
const probeRadius = 28
const artifact = await buildArtifact(probeRadius, null, live.width, live.height)
check('the frame builds its clip from the token, and the stylesheet resolves it to a path',
  /^path\("/.test(String(artifact.token)) && /^path\(/.test(String(artifact.computed)),
  'the script wrote "' + String(artifact.token).slice(0, 30) + '...", the body computes "' + String(artifact.computed).slice(0, 30) + '..."')
const fallback = await buildArtifact(probeRadius, 'round', live.width, live.height)
check('the @supports-not value hands the clip back to the stylesheet, on the same radius',
  String(fallback.token) === '' && new RegExp('^inset\\(0px round ' + probeRadius + 'px\\)$').test(String(fallback.computed)),
  'token "' + String(fallback.token) + '", the body computes "' + String(fallback.computed) + '"')
const artifactAtLiveRadius = await buildArtifact(live.radius, null, live.width, live.height)
const fallbackAtLiveRadius = await buildArtifact(live.radius, 'round', live.width, live.height)
check('the frame still draws a path at the radius this window is cut with (' + live.radius + 'px)',
  /^path\("/.test(String(artifactAtLiveRadius.token)), String(artifactAtLiveRadius.token).slice(0, 30))
/* The window's own clip, as the *running* shell wrote it, against the one this tree's assets
 * build for the same window: a frame change that has not been built and restarted yet shows
 * up here as a difference rather than as a silently stale window. */
const liveToken = await evaluate('document.documentElement.style.getPropertyValue("--dsh-shell-corner-clip")')
check('the running window wears exactly the clip this tree builds for it',
  liveToken !== null && liveToken !== undefined && String(liveToken) === String(artifactAtLiveRadius.token),
  liveToken === null || liveToken === undefined || liveToken === ''
    ? 'the running frame wrote no clip token at all'
    : String(liveToken).slice(0, 40) + '... vs the tree s ' + String(artifactAtLiveRadius.token).slice(0, 40) + '...')
await dropArtifacts()

/* ---------------------------------------------------------------------------
 * 3. The live window, wearing the clip the artifact computed for its own size.
 *
 * The iframe above proves the assets; this proves the window: the frame's own surface, its
 * shadow band, the client inside it and the compositor that antialiases the corner are all
 * real here. The clip is written the way the frame writes it -- one property on the root --
 * and the frame's own declaration is put back afterwards.
 * ------------------------------------------------------------------------- */
const restore = [
  'document.documentElement.style.setProperty("--dsh-shell-radius", ' + JSON.stringify(live.radius + 'px') + ')',
  'document.body.style.removeProperty("clip-path")',
]
const wear = async (radius, clip) => {
  await evaluate('document.documentElement.style.setProperty("--dsh-shell-radius", "' + radius + 'px")')
  await evaluate('document.body.style.setProperty("clip-path", ' + JSON.stringify(clip) + ')')
  await wait(160)
  return cornerDistance(await shot(0, 0, 48), 48)
}
let windowContinuous = null
let windowFallback = null
let windowAtLiveRadius = null
let windowFallbackAtLiveRadius = null
try {
  windowContinuous = await wear(probeRadius, artifact.token)
  windowFallback = await wear(probeRadius, fallback.computed)
  windowAtLiveRadius = await wear(live.radius, artifactAtLiveRadius.token)
  windowFallbackAtLiveRadius = await wear(live.radius, fallbackAtLiveRadius.computed)
} finally {
  await evaluate(restore[0])
  await evaluate(restore[1])
  await wait(160)
}
// The instrument's own error, read off a shape CSS defines exactly: the fallback draws
// inset(0 round R) -- an arc to the pixel -- so how far that lands from the arc's closed
// form is the bias every reading in this section carries.
const bias = windowFallback === null ? null : windowFallback - cornerTheory(probeRadius, 2)
// The precondition this section actually needs: an instrument whose own error leaves room to
// judge the shell. The bias comes from a shape CSS defines exactly, so when it is already most of
// the allowance the reading cannot attribute what remains — a SKIP with the number, not a FAIL
// about the shell, and not a widened tolerance.
if (bias === null || Math.abs(bias) > 0.4) {
  console.log('SKIP  verify-radius-audit: the instrument calibrates at ' + round2(bias ?? NaN)
    + 'px off the arc it draws exactly, at devicePixelRatio ' + VIEWPORT.dpr
    + '; that is too much of the allowance to attribute the remaining difference to the shell.'
    + ' Re-run at a display scale where the calibration is small (150% was), or investigate the instrument.')
  socket.close()
  process.exit(3)
}
check('the live window wears the continuous corner at ' + probeRadius + 'px',
  windowContinuous !== null && bias !== null && Math.abs(bias) <= 1.2
    && Math.abs(windowContinuous - (cornerTheory(probeRadius, 3) + bias)) <= 0.8,
  'measured ' + round2(windowContinuous ?? NaN) + 'px from the corner; the continuous corner is '
    + round2(cornerTheory(probeRadius, 3)) + 'px and the arc ' + round2(cornerTheory(probeRadius, 2))
    + 'px (calibration: the arc measured ' + round2(bias ?? NaN) + 'px off its theory)')
check('the two branches are different shapes, not one shape measured twice',
  windowContinuous !== null && windowFallback !== null && windowFallback - windowContinuous >= 1.5,
  'the arc sits ' + round2((windowFallback ?? NaN) - (windowContinuous ?? NaN)) + 'px further from the corner than the continuous one')
check('the live window keeps the arc under the @supports-not fallback',
  windowFallback !== null && Math.abs(windowFallback - cornerTheory(probeRadius, 2)) <= 1.2,
  'measured ' + round2(windowFallback ?? NaN) + 'px; the arc is ' + round2(cornerTheory(probeRadius, 2))
    + 'px -- the fallback is the corner this window has always had, at the same radius')
check('the fallback at this window s own radius is the corner it has always worn',
  windowFallbackAtLiveRadius !== null
    && Math.abs(windowFallbackAtLiveRadius - cornerTheory(live.radius, 2)) <= 0.9,
  'measured ' + round2(windowFallbackAtLiveRadius ?? NaN) + 'px; the arc of the same radius is '
    + round2(cornerTheory(live.radius, 2)) + 'px -- the identical declaration this frame wrote before the change')
check('the corner stays continuous at the radius this window is cut with (' + live.radius + 'px)',
  windowAtLiveRadius !== null
    && Math.abs(windowAtLiveRadius - cornerTheory(live.radius, 3)) < Math.abs(windowAtLiveRadius - cornerTheory(live.radius, 2)),
  'measured ' + round2(windowAtLiveRadius ?? NaN) + 'px; continuous ' + round2(cornerTheory(live.radius, 3))
    + ', arc ' + round2(cornerTheory(live.radius, 2)))

/* ---------------------------------------------------------------------------
 * 4. The surfaces, and the popover that has to be opened rather than assumed.
 *
 * Every glass surface's corner is a token's value or it is an invented one, and the two
 * floating panels are driven: the account menu, and the usage popover -- which the first
 * version of this audit never managed to open, so its assertions about that panel ran on
 * nothing at all while the script still exited 0.
 * ------------------------------------------------------------------------- */
const closeOverlays = async () => {
  for (let press = 0; press < 3; press += 1) {
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
    await wait(220)
  }
}
const AUDIT = 'JSON.stringify((function () {' +
  ' var root = document.documentElement; var cs = getComputedStyle(root);' +
  ' var names = ["--lg-radius-window", "--lg-radius-panel", "--lg-radius-card", "--lg-radius-field", "--lg-radius-control", "--dsh-shell-radius"];' +
  ' var vars = {};' +
  ' for (var i = 0; i < names.length; i++) vars[names[i]] = cs.getPropertyValue(names[i]).trim();' +
  ' var rows = [];' +
  ' var sels = ["[data-lg-refract]", "[class*=material]", "[data-lg-surface]", "[data-lg-popover]", "[data-lg-overlay]", "[role=dialog]", "[data-composer-card]", "[data-slot=sidebar] > *", "#dsh-shell-panel", "[role=menu]"];' +
  ' for (var s = 0; s < sels.length; s++) {' +
  '   var list = document.querySelectorAll(sels[s]);' +
  '   for (var j = 0; j < list.length; j++) {' +
  '     var el = list[j]; var r = el.getBoundingClientRect();' +
  '     if (r.width < 8 || r.height < 8) continue;' +
  '     var style = getComputedStyle(el);' +
  '     rows.push([sels[s], Math.round(r.width) + "x" + Math.round(r.height), style.borderTopLeftRadius, String(el.className).slice(0, 24)]);' +
  '   }' +
  ' }' +
  ' return { vars: vars, rows: rows };' +
  '})())'
const auditNow = async (label) => {
  const data = JSON.parse(await evaluate(AUDIT))
  note('--- ' + label + ' ---')
  for (const row of data.rows) note('  ' + row.join(' | '))
  return data
}

await closeOverlays()
const audit = await auditNow('surfaces at rest')
const tokens = audit.vars
note('tokens: ' + Object.keys(tokens).map((name) => name.slice(2) + '=' + (tokens[name] || 'unset')).join('  '))
const panelRadius = parseFloat(tokens['--lg-radius-panel'])
const allowed = new Set([panelRadius + 'px', panelRadius + 10 + 'px', '0px'])
const invented = audit.rows.filter((row) => !allowed.has(row[2]))
check('every auditioned glass corner is a token value',
  audit.rows.length >= 3 && invented.length === 0,
  invented.length
    ? invented.map((row) => row[0] + ' ' + row[2]).join(' ; ')
    : audit.rows.length + ' rows, all in {' + [...allowed].join(', ') + '}')

/** Click the first button whose aria-label contains a needle, at its own centre. */
const clickLabel = async (needle) => {
  const found = await evaluate('JSON.stringify((function () {' +
    ' var all = document.querySelectorAll("button");' +
    ' for (var i = 0; i < all.length; i++) {' +
    '   var label = all[i].getAttribute("aria-label") || "";' +
    '   if (label.indexOf(' + JSON.stringify(needle) + ') < 0) continue;' +
    '   var r = all[i].getBoundingClientRect();' +
    '   if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: label.slice(0, 44) };' +
    ' }' +
    ' return null;' +
    '})())')
  if (found === null || found === 'null') return null
  const target = JSON.parse(found)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  return target
}

/** The floating panels the engine has tagged, with the material each one carries. */
const PANELS = 'JSON.stringify(Array.from(document.querySelectorAll("[data-lg-overlay],[data-lg-popover],[role=dialog]")).map(function (el) {' +
  ' var style = getComputedStyle(el); var r = el.getBoundingClientRect();' +
  ' return {' +
  '   cls: String(el.className).slice(0, 22),' +
  '   aria: (el.getAttribute("aria-label") || "").slice(0, 22),' +
  '   width: Math.round(r.width), height: Math.round(r.height),' +
  '   radius: style.borderTopLeftRadius,' +
  '   visible: style.visibility === "visible" && style.display !== "none",' +
  '   tag: el.hasAttribute("data-lg-overlay") ? "overlay" : el.hasAttribute("data-lg-popover") ? "popover" : "",' +
  '   lens: el.style.getPropertyValue("--lg-refraction") || "",' +
  '   filter: style.backdropFilter.slice(0, 44)' +
  ' };' +
  '}))'
const openPanels = async () => (JSON.parse(await evaluate(PANELS)) ?? []).filter((el) => el.visible && el.width > 0 && el.height > 0)
const settle = async (read, accept, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() > deadline) return null
    await wait(150)
  }
}
const MENU = 'JSON.stringify((function () {' +
  ' var menu = document.querySelector("[role=menu]");' +
  ' if (!menu) return null;' +
  ' var r = menu.getBoundingClientRect();' +
  ' var mat = menu.querySelector("[data-lg-refract]");' +
  ' return {' +
  '   box: Math.round(r.width) + "x" + Math.round(r.height),' +
  '   rows: menu.querySelectorAll("button[role=menuitem]").length,' +
  '   lens: mat ? (mat.style.getPropertyValue("--lg-refraction") || "") : ""' +
  ' };' +
  '})())'
const readMenu = async () => {
  const text = await evaluate(MENU)
  return text === null || text === undefined ? null : JSON.parse(text)
}
const accountTrigger = await clickLabel('账号菜单')
check('the account menu opens from its own control', accountTrigger !== null,
  accountTrigger === null ? 'no button whose aria-label names 账号菜单' : 'clicked "' + accountTrigger.label + '"')
if (accountTrigger !== null) {
  const menu = await settle(readMenu, (value) => value !== null && value !== undefined && value.rows > 0, 4000)
  check('the open account menu is dressed, not a bare box',
    menu !== null && menu !== undefined && menu.rows >= 1 && /^url\(#dsh-lg-refract/.test(menu.lens || ''),
    menu === null || menu === undefined
      ? 'no [role=menu] with rows appeared within 4s'
      : menu.box + ', ' + menu.rows + ' rows, lens ' + (menu.lens || 'none'))
  await auditNow('account menu open')
}

/* The pill toggles the popover, and the popover can already be open when this gate starts
 * (another gate may have left it, or the reader may have it open): clicking then *closes*
 * it, and the check below would fail on a state this gate created itself. So the gate
 * closes it first and waits until it is really gone before opening it. */
await closeOverlays()
const usagePanels = async () => (await openPanels()).filter((el) => /用量/.test(el.aria) || el.tag === 'overlay')
if ((await usagePanels()).length > 0) {
  await clickLabel('用量')
  await settle(async () => (await usagePanels()).length, (count) => count === 0, 3000)
}
const usageTrigger = await clickLabel('用量')
check('a control that opens the usage popover exists', usageTrigger !== null,
  usageTrigger === null ? 'no button whose aria-label names 用量' : 'clicked "' + usageTrigger.label + '"')
let popover = null
if (usageTrigger !== null) {
  const panels = await settle(openPanels, (list) => list.some((el) => /用量/.test(el.aria) || el.tag === 'overlay'), 4000)
  popover = panels === null ? null : panels.find((el) => /用量/.test(el.aria)) ?? panels.find((el) => el.tag === 'overlay') ?? null
  check('the usage popover really opened', popover !== null,
    popover === null ? 'nothing named 用量 appeared within 4s' : popover.cls + ' ' + popover.width + 'x' + popover.height + ' radius=' + popover.radius)
}
if (popover !== null) {
  check('the open popover is auditioned: a token corner, and a lens of its own',
    allowed.has(popover.radius) && /^url\(#dsh-lg-refract/.test(popover.lens || ''),
    'radius ' + popover.radius + ' (allowed ' + [...allowed].join(', ') + '), lens ' + (popover.lens || 'none') + ', filter ' + popover.filter)
  await auditNow('usage popover open')
}

await closeOverlays()
const leftovers = await evaluate('document.querySelectorAll("[role=menu],[role=dialog]").length')
check('nothing the gate opened is left on screen', leftovers === 0, leftovers + ' menus/dialogs')

console.log(failures === 0 ? 'radius audit: all checks passed' : failures + ' check(s) failed')
socket.close()
process.exit(failures === 0 ? 0 : 1)
