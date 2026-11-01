# Capture the main window of a process to a PNG.
#
# Two Windows-specific traps this works around:
#
# 1. A Tauri process owns several top-level windows, one of them a degenerate 15x15
#    message window, so `MainWindowHandle` is not the shell. The main window is picked
#    by having a title.
# 2. The window is usually behind other applications, and `SetForegroundWindow` only
#    reliably works for the process that currently owns the foreground. Screen-grabbing
#    at the window's coordinates therefore captures whatever is in front. `PrintWindow`
#    with PW_RENDERFULLCONTENT renders the window's own surface, which is also what
#    makes a composited WebView2 view appear.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot.ps1 <process> <out.png>

$source = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class Cap
{
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);

    // One "handle|x|y|w|h|visible|minimized|title" row per top-level window.
    public static List<string> Describe(int pid)
    {
        var rows = new List<string>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr _) {
            uint owner;
            GetWindowThreadProcessId(hWnd, out owner);
            if (owner != (uint)pid) return true;
            Rect rect;
            if (!GetWindowRect(hWnd, out rect)) return true;
            var sb = new StringBuilder(GetWindowTextLength(hWnd) + 2);
            GetWindowText(hWnd, sb, sb.Capacity);
            rows.Add(string.Join("|", new string[] {
                hWnd.ToInt64().ToString(),
                rect.Left.ToString(), rect.Top.ToString(),
                (rect.Right - rect.Left).ToString(), (rect.Bottom - rect.Top).ToString(),
                IsWindowVisible(hWnd) ? "1" : "0",
                IsIconic(hWnd) ? "1" : "0",
                sb.ToString(),
            }));
            return true;
        }, IntPtr.Zero);
        return rows;
    }

    public static void Restore(long handle)
    {
        var h = new IntPtr(handle);
        ShowWindow(h, 9);
        SetForegroundWindow(h);
    }

    // Re-read the rect after a restore: a minimized window reports the sentinel
    // position Windows parks it at, so the pre-restore rect is not usable.
    public static string RectOf(long handle)
    {
        var h = new IntPtr(handle);
        Rect rect;
        if (!GetWindowRect(h, out rect)) return "0|0|0|0";
        return string.Join("|", new string[] {
            rect.Left.ToString(), rect.Top.ToString(),
            (rect.Right - rect.Left).ToString(), (rect.Bottom - rect.Top).ToString(),
        });
    }

    // PW_RENDERFULLCONTENT (2) is what makes a composited WebView2 surface appear.
    public static bool Capture(long handle, int width, int height, string path)
    {
        using (var bitmap = new System.Drawing.Bitmap(width, height))
        using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
        {
            var hdc = graphics.GetHdc();
            bool ok;
            try { ok = PrintWindow(new IntPtr(handle), hdc, 2); }
            finally { graphics.ReleaseHdc(hdc); }
            if (!ok) return false;
            bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
            return true;
        }
    }
}
'@

Add-Type -AssemblyName System.Drawing
# `Capture` renders through System.Drawing, so the compiler needs that reference
# explicitly; without it Add-Type reports "the type System.Drawing is not defined".
Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies 'System.Drawing'

$procName = $args[0]
$out = $args[1]

$proc = Get-Process -Name $procName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "NO_PROCESS: '$procName'"; exit 1 }

$rows = [Cap]::Describe($proc.Id)
if ($rows.Count -eq 0) { Write-Output "NO_WINDOW: process $($proc.Id) owns no top-level window"; exit 1 }

# A titled window is the reliable pick: a minimized window reports the size it had
# before minimizing and a sentinel position, so neither footprint nor coordinates can
# rank candidates. Area only breaks ties among the untitled remainder.
$named = $null
$largest = $null
foreach ($row in $rows) {
    $f = $row -split '\|'
    Write-Output ("  candidate handle={0,-12} {1,5}x{2,-5} at {3},{4} visible={5} minimized={6} title='{7}'" -f $f[0], $f[3], $f[4], $f[1], $f[2], $f[5], $f[6], $f[7])
    if ($f[5] -ne '1') { continue }
    if ($f[7] -ne '' -and $null -eq $named) { $named = $row; continue }
    $area = [long]$f[3] * [long]$f[4]
    if ($null -eq $largest -or $area -gt $largest.Area) { $largest = [PSCustomObject]@{ Row = $row; Area = $area } }
}

$chosen = if ($null -ne $named) { $named } elseif ($null -ne $largest) { $largest.Row } else { $null }
if (-not $chosen) { Write-Output "NO_USABLE_WINDOW"; exit 1 }

$handle = [long](($chosen -split '\|')[0])
[Cap]::Restore($handle)
Start-Sleep -Milliseconds 1800   # let the WebView paint after a restore

$f = [Cap]::RectOf($handle) -split '\|'
$w = [int]$f[2]
$h = [int]$f[3]
if ($w -le 0 -or $h -le 0) { Write-Output "BAD_RECT after restore: ${w}x${h} at $($f[0]),$($f[1])"; exit 1 }

if (-not [Cap]::Capture($handle, $w, $h, $out)) { Write-Output "PRINT_FAILED"; exit 1 }
Write-Output "captured ${w}x${h} -> $out ($((Get-Item $out).Length) bytes)"
