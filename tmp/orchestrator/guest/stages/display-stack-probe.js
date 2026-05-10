'use strict';

const { spawnSync } = require('child_process');
const { detectPlatformKey } = require('../lib/platform');

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error) {
    return { status: 1, stdout: '', stderr: result.error.message };
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

async function runStage() {
  const platform = detectPlatformKey();

  if (platform === 'windows') {
    return {
      ok: true,
      command: 'display-stack-probe',
      summary: 'Windows guest is assumed to provide an interactive desktop for headed browser automation',
      details: {
        platform,
        interactiveDesktopAssumed: true,
        sessionName: process.env.SESSIONNAME || null
      }
    };
  }

  if (platform === 'macos') {
    const hasWindowServer = run('sh', ['-lc', 'ps ax | grep -v grep | grep -i WindowServer >/dev/null 2>&1']);
    return {
      ok: hasWindowServer.status === 0,
      command: 'display-stack-probe',
      summary: hasWindowServer.status === 0
        ? 'macOS guest appears to have WindowServer available for headed browser automation'
        : 'macOS guest does not appear to have WindowServer available',
      details: {
        platform,
        hasWindowServer: hasWindowServer.status === 0
      }
    };
  }

  const display = process.env.DISPLAY || null;
  const waylandDisplay = process.env.WAYLAND_DISPLAY || null;
  const sessionType = process.env.XDG_SESSION_TYPE || null;
  const xsetResult = run('sh', ['-lc', 'xset q >/dev/null 2>&1']);
  const hasUsableXDisplay = !!display && xsetResult.status === 0;
  const hasUsableWayland = !!waylandDisplay && sessionType === 'wayland';

  return {
    ok: hasUsableXDisplay || hasUsableWayland,
    command: 'display-stack-probe',
    summary: hasUsableXDisplay
      ? 'Linux guest has an active X display for headed browser automation'
      : hasUsableWayland
        ? 'Linux guest has an active Wayland desktop session for headed browser automation'
        : 'Linux guest does not currently expose a usable display session for headed browser automation',
    details: {
      platform,
      DISPLAY: display,
      WAYLAND_DISPLAY: waylandDisplay,
      XDG_SESSION_TYPE: sessionType,
      hasUsableXDisplay,
      hasUsableWayland,
      xsetStatus: xsetResult.status,
      xsetError: xsetResult.stderr ? xsetResult.stderr.trim() : null
    }
  };
}

module.exports = { run: runStage };
