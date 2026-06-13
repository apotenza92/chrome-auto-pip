'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
    }
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
  return result.stdout || '';
}

function listJsFiles(dir) {
  const out = [];
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(path.relative(repoRoot, full));
      }
    });
  };
  walk(path.join(repoRoot, dir));
  return out;
}

function syntaxCheck() {
  const files = [
    'main.js',
    'options.js',
    'playwright.config.js',
    'playwright.local.config.js',
    ...listJsFiles('background'),
    ...listJsFiles('scripts'),
    ...listJsFiles('tests'),
    ...listJsFiles('scripts/local-test')
  ].filter((file, index, all) => all.indexOf(file) === index && fs.existsSync(path.join(repoRoot, file)));

  files.forEach((file) => run(process.execPath, ['-c', file]));
  console.log(`syntax: checked ${files.length} JavaScript files`);
}

function diffCheck() {
  run('git', ['diff', '--check']);
  console.log('git diff --check: ok');
}

function manifestReferenceCheck() {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
  const files = new Set();
  const globs = [];

  (manifest.content_scripts || []).forEach((contentScript) => {
    (contentScript.js || []).forEach(file => files.add(file));
  });
  (manifest.web_accessible_resources || []).forEach((resource) => {
    (resource.resources || []).forEach((file) => {
      if (file.includes('*')) globs.push(file);
      else files.add(file);
    });
  });
  if (manifest.background && manifest.background.service_worker) {
    files.add(manifest.background.service_worker);
  }

  const main = fs.readFileSync(path.join(repoRoot, 'main.js'), 'utf8');
  const importMatch = main.match(/importScripts\(([^)]*)\)/s);
  if (importMatch) {
    for (const quoted of importMatch[1].matchAll(/["']([^"']+)["']/g)) {
      files.add(quoted[1]);
    }
  }

  const missing = [];
  files.forEach((file) => {
    if (!fs.existsSync(path.join(repoRoot, file))) missing.push(file);
  });
  globs.forEach((glob) => {
    const prefix = glob.slice(0, glob.indexOf('*'));
    const dir = prefix.endsWith('/') ? prefix.slice(0, -1) : path.dirname(prefix);
    if (!fs.existsSync(path.join(repoRoot, dir))) missing.push(glob);
  });

  if (missing.length) {
    throw new Error(`missing manifest/runtime references: ${missing.join(', ')}`);
  }
  console.log(`manifest references: checked ${files.size} files and ${globs.length} wildcards`);
}

function grepCheck() {
  const obsolete = /ensure-pip|check-playing|check-pip|page-clear-auto-pip|page-disable-auto-pip|site-fixes|compat-auto-pip/;
  const runtimeFiles = [
    ...listJsFiles('background'),
    ...listJsFiles('scripts').filter(file => !file.startsWith('scripts/local-test/')),
    'main.js',
    'manifest.json'
  ];
  const obsoleteHits = runtimeFiles.filter((file) => obsolete.test(fs.readFileSync(path.join(repoRoot, file), 'utf8')));
  if (obsoleteHits.length) {
    throw new Error(`obsolete fallback references found: ${obsoleteHits.join(', ')}`);
  }

  const runtimeText = [
    ...listJsFiles('background'),
    ...listJsFiles('scripts').filter(file => !file.startsWith('scripts/local-test/')),
    'main.js',
    'manifest.json'
  ].map(file => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
  if (/contentSettings/.test(runtimeText)) {
    throw new Error('runtime code still references chrome.contentSettings');
  }
  console.log('obsolete fallback/contentSettings checks: ok');
}

function defaultDisabledSitesCheck() {
  const expected = [
    'meet.google.com',
    '*.zoom.us',
    'zoom.com',
    'teams.microsoft.com',
    'teams.live.com',
    '*.slack.com',
    '*.discord.com'
  ];
  const files = ['background/constants.js', 'options.js', 'scripts/lib/settings.js'];
  const missing = [];

  files.forEach((file) => {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    expected.forEach((site) => {
      if (!text.includes(`'${site}'`) && !text.includes(`"${site}"`)) {
        missing.push(`${file}:${site}`);
      }
    });
  });

  if (missing.length) {
    throw new Error(`default disabled site mismatch: ${missing.join(', ')}`);
  }
  console.log('default disabled sites: ok');
}

function releaseWorkflowCheck() {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  const requiredRuntimeDirs = ['assets', 'background', 'scripts'];
  const missing = requiredRuntimeDirs.filter(dir => !workflow.includes(`cp -R ${requiredRuntimeDirs.join(' ')} "dist/`));

  if (missing.length) {
    throw new Error(`release workflow does not package runtime dirs: ${missing.join(', ')}`);
  }
  ['scripts/local-test', '.DS_Store', 'assets/icon.afdesign'].forEach((entry) => {
    if (!workflow.includes(entry)) {
      throw new Error(`release workflow does not clean package-only entry: ${entry}`);
    }
  });
  console.log('release workflow package dirs: ok');
}

try {
  syntaxCheck();
  diffCheck();
  manifestReferenceCheck();
  grepCheck();
  defaultDisabledSitesCheck();
  releaseWorkflowCheck();
  console.log('local static checks passed');
} catch (error) {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}
