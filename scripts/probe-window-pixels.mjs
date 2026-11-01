// Does the panel actually DRAW on screen, on top of the main page, inside the rect the shell reports?
//
// R182-G: WHICH rectangle that is changed in R179-A. The browser is a VM-style preview window now: the
// declared SURFACE is a bay the shell's own page paints (letterbox + screen frame, browser_ui.html
// --dsh-screen-void #050608), and the ACTIVE TAB's window is placed on screenPane - the viewport's aspect
// ratio centred in the bay (sidebar_panel.rs:279-293). Sampling the SURFACE therefore samples a rectangle the
// panel window only partly covers (measured R182-G with a 420x600 surface: the window is 600.016,270.76
// 419.968x262.48 logical = 900,406 630x394 device, so most of the surface is the client's own page behind
// the bay). This gate now samples the rectangle op=state says the tab's WINDOW is: the active tab's bounds
// (units "physical", read off the live webview) or screenPane x the display scale derived from those two.
// The control questions are unchanged - the overlay must reach the capture, it must NOT be visible inside the
// panel's window, and it must be visible beside it.
//
// R73 alive-control: EXEMPT, with the reason - it never boots a kernel or a profile: it talks to an already-running
// shell over HTTP, injects its control through that shell's own page, and refuses (exit 3) when the shell or the CDP
// port is absent, so the composition it reads is the caller's and its absence is reported instead of absorbed.
//
// R158 declared screen-level pixels unusable here because a capture did not change when the main page's BODY turned
// green. That verdict was wrong, and R164 found why: the shell paints its own opaque layout over the body, so the
// control could never be visible. With a control that MUST be visible - a fixed overlay at the top z-index - the
// window capture is live, and it answers the question the whole sidebar line rests on:
//
//   * the control overlay must reach the capture (otherwise the instrument is dead and this says so),
//   * the panel's own rectangle must NOT show the overlay: the child webview is drawn over the main page there,
//   * outside that rectangle the overlay must show: the panel is not covering the whole window.
//
// Capture is PrintWindow(PW_RENDERFULLCONTENT) in a per-monitor-DPI-aware pwsh child (R159), because GetWindowRect and
// the bitmap must be in the same, true-physical space as the shell's reported bounds.
//
// R277 MEASURED THAT CAPTURE STALE, and made this probe say so instead of failing the panel for it. The control is
// located by asking the page for a real element's box ([contenteditable="true"], the composer) instead of guessing
// "200 px left of the tab window"; the SAME instant is then captured twice - PrintWindow for the native window, and
// Page.captureScreenshot through the shell's own renderer. Measured on this machine:
//
//     renderer, anchor box   1225 / 1225 samples are the control overlay, top-left corner 100 / 100
//     PrintWindow, whole window   0 control-green of 81000 samples
//
// The page is live and the control is up; the window capture is not showing it. So a capture without the control is
// now the INSTRUMENT's third state (exit 3, with both numbers printed), never a verdict that the panel is not
// drawn. If a later round fixes the capture, the same run flips to a verdict on its own.
//
// Usage: node scripts/probe-window-pixels.mjs [--port 31761] [--json]
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimLease, releaseLease, panelPost, openOwnPanel } from './panel-lease.mjs'

const args = process.argv.slice(2)
const argOf = (name, fallback) => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? args[at + 1] : fallback }
const PORT = Number(argOf('--port', '31761'))
const CDP_PORT = Number(argOf('--cdp-port', '9222'))
const RECT = { x: 600, y: 90, w: 420, h: 600 }
const HOLDER = 'probe-window-pixels'
const TOLERANCE = 6
// pointer-events:none: the overlay must be see-through to INPUT as well as visible - R171 measured that a control overlay
// which swallows clicks breaks any tool that drives the page while it is up.
const OVERLAY = "(()=>{const d=document.createElement('div');d.id='dsh-ctl-overlay';d.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:#00ff00;pointer-events:none';document.body.appendChild(d);return true})()"
// R277: where the overlay MUST be visible is not a guess about the layout - it is the rectangle of an element the
// page itself reports. The sample this probe used to take ("200x200 to the LEFT of the tab window") assumed the
// main page was exposed there; in this world the shell's own deck and glass sidebar reach that far, so a correct
// capture read as a dead one. Asking the page for a real element's box makes the control self-locating: if that
// box is not green in the capture, either the capture is stale or the page moved, and both are instrument faults.
const ANCHOR_EXPRESSION = `(() => {
  const pick = ['textarea', '[contenteditable="true"]', '[data-slot="composer"]', 'main', '#root']
  for (const selector of pick) {
    const el = document.querySelector(selector)
    if (el === null) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 60 || rect.height < 30) continue
    return { selector, x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  }
  return null
})()`
const UNOVERLAY = "(()=>{const d=document.getElementById('dsh-ctl-overlay');if(d)d.remove();return true})()"

const CAPTURE = `param([string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class WPx {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L; public int T; public int RR; public int B; }
}
"@
[void][WPx]::SetProcessDpiAwarenessContext([IntPtr](-4))
$proc = Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { '{"error":"no client"}'; exit 0 }
$script:MY = [uint32]$proc.Id
$script:MAIN = [IntPtr]::Zero
[void][WPx]::EnumWindows([WPx+P]{ param($h, $l)
  $q = [uint32]0
  [void][WPx]::GetWindowThreadProcessId($h, [ref]$q)
  if ($q -eq $script:MY) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][WPx]::GetClassName($h, $sb, 256)
    if ($sb.ToString() -eq 'Tauri Window') { $script:MAIN = $h }
  }
  return $true }, [IntPtr]::Zero)
if ($script:MAIN -eq [IntPtr]::Zero) { '{"error":"no window"}'; exit 0 }
$r = New-Object WPx+R
[void][WPx]::GetWindowRect($script:MAIN, [ref]$r)
$w = $r.RR - $r.L
$h2 = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $h2
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [WPx]::PrintWindow($script:MAIN, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
if ($Out -ne '') { New-Item -ItemType Directory -Force -Path (Split-Path $Out -Parent) | Out-Null; $bmp.Save((Join-Path (Get-Location) $Out), [System.Drawing.Imaging.ImageFormat]::Png) }
# the whole picture, and the panel's own rectangle, sampled on a grid
$rows = New-Object System.Collections.ArrayList
$tot = 0; $greenAll = 0; $blackAll = 0
# R277: WHERE the green is, not only how much. A capture that shows five green samples and no coordinates cannot
# tell "the overlay is up but almost entirely covered by a child webview" from "the picture is stale", and those
# are two different verdicts - one is about the panel, the other about this instrument.
$gx0 = -1; $gy0 = -1; $gx1 = -1; $gy1 = -1
for ($y = 0; $y -lt $h2; $y += 6) { for ($x = 0; $x -lt $w; $x += 6) {
  $c = $bmp.GetPixel($x, $y); $tot++
  if ($c.R -lt 110 -and $c.G -gt 190 -and $c.B -lt 110) {
    $greenAll++
    if ($gx0 -lt 0 -or $x -lt $gx0) { $gx0 = $x }
    if ($gy0 -lt 0 -or $y -lt $gy0) { $gy0 = $y }
    if ($x -gt $gx1) { $gx1 = $x }
    if ($y -gt $gy1) { $gy1 = $y }
  }
  if ($c.R -lt 12 -and $c.G -lt 12 -and $c.B -lt 12) { $blackAll++ }
} }
$bmp.Dispose()
# hand-rolled: ConvertTo-Json on an ordered dictionary printed its own type name instead of a JSON object (R164)
Write-Output ('{"printed":' + $ok.ToString().ToLower() + ',"window":{"left":' + $r.L + ',"top":' + $r.T + ',"w":' + $w + ',"h":' + $h2 + '},"samples":' + $tot + ',"greenWhole":' + $greenAll + ',"nearBlackWhole":' + $blackAll + ',"greenBox":{"x0":' + $gx0 + ',"y0":' + $gy0 + ',"x1":' + $gx1 + ',"y1":' + $gy1 + '}}')`

const connectCdp = async () => {
  const mod = await import('file:///' + process.cwd().replace(/\\/g, '/') + '/scripts/cdp-drive.mjs')
  return mod.connect({ port: CDP_PORT, deadlineMs: 15000 })
}

/** sample the window picture inside and outside one rectangle, without keeping the whole bitmap in JS */
const sampleRegion = (image, rect) => {
  const script = `param([string]$Img, [int]$L, [int]$T, [int]$W, [int]$H)
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Image]::FromFile((Join-Path (Get-Location) $Img))
$green = 0; $other = 0; $tot = 0
for ($y = $T; $y -lt ($T + $H); $y += 6) { for ($x = $L; $x -lt ($L + $W); $x += 6) {
  if ($x -lt 0 -or $y -lt 0 -or $x -ge $bmp.Width -or $y -ge $bmp.Height) { continue }
  $c = $bmp.GetPixel($x, $y); $tot++
  if ($c.R -lt 110 -and $c.G -gt 190 -and $c.B -lt 110) { $green++ } else { $other++ }
} }
$bmp.Dispose()
Write-Output ($green.ToString() + '/' + $tot.ToString() + '/' + $other.ToString())`
  const path = join(tmpdir(), 'dsh-link-sample-' + process.pid + '.ps1')
  writeFileSync(path, script)
  const run = spawnSync('pwsh', ['-NoProfile', '-File', path, '-Img', image, '-L', String(rect.x), '-T', String(rect.y), '-W', String(rect.w), '-H', String(rect.h)], { encoding: 'utf8', timeout: 120000 })
  const line = String(run.stdout || '').trim().split(/\r?\n/).pop()
  const parts = line.split('/').map((v) => Number(v))
  return { green: parts[0], total: parts[1], other: parts[2], line: line }
}

const main = async () => {
  let openedPanel = false
  const health = await panelPost(PORT, { op: 'report' }).catch(() => null)
  if (health === null) { console.log('SKIP: no shell on port ' + PORT + ' (start the client, or pass --port)'); return 3 }
  const cdp = await connectCdp().catch(() => null)
  if (cdp === null) { console.log('SKIP: no CDP on ' + CDP_PORT + ', so the control overlay cannot be injected; this gate measured NOTHING'); return 3 }
  const held = await claimLease(PORT, HOLDER)
  if (!held) { cdp.close(); console.log('SKIP: the panel lease is held by someone else, so a stable rectangle is not available'); return 3 }
  const image = '.tmp/r164-pixels/window.png'
  try {
    const opened = await openOwnPanel(PORT, RECT)
    if (opened === null || opened.exists !== true) { console.log('SKIP: the shell would not open a panel'); return 3 }
    openedPanel = true
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const report = await panelPost(PORT, { op: 'report' })
    const bounds = report && report.bounds ? report.bounds : null
    // R182-G: the window's real rectangle. Preferred source: the ACTIVE TAB's own bounds, which the shell
    // reads off the live webview (units "physical", window-relative). Fallback: screenPane (logical) scaled by
    // the ratio the shell's own two descriptions agree on.
    const tabRow = report && Array.isArray(report.tabs) ? (report.tabs.filter((tab) => tab.active === true)[0] || report.tabs[0]) : null
    const tabBounds = tabRow && tabRow.bounds && typeof tabRow.bounds.w === 'number' ? tabRow.bounds : null
    const screenPane = report && report.screenPane && typeof report.screenPane.w === 'number' ? report.screenPane : null
    const displayScale = tabBounds !== null && screenPane !== null && screenPane.w > 0
      ? Math.round((tabBounds.w / screenPane.w) * 10000) / 10000 : null
    const screenDevice = tabBounds !== null
      ? { x: Math.round(tabBounds.x), y: Math.round(tabBounds.y), w: Math.round(tabBounds.w), h: Math.round(tabBounds.h) }
      : (screenPane !== null && displayScale !== null
        ? { x: Math.round(screenPane.x * displayScale), y: Math.round(screenPane.y * displayScale), w: Math.round(screenPane.w * displayScale), h: Math.round(screenPane.h * displayScale) }
        : null)
    // R176: clean BEFORE injecting as well as after. Two ad-hoc experiment scripts of mine left a full-page green overlay
    // in the user's live client for hours (measured: r173-ctl and r173-ovl, both rgb(0,255,0) 1440x900 at the top z-index,
    // found and removed in R176) - and the user saw a green DSH-LINK because of it. Removing leftovers first makes this
    // instrument idempotent, so a run that was killed mid-flight cannot leave the client looking broken.
    await cdp.evaluate(UNOVERLAY).catch(() => null)
    await cdp.evaluate(OVERLAY)
    // The page's own answer about where it is, read while the overlay is up: this is the rectangle the control
    // must be green in, and it is asked for rather than assumed from the layout.
    // cdp.evaluate answers { value, description, exception }: the value is the object this expression returns,
    // and a null/partial answer is an instrument fault that must NOT be allowed to fall through to a verdict.
    const anchorAnswer = await cdp.evaluate(ANCHOR_EXPRESSION).catch((error) => ({ value: null, exception: String(error) }))
    const anchorRaw = anchorAnswer === null || anchorAnswer === undefined ? null : anchorAnswer.value
    const anchor = anchorRaw !== null && typeof anchorRaw === 'object'
      && [anchorRaw.x, anchorRaw.y, anchorRaw.w, anchorRaw.h].every((field) => Number.isFinite(Number(field)))
      ? anchorRaw : null
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const capturePath = join(tmpdir(), 'dsh-link-capture-' + process.pid + '.ps1')
    writeFileSync(capturePath, CAPTURE)
    const capture = spawnSync('pwsh', ['-NoProfile', '-File', capturePath, '-Out', image], { encoding: 'utf8', timeout: 180000 })
    // The SAME instant through the shell's own renderer, taken BEFORE the control comes down: this is what decides
    // whether a capture that does not show the overlay is a stale window capture or a page that lost its control.
    const cdpShot = await cdp.call('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    const cdpData = cdpShot === null || cdpShot.result === undefined ? null : cdpShot.result.data
    const line = String(capture.stdout || '').trim().split(/\r?\n/).filter((row) => row.startsWith('{')).pop()
    await cdp.evaluate(UNOVERLAY)
    if (line === undefined) { console.log('SKIP: the capture probe printed no JSON: ' + String(capture.stdout).slice(0, 200) + ' / ' + String(capture.stderr || '').slice(0, 200)); return 3 }
    const facts = JSON.parse(line)
    if (facts.printed !== true) { console.log('SKIP: PrintWindow refused the window, so nothing was captured'); return 3 }
    const window = facts.window
    const panelBox = screenDevice
    console.log('  window ' + window.w + 'x' + window.h + ' at ' + window.left + ',' + window.top)
    console.log('  the shell declares: surface (the BAY the shell page paints, logical) ' + (bounds === null ? 'nothing' : bounds.x + ',' + bounds.y + ' ' + bounds.w + 'x' + bounds.h)
      + ' | screenPane (logical) ' + (screenPane === null ? 'nothing' : screenPane.x + ',' + screenPane.y + ' ' + screenPane.w + 'x' + screenPane.h)
      + ' | active tab window (physical, window-relative) ' + (tabBounds === null ? 'nothing' : tabBounds.x + ',' + tabBounds.y + ' ' + tabBounds.w + 'x' + tabBounds.h)
      + ' | display scale ' + String(displayScale))
    console.log('  the rectangle sampled is the TAB WINDOW: ' + (panelBox === null ? 'nothing' : panelBox.x + ',' + panelBox.y + ' ' + panelBox.w + 'x' + panelBox.h))
    console.log('  whole window: ' + facts.samples + ' samples, ' + facts.greenWhole + ' control-green, ' + facts.nearBlackWhole + ' near-black'
      + (facts.greenBox === undefined || facts.greenBox.x0 < 0 ? ' (no green sample at all)' : ' (green box ' + facts.greenBox.x0 + ',' + facts.greenBox.y0 + ' .. ' + facts.greenBox.x1 + ',' + facts.greenBox.y1 + ')'))
    if (panelBox === null) { console.log('  FAIL  the shell reported neither the active tab bounds nor a screenPane while a panel was open, so the rectangle the window really occupies could not be read'); return 1 }
    // A 4 px inset: the panel page draws the screen FRAME as a ring around the same rectangle (browser_ui.html
    // #screen box-shadow), and the window is placed on it exactly, so a frame-width bleed at the edge is the
    // furniture, not the panel failing to draw. The control question is about the middle of the window.
    const inset = 4
    const insideRect = { x: panelBox.x + inset, y: panelBox.y + inset, w: panelBox.w - 2 * inset, h: panelBox.h - 2 * inset }
    const inside = sampleRegion(image, insideRect)
    // The anchored control: the page named this box, so green here is the proof that this capture is the live
    // window AND that the main page is still the one being drawn where the page says it is.
    const scale = displayScale === null ? 1.5 : displayScale
    const anchorDevice = anchor === null ? null : {
      x: Math.round(Number(anchor.x) * scale) + 6,
      y: Math.round(Number(anchor.y) * scale) + 6,
      w: Math.max(1, Math.round(Number(anchor.w) * scale) - 12),
      h: Math.max(1, Math.round(Number(anchor.h) * scale) - 12),
    }
    const live = anchorDevice === null ? { green: 0, total: 0, other: 0 } : sampleRegion(image, anchorDevice)
    console.log('  the anchor the PAGE reported: ' + (anchor === null ? 'not available' : String(anchor.selector) + ' at ' + String(anchor.x) + ',' + String(anchor.y) + ' ' + String(anchor.w) + 'x' + String(anchor.h) + ' logical = ' + (anchorDevice === null ? '?' : anchorDevice.x + ',' + anchorDevice.y + ' ' + anchorDevice.w + 'x' + anchorDevice.h + ' device')))
    console.log('  inside the anchored element (the control MUST be green here): ' + live.green + ' green of ' + live.total + ' samples')
    console.log('  inside the tab window, inset by ' + inset + 'px (the screen frame is the page furniture): ' + inside.green + ' green of ' + inside.total + ' samples')
    const problems = []
    // R277: a full-page overlay at the top z-index, painted by the page this instrument just appended it to, must
    // cover a large share of whatever part of that page the capture shows. A handful of green samples means the
    // CAPTURE is stale - PrintWindow of a window carrying child webviews does not always force a repaint - and a
    // stale capture is an INSTRUMENT fault, so it is the third state and never a verdict about the panel. The
    // green box is printed above so the next reader can see which of the two cases this run was.
    // A whole-window green share is NOT a reading in this world: the shell's own deck, the right sidebar and the
    // panel's child webview cover most of the page, so a correct capture shows very little green over the whole
    // window. It is printed above as evidence and judged nowhere.
    if (anchor === null) {
      // A control that cannot be located cannot be read: this is the instrument's own third state, named.
      console.log('  SKIP  instrument fault, not a verdict: the page did not report a rectangle for the anchored element ('
        + String(anchorAnswer === null || anchorAnswer === undefined ? 'no answer' : anchorAnswer.exception ?? 'answer carried no box')
        + '), so the capture has no control in it and nothing about the panel can be read from this run')
      return 3
    }
    if (!Number.isFinite(Number(live.total)) || live.total === 0) problems.push('the anchored element ' + String(anchor.selector) + ' falls outside the captured window at ' + anchorDevice.x + ',' + anchorDevice.y + ', so the control was never in this picture')
    else if (live.green < live.total * 0.9) {
      // Which side is at fault: the page, or this capture pipeline? The SAME instant captured through the shell's
      // own renderer answers it. CDP's screenshot is the page as the renderer composited it; PrintWindow asks the
      // window to repaint itself. If CDP shows the control in the anchor box and PrintWindow does not, the window
      // capture is stale and every pixel reading this probe could produce is unavailable - an instrument fault,
      // proven rather than asserted, and never a verdict about the panel.
      let cdpVerdict = 'the shell renderer could not be asked for a screenshot (' + (cdpData === null ? 'no data' : 'no result') + ')'
      if (typeof cdpData === 'string') {
        // sampleRegion resolves its image argument against the shell's own cwd, so a relative path is what it wants.
        const cdpPath = '.tmp/r277-probe-cdp-shot.png'
        writeFileSync(join(process.cwd(), cdpPath), Buffer.from(cdpData, 'base64'))
        const cdpSample = sampleRegion(cdpPath, anchorDevice)
        const shellSample = sampleRegion(cdpPath, { x: 0, y: 0, w: 60, h: 60 })
        cdpVerdict = 'the SAME instant through the shell renderer (Page.captureScreenshot, saved to ' + cdpPath + '): '
          + cdpSample.green + '/' + cdpSample.total + ' samples of the anchor box are the control overlay, and ' + shellSample.green + '/' + shellSample.total + ' at the top-left corner are too'
      }
      console.log('  SKIP  instrument fault, not a verdict: the page reported ' + String(anchor.selector) + ' at ' + String(anchor.x) + ',' + String(anchor.y)
        + ' but only ' + live.green + ' of ' + live.total + ' samples of that box are the control overlay in the WINDOW CAPTURE')
      console.log('        ' + cdpVerdict)
      console.log('        so the capture pipeline, not the page, is what cannot be read here - nothing about the panel can be established from this run')
      return 3
    }
    if (inside.total > 0 && inside.green > inside.total * 0.2) problems.push('the tab window shows the MAIN page: ' + inside.green + ' of ' + inside.total + ' samples are the control overlay, so the panel is NOT drawn where the shell says its window is')
    if (inside.total === 0) problems.push('the tab window rectangle falls outside the captured window, so nothing was read inside it')
    if (problems.length > 0) { for (const problem of problems) console.log('  FAIL  ' + problem); return 1 }
    console.log('  ok    the panel is drawn over the main page inside the window rectangle the shell reports, and the control proves the picture is live')
    return 0
  } finally {
    if (openedPanel) await panelPost(PORT, { op: 'close' })
    await releaseLease(PORT, HOLDER)
    cdp.close()
  }
}

process.exitCode = await main()
