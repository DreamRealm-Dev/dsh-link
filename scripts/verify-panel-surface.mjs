#!/usr/bin/env node
/**
 * Gate (R178-B) - does the native panel fill the BROWSER PANE's declared surface, or does it sit on the RAIL?
 *
 * Subject: the page host (src-tauri/src/core/panel_host.js, served at /__shell/panel.js) plus the shell's
 * POST /__shell/panel. The rail is a DOCK, not a pane: its box contains the tab strip that switches panes.
 * Measured before the change (this repo, R178): the panel was placed at the rail box 1128,36 300x852 while the
 * rail's own tab strip sits at 1151,58 100x28 - the browser was a lid on the control that switches to it.
 * dsh-browser declares the surface it wants filled with data-dsh-link-surface="true"; the pane's body measured
 * 1141,86 275x790. DSH parks an INACTIVE pane's body at 0x0, so "no surface" and "0x0 surface" both mean CLOSE.
 *
 * Readings (every one has numbers):
 *   1-surface-filled        the panel's reported rect equals the rect the SHIPPED producer computes (panel_host.js
 *                           rect(): the pane's x/y/w, extended down to the rail's bottom edge), with dpr converting
 *                           CSS to the shell's physical units, worstDelta <= 3px
 *   2-tab-strip-uncovered   no role=tab of the rail has any area under the panel's rect, and the page's own
 *                           elementFromPoint at each tab's centre is the tab (or inside it)
 *   3-inactive-pane-closes  after a REAL mouse click switches the rail to its other pane, the surface is gone
 *                           or 0x0 AND the shell holds no panel (or a 0x0 one)
 *   4-negative-control      this gate RUNS ITS OWN JUDGE over the pre-R178 shape (panel on the rail box) and
 *                           requires readings 1 and 2 to go red there - a gate that cannot fail proves nothing.
 *                           It also reports whether the LIVE world is that shape.
 *   5-restored              the gate clicked the rail's tabs and put the selected pane back where it found it
 *   6-handle-centre-free    the panel does not cover the rail divider handle's CENTRE (the handle reaches 4px
 *                           INSIDE its own rail), so the divider stays grabbable; the OS hit test at that point
 *                           is attached as EVIDENCE, never as the verdict
 *
 * The click evidence is REAL mouse input (Input.dispatchMouseEvent through CDP), not element.click(). What it
 * proves is bounded, and the bound is MEASURED and printed rather than assumed: the panel is a separate native
 * child window, and CDP input is injected into the page's own renderer, so it can reach a control that a native
 * window covers. Reading 3's click and reading 2's geometry together are what carry the claim; the click alone
 * is not proof of reachability.
 *
 * This gate takes NO panel lease: reading 3 asks whether the PAGE HOST reacts to an inactive pane, and a lease
 * makes the host stand down (R152/R153), which would measure the gate instead of the product.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when nothing could be measured (no CDP, or
 * no rail in this world, or a reading that could not be reached) - never a silent green.
 *
 * Usage: node scripts/verify-panel-surface.mjs [--cdp-port 9222] [--deadline-ms 6000] [--budget-ms 45000]
 *        [--expect-rect-shift N] [--self-attack]
 */
import { connect } from './cdp-drive.mjs'
import { settlePanelWorld } from './panel-lease.mjs'
import { closeBrowserPane, openBrowserPane } from './panel-world.mjs'

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const CDP_PORT = Number(option('--cdp-port', '9222'))
const DEADLINE_MS = Number(option('--deadline-ms', '6000'))
const BUDGET_MS = Number(option('--budget-ms', '45000'))
const SELF_ATTACK = has('--self-attack')
const TOLERANCE = 3
/* The pane's padding inside the glass frame measures 13 left / 12 right / 12 bottom; 1px is a rounding licence,
 * not a licence to lose the padding (reading 7 refuses 0 explicitly). */
const PADDING_TOLERANCE = 1
const MIN_SURFACE = 48
const WAIT_RAIL_MS = Number(option('--wait-rail-ms', '9000'))

const show = (value) => JSON.stringify(value === undefined ? null : value)
const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)))
const round1 = (value) => Math.round(value * 10) / 10

// ------------------------------------------------------------------------------- page-side probe
// A real function shipped through toString(): the page only runs it, the local parser checks it.
function pageProbe() {
  const boxOf = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
  const rail = document.querySelector('[data-rightbar-col]')
  const surface = document.querySelector('[data-dsh-link-surface="true"]')
  const tabs = []
  const all = document.querySelectorAll('[role="tab"]')
  for (let index = 0; index < all.length; index += 1) {
    const el = all[index]
    if (rail !== null && rail.contains(el) === false) continue
    const box = boxOf(el)
    const cx = Math.round(box.x + box.w / 2)
    const cy = Math.round(box.y + box.h / 2)
    // The page's own hit test: a DOM overlay between the tab and the pointer is visible here, a NATIVE window
    // on top of the page is not (the page cannot see it). Reading the pair is what makes the bound explicit.
    const top = document.elementFromPoint(cx, cy)
    tabs.push({
      x: box.x, y: box.y, w: box.w, h: box.h,
      selected: el.getAttribute('aria-selected') === 'true',
      label: String(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
      top: top === null ? null : { tag: top.tagName.toLowerCase(), cls: String(top.className || '').slice(0, 40), inTab: el === top || el.contains(top) },
    })
  }
  const strip = document.querySelector('[data-dockkit-strip]')
  /* The rail's own divider handle: the rail's box reaches 4px past it (measured 787,36 8x852 against a rail at
   * 791), so a panel that took the rail's left edge would seal the handle's CENTRE under a native window. */
  const sideEls = document.querySelectorAll('[data-side]')
  const sides = []
  for (let index = 0; index < sideEls.length; index += 1) {
    const box = boxOf(sideEls[index])
    sides.push({ side: String(sideEls[index].getAttribute('data-side')), x: box.x, y: box.y, w: box.w, h: box.h, cursor: getComputedStyle(sideEls[index]).cursor })
  }
  const handleEl = document.querySelector('[data-side="rightbar"]')
  const handleBox = handleEl === null ? null : boxOf(handleEl)
  const handle = handleBox === null ? null : { x: handleBox.x, y: handleBox.y, w: handleBox.w, h: handleBox.h, side: String(handleEl.getAttribute('data-side')), cursor: getComputedStyle(handleEl).cursor }
  return JSON.stringify({
    url: location.href, iw: Math.round(window.innerWidth), ih: Math.round(window.innerHeight), dpr: window.devicePixelRatio,
    rail: rail === null ? null : boxOf(rail),
    surfaceCount: document.querySelectorAll('[data-dsh-link-surface]').length,
    surface: surface === null ? null : boxOf(surface),
    strip: strip === null ? null : boxOf(strip),
    sides: sides,
    handle: handle,
    tabs: tabs,
    host: globalThis.__DSH_LINK_PANEL_HOST ? globalThis.__DSH_LINK_PANEL_HOST.state() : null,
  })
}
const PAGE_PROBE = '(' + pageProbe.toString() + ')()'

// ------------------------------------------------------------------------------------------ judge
const asLogical = (bounds, factor) => bounds === null || bounds === undefined ? null : (bounds.units === 'logical' ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } : { x: bounds.x / factor, y: bounds.y / factor, w: bounds.w / factor, h: bounds.h / factor })
const worstDelta = (left, right) => left === null || right === null ? null : Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y), Math.abs(left.w - right.w), Math.abs(left.h - right.h))
/* The OS hit test is EVIDENCE for reading 6, never its verdict. It has been non-discriminating on this machine
 * before (R178-A: WindowFromPoint returned the same Chrome_RenderWidgetHostHWND for a covered tab centre and an
 * uncovered surface centre), so this NAMES what it said rather than turning it into a pass/fail. */
const classifyWitness = (witness, panelPhysical) => {
  if (witness === null || witness === undefined) return 'not taken'
  if (witness.ok !== true) return 'the witness could not run: ' + String(witness.why)
  const hit = witness.hit
  if (hit === null || hit === undefined) return 'the witness returned no hit'
  const near = (a, b) => Math.abs(a - b) <= 3
  if (panelPhysical !== null && panelPhysical !== undefined && near(hit.clientBox.x, panelPhysical.x) && near(hit.clientBox.y, panelPhysical.y) && near(hit.clientBox.w, panelPhysical.w) && near(hit.clientBox.h, panelPhysical.h)) return 'the PANEL child window (the divider centre is behind the panel)'
  const page = (witness.webviews || []).find((row) => row.x === 0 && row.y === 0)
  if (page !== undefined && near(hit.clientBox.x, page.x) && near(hit.clientBox.y, page.y) && near(hit.clientBox.w, page.w) && near(hit.clientBox.h, page.h)) return 'the PAGE client window (nothing native sits on the point)'
  return 'neither (' + String(hit.cls) + ' at ' + JSON.stringify(hit.clientBox) + ')'
}
// the overlap of two CSS boxes; an EDGE TOUCH is not a cover (the fixed pane's surface starts exactly where the
// tab strip ends, measured 1141,86 against a strip bottom of 86), so the test is "does either extent go negative"
const overlap = (a, b) => {
  if (a === null || b === null) return null
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return { w: w, h: h, covered: w > 0 && h > 0 }
}
/* The pane's padding inside the app's glass frame, measured against the RAIL: the frame's right and bottom edges
 * ARE the rail's (frame 12,36 1416x852 vs rail 791,36 637x852), while the frame's LEFT edge is the window's, not
 * the rail's - which is why the left padding is read against the rail. */
const insetsOf = (box, rail) => box === null || rail === null ? null : {
  left: Math.round(box.x - rail.x),
  right: Math.round((rail.x + rail.w) - (box.x + box.w)),
  bottom: Math.round((rail.y + rail.h) - (box.y + box.h)),
  top: Math.round(box.y - rail.y),
}

const expectations = (over = {}) => ({
  rectShift: over.rectShift === undefined ? Number(option('--expect-rect-shift', '0')) : over.rectShift,
})

const judge = (world, expect) => {
  const readings = []
  const record = (id, ok, detail, evidence) => readings.push({ id, ok: ok === true, detail: String(detail), evidence: evidence || [] })
  const factor = world.dpr === null || world.dpr === undefined ? 1 : world.dpr
  const surface = world.surface
  const panel = asLogical(world.panel !== null && world.panel !== undefined && world.panel.exists === true ? world.panel.bounds : null, factor)
  const rail = world.rail

  { // 1-surface-filled
    const problems = []
    if (world.surfaceCount === 0) problems.push('the page declares no [data-dsh-link-surface] at all, so the browser pane did not name the rectangle it wants filled (the rail cannot stand in for it)')
    if (surface === null) problems.push('no surface rectangle was measured')
    else if (surface.w < MIN_SURFACE || surface.h < MIN_SURFACE) problems.push('the declared surface is only ' + surface.w + 'x' + surface.h + ' (floor ' + MIN_SURFACE + 'px), so it holds no browser')
    if (world.panel === null || world.panel === undefined) problems.push('the shell did not answer op=state')
    else if (world.panel.exists !== true) problems.push('the shell reports no panel although the pane declares a surface')
    if (world.panel !== null && world.panel.exists === true && world.panel.bounds === null) problems.push('the panel exists and reports no bounds')
    /* R178 (fourth pass): the panel is the ANCHOR's rectangle, unchanged - all four sides keep the pane's own
     * padding inside the app's liquid-glass frame (measured frame _6nbfjq_frame = 12,36 1416x852, whose right and
     * bottom edges coincide with the rail's 791,36 637x852). Measured against the rail: pane body 804,86 612x790
     * gives left 13, right 12, bottom 12. The THIRD pass extended the height to the rail's bottom edge (panel
     * 804,86 612x802, bottom padding 0), which puts a square panel's corners against the frame's rounded ones and
     * was reported by the user as "the corners disagree and it pushes my frame" - so the bottom padding is the
     * pane's, like the other three sides. Reading 7 pins that padding; reading 6 pins that the rail's divider
     * handle (787,36 8x852, reaching 791..795 INSIDE the rail) is not sealed. */
    const wanted = surface === null ? null : { x: surface.x + expect.rectShift, y: surface.y, w: surface.w, h: surface.h }
    const worst = worstDelta(panel, wanted)
    if (panel !== null && wanted !== null && (worst === null || worst > TOLERANCE)) problems.push('the panel is not on the declared surface: worstDelta=' + round1(worst) + 'px (tolerance ' + TOLERANCE + ')')
    if (problems.length > 0 && panel !== null && rail !== null && worstDelta(panel, rail) <= TOLERANCE) problems.push('the panel sits exactly on the RAIL box ' + show(rail) + ', which contains the pane switcher: that is the pre-R178 shape')
    record('1-surface-filled', problems.length === 0, problems.length === 0
      ? 'the native panel fills the rectangle the pane anchor declares, unchanged (all four sides keep the pane padding inside the glass frame): worstDelta=' + round1(worst) + 'px <= ' + TOLERANCE
      : 'FAIL: ' + problems.join(' | '),
      ['surface(count=' + String(world.surfaceCount) + ')=' + show(surface), 'panelRaw=' + show(world.panel === null || world.panel === undefined ? null : world.panel.bounds) + ' units=' + show(world.panel === null || world.panel === undefined || world.panel.bounds === null ? null : world.panel.bounds.units), 'dpr=' + show(world.dpr), 'panelLogical=' + show(panel === null ? null : { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.w), h: Math.round(panel.h) }), 'rail=' + show(rail), 'worstDelta=' + show(worst === null ? null : round1(worst)), 'railDelta=' + show(panel === null || rail === null ? null : round1(worstDelta(panel, rail))), 'paddingInsideTheFrame=' + show(insetsOf(panel, rail))])
  }

  { // 2-tab-strip-uncovered
    const problems = []
    const tabs = world.tabs === undefined || world.tabs === null ? [] : world.tabs
    if (tabs.length === 0) problems.push('the rail exposes no role=tab element, so nothing about the pane switcher could be judged')
    const lines = []
    for (let index = 0; index < tabs.length; index += 1) {
      const tab = tabs[index]
      const cover = overlap(tab, panel)
      lines.push('tab[' + index + '] "' + tab.label + '" at ' + tab.x + ',' + tab.y + ' ' + tab.w + 'x' + tab.h + ' selected=' + String(tab.selected) + ' overlapWithPanel=' + (cover === null ? 'n/a' : cover.w + 'x' + cover.h) + ' topAtCentre=' + show(tab.top))
      if (cover !== null && cover.covered === true) problems.push('the panel covers tab[' + index + '] "' + tab.label + '" by ' + cover.w + 'x' + cover.h + 'px')
      if (tab.top !== null && tab.top !== undefined && tab.top.inTab !== true) problems.push('in the page the centre of tab[' + index + '] "' + tab.label + '" belongs to ' + tab.top.tag + '.' + tab.top.cls + ', not to the tab')
    }
    record('2-tab-strip-uncovered', problems.length === 0, problems.length === 0
      ? 'no rail tab has any area under the panel and every tab centre resolves to its own tab'
      : 'FAIL: ' + problems.join(' | '),
      lines.concat(['panelLogical=' + show(panel === null ? null : { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.w), h: Math.round(panel.h) }), 'strip=' + show(world.strip)]))
  }

  { // 3-inactive-pane-closes
    const switched = world.switched
    if (switched === null || switched === undefined) {
      record('3-inactive-pane-closes', true, 'NOT MEASURED: ' + String(world.switchSkipReason || 'the gate could not switch the rail to another pane, so the inactive-pane state was never created - this line is not a pass'), ['switched=null'])
    } else {
      const problems = []
      const surfaceAfter = switched.surface
      const panelAfter = asLogical(switched.panel !== null && switched.panel !== undefined && switched.panel.exists === true ? switched.panel.bounds : null, factor)
      if (surfaceAfter !== null && surfaceAfter.w >= MIN_SURFACE && surfaceAfter.h >= MIN_SURFACE) problems.push('after switching to "' + String(switched.awayLabel) + '" the declared surface still measures ' + surfaceAfter.w + 'x' + surfaceAfter.h + ', so the browser pane was not parked')
      if (switched.panel !== null && switched.panel !== undefined && switched.panel.exists === true && panelAfter !== null && (panelAfter.w > 0 || panelAfter.h > 0)) problems.push('the shell still holds a panel at ' + show(switched.panel.bounds) + ' while the browser pane is inactive (an inactive pane parks its body at 0x0, so the panel had to close)')
      record('3-inactive-pane-closes', problems.length === 0, problems.length === 0
        ? 'with the rail switched to "' + String(switched.awayLabel) + '" the surface is ' + show(surfaceAfter) + ' and the shell holds ' + show(switched.panel === null || switched.panel === undefined || switched.panel.exists !== true ? 'no panel' : show(switched.panel.bounds))
        : 'FAIL: ' + problems.join(' | '),
        ['awayLabel=' + show(switched.awayLabel), 'clicked=' + show(switched.clicked), 'ariaSelectedMoved=' + show(switched.flipped), 'selectedLabelAfter=' + show(switched.selectedAfter), 'surfaceAfter=' + show(surfaceAfter), 'panelAfterExists=' + show(switched.panel === null || switched.panel === undefined ? null : switched.panel.exists), 'panelAfterBounds=' + show(switched.panel === null || switched.panel === undefined ? null : switched.panel.bounds), 'waitedMs=' + show(switched.waitedMs)])
    }
  }

  { // 4-negative-control
    const control = world.control
    if (control === null || control === undefined) {
      record('4-negative-control', false, 'FAIL: the gate could not run its own control, so it never showed that it can fail', ['control=null'])
    } else {
      const reds = control.red
      /* The pre-R178 shape reddens THREE claims, not two: a panel on the whole rail box covers the tab strip AND
       * puts its left edge exactly on the divider handle centre (the rail box starts at 791, which IS the handle
       * centre x). Declaring only two would be a declared-set fiction, so the third is declared here. */
      const wanted = world.handle === null || world.handle === undefined
        ? ['1-surface-filled', '2-tab-strip-uncovered', '7-frame-padding-kept']
        : ['1-surface-filled', '2-tab-strip-uncovered', '6-handle-centre-free', '7-frame-padding-kept']
      const precise = wanted.every((id) => reds.includes(id)) && reds.length === wanted.length
      record('4-negative-control', precise, precise
        ? 'the pre-R178 shape (panel on the rail box ' + show(control.rail) + ', pane surface ' + show(control.surface) + ') reddens exactly the claims it should: red=' + show(reds) + (control.liveOnRail === true ? ' - and this LIVE world is that shape' : '')
        : 'FAIL: with the panel put on the rail box the judge should redden ' + show(wanted) + ' and it reddened ' + show(reds),
        ['controlPanel=' + show(control.panel), 'red=' + show(reds), 'livePanelOnRail=' + show(control.liveOnRail), 'livePanelLogical=' + show(control.livePanel)])
    }
  }

  { // 5-restored
    const problems = []
    if (world.restored === null || world.restored === undefined) problems.push('the gate could not say whether it restored the rail')
    else if (world.restored.ok !== true) problems.push('the rail was left on "' + String(world.restored.on) + '" instead of "' + String(world.restored.wanted) + '"')
    record('5-restored', problems.length === 0, problems.length === 0
      ? 'the rail is back on the pane the gate found selected (' + String(world.restored === null || world.restored === undefined ? 'never clicked' : world.restored.wanted) + ')'
      : 'FAIL: ' + problems.join(' | '),
      ['restored=' + show(world.restored)])
  }
  { // 6-handle-centre-free
    const handle = world.handle
    if (handle === null || handle === undefined) {
      record('6-handle-centre-free', true, 'NOT MEASURED: this world exposes no [data-side="rightbar"] divider handle on the rail, so the divider could not be judged - this line is not a pass', ['handle=null', 'sides=' + show(world.sides)])
    } else {
      const centre = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 }
      /* The OS hit test put the panel on the handle's centre at EXACTLY this boundary (panel left edge 791 ==
       * the handle's centre x 791), so a point ON the panel's edge counts as covered: this tolerance is
       * sub-pixel, not the 3px licence reading 1 gets. */
      const covered = panel !== null && centre.x >= panel.x - 0.5 && centre.x <= panel.x + panel.w + 0.5 && centre.y >= panel.y - 0.5 && centre.y <= panel.y + panel.h + 0.5
      record('6-handle-centre-free', covered !== true, covered !== true
        ? 'the panel does not reach the divider handle centre (' + round1(centre.x) + ',' + round1(centre.y) + '), so the divider stays grabbable there'
        : 'FAIL: the panel covers the divider handle centre (' + round1(centre.x) + ',' + round1(centre.y) + '): handle ' + show({ x: handle.x, y: handle.y, w: handle.w, h: handle.h }) + ' panel ' + show(panel === null ? null : { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.w), h: Math.round(panel.h) }) + ' - the divider cannot be grabbed at its centre',
        ['handle=' + show({ x: handle.x, y: handle.y, w: handle.w, h: handle.h, side: handle.side, cursor: handle.cursor }), 'handleCentre=' + show({ x: round1(centre.x), y: round1(centre.y) }), 'handleReachesInsideRailBy=' + show(rail === null ? null : round1(rail.x - handle.x)), 'panelLogical=' + show(panel === null ? null : { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.w), h: Math.round(panel.h) }), 'panelLeftMinusRailLeft=' + show(panel === null || rail === null ? null : round1(panel.x - rail.x)), 'windowFromPointHit=' + show(world.handleWitness === null || world.handleWitness === undefined ? null : (world.handleWitness.hit === undefined ? world.handleWitness : world.handleWitness.hit)), 'windowFromPointWebviews=' + show(world.handleWitness === null || world.handleWitness === undefined ? null : world.handleWitness.webviews), 'windowFromPointSays=' + classifyWitness(world.handleWitness, world.panelPhysical)])
    }
  }

  { // 7-frame-padding-kept
    const reference = insetsOf(surface, rail)
    const seen = insetsOf(panel, rail)
    const problems = []
    if (reference === null || seen === null) problems.push('no rail, no surface or no panel, so the padding inside the glass frame could not be measured')
    else {
      for (const side of ['left', 'right', 'bottom']) {
        if (Math.abs(seen[side] - reference[side]) > PADDING_TOLERANCE) problems.push('the panel\'s ' + side + ' padding inside the frame is ' + String(seen[side]) + 'px where the pane declares ' + String(reference[side]) + 'px (tolerance ' + String(PADDING_TOLERANCE) + ')')
        if (seen[side] < 1) problems.push('the panel touches the frame on its ' + side + ' edge (' + String(seen[side]) + 'px), so a square panel corner is laid on the frame\'s rounded one - measured: this is what the third pass (bottom 802) did')
      }
    }
    record('7-frame-padding-kept', problems.length === 0, problems.length === 0
      ? 'the panel keeps the pane\'s padding on every side inside the glass frame (left ' + String(seen.left) + ' / right ' + String(seen.right) + ' / bottom ' + String(seen.bottom) + 'px, top ' + String(seen.top) + 'px below the frame)'
      : 'FAIL: ' + problems.join(' | '),
      ['paddingReference(pane)=' + show(reference), 'paddingSeen(panel)=' + show(seen), 'tolerance=' + String(PADDING_TOLERANCE), 'panelLogical=' + show(panel === null ? null : { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.w), h: Math.round(panel.h) }), 'surface=' + show(surface), 'rail=' + show(rail), 'frameNote=the glass frame measured 12,36 1416x852 shares its right and bottom edges with the rail'])
  }

  return readings
}

// ----------------------------------------------------------------------------------------- probe
const panelState = async (port) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'state' }) }).catch(() => null)
  if (answer === null) return null
  try { return await answer.json() } catch (error) { return null }
}
const hasPanel = (state) => state !== null && state !== undefined && state.exists === true && state.bounds !== null && state.bounds !== undefined && state.bounds.w > 0 && state.bounds.h > 0
const tabsOf = (probe) => probe !== null && probe.ok === true && Array.isArray(probe.value.tabs) ? probe.value.tabs : []
const selectedLabel = (tabs) => { const hit = tabs.find((tab) => tab.selected === true); return hit === undefined ? null : hit.label }

const collect = async () => {
  const cdp = await connect({ port: CDP_PORT, deadlineMs: 10000 })
  if (cdp === null) return null
  const started = Date.now()
  const left = () => Math.max(0, BUDGET_MS - (Date.now() - started))
  const port = new URL(cdp.page).port
  // R279: start from a world every gate can share. The panel is one native object, and the suite proved it: a gate
  // that inherits a panel still carrying another surface's rectangle reads worstDelta=190px for one beat.
  const settled = await settlePanelWorld(port, { cdpPort: CDP_PORT })
  const world = { settled, url0: cdp.page, dpr: null, rail: null, surface: null, surfaceCount: null, tabs: [], strip: null, panel: null, switched: null, restored: null, control: null, progress: [] }
  const call = async (ms) => await cdp.json(PAGE_PROBE).catch(() => ({ ok: false, why: 'the page probe threw' }))
  try {
    // A client that has just BOOTED is not yet the world: it comes up on its home screen with no session, and
    // the rail only exists once a session is open (measured in R166 for the same reason). Waiting for the rail
    // is what tells "this world has no rail" apart from "this world is not ready yet" - the first version
    // skipped on a boot that was 8 seconds from having exactly the rail it came to judge.
    let first = await call()
    const railUntil = Date.now() + Math.min(left(), WAIT_RAIL_MS)
    while (first.ok === true && first.value.rail === null && Date.now() < railUntil) { await sleep(600); first = await call() }
    if (first.ok !== true) { world.probeWhy = first.why; cdp.close(); return world }
    world.dpr = first.value.dpr
    world.rail = first.value.rail
    world.railWaitMs = Date.now() - started
    if (world.rail === null) { world.noRail = true; cdp.close(); return world }
    // R278: THE PREMISE, named. This gate asks "does the native panel fill the BROWSER PANE's declared surface",
    // so the browser pane has to be the pane IN FRONT. Measured in this world: the rail comes up on the LINK panel
    // and declares no surface at all, and the gate then took the first UNSELECTED tab as "the other pane to switch
    // away from" - which happened to be the browser chip, so it opened the very pane it came to measure and called
    // the surface it had just created "a pane that was not parked". Bringing the browser pane to the front first,
    // and restoring the tab that was selected on ENTRY, is what makes readings 1 and 3 mean what they say.
    const entryTabs = tabsOf(first)
    world.entryLabel = selectedLabel(entryTabs)
    const BROWSER_WORDS = ['Browser', 'browser', '\u6d4f\u89c8\u5668']
    let browserTab = entryTabs.find((tab) => BROWSER_WORDS.some((word) => String(tab.label === null || tab.label === undefined ? '' : tab.label).includes(word)))
    // R357: a COLD rail has no browser tab at all (the pane becomes a tab only once somebody opens it), and that is the
    // world this gate kept declining in. It opens one through the rail own 新标签页 menu - the same two clicks a person
    // makes - and remembers that it did, so the reading below judges a world the gate itself prepared instead of a red
    // it cannot explain.
    world.openedBrowserPane = null
    if (browserTab === undefined) {
      const opened = await openBrowserPane(port, CDP_PORT)
      world.openedBrowserPane = opened
      if (opened.opened === true) {
        first = await call()
        const afterTabs = tabsOf(first)
        browserTab = afterTabs.find((tab) => BROWSER_WORDS.some((word) => String(tab.label === null || tab.label === undefined ? '' : tab.label).includes(word)))
        if (browserTab !== undefined) world.broughtBrowserToFront = true
      }
    }
    world.browserTabLabel = browserTab === undefined ? null : browserTab.label
    console.log('        door: ' + JSON.stringify(world.openedBrowserPane))
    world.broughtBrowserToFront = false
    if (browserTab !== undefined && browserTab.selected !== true) {
      await cdp.click({ x: Math.round(browserTab.x + browserTab.w / 2), y: Math.round(browserTab.y + browserTab.h / 2) })
      const frontUntil = Date.now() + Math.min(left(), 6000)
      while (Date.now() < frontUntil) {
        await sleep(400)
        const front = await call()
        if (front.ok === true && front.value.surfaceCount > 0) { first = front; break }
      }
      // Read the state AGAIN even when no surface arrived: the tab did move, and the readings below have to judge
      // the world that follows the click rather than the one before it.
      if (first.value.surfaceCount === 0) first = await call()
      world.broughtBrowserToFront = true
    }
    world.surfaceCount = first.value.surfaceCount
    world.surface = first.value.surface
    world.strip = first.value.strip
    world.tabs = first.value.tabs
    world.handle = first.value.handle === undefined ? null : first.value.handle
    world.sides = first.value.sides === undefined ? null : first.value.sides
    // "Another pane" must not be the browser pane itself: with that pane now in front, switching to it would be
    // switching to what is already selected, and the inactive-pane state would never be created.
    const away = world.tabs.find((tab) => tab.selected === false && tab.label !== world.browserTabLabel)
    // The world is put back on the tab that was selected when the gate ARRIVED, not on the browser tab this gate
    // brought to the front: a gate that leaves the rail on a different pane has changed the thing it measured.
    const backLabel = world.entryLabel === undefined || world.entryLabel === null ? selectedLabel(world.tabs) : world.entryLabel
    world.progress.push('found rail=' + show(world.rail) + ' surface=' + show(world.surface) + ' tabs=' + String(world.tabs.length) + ' selected=' + show(backLabel))

    // a panel has to exist for readings 1 and 2 to judge anything; the host places it on its own 400 ms tick
    const panelUntil = Date.now() + Math.min(left(), DEADLINE_MS)
    world.panel = await panelState(port)
    while (Date.now() < panelUntil && hasPanel(world.panel) === false) { await sleep(400); world.panel = await panelState(port) }
    // R279: the host places the panel on its own tick, so a panel that arrived carrying ANOTHER surface's rectangle
    // keeps that rectangle until the next placement. Measured after the foreign-app gate handed the world over:
    // worstDelta 190px at entry, 0px one beat later - and the gate called the product wrong for the beat. Waiting
    // for the placement is waiting for the thing being measured, not waiting for a green: a host that never places
    // it still ends in the same red.
    if (world.surface !== null && hasPanel(world.panel) === true) {
      const settleUntil = Date.now() + Math.min(4000, left())
      const factorNow = world.dpr === null || world.dpr === undefined ? 1 : world.dpr
      while (Date.now() < settleUntil) {
        const logical = world.panel !== null && world.panel.exists === true && world.panel.bounds !== null ? asLogical(world.panel.bounds, factorNow) : null
        const off = worstDelta(logical, world.surface)
        if (off !== null && off <= TOLERANCE) break
        await sleep(300)
        world.panel = await panelState(port)
      }
    }
    world.waitedForPanelMs = Date.now() - started
    world.progress.push('panel after ' + String(world.waitedForPanelMs) + 'ms: exists=' + show(world.panel === null ? null : world.panel.exists) + ' bounds=' + show(world.panel === null ? null : world.panel.bounds))

    // 2/3: REAL mouse input on the rail's pane switcher. Click the tab that is NOT selected, require aria-selected
    // to move, read the inactive-pane state, then click the ORIGINAL pane back.
    if (away === undefined) {
      world.switchSkipReason = 'the rail has only one role=tab, so there is no other pane to switch to'
    } else if (left() < 2000) {
      world.switchSkipReason = 'the gate ran out of its ' + String(BUDGET_MS) + 'ms budget before it could switch panes'
    } else {
      const before = await call()
      const beforeTabs = tabsOf(before)
      world.tabs = beforeTabs.length > 0 ? beforeTabs : world.tabs
      const spot = world.tabs.find((tab) => tab.selected === false && tab.label !== world.browserTabLabel)
      const clicked = spot === undefined ? null : { x: Math.round(spot.x + spot.w / 2), y: Math.round(spot.y + spot.h / 2), label: spot.label }
      const switchStarted = Date.now()
      const switched = { awayLabel: spot === undefined ? null : spot.label, clicked: clicked, flipped: false, selectedAfter: null, surface: null, panel: null, waitedMs: null }
      if (clicked !== null) {
        await cdp.click({ x: clicked.x, y: clicked.y })
        const flipUntil = Date.now() + Math.min(left(), 5000)
        // the host needs a tick to react to the parked pane, so this loop waits for BOTH facts and records what
        // it saw last; a state that never arrives stays a red reading instead of a timeout.
        while (Date.now() < flipUntil) {
          await sleep(400)
          const seen = await call()
          const tabs = tabsOf(seen)
          const panel = await panelState(port)
          if (seen.ok === true) switched.surface = seen.value.surface
          switched.panel = panel
          switched.selectedAfter = selectedLabel(tabs)
          if (selectedLabel(tabs) === clicked.label) switched.flipped = true
          const parked = switched.surface === null || switched.surface.w < MIN_SURFACE || switched.surface.h < MIN_SURFACE
          if (switched.flipped === true && parked === true && hasPanel(panel) === false) break
        }
        switched.waitedMs = Date.now() - switchStarted
        world.switched = switched
        world.progress.push('switched to ' + show(clicked.label) + ': ariaSelectedMoved=' + show(switched.flipped) + ' surfaceAfter=' + show(switched.surface) + ' panelAfter=' + show(switched.panel === null ? null : switched.panel.bounds))
        // restore: click the pane that was selected when the gate started
        const now = await call()
        const backTabs = tabsOf(now)
        const back = backLabel === null ? undefined : backTabs.find((tab) => tab.label === backLabel && tab.selected !== true)
        if (back === undefined) {
          world.restored = { ok: selectedLabel(backTabs) === backLabel, wanted: backLabel, on: selectedLabel(backTabs), why: 'the original tab was not found to click back' }
        } else {
          await cdp.click({ x: Math.round(back.x + back.w / 2), y: Math.round(back.y + back.h / 2) })
          const backUntil = Date.now() + Math.min(left(), 5000)
          let seenLabel = selectedLabel(tabsOf(await call()))
          while (Date.now() < backUntil && seenLabel !== backLabel) { await sleep(400); seenLabel = selectedLabel(tabsOf(await call())) }
          world.restored = { ok: seenLabel === backLabel, wanted: backLabel, on: seenLabel }
        }
        world.progress.push('restored: ' + show(world.restored))
        // Readings 1 and 2 judge the panel while the browser pane was ACTIVE, so the post-restore probe is kept
        // SEPARATE rather than written back over them: at that instant the panel is closed (the host needs its own
        // tick to reopen it), and judging a pre-switch panel rect against a post-restore surface compares two
        // different moments. Measured: this overwrite made reading 1 report "no panel" in a world whose panel had
        // been sitting exactly on the surface 8 seconds earlier.
        const end = await call()
        world.afterRestore = { surface: end.ok === true ? end.value.surface : null, tabs: end.ok === true ? end.value.tabs : null, panel: await panelState(port) }
        // R364: if THIS gate opened the browser pane (a cold rail), it closes it again. Leaving the tab behind put a
        // browser chip and a freshly drawn pane into the next gate world, and `panel-action-render` reading 4 refuses a
        // browser pane that was already drawn before its own press - the measured family red of R363.
        if (world.openedBrowserPane !== null && world.openedBrowserPane !== undefined && world.openedBrowserPane.opened === true) {
          const shut = await closeBrowserPane(port, CDP_PORT)
          world.closedOwnPane = shut
        }
      } else {
        world.switched = switched
        world.switchSkipReason = 'no unselected tab was found to switch to'
      }
    }
    // 4-negative-control: the SAME judge, run over the pre-R178 shape (the panel on the whole rail box), must
    // redden readings 1 and 2. It runs LAST, over an otherwise complete world, so the comparison is not polluted
    // by a half-built one (the first version ran it before the tab switch and read two extra reds that were only
    // artefacts of that). A world cannot contain its own control, so this id is excluded from the comparison.
    {
      const panelLogical = asLogical(world.panel !== null && world.panel.exists === true ? world.panel.bounds : null, world.dpr)
      const onRail = world.rail
      const controlWorld = { ...world, control: null, panel: { exists: true, bounds: { units: 'physical', x: onRail.x * world.dpr, y: onRail.y * world.dpr, w: onRail.w * world.dpr, h: onRail.h * world.dpr } } }
      const controlReadings = judge(controlWorld, expectations())
      world.control = {
        rail: onRail, surface: world.surface, panel: controlWorld.panel.bounds,
        red: controlReadings.filter((reading) => reading.ok === false && reading.id !== '4-negative-control').map((reading) => reading.id),
        livePanel: panelLogical === null ? null : { x: Math.round(panelLogical.x), y: Math.round(panelLogical.y), w: Math.round(panelLogical.w), h: Math.round(panelLogical.h) },
        liveOnRail: panelLogical !== null && worstDelta(panelLogical, onRail) <= TOLERANCE,
      }
    }
    cdp.close()
  } catch (error) {
    world.collectError = error && error.stack ? error.stack : String(error)
    try { cdp.close() } catch (ignored) { }
  }
  // R279: hand the world back in the shared shape - no panel, rail off the browser pane - so the gate after this one
  // starts where this one started instead of where it stopped. This gate takes no lease, so closing is unconditional.
  try { world.exitSettled = await settlePanelWorld(new URL(String(world.url0 ?? 'http://127.0.0.1:31761')).port, { cdpPort: CDP_PORT }) } catch (error) { world.exitSettled = { action: 'threw', why: String(error) } }
  return world
}

// -------------------------------------------------------------------------------------- self-attack
const HONEST = () => ({
  kind: 'synthetic', url0: 'synthetic://pane', dpr: 1.5,
  rail: { x: 791, y: 36, w: 637, h: 852 },
  surface: { x: 804, y: 86, w: 612, h: 790 }, surfaceCount: 1,
  strip: { x: 804, y: 48, w: 612, h: 38 },
  handle: { x: 787, y: 36, w: 8, h: 852, side: 'rightbar', cursor: 'col-resize' },
  sides: [{ side: 'rightbar', x: 787, y: 36, w: 8, h: 852, cursor: 'col-resize' }],
  tabs: [
    { x: 814, y: 58, w: 100, h: 28, selected: true, label: 'browser', top: { tag: 'span', cls: 'title', inTab: true } },
    { x: 924, y: 58, w: 100, h: 28, selected: false, label: 'files', top: { tag: 'span', cls: 'title', inTab: true } },
    { x: 1034, y: 58, w: 100, h: 28, selected: false, label: 'start', top: { tag: 'span', cls: 'title', inTab: true } },
  ],
  panel: { exists: true, bounds: { units: 'physical', x: 804 * 1.5, y: 86 * 1.5, w: 612 * 1.5, h: 790 * 1.5 } },
  switched: { awayLabel: 'files', clicked: { x: 974, y: 72, label: 'files' }, flipped: true, selectedAfter: 'files', surface: null, panel: { exists: false, bounds: null }, waitedMs: 430 },
  restored: { ok: true, wanted: 'browser', on: 'browser' },
  control: { rail: { x: 791, y: 36, w: 637, h: 852 }, surface: { x: 804, y: 86, w: 612, h: 790 }, panel: { units: 'physical', x: 791 * 1.5, y: 36 * 1.5, w: 637 * 1.5, h: 852 * 1.5 }, red: ['1-surface-filled', '2-tab-strip-uncovered', '6-handle-centre-free', '7-frame-padding-kept'], liveOnRail: false, livePanel: { x: 804, y: 86, w: 612, h: 790 } },
})

const selfAttack = () => {
  const honest = expectations()
  let failures = 0
  const baseline = judge(HONEST(), honest)
  const baselineRed = baseline.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  ' + (baselineRed.length === 0 ? 'ok  ' : 'FAIL') + '  baseline. the labelled SYNTHETIC fixed world judged honestly is green: ' + baseline.map((reading) => reading.id + '=' + (reading.ok ? 'ok' : 'FAIL')).join(' '))
  if (baselineRed.length > 0) failures += 1
  console.log('          (SYNTHETIC, not the app: this exercises the judge, never the probe.)')
  const panelOn = (box) => ({ ...HONEST(), panel: { exists: true, bounds: { units: 'physical', x: box.x * 1.5, y: box.y * 1.5, w: box.w * 1.5, h: box.h * 1.5 } } })
  const mutants = [
    // the whole-rail shape is the second-pass regression on top of the first: it covers the strip AND seals the
    // handle centre (rail box left 791 == handle centre x 791), so it reddens three claims, not two.
    { name: 'the panel placed on the whole rail box (the second-pass shape)', world: panelOn({ x: 791, y: 36, w: 637, h: 852 }), expect: honest, mustRedden: ['1-surface-filled', '2-tab-strip-uncovered', '6-handle-centre-free', '7-frame-padding-kept'] },
    { name: 'the panel 50px below where the anchor puts it', world: panelOn({ x: 804, y: 136, w: 612, h: 790 }), expect: honest, mustRedden: ['1-surface-filled', '7-frame-padding-kept'] },
    { name: 'the panel one pixel into the tab strip (still within the 3px rect tolerance)', world: panelOn({ x: 804, y: 85, w: 612, h: 791 }), expect: honest, mustRedden: ['2-tab-strip-uncovered'] },
    // the THIRD pass: the panel extended to the rail's bottom edge. Reading 1 sees the 50px rectangle delta, and
    // reading 7 sees WHY it matters (bottom padding 0 against the pane's 12) - the two are declared together.
    { name: 'the panel extended down to the rail bottom edge (the third-pass shape)', world: panelOn({ x: 804, y: 86, w: 612, h: 802 }), expect: honest, mustRedden: ['1-surface-filled', '7-frame-padding-kept'] },
    // this one keeps the panel ON the anchor while the ANCHOR itself declares a surface flush with the rail's
    // bottom padding: reading 1 is satisfied and reading 7 must redden on its own.
    { name: 'a pane that declares a surface flush with the frame bottom padding', world: { ...HONEST(), surface: { x: 804, y: 86, w: 612, h: 802 }, panel: { exists: true, bounds: { units: 'physical', x: 804 * 1.5, y: 86 * 1.5, w: 612 * 1.5, h: 802 * 1.5 } } }, expect: honest, mustRedden: ['7-frame-padding-kept'] },
    // this mutant moves the FIXTURE, not the product: its job is to show reading 6 can redden ALONE, with no rect
    // claim beside it.
    { name: 'the rail divider handle moved 14px inward, under the pane inset', world: { ...HONEST(), handle: { x: 801, y: 36, w: 8, h: 852, side: 'rightbar' } }, expect: honest, mustRedden: ['6-handle-centre-free'] },
    { name: 'a pane that stays open when the rail switches away', world: { ...HONEST(), switched: { ...HONEST().switched, surface: { x: 804, y: 86, w: 612, h: 790 }, panel: { exists: true, bounds: { units: 'physical', x: 804 * 1.5, y: 86 * 1.5, w: 612 * 1.5, h: 790 * 1.5 } } } }, expect: honest, mustRedden: ['3-inactive-pane-closes'] },
    // with no surface there is no reference padding either, so reading 7 reddens with reading 1 (measured, not declared)
    { name: 'a pane that never declares a surface at all', world: { ...HONEST(), surface: null, surfaceCount: 0 }, expect: honest, mustRedden: ['1-surface-filled', '7-frame-padding-kept'] },
    { name: 'a judge that expects the surface 50px away', world: HONEST(), expect: expectations({ rectShift: 50 }), mustRedden: ['1-surface-filled'] },
    { name: 'a DOM overlay on top of the tab centres', world: { ...HONEST(), tabs: HONEST().tabs.map((tab) => ({ ...tab, top: { tag: 'div', cls: 'overlay', inTab: false } })) }, expect: honest, mustRedden: ['2-tab-strip-uncovered'] },
    { name: 'a rail left on the wrong pane', world: { ...HONEST(), restored: { ok: false, wanted: 'browser', on: 'start' } }, expect: honest, mustRedden: ['5-restored'] },
  ]
  for (const mutant of mutants) {
    const seen = judge(mutant.world, mutant.expect).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const precise = seen.length === mutant.mustRedden.length && mutant.mustRedden.every((id) => seen.includes(id))
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + show(seen) + ' declared=' + show(mutant.mustRedden))
  }
  // the control reading has to be red in an UNCONTROLLED world too: a judge whose control never runs is a
  // control that proves nothing.
  const noControl = judge({ ...HONEST(), control: null }, honest).filter((reading) => reading.ok === false).map((reading) => reading.id)
  const precise = noControl.length === 1 && noControl[0] === '4-negative-control'
  if (precise === false) failures += 1
  console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. a world where the gate could not run its own control: red=' + show(noControl) + ' declared=' + show(['4-negative-control']))
  console.log('  note the live probe was NOT exercised in this mode: --self-attack attacks the judge only.')
  return failures === 0 ? 0 : 1
}

// ------------------------------------------------------------------- OS hit-test witness (evidence only)
const HANDLE_WITNESS_LINES = [
  "param([string]$Point = '0,0', [string]$Panel = '0,0,0,0')",
  "$ErrorActionPreference = 'Continue'",
  "Add-Type @'",
  "using System; using System.Text; using System.Runtime.InteropServices;",
  "public struct RECT { public int Left, Top, Right, Bottom; }",
  "public struct POINT { public int X, Y; }",
  "public class HW {",
  "  [DllImport(\"user32.dll\")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);",
  "  [DllImport(\"user32.dll\")] public static extern int GetSystemMetrics(int index);",
  "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r);",
  "  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);",
  "  [DllImport(\"user32.dll\")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);",
  "  [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();",
  "  [DllImport(\"user32.dll\")] public static extern IntPtr WindowFromPoint(POINT p);",
  "  [DllImport(\"user32.dll\")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);",
  "  public delegate bool EnumProc(IntPtr h, IntPtr p);",
  "}",
  "'@",
  "[void][HW]::SetProcessDpiAwarenessContext([IntPtr](-4))",
  "if ([HW]::GetSystemMetrics(0) -lt 2000) { [void][HW]::SetProcessDPIAware() }",
  "$proc = Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1",
  "if (-not $proc) { Write-Output '{\"ok\":false,\"why\":\"no dsh-link process\"}'; exit 0 }",
  "$main = $proc.MainWindowHandle",
  "$origin = New-Object POINT",
  "$origin.X = 0; $origin.Y = 0",
  "[void][HW]::ClientToScreen($main, [ref]$origin)",
  "$rows = New-Object System.Collections.ArrayList",
  "$cb = [HW+EnumProc]{ param($h, $p)",
  "  $sb = New-Object System.Text.StringBuilder 256",
  "  [void][HW]::GetClassName($h, $sb, 256)",
  "  $r = New-Object RECT",
  "  [void][HW]::GetWindowRect($h, [ref]$r)",
  "  [void]$rows.Add([pscustomobject]@{ cls = $sb.ToString(); x = ($r.Left - $origin.X); y = ($r.Top - $origin.Y); w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top) })",
  "  return $true",
  "}",
  "[void][HW]::EnumChildWindows($main, $cb, [IntPtr]::Zero)",
  "$webviews = @($rows | Where-Object { $_.cls -eq 'WRY_WEBVIEW' })",
  "$parts = $Point -split ','",
  "$pp = New-Object POINT",
  "$pp.X = [int][math]::Round($origin.X + [double]$parts[0]); $pp.Y = [int][math]::Round($origin.Y + [double]$parts[1])",
  "$hit = [HW]::WindowFromPoint($pp)",
  "$cls = ''; $hx = -1; $hy = -1; $hw = -1; $hh = -1",
  "if ($hit -ne [IntPtr]::Zero) {",
  "  $sb = New-Object System.Text.StringBuilder 256",
  "  [void][HW]::GetClassName($hit, $sb, 256)",
  "  $cls = $sb.ToString()",
  "  $r = New-Object RECT",
  "  [void][HW]::GetWindowRect($hit, [ref]$r)",
  "  $hx = $r.Left - $origin.X; $hy = $r.Top - $origin.Y; $hw = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top",
  "}",
  "$out = [ordered]@{ ok = $true; point = $Point; panelArg = $Panel; clientOrigin = @{ x = $origin.X; y = $origin.Y }; hit = @{ cls = $cls; clientBox = @{ x = $hx; y = $hy; w = $hw; h = $hh } }; webviews = @($webviews | ForEach-Object { @{ x = $_.x; y = $_.y; w = $_.w; h = $_.h } }) }",
  "$out | ConvertTo-Json -Compress -Depth 8",
]
const HANDLE_WITNESS_SCRIPT = HANDLE_WITNESS_LINES.join('\n')
/**
 * Which window owns the handle centre, according to the OS rather than to the page. Bounded on purpose: the
 * reading 6 VERDICT is geometric, and this only says what the hit test returned. Run with no app, no pwsh, or a
 * client the DPI API refuses and it reports that in words instead of reddening a product reading.
 */
const handleWitness = async (pointPhysical, panelPhysical) => {
  const [{ spawnSync }, { writeFileSync }, { tmpdir }, { join }] = await Promise.all([import('node:child_process'), import('node:fs'), import('node:os'), import('node:path')])
  const path = join(tmpdir(), 'dsh-link-handle-witness-' + String(process.pid) + '.ps1')
  try { writeFileSync(path, HANDLE_WITNESS_SCRIPT) } catch (error) { return { ok: false, why: 'could not write the witness script: ' + error.message } }
  const box = panelPhysical === null ? '0,0,0,0' : [panelPhysical.x, panelPhysical.y, panelPhysical.w, panelPhysical.h].map((value) => String(Math.round(value))).join(',')
  const run = spawnSync('pwsh', ['-NoProfile', '-File', path, '-Point', String(Math.round(pointPhysical.x)) + ',' + String(Math.round(pointPhysical.y)), '-Panel', box], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  if (run.status !== 0) return { ok: false, why: 'the witness exited ' + String(run.status) + ': ' + String(run.stderr || '').slice(0, 200) }
  try { return JSON.parse(String(run.stdout).trim()) } catch (error) { return { ok: false, why: 'the witness did not print JSON: ' + String(run.stdout).slice(0, 200) } }
}

const main = async () => {
  if (SELF_ATTACK) return selfAttack()
  let world
  try { world = await collect() }
  catch (error) {
    console.log('  FAIL  collect(): the probe itself failed before collecting (a GATE bug, not a data verdict)')
    console.log('        ' + (error && error.stack ? error.stack : String(error)))
    return 1
  }
  if (world === null) { console.log('SKIP: no CDP on 127.0.0.1:' + String(CDP_PORT) + ', so the app is not running with remote debugging; this gate measured NOTHING'); return 3 }
  if (world.noRail === true) { console.log('SKIP: this client has no right rail ([data-rightbar-col] is absent, i.e. no session is open), so nothing about the pane surface can be measured; the gate touched no layout'); return 3 }
  if (world.collectError !== undefined) {
    for (const reading of judge({ ...world, dpr: world.dpr === null ? 1 : world.dpr }, expectations())) console.log('  FAIL  ' + reading.id + '. ' + reading.detail)
    console.log('      collectError: ' + String(world.collectError).split('\n').slice(0, 4).join(' / '))
    return 1
  }
  /* Reading 6's OS evidence, taken with the panel up and the browser pane still active (the collect() snapshot
   * readings 1/2/6 judge). It is attached, never judged: see classifyWitness. */
  if (world.handle !== null && world.handle !== undefined) {
    const factor = world.dpr === null || world.dpr === undefined ? 1 : world.dpr
    const centre = { x: world.handle.x + world.handle.w / 2, y: world.handle.y + world.handle.h / 2 }
    const panelLogical = asLogical(world.panel !== null && world.panel !== undefined && world.panel.exists === true ? world.panel.bounds : null, factor)
    world.panelPhysical = panelLogical === null ? null : { x: panelLogical.x * factor, y: panelLogical.y * factor, w: panelLogical.w * factor, h: panelLogical.h * factor }
    world.handleWitness = await handleWitness({ x: centre.x * factor, y: centre.y * factor }, world.panelPhysical)
  }
  const readings = judge(world, expectations())
  console.log('  live page ' + world.url0 + ' | rail=' + show(world.rail) + ' | surface=' + show(world.surface) + ' | dpr=' + show(world.dpr) + ' | tabs=' + String(world.tabs === null ? 0 : world.tabs.length))
  for (const line of world.progress) console.log('        ' + line)
  for (const reading of readings) {
    console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const unmeasured = readings.filter((reading) => /NOT MEASURED/.test(reading.detail))
  const failed = readings.filter((reading) => reading.ok === false)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed')
  if (unmeasured.length > 0) { console.log('SKIP: ' + String(unmeasured.length) + ' of ' + String(readings.length) + ' readings could not be measured here (' + unmeasured.map((reading) => reading.id).join(', ') + ') - ' + String(world.switchSkipReason || 'see above')); return 3 }
  return failed.length === 0 ? 0 : 1
}

process.exitCode = await main()
