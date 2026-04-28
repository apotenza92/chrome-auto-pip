const { test, expect } = require('../fixtures/extension-fixture');

test('options page shows tab switch and disabled site controls', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.locator('#autoPipOnTabSwitch')).toBeAttached();
  await expect(page.locator('#blockedSitesSetting')).toBeAttached();
});
