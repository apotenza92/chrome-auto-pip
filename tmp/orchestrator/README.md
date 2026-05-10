# Orchestrator

This directory now has the first slice of a target-aware modular runner.

## Host entrypoints
- `tmp/orchestrator/host.js` - compatibility wrapper
- `tmp/orchestrator/host/run.js` - target-aware runner
- `tmp/orchestrator/host/vm-registry.js` - Parallels VM target registry

## Local target overrides
Copy:
- `tmp/orchestrator.local.example.json`

to:
- `tmp/orchestrator.local.json`

and adjust guest runtime/shared-folder paths as needed.

If `--current-user` auth does not work for a guest, add:
- `execUser`
- `execPassword`

to that target entry in `tmp/orchestrator.local.json`.

For Linux guests that expose the interactive desktop only to the logged-in user session but run GUI guest stages more reliably through root/no-auth execution, you can also set:
- `guestStageExecMode`: `"root"`

This keeps host/bootstrap probes on the configured user while allowing guest Node stages to run via root/no-auth with the interactive desktop environment injected.

For Windows guests that initially needed no-auth execution before an interactive user session existed, but should switch back to user-context execution once autologon is working, you can set:
- `forceCurrentUserAuth`: `true`

This makes guest execution use `prlctl exec --current-user ...`, which can be important for native app/window interaction once the desktop is truly interactive.

`tmp/orchestrator.local.json` is gitignored.

## Example commands

### Start lean background tmux orchestration (default)
```bash
bash tmp/orchestrator/scripts/start-tmux.sh
```

### Start full-matrix background tmux orchestration only when needed
```bash
bash tmp/orchestrator/scripts/start-tmux.sh auto-pip-orchestrator full
```

### Windows bootstrap
```bash
node tmp/orchestrator/host.js --target=windows --flow=bootstrap
```

### Fedora bootstrap
```bash
node tmp/orchestrator/host.js --target=fedora --flow=bootstrap
```

### Fedora display bootstrap
```bash
node tmp/orchestrator/host.js --target=fedora --flow=linux-display-bootstrap
```

### Windows readiness
```bash
node tmp/orchestrator/host.js --target=windows --flow=readiness
```

### Core primitive flow
```bash
node tmp/orchestrator/host.js --target=windows --flow=core-primitives
node tmp/orchestrator/host.js --target=macosTahoe --flow=core-primitives
node tmp/orchestrator/host.js --target=fedora --flow=bootstrap
```

### Final pre-update E2E gate
Run this before uploading or publishing an update:

```bash
npm run test:e2e:preupdate
```

This runs the current supported extension surface on the three active Parallels VM targets, serially, and suspends each VM after its run.

### Individual full-extension E2E flow
```bash
node tmp/orchestrator/host.js --target=windows --flow=full-extension-e2e --suspend-after-run
node tmp/orchestrator/host.js --target=macosTahoe --flow=full-extension-e2e --suspend-after-run
node tmp/orchestrator/host.js --target=fedora --vm-name=Fedora --flow=full-extension-e2e --suspend-after-run
```

### Active target policy
- Primary macOS target: `macosTahoe`
- Primary Linux target: `fedora`
- `ubuntu` and `macosSequoia` remain available in code, but are not part of the active validation matrix.

### Repeat a flow 3 times
```bash
node tmp/orchestrator/host.js --target=windows --flow=readiness --repeat=3
```

## Current stage catalog

### Core readiness stages
- `guest-prereq-probe` (host-managed; does not require guest Node stage runner)
- `guest-node-bootstrap` (host-managed)
- `guest-runtime-probe` (host-managed)
- `guest-project-deps-probe` (host-managed)
- `guest-deps-install` (host-managed)
- `guest-linux-desktop-tools-probe` (host-managed)
- `guest-linux-desktop-tools-install` (host-managed)
- `guest-windows-autologon-probe` (host-managed)
- `guest-windows-autologon-enable` (host-managed)
- `env-probe`
- `playwright-browser-probe`
- `playwright-browser-install`
- `browser-headless-session-probe`
- `platform-tools-probe`
- `display-stack-probe`
- `interactive-desktop-probe`
- `browser-session-probe`
- `extension-absence-probe`
- `extension-install-probe`
- `extension-reload-probe`
- `extension-storage-reset-probe`
- `tab-open-close-probe`
- `window-open-close-probe`
- `window-inventory-probe`
- `app-launch-probe`
- `extension-probe`
- `plugin-mode-roundtrip-probe`
- `plugin-debug-log-probe`

### Media / PiP stages
- `video-probe`
- `manual-pip-probe`
- `browser-autopip-probe`
- `playwright-extension-e2e`

## Persistent tracking files
- Active status targets are the current matrix:
  - `windows`
  - `fedora`
  - `macosTahoe`
- `tmp/orchestrator/STATUS.md` - compact generated summary
- `tmp/orchestrator/NOW.md` - current active focus / handoff state
- `tmp/orchestrator/WORKLOG.md` - narrative progress log
- `tmp/orchestrator/BACKLOG.md` - prioritized remaining work
- `tmp/orchestrator/TMUX.md` - tmux session/operator notes

## Current state
- VM boot + reachability are now target-aware.
- Runtime sync is now target-aware for Windows and POSIX guests.
- Host-managed bootstrap probes can now test guest prerequisites, runtime layout, and Node dependency availability independently of the guest Node stage runner.
- Host runs are now globally serialized with a shared lock so only one orchestrator VM run executes at a time.
- Before each active-target run, the runner suspends the other active target VMs (`windows`, `fedora`, `macosTahoe`) so only one of them stays running.
- Host runs can also use `--suspend-after-run` to suspend the current VM immediately after the flow finishes; the tmux runner now uses this by default.
- The tmux runner is now profile-driven, with a lean `focused` default and broader profiles only by explicit opt-in.
- Windows now has a richer modular readiness flow and a dedicated `windows-switch-primitives` flow.
- Capability probes now distinguish between:
  - probe execution success
  - measured capability/result
  - environment-unavailable skips
- macOS Tahoe core primitives are in good shape.
- Fedora bootstrap/headless browser validation works, but headed desktop automation is still blocked by display prerequisites.
