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

test('window switch triggers registration on video tab', async ({ context, page, extensionId }) => {
  const { server, baseURL } = await startStaticServer();
  const videoUrl = `${baseURL}/sample-video.html`;

  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await setToggle(page, 'autoPipOnTabSwitch', false);
    await setToggle(page, 'autoPipOnWindowSwitch', true);
    await setToggle(page, 'autoPipOnAppSwitch', false);

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

    const { videoTabId, windowAId, windowBId } = await worker.evaluate(async (url) => {
      const waitForTabComplete = (tabId) => new Promise((resolve) => {
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

      const windowA = await new Promise((resolve) => {
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

      const windowB = await new Promise((resolve) => {
        chrome.windows.create({ url: 'about:blank', focused: true }, resolve);
      });

      if (windowA && windowA.id) {
        chrome.windows.update(windowA.id, { focused: true });
      }
      if (windowB && windowB.id) {
        chrome.windows.update(windowB.id, { focused: true });
      }

      return { videoTabId, windowAId: windowA.id, windowBId: windowB.id };
    }, videoUrl);

    await expect.poll(async () => {
      return worker.evaluate(async (tabId) => {
        if (!tabId) return false;
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => !!window.__auto_pip_registered__
        });
        return result && result[0] ? result[0].result === true : false;
      }, videoTabId);
    }, { timeout: 15000 }).toBe(true);

    await worker.evaluate(({ windowAId, windowBId }) => {
      if (windowAId) chrome.windows.remove(windowAId);
      if (windowBId) chrome.windows.remove(windowBId);
    }, { windowAId, windowBId });
  } finally {
    server.close();
  }
});
