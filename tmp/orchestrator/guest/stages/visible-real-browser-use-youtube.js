'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { chromium } = require('@playwright/test');
const { sleep, expectPoll, scaleTimeout, withTimeout } = require('../lib/helpers');
const { resetStageEnvironment } = require('../lib/stage-reset');

const EXTENSION_PATH = path.resolve(__dirname, '..', '..', '..', '..');
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&autoplay=1&mute=1';
const NEWS_URL = 'https://apnews.com/';
const THIRD_URL = 'https://www.wikipedia.org/';
const DEBUG_PORT = 9224;

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

function runPowerShell(script, timeout = 30000) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'PowerShell command failed').trim());
  }
  return result.stdout || '';
}

function httpGetJson(url, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
    req.on('error', reject);
  });
}

async function waitForCdp(port, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      return await httpGetJson(`http://127.0.0.1:${port}/json/version`, 1000);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw lastError || new Error(`Timed out waiting for CDP on ${port}`);
}

function findChromiumExecutable() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const browsersDir = path.join(localAppData, 'ms-playwright');
  try {
    const entries = fs.readdirSync(browsersDir)
      .filter(entry => entry.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const entry of entries) {
      const root = path.join(browsersDir, entry);
      const candidates = [
        path.join(root, 'chrome-win64', 'chrome.exe'),
        path.join(root, 'chrome-win', 'chrome.exe')
      ];
      const found = candidates.find(candidate => fs.existsSync(candidate));
      if (found) return found;
    }
  } catch (_) { }
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

function buildLaunchScript(profileDir, browserExecutable) {
  const args = [
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DevToolsDebuggingRestrictions,DisableLoadExtensionCommandLineSwitch',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--enable-features=AutoPictureInPictureForVideoPlayback,MediaSessionEnterPictureInPicture,BrowserInitiatedAutomaticPictureInPicture',
    `--user-data-dir="${profileDir}"`,
    `--disable-extensions-except="${EXTENSION_PATH}"`,
    `--load-extension="${EXTENSION_PATH}"`,
    '--new-window',
    'about:blank'
  ].join(' ');

  return `
    Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
    Unregister-ScheduledTask -TaskName AutoPipVisibleChrome -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item '${psQuote(profileDir)}' -Recurse -Force -ErrorAction SilentlyContinue
    $action = New-ScheduledTaskAction -Execute '${psQuote(browserExecutable)}' -Argument '${psQuote(args)}'
    $trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(5))
    $principal = New-ScheduledTaskPrincipal -UserId 'alex' -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName AutoPipVisibleChrome -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName AutoPipVisibleChrome
  `;
}

async function waitForExtensionWorker(context, timeoutMs) {
  const startedAt = Date.now();
  const isAutoPipWorker = (worker) => {
    try {
      const url = worker.url();
      return url.startsWith('chrome-extension://') && url.endsWith('/main.js');
    } catch (_) {
      return false;
    }
  };

  while ((Date.now() - startedAt) < timeoutMs) {
    const worker = context.serviceWorkers().find(isAutoPipWorker);
    if (worker) return worker;
    try {
      const next = await context.waitForEvent('serviceworker', { timeout: 1000 });
      if (next && isAutoPipWorker(next)) return next;
    } catch (_) {}
  }
  throw new Error('Timed out waiting for visible Chrome extension service worker');
}

function samePath(left, right) {
  if (!left || !right) return false;
  try {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
  } catch (_) {
    return String(left).toLowerCase() === String(right).toLowerCase();
  }
}

function findLoadedExtensionId(profileDir) {
  const prefsPath = path.join(profileDir, 'Default', 'Preferences');
  if (!fs.existsSync(prefsPath)) return null;

  let prefs;
  try {
    prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
  } catch (_) {
    return null;
  }

  const settings = prefs && prefs.extensions && prefs.extensions.settings
    ? prefs.extensions.settings
    : {};

  for (const [id, setting] of Object.entries(settings)) {
    const manifest = setting && setting.manifest ? setting.manifest : {};
    if (manifest.name === 'Automatic Picture-in-Picture (PiP)') {
      return id;
    }
    if (samePath(setting && setting.path, EXTENSION_PATH)) {
      return id;
    }
  }

  return null;
}

async function waitForLoadedExtensionId(profileDir, timeoutMs) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const extensionId = findLoadedExtensionId(profileDir);
    if (extensionId) return extensionId;
    await sleep(500);
  }
  return null;
}

async function setExtensionDefaults(worker) {
  return worker.evaluate(async () => {
    await chrome.storage.sync.set({ autoPipOnTabSwitch: true });
    await chrome.storage.local.set({ autoPipOnTabSwitch: true });
    const api = chrome.contentSettings && chrome.contentSettings.autoPictureInPicture
      ? chrome.contentSettings.autoPictureInPicture
      : null;
    if (api) {
      await new Promise(resolve => {
        api.set({ primaryPattern: 'https://www.youtube.com/*', setting: 'allow', scope: 'regular' }, () => resolve());
      });
    }
    return { ok: true };
  });
}

function videoStateScript() {
  return () => {
    const video = document.querySelector('video');
    return {
      url: location.href,
      title: document.title,
      videoExists: !!video,
      videoPlaying: !!video && !video.paused && !video.ended && video.currentTime > 0,
      currentTime: video ? video.currentTime : null,
      paused: video ? video.paused : null,
      readyState: video ? video.readyState : null,
      muted: video ? video.muted : null,
      pip: !!document.pictureInPictureElement,
      autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
      registered: window.__auto_pip_registered__ === true,
      playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null,
      hidden: document.visibilityState
    };
  };
}

async function dismissOverlays(page) {
  for (const label of [/accept all/i, /i agree/i, /no thanks/i, /got it/i, /skip ad/i]) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible({ timeout: 700 }).catch(() => false)) {
      await button.click({ timeout: 2000 }).catch(() => {});
      await sleep(300);
    }
  }
}

async function ensureYoutubePlaying(page, timeoutMs) {
  await page.waitForSelector('video', { timeout: timeoutMs });
  await dismissOverlays(page);
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return false;
    video.muted = true;
    try { video.volume = 0; } catch (_) {}
    const promise = video.play();
    if (promise && typeof promise.catch === 'function') await promise.catch(() => {});
    return true;
  });
  await page.click('body', { timeout: 5000 }).catch(() => {});
  return expectPoll(
    () => page.evaluate(videoStateScript()),
    state => !!(state && state.videoExists && state.videoPlaying),
    timeoutMs,
    500
  );
}

async function waitForAutoPipArmed(page, timeoutMs) {
  return expectPoll(
    () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
    state => !!(state && state.videoPlaying && (state.autoPipAttr || state.registered)),
    timeoutMs,
    500
  );
}

async function waitForPip(page, timeoutMs) {
  return expectPoll(
    () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
    state => !!(state && state.pip === true),
    timeoutMs,
    500
  );
}

async function createPage(context, label) {
  const page = await withTimeout(
    () => context.newPage(),
    scaleTimeout(10000, 1),
    `${label} new page`
  );
  return page;
}

async function navigateAndFocusPage(page, url, label, timeoutMs) {
  await withTimeout(
    () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }),
    timeoutMs + 5000,
    `${label} navigation`
  ).catch(() => {});
  await withTimeout(
    () => page.bringToFront(),
    scaleTimeout(5000, 1),
    `${label} focus`
  ).catch(() => {});
  return page;
}

async function run(artifacts, options = {}) {
  const reset = await resetStageEnvironment({ killBrowser: true, sleepMs: 1000 });
  const profileDir = path.join(os.tmpdir(), `auto-pip-visible-${Date.now()}`);
  const browserExecutable = findChromiumExecutable();
  const launchStdout = runPowerShell(buildLaunchScript(profileDir, browserExecutable), 30000);
  const cdpVersion = await waitForCdp(DEBUG_PORT, scaleTimeout(20000, options.timeoutScale));

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  const context = browser.contexts()[0];
  const timeline = [];
  const serviceWorkerUrls = () => context.serviceWorkers().map(worker => worker.url());

  try {
    const extensionId = await waitForLoadedExtensionId(profileDir, scaleTimeout(10000, options.timeoutScale));

    const initialPages = context.pages();
    const youtubePage = initialPages[0] || await createPage(context, 'youtube');
    const newsPage = initialPages[1] || await createPage(context, 'news');
    const thirdPage = initialPages[2] || await createPage(context, 'third');

    await youtubePage.goto(YOUTUBE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await youtubePage.bringToFront();
    const youtubePlaying = await ensureYoutubePlaying(youtubePage, scaleTimeout(30000, options.timeoutScale));

    const worker = await waitForExtensionWorker(context, scaleTimeout(10000, options.timeoutScale)).catch(() => null);
    if (worker) {
      await setExtensionDefaults(worker);
    }
    const youtubeArmed = await waitForAutoPipArmed(youtubePage, scaleTimeout(15000, options.timeoutScale));
    timeline.push({ label: 'youtube-opened', state: youtubeArmed, playback: youtubePlaying });

    await navigateAndFocusPage(newsPage, NEWS_URL, 'news', scaleTimeout(30000, options.timeoutScale));
    timeline.push({ label: 'news-active', state: await waitForPip(youtubePage, scaleTimeout(15000, options.timeoutScale)) });

    await youtubePage.bringToFront();
    timeline.push({ label: 'youtube-returned', state: await ensureYoutubePlaying(youtubePage, scaleTimeout(15000, options.timeoutScale)) });

    await navigateAndFocusPage(thirdPage, THIRD_URL, 'third', scaleTimeout(30000, options.timeoutScale));
    timeline.push({ label: 'third-active', state: await waitForPip(youtubePage, scaleTimeout(15000, options.timeoutScale)) });

    await newsPage.bringToFront();
    timeline.push({ label: 'news-returned', state: await waitForPip(youtubePage, scaleTimeout(8000, options.timeoutScale)) });

    await youtubePage.bringToFront();
    timeline.push({ label: 'youtube-final', state: await ensureYoutubePlaying(youtubePage, scaleTimeout(15000, options.timeoutScale)) });

    artifacts.writeJson('visible-real-browser-use-timeline.json', timeline);
    const pipChecks = timeline
      .filter(step => ['news-active', 'third-active', 'news-returned'].includes(step.label))
      .map(step => ({ label: step.label, pip: !!(step.state && step.state.pip), state: step.state }));
    const ok = pipChecks.length === 3 && pipChecks.every(check => check.pip);

    return {
      ok,
      command: 'visible-real-browser-use-youtube',
      summary: ok
        ? 'Visible Windows Chrome YouTube/news/third-tab sequence showed PiP on every background switch'
        : 'Visible Windows Chrome sequence did not show PiP on every background switch',
      details: {
        reset,
        profileDir,
        browserExecutable,
        cdpVersion,
        launchStdout,
        extensionId,
        extensionWorkerUrl: worker ? worker.url() : null,
        serviceWorkerUrls: serviceWorkerUrls(),
        pipChecks,
        timelineLength: timeline.length
      }
    };
  } finally {
    artifacts.writeJson('visible-real-browser-use-timeline.json', timeline);
    await browser.close().catch(() => {});
    runPowerShell(`
      Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
      Unregister-ScheduledTask -TaskName AutoPipVisibleChrome -Confirm:$false -ErrorAction SilentlyContinue
    `, 30000);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { run };
