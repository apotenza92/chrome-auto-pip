'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  return result;
}

function commandExists(command) {
  const result = run('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`]);
  return result.status === 0;
}

function runAppleScript(lines) {
  const script = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
  const result = run('osascript', ['-e', script]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'osascript failed').trim());
  }
  return (result.stdout || '').trim();
}

function getToolAvailability() {
  return {
    osascript: commandExists('osascript'),
    screencapture: commandExists('screencapture'),
    node: commandExists('node')
  };
}

async function getForegroundWindow() {
  try {
    const appName = runAppleScript([
      'tell application "System Events"',
      '  name of first application process whose frontmost is true',
      'end tell'
    ]);
    let windowTitle = null;
    try {
      windowTitle = runAppleScript([
        'tell application "System Events"',
        '  tell first application process whose frontmost is true',
        '    if (count of windows) > 0 then',
        '      get name of front window',
        '    end if',
        '  end tell',
        'end tell'
      ]) || null;
    } catch (_) {
      windowTitle = null;
    }
    return {
      processName: appName || null,
      title: windowTitle || null
    };
  } catch (error) {
    return {
      unsupported: true,
      error: error.message
    };
  }
}

async function listTopLevelWindows() {
  try {
    const raw = runAppleScript([
      'tell application "System Events"',
      '  set output to {}',
      '  repeat with p in application processes',
      '    try',
      '      if (count of windows of p) > 0 then',
      '        repeat with w in windows of p',
      '          set end of output to ((name of p as text) & "\t" & (name of w as text))',
      '        end repeat',
      '      end if',
      '    end try',
      '  end repeat',
      '  return output as text',
      'end tell'
    ]);
    return String(raw || '')
      .split(', ')
      .map((line) => line.split('\t'))
      .filter((parts) => parts[0])
      .map((parts) => ({ processName: parts[0] || null, title: parts[1] || null }));
  } catch (error) {
    return [{ unsupported: true, error: error.message }];
  }
}

async function focusWindow(title) {
  try {
    runAppleScript([
      'tell application "System Events"',
      `  set targetTitle to ${JSON.stringify(String(title || ''))}`,
      '  repeat with p in application processes',
      '    try',
      '      repeat with w in windows of p',
      '        if (name of w as text) contains targetTitle then',
      '          set frontmost of p to true',
      '          perform action "AXRaise" of w',
      '          return true',
      '        end if',
      '      end repeat',
      '    end try',
      '  end repeat',
      'end tell'
    ]);
    return getForegroundWindow();
  } catch (error) {
    return { unsupported: true, error: error.message };
  }
}

async function launchDefaultApp() {
  try {
    run('open', ['-a', 'TextEdit']);
    return {
      ok: true,
      appId: 'textedit',
      launched: true,
      foreground: await getForegroundWindow()
    };
  } catch (error) {
    return { ok: false, appId: 'textedit', error: error.message };
  }
}

async function closeDefaultApp() {
  try {
    runAppleScript(['tell application "TextEdit" to quit']);
    return { ok: true, appId: 'textedit' };
  } catch (error) {
    return { ok: false, appId: 'textedit', error: error.message };
  }
}

async function killBrowserProcesses() {
  const result = run('sh', ['-lc', 'pkill -f "Chromium|Google Chrome|chrome|Helium" >/dev/null 2>&1 || true']);
  return { ok: result.status === 0, status: result.status };
}

async function killDefaultAppProcesses() {
  try {
    runAppleScript(['tell application "TextEdit" to quit']);
  } catch (_) {}
  const result = run('sh', ['-lc', 'pkill -x TextEdit >/dev/null 2>&1 || true']);
  return { ok: result.status === 0, status: result.status };
}

async function screenshot(outputPath) {
  const resolved = path.resolve(outputPath);
  const result = run('screencapture', ['-x', resolved]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'screencapture failed').trim());
  }
  return resolved;
}

module.exports = {
  key: 'macos',
  getToolAvailability,
  getForegroundWindow,
  listTopLevelWindows,
  focusWindow,
  launchDefaultApp,
  closeDefaultApp,
  killBrowserProcesses,
  killDefaultAppProcesses,
  screenshot
};
