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
  const result = run('bash', ['-lc', `command -v ${command} >/dev/null 2>&1`]);
  return result.status === 0;
}

function shellCapture(script) {
  const result = run('bash', ['-lc', script]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'shell command failed').trim());
  }
  return (result.stdout || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getToolAvailability() {
  return {
    node: commandExists('node'),
    xdotool: commandExists('xdotool'),
    wmctrl: commandExists('wmctrl'),
    xprop: commandExists('xprop'),
    xset: commandExists('xset'),
    gnomeTextEditor: commandExists('gnome-text-editor'),
    gedit: commandExists('gedit')
  };
}

function parseWmctrlWindows() {
  if (!commandExists('wmctrl')) return [];
  const output = shellCapture('wmctrl -lx 2>/dev/null || true');
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
      if (!match) return { raw: line, id: null, title: null, wmClass: null };
      return {
        raw: line,
        id: match[1],
        desktop: match[2],
        pid: match[3],
        wmClass: match[4],
        host: match[5],
        title: match[6] || ''
      };
    });
}

function findEditorWindow(command) {
  const appId = String(command || '').toLowerCase();
  const titleNeedle = appId === 'gnome-text-editor' ? 'text editor' : appId;
  return parseWmctrlWindows().find((entry) => {
    const raw = String(entry.raw || '').toLowerCase();
    const title = String(entry.title || '').toLowerCase();
    const wmClass = String(entry.wmClass || '').toLowerCase();
    return raw.includes(appId) || title.includes(titleNeedle) || wmClass.includes(appId) || wmClass.includes('texteditor');
  }) || null;
}

function foregroundLooksLikeEditor(info, command, editorWindow = null) {
  const title = String((info && info.title) || '').toLowerCase();
  const commandName = String(command || '').toLowerCase();
  const editorTitle = String((editorWindow && editorWindow.title) || '').toLowerCase();
  return !!(
    (editorTitle && title.includes(editorTitle)) ||
    (commandName === 'gnome-text-editor' && title.includes('text editor')) ||
    (commandName === 'gedit' && title.includes('gedit'))
  );
}

async function getForegroundWindow() {
  try {
    if (!commandExists('xdotool')) {
      return { unsupported: true, reason: 'xdotool-missing' };
    }
    const title = shellCapture('xdotool getactivewindow getwindowname 2>/dev/null || true');
    return { title: title || null };
  } catch (error) {
    return { unsupported: true, error: error.message };
  }
}

async function listTopLevelWindows() {
  try {
    if (!commandExists('wmctrl')) {
      return [{ unsupported: true, reason: 'wmctrl-missing' }];
    }
    const output = shellCapture('wmctrl -lp 2>/dev/null || true');
    return String(output || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({ raw: line }));
  } catch (error) {
    return [{ unsupported: true, error: error.message }];
  }
}

async function focusWindowById(windowId) {
  try {
    if (!windowId) {
      return { unsupported: true, reason: 'missing-window-id' };
    }
    if (commandExists('xdotool')) {
      run('bash', ['-lc', `xdotool windowactivate --sync ${JSON.stringify(String(windowId))} >/dev/null 2>&1 || true`]);
    }
    if (commandExists('wmctrl')) {
      run('bash', ['-lc', `wmctrl -ia ${JSON.stringify(String(windowId))} >/dev/null 2>&1 || true`]);
    }
    return getForegroundWindow();
  } catch (error) {
    return { unsupported: true, error: error.message };
  }
}

async function focusWindow(title) {
  try {
    if (!commandExists('wmctrl')) {
      return { unsupported: true, reason: 'wmctrl-missing' };
    }
    shellCapture(`wmctrl -a ${JSON.stringify(String(title || ''))}`);
    return getForegroundWindow();
  } catch (error) {
    return { unsupported: true, error: error.message };
  }
}

async function launchDefaultApp() {
  const tools = getToolAvailability();
  const command = tools.gnomeTextEditor
    ? 'gnome-text-editor'
    : tools.gedit
      ? 'gedit'
      : null;

  if (!command) {
    return { ok: false, unsupported: true, reason: 'no-supported-editor-found' };
  }

  try {
    run('bash', ['-lc', `${command} >/dev/null 2>&1 &`]);

    let editorWindow = null;
    let foreground = await getForegroundWindow();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      editorWindow = findEditorWindow(command) || editorWindow;
      if (editorWindow && editorWindow.id) {
        await focusWindowById(editorWindow.id).catch(() => null);
      }
      foreground = await getForegroundWindow();
      if (foregroundLooksLikeEditor(foreground, command, editorWindow)) {
        break;
      }
      await sleep(250);
    }

    return {
      ok: true,
      appId: command,
      launched: true,
      editorWindow,
      foreground
    };
  } catch (error) {
    return { ok: false, appId: command, error: error.message };
  }
}

async function closeDefaultApp(instance) {
  if (!instance || !instance.appId) {
    return { ok: false, skipped: true, reason: 'missing-app-id' };
  }
  const result = run('bash', ['-lc', `pkill -f ${JSON.stringify(instance.appId)} >/dev/null 2>&1 || true`]);
  return { ok: result.status === 0 || result.status === 1, appId: instance.appId };
}

async function killBrowserProcesses() {
  const script = [
    'for name in chromium chrome chrome_crashpad_handler; do',
    '  pkill -x "$name" >/dev/null 2>&1 || true',
    'done',
    'exit 0'
  ].join('\n');
  const result = run('bash', ['-lc', script]);
  return { ok: result.status === 0, status: result.status };
}

async function killDefaultAppProcesses() {
  const result = run('bash', ['-lc', 'pkill -f "gnome-text-editor|gedit" >/dev/null 2>&1 || true']);
  return { ok: result.status === 0, status: result.status };
}

async function screenshot(outputPath) {
  const resolved = path.resolve(outputPath);
  if (commandExists('gnome-screenshot')) {
    const result = run('gnome-screenshot', ['-f', resolved]);
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'gnome-screenshot failed').trim());
    return resolved;
  }
  if (commandExists('import')) {
    const result = run('import', ['-window', 'root', resolved]);
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'import failed').trim());
    return resolved;
  }
  throw new Error('No supported Linux screenshot tool found');
}

module.exports = {
  key: 'linux',
  getToolAvailability,
  getForegroundWindow,
  listTopLevelWindows,
  focusWindow,
  focusWindowById,
  launchDefaultApp,
  closeDefaultApp,
  killBrowserProcesses,
  killDefaultAppProcesses,
  screenshot
};
