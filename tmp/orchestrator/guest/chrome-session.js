'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { chromium } = require('@playwright/test');
const { sleep, expectPoll, withTimeout } = require('./lib/helpers');
const { getVideoStateScript, installPiPEventObserverScript } = require('./lib/pip-verifier');
const { resolveBrowserConfig } = require('./lib/browser-config');
const { getPlatformAdapter } = require('./lib/platform');

const EXTENSION_PATH = path.resolve(__dirname, '..', '..', '..');
const AUTO_PIP_EXCEPTION_KEYS = ['auto_picture_in_picture', 'automatic_picture_in_picture'];

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildAutoPiPPrefs(origins = []) {
  const exceptions = {};

  AUTO_PIP_EXCEPTION_KEYS.forEach((key) => {
    exceptions[key] = {};
  });

  const uniqueOrigins = Array.from(new Set((Array.isArray(origins) ? origins : []).filter(Boolean)));
  uniqueOrigins.forEach((origin) => {
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
      // Ignore malformed origins.
    }
  });

  return {
    profile: {
      default_content_setting_values: {
        auto_picture_in_picture: 1,
        automatic_picture_in_picture: 1
      },
      content_settings: {
        exceptions
      }
    }
  };
}

class ChromeSession {
  constructor(artifacts, options = {}) {
    this.artifacts = artifacts;
    this.options = options;
    this.extensionPath = EXTENSION_PATH;
    this.context = null;
    this.worker = null;
    this.extensionId = null;
    this.profileDir = null;
    this.extensionEnabled = options.withExtension !== false;
  }

  seedProfilePreferences() {
    if (!this.profileDir) return;

    const defaultDir = path.join(this.profileDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    const preferencesPath = path.join(defaultDir, 'Preferences');

    let existing = {};
    if (fs.existsSync(preferencesPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
      } catch (_) {
        existing = {};
      }
    }

    const seeded = buildAutoPiPPrefs(this.options.autoPiPOrigins || []);
    const next = ensureObject(existing);
    next.profile = ensureObject(next.profile);
    next.profile.default_content_setting_values = {
      ...ensureObject(next.profile.default_content_setting_values),
      ...seeded.profile.default_content_setting_values
    };
    next.profile.content_settings = ensureObject(next.profile.content_settings);
    next.profile.content_settings.exceptions = ensureObject(next.profile.content_settings.exceptions);

    Object.entries(seeded.profile.content_settings.exceptions).forEach(([key, values]) => {
      next.profile.content_settings.exceptions[key] = {
        ...ensureObject(next.profile.content_settings.exceptions[key]),
        ...values
      };
    });

    fs.writeFileSync(preferencesPath, `${JSON.stringify(next, null, 2)}\n`);
  }

  async start() {
    const launchOptions = {
      headless: this.options.headless === true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=DevToolsDebuggingRestrictions,DisableLoadExtensionCommandLineSwitch',
        '--enable-features=AutoPictureInPictureForVideoPlayback,BrowserInitiatedAutomaticPictureInPicture'
      ]
    };

    if (this.extensionEnabled) {
      launchOptions.args.unshift(
        `--disable-extensions-except=${this.extensionPath}`,
        `--load-extension=${this.extensionPath}`
      );
    }

    const browserConfig = this.resolveBrowserConfig();
    if (this.extensionEnabled && (browserConfig.key === 'chrome' || browserConfig.key === 'edge')) {
      throw new Error(
        'Playwright cannot side-load extensions in branded Chrome/Edge; use browser=chromium for automated extension scenarios.'
      );
    }
    if (browserConfig.executablePath) {
      launchOptions.executablePath = browserConfig.executablePath;
    }
    if (browserConfig.channel) {
      launchOptions.channel = browserConfig.channel;
    }

    const maxLaunchAttempts = this.extensionEnabled ? 2 : 1;
    let lastError = null;
    let launchAttempt = 0;

    for (launchAttempt = 1; launchAttempt <= maxLaunchAttempts; launchAttempt += 1) {
      this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-chromium-auto-pip-'));
      this.seedProfilePreferences();

      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, launchOptions);

        if (this.extensionEnabled) {
          this.worker = this.context.serviceWorkers()[0] || null;
          if (!this.worker) {
            this.worker = await this.context.waitForEvent('serviceworker', {
              timeout: browserConfig.workerTimeoutMs || 15000
            }).catch(() => null);
          }
          if (!this.worker) {
            throw new Error('Timed out waiting for extension service worker');
          }
          this.extensionId = this.worker.url().split('/')[2];
        } else {
          this.worker = null;
          this.extensionId = null;
        }

        this.artifacts.writeJson('chrome-session.json', {
          browser: browserConfig.key,
          browserConfig,
          extensionEnabled: this.extensionEnabled,
          extensionId: this.extensionId,
          profileDir: this.profileDir,
          extensionPath: this.extensionEnabled ? this.extensionPath : null,
          autoPiPOrigins: this.options.autoPiPOrigins || [],
          autoPiPPrefKeys: AUTO_PIP_EXCEPTION_KEYS,
          launchAttempt,
          maxLaunchAttempts
        });

        return this;
      } catch (error) {
        lastError = error;
        if (this.context) {
          await this.context.close().catch(() => {});
        }
        this.context = null;
        this.worker = null;
        this.extensionId = null;
        if (this.profileDir) {
          try {
            fs.rmSync(this.profileDir, { recursive: true, force: true });
          } catch (_) {
            // Best-effort cleanup before a retry.
          }
        }
        if (launchAttempt < maxLaunchAttempts) {
          await sleep(1000);
          continue;
        }
      }
    }

    throw lastError || new Error('Failed to start Chrome session');
  }

  resolveBrowserConfig() {
    return resolveBrowserConfig(this.options);
  }

  buildHostClockAnchor() {
    const startedEpochMs = Number(this.options.hostStageStartedEpochMs);
    const guestPerfStartedMs = Number(this.options.hostStageGuestPerfStartedMs);
    if (!Number.isFinite(startedEpochMs) || !Number.isFinite(guestPerfStartedMs)) {
      return null;
    }
    return {
      source: 'host-stage-monotonic',
      hostNowEpochMs: startedEpochMs + (performance.now() - guestPerfStartedMs),
      hostStageStartedAt: this.options.hostStageStartedAt || null,
      hostStageStartedEpochMs: startedEpochMs
    };
  }

  requireExtension(requireWorker = true) {
    if (!this.extensionEnabled || !this.extensionId || (requireWorker && !this.worker)) {
      throw new Error('This ChromeSession was started without an active side-loaded extension');
    }
  }

  async hasExtensionWorker() {
    if (!this.context) return false;
    return this.context.serviceWorkers().some((worker) => {
      try {
        return typeof worker.url === 'function' && worker.url().startsWith('chrome-extension://');
      } catch (_) {
        return false;
      }
    });
  }

  async openExtensionPage(pagePath = 'options.html') {
    this.requireExtension(false);
    const page = await this.context.newPage();
    await page.goto(`chrome-extension://${this.extensionId}/${pagePath}`);
    return page;
  }

  async reloadExtension() {
    this.requireExtension(false);
    const browserConfig = this.resolveBrowserConfig();
    const previousExtensionId = this.extensionId;
    const page = await this.openExtensionPage('reload-extension.html');
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(1500);

    const existingWorker = this.context.serviceWorkers().find((worker) => {
      try {
        return typeof worker.url === 'function' && worker.url().includes(`chrome-extension://${previousExtensionId}/`);
      } catch (_) {
        return false;
      }
    }) || null;

    this.worker = existingWorker;
    if (!this.worker) {
      try {
        const nextWorker = await this.context.waitForEvent('serviceworker', {
          timeout: Math.min(browserConfig.workerTimeoutMs || 15000, 15000),
          predicate: (worker) => {
            try {
              return typeof worker.url === 'function' && worker.url().includes(`chrome-extension://${previousExtensionId}/`);
            } catch (_) {
              return false;
            }
          }
        });
        this.worker = nextWorker;
      } catch (_) {
        this.worker = null;
      }
    }

    this.extensionId = this.worker
      ? this.worker.url().split('/')[2]
      : previousExtensionId;

    return {
      ok: true,
      extensionId: this.extensionId,
      workerDetected: !!this.worker,
      workerCount: this.context.serviceWorkers().length
    };
  }

  async clearExtensionStorage() {
    this.requireExtension();
    return this.worker.evaluate(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();
      return { ok: true };
    });
  }

  async allowAutoPiPForOrigin(origin) {
    this.requireExtension();
    if (!origin) return { ok: false, reason: 'missing-origin' };

    return this.worker.evaluate(async (targetOrigin) => {
      const api = chrome && chrome.contentSettings && chrome.contentSettings.autoPictureInPicture
        ? chrome.contentSettings.autoPictureInPicture
        : null;
      if (!api) {
        return { ok: false, reason: 'contentSettingsUnavailable' };
      }

      let primaryPattern = null;
      try {
        const parsed = new URL(targetOrigin);
        primaryPattern = `${parsed.protocol}//${parsed.host}/*`;
      } catch (_) {
        return { ok: false, reason: 'invalid-origin' };
      }

      await new Promise((resolve) => {
        api.set({ primaryPattern, setting: 'allow', scope: 'regular' }, () => resolve());
      });

      if (chrome.runtime.lastError) {
        return { ok: false, reason: chrome.runtime.lastError.message, primaryPattern };
      }

      return { ok: true, primaryPattern };
    }, origin);
  }

  async setModes(modes) {
    this.requireExtension();
    const settings = {
      autoPipOnTabSwitch: !!modes.tab,
      autoPipOnWindowSwitch: !!modes.window,
      autoPipOnAppSwitch: !!modes.app
    };
    return this.worker.evaluate(async (nextSettings) => {
      if (typeof settingsReady !== 'undefined' && settingsReady && typeof settingsReady.then === 'function') {
        try { await settingsReady; } catch (_) {}
      }
      let platformOs = null;
      try {
        const info = await new Promise((resolve) => chrome.runtime.getPlatformInfo(resolve));
        platformOs = info && info.os ? info.os : null;
      } catch (_) {}
      if (platformOs === 'linux') {
        nextSettings.autoPipOnAppSwitch = false;
      }
      autoPipOnTabSwitch = nextSettings.autoPipOnTabSwitch;
      autoPipOnWindowSwitch = nextSettings.autoPipOnWindowSwitch;
      autoPipOnAppSwitch = nextSettings.autoPipOnAppSwitch;
      await chrome.storage.sync.set(nextSettings);
      await chrome.storage.local.set(nextSettings);
      return {
        ok: true,
        platformOs,
        appSwitchSupported: platformOs !== 'linux',
        autoPipOnTabSwitch,
        autoPipOnWindowSwitch,
        autoPipOnAppSwitch
      };
    }, settings);
  }

  async primeActiveTab() {
    this.requireExtension();
    return this.worker.evaluate(() => new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const tabList = Array.isArray(tabs) ? tabs : [];
        const candidateTabs = tabList.filter((tab) => isValidTab(tab) && isAutoPipAllowedTab(tab));

        candidateTabs.sort((a, b) => {
          const aScore = (a.active ? 2 : 0) + (a.windowId === lastFocusedNormalWindowId ? 1 : 0);
          const bScore = (b.active ? 2 : 0) + (b.windowId === lastFocusedNormalWindowId ? 1 : 0);
          return bScore - aScore;
        });

        if (candidateTabs.length === 0) {
          resolve({ ok: false, reason: 'no_candidate_tabs' });
          return;
        }

        const tryPrimeAtIndex = (index) => {
          if (index >= candidateTabs.length) {
            resolve({ ok: false, reason: 'no_video_tab_found' });
            return;
          }
          const tab = candidateTabs[index];
          injectCheckVideoScript(tab.id, (results) => {
            const hasVideo = hasAnyFrameTrue(results);
            if (!hasVideo) {
              tryPrimeAtIndex(index + 1);
              return;
            }
            setTargetTab(tab.id);
            injectTriggerAutoPiP(tab.id, () => {
              resolve({ ok: true, tabId: tab.id, targetTab, targetWindowId });
            });
          });
        };

        tryPrimeAtIndex(0);
      });
    }));
  }

  async clearDebugLog() {
    this.requireExtension();
    return this.worker.evaluate(() => {
      log = [];
      return { ok: true };
    });
  }

  async getDebugLog() {
    this.requireExtension();
    return this.worker.evaluate(() => Array.isArray(log) ? log.slice() : []);
  }

  async getBackgroundState() {
    this.requireExtension();
    return this.worker.evaluate(async () => {
      if (typeof settingsReady !== 'undefined' && settingsReady && typeof settingsReady.then === 'function') {
        try { await settingsReady; } catch (_) {}
      }
      return {
        currentTab,
        prevTab,
        targetTab,
        targetWindowId,
        lastFocusedWindowId,
        lastFocusedNormalWindowId,
        pipActiveTab,
        autoPipOnTabSwitch,
        autoPipOnWindowSwitch,
        autoPipOnAppSwitch,
        logLength: Array.isArray(log) ? log.length : null
      };
    });
  }

  async createWindow(url, focused = true, windowOptions = {}) {
    if (this.worker) {
      return this.worker.evaluate(async ({ targetUrl, targetFocused }) => {
        const created = await new Promise((resolve) =>
          chrome.windows.create({ url: targetUrl, focused: targetFocused }, resolve)
        );
        const activeTab = created && created.tabs ? created.tabs.find((tab) => tab.active) : null;
        return {
          windowId: created ? created.id : null,
          tabId: activeTab ? activeTab.id : null,
          bounds: created
            ? {
                left: created.left,
                top: created.top,
                width: created.width,
                height: created.height,
                state: created.state
              }
            : null
        };
      }, { targetUrl: url, targetFocused: focused, targetWindowOptions: windowOptions || {} });
    }

    const page = await this.context.newPage();
    await page.goto(url);
    if (focused) await page.bringToFront().catch(() => {});
    return {
      windowId: null,
      tabId: null,
      pageUrl: page.url()
    };
  }

  async normaliseWindow(windowId, windowOptions = {}, focused = true) {
    if (!this.worker || windowId == null) {
      return { ok: false, skipped: true, reason: 'missing-worker-or-window-id' };
    }

    return this.worker.evaluate(async ({ targetWindowId, targetWindowOptions, targetFocused }) => {
      const updateWindow = (updates) => new Promise((resolve) => {
        chrome.windows.update(targetWindowId, updates, (updated) => {
          resolve({
            updates,
            ok: !chrome.runtime.lastError,
            error: chrome.runtime.lastError ? chrome.runtime.lastError.message : null,
            window: updated
              ? {
                  id: updated.id,
                  focused: updated.focused,
                  left: updated.left,
                  top: updated.top,
                  width: updated.width,
                  height: updated.height,
                  state: updated.state
                }
              : null
          });
        });
      });

      const results = [];
      results.push(await updateWindow({ state: 'normal' }));

      const geometry = {};
      ['left', 'top', 'width', 'height'].forEach((key) => {
        const value = Number(targetWindowOptions && targetWindowOptions[key]);
        if (Number.isFinite(value)) {
          geometry[key] = value;
        }
      });
      if (Object.keys(geometry).length > 0) {
        results.push(await updateWindow(geometry));
      }
      if (targetFocused !== null) {
        results.push(await updateWindow({ focused: !!targetFocused }));
      }

      const last = results[results.length - 1] || null;
      return {
        ok: results.every((result) => result && result.ok),
        results,
        window: last ? last.window : null
      };
    }, {
      targetWindowId: windowId,
      targetWindowOptions: windowOptions || {},
      targetFocused: focused == null ? null : !!focused
    });
  }

  async openTab(url, focused = true) {
    const page = await this.context.newPage();
    await page.goto(url);
    if (focused) await page.bringToFront().catch(() => {});
    return page;
  }

  async openPopupWindow(sourcePage, url) {
    if (!sourcePage) {
      throw new Error('openPopupWindow requires a source page');
    }
    const popupPromise = sourcePage.waitForEvent('popup', { timeout: 10000 });
    await sourcePage.evaluate((targetUrl) => {
      window.open(targetUrl, '_blank', 'popup=yes,width=900,height=700');
    }, url);
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    return popup;
  }

  async listPages() {
    const pages = this.context ? this.context.pages() : [];
    const described = [];
    for (const page of pages) {
      let title = null;
      let url = null;
      try { title = await page.title(); } catch (_) { title = null; }
      try { url = page.url(); } catch (_) { url = null; }
      described.push({ title, url });
    }
    return described;
  }

  async focusWindow(windowId, options = {}) {
    if (this.worker && windowId != null) {
      await this.worker.evaluate((targetWindowId) => new Promise((resolve) => {
        chrome.windows.update(targetWindowId, { state: 'normal' }, () => {
          chrome.windows.update(targetWindowId, { focused: true }, () => resolve());
        });
      }), windowId);
    }

    if (options && options.title) {
      const adapter = getPlatformAdapter();
      if (adapter && adapter.focusWindow) {
        await adapter.focusWindow(options.title).catch(() => null);
      }
    }
  }

  async activateTab(tabId) {
    this.requireExtension();
    await this.worker.evaluate((targetTabId) => new Promise((resolve) => {
      chrome.tabs.update(targetTabId, { active: true }, () => resolve());
    }), tabId);
  }

  async closeWindow(windowId) {
    this.requireExtension();
    await this.worker.evaluate((targetWindowId) => new Promise((resolve) => {
      chrome.windows.remove(targetWindowId, () => resolve());
    }), windowId);
  }

  async getTabFlags(tabId) {
    this.requireExtension();
    return this.worker.evaluate(async (targetTabId) => {
      const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => ({
          registered: window.__auto_pip_registered__ === true,
          disabled: window.__auto_pip_disabled__ === true,
          blocked: window.__auto_pip_blocked__ === true
        })
      });
      return result && result[0] ? result[0].result : null;
    }, tabId);
  }

  async requestImmediatePiP(tabId) {
    this.requireExtension();
    return this.worker.evaluate(async (targetTabId) => {
      return new Promise((resolve) => {
        injectImmediatePiPScript(targetTabId, (results) => resolve(results || null));
      });
    }, tabId);
  }

  async closeExtensionTabs() {
    this.requireExtension();
    return this.worker.evaluate((currentExtensionId) => new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const ids = (Array.isArray(tabs) ? tabs : [])
          .filter((tab) => tab && typeof tab.url === 'string' && tab.url.startsWith(`chrome-extension://${currentExtensionId}/`))
          .map((tab) => tab.id)
          .filter((id) => id != null);
        if (ids.length === 0) {
          resolve([]);
          return;
        }
        chrome.tabs.remove(ids, () => resolve(ids));
      });
    }), this.extensionId);
  }

  async closeOtherBlankWindows() {
    const removablePages = this.context.pages().filter((page) => {
      const url = typeof page.url === 'function' ? page.url() : '';
      return url === 'about:blank' || url === 'about:blank#chrome-auto-pip-helper';
    });

    const closed = [];
    for (const page of removablePages) {
      try {
        closed.push(page.url());
        await page.close({ runBeforeUnload: false });
      } catch (_) {
        // Best-effort cleanup only.
      }
    }
    return closed;
  }

  async waitForPage(predicate, timeoutMs = 15000) {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
      const existing = this.context.pages().find(predicate);
      if (existing) return existing;
      try {
        return await this.context.waitForEvent('page', { predicate, timeout: 500 });
      } catch (_) {
        await sleep(100);
      }
    }
    throw new Error('Timed out waiting for a matching Chrome page');
  }

  async ensureVideoPlaying(page, options = {}) {
    await withTimeout(
      () => page.waitForSelector('video', { timeout: 15000 }),
      16000,
      'waitForSelector(video)'
    );
    await withTimeout(
      () => page.evaluate(installPiPEventObserverScript(), this.buildHostClockAnchor()).catch(() => {}),
      5000,
      'installPiPEventObserverScript'
    );
    await withTimeout(
      () => page.click('body').catch(() => {}),
      5000,
      'video page click'
    );
    await withTimeout(
      () => page.evaluate(async ({ muted = true, volume = 1 }) => {
        const video = document.querySelector('video');
        if (!video) return;
        video.muted = !!muted;
        try { video.volume = volume; } catch (_) {}
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          await playPromise.catch(() => {});
        }
      }, options),
      10000,
      'video play evaluation'
    );
    return withTimeout(
      () => expectPoll(
        () => page.evaluate(getVideoStateScript()),
        (state) => !!(state.videoExists && state.videoPlaying),
        10000
      ),
      11000,
      'video playback poll'
    );
  }

  async close() {
    if (this.context) {
      await this.context.close().catch(() => {});
    }
    await sleep(500);
    if (this.profileDir) {
      try {
        fs.rmSync(this.profileDir, { recursive: true, force: true });
      } catch (_) {
        // Temporary profile cleanup should not fail the result.
      }
    }
  }
}

module.exports = { ChromeSession };
