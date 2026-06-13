const { test: base, expect } = require('@playwright/test');
const { launchLocalContext, waitForExtensionWorker } = require('../../scripts/local-test/local-session');

const test = base.extend({
  context: async ({}, use) => {
    let session = null;
    let worker = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      session = await launchLocalContext({
        artifactPrefix: 'playwright',
        autoPiPOrigins: ['https://www.youtube.com', 'https://music.youtube.com', 'https://shaka-player-demo.appspot.com']
      });
      if (session.skipped) {
        throw new Error(session.skipReason);
      }

      try {
        worker = session.worker || await waitForExtensionWorker(session.context);
        session.context.__autoPipExtensionWorker = worker;
        break;
      } catch (error) {
        await session.close();
        session = null;
        if (attempt >= 2) throw error;
      }
    }

    try {
      await use(session.context);
    } finally {
      if (session) await session.close();
    }
  },
  extensionId: async ({ context }, use) => {
    const worker = context.__autoPipExtensionWorker || await waitForExtensionWorker(context);
    const extensionId = worker.url().split('/')[2];
    await use(extensionId);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  }
});

module.exports = { test, expect };
