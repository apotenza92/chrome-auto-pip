const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

test('blocklist disables auto-pip on a site', async ({ context }) => {
  test.setTimeout(60000);

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/sample-video.html`;
  const host = new URL(baseURL).hostname;

  const createVideoTab = async () => {
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

      const windowA = await new Promise(resolve => {
        chrome.windows.create({ url, focused: true }, resolve);
      });

      const videoTabId = windowA.tabs && windowA.tabs[0] ? windowA.tabs[0].id : null;
      if (videoTabId != null) {
        await waitForTabComplete(videoTabId);
        await chrome.scripting.executeScript({
          target: { tabId: videoTabId },
          func: () => {
            const video = document.querySelector('video');
            if (!video) return false;
            video.muted = true;
            const playPromise = video.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              playPromise.catch(() => {});
            }
            return true;
          }
        });
      }

      return { windowId: windowA.id, videoTabId };
    }, videoUrl);
  };

  const getTabFlags = async (tabId) => {
    return worker.evaluate(async (id) => {
      const result = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => ({
          registered: window.__auto_pip_registered__ === true,
          disabled: window.__auto_pip_disabled__ === true
        })
      });
      return result && result[0] ? result[0].result : { registered: false, disabled: false };
    }, tabId);
  };

  try {
    const { windowId, videoTabId } = await createVideoTab();

    await worker.evaluate((payload) => new Promise(resolve => {
      chrome.storage.sync.set(payload, () => resolve());
    }), { autoPipSiteBlocklist: [host] });

    await expect.poll(async () => (await getTabFlags(videoTabId)).disabled).toBe(true);
    await expect.poll(async () => (await getTabFlags(videoTabId)).registered).toBe(false);

    await worker.evaluate((id) => {
      if (id) chrome.windows.remove(id);
    }, windowId);
  } finally {
    server.close();
  }
});
