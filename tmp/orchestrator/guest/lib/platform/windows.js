'use strict';

const path = require('path');
const {
  runCommand,
  getForegroundWindowInfo,
  getTopLevelWindows,
  launchAndFocusNotepad,
  stopProcessById,
  focusWindowByTitle,
  captureDesktopScreenshot
} = require('../powershell');

function commandExists(command) {
  try {
    const result = runCommand('where', [command]);
    return result.status === 0 && !!String(result.stdout || '').trim();
  } catch (_) {
    return false;
  }
}

function getToolAvailability() {
  return {
    powershell: commandExists('powershell'),
    node: commandExists('node'),
    chrome: commandExists('chrome'),
    notepad: commandExists('notepad')
  };
}

async function getForegroundWindow() {
  return getForegroundWindowInfo();
}

async function listTopLevelWindows() {
  return getTopLevelWindows();
}

async function focusWindow(title) {
  return focusWindowByTitle(title);
}

async function launchDefaultApp() {
  const info = await launchAndFocusNotepad();
  return {
    ok: !!(info && info.processId),
    appId: 'notepad',
    ...info
  };
}

async function closeDefaultApp(instance) {
  if (!instance || !instance.processId) {
    return { ok: false, skipped: true, reason: 'missing-process-id' };
  }
  stopProcessById(instance.processId);
  return { ok: true, processId: instance.processId };
}

async function killBrowserProcesses() {
  const processes = ['chrome.exe', 'msedge.exe'];
  const results = [];
  for (const name of processes) {
    try {
      const result = runCommand('taskkill', ['/IM', name, '/F']);
      results.push({ process: name, status: result.status });
    } catch (error) {
      results.push({ process: name, error: error.message });
    }
  }
  return { ok: true, results };
}

async function killDefaultAppProcesses() {
  const processes = ['notepad.exe', 'CalculatorApp.exe', 'Calculator.exe'];
  const results = [];
  for (const name of processes) {
    try {
      const result = runCommand('taskkill', ['/IM', name, '/F']);
      results.push({ process: name, status: result.status });
    } catch (error) {
      results.push({ process: name, error: error.message });
    }
  }
  return { ok: true, results };
}

async function screenshot(outputPath) {
  const resolved = path.resolve(outputPath);
  captureDesktopScreenshot(resolved);
  return resolved;
}

module.exports = {
  key: 'windows',
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
