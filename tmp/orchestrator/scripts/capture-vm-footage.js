#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { REGISTRY, localConfigPath } = require('../host/vm-registry');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outRoot = path.join(repoRoot, 'tmp', 'orchestrator-footage', new Date().toISOString().replace(/[:.]/g, '-'));
const nodeBin = process.execPath;
const hostScript = path.join(repoRoot, 'tmp', 'orchestrator', 'host.js');
const captureIntervalMs = Math.max(100, Number.parseInt(process.env.AUTO_PIP_FOOTAGE_INTERVAL_MS || '200', 10) || 200);
const outputFps = Math.max(1, Math.round(1000 / captureIntervalMs));

function loadLocalConfig() {
  if (!fs.existsSync(localConfigPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function resolveVmName(targetKey) {
  const localConfig = loadLocalConfig();
  const localTarget = localConfig.targets && localConfig.targets[targetKey] ? localConfig.targets[targetKey] : {};
  if (targetKey === 'fedora') {
    return process.env.AUTO_PIP_FEDORA_VM_NAME || localTarget.vmName || 'Fedora';
  }
  return localTarget.vmName || (REGISTRY[targetKey] && REGISTRY[targetKey].vmName);
}

const requestedTargets = (process.env.AUTO_PIP_FOOTAGE_TARGETS || '')
  .split(',')
  .map((target) => target.trim())
  .filter(Boolean);

const targets = [
  { key: 'windows', label: 'Windows 11 ARM' },
  { key: 'fedora', label: 'Fedora' },
  { key: 'macosTahoe', label: 'macOS Tahoe' }
]
  .filter((target) => requestedTargets.length === 0 || requestedTargets.includes(target.key))
  .map((target) => ({ ...target, vmName: resolveVmName(target.key) }));

if (requestedTargets.length > 0 && targets.length !== requestedTargets.length) {
  const knownTargets = ['windows', 'fedora', 'macosTahoe'].join(', ');
  throw new Error(`Unknown footage target in AUTO_PIP_FOOTAGE_TARGETS. Known targets: ${knownTargets}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function buildMp4(framesDir, outputPath) {
  const frames = fs.readdirSync(framesDir).filter((name) => name.endsWith('.png')).sort();
  if (frames.length === 0) {
    throw new Error(`No captured frames in ${framesDir}`);
  }

  const result = run('ffmpeg', [
    '-y',
    '-framerate', String(outputFps),
    '-pattern_type', 'glob',
    '-i', path.join(framesDir, '*.png'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-pix_fmt', 'yuv420p',
    outputPath
  ]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'ffmpeg failed').trim());
  }
}

async function captureWhileRunning(target, child, framesDir) {
  let index = 0;
  while (child.exitCode == null) {
    index += 1;
    const framePath = path.join(framesDir, `${String(index).padStart(5, '0')}.png`);
    const result = run('prlctl', ['capture', target.vmName, '--file', framePath], { timeout: 10000 });
    if (result.status !== 0) {
      try { fs.unlinkSync(framePath); } catch (_) {}
    }
    await sleep(captureIntervalMs);
  }
}

function waitForChild(child) {
  return new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

async function runTarget(target) {
  const targetDir = path.join(outRoot, target.key);
  const framesDir = path.join(targetDir, 'frames');
  ensureDir(framesDir);

  const commonArgs = [
    hostScript,
    `--target=${target.key}`
  ];
  if (target.key === 'fedora') {
    commonArgs.push(`--vm-name=${target.vmName}`);
  }

  const syncArgs = [
    ...commonArgs,
    '--stage=sync'
  ];
  console.log(`\n=== Preparing ${target.label} (${target.vmName}) ===`);
  const syncResult = run(nodeBin, syncArgs, { timeout: 4 * 60 * 1000 });
  fs.writeFileSync(path.join(targetDir, 'sync.stdout.log'), syncResult.stdout || '');
  fs.writeFileSync(path.join(targetDir, 'sync.stderr.log'), syncResult.stderr || '');
  if (syncResult.status !== 0) {
    throw new Error(`Failed to sync ${target.label}\n${syncResult.stdout}${syncResult.stderr}`.trim());
  }

  const args = [
    ...commonArgs,
    '--stage=tab-switch-visual-proof',
    '--suspend-after-run'
  ];

  console.log(`\n=== Capturing ${target.label} (${target.vmName}) at ${outputFps} fps ===`);
  const child = spawn(nodeBin, args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    process.stderr.write(chunk);
  });

  await Promise.all([
    captureWhileRunning(target, child, framesDir),
    waitForChild(child)
  ]);

  fs.writeFileSync(path.join(targetDir, 'stdout.log'), stdout);
  fs.writeFileSync(path.join(targetDir, 'stderr.log'), stderr);

  const videoPath = path.join(targetDir, 'tab-switch-visual-proof.mp4');
  buildMp4(framesDir, videoPath);

  const ok = child.exitCode === 0;
  return {
    target: target.key,
    label: target.label,
    vmName: target.vmName,
    ok,
    videoPath,
    frames: fs.readdirSync(framesDir).filter((name) => name.endsWith('.png')).length
  };
}

(async () => {
  ensureDir(outRoot);
  const results = [];
  for (const target of targets) {
    results.push(await runTarget(target));
  }

  const summaryPath = path.join(outRoot, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);

  console.log('\n=== Footage Summary ===');
  results.forEach((result) => {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label}: ${result.videoPath} (${result.frames} frames)`);
  });
  console.log(`summary: ${summaryPath}`);

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
