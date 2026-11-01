<#
  Close DSH-LINK and open it again, the way the app itself expects to be closed.

  Why this exists: a test fixture resizes the window and a forced kill leaves the tray icon behind (Windows keeps a
  ghost until the pointer passes over it), because killing the process skips the shell's own shutdown - which is what
  drops the tray icon and stops the kernel child. The shell's ONLY graceful exit is the tray's 退出 item, and since
  R385 a script can ask for the same thing:

      dsh-link.exe --quit        -> the running instance quits through its tray path

  So this script asks politely first, and only kills on -Force or after the timeout - warning, when it does, that a
  forced stop is the thing that leaves the tray ghost and the resized window behind.

  The window size itself is not persisted anywhere: boot builds it at 1440x900 with min 960x640, so a restart restores it.
  What DOES persist is the browser pane's page viewport (browser.json: { viewport: {w,h}, mode }); -ResetViewport puts it
  back to the shipped 1280x800 fixed.

  Usage:
    pwsh -File scripts/restart-client.ps1                  # quit (graceful) and start again, CDP on 9222
    pwsh -File scripts/restart-client.ps1 -NoStart          # only close
    pwsh -File scripts/restart-client.ps1 -NoStop           # only start (when nothing is running)
    pwsh -File scripts/restart-client.ps1 -Force            # kill instead of asking (last resort)
    pwsh -File scripts/restart-client.ps1 -ResetViewport    # also rewrite browser.json to 1280x800 fixed
    pwsh -File scripts/restart-client.ps1 -NoCdp            # start WITHOUT the remote debugging port

  Exit 0 the world is in the state asked for | 1 something did not reach it (the reason is printed) | 3 nothing to do.
#>
param(
  [switch]$NoStart,
  [switch]$NoStop,
  [switch]$Force,
  [switch]$ResetViewport,
  [switch]$NoCdp,
  [int]$TimeoutSeconds = 25,
  [int]$ProxyPort = 31761,
  [int]$KernelPort = 31760,
  [int]$CdpPort = 9222,
  [string]$Exe = '<workspace>\\dsh-link\src-tauri\target\debug\dsh-link.exe',
  [string]$LogDir = '<workspace>\\dsh-link\.tmp\restart'
)
$ErrorActionPreference = 'Continue'
$rows = @()
function Say($text) { Write-Output $text; $script:rows += $text }
function Listening([int]$port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0
}
function PidOf([int]$port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $conn) { return 0 }
  return [int]$conn.OwningProcess
}
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RestartWin {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L; public int T; public int RR; public int B; }
}
"@ -ErrorAction SilentlyContinue
function WindowOfProcess([int]$processId) {
  [void][RestartWin]::SetProcessDpiAwarenessContext([IntPtr](-4))
  $script:found = [IntPtr]::Zero
  [void][RestartWin]::EnumWindows([RestartWin+P]{ param($h, $l)
    $q = [uint32]0
    [void][RestartWin]::GetWindowThreadProcessId($h, [ref]$q)
    if ($q -eq [uint32]$processId) {
      $sb = New-Object System.Text.StringBuilder 256
      [void][RestartWin]::GetClassName($h, $sb, 256)
      if ($sb.ToString() -eq 'Tauri Window') { $script:found = $h }
    }
    return $true }, [IntPtr]::Zero)
  if ($script:found -eq [IntPtr]::Zero) { return $null }
  $r = New-Object RestartWin+R
  [void][RestartWin]::GetWindowRect($script:found, [ref]$r)
  return "$($r.RR - $r.L)x$($r.B - $r.T)"
}

if (-not (Test-Path $Exe)) { Say ('FAIL: no shell executable at ' + $Exe); exit 1 }
if (-not $NoStart) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }

# ---------------------------------------------------------------- stop
if (-not $NoStop) {
  $shellPid = PidOf $ProxyPort
  if ($shellPid -eq 0) {
    Say ('stop: nothing is listening on ' + $ProxyPort + ', so there was nothing to close')
  } elseif ($Force) {
    Say ('stop: -Force given, so the shell (pid ' + $shellPid + ') is KILLED - expect a tray ghost until the pointer passes over it')
    Stop-Process -Id $shellPid -Force -ErrorAction SilentlyContinue
  } else {
    Say ('stop: asking the shell (pid ' + $shellPid + ') to quit through its own tray path: ' + $Exe + ' --quit')
    $before = WindowOfProcess $shellPid
    if ($null -ne $before) { Say ('      the window before closing was ' + $before) }
    & $Exe --quit 2>&1 | ForEach-Object { Say ('      ' + $_) }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline -and (Listening $ProxyPort)) { Start-Sleep -Milliseconds 300 }
    if (Listening $ProxyPort) {
      Say ('      it did not quit within ' + $TimeoutSeconds + 's, so it is killed now (a forced stop is what leaves the tray ghost)')
      $shellPid = PidOf $ProxyPort
      if ($shellPid -ne 0) { Stop-Process -Id $shellPid -Force -ErrorAction SilentlyContinue }
    } else {
      Say ('      it quit cleanly; the tray icon went with it and the kernel child was stopped by the shell own run-event half')
    }
  }
  Start-Sleep -Milliseconds 800
  $kernelPid = PidOf $KernelPort
  if ($kernelPid -ne 0) {
    Say ('stop: the kernel (pid ' + $kernelPid + ') outlived the shell - stopping it too')
    Stop-Process -Id $kernelPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
  }
  # webviews of THIS app only: they go when the window goes, but a forced stop can leave one behind
  Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' -and $_.Path -like '*EdgeWebView*' } | Out-Null
  foreach ($port in @($ProxyPort, $KernelPort)) {
    if (Listening $port) { Say ('FAIL: port ' + $port + ' is STILL listening after the stop') }
  }
}

# ---------------------------------------------------------------- optional viewport reset
if ($ResetViewport) {
  $path = Join-Path $env:APPDATA 'dev.dshlink.client\browser.json'
  $body = '{' + [Environment]::NewLine + '  "viewport": {' + [Environment]::NewLine + '    "w": 1280.0,' + [Environment]::NewLine + '    "h": 800.0' + [Environment]::NewLine + '  },' + [Environment]::NewLine + '  "mode": "fixed"' + [Environment]::NewLine + '}' + [Environment]::NewLine
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    Set-Content -Path $path -Value $body -Encoding utf8
    Say ('viewport: browser.json rewritten to 1280x800 fixed at ' + $path)
  } catch {
    Say ('viewport: could not write ' + $path + ': ' + $_.Exception.Message)
  }
}

# ---------------------------------------------------------------- make the tray icon VISIBLE
# Windows 11 files a new tray icon into the overflow flyout and keeps it there ("IsPromoted" unset), so a shell that
# reports "[shell] tray icon ready" can still be invisible to the person looking at the taskbar. The per-app setting
# lives in the registry; this sets it before the app starts so the icon is created promoted.
$notifyRoot = 'HKCU:\Control Panel\NotifyIconSettings'
if (-not (Test-Path $notifyRoot)) { Say 'tray: this Windows has no NotifyIconSettings key, so the icon position is whatever the taskbar settings say' }
if (Test-Path $notifyRoot) {
  $promoted = 0
  Get-ChildItem $notifyRoot -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($null -ne $props -and $props.ExecutablePath -eq $Exe) {
      New-ItemProperty -Path $_.PSPath -Name 'IsPromoted' -Value 1 -PropertyType DWord -Force | Out-Null
      $promoted += 1
    }
  }
  if ($promoted -gt 0) { Say ('tray: promoted ' + $promoted + ' NotifyIconSettings entr(y/ies) for ' + $Exe) }
  else { Say 'tray: no NotifyIconSettings entry yet (Windows writes one the first time the icon appears); start once, then run this again to promote it' }
}

if ($NoStart) { Say 'done: closed only (-NoStart)'; exit 0 }

# ---------------------------------------------------------------- integrity (R389)
# A build run under a low-integrity token leaves the exe labelled Low, and Windows then STARTS it at Low, where
# Shell_NotifyIcon is refused with ERROR_ACCESS_DENIED (UIPI, low -> high): the app runs, the log says the tray is
# there, and no icon ever appears. Measured on this machine: a Low-labelled exe got err=5 every time, and the same
# exe relabelled High got a rect on the first attempt. This matches the level the shell itself runs at.
$label = (& icacls $Exe 2>$null | Select-String "Mandatory Label" | Select-Object -First 1)
if ($null -ne $label -and $label.Line -match "Low Mandatory Level") {
  & icacls $Exe /setintegritylevel High 2>$null | Out-Null
  Say ("integrity: the exe was labelled LOW, which makes the tray impossible - relabelled to High")
}

# ---------------------------------------------------------------- start
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $LogDir ('client-' + $stamp + '.log')
$env:DSH_LINK_WEBVIEW2_ARGS = if ($NoCdp) { '' } else { '--remote-debugging-port=' + $CdpPort }
$env:TEMP = '<workspace>\\.tmp\r179-home\temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
Say ('start: ' + $Exe + ' (CDP ' + $(if ($NoCdp) { 'off' } else { $CdpPort }) + ', log ' + $log + ')')
$proc = Start-Process -FilePath $Exe -PassThru -RedirectStandardError $log -RedirectStandardOutput ($log + '.out') -WindowStyle Normal
$deadline = (Get-Date).AddSeconds([Math]::Max(30, $TimeoutSeconds))
while ((Get-Date) -lt $deadline) {
  if ((Listening $ProxyPort) -and (Listening $KernelPort)) { break }
  Start-Sleep -Milliseconds 400
}
$ok = (Listening $ProxyPort) -and (Listening $KernelPort)
if (-not $ok) {
  Say ('FAIL: the shell did not come up (proxy=' + (Listening $ProxyPort) + ' kernel=' + (Listening $KernelPort) + ')')
  if (Test-Path $log) { Get-Content $log -Tail 8 | ForEach-Object { Say ('      ' + $_) } }
  exit 1
}
Start-Sleep -Seconds 2
$shellPid = PidOf $ProxyPort
$window = if ($shellPid -ne 0) { WindowOfProcess $shellPid } else { $null }
Say ('start: up - proxy ' + $ProxyPort + ' (pid ' + $shellPid + '), kernel ' + $KernelPort + ' (pid ' + (PidOf $KernelPort) + ')')
Say ('start: window ' + $(if ($null -eq $window) { '(not readable yet)' } else { $window }) + ', CDP ' + $CdpPort + ' ' + $(if (Listening $CdpPort) { 'listening' } else { 'NOT listening' }))
$tray = 'no tray line'
if (Test-Path $log) {
  $trayLine = (Get-Content $log -ErrorAction SilentlyContinue | Where-Object { $_ -match 'tray icon ready' } | Select-Object -First 1)
  if ($null -ne $trayLine) { $tray = $trayLine.Trim() }
}
Say ('start: ' + $tray)
$bad = @($rows | Where-Object { $_ -like 'FAIL:*' })
if ($bad.Count -gt 0) { foreach ($row in $bad) { Write-Output $row }; exit 1 }
Say 'done: DSH-LINK was closed cleanly and is up again'
exit 0
