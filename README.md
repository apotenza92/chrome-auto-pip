# Chrome Automatic Picture-in-Picture (PiP)

Free and open source.

Automatically enables Picture-in-Picture when switching tabs like Arc or Firefox or Zen.

Also enables Picture-in-Picture when switching windows or applications.

Includes one click activation of Picture-in-Picture through plugin icon.

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

**Automatic:** Switch tabs away from a video or switch to another window/app and it will automatically enter PiP

**Manual:** Click the extension icon to immediately activate PiP on the current video

**PiP size:** Choose a default PiP window size in options; manual resize is remembered as a custom size

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
