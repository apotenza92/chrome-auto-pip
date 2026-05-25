#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { REGISTRY, localConfigPath } = require('./vm-registry');
const { getLinuxDesktopSessionContext } = require('./linux-desktop-session');

const MARKER = '__AUTO_PIP_RESULT__=';
const STAGE_TIMEOUT_MS = 120000;
const VM_BOOT_TIMEOUT_MS = 6 * 60 * 1000;
const VM_READY_MAX_ATTEMPTS = 3;
const VM_STOPPING_SETTLE_MS = 60 * 1000;
const STAGE_TIMEOUT_MULTIPLIER = {
  'guest-deps-install': 8,
  'guest-linux-desktop-tools-install': 8,
  'playwright-browser-install': 8,
  'window-open-close-probe': 3,
  'window-inventory-probe': 2,
  'app-launch-probe': 2,
  'video-probe': 2,
  'manual-pip-probe': 2,
  'browser-autopip-probe': 3,
  'extension-immediate-pip-probe': 2,
  'cpu-usage-benchmark': 3,
  'tab-switch-visual-proof': 3,
  'focus-window-probe': 2,
  'visibility-window-switch-probe': 2,
  'focus-app-probe': 2,
  'visibility-app-switch-probe': 2,
  'linux-app-focus-contract-probe': 3,
  'scenario-window-switch': 3,
  'scenario-app-switch': 3,
  'playwright-extension-e2e': 8,
  'dynamic-video-consistency': 10,
  'real-browser-use-youtube': 6,
  'visible-real-browser-use-youtube': 6,
  'helium-youtube-disable': 8
};
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const ACTIVE_TARGET_KEYS = ['windows', 'fedora', 'macos'];
const VM_RUN_LOCK_PATH = path.join(repoRoot, 'tmp', 'orchestrator', 'vm-run.lock');
const VM_RUN_LOCK_POLL_MS = 5000;

function parseArgs(argv) {
  const options = {
    target: 'windows',
    vmName: null,
    browser: null,
    flow: 'readiness',
    scenario: 'all',
    stage: null,
    continueOnFailure: false,
    timeoutScale: 1,
    runtimeRoot: null,
    browserChannel: null,
    browserExecutable: null,
    extensionPath: null,
    repeat: 1,
    startVm: true,
    suspendAfterRun: false,
    bootTimeoutMs: VM_BOOT_TIMEOUT_MS
  };

  argv.forEach((arg) => {
    if (arg === '--continue-on-failure') {
      options.continueOnFailure = true;
      return;
    }
    if (arg === '--no-start-vm') {
      options.startVm = false;
      return;
    }
    if (arg === '--suspend-after-run') {
      options.suspendAfterRun = true;
      return;
    }
    if (!arg.startsWith('--')) return;

    const eqIndex = arg.indexOf('=');
    const key = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
    const value = eqIndex === -1 ? 'true' : arg.slice(eqIndex + 1);

    if (key === 'target') options.target = value;
    if (key === 'vm-name') options.vmName = value;
    if (key === 'browser') options.browser = value;
    if (key === 'flow') options.flow = value;
    if (key === 'scenario') options.scenario = value;
    if (key === 'stage') options.stage = value;
    if (key === 'runtime-root') options.runtimeRoot = value;
    if (key === 'timeout-scale') options.timeoutScale = parseFloat(value) || 1;
    if (key === 'browser-channel') options.browserChannel = value;
    if (key === 'browser-executable') options.browserExecutable = value;
    if (key === 'extension-path') options.extensionPath = value;
    if (key === 'repeat') options.repeat = Math.max(1, parseInt(value, 10) || 1);
    if (key === 'boot-timeout-ms') options.bootTimeoutMs = Math.max(1000, parseInt(value, 10) || VM_BOOT_TIMEOUT_MS);
  });

  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runLocal(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`Command timed out after ${options.timeout || 'unknown'}ms`);
    }
    throw result.error;
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runLocalBinary(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'buffer',
    maxBuffer: 100 * 1024 * 1024,
    ...options
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`Command timed out after ${options.timeout || 'unknown'}ms`);
    }
    throw result.error;
  }

  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ''),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : (result.stderr || '')
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quotePosix(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function loadLocalConfig() {
  if (!fs.existsSync(localConfigPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${localConfigPath}: ${error.message}`);
  }
}

function resolveTarget(options) {
  const registryEntry = REGISTRY[options.target];
  if (!registryEntry) {
    throw new Error(`Unknown target '${options.target}'. Available targets: ${Object.keys(REGISTRY).join(', ')}`);
  }

  const localConfig = loadLocalConfig();
  const localTarget = localConfig.targets && localConfig.targets[options.target]
    ? localConfig.targets[options.target]
    : {};

  const merged = {
    ...registryEntry,
    ...localTarget
  };

  if (options.vmName) merged.vmName = options.vmName;
  if (options.runtimeRoot) merged.runtimeRoot = options.runtimeRoot;
  if (options.browser) merged.browser = options.browser;

  return merged;
}

function resolveRegistryTargetByKey(targetKey) {
  return resolveTarget({ target: targetKey });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function readVmRunLock() {
  if (!fs.existsSync(VM_RUN_LOCK_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(VM_RUN_LOCK_PATH, 'utf8'));
  } catch (error) {
    return null;
  }
}

async function acquireVmRunLock(details) {
  ensureDir(path.dirname(VM_RUN_LOCK_PATH));
  let announcedWait = false;

  while (true) {
    const payload = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      ...details
    };

    try {
      fs.writeFileSync(VM_RUN_LOCK_PATH, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
      if (announcedWait) {
        console.error(`[vm-lock] acquired for target=${details.target} after waiting`);
      }
      return payload;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const currentLock = readVmRunLock();
      if (!currentLock || !isProcessAlive(currentLock.pid)) {
        console.error(`[vm-lock] clearing stale lock at ${VM_RUN_LOCK_PATH}: ${JSON.stringify(currentLock || {})}`);
        try {
          fs.unlinkSync(VM_RUN_LOCK_PATH);
        } catch (unlinkError) {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        }
        continue;
      }
      if (!announcedWait) {
        const owner = currentLock.target || 'unknown';
        const scope = currentLock.stage ? `stage=${currentLock.stage}` : `flow=${currentLock.flow || 'readiness'}`;
        console.error(`[vm-lock] waiting for active VM run owned by pid=${currentLock.pid} target=${owner} ${scope}`);
        announcedWait = true;
      }
      await sleep(VM_RUN_LOCK_POLL_MS);
    }
  }
}

function releaseVmRunLock(lockPayload) {
  if (!lockPayload) return;
  const currentLock = readVmRunLock();
  if (currentLock && currentLock.pid !== process.pid) return;
  try {
    fs.unlinkSync(VM_RUN_LOCK_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function listVms() {
  const result = runLocal('prlctl', ['list', '--all', '--json']);
  if (result.status !== 0) {
    throw new Error(`Failed to list VMs\n${result.stdout}${result.stderr}`.trim());
  }
  return JSON.parse(result.stdout || '[]');
}

function getVmRecord(vmName) {
  return listVms().find((vm) => vm && vm.name === vmName) || null;
}

function getVmInfoText(vmName) {
  const result = runLocal('prlctl', ['list', '--info', vmName], { timeout: 30 * 1000 });
  if (result.status !== 0) {
    return '';
  }
  return result.stdout || '';
}

function getGuestToolsState(vmName) {
  const info = getVmInfoText(vmName);
  const toolsMatch = info.match(/GuestTools:\s*state=([^\s]+)/);
  const ipMatch = info.match(/IP Addresses:\s*(.*)/);
  return {
    toolsState: toolsMatch ? toolsMatch[1] : null,
    ipAddresses: ipMatch ? ipMatch[1].trim() : null,
    raw: info
  };
}

function suspendOtherActiveTargetVms(currentTarget) {
  const currentVmName = currentTarget && currentTarget.vmName;
  const managedTargets = ACTIVE_TARGET_KEYS
    .filter((targetKey) => targetKey !== currentTarget.key)
    .map((targetKey) => resolveRegistryTargetByKey(targetKey))
    .filter((target) => target && target.vmName);

  if (!managedTargets.length) return [];

  const vmRecords = listVms();
  const suspended = [];

  for (const target of managedTargets) {
    const vm = vmRecords.find((record) => record && record.name === target.vmName);
    if (!vm || vm.status !== 'running') continue;
    const result = closeVm(target, `before starting '${currentVmName}'`);
    suspended.push(target.vmName);
  }

  return suspended;
}

function waitForVmStatus(vmName, statuses, timeoutMs) {
  const wanted = new Set(Array.isArray(statuses) ? statuses : [statuses]);
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const current = getVmRecord(vmName);
    if (current && wanted.has(current.status)) return current;
    runLocal('sleep', ['2']);
  }
  return getVmRecord(vmName);
}

function isParallelsGuestSessionError(error) {
  const message = String(error && (error.stack || error.message) || error || '');
  return /prlctl exec failed \(255\)/i.test(message) ||
    /Unable to open new session in this virtual machine/i.test(message);
}

function isRetryableGuestReadyError(error) {
  const message = String(error && (error.stack || error.message) || error || '');
  return isParallelsGuestSessionError(error) ||
    /Timed out waiting for guest '.+' to become reachable/i.test(message);
}

function isMacosLoginRequired(target) {
  if (!target || target.guestFamily !== 'macos') return false;
  const tools = getGuestToolsState(target.vmName);
  const hasIp = !!(tools.ipAddresses && tools.ipAddresses !== '-');
  return tools.toolsState === 'not_installed' && !hasIp;
}

function forceStopVm(target, reason = 'restart recovery') {
  const before = getVmRecord(target.vmName);
  const result = runLocal('prlctl', ['stop', target.vmName, '--kill'], { timeout: 2 * 60 * 1000 });
  if (result.status !== 0) {
    throw new Error(`Failed to force-stop VM '${target.vmName}' (${reason})\n${result.stdout}${result.stderr}`.trim());
  }
  const after = waitForVmStatus(target.vmName, ['stopped'], 60 * 1000);
  return {
    action: 'stop-kill',
    reason,
    stdout: (result.stdout || '').trim(),
    before,
    after
  };
}

function closeVm(target, reason = 'after run') {
  const vm = getVmRecord(target.vmName);
  if (!vm || vm.status === 'stopped') {
    return { closed: false, alreadyStopped: true, reason, action: 'none' };
  }

  if (target.guestFamily === 'macos') {
    if (vm.status === 'suspended') {
      const dropResult = runLocal('prlctl', ['stop', target.vmName, '--drop-state'], { timeout: 2 * 60 * 1000 });
      if (dropResult.status !== 0) {
        throw new Error(`Failed to drop suspended state for VM '${target.vmName}' (${reason})\n${dropResult.stdout}${dropResult.stderr}`.trim());
      }
      return {
        closed: true,
        alreadyStopped: false,
        reason,
        action: 'drop-state',
        stdout: (dropResult.stdout || '').trim()
      };
    }

    let acpiResult;
    try {
      acpiResult = runLocal('prlctl', ['stop', target.vmName, '--acpi'], { timeout: 20 * 1000 });
    } catch (error) {
      acpiResult = {
        status: 124,
        stdout: '',
        stderr: error.message
      };
    }
    let finalStatus = waitForVmStatus(target.vmName, ['stopped'], 2 * 60 * 1000);
    if (acpiResult.status !== 0 || !finalStatus || finalStatus.status !== 'stopped') {
      const killResult = runLocal('prlctl', ['stop', target.vmName, '--kill'], { timeout: 2 * 60 * 1000 });
      if (killResult.status !== 0) {
        throw new Error(`Failed to stop VM '${target.vmName}' (${reason})\n${acpiResult.stdout}${acpiResult.stderr}${killResult.stdout}${killResult.stderr}`.trim());
      }
      finalStatus = getVmRecord(target.vmName);
      return {
        closed: true,
        alreadyStopped: false,
        reason,
        action: 'stop-kill',
        stdout: (killResult.stdout || '').trim(),
        finalStatus
      };
    }

    return {
      closed: true,
      alreadyStopped: false,
      reason,
      action: 'stop-acpi',
      stdout: (acpiResult.stdout || '').trim(),
      finalStatus
    };
  }

  const result = runLocal('prlctl', ['suspend', target.vmName], { timeout: 2 * 60 * 1000 });
  if (result.status !== 0) {
    throw new Error(`Failed to suspend VM '${target.vmName}' (${reason})\n${result.stdout}${result.stderr}`.trim());
  }

  return {
    closed: true,
    suspended: true,
    alreadyStopped: false,
    reason,
    action: 'suspend',
    stdout: (result.stdout || '').trim()
  };
}

async function ensureVmRunning(target, timeoutMs) {
  let existing = getVmRecord(target.vmName);
  if (!existing) {
    throw new Error(`Parallels VM '${target.vmName}' not found`);
  }

  const preflightActions = [];

  if (existing.status === 'stopping') {
    const settled = waitForVmStatus(target.vmName, ['stopped', 'running'], VM_STOPPING_SETTLE_MS);
    if (settled && settled.status !== 'stopping') {
      preflightActions.push({
        action: 'wait-stopping',
        before: existing,
        after: settled
      });
      existing = settled;
    } else {
      const stopped = forceStopVm(target, 'stopping-state recovery before start');
      preflightActions.push(stopped);
      existing = stopped.after || getVmRecord(target.vmName);
    }
  }

  if (target.guestFamily === 'macos' && existing.status === 'suspended') {
    const dropResult = runLocal('prlctl', ['stop', target.vmName, '--drop-state'], { timeout: 2 * 60 * 1000 });
    if (dropResult.status !== 0) {
      throw new Error(`Failed to drop stale suspended state for VM '${target.vmName}'\n${dropResult.stdout}${dropResult.stderr}`.trim());
    }
    preflightActions.push({
      action: 'drop-state',
      before: existing,
      stdout: (dropResult.stdout || '').trim()
    });
    existing = getVmRecord(target.vmName);
  }

  if (existing.status === 'running') {
    return { started: false, status: existing.status, preflightActions };
  }

  const startResult = runLocal('prlctl', ['start', target.vmName]);
  if (startResult.status !== 0) {
    throw new Error(`Failed to start VM '${target.vmName}'\n${startResult.stdout}${startResult.stderr}`.trim());
  }

  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const current = getVmRecord(target.vmName);
    if (current && current.status === 'running') {
      return {
        started: true,
        status: current.status,
        stdout: startResult.stdout.trim(),
        preflightActions
      };
    }
    await sleep(2000);
  }

  throw new Error(`Timed out waiting for VM '${target.vmName}' to enter running state`);
}

function buildPrlctlExecArgs(target, args) {
  const authArgs = target.execUser
    ? ['--user', target.execUser, '--password', target.execPassword || '']
    : target.forceCurrentUserAuth
      ? ['--current-user']
      : target.guestFamily === 'windows'
        ? []
        : ['--current-user'];
  return ['exec', target.vmName, ...authArgs, ...args];
}

function shouldUseWindowsCurrentUserForStage(target, stageName) {
  if (!target || target.guestFamily !== 'windows') return false;
  return new Set([
    'app-launch-probe',
    'tab-switch-visual-proof',
    'focus-app-probe',
    'visibility-app-switch-probe',
    'scenario-window-switch',
    'scenario-app-switch'
  ]).has(stageName);
}

function shouldUseLinuxDesktopUserForStage(target, stageName) {
  if (!target || target.guestFamily !== 'linux' || !target.execUser) return false;
  return new Set([
    'browser-session-probe',
    'extension-absence-probe',
    'extension-install-probe',
    'extension-reload-probe',
    'extension-storage-reset-probe',
    'tab-open-close-probe',
    'window-open-close-probe',
    'window-inventory-probe',
    'app-launch-probe',
    'extension-probe',
    'plugin-mode-roundtrip-probe',
    'plugin-debug-log-probe',
    'video-probe',
    'manual-pip-probe',
    'browser-autopip-probe',
    'extension-immediate-pip-probe',
    'cpu-usage-benchmark',
    'tab-switch-visual-proof',
    'focus-window-probe',
    'visibility-window-switch-probe',
    'focus-app-probe',
    'visibility-app-switch-probe',
    'linux-app-focus-contract-probe',
    'visibility-minimize-probe',
    'scenario-window-switch',
    'scenario-app-switch',
    'playwright-extension-e2e'
  ]).has(stageName);
}

function runPrlctlExec(target, args, options = {}) {
  const result = runLocal('prlctl', buildPrlctlExecArgs(target, args), options);
  if (result.status !== 0) {
    throw new Error(`prlctl exec failed (${result.status})\n${result.stdout}${result.stderr}`.trim());
  }
  return result;
}

async function waitForGuestReady(target, timeoutMs) {
  const command = Array.isArray(target.readyCommand) && target.readyCommand.length > 0
    ? target.readyCommand
    : target.guestFamily === 'windows'
      ? ['cmd', '/c', 'ver']
      : [target.shell || 'bash', '-lc', 'uname -a'];

  const startedAt = Date.now();
  let lastError = null;
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const result = runPrlctlExec(target, command, { timeout: 15000 });
      return result.stdout.trim() || result.stderr.trim();
    } catch (error) {
      if (!target.execUser && target.guestFamily === 'windows') {
        try {
          const fallback = runLocal('prlctl', ['exec', target.vmName, ...command], { timeout: 15000 });
          if (fallback.status === 0) {
            return fallback.stdout.trim() || fallback.stderr.trim();
          }
        } catch (_) {
          // Fall through to normal retry behavior.
        }
      }
      lastError = error;
      await sleep(5000);
    }
  }

  throw new Error(`Timed out waiting for guest '${target.vmName}' to become reachable${lastError ? `: ${lastError.message}` : ''}`);
}

function parseGuestResult(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith(MARKER)) continue;
    return JSON.parse(line.slice(MARKER.length));
  }
  throw new Error(`Guest result marker not found in output:\n${output}`);
}

function toGuestSharedPath(absolutePath, target) {
  const normalized = path.resolve(absolutePath);
  const homeDir = os.homedir();

  if (!normalized.startsWith(homeDir)) {
    throw new Error(`Cannot map path outside home directory: ${normalized}`);
  }

  const relative = normalized.slice(homeDir.length).split(path.sep).filter(Boolean);

  if (target.guestFamily === 'windows') {
    return relative.length > 0
      ? path.win32.join(target.sharedHomeRoot, ...relative)
      : target.sharedHomeRoot;
  }

  return relative.length > 0
    ? path.posix.join(target.sharedHomeRoot, ...relative)
    : target.sharedHomeRoot;
}

function buildWindowsSyncScript(sharedRoot, runtimeRoot) {
  const robocopyCalls = [
    [`${sharedRoot}`, `${runtimeRoot}`, ['manifest.json', 'main.js', 'options.html', 'options.js', 'package.json', 'package-lock.json', 'playwright.config.js', 'reload-extension.html', 'reload-extension.js', 'dump-log.html', 'dump-log.js', 'prime-active-tab.html', 'prime-active-tab.js', 'set-switch-modes.html', 'set-switch-modes.js', 'clear-debug-log.html', 'clear-debug-log.js', 'enable-debug-stream.html', 'enable-debug-stream.js', 'disable-debug-stream.html', 'disable-debug-stream.js'], []],
    [path.win32.join(sharedRoot, 'scripts'), path.win32.join(runtimeRoot, 'scripts'), ['*'], ['/E']],
    [path.win32.join(sharedRoot, 'assets'), path.win32.join(runtimeRoot, 'assets'), ['icon.png'], []],
    [path.win32.join(sharedRoot, 'tests', 'fixtures'), path.win32.join(runtimeRoot, 'tests', 'fixtures'), ['*'], ['/E']],
    [path.win32.join(sharedRoot, 'tests', 'e2e'), path.win32.join(runtimeRoot, 'tests', 'e2e'), ['*'], ['/E']],
    [path.win32.join(sharedRoot, 'tmp', 'orchestrator'), path.win32.join(runtimeRoot, 'tmp', 'orchestrator'), ['*'], ['/E']],
  ];

  const lines = [`$ErrorActionPreference = 'Stop'`];

  robocopyCalls.forEach(([source, dest, files, extraArgs]) => {
    const parts = ['& robocopy', quoteCmd(source), quoteCmd(dest), ...files, ...extraArgs, '/R:1', '/W:1'];
    lines.push(parts.join(' '));
    lines.push('if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE }');
  });

  lines.push('exit 0');
  return ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', lines.join('; ')];
}

function buildPosixSyncCommand(sharedRoot, runtimeRoot, shell = 'bash') {
  const entries = [
    { src: path.posix.join(sharedRoot, 'manifest.json'), dest: path.posix.join(runtimeRoot, 'manifest.json'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'main.js'), dest: path.posix.join(runtimeRoot, 'main.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'options.html'), dest: path.posix.join(runtimeRoot, 'options.html'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'options.js'), dest: path.posix.join(runtimeRoot, 'options.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'reload-extension.html'), dest: path.posix.join(runtimeRoot, 'reload-extension.html'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'reload-extension.js'), dest: path.posix.join(runtimeRoot, 'reload-extension.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'dump-log.html'), dest: path.posix.join(runtimeRoot, 'dump-log.html'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'dump-log.js'), dest: path.posix.join(runtimeRoot, 'dump-log.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'prime-active-tab.html'), dest: path.posix.join(runtimeRoot, 'prime-active-tab.html'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'prime-active-tab.js'), dest: path.posix.join(runtimeRoot, 'prime-active-tab.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'set-switch-modes.html'), dest: path.posix.join(runtimeRoot, 'set-switch-modes.html'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'set-switch-modes.js'), dest: path.posix.join(runtimeRoot, 'set-switch-modes.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'clear-debug-log.html'), dest: path.posix.join(runtimeRoot, 'clear-debug-log.html'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'clear-debug-log.js'), dest: path.posix.join(runtimeRoot, 'clear-debug-log.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'enable-debug-stream.html'), dest: path.posix.join(runtimeRoot, 'enable-debug-stream.html'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'enable-debug-stream.js'), dest: path.posix.join(runtimeRoot, 'enable-debug-stream.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'disable-debug-stream.html'), dest: path.posix.join(runtimeRoot, 'disable-debug-stream.html'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'disable-debug-stream.js'), dest: path.posix.join(runtimeRoot, 'disable-debug-stream.js'), type: 'file' },
    { src: path.posix.join(sharedRoot, 'scripts'), dest: path.posix.join(runtimeRoot, 'scripts'), type: 'dir' },
    { src: path.posix.join(sharedRoot, 'assets'), dest: path.posix.join(runtimeRoot, 'assets'), type: 'dir' },
    { src: path.posix.join(sharedRoot, 'tests', 'fixtures'), dest: path.posix.join(runtimeRoot, 'tests', 'fixtures'), type: 'dir' },
    { src: path.posix.join(sharedRoot, 'tests', 'e2e'), dest: path.posix.join(runtimeRoot, 'tests', 'e2e'), type: 'dir' },
    { src: path.posix.join(sharedRoot, 'tmp', 'orchestrator'), dest: path.posix.join(runtimeRoot, 'tmp', 'orchestrator'), type: 'dir' }
  ];

  const lines = [
    'set -e',
    `mkdir -p ${quotePosix(runtimeRoot)}`,
    'copy_path() {',
    '  src="$1"',
    '  dest="$2"',
    '  kind="$3"',
    '  if [ ! -e "$src" ]; then',
    '    echo "Missing sync source: $src" >&2',
    '    exit 1',
    '  fi',
    '  mkdir -p "$(dirname "$dest")"',
    '  if [ "$kind" = "dir" ]; then',
    '    rm -rf "$dest"',
    '    cp -R "$src" "$dest"',
    '  else',
    '    cp "$src" "$dest"',
    '  fi',
    '}'
  ];

  entries.forEach((entry) => {
    lines.push(`copy_path ${quotePosix(entry.src)} ${quotePosix(entry.dest)} ${quotePosix(entry.type)}`);
  });

  return [shell, '-lc', lines.join('\n')];
}

function buildSyncCommand(target, sharedRepoRoot) {
  if (target.guestFamily === 'windows') {
    return buildWindowsSyncScript(sharedRepoRoot, target.runtimeRoot);
  }
  return buildPosixSyncCommand(sharedRepoRoot, target.runtimeRoot, target.shell || 'bash');
}

function buildNodeRuntimeArchive() {
  const nodeBinaryPath = fs.realpathSync(process.execPath);
  const nodeRoot = path.resolve(nodeBinaryPath, '..', '..');
  const result = runLocalBinary('tar', ['-czf', '-', '.'], {
    cwd: nodeRoot,
    timeout: 120000,
    env: {
      ...process.env,
      COPYFILE_DISABLE: '1'
    }
  });
  if (result.status !== 0) {
    throw new Error(`Failed to build Node runtime archive\n${result.stderr}`.trim());
  }
  return {
    archive: result.stdout,
    nodeRoot,
    nodeBinaryPath
  };
}

function buildSyncArchive() {
  const entries = [
    'manifest.json',
    'main.js',
    'options.html',
    'options.js',
    'package.json',
    'package-lock.json',
    'playwright.config.js',
    'reload-extension.html',
    'reload-extension.js',
    'dump-log.html',
    'dump-log.js',
    'prime-active-tab.html',
    'prime-active-tab.js',
    'set-switch-modes.html',
    'set-switch-modes.js',
    'clear-debug-log.html',
    'clear-debug-log.js',
    'enable-debug-stream.html',
    'enable-debug-stream.js',
    'disable-debug-stream.html',
    'disable-debug-stream.js',
    'scripts',
    'assets',
    'tests/fixtures',
    'tests/e2e',
    'tmp/orchestrator'
  ];

  const result = runLocalBinary('tar', ['-czf', '-', ...entries], {
    cwd: repoRoot,
    timeout: 120000,
    env: {
      ...process.env,
      COPYFILE_DISABLE: '1'
    }
  });
  if (result.status !== 0) {
    throw new Error(`Failed to build sync archive\n${result.stderr}`.trim());
  }
  return result.stdout;
}

function buildGuestStageCommand(target, stageName, stageArtifactDir, options) {
  const browser = options.browser || target.browser || 'chromium';
  const nodeCommand = options.nodeCommand || target.nodeCommand || 'node';


  if (target.guestFamily === 'windows') {
    const guestScript = path.win32.join(target.runtimeRoot, 'tmp', 'orchestrator', 'guest.js');
    const userProfile = target.windowsUserProfile || path.win32.dirname(path.win32.dirname(target.runtimeRoot));
    const localAppData = path.win32.join(userProfile, 'AppData', 'Local');
    const roamingAppData = path.win32.join(userProfile, 'AppData', 'Roaming');
    const browsersPath = path.win32.join(localAppData, 'ms-playwright');
    const homeDrive = path.win32.parse(userProfile).root.replace(/[\\/]+$/, '');
    const homePath = userProfile.slice(homeDrive.length) || '\\';
    let cmd = `cd /d ${quoteCmd(target.runtimeRoot)} && set "USERPROFILE=${userProfile}" && set "HOME=${userProfile}" && set "HOMEDRIVE=${homeDrive}" && set "HOMEPATH=${homePath}" && set "LOCALAPPDATA=${localAppData}" && set "APPDATA=${roamingAppData}" && set "PLAYWRIGHT_BROWSERS_PATH=${browsersPath}" && ${nodeCommand} ${quoteCmd(guestScript)} --command=${stageName} --artifacts=${quoteCmd(stageArtifactDir)}`;
    cmd += ` --browser=${browser}`;
    if (options.browserChannel) cmd += ` --browser-channel=${quoteCmd(options.browserChannel)}`;
    if (options.browserExecutable) cmd += ` --browser-executable=${quoteCmd(options.browserExecutable)}`;
    if (options.timeoutScale !== 1) cmd += ` --timeout-scale=${options.timeoutScale}`;
    if (options.hostStageStartedAt) cmd += ` --host-stage-started-at=${quoteCmd(options.hostStageStartedAt)}`;
    if (options.hostStageStartedEpochMs != null) cmd += ` --host-stage-started-epoch-ms=${options.hostStageStartedEpochMs}`;
    return ['cmd', '/c', cmd];
  }

  const guestScript = path.posix.join(target.runtimeRoot, 'tmp', 'orchestrator', 'guest.js');
  const cliArgs = [
    guestScript,
    `--command=${stageName}`,
    `--artifacts=${stageArtifactDir}`,
    `--browser=${browser}`
  ];
  if (options.browserChannel) cliArgs.push(`--browser-channel=${options.browserChannel}`);
  if (options.browserExecutable) cliArgs.push(`--browser-executable=${options.browserExecutable}`);
  if (options.extensionPath) cliArgs.push(`--extension-path=${options.extensionPath}`);
  if (options.timeoutScale !== 1) cliArgs.push(`--timeout-scale=${options.timeoutScale}`);
  if (options.hostStageStartedAt) cliArgs.push(`--host-stage-started-at=${options.hostStageStartedAt}`);
  if (options.hostStageStartedEpochMs != null) cliArgs.push(`--host-stage-started-epoch-ms=${options.hostStageStartedEpochMs}`);

  const extraEnv = options.extraEnv || null;
  if (extraEnv && Object.keys(extraEnv).length > 0) {
    return [
      'env',
      ...Object.entries(extraEnv)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${key}=${value}`),
      nodeCommand,
      ...cliArgs
    ];
  }

  return [nodeCommand, ...cliArgs];
}

class HostOrchestrator {
  constructor(options) {
    this.options = options;
    this.target = resolveTarget(options);
    this.sharedRepoRoot = this.target.guestFamily === 'windows'
      ? toGuestSharedPath(repoRoot, this.target)
      : null;
    this.artifactRoot = path.join(
      repoRoot,
      'tmp',
      'orchestrator-artifacts',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${this.target.key}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    );
    ensureDir(this.artifactRoot);
    this.guestArtifactRoot = this.target.guestFamily === 'windows'
      ? toGuestSharedPath(this.artifactRoot, this.target)
      : path.posix.join(this.target.runtimeRoot, 'tmp', 'orchestrator-artifacts', path.basename(this.artifactRoot));
    this.stageResults = [];
    this.linuxDesktopSessionEnv = undefined;
    this.linuxDesktopSessionEnvError = null;
  }

  getPlannedStages() {
    if (this.options.stage) return [this.options.stage];

    if (this.options.flow === 'bootstrap') {
      return [
        'guest-prereq-probe',
        'sync',
        'guest-node-bootstrap',
        'guest-prereq-probe',
        'guest-runtime-probe',
        'guest-project-deps-probe',
        'guest-deps-install',
        'guest-project-deps-probe',
        'env-probe',
        'playwright-browser-probe',
        'playwright-browser-install',
        'playwright-browser-probe',
        'browser-headless-session-probe',
        'guest-linux-desktop-tools-probe'
      ];
    }

    if (this.options.flow === 'linux-display-bootstrap') {
      return [
        'guest-prereq-probe',
        'sync',
        'guest-node-bootstrap',
        'guest-prereq-probe',
        'guest-linux-desktop-tools-probe',
        'guest-linux-desktop-tools-install',
        'guest-linux-desktop-tools-probe',
        'display-stack-probe'
      ];
    }

    if (this.options.flow === 'core-primitives') {
      return [
        'guest-prereq-probe',
        'sync',
        'guest-node-bootstrap',
        'guest-prereq-probe',
        'guest-runtime-probe',
        'guest-project-deps-probe',
        'env-probe',
        'playwright-browser-probe',
        'browser-headless-session-probe',
        'guest-linux-desktop-tools-probe',
        'platform-tools-probe',
        'display-stack-probe',
        'browser-session-probe',
        'extension-absence-probe',
        'extension-install-probe',
        'extension-reload-probe',
        'extension-storage-reset-probe',
        'tab-open-close-probe',
        'window-open-close-probe',
        'window-inventory-probe',
        'app-launch-probe',
        'extension-probe',
        'plugin-mode-roundtrip-probe',
        'plugin-debug-log-probe'
      ];
    }

    if (this.options.flow === 'windows-switch-primitives' || this.options.flow === 'switch-primitives') {
      return [
        'guest-prereq-probe',
        'sync',
        'env-probe',
        'playwright-browser-probe',
        'display-stack-probe',
        'interactive-desktop-probe',
        'video-probe',
        'manual-pip-probe',
        'browser-autopip-probe',
        'focus-window-probe',
        'visibility-window-switch-probe',
        'focus-app-probe',
        'visibility-app-switch-probe'
      ];
    }

    if (this.options.flow === 'windows-scenarios' || this.options.flow === 'scenarios') {
      return [
        'guest-prereq-probe',
        'sync',
        'env-probe',
        'playwright-browser-probe',
        'display-stack-probe',
        'interactive-desktop-probe',
        'scenario-window-switch',
        'scenario-app-switch'
      ];
    }

    if (this.options.flow === 'full-extension-e2e') {
      return [
        'guest-prereq-probe',
        'sync',
        'env-probe',
        'playwright-browser-probe',
        'display-stack-probe',
        'interactive-desktop-probe',
        'playwright-extension-e2e'
      ];
    }

    if (this.options.flow === 'dynamic-video-consistency') {
      return [
        'guest-prereq-probe',
        'sync',
        'env-probe',
        'playwright-browser-probe',
        'display-stack-probe',
        'interactive-desktop-probe',
        'dynamic-video-consistency'
      ];
    }

    if (this.options.flow === 'real-browser-use-youtube') {
      return [
        'guest-prereq-probe',
        'sync',
        'env-probe',
        'playwright-browser-probe',
        'display-stack-probe',
        'interactive-desktop-probe',
        'real-browser-use-youtube'
      ];
    }

    if (this.options.flow === 'visible-real-browser-use-youtube') {
      return [
        'guest-prereq-probe',
        'sync',
        'env-probe',
        'playwright-browser-probe',
        'display-stack-probe',
        'interactive-desktop-probe',
        'visible-real-browser-use-youtube'
      ];
    }

    if (this.options.flow === 'helium-youtube-disable') {
      return [
        'guest-prereq-probe',
        'sync',
        'env-probe',
        'playwright-browser-probe',
        'display-stack-probe',
        'interactive-desktop-probe',
        'helium-youtube-disable'
      ];
    }

    if (this.options.flow === 'visual-proof') {
      return [
        'guest-prereq-probe',
        'sync',
        'env-probe',
        'playwright-browser-probe',
        'display-stack-probe',
        'interactive-desktop-probe',
        'tab-switch-visual-proof'
      ];
    }

    if (this.options.flow === 'readiness') {
      const stages = [
        'guest-prereq-probe',
        'sync',
        'guest-node-bootstrap',
        'guest-prereq-probe',
        'guest-runtime-probe',
        'guest-project-deps-probe',
        'env-probe',
        'playwright-browser-probe',
        'browser-headless-session-probe',
        'guest-linux-desktop-tools-probe',
        'platform-tools-probe',
        'display-stack-probe',
        'browser-session-probe',
        'extension-absence-probe',
        'extension-install-probe',
        'extension-reload-probe',
        'extension-storage-reset-probe',
        'tab-open-close-probe',
        'window-open-close-probe',
        'window-inventory-probe',
        'app-launch-probe',
        'extension-probe'
      ];

      if (this.target.guestFamily === 'windows') {
        stages.push(
          'video-probe',
          'manual-pip-probe',
          'browser-autopip-probe',
          'focus-window-probe',
          'visibility-window-switch-probe',
          'focus-app-probe',
          'visibility-app-switch-probe'
        );
      }
      return stages;
    }

    if (this.options.flow === 'known-good') {
      const stages = ['guest-prereq-probe', 'sync', 'guest-node-bootstrap', 'guest-prereq-probe', 'guest-project-deps-probe', 'env-probe', 'extension-probe', 'video-probe'];
      if (this.options.scenario === 'all' || this.options.scenario === 'window') stages.push('scenario-window-switch');
      if (this.options.scenario === 'all' || this.options.scenario === 'app') stages.push('scenario-app-switch');
      return stages;
    }

    const stages = [
      'guest-prereq-probe',
      'sync',
      'guest-node-bootstrap',
      'guest-prereq-probe',
      'env-probe',
      'extension-probe',
      'video-probe',
      'focus-window-probe',
      'visibility-window-switch-probe',
      'focus-app-probe',
      'visibility-app-switch-probe'
    ];

    if (this.options.scenario === 'all' || this.options.scenario === 'window') stages.push('scenario-window-switch');
    if (this.options.scenario === 'all' || this.options.scenario === 'app') stages.push('scenario-app-switch');
    return stages;
  }

  shouldContinueAfterFailure(stageName) {
    const remediableStages = new Set([
      'guest-prereq-probe',
      'guest-project-deps-probe',
      'playwright-browser-probe',
      'guest-linux-desktop-tools-probe'
    ]);
    if (this.options.continueOnFailure) return true;
    return remediableStages.has(stageName);
  }

  recordStage(stageName, payload) {
    const stageFile = path.join(this.artifactRoot, `${this.stageResults.length.toString().padStart(2, '0')}-${stageName}.json`);
    const record = {
      stage: stageName,
      recordedAt: new Date().toISOString(),
      payload
    };
    fs.writeFileSync(stageFile, `${JSON.stringify(record, null, 2)}\n`);
    this.stageResults.push(record);
  }

  async ensureVmReady() {
    const suspendedVmNames = suspendOtherActiveTargetVms(this.target);
    let lastError = null;

    for (let attempt = 1; attempt <= VM_READY_MAX_ATTEMPTS; attempt += 1) {
      let bootInfo = null;
      try {
        if (this.options.startVm !== false) {
          bootInfo = await ensureVmRunning(this.target, this.options.bootTimeoutMs);
        }

        if (isMacosLoginRequired(this.target)) {
          const error = new Error(`macOS guest '${this.target.vmName}' requires interactive login before Parallels Tools exposes guest execution`);
          error.macosLoginRequired = true;
          this.recordStage('vm-login-required', {
            ok: false,
            summary: 'macOS guest is running at the login screen; Parallels Tools and prlctl exec are unavailable until the user logs in',
            vmName: this.target.vmName,
            guestFamily: this.target.guestFamily,
            attempt,
            guestTools: getGuestToolsState(this.target.vmName),
            error: error.message
          });
          throw error;
        }

        const guestVersion = await waitForGuestReady(this.target, this.options.bootTimeoutMs);

        if (this.options.startVm !== false) {
          this.recordStage('vm-boot', {
            ok: true,
            summary: bootInfo.started ? 'VM booted successfully' : 'VM was already running',
            vmName: this.target.vmName,
            attempt,
            suspendedVmNames,
            bootInfo: {
              ...bootInfo,
              suspendedVmNames
            }
          });
        }

        this.recordStage('vm-ready', {
          ok: true,
          summary: 'Parallels guest command execution works',
          guestVersion,
          vmName: this.target.vmName,
          guestFamily: this.target.guestFamily,
          attempt
        });
        return;
      } catch (error) {
        lastError = error;
        if (error && error.macosLoginRequired === true) {
          throw error;
        }
        const retryable = isRetryableGuestReadyError(error);
        const macosLoginRequired = isMacosLoginRequired(this.target);
        if (macosLoginRequired) {
          this.recordStage('vm-login-required', {
            ok: false,
            summary: 'macOS guest is running at the login screen; Parallels Tools and prlctl exec are unavailable until the user logs in',
            vmName: this.target.vmName,
            guestFamily: this.target.guestFamily,
            attempt,
            guestTools: getGuestToolsState(this.target.vmName),
            lastGuestExecError: error.stack || error.message
          });
          throw error;
        }
        if (!retryable || attempt >= VM_READY_MAX_ATTEMPTS) {
          this.recordStage('vm-ready', {
            ok: false,
            summary: `Parallels guest readiness failed: ${error.message}`,
            error: error.stack || error.message,
            vmName: this.target.vmName,
            guestFamily: this.target.guestFamily,
            attempt,
            retryable
          });
          throw error;
        }

        let recovery = null;
        try {
          recovery = forceStopVm(this.target, `guest readiness retry ${attempt}`);
        } catch (recoveryError) {
          recovery = {
            action: 'stop-kill',
            ok: false,
            error: recoveryError.stack || recoveryError.message,
            before: getVmRecord(this.target.vmName),
            after: getVmRecord(this.target.vmName)
          };
        }

        this.recordStage('vm-recovery', {
          ok: recovery && recovery.ok === false ? false : true,
          summary: `Recovered VM after guest readiness failure; retrying (${attempt + 1}/${VM_READY_MAX_ATTEMPTS})`,
          vmName: this.target.vmName,
          guestFamily: this.target.guestFamily,
          attempt,
          nextAttempt: attempt + 1,
          action: recovery ? recovery.action : null,
          recovery,
          lastGuestExecError: error.stack || error.message
        });

        if (recovery && recovery.ok === false) {
          throw error;
        }

        await sleep(2000);
      }
    }

    throw lastError || new Error(`Failed to prepare VM '${this.target.vmName}'`);
  }

  runGuestPowerShellJson(script, timeout = 30000) {
    const result = runPrlctlExec(this.target, ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout });
    return JSON.parse(result.stdout || '{}');
  }

  runGuestPosixKeyValueScript(script, timeout = 30000) {
    const result = runLocal('prlctl', buildPrlctlExecArgs(this.target, [this.target.shell || 'bash', '-s']), {
      timeout,
      input: script,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.status !== 0) {
      throw new Error(`prlctl exec failed (${result.status})\n${result.stdout}${result.stderr}`.trim());
    }
    const details = {};
    String(result.stdout || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        const index = line.indexOf('=');
        if (index === -1) return;
        const key = line.slice(0, index);
        const value = line.slice(index + 1);
        details[key] = value || null;
      });
    return details;
  }

  getLinuxDesktopSessionEnvironment() {
    if (this.target.guestFamily !== 'linux') return null;
    if (this.linuxDesktopSessionEnv !== undefined) {
      return this.linuxDesktopSessionEnv;
    }

    this.linuxDesktopSessionEnv = null;
    this.linuxDesktopSessionEnvError = null;
    this.linuxDesktopSessionContext = null;

    try {
      const context = getLinuxDesktopSessionContext(this.target);
      this.linuxDesktopSessionContext = context;
      if (!context || !context.sessionEnv) {
        this.linuxDesktopSessionEnvError = 'No usable Linux desktop session environment was discovered';
        return null;
      }
      this.linuxDesktopSessionEnv = context.sessionEnv;
      return this.linuxDesktopSessionEnv;
    } catch (error) {
      this.linuxDesktopSessionEnvError = error.message;
      return null;
    }
  }

  buildLinuxGuestStageEnvironment() {
    if (this.target.guestFamily !== 'linux') return null;
    const env = {
      ...(this.getLinuxDesktopSessionEnvironment() || {})
    };

    if (this.target.guestStageExecMode === 'root') {
      const userHome = this.target.userHome || path.posix.dirname(this.target.runtimeRoot);
      const userName = this.target.execUser || path.posix.basename(userHome);
      env.HOME = env.HOME || userHome;
      env.USER = env.USER || userName;
      env.LOGNAME = env.LOGNAME || userName;
      env.XDG_CACHE_HOME = env.XDG_CACHE_HOME || path.posix.join(userHome, '.cache');
      env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH || path.posix.join(env.XDG_CACHE_HOME, 'ms-playwright');
    }

    return env;
  }

  probeConfiguredGuestCommand(commandPath, versionArg = '--version') {
    if (!commandPath) return null;
    try {
      const result = runLocal('prlctl', buildPrlctlExecArgs(this.target, [commandPath, versionArg]), { timeout: 15000 });
      const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      if (result.status !== 0) return null;
      if (!combined) return null;
      if (/Library not loaded|dyld\[|command not found|not recognized/i.test(combined)) return null;
      return {
        path: commandPath,
        version: combined
      };
    } catch (_) {
      return null;
    }
  }

  bootstrapGuestNodeRuntime() {
    if ((this.target.guestFamily !== 'macos' && this.target.guestFamily !== 'linux') || !this.target.nodeRoot || !this.target.nodeCommand) {
      return {
        ok: true,
        skipped: true,
        command: 'guest-node-bootstrap',
        summary: 'Guest Node bootstrap is not required for this target',
        details: {
          guestFamily: this.target.guestFamily,
          nodeRoot: this.target.nodeRoot || null,
          nodeCommand: this.target.nodeCommand || null
        }
      };
    }

    const existing = this.probeConfiguredGuestCommand(this.target.nodeCommand, '--version');
    if (existing) {
      return {
        ok: true,
        skipped: true,
        command: 'guest-node-bootstrap',
        summary: 'Guest Node runtime is already available at the configured path',
        details: {
          nodeCommand: existing.path,
          nodeVersion: existing.version,
          nodeRoot: this.target.nodeRoot
        }
      };
    }

    if (this.target.nodeBootstrapUrl) {
      const bootstrapScript = [
        'set -e',
        `NODE_ROOT=${quotePosix(this.target.nodeRoot)}`,
        `NODE_URL=${quotePosix(this.target.nodeBootstrapUrl)}`,
        'TMP_DIR=$(mktemp -d /tmp/pi-node-bootstrap.XXXXXX)',
        'ARCHIVE_PATH="$TMP_DIR/node.tar.gz"',
        'mkdir -p "$NODE_ROOT"',
        'find "$NODE_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +',
        'curl -fsSL "$NODE_URL" -o "$ARCHIVE_PATH"',
        'tar -xzf "$ARCHIVE_PATH" --strip-components=1 -C "$NODE_ROOT"',
        'rm -rf "$TMP_DIR"'
      ].join('\n');
      const result = runLocal('prlctl', buildPrlctlExecArgs(this.target, [this.target.shell || 'bash', '-s']), {
        timeout: 240000,
        input: bootstrapScript,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });
      if (result.status !== 0) {
        return {
          ok: false,
          command: 'guest-node-bootstrap',
          summary: 'Failed to download and extract a standalone Node runtime in the macOS guest',
          details: {
            nodeRoot: this.target.nodeRoot,
            nodeCommand: this.target.nodeCommand,
            nodeBootstrapUrl: this.target.nodeBootstrapUrl,
            stdoutTail: String(result.stdout || '').slice(-4000),
            stderrTail: String(result.stderr || '').slice(-4000)
          }
        };
      }

      const verified = this.probeConfiguredGuestCommand(this.target.nodeCommand, '--version');
      return {
        ok: !!verified,
        command: 'guest-node-bootstrap',
        summary: verified
          ? 'Bootstrapped a guest-local Node runtime for the target'
          : 'Guest-local Node runtime bootstrap did not produce a working node binary',
        details: {
          nodeRoot: this.target.nodeRoot,
          nodeCommand: this.target.nodeCommand,
          npmCommand: this.target.npmCommand || null,
          npmCliPath: this.target.npmCliPath || null,
          nodeBootstrapUrl: this.target.nodeBootstrapUrl,
          nodeVersion: verified ? verified.version : null
        }
      };
    }

    const { archive, nodeRoot, nodeBinaryPath } = buildNodeRuntimeArchive();
    const parentDir = path.posix.dirname(this.target.nodeRoot);
    runPrlctlExec(this.target, ['mkdir', '-p', parentDir], { timeout: 30000 });
    runPrlctlExec(this.target, ['rm', '-rf', this.target.nodeRoot], { timeout: 30000 });
    runPrlctlExec(this.target, ['mkdir', '-p', this.target.nodeRoot], { timeout: 30000 });

    const extract = runLocal('prlctl', buildPrlctlExecArgs(this.target, ['tar', '-xzf', '-', '-C', this.target.nodeRoot]), {
      timeout: 180000,
      input: archive,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    if (extract.status !== 0) {
      return {
        ok: false,
        command: 'guest-node-bootstrap',
        summary: 'Failed to extract the host Node runtime into the macOS guest',
        details: {
          nodeRoot: this.target.nodeRoot,
          hostNodeRoot: nodeRoot,
          hostNodeBinary: nodeBinaryPath,
          stdoutTail: String(extract.stdout || '').slice(-4000),
          stderrTail: String(extract.stderr || '').slice(-4000)
        }
      };
    }

    const verified = this.probeConfiguredGuestCommand(this.target.nodeCommand, '--version');
    return {
      ok: !!verified,
      command: 'guest-node-bootstrap',
      summary: verified
        ? 'Bootstrapped a guest-local Node runtime for the target'
        : 'Guest-local Node runtime bootstrap did not produce a working node binary',
      details: {
        nodeRoot: this.target.nodeRoot,
        nodeCommand: this.target.nodeCommand,
        npmCommand: this.target.npmCommand || null,
        hostNodeRoot: nodeRoot,
        hostNodeBinary: nodeBinaryPath,
        nodeVersion: verified ? verified.version : null
      }
    };
  }

  probeGuestPrerequisites() {
    let details;
    if (this.target.guestFamily === 'windows') {
      const script = [
        '$ErrorActionPreference = "Stop"',
        '$node = Get-Command node -ErrorAction SilentlyContinue',
        '$npm = Get-Command npm -ErrorAction SilentlyContinue',
        '$pwsh = Get-Command powershell -ErrorAction SilentlyContinue',
        '[pscustomobject]@{',
        '  user = $env:USERNAME',
        '  home = $env:USERPROFILE',
        '  nodePath = if ($node) { $node.Source } else { $null }',
        '  npmPath = if ($npm) { $npm.Source } else { $null }',
        '  powershellPath = if ($pwsh) { $pwsh.Source } else { $null }',
        '} | ConvertTo-Json -Compress'
      ].join('\n');
      details = this.runGuestPowerShellJson(script, 30000);
    } else {
      const script = [
        'set +e',
        'printf "user=%s\\n" "$USER"',
        'printf "home=%s\\n" "$HOME"',
        'command -v node >/tmp/pi-node-path 2>/dev/null',
        'command -v npm >/tmp/pi-npm-path 2>/dev/null',
        'command -v python3 >/tmp/pi-python-path 2>/dev/null',
        'printf "nodePath=%s\\n" "$(cat /tmp/pi-node-path 2>/dev/null)"',
        'printf "npmPath=%s\\n" "$(cat /tmp/pi-npm-path 2>/dev/null)"',
        'printf "python3Path=%s\\n" "$(cat /tmp/pi-python-path 2>/dev/null)"'
      ].join('\n');
      details = this.runGuestPosixKeyValueScript(script, 30000);
    }

    if (!details.nodePath && this.target.nodeCommand) {
      const fallbackNode = this.probeConfiguredGuestCommand(this.target.nodeCommand, '--version');
      if (fallbackNode) {
        details.nodePath = fallbackNode.path;
        details.nodeVersion = details.nodeVersion || fallbackNode.version;
      }
    }
    if (!details.npmPath && this.target.npmCommand) {
      const fallbackNpm = this.probeConfiguredGuestCommand(this.target.npmCommand, '--version');
      if (fallbackNpm) {
        details.npmPath = fallbackNpm.path;
        details.npmVersion = details.npmVersion || fallbackNpm.version;
      }
    }

    return {
      ok: !!details.nodePath,
      command: 'guest-prereq-probe',
      summary: details.nodePath
        ? 'Guest shell prerequisites are available for Node-based stages'
        : 'Guest is reachable, but Node is missing from PATH for Node-based stages',
      details
    };
  }

  probeGuestRuntime() {
    let details;
    if (this.target.guestFamily === 'windows') {
      const runtimeRoot = this.target.runtimeRoot.replace(/'/g, "''");
      const parentRoot = path.win32.dirname(this.target.runtimeRoot).replace(/'/g, "''");
      const script = [
        '$ErrorActionPreference = "Stop"',
        `$runtimeRoot = '${runtimeRoot}'`,
        `$parentRoot = '${parentRoot}'`,
        '[pscustomobject]@{',
        '  user = $env:USERNAME',
        '  home = $env:USERPROFILE',
        '  runtimeRoot = $runtimeRoot',
        '  runtimeExists = Test-Path $runtimeRoot',
        '  runtimeParent = $parentRoot',
        '  runtimeParentExists = Test-Path $parentRoot',
        '  runtimeParentWritable = Test-Path $parentRoot',
        '  temp = $env:TEMP',
        '  pwd = (Get-Location).Path',
        '} | ConvertTo-Json -Compress'
      ].join('\n');
      details = this.runGuestPowerShellJson(script, 30000);
    } else {
      const script = [
        'set +e',
        `RUNTIME_ROOT=${quotePosix(this.target.runtimeRoot)}`,
        `RUNTIME_PARENT=${quotePosix(path.posix.dirname(this.target.runtimeRoot))}`,
        'printf "user=%s\\n" "$USER"',
        'printf "home=%s\\n" "$HOME"',
        'printf "pwd=%s\\n" "$PWD"',
        'printf "runtimeRoot=%s\\n" "$RUNTIME_ROOT"',
        '[ -d "$RUNTIME_ROOT" ] && echo runtimeExists=yes || echo runtimeExists=no',
        'printf "runtimeParent=%s\\n" "$RUNTIME_PARENT"',
        '[ -d "$RUNTIME_PARENT" ] && echo runtimeParentExists=yes || echo runtimeParentExists=no',
        '[ -w "$RUNTIME_PARENT" ] && echo runtimeParentWritable=yes || echo runtimeParentWritable=no',
        'printf "temp=%s\\n" "${TMPDIR:-/tmp}"'
      ].join('\n');
      details = this.runGuestPosixKeyValueScript(script, 30000);
    }

    const runtimeExists = details.runtimeExists === true || details.runtimeExists === 'yes';
    return {
      ok: runtimeExists,
      command: 'guest-runtime-probe',
      summary: runtimeExists
        ? 'Guest runtime directory is available for synced project files'
        : 'Guest runtime directory is not available yet',
      details
    };
  }

  probeGuestProjectDependencies() {
    let details;
    if (this.target.guestFamily === 'windows') {
      const runtimeRoot = this.target.runtimeRoot.replace(/'/g, "''");
      const playwrightPkg = path.win32.join(this.target.runtimeRoot, 'node_modules', '@playwright', 'test', 'package.json').replace(/'/g, "''");
      const packageJson = path.win32.join(this.target.runtimeRoot, 'package.json').replace(/'/g, "''");
      const packageLock = path.win32.join(this.target.runtimeRoot, 'package-lock.json').replace(/'/g, "''");
      const script = [
        '$ErrorActionPreference = "Stop"',
        '$node = Get-Command node -ErrorAction SilentlyContinue',
        '$npm = Get-Command npm -ErrorAction SilentlyContinue',
        `$runtimeRoot = '${runtimeRoot}'`,
        `$playwrightPkg = '${playwrightPkg}'`,
        `$packageJson = '${packageJson}'`,
        `$packageLock = '${packageLock}'`,
        '$playwrightInstalled = Test-Path $playwrightPkg',
        '$playwrightVersion = $null',
        'if ($playwrightInstalled) { try { $playwrightVersion = (Get-Content $playwrightPkg -Raw | ConvertFrom-Json).version } catch {} }',
        '[pscustomobject]@{',
        '  runtimeRoot = $runtimeRoot',
        '  runtimeExists = Test-Path $runtimeRoot',
        '  packageJson = Test-Path $packageJson',
        '  packageLock = Test-Path $packageLock',
        '  nodeModules = Test-Path (Join-Path $runtimeRoot "node_modules")',
        '  nodePath = if ($node) { $node.Source } else { $null }',
        '  npmPath = if ($npm) { $npm.Source } else { $null }',
        '  nodeVersion = if ($node) { (& node --version) } else { $null }',
        '  npmVersion = if ($npm) { (& npm --version) } else { $null }',
        '  playwrightInstalled = $playwrightInstalled',
        '  playwrightVersion = $playwrightVersion',
        '} | ConvertTo-Json -Compress'
      ].join('\n');
      details = this.runGuestPowerShellJson(script, 30000);
    } else {
      const script = [
        'set +e',
        `RUNTIME_ROOT=${quotePosix(this.target.runtimeRoot)}`,
        `CONFIG_NODE=${quotePosix(this.target.nodeCommand || '')}`,
        `CONFIG_NPM=${quotePosix(this.target.npmCommand || '')}`,
        'NODE_BIN=$(command -v node 2>/dev/null || true)',
        'NPM_BIN=$(command -v npm 2>/dev/null || true)',
        '[ -z "$NODE_BIN" ] && [ -n "$CONFIG_NODE" ] && [ -x "$CONFIG_NODE" ] && NODE_BIN="$CONFIG_NODE"',
        '[ -z "$NPM_BIN" ] && [ -n "$CONFIG_NPM" ] && [ -x "$CONFIG_NPM" ] && NPM_BIN="$CONFIG_NPM"',
        'printf "runtimeRoot=%s\\n" "$RUNTIME_ROOT"',
        '[ -d "$RUNTIME_ROOT" ] && echo runtimeExists=yes || echo runtimeExists=no',
        '[ -f "$RUNTIME_ROOT/package.json" ] && echo packageJson=yes || echo packageJson=no',
        '[ -f "$RUNTIME_ROOT/package-lock.json" ] && echo packageLock=yes || echo packageLock=no',
        '[ -d "$RUNTIME_ROOT/node_modules" ] && echo nodeModules=yes || echo nodeModules=no',
        'printf "nodePath=%s\\n" "$NODE_BIN"',
        'printf "npmPath=%s\\n" "$NPM_BIN"',
        'printf "nodeVersion=%s\\n" "$([ -n "$NODE_BIN" ] && "$NODE_BIN" --version 2>/dev/null || true)"',
        'printf "npmVersion=%s\\n" "$([ -n "$NPM_BIN" ] && "$NPM_BIN" --version 2>/dev/null || true)"',
        '[ -f "$RUNTIME_ROOT/node_modules/@playwright/test/package.json" ] && echo playwrightInstalled=yes || echo playwrightInstalled=no',
        'if [ -f "$RUNTIME_ROOT/node_modules/@playwright/test/package.json" ] && [ -n "$NODE_BIN" ]; then',
        '  "$NODE_BIN" -e "const pkg=require(process.argv[1]); console.log(`playwrightVersion=${pkg.version}`)" "$RUNTIME_ROOT/node_modules/@playwright/test/package.json"',
        'fi'
      ].join('\n');
      details = this.runGuestPosixKeyValueScript(script, 30000);
    }

    const playwrightInstalled = details.playwrightInstalled === true || details.playwrightInstalled === 'yes';
    return {
      ok: playwrightInstalled,
      command: 'guest-project-deps-probe',
      summary: playwrightInstalled
        ? 'Guest runtime already has project Node dependencies available'
        : 'Guest runtime is missing some project Node dependencies',
      details
    };
  }

  probeGuestLinuxDesktopTools() {
    if (this.target.guestFamily !== 'linux') {
      return {
        ok: true,
        skipped: true,
        command: 'guest-linux-desktop-tools-probe',
        summary: 'Linux desktop tool probing is not required for this target',
        details: { guestFamily: this.target.guestFamily }
      };
    }

    const script = [
      'set +e',
      'printf "DISPLAY=%s\\n" "$DISPLAY"',
      'printf "WAYLAND_DISPLAY=%s\\n" "$WAYLAND_DISPLAY"',
      'printf "XDG_SESSION_TYPE=%s\\n" "$XDG_SESSION_TYPE"',
      'printf "xdotool=%s\\n" "$(command -v xdotool 2>/dev/null || true)"',
      'printf "wmctrl=%s\\n" "$(command -v wmctrl 2>/dev/null || true)"',
      'printf "xprop=%s\\n" "$(command -v xprop 2>/dev/null || true)"',
      'printf "xset=%s\\n" "$(command -v xset 2>/dev/null || true)"',
      'printf "xvfbRun=%s\\n" "$(command -v xvfb-run 2>/dev/null || true)"',
      'printf "Xvfb=%s\\n" "$(command -v Xvfb 2>/dev/null || true)"',
      'printf "xauth=%s\\n" "$(command -v xauth 2>/dev/null || true)"',
      'printf "sudoPasswordless=%s\\n" "$(sudo -n true >/dev/null 2>&1; echo $?)"',
      'printf "aptGet=%s\\n" "$(command -v apt-get 2>/dev/null || true)"',
      'printf "dnf=%s\\n" "$(command -v dnf 2>/dev/null || true)"'
    ].join('\n');
    const details = this.runGuestPosixKeyValueScript(script, 30000);
    const desktopSessionEnv = this.getLinuxDesktopSessionEnvironment();
    const desktopSessionDisplay = desktopSessionEnv && (desktopSessionEnv.DISPLAY || desktopSessionEnv.WAYLAND_DISPLAY)
      ? (desktopSessionEnv.DISPLAY || desktopSessionEnv.WAYLAND_DISPLAY)
      : null;
    const hasDisplay = !!(details.DISPLAY || desktopSessionDisplay);
    const hasDesktopTools = !!(details.xdotool && details.wmctrl && details.xprop && details.xset);
    const hasVirtualDisplayTools = !!(details.xvfbRun || details.Xvfb);
    const hasDesktopSessionEnv = !!desktopSessionEnv;

    return {
      ok: hasDisplay && hasDesktopTools,
      command: 'guest-linux-desktop-tools-probe',
      summary: hasDisplay && hasDesktopTools
        ? 'Linux guest has a usable desktop session environment and core desktop automation tools'
        : hasDisplay
          ? 'Linux guest has a desktop session environment, but core desktop automation tools are still missing'
          : hasVirtualDisplayTools
            ? 'Linux guest lacks a usable desktop session environment, but virtual display tooling is partially available'
            : 'Linux guest lacks the desktop/display prerequisites for headed automation',
      details: {
        ...details,
        hasDisplay,
        hasDesktopTools,
        hasVirtualDisplayTools,
        hasDesktopSessionEnv,
        desktopSessionEnv,
        desktopSessionContext: this.linuxDesktopSessionContext || null,
        desktopSessionEnvError: this.linuxDesktopSessionEnvError,
        sudoPasswordConfigured: !!this.target.sudoPassword
      }
    };
  }

  probeWindowsAutoLogon() {
    if (this.target.guestFamily !== 'windows') {
      return {
        ok: true,
        skipped: true,
        command: 'guest-windows-autologon-probe',
        summary: 'Windows autologon probing is not required for this target',
        details: { guestFamily: this.target.guestFamily }
      };
    }

    const queryValue = (name) => {
      const result = runLocal('prlctl', buildPrlctlExecArgs(this.target, [
        'cmd',
        '/c',
        `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v ${name}`
      ]), { timeout: 30000 });

      const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (result.status !== 0) {
        return { present: false, value: null, status: result.status, raw: combined.trim() };
      }

      const line = combined
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry.toLowerCase().startsWith(name.toLowerCase()));
      if (!line) {
        return { present: false, value: null, status: result.status, raw: combined.trim() };
      }

      const parts = line.split(/\s{2,}/).filter(Boolean);
      return {
        present: true,
        value: parts.length >= 3 ? parts.slice(2).join(' ') : null,
        status: result.status,
        raw: line
      };
    };

    const autoAdminLogon = queryValue('AutoAdminLogon');
    const defaultUserName = queryValue('DefaultUserName');
    const defaultDomainName = queryValue('DefaultDomainName');
    const defaultPassword = queryValue('DefaultPassword');
    const forceAutoLogon = queryValue('ForceAutoLogon');

    const details = {
      autoAdminLogon: autoAdminLogon.value,
      defaultUserName: defaultUserName.value,
      defaultDomainName: defaultDomainName.value,
      defaultPasswordConfigured: defaultPassword.present && !!String(defaultPassword.value || '').trim(),
      forceAutoLogon: forceAutoLogon.value,
      raw: {
        autoAdminLogon: autoAdminLogon.raw,
        defaultUserName: defaultUserName.raw,
        defaultDomainName: defaultDomainName.raw,
        defaultPassword: defaultPassword.raw,
        forceAutoLogon: forceAutoLogon.raw
      }
    };

    const enabled = String(details.autoAdminLogon || '').trim() === '1';
    const hasUser = !!String(details.defaultUserName || '').trim();
    const hasPassword = !!details.defaultPasswordConfigured;

    return {
      ok: enabled && hasUser && hasPassword,
      command: 'guest-windows-autologon-probe',
      summary: enabled && hasUser && hasPassword
        ? 'Windows autologon is configured for the guest user session'
        : enabled && hasUser
          ? 'Windows autologon is partially configured but missing a stored password'
          : 'Windows autologon is not configured for this guest',
      details
    };
  }

  enableWindowsAutoLogon() {
    if (this.target.guestFamily !== 'windows') {
      return {
        ok: true,
        skipped: true,
        command: 'guest-windows-autologon-enable',
        summary: 'Windows autologon enablement is not required for this target',
        details: { guestFamily: this.target.guestFamily }
      };
    }

    if (!this.target.autoLogonUser || !this.target.autoLogonPassword) {
      return {
        ok: false,
        command: 'guest-windows-autologon-enable',
        summary: 'No Windows autologon credentials configured in tmp/orchestrator.local.json',
        details: {
          target: this.target.key,
          requiredKeys: ['autoLogonUser', 'autoLogonPassword'],
          optionalKeys: ['autoLogonDomain'],
          hint: 'Provide Windows autologon credentials only in gitignored tmp/orchestrator.local.json.'
        }
      };
    }

    const domain = this.target.autoLogonDomain || '.';
    const command = [
      'cmd',
      '/c',
      [
        `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v AutoAdminLogon /t REG_SZ /d 1 /f`,
        `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v DefaultUserName /t REG_SZ /d ${quoteCmd(this.target.autoLogonUser) } /f`,
        `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v DefaultDomainName /t REG_SZ /d ${quoteCmd(domain)} /f`,
        `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v DefaultPassword /t REG_SZ /d ${quoteCmd(this.target.autoLogonPassword)} /f`,
        `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v ForceAutoLogon /t REG_SZ /d 1 /f`
      ].join(' && ')
    ];
    const result = runLocal('prlctl', buildPrlctlExecArgs(this.target, command), {
      timeout: this.getStageTimeoutMs('guest-node-bootstrap')
    });
    const ok = result.status === 0;
    return {
      ok,
      command: 'guest-windows-autologon-enable',
      summary: ok
        ? 'Configured Windows autologon registry keys; reboot the VM to apply the login behavior'
        : 'Failed to configure Windows autologon registry keys',
      details: {
        target: this.target.key,
        autoLogonUser: this.target.autoLogonUser,
        autoLogonDomain: domain,
        status: result.status,
        stdoutTail: String(result.stdout || '').slice(-4000),
        stderrTail: String(result.stderr || '').slice(-4000)
      }
    };
  }

  installGuestLinuxDesktopTools() {
    if (this.target.guestFamily !== 'linux') {
      return {
        ok: true,
        skipped: true,
        command: 'guest-linux-desktop-tools-install',
        summary: 'Linux desktop tool installation is not required for this target',
        details: { guestFamily: this.target.guestFamily }
      };
    }

    if (!this.target.sudoPassword) {
      return {
        ok: false,
        command: 'guest-linux-desktop-tools-install',
        summary: 'No sudoPassword configured for Linux desktop tool installation',
        details: {
          target: this.target.key,
          hint: 'Add sudoPassword to tmp/orchestrator.local.json if the guest user can sudo.'
        }
      };
    }

    const timeout = this.getStageTimeoutMs('guest-linux-desktop-tools-install');
    const installScript = this.target.key === 'fedora'
      ? `echo ${quotePosix(this.target.sudoPassword)} | sudo -S -k dnf install -y xdotool wmctrl xprop xset xorg-x11-server-Xvfb xorg-x11-xauth`
      : `echo ${quotePosix(this.target.sudoPassword)} | sudo -S -k apt-get update && echo ${quotePosix(this.target.sudoPassword)} | sudo -S -k apt-get install -y xvfb xauth x11-utils xdotool wmctrl`;

    let result = runLocal('prlctl', buildPrlctlExecArgs(this.target, [this.target.shell || 'bash', '-lc', installScript]), {
      timeout
    });
    let strategy = 'user-sudo';

    if (result.status !== 0 && this.target.execUser) {
      const rootCheck = runLocal('prlctl', ['exec', this.target.vmName, 'id', '-u'], { timeout: 15000 });
      if (rootCheck.status === 0 && String(rootCheck.stdout || '').trim() === '0') {
        const rootCommand = this.target.key === 'fedora'
          ? ['dnf', 'install', '-y', 'xdotool', 'wmctrl', 'xprop', 'xset', 'xorg-x11-server-Xvfb', 'xorg-x11-xauth']
          : ['bash', '-lc', 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y xvfb xauth x11-utils xdotool wmctrl'];
        const fallback = runLocal('prlctl', ['exec', this.target.vmName, ...rootCommand], { timeout });
        if (fallback.status === 0) {
          result = fallback;
          strategy = 'root-fallback';
        }
      }
    }

    const ok = result.status === 0;
    return {
      ok,
      command: 'guest-linux-desktop-tools-install',
      summary: ok
        ? strategy === 'root-fallback'
          ? 'Installed Linux desktop tooling via root guest execution fallback'
          : 'Attempted Linux desktop tooling installation'
        : 'Linux desktop tooling installation failed',
      details: {
        target: this.target.key,
        strategy,
        status: result.status,
        stdoutTail: String(result.stdout || '').slice(-4000),
        stderrTail: String(result.stderr || '').slice(-4000)
      }
    };
  }

  installGuestDependencies() {
    const timeout = this.getStageTimeoutMs('guest-deps-install');

    const execAttempt = (commandArgs) => runLocal('prlctl', buildPrlctlExecArgs(this.target, commandArgs), { timeout });

    const buildInstallCommand = (retry = false) => {
      if (this.target.guestFamily === 'windows') {
        const cacheDir = '%TEMP%\\pi-npm-cache';
        const install = retry
          ? `cd /d ${quoteCmd(this.target.runtimeRoot)} && npm cache clean --force && npm install --no-fund --no-audit --cache ${quoteCmd(cacheDir)}`
          : `cd /d ${quoteCmd(this.target.runtimeRoot)} && npm install --no-fund --no-audit --cache ${quoteCmd(cacheDir)}`;
        return ['cmd', '/c', install];
      }

      const npmCommand = this.target.npmCommand || 'npm';
      const npmCliPath = this.target.npmCliPath || null;
      const cacheDir = '/tmp/pi-npm-cache';
      if (npmCliPath && this.target.nodeCommand) {
        if (retry) {
          return [this.target.nodeCommand, npmCliPath, '--prefix', this.target.runtimeRoot, 'cache', 'clean', '--force'];
        }
        return [this.target.nodeCommand, npmCliPath, '--prefix', this.target.runtimeRoot, 'install', '--no-fund', '--no-audit', '--cache', cacheDir];
      }
      if (retry) {
        return [npmCommand, '--prefix', this.target.runtimeRoot, 'cache', 'clean', '--force'];
      }
      return [npmCommand, '--prefix', this.target.runtimeRoot, 'install', '--no-fund', '--no-audit', '--cache', cacheDir];
    };

    let result = execAttempt(buildInstallCommand(false));
    let retried = false;
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.status !== 0 && /idealTree/i.test(combined)) {
      retried = true;
      execAttempt(buildInstallCommand(true));
      result = execAttempt(buildInstallCommand(false));
    }

    const combinedAfter = `${result.stdout || ''}\n${result.stderr || ''}`;
    const installOk = result.status === 0 && !/Library not loaded|dyld\[|command not found|not recognized/i.test(combinedAfter);

    return {
      ok: installOk,
      command: 'guest-deps-install',
      summary: installOk
        ? 'Ran npm install inside the guest runtime root'
        : 'npm install inside the guest runtime root failed',
      details: {
        runtimeRoot: this.target.runtimeRoot,
        retried,
        status: result.status,
        stdoutTail: String(result.stdout || '').slice(-4000),
        stderrTail: String(result.stderr || '').slice(-4000)
      }
    };
  }

  syncRuntime() {
    if (this.target.guestFamily === 'windows') {
      const command = buildSyncCommand(this.target, this.sharedRepoRoot);
      const result = runPrlctlExec(this.target, command, { timeout: 90000 });
      return {
        ok: true,
        sharedRepoRoot: this.sharedRepoRoot,
        runtimeRoot: this.target.runtimeRoot,
        guestArtifactRoot: this.guestArtifactRoot,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        strategy: 'shared-folder-copy'
      };
    }

    const archive = buildSyncArchive();
    const mkdirRuntime = runPrlctlExec(this.target, ['mkdir', '-p', this.target.runtimeRoot], { timeout: 30000 });
    const mkdirArtifacts = runPrlctlExec(this.target, ['mkdir', '-p', this.guestArtifactRoot], { timeout: 30000 });
    const result = runLocal('prlctl', buildPrlctlExecArgs(this.target, ['tar', '-xzf', '-', '-C', this.target.runtimeRoot]), {
      timeout: 120000,
      input: archive,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.status !== 0) {
      throw new Error(`Posix sync failed (${result.status})\n${result.stdout}${result.stderr}`.trim());
    }

    return {
      ok: true,
      sharedRepoRoot: this.sharedRepoRoot,
      runtimeRoot: this.target.runtimeRoot,
      guestArtifactRoot: this.guestArtifactRoot,
      stdout: `${mkdirRuntime.stdout || ''}${mkdirArtifacts.stdout || ''}${result.stdout || ''}`.trim(),
      stderr: `${mkdirRuntime.stderr || ''}${mkdirArtifacts.stderr || ''}${result.stderr || ''}`.trim(),
      strategy: 'stdin-tar-sync'
    };
  }

  getStageTimeoutMs(stageName) {
    const multiplier = STAGE_TIMEOUT_MULTIPLIER[stageName] || 1;
    return Math.round(STAGE_TIMEOUT_MS * multiplier * this.options.timeoutScale);
  }

  guestExec(args, options = {}) {
    const execArgs = this.target.guestFamily === 'linux' && this.target.guestStageExecMode === 'root'
      ? ['exec', this.target.vmName, ...args]
      : buildPrlctlExecArgs(this.target, args);
    return runLocal('prlctl', execArgs, options);
  }

  guestFileExists(filePath) {
    const result = this.guestExec(['test', '-f', filePath], { timeout: 10000 });
    return result.status === 0;
  }

  readGuestTextFile(filePath) {
    const result = this.guestExec(['cat', filePath], { timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(`Failed to read guest file '${filePath}'\n${result.stdout}${result.stderr}`.trim());
    }
    return result.stdout || '';
  }

  runLinuxRootGuestStageDetached(stageName, stageArtifactDir, command, stageTimeout) {
    const stdoutPath = path.posix.join(stageArtifactDir, 'stdout.log');
    const stderrPath = path.posix.join(stageArtifactDir, 'stderr.log');
    const resultPath = path.posix.join(stageArtifactDir, 'result.json');
    const launcherScript = path.posix.join(this.target.runtimeRoot, 'tmp', 'orchestrator', 'guest', 'detached-launcher.js');
    const launchCommand = [
      this.target.nodeCommand || 'node',
      launcherScript,
      `--stdout=${stdoutPath}`,
      `--stderr=${stderrPath}`,
      '--',
      ...command
    ];

    const launchResult = runLocal('prlctl', ['exec', this.target.vmName, ...launchCommand], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024
    });
    if (launchResult.status !== 0) {
      throw new Error(`Failed to launch detached guest stage '${stageName}'\n${launchResult.stdout}${launchResult.stderr}`.trim());
    }

    const deadline = Date.now() + stageTimeout;
    let lastResultError = null;
    while (Date.now() < deadline) {
      if (this.guestFileExists(resultPath)) {
        try {
          const payload = JSON.parse(this.readGuestTextFile(resultPath));
          return payload;
        } catch (error) {
          lastResultError = error;
        }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }

    const stdout = this.guestFileExists(stdoutPath) ? this.readGuestTextFile(stdoutPath) : '';
    const stderr = this.guestFileExists(stderrPath) ? this.readGuestTextFile(stderrPath) : '';
    if (lastResultError) {
      throw new Error(`Detached guest stage '${stageName}' wrote an unreadable result file: ${lastResultError.message}\n${stdout}\n${stderr}`.trim());
    }
    throw new Error(`Detached guest stage '${stageName}' timed out after ${stageTimeout}ms\n${stdout}\n${stderr}`.trim());
  }

  runGuestStage(stageName) {
    const stageArtifactDir = this.target.guestFamily === 'windows'
      ? path.win32.join(this.guestArtifactRoot, stageName)
      : path.posix.join(this.guestArtifactRoot, stageName);
    const hostStageStartedAt = new Date().toISOString();
    const hostStageStartedEpochMs = Date.now();
    const command = buildGuestStageCommand(this.target, stageName, stageArtifactDir, {
      browser: this.options.browser || this.target.browser,
      browserChannel: this.options.browserChannel,
      browserExecutable: this.options.browserExecutable,
      extensionPath: this.options.extensionPath,
      nodeCommand: this.target.nodeCommand,
      timeoutScale: this.options.timeoutScale,
      hostStageStartedAt,
      hostStageStartedEpochMs,
      extraEnv: this.target.guestFamily === 'linux' ? this.buildLinuxGuestStageEnvironment() : null
    });

    const stageTimeout = this.getStageTimeoutMs(stageName);
    const maxAttempts = 2;
    let lastError = null;
    const useLinuxDesktopUserExec = this.target.guestFamily === 'linux'
      && shouldUseLinuxDesktopUserForStage(this.target, stageName)
      && !!(this.buildLinuxGuestStageEnvironment() || {}).DISPLAY;

    if (this.target.guestFamily === 'linux' && this.target.guestStageExecMode === 'root' && !useLinuxDesktopUserExec) {
      return this.runLinuxRootGuestStageDetached(stageName, stageArtifactDir, command, stageTimeout);
    }

    const guestStageExecArgs = shouldUseWindowsCurrentUserForStage(this.target, stageName)
      ? ['exec', this.target.vmName, '--current-user', ...command]
      : buildPrlctlExecArgs(this.target, command);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = runLocal('prlctl', guestStageExecArgs, { timeout: stageTimeout });
      const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;

      try {
        return parseGuestResult(combinedOutput);
      } catch (error) {
        lastError = error;
        const recoverableMissingMarker = result.status === 0 && /Guest result marker not found/i.test(String(error.message || error));
        if (result.status !== 0) {
          throw new Error(`prlctl exec failed (${result.status})\n${combinedOutput}`.trim());
        }
        if (!recoverableMissingMarker || attempt >= maxAttempts) {
          throw error;
        }
      }
    }

    throw lastError || new Error(`Failed to run guest stage: ${stageName}`);
  }

  writeSummary(runIndex) {
    const summary = {
      generatedAt: new Date().toISOString(),
      runIndex,
      target: this.target.key,
      vmName: this.target.vmName,
      guestFamily: this.target.guestFamily,
      browser: this.options.browser || this.target.browser,
      browserChannel: this.options.browserChannel,
      browserExecutable: this.options.browserExecutable,
      flow: this.options.flow,
      timeoutScale: this.options.timeoutScale,
      runtimeRoot: this.target.runtimeRoot,
      artifactRoot: this.artifactRoot,
      stages: this.stageResults.map((stage) => {
        const entry = {
          stage: stage.stage,
          ok: stage.payload && stage.payload.ok === true,
          summary: stage.payload && stage.payload.summary ? stage.payload.summary : null
        };
        if (stage.payload && Array.isArray(stage.payload.checks)) {
          entry.checks = stage.payload.checks;
          entry.failedChecks = stage.payload.failedChecks || [];
        }
        return entry;
      })
    };

    const summaryFile = path.join(this.artifactRoot, 'run-summary.json');
    fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }

  async run(runIndex = 1) {
    let vmReady = true;
    try {
      await this.ensureVmReady();
    } catch (_) {
      vmReady = false;
    }

    if (vmReady) {
      for (const stageName of this.getPlannedStages()) {
        try {
          const payload = stageName === 'guest-prereq-probe'
            ? this.probeGuestPrerequisites()
            : stageName === 'guest-node-bootstrap'
              ? this.bootstrapGuestNodeRuntime()
            : stageName === 'guest-runtime-probe'
              ? this.probeGuestRuntime()
              : stageName === 'guest-project-deps-probe'
                ? this.probeGuestProjectDependencies()
                : stageName === 'guest-linux-desktop-tools-probe'
                  ? this.probeGuestLinuxDesktopTools()
                  : stageName === 'guest-windows-autologon-probe'
                    ? this.probeWindowsAutoLogon()
                    : stageName === 'guest-windows-autologon-enable'
                      ? this.enableWindowsAutoLogon()
                      : stageName === 'guest-linux-desktop-tools-install'
                        ? this.installGuestLinuxDesktopTools()
                        : stageName === 'guest-deps-install'
                          ? this.installGuestDependencies()
                        : stageName === 'sync'
                          ? this.syncRuntime()
                          : this.runGuestStage(stageName);

          this.recordStage(stageName, payload);
          if (!payload.ok && !this.shouldContinueAfterFailure(stageName)) break;
        } catch (error) {
          const payload = {
            ok: false,
            summary: `Stage failed before producing a guest result: ${error.message}`,
            error: error.stack || error.message
          };
          this.recordStage(stageName, payload);
          if (!this.shouldContinueAfterFailure(stageName)) break;
        }
      }
    }

    if (this.options.suspendAfterRun) {
      try {
        const closeInfo = closeVm(this.target, 'suspend-after-run');
        this.recordStage('vm-suspend', {
          ok: true,
          summary: closeInfo.action === 'suspend'
            ? 'VM suspended after run'
            : closeInfo.closed
              ? `VM closed after run (${closeInfo.action})`
              : 'VM was already stopped before suspend-after-run',
          vmName: this.target.vmName,
          suspendInfo: closeInfo
        });
      } catch (error) {
        this.recordStage('vm-suspend', {
          ok: false,
          summary: `Failed to suspend VM after run: ${error.message}`,
          error: error.stack || error.message,
          vmName: this.target.vmName
        });
      }
    }

    const summary = this.writeSummary(runIndex);
    console.log(JSON.stringify(summary, null, 2));

    const failedStage = summary.stages.find((stage) => stage.ok !== true);
    if (failedStage) process.exitCode = 1;
    return summary;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  for (let runIndex = 1; runIndex <= options.repeat; runIndex += 1) {
    const lockPayload = await acquireVmRunLock({
      target: options.target,
      flow: options.flow,
      stage: options.stage,
      runIndex,
      repeat: options.repeat
    });

    try {
      const orchestrator = new HostOrchestrator(options);
      await orchestrator.run(runIndex);
    } finally {
      releaseVmRunLock(lockPayload);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
