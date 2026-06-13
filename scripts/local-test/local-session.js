'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..', '..');
const extensionPath = repoRoot;
const artifactsRoot = path.join(repoRoot, 'tmp', 'local-test-artifacts');
const AUTO_PIP_EXCEPTION_KEYS = ['auto_picture_in_picture', 'automatic_picture_in_picture'];

function runId(prefix = 'local') {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createArtifactDir(prefix = 'local') {
  const configured = process.env.AUTO_PIP_LOCAL_ARTIFACT_DIR;
  return ensureDir(configured || path.join(artifactsRoot, runId(prefix)));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(value));
}

function mergeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildAutoPiPPrefs(origins = []) {
  const exceptions = {};
  AUTO_PIP_EXCEPTION_KEYS.forEach((key) => {
    exceptions[key] = {};
  });

  Array.from(new Set((Array.isArray(origins) ? origins : []).filter(Boolean))).forEach((origin) => {
    try {
      const url = new URL(origin);
      const pattern = `${url.origin},*`;
      AUTO_PIP_EXCEPTION_KEYS.forEach((key) => {
        exceptions[key][pattern] = {
          setting: 1,
          last_modified: String(Date.now() * 1000)
        };
      });
    } catch (_) {
      // Ignore malformed test origins.
    }
  });

  return {
    profile: {
      default_content_setting_values: {
        auto_picture_in_picture: 1,
        automatic_picture_in_picture: 1
      },
      content_settings: { exceptions }
    }
  };
}

function seedProfilePreferences(profileDir, origins = []) {
  const defaultDir = path.join(profileDir, 'Default');
  ensureDir(defaultDir);
  const preferencesPath = path.join(defaultDir, 'Preferences');

  let existing = {};
  if (fs.existsSync(preferencesPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    } catch (_) {
      existing = {};
    }
  }

  const seeded = buildAutoPiPPrefs(origins);
  const next = mergeObject(existing);
  next.profile = mergeObject(next.profile);
  next.profile.default_content_setting_values = {
    ...mergeObject(next.profile.default_content_setting_values),
    ...seeded.profile.default_content_setting_values
  };
  next.profile.content_settings = mergeObject(next.profile.content_settings);
  next.profile.content_settings.exceptions = mergeObject(next.profile.content_settings.exceptions);

  Object.entries(seeded.profile.content_settings.exceptions).forEach(([key, values]) => {
    next.profile.content_settings.exceptions[key] = {
      ...mergeObject(next.profile.content_settings.exceptions[key]),
      ...values
    };
  });

  fs.writeFileSync(preferencesPath, `${JSON.stringify(next, null, 2)}\n`);
}

function fileExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

function resolveHeliumExecutable() {
  const candidates = [
    process.env.AUTO_PIP_LOCAL_EXECUTABLE,
    '/Applications/Helium.app/Contents/MacOS/Helium',
    path.join(os.homedir(), 'Applications', 'Helium.app', 'Contents', 'MacOS', 'Helium')
  ].filter(Boolean);
  return candidates.find(fileExists) || null;
}

function resolveChromiumFallbackExecutable() {
  const candidates = [
    process.env.AUTO_PIP_LOCAL_EXECUTABLE,
    process.env.AUTO_PIP_PLAYWRIGHT_EXECUTABLE
  ].filter(Boolean);
  return candidates.find(fileExists) || null;
}

function resolveLocalBrowserConfig() {
  const browser = (process.env.AUTO_PIP_LOCAL_BROWSER || process.env.AUTO_PIP_PLAYWRIGHT_BROWSER || 'chromium').toLowerCase();
  const executable = process.env.AUTO_PIP_LOCAL_EXECUTABLE || process.env.AUTO_PIP_PLAYWRIGHT_EXECUTABLE || null;
  const channel = process.env.AUTO_PIP_PLAYWRIGHT_CHANNEL || null;

  if (browser === 'helium') {
    const heliumExecutable = executable || resolveHeliumExecutable();
    return {
      browser,
      executablePath: heliumExecutable,
      channel: null,
      ok: !!heliumExecutable,
      skipReason: heliumExecutable ? null : 'Helium executable not found. Set AUTO_PIP_LOCAL_EXECUTABLE.'
    };
  }

  if (browser !== 'chromium') {
    return {
      browser,
      executablePath: executable,
      channel,
      ok: false,
      skipReason: `Unsupported AUTO_PIP_LOCAL_BROWSER='${browser}'. Use chromium or helium.`
    };
  }

  return {
    browser,
    executablePath: executable || resolveChromiumFallbackExecutable(),
    channel,
    ok: true,
    skipReason: null
  };
}

async function waitForExtensionWorker(context, timeoutMs = 45000) {
  const startedAt = Date.now();
  let wakePage = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    const existing = context.serviceWorkers()[0];
    if (existing) {
      if (wakePage && !wakePage.isClosed()) await wakePage.close().catch(() => {});
      return existing;
    }

    try {
      if (!wakePage || wakePage.isClosed()) wakePage = await context.newPage();
      await wakePage.goto(`data:text/html,<title>Auto%20PiP%20worker%20wake</title>${Date.now()}`, {
        waitUntil: 'domcontentloaded',
        timeout: 5000
      });
    } catch (_) {
      if (wakePage && !wakePage.isClosed()) await wakePage.close().catch(() => {});
      wakePage = null;
    }

    const worker = await context.waitForEvent('serviceworker', { timeout: 1000 }).catch(() => null);
    if (worker) {
      if (wakePage && !wakePage.isClosed()) await wakePage.close().catch(() => {});
      return worker;
    }
  }

  if (wakePage && !wakePage.isClosed()) await wakePage.close().catch(() => {});
  throw new Error(`Timed out waiting for extension service worker after ${timeoutMs}ms`);
}

async function launchLocalContext(options = {}) {
  const browserConfig = resolveLocalBrowserConfig();
  if (!browserConfig.ok) {
    return {
      skipped: true,
      skipReason: browserConfig.skipReason,
      browserConfig
    };
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pip-local-'));
  const artifactDir = options.artifactDir || createArtifactDir(options.artifactPrefix || browserConfig.browser);
  seedProfilePreferences(userDataDir, options.autoPiPOrigins || []);

  const withExtension = options.withExtension !== false;
  const args = [
    '--enable-features=AutoPictureInPictureForVideoPlayback,MediaSessionEnterPictureInPicture,BrowserInitiatedAutomaticPictureInPicture',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DevToolsDebuggingRestrictions,DisableLoadExtensionCommandLineSwitch'
  ];

  if (withExtension) {
    args.unshift(
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    );
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.headless === true,
    channel: browserConfig.channel || undefined,
    executablePath: browserConfig.executablePath || undefined,
    args
  });

  const worker = withExtension ? await waitForExtensionWorker(context, options.workerTimeoutMs || 45000) : null;
  const extensionId = worker ? worker.url().split('/')[2] : null;
  const session = {
    context,
    userDataDir,
    artifactDir,
    browserConfig,
    worker,
    extensionId,
    withExtension,
    async close() {
      await context.close().catch(() => {});
      if (process.env.AUTO_PIP_KEEP_PROFILE !== '1') {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }
  };

  if (worker) context.__autoPipExtensionWorker = worker;
  writeJson(path.join(artifactDir, 'browser.json'), {
    browserConfig,
    userDataDir: process.env.AUTO_PIP_KEEP_PROFILE === '1' ? userDataDir : null,
    extensionId,
    extensionPath: withExtension ? extensionPath : null,
    autoPiPOrigins: options.autoPiPOrigins || []
  });

  return session;
}

async function getBackgroundState(session) {
  if (!session || !session.worker) return null;
  return session.worker.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    const sync = await chrome.storage.sync.get(null);
    return {
      currentTab: globalThis.AutoPip && globalThis.AutoPip.state ? globalThis.AutoPip.state.currentTab : null,
      targetTab: globalThis.AutoPip && globalThis.AutoPip.state ? globalThis.AutoPip.state.targetTab : null,
      pipActiveTab: globalThis.AutoPip && globalThis.AutoPip.state ? globalThis.AutoPip.state.pipActiveTab : null,
      autoPipOnTabSwitch: globalThis.AutoPip && globalThis.AutoPip.state ? globalThis.AutoPip.state.autoPipOnTabSwitch : null,
      local,
      sync
    };
  });
}

module.exports = {
  artifactsRoot,
  createArtifactDir,
  extensionPath,
  getBackgroundState,
  launchLocalContext,
  resolveLocalBrowserConfig,
  waitForExtensionWorker,
  writeJson,
  writeText
};
