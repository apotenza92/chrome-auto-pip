const { test, expect } = require('../fixtures/extension-fixture');

test('tab switch setting updates background state', async ({ context, page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

  const setToggle = async (value) => {
    await page.waitForFunction(() => {
      const el = document.getElementById('autoPipOnTabSwitch');
      return el && !el.disabled;
    });
    await page.evaluate((val) => {
      const el = document.getElementById('autoPipOnTabSwitch');
      if (!el) return;
      el.checked = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };

  await expect.poll(async () => worker.evaluate(() => typeof autoPipOnTabSwitch !== 'undefined')).toBe(true);

  await setToggle(false);
  await expect.poll(async () => worker.evaluate(async () => {
    const result = await chrome.storage.sync.get(['autoPipOnTabSwitch']);
    return result.autoPipOnTabSwitch;
  })).toBe(false);
  await expect.poll(async () => worker.evaluate(async () => {
    await loadSettings();
    return autoPipOnTabSwitch;
  })).toBe(false);

  await setToggle(true);
  await expect.poll(async () => worker.evaluate(async () => {
    const result = await chrome.storage.sync.get(['autoPipOnTabSwitch']);
    return result.autoPipOnTabSwitch;
  })).toBe(true);
  await expect.poll(async () => worker.evaluate(async () => {
    await loadSettings();
    return autoPipOnTabSwitch;
  })).toBe(true);
});
