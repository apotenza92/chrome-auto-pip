'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const options = {
    stdout: null,
    stderr: null,
    command: []
  };

  let afterSeparator = false;
  for (const arg of argv) {
    if (afterSeparator) {
      options.command.push(arg);
      continue;
    }
    if (arg === '--') {
      afterSeparator = true;
      continue;
    }
    if (arg.startsWith('--stdout=')) {
      options.stdout = arg.slice('--stdout='.length);
      continue;
    }
    if (arg.startsWith('--stderr=')) {
      options.stderr = arg.slice('--stderr='.length);
      continue;
    }
  }

  return options;
}

function ensureParent(filePath) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!options.stdout || !options.stderr || options.command.length === 0) {
    console.error('Usage: detached-launcher.js --stdout=<path> --stderr=<path> -- <command...>');
    process.exit(2);
    return;
  }

  ensureParent(options.stdout);
  ensureParent(options.stderr);

  const stdoutFd = fs.openSync(options.stdout, 'a');
  const stderrFd = fs.openSync(options.stderr, 'a');
  const [command, ...args] = options.command;

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: ['ignore', stdoutFd, stderrFd]
    });

    child.on('error', (error) => {
      try {
        fs.writeSync(stderrFd, `[detached-launcher] ${error.stack || error.message}\n`);
      } catch (_) {
        // ignore secondary write errors
      }
    });

    child.unref();
    process.exit(0);
  } catch (error) {
    try {
      fs.writeSync(stderrFd, `[detached-launcher] ${error.stack || error.message}\n`);
    } catch (_) {
      // ignore secondary write errors
    }
    process.exit(1);
  } finally {
    try { fs.closeSync(stdoutFd); } catch (_) {}
    try { fs.closeSync(stderrFd); } catch (_) {}
  }
})();
