'use strict';

function detectPlatformKey() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

function getPlatformAdapter() {
  const key = detectPlatformKey();
  if (key === 'windows') return require('./windows');
  if (key === 'macos') return require('./macos');
  return require('./linux');
}

module.exports = {
  detectPlatformKey,
  getPlatformAdapter
};
