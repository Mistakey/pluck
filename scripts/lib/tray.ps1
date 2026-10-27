# 通过 UI Automation 与 Win32 菜单接口操作 Windows 通知区域中的 Pluck 托盘图标。
#   tray.ps1 -Action tooltip                   输出托盘提示文字（“Pluck · 模式 · 默认模型”）
#   tray.ps1 -Action menu [-Shot a.png]        右键打开菜单，输出菜单项 JSON（文字、是否可用），截图后关闭
#   tray.ps1 -Action click -Item 文字 [-Shot]  右键打开菜单，用鼠标点击指定菜单项；输出点击时刻（Unix 毫秒）
#   tray.ps1 -Action open                      左键单击图标（打开配置窗口）
# 只模拟鼠标点击托盘图标和菜单项，不向前台窗口发送键盘输入；菜单通过发给菜单窗口自身的消息关闭。
param(
  [ValidateSet('tooltip', 'menu', 'click', 'open')] [string]$Action = 'tooltip',
  [string]$Item = '',
  [string]$Shot = '',
  [string]$Name = 'Pluck'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class PluckTray {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetMenuStringW(IntPtr m, uint id, StringBuilder s, int max, uint f);
  [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr m, uint id, uint f);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetMenuItemRect(IntPtr h, IntPtr m, uint i, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Click(int x, int y, bool right) {
    SetCursorPos(x, y); System.Threading.Thread.Sleep(80);
    uint down = right ? 0x0008u : 0x0002u, up = right ? 0x0010u : 0x0004u;
    mouse_event(down, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(40); mouse_event(up, 0, 0, 0, UIntPtr.Zero);
  }
  public static string Text(IntPtr m, uint i) { var sb = new StringBuilder(512); GetMenuStringW(m, i, sb, 512, 0x400); return sb.ToString(); }
}
'@
# 坐标统一使用物理像素。
[void][PluckTray]::SetProcessDPIAware()
$UIA = [System.Windows.Automation.AutomationElement]
$Tree = [System.Windows.Automation.TreeScope]

function Find-ByName($root, [string]$pattern) {
  foreach ($e in $root.FindAll($Tree::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    try { if ($e.Current.Name -like $pattern) { return $e } } catch {}
  }
  return $null
}

function Center($e) {
  $r = $e.Current.BoundingRectangle
  return @([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
}

function Find-NotifyIcon($root) {
  # 通知区域图标的名称就是托盘提示文字；任务栏窗口按钮不匹配。
  $cond = New-Object System.Windows.Automation.PropertyCondition($UIA::AutomationIdProperty, 'NotifyItemIcon')
  foreach ($e in $root.FindAll($Tree::Descendants, $cond)) {
    if ($e.Current.Name.Trim() -like "$Name ·*") { return $e }
  }
  return $null
}

function Find-TrayIcon([switch]$Visible) {
  $root = $UIA::RootElement
  $bar = $root.FindFirst($Tree::Children, (New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, 'Shell_TrayWnd')))
  $icon = Find-NotifyIcon $bar
  if ($icon) { return $icon }
  $icon = Find-NotifyIcon $root
  if ($icon -and (-not $Visible -or -not $icon.Current.IsOffscreen)) { return $icon }
  # 图标在“显示隐藏的图标”溢出区：展开后再找；溢出区原本已展开时点击会收起，因此最多尝试两次。
  $chevron = Find-ByName $bar '*隐藏的图标*'
  if (-not $chevron) { $chevron = Find-ByName $bar '*hidden icons*' }
  if (-not $chevron) { throw "找不到 $Name 托盘图标" }
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $c = Center $chevron; [PluckTray]::Click($c[0], $c[1], $false)
    for ($i = 0; $i -lt 10; $i++) {
      Start-Sleep -Milliseconds 150
      $icon = Find-NotifyIcon $root
      if ($icon -and -not $icon.Current.IsOffscreen) { return $icon }
    }
  }
  throw "找不到 $Name 托盘图标"
}

function Close-Menu($hwnd) {
  # WM_KEYDOWN(VK_ESCAPE) 只发给菜单窗口。
  [void][PluckTray]::PostMessage($hwnd, 0x0100, [IntPtr]0x1B, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 200
}

function Open-Menu {
  $cond = New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, '#32768')
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $icon = Find-TrayIcon -Visible
    $c = Center $icon; [PluckTray]::Click($c[0], $c[1], $true)
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 100
      $w = $UIA::RootElement.FindFirst($Tree::Children, $cond)
      if (-not $w) { continue }
      $hwnd = [IntPtr]$w.Current.NativeWindowHandle
      $hmenu = [PluckTray]::SendMessage($hwnd, 0x01E1, [IntPtr]::Zero, [IntPtr]::Zero)  # MN_GETHMENU
      if ($hmenu -eq [IntPtr]::Zero) { continue }
      $items = @()
      for ($k = 0; $k -lt [PluckTray]::GetMenuItemCount($hmenu); $k++) {
        $state = [PluckTray]::GetMenuState($hmenu, [uint32]$k, 0x400)
        $r = New-Object PluckTray+RECT; [void][PluckTray]::GetMenuItemRect([IntPtr]::Zero, $hmenu, [uint32]$k, [ref]$r)
        $items += [pscustomobject]@{
          text = [PluckTray]::Text($hmenu, [uint32]$k); enabled = (($state -band 0x3) -eq 0); separator = (($state -band 0x800) -ne 0)
          x = [int](($r.L + $r.R) / 2); y = [int](($r.T + $r.B) / 2)
        }
      }
      Start-Sleep -Milliseconds 200
      return @{ hwnd = $hwnd; items = $items }
    }
  }
  throw '托盘菜单未出现'
}

function Shot-Menu($hwnd) {
  if (-not $Shot) { return }
  # PrintWindow 直接取菜单窗口内容，不受其他浮层遮挡。
  $r = New-Object PluckTray+RECT; [void][PluckTray]::GetWindowRect($hwnd, [ref]$r)
  $bmp = New-Object System.Drawing.Bitmap ([Math]::Max(1, $r.R - $r.L)), ([Math]::Max(1, $r.B - $r.T))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $dc = $g.GetHdc(); $ok = [PluckTray]::PrintWindow($hwnd, $dc, 2); $g.ReleaseHdc($dc)
  if (-not $ok) { $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size) }
  $g.Dispose(); $bmp.Save([IO.Path]::GetFullPath($Shot), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

switch ($Action) {
  'tooltip' { (Find-TrayIcon).Current.Name.Trim() }
  'open' { $icon = Find-TrayIcon -Visible; $c = Center $icon; [PluckTray]::Click($c[0], $c[1], $false); 'ok' }
  'menu' {
    $m = Open-Menu; Shot-Menu $m.hwnd; Close-Menu $m.hwnd
    ConvertTo-Json -Compress -InputObject @($m.items | Where-Object { -not $_.separator } | Select-Object text, enabled)
  }
  'click' {
    $m = Open-Menu; Shot-Menu $m.hwnd
    $target = $m.items | Where-Object { $_.text -eq $Item } | Select-Object -First 1
    if (-not $target) { Close-Menu $m.hwnd; throw "菜单中没有「$Item」" }
    if (-not $target.enabled) { Close-Menu $m.hwnd; throw "「$Item」不可用" }
    $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    [PluckTray]::Click($target.x, $target.y, $false)
    "clicked=$at"
  }
}
