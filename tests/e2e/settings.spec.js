const { test, expect } = require('../fixtures/extension-fixture');
const { startStaticServer } = require('../fixtures/static-server');

async function getSyncSettings(page) {
  return await page.evaluate(() => new Promise(resolve => {
    chrome.storage.sync.get([
      'autoPipOnTabSwitch',
      'autoPipSiteBlocklist'
    ], resolve);
  }));
}

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

test('options persist settings, render blocker guidance, and gate debug downloads', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.locator('#autoPipOnTabSwitch')).toBeAttached();
  await expect(page.locator('#autoPipDebugEnabled')).toBeAttached();
  await expect(page.locator('#downloadDebugLog')).toBeAttached();
  await expect(page.locator('#blockedSitesSetting')).toBeAttached();
  await expect(page.locator('#autoPipOnTabSwitch')).toBeChecked();

  await setToggle(page, 'autoPipOnTabSwitch', false);

  await expect.poll(async () => {
    const settings = await getSyncSettings(page);
    return settings.autoPipOnTabSwitch;
  }).toBe(false);

  await page.reload();

  await expect(page.locator('#autoPipOnTabSwitch')).not.toBeChecked();

  await page.waitForFunction(() => {
    const el = document.getElementById('manualSiteInput');
    return el && !el.disabled;
  });

  await page.fill('#manualSiteInput', 'example.com');
  await page.click('#addManualSite');

  await expect.poll(async () => {
    const settings = await getSyncSettings(page);
    return Array.isArray(settings.autoPipSiteBlocklist)
      ? settings.autoPipSiteBlocklist.includes('example.com')
      : false;
  }).toBe(true);

  const removeExample = page.locator('.site-item', { hasText: 'example.com' }).locator('button');
  await removeExample.click();

  await expect.poll(async () => {
    const settings = await getSyncSettings(page);
    return Array.isArray(settings.autoPipSiteBlocklist)
      ? settings.autoPipSiteBlocklist.includes('example.com')
      : false;
  }).toBe(false);

  await setToggle(page, 'autoPipOnTabSwitch', true);
  await expect.poll(async () => {
    const settings = await getSyncSettings(page);
    return settings.autoPipOnTabSwitch;
  }).toBe(true);

  const seedBlocker = async () => page.evaluate(async () => {
    const blocker = {
      at: new Date().toISOString(),
      tabId: 123,
      url: 'https://www.youtube.com/watch?v=test',
      hostname: 'www.youtube.com',
      reason: 'native_auto_pip_not_fired',
      likelyReason: 'site_auto_pip_permission_or_media_engagement',
      hasPlaying: true,
      playbackState: 'playing',
      pictureInPictureEnabled: true,
      topFrame: true,
      playingMutedCount: 0,
      playingAudibleCandidateCount: 1,
      autoPipAttrCount: 1,
      ownedAttrCount: 1,
      addedAutoPipAttrCount: 1
    };
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ autoPipLatestBlocker: blocker }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(['autoPipLatestBlocker'], resolve);
    });
    return data.autoPipLatestBlocker && data.autoPipLatestBlocker.hostname;
  });

  const seededHostname = await seedBlocker();
  expect(seededHostname).toBe('www.youtube.com');

  const renderedFromChange = await page.locator('#autoPipBlockerStatus').isVisible({ timeout: 1500 }).catch(() => false);
  if (!renderedFromChange) {
    await seedBlocker();
    await page.reload();
  }

  await expect(page.locator('#autoPipBlockerStatus')).toBeVisible();
  await expect(page.locator('#autoPipBlockerStatus')).toContainText('Auto PiP was blocked by the browser.');
  await expect(page.locator('#autoPipBlockerStatus')).toContainText('Automatic picture-in-picture');
  await expect(page.locator('#autoPipBlockerStatus')).toContainText('www.youtube.com');

  await page.waitForFunction(() => {
    const el = document.getElementById('autoPipDebugEnabled');
    return el && !el.disabled;
  });

  await expect(page.locator('#autoPipDebugEnabled')).not.toBeChecked();
  await expect(page.locator('#downloadDebugLog')).toBeDisabled();

  await setToggle(page, 'autoPipDebugEnabled', true);

  await expect.poll(async () => {
    return page.evaluate(async () => {
      const result = await chrome.storage.local.get(['autoPipDebugEnabled', 'autoPipDebugLog', 'autoPipDebugText']);
      return {
        enabled: result.autoPipDebugEnabled,
        logLength: Array.isArray(result.autoPipDebugLog) ? result.autoPipDebugLog.length : -1,
        text: result.autoPipDebugText
      };
    });
  }).toMatchObject({
    enabled: true,
    logLength: 0,
    text: ''
  });

  await expect(page.locator('#downloadDebugLog')).toBeEnabled();

  await setToggle(page, 'autoPipDebugEnabled', false);

  await expect.poll(async () => {
    return page.evaluate(async () => {
      const result = await chrome.storage.local.get(['autoPipDebugEnabled', 'autoPipDebugLog', 'autoPipDebugText']);
      return {
        enabled: result.autoPipDebugEnabled,
        logLength: Array.isArray(result.autoPipDebugLog) ? result.autoPipDebugLog.length : -1,
        text: result.autoPipDebugText
      };
    });
  }).toMatchObject({
    enabled: false,
    logLength: 0,
    text: ''
  });
  await expect(page.locator('#downloadDebugLog')).toBeDisabled();
});

test('disabling auto-pip from options applies to already-open video tabs', async ({ context, extensionId }) => {
  test.setTimeout(60000);

  const worker = context.__autoPipExtensionWorker || context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/sample-video.html`;

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
      const isolatedResult = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => ({
          registered: window.__auto_pip_registered__ === true,
          disabled: window.__auto_pip_disabled__ === true,
          autoPiPVideoCount: document.querySelectorAll('video[autopictureinpicture]').length
        })
      });
      const mainResult = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: 'MAIN',
        func: () => ({
          siteMediaSessionCleared: window.__site_media_session_enter_pip_cleared__ === true
        })
      });

      const isolatedFlags = isolatedResult && isolatedResult[0] ? isolatedResult[0].result : {
        registered: false,
        disabled: false,
        autoPiPVideoCount: 0
      };
      const mainFlags = mainResult && mainResult[0] ? mainResult[0].result : {
        siteMediaSessionCleared: false
      };

      return { ...isolatedFlags, ...mainFlags };
    }, tabId);
  };

  try {
    const { videoTabId } = await createVideoTab();

    await expect.poll(async () => (await getTabFlags(videoTabId)).registered, { timeout: 15000 }).toBe(true);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await setToggle(optionsPage, 'autoPipOnTabSwitch', false);

    await expect.poll(async () => (await getTabFlags(videoTabId)).disabled, { timeout: 15000 }).toBe(true);
    await expect.poll(async () => (await getTabFlags(videoTabId)).siteMediaSessionCleared, { timeout: 15000 }).toBe(false);
    await expect.poll(async () => (await getTabFlags(videoTabId)).registered, { timeout: 15000 }).toBe(false);
    await expect.poll(async () => (await getTabFlags(videoTabId)).autoPiPVideoCount, { timeout: 15000 }).toBe(0);

    await optionsPage.close();

    await worker.evaluate((id) => {
      if (id) chrome.tabs.remove(id);
    }, videoTabId);
  } finally {
    server.close();
  }
});

test('disabling auto-pip preserves site-owned autopictureinpicture attributes', async ({ context, extensionId }) => {
  test.setTimeout(60000);

  const worker = context.__autoPipExtensionWorker || context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/site-owned-auto-pip.html`;

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
        func: () => {
          const video = document.querySelector('video');
          return {
            registered: window.__auto_pip_registered__ === true,
            disabled: window.__auto_pip_disabled__ === true,
            autoPipAttr: !!video && video.hasAttribute('autopictureinpicture'),
            managedAttr: !!video && video.hasAttribute('data-auto-pip-managed'),
            addedByExtensionAttr: !!video && video.hasAttribute('data-auto-pip-added-autopictureinpicture')
          };
        }
      });
      return result && result[0] ? result[0].result : {
        registered: false,
        disabled: false,
        autoPipAttr: false,
        managedAttr: false,
        addedByExtensionAttr: false
      };
    }, tabId);
  };

  try {
    const { videoTabId } = await createVideoTab();

    await expect.poll(async () => (await getTabFlags(videoTabId)).registered, { timeout: 15000 }).toBe(true);
    expect((await getTabFlags(videoTabId)).autoPipAttr).toBe(true);
    expect((await getTabFlags(videoTabId)).addedByExtensionAttr).toBe(false);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await setToggle(optionsPage, 'autoPipOnTabSwitch', false);

    await expect.poll(async () => (await getTabFlags(videoTabId)).disabled, { timeout: 15000 }).toBe(true);
    await expect.poll(async () => (await getTabFlags(videoTabId)).managedAttr, { timeout: 15000 }).toBe(false);
    expect((await getTabFlags(videoTabId)).autoPipAttr).toBe(true);
    expect((await getTabFlags(videoTabId)).addedByExtensionAttr).toBe(false);

    await optionsPage.close();
    await worker.evaluate((id) => {
      if (id) chrome.tabs.remove(id);
    }, videoTabId);
  } finally {
    server.close();
  }
});
