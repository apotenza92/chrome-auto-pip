const { test, expect } = require('../fixtures/extension-fixture');

test('options page shows auto switch toggles', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.locator('#autoPipOnTabSwitch')).toBeAttached();
  await expect(page.locator('#autoPipOnWindowSwitch')).toBeAttached();
  await expect(page.locator('#autoPipOnAppSwitch')).toBeAttached();
  await expect(page.getByText(/This mode creates temporary\s+about:blank\s+helper tabs\./)).toHaveCount(2);
});
