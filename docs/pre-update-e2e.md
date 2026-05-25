# Pre-update E2E Gate

Run this before uploading or publishing an extension update:

```bash
npm run test:e2e:preupdate
```

The gate runs the supported extension surface in Parallels VMs only:

- Windows 11 ARM
- Fedora
- macOS

Each target runs:

- VM boot and guest reachability
- runtime sync
- guest environment probe
- Playwright browser probe
- headed desktop probe
- `playwright-extension-e2e`
- VM suspend

The Playwright suite verifies normal release behavior:

- extension loading
- options UI
- settings persistence
- site blocklist behavior
- disabling Auto PiP on already-open video tabs
- dynamic video registration
- tab-switch Auto PiP behavior

Window-switch and app-switch scenarios are not part of the release gate because they are not part of the current supported extension surface.

If the local Fedora VM is not named `Fedora`, set:

```bash
AUTO_PIP_FEDORA_VM_NAME='Your Fedora VM Name' npm run test:e2e:preupdate
```

To generate visual proof footage for all three OSes:

```bash
npm run test:e2e:footage
```

This records the VM display while each target runs the supported tab-switch Auto PiP proof stage.
