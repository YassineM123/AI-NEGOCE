param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Commands,
    [int]$DelayMs = 1400
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NegoceCommand {
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$process = Get-Process negoce32 -ErrorAction Stop | Select-Object -First 1
$evidence = Join-Path (Split-Path $PSScriptRoot -Parent) 'PREUVES_NEGOCE'

foreach ($entry in $Commands.GetEnumerator()) {
    [void][NegoceCommand]::SendMessage($process.MainWindowHandle, 0x0111, [IntPtr]$entry.Value, [IntPtr]::Zero)
    Start-Sleep -Milliseconds $DelayMs
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save((Join-Path $evidence $entry.Key), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}
