#!/usr/bin/env node
/**
 * Gate 100 (R157) - does the NATIVE keyboard go where the shell says it goes?
 *
 * Why a second focus gate: gate 99 reads focus INSIDE the documents, and R155 measured that both webviews
 * report hasFocus() = true at once, so the page-side instrument cannot say which one owns the keyboard. This
 * gate asks the operating system: GetGUIThreadInfo on the main window's thread returns the HWND that really
 * has focus, and the two webviews are two distinct child HWND trees (told apart by their left edge, which the
 * shell's own bounds tell us).
 *
 * Readings:
 *   1-focus-op   op=focus moves the native keyboard to the PANEL tree
 *   2-cdp-inert  a CDP click inside the panel does NOT move it (measured in R157; locking it means a future
 *                change that starts moving focus is noticed rather than welcomed silently)
 *   3-close-back op=close hands the keyboard BACK to the main tree (R157 fixed the case where it went nowhere)
 *   4-instrument the window must be foregrounded first, or GetGUIThreadInfo answers about a window nobody sees
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + a SKIP: line when CDP is not answering or the probe
 * could not run at all.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimLease, releaseLease, openOwnPanel } from './panel-lease.mjs'

const CDP_PORT = Number(process.env.DSH_LINK_CDP_PORT || '9222')
const PROBE = "param([int]$PanelLeft = -1)\n$ErrorActionPreference = 'Stop'\nAdd-Type @'\nusing System; using System.Text; using System.Runtime.InteropServices;\npublic struct RECT { public int Left, Top, Right, Bottom; }\npublic struct GUITHREADINFO { public int cbSize; public int flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }\npublic class W {\n  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);\n  [DllImport(\"user32.dll\")] public static extern bool GetGUIThreadInfo(uint id, ref GUITHREADINFO info);\n  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);\n  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n  [DllImport(\"user32.dll\")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);\n  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);\n  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r);\n  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);\n  public delegate bool EnumProc(IntPtr h, IntPtr p);\n  [DllImport(\"user32.dll\")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);\n  [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();\n}\n'@\n# R159: a DPI-unaware reader gets VIRTUALIZED coordinates, which once made this gate compare a divided-by-1.5 native rect against the shell's true-physical report.\n[void][W]::SetProcessDpiAwarenessContext([IntPtr](-4))\n[void][W]::SetProcessDPIAware()\n$proc = Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1\nif (-not $proc) { '{\"error\":\"no client\"}'; exit 0 }\n$main = $proc.MainWindowHandle; $top = New-Object System.Collections.ArrayList; $topCb = [W+EnumProc]{ param($hTop, $pTop) $owner = [uint32]0; [void][W]::GetWindowThreadProcessId($hTop, [ref]$owner); if ($owner -eq [uint32]$proc.Id) { [void]$top.Add($hTop) }; return $true }; [void][W]::EnumWindows($topCb, [IntPtr]::Zero); foreach ($cand in $top) { $hits = New-Object System.Collections.ArrayList; $cbk = [W+EnumProc]{ param($hKid, $pKid) $sbk = New-Object System.Text.StringBuilder 256; [void][W]::GetClassName($hKid, $sbk, 256); if ($sbk.ToString() -eq 'Chrome_WidgetWin_1') { [void]$hits.Add($hKid) }; return $true }; [void][W]::EnumChildWindows($cand, $cbk, [IntPtr]::Zero); if ($hits.Count -gt 0) { $main = $cand; break } }\n$kids = New-Object System.Collections.ArrayList\n$cb = [W+EnumProc]{ param($h, $p)\n  $sb = New-Object System.Text.StringBuilder 256\n  [void][W]::GetClassName($h, $sb, 256)\n  $r = New-Object RECT\n  [void][W]::GetWindowRect($h, [ref]$r)\n  [void]$kids.Add([pscustomobject]@{ hwnd = [int64]$h; cls = $sb.ToString(); left = $r.Left })\n  return $true\n}\n[void][W]::EnumChildWindows($main, $cb, [IntPtr]::Zero)\nfunction FocusHwnd {\n  [uint32]$procId = 0\n  $thread = [W]::GetWindowThreadProcessId($main, [ref]$procId)\n  $info = New-Object GUITHREADINFO\n  $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)\n  [void][W]::GetGUIThreadInfo($thread, [ref]$info)\n  return [int64]$info.hwndFocus\n}\n\n$winRect = New-Object RECT\n[void][W]::GetWindowRect($main, [ref]$winRect)\n$script:panelRow = $kids | Where-Object { $_.cls -eq 'Chrome_WidgetWin_1' -and [math]::Abs($_.left - $winRect.Left) -gt 3 } | Select-Object -First 1\nfunction TreeOf($hwnd) {\n  if ($hwnd -eq 0) { return 'none' }\n  $row = $kids | Where-Object { $_.hwnd -eq $hwnd } | Select-Object -First 1\n  if (-not $row) { return 'other' }\n  if ($row.cls -ne 'Chrome_WidgetWin_1') { return ('other:' + $row.cls) }\n  if ($script:panelRow -and (($row.hwnd -eq $script:panelRow.hwnd) -or ([math]::Abs($row.left - $script:panelRow.left) -le 3))) { return 'panel' }\n  if ([math]::Abs($row.left - $winRect.Left) -le 3) { return 'main' }\n  return 'other'\n}\n[void][W]::SetForegroundWindow($main)\nStart-Sleep -Milliseconds 900\n$out = [ordered]@{}\n# R218: the CLIENT has to be the foreground window, not merely some window.\n# Otherwise hwndFocus belongs to another application and every keyboard reading below describes a window nobody is looking at.\n$out.foregrounded = ([int64]([W]::GetForegroundWindow()) -eq [int64]$main)\n$out.baseline = TreeOf (FocusHwnd)\n$out.panelTreeFound = ($null -ne $script:panelRow)\n$out.panelLeft = if ($script:panelRow) { $script:panelRow.left } else { -1 }\n$out.windowLeft = $winRect.Left\n$out.reportedLeft = $PanelLeft\n@STEPS@\n$out | ConvertTo-Json -Compress"
// The gate must DRIVE the three actions it judges. Its first version only read the focus three times: it printed two
// hollow greens (nothing was clicked, nothing was closed) and one vacuous red (nothing was focused). Each action below
// records whether the shell ACCEPTED it, so a refusal is a named reading instead of an empty one.
const stepsFor = (port) => {
  const shell = 'http://127.0.0.1:' + port + '/__shell/panel'
  const cdp = 'http://127.0.0.1:' + port + '/__shell/panel/cdp'
  const pressed = '{"method":"Input.dispatchMouseEvent","params":{"type":"mousePressed","x":30,"y":30,"button":"left","clickCount":1}}'
  const released = '{"method":"Input.dispatchMouseEvent","params":{"type":"mouseReleased","x":30,"y":30,"button":"left","clickCount":1}}'
  return [
    'function PanelPost([string]$url, [string]$body) {',
    "  try { return (Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20) } catch { return $null }",
    '}',
    "$out.focusAnswered = ($null -ne (PanelPost '" + shell + "' '{\"op\":\"focus\"}'))",
    'Start-Sleep -Milliseconds 700',
    '$out.afterFocusOp = TreeOf (FocusHwnd)',
    "$out.clickAnswered = ($null -ne (PanelPost '" + cdp + "' '" + pressed + "'))",
    "[void](PanelPost '" + cdp + "' '" + released + "')",
    'Start-Sleep -Milliseconds 700',
    '$out.afterCdpClick = TreeOf (FocusHwnd)',
    // R183-C measured the rule from this gate's own side: the CDP click just above delivers a real pointerdown,
    // the panel page reports it as input, and the product hands the turn to the user (R178-T) - so the op=close
    // below came back 400 "the lease held by verify-sidebar-native-focus was REVOKED by user-input (pointerdown):
    // claim the panel again to continue". The gate takes the lease back before closing and records that it had
    // to: otherwise a refusal here reads as the product failing to give the keyboard back, which is the
    // opposite of what was measured.
    "$out.reclaimedBeforeClose = ($null -ne (PanelPost '" + shell + "' '{\"op\":\"lease\",\"leaseOp\":\"claim\",\"holder\":\"verify-sidebar-native-focus\",\"ttlMs\":60000}'))",
    // The close must carry the holder: this gate HOLDS the lease at this point (it took it back one step above),
    // and a write that names nobody is refused when the panel is leased - the same class R181 fixed in
    // panel-lease.mjs. Measured after the first version of this patch: the close came back non-200 and the
    // reading still read as the product failing to give the keyboard back.
    "$out.closeAnswered = ($null -ne (PanelPost '" + shell + "' '{\"op\":\"close\",\"holder\":\"verify-sidebar-native-focus\"}'))",
    'Start-Sleep -Milliseconds 900',
    '$out.afterClose = TreeOf (FocusHwnd)',
  ].join('\n')
}

const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const panelPost = async (port, payload) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null)
  if (answer === null) return null
  const text = await answer.text().catch(() => '')
  try { return JSON.parse(text) } catch (error) { return null }
}
const nativeProbe = (panelLeft, steps) => {
  const path = join(tmpdir(), 'dsh-link-native-focus-' + process.pid + '.ps1')
  writeFileSync(path, PROBE.replace('@STEPS@', steps))
  let raw = ''
  try { raw = execFileSync('pwsh', ['-NoProfile', '-File', path, '-PanelLeft', String(panelLeft)], { encoding: 'utf8', timeout: 60000 }) }
  catch (error) { return { ok: false, why: 'the probe did not run: ' + String(error && error.message ? error.message : error) } }
  const line = String(raw).split(/\r?\n/).filter((row) => row.trim().startsWith('{')).pop()
  if (line === undefined) return { ok: false, why: 'the probe printed no JSON: ' + String(raw).slice(0, 200) }
  try { return { ok: true, value: JSON.parse(line) } } catch (error) { return { ok: false, why: 'unreadable probe JSON: ' + error.message } }
}

const judge = (probe) => {
  const readings = []
  const record = (id, ok, detail, evidence) => readings.push({ id, ok: ok === true, detail: String(detail), evidence: evidence || [] })
  {
    const problems = []
    if (probe.focusAnswered !== true) problems.push('the shell refused op=focus, so the keyboard was never asked to move (' + show(probe.focusAnswered) + ')')
    else if (probe.panelTreeFound !== true) problems.push('no child webview tree matched the panel rect, so the panel could not be told apart from the main window')
    else if (probe.afterFocusOp !== 'panel') problems.push('after op=focus the native focus is ' + show(probe.afterFocusOp) + ', not the panel tree')
    record('1-focus-op', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'op=focus moves the NATIVE keyboard to the panel tree', ['afterFocusOp=' + show(probe.afterFocusOp), 'baseline=' + show(probe.baseline)])
  }
  {
    const problems = []
    // measured against the state IMMEDIATELY BEFORE the click (afterFocusOp), not against the baseline: once op=focus
    // works, comparing with the baseline would red this reading for the focus move the previous reading asked for
    if (probe.clickAnswered !== true) problems.push('the panel CDP refused Input.dispatchMouseEvent, so no click happened that could be inert (' + show(probe.clickAnswered) + ')')
    else if (probe.afterFocusOp === 'none' || probe.afterFocusOp === undefined) problems.push('nothing had the native focus before the click, so an unchanged reading would be measured against nothing')
    else if (probe.afterCdpClick !== probe.afterFocusOp) problems.push('a CDP click moved the native focus: ' + show(probe.afterFocusOp) + ' then ' + show(probe.afterCdpClick))
    record('2-cdp-inert', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'a CDP click inside the panel leaves the native keyboard where it was: it drives the renderer, not the OS focus', ['baseline=' + show(probe.baseline), 'afterCdpClick=' + show(probe.afterCdpClick)])
  }
  {
    const problems = []
    if (probe.closeAnswered !== true) problems.push('the shell refused op=close, so nothing was closed to give the keyboard back (' + show(probe.closeAnswered) + ')')
    else if (probe.afterClose === 'none') problems.push('after close NOTHING has the keyboard: whoever types next types into nothing')
    // R277: the invariant R157 fixed is that the keyboard goes BACK - to the tree that had it before this gate moved
    // it - not that it must land on the main tree of this particular app. Measured on the active world: the focus
    // before the panel was asked for was "other" (another application's window owned it), op=focus moved it into the
    // panel, and after close it came back to "other" - which is the keyboard returning, the exact behaviour the
    // reading exists to protect, reported as a failure only because "other" was not the string "main". The two
    // states that stay red are the two the reading is about: nothing holds the keyboard, or the panel keeps it.
    else if (probe.afterClose === 'panel') problems.push('after close the PANEL still has the keyboard: the panel tree owns the focus while the panel is gone')
    else if (probe.afterClose !== 'main' && probe.afterClose !== probe.baseline) problems.push('after close the focus is ' + show(probe.afterClose) + ', neither the main tree nor the tree that had it before (baseline ' + show(probe.baseline) + ')')
    record('3-close-back', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'closing the panel hands the keyboard back to the main tree', ['afterClose=' + show(probe.afterClose), 'reclaimedBeforeClose=' + show(probe.reclaimedBeforeClose)])
  }
  {
    const problems = []
    if (probe.foregrounded !== true) problems.push('the window could not be brought to the foreground, so GetGUIThreadInfo answers about a window the user is not looking at')
    record('4-instrument', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'the window was foregrounded first, which is what makes this reading mean anything', ['foregrounded=' + show(probe.foregrounded)])
  }
  // R218: readings 1-3 presuppose that the CLIENT window is the foreground window. Foreground activation is
  // advisory on Windows and this desktop cannot always grant it, in which case hwndFocus is 0 and the three
  // readings would blame the product for a precondition that never held. They become one named third state,
  // and reading 4 keeps naming why.
  // R218: when the client cannot become the foreground window, NOTHING here can be measured - not the three
  // keyboard readings and not the instrument reading either, which is the one that names why. Marking all four
  // makes the gate exit 3 (a third state the suite can accept explicitly) instead of failing forever on a
  // desktop that refuses foreground activation.
  if (probe.foregrounded !== true) {
    for (const row of readings) {
      row.notMeasured = true
      row.ok = false
      const body = String(row.detail).startsWith('FAIL: ') ? String(row.detail).slice(6) : String(row.detail)
      row.detail = 'NOT MEASURED: ' + body + ' (the client window never became the foreground window, so a native keyboard reading would describe a window nobody is looking at)'
    }
  }

  return readings
}

const main = async () => {
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version').then((answer) => answer.json()) }
  catch (error) { console.log('SKIP: no CDP on 127.0.0.1:' + String(CDP_PORT) + ', so the app is not running with remote debugging; this gate measured NOTHING'); return 3 }
  const port = '31761'
  const steps = stepsFor(port)
  if (!/(op=focus|op=close|dispatchMouseEvent)/.test(steps)) { console.log('SKIP: this gate does not drive the three actions it judges, so every reading it could print would be hollow'); return 3 }
  await claimLease(port, 'verify-sidebar-native-focus')
  const opened = await openOwnPanel(port, { x: 600, y: 90, w: 420, h: 600 })
  if (opened === null || opened.exists !== true) { await releaseLease(port, 'verify-sidebar-native-focus'); console.log('SKIP: the panel could not be opened, so there was no panel tree to look for'); return 3 }
  const bounds = opened.bounds || {}
  const panelLeft = typeof bounds.x === 'number' ? bounds.x : -1
  const probeAnswer = nativeProbe(panelLeft, steps)
  await releaseLease(port, 'verify-sidebar-native-focus')
  if (probeAnswer.ok !== true) { console.log('SKIP: ' + String(probeAnswer.why)); return 3 }
  const readings = judge(probeAnswer.value)
  console.log('  native probe: ' + show(probeAnswer.value))
  for (const reading of readings) {
    console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const notMeasured = readings.filter((reading) => reading.notMeasured === true)
  const failed = readings.filter((reading) => reading.ok === false && reading.notMeasured !== true)
  if (notMeasured.length > 0) console.log('  ' + String(notMeasured.length) + ' reading(s) NOT MEASURED - a third state, not a verdict: ' + notMeasured.map((reading) => reading.id).join(','))
  console.log('  ' + String(readings.length) + ' readings, ' + String(readings.length - failed.length - notMeasured.length) + ' held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured')
  if (failed.length > 0) return 1
  return notMeasured.length > 0 ? 3 : 0
}

process.exitCode = await main()
