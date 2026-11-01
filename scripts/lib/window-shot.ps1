<#
  Capture the shell's own window rectangle off the screen, with a margin.

  Two things make this usable as an instrument rather than a screenshot. The
  process asks for per-monitor DPI awareness before touching any window API, so
  the rectangle it reports is in physical pixels and matches what
  CopyFromScreen copies; and it reports the capture origin, so a caller can map
  a window corner into the image exactly.

  The margin exists because the corners are what this is for: a rounded corner
  is only visible as a difference from what the window does *not* cover.
#>
param(
  [int]$Margin = 60,
  [string]$Output = 'window.png',
  [string]$Match = 'dsh-link'
)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DshWindow {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$aware = [DshWindow]::SetProcessDpiAwarenessContext([IntPtr](-4))

$candidates = New-Object System.Collections.ArrayList
$callback = [DshWindow+EnumProc]{
  param($handle, $state)
  if (-not [DshWindow]::IsWindowVisible($handle)) { return $true }
  $title = New-Object System.Text.StringBuilder 512
  [void][DshWindow]::GetWindowTextW($handle, $title, 512)
  if ($title.ToString().Length -eq 0) { return $true }
  $pid2 = 0
  [void][DshWindow]::GetWindowThreadProcessId($handle, [ref]$pid2)
  if ($pid2 -eq 0) { return $true }
  $process = $null
  try { $process = Get-Process -Id $pid2 -ErrorAction Stop } catch { return $true }
  if ($process.ProcessName -notlike "*$Match*") { return $true }
  $rect = New-Object DshWindow+RECT
  if (-not [DshWindow]::GetWindowRect($handle, [ref]$rect)) { return $true }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 200 -or $height -lt 200) { return $true }
  [void]$script:candidates.Add([pscustomobject]@{
    handle = $handle.ToInt64(); title = $title.ToString(); pid = $pid2; process = $process.ProcessName
    left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; area = $width * $height
  })
  return $true
}
[void][DshWindow]::EnumWindows($callback, [IntPtr]::Zero)

if ($candidates.Count -eq 0) {
  Write-Output ('{"error":"no visible window belongs to a process matching ' + $Match + '"}')
  exit 3
}
$window = $candidates | Sort-Object -Property area -Descending | Select-Object -First 1

$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
$left = [Math]::Max($screen.Left, $window.left - $Margin)
$top = [Math]::Max($screen.Top, $window.top - $Margin)
$right = [Math]::Min($screen.Right, $window.right + $Margin)
$bottom = [Math]::Min($screen.Bottom, $window.bottom + $Margin)
$width = $right - $left
$height = $bottom - $top

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
$graphics.Dispose()
$directory = Split-Path -Parent $Output
if ($directory -and -not (Test-Path $directory)) { [void](New-Item -ItemType Directory -Path $directory) }
$bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

$report = [pscustomobject]@{
  dpiAware = $aware
  process = $window.process
  title = $window.title
  windowHandle = $window.handle
  window = @{ left = $window.left; top = $window.top; right = $window.right; bottom = $window.bottom }
  capture = @{ left = $left; top = $top; width = $width; height = $height }
  output = $Output
  candidates = $candidates.Count
}
$report | ConvertTo-Json -Depth 4 -Compress
