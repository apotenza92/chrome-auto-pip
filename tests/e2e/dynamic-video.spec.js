const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

test('tab switch registration follows dynamically-created player video', async ({ context }) => {
  test.setTimeout(60000);

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
            autoPipAttr: !!video && video.hasAttribute('autopictureinpicture')
          };
        }
      });
      return result && result[0] ? result[0].result : {
        hasVideo: false,
        playing: false,
        registered: false,
        autoPipAttr: false
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
      autoPipAttr: true
    });
  } finally {
    if (tabId != null) {
      await worker.evaluate((id) => chrome.tabs.remove(id), tabId).catch(() => {});
    }
    server.close();
  }
});
