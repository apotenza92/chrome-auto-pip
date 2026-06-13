const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

async function setToggle(page, id, value) {
  await page.waitForFunction((targetId) => {
    const el = document.getElementById(targetId);
    return el && !el.disabled;
  }, id);
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}

async function videoFlags(page) {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) {
      return {
        hasVideo: false,
        playing: false,
        paused: false,
        muted: false,
        autoPipAttr: false,
        inPictureInPicture: false,
        compatRequested: false,
        owned: false,
        playbackState: null
      };
    }

    return {
      hasVideo: true,
      playing: !video.paused && !video.ended && video.readyState >= 2,
      paused: video.paused,
      muted: video.muted,
      autoPipAttr: video.hasAttribute('autopictureinpicture'),
      inPictureInPicture: document.pictureInPictureElement === video,
      compatRequested: video.hasAttribute('data-auto-pip-compat-requested'),
      owned: video.hasAttribute('data-auto-pip-managed'),
      playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null
    };
  });
}

test('tab switch setting, paused skip, and repeated muted compatibility PiP', async ({ context, page, extensionId }) => {
  test.setTimeout(120000);

  const worker = context.__autoPipExtensionWorker || context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const { server, baseURL } = await startStaticServer();
  const openedPages = [];

  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect.poll(async () => worker.evaluate(() => typeof autoPipOnTabSwitch !== 'undefined')).toBe(true);

    await setToggle(page, 'autoPipOnTabSwitch', false);
    await expect.poll(async () => worker.evaluate(async () => {
      const result = await chrome.storage.sync.get(['autoPipOnTabSwitch']);
      return result.autoPipOnTabSwitch;
    })).toBe(false);
    await expect.poll(async () => worker.evaluate(async () => {
      await loadSettings();
      return autoPipOnTabSwitch;
    })).toBe(false);

    await setToggle(page, 'autoPipOnTabSwitch', true);
    await expect.poll(async () => worker.evaluate(async () => {
      await loadSettings();
      return autoPipOnTabSwitch;
    })).toBe(true);

    const pausedPage = await context.newPage();
    openedPages.push(pausedPage);
    await pausedPage.goto(`${baseURL}/sample-video.html`);

    await expect.poll(async () => videoFlags(pausedPage), { timeout: 15000 }).toMatchObject({
      hasVideo: true,
      playing: true,
      muted: true,
      autoPipAttr: true,
      playbackState: 'playing'
    });

    await pausedPage.evaluate(async () => {
      const video = document.querySelector('video');
      video.pause();
      await new Promise(resolve => setTimeout(resolve, 250));
    });

    await expect.poll(async () => videoFlags(pausedPage), { timeout: 5000 }).toMatchObject({
      hasVideo: true,
      playing: false,
      paused: true,
      autoPipAttr: false,
      playbackState: 'paused',
      inPictureInPicture: false
    });

    const blankPage = await context.newPage();
    openedPages.push(blankPage);
    await blankPage.goto(`${baseURL}/blank.html`);
    await blankPage.bringToFront();
    await blankPage.waitForTimeout(1000);
    expect((await videoFlags(pausedPage)).inPictureInPicture).toBe(false);
    await pausedPage.close();

    const videoPage = await context.newPage();
    openedPages.push(videoPage);
    await videoPage.goto(`${baseURL}/sample-video.html`);
    await expect.poll(async () => videoFlags(videoPage), { timeout: 15000 }).toMatchObject({
      hasVideo: true,
      playing: true,
      muted: true,
      autoPipAttr: true
    });

    await blankPage.bringToFront();
    await expect.poll(async () => videoFlags(videoPage), { timeout: 10000 }).toMatchObject({
      inPictureInPicture: true,
      compatRequested: true,
      owned: true
    });

    await videoPage.bringToFront();
    await expect.poll(async () => videoFlags(videoPage), { timeout: 10000 }).toMatchObject({
      inPictureInPicture: false,
      playing: true
    });

    await blankPage.bringToFront();
    await expect.poll(async () => videoFlags(videoPage), { timeout: 10000 }).toMatchObject({
      inPictureInPicture: true,
      playing: true,
      muted: true
    });
  } finally {
    await Promise.all(openedPages.map(openPage => openPage.isClosed() ? null : openPage.close().catch(() => {})));
    server.close();
  }
});
