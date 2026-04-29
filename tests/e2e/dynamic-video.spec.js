const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

test('tab switch registration follows dynamically-created player video', async ({ context }) => {
  test.setTimeout(120000);

  const worker = context.__autoPipExtensionWorker || context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/delayed-video.html`;

  const createTab = async () => {
    return worker.evaluate(async (url) => {
      const waitForTabComplete = (tabId) => new Promise(resolve => {
        chrome.tabs.get(tabId, (tab) => {
          if (tab && tab.status === 'complete') return resolve();
          const listener = (updatedId, info) => {
            if (updatedId === tabId && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      });

      const tab = await new Promise(resolve => {
        chrome.tabs.create({ url, active: true }, resolve);
      });

      if (tab && tab.id != null) {
        await waitForTabComplete(tab.id);
      }

      return tab ? tab.id : null;
    }, videoUrl);
  };

  const getFlags = async (tabId) => {
    return worker.evaluate(async (id) => {
      const result = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
          const video = document.querySelector('video');
          return {
            hasVideo: !!video,
            playing: !!video && !video.paused && !video.ended && video.readyState >= 2,
            registered: window.__auto_pip_registered__ === true,
            autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
            playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null
          };
        }
      });
      return result && result[0] ? result[0].result : {
        hasVideo: false,
        playing: false,
        registered: false,
        autoPipAttr: false,
        playbackState: null
      };
    }, tabId);
  };

  let tabId = null;
  try {
    tabId = await createTab();
    await expect.poll(async () => getFlags(tabId), { timeout: 15000 }).toMatchObject({
      hasVideo: true,
      playing: true,
      registered: true,
      autoPipAttr: true,
      playbackState: 'playing'
    });
  } finally {
    if (tabId != null) {
      await worker.evaluate((id) => chrome.tabs.remove(id), tabId).catch(() => {});
    }
    server.close();
  }
});

test('tab switch enters PiP for dynamically-created player video', async ({ context }) => {
  test.setTimeout(120000);

  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/delayed-video.html`;
  const blankUrl = `${baseURL}/blank.html`;

  const getFlags = async (page) => {
    return page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) {
        return {
          hasVideo: false,
          playing: false,
          autoPipAttr: false,
          playbackState: null,
          inPictureInPicture: false
        };
      }

      return {
        hasVideo: true,
        playing: !video.paused && !video.ended && video.readyState >= 2,
        autoPipAttr: video.hasAttribute('autopictureinpicture'),
        playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null,
        inPictureInPicture: document.pictureInPictureElement === video
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

    blankPage = await context.newPage();
    await blankPage.goto(blankUrl);
    await blankPage.bringToFront();
    await expect.poll(async () => getFlags(videoPage), { timeout: 10000 }).toMatchObject({
      inPictureInPicture: true
    });
  } finally {
    if (blankPage) await blankPage.close().catch(() => {});
    if (videoPage) await videoPage.close().catch(() => {});
    server.close();
  }
});
