$code = @"
using System;
using System.Runtime.InteropServices;
public class DisplayOff {
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
    public static void TurnOff() {
        SendMessage((IntPtr)0xFFFF, 0x0112, 0xF170, 2);
    }
}
"@
Add-Type -TypeDefinition $code
[DisplayOff]::TurnOff()
Write-Host "Screen off. Tasks keep running."
