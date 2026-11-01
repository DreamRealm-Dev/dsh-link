// Contract criterion 1 (task-184): opening and closing the panel must not leave the main window black or torn - and R170
// taught the gate to measure it the way a user does it.
//
// R165 drove op=open/op=close itself and sampled six frames 300 ms apart. R170 then built a ~30 fps sampler and found two
// things: a sampler started AFTER the op only ever sees the settled world, and - more importantly - the LIVE PAGE HOST owns
// the panel (it runs the product's own heal rule, "no open right column, no panel", on a 400 ms poll), so a gate that drives
// the panel is fighting the product for it and can lose mid-phase (measured: exists=false straight after a phase the shell
// had reported open).
//
// So this gate drives the COLUMN instead: it clicks the page's own 收起右侧边栏 / 打开右侧边栏 controls and samples the window
// across the transitions the product performs by itself. That is also closer to the criterion, which is about the user
// opening and closing the panel.
//
// Sampling: the process loops as fast as it can until a deadline (measured ~25-30 fps), and each frame reads a sparse grid
// over the WHOLE window (so the panel's share shows up wherever the host puts it - a fixed box goes stale the moment it is
// re-placed) plus two 120x120 boxes: one beside the panel, which must stay covered by the injected control overlay, and one
// where the panel's rectangle is, which must never become a black void.
//
// Usage: node scripts/probe-window-transition.mjs [--port 31761] [--cdp-port 9222] [--deadline 4200]
//                                                [--confirm-ms 1200] [--confirm-attempts 4] [--self-attack]
//
// R182-G: THIS GATE USED TO HOLD THE LEASE WHILE IT WAITED FOR THE PRODUCT TO ACT, and that is why readings 1, 2
// and 3 were red on a healthy build. Measured (raw: .tmp/r182-live/e5-host-close-lease.txt), the page host closes
// the panel when the pane goes away by posting op=close from the CLIENT'S OWN PAGE (panel_host.js:134, no holder);
// the proxy names a request from our own origin USER_PAGE_HOLDER (proxy.rs:380-399), and enforce_lease refuses a
// holder that is not the lease holder BY NAME (sidebar_panel.rs:777-801). The SAME page-posted close, one run:
//   lease free  -> 200 {"exists":false}   (the panel closed)
//   leased by X -> 400 "the panel is leased by X and not by user-page: the placement was refused"  (it stayed open)
//   released    -> 200 {"exists":false}   (closed again)
// R152/R153 settled the rule this gate was breaking: while a lease is held the host "must not reopen, move or
// close anything" (panel_host.js:94-103). A gate whose subject IS the product's own open/close therefore takes no
// lease at all; it refuses by name when somebody else holds one.
//
// The second stale premise was the black accounting. Since R179-A the panel is a preview window: the shell's own
// browser page paints the bay, and the letterbox around the screen is --dsh-screen-void #050608 (browser_ui.html:24
// and :74-78) - deliberately near-black. Counting those pixels as "the window went black" (the old wholeBlack
// ceiling) reddens every frame in which the panel is OPEN. The panel's own deck is now EXCLUDED from that count
// (reported separately), and the probe boxes are converted from the page's logical coordinates into the capture's
// device pixels, which is the space the bitmap and GetWindowRect share.
//
// ---------------------------------------------------------------------------------------------------------------------
// R184-E: the two GATE-SIDE debts R182-G §8 named (and R183-C re-measured: 段跑 SKIP / 逐门 PASS 16.4 s / 复跑
// SKIP+FAIL 1-collapse-no-black - i.e. the verdict was not usable at all). Both are fixed HERE, in the gate:
//
// 1. A world with NO [data-dsh-link-surface="true"] ANCHOR now gets a NAMED NOT MEASURED and exit 3 - never a
//    FAIL. The object this gate switches is the product's own panel, and the page host opens NOTHING where no
//    pane declares that surface: panel_host.js:15 ("with no surface marker ... the panel is CLOSED"), :44 (the
//    column IS that query) and :133 (with no rect, the tick returns after closing). In an anchor-less world the
//    product has no panel to open or close, so "the column control did not close a panel" is a fact about the
//    WORLD. R182-G's first two runs (the world left on 终端, surfaceCount=0) read exactly that world as three
//    PRODUCT failures - one of the three shapes that made this gate unusable. The anchor is now read as the FIRST
//    thing the gate does, before the overlay is injected and before anything is clicked, so a world with no
//    object to switch is refused without touching the layout.
//
// 2. The frames must prove they are not STALE BEFORE any product verdict, not after one. Before the two
//    transitions are sampled the gate now takes a CONFIRMATION: the page says the anchor is on screen, the shell
//    says the panel exists, and the capture taken between those two reads shows the panel drawn - twice in a row,
//    with the same state both times. Every confirmation frame must also carry a LIVENESS MARKER painted into the
//    page moments before the capture (12x12 px at 6,6, off the 24px sample grid), which is what makes "these
//    frames are newer than the marker" a measurement rather than a hope. Until the confirmation holds the gate
//    clicks NOTHING; if it never holds the verdict is a named NOT MEASURED, exit 3. R182-G's third run said
//    "these are stale captures of a repainting window" AFTER the phases had run and after a FAIL had been
//    printed; that refusal is kept, and the confirmation above is what makes it rare.
//
// 3. What did NOT change: a world that HAS the anchor is measured, and a product that does not move the panel in
//    it is still RED with exit 1. Every refusal path above fires only on INSTRUMENT evidence (no usable anchor,
//    the confirmation never held, the control overlay missing from the frames, PrintWindow refusing, too few
//    frames, the panel not drawn before the click while the shell says it is open). A flat swing with a live
//    instrument is a product failure and stays one. Measured in R184-E in a purpose-built counter-evidence world
//    (anchor on screen, the product's own op=open refused in the page by the harness): 2 readings failed, exit 1.
//
// Exit: 0 every reading held | 1 a product reading failed | 3 a named reason the gate could not reach a product
// verdict (the third state - exit 3 is NOT a report that the product is broken).
//
// R73 alive-control: EXEMPT, with the reason - it never boots a kernel or a profile: it talks to an already-running shell
// over HTTP, clicks that shell's own controls through its CDP port, and refuses (exit 3) when the shell, the CDP port or the
// right column is absent - so the composition it reads is the caller's and its absence is reported instead of absorbed.
import { writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { panelPost } from './panel-lease.mjs'

const args = process.argv.slice(2)
const argOf = (name, fallback) => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? args[at + 1] : fallback }
const PORT = Number(argOf('--port', '31761'))
const CDP_PORT = Number(argOf('--cdp-port', '9222'))
// The column animates (the frame carries transition: all) and the page host only closes the panel once the column is
// below the collapsed width, on its own 400 ms poll - measured in R171: a 2.6 s window ended at column width 397, i.e.
// mid-animation, while the panel was still open. The window has to cover the animation AND the host's tick.
const DEADLINE = Number(argOf('--deadline', '4200'))
// R184-E: the confirmation window (see the header). Short on purpose: it has to be the SAME read as the page and shell
// readings that bracket it, and it is retried rather than lengthened.
const CONFIRM_MS = Number(argOf('--confirm-ms', '1200'))
const CONFIRM_ATTEMPTS = Number(argOf('--confirm-attempts', '4'))
const SELF_ATTACK = args.includes('--self-attack')
// R182-G: no HOLDER and no lease claim. While a lease is held the page host must not open, move or close the
// panel (panel_host.js:94-103), and this gate's whole subject is the product doing exactly that.
const OPEN_LABEL = '\u6253\u5f00\u53f3\u4fa7\u8fb9\u680f'
const CLOSE_LABEL = '\u6536\u8d77\u53f3\u4fa7\u8fb9\u680f'
const MIN_COLUMN = 48
// panel_host.js:31 - "a surface smaller than this holds no browser". The gate uses the product's own floor so that
// "the product could have a panel here" is the product's criterion rather than one invented in the gate.
const MIN_SURFACE = 48
// R171: pointer-events:none is not decoration. This overlay covers the whole page at the top z-index, so without it the
// CDP clicks that drive the column's own controls land ON THE OVERLAY and nothing happens - measured: the collapse
// control was clicked, the column stayed at 397px for 15s, and the panel never closed.
const OVERLAY = "(()=>{const d=document.createElement('div');d.id='dsh-ctl-overlay';d.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:#00ff00;pointer-events:none';document.body.appendChild(d);return true})()"
const UNOVERLAY = "(()=>{const d=document.getElementById('dsh-ctl-overlay');if(d)d.remove();return true})()"
// R184-E: the liveness marker. Appended AFTER the overlay with the same top z-index (later in DOM order wins), 12x12 px
// at 6,6: it covers none of the 24px sample grid points ((0,0), (24,0), (0,24) ...) and neither probe box (the "outside"
// box starts at x=40), so it cannot move a reading - it only has to be VISIBLE IN EVERY CONFIRMATION FRAME. A frame
// painted before the marker existed cannot carry it, which is what turns "these frames are not stale" into a reading.
const MARK_RGB = '#ff00ff'
const MARK = "(()=>{const d=document.createElement('div');d.id='dsh-ctl-mark';d.style.cssText='position:fixed;left:6px;top:6px;width:12px;height:12px;z-index:2147483647;background:" + MARK_RGB + "';document.body.appendChild(d);return true})()"
const UNMARK = "(()=>{const d=document.getElementById('dsh-ctl-mark');if(d)d.remove();return true})()"
const OUTSIDE_GREEN_FLOOR = 0.85
const MAIN_BLACK_CEILING = 0.05
const PROBE_BLACK_CEILING = 0.5
// R182-G: a void has to be SUSTAINED to be a reading. One frame of black inside a fixed box is what a mid-repaint
// capture looks like (R173 measured stale captures of a repainting window), and the panel's own letterbox is
// deliberately near-black (browser_ui.html --dsh-screen-void), so a single frame is reported and not judged.
const VOID_FRAMES_FLOOR = 2
const SWING_FLOOR = 0.05
// The panel covering this share of the window or less counts as DRAWN (wholeGreen is the share of the window the
// injected green overlay still shows). Measured on a healthy build in R182-G: wholeGreen 0.85 with the panel open,
// 1.0 with it closed, so this ceiling sits in the middle of a real gap rather than on a measured value.
const DRAWN_CEILING = 0.9
// The phases click their control 300 ms in; a frame captured before that is a frame of the world AS IT WAS BEFORE the
// transition was asked for, and R182-G's third run is exactly where that distinction matters.
const PRE_CLICK_MS = 250
// How long the gate waits for the sampler's first frames before clicking anyway (see samplePhase).
const ARM_MS = Number(argOf('--arm-ms', '3000'))

// PanelOn is an INT, not a bool: pwsh -File hands every argument over as a string and PowerShell refuses to
// bind "true" to [bool] (measured: 'Cannot convert value "System.String" to type "System.Boolean"', R182-G).
const SAMPLER = `param([int]$DeadlineMs, [int]$InX, [int]$InY, [int]$OutX, [int]$OutY, [int]$Size, [int]$PanelL, [int]$PanelT, [int]$PanelW, [int]$PanelH, [int]$PanelOn)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class WTr2 {
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
[void][WTr2]::SetProcessDpiAwarenessContext([IntPtr](-4))
$proc = Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { '{"error":"no client"}'; exit 0 }
$script:MY = [uint32]$proc.Id
$script:MAIN = [IntPtr]::Zero
[void][WTr2]::EnumWindows([WTr2+P]{ param($h, $l)
  $q = [uint32]0
  [void][WTr2]::GetWindowThreadProcessId($h, [ref]$q)
  if ($q -eq $script:MY) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][WTr2]::GetClassName($h, $sb, 256)
    if ($sb.ToString() -eq 'Tauri Window') { $script:MAIN = $h }
  }
  return $true }, [IntPtr]::Zero)
if ($script:MAIN -eq [IntPtr]::Zero) { '{"error":"no window"}'; exit 0 }
$r = New-Object WTr2+R
[void][WTr2]::GetWindowRect($script:MAIN, [ref]$r)
$w = $r.RR - $r.L
$h2 = $r.B - $r.T
$frame = 0
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$base = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
while ($stopwatch.ElapsedMilliseconds -lt $DeadlineMs) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h2
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [WTr2]::PrintWindow($script:MAIN, $hdc, 2)
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  $wGreen = 0; $wBlack = 0; $wTot = 0; $wBlackOut = 0; $wTotOut = 0; $wBlackLeft = 0; $wTotLeft = 0
  # R382: the MAIN PAGE lives on the LEFT of the window and the panel's deck on the RIGHT, so a band on the left is the
  # one region a reflow cannot invalidate. The fixed OUTSIDE box this gate used before sat where the layout moves during
  # the column animation: it ended up over the deck (which paints near-black on purpose) and every animating frame read
  # as "the main page was lost". A band measured against the window's own width follows the layout for free.
  $leftBand = [int]($w * 0.45)
  for ($wy = 0; $wy -lt $h2; $wy += 24) {
    for ($wx = 0; $wx -lt $w; $wx += 24) {
      $wc = $bmp.GetPixel($wx, $wy); $wTot++
      $inPanel = ($PanelOn -eq 1) -and $wx -ge $PanelL -and $wx -lt ($PanelL + $PanelW) -and $wy -ge $PanelT -and $wy -lt ($PanelT + $PanelH)
      if ($wx -lt $leftBand) {
        $wTotLeft++
        if ($wc.R -lt 16 -and $wc.G -lt 16 -and $wc.B -lt 16) { $wBlackLeft++ }
      }
      if (-not $inPanel) { $wTotOut++ }
      if ($wc.R -lt 110 -and $wc.G -gt 190 -and $wc.B -lt 110) { $wGreen++ }
      if ($wc.R -lt 16 -and $wc.G -lt 16 -and $wc.B -lt 16) { $wBlack++; if (-not $inPanel) { $wBlackOut++ } }
    }
  }
  function Stats([int]$bx, [int]$by, [int]$sz) {
    $green = 0; $black = 0; $tot = 0
    for ($y = $by; $y -lt ($by + $sz); $y += 4) {
      for ($x = $bx; $x -lt ($bx + $sz); $x += 4) {
        if ($x -lt 0 -or $y -lt 0 -or $x -ge $w -or $y -ge $h2) { continue }
        $c = $bmp.GetPixel($x, $y); $tot++
        if ($c.R -lt 110 -and $c.G -gt 190 -and $c.B -lt 110) { $green++ }
        if ($c.R -lt 16 -and $c.G -lt 16 -and $c.B -lt 16) { $black++ }
      }
    }
    if ($tot -lt 1) { return @{ green = 0.0; black = 0.0 } }
    return @{ green = [math]::Round($green / [double]$tot, 3); black = [math]::Round($black / [double]$tot, 3) }
  }
  $ins = Stats $InX $InY $Size
  $outs = Stats $OutX $OutY $Size
  if ($w -gt 12 -and $h2 -gt 12) { $mk = $bmp.GetPixel(12, 12); $mkText = '"' + $mk.R + ',' + $mk.G + ',' + $mk.B + '"' } else { $mkText = 'null' }
  $bmp.Dispose()
  $wg = if ($wTot -lt 1) { 0.0 } else { [math]::Round($wGreen / [double]$wTot, 3) }
  $wb = if ($wTot -lt 1) { 0.0 } else { [math]::Round($wBlack / [double]$wTot, 3) }
  $wbo = if ($wTotOut -lt 1) { 0.0 } else { [math]::Round($wBlackOut / [double]$wTotOut, 3) }
  $wbl = if ($wTotLeft -lt 1) { 0.0 } else { [math]::Round($wBlackLeft / [double]$wTotLeft, 3) }
  Write-Output ('{"frame":' + $frame + ',"t":' + $stopwatch.ElapsedMilliseconds + ',"at":' + ($base + $stopwatch.ElapsedMilliseconds) + ',"printed":' + $ok.ToString().ToLower() + ',"wholeGreen":' + $wg + ',"wholeBlack":' + $wb + ',"wholeBlackOutsidePanel":' + $wbo + ',"leftBlack":' + $wbl + ',"insideGreen":' + $ins.green + ',"insideBlack":' + $ins.black + ',"outsideGreen":' + $outs.green + ',"outsideBlack":' + $outs.black + ',"mark":' + $mkText + '}')
  $frame++
}`

// R184-E: ONE read of the object this gate switches - the same element the page host reads (panel_host.js:44). It is read
// BEFORE anything is injected or clicked, so an anchor-less world is refused without the gate touching the layout. Nothing
// here is invented: every field is the product's own criterion for "there is a surface to fill" (panel_host.js:58-75).
const ANCHOR_PROBE = `(() => {
  const box = (el) => { if (el === null) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
  const surface = document.querySelector('[data-dsh-link-surface="true"]')
  const style = surface === null ? null : getComputedStyle(surface)
  const spot = box(surface)
  const vw = Math.round(window.innerWidth || 0)
  const vh = Math.round(window.innerHeight || 0)
  return JSON.stringify({
    url: location.href,
    surfaceCount: document.querySelectorAll('[data-dsh-link-surface]').length,
    surface: spot,
    display: style === null ? null : style.display,
    visibility: style === null ? null : style.visibility,
    opacity: style === null ? null : style.opacity,
    viewport: [vw, vh],
    onScreen: spot === null ? null : (spot.x < vw && spot.y < vh && spot.x + spot.w > 0 && spot.y + spot.h > 0),
    column: box(document.querySelector('[data-rightbar-col]')),
    host: globalThis.__DSH_LINK_PANEL_HOST ? globalThis.__DSH_LINK_PANEL_HOST.state() : null,
  })
})()`

// =====================================================================================================================
// The decision core. Every judgement below is a function of MEASURED DATA ONLY - no clock, no I/O, no page - so the live
// run and --self-attack drive the SAME code: a mutant either moves the verdicts it declares or the attack fails.
// =====================================================================================================================
const show = (value) => JSON.stringify(value === undefined ? null : value)
const round3 = (value) => Math.round(value * 1000) / 1000
const boxKey = (box) => (box === null || box === undefined || typeof box.w !== 'number' ? null : [box.x, box.y, box.w, box.h].map((n) => Math.round(n)).join(','))

/** The anchor reading: is there an object here that the product could open a panel on at all? */
const judgeAnchor = (anchor) => {
  const id = 'pre-anchor'
  // instrument: this row reads the WORLD (does an object exist for the product to switch), not the product. It is
  // printed beside the five product readings and it is not one of them.
  const instrument = true
  if (anchor === null) {
    return { id, instrument, status: 'not-measured', detail: 'NOT MEASURED: the page probe did not answer, so whether this world declares the surface a panel can be placed on is unknown', evidence: [] }
  }
  const evidence = [
    'surfaceCount=' + String(anchor.surfaceCount) + ' [data-dsh-link-surface="true"]=' + show(anchor.surface) + ' display=' + show(anchor.display) + ' visibility=' + show(anchor.visibility) + ' opacity=' + show(anchor.opacity),
    'viewport=' + show(anchor.viewport) + ' anchorOnScreen=' + show(anchor.onScreen) + ' railColumn=' + show(anchor.column) + ' pageHost=' + show(anchor.host),
  ]
  const refuse = (why) => ({ id, instrument, status: 'not-measured', detail: 'NOT MEASURED: ' + why + ' - the gate clicked nothing and touched no layout', evidence })
  if (anchor.surfaceCount === 0 || anchor.surface === null) {
    return refuse('this world declares no [data-dsh-link-surface="true"] anchor at all, and the page host opens NOTHING where no pane declares one (panel_host.js:15, :44, :133 - with no surface marker it CLOSES the panel), so there is no panel here for the product to open or close: no object this gate could watch being switched. R182-G measured this world (the rail left on 终端) and got three red readings out of it; they were about the world, not about the product')
  }
  if (anchor.display === 'none' || anchor.visibility === 'hidden' || anchor.opacity === '0') {
    return refuse('the page declares [data-dsh-link-surface="true"] but it is not rendered (display=' + show(anchor.display) + ', visibility=' + show(anchor.visibility) + ', opacity=' + show(anchor.opacity) + '), and panel_host.js:62 answers null for exactly that state - the host closes the panel there rather than opening one')
  }
  if (anchor.surface.w < MIN_SURFACE || anchor.surface.h < MIN_SURFACE) {
    return refuse('the anchor is ' + anchor.surface.w + 'x' + anchor.surface.h + ', below the ' + MIN_SURFACE + 'px floor the host itself uses (panel_host.js:31: "a surface smaller than this holds no browser"; :12: DSH parks an INACTIVE pane body at 0x0), so the host opens no panel on this surface')
  }
  return {
    id, instrument, status: 'ok',
    detail: 'the world offers the object this gate switches: [data-dsh-link-surface="true"] at ' + show(anchor.surface) + ' (on screen ' + show(anchor.onScreen) + '), with the page host ' + (anchor.host === null ? 'ABSENT from the page' : 'present (open=' + show(anchor.host.open) + ')'),
    evidence,
  }
}

/** R184-E: the confirmation. Two consecutive reads that HOLD and saw the same state - anchor on screen, shell reports the
 * panel, the capture between those two reads shows it drawn, and every frame is newer than the liveness marker. */
const judgeConfirmation = (reads) => {
  const id = '0-anchor-panel-in-one-read'
  const evidence = []
  for (const read of reads.slice(-2)) {
    evidence.push('attempt ' + String(read.attempt) + ': frames=' + String(read.frames) + ' markerFresh=' + String(read.markFrames) + ' drawnFrames=' + String(read.drawnFrames) + ' wholeGreen=' + show(read.wholeGreen) + ' anchor=' + show(read.anchorSurface) + ' panelExists=' + show(read.panelExists) + ' panelBounds=' + show(read.panelBounds) + ' freshestFrame=' + show(read.last))
  }
  const last = reads.length === 0 ? null : reads[reads.length - 1]
  const prev = reads.length < 2 ? null : reads[reads.length - 2]
  const refuse = (why) => ({ id, instrument: true, status: 'not-measured', detail: 'NOT MEASURED: ' + why, evidence })
  if (last === null || prev === null) {
    return refuse('the anchor and the panel were never seen in ONE read: the gate waited ' + String(CONFIRM_ATTEMPTS) + ' confirmation window(s) and never got two consecutive reads that held' + (last === null ? ' (no window produced a reading at all)' : ' (the last window: ' + String(last.why) + ')') + '. Nothing was clicked, so no product verdict is claimed here')
  }
  if (last.held !== true || prev.held !== true) {
    const broken = last.held === true ? prev : last
    return refuse('the confirmation did not hold twice in a row: attempt ' + String(prev.attempt) + ' held=' + show(prev.held) + ' and attempt ' + String(last.attempt) + ' held=' + show(last.held) + '; the failing window says: ' + String(broken.why) + '. Nothing was clicked, so no product verdict is claimed here')
  }
  if (prev.stateKey !== last.stateKey) {
    return refuse('the two consecutive confirmation reads did not see the same state (' + String(prev.stateKey) + ' then ' + String(last.stateKey) + '), so something moved between them and the frames cannot be read as one settled world')
  }
  return {
    id, instrument: true, status: 'ok',
    detail: 'the anchor and the panel were seen in ONE read, twice in a row and in the same state both times: the page has [data-dsh-link-surface="true"] at ' + show(last.anchorSurface) + ' on screen, the shell reports the panel at ' + show(last.panelBounds) + ', and the capture taken between those two reads shows the panel drawn in ' + String(last.drawnFrames) + ' of ' + String(last.frames) + ' frames - every one of them carrying the liveness marker painted into the page moments before the capture (' + String(last.markFrames) + '/' + String(last.frames) + '). So the frames the two phases are about to read are of the live world, not stale captures of a repainting window',
    evidence,
  }
}

/** One transition's verdict, from its frames and the shell's own readings around it. */
const judgePhase = (id, phase, ctx) => {
  const frames = phase.frames
  const problems = []
  const refusals = []
  const notes = []
  if (frames.length < 3) refusals.push('only ' + String(frames.length) + ' frame(s) were captured across the ' + phase.what + ' (floor 3), too few for the instrument to see a transition')
  const stale = frames.filter((f) => f.printed !== true)
  if (stale.length > 0) refusals.push('PrintWindow refused ' + String(stale.length) + ' of ' + String(frames.length) + ' frames, so the capture was not of this window')
  if (frames.length > 0 && frames[0].outsideGreen < OUTSIDE_GREEN_FLOOR) refusals.push('the control overlay was not visible in the first frame (outsideGreen=' + String(frames[0].outsideGreen) + '), so the page was not the prepared one - most likely it reloaded mid-run; no pixel reading is possible')
  const controlLost = frames.filter((f) => f.outsideGreen < OUTSIDE_GREEN_FLOOR && f.wholeBlack <= MAIN_BLACK_CEILING)
  if (controlLost.length > 0) refusals.push('the control overlay was absent from ' + String(controlLost.length) + ' of ' + String(frames.length) + ' frames while nothing was black (first at ' + String(controlLost[0].t) + 'ms) - ' + (ctx.controlPresentAfter === true ? 'the control is STILL in the page, so these are stale captures of a repainting window - the instrument, not the page' : 'and the control is gone from the page too, so the page itself changed'))
  if (phase.expectedDrawnAtStart === true) {
    // R184-E: the pre-click window is MEASURED, not assumed. The sampler starts in its own process (pwsh + Add-Type take
    // a few hundred ms), so "t < 250ms" does not mean "before the click": measured in the first R184-E ACTIVE run, the
    // click landed before the sampler's first frame and three perfectly good frames were read as "the panel was never
    // drawn". Every frame now carries an absolute epoch ("at") and the gate records when it clicked, so the frames this
    // test looks at are the ones that really were captured before the control was clicked.
    const clickedAt = typeof phase.clickedAt === 'number' ? phase.clickedAt : null
    const preClick = clickedAt === null ? frames.filter((f) => f.t < PRE_CLICK_MS) : frames.filter((f) => typeof f.at === 'number' && f.at < clickedAt)
    const drawnPre = preClick.filter((f) => f.wholeGreen <= DRAWN_CEILING)
    if (preClick.length > 0 && drawnPre.length === 0) {
      const lowest = Math.min.apply(null, preClick.map((f) => f.wholeGreen))
      refusals.push('the shell reported the panel open at ' + show(phase.panelRect) + ' but none of the ' + String(preClick.length) + ' frames captured BEFORE the control was clicked (' + (clickedAt === null ? 't<' + String(PRE_CLICK_MS) + 'ms' : 'at<' + String(clickedAt) + 'ms, between ' + String(preClick[0].at) + ' and ' + String(preClick[preClick.length - 1].at) + 'ms') + ') show it drawn (lowest wholeGreen=' + String(lowest) + ', ceiling ' + String(DRAWN_CEILING) + ') - ' + (ctx.controlPresentAfter === true ? 'and the inverted control is still in the page, so these are stale captures of a repainting window, not a page that lost its panel' : 'and the control is gone from the page too, so the page itself changed') + '. The confirmation immediately before this phase DID see the panel drawn, which is what makes this the instrument rather than the page')
    }
  }
  // R382: measured on the LEFT BAND (the main page's own side of the window), not on the fixed OUTSIDE box. That box sits
  // where the layout reflows during the column animation, so it lands on the deck - which paints near-black on purpose -
  // and every animating frame read as a lost main page (measured: 47 of 75 frames with outsideGreen=1 and
  // wholeBlackOutsidePanel=0, i.e. the control overlay was there and nothing outside the deck was black).
  const blackMain = frames.filter((f) => typeof f.leftBlack === 'number' && f.leftBlack > MAIN_BLACK_CEILING)
  if (blackMain.length > 0) problems.push(String(blackMain.length) + ' of ' + String(frames.length) + ' frames lost the main page on its own side of the window (first at ' + String(blackMain[0].t) + 'ms: leftBlack=' + String(blackMain[0].leftBlack) + ' outsideBlack=' + String(blackMain[0].outsideBlack) + ' outsideGreen=' + String(blackMain[0].outsideGreen) + ' wholeBlackOutsidePanel=' + String(blackMain[0].wholeBlackOutsidePanel) + ')')
  else if (frames.some((f) => typeof f.leftBlack !== 'number')) notes.push('the sampler did not report leftBlack in every frame, so the main-page side could not be judged (a sampler older than this gate)')
  const blackVoid = frames.filter((f) => f.insideBlack > PROBE_BLACK_CEILING)
  if (blackVoid.length >= VOID_FRAMES_FLOOR) problems.push(String(blackVoid.length) + ' of ' + String(frames.length) + ' frames show a black void inside the panel\'s own screen rectangle (first at ' + String(blackVoid[0].t) + 'ms: insideBlack=' + String(blackVoid[0].insideBlack) + '); a single frame is a repaint artifact and is reported without a verdict')
  else if (blackVoid.length > 0) notes.push('note: ' + String(blackVoid.length) + ' frame showed a black void inside the panel screen (t=' + String(blackVoid[0].t) + 'ms); below the ' + String(VOID_FRAMES_FLOOR) + '-frame floor, so it is reported and not judged')
  const clickedOffset = typeof phase.clickedAt === 'number' && frames.length > 0 && typeof frames[0].at === 'number' ? phase.clickedAt - frames[0].at : null
  const greens = frames.map((f) => f.wholeGreen)
  const lowest = greens.length === 0 ? null : Math.min.apply(null, greens)
  const highest = greens.length === 0 ? null : Math.max.apply(null, greens)
  const swing = lowest === null ? 0 : round3(highest - lowest)
  if (swing < SWING_FLOOR) problems.push('the window-wide main-page fraction moved only ' + String(swing) + ' across the ' + phase.what + ' (floor ' + String(SWING_FLOOR) + '), so the panel did not actually open or close in this phase')
  const evidence = notes.concat([
    'frames=' + String(frames.length) + ' over ' + String(phase.deadlineMs) + 'ms' + (clickedOffset === null ? '' : ', the control was clicked ' + String(clickedOffset) + 'ms after the first frame'),
    'wholeGreenLow=' + String(lowest) + ' high=' + String(highest) + ' swing=' + String(swing),
    'framesWithBlackVoid=' + String(blackVoid.length),
    'panelRectExcludedFromTheBlackCount=' + show(ctx.panelRectDevice),
    'leaseHeldDuringThisPhase=' + show(phase.lease === null || phase.lease === undefined ? null : phase.lease.held) + ' holder=' + show(phase.lease === null || phase.lease === undefined ? null : phase.lease.holder),
  ])
  if (refusals.length > 0) {
    return {
      refusals,
      row: {
        id, instrument: true, status: 'not-measured',
        detail: 'NOT MEASURED: ' + refusals.join(' | ') + ' - so this phase is not read as a product verdict, in either direction',
        evidence: evidence.concat(problems.map((problem) => 'reported for the record, NOT judged (the phase itself was refused): ' + problem)),
      },
    }
  }
  return {
    refusals: [],
    row: {
      id, status: problems.length === 0 ? 'ok' : 'red',
      detail: problems.length > 0 ? 'FAIL: ' + problems.join(' | ') : 'across the ' + phase.what + ' every frame kept the main page beside the panel, no frame showed a black void, and the panel itself moved',
      evidence,
    },
  }
}

/** The whole gate, over one measured world. Exit precedence: a named NOT MEASURED (3) outranks a product red (1) - the
 * third state refuses to claim a product verdict at all, and every row is printed either way so a red is never hidden. */
const judgeWorld = (world) => {
  const rows = []
  const anchorRow = judgeAnchor(world.anchor)
  rows.push(anchorRow)
  if (anchorRow.status !== 'ok') return { rows, exit: 3, stopped: anchorRow.id }
  const confirmRow = judgeConfirmation(world.confirmations)
  rows.push(confirmRow)
  if (confirmRow.status !== 'ok') return { rows, exit: 3, stopped: confirmRow.id }
  const collapse = judgePhase('1-collapse-no-black', world.collapse, world.ctx)
  rows.push(collapse.row)
  const expand = judgePhase('2-expand-no-black', world.expand, world.ctx)
  rows.push(expand.row)
  const afterCollapse = world.afterCollapse === undefined ? null : world.afterCollapse
  const closedHalf = afterCollapse !== null && afterCollapse.exists === false
  const existsAfterCollapse = show(afterCollapse === null ? null : afterCollapse.exists)
  rows.push(collapse.row.status === 'not-measured'
    ? { id: '3-collapse-closed-it', instrument: true, status: 'not-measured', detail: 'NOT MEASURED: reading 1 was refused (the reason is printed above), so the shell\'s report after the collapse (exists=' + existsAfterCollapse + ') cannot be turned into a claim about the close transition', evidence: ['panelExistsAfterCollapse=' + existsAfterCollapse] }
    : { id: '3-collapse-closed-it', status: closedHalf ? 'ok' : 'red', detail: closedHalf ? 'the product closed the panel when the column collapsed (so reading 1 measured a real close)' : 'FAIL: after collapsing the column the shell still reports a panel (exists=' + existsAfterCollapse + '), so reading 1 was not a close transition', evidence: ['panelExistsAfterCollapse=' + existsAfterCollapse] })
  const afterExpand = world.afterExpand === undefined ? null : world.afterExpand
  const openHalf = afterExpand !== null && afterExpand.exists === true
  const existsAfterExpand = show(afterExpand === null ? null : afterExpand.exists)
  rows.push(expand.row.status === 'not-measured'
    ? { id: '4-expand-opened-it', instrument: true, status: 'not-measured', detail: 'NOT MEASURED: reading 2 was refused (the reason is printed above), so the shell\'s report after the expand (exists=' + existsAfterExpand + ') cannot be turned into a claim about the open transition', evidence: ['panelExistsAfterExpand=' + existsAfterExpand] }
    : { id: '4-expand-opened-it', status: openHalf ? 'ok' : 'red', detail: openHalf ? 'the product opened the panel when the column expanded (so reading 2 measured a real open)' : 'FAIL: after expanding the column the shell reports no panel, so reading 2 was not an open transition', evidence: ['panelExistsAfterExpand=' + existsAfterExpand] })
  const restored = world.restored === undefined ? null : world.restored
  rows.push({ id: '5-column-restored', status: restored !== null && restored.w >= MIN_COLUMN ? 'ok' : 'red', detail: restored !== null && restored.w >= MIN_COLUMN ? 'the column was left expanded, the way it was found' : 'FAIL: the column was left with width ' + String(restored === null ? 'unknown' : restored.w), evidence: ['finalColumn=' + show(restored)] })
  const exit = rows.some((row) => row.status === 'not-measured') ? 3 : (rows.some((row) => row.status === 'red') ? 1 : 0)
  return { rows, exit, stopped: null }
}

const printRow = (row) => {
  console.log('  ' + (row.status === 'ok' ? 'ok  ' : row.status === 'red' ? 'FAIL' : 'NOT MEASURED') + '  ' + row.id + '. ' + row.detail)
  for (const line of row.evidence) console.log('        ' + line)
}

// =====================================================================================================================
// The live run.
// =====================================================================================================================
const connectCdp = async () => {
  const mod = await import('file:///' + process.cwd().replaceAll(String.fromCharCode(92), '/') + '/scripts/cdp-drive.mjs')
  const cdp = await mod.connect({ port: CDP_PORT, deadlineMs: 15000 })
  return { cdp, COLUMN_PROBE: mod.COLUMN_PROBE }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// The sampler prints one JSON object per line; PowerShell's own output is CRLF, so the split is the same one the
// original regex spelled out - written this way so it survives every layer of escaping a source file can pick up.
const LINES = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10))
// A compact summary, not every frame: the readings are what has to be read, and 60 frames of numbers bury them.
const fmt = (frames) => {
  if (frames.length === 0) return 'no frames'
  const greens = frames.map((f) => f.wholeGreen)
  const low = Math.min.apply(null, greens)
  const high = Math.max.apply(null, greens)
  // R382: the same substitution as the judge - the main page's own side of the window, not the reflowing fixed box.
  const blacks = frames.filter((f) => (typeof f.leftBlack === 'number' && f.leftBlack > MAIN_BLACK_CEILING) || f.insideBlack > PROBE_BLACK_CEILING).length
  return frames.length + ' frames, wholeGreen ' + low + '..' + high + ', framesWithBlack=' + blacks + ', first=' + frames[0].t + 'ms last=' + frames[frames.length - 1].t + 'ms'
}
/** The liveness marker's pixel, as the capture saw it. Tolerance, not equality: the marker is a flat fill, but the
 * capture goes through DPI scaling and PrintWindow's own rendering. */
const markerSeen = (mark) => {
  if (typeof mark !== 'string') return false
  const parts = mark.split(',').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((value) => Number.isFinite(value) === false)) return false
  return parts[0] >= 225 && parts[2] >= 225 && parts[1] <= 40
}

const main = async () => {
  const health = await panelPost(PORT, { op: 'report' }).catch(() => null)
  if (health === null) { console.log('SKIP: no shell on port ' + PORT + ' (start the client, or pass --port)'); return 3 }
  const connected = await connectCdp().catch(() => null)
  if (connected === null) { console.log('SKIP: no CDP on ' + CDP_PORT + ', so the column controls cannot be clicked and the overlay cannot be injected; this gate measured NOTHING'); return 3 }
  const { cdp, COLUMN_PROBE } = connected
  // R182-G: this gate takes NO lease (see the header). It watches the PRODUCT perform the transition - the page
  // host closes and opens the panel by itself - and a held lease is exactly what forbids the host to do that.
  const leaseAtEntry = health !== null && health.lease !== undefined && health.lease !== null ? health.lease : null
  if (leaseAtEntry !== null && leaseAtEntry.held === true) {
    cdp.close()
    console.log('SKIP: the panel is leased by ' + String(leaseAtEntry.holder) + ', and while a lease is held the page host must not open, move or close the panel (panel_host.js:94-103), so the product cannot perform the transition this gate watches; it refuses by name instead of measuring somebody else\'s lease')
    return 3
  }
  const samplerPath = join(tmpdir(), 'dsh-link-column-' + process.pid + '.ps1')
  writeFileSync(samplerPath, SAMPLER)
  // The rectangle the panel's own page paints: the deck the shell reports (logical) in the capture's device px.
  // Its near-black letterbox is the product's own furniture (browser_ui.html --dsh-screen-void), so the window's
  // black count has to exclude it or every frame with the panel open reads as "the window went black".
  let panelRectDevice = null
  let leaseNow = null
  const anchorRead = async () => { const seen = await cdp.json(ANCHOR_PROBE).catch(() => null); return seen !== null && seen.ok === true ? seen.value : null }
  const columnNow = async () => { const seen = await cdp.json(COLUMN_PROBE); return seen.ok === true ? seen.value : null }
  const panelReport = async () => { const seen = await panelPost(PORT, { op: 'report' }); return seen === null || seen === undefined ? null : seen }
  // R173: the discriminator for a refusal. "No overlay in the frames" has two very different causes - the page really
  // changed, or the CAPTURE returned stale frames while the window was repainting - and asking the page settles it.
  // Measured: across an idle 12s, across a collapse click and across an expand click, the injected marker element and the
  // window token both survive and performance.now() only grows (four controlled experiments in .tmp/r173-logs/), so the
  // frames that showed no control were stale captures, not a navigation.
  const controlStillInPage = async () => {
    const seen = await cdp.evaluate("!!document.getElementById('dsh-ctl-overlay')").catch(() => null)
    return seen !== null && (seen === true || seen.value === true)
  }
  const clickLabel = async (label) => {
    const seen = await columnNow()
    const button = seen === null || Array.isArray(seen.buttons) === false ? undefined : seen.buttons.find((entry) => entry.label === label)
    if (button === undefined) return null
    await cdp.click({ x: button.x, y: button.y })
    return button
  }
  const capture = async (deadlineMs, inside, outside) => {
    const panel = panelRectDevice
    const child = spawn('pwsh', ['-NoProfile', '-File', samplerPath, '-DeadlineMs', String(deadlineMs), '-InX', String(inside.x), '-InY', String(inside.y), '-OutX', String(outside.x), '-OutY', String(outside.y), '-Size', '120',
      '-PanelL', String(panel === null ? 0 : panel.x), '-PanelT', String(panel === null ? 0 : panel.y), '-PanelW', String(panel === null ? 0 : panel.w), '-PanelH', String(panel === null ? 0 : panel.h),
      '-PanelOn', panel === null ? '0' : '1'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += String(chunk) })
    child.stderr.on('data', (chunk) => { err += String(chunk) })
    await new Promise((resolve) => child.on('close', () => resolve()))
    if (err.trim() !== '') console.log('        sampler stderr: ' + err.trim().slice(0, 160))
    return out.split(LINES).filter((row) => row.trim().startsWith('{') && row.includes('frame')).map((row) => JSON.parse(row.trim()))
  }
  // R184-E: the sampler is ARMED before the control is clicked. The click used to go out on a fixed 300ms sleep, which
  // assumed the sampler's process was already running; measured, pwsh + Add-Type can take longer than that, and the
  // whole transition then happens before the first frame - the exact shape that made R183-C's re-run read a healthy
  // product as "1-collapse-no-black FAIL". Waiting for the first frames is not a relaxation: it can only add frames to
  // the window the readings are computed from.
  const samplePhase = async (label, inside, outside, trigger) => {
    // R182-G: recorded per phase, as evidence that the product was free to act (no lease of ours, and if a lease
    // appeared it was somebody else's - which is exactly the situation this gate no longer creates itself).
    const leaseReport = await panelReport()
    leaseNow = leaseReport !== null && leaseReport.lease !== undefined && leaseReport.lease !== null ? leaseReport.lease : null
    const child = spawn('pwsh', ['-NoProfile', '-File', samplerPath, '-DeadlineMs', String(DEADLINE), '-InX', String(inside.x), '-InY', String(inside.y), '-OutX', String(outside.x), '-OutY', String(outside.y), '-Size', '120',
      '-PanelL', String(panelRectDevice === null ? 0 : panelRectDevice.x), '-PanelT', String(panelRectDevice === null ? 0 : panelRectDevice.y), '-PanelW', String(panelRectDevice === null ? 0 : panelRectDevice.w), '-PanelH', String(panelRectDevice === null ? 0 : panelRectDevice.h),
      '-PanelOn', panelRectDevice === null ? '0' : '1'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let armed = 0
    const spawnedAt = Date.now()
    child.stdout.on('data', (chunk) => { const text = String(chunk); out += text; armed += (text.match(/\{"frame":/g) || []).length })
    child.stderr.on('data', (chunk) => { err += String(chunk) })
    const finished = new Promise((resolve) => child.on('close', () => resolve()))
    const armUntil = Date.now() + ARM_MS
    while (armed < 2 && Date.now() < armUntil) await sleep(25)
    if (armed < 2) console.log('        the sampler produced ' + String(armed) + ' frame(s) in ' + String(ARM_MS) + 'ms; clicking anyway (the phase will say so)')
    await trigger()
    const clickedAt = Date.now()
    console.log('        the control click went out ' + String(clickedAt - spawnedAt) + 'ms after the sampler was spawned, with ' + String(armed) + ' frame(s) already captured before it')
    await finished
    if (err.trim() !== '') console.log('        sampler stderr: ' + err.trim().slice(0, 160))
    const frames = out.split(LINES).filter((row) => row.trim().startsWith('{') && row.includes('frame')).map((row) => JSON.parse(row.trim()))
    console.log('  ' + label + ' (' + frames.length + ' frames over ' + DEADLINE + 'ms): ' + fmt(frames))
    return { frames, clickedAt }
  }
  // R184-E: one confirmation read - the page, the shell and a capture taken BETWEEN the two readings, so "the anchor and
  // the panel were visible in the same read" is measured rather than assumed. Two of these in a row, in the same state,
  // are what the sampling is allowed to start from.
  const confirmationRead = async (attempt, inside, outside) => {
    await cdp.evaluate(UNMARK).catch(() => null)
    const anchorBefore = await anchorRead()
    const panelBefore = await panelReport()
    await cdp.evaluate(MARK).catch(() => null)
    const frames = await capture(CONFIRM_MS, inside, outside)
    await cdp.evaluate(UNMARK).catch(() => null)
    const anchorAfter = await anchorRead()
    const panelAfter = await panelReport()
    const greens = frames.map((f) => f.wholeGreen)
    const lastFrame = frames.length === 0 ? null : frames[frames.length - 1]
    const markFrames = frames.filter((f) => markerSeen(f.mark)).length
    const drawnFrames = frames.filter((f) => f.printed === true && f.wholeGreen <= DRAWN_CEILING && f.outsideGreen >= OUTSIDE_GREEN_FLOOR).length
    const read = {
      attempt,
      frames: frames.length,
      markFrames,
      drawnFrames,
      wholeGreen: frames.length === 0 ? null : [Math.min.apply(null, greens), Math.max.apply(null, greens)],
      anchorSurface: anchorBefore === null ? null : anchorBefore.surface,
      anchorOnScreen: anchorBefore !== null && anchorAfter !== null && anchorBefore.onScreen === true && anchorAfter.onScreen === true,
      panelExists: panelBefore !== null && panelAfter !== null && panelBefore.exists === true && panelAfter.exists === true,
      panelBounds: panelAfter === null ? null : panelAfter.bounds,
      last: lastFrame === null ? null : { t: lastFrame.t, wholeGreen: lastFrame.wholeGreen, outsideGreen: lastFrame.outsideGreen, printed: lastFrame.printed, mark: lastFrame.mark },
      stateKey: JSON.stringify({ anchorBefore: boxKey(anchorBefore === null ? null : anchorBefore.surface), anchorAfter: boxKey(anchorAfter === null ? null : anchorAfter.surface), existsBefore: panelBefore === null ? null : panelBefore.exists, existsAfter: panelAfter === null ? null : panelAfter.exists, boundsBefore: panelBefore === null ? null : boxKey(panelBefore.bounds), boundsAfter: panelAfter === null ? null : boxKey(panelAfter.bounds) }),
    }
    read.held = read.frames >= 3 && read.markFrames === read.frames && read.anchorOnScreen === true && read.panelExists === true && lastFrame !== null && lastFrame.printed === true && lastFrame.wholeGreen <= DRAWN_CEILING && lastFrame.outsideGreen >= OUTSIDE_GREEN_FLOOR
    read.why = read.held === true ? 'held' : read.frames < 3 ? 'only ' + String(read.frames) + ' frame(s) in the ' + String(CONFIRM_MS) + 'ms confirmation window'
      : read.markFrames !== read.frames ? String(read.frames - read.markFrames) + ' of ' + String(read.frames) + ' frames do not carry the liveness marker, so those frames were painted BEFORE the marker was put into the page - stale captures of a repainting window, not the live world'
        : read.anchorOnScreen !== true ? 'the page does not have [data-dsh-link-surface="true"] on screen (' + show(read.anchorSurface) + '), so the host has no surface to place a panel on'
          : read.panelExists !== true ? 'the shell does not report a panel (exists=' + show(read.panelExists) + ' before/after the capture), so there is no panel being drawn to confirm'
            : lastFrame === null || lastFrame.wholeGreen > DRAWN_CEILING ? 'the freshest frame does not show the panel drawn (wholeGreen=' + show(read.wholeGreen) + ', ceiling ' + String(DRAWN_CEILING) + ')'
              : 'the control overlay is not visible in the freshest frame (outsideGreen=' + show(lastFrame.outsideGreen) + ')'
    console.log('  confirmation attempt ' + attempt + ': frames=' + String(read.frames) + ' markerFresh=' + String(read.markFrames) + ' drawnFrames=' + String(read.drawnFrames) + ' wholeGreen=' + show(read.wholeGreen) + ' anchorOnScreen=' + show(read.anchorOnScreen) + ' panelExists=' + show(read.panelExists) + ' -> ' + (read.held ? 'HELD' : 'not held: ' + read.why))
    return read
  }
  // The world as found, before anything is injected or clicked (R184-E).
  const anchorAtEntry = await anchorRead()
  const anchorRow = judgeAnchor(anchorAtEntry)
  const reportLeftWorld = async () => {
    const left = await panelReport()
    console.log('  the world this gate leaves: panel exists=' + String(left === null ? null : left.exists) + ' lease=' + show(left === null ? null : left.lease))
  }
  if (anchorRow.status !== 'ok') {
    printRow(anchorRow)
    console.log('  SKIP: this gate did not reach a product verdict (the named reason is printed above). Exit 3 is the THIRD state: it is not a report that the product is broken, and the gate touched no layout')
    await reportLeftWorld()
    cdp.close()
    return 3
  }
  try {
    const first = await columnNow()
    if (first === null) { console.log('SKIP: the page probe did not answer, so the right column could not be found'); return 3 }
    if (first.column === null) { console.log('SKIP: this client is showing a screen without the right column ([data-rightbar-col] is absent, i.e. no session is open), so nothing about opening and closing the panel can be measured; the gate touched no layout'); return 3 }
    // R176: clean BEFORE injecting as well as after (see probe-window-pixels.mjs) - a leftover full-page green overlay
    // from a killed run was found sitting in the user's live client and removed in R176.
    await cdp.evaluate(UNOVERLAY).catch(() => null)
    await cdp.evaluate(OVERLAY)
    await sleep(1000)
    const beforeCollapse = await panelReport()
    const reportBox = beforeCollapse && beforeCollapse.bounds ? beforeCollapse.bounds : null
    // R182-G: the panel's own WINDOW (= the letterboxed screen) and the DECK the shell's page paints, both in the
    // capture's device pixels. They come from the shell's own report, and the display scale is MEASURED from its two
    // descriptions of the same window (screenPane logical vs the active tab's bounds, which are physical) - never
    // assumed, and never the panel page's devicePixelRatio, which fixed mode forces to 1.
    const tabRow = beforeCollapse && Array.isArray(beforeCollapse.tabs) ? (beforeCollapse.tabs.filter((tab) => tab.active === true)[0] || beforeCollapse.tabs[0]) : null
    const tabBox = tabRow && tabRow.bounds && typeof tabRow.bounds.w === 'number' ? tabRow.bounds : null
    const screenPane = beforeCollapse && beforeCollapse.screenPane && typeof beforeCollapse.screenPane.w === 'number' ? beforeCollapse.screenPane : null
    const deckPane = beforeCollapse && beforeCollapse.deckPane && typeof beforeCollapse.deckPane.w === 'number' ? beforeCollapse.deckPane : null
    const displayScale = tabBox !== null && screenPane !== null && screenPane.w > 0 ? Math.round((tabBox.w / screenPane.w) * 10000) / 10000 : null
    const scale = displayScale === null ? 1 : displayScale
    const toDevice = (quad) => quad === null ? null : { x: Math.round(quad.x * scale), y: Math.round(quad.y * scale), w: Math.round(quad.w * scale), h: Math.round(quad.h * scale) }
    const windowDevice = tabBox !== null ? { x: Math.round(tabBox.x), y: Math.round(tabBox.y), w: Math.round(tabBox.w), h: Math.round(tabBox.h) } : toDevice(screenPane)
    // The exclusion is the DECK (the whole surface minus the chin), not the screen: the letterbox lives between them.
    panelRectDevice = toDevice(deckPane) === null ? windowDevice : toDevice(deckPane)
    // R171: anchor the probes on the COLUMN, not on where the panel happens to be. Measured: a panel the shell opened
    // itself (rather than the page host) sits at the default creation rect 0,0 630x900, so a "outside the panel" box
    // computed from it landed INSIDE the panel and the reading then called a perfectly good overlay "lost". The column is
    // what this gate drives, so the column is the reference: one box in the column's middle (where the panel appears) and
    // one on the main page well to the left of the column (where the overlay must stay visible).
    // R173: the "outside" box must be somewhere the COLUMN CAN NEVER REACH. The column grows leftward when it expands, so a
    // box just beside it can end up covered by the panel - and a box under a dark panel measures zero overlay, which the
    // older gate then reported as "the page changed under the gate". Measured: during an expand the overlay vanished from
    // 91 of 97 frames while nothing was black, with the box sitting where the widened column had arrived. The far left of
    // the window is covered by the overlay and cannot be covered by the panel.
    const columnBox = first.column
    // R171 anchored these boxes on the column because a fixed box goes stale the moment the panel is re-placed.
    // R182-G adds the missing half: the boxes are handed to a BITMAP in device pixels, while the page reports
    // logical ones, so the column's numbers are scaled here (measured display scale) and the "inside" box is the
    // panel's own screen when the report names one - which is where the panel really is.
    const inside = windowDevice === null
      ? { x: Math.round(columnBox.x * scale + (columnBox.w * scale) / 2 - 60), y: Math.round(columnBox.y * scale + (columnBox.h * scale) / 2 - 60) }
      : { x: Math.round(windowDevice.x + windowDevice.w / 2 - 60), y: Math.round(windowDevice.y + windowDevice.h / 2 - 60) }
    const outside = { x: 40, y: inside.y }
    console.log('  panel before the collapse: exists=' + String(beforeCollapse && beforeCollapse.exists) + ' bounds(surface)=' + JSON.stringify(reportBox) + ' | column=' + JSON.stringify(columnBox))
    console.log('  panel window (physical, window-relative) ' + show(windowDevice) + ' | deck excluded from the black count ' + show(panelRectDevice) + ' | display scale ' + String(displayScale) + ' | probe boxes (device px) inside ' + inside.x + ',' + inside.y + ' outside ' + outside.x + ',' + outside.y)
    // The control must exist before a phase is driven with it: a page that offers no collapse control is a world the
    // gate cannot measure in, and saying so is not the same as reporting a product failure (R171).
    const collapseControl = (await columnNow())?.buttons?.find((entry) => entry.label === CLOSE_LABEL)
    if (collapseControl === undefined) { console.log('SKIP: the page offers no ' + JSON.stringify(CLOSE_LABEL) + ' control, so the panel could not be closed the way a user closes it; the gate touched no layout'); return 3 }
    console.log('  the collapse control is at ' + JSON.stringify(collapseControl))
    // ---- R184-E: the confirmation the sampling has to pass BEFORE it is allowed to judge anything ----
    const confirmations = []
    for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS && confirmations.length < 2; attempt++) {
      const read = await confirmationRead(attempt, inside, outside)
      if (read.held === true) confirmations.push(read)
      else confirmations.length = 0
      if (confirmations.length < 2 && attempt < CONFIRM_ATTEMPTS) await sleep(700)
    }
    const confirmRow = judgeConfirmation(confirmations)
    if (confirmRow.status !== 'ok') {
      console.log('  (reading 0 is the INSTRUMENT precondition, printed with the five product readings; it is what makes them readable, and when it cannot be taken the gate exits 3 instead of judging)')
      printRow(anchorRow)
      printRow(confirmRow)
      console.log('  SKIP: this gate did not reach a product verdict (the named reason is printed above). Exit 3 is the THIRD state: it is not a report that the product is broken, and nothing was clicked')
      return 3
    }
    // Waiting for the END STATE, not for a fixed sleep: the reading is about the transition, and the state readings have
    // to be taken after the product has finished doing what the click asked for.
    const waitFor = async (predicate, ms, label) => {
      const until = Date.now() + ms
      while (Date.now() < until) {
        if ((await predicate()) === true) return true
        await sleep(500)
      }
      console.log('  gave up waiting for ' + label)
      return false
    }
    const closingSample = await samplePhase('collapse', inside, outside, async () => {
      const button = await clickLabel(CLOSE_LABEL)
      console.log('        clicked the collapse control: ' + (button === null ? 'NOT FOUND (label ' + JSON.stringify(CLOSE_LABEL) + ')' : JSON.stringify(button)))
    })
    const closing = closingSample.frames
    const leaseAtCollapse = leaseNow
    const collapsed = await waitFor(async () => { const c = (await columnNow())?.column; return c !== null && c.w < MIN_COLUMN }, 15000, 'the column to reach the collapsed width')
    const controlPresentAfter = await controlStillInPage()
    await waitFor(async () => { const report = await panelReport(); return report !== null && report.exists === false }, 10000, 'the host to close the panel')
    const afterCollapse = await panelReport()
    const columnAfterCollapse = (await columnNow())?.column ?? null
    console.log('  collapsed=' + String(collapsed))
    console.log('  after the collapse: panel exists=' + String(afterCollapse && afterCollapse.exists) + ' | column=' + JSON.stringify(columnAfterCollapse))
    const openingSample = await samplePhase('expand', inside, outside, async () => {
      // The open control is only offered while the column is collapsed, so wait for it rather than clicking blindly
      let button = await clickLabel(OPEN_LABEL)
      for (let attempt = 0; attempt < 6 && button === null; attempt++) { await sleep(500); button = await clickLabel(OPEN_LABEL) }
      console.log('        clicked the expand control: ' + (button === null ? 'NOT FOUND (label ' + JSON.stringify(OPEN_LABEL) + ')' : JSON.stringify(button)))
    })
    const opening = openingSample.frames
    const leaseAtExpand = leaseNow
    await waitFor(async () => { const c = (await columnNow())?.column; return c !== null && c.w >= MIN_COLUMN }, 15000, 'the column to expand again')
    await waitFor(async () => { const report = await panelReport(); return report !== null && report.exists === true }, 10000, 'the host to open the panel again')
    const afterExpand = await panelReport()
    const columnAfterExpand = (await columnNow())?.column ?? null
    const restored = (await columnNow())?.column ?? null
    console.log('  after the expand: panel exists=' + String(afterExpand && afterExpand.exists) + ' | column=' + JSON.stringify(columnAfterExpand))
    const believedOpen = beforeCollapse !== null && beforeCollapse.exists === true
    const verdict = judgeWorld({
      anchor: anchorAtEntry,
      confirmations,
      ctx: { panelRectDevice, controlPresentAfter },
      collapse: { what: 'collapse (the panel being closed by the product)', frames: closing, clickedAt: closingSample.clickedAt, expectedDrawnAtStart: believedOpen, lease: leaseAtCollapse, panelRect: reportBox, deadlineMs: DEADLINE },
      expand: { what: 'expand (the panel being opened by the product)', frames: opening, clickedAt: openingSample.clickedAt, expectedDrawnAtStart: false, lease: leaseAtExpand, panelRect: reportBox, deadlineMs: DEADLINE },
      afterCollapse, afterExpand, columnAfterCollapse, columnAfterExpand, restored,
    })
    console.log('  limit: the sampler loops as fast as it can; a tear shorter than one frame interval is still invisible, a black window lasting a whole frame is not')
    console.log('  (reading 0 is the INSTRUMENT precondition, printed with the five product readings; it is what makes them readable, and when it cannot be taken the gate exits 3 instead of judging)')
    for (const row of verdict.rows) printRow(row)
    if (verdict.exit === 3) {
      console.log('  SKIP: this gate did not reach a product verdict for every phase (the named reasons are printed above). Exit 3 is the THIRD state: it is not a report that the product is broken')
      return 3
    }
    const product = verdict.rows.filter((row) => row.instrument !== true)
    const failed = product.filter((row) => row.status === 'red')
    console.log('  ' + product.length + ' readings, ' + (failed.length === 0 ? 'all held' : failed.length + ' failed'))
    return verdict.exit
  } finally {
    await cdp.evaluate(UNMARK).catch(() => null)
    await cdp.evaluate(UNOVERLAY).catch(() => null)
    // Nothing to release: this gate took no lease (see the header). The world it leaves is read back instead.
    await reportLeftWorld()
    cdp.close()
  }
}

// =====================================================================================================================
// --self-attack: the SAME decision core, driven with synthetic worlds. Each mutant declares the exact set of readings it
// must move - no more (an over-triggering judge is as useless as a blind one) and no less. The live probe is NOT
// exercised here: this attacks what decides, which is where R182-G's two debts lived.
// =====================================================================================================================
const sfFrame = (t, over) => ({ frame: 0, t, at: 1000 + t, printed: true, wholeGreen: 0.85, wholeBlack: 0, wholeBlackOutsidePanel: 0, insideGreen: 0.7, insideBlack: 0, outsideGreen: 1, outsideBlack: 0, mark: '255,0,255', ...over })
const sfSeries = (greens) => Object.keys(greens).map((t) => sfFrame(Number(t), { wholeGreen: greens[t] }))
const SF_CLOSING = { 0: 0.85, 100: 0.85, 200: 0.85, 300: 0.85, 400: 0.92, 500: 0.98, 600: 1, 700: 1, 800: 1 }
const SF_OPENING = { 0: 1, 100: 1, 200: 1, 300: 1, 400: 0.94, 500: 0.88, 600: 0.85, 700: 0.85, 800: 0.85 }
const SF_CONFIRM = (over) => ({
  attempt: 1, frames: 5, markFrames: 5, drawnFrames: 5, wholeGreen: [0.85, 0.85],
  anchorSurface: { x: 804, y: 86, w: 612, h: 790 }, anchorOnScreen: true, panelExists: true,
  panelBounds: { x: 1206, y: 453, w: 918, h: 574 },
  last: { t: 200, wholeGreen: 0.85, outsideGreen: 1, printed: true, mark: '255,0,255' },
  stateKey: 'anchor 804,86,612,790 | exists true,true | bounds 1206,453,918,574', held: true, why: 'held',
  ...over,
})
const SF_CLICK = 1300
const HONEST = () => ({
  anchor: {
    url: 'synthetic://the-screen-through-a-user-eyes', surfaceCount: 1, surface: { x: 804, y: 86, w: 612, h: 790 },
    display: 'block', visibility: 'visible', opacity: '1', viewport: [1440, 900], onScreen: true,
    column: { x: 791, y: 36, w: 637, h: 852 }, host: { open: true, url: 'synthetic://panel-start', last: '804,86,612,790', placed: '804,86,612,790' },
  },
  confirmations: [SF_CONFIRM({ attempt: 1 }), SF_CONFIRM({ attempt: 2 })],
  ctx: { panelRectDevice: { x: 1206, y: 129, w: 918, h: 1167 }, controlPresentAfter: true },
  collapse: { what: 'collapse (the panel being closed by the product)', frames: sfSeries(SF_CLOSING), clickedAt: SF_CLICK, expectedDrawnAtStart: true, lease: { held: false, holder: null }, panelRect: { x: 1206, y: 453, w: 918, h: 574 }, deadlineMs: 4200 },
  expand: { what: 'expand (the panel being opened by the product)', frames: sfSeries(SF_OPENING), clickedAt: SF_CLICK, expectedDrawnAtStart: false, lease: { held: false, holder: null }, panelRect: { x: 1206, y: 453, w: 918, h: 574 }, deadlineMs: 4200 },
  afterCollapse: { exists: false }, afterExpand: { exists: true },
  columnAfterCollapse: { w: 0 }, columnAfterExpand: { w: 397 }, restored: { w: 397 },
})
const sfMutate = (base, patch) => ({ ...base, ...patch })
const sfPhase = (base, key, patch) => ({ ...base, [key]: { ...base[key], ...patch } })

const selfAttack = () => {
  let failures = 0
  let worlds = 0
  const run = (name, world, declared) => {
    worlds += 1
    const verdict = judgeWorld(world)
    const observedNotMeasured = verdict.rows.filter((row) => row.status === 'not-measured').map((row) => row.id).sort()
    const observedRed = verdict.rows.filter((row) => row.status === 'red').map((row) => row.id).sort()
    const wantNotMeasured = declared.notMeasured.slice().sort()
    const wantRed = declared.red.slice().sort()
    const same = observedNotMeasured.join(',') === wantNotMeasured.join(',') && observedRed.join(',') === wantRed.join(',')
    const exitWanted = wantNotMeasured.length > 0 ? 3 : (wantRed.length > 0 ? 1 : 0)
    const precise = same && verdict.exit === exitWanted
    if (precise === false) {
      failures += 1
      console.log('        the rows this world produced: ' + verdict.rows.map((row) => row.id + '=' + row.status).join(' ') + ' exit=' + String(verdict.exit))
    }
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + name + ': notMeasured=' + show(observedNotMeasured) + ' red=' + show(observedRed) + ' exit=' + String(verdict.exit) + ' | declared notMeasured=' + show(wantNotMeasured) + ' red=' + show(wantRed) + ' exit=' + String(exitWanted))
  }
  const honest = HONEST()
  const baseline = judgeWorld(honest)
  worlds += 1
  const baselineBroken = baseline.rows.filter((row) => row.status !== 'ok').map((row) => row.id)
  if (baselineBroken.length > 0 || baseline.exit !== 0) failures += 1
  console.log('  ' + (baselineBroken.length === 0 && baseline.exit === 0 ? 'ok  ' : 'FAIL') + '  baseline. the labelled SYNTHETIC fixed world judged honestly is green: ' + baseline.rows.map((row) => row.id + '=' + row.status).join(' ') + ' exit=' + String(baseline.exit))
  console.log('          (SYNTHETIC, not the app: this exercises the decision core, never the live probe.)')
  // ---- the anchor (reading pre-anchor): the world R182-G's first two runs were actually in ----
  run('the R182-G first-run world: the rail left on 终端, no [data-dsh-link-surface] at all', sfMutate(honest, { anchor: { ...honest.anchor, surfaceCount: 0, surface: null, onScreen: null } }), { notMeasured: ['pre-anchor'], red: [] })
  run('a pane parked at 0x0 (DSH parks an inactive pane body there, panel_host.js:12)', sfMutate(honest, { anchor: { ...honest.anchor, surface: { x: 0, y: 0, w: 0, h: 0 }, onScreen: false } }), { notMeasured: ['pre-anchor'], red: [] })
  run('a declared surface the page hides (display:none, panel_host.js:62)', sfMutate(honest, { anchor: { ...honest.anchor, display: 'none' } }), { notMeasured: ['pre-anchor'], red: [] })
  // ---- the confirmation (reading 0): the world must be seen live BEFORE any product verdict ----
  run('R182-G third run: the shell reports the panel open while no frame shows it drawn', sfMutate(honest, { confirmations: [SF_CONFIRM({ drawnFrames: 0, held: false, wholeGreen: [0.95, 1], last: { t: 200, wholeGreen: 1, outsideGreen: 1, printed: true, mark: '255,0,255' }, why: 'the freshest frame does not show the panel drawn (wholeGreen=[0.95,1], ceiling 0.9)' })] }), { notMeasured: ['0-anchor-panel-in-one-read'], red: [] })
  run('frames older than the liveness marker (stale captures of a repainting window)', sfMutate(honest, { confirmations: [SF_CONFIRM({ markFrames: 0, held: false, why: '5 of 5 frames do not carry the liveness marker' })] }), { notMeasured: ['0-anchor-panel-in-one-read'], red: [] })
  run('a collapsed rail: the marker is still declared but the anchor is not on screen', sfMutate(honest, { confirmations: [SF_CONFIRM({ anchorOnScreen: false, held: false, why: 'the page does not have [data-dsh-link-surface="true"] on screen' })] }), { notMeasured: ['0-anchor-panel-in-one-read'], red: [] })
  run('the shell reports no panel during the confirmation window', sfMutate(honest, { confirmations: [SF_CONFIRM({ panelExists: false, held: false, why: 'the shell does not report a panel' })] }), { notMeasured: ['0-anchor-panel-in-one-read'], red: [] })
  run('two consecutive confirmation reads that disagree (the panel moved between them)', sfMutate(honest, { confirmations: [SF_CONFIRM({ attempt: 1 }), SF_CONFIRM({ attempt: 2, stateKey: 'anchor 804,86,612,790 | exists true,true | bounds 1206,500,918,574' })] }), { notMeasured: ['0-anchor-panel-in-one-read'], red: [] })
  run('a confirmation that never got a second read (one window only)', sfMutate(honest, { confirmations: [SF_CONFIRM({ attempt: 1 })] }), { notMeasured: ['0-anchor-panel-in-one-read'], red: [] })
  // ---- the product verdicts: an anchor in place and a product that does not move the panel must still RED ----
  run('the counter-evidence shape: closed on collapse, NOT reopened on expand (anchor on screen)', sfMutate(honest, { ...sfPhase(honest, 'expand', { frames: sfSeries(Object.fromEntries(Object.keys(SF_OPENING).map((t) => [t, 1]))) }), afterExpand: { exists: false } }), { notMeasured: [], red: ['2-expand-no-black', '4-expand-opened-it'] })
  run('the product never moves the panel at all (both phases flat while the anchor is on screen)', sfMutate(honest, { collapse: { ...honest.collapse, frames: sfSeries(Object.fromEntries(Object.keys(SF_CLOSING).map((t) => [t, 0.85]))) }, expand: { ...honest.expand, frames: sfSeries(Object.fromEntries(Object.keys(SF_OPENING).map((t) => [t, 0.85]))) }, afterCollapse: { exists: true } }), { notMeasured: [], red: ['1-collapse-no-black', '2-expand-no-black', '3-collapse-closed-it'] })
  run('the window really goes black beside the panel during the collapse', sfMutate(honest, { ...sfPhase(honest, 'collapse', { frames: sfSeries(SF_CLOSING).map((f) => f.t >= 400 && f.t <= 500 ? { ...f, wholeBlack: 0.4, wholeBlackOutsidePanel: 0.4, outsideGreen: 0.1 } : f) }) }), { notMeasured: [], red: ['1-collapse-no-black'] })
  run('a black void inside the panel screen for three frames during the expand', sfMutate(honest, { ...sfPhase(honest, 'expand', { frames: sfSeries(SF_OPENING).map((f) => f.t >= 400 && f.t <= 600 ? { ...f, insideBlack: 0.9 } : f) }) }), { notMeasured: [], red: ['2-expand-no-black'] })
  run('a single-frame void inside the panel screen (below the 2-frame floor: reported, not judged)', sfMutate(honest, { ...sfPhase(honest, 'expand', { frames: sfSeries(SF_OPENING).map((f) => f.t === 400 ? { ...f, insideBlack: 0.9 } : f) }) }), { notMeasured: [], red: [] })
  run('the column left collapsed at the end', sfMutate(honest, { restored: { w: 0 } }), { notMeasured: [], red: ['5-column-restored'] })
  // ---- the refusals: instrument evidence gets a name, never a product verdict, and never within a phase only ----
  run('the control overlay gone from the collapse frames while nothing is black (stale captures)', sfMutate(honest, { ...sfPhase(honest, 'collapse', { frames: sfSeries(SF_CLOSING).map((f) => ({ ...f, outsideGreen: 0.1 })) }) }), { notMeasured: ['1-collapse-no-black', '3-collapse-closed-it'], red: [] })
  run('the page reloads mid-run: the control overlay is gone from the FIRST frame (and that frame went black)', sfMutate(honest, { ...sfPhase(honest, 'collapse', { frames: sfSeries(SF_CLOSING).map((f, index) => index === 0 ? { ...f, outsideGreen: 0.1, wholeBlack: 0.4, wholeBlackOutsidePanel: 0.4 } : f) }) }), { notMeasured: ['1-collapse-no-black', '3-collapse-closed-it'], red: [] })
  run('a sampler that returns no frames at all', sfMutate(honest, { ...sfPhase(honest, 'collapse', { frames: [] }) }), { notMeasured: ['1-collapse-no-black', '3-collapse-closed-it'], red: [] })
  run('R182-G third run inside a phase: the shell says open, the frames before the click never show it drawn', sfMutate(honest, { ...sfPhase(honest, 'collapse', { frames: sfSeries(SF_CLOSING).map((f) => f.at < SF_CLICK ? { ...f, wholeGreen: 0.95 } : f) }) }), { notMeasured: ['1-collapse-no-black', '3-collapse-closed-it'], red: [] })
  run('PrintWindow refused every frame of the expand phase', sfMutate(honest, { ...sfPhase(honest, 'expand', { frames: sfSeries(SF_OPENING).map((f) => ({ ...f, printed: false })) }) }), { notMeasured: ['2-expand-no-black', '4-expand-opened-it'], red: [] })
  const exit = failures === 0 ? 0 : 1
  console.log('  ' + (failures === 0 ? 'ok  ' : 'FAIL') + '  ' + String(worlds - failures) + ' of ' + String(worlds) + ' synthetic worlds moved exactly the readings they declared')
  return exit
}

process.exitCode = SELF_ATTACK ? selfAttack() : await main()
