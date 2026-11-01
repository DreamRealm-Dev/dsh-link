<#
  R378: the window facts of the embedded-host run, as one JSON line on stdout.

  Given the title a host application gives its own window, this reports the window's handle, owning process and box,
  walks its CHILD tree, and (when -Capture is passed) writes a PrintWindow capture of it.

  The child tree is the reading requirement D needs: the shell attaches its webview INTO the host's window, so the
  host window's own child is a WRY_WEBVIEW and inside that a Chromium widget titled with the client document. A
  PrintWindow capture is what shows the two together as pixels, which no DOM or CDP read can.

  Usage: pwsh -File scripts/lib/host-window-facts.ps1 -WantTitle 'Host application' [-Capture out.png]
#>
param(
  [string]$Capture = '',
  [string]$WantTitle = 'Host application'
)
# The JSON carries window titles, which are user text and may be any script: pin the console encoding so a caller
# reading this through a pipe gets bytes it can decode (measured: the client's own Chinese title came back mojibake).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class HostW {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> Rows = new List<string>();
  public static void Walk(IntPtr parent, int depth) {
    EnumChildWindows(parent, (h, l) => {
      var t = new StringBuilder(256); GetWindowTextW(h, t, 256);
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      Rows.Add(depth + "|" + h.ToInt64() + "|" + c + "|" + t + "|" + pid);
      Walk(h, depth + 1);
      return true;
    }, IntPtr.Zero);
  }
}
'@
$target = [IntPtr]::Zero
[HostW]::EnumWindows({ param($h, $l)
  $t = New-Object System.Text.StringBuilder 256
  [void][HostW]::GetWindowTextW($h, $t, 256)
  if ($t.ToString() -eq $WantTitle) { $script:target = $h; return $false }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($target -eq [IntPtr]::Zero) { Write-Output '{"found":false}'; exit 0 }
$rect = New-Object HostW+RECT
[void][HostW]::GetWindowRect($target, [ref]$rect)
$ownerPid = 0
[void][HostW]::GetWindowThreadProcessId($target, [ref]$ownerPid)
[HostW]::Rows.Clear()
[HostW]::Walk($target, 1)
$saved = ''
$bytes = 0
if ($Capture -ne '') {
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  if ($w -gt 0 -and $h -gt 0) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    $ok = [HostW]::PrintWindow($target, $hdc, 2)
    $g.ReleaseHdc($hdc)
    $g.Dispose()
    $bmp.Save($Capture, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    if (Test-Path $Capture) { $saved = $Capture; $bytes = (Get-Item $Capture).Length }
  }
}
$out = [ordered]@{
  found = $true
  hwnd = $target.ToInt64()
  pid = $ownerPid
  box = @{ x = $rect.Left; y = $rect.Top; w = $rect.Right - $rect.Left; h = $rect.Bottom - $rect.Top }
  children = @([HostW]::Rows)
  capture = @{ path = $saved; bytes = $bytes }
}
$out | ConvertTo-Json -Compress -Depth 6
