# Changelog

## [Unreleased]

## [2.0.0] - 2026-06-12

### Changed
- Reworked the extension into small buildless modules: background state/injection/settings/message helpers, shared content video/PiP helpers, thin command scripts, and one page-world Auto-PiP agent.
- Simplified automatic PiP around browser-native Auto-PiP registration using managed `autopictureinpicture` attributes and MediaSession playback state.
- Stopped sweeping every open tab on install/startup; tabs are armed lazily when they become active, finish loading, or report video playback.
- Replaced Parallels-required validation docs with a local Playwright regression system for v2.
- Kept the default disabled-sites list unchanged for conferencing and app surfaces.

### Fixed
- Added ownership tracking so disabling Auto PiP removes only `autopictureinpicture` attributes added by this extension.
- Added explicit diagnostics and toolbar badge guidance for browsers such as Helium that register native Auto-PiP state but do not fire the native callback.
- Added opt-in local debug logging, an options switch, and a direct `.txt` log download.
- Added a narrow one-shot tab-leave compatibility request for currently playing videos so repeated Helium tab switches work without restoring the old fallback stack.
- Re-armed extension-owned Auto-PiP after PiP leaves so repeated tab-switch cycles can trigger again.
- Preserved site-owned `autopictureinpicture` and MediaSession behavior when disabling Auto PiP or blocklisting a site.

### Removed
- Removed obsolete direct-PiP fallback paths, including broad tab-leave ensure-PiP injection.
- Removed the delayed background compatibility request that could not satisfy browser user-gesture requirements after a tab switch.
- Removed the self-cleaning watchdog path and obsolete helper scripts.

## [1.7.6] - 2026-05-25

### Fixed
- Restored Auto PiP's playing-video gate so paused videos do not enter PiP during tab-switch activation.
- Made all automatic PiP paths require active playback, including the tab-leave ensure-PiP helper and page-world MediaSession handler.
- Stopped mutating Chrome's Auto PiP content setting; the extension now only manages its own registration, blocklist, and video attributes.

### Tests
- Added a paused-video tab-switch regression test to the Parallels VM E2E gate.
- Updated the active Parallels VM matrix to Windows, Fedora, and the new macOS VM target.
- Added coverage that the blocklist disables extension-managed Auto PiP without requesting `contentSettings`.

## [1.7.5] - 2026-05-21

### Fixed
- Made disabling Auto PiP from extension options apply immediately to already-open video tabs, including YouTube tabs in Helium.
- Made browser-level extension disable clean up already-injected pages by removing extension-managed Auto PiP state and exiting extension-triggered PiP.
- Preserved disabled-site blocklist behaviour so site-owned MediaSession handlers are not cleared when a site is excluded.

### Changed
- Added a page-side watchdog so already-injected tabs can self-disable if the browser disables the extension and the service worker can no longer inject cleanup.
- Hardened Parallels VM validation for macOS guests and added a Helium YouTube disable regression stage.

## [1.7.4] - 2026-05-14

### Fixed
- Restored reliable Auto PiP activation for Windows tab-switch flows after the v1.7.2 CPU optimization changed dynamic-video discovery timing.
- Improved handling for late-ready and shadow-DOM video players while keeping deep video scans throttled.
- Preserved disabled-site behavior for Google Meet, Zoom, and other excluded sites after the Chrome Web Store rollback consumed version 1.7.3.

### Changed
- Continued CPU tuning by caching discovered videos, throttling generic DOM-churn refreshes, and avoiding isolated-script refreshes for unrelated mutations.
- Added Parallels Windows visible-browser validation for a normal YouTube/news/third-tab browsing flow.

## [1.7.2] - 2026-05-10

### Fixed
- Reduced CPU and power usage on pages with frequent DOM churn by caching discovered videos and refreshing Auto PiP registration only when new videos are added.
- Improved disabled-site handling so excluded sites also block Chrome's Auto PiP content setting and disable extension-managed page-level Auto PiP handling.
- Made turning Auto PiP off apply immediately to already-open video tabs.

## [1.7.1] - 2026-04-29

### Fixed
- Fixed tab-switch Auto PiP activation for Shaka/player-managed videos by registering the browser-facing MediaSession handler in the page world and retrying when dynamically-created videos become eligible.

## [1.7.0] - 2026-04-28

### Changed
- Removed **Auto PiP on Window Switch** and **Auto PiP on App Switch** because they were inconsistent across platforms, difficult to implement properly, and likely to be difficult to maintain reliably in the future.
- Simplified the extension back to tab-switch Auto PiP, one-click manual PiP, and disabled-sites support.
- Updated README, Chrome Web Store copy, manifest copy, and options UI to describe the simpler tab-switch-only behaviour.

### Fixed
- Improved auto-PiP registration for dynamically-created/player-managed videos, including Shaka-style players that create or replace the video element after the extension first runs.

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
