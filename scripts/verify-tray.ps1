# Tray regression check: closing the window must hide it, not quit the process.
#
# Launch the shell, wait for its main window, assert it is visible, send WM_CLOSE,
# then assert the process is STILL RUNNING and the window is hidden. Exits 1 with
# a named failure if the shell quits with its window (the bug this guards).
param(
  [string]$Exe = "$PSScriptRoot\..\src-tauri\target\debug\dsh-link.exe",
  [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static List<IntPtr> TopLevel() {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => { found.Add(h); return true; }, IntPtr.Zero);
    return found;
  }
  public static string Title(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }
  public static uint Owner(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }
}
"@

# The shell writes its own diagnostics to stderr; a failure without them is unreadable.
$script:stdoutLog = $null
$script:stderrLog = $null
function Show-Logs {
  foreach ($p in @($script:stdoutLog, $script:stderrLog)) {
    if ($null -eq $p -or -not (Test-Path $p)) { continue }
    $text = Get-Content $p -Raw -ErrorAction SilentlyContinue
    if ($text) { Write-Host "--- $([IO.Path]::GetFileName($p)) ---"; Write-Host $text.Trim() }
  }
}
function Fail([string]$why) { Write-Host "FAIL: $why"; Show-Logs; exit 1 }

if (-not (Test-Path $Exe)) { Fail "no shell binary at $Exe" }
$logDir = Join-Path ([IO.Path]::GetTempPath()) "dsh-link-tray-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $logDir | Out-Null
$script:stdoutLog = Join-Path $logDir 'shell.out.log'
$script:stderrLog = Join-Path $logDir 'shell.err.log'
$proc = Start-Process -FilePath $Exe -PassThru -RedirectStandardError $script:stderrLog -RedirectStandardOutput $script:stdoutLog
Write-Host "launched $($proc.Id): $Exe"

# The window appears once the webview is created; the proxy is up sooner.
$window = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if ($proc.HasExited) { Fail "shell exited during startup (code $($proc.ExitCode))" }
  $window = [Win]::TopLevel() | Where-Object {
    [Win]::Owner($_) -eq $proc.Id -and [Win]::Title($_) -eq 'DSH Link'
  } | Select-Object -First 1
  if ($window) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $window) { Fail "no 'DSH Link' window for pid $($proc.Id) within $TimeoutSeconds seconds" }
if (-not [Win]::IsWindowVisible($window)) { Fail "main window exists but is not visible" }
Write-Host "window handle 0x$($window.ToString('X')) is visible"

[void][Win]::SendMessageW($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)  # WM_CLOSE
Start-Sleep -Seconds 3

if ($proc.HasExited) { Fail "closing the window quit the shell (exit $($proc.ExitCode)) - it must hide to the tray" }
if ([Win]::IsWindowVisible($window)) { Fail "window is still visible after WM_CLOSE - it must hide" }

Write-Host "PASS: process $($proc.Id) survived WM_CLOSE with its window hidden (tray holds it)"
Show-Logs
Stop-Process -Id $proc.Id -Force
# A force-kill skips the supervisor's own shutdown, so the kernel child it started would
# outlive this check and hold the kernel port for the next run. The tray's Quit path
# stops it properly; this is only the cleanup for the harness.
Start-Sleep -Milliseconds 500
Get-NetTCPConnection -LocalPort 31760 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
exit 0
