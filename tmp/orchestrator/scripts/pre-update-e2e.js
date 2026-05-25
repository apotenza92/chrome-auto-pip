#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const nodeBin = process.execPath;
const hostScript = path.join(repoRoot, 'tmp', 'orchestrator', 'host.js');

const targets = [
  {
    key: 'windows',
    label: 'Windows 11 ARM',
    args: ['--target=windows']
  },
  {
    key: 'fedora',
    label: 'Fedora',
    args: ['--target=fedora', `--vm-name=${process.env.AUTO_PIP_FEDORA_VM_NAME || 'Fedora'}`]
  },
  {
    key: 'macos',
    label: 'macOS',
    args: ['--target=macos']
  }
];

function extractLastJsonObject(output) {
  const text = String(output || '');
  for (let index = text.lastIndexOf('\n{'); index >= 0; index = text.lastIndexOf('\n{', index - 1)) {
    const candidate = text.slice(index + 1).trim();
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // Keep looking for the final orchestrator summary.
    }
  }
  try {
    return JSON.parse(text.trim());
  } catch (_) {
    return null;
  }
}

function runTarget(target) {
  const args = [
    hostScript,
    ...target.args,
    '--flow=full-extension-e2e',
    '--suspend-after-run'
  ];

  console.log(`\n=== ${target.label} ===`);
  console.log(`${nodeBin} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`);

  const result = spawnSync(nodeBin, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const summary = extractLastJsonObject(result.stdout);
  const e2eStage = summary && Array.isArray(summary.stages)
    ? summary.stages.find((stage) => stage.stage === 'playwright-extension-e2e')
    : null;
  const suspendStage = summary && Array.isArray(summary.stages)
    ? summary.stages.find((stage) => stage.stage === 'vm-suspend')
    : null;

  return {
    target: target.key,
    label: target.label,
    ok: result.status === 0 && !!e2eStage && e2eStage.ok === true && !!suspendStage && suspendStage.ok === true,
    exitCode: result.status,
    artifactRoot: summary ? summary.artifactRoot : null,
    e2eSummary: e2eStage ? e2eStage.summary : 'missing playwright-extension-e2e stage',
    suspendSummary: suspendStage ? suspendStage.summary : 'missing vm-suspend stage'
  };
}

const results = targets.map(runTarget);
const failed = results.filter((result) => !result.ok);

console.log('\n=== Pre-update E2E Summary ===');
results.forEach((result) => {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label}: ${result.e2eSummary}`);
  if (result.artifactRoot) {
    console.log(`  artifact: ${result.artifactRoot}`);
  }
  console.log(`  suspend: ${result.suspendSummary}`);
});

if (failed.length > 0) {
  console.error(`\nPre-update E2E failed for ${failed.map((result) => result.label).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nPre-update E2E passed on all VM targets.');
}
