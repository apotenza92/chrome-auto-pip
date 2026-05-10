'use strict';

const fs = require('fs');
const path = require('path');
const { resolveBrowserConfig, discoverExecutableCandidates } = require('../lib/browser-config');
const { detectPlatformKey } = require('../lib/platform');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

async function run(artifacts, options = {}) {
  const browserConfig = resolveBrowserConfig(options);
  const nodeVersion = process.version;
  const playwrightExists = fs.existsSync(path.join(REPO_ROOT, 'node_modules', '@playwright', 'test'));
  const extensionAutomationSupported = browserConfig.key === 'chromium';
  const chromeCandidates = discoverExecutableCandidates('chrome');
  const edgeCandidates = discoverExecutableCandidates('edge');
  const resolvedExecutableExists = browserConfig.executablePath
    ? fs.existsSync(browserConfig.executablePath)
    : browserConfig.discoveredExecutablePath
      ? fs.existsSync(browserConfig.discoveredExecutablePath)
      : browserConfig.key === 'chromium';
  const ok = playwrightExists && resolvedExecutableExists && extensionAutomationSupported;

  const platform = detectPlatformKey();

  return {
    ok,
    command: 'env-probe',
    summary: ok
      ? `${platform} guest has Node, Playwright, and a supported browser target available`
      : extensionAutomationSupported
        ? `${platform} guest is missing Playwright or the selected browser target`
        : 'Selected browser exists, but Playwright extension automation is only supported with bundled Chromium',
    details: {
      platform,
      repoRoot: REPO_ROOT,
      browser: options.browser || 'chromium',
      browserChannel: options.browserChannel || null,
      browserExecutable: options.browserExecutable || null,
      browserConfig,
      chromeCandidates,
      edgeCandidates,
      playwrightExists,
      resolvedExecutableExists,
      extensionAutomationSupported,
      nodeVersion
    }
  };
}

module.exports = { run };
