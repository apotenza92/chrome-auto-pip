'use strict';

const path = require('path');
const { ChromeSession } = require('../chrome-session');
const { resetStageEnvironment } = require('../lib/stage-reset');
const { sleep, expectPoll, scaleTimeout } = require('../lib/helpers');
const { getPlatformAdapter } = require('../lib/platform');
const { startStaticServer } = require('../../../../tests/fixtures/static-server');

async function showProofBadge(page, text, background = '#1d4ed8') {
  await page.evaluate(({ text: badgeText, background: badgeBackground }) => {
    document.querySelectorAll('[data-auto-pip-proof]').forEach((node) => node.remove());
    const badge = document.createElement('div');
    badge.setAttribute('data-auto-pip-proof', 'true');
    badge.style.cssText = [
      'position: fixed',
      'inset: auto 32px 32px 32px',
      'padding: 22px 26px',
      'border-radius: 12px',
      `background: ${badgeBackground}`,
      'color: #fff',
      'font: 700 28px/1.35 system-ui, -apple-system, Segoe UI, sans-serif',
      'box-shadow: 0 16px 48px rgba(0,0,0,.28)',
      'z-index: 2147483647'
    ].join(';');
    badge.textContent = badgeText;
    document.body.appendChild(badge);
  }, { text, background }).catch(() => {});
}

async function run(artifacts, options) {
  const reset = await resetStageEnvironment({ killBrowser: true, sleepMs: 1500 });
  const fixture = await startStaticServer();
  const adapter = getPlatformAdapter();
  const session = await new ChromeSession(artifacts, { browser: options.browser }).start();

  try {
    const videoPage = await session.openTab(`${fixture.baseURL}/sample-video.html`, true);
    await videoPage.waitForLoadState('domcontentloaded');
    await session.ensureVideoPlaying(videoPage);

    const tabId = await session.worker.evaluate((targetUrl) => new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const match = (Array.isArray(tabs) ? tabs : []).find((tab) => tab.url === targetUrl);
        resolve(match ? match.id : null);
      });
    }), videoPage.url());

    const primeResult = await session.worker.evaluate((targetTabId) => new Promise((resolve) => {
      autoPipOnTabSwitch = true;
      chrome.storage.sync.set({ autoPipOnTabSwitch: true }, () => {
        chrome.storage.local.set({ autoPipOnTabSwitch: true }, () => {
          injectCheckVideoScript(targetTabId, (checkResults) => {
            const hasVideo = hasAnyFrameTrue(checkResults);
            if (hasVideo) setTargetTab(targetTabId);
            injectTriggerAutoPiP(targetTabId, (triggerResults) => {
              resolve({ ok: hasVideo, tabId: targetTabId, targetTab, checkResults, triggerResults });
            });
          });
        });
      });
    }), tabId);

    await expectPoll(
      async () => videoPage.evaluate(() => {
        const video = document.querySelector('video');
        return {
          title: document.title,
          hasVideo: !!video,
          playing: !!video && !video.paused && !video.ended && video.readyState >= 2,
          autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
          playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null
        };
      }),
      (state) => !!(state && state.hasVideo && state.playing && state.autoPipAttr),
      scaleTimeout(15000, options.timeoutScale)
    );

    await showProofBadge(videoPage, 'Step 1: video is playing and Auto PiP is armed on this tab.', '#1d4ed8');
    await sleep(8000);
    await videoPage.screenshot({ path: path.join(artifacts.rootDir, '01-video-tab.png') }).catch(() => {});
    if (adapter.screenshot) {
      await adapter.screenshot(path.join(artifacts.rootDir, '01-desktop-video-tab.png')).catch(() => null);
    }

    const blankPage = await session.openTab(`${fixture.baseURL}/blank.html`, true);
    await blankPage.waitForLoadState('domcontentloaded').catch(() => {});
    await blankPage.bringToFront().catch(() => {});
    await showProofBadge(blankPage, 'Step 2: switched to a new blank tab. Auto PiP should appear now.', '#9a3412');
    await sleep(5000);

    const pipState = await expectPoll(
      async () => videoPage.evaluate(() => {
        const video = document.querySelector('video');
        return {
          inPictureInPicture: !!video && document.pictureInPictureElement === video,
          videoCurrentTime: video ? video.currentTime : null,
          videoPaused: video ? video.paused : null
        };
      }),
      (state) => !!(state && state.inPictureInPicture === true),
      scaleTimeout(15000, options.timeoutScale)
    );

    await showProofBadge(
      blankPage,
      `Step 3: Auto PiP verified. PiP=${pipState.inPictureInPicture}; video still playing=${!pipState.videoPaused}.`,
      '#0b7a3b'
    );

    await sleep(20000);
    await blankPage.screenshot({ path: path.join(artifacts.rootDir, '02-blank-tab-with-pip.png') }).catch(() => {});
    if (adapter.screenshot) {
      await adapter.screenshot(path.join(artifacts.rootDir, '02-desktop-blank-tab-with-pip.png')).catch(() => null);
    }

    return {
      ok: !!(primeResult && primeResult.ok && pipState && pipState.inPictureInPicture),
      command: 'tab-switch-visual-proof',
      summary: 'Tab-switch Auto PiP visual proof completed',
      details: {
        reset,
        extensionId: session.extensionId,
        videoUrl: videoPage.url(),
        blankUrl: blankPage.url(),
        primeResult,
        pipState
      }
    };
  } finally {
    await session.close();
    fixture.server.close();
  }
}

module.exports = { run };
