# Chrome Automatic Picture-in-Picture (PiP)

[Chrome Web Store](https://chromewebstore.google.com/detail/automatic-picture-in-pict/dmjccoaplbldlhhljlcldhaciadfhkcj)

Free and open source.

Changelog: [CHANGELOG.md](CHANGELOG.md)

Automatically opens Picture-in-Picture when you switch away from a playing video tab, with one-click manual PiP from the toolbar.

Version 2.0 keeps the same core experience with a simpler, more reliable foundation: it attaches to video tabs only when needed, handles repeated tab switches more consistently, cleans up after itself more carefully, and includes opt-in debug logs for issue reports.
<br><br>
Enjoying the extension?

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=000000)](https://buymeacoffee.com/apotenza)

## Installation

1. **Enable the browser flag (REQUIRED)**

   1. Go to `about://flags` and search for `auto-picture-in-picture-for-video-playback`
   2. Set the flag to **Enabled**
   3. Restart your browser

   Some Chromium builds also require the site to be allowed to use Automatic Picture-in-Picture from the site information menu in the address bar.

2. **Install the extension** 

   **Option A: Chrome Web Store (Recommended)**
   
   [Chrome Web Store](https://chromewebstore.google.com/detail/automatic-picture-in-pict/dmjccoaplbldlhhljlcldhaciadfhkcj)
   
   **Option B: Manual Installation (GitHub Release ZIP)**

   1. Download the latest release ZIP from: https://github.com/apotenza92/chrome-auto-pip/releases
   2. Extract/unzip the downloaded file to a folder on your computer
   3. Open Chrome and go to `chrome://extensions` (or `brave://extensions` / `edge://extensions`)
   4. Enable **Developer mode** (toggle in the top right)
   5. Click **Load unpacked**
   6. Select the extracted folder (the one that contains `manifest.json`)
   7. The extension should now appear in your extensions list and toolbar

## Usage

### Default Automatic Behaviour (Fresh Install)
- `Auto PiP on Tab Switch`: **On**

With default settings, switching tabs away from a playing video will automatically enter PiP.

### Manual PiP
Click the extension icon to immediately activate PiP on the current video

### Open Extension Options
1. Right-click the extension icon in the Chrome toolbar and click **Options**
2. Or open `chrome://extensions`, open this extension's **Details**, and click **Extension options**

Chrome docs reference: [Options page](https://developer.chrome.com/docs/extensions/develop/ui/options-page)

### Disabled Sites
Auto-PiP is disabled on specific domains. You can add or remove domains in the Options page. Use a `*.` prefix to include subdomains (e.g. `*.zoom.us`).

Google Meet and other conferencing apps are disabled by default because automatic PiP can conflict with meeting controls and expected call behaviour.

Default disabled sites:
- `meet.google.com`
- `*.zoom.us`
- `zoom.com`
- `teams.microsoft.com`
- `teams.live.com`
- `*.slack.com`
- `*.discord.com`

## How It Works

This extension uses Chrome's [MediaSession API](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback) to register an `enterpictureinpicture` handler and sets the `autopictureinpicture` attribute on videos. When you switch tabs away from a playing video, Chrome's built-in auto-PiP feature can trigger PiP if the browser considers the site eligible. For Chromium browsers that do not repeat native Auto-PiP reliably, the extension also makes one immediate compatibility request for the currently playing video at the exact tab-leave moment. Paused videos are skipped, and cleanup only removes attributes added by this extension.

Internally, v2 is split into small buildless modules: background modules handle settings, URL rules, debug state, script injection, tab switching, and message routing; content helpers handle video discovery and PiP ownership; command scripts perform one action and return a structured result; the page-world agent owns native Auto-PiP registration.

## Site Compatibility

### Browser Permission Gate

Chrome's native Auto-PiP for media playback may not fire until the site is trusted by the browser. If a site is armed by the extension but native Auto-PiP does not fire, open the site information menu in the address bar and set **Automatic picture-in-picture** to **Allow** for that site.

The extension cannot grant this browser site permission by itself.

## Debug Logs

Debug logging is off by default. To collect logs, open the extension options, turn on **Debug Logs**, reproduce the issue, then choose **Download .txt**.

## Testing

Local regression tests run on this Mac with Playwright Chromium and the unpacked extension side-loaded into a temporary profile.

```bash
npm install
npm run test:local
```

Additional local checks:

```bash
npm run test:local:static   # syntax, manifest references, defaults, removed-cruft checks
npm run test:local:cpu      # high-churn CPU regression benchmark
npm run test:local:all      # static + fixture E2E + site smoke + CPU benchmark
```

Real website smoke tests are opt-in:

```bash
AUTO_PIP_REAL_SITES=1 npm run test:local:sites
```

Useful environment variables:
- `AUTO_PIP_LOCAL_BROWSER=chromium`
- `AUTO_PIP_LOCAL_EXECUTABLE=/path/to/browser`
- `AUTO_PIP_REAL_SITES=1`
- `AUTO_PIP_KEEP_PROFILE=1`

Artifacts are written to `tmp/local-test-artifacts/`.

### Sites Requiring User Interaction

**Twitch** and similar sites that embed video players in iframes may require a click or keyboard input on the page before auto-PiP will activate when switching tabs.

**Why?** Chrome's auto-PiP has a security requirement that [media must be in the top frame](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback). When the video is in an iframe (like Twitch's player), Chrome requires a recent user gesture to allow PiP.

**Workaround:** Simply click anywhere on the Twitch page before switching tabs. After that initial interaction, auto-PiP should work. If you return to the tab and want to switch away again, another click may be needed.

> **Note:** Firefox's built-in auto-PiP feature doesn't have this limitation because it's implemented at the browser level with elevated privileges, not as an extension subject to web security policies.

## Requirements

- Chrome 134+ or compatible Chromium browser
- The `auto-picture-in-picture-for-video-playback` flag must be enabled
- The site must have a currently playing video for tab-switch Auto PiP
