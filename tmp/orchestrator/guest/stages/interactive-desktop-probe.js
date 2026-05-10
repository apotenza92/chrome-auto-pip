'use strict';

const { detectPlatformKey, getPlatformAdapter } = require('../lib/platform');
const { getInteractiveDesktopState } = require('../lib/powershell');

async function run() {
  const platform = detectPlatformKey();
  const adapter = getPlatformAdapter();

  if (platform === 'windows') {
    const desktopState = getInteractiveDesktopState();
    return {
      ok: true,
      command: 'interactive-desktop-probe',
      summary: desktopState && desktopState.reason === 'interactive-parallels-service-terminal'
        ? 'Windows guest appears interactive even though the Parallels service terminal is currently foregrounded'
        : desktopState && desktopState.reason === 'interactive-no-foreground-window'
          ? 'Windows guest appears to have an interactive desktop even though no foreground window is currently reported'
        : desktopState && desktopState.interactive
          ? 'Windows guest appears to have an interactive unlocked desktop'
        : desktopState && desktopState.reason === 'locked'
          ? 'Windows guest appears to be on a locked desktop'
          : desktopState && desktopState.reason === 'logon-screen'
            ? 'Windows guest appears to be sitting at the logon screen with no interactive user shell'
            : desktopState && desktopState.reason === 'no-foreground-window'
              ? 'Windows guest has no foreground window and does not currently look interactive'
              : 'Windows guest appears to be on a non-interactive Parallels service desktop',
      details: {
        platform,
        interactive: !!(desktopState && desktopState.interactive),
        locked: !!(desktopState && desktopState.locked),
        desktopState
      }
    };
  }

  const foreground = adapter.getForegroundWindow
    ? await adapter.getForegroundWindow().catch((error) => ({ error: error.message }))
    : null;

  return {
    ok: true,
    command: 'interactive-desktop-probe',
    summary: 'Collected current desktop/foreground information for this target',
    details: {
      platform,
      foreground,
      display: process.env.DISPLAY || null,
      waylandDisplay: process.env.WAYLAND_DISPLAY || null,
      xdgSessionType: process.env.XDG_SESSION_TYPE || null
    }
  };
}

module.exports = { run };
