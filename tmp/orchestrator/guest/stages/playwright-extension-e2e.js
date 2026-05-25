'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { resetStageEnvironment } = require('../lib/stage-reset');

const SPEC_FILES = [
  'tests/e2e/extension-loading.spec.js',
  'tests/e2e/settings.spec.js',
  'tests/e2e/blocklist.spec.js',
  'tests/e2e/dynamic-video.spec.js',
  'tests/e2e/tab-switch.spec.js'
];

function parseJsonReport(stdout) {
  try {
    return { report: JSON.parse(stdout), parseError: null };
  } catch (error) {
    return { report: null, parseError: error.message };
  }
}

function summarizeStats(stats, specCount) {
  if (!stats || typeof stats !== 'object') {
    return `Playwright extension E2E finished without parseable stats (${specCount} specs requested)`;
  }

  const expected = Number(stats.expected || 0);
  const unexpected = Number(stats.unexpected || 0);
  const flaky = Number(stats.flaky || 0);
  const skipped = Number(stats.skipped || 0);

  if (unexpected === 0) {
    return `Playwright extension E2E passed (${expected} expected, ${flaky} flaky, ${skipped} skipped)`;
  }

  return `Playwright extension E2E failed (${unexpected} unexpected, ${expected} expected, ${flaky} flaky, ${skipped} skipped)`;
}

function collectFailures(report) {
  const failures = [];

  function visitSuites(suites, prefix = []) {
    if (!Array.isArray(suites)) return;
    suites.forEach((suite) => {
      const nextPrefix = suite && suite.title ? prefix.concat(suite.title) : prefix;
      visitSuites(suite && suite.suites, nextPrefix);
      const specs = suite && Array.isArray(suite.specs) ? suite.specs : [];
      specs.forEach((spec) => {
        const tests = Array.isArray(spec.tests) ? spec.tests : [];
        tests.forEach((test) => {
          const results = Array.isArray(test.results) ? test.results : [];
          results.forEach((result) => {
            if (!result || result.status === 'passed' || result.status === 'skipped') return;
            failures.push({
              title: nextPrefix.concat(spec.title || test.title || 'unknown test').filter(Boolean).join(' > '),
              status: result.status,
              duration: result.duration,
              errors: Array.isArray(result.errors)
                ? result.errors.map((error) => error && (error.message || error.stack || String(error))).filter(Boolean)
                : []
            });
          });
        });
      });
    });
  }

  visitSuites(report && report.suites);
  return failures;
}

async function run(artifacts, options = {}) {
  const reset = await resetStageEnvironment({ killBrowser: true, sleepMs: 1500 });
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const cliPath = require.resolve('@playwright/test/cli');
  const args = [
    cliPath,
    'test',
    '--config=playwright.config.js',
    '--reporter=json',
    '--workers=1',
    ...SPEC_FILES
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      AUTO_PIP_PLAYWRIGHT_BROWSER: options.browser || 'chromium',
      AUTO_PIP_PLAYWRIGHT_CHANNEL: options.browserChannel || '',
      AUTO_PIP_PLAYWRIGHT_EXECUTABLE: options.browserExecutable || '',
      ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {})
    }
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const { report, parseError } = parseJsonReport(stdout);
  const stats = report && report.stats ? report.stats : null;
  const failures = report ? collectFailures(report) : [];

  artifacts.writeJson('playwright-extension-e2e-run.json', {
    command: process.execPath,
    args,
    cwd: repoRoot,
    exitCode: result.status,
    signal: result.signal || null,
    stdout,
    stderr,
    parseError
  });

  if (report) {
    artifacts.writeJson('playwright-extension-e2e-report.json', report);
  }

  const ok = result.status === 0 && !!report && Number((stats && stats.unexpected) || 0) === 0;

  return {
    ok,
    command: 'playwright-extension-e2e',
    summary: summarizeStats(stats, SPEC_FILES.length),
    details: {
      reset,
      specFiles: SPEC_FILES,
      exitCode: result.status,
      signal: result.signal || null,
      stats,
      failures,
      parseError,
      reportParsed: !!report
    }
  };
}

module.exports = { run };
