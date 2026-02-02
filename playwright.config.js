const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 5000
  },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: false
  }
});
