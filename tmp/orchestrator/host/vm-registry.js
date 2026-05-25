'use strict';

const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const localConfigPath = path.join(repoRoot, 'tmp', 'orchestrator.local.json');

const REGISTRY = {
  windows: {
    key: 'windows',
    vmName: 'Windows 11 ARM',
    guestFamily: 'windows',
    shell: 'cmd',
    browser: 'chromium',
    runtimeRoot: 'C:\\Users\\alex\\Downloads\\chrome-auto-pip',
    sharedHomeRoot: 'C:\\Mac\\Home',
    readyCommand: ['cmd', '/c', 'ver'],
    nativeAppProfile: 'windows-notepad',
    notes: 'Reference backend. Current focus/app-switch tooling is Windows-first.'
  },
  ubuntu: {
    key: 'ubuntu',
    vmName: 'Ubuntu 24.04.3 ARM64',
    guestFamily: 'linux',
    shell: 'bash',
    browser: 'chromium',
    runtimeRoot: '/home/parallels/chrome-auto-pip',
    sharedHomeRoot: '/media/psf/Home',
    readyCommand: ['uname', '-a'],
    nativeAppProfile: 'linux-text-editor',
    notes: 'Assumes Parallels shared folders and an X11-capable session or equivalent desktop tooling.'
  },
  fedora: {
    key: 'fedora',
    vmName: 'Fedora',
    guestFamily: 'linux',
    shell: 'bash',
    browser: 'chromium',
    runtimeRoot: '/home/parallels/chrome-auto-pip',
    sharedHomeRoot: '/media/psf/Home',
    nodeRoot: '/home/parallels/.pi-tools/node',
    nodeCommand: '/home/parallels/.pi-tools/node/bin/node',
    npmCommand: '/home/parallels/.pi-tools/node/bin/npm',
    npmCliPath: '/home/parallels/.pi-tools/node/lib/node_modules/npm/bin/npm-cli.js',
    nodeBootstrapUrl: 'https://nodejs.org/dist/v20.20.0/node-v20.20.0-linux-arm64.tar.gz',
    readyCommand: ['uname', '-a'],
    nativeAppProfile: 'linux-text-editor',
    notes: 'Assumes Parallels shared folders and an X11-capable session or equivalent desktop tooling.'
  },
  macosSequoia: {
    key: 'macosSequoia',
    vmName: 'macOS Sequoia',
    guestFamily: 'macos',
    shell: 'zsh',
    browser: 'chromium',
    runtimeRoot: '/Users/alex/chrome-auto-pip',
    sharedHomeRoot: '/Volumes/psf/Home',
    nodeRoot: '/Users/alex/.pi-tools/node',
    nodeCommand: '/Users/alex/.pi-tools/node/bin/node',
    npmCommand: '/Users/alex/.pi-tools/node/bin/npm',
    npmCliPath: '/Users/alex/.pi-tools/node/lib/node_modules/npm/bin/npm-cli.js',
    nodeBootstrapUrl: 'https://nodejs.org/dist/v20.20.0/node-v20.20.0-darwin-arm64.tar.gz',
    readyCommand: ['sw_vers'],
    nativeAppProfile: 'macos-textedit',
    notes: 'May require guest Accessibility/Automation permissions for full window/app automation.'
  },
  macos: {
    key: 'macos',
    vmName: 'macOS',
    hostWindowAliases: ['Control Center'],
    guestFamily: 'macos',
    shell: 'zsh',
    browser: 'chromium',
    runtimeRoot: '/Users/alex/chrome-auto-pip',
    sharedHomeRoot: '/Volumes/psf/Home',
    nodeRoot: '/Users/alex/.pi-tools/node',
    nodeCommand: '/Users/alex/.pi-tools/node/bin/node',
    npmCommand: '/Users/alex/.pi-tools/node/bin/npm',
    npmCliPath: '/Users/alex/.pi-tools/node/lib/node_modules/npm/bin/npm-cli.js',
    nodeBootstrapUrl: 'https://nodejs.org/dist/v20.20.0/node-v20.20.0-darwin-arm64.tar.gz',
    readyCommand: ['sw_vers'],
    nativeAppProfile: 'macos-textedit',
    notes: 'Primary macOS validation VM. May require guest Accessibility/Automation permissions for full window/app automation.'
  },
  macosTahoe: {
    key: 'macosTahoe',
    vmName: 'macOS Tahoe',
    hostWindowAliases: ['Control Center'],
    guestFamily: 'macos',
    shell: 'zsh',
    browser: 'chromium',
    runtimeRoot: '/Users/alex/chrome-auto-pip',
    sharedHomeRoot: '/Volumes/psf/Home',
    nodeRoot: '/Users/alex/.pi-tools/node',
    nodeCommand: '/Users/alex/.pi-tools/node/bin/node',
    npmCommand: '/Users/alex/.pi-tools/node/bin/npm',
    npmCliPath: '/Users/alex/.pi-tools/node/lib/node_modules/npm/bin/npm-cli.js',
    nodeBootstrapUrl: 'https://nodejs.org/dist/v20.20.0/node-v20.20.0-darwin-arm64.tar.gz',
    readyCommand: ['sw_vers'],
    nativeAppProfile: 'macos-textedit',
    notes: 'May require guest Accessibility/Automation permissions for full window/app automation.'
  }
};

module.exports = {
  REGISTRY,
  localConfigPath
};
