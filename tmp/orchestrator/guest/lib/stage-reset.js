'use strict';

const { getPlatformAdapter } = require('./platform');
const { sleep } = require('./helpers');

async function resetStageEnvironment(options = {}) {
  const adapter = getPlatformAdapter();
  const details = {
    platform: adapter.key,
    browserReset: null,
    defaultAppReset: null
  };

  if (options.killBrowser && adapter.killBrowserProcesses) {
    details.browserReset = await adapter.killBrowserProcesses().catch((error) => ({ ok: false, error: error.message }));
  }

  if (options.killDefaultApp && adapter.killDefaultAppProcesses) {
    details.defaultAppReset = await adapter.killDefaultAppProcesses().catch((error) => ({ ok: false, error: error.message }));
  }

  await sleep(options.sleepMs != null ? options.sleepMs : 1500);
  return details;
}

module.exports = { resetStageEnvironment };
