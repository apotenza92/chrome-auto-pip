const { test, expect } = require('../fixtures/extension-fixture');

test('app switch setting updates background state', async ({ context, page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

  const setToggle = async (value) => {
    await page.waitForFunction(() => {
      const el = document.getElementById('autoPipOnAppSwitch');
      return el && !el.disabled;
    });
    await page.evaluate((val) => {
      const el = document.getElementById('autoPipOnAppSwitch');
      if (!el) return;
      el.checked = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };

  await expect.poll(async () => worker.evaluate(() => typeof autoPipOnAppSwitch !== 'undefined')).toBe(true);

  await setToggle(false);
  await expect.poll(async () => worker.evaluate(async () => {
    const result = await chrome.storage.sync.get(['autoPipOnAppSwitch']);
    return result.autoPipOnAppSwitch;
  })).toBe(false);
  await expect.poll(async () => worker.evaluate(async () => {
    await loadSettings();
    return autoPipOnAppSwitch;
  })).toBe(false);

  await setToggle(true);
  await expect.poll(async () => worker.evaluate(async () => {
    const result = await chrome.storage.sync.get(['autoPipOnAppSwitch']);
    return result.autoPipOnAppSwitch;
  })).toBe(true);
  await expect.poll(async () => worker.evaluate(async () => {
    await loadSettings();
    return autoPipOnAppSwitch;
  })).toBe(true);
});
