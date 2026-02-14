# Changelog

## [1.6.3] - 2026-02-14

### Fixed
- Reduced false positives for **Auto PiP on App Switch** by debouncing transient `chrome.windows.WINDOW_ID_NONE` focus events.
- Reduced "ghost" helper tabs by:
  - Creating helper tabs as `about:blank#chrome-auto-pip-helper` (so they are identifiable).
  - Best-effort cleanup of orphaned helper tabs when a window regains focus (covers MV3 service worker restarts that lose in-memory state).
- Improved helper-tab cleanup robustness by retrying `chrome.tabs.remove()` more times when Chrome reports the tab is temporarily busy.

### Changed
- Helper tab URL is now `about:blank#chrome-auto-pip-helper` (instead of plain `about:blank`).

### Tests
- Made e2e tests self-contained by serving a local MP4 fixture with proper Range support.

## [1.6.2] - 2026-02-12

### Changed
- Safer defaults and clearer UX copy around aggressive modes:
  - **Auto PiP on Tab Switch**: On
  - **Auto PiP on Window Switch**: Off
  - **Auto PiP on App Switch**: Off
- Refined Chrome Web Store description/summary copy.

## [1.6.1] - 2026-02-06

### Changed
- Removed the unused `webNavigation` permission.

### Internal
- Adjusted Chrome Web Store release workflows (removed CI release workflow; added manual workflow).

## [1.6.0] - 2026-02-04

### Removed
- Removed Document PiP support.

### Added
- Added per-site auto-PiP exclusions (blocklist) to avoid conferencing/app conflicts.

### Fixed
- Improved fallback cleanup reliability and default PiP sizing.

### Docs
- Updated README and store description to clarify window/app switch behavior and limitations.

## [1.5.0] - 2026-01-28

### Added
- Added Document PiP sizing support.

### Fixed
- Added/improved window-blur fallback cleanup.

## [1.4.0] - 2026-01-08

### Fixed
- Fixed Auto-PiP option not being respected in already-open tabs.

## [1.3.0] - 2025-12-08

### Changed
- Refactored and consolidated shared utilities to improve auto-PiP reliability.

### Fixed
- Improved Twitch support.
- Fixed settings changes not being applied to currently open tabs.

### Added
- Added support for swapping workspaces in browsers like Vivaldi.

## [1.2.0] - 2025-10-15

### Fixed
- Fixed `check-video` logic and improved multi-frame/all-frames handling.
- Improved PiP reliability by force-enabling PiP in cases where pages temporarily disable it.

### Changed
- Updated icons/assets.

## [1.1.0] - 2025-08-24

### Fixed
- Fixed detection of videos in new windows and autoplaying scenarios.
- Fixed manual PiP activation to respect the user option.

## [1.0.0] - 2025-07-17

### Fixed
- Fixed user disabling Auto PiP not being applied to currently open tabs.

### Docs
- General documentation updates and privacy policy added.

## [0.1.0] - 2025-06-13

### Added
- Initial release.
- Auto PiP on tab switch via MediaSession/auto-PiP registration.
- Manual PiP trigger from the toolbar action.
- Options page and basic settings persistence.
- Early error-handling and restricted-URL safeguards.
