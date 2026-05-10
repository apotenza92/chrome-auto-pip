'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');
const { detectPlatformKey } = require('../lib/platform');

async function run() {
  const executablePath = chromium.executablePath();
  const executableExists = fs.existsSync(executablePath);
  const homeDir = os.homedir();
  const playwrightCacheDir = process.platform === 'win32'
    ? path.join(homeDir, 'AppData', 'Local', 'ms-playwright')
    : path.join(homeDir, '.cache', 'ms-playwright');

  return {
    ok: executableExists,
    command: 'playwright-browser-probe',
    summary: executableExists
      ? 'Playwright browser binary is available for Chromium-based automation'
      : 'Playwright browser binary is missing for Chromium-based automation',
    details: {
      platform: detectPlatformKey(),
      executablePath,
      executableExists,
      playwrightCacheDir,
      cacheDirExists: fs.existsSync(playwrightCacheDir)
    }
  };
}

module.exports = { run };
