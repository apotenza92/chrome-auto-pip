'use strict';

const path = require('path');
const { ChromeSession } = require('../chrome-session');
const { sleep, expectPoll, scaleTimeout } = require('../lib/helpers');
const { getPlatformAdapter } = require('../lib/platform');
const { resetStageEnvironment } = require('../lib/stage-reset');
const {
  installPiPEventObserverScript,
  resetPiPEventObserverScript
} = require('../lib/pip-verifier');

const YOUTUBE_URLS = [
  'https://www.youtube.com/watch?v=aqz-KE-bpKQ&autoplay=1&mute=1',
  'https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1&mute=1'
];
const NEWS_URLS = [
  'https://apnews.com/',
  'https://www.bbc.com/news'
];
const THIRD_URL = 'https://www.wikipedia.org/';

function videoStateScript() {
  return () => {
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find((candidate) => candidate.readyState >= 1) || videos[0] || null;
    const pipEvents = window.__autoPipVerifierEvents || null;
    return {
      url: location.href,
      title: document.title,
      videoCount: videos.length,
      videoExists: !!video,
      videoPlaying: !!video && !video.paused && !video.ended && video.currentTime > 0,
      currentTime: video ? video.currentTime : null,
      paused: video ? video.paused : null,
      ended: video ? video.ended : null,
      readyState: video ? video.readyState : null,
      muted: video ? video.muted : null,
      hidden: document.visibilityState,
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
      pip: !!document.pictureInPictureElement,
      autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
      registered: window.__auto_pip_registered__ === true,
      pipEventCount: pipEvents ? pipEvents.enterCount || 0 : 0,
      leavePipEventCount: pipEvents ? pipEvents.leaveCount || 0 : 0,
      pipEvents
    };
  };
}

async function dismissCommonYouTubeOverlays(page) {
  const labels = [
    /accept all/i,
    /i agree/i,
    /no thanks/i,
    /skip ad/i,
    /got it/i
  ];

  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await button.click({ timeout: 2000 }).catch(() => {});
      await sleep(500);
    }
  }
}

async function openFirstWorkingPage(session, urls, focused = true) {
  let lastError = null;
  for (const url of urls) {
    const page = await session.context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (focused) {
        await page.bringToFront().catch(() => {});
      }
      return { page, url };
    } catch (error) {
      lastError = error;
      await page.close({ runBeforeUnload: false }).catch(() => {});
    }
  }
  throw lastError || new Error(`Unable to open any URL from ${urls.join(', ')}`);
}

async function findTabIdByUrlPart(session, urlPart) {
  session.requireExtension();
  return session.worker.evaluate((part) => new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      const tab = (Array.isArray(tabs) ? tabs : []).find((candidate) =>
        candidate && typeof candidate.url === 'string' && candidate.url.includes(part)
      );
      resolve(tab ? tab.id : null);
    });
  }), urlPart);
}

async function activatePage(session, page, tabId, label) {
  if (tabId != null) {
    await session.activateTab(tabId).catch(() => {});
  }
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await sleep(500);
  return {
    label,
    url: page.url(),
    title: await page.title().catch(() => null)
  };
}

async function ensureYouTubePlaying(page, timeoutMs) {
  await page.waitForSelector('video', { timeout: timeoutMs });
  await dismissCommonYouTubeOverlays(page);
  await page.evaluate(installPiPEventObserverScript()).catch(() => {});
  await page.evaluate(async () => {
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find((candidate) => candidate.readyState >= 1) || videos[0];
    if (!video) return false;
    video.muted = true;
    try { video.volume = 0; } catch (_) {}
    try { video.setAttribute('autopictureinpicture', ''); } catch (_) {}
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      await playPromise.catch(() => {});
    }
    return true;
  });
  await page.click('body', { timeout: 5000 }).catch(() => {});
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return false;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      await playPromise.catch(() => {});
    }
    return true;
  }).catch(() => false);

  return expectPoll(
    () => page.evaluate(videoStateScript()),
    (state) => !!(state && state.videoExists && state.videoPlaying),
    timeoutMs,
    500
  );
}

async function waitForYouTubeRegistered(session, youtubePage, youtubeTabId, timeoutMs) {
  return expectPoll(
    async () => {
      const state = await youtubePage.evaluate(videoStateScript()).catch((error) => ({ error: error.message }));
      const bg = await session.getBackgroundState().catch((error) => ({ error: error.message }));
      return { state, bg, youtubeTabId };
    },
    (value) => !!(
      value &&
      value.state &&
      value.state.videoPlaying &&
      (value.state.registered || value.state.autoPipAttr) &&
      value.bg &&
      (value.bg.targetTab === youtubeTabId || value.bg.currentTab === youtubeTabId)
    ),
    timeoutMs,
    500
  );
}

async function waitForPiP(page, timeoutMs) {
  return expectPoll(
    () => page.evaluate(videoStateScript()).catch((error) => ({ error: error.message })),
    (state) => !!(state && (state.pip === true || state.pipEventCount > 0)),
    timeoutMs,
    500
  );
}

async function captureStep(artifacts, adapter, page, label, extra = {}) {
  const state = await page.evaluate(videoStateScript()).catch((error) => ({ error: error.message }));
  const step = {
    at: new Date().toISOString(),
    label,
    state,
    ...extra
  };
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  await page.screenshot({ path: path.join(artifacts.rootDir, `${safeLabel}-youtube-page.png`) }).catch(() => {});
  if (adapter && adapter.screenshot) {
    await adapter.screenshot(path.join(artifacts.rootDir, `${safeLabel}-desktop.png`)).catch(() => null);
  }
  return step;
}

async function run(artifacts, options = {}) {
  const reset = await resetStageEnvironment({ killBrowser: true, sleepMs: 1500 });
  const adapter = getPlatformAdapter();
  const scale = options.timeoutScale || 1;
  const session = await new ChromeSession(artifacts, {
    ...options,
    autoPiPOrigins: ['https://www.youtube.com']
  }).start();

  const timeline = [];
  try {
    await session.allowAutoPiPForOrigin('https://www.youtube.com').catch(() => null);
    await session.setModes({ tab: true, window: false, app: false });

    const youtube = await openFirstWorkingPage(session, YOUTUBE_URLS, true);
    const youtubePage = youtube.page;
    await dismissCommonYouTubeOverlays(youtubePage);
    const beforePlay = await ensureYouTubePlaying(youtubePage, scaleTimeout(30000, scale));
    const youtubeTabId = await findTabIdByUrlPart(session, 'youtube.com');
    await waitForYouTubeRegistered(session, youtubePage, youtubeTabId, scaleTimeout(15000, scale));
    await youtubePage.evaluate(resetPiPEventObserverScript()).catch(() => {});
    timeline.push(await captureStep(artifacts, adapter, youtubePage, '01-youtube-playing', {
      activePage: 'youtube',
      youtubeUrl: youtube.url,
      youtubeTabId,
      beforePlay
    }));

    const news = await openFirstWorkingPage(session, NEWS_URLS, true);
    const newsPage = news.page;
    const newsTabId = await findTabIdByUrlPart(session, new URL(news.url).hostname);
    await activatePage(session, newsPage, newsTabId, 'news');
    const pipAfterNews = await waitForPiP(youtubePage, scaleTimeout(15000, scale));
    timeline.push(await captureStep(artifacts, adapter, youtubePage, '02-youtube-hidden-news-active', {
      activePage: 'news',
      newsUrl: news.url,
      newsTabId,
      pipCheck: pipAfterNews
    }));

    await activatePage(session, youtubePage, youtubeTabId, 'youtube');
    const youtubeReturn1 = await ensureYouTubePlaying(youtubePage, scaleTimeout(15000, scale));
    await youtubePage.evaluate(resetPiPEventObserverScript()).catch(() => {});
    timeline.push(await captureStep(artifacts, adapter, youtubePage, '03-youtube-returned-from-news', {
      activePage: 'youtube',
      playbackCheck: youtubeReturn1
    }));

    const thirdPage = await session.openTab(THIRD_URL, true);
    await thirdPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    const thirdTabId = await findTabIdByUrlPart(session, 'wikipedia.org');
    await activatePage(session, thirdPage, thirdTabId, 'third');
    const pipAfterThird = await waitForPiP(youtubePage, scaleTimeout(15000, scale));
    timeline.push(await captureStep(artifacts, adapter, youtubePage, '04-youtube-hidden-third-active', {
      activePage: 'third',
      thirdUrl: THIRD_URL,
      thirdTabId,
      pipCheck: pipAfterThird
    }));

    await activatePage(session, newsPage, newsTabId, 'news');
    const pipStillOnNews = await waitForPiP(youtubePage, scaleTimeout(8000, scale));
    timeline.push(await captureStep(artifacts, adapter, youtubePage, '05-youtube-hidden-news-revisited', {
      activePage: 'news',
      pipCheck: pipStillOnNews
    }));

    await activatePage(session, youtubePage, youtubeTabId, 'youtube-final');
    const finalPlayback = await ensureYouTubePlaying(youtubePage, scaleTimeout(15000, scale));
    timeline.push(await captureStep(artifacts, adapter, youtubePage, '06-youtube-final-return', {
      activePage: 'youtube',
      playbackCheck: finalPlayback
    }));

    artifacts.writeJson('real-browser-use-timeline.json', timeline);
    const pipChecks = timeline
      .filter((step) => step && step.pipCheck)
      .map((step) => ({
        label: step.label,
        pip: !!(step.pipCheck && (step.pipCheck.pip || step.pipCheck.pipEventCount > 0)),
        pipEventCount: step.pipCheck ? step.pipCheck.pipEventCount : null,
        hidden: step.pipCheck ? step.pipCheck.hidden : null
      }));

    const ok = pipChecks.length === 3 && pipChecks.every((check) => check.pip === true);
    return {
      ok,
      command: 'real-browser-use-youtube',
      summary: ok
        ? 'Real browsing YouTube/news/third-tab sequence kept Auto PiP working in the VM'
        : 'Real browsing YouTube/news/third-tab sequence did not consistently show Auto PiP',
      details: {
        reset,
        platform: adapter.key,
        extensionId: session.extensionId,
        youtubeUrl: youtube.url,
        newsUrl: news.url,
        thirdUrl: THIRD_URL,
        youtubeTabId,
        newsTabId,
        thirdTabId,
        pipChecks,
        timelineLength: timeline.length
      }
    };
  } finally {
    artifacts.writeJson('real-browser-use-timeline.json', timeline);
    await session.close();
  }
}

module.exports = { run };
