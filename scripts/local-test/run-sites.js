'use strict';

const path = require('path');
const {
  createArtifactDir,
  getBackgroundState,
  launchLocalContext,
  writeJson,
  writeText
} = require('./local-session');

const REAL_SITE_ORIGINS = [
  'https://www.youtube.com',
  'https://music.youtube.com',
  'https://shaka-player-demo.appspot.com',
  'https://www.twitch.tv',
  'https://meet.google.com',
  'https://zoom.us'
];

const CHECKS = [
  { name: 'youtube-muted', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&autoplay=1&mute=1', kind: 'video', muted: true },
  { name: 'youtube-unmuted', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&autoplay=1', kind: 'video', muted: false },
  { name: 'youtube-music', url: 'https://music.youtube.com/', kind: 'arm-only' },
  { name: 'shaka-demo', url: 'https://shaka-player-demo.appspot.com/demo/', kind: 'arm-only' },
  { name: 'twitch-gesture', url: 'https://www.twitch.tv/twitch', kind: 'gesture-video' },
  { name: 'meet-disabled', url: 'https://meet.google.com/', kind: 'disabled', hostPattern: 'meet.google.com' },
  { name: 'zoom-disabled', url: 'https://zoom.us/', kind: 'disabled', hostPattern: '*.zoom.us' }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function poll(getValue, predicate, timeoutMs = 15000, intervalMs = 500) {
  const startedAt = Date.now();
  let latest = null;
  while ((Date.now() - startedAt) < timeoutMs) {
    latest = await getValue();
    if (predicate(latest)) return latest;
    await sleep(intervalMs);
  }
  return latest;
}

function skipped(reason, details = {}) {
  return { status: 'skipped', reason, ...details };
}

function passed(details = {}) {
  return { status: 'passed', ...details };
}

function failed(reason, details = {}) {
  return { status: 'failed', reason, ...details };
}

function videoStateScript() {
  return () => {
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(candidate => candidate.readyState >= 1) || videos[0] || null;
    return {
      url: location.href,
      title: document.title,
      videoCount: videos.length,
      videoExists: !!video,
      playing: !!video && !video.paused && !video.ended && video.readyState >= 2,
      paused: video ? video.paused : null,
      ended: video ? video.ended : null,
      readyState: video ? video.readyState : null,
      currentTime: video ? video.currentTime : null,
      muted: video ? video.muted : null,
      visibilityState: document.visibilityState,
      pip: !!document.pictureInPictureElement,
      autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
      owned: !!video && video.hasAttribute('data-auto-pip-managed'),
      registered: window.__auto_pip_registered__ === true,
      disabled: window.__auto_pip_disabled__ === true,
      blocked: window.__auto_pip_blocked__ === true
    };
  };
}

async function dismissCommonOverlays(page) {
  const labels = [/accept all/i, /i agree/i, /no thanks/i, /skip ad/i, /got it/i, /not now/i];
  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await button.click({ timeout: 2000 }).catch(() => {});
      await sleep(500);
    }
  }
}

async function ensurePlayableVideo(page, options = {}) {
  await dismissCommonOverlays(page);
  const before = await poll(
    () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
    state => state && state.videoExists === true,
    options.videoTimeoutMs || 20000,
    500
  );
  if (!before || before.videoExists !== true) {
    return skipped('no_video_found', { state: before });
  }

  await page.evaluate(async (muted) => {
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(candidate => candidate.readyState >= 1) || videos[0];
    if (!video) return false;
    video.muted = muted === true;
    if (muted !== true) {
      try { video.volume = 0.2; } catch (_) {}
    }
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      await playPromise.catch(() => {});
    }
    return true;
  }, options.muted === true).catch(() => false);
  await page.click('body', { timeout: 5000 }).catch(() => {});

  const playing = await poll(
    () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
    state => state && state.playing === true,
    options.playTimeoutMs || 20000,
    500
  );
  if (!playing || playing.playing !== true) {
    return skipped('video_not_playing', { state: playing });
  }
  return passed({ state: playing });
}

async function waitForArmed(page) {
  return poll(
    () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
    state => state && (state.autoPipAttr === true || state.registered === true),
    15000,
    500
  );
}

async function runVideoSwitchCheck(session, check, artifactDir) {
  const page = await session.context.newPage();
  const blank = await session.context.newPage();
  try {
    await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.bringToFront().catch(() => {});
    const playable = await ensurePlayableVideo(page, { muted: check.muted === true });
    if (playable.status !== 'passed') return playable;

    const armed = await waitForArmed(page);
    if (!armed || !(armed.autoPipAttr || armed.registered)) {
      return failed('video_not_armed', { state: armed });
    }

    await blank.goto('data:text/html,<title>Auto%20PiP%20Target</title><h1>Target</h1>', { waitUntil: 'domcontentloaded' });
    await blank.bringToFront().catch(() => {});
    const firstPip = await poll(
      () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
      state => state && state.pip === true,
      15000,
      500
    );
    if (!firstPip || firstPip.pip !== true) {
      await page.screenshot({ path: path.join(artifactDir, `${check.name}-no-pip.png`) }).catch(() => {});
      return failed('pip_not_started_on_tab_switch', { state: firstPip });
    }

    await page.bringToFront().catch(() => {});
    await poll(
      () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
      state => state && state.pip === false,
      10000,
      500
    );
    await blank.bringToFront().catch(() => {});
    const secondPip = await poll(
      () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
      state => state && state.pip === true,
      15000,
      500
    );
    if (!secondPip || secondPip.pip !== true) {
      return failed('pip_not_started_on_repeat_tab_switch', { state: secondPip });
    }

    return passed({ armed, firstPip, secondPip });
  } finally {
    await blank.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

async function runArmOnlyCheck(session, check) {
  const page = await session.context.newPage();
  try {
    await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.bringToFront().catch(() => {});
    const playable = await ensurePlayableVideo(page, { muted: true, videoTimeoutMs: 15000, playTimeoutMs: 15000 });
    if (playable.status !== 'passed') return playable;

    const armed = await waitForArmed(page);
    if (!armed || !(armed.autoPipAttr || armed.registered)) {
      return failed('video_not_armed', { state: armed });
    }
    return passed({ state: armed });
  } finally {
    await page.close().catch(() => {});
  }
}

async function runGestureCheck(session, check, artifactDir) {
  const page = await session.context.newPage();
  const blank = await session.context.newPage();
  try {
    await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.bringToFront().catch(() => {});
    const playable = await ensurePlayableVideo(page, { muted: true, videoTimeoutMs: 15000, playTimeoutMs: 15000 });
    if (playable.status !== 'passed') return playable;

    await page.click('body', { timeout: 5000 }).catch(() => {});
    await blank.goto('data:text/html,<title>Auto%20PiP%20Target</title><h1>Target</h1>', { waitUntil: 'domcontentloaded' });
    await blank.bringToFront().catch(() => {});
    const state = await poll(
      () => page.evaluate(videoStateScript()).catch(error => ({ error: error.message })),
      value => value && (value.pip === true || value.autoPipAttr === true || value.registered === true),
      15000,
      500
    );
    if (!state || !(state.pip || state.autoPipAttr || state.registered)) {
      await page.screenshot({ path: path.join(artifactDir, `${check.name}-gesture.png`) }).catch(() => {});
      return failed('gesture_path_did_not_arm_or_enter_pip', { state });
    }
    return passed({ state, note: state.pip ? 'PiP entered after gesture' : 'Gesture path armed; browser did not enter PiP during smoke window' });
  } finally {
    await blank.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

async function runDisabledSiteCheck(session, check) {
  const page = await session.context.newPage();
  try {
    await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => ({
      url: location.href,
      registered: window.__auto_pip_registered__ === true,
      disabled: window.__auto_pip_disabled__ === true,
      blocked: window.__auto_pip_blocked__ === true,
      ownedCount: document.querySelectorAll('video[data-auto-pip-managed], video[data-auto-pip-added-autopictureinpicture]').length
    })).catch(error => ({ error: error.message }));
    const storage = await session.worker.evaluate(async () => chrome.storage.local.get(['autoPipSiteBlocklist']));
    const blocklist = Array.isArray(storage.autoPipSiteBlocklist) ? storage.autoPipSiteBlocklist : [];
    const configured = blocklist.includes(check.hostPattern);
    if (!configured) {
      return failed('default_disabled_site_missing', { blocklist, state });
    }
    if (state.registered || state.ownedCount > 0) {
      return failed('disabled_site_registered_extension_state', { blocklist, state });
    }
    return passed({ blocklist, state });
  } finally {
    await page.close().catch(() => {});
  }
}

async function runCheck(session, check, artifactDir) {
  if (check.kind === 'video') return runVideoSwitchCheck(session, check, artifactDir);
  if (check.kind === 'arm-only') return runArmOnlyCheck(session, check);
  if (check.kind === 'gesture-video') return runGestureCheck(session, check, artifactDir);
  if (check.kind === 'disabled') return runDisabledSiteCheck(session, check);
  return skipped('unknown_check_kind', { kind: check.kind });
}

async function main() {
  const artifactDir = createArtifactDir('sites');
  const enabled = process.env.AUTO_PIP_REAL_SITES === '1';
  const startedAt = new Date().toISOString();
  const summary = {
    command: 'test:local:sites',
    startedAt,
    artifactDir,
    realSitesEnabled: enabled,
    browser: process.env.AUTO_PIP_LOCAL_BROWSER || 'chromium',
    checks: []
  };

  if (!enabled) {
    summary.checks = CHECKS.map(check => ({ name: check.name, ...skipped('AUTO_PIP_REAL_SITES is not 1') }));
    summary.ok = true;
    writeJson(path.join(artifactDir, 'summary.json'), summary);
    console.log(`Real-site smoke skipped. Set AUTO_PIP_REAL_SITES=1 to run. Artifacts: ${artifactDir}`);
    return;
  }

  const session = await launchLocalContext({
    artifactDir,
    artifactPrefix: 'sites',
    autoPiPOrigins: REAL_SITE_ORIGINS
  });
  if (session.skipped) {
    summary.checks = CHECKS.map(check => ({ name: check.name, ...skipped(session.skipReason) }));
    summary.ok = true;
    writeJson(path.join(artifactDir, 'summary.json'), summary);
    console.log(`${session.skipReason} Artifacts: ${artifactDir}`);
    return;
  }

  try {
    await session.worker.evaluate(async () => chrome.storage.local.set({
      autoPipDebugEnabled: true,
      autoPipDebugLog: [],
      autoPipDebugText: ''
    }));

    for (const check of CHECKS) {
      const started = Date.now();
      try {
        const result = await runCheck(session, check, artifactDir);
        summary.checks.push({ name: check.name, url: check.url, durationMs: Date.now() - started, ...result });
        console.log(`${check.name}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
      } catch (error) {
        const state = await getBackgroundState(session).catch(() => null);
        summary.checks.push({
          name: check.name,
          url: check.url,
          durationMs: Date.now() - started,
          ...failed(error && error.message ? error.message : String(error), { background: state })
        });
        console.log(`${check.name}: failed (${error && error.message ? error.message : error})`);
      }
    }

    const debug = await session.worker.evaluate(async () => chrome.storage.local.get(['autoPipDebugText', 'autoPipDebugLog', 'autoPipLatestBlocker']));
    writeText(path.join(artifactDir, 'debug-log.txt'), debug.autoPipDebugText || JSON.stringify(debug.autoPipDebugLog || [], null, 2));
    writeJson(path.join(artifactDir, 'background-state.json'), await getBackgroundState(session));
  } finally {
    await session.close();
  }

  summary.finishedAt = new Date().toISOString();
  summary.ok = !summary.checks.some(check => check.status === 'failed');
  writeJson(path.join(artifactDir, 'summary.json'), summary);
  console.log(`Artifacts: ${artifactDir}`);
  if (!summary.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
