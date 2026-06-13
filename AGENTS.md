# AGENTS

This repo is a Chrome (MV3) extension. This file documents common project workflows for maintainers and automation/agents.

## Development

- Main extension code: `main.js`
- Options UI: `options.html`, `options.js`
- Content scripts: `scripts/`
- Manifest: `manifest.json`

## Tests

Local regression tests use Playwright and run directly on the host macOS desktop by default.

The deterministic local suite uses Playwright Chromium with a temporary profile and the unpacked extension side-loaded. Real website smoke tests are opt-in because network, login, ads, and site layout changes can make them non-deterministic.

```bash
npm install
npm run test:local
```

Useful local commands:

```bash
npm run test:local:static
npm run test:local:sites
AUTO_PIP_REAL_SITES=1 npm run test:local:sites
npm run test:local:helium
npm run test:local:cpu
npm run test:local:all
```

Local test artifacts are written under `tmp/local-test-artifacts/`. Temporary browser profiles are deleted after each run unless `AUTO_PIP_KEEP_PROFILE=1` is set.

## Releases (GitHub Release ZIPs)

This project publishes a downloadable ZIP asset on GitHub Releases so users can install manually via **Load unpacked**.

### How it works

- Workflow: `.github/workflows/release.yml`
- Trigger: pushing a tag that matches `v*.*.*` (example: `v1.6.3`)
- The workflow:
  1. Derives the version from the tag.
  2. Verifies `manifest.json` `version` matches the tag version.
  3. Extracts the matching section from `CHANGELOG.md` and uses it as the GitHub Release notes.
  4. Builds `chrome-auto-pip-<version>.zip` containing the extension runtime files.
  5. Creates/updates the GitHub Release and uploads the ZIP as a release asset.

### Publish a release

1. Update `manifest.json` version (and `CHANGELOG.md`).
2. Commit and push to `main`.
3. Create and push a tag:

```bash
git tag v<version>
git push origin v<version>
```

Example:

```bash
git tag v1.6.3
git push origin v1.6.3
```

After the workflow finishes, the release page will contain `chrome-auto-pip-<version>.zip`.

### Backfill/update existing GitHub Releases

If older versions don't have GitHub Releases (or the release body needs to be updated to match `CHANGELOG.md`), run the workflow:

- Actions → **Backfill GitHub Releases** → Run workflow
- Optional input: `versions` as a comma-separated list (e.g. `1.6.2,1.6.1`). Leave blank to process all versions in `CHANGELOG.md`.

This will create/update releases and upload the matching ZIP assets.
