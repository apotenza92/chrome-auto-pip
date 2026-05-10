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

test('settings update sync storage and persist', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);

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
          pageDisabled: window.__auto_pip_page_disabled__ === true
        })
      });

      const isolatedFlags = isolatedResult && isolatedResult[0] ? isolatedResult[0].result : {
        registered: false,
        disabled: false,
        autoPiPVideoCount: 0
      };
      const mainFlags = mainResult && mainResult[0] ? mainResult[0].result : {
        pageDisabled: false
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
    await expect.poll(async () => (await getTabFlags(videoTabId)).pageDisabled, { timeout: 15000 }).toBe(true);
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
