const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

test('tab switch setting updates background state', async ({ context, page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  const worker = context.__autoPipExtensionWorker || context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

  const setToggle = async (value) => {
    await page.waitForFunction(() => {
      const el = document.getElementById('autoPipOnTabSwitch');
      return el && !el.disabled;
    });
    await page.evaluate((val) => {
      const el = document.getElementById('autoPipOnTabSwitch');
      if (!el) return;
      el.checked = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };

  await expect.poll(async () => worker.evaluate(() => typeof autoPipOnTabSwitch !== 'undefined')).toBe(true);

  await setToggle(false);
  await expect.poll(async () => worker.evaluate(async () => {
    const result = await chrome.storage.sync.get(['autoPipOnTabSwitch']);
    return result.autoPipOnTabSwitch;
  })).toBe(false);
  await expect.poll(async () => worker.evaluate(async () => {
    await loadSettings();
    return autoPipOnTabSwitch;
  })).toBe(false);

  await setToggle(true);
  await expect.poll(async () => worker.evaluate(async () => {
    const result = await chrome.storage.sync.get(['autoPipOnTabSwitch']);
    return result.autoPipOnTabSwitch;
  })).toBe(true);
  await expect.poll(async () => worker.evaluate(async () => {
    await loadSettings();
    return autoPipOnTabSwitch;
  })).toBe(true);
});

test('tab switch does not enter PiP for paused video', async ({ context }) => {
  test.setTimeout(120000);

  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/sample-video.html`;
  const blankUrl = `${baseURL}/blank.html`;

  const getFlags = async (page) => {
    return page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) {
        return {
          hasVideo: false,
          playing: false,
          paused: false,
          autoPipAttr: false,
          playbackState: null,
          inPictureInPicture: false,
          currentTime: 0
        };
      }

      return {
        hasVideo: true,
        playing: !video.paused && !video.ended && video.readyState >= 2,
        paused: video.paused,
        autoPipAttr: video.hasAttribute('autopictureinpicture'),
        playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null,
        inPictureInPicture: document.pictureInPictureElement === video,
        currentTime: video.currentTime
      };
    });
  };

  let videoPage = null;
  let blankPage = null;
  try {
    videoPage = await context.newPage();
    await videoPage.goto(videoUrl);

    await expect.poll(async () => getFlags(videoPage), { timeout: 15000 }).toMatchObject({
      hasVideo: true,
      playing: true,
      autoPipAttr: true,
      playbackState: 'playing'
    });

    await videoPage.evaluate(async () => {
      const video = document.querySelector('video');
      video.pause();
      await new Promise(resolve => setTimeout(resolve, 250));
    });

    await expect.poll(async () => getFlags(videoPage), { timeout: 5000 }).toMatchObject({
      hasVideo: true,
      playing: false,
      paused: true,
      autoPipAttr: false,
      playbackState: 'paused',
      inPictureInPicture: false
    });

    blankPage = await context.newPage();
    await blankPage.goto(blankUrl);
    await blankPage.bringToFront();
    await blankPage.waitForTimeout(3000);

    expect((await getFlags(videoPage)).inPictureInPicture).toBe(false);
  } finally {
    if (blankPage) await blankPage.close().catch(() => {});
    if (videoPage) await videoPage.close().catch(() => {});
    server.close();
  }
});
