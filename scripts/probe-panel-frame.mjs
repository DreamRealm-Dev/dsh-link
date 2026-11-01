// The panel rectangle, described three ways at once, so its units stop being a guess.
//
// R73 alive-control: EXEMPT, with the reason - this probe never boots a kernel or a profile: it talks to an
// already-running shell over HTTP, refuses (exit 3) when nothing answers, and claims the panel lease before it
// reads, so the composition it reads is the caller's and its absence is reported instead of absorbed. The DPI
// awareness it forces on its own process (R159) is the same class of instrument honesty.
//
// R158/R159 read three sources that claim to know where the panel is:
//   native - the panel webview's own child window, in client coordinates (device pixels, no bookkeeping)
//   shell  - POST /__shell/panel op=state, which reports the surface, the bay AND the screen separately
//   page   - the panel document's innerWidth/innerHeight x devicePixelRatio (what the renderer was laid out for)
//
// R182-G: WHAT the native rectangle is has changed, and this probe was still asking the pre-R179 question.
// Since R179-A the browser is a VM-style preview window (src-tauri/src/core/sidebar_panel.rs:40-51): the
// declared SURFACE is a bay, the shell paints a letterbox in it (browser_ui.html, --dsh-screen-void #050608),
// and the ACTIVE TAB'S WINDOW IS PLACED ON screenPane - the viewport's aspect ratio centred in the bay
// (Surface::screen, sidebar_panel.rs:279-293, reported as screenPane by the same report). In fixed mode the
// page is not laid out for its window at all: it is TOLD it is viewport (1280x800 by default) through
// Emulation.setDeviceMetricsOverride and scaled down by exactly the factor the screen rect was cut with
// (apply_mode, sidebar_panel.rs:1410-1424). So the three descriptions of "where the panel is" are:
//
//   native child window (device px, client coords)
//   shell screenPane x the page's devicePixelRatio   <- the rectangle the window really occupies
//   shell tabs[<active>].bounds (units "physical")   <- the same rectangle, already in device px
//   shell surface (units "logical")                  <- the BAY the page paints, NOT the window
//
// The old reading compared the window against the surface and the renderer against the window; both are
// stale (measured R182-G: native 900,406 630x394 = screenPane 600.016,270.76 419.968x262.48 x 1.5, while the
// surface was 600,90 420x600 and the page reported 1280x800 device px). What is still a defect, and what
// this probe now fails on, is: the window NOT being on the declared screen, the shell's two descriptions of
// that screen disagreeing, the screen not being inside the bay, the renderer not being laid out for the
// declared page viewport, or the lease not being enforced. The pre-R179 shape (the window stretched over the
// surface) is printed as its own verdict so it can be told apart from a missing reading.
//
// It opens its own panel under a lease (R153), so the page host stands down and the rectangle is stable.
//
// Usage: node scripts/probe-panel-frame.mjs [--port 31761] [--json]
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimLease, releaseLease, panelPost, openOwnPanel } from './panel-lease.mjs'

const args = process.argv.slice(2)
const argOf = (name, fallback) => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? args[at + 1] : fallback }
const PORT = Number(argOf('--port', '31761'))
const RECT = { x: 600, y: 90, w: 420, h: 600 }
const HOLDER = 'probe-panel-frame'
const TOLERANCE = 3

const NATIVE = `param()
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class W {
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public delegate bool EnumProc(IntPtr h, IntPtr p);
}
'@
# R159: a DPI-unaware reader is handed VIRTUALIZED coordinates (a 2560x1440 @150% desktop reads as 1707x960),
# which is exactly the trap that made an earlier round think the panel was placed at the wrong scale.
[void][W]::SetProcessDpiAwarenessContext([IntPtr](-4))
if ([W]::GetSystemMetrics(0) -lt 2000) { [void][W]::SetProcessDPIAware() }
$proc = Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { '{"error":"no client process"}'; exit 0 }
$main = $proc.MainWindowHandle
$win = New-Object RECT
[void][W]::GetWindowRect($main, [ref]$win)
$rows = New-Object System.Collections.ArrayList
$cb = [W+EnumProc]{ param($h, $p)
  $sb = New-Object System.Text.StringBuilder 256
  [void][W]::GetClassName($h, $sb, 256)
  $r = New-Object RECT
  [void][W]::GetWindowRect($h, [ref]$r)
  [void]$rows.Add([pscustomobject]@{ cls = $sb.ToString(); left = $r.Left; top = $r.Top; w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top) })
  return $true
}
[void][W]::EnumChildWindows($main, $cb, [IntPtr]::Zero)
# R218: this process owns more than one top-level window, and MainWindowHandle can point at a small
# hidden frame (measured 22x22 right after a restart). When that frame has no child of class
# WRY_WEBVIEW the old probe reported "no panel child window" while the panel was plainly on screen.
# The probe now falls back to scanning the process TOP-LEVEL windows for the one that has webview
# children, and says which window it used.
$webviews = @($rows | Where-Object { $_.cls -eq 'WRY_WEBVIEW' })
$windowSource = 'MainWindowHandle'
if ($webviews.Count -eq 0) {
  $candidates = New-Object System.Collections.ArrayList
  $topCb = [W+EnumProc]{ param($h2, $p2)
    $owner = [uint32]0
    [void][W]::GetWindowThreadProcessId($h2, [ref]$owner)
    if ($owner -eq [uint32]$proc.Id) { [void]$candidates.Add($h2) }
    return $true
  }
  [void][W]::EnumWindows($topCb, [IntPtr]::Zero)
  foreach ($candidate in $candidates) {
    $rows2 = New-Object System.Collections.ArrayList
    $cb2 = [W+EnumProc]{ param($h3, $p3)
      $sb3 = New-Object System.Text.StringBuilder 256
      [void][W]::GetClassName($h3, $sb3, 256)
      $r3 = New-Object RECT
      [void][W]::GetWindowRect($h3, [ref]$r3)
      [void]$rows2.Add([pscustomobject]@{ cls = $sb3.ToString(); left = $r3.Left; top = $r3.Top; w = ($r3.Right - $r3.Left); h = ($r3.Bottom - $r3.Top) })
      return $true
    }
    [void][W]::EnumChildWindows($candidate, $cb2, [IntPtr]::Zero)
    $found = @($rows2 | Where-Object { $_.cls -eq 'WRY_WEBVIEW' })
    if ($found.Count -gt 0) {
      $main = $candidate
      [void][W]::GetWindowRect($main, [ref]$win)
      $rows = $rows2
      $webviews = $found
      $windowSource = 'top-level scan'
      break
    }
  }
}
# (the webview rows are computed by the fallback block above)
$panel = $webviews | Where-Object { [math]::Abs($_.left - $win.Left) -gt 3 } | Select-Object -First 1
$mainRow = $webviews | Where-Object { [math]::Abs($_.left - $win.Left) -le 3 } | Select-Object -First 1
$out = [ordered]@{
  windowScreen = @{ left = $win.Left; top = $win.Top; w = ($win.Right - $win.Left); h = ($win.Bottom - $win.Top) }
  windowSource = $windowSource
  webviewCount = $webviews.Count
  mainClient = if ($mainRow) { @{ x = ($mainRow.left - $win.Left); y = ($mainRow.top - $win.Top); w = $mainRow.w; h = $mainRow.h } } else { $null }
  panelClient = if ($panel) { @{ x = ($panel.left - $win.Left); y = ($panel.top - $win.Top); w = $panel.w; h = $panel.h } } else { $null }
}
$out | ConvertTo-Json -Compress -Depth 6`

const nativeRead = () => {
  const path = join(tmpdir(), 'dsh-link-panel-frame-' + process.pid + '.ps1')
  writeFileSync(path, NATIVE)
  const run = spawnSync('pwsh', ['-NoProfile', '-File', path], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (run.status !== 0) return { ok: false, why: 'the native probe exited ' + run.status + ': ' + String(run.stderr || '').slice(0, 200) }
  try { return { ok: true, value: JSON.parse(String(run.stdout).trim()) } } catch (error) { return { ok: false, why: 'the native probe did not print JSON: ' + String(run.stdout).slice(0, 200) } }
}

// the in-process CDP has its own route: POST /__shell/panel/cdp {method, params}
const cdpPost = async (method, params) => {
  const answer = await fetch('http://127.0.0.1:' + PORT + '/__shell/panel/cdp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) }).catch(() => null)
  if (answer === null) return null
  const text = await answer.text().catch(() => '')
  try { return JSON.parse(text) } catch (error) { return null }
}

const pageRead = async () => {
  const answer = await cdpPost('Runtime.evaluate', { expression: "JSON.stringify({iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio,sx:screenX,sy:screenY,url:location.href})", returnByValue: true })
  // the shell answers with the CDP reply as a JSON STRING inside its own envelope, so unwrap twice
  let outer = answer && answer.result
  if (typeof outer === 'string') { try { outer = JSON.parse(outer) } catch (error) { return { ok: false, why: 'the shell CDP envelope was not JSON: ' + outer.slice(0, 160) } } }
  const value = outer && outer.result && outer.result.value
  if (typeof value !== 'string') return { ok: false, why: 'the panel page did not answer Runtime.evaluate (' + JSON.stringify(answer).slice(0, 160) + ')' }
  try { return { ok: true, value: JSON.parse(value) } } catch (error) { return { ok: false, why: 'the panel page answered non-JSON' } }
}

const near = (a, b) => a !== null && b !== null && Math.abs(a - b) <= TOLERANCE
const box = (value) => value === null || value === undefined ? 'none' : value.x + ',' + value.y + ' ' + value.w + 'x' + value.h
const boundsOf = (report) => report && report.bounds ? { x: report.bounds.x, y: report.bounds.y, w: report.bounds.w, h: report.bounds.h } : null
const quadOf = (report, key) => report && report[key] && typeof report[key].w === 'number' ? { x: report[key].x, y: report[key].y, w: report[key].w, h: report[key].h, units: report[key].units } : null
/** The active tab's own window rectangle, as the shell reports it (units: physical). */
const activeTabBounds = (report) => {
  const rows = report && Array.isArray(report.tabs) ? report.tabs : []
  const row = rows.filter((tab) => tab.active === true)[0] || rows[0]
  return row && row.bounds && typeof row.bounds.w === 'number' ? { x: row.bounds.x, y: row.bounds.y, w: row.bounds.w, h: row.bounds.h, units: row.bounds.units, url: row.url } : null
}
const sameBox = (a, b) => a !== null && b !== null && a !== undefined && b !== undefined && near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h)
/** a scaled to device px (logical x the page's own devicePixelRatio) */
const toDevice = (quad, dpr) => quad === null || quad === undefined || dpr === null ? null : { x: quad.x * dpr, y: quad.y * dpr, w: quad.w * dpr, h: quad.h * dpr }
/** is the inner rectangle inside the outer one, within the tolerance? */
const insideBox = (inner, outer, slack) => inner !== null && outer !== null
  && inner.x >= outer.x - slack && inner.y >= outer.y - slack
  && inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack

const main = async () => {
  let openedPanel = false
  let leaseReleased = false
  const health = await panelPost(PORT, { op: 'report' }).catch(() => null)
  if (health === null) { console.log('SKIP: no shell on port ' + PORT + ' (start the client, or pass --port)'); return 3 }
  const held = await claimLease(PORT, HOLDER)
  if (!held) { console.log('SKIP: the panel lease is held by someone else, so a stable rectangle is not available'); return 3 }
  try {
    const opened = await openOwnPanel(PORT, RECT)
    if (opened === null || opened.exists !== true) { console.log('SKIP: the shell would not open a panel'); return 3 }
    openedPanel = true
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const after = await panelPost(PORT, { op: 'report' })
    const native = nativeRead()
    const page = await pageRead()
    // The lease promises exclusivity. Read the shell's belief once more, after the native read: if the page host is
    // still placing the panel while the lease is held, the two reports disagree and the window is not where the shell
    // says it is - a race this gate exists to catch, because gate 100 once saw exactly that (report x=1038, window 900).
    const after2 = await panelPost(PORT, { op: 'report' })
    if (native.ok !== true) { console.log('SKIP: ' + native.why); return 3 }
    if (page.ok !== true) { console.log('SKIP: ' + page.why); return 3 }
    const shellBounds = boundsOf(after)
    const shellUnderLease = boundsOf(after2)
    const screenPane = quadOf(after, 'screenPane')
    const bayPane = quadOf(after, 'bayPane')
    const tabBox = activeTabBounds(after)
    const mode = after && after.mode ? after.mode : null
    const viewport = after && after.viewport && typeof after.viewport.w === 'number' ? after.viewport : null
    // The display scale is MEASURED from the shell's own two descriptions of the one window it placed: the
    // logical rectangle it decided (screenPane) and the physical rectangle the webview really has (the active
    // tab's bounds). The panel PAGE's devicePixelRatio is NOT the display scale in fixed mode - the shell
    // forces it to 1 with the emulation (deviceScaleFactor:1), which is exactly the trap this reading names.
    const pageDpr = typeof page.value.dpr === 'number' && page.value.dpr > 0 ? page.value.dpr : null
    const displayScale = tabBox !== null && screenPane !== null && screenPane.w > 0 && screenPane.h > 0
      ? Math.round((tabBox.w / screenPane.w) * 10000) / 10000 : null
    const scaleAgrees = tabBox === null || screenPane === null || screenPane.h <= 0
      ? null : Math.abs(tabBox.h / screenPane.h - displayScale) <= 0.01
    const nativeRect = native.value.panelClient
    const pageDevice = { w: Math.round(page.value.iw * page.value.dpr), h: Math.round(page.value.ih * page.value.dpr) }
    const screenDevice = toDevice(screenPane, displayScale)
    const asked = RECT
    const rows = [
      ['native child window (client, device px)', box(nativeRect)],
      ['shell screenPane (logical) x display scale ' + String(displayScale) + ' (derived: tab bounds w / screenPane w)', box(screenDevice) + (screenPane === null ? ' (no screenPane in the report)' : '')],
      ['shell screenPane (logical, as reported)', box(screenPane)],
      ['shell active tab bounds (physical)', box(tabBox) + (tabBox === null ? '' : '  url=' + String(tabBox.url))],
      ['shell surface = the BAY, not the window (logical)', box(shellBounds)],
      ['shell bayPane (logical)', box(bayPane)],
      ['page viewport declared by the shell (fixed)', viewport === null ? 'none' : viewport.w + 'x' + viewport.h + '  mode=' + String(mode)],
      ['panel page innerWidth x dpr', pageDevice.w + 'x' + pageDevice.h + '  (css ' + page.value.iw + 'x' + page.value.ih + ' @' + page.value.dpr + ')'],
      ['asked for (logical, the surface declaration)', box(asked)],
      ['shell report again, after the native read', box(shellUnderLease)],
      ['main child window (client, device px)', box(native.value.mainClient)],
      ['window', box({ x: native.value.windowScreen.left, y: native.value.windowScreen.top, w: native.value.windowScreen.w, h: native.value.windowScreen.h })],
    ]
    for (const [label, value] of rows) console.log('  ' + label.padEnd(52) + ' ' + value)
    const childIsScreen = sameBox(nativeRect, screenDevice)
    const childIsTabBox = sameBox(nativeRect, tabBox)
    const childIsSurface = sameBox(nativeRect, asked)
    const pageIsViewport = viewport !== null && near(pageDevice.w, viewport.w) && near(pageDevice.h, viewport.h)
    const pageIsScreenDevice = sameBox({ x: 0, y: 0, w: pageDevice.w, h: pageDevice.h }, { x: 0, y: 0, w: screenDevice === null ? -1 : screenDevice.w, h: screenDevice === null ? -1 : screenDevice.h })
    const verdicts = [
      ['child == shell screenPane x dpr', childIsScreen, 'the tab window is on the letterboxed screen the shell declares'],
      ['child == shell active tab bounds (physical)', childIsTabBox, "the shell's two descriptions of the tab's own window agree"],
      ['child == the declared surface (the pre-R179 shape)', childIsSurface, 'the window is stretched over the bay instead of the screen'],
      ['page viewport == the declared page viewport', mode === 'fit' ? pageIsScreenDevice : pageIsViewport, mode === 'fit' ? 'in fit mode the page IS the content rect' : 'in fixed mode the renderer is told it is the page viewport, not its window'],
      ['page viewport inside the screen', screenDevice === null ? false : pageIsViewport && insideBox({ x: 0, y: 0, w: screenDevice.w, h: screenDevice.h }, screenDevice, TOLERANCE), 'the renderer is laid out for the rectangle the window really got (the same box in two spaces)'],
      ['the two shell descriptions use one display scale', scaleAgrees === true && displayScale !== null, 'screenPane x scale == the active tab bounds the webview really has, in both width and height'],
      ['screenPane inside bayPane', insideBox(screenPane, bayPane, TOLERANCE), 'the letterbox is a screen INSIDE the bay, so the bays black bars are the bay itself'],
    ]
    console.log('  ---')
    for (const [label, holds, meaning] of verdicts) console.log('  ' + (holds ? 'HOLDS ' : 'no    ') + ' ' + label.padEnd(44) + ' ' + meaning)
    if (process.argv.includes('--json')) console.log(JSON.stringify({ native: native.value, shell: shellBounds, screenPane, screenDevice, tabBox, bayPane, mode, viewport, page: page.value, asked, verdicts: verdicts.map((v) => ({ what: v[0], holds: v[1] })) }))
    console.log('  ---')
    const story = childIsScreen && childIsTabBox ? 'the tab window is exactly the letterboxed screen both the shell and the native read agree on; the page is a viewport the shell told it to be, not the window'
      : childIsSurface && !childIsScreen ? 'the window is on the declared SURFACE: that is the pre-R179 shape (a stretched page, no letterbox), so this build does not have the preview-window shape the report claims'
      : childIsScreen && !childIsTabBox ? 'the native window is on screenPane x dpr but the tab bounds the shell reports disagree with it: one of the two descriptions is stale'
      : 'the window is on neither the screen nor the surface the shell reports: read the raw numbers above before changing anything'
    console.log('  reading: ' + story)
    // A gate that cannot fail is not a gate: the verdicts above are ASSERTED here, not merely printed. This script
    // printed its three-way comparison for a whole round without ever returning non-zero, which made it decorative.
    const problems = []
    // R166: the lease must be ENFORCED, not merely published. R165 caught the panel being re-placed while a gate held
    // the lease (onto the live right column). This asks the shell to refuse a placement that does not name the holder,
    // and then checks that the window really did not move - both halves, or a refusal that still moved it is no use.
    const foreign = { x: RECT.x + 60, y: RECT.y + 30, w: RECT.w, h: RECT.h }
    const refusal = await panelPost(PORT, { op: 'set-bounds', ...foreign })
    const refusedByName = refusal !== null && typeof refusal.error === 'string' && refusal.error.includes('leased by')
    const afterRefusal = boundsOf(await panelPost(PORT, { op: 'report' }))
    const stayed = sameBox(afterRefusal, shellUnderLease === null ? shellBounds : shellUnderLease)
    console.log('  a placement that does not name the holder, WITH the lease held: ' + (refusedByName ? 'REFUSED by name' : 'ACCEPTED') + ' | rect after it: ' + box(afterRefusal) + (stayed ? ' (unchanged)' : ' (MOVED)'))
    if (!refusedByName) problems.push('a placement that did not name the lease holder was not refused by name (' + JSON.stringify(refusal === null ? null : refusal.error) + '), so the lease is still advisory')
    if (!stayed) problems.push('the panel moved on a placement that did not name the holder: ' + box(afterRefusal) + ' instead of ' + box(shellUnderLease === null ? shellBounds : shellUnderLease))
    // The other half of the same controlled pair (only the lease state differs): with the lease RELEASED the very same
    // nameless placement must be accepted, or "refused while leased" cannot be told apart from "set-bounds is broken".
    await releaseLease(PORT, HOLDER)
    leaseReleased = true
    const accepted = await panelPost(PORT, { op: 'set-bounds', ...foreign })
    const acceptedWhenFree = accepted !== null && accepted.error === undefined
    console.log('  the SAME placement with the lease released:    ' + (acceptedWhenFree ? 'ACCEPTED' : 'refused') + (acceptedWhenFree ? '' : ' (' + JSON.stringify(accepted === null ? null : accepted.error) + ')'))
    if (!acceptedWhenFree) problems.push('with no lease held, a nameless placement was still refused (' + JSON.stringify(accepted === null ? null : accepted.error) + '), so the refusal above proves nothing about the lease')
    // R169: WHICH document the panel opens on is part of "usable". Until R169 the page host opened it on '/__shell/' -
    // the client's own UI - so the sidebar browser showed the DSH shell inside itself (seen in R164's picture: the home
    // screen with its own left rail, drawn inside the panel rectangle). This reading pins the default page.
    const panelUrl = typeof page.value.url === 'string' ? page.value.url : ''
    console.log('  the panel opened on: ' + (panelUrl === '' ? '(it did not say)' : panelUrl))
    if (panelUrl === '') problems.push('the panel did not report which document it is on, so its default page could not be read')
    else if (/\/__shell\/$/.test(panelUrl)) problems.push('the panel opened on the CLIENT UI itself (' + panelUrl + '), so the sidebar browser is hosting the shell inside itself')
    else if (panelUrl.endsWith('/__shell/panel-start') === false) problems.push('the panel opened on ' + panelUrl + ', which is neither its start page nor the client UI: the default page is not pinned')
    if (nativeRect === null) problems.push('no panel child window was found, so nothing was measured')
    else if (screenPane === null || screenDevice === null) problems.push('the shell did not report screenPane, so the rectangle the window should be on cannot be read')
    else if (!childIsScreen) problems.push('the panel window is at ' + box(nativeRect) + ' while the shell says its screen is ' + box(screenDevice) + ' (screenPane ' + box(screenPane) + ' x dpr ' + String(dpr) + ')')
    else if (!childIsTabBox) problems.push('the panel window is at ' + box(nativeRect) + ' and the shell itself says the active tab is at ' + box(tabBox) + ': the two descriptions of the same window disagree')
    if (screenPane !== null && bayPane !== null && !insideBox(screenPane, bayPane, TOLERANCE)) problems.push('the screen is not inside the bay: screenPane ' + box(screenPane) + ' is not within bayPane ' + box(bayPane) + ', so the letterbox arithmetic is wrong')
    if (displayScale === null) problems.push('the display scale could not be measured (the shell reported screenPane ' + box(screenPane) + ' and the active tab ' + box(tabBox) + '), so logical and physical cannot be compared')
    else if (scaleAgrees !== true) problems.push('the shell reports the same window as ' + box(screenPane) + ' logical and ' + box(tabBox) + ' physical, which is not ONE scale: w ratio ' + String(displayScale) + ', h ratio ' + String(tabBox === null || screenPane === null ? null : Math.round((tabBox.h / screenPane.h) * 10000) / 10000))
    if (mode === null) problems.push('the report does not name a page-viewport mode, so what the renderer should be laid out for cannot be read')
    else if (mode === 'fixed' && !pageIsViewport) problems.push('fixed mode emulates the page viewport ' + (viewport === null ? '(none reported)' : viewport.w + 'x' + viewport.h) + ' but the panel page reports ' + pageDevice.w + 'x' + pageDevice.h + ' device px')
    else if (mode === 'fit' && !pageIsScreenDevice) problems.push('fit mode makes the page the content rect but the panel page reports ' + pageDevice.w + 'x' + pageDevice.h + ' device px while its window is ' + box(screenDevice))
    if (shellBounds === null || shellUnderLease === null) problems.push('the shell did not report a rect while the panel was open')
    else if (!sameBox(shellBounds, shellUnderLease)) problems.push('the reported rect moved while the lease was held: ' + box(shellBounds) + ' then ' + box(shellUnderLease))
    if (problems.length > 0) { for (const problem of problems) console.log('  FAIL  ' + problem); return 1 }
    console.log('  ok    the tab window is the letterboxed screen the shell declares, the renderer is laid out for the page viewport it was told, and the rect held still under the lease')
    return 0
  } finally {
    if (openedPanel) await panelPost(PORT, { op: 'close' })
    if (!leaseReleased) await releaseLease(PORT, HOLDER)
  }
}

process.exitCode = await main()
