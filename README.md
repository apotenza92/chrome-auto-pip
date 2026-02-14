# Chrome Automatic Picture-in-Picture (PiP)

[Chrome Web Store](https://chromewebstore.google.com/detail/automatic-picture-in-pict/dmjccoaplbldlhhljlcldhaciadfhkcj)

Free and open source.

Changelog: [CHANGELOG.md](CHANGELOG.md)

Automatically enables Picture-in-Picture when switching tabs like Arc or Firefox or Zen.

Also enables Picture-in-Picture when switching windows or applications.

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
   
   **Option B: Manual Installation from GitHub**
   
   1. Click the **Code** button on this GitHub repository
   2. Select **Download ZIP**
   3. Extract the downloaded ZIP file to a folder on your computer
   4. Open your browser and go to `about://extensions`
   5. Enable **Developer mode** (toggle switch in the top right)
   6. Click **Load unpacked** button
   7. Select the extracted folder containing the extension files
   8. The extension should now appear in your extensions list and toolbar

## Usage

### Default Automatic Behavior (Fresh Install)
- `Auto PiP on Tab Switch`: **On**
- `Auto PiP on Window Switch`: **Off**
- `Auto PiP on App Switch`: **Off**

With default settings, switching tabs away from a playing video will automatically enter PiP.

### Manual PiP
Click the extension icon to immediately activate PiP on the current video

### Open Extension Options
1. Right-click the extension icon in the Chrome toolbar and click **Options**
2. Or open `chrome://extensions`, open this extension's **Details**, and click **Extension options**

Chrome docs reference: [Options page](https://developer.chrome.com/docs/extensions/develop/ui/options-page)

### Window/App Switch Modes
- If you enable **Auto PiP on Window Switch** or **Auto PiP on App Switch**, the extension will create temporary `about:blank` helper tabs by design.
- This is required for how the current focus-change detection works when handling aggressive window/app switching behavior.
- It can trigger in undesirable circumstances (for example, opening other extension popups) because Chrome reports browser focus loss as `WINDOW_ID_NONE` and does not reliably expose whether that focus change came from a popup/overlay.

#### Why The Extension Works This Way
- Tab switching is straightforward because Chrome gives direct tab activation events.
- App/window switching is harder: extensions only get high-level focus changes from `chrome.windows.onFocusChanged`.
- For app switches, Chrome can report `WINDOW_ID_NONE`, which means "Chrome lost focus", but it does not say *what* got focus instead.
- To keep PiP behavior consistent in those modes, the extension creates a temporary `about:blank` helper tab to force a reliable focus transition path that Chrome can observe.

#### Chrome Extension Limitations
- There is no reliable API signal that says "this focus loss came from another extension popup/overlay."
- Because of that, some interactions that are not true app switching can still look like app/window switching to the extension.
- This is a platform-level limitation of the currently available extension focus APIs, not a site-specific bug.

References:
- [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows)
- [Auto PiP MediaSession behavior](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback)

### Disabled Sites
Auto-PiP is disabled on specific domains. You can add or remove domains in the Options page. Use a `*.` prefix to include subdomains (e.g. `*.zoom.us`).

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

## Store Description Copy

Use this updated text for the Chrome Web Store long description:

Automatically enables Picture-in-Picture when switching tabs, with one-click manual PiP from the toolbar icon.

Default behavior for new installs:
- Auto PiP on Tab Switch: On
- Auto PiP on Window Switch: Off
- Auto PiP on App Switch: Off

Window Switch and App Switch modes are available in Extension Options as opt-in aggressive modes.

Important: when Window Switch or App Switch is enabled, the extension will create temporary `about:blank` helper tabs by design. This is required so focus transitions can be detected reliably for those modes.

In some undesirable circumstances (for example opening other extension popups), this behavior can still trigger because Chrome reports browser focus loss as `WINDOW_ID_NONE` and does not reliably identify popup sources to extensions.
