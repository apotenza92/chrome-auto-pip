const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

test('toolbar manual PiP works for paused video and toggles off', async ({ context }) => {
  test.setTimeout(60000);

  const worker = context.__autoPipExtensionWorker || context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/sample-video.html`;

  const clickToolbarForTab = async (tabId) => {
    return worker.evaluate(async (id) => {
      const tab = await new Promise(resolve => chrome.tabs.get(id, resolve));
      globalThis.AutoPip.tabSwitch.handleToolbarClick(tab);
      return true;
    }, tabId);
  };

  const getFlags = async (page) => {
    return page.evaluate(() => {
      const video = document.querySelector('video');
      return {
        hasVideo: !!video,
        playing: !!video && !video.paused && !video.ended && video.readyState >= 2,
        paused: !!video && video.paused === true,
        inPictureInPicture: !!video && document.pictureInPictureElement === video,
        owned: !!video && video.hasAttribute('data-auto-pip-managed')
      };
    });
  };

  let page = null;
  try {
    page = await context.newPage();
    await page.goto(videoUrl);
    const tabId = await worker.evaluate(async (urlPart) => {
      const tabs = await new Promise(resolve => chrome.tabs.query({}, resolve));
      const tab = tabs.find(candidate => candidate.url && candidate.url.includes(urlPart));
      return tab ? tab.id : null;
    }, '/sample-video.html');

    await expect.poll(async () => getFlags(page), { timeout: 15000 }).toMatchObject({
      hasVideo: true,
      playing: true
    });

    await page.evaluate(async () => {
      const video = document.querySelector('video');
      video.pause();
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    await expect.poll(async () => getFlags(page), { timeout: 5000 }).toMatchObject({
      paused: true,
      inPictureInPicture: false
    });

    await clickToolbarForTab(tabId);
    await expect.poll(async () => getFlags(page), { timeout: 10000 }).toMatchObject({
      inPictureInPicture: true,
      owned: true
    });

    await clickToolbarForTab(tabId);
    await expect.poll(async () => getFlags(page), { timeout: 10000 }).toMatchObject({
      inPictureInPicture: false
    });
  } finally {
    if (page) await page.close().catch(() => {});
    server.close();
  }
});
