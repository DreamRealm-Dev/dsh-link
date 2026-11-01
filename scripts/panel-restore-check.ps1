<#
  R393 - does the native browser panel survive a minimise + restore?

  Why this replaces scripts/panel-restore-check.mjs: that observer compared op=state bounds with surface, but the
  shell derives bounds FROM the stored surface (sidebar_panel.rs), so the two are the same string whenever a surface
  exists - the comparison could not fail - and the window size it read (geometry.window / clientSize) is not a field
  op=state reports, so its own FAIL branch was unreachable. A gate that cannot fail is not a measurement.

  This one reads the real numbers: op=state chromeBounds (physical pixels, what the shell actually set on the child
  webview), each tab bounds, and the window client rect from Win32 with the process made DPI-aware.

  Exit 0 the panel is the right size after the restore | 1 it is not | 3 the precondition is absent (no pane open).
#>
# Usage:
#   pwsh -File scripts/panel-restore-check.ps1                     # check against the default port
#   pwsh -File scripts/panel-restore-check.ps1 -Port 31761         # same, spelled out
# Exit 0 the panel kept its geometry across the restore, 1 it did not, 3 the precondition is absent (no pane open).
param([int]$Port = 31761)
$ErrorActionPreference = 'Continue'
function State {
  try {
    $body = '{"op":"state"}'
    $raw = (Invoke-WebRequest -UseBasicParsing ("http://127.0.0.1:" + $Port + "/__shell/panel") -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 10).Content
    return $raw | ConvertFrom-Json
  } catch { return $null }
}
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RestoreWin2 {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
}
"@ -ErrorAction SilentlyContinue
[void][RestoreWin2]::SetProcessDpiAwarenessContext([IntPtr](-4))
$proc = Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output 'SKIP: dsh-link is not running'; exit 3 }
$found = [IntPtr]::Zero
[void][RestoreWin2]::EnumWindows({ param($h, $l)
  $q = [uint32]0
  [void][RestoreWin2]::GetWindowThreadProcessId($h, [ref]$q)
  if ($q -eq [uint32]$proc.Id) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][RestoreWin2]::GetClassNameW($h, $sb, 256)
    if ($sb.ToString() -eq 'Tauri Window') { $script:found = $h; return $false }
  }
  return $true }, [IntPtr]::Zero) | Out-Null
if ($found -eq [IntPtr]::Zero) { Write-Output 'SKIP: the main window was not found'; exit 3 }
$rect = New-Object RestoreWin2+RECT
[void][RestoreWin2]::GetClientRect($found, [ref]$rect)
$clientW = $rect.R - $rect.L
$clientH = $rect.B - $rect.T
Write-Output ('window client (physical): ' + $clientW + 'x' + $clientH)
$before = State
if ($null -eq $before -or $before.exists -ne $true) { Write-Output 'SKIP: no panel is open, so a restore cannot be judged (open the browser pane first)'; exit 3 }
Write-Output ('chrome before: ' + ($before.chromeBounds | ConvertTo-Json -Compress))
[void][RestoreWin2]::ShowWindow($found, 6)
Start-Sleep -Seconds 3
[void][RestoreWin2]::ShowWindow($found, 9)
Start-Sleep -Seconds 3
$after = State
if ($null -eq $after -or $after.exists -ne $true) { Write-Output 'FAIL: the panel did not come back after the restore'; exit 1 }
$chrome = $after.chromeBounds
$tab = @($after.tabs) | Where-Object { $_.active -eq $true } | Select-Object -First 1
Write-Output ('chrome after : ' + ($chrome | ConvertTo-Json -Compress))
Write-Output ('active tab   : ' + ($tab.bounds | ConvertTo-Json -Compress) + '  screenPane=' + ($after.screenPane | ConvertTo-Json -Compress))
Write-Output ('deck pane    : ' + ($after.deckPane | ConvertTo-Json -Compress))
$bad = @()
if ($null -eq $chrome) { $bad += 'chromeBounds is null after the restore' }
elseif ([double]$chrome.w -ge ($clientW - 4)) { $bad += ('chrome width ' + $chrome.w + ' fills the client width ' + $clientW) }
if ($null -eq $tab) { $bad += 'no active tab after the restore' }
if ($null -ne $chrome -and $null -ne $after.deckPane) {
  # chromeBounds is PHYSICAL and the pane rects are LOGICAL: compare in one unit (R394 measured them 1.5x apart on a
  # 150% display, which is the display's scale factor, not a geometry bug).
  # The DPR is CALIBRATED from the state itself: the active tab and screenPane describe the same content area, one in
  # physical and one in logical units ("scale" in this report is the PAGE zoom, measured 0.4781 here, not the DPR).
  $dpr = if ($tab -ne $null -and $after.screenPane -ne $null -and [double]$after.screenPane.w -gt 0) { [double]$tab.bounds.w / [double]$after.screenPane.w } else { 1.0 }
  $chromeLogical = [double]$chrome.w / $dpr
  $gap = [Math]::Abs($chromeLogical - [double]$after.deckPane.w)
  if ($gap -gt 2) { $bad += ('chrome width ' + $chromeLogical + ' logical (' + $chrome.w + ' physical / dpr ' + $dpr + ') disagrees with the deck pane ' + $after.deckPane.w) }
}
# R394: the regression signal is the CHANGE across the restore. Comparing the panel with the deck cannot catch it,
# because the deck itself grows with the panel (measured: deck 612 -> 1415 logical, chrome 918 -> 2123 physical), so a
# minimise+restore that changes the geometry must fail even when both numbers still agree with each other.
if ($null -ne $before.chromeBounds -and $null -ne $chrome) {
  $grew = [Math]::Abs([double]$chrome.w - [double]$before.chromeBounds.w)
  if ($grew -gt 4) { $bad += ('the panel changed width across the restore: ' + $before.chromeBounds.w + ' -> ' + $chrome.w + ' physical') }
}
if ($bad.Count -gt 0) { foreach ($row in $bad) { Write-Output ('FAIL: ' + $row) }; exit 1 }
Write-Output ('PASS: the panel kept the deck geometry across the restore (chrome ' + $chrome.w + 'x' + $chrome.h + ' inside a ' + $clientW + 'x' + $clientH + ' client)')
exit 0
