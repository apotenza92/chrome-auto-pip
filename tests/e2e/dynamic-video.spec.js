const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

test('dynamic and shadow videos arm and enter PiP', async ({ context }) => {
  test.setTimeout(120000);

  const worker = context.__autoPipExtensionWorker || context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const { server, baseURL } = await startStaticServer();
  const openedPages = [];

  const delayedFlags = async (page) => page.evaluate(() => {
    const video = document.querySelector('video');
    return {
      hasVideo: !!video,
      playing: !!video && !video.paused && !video.ended && video.readyState >= 2,
      autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
      playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null,
      inPictureInPicture: document.pictureInPictureElement === video
    };
  });

  const shadowFlags = async (page) => page.evaluate(() => {
    const host = document.getElementById('host');
    const video = host && host.shadowRoot ? host.shadowRoot.querySelector('video') : null;
    return {
      hasVideo: !!video,
      started: window.__shadow_late_ready_started__ === true,
      churnTick: window.__shadow_late_ready_tick__ || 0,
      playing: !!video && !video.paused && !video.ended && video.readyState >= 2,
      autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
      playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null
    };
  });

  try {
    const delayedPage = await context.newPage();
    openedPages.push(delayedPage);
    await delayedPage.goto(`${baseURL}/delayed-video.html`);

    await expect.poll(async () => delayedFlags(delayedPage), { timeout: 15000 }).toMatchObject({
      hasVideo: true,
      playing: true,
      autoPipAttr: true,
      playbackState: 'playing'
    });

    const blankPage = await context.newPage();
    openedPages.push(blankPage);
    await blankPage.goto(`${baseURL}/blank.html`);
    await blankPage.bringToFront();

    await expect.poll(async () => delayedFlags(delayedPage), { timeout: 10000 }).toMatchObject({
      inPictureInPicture: true
    });

    await delayedPage.close();

    const shadowPage = await context.newPage();
    openedPages.push(shadowPage);
    await shadowPage.goto(`${baseURL}/shadow-late-ready-video.html`);

    await expect.poll(async () => shadowFlags(shadowPage), { timeout: 15000 }).toMatchObject({
      hasVideo: true,
      started: true,
      playing: true,
      autoPipAttr: true,
      playbackState: 'playing'
    });
    expect((await shadowFlags(shadowPage)).churnTick).toBeGreaterThan(0);

    const background = await worker.evaluate(() => ({
      currentTab: AutoPip.state.currentTab,
      targetTab: AutoPip.state.targetTab
    }));
    expect(background.targetTab).not.toBeNull();
  } finally {
    await Promise.all(openedPages.map(page => page.isClosed() ? null : page.close().catch(() => {})));
    server.close();
  }
});
