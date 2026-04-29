# Chrome Automatic Picture-in-Picture (PiP)

[Chrome Web Store](https://chromewebstore.google.com/detail/automatic-picture-in-pict/dmjccoaplbldlhhljlcldhaciadfhkcj)

Free and open source.

Changelog: [CHANGELOG.md](CHANGELOG.md)

Automatically enables Picture-in-Picture when switching tabs like Arc or Firefox or Zen.

Includes one click activation of Picture-in-Picture through plugin icon.
<br><br>
Enjoying the extension?

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=000000)](https://buymeacoffee.com/apotenza)

## Installation

1. **Enable the browser flag (REQUIRED)**

   1. Go to `about://flags` and search for `auto-picture-in-picture-for-video-playback`
   2. Set the flag to **Enabled**
   3. Restart your browser

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

This extension uses Chrome's [MediaSession API](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback) to register an `enterpictureinpicture` handler and sets the `autopictureinpicture` attribute on videos. When you switch tabs away from a playing video, Chrome's built-in auto-PiP feature (enabled via the flag) automatically triggers PiP.

## Site Compatibility

### Sites That Work Seamlessly
Most video sites work automatically, including:
- YouTube
- Netflix
- Vimeo
- And many others where the video is in the main page frame

### Sites Requiring User Interaction

**Twitch** and similar sites that embed video players in iframes may require a click or keyboard input on the page before auto-PiP will activate when switching tabs.

**Why?** Chrome's auto-PiP has a security requirement that [media must be in the top frame](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback). When the video is in an iframe (like Twitch's player), Chrome requires a recent user gesture to allow PiP.

**Workaround:** Simply click anywhere on the Twitch page before switching tabs. After that initial interaction, auto-PiP should work. If you return to the tab and want to switch away again, another click may be needed.

> **Note:** Firefox's built-in auto-PiP feature doesn't have this limitation because it's implemented at the browser level with elevated privileges, not as an extension subject to web security policies.

## Requirements

- Chrome 134+ or compatible Chromium browser
- The `auto-picture-in-picture-for-video-playback` flag must be enabled
