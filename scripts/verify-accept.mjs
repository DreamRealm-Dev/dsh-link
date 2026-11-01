#!/usr/bin/env node
/**
 * Acceptance after a shell restart: the account menu never renders three rows, every glass
 * corner follows a token, the lens equals the control's box, and the engine still dresses
 * surfaces.
 *
 *   node scripts/verify-accept.mjs [port]
 *
 * Ported out of .tmp/accept/accept.mjs, which lived in a draft directory this tree does not
 * even track: it depended on three more scripts next to it, so the gate broke the moment
 * anything was cleaned up. Everything it needed is inline here now -- the frame recorder and
 * the corner audit are page expressions rather than files -- and the two probes it shells
 * out to are the repository's own scripts/probe-*.mjs.
 *
 * The shell must be running with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=<port>.
 * Every check prints PASS/FAIL; the process exits non-zero when any fails.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { requestJson } from './lib/http.mjs'

const port = /^\d+$/.test(process.argv[2] ?? '') ? Number(process.argv[2]) : 9222
const root = fileURLToPath(new URL('../', import.meta.url))
let failures = 0
/* Filled in once the page is connected: every FAIL line carries the viewport, so a reader
 * cannot mistake a page that is 40px wide for a defect in the menu. */
let viewportNote = ''
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  -- ' + detail) + (ok ? '' : viewportNote))
}
const note = (text) => console.log('       ' + text)
const round1 = (value) => Math.round(value * 10) / 10

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

/* A gate that drives the live page has to refuse to judge a viewport that is not the
 * window: the webview's viewport can be 40x40 CSS px while the OS window is 1440x900
 * (measured), and every reading would be a reading of that box. SKIP, not PASS; exit 3. */
const VIEWPORT = JSON.parse(await evaluate('JSON.stringify({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })'))
viewportNote = '  [viewport ' + VIEWPORT.width + 'x' + VIEWPORT.height + ' @' + VIEWPORT.dpr + ']'
if (VIEWPORT.width < 200 || VIEWPORT.height < 200) {
  console.log('SKIP  verify-accept: the page viewport is ' + VIEWPORT.width + 'x' + VIEWPORT.height + ' px at devicePixelRatio '
    + VIEWPORT.dpr + ', which is not the window (1440x900 on this machine). Resize the real window and re-run.')
  socket.close()
  process.exit(3)
}
const closeOverlays = async () => {
  for (let press = 0; press < 3; press += 1) {
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
    await wait(220)
  }
}

/* ---------------------------------------------------------------------------
 * 1. The account menu, frame by frame.
 *
 * The defect this gate exists for was a menu that rendered three rows -- or 110px tall --
 * for a frame or two while it opened: a state that is over before a screenshot can be
 * taken, and that a single "is it 76px now?" reading therefore cannot see. So the page
 * records every animation frame while the menu opens, and the assertions are about the
 * whole timeline: how many rows it ever showed, and the box it settled at.
 * ------------------------------------------------------------------------- */
const RECORDER = '(function () {' +
  ' var frames = [];' +
  ' var t0 = performance.now();' +
  ' function snap() {' +
  '   var now = performance.now() - t0;' +
  '   if (now < 1500 && frames.length < 200) {' +
  '     var menu = document.querySelector("[role=menu]");' +
  '     if (!menu) { frames.push({ t: Math.round(now) }); requestAnimationFrame(snap); return; }' +
  '     var mat = menu.querySelector("[data-lg-refract]");' +
  '     var refr = mat ? mat.style.getPropertyValue("--lg-refraction") : "";' +
  '     var id = refr && refr.indexOf("url(#") === 0 ? refr.slice(5).replace(")", "") : "";' +
  '     var filter = id ? document.getElementById(id) : null;' +
  '     var image = filter ? filter.querySelector("feImage") : null;' +
  '     var mr = mat ? mat.getBoundingClientRect() : null;' +
  '     var sr = menu.getBoundingClientRect();' +
  '     frames.push({' +
  '       t: Math.round(now),' +
  '       rows: menu.querySelectorAll("button[role=menuitem]").length,' +
  '       menuH: Math.round(sr.height * 10) / 10,' +
  '       matH: mr ? Math.round(mr.height * 10) / 10 : null,' +
  '       id: id,' +
  '       map: image ? image.getAttribute("width") + "x" + image.getAttribute("height") : null,' +
  '       scale: filter && filter.querySelector("feDisplacementMap") ? filter.querySelector("feDisplacementMap").getAttribute("scale") : null' +
  '     });' +
  '     requestAnimationFrame(snap);' +
  '   }' +
  ' }' +
  ' requestAnimationFrame(snap);' +
  ' return frames;' +
  '})()'
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

await closeOverlays()
await evaluate('window.__dshAcceptFrames = ' + RECORDER)
const trigger = await clickLabel('账号菜单')
check('the account menu was actually driven', trigger !== null,
  trigger === null ? 'no button whose aria-label names 账号菜单' : 'clicked "' + trigger.label + '"')
await wait(1800)
const frames = JSON.parse(await evaluate('JSON.stringify(window.__dshAcceptFrames)') ?? '[]')
await evaluate('delete window.__dshAcceptFrames')
/* One line per change, not one per frame: the timeline is ~200 frames long and what a
 * reader needs is where it changed. */
note('t | rows | menuH | matH | lens | map(px) | bend')
let previous = ''
for (const frame of frames) {
  const line = [frame.t, frame.rows ?? '-', frame.menuH ?? '-', frame.matH ?? '-', frame.id || '-', frame.map || '-', frame.scale || '-'].join(' | ')
  if (line.slice(line.indexOf('|')) === previous) continue
  previous = line.slice(line.indexOf('|'))
  note('  ' + line)
}
const opened = frames.filter((frame) => frame.rows !== undefined)
const settled = opened.length === 0 ? null : opened[opened.length - 1]
check('the timeline is not empty (the two assertions below cannot pass vacuously)',
  opened.length > 0, opened.length + ' frames with the menu on screen')
check('no frame renders the menu with three rows',
  opened.every((frame) => frame.rows !== 3), opened.filter((frame) => frame.rows === 3).length + ' such frames')
check('no frame renders the menu 110px tall',
  opened.every((frame) => frame.menuH !== 110), opened.filter((frame) => frame.menuH === 110).length + ' such frames')
check('the settled menu is 2 rows / 76px',
  settled !== null && settled.rows === 2 && settled.menuH === 76,
  settled === null ? 'the menu never appeared' : 'rows ' + settled.rows + ', height ' + settled.menuH + 'px')
if (settled !== null && settled.map !== null) {
  const map = settled.map.split('x').map(Number)
  check('the lens is the control s own box, not the menu s column',
    Math.abs(map[0] - 144) <= 0.5 && Math.abs(map[1] - settled.menuH) <= 0.5,
    'map ' + settled.map + ' vs box 144x' + settled.menuH)
  check('the settled menu is dressed with a lens that bends',
    /^dsh-lg-refract/.test(settled.id || '') && Number(settled.scale) !== 0,
    'lens ' + (settled.id || 'none') + ', bend ' + (settled.scale ?? 'none'))
} else {
  check('the lens is the control s own box, not the menu s column', false, 'no settled frame with a mapped lens')
  check('the settled menu is dressed with a lens that bends', false, 'no settled frame with a mapped lens')
}
await closeOverlays()

/* ---------------------------------------------------------------------------
 * 2. Every glass corner is a token's value.
 *
 * The radii are one control's: the window's radius and the panel's (the card is the panel
 * plus the offset the client's own 28px card always had). A corner that is none of those is
 * an invented number, and it is what makes a stack of nested surfaces look assembled
 * rather than cut.
 * ------------------------------------------------------------------------- */
const AUDIT = 'JSON.stringify((function () {' +
  ' var cs = getComputedStyle(document.documentElement);' +
  ' var names = ["--lg-radius-panel", "--lg-radius-card", "--lg-radius-field", "--lg-radius-control", "--dsh-shell-radius"];' +
  ' var vars = {};' +
  ' for (var i = 0; i < names.length; i++) vars[names[i]] = cs.getPropertyValue(names[i]).trim();' +
  ' var rows = [];' +
  ' var sels = ["[data-lg-refract]", "[class*=material]", "[data-lg-surface]", "[data-lg-popover]", "[data-lg-overlay]", "[role=dialog]", "[data-composer-card]", "[data-slot=sidebar] > *", "#dsh-shell-panel", "[role=menu]"];' +
  ' for (var s = 0; s < sels.length; s++) {' +
  '   var list = document.querySelectorAll(sels[s]);' +
  '   for (var j = 0; j < list.length; j++) {' +
  '     var el = list[j]; var r = el.getBoundingClientRect();' +
  '     if (r.width < 8 || r.height < 8) continue;' +
  '     rows.push([sels[s], Math.round(r.width) + "x" + Math.round(r.height), getComputedStyle(el).borderTopLeftRadius]);' +
  '   }' +
  ' }' +
  ' return { vars: vars, rows: rows };' +
  '})())'
const audit = JSON.parse(await evaluate(AUDIT))
const panel = parseFloat(audit.vars['--lg-radius-panel'])
const allowed = new Set([panel + 'px', panel + 10 + 'px', '0px'])
const invented = audit.rows.filter((row) => !allowed.has(row[2]))
note('tokens: panel ' + audit.vars['--lg-radius-panel'] + ', card ' + audit.vars['--lg-radius-card']
  + ' | allowed corners ' + [...allowed].join(', '))
check('there were surfaces to audit', audit.rows.length >= 3, audit.rows.length + ' rows')
check('every glass corner is a token value (panel, panel + 10, or the square shell box)',
  invented.length === 0,
  invented.length === 0
    ? audit.rows.map((row) => row[0] + ' ' + row[2]).join(' | ')
    : invented.map((row) => row[0] + ' ' + row[2]).join(' ; '))

/* ---------------------------------------------------------------------------
 * 3. The engine is still dressing surfaces.
 *
 * Both probes are the repository's own, run as they are meant to be run -- and both assert
 * something about the live page rather than merely exiting 0, so their exit code is the
 * claim.
 * ------------------------------------------------------------------------- */
for (const probe of ['probe-refraction.mjs', 'probe-edge.mjs']) {
  const run = spawnSync(process.execPath, [root + 'scripts/' + probe, String(port)], { cwd: root, encoding: 'utf8', timeout: 240000 })
  const tail = String(run.stdout ?? '').trim().split('\n').pop() ?? ''
  check(probe + ' exits 0', run.status === 0, 'exit ' + run.status + ': ' + tail.slice(0, 120))
}

const leftovers = await evaluate('document.querySelectorAll("[role=menu],[role=dialog]").length')
check('nothing the gate opened is left on screen', leftovers === 0, leftovers + ' menus/dialogs')

console.log(failures === 0 ? 'acceptance: ALL PASS' : 'acceptance: ' + failures + ' FAIL')
socket.close()
process.exit(failures === 0 ? 0 : 1)
