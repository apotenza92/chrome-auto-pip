const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium, test: base, expect } = require('@playwright/test');

const extensionPath = path.resolve(__dirname, '..', '..');
const configuredBrowser = process.env.AUTO_PIP_PLAYWRIGHT_BROWSER || 'chromium';
const configuredChannel = process.env.AUTO_PIP_PLAYWRIGHT_CHANNEL || null;
const configuredExecutable = process.env.AUTO_PIP_PLAYWRIGHT_EXECUTABLE || null;

if (configuredBrowser !== 'chromium') {
  throw new Error(`Unsupported AUTO_PIP_PLAYWRIGHT_BROWSER='${configuredBrowser}'. Extension fixture requires Chromium.`);
}

async function waitForExtensionWorker(context, timeoutMs = 45000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const existing = context.serviceWorkers()[0];
    if (existing) return existing;
    try {
      return await context.waitForEvent('serviceworker', { timeout: 1000 });
    } catch (_) {
      // Keep polling until the overall timeout expires.
    }
  }
  throw new Error(`Timed out waiting for extension service worker after ${timeoutMs}ms`);
}

async function launchExtensionContext() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pip-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: configuredChannel || undefined,
    executablePath: configuredExecutable || undefined,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--enable-features=AutoPictureInPictureForVideoPlayback,MediaSessionEnterPictureInPicture,BrowserInitiatedAutomaticPictureInPicture',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });
  return { context, userDataDir };
}

async function closeExtensionContext(context, userDataDir) {
  if (context) {
    await context.close().catch(() => {});
  }
  if (userDataDir) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

const test = base.extend({
  context: async ({}, use) => {
    let launchedContext = null;
    let launchedUserDataDir = null;
    let worker = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const launched = await launchExtensionContext();
      launchedContext = launched.context;
      launchedUserDataDir = launched.userDataDir;

      try {
        worker = await waitForExtensionWorker(launchedContext);
        launchedContext.__autoPipExtensionWorker = worker;
        break;
      } catch (error) {
        await closeExtensionContext(launchedContext, launchedUserDataDir);
        launchedContext = null;
        launchedUserDataDir = null;
        if (attempt >= 2) throw error;
      }
    }

    try {
      await use(launchedContext);
    } finally {
      await closeExtensionContext(launchedContext, launchedUserDataDir);
    }
  },
  extensionId: async ({ context }, use) => {
    const worker = context.__autoPipExtensionWorker || await waitForExtensionWorker(context);
    const extensionId = worker.url().split('/')[2];
    await use(extensionId);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  }
});

module.exports = { test, expect };
