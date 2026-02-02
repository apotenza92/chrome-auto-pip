const { test, expect } = require('../fixtures/extension-fixture');

async function getSyncSettings(page) {
  return await page.evaluate(() => new Promise(resolve => {
    chrome.storage.sync.get([
      'autoPipOnTabSwitch',
      'autoPipOnWindowSwitch',
      'autoPipOnAppSwitch',
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

  await setToggle(page, 'autoPipOnTabSwitch', false);
  await setToggle(page, 'autoPipOnWindowSwitch', true);
  await setToggle(page, 'autoPipOnAppSwitch', false);

  await expect.poll(async () => {
    const settings = await getSyncSettings(page);
    return settings.autoPipOnTabSwitch;
  }).toBe(false);

  await expect.poll(async () => {
    const settings = await getSyncSettings(page);
    return settings.autoPipOnWindowSwitch;
  }).toBe(true);

  await expect.poll(async () => {
    const settings = await getSyncSettings(page);
    return settings.autoPipOnAppSwitch;
  }).toBe(false);

  await page.reload();

  await expect(page.locator('#autoPipOnTabSwitch')).not.toBeChecked();
  await expect(page.locator('#autoPipOnWindowSwitch')).toBeChecked();
  await expect(page.locator('#autoPipOnAppSwitch')).not.toBeChecked();

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
