'use strict';

const { spawnSync } = require('child_process');
const { sleep } = require('./helpers');

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runPowerShell(script) {
  return runCommand('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

function runPowerShellJson(script) {
  const result = runPowerShell(script);
  if (result.status !== 0) {
    throw new Error(`PowerShell failed (${result.status})\n${result.stderr || result.stdout}`.trim());
  }

  const text = result.stdout.trim();
  if (!text) return null;
  return JSON.parse(text);
}

function getForegroundWindowInfo() {
  return runPowerShellJson(`
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ForegroundWindowProbe {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$handle = [ForegroundWindowProbe]::GetForegroundWindow()
$builder = New-Object System.Text.StringBuilder 1024
[void][ForegroundWindowProbe]::GetWindowText($handle, $builder, $builder.Capacity)
$processId = 0
[void][ForegroundWindowProbe]::GetWindowThreadProcessId($handle, [ref]$processId)
$process = $null
if ($processId -gt 0) {
  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
  } catch {}
}

[pscustomobject]@{
  hwnd = $handle.ToInt64()
  hwndHex = ('0x{0:X}' -f $handle.ToInt64())
  title = $builder.ToString()
  processId = $processId
  processName = if ($process) { $process.ProcessName } else { $null }
} | ConvertTo-Json -Compress
`);
}

function getSessionProcessSummary() {
  const result = runPowerShell(`
$names = 'explorer','LogonUI','winlogon','dwm','sihost'
Get-Process -Name $names -ErrorAction SilentlyContinue |
  Select-Object ProcessName, Id, SessionId |
  ConvertTo-Json -Compress
`);
  const text = String(result.stdout || '').trim();
  if (!text) return [];
  return JSON.parse(text);
}

function getInteractiveDesktopState() {
  const foreground = getForegroundWindowInfo();
  const processName = String((foreground && foreground.processName) || '').toLowerCase();
  const title = String((foreground && foreground.title) || '').toLowerCase();
  const hwnd = Number((foreground && foreground.hwnd) || 0);
  const noForegroundWindow = !hwnd;
  const processesRaw = getSessionProcessSummary();
  const processes = Array.isArray(processesRaw) ? processesRaw : (processesRaw ? [processesRaw] : []);
  const hasExplorerShell = processes.some((proc) => String(proc.ProcessName || '').toLowerCase() === 'explorer');
  const hasLogonUi = processes.some((proc) => String(proc.ProcessName || '').toLowerCase() === 'logonui');
  const locked = processName === 'lockapp' || processName === 'logonui' || title.includes('lock screen');
  const atLogonScreen = !locked && noForegroundWindow && hasLogonUi && !hasExplorerShell;
  const interactiveNoForegroundWindow = !locked && noForegroundWindow && hasExplorerShell && !hasLogonUi;
  const parallelsServiceTerminal = processName === 'windowsterminal' && title.includes('prl_tools_service.exe');
  const interactiveParallelsServiceTerminal = !locked && parallelsServiceTerminal && hasExplorerShell && !hasLogonUi;

  let reason = 'interactive';
  if (locked) {
    reason = 'locked';
  } else if (atLogonScreen) {
    reason = 'logon-screen';
  } else if (interactiveParallelsServiceTerminal) {
    reason = 'interactive-parallels-service-terminal';
  } else if (parallelsServiceTerminal) {
    reason = 'parallels-service-terminal';
  } else if (interactiveNoForegroundWindow) {
    reason = 'interactive-no-foreground-window';
  } else if (noForegroundWindow) {
    reason = 'no-foreground-window';
  }

  return {
    foreground,
    locked,
    atLogonScreen,
    interactiveNoForegroundWindow,
    interactiveParallelsServiceTerminal,
    hasExplorerShell,
    hasLogonUi,
    sessionProcesses: processes,
    parallelsServiceTerminal,
    noForegroundWindow,
    interactive: !locked && !atLogonScreen && (interactiveParallelsServiceTerminal || interactiveNoForegroundWindow || (!parallelsServiceTerminal && !noForegroundWindow)),
    reason
  };
}

function getTopLevelWindows() {
  return runPowerShellJson(`
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class WindowEnumProbe {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

  [DllImport("user32.dll")]
  public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$windows = New-Object System.Collections.Generic.List[object]
$callback = [WindowEnumProbe+EnumWindowsProc]{
  param($hWnd, $lParam)

  $titleBuilder = New-Object System.Text.StringBuilder 1024
  [void][WindowEnumProbe]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
  $classBuilder = New-Object System.Text.StringBuilder 512
  [void][WindowEnumProbe]::GetClassName($hWnd, $classBuilder, $classBuilder.Capacity)
  $processId = 0
  [void][WindowEnumProbe]::GetWindowThreadProcessId($hWnd, [ref]$processId)
  $process = $null
  if ($processId -gt 0) {
    try { $process = Get-Process -Id $processId -ErrorAction Stop } catch {}
  }

  $rect = New-Object WindowEnumProbe+RECT
  [void][WindowEnumProbe]::GetWindowRect($hWnd, [ref]$rect)
  $exStyle = [WindowEnumProbe]::GetWindowLong($hWnd, -20)
  $owner = [WindowEnumProbe]::GetWindow($hWnd, 4)
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top

  $windows.Add([pscustomobject]@{
    hwnd = $hWnd.ToInt64()
    hwndHex = ('0x{0:X}' -f $hWnd.ToInt64())
    title = $titleBuilder.ToString()
    className = $classBuilder.ToString()
    processId = $processId
    processName = if ($process) { $process.ProcessName } else { $null }
    visible = [WindowEnumProbe]::IsWindowVisible($hWnd)
    minimized = [WindowEnumProbe]::IsIconic($hWnd)
    ownerHwnd = $owner.ToInt64()
    ownerHwndHex = ('0x{0:X}' -f $owner.ToInt64())
    exStyle = $exStyle
    exStyleHex = ('0x{0:X}' -f ($exStyle -band 0xFFFFFFFF))
    topMost = (($exStyle -band 0x8) -ne 0)
    toolWindow = (($exStyle -band 0x80) -ne 0)
    rect = [pscustomobject]@{
      left = $rect.Left
      top = $rect.Top
      right = $rect.Right
      bottom = $rect.Bottom
      width = $width
      height = $height
    }
  }) | Out-Null
  return $true
}
[void][WindowEnumProbe]::EnumWindows($callback, [IntPtr]::Zero)
$windows | ConvertTo-Json -Compress -Depth 5
`);
}

function findLikelyPiPWindows(windows) {
  const list = Array.isArray(windows) ? windows : [];
  return list.filter((win) => {
    if (!win || !win.visible) return false;
    const processName = String(win.processName || '').toLowerCase();
    const className = String(win.className || '');
    const title = String(win.title || '').toLowerCase();
    const rect = win.rect || {};
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    const browserOwned = processName === 'chrome' || processName === 'msedge';
    const chromeClass = className === 'Chrome_WidgetWin_1';
    const smallWindow = width > 0 && height > 0 && width <= 900 && height <= 700;
    const likelyTitle = title.includes('picture in picture') || title.includes('picture-in-picture') || title === 'sample video';
    return browserOwned && chromeClass && (win.topMost || win.toolWindow || smallWindow || likelyTitle);
  });
}

async function launchAndFocusNotepad() {
  const processInfo = runPowerShellJson(`
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FocusInterop {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
}
"@

function Get-ForegroundInfo {
  $handle = [FocusInterop]::GetForegroundWindow()
  $builder = New-Object System.Text.StringBuilder 1024
  [void][FocusInterop]::GetWindowText($handle, $builder, $builder.Capacity)
  $processId = 0
  [void][FocusInterop]::GetWindowThreadProcessId($handle, [ref]$processId)
  $process = $null
  if ($processId -gt 0) {
    try { $process = Get-Process -Id $processId -ErrorAction Stop } catch {}
  }
  [pscustomobject]@{
    hwnd = $handle.ToInt64()
    hwndHex = ('0x{0:X}' -f $handle.ToInt64())
    title = $builder.ToString()
    processId = $processId
    processName = if ($process) { $process.ProcessName } else { $null }
  }
}

function Get-NotepadWindowCandidates {
  @(Get-Process notepad -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    ForEach-Object {
      [pscustomobject]@{
        processId = $_.Id
        processName = $_.ProcessName
        hwnd = [int64]$_.MainWindowHandle
        hwndHex = ('0x{0:X}' -f [int64]$_.MainWindowHandle)
        title = $_.MainWindowTitle
        className = $null
        visible = $true
        source = 'main-window-handle'
      }
    })
}

function Get-NotepadWindowCandidatesFromEnum {
  $windows = New-Object System.Collections.ArrayList
  $callback = [FocusInterop+EnumWindowsProc]{
    param($hWnd, $lParam)

    $titleBuilder = New-Object System.Text.StringBuilder 1024
    [void][FocusInterop]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
    $classBuilder = New-Object System.Text.StringBuilder 256
    [void][FocusInterop]::GetClassName($hWnd, $classBuilder, $classBuilder.Capacity)
    $processId = 0
    [void][FocusInterop]::GetWindowThreadProcessId($hWnd, [ref]$processId)
    $process = $null
    if ($processId -gt 0) {
      try { $process = Get-Process -Id $processId -ErrorAction Stop } catch {}
    }

    $processName = if ($process) { [string]$process.ProcessName } else { '' }
    $title = $titleBuilder.ToString()
    $className = $classBuilder.ToString()
    if ($processName -match 'notepad' -or $className -eq 'Notepad' -or $title -match 'Notepad') {
      [void]$windows.Add([pscustomobject]@{
        processId = $processId
        processName = if ($process) { $process.ProcessName } else { $null }
        hwnd = $hWnd.ToInt64()
        hwndHex = ('0x{0:X}' -f $hWnd.ToInt64())
        title = $title
        className = $className
        visible = [FocusInterop]::IsWindowVisible($hWnd)
        source = 'enum-windows'
      })
    }
    return $true
  }

  [void][FocusInterop]::EnumWindows($callback, [IntPtr]::Zero)
  @($windows)
}

function Invoke-WindowFocus {
  param(
    [long]$Hwnd,
    [string]$Strategy,
    [string]$WindowTitle
  )

  $result = [ordered]@{ strategy = $Strategy; hwnd = $Hwnd; hwndHex = ('0x{0:X}' -f $Hwnd) }
  $nativeHandle = [IntPtr]::new($Hwnd)

  if ($Strategy -eq 'restore-setforeground') {
    $result.showRestore = [FocusInterop]::ShowWindowAsync($nativeHandle, 9)
    Start-Sleep -Milliseconds 150
    $result.bringToTop = [FocusInterop]::BringWindowToTop($nativeHandle)
    $result.setForeground = [FocusInterop]::SetForegroundWindow($nativeHandle)
  }
  elseif ($Strategy -eq 'attach-thread-input') {
    $foreground = Get-ForegroundInfo
    $targetThreadId = 0
    [void][FocusInterop]::GetWindowThreadProcessId($nativeHandle, [ref]([uint32]0))
    $targetThreadId = [FocusInterop]::GetWindowThreadProcessId($nativeHandle, [ref]([uint32]0))
    $currentThreadId = [FocusInterop]::GetCurrentThreadId()
    $foregroundThreadId = 0
    if ($foreground -and $foreground.hwnd) {
      $foregroundThreadId = [FocusInterop]::GetWindowThreadProcessId([IntPtr]::new([long]$foreground.hwnd), [ref]([uint32]0))
    }
    if ($foregroundThreadId -gt 0) {
      [void][FocusInterop]::AttachThreadInput($currentThreadId, $foregroundThreadId, $true)
    }
    if ($targetThreadId -gt 0) {
      [void][FocusInterop]::AttachThreadInput($currentThreadId, $targetThreadId, $true)
    }
    try {
      $result.showRestore = [FocusInterop]::ShowWindow($nativeHandle, 9)
      $result.bringToTop = [FocusInterop]::BringWindowToTop($nativeHandle)
      $result.setForeground = [FocusInterop]::SetForegroundWindow($nativeHandle)
    } finally {
      if ($foregroundThreadId -gt 0) {
        [void][FocusInterop]::AttachThreadInput($currentThreadId, $foregroundThreadId, $false)
      }
      if ($targetThreadId -gt 0) {
        [void][FocusInterop]::AttachThreadInput($currentThreadId, $targetThreadId, $false)
      }
    }
  }
  elseif ($Strategy -eq 'appactivate') {
    $ws = New-Object -ComObject WScript.Shell
    $result.appActivate = [bool]$ws.AppActivate($WindowTitle)
  }
  elseif ($Strategy -eq 'alt-tab') {
    $ws = New-Object -ComObject WScript.Shell
    $ws.SendKeys('%{TAB}')
    $result.sentKeys = '%{TAB}'
  }

  Start-Sleep -Milliseconds 300
  $result.foregroundAfter = Get-ForegroundInfo
  $result.success = $result.foregroundAfter -and ($result.foregroundAfter.processName -match 'Notepad')
  [pscustomobject]$result
}

$foregroundBefore = Get-ForegroundInfo
$attempts = New-Object System.Collections.ArrayList

if ($foregroundBefore -and $foregroundBefore.hwnd -and $foregroundBefore.processName -match 'chrome') {
  [void][FocusInterop]::ShowWindowAsync([IntPtr]::new([long]$foregroundBefore.hwnd), 6)
  Start-Sleep -Milliseconds 250
}

$launchedProcess = Start-Process notepad.exe -PassThru
Start-Sleep -Milliseconds 1200

$candidates = Get-NotepadWindowCandidates
if (-not $candidates -or $candidates.Count -eq 0) {
  Start-Sleep -Milliseconds 800
  $candidates = Get-NotepadWindowCandidates
}

if (-not $candidates -or $candidates.Count -eq 0) {
  $wsLaunch = New-Object -ComObject WScript.Shell
  [void]$wsLaunch.Run('notepad.exe', 1, $false)
  Start-Sleep -Milliseconds 1200
  $candidates = Get-NotepadWindowCandidates
}

if (-not $candidates -or $candidates.Count -eq 0) {
  $candidates = Get-NotepadWindowCandidatesFromEnum
}

$target = $null
if ($candidates -and $candidates.Count -gt 0) {
  $target = $candidates | Sort-Object @{ Expression = { $_.processId -eq $launchedProcess.Id }; Descending = $true }, @{ Expression = { $_.visible -eq $true }; Descending = $true }, @{ Expression = { [string]$_.title -ne '' }; Descending = $true }, @{ Expression = { $_.hwnd }; Descending = $true } | Select-Object -First 1
}

if ($target) {
  foreach ($strategy in @('restore-setforeground', 'attach-thread-input', 'appactivate', 'alt-tab')) {
    $attempt = Invoke-WindowFocus -Hwnd $target.hwnd -Strategy $strategy -WindowTitle $target.title
    [void]$attempts.Add($attempt)
    if ($attempt.success) { break }
  }
} else {
  $ws = New-Object -ComObject WScript.Shell
  [void]$ws.AppActivate('Untitled - Notepad')
  Start-Sleep -Milliseconds 300
}

$foregroundAfter = Get-ForegroundInfo
[pscustomobject]@{
  launcherProcessId = if ($launchedProcess) { $launchedProcess.Id } else { $null }
  processId = if ($foregroundAfter -and $foregroundAfter.processName -match 'Notepad') { $foregroundAfter.processId } elseif ($target) { $target.processId } else { if ($launchedProcess) { $launchedProcess.Id } else { $null } }
  hwnd = if ($foregroundAfter -and $foregroundAfter.processName -match 'Notepad') { $foregroundAfter.hwnd } elseif ($target) { $target.hwnd } else { $null }
  hwndHex = if ($foregroundAfter -and $foregroundAfter.processName -match 'Notepad') { $foregroundAfter.hwndHex } elseif ($target) { $target.hwndHex } else { $null }
  title = if ($foregroundAfter -and $foregroundAfter.processName -match 'Notepad') { $foregroundAfter.title } elseif ($target) { $target.title } else { $null }
  strategy = if ($attempts.Count -gt 0) { ($attempts | Select-Object -Last 1).strategy } else { 'launch-only' }
  foregroundBefore = $foregroundBefore
  foregroundAfter = $foregroundAfter
  targetWindow = $target
  candidates = $candidates
  attempts = $attempts
} | ConvertTo-Json -Compress -Depth 6
`);
  await sleep(600);
  const foreground = getForegroundWindowInfo();
  return {
    processId: processInfo ? processInfo.processId : null,
    hwnd: processInfo ? processInfo.hwnd : null,
    hwndHex: processInfo ? processInfo.hwndHex : null,
    title: processInfo ? processInfo.title : null,
    strategy: processInfo ? processInfo.strategy : null,
    foregroundBefore: processInfo ? processInfo.foregroundBefore : null,
    foregroundAfter: processInfo ? processInfo.foregroundAfter : null,
    targetWindow: processInfo ? processInfo.targetWindow : null,
    candidates: processInfo ? processInfo.candidates : null,
    attempts: processInfo ? processInfo.attempts : null,
    launcherProcessId: processInfo ? processInfo.launcherProcessId : null,
    foreground
  };
}

function stopProcessById(processId) {
  if (!processId) return;
  runCommand('taskkill', ['/PID', String(processId), '/T', '/F']);
}

async function focusWindowByTitle(title) {
  const escaped = title.replace(/'/g, "''");
  runPowerShell(`
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FocusWindowByTitleInterop {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
}
"@

function Get-FocusWindowByTitleForegroundInfo {
  $handle = [FocusWindowByTitleInterop]::GetForegroundWindow()
  $builder = New-Object System.Text.StringBuilder 1024
  [void][FocusWindowByTitleInterop]::GetWindowText($handle, $builder, $builder.Capacity)
  $processId = 0
  [void][FocusWindowByTitleInterop]::GetWindowThreadProcessId($handle, [ref]$processId)
  [pscustomobject]@{
    hwnd = $handle.ToInt64()
    title = $builder.ToString()
    processId = $processId
  }
}

function Invoke-FocusWindowByTitle {
  param(
    [long]$Hwnd,
    [string]$Strategy,
    [string]$WindowTitle
  )

  $nativeHandle = [IntPtr]::new($Hwnd)
  if ($Strategy -eq 'restore-setforeground') {
    [void][FocusWindowByTitleInterop]::ShowWindowAsync($nativeHandle, 9)
    Start-Sleep -Milliseconds 150
    [void][FocusWindowByTitleInterop]::BringWindowToTop($nativeHandle)
    [void][FocusWindowByTitleInterop]::SetForegroundWindow($nativeHandle)
  }
  elseif ($Strategy -eq 'attach-thread-input') {
    $foreground = Get-FocusWindowByTitleForegroundInfo
    $targetThreadId = [FocusWindowByTitleInterop]::GetWindowThreadProcessId($nativeHandle, [ref]([uint32]0))
    $currentThreadId = [FocusWindowByTitleInterop]::GetCurrentThreadId()
    $foregroundThreadId = 0
    if ($foreground -and $foreground.hwnd) {
      $foregroundThreadId = [FocusWindowByTitleInterop]::GetWindowThreadProcessId([IntPtr]::new([long]$foreground.hwnd), [ref]([uint32]0))
    }
    if ($foregroundThreadId -gt 0) {
      [void][FocusWindowByTitleInterop]::AttachThreadInput($currentThreadId, $foregroundThreadId, $true)
    }
    if ($targetThreadId -gt 0) {
      [void][FocusWindowByTitleInterop]::AttachThreadInput($currentThreadId, $targetThreadId, $true)
    }
    try {
      [void][FocusWindowByTitleInterop]::ShowWindow($nativeHandle, 9)
      [void][FocusWindowByTitleInterop]::BringWindowToTop($nativeHandle)
      [void][FocusWindowByTitleInterop]::SetForegroundWindow($nativeHandle)
    } finally {
      if ($foregroundThreadId -gt 0) {
        [void][FocusWindowByTitleInterop]::AttachThreadInput($currentThreadId, $foregroundThreadId, $false)
      }
      if ($targetThreadId -gt 0) {
        [void][FocusWindowByTitleInterop]::AttachThreadInput($currentThreadId, $targetThreadId, $false)
      }
    }
  }
  elseif ($Strategy -eq 'appactivate') {
    $ws = New-Object -ComObject WScript.Shell
    [void]$ws.AppActivate($WindowTitle)
  }

  Start-Sleep -Milliseconds 250
  $foregroundAfter = Get-FocusWindowByTitleForegroundInfo
  return ($foregroundAfter -and $foregroundAfter.title -like ('*' + $WindowTitle + '*'))
}

$target = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*${escaped}*' } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1

if ($target) {
  foreach ($strategy in @('restore-setforeground', 'attach-thread-input', 'appactivate')) {
    if (Invoke-FocusWindowByTitle -Hwnd ([int64]$target.MainWindowHandle) -Strategy $strategy -WindowTitle $target.MainWindowTitle) {
      break
    }
  }
} else {
  $ws = New-Object -ComObject WScript.Shell
  [void]$ws.AppActivate('${escaped}')
}
`);
  await sleep(600);
  return getForegroundWindowInfo();
}

async function minimizeWindowByTitle(title) {
  const escaped = title.replace(/'/g, "''");
  runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowMinimizeProbe {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
$process = Get-Process | Where-Object { $_.MainWindowTitle -eq '${escaped}' } | Select-Object -First 1
if ($process -and $process.MainWindowHandle -ne 0) {
  [void][WindowMinimizeProbe]::ShowWindowAsync([IntPtr]::new([int64]$process.MainWindowHandle), 6)
}
`);
  await sleep(600);
  return getForegroundWindowInfo();
}

function captureDesktopScreenshot(outputPath) {
  const escaped = String(outputPath).replace(/'/g, "''");
  runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`);
  return outputPath;
}

module.exports = {
  runCommand,
  runPowerShell,
  runPowerShellJson,
  getForegroundWindowInfo,
  getInteractiveDesktopState,
  getTopLevelWindows,
  findLikelyPiPWindows,
  launchAndFocusNotepad,
  stopProcessById,
  focusWindowByTitle,
  minimizeWindowByTitle,
  captureDesktopScreenshot
};
