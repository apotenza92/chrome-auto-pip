var currentTab = 0;
var prevTab = null;
var targetTab = null;
var log = []

// Handle extension icon click to manually activate PiP
chrome.action.onClicked.addListener(async (tab) => {
  console.log("Extension icon clicked, attempting to activate PiP on tab:", tab.id);

  // First setup MediaSession auto-PiP for future tab switches
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: triggerAutoPiP
  }, (results) => {
    if (results && results[0]) {
      console.log("MediaSession setup result:", results[0].result);
      if (results[0].result) {
        // Set this as the target tab for future auto-switching
        targetTab = tab.id;
        console.log("Set targetTab to:", targetTab);

        // Now immediately request PiP
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: immediatelyRequestPiP
        }, (pipResults) => {
          if (pipResults && pipResults[0]) {
            console.log("Immediate PiP activation result:", pipResults[0].result);
          }
        });
      }
    }
  });
});

chrome.tabs.onActivated.addListener(function (tab) {

  console.clear();
  currentTab = tab.tabId;

  console.log("=== TAB SWITCH DEBUG ===");
  console.log("Current tab:", currentTab);
  console.log("Target tab:", targetTab);
  console.log("Previous tab:", prevTab);

  // --- [1] : Check for playing videos *(set target)  ---
  if (targetTab === null) {
    console.log(">> [1] Check PiP For:", currentTab)
    chrome.scripting.executeScript({ target: { tabId: currentTab }, files: ['./scripts/check-video.js'] }, (results) => {
      console.log("Has Video:", results[0].result);
      if (results[0].result) {
        targetTab = currentTab;
        console.log(">> [1] Set targetTab to:", targetTab);

        // Setup MediaSession auto-PiP on the video tab
        chrome.scripting.executeScript({
          target: { tabId: targetTab },
          func: triggerAutoPiP
        }, (autoResults) => {
          console.log("Auto-PiP setup result:", autoResults[0].result);
        });
      }

      // After video detection, check if we need to activate PiP
      checkAndActivatePiP();
    });
  } else {
    // If we already have a targetTab, proceed to check PiP conditions
    checkAndActivatePiP();
  }

  function checkAndActivatePiP() {
    // --- [2] : Exit PiP *(if user is in target tab)  ---
    if (currentTab === targetTab) {
      console.log(">> [2] Exit PiP (user is in target tab)")

      // Execute Exit PiP
      chrome.scripting.executeScript({ target: { tabId: targetTab }, files: ['./scripts/pip.js'] }, (results) => {
        console.log("PiP:", results[0].result);
        targetTab = null;
      });

      // If page has a video, set targetTab and setup auto-PiP
      chrome.scripting.executeScript({ target: { tabId: currentTab }, files: ['./scripts/check-video.js'] }, (results) => {
        console.log("Has Video:", results[0].result);
        if (results[0].result) {
          targetTab = currentTab;

          // Setup MediaSession auto-PiP on the video tab
          chrome.scripting.executeScript({
            target: { tabId: targetTab },
            func: triggerAutoPiP
          }, (autoResults) => {
            console.log("Auto-PiP setup result:", autoResults[0].result);
          });
        }
      });

      // Log and exit - don't continue to section [3]
      console.log("Current:", tab)
      console.log("Previous:", prevTab)
      console.log("Target:", targetTab)
      prevTab = tab.tabId;
      return;
    }

    // --- [3] : Auto-PiP should trigger automatically via MediaSession  ---
    console.log(">> [3] Auto-PiP should activate automatically");
    console.log("  targetTab != null:", targetTab != null);
    console.log("  currentTab != targetTab:", currentTab != targetTab);

    if (targetTab != null && currentTab != targetTab) {
      console.log(">> [3] Conditions met - MediaSession should trigger auto-PiP");
      // No manual action needed - MediaSession API handles this automatically
    }

    console.log("Current:", tab)
    console.log("Previous:", prevTab)
    console.log("Target:", targetTab)

    // --- [ Update ] ---
    prevTab = tab.tabId;
  }
});

// Function to trigger automatic PiP via MediaSession API (Chrome 134+)
function triggerAutoPiP() {
  console.log("=== AUTO-PIP ATTEMPT START ===");

  // Check if MediaSession API is supported
  if (!('mediaSession' in navigator)) {
    console.log("❌ MediaSession API not supported");
    return false;
  }

  // Find the main video element
  const videos = Array.from(document.querySelectorAll('video'))
    .filter(video => video.readyState >= 2)
    .filter(video => video.disablePictureInPicture == false)
    .filter(video => {
      const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
      const isReadyToPlay = video.readyState >= 3 && !video.ended && video.duration > 0;
      return isPlaying || isReadyToPlay;
    })
    .sort((v1, v2) => {
      const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
      const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
      return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
    });

  if (videos.length === 0) {
    console.log("❌ No suitable video found for auto-PiP");
    return false;
  }

  const video = videos[0];

  // Log Chrome's auto-PiP eligibility requirements
  console.log("📊 Auto-PiP Eligibility Check:");
  console.log("  ✓ Video found:", video.tagName);
  console.log("  ✓ Video playing:", !video.paused);
  console.log("  ✓ Video audible:", !video.muted && video.volume > 0);
  console.log("  ✓ Video currentTime:", video.currentTime);
  console.log("  ✓ Video duration:", video.duration);
  console.log("  ✓ Video readyState:", video.readyState);
  console.log("  ✓ Page visible:", !document.hidden);
  console.log("  ✓ Top frame:", window === window.top);

  try {
    // Register MediaSession action handler for automatic PiP
    navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
      console.log("🚀 Auto-PiP triggered by tab switch!");

      // Ensure video is playing for PiP
      if (video.paused && video.readyState >= 3) {
        console.log("▶️ Starting paused video for PiP");
        await video.play();
      }

      // Request PiP - this should work without user gesture!
      try {
        await video.requestPictureInPicture();
        video.setAttribute('__pip__', true);
        video.addEventListener('leavepictureinpicture', event => {
          video.removeAttribute('__pip__');
          console.log("📺 Left auto-PiP mode");
        }, { once: true });
        console.log("✅ Auto-PiP activated successfully!");
      } catch (pipError) {
        console.error("❌ Auto-PiP request failed:", pipError);
        throw pipError;
      }
    });

    console.log("✅ MediaSession auto-PiP handler registered");

    // Set comprehensive media metadata to help Chrome recognize this as a media session
    navigator.mediaSession.metadata = new MediaMetadata({
      title: document.title || 'Video Content',
      artist: window.location.hostname,
      album: 'Auto-PiP Extension',
      artwork: [
        {
          src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="%23FF0000"/><text x="48" y="56" text-anchor="middle" fill="white" font-size="24">📺</text></svg>',
          sizes: '96x96',
          type: 'image/svg+xml'
        }
      ]
    });

    // Set additional MediaSession playback state to help with eligibility
    navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';

    // Add playback event listeners to keep MediaSession in sync
    video.addEventListener('play', () => {
      navigator.mediaSession.playbackState = 'playing';
      console.log("📻 MediaSession: playing");
    });

    video.addEventListener('pause', () => {
      navigator.mediaSession.playbackState = 'paused';
      console.log("📻 MediaSession: paused");
    });

    console.log("📻 MediaSession metadata and state configured");
    console.log("=== AUTO-PIP SETUP COMPLETE ===");
    return true;
  } catch (error) {
    console.error("❌ MediaSession setup failed:", error);
    return false;
  }
}

// Function to immediately request PiP when icon is clicked
function immediatelyRequestPiP() {
  console.log("=== IMMEDIATE PIP REQUEST ===");

  // Find the main video element
  const videos = Array.from(document.querySelectorAll('video'))
    .filter(video => video.readyState >= 2)
    .filter(video => video.disablePictureInPicture == false)
    .filter(video => {
      const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
      const isReadyToPlay = video.readyState >= 3 && !video.ended && video.duration > 0;
      return isPlaying || isReadyToPlay;
    })
    .sort((v1, v2) => {
      const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
      const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
      return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
    });

  if (videos.length === 0) {
    console.log("❌ No suitable video found for immediate PiP");
    return false;
  }

  const video = videos[0];
  console.log("🎥 Found video for immediate PiP:", video);

  // Start video if paused
  if (video.paused && video.readyState >= 3) {
    console.log("▶️ Starting paused video for PiP");
    video.play();
  }

  // Request PiP immediately (this has user gesture context from icon click)
  video.requestPictureInPicture().then(() => {
    video.setAttribute('__pip__', true);
    video.addEventListener('leavepictureinpicture', event => {
      video.removeAttribute('__pip__');
      console.log("📺 Left immediate PiP mode");
    }, { once: true });
    console.log("✅ Immediate PiP activated successfully!");
    return true;
  }).catch(error => {
    console.error("❌ Immediate PiP request failed:", error);
    return false;
  });
}