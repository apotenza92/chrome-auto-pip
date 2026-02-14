# AGENTS

This repo is a Chrome (MV3) extension. This file documents common project workflows for maintainers and automation/agents.

## Development

- Main extension code: `main.js`
- Options UI: `options.html`, `options.js`
- Content scripts: `scripts/`
- Manifest: `manifest.json`

## Tests

End-to-end tests use Playwright.

```bash
npm install
npm run test:e2e
```

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
