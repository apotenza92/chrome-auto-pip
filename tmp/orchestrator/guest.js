#!/usr/bin/env node

'use strict';

const { performance } = require('perf_hooks');
const { ArtifactWriter } = require('./guest/lib/artifact-writer');

const RESULT_MARKER = '__AUTO_PIP_RESULT__=';

const STAGES = {
  'env-probe': './guest/stages/env-probe',
  'platform-tools-probe': './guest/stages/platform-tools-probe',
  'display-stack-probe': './guest/stages/display-stack-probe',
  'interactive-desktop-probe': './guest/stages/interactive-desktop-probe',
  'playwright-browser-probe': './guest/stages/playwright-browser-probe',
  'playwright-browser-install': './guest/stages/playwright-browser-install',
  'browser-headless-session-probe': './guest/stages/browser-headless-session-probe',
  'browser-session-probe': './guest/stages/browser-session-probe',
  'extension-absence-probe': './guest/stages/extension-absence-probe',
  'extension-install-probe': './guest/stages/extension-install-probe',
  'extension-reload-probe': './guest/stages/extension-reload-probe',
  'extension-storage-reset-probe': './guest/stages/extension-storage-reset-probe',
  'tab-open-close-probe': './guest/stages/tab-open-close-probe',
  'window-open-close-probe': './guest/stages/window-open-close-probe',
  'window-inventory-probe': './guest/stages/window-inventory-probe',
  'app-launch-probe': './guest/stages/app-launch-probe',
  'extension-probe': './guest/stages/extension-probe',
  'plugin-mode-roundtrip-probe': './guest/stages/plugin-mode-roundtrip-probe',
  'plugin-debug-log-probe': './guest/stages/plugin-debug-log-probe',
  'playwright-extension-e2e': './guest/stages/playwright-extension-e2e',
  'dynamic-video-consistency': './guest/stages/dynamic-video-consistency',
  'real-browser-use-youtube': './guest/stages/real-browser-use-youtube',
  'visible-real-browser-use-youtube': './guest/stages/visible-real-browser-use-youtube',
  'helium-youtube-disable': './guest/stages/helium-youtube-disable',
  'video-probe': './guest/stages/video-probe',
  'manual-pip-probe': './guest/stages/manual-pip-probe',
  'browser-autopip-probe': './guest/stages/browser-autopip-probe',
  'extension-immediate-pip-probe': './guest/stages/extension-immediate-pip-probe',
  'cpu-usage-benchmark': './guest/stages/cpu-usage-benchmark',
  'tab-switch-visual-proof': './guest/stages/tab-switch-visual-proof',
  'focus-window-probe': './guest/stages/focus-window-probe',
  'visibility-window-switch-probe': './guest/stages/visibility-window-switch-probe',
  'visibility-minimize-probe': './guest/stages/visibility-minimize-probe',
  'focus-app-probe': './guest/stages/focus-app-probe',
  'visibility-app-switch-probe': './guest/stages/visibility-app-switch-probe',
  'linux-app-focus-contract-probe': './guest/stages/linux-app-focus-contract-probe',
  'scenario-window-switch': './guest/stages/scenario-window-switch',
  'scenario-app-switch': './guest/stages/scenario-app-switch'
};

function parseArgs(argv) {
  const guestPerfStartedMs = performance.now();
  const options = {
    command: 'env-probe',
    browser: 'chromium',
    browserChannel: null,
    browserExecutable: null,
    extensionPath: null,
    artifacts: null,
    timeoutScale: 1,
    hostStageStartedAt: null,
    hostStageStartedEpochMs: null,
    hostStageGuestPerfStartedMs: guestPerfStartedMs
  };

  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const eqIndex = arg.indexOf('=');
    const key = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
    const value = eqIndex === -1 ? 'true' : arg.slice(eqIndex + 1);

    if (key === 'command') options.command = value;
    if (key === 'browser') options.browser = value;
    if (key === 'browser-channel') options.browserChannel = value.replace(/^"|"$/g, '');
    if (key === 'browser-executable') options.browserExecutable = value.replace(/^"|"$/g, '');
    if (key === 'extension-path') options.extensionPath = value.replace(/^"|"$/g, '');
    if (key === 'artifacts') options.artifacts = value.replace(/^"|"$/g, '');
    if (key === 'timeout-scale') options.timeoutScale = parseFloat(value) || 1;
    if (key === 'host-stage-started-at') options.hostStageStartedAt = value.replace(/^"|"$/g, '');
    if (key === 'host-stage-started-epoch-ms') {
      const parsed = Number(value);
      options.hostStageStartedEpochMs = Number.isFinite(parsed) ? parsed : null;
    }
  });

  if (!options.artifacts) {
    options.artifacts = require('path').join(process.cwd(), 'tmp', 'orchestrator-artifacts', options.command);
  }

  return options;
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const artifacts = new ArtifactWriter(options.artifacts);
  const stageModule = STAGES[options.command];

  if (!stageModule) {
    const result = { ok: false, command: options.command, summary: `Unknown command: ${options.command}` };
    artifacts.writeJson('result.json', result);
    console.log(`${RESULT_MARKER}${JSON.stringify(result)}`);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    const stage = require(stageModule);
    result = await stage.run(artifacts, options);
  } catch (error) {
    result = {
      ok: false,
      command: options.command,
      summary: error.message,
      error: error.stack || error.message
    };
  }

  artifacts.writeJson('result.json', result);
  console.log(`${RESULT_MARKER}${JSON.stringify(result)}`);
  if (!result.ok) {
    process.exitCode = 1;
  }

  // Force process exit after emitting the result marker so lingering
  // browser/Playwright handles in the guest do not cause host-side timeouts.
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
