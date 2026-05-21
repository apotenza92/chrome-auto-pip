'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATE_EXECUTABLES = {
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\alex\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome for Testing\\Application\\chrome.exe',
    'C:\\Program Files\\Chrome for Testing\\chrome.exe',
    'C:\\Users\\alex\\AppData\\Local\\Google\\Chrome for Testing\\Application\\chrome.exe'
  ],
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  helium: [
    '/Applications/Helium.app/Contents/MacOS/Helium',
    path.join(os.homedir(), 'Applications', 'Helium.app', 'Contents', 'MacOS', 'Helium')
  ]
};

function browserWorkerTimeoutMs(key) {
  // Repeated Windows VM runs can take noticeably longer to surface the MV3
  // service worker after Chromium relaunch, especially late in a full flow.
  return 90000;
}

function discoverExecutableCandidates(key) {
  const candidates = CANDIDATE_EXECUTABLES[key] || [];
  return candidates.map((candidate) => ({ path: candidate, exists: fs.existsSync(candidate) }));
}

function resolveBrowserConfig(options = {}) {
  const key = (options.browser || 'chromium').toLowerCase();
  const explicitExecutablePath = options.browserExecutable || null;
  const explicitChannel = options.browserChannel || null;

  if (explicitExecutablePath) {
    return {
      key,
      executablePath: explicitExecutablePath,
      channel: explicitChannel,
      workerTimeoutMs: browserWorkerTimeoutMs(key),
      processName: key === 'edge' ? 'msedge' : key === 'helium' ? 'Helium' : 'chrome',
      source: 'explicit-executable',
      candidates: discoverExecutableCandidates(key)
    };
  }

  if (explicitChannel) {
    return {
      key,
      executablePath: null,
      channel: explicitChannel,
      workerTimeoutMs: browserWorkerTimeoutMs(key),
      processName: key === 'edge' ? 'msedge' : key === 'helium' ? 'Helium' : 'chrome',
      source: 'explicit-channel',
      candidates: discoverExecutableCandidates(key)
    };
  }

  if (key === 'chromium') {
    return {
      key,
      executablePath: null,
      channel: null,
      workerTimeoutMs: browserWorkerTimeoutMs(key),
      processName: 'chrome',
      source: 'playwright-bundled',
      candidates: []
    };
  }

  if (key === 'chrome') {
    const candidates = discoverExecutableCandidates('chrome');
    const discovered = candidates.find((candidate) => candidate.exists);
    return {
      key,
      executablePath: null,
      channel: 'chrome',
      workerTimeoutMs: browserWorkerTimeoutMs(key),
      processName: 'chrome',
      source: discovered ? 'playwright-channel-with-discovered-chrome' : 'playwright-channel',
      discoveredExecutablePath: discovered ? discovered.path : null,
      candidates
    };
  }

  if (key === 'edge') {
    const candidates = discoverExecutableCandidates('edge');
    const discovered = candidates.find((candidate) => candidate.exists);
    return {
      key,
      executablePath: null,
      channel: 'msedge',
      workerTimeoutMs: browserWorkerTimeoutMs(key),
      processName: 'msedge',
      source: discovered ? 'playwright-channel-with-discovered-edge' : 'playwright-channel',
      discoveredExecutablePath: discovered ? discovered.path : null,
      candidates
    };
  }

  if (key === 'helium') {
    const candidates = discoverExecutableCandidates('helium');
    const discovered = candidates.find((candidate) => candidate.exists);
    if (!discovered) {
      throw new Error(`Unsupported browser: helium executable not found. Checked: ${candidates.map(c => c.path).join(', ')}`);
    }
    return {
      key,
      executablePath: discovered.path,
      channel: null,
      workerTimeoutMs: browserWorkerTimeoutMs(key),
      processName: 'Helium',
      source: 'discovered-executable',
      discoveredExecutablePath: discovered.path,
      candidates
    };
  }

  throw new Error(`Unsupported browser: ${key}`);
}

module.exports = {
  CANDIDATE_EXECUTABLES,
  discoverExecutableCandidates,
  resolveBrowserConfig
};
