const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

test('auto-switch settings toggle one by one with real windows', async ({ context }) => {
  test.setTimeout(120000);

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/sample-video.html`;

  const setSettings = async (settings) => {
    await worker.evaluate((payload) => new Promise(resolve => {
      chrome.storage.sync.set(payload, () => resolve());
    }), settings);
  };

  const waitForSettings = async (expected) => {
    await expect.poll(async () => worker.evaluate(() => ({
      autoPipOnTabSwitch,
      autoPipOnWindowSwitch,
      autoPipOnAppSwitch
    }))).toEqual(expected);
  };

  const createVideoWindow = async () => {
    return worker.evaluate(async (videoUrl) => {
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
        chrome.windows.create({ url: videoUrl, focused: true }, resolve);
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

      const blankTab = await new Promise(resolve => {
        chrome.tabs.create({ windowId: windowA.id, url: 'about:blank', active: false }, resolve);
      });

      return {
        windowId: windowA.id,
        videoTabId,
        blankTabId: blankTab.id
      };
    }, videoUrl);
  };

  const createBlankWindow = async () => {
    return worker.evaluate(async () => {
      const windowB = await new Promise(resolve => {
        chrome.windows.create({ url: 'about:blank', focused: true }, resolve);
      });
      return windowB.id;
    });
  };

  const focusWindow = async (windowId) => {
    await worker.evaluate((id) => new Promise(resolve => {
      chrome.windows.update(id, { focused: true }, () => resolve());
    }), windowId);
  };

  const activateTab = async (tabId) => {
    await worker.evaluate((id) => new Promise(resolve => {
      chrome.tabs.update(id, { active: true }, () => resolve());
    }), tabId);
  };

  const restoreWindow = async (windowId) => {
    await worker.evaluate((id) => new Promise(resolve => {
      chrome.windows.update(id, { state: 'normal', focused: true }, () => resolve());
    }), windowId);
  };

  const waitForVideoPlaying = async (tabId) => {
    await expect.poll(async () => worker.evaluate(async (id) => {
      const result = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
          const video = document.querySelector('video');
          if (!video) return { hasVideo: false, playing: false };
          return {
            hasVideo: true,
            playing: !video.paused && !video.ended && video.readyState >= 2
          };
        }
      });
      return result && result[0] ? result[0].result : { hasVideo: false, playing: false };
    }, tabId)).toEqual({ hasVideo: true, playing: true });
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

  const waitForRegistered = async (tabId, expected) => {
    await expect.poll(async () => (await getTabFlags(tabId)).registered).toBe(expected);
  };

  const waitForDisabled = async (tabId, expected) => {
    await expect.poll(async () => (await getTabFlags(tabId)).disabled).toBe(expected);
  };

  try {
    const { windowId: windowAId, videoTabId, blankTabId } = await createVideoWindow();
    const windowBId = await createBlankWindow();

    await waitForVideoPlaying(videoTabId);

    // All off
    await setSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: false
    });
    await waitForSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: false
    });
    await waitForDisabled(videoTabId, true);

    await activateTab(blankTabId);
    await focusWindow(windowBId);
    await focusWindow(windowAId);

    await waitForRegistered(videoTabId, false);

    // Tab switch only
    await setSettings({
      autoPipOnTabSwitch: true,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: false
    });
    await waitForSettings({
      autoPipOnTabSwitch: true,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: false
    });

    await focusWindow(windowAId);
    await activateTab(videoTabId);
    await waitForRegistered(videoTabId, true);
    await waitForDisabled(videoTabId, false);

    // Turn off again before next scenario
    await setSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: false
    });
    await waitForSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: false
    });
    await waitForDisabled(videoTabId, true);
    await waitForRegistered(videoTabId, false);

    // Window switch only
    await setSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: true,
      autoPipOnAppSwitch: false
    });
    await waitForSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: true,
      autoPipOnAppSwitch: false
    });

    await focusWindow(windowAId);
    await activateTab(videoTabId);
    await waitForRegistered(videoTabId, false);
    await focusWindow(windowBId);
    await waitForRegistered(videoTabId, true);

    // Turn off again before app switch
    await setSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: false
    });
    await waitForSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: false
    });
    await waitForDisabled(videoTabId, true);
    await waitForRegistered(videoTabId, false);

    // App switch only
    await setSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: true
    });
    await waitForSettings({
      autoPipOnTabSwitch: false,
      autoPipOnWindowSwitch: false,
      autoPipOnAppSwitch: true
    });

    await focusWindow(windowAId);
    await activateTab(videoTabId);
    await waitForRegistered(videoTabId, false);
    await worker.evaluate((windowId) => {
      lastFocusedWindowId = windowId;
      handleWindowFocusChanged(chrome.windows.WINDOW_ID_NONE);
    }, windowAId);
    await waitForRegistered(videoTabId, true);
    await restoreWindow(windowAId);
    await restoreWindow(windowBId);

    await worker.evaluate(({ windowAId, windowBId }) => {
      if (windowAId) chrome.windows.remove(windowAId);
      if (windowBId) chrome.windows.remove(windowBId);
    }, { windowAId, windowBId });
  } finally {
    server.close();
  }
});
