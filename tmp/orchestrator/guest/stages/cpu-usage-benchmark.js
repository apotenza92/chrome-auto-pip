'use strict';

const { ChromeSession } = require('../chrome-session');
const { resetStageEnvironment } = require('../lib/stage-reset');
const { sleep, expectPoll, scaleTimeout } = require('../lib/helpers');
const { startStaticServer } = require('../../../../tests/fixtures/static-server');

function metricMap(metrics) {
  const mapped = {};
  (metrics || []).forEach((metric) => {
    mapped[metric.name] = metric.value;
  });
  return mapped;
}

async function createPerformanceSampler(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  return {
    async read() {
      const result = await client.send('Performance.getMetrics');
      return metricMap(result.metrics);
    },
    async close() {
      await client.detach().catch(() => {});
    }
  };
}

async function readPerformanceMetrics(sampler) {
  const result = await sampler.read();
  return result;
}

function diffMetrics(before, after, elapsedSeconds) {
  const keys = [
    'TaskDuration',
    'ScriptDuration',
    'LayoutDuration',
    'RecalcStyleDuration',
    'JSHeapUsedSize',
    'Nodes',
    'LayoutCount',
    'RecalcStyleCount'
  ];
  const diff = {};
  keys.forEach((key) => {
    const start = Number(before[key]);
    const end = Number(after[key]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    diff[key] = end - start;
  });
  if (Number.isFinite(diff.TaskDuration) && elapsedSeconds > 0) {
    diff.mainThreadBusyPercent = (diff.TaskDuration / elapsedSeconds) * 100;
  }
  if (Number.isFinite(diff.ScriptDuration) && elapsedSeconds > 0) {
    diff.scriptBusyPercent = (diff.ScriptDuration / elapsedSeconds) * 100;
  }
  return diff;
}

async function runScenario(artifacts, options, fixture, scenario) {
  const session = await new ChromeSession(artifacts, {
    browser: options.browser,
    withExtension: scenario.withExtension
  }).start();

  try {
    const page = await session.openTab(`${fixture.baseURL}/high-churn-video.html`, true);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__churn_tick__ >= 10, null, {
      timeout: scaleTimeout(10000, options.timeoutScale)
    });
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return false;
      video.muted = true;
      return video.play().then(() => true).catch(() => false);
    });

    let tabId = null;
    let primeResult = null;
    let primedFlags = null;
    let pageFlags = null;

    if (scenario.withExtension) {
      tabId = await session.worker.evaluate((targetUrl) => new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => {
          const match = (Array.isArray(tabs) ? tabs : []).find((tab) => tab.url === targetUrl);
          resolve(match ? match.id : null);
        });
      }), page.url());

      primeResult = await session.worker.evaluate((targetTabId) => new Promise((resolve) => {
        autoPipOnTabSwitch = true;
        chrome.storage.local.set({ autoPipOnTabSwitch: true }, () => {
          injectCheckVideoScript(targetTabId, (checkResults) => {
            const hasVideo = hasAnyFrameTrue(checkResults);
            if (hasVideo) setTargetTab(targetTabId);
            injectTriggerAutoPiP(targetTabId, (triggerResults) => {
              resolve({
                ok: hasVideo,
                tabId: targetTabId,
                targetTab,
                checkResults,
                triggerResults
              });
            });
          });
        });
      }), tabId);

      if (tabId != null) {
        primedFlags = await expectPoll(
          async () => session.getTabFlags(tabId),
          (value) => !!(value && value.registered === true),
          scaleTimeout(10000, options.timeoutScale)
        );
      }
      pageFlags = await page.evaluate(() => ({
        isolatedRegistered: window.__auto_pip_registered__ === true,
        mainWorldRegistered: !!(window.__auto_pip_page_state__ && window.__auto_pip_page_state__.registered),
        autoPipVideos: document.querySelectorAll('video[autopictureinpicture]').length,
        managedVideos: document.querySelectorAll('video[data-auto-pip-managed]').length
      }));
    }

    const sampler = await createPerformanceSampler(page);

    await sleep(1000);
    const foregroundBefore = await readPerformanceMetrics(sampler);
    const foregroundStartedAt = Date.now();
    await sleep(scenario.durationMs);
    const foregroundElapsedSeconds = (Date.now() - foregroundStartedAt) / 1000;
    const foregroundAfter = await readPerformanceMetrics(sampler);

    const blankPage = await session.openTab('about:blank', true);
    await sleep(1000);
    const backgroundBefore = await readPerformanceMetrics(sampler);
    const backgroundStartedAt = Date.now();
    await sleep(scenario.durationMs);
    const backgroundElapsedSeconds = (Date.now() - backgroundStartedAt) / 1000;
    const backgroundAfter = await readPerformanceMetrics(sampler);

    const finalState = await page.evaluate(() => {
      const video = document.querySelector('video');
      return {
        churnTick: window.__churn_tick__ || 0,
        visibilityState: document.visibilityState,
        pictureInPicture: !!document.pictureInPictureElement,
        videoPaused: video ? video.paused : null,
        videoCurrentTime: video ? video.currentTime : null,
        autoPipVideos: document.querySelectorAll('video[autopictureinpicture]').length,
        managedVideos: document.querySelectorAll('video[data-auto-pip-managed]').length
      };
    });

    await blankPage.close().catch(() => {});
    await sampler.close();

    return {
      name: scenario.name,
      withExtension: scenario.withExtension,
      extensionId: session.extensionId,
      primeResult,
      primedFlags,
      pageFlags,
      foreground: diffMetrics(foregroundBefore, foregroundAfter, foregroundElapsedSeconds),
      background: diffMetrics(backgroundBefore, backgroundAfter, backgroundElapsedSeconds),
      finalState
    };
  } finally {
    await session.close();
  }
}

async function run(artifacts, options) {
  const reset = await resetStageEnvironment({ killBrowser: true, sleepMs: 1500 });
  const fixture = await startStaticServer();
  const durationMs = 8000;

  try {
    const scenarios = [
      { name: 'no-extension', withExtension: false, durationMs },
      { name: 'extension-enabled', withExtension: true, durationMs }
    ];

    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(artifacts, options, fixture, scenario));
      await resetStageEnvironment({ killBrowser: true, sleepMs: 1000 });
    }

    const [withoutExtension, withExtension] = results;
    const ratio = (phase, key) => {
      const base = withoutExtension && withoutExtension[phase] ? withoutExtension[phase][key] : null;
      const next = withExtension && withExtension[phase] ? withExtension[phase][key] : null;
      if (!Number.isFinite(base) || !Number.isFinite(next) || base <= 0) return null;
      return next / base;
    };

    const summary = {
      foregroundTaskDurationRatio: ratio('foreground', 'TaskDuration'),
      foregroundScriptDurationRatio: ratio('foreground', 'ScriptDuration'),
      backgroundTaskDurationRatio: ratio('background', 'TaskDuration'),
      backgroundScriptDurationRatio: ratio('background', 'ScriptDuration')
    };

    const payload = {
      ok: true,
      command: 'cpu-usage-benchmark',
      summary: `CPU benchmark complete; background task ratio ${summary.backgroundTaskDurationRatio == null ? 'n/a' : summary.backgroundTaskDurationRatio.toFixed(2)}x`,
      details: {
        reset,
        durationMs,
        fixture: fixture.baseURL,
        results,
        summary
      }
    };
    artifacts.writeJson('cpu-usage-benchmark.json', payload);
    return payload;
  } finally {
    fixture.server.close();
    await resetStageEnvironment({ killBrowser: true, sleepMs: 500 }).catch(() => {});
  }
}

module.exports = { run };
