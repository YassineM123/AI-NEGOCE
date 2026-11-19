param(
    [string[]]$Clicks = @(),
    [int[]]$VirtualKeys = @(),
    [switch]$SkipFocus,
    [string[]]$Keys = @(),
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [int]$DelayMs = 350
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32Focus {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$process = Get-Process negoce32 -ErrorAction Stop | Select-Object -First 1
if (-not $SkipFocus) {
    [Win32Focus]::ShowWindowAsync($process.MainWindowHandle, 9) | Out-Null
    [Win32Focus]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 500
}

foreach ($click in $Clicks) {
    $parts = $click.Split(',')
    [Win32Focus]::SetCursorPos([int]$parts[0], [int]$parts[1]) | Out-Null
    [Win32Focus]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [Win32Focus]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds $DelayMs
}

foreach ($vk in $VirtualKeys) {
    [Win32Focus]::PostMessage($process.MainWindowHandle, 0x0100, [IntPtr]$vk, [IntPtr]::Zero) | Out-Null
    [Win32Focus]::PostMessage($process.MainWindowHandle, 0x0101, [IntPtr]$vk, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds $DelayMs
}

foreach ($key in $Keys) {
    [System.Windows.Forms.SendKeys]::SendWait($key)
    Start-Sleep -Milliseconds $DelayMs
}

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
