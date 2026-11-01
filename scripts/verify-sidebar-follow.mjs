#!/usr/bin/env node
/**
 * Gate 96 (R144) - does the native panel FOLLOW the real right column, pixel for pixel?
 *
 * Subject: the injected page host (src-tauri/src/core/panel_host.js, served at /__shell/panel.js) plus
 * POST /__shell/panel. The gate drives the REAL gestures - the official open-right-sidebar button and the
 * divider handle - through CDP, because the claim under test is exactly that a pixel-level layout change
 * (which Tauri's proportional auto_resize can never follow) reaches the native child webview.
 *
 * Readings:
 *   1-collapsed  a collapsed column (width < 48) holds NO panel: exists=false and no panel browser process
 *   2-follow     the panel's reported rect equals the [data-dsh-link-surface="true"] ANCHOR's box times the
 *                MEASURED scale (window.devicePixelRatio), compared in logical units. R178 made the panel fill
 *                the PANE's own rectangle, so the rail ([data-rightbar-col]) is the pre-R178 quantity: judged
 *                against it this gate reported worstDelta=62 on a placement that was exact on the anchor
 *                (measured rail 791,36 637x852 vs anchor 804,86 612x790 - R181-C section 3 C-2)
 *   3-drag       after a real divider drag of DELTA px the panel follows to the NEW anchor box, same scale -
 *                and the anchor itself must have come with the column, which is what keeps the original claim
 *                ("the panel follows the REAL right column") intact now that the anchor is what is placed
 *   4-restore    the gate puts the column back the way it found it, and says which way that was
 *   5-mainpool   the main window's own webview2 processes never move during any of it (paired counts)
 *   6-host-heals-a-moved-panel  a panel pushed off the anchor is brought back onto the anchor by the host alone
 *
 * PREMISE, named instead of assumed: this gate needs the ACTIVE world - a right rail whose selected pane
 * declares [data-dsh-link-surface="true"] AND a page host that is alive. Without the anchor the host's tick
 * returns before it can open anything (src-tauri/src/core/panel_host.js:133), so there is no placement to
 * follow: the gate names the missing premise, touches no layout and exits 3.
 *   .tmp/r181-owner/prepare-world.ps1 -Gate sidebar-follow
 *
 * Applicability is part of the judge, not a comment: a reading that cannot apply in the world in hand says
 * so in its own detail, and a gate that TRIED to reach a state and failed is red - never silently green.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when CDP is not answering (this gate
 * measured NOTHING; the app is simply not running with remote debugging) or when the world has no anchor.
 *
 * Usage: node scripts/verify-sidebar-follow.mjs [--cdp-port 9222] [--delta 80] [--deadline-ms 15000]
 *        [--self-attack] [--expect-rect-shift N] [--force-scale N] [--expect-collapsed-open on|off]
 *
 * --self-attack never touches the app: it judges two labelled SYNTHETIC worlds with one expectation mutated
 * at a time. That proves the judge can fail; it does not exercise the probe.
 */
import { execFileSync } from 'node:child_process'
import { connect, COLUMN_PROBE } from './cdp-drive.mjs'

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const CDP_PORT = Number(option('--cdp-port', '9222'))
const DELTA = Number(option('--delta', '80'))
const DEADLINE_MS = Number(option('--deadline-ms', '15000'))
const SELF_ATTACK = has('--self-attack')
// A drag that really moved the column: the floor is a visible pixel change, not a fraction of the drag length (R167)
const MOVED_FLOOR = 8
const MIN_COLUMN = 48
const TOLERANCE = 2
const OPEN_LABEL = '\u6253\u5f00\u53f3\u4fa7\u8fb9\u680f'
const CLOSE_LABEL = '\u6536\u8d77\u53f3\u4fa7\u8fb9\u680f'

const round1 = (value) => Math.round(value * 10) / 10
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// One process snapshot: tasklist counts the image; command lines are fetched only when a reading has to
// say WHICH user data folder a process belongs to (the split gate 95 uses, for the same reason).
const countWebviews = () => {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq msedgewebview2.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 20000 })
    return String(out).split(/\r?\n/).filter((line) => /msedgewebview2\.exe/i.test(line)).length
  } catch (error) { return null }
}
const commandLines = () => {
  const script = "Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"
  try {
    const out = execFileSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
    return String(out).split(/\r?\n/).filter((line) => line.includes('|')).map((line) => { const at = line.indexOf('|'); return { pid: Number(line.slice(0, at)), cmdline: line.slice(at + 1) } })
  } catch (error) { return null }
}
const panelProcs = (lines) => lines === null ? null : lines.filter((row) => /sidebar-panels/i.test(String(row.cmdline))).length
const mainPoolProcs = (lines) => lines === null ? null : lines.filter((row) => /dev\.dshlink\.client[\\/]EBWebView/i.test(String(row.cmdline))).length

const panelCall = async (port, payload) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null)
  if (answer === null) return { status: 0, body: null }
  const text = await answer.text().catch(() => '')
  let body = null
  try { body = JSON.parse(text) } catch (error) { body = null }
  return { status: answer.status, body, text }
}

// The anchor: the rectangle the page host actually places the panel on since R178, read through this gate's own
// probe rather than through cdp-drive.mjs's COLUMN_PROBE - that probe is shared with other gates and answers the
// COLUMN. This gate reads both quantities and says which one it is judging.
const anchorProbe = () => {
  const surface = document.querySelector('[data-dsh-link-surface="true"]')
  const box = (el) => { if (el === null) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
  return JSON.stringify({
    count: document.querySelectorAll('[data-dsh-link-surface]').length,
    anchor: box(surface),
    display: surface === null ? null : getComputedStyle(surface).display,
  })
}
const ANCHOR_PROBE = '(' + anchorProbe.toString() + ')()'
const readAnchor = async (cdp) => {
  const seen = await cdp.json(ANCHOR_PROBE)
  if (seen.ok !== true) return null
  return { count: seen.value.count, anchor: seen.value.anchor, display: seen.value.display }
}

// --------------------------------------------------------------------------------------------- judge
const judge = (world, expect) => {
  const readings = []
  const record = (id, ok, detail, evidence) => readings.push({ id, ok: ok === true, detail: String(detail), evidence: evidence || [] })
  const spot = world.column
  const scale = world.scale
  const expanded = spot !== null && spot.w >= MIN_COLUMN
  // Reading 1 judges the world as the gate FOUND it: the column and panel snapshots taken before the
  // official button was ever clicked. Judging the post-expansion column against "was collapsed" is how
  // the first live run of this gate reddened itself for no reason.
  const initial = world.initial === undefined ? { column: spot, panel: world.panel, panelProcs: world.panelProcs } : world.initial
  const bounds = world.panel !== null && world.panel !== undefined && world.panel.exists === true ? world.panel.bounds : null
  const asLogical = (box, factor) => box === null || box === undefined ? null : (box.units === 'logical' ? { x: box.x, y: box.y, w: box.w, h: box.h } : { x: box.x / factor, y: box.y / factor, w: box.w / factor, h: box.h / factor })
  const worstDelta = (left, right) => (left === null || right === null) ? null : Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y), Math.abs(left.w - right.w), Math.abs(left.h - right.h))

  if (world.wasCollapsed !== true && world.collapsedProbe !== undefined && world.collapsedProbe !== null) {
    // measured by the gate itself: it collapsed the column, read the panel and the panel process count, then expanded
    const problems = []
    const probe = world.collapsedProbe
    if (probe.column === null) problems.push('after asking the page to collapse, no right column was reported at all')
    else if (probe.column.w >= MIN_COLUMN) problems.push('the gate asked the page to collapse and the column is still ' + String(probe.column.w) + 'px wide, so nothing was collapsed')
    if (probe.panel === null || probe.panel === undefined) problems.push('the shell did not answer op=state while the column was collapsed')
    else if (expect.collapsedOpen === true) {
      if (probe.panel.exists !== true) problems.push('this run expected a panel while the column is collapsed, and the shell reports none')
    } else if (probe.panel.exists === true) problems.push('a collapsed column still has a panel: exists=true')
    if (probe.panelProcs !== null && probe.panelProcs > 0) problems.push('panel browser processes exist while the column is collapsed: ' + String(probe.panelProcs))
    record('1-collapsed', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'the gate collapsed the column itself and a collapsed column holds no panel and no panel process', ['columnWhenCollapsed=' + show(probe.column), 'panelExistsWhenCollapsed=' + show(probe.panel === null || probe.panel === undefined ? null : probe.panel.exists), 'panelProcsWhenCollapsed=' + show(probe.panelProcs), 'controlUsed=' + JSON.stringify(CLOSE_LABEL)])
  } else if (world.wasCollapsed !== true) {
    record('1-collapsed', true, 'NOT MEASURED: ' + String(world.collapseSkipReason || 'the right column was already open when the gate started and the gate could not collapse it, so there was no collapsed state to judge - this line is not a pass'), ['wasCollapsed=' + show(world.wasCollapsed), 'column=' + show(spot)])
  } else {
    const problems = []
    if (world.probeOk !== true) problems.push('the page probe did not answer: ' + show(world.probeWhy))
    if (initial.column === null) problems.push('no right column was found in the page ([data-rightbar-col])')
    else if (initial.column.w >= MIN_COLUMN) problems.push('this world was recorded as collapsed, but the column read ' + String(initial.column.w) + 'px wide when the gate started')
    if (initial.panel === null || initial.panel === undefined) problems.push('the shell did not answer op=state before the gate touched anything')
    else {
      const holds = initial.panel.exists === true
      // Stated positively, so BOTH directions can be wrong: a panel where none was expected, and none
      // where one was. That is what lets a mutant redden this reading.
      if (expect.collapsedOpen === true) {
        if (holds !== true) problems.push('this run expected a panel while the column is collapsed, and the shell reports none')
      } else {
        if (holds === true) problems.push('a collapsed column still has a panel: exists=true')
        if (initial.panelProcs !== null && initial.panelProcs > 0) problems.push('panel browser processes exist while the column is collapsed: ' + String(initial.panelProcs))
      }
    }
    record('1-collapsed', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'a collapsed column holds no panel and no panel process', ['columnWhenFound=' + show(initial.column), 'panelWhenFound=' + show(initial.panel), 'panelProcsWhenFound=' + show(initial.panelProcs), 'expect.collapsedOpen=' + show(expect.collapsedOpen)])
  }

  if (world.narrow !== null && world.narrow !== undefined) {
    record('2-follow', false, 'the client window is only ' + String(world.narrow) + 'px wide, so no panel could be placed: NOTHING about following was measured (resize the window and run again)', ['innerWidth=' + show(world.narrow), 'column=' + show(spot)])
  } else if (expanded === false && world.expandAttempted !== true) {
    record('2-follow', true, 'not applicable: the column is collapsed in this world, so there is no panel to follow', ['column=' + show(spot), 'expandAttempted=' + show(world.expandAttempted)])
  } else if (world.anchor === null || world.anchor === undefined) {
    // R181-D (C-2): a world with no anchor has no rectangle for the host to place the panel on
    // (panel_host.js:133), so there is nothing here that could follow anything. Named, never a silent green.
    record('2-follow', true, 'NOT MEASURED: this world declares no [data-dsh-link-surface] anchor, so the rectangle the page host places the panel on does not exist and following cannot be judged here (see PREMISE in the header)', ['anchor=' + show(world.anchor), 'column=' + show(spot), 'bounds=' + show(bounds)])
  } else {
    const anchor = world.anchor
    const problems = []
    if (expanded === false) problems.push('the gate tried to expand the column and could not (width ' + String(spot === null ? '?' : spot.w) + '), so NOTHING about following was measured')
    if (world.panel === null || world.panel === undefined) problems.push('the shell did not answer op=state after the open')
    else if (world.panel.exists !== true) problems.push('the panel never appeared although the column is ' + String(spot === null ? '?' : spot.w) + 'px wide')
    if (bounds === null) problems.push('no bounds were reported')
    if (spot === null || scale === null) problems.push('no column or no scale to compare against')
    const wanted = anchor === null ? null : { x: anchor.x + expect.rectShift, y: anchor.y, w: anchor.w, h: anchor.h }
    const seen = asLogical(bounds, scale)
    const worst = worstDelta(seen, wanted)
    if (worst !== null && worst > TOLERANCE) problems.push('the panel is not on the anchor: worstDelta=' + String(round1(worst)) + ' tolerance=' + String(TOLERANCE))
    if (world.converged === false) problems.push('the panel rect and the anchor rect never agreed within ' + String(DEADLINE_MS / 1000) + 's')
    record('2-follow', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'the panel converged onto the anchor the page declares, after ' + String(world.convergedAfter ?? '?') + 's', ['anchor=' + show(anchor), 'column=' + show(spot), 'bounds=' + show(bounds), 'scale=' + show(scale), 'asLogical=' + show(seen), 'wanted=' + show(wanted), 'worstDelta=' + show(worst), 'converged=' + show(world.converged) + ' after ' + String(world.convergedAfter ?? '?') + 's'])
  }

  if (world.afterDrag === null || world.afterDrag === undefined) {
    record('3-drag', world.expandAttempted !== true, world.expandAttempted === true ? 'FAIL: the gate tried to expand and drag, and no post-drag reading was taken at all' : 'not applicable: no panel exists in this world, so there was nothing to drag along', ['column=' + show(spot)])
  } else if (world.afterDrag.anchor === undefined || world.afterDrag.anchor === null) {
    // R181-D (C-2): the same premise as reading 2, re-stated at the instant this reading judged - the anchor can
    // go away if the pane collapses while the divider is being dragged.
    record('3-drag', true, 'NOT MEASURED: the world declares no [data-dsh-link-surface] anchor after the drag, so there is no rectangle the panel could have followed (see PREMISE in the header)', ['anchorBefore=' + show(world.anchorBeforeDrag === undefined ? null : world.anchorBeforeDrag), 'anchorAfter=' + show(null), 'columnAfter=' + show(world.afterDrag.column)])
  } else {
    const problems = []
    const moved = world.afterDrag.column
    const anchorBeforeDrag = world.anchorBeforeDrag === undefined ? world.anchor : world.anchorBeforeDrag
    const anchorAfter = world.afterDrag.anchor
    const draggedLogical = asLogical(world.afterDrag.bounds, world.afterDrag.scale)
    if (moved === null) problems.push('the column vanished after the drag')
    // R167: the threshold has to be about "a real drag moved it", not an arbitrary quarter of the drag length. The
    // layout CLAMPS the column at its maximum width (measured: a widen attempt moved it 19px and stopped at 736),
    // and calling a clamped-but-real 19px move "did not really move" is a false red. What the reading claims is that a
    // real drag takes the panel with it - which the pair below still has to show - so the floor is a real pixel change.
    else if (spot !== null && Math.abs(moved.w - spot.w) < MOVED_FLOOR) problems.push('the column did not really move: before=' + String(spot.w) + ' after=' + String(moved.w) + ' (floor ' + String(MOVED_FLOOR) + 'px)')
    const anchorMoved = worstDelta(anchorBeforeDrag, anchorAfter)
    if (anchorMoved !== null && anchorMoved < MOVED_FLOOR) problems.push('the drag moved the column (' + String(spot === null ? '?' : spot.w) + ' -> ' + String(moved === null ? '?' : moved.w) + ') but the anchor did not come with it: ' + show(anchorBeforeDrag) + ' -> ' + show(anchorAfter) + ' (floor ' + String(MOVED_FLOOR) + 'px), so "the panel follows the real column" cannot be judged through it')
    if (draggedLogical === null) problems.push('the panel reported no bounds after the drag')
    else {
      const worst = worstDelta(draggedLogical, anchorAfter)
      if (worst === null || worst > TOLERANCE) problems.push('the panel did not follow the drag: panel=' + show(draggedLogical) + ' anchor=' + show(anchorAfter) + ' worstDelta=' + show(worst))
    }
    record('3-drag', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'a real divider drag of ' + String(DELTA) + 'px moved the column and the anchor with it, and the panel with them', ['columnBefore=' + show(spot), 'columnAfter=' + show(moved), 'anchorBefore=' + show(anchorBeforeDrag), 'anchorAfter=' + show(anchorAfter), 'panelAfter=' + show(world.afterDrag.bounds), 'handle=' + show(world.afterDrag.handle), 'target=' + show(world.afterDrag.target)])
  }

  {
    const problems = []
    if (world.restored === null || world.restored === undefined) problems.push('the gate could not say whether it restored the column')
    else if (world.finalColumn === null) problems.push('the final column reading is missing')
    else if (world.restored === 'collapsed' && world.finalColumn.w >= MIN_COLUMN) problems.push('the gate claimed to leave the column collapsed and width=' + String(world.finalColumn.w))
    else if (world.restored === 'expanded' && world.finalColumn.w < MIN_COLUMN) problems.push('the gate claimed to leave the column open and width=' + String(world.finalColumn.w))
    record('4-restore', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'the column was left in the same STATE it was found in: ' + String(world.restored) + ' (state only - a drag run leaves the column WIDTH changed, which this reading does not claim to undo)', ['restored=' + show(world.restored), 'finalColumn=' + show(world.finalColumn)])
  }

  {
    const problems = []
    if (world.mainPool.before === null || world.mainPool.after === null) problems.push('the main window pool was not counted on both sides')
    else if (world.mainPool.before !== world.mainPool.after) problems.push('the main window pool moved: before=' + String(world.mainPool.before) + ' after=' + String(world.mainPool.after))
    record('5-mainpool', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'the MAIN window WebView2 pool never moved (the panel has its own pool, which does grow when a panel opens)', ['mainPool before=' + String(world.mainPool.before) + ' after=' + String(world.mainPool.after) + ' (paired)', 'allWebviews before=' + String(world.allWebviews.before) + ' after=' + String(world.allWebviews.after)])
  }

  {
    if (world.movedAway === undefined) {
      record('6-host-heals-a-moved-panel', true, 'not applicable: this world did not displace the panel, so there was nothing to heal (the synthetic worlds used by --self-attack pass through here)', ['movedAway=undefined'])
    } else if (world.movedAway === null) {
      record('6-host-heals-a-moved-panel', false, 'FAIL: the panel could not be moved off the anchor (the shell did not report an existing panel after the displacement), so this reading measured nothing', ['movedAway=null'])
    } else if (world.anchorHeal === null || world.anchorHeal === undefined) {
      record('6-host-heals-a-moved-panel', true, 'NOT MEASURED: the anchor [data-dsh-link-surface] was gone while the heal was being watched, so the rectangle the host was supposed to bring the panel back to is unknown here', ['movedAway=' + JSON.stringify(world.movedAway), 'anchorHeal=null'])
    } else if (world.healed === true) {
      // R181-D (C-2): "brought it back" means back ONTO the anchor - the rectangle R178 made the host's target.
      // The pre-R178 rule compared the healed panel against the rail and read 62px of "never came back" that
      // was really "came back to the anchor" (measured here: anchor 804,86 612x790, rail 791,36 637x852).
      record('6-host-heals-a-moved-panel', true, 'after the panel was moved off the anchor, the page host brought it back onto the anchor on its own in ' + String(world.healedAfter) + 's', ['movedAway=' + JSON.stringify(world.movedAway), 'anchorHeal=' + show(world.anchorHeal), 'healedAfter=' + String(world.healedAfter), 'tolerance=' + String(TOLERANCE)])
    } else {
      record('6-host-heals-a-moved-panel', false, 'FAIL: the panel was moved to ' + JSON.stringify(world.movedAway) + ' and the page host never brought it back onto the anchor ' + show(world.anchorHeal) + ' within 14s - this is exactly the pre-R172 hole (the host trusts its own memory of where it placed the panel instead of re-reading the shell)', ['movedAway=' + JSON.stringify(world.movedAway), 'anchorHeal=' + show(world.anchorHeal)])
    }
  }

  return readings
}

const expectations = (over = {}) => ({
  rectShift: over.rectShift === undefined ? Number(option('--expect-rect-shift', '0')) : over.rectShift,
  forceScale: over.forceScale === undefined ? option('--force-scale', null) : over.forceScale,
  collapsedOpen: over.collapsedOpen === undefined ? option('--expect-collapsed-open', 'off') === 'on' : over.collapsedOpen,
})

// ------------------------------------------------------------------------------------------- probe
const collect = async () => {
  const cdp = await connect({ port: CDP_PORT, deadlineMs: DEADLINE_MS })
  if (cdp === null) return null
  const port = new URL(cdp.page).port
  const world = { url0: cdp.page, probeOk: false, probeWhy: null, column: null, scale: null, panel: null, panelProcs: null, afterDrag: null, restored: null, finalColumn: null, wasCollapsed: null, expandAttempted: false, mainPool: { before: null, after: null }, allWebviews: { before: null, after: null } }
  const linesBefore = commandLines()
  world.allWebviews.before = countWebviews()
  world.mainPool.before = mainPoolProcs(linesBefore)
  const first = await cdp.json(COLUMN_PROBE)
  if (first.ok !== true) { world.probeWhy = first.why;   cdp.close(); return world }
  world.probeOk = true
  world.column = first.value.column
  // R166: a page with NO right-column element is a different world, not a broken product. The client restarted onto its
  // home screen has no session open and therefore no right column, and this gate then reported five product reds for a
  // world it should not have judged - the "world failure read as a defect" trap. Name it, touch no layout, and skip.
  if (world.column === null) { world.noColumn = true; cdp.close(); return world }
  // R181-D (C-2): the premise of this gate AFTER R178. The host places the panel on the pane's OWN surface
  // ([data-dsh-link-surface="true"]), so a world without that anchor has no placement to follow at all: the
  // host's tick reads panel_host.rect() and returns before it can open anything (panel_host.js:133). Name the
  // missing premise, touch no layout, and exit 3 - the same treatment the no-column world above gets. A world
  // this gate cannot judge must not be reported as a product failure.
  // R279: THE PREMISE IS A DOOR THIS GATE CAN OPEN. The anchor exists exactly while the browser pane is the pane in
  // front (measured: rail on our LINK panel -> 0 anchors, rail on the browser chip -> 1 anchor at 808,86 614x790), so
  // a world that skipped here was usually a world that simply had another tab in front. Clicking that chip is part of
  // finding the world, and it is recorded; a world with no browser chip at all still skips by name.
  const brought = await cdp.evaluate('(' + (function () {
    const rail = document.querySelector('[data-rightbar-col]')
    const tabs = document.querySelectorAll('[role="tab"]')
    for (let index = 0; index < tabs.length; index += 1) {
      const el = tabs[index]
      if (rail !== null && rail.contains(el) === false) continue
      const label = String(el.textContent === null || el.textContent === undefined ? '' : el.textContent)
      if (!/Browser|browser|\u6d4f\u89c8\u5668/.test(label)) continue
      if (el.getAttribute('aria-selected') === 'true') return 'already'
      el.click()
      return 'clicked'
    }
    return 'no-browser-chip'
  }).toString() + ')()')
  world.browserPaneFront = brought.ok === true ? brought.value : null
  // Remember which pane this gate found in front, so the rail can be handed back the way it was.
  world.entryRailLabel = null
  {
    const before = await cdp.evaluate('(' + (function () {
      const rail = document.querySelector('[data-rightbar-col]')
      const tabs = document.querySelectorAll('[role="tab"]')
      for (let index = 0; index < tabs.length; index += 1) {
        const el = tabs[index]
        if (rail !== null && rail.contains(el) === false) continue
        if (el.getAttribute('aria-selected') === 'true') return String(el.textContent === null || el.textContent === undefined ? '' : el.textContent).trim()
      }
      return null
    }).toString() + ')()')
    world.entryRailLabel = before.ok === true ? before.value : null
  }
  if (world.browserPaneFront === 'clicked') await new Promise((done) => setTimeout(done, 1500))
  const anchorFirst = await readAnchor(cdp)
  world.anchorRead = anchorFirst
  world.anchor = anchorFirst === null ? null : anchorFirst.anchor
  if (anchorFirst === null || anchorFirst.anchor === null || anchorFirst.anchor.w <= 0 || anchorFirst.anchor.h <= 0) {
    world.noAnchor = true
    cdp.close()
    return world
  }
  world.scale = option('--force-scale', null) === null ? first.value.scale : Number(option('--force-scale'))
  world.panel = (await panelCall(port, { op: 'state' })).body
  world.panelProcs = panelProcs(commandLines())
  world.initial = { column: world.column, anchor: world.anchor, panel: world.panel, panelProcs: world.panelProcs }
  // A window too narrow to hold the column is a state the gate cannot judge following in. Say so and stop
  // touching the layout: measured once (R144) after automated clicks left the client window 158px wide,
  // which made every geometric reading meaningless while looking like a product failure.
  world.narrow = typeof first.value.innerWidth === 'number' && first.value.innerWidth < 600 ? first.value.innerWidth : null
  const wasCollapsed = world.column === null || world.column.w < MIN_COLUMN
  world.wasCollapsed = wasCollapsed
  world.expandAttempted = wasCollapsed && world.narrow === null

  // R162: reading 1 used to be a HOLLOW PASS. When the column started expanded the gate printed `ok` for
  // "a collapsed column holds no panel" while testing nothing - a third party (critic, task-190) attacked this gate
  // and named it. The page offers its own right-column control, so now the gate COLLAPSES the column itself,
  // measures the collapsed state (panel + panel processes), and expands it again before the following readings.
  // If the control is missing it says NOT MEASURED rather than ok.
  if (world.column !== null && world.column.w >= MIN_COLUMN && world.narrow === null) {
    const before = await cdp.json(COLUMN_PROBE)
    const control = before.ok === true ? (before.value.buttons || []).find((entry) => entry.label === CLOSE_LABEL) : undefined
    if (control === undefined) {
      world.collapseSkipReason = 'the page offers no "' + CLOSE_LABEL + '" control, so the gate could not create the collapsed state'
    } else {
      await cdp.click({ x: control.x, y: control.y })
      const collapseUntil = Date.now() + DEADLINE_MS
      while (Date.now() < collapseUntil) {
        await sleep(700)
        const seen = await cdp.json(COLUMN_PROBE)
        if (seen.ok === true && seen.value.column !== null && seen.value.column.w < MIN_COLUMN) break
      }
      const collapsed = await cdp.json(COLUMN_PROBE)
      const panel = (await panelCall(port, { op: 'state' })).body
      world.collapsedProbe = { column: collapsed.ok === true ? collapsed.value.column : null, panel, panelProcs: panelProcs(commandLines()) }
      // put the column back the way this run found it (expanded) before anything measures following
      const again = await cdp.json(COLUMN_PROBE)
      const reopen = again.ok === true ? (again.value.buttons || []).find((entry) => entry.label === OPEN_LABEL) : undefined
      if (reopen === undefined) world.collapseSkipReason = 'the column was collapsed and the "' + OPEN_LABEL + '" control was gone, so it could not be expanded again'
      else {
        await cdp.click({ x: reopen.x, y: reopen.y })
        const backUntil = Date.now() + DEADLINE_MS
        while (Date.now() < backUntil) {
          await sleep(700)
          const back = await cdp.json(COLUMN_PROBE)
          if (back.ok === true && back.value.column !== null && back.value.column.w >= MIN_COLUMN) break
        }
      }
    }
  }

  if (wasCollapsed && world.narrow === null) {
    const button = (first.value.buttons || []).find((entry) => entry.label === OPEN_LABEL)
    if (button === undefined) { world.probeWhy = 'the open-right-sidebar button was not found';   cdp.close(); return world }
    await cdp.click({ x: button.x, y: button.y })
    const until = Date.now() + DEADLINE_MS
    while (Date.now() < until) {
      await sleep(700)
      const seen = await cdp.json(COLUMN_PROBE)
      if (seen.ok === true && seen.value.column !== null && seen.value.column.w >= MIN_COLUMN) break
    }
  }
  // open is asynchronous TWICE: the child webview is created on its own thread, and only then does the page
  // host measure and place it. Waiting only for exists=true reads the creation rectangle (0,0,420,600) and
  // calls a placement that has not happened yet a defect - the first live run of this gate did exactly that.
  const placeUntil = Date.now() + DEADLINE_MS
  let placed = (await panelCall(port, { op: 'state' })).body
  while (Date.now() < placeUntil) {
    const exists = placed !== null && placed.exists === true
    const sized = exists && placed.bounds !== null && placed.bounds !== undefined && placed.bounds.w > 0 && placed.bounds.h > 0
    if (sized) break
    await sleep(500)
    placed = (await panelCall(port, { op: 'state' })).body
  }
  // Two things are asynchronous here: the child webview is created on its own thread, and the page host then
  // measures and places it on a 400 ms tick - while the layout animates (the frame carries transition: all).
  // So this waits for the pair (panel rect, column rect) to CONVERGE, and records how long that took, instead
  // of judging whatever instant it happened to read first. The deadline is the same one the drag uses; a pair
  // that never converges stays a red reading.
  const convergeUntil = Date.now() + DEADLINE_MS
  let stable = null
  let converged = false
  let waited = 0
  while (Date.now() < convergeUntil) {
    const seen = await cdp.json(COLUMN_PROBE)
    const box = seen.ok === true ? seen.value.column : null
    const anchored = await readAnchor(cdp)
    const anchorBox = anchored === null ? null : anchored.anchor
    const answer = (await panelCall(port, { op: 'state' })).body
    if (seen.ok === true) { world.column = box; world.host = seen.value.hostState }
    if (anchorBox !== null) world.anchor = anchorBox
    world.panel = answer
    const bounds = answer !== null && answer.exists === true ? answer.bounds : null
    const factor = world.scale === null ? 1 : world.scale
    const logical = bounds === null ? null : (bounds.units === 'logical' ? bounds : { x: bounds.x / factor, y: bounds.y / factor, w: bounds.w / factor, h: bounds.h / factor })
    // R181-D (C-2): the pair that has to settle is (panel rect, ANCHOR rect) - R178 made the anchor, not the
    // rail, the rectangle the page host places the panel on. The column is still read and printed: the anchor
    // is measured off it, so a column that moves is how the anchor moves.
    const close = anchorBox !== null && logical !== null && Math.max(Math.abs(logical.x - anchorBox.x), Math.abs(logical.y - anchorBox.y), Math.abs(logical.w - anchorBox.w), Math.abs(logical.h - anchorBox.h)) <= TOLERANCE
    const settled = stable !== null && anchorBox !== null && stable.x === anchorBox.x && stable.w === anchorBox.w
    stable = anchorBox
    if (close && settled) { converged = true; waited = Math.round((DEADLINE_MS - (convergeUntil - Date.now()))); break }
    await sleep(400)
  }
  world.converged = converged
  world.convergedAfter = Math.round((DEADLINE_MS - (convergeUntil - Date.now())) / 100) / 10
  // The panel is a native child window drawn OVER the client, and the divider this gate drags sits on the
  // column's left edge - exactly where the panel begins. Measured in R146: inside the suite this gate failed
  // because the live gate before it left a panel in place and the drag never reached the divider. Closing it
  // first establishes what the drag needs; a panel that refuses to close still shows up in the readings.
  // The panel must be PRESENT for this gate: reading 3 asks where the panel ended up after the drag, so a
  // run that closes it first has nothing to measure. An earlier version closed it here - to keep the panel's
  // window out of the divider's way - and that starved reading 3 with `panelAfter=null` (measured in R147:
  // the column moved 736->656 while the panel was gone). Two things follow from that: this gate only ever
  // WAITS for a panel, and it drags a couple of pixels OUTSIDE the panel's left edge, since the panel is a
  // native window drawn over the client and its left edge is exactly where the divider sits.
  {
    const until = Date.now() + DEADLINE_MS
    let seen = (await panelCall(port, { op: 'state' })).body
    while (Date.now() < until && (seen === null || seen.exists !== true)) {
      await sleep(700)
      seen = (await panelCall(port, { op: 'state' })).body
    }
  }
  let now = await cdp.json(COLUMN_PROBE)
  if (now.ok === true) { world.column = now.value.column; world.host = now.value.hostState }
  // Where the anchor sits the moment before the drag: reading 3 has to know it MOVED, not only where it ended.
  const anchorNow = await readAnchor(cdp)
  if (anchorNow !== null && anchorNow.anchor !== null) world.anchor = anchorNow.anchor
  world.anchorBeforeDrag = world.anchor

  const dragOnce = async (handle, direction) => {
    const target = { x: handle.x + direction * DELTA, y: handle.y }
    await cdp.drag({ from: { x: handle.x, y: handle.y }, to: target, steps: 6 })
    // R162b: the frame carries `transition: all`, so the column is still animating while the page host (400 ms tick)
    // moves the panel. One post-drag read can catch the column BEFORE it moved and the panel AFTER - which reddens
    // "the panel did not follow the drag" with the panel exactly where the column is about to be. Measured in the
    // suite: panel=772 column=692, worstDelta=80 = exactly the drag. So settle the PAIR, like the pre-drag loop does.
    const until = Date.now() + DEADLINE_MS
    let last = null
    let previous = null
    while (Date.now() < until) {
      const probe = await cdp.json(COLUMN_PROBE)
      const anchored = await readAnchor(cdp)
      const panel = (await panelCall(port, { op: 'state' })).body
      const box = probe.ok === true ? probe.value.column : null
      const anchorBox = anchored === null ? null : anchored.anchor
      const factor = probe.ok === true && probe.value.scale !== null && probe.value.scale !== undefined ? probe.value.scale : (world.scale === null ? 1 : world.scale)
      const bounds = panel !== null && panel !== undefined && panel.exists === true ? panel.bounds : null
      const logical = bounds === null ? null : (bounds.units === 'logical' ? bounds : { x: bounds.x / factor, y: bounds.y / factor, w: bounds.w / factor, h: bounds.h / factor })
      // R181-D (C-2): the pair that has to settle is (panel rect, ANCHOR rect); the column box is printed with it.
      const agree = anchorBox !== null && logical !== null && Math.max(Math.abs(logical.x - anchorBox.x), Math.abs(logical.y - anchorBox.y), Math.abs(logical.w - anchorBox.w), Math.abs(logical.h - anchorBox.h)) <= TOLERANCE
      const stable = previous !== null && anchorBox !== null && previous.x === anchorBox.x && previous.w === anchorBox.w
      previous = anchorBox
      last = { column: box, anchor: anchorBox, scale: probe.ok === true ? probe.value.scale : null, bounds: bounds, handle: handle, target: target, direction: direction }
      if (agree && stable) { last.settledAfter = Math.round((DEADLINE_MS - (until - Date.now())) / 100) / 10; return last }
      await sleep(400)
    }
    return last === null ? { column: null, anchor: null, scale: null, bounds: null, handle: handle, target: target, direction: direction } : last
  }
  const handle = now.ok === true ? now.value.handle : null
  if (handle !== null && world.column !== null) {
    // The right column has a width the LAYOUT enforces, so one direction can be a dead end (measured: at
    // 736px wide the divider refused to widen further). The reading is "the panel follows a real divider
    // drag", not "the divider must grow", so whichever direction the layout permits is tried first and the
    // other is tried once if it moved nothing - and the attempt that was actually used is printed.
    // R167: prefer the direction that HAS room. The layout clamps the column at a maximum width (measured: 736), so
    // widening from near that maximum moves almost nothing while narrowing always has room - and the previous rule
    // chose widening whenever there was space to the left, which is exactly the clamped case.
    const first = world.column.w - DELTA >= MIN_COLUMN ? 1 : -1
    world.afterDrag = await dragOnce(handle, first)
    const movedBy = world.afterDrag.column === null ? null : Math.abs(world.afterDrag.column.w - world.column.w)
    if (movedBy !== null && movedBy < 4) {
      const second = await cdp.json(COLUMN_PROBE)
      const retry = second.ok === true ? second.value.handle : null
      if (retry !== null && world.afterDrag.column !== null) {
        world.firstDrag = world.afterDrag
        world.afterDrag = await dragOnce(retry, -first)
        world.afterDrag.retriedAfter = world.firstDrag
      }
    }
  }

  if (wasCollapsed) {
    const probe = await cdp.json(COLUMN_PROBE)
    const button = (probe.ok === true ? (probe.value.buttons || []) : []).find((entry) => entry.label === CLOSE_LABEL)
    if (button !== undefined) {
      await cdp.click({ x: button.x, y: button.y })
      const until = Date.now() + DEADLINE_MS
      while (Date.now() < until) { await sleep(700); const seen = await cdp.json(COLUMN_PROBE); if (seen.ok === true && seen.value.column !== null && seen.value.column.w < MIN_COLUMN) break }
    }
    world.restored = 'collapsed'
  } else {
    world.restored = 'expanded'
  }
  // R172: the old reading said it left the column "in the same STATE" and admitted it did not restore the WIDTH - and
  // that admission was leaving the drift behind for the NEXT run. Measured: each run widened the column by DELTA
  // (397 -> 477 -> 557), and the following run then started with its panel 80 px off the column (worstDelta=80.3) and
  // could not drag at all, because the offset panel covered the divider. So the gate now drags the divider back by
  // exactly what it moved: a gate must leave the world it found, or the next run is measuring its predecessor.
  if (world.afterDrag !== null && world.afterDrag !== undefined && world.column !== null && world.afterDrag.column !== null) {
    const movedBy = Math.round(world.afterDrag.column.w - world.column.w)
    if (Math.abs(movedBy) >= 4) {
      const back = await cdp.json(COLUMN_PROBE)
      const handle = back.ok === true ? back.value.handle : null
      if (handle !== null) {
        await cdp.drag({ from: { x: handle.x, y: handle.y }, to: { x: handle.x + movedBy, y: handle.y }, steps: 6 })
        await sleep(1500)
        world.restoredWidth = true
      }
    }
  }
  const final = await cdp.json(COLUMN_PROBE)
  world.finalColumn = final.ok === true ? final.value.column : null
  // R172: the host's MEMORY is not the shell's reality. Move the panel off the column behind the host's back and require
  // the host to bring it back on its own slow beat (12 ticks x 400 ms). This reading reddens on the pre-R172 code: the
  // fast path returns early while the host still believes it placed the panel, and the reconcile beat only checked
  // whether a panel EXISTS, never whether it was where the host thought.
  if (world.column !== null && world.narrow === null && world.scale !== null) {
    const factor = world.scale
    const asLogical = (box) => box === null || box === undefined ? null : (box.units === 'logical' ? { x: box.x, y: box.y, w: box.w, h: box.h } : { x: box.x / factor, y: box.y / factor, w: box.w / factor, h: box.h / factor })
    await panelCall(port, { op: 'set-bounds', x: 0, y: 0, w: 420, h: 600 })
    await sleep(900)
    const moved = (await panelCall(port, { op: 'state' })).body
    world.movedAway = moved !== null && moved.exists === true ? asLogical(moved.bounds) : null
    const until = Date.now() + 14000
    while (Date.now() < until) {
      const seen = await cdp.json(COLUMN_PROBE)
      const box = seen.ok === true ? seen.value.column : null
      const anchored = await readAnchor(cdp)
      const anchorBox = anchored === null ? null : anchored.anchor
      const answer = (await panelCall(port, { op: 'state' })).body
      const logical = answer !== null && answer.exists === true ? asLogical(answer.bounds) : null
      // R181-D (C-2): the heal target is the ANCHOR, not the rail. The pre-R178 rule waited for the panel to
      // agree with [data-rightbar-col] - 62px away from where the host really places it - and so reported
      // "the host never brought it back" for a host that had brought it back exactly where it belongs.
      const delta = anchorBox === null || logical === null ? null : Math.max(Math.abs(logical.x - anchorBox.x), Math.abs(logical.y - anchorBox.y), Math.abs(logical.w - anchorBox.w), Math.abs(logical.h - anchorBox.h))
      if (anchorBox !== null) { world.anchor = anchorBox; world.anchorHeal = anchorBox }
      if (delta !== null && delta <= TOLERANCE) { world.healed = true; world.healedAfter = Math.round((14000 - (until - Date.now())) / 100) / 10; world.column = box; break }
      await sleep(500)
    }
  }
  // R279: hand the rail back. This gate clicks the browser chip to make the anchor exist, and a gate that leaves
  // the rail on a pane it did not find it on has moved the world for the NEXT live gate - measured in the suite:
  // with the browser pane left in front, the action-render gate declined to measure ("the browser pane is already
  // open"). Put the pane that was selected at entry back, by label, and record it.
  if (world.entryRailLabel !== null && world.entryRailLabel !== undefined) {
    const railNow = await cdp.evaluate('(' + (function (wanted) {
      const rail = document.querySelector('[data-rightbar-col]')
      const tabs = document.querySelectorAll('[role="tab"]')
      for (let index = 0; index < tabs.length; index += 1) {
        const el = tabs[index]
        if (rail !== null && rail.contains(el) === false) continue
        const label = String(el.textContent === null || el.textContent === undefined ? '' : el.textContent).trim()
        if (label !== wanted) continue
        if (el.getAttribute('aria-selected') === 'true') return 'already'
        el.click()
        return 'clicked'
      }
      return 'not-found'
    }).toString() + ')(' + JSON.stringify(world.entryRailLabel) + ')')
    world.railRestored = railNow.ok === true ? railNow.value : null
    if (world.railRestored === 'clicked') await new Promise((done) => setTimeout(done, 1200))
  }
  cdp.close()
  world.allWebviews.after = countWebviews()
  world.mainPool.after = mainPoolProcs(commandLines())
  return world
}

// -------------------------------------------------------------------------------------- self-attack
const expandedWorld = (expect) => {
  const column = { x: 791, y: 36, w: 637, h: 852 }
  // R181-D (C-2): the two rectangles as measured live in R181-C - the rail, and the PANE's own surface inside
  // it that R178 made the placement target. The synthetics carry both, so the judge is exercised on the same
  // pair the live run reads; a placement that fills the rail is a labelled mutant below.
  const anchor = { x: 804, y: 86, w: 612, h: 790 }
  const scale = expect.forceScale === null || expect.forceScale === undefined ? 1.5 : Number(expect.forceScale)
  const box = (spot) => ({ units: 'physical', x: spot.x * scale, y: spot.y * scale, w: spot.w * scale, h: spot.h * scale })
  const moved = { x: column.x - 80, y: column.y, w: column.w + 80, h: column.h }
  const movedAnchor = { x: anchor.x - 80, y: anchor.y, w: anchor.w + 80, h: anchor.h }
  return {
    kind: 'synthetic', url0: 'synthetic://expanded',
    probeOk: true, probeWhy: null, wasCollapsed: false, expandAttempted: false, narrow: null,
    column: column, anchor: anchor, anchorBeforeDrag: anchor, scale: scale, host: null,
    initial: { column: { x: column.x - 80, y: column.y, w: column.w - 80, h: column.h }, anchor: anchor, panel: { exists: false, bounds: null }, panelProcs: 0 },
    panel: { exists: true, bounds: box(anchor) }, panelProcs: 6,
    afterDrag: { column: moved, anchor: movedAnchor, scale: scale, bounds: box(movedAnchor), handle: { x: 787, y: 400, w: 8 }, target: { x: 707, y: 400 } },
    restored: 'expanded', finalColumn: moved,
    mainPool: { before: 6, after: 6 }, allWebviews: { before: 6, after: 12 },
  }
}

/**
 * R181-D (C-2), the regression this change is about: a placement that fills the OLD rail box instead of the
 * pane's anchor is exactly on the column and 13/50/25/62px off the anchor. It must redden reading 2 and
 * nothing else - that is what makes "the comparison was wrong" a claim with a reading behind it.
 */
const railFilled = (world) => {
  const seat = (spot) => ({ units: 'physical', x: spot.x * 1.5, y: spot.y * 1.5, w: spot.w * 1.5, h: spot.h * 1.5 })
  return { ...world, panel: { ...world.panel, bounds: seat(world.column) } }
}

const collapsedSynthetic = (expect) => ({
  kind: 'synthetic', url0: 'synthetic://collapsed',
  probeOk: true, probeWhy: null, wasCollapsed: true, expandAttempted: false, narrow: null,
  column: { x: 1428, y: 36, w: 0, h: 852 }, anchor: null, anchorBeforeDrag: null, scale: 1.5, host: null,
  initial: { column: { x: 1428, y: 36, w: 0, h: 852 }, panel: { exists: false, bounds: null }, panelProcs: 0 },
  panel: { exists: false, bounds: null }, panelProcs: 0,
  afterDrag: null, restored: 'collapsed', finalColumn: { x: 1428, y: 36, w: 0, h: 852 },
  mainPool: { before: 6, after: 6 }, allWebviews: { before: 6, after: 6 },
})

const doubleScaled = (world) => ({
  ...world,
  panel: { ...world.panel, bounds: { units: 'physical', x: world.panel.bounds.x * 1.5, y: world.panel.bounds.y * 1.5, w: world.panel.bounds.w * 1.5, h: world.panel.bounds.h * 1.5 } },
})

const movedMainPool = (world) => ({ ...world, mainPool: { before: 6, after: 7 } })

const selfAttack = () => {
  const honest = expectations()
  let failures = 0
  const baseline = [...judge(expandedWorld(honest), honest), ...judge(collapsedSynthetic(honest), honest)]
  const baselineRed = baseline.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  ' + (baselineRed.length === 0 ? 'ok  ' : 'FAIL') + '  baseline. both labelled SYNTHETIC worlds judged with honest expectations are green: ' + baseline.map((reading) => reading.id + '=' + (reading.ok ? 'ok' : 'FAIL')).join(' '))
  if (baselineRed.length > 0) failures += 1
  console.log('          (SYNTHETIC, not the app: this exercises the judge, never the probe.)')
  const mutants = [
    { name: 'expected rect shifted by 50px', expect: expectations({ rectShift: 50 }), world: expandedWorld(expectations({ rectShift: 50 })), mustRedden: ['2-follow'] },
    // The scale is read from the world, not from a flag, so the mutant has to be a PLACEMENT that ignores
    // it: a shell that put the child webview at the physical numbers without dividing by the display scale
    // would leave the panel 1.5x too big. That is the defect reading 2 exists to catch.
    { name: 'a placement that forgot to divide by the display scale', expect: honest, world: doubleScaled(expandedWorld(honest)), mustRedden: ['2-follow'] },
    { name: 'a placement that filled the old rail box instead of the pane anchor', expect: honest, world: railFilled(expandedWorld(honest)), mustRedden: ['2-follow'] },
    { name: 'a main window pool that moved while the panel was placed', expect: honest, world: movedMainPool(expandedWorld(honest)), mustRedden: ['5-mainpool'] },
    { name: 'a collapsed world that is expected to hold a panel', expect: expectations({ collapsedOpen: true }), world: collapsedSynthetic(expectations({ collapsedOpen: true })), mustRedden: ['1-collapsed'] },
  ]
  for (const mutant of mutants) {
    const seen = judge(mutant.world, mutant.expect).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const precise = seen.length === mutant.mustRedden.length && mutant.mustRedden.every((id) => seen.includes(id))
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + show(seen) + ' expected=' + show(mutant.mustRedden))
  }
  console.log('  note the live probe was NOT exercised in this mode: --self-attack attacks the judge only.')
  return failures === 0 ? 0 : 1
}

const main = async () => {
  if (SELF_ATTACK) return selfAttack()
  let world
  try { world = await collect() }
  catch (error) {
    console.log('  FAIL  collect(): the judge itself failed before judging anything (a GATE bug, not a data verdict)')
    console.log('        ' + (error && error.stack ? error.stack : String(error)))
    return 1
  }
  if (world === null) {
    console.log('SKIP: no CDP on 127.0.0.1:' + String(CDP_PORT) + ', so the app is not running with remote debugging; this gate measured NOTHING')
    return 3
  }
  if (world.noColumn === true) {
    console.log('SKIP: this client is showing a screen without the right column ([data-rightbar-col] is absent, i.e. no session is open), so nothing about following can be measured; the gate touched no layout')
    return 3
  }
  if (world.noAnchor === true) {
    console.log('SKIP: this world declares no [data-dsh-link-surface="true"] anchor (measured ' + show(world.anchorRead) + '), i.e. the right rail is not on the pane the page host places the panel on, so the host is inert (panel_host.js:133) and nothing about following can be measured; the gate touched no layout. Prepare this world with .tmp/r181-owner/prepare-world.ps1 -Gate sidebar-follow')
    return 3
  }
  const readings = judge(world, expectations())
  console.log('  live page ' + world.url0 + ' | column=' + show(world.column) + ' | scale=' + show(world.scale) + ' | restored=' + show(world.restored) + ' | expandAttempted=' + show(world.expandAttempted))
  for (const reading of readings) {
    console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const unmeasured = readings.filter((reading) => /NOT MEASURED/.test(reading.detail))
  if (unmeasured.length > 0) {
    // R166 (task-192): the third party that rechecked the collapse repair pointed at exactly this - the NOT MEASURED
    // line was still recorded as ok and the gate still exited 0, so a world where the collapsed state cannot be created
    // stayed green in the suite. A gate must not report a green for a claim it did not measure, so it names the reason
    // and skips; the readings it DID take are printed above and stay readable.
    console.log('SKIP: ' + String(unmeasured.length) + ' of ' + String(readings.length) + ' readings could not be measured here (' + unmeasured.map((reading) => reading.id).join(', ') + ') - ' + String(world.collapseSkipReason || 'see above'))
    return 3
  }
  const failed = readings.filter((reading) => reading.ok === false)
  console.log(failed.length === 0 ? '  ' + String(readings.length) + ' readings, all held' : '  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed')
  return failed.length === 0 ? 0 : 1
}

process.exitCode = await main()