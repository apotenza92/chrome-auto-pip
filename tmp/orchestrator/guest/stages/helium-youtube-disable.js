'use strict';

const path = require('path');
const { ChromeSession } = require('../chrome-session');
const { sleep, expectPoll, scaleTimeout } = require('../lib/helpers');
const { getPlatformAdapter } = require('../lib/platform');
const { resetStageEnvironment } = require('../lib/stage-reset');

const YOUTUBE_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&autoplay=1&mute=1';
const SECOND_URL = 'https://www.wikipedia.org/';

function videoStateScript() {
  return () => {
    const video = document.querySelector('video');
    return {
      url: location.href,
      title: document.title,
      videoExists: !!video,
      videoPlaying: !!video && !video.paused && !video.ended && video.currentTime > 0,
      currentTime: video ? video.currentTime : null,
      readyState: video ? video.readyState : null,
      pip: !!document.pictureInPictureElement,
      autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
      managedAttr: !!video && video.hasAttribute('data-auto-pip-managed'),
      pageDisabled: window.__auto_pip_page_disabled__ === true,
      registered: window.__auto_pip_registered__ === true,
      pipEnteredAfterReset: window.__auto_pip_disable_scenario_pip_entered__ === true
    };
  };
}

async function dismissYouTubeOverlays(page) {
  for (const label of [/accept all/i, /i agree/i, /no thanks/i, /skip ad/i, /got it/i]) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await button.click({ timeout: 2000 }).catch(() => {});
      await sleep(500);
    }
  }
}

async function ensureYouTubePlaying(page, timeoutMs) {
  await page.waitForSelector('video', { timeout: timeoutMs });
  await dismissYouTubeOverlays(page);
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return false;
    video.muted = true;
    try { video.volume = 0; } catch (_) {}
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      await playPromise.catch(() => {});
    }
    return true;
  });
  await page.click('body', { timeout: 5000 }).catch(() => {});
  return expectPoll(
    () => page.evaluate(videoStateScript()).catch((error) => ({ error: error.message })),
    (state) => !!(state && state.videoExists && state.videoPlaying),
    timeoutMs,
    500
  );
}

async function waitForAutoPipArmed(page, timeoutMs) {
  return expectPoll(
    () => page.evaluate(videoStateScript()).catch((error) => ({ error: error.message })),
    (state) => !!(state && state.videoPlaying && (state.autoPipAttr || state.registered)),
    timeoutMs,
    500
  );
}

async function waitForPip(page, timeoutMs) {
  return expectPoll(
    () => page.evaluate(videoStateScript()).catch((error) => ({ error: error.message })),
    (state) => !!(state && state.pip === true),
    timeoutMs,
    500
  );
}

async function resetPipProbe(page) {
  await page.evaluate(() => {
    window.__auto_pip_disable_scenario_pip_entered__ = false;
    if (!window.__auto_pip_disable_scenario_listener__) {
      document.addEventListener('enterpictureinpicture', () => {
        window.__auto_pip_disable_scenario_pip_entered__ = true;
      }, true);
      window.__auto_pip_disable_scenario_listener__ = true;
    }
  }).catch(() => {});
}

async function assertNoPipAfterSwitch(youtubePage, secondPage, timeoutMs) {
  await resetPipProbe(youtubePage);
  await secondPage.bringToFront().catch(() => {});
  await sleep(Math.min(timeoutMs, 6000));
  return youtubePage.evaluate(videoStateScript()).catch((error) => ({ error: error.message }));
}

async function disableFromOptions(session) {
  const optionsPage = await session.openExtensionPage('options.html');
  await optionsPage.waitForFunction(() => {
    const el = document.getElementById('autoPipOnTabSwitch');
    return el && !el.disabled;
  }, { timeout: 15000 });
  await optionsPage.evaluate(() => {
    const el = document.getElementById('autoPipOnTabSwitch');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(1500);
  await optionsPage.close().catch(() => {});
}

async function disableFromBrowserControls(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extensionId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  }).catch(() => {});
  await sleep(1000);
  const result = await page.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const managerRoot = manager && manager.shadowRoot;
    const detail = managerRoot && (
      managerRoot.querySelector('extensions-detail-view') ||
      managerRoot.querySelector('extensions-item-list')
    );
    const roots = [document, managerRoot, detail && detail.shadowRoot].filter(Boolean);
    for (const root of roots) {
      const toggle = root.querySelector('#enableToggle, cr-toggle, extensions-toggle-row cr-toggle');
      if (toggle) {
        toggle.click();
        return { ok: true, selector: toggle.id || toggle.tagName };
      }
    }
    return { ok: false, reason: 'enable toggle not found' };
  }).catch((error) => ({ ok: false, reason: error.message }));
  await sleep(3000);
  await page.close().catch(() => {});
  return result;
}

async function runScenario(artifacts, adapter, label, disableFn, options) {
  const session = await new ChromeSession(artifacts, {
    ...options,
    browser: 'helium',
    autoPiPOrigins: ['https://www.youtube.com']
  }).start();
  const timeline = [];

  try {
    await session.allowAutoPiPForOrigin('https://www.youtube.com').catch(() => null);
    await session.setModes({ tab: true, window: false, app: false });

    const youtubePage = await session.openTab(YOUTUBE_URL, true);
    const secondPage = await session.openTab(SECOND_URL, false);
    const playing = await ensureYouTubePlaying(youtubePage, scaleTimeout(30000, options.timeoutScale || 1));
    const armed = await waitForAutoPipArmed(youtubePage, scaleTimeout(15000, options.timeoutScale || 1));
    timeline.push({ label: `${label}-armed`, playing, armed });

    await secondPage.bringToFront().catch(() => {});
    const pipBeforeDisable = await waitForPip(youtubePage, scaleTimeout(15000, options.timeoutScale || 1));
    timeline.push({ label: `${label}-pip-before-disable`, state: pipBeforeDisable });

    await youtubePage.bringToFront().catch(() => {});
    await ensureYouTubePlaying(youtubePage, scaleTimeout(15000, options.timeoutScale || 1));

    const disableResult = await disableFn(session, youtubePage, secondPage);
    const stateAfterDisable = await youtubePage.evaluate(videoStateScript()).catch((error) => ({ error: error.message }));
    const stateAfterSwitch = await assertNoPipAfterSwitch(
      youtubePage,
      secondPage,
      scaleTimeout(8000, options.timeoutScale || 1)
    );

    timeline.push({
      label: `${label}-after-disable`,
      disableResult,
      stateAfterDisable,
      stateAfterSwitch
    });

    if (adapter && adapter.screenshot) {
      await adapter.screenshot(path.join(artifacts.rootDir, `${label}-desktop.png`)).catch(() => null);
    }

    const ok = !!(
      armed &&
      armed.videoPlaying === true &&
      (armed.autoPipAttr === true || armed.registered === true) &&
      stateAfterSwitch &&
      stateAfterSwitch.pip !== true &&
      stateAfterSwitch.pipEnteredAfterReset !== true &&
      stateAfterSwitch.autoPipAttr !== true &&
      stateAfterSwitch.managedAttr !== true &&
      stateAfterSwitch.pageDisabled === true
    );

    return {
      ok,
      pipBeforeDisableObserved: !!(pipBeforeDisable && pipBeforeDisable.pip === true),
      timeline
    };
  } finally {
    artifacts.writeJson(`${label}-timeline.json`, timeline);
    await session.close().catch(() => {});
  }
}

async function run(artifacts, options = {}) {
  const reset = await resetStageEnvironment({ killBrowser: true, sleepMs: 1500 });
  const adapter = getPlatformAdapter();
  const optionsScenario = await runScenario(
    artifacts,
    adapter,
    'options-disable',
    (session) => disableFromOptions(session),
    options
  );
  const controlsScenario = await runScenario(
    artifacts,
    adapter,
    'browser-controls-disable',
    (session) => disableFromBrowserControls(session.context, session.extensionId),
    options
  );

  const ok = optionsScenario.ok && controlsScenario.ok;
  return {
    ok,
    command: 'helium-youtube-disable',
    summary: ok
      ? 'Helium YouTube disable scenarios did not re-enter PiP'
      : 'One or more Helium YouTube disable scenarios re-entered PiP or could not be verified',
    details: {
      reset,
      optionsScenario,
      controlsScenario
    }
  };
}

module.exports = { run };
