'use strict';

const path = require('path');
const { performance } = require('perf_hooks');
const { startStaticServer } = require('../../tests/fixtures/static-server');
const {
  createArtifactDir,
  getBackgroundState,
  launchLocalContext,
  writeJson
} = require('./local-session');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMetric(cdp, name) {
  const result = await cdp.send('Performance.getMetrics');
  const metric = (result.metrics || []).find(candidate => candidate.name === name);
  return metric ? Number(metric.value) : 0;
}

async function measureHighChurn({ withExtension, artifactDir, baseURL }) {
  const session = await launchLocalContext({
    artifactDir,
    artifactPrefix: withExtension ? 'cpu-extension' : 'cpu-baseline',
    withExtension,
    autoPiPOrigins: [baseURL]
  });
  if (session.skipped) return { skipped: true, reason: session.skipReason };

  const page = await session.context.newPage();
  const cdp = await session.context.newCDPSession(page);
  const startedAt = performance.now();
  try {
    await cdp.send('Performance.enable');
    await page.goto(`${baseURL}/high-churn-video.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.bringToFront().catch(() => {});
    await page.waitForSelector('video', { timeout: 10000 });
    await page.evaluate(async () => {
      const video = document.querySelector('video');
      if (!video) return;
      video.muted = true;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        await playPromise.catch(() => {});
      }
    });

    await sleep(1500);
    const beforeTask = await getMetric(cdp, 'TaskDuration');
    const beforeJsHeap = await getMetric(cdp, 'JSHeapUsedSize');
    await sleep(8000);
    const afterTask = await getMetric(cdp, 'TaskDuration');
    const afterJsHeap = await getMetric(cdp, 'JSHeapUsedSize');
    const state = await page.evaluate(() => {
      const video = document.querySelector('video');
      return {
        churnTick: window.__churn_tick__ || null,
        videoExists: !!video,
        videoPlaying: !!video && !video.paused && !video.ended,
        autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
        registered: window.__auto_pip_registered__ === true
      };
    }).catch(error => ({ error: error.message }));

    const background = withExtension ? await getBackgroundState(session).catch(() => null) : null;
    return {
      skipped: false,
      withExtension,
      durationMs: Math.round(performance.now() - startedAt),
      taskDurationSeconds: Math.max(0, afterTask - beforeTask),
      jsHeapDeltaBytes: afterJsHeap - beforeJsHeap,
      state,
      background
    };
  } finally {
    await page.close().catch(() => {});
    await session.close();
  }
}

async function main() {
  const artifactDir = createArtifactDir('cpu');
  const { server, baseURL } = await startStaticServer();
  const summary = {
    command: 'test:local:cpu',
    startedAt: new Date().toISOString(),
    artifactDir,
    baseURL,
    threshold: {
      maxRatio: 5,
      minExtraTaskDurationSeconds: 1
    }
  };

  try {
    summary.baseline = await measureHighChurn({ withExtension: false, artifactDir, baseURL });
    summary.extension = await measureHighChurn({ withExtension: true, artifactDir, baseURL });

    if (summary.baseline.skipped || summary.extension.skipped) {
      summary.ok = true;
      summary.status = 'skipped';
      summary.reason = summary.baseline.reason || summary.extension.reason;
    } else {
      const baseline = summary.baseline.taskDurationSeconds;
      const extension = summary.extension.taskDurationSeconds;
      const ratio = baseline > 0 ? extension / baseline : (extension > 0 ? Infinity : 1);
      const extra = extension - baseline;
      summary.ratio = Number.isFinite(ratio) ? ratio : null;
      summary.extraTaskDurationSeconds = extra;
      summary.status = ratio > summary.threshold.maxRatio && extra > summary.threshold.minExtraTaskDurationSeconds
        ? 'failed'
        : ratio > 2 && extra > 0.25
          ? 'warning'
          : 'passed';
      summary.ok = summary.status !== 'failed';
    }
  } finally {
    server.close();
  }

  summary.finishedAt = new Date().toISOString();
  writeJson(path.join(artifactDir, 'summary.json'), summary);
  console.log(`CPU benchmark ${summary.status}. Artifacts: ${artifactDir}`);
  if (!summary.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
