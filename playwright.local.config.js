const path = require('path');
const { defineConfig } = require('@playwright/test');

const outputRoot = path.join('tmp', 'local-test-artifacts', 'playwright-output');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 120000,
  expect: {
    timeout: 5000
  },
  workers: 1,
  retries: 0,
  outputDir: outputRoot,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join('tmp', 'local-test-artifacts', 'playwright-report.json') }]
  ],
  use: {
    headless: false,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
