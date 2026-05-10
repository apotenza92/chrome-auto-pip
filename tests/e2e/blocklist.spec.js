const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

test('blocklist disables auto-pip on a site', async ({ context }) => {
  test.setTimeout(60000);

  const worker = context.__autoPipExtensionWorker || context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
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

      const tab = await new Promise(resolve => {
        chrome.tabs.create({ url, active: true }, resolve);
      });
      const videoTabId = tab ? tab.id : null;
      if (videoTabId != null) {
        await waitForTabComplete(videoTabId);
        await chrome.scripting.executeScript({
          target: { tabId: videoTabId },
          world: 'MAIN',
          func: () => {
            window.__site_media_session_enter_pip_cleared__ = false;
            if (!navigator.mediaSession || navigator.mediaSession.__autoPipTestPatched) return true;
            const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
            navigator.mediaSession.setActionHandler = (action, handler) => {
              if (action === 'enterpictureinpicture' && handler === null) {
                window.__site_media_session_enter_pip_cleared__ = true;
              }
              return original(action, handler);
            };
            navigator.mediaSession.__autoPipTestPatched = true;
            navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
              window.__site_media_session_enter_pip_called__ = true;
            });
            return true;
          }
        });
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

      return { videoTabId };
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
      const mainResult = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'MAIN',
        func: () => ({
          pageDisabled: window.__auto_pip_page_disabled__ === true,
          siteMediaSessionCleared: window.__site_media_session_enter_pip_cleared__ === true
        })
      });
      return {
        ...(result && result[0] ? result[0].result : { registered: false, disabled: false }),
        ...(mainResult && mainResult[0] ? mainResult[0].result : { pageDisabled: false, siteMediaSessionCleared: false })
      };
    }, tabId);
  };

  const getAutoPiPContentSetting = async () => {
    return worker.evaluate(async (url) => {
      if (!chrome.contentSettings.autoPictureInPicture) return null;
      const primaryUrl = new URL(url).origin + '/';
      return await chrome.contentSettings.autoPictureInPicture.get({ primaryUrl });
    }, baseURL);
  };

  try {
    const { videoTabId } = await createVideoTab();

    const hasAutoPiPContentSetting = await worker.evaluate(() => !!chrome.contentSettings.autoPictureInPicture);

    if (hasAutoPiPContentSetting) {
      await worker.evaluate(async (url) => {
        const primaryPattern = new URL(url).origin + '/*';
        await chrome.contentSettings.autoPictureInPicture.set({
          primaryPattern,
          setting: 'allow',
          scope: 'regular'
        });
      }, baseURL);

      await expect.poll(async () => (await getAutoPiPContentSetting()).setting, { timeout: 15000 }).toBe('allow');
    }

    await worker.evaluate((payload) => new Promise(resolve => {
      chrome.storage.sync.set(payload, () => {
        chrome.storage.local.set(payload, () => resolve());
      });
    }), { autoPipSiteBlocklist: [host] });

    await expect.poll(async () => (await getTabFlags(videoTabId)).disabled, { timeout: 15000 }).toBe(true);
    await expect.poll(async () => (await getTabFlags(videoTabId)).registered, { timeout: 15000 }).toBe(false);
    await expect.poll(async () => (await getTabFlags(videoTabId)).pageDisabled, { timeout: 15000 }).toBe(true);
    expect((await getTabFlags(videoTabId)).siteMediaSessionCleared).toBe(false);
    if (hasAutoPiPContentSetting) {
      await expect.poll(async () => (await getAutoPiPContentSetting()).setting, { timeout: 15000 }).toBe('block');
    }

    await worker.evaluate((id) => {
      if (id) chrome.tabs.remove(id);
    }, videoTabId);
  } finally {
    server.close();
  }
});
