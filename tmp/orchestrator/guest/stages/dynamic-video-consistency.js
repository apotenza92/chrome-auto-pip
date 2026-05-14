'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { resetStageEnvironment } = require('../lib/stage-reset');

const SPEC_FILE = 'tests/e2e/dynamic-video.spec.js';
const REPEAT_EACH = 10;

function parseJsonReport(stdout) {
  try {
    return { report: JSON.parse(stdout), parseError: null };
  } catch (error) {
    return { report: null, parseError: error.message };
  }
}

function collectFailures(report) {
  const failures = [];

  function visitSuite(suite) {
    (suite.specs || []).forEach((spec) => {
      (spec.tests || []).forEach((test) => {
        (test.results || []).forEach((result) => {
          if (result.status === 'passed' || result.status === 'skipped') return;
          failures.push({
            file: spec.file,
            title: spec.title,
            status: result.status,
            duration: result.duration,
            error: result.error ? result.error.message : null
          });
        });
      });
    });

    (suite.suites || []).forEach(visitSuite);
  }

  (report && report.suites || []).forEach(visitSuite);
  return failures;
}

function summarizeStats(stats) {
  if (!stats || typeof stats !== 'object') {
    return `Dynamic video consistency finished without parseable stats (${SPEC_FILE}, repeat ${REPEAT_EACH})`;
  }

  const expected = Number(stats.expected || 0);
  const unexpected = Number(stats.unexpected || 0);
  const flaky = Number(stats.flaky || 0);
  const skipped = Number(stats.skipped || 0);

  if (unexpected === 0) {
    return `Dynamic video consistency passed (${expected} expected, repeat ${REPEAT_EACH}, ${flaky} flaky, ${skipped} skipped)`;
  }

  return `Dynamic video consistency failed (${unexpected} unexpected, ${expected} expected, repeat ${REPEAT_EACH}, ${flaky} flaky, ${skipped} skipped)`;
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
    `--repeat-each=${REPEAT_EACH}`,
    SPEC_FILE
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
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

  artifacts.writeJson('dynamic-video-consistency-run.json', {
    command: process.execPath,
    args,
    cwd: repoRoot,
    repeatEach: REPEAT_EACH,
    exitCode: result.status,
    signal: result.signal || null,
    stdout,
    stderr,
    parseError
  });

  if (report) {
    artifacts.writeJson('dynamic-video-consistency-report.json', report);
  }

  const ok = result.status === 0 && !!report && Number((stats && stats.unexpected) || 0) === 0;

  return {
    ok,
    command: 'dynamic-video-consistency',
    summary: summarizeStats(stats),
    details: {
      reset,
      specFile: SPEC_FILE,
      repeatEach: REPEAT_EACH,
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
