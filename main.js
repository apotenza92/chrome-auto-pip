var currentTab = 0;
var prevTab = null;
var targetTab = null;
var log = []

// Helper function to check if a URL is restricted (chrome://, chrome-extension://, etc.)
function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedProtocols = ['chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-devtools:', 'moz-extension:', 'edge:', 'about:'];
  return restrictedProtocols.some(protocol => url.startsWith(protocol));
}

// Helper function to safely execute scripts with error handling
function safeExecuteScript(tabId, files, callback) {
  // First check if the tab exists and get its URL
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.log("Tab access error:", chrome.runtime.lastError.message);
      if (callback) callback(null);
      return;
    }

    if (isRestrictedUrl(tab.url)) {
      console.log("Skipping restricted URL:", tab.url);
      if (callback) callback(null);
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: files
    }, (results) => {
      if (chrome.runtime.lastError) {
        console.log("Script execution error:", chrome.runtime.lastError.message);
        if (callback) callback(null);
        return;
      }
      if (callback) callback(results);
    });
  });
}

// Wait for Chrome APIs to be available
if (typeof chrome !== 'undefined' && chrome.action) {
  // Handle extension icon click to manually activate PiP
  chrome.action.onClicked.addListener(async (tab) => {
    console.log("Extension icon clicked, attempting to activate PiP on tab:", tab.id);

    if (isRestrictedUrl(tab.url)) {
      console.log("Cannot activate PiP on restricted URL:", tab.url);
      return;
    }

    // First try immediate PiP (works with both playing and paused videos)
    safeExecuteScript(tab.id, ['./scripts/immediate-pip.js'], (pipResults) => {
      if (pipResults && pipResults[0]) {
        console.log("Immediate PiP activation result:", pipResults[0].result);
      }
    });

    // Separately, try to setup auto-PiP for future tab switches (only if playing videos exist)
    safeExecuteScript(tab.id, ['./scripts/trigger-auto-pip.js'], (results) => {
      if (results && results[0] && results[0].result) {
        console.log("MediaSession setup result:", results[0].result);
        // Set this as the target tab for future auto-switching
        targetTab = tab.id;
        console.log("Set targetTab to:", targetTab);
      } else {
        console.log("MediaSession setup failed or returned false (no playing videos for auto-PiP)");
      }
    });
  });
}

// Handle tab activation
if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onActivated.addListener(function (tab) {

    currentTab = tab.tabId;

    console.log("=== TAB SWITCH DEBUG ===");
    console.log("Current tab:", currentTab);
    console.log("Target tab:", targetTab);
    console.log("Previous tab:", prevTab);

    // --- [1] : Check for playing videos *(set target)  ---
    if (targetTab === null) {
      console.log(">> [1] Check PiP For:", currentTab)
      safeExecuteScript(currentTab, ['./scripts/check-video.js'], (results) => {
        const hasVideo = results && results[0] && results[0].result;
        console.log("Has Video:", hasVideo);
        if (hasVideo) {
          targetTab = currentTab;
          console.log(">> [1] Set targetTab to:", targetTab);

          // Setup MediaSession auto-PiP on the video tab
          safeExecuteScript(targetTab, ['./scripts/trigger-auto-pip.js'], (autoResults) => {
            if (autoResults && autoResults[0]) {
              console.log("Auto-PiP setup result:", autoResults[0].result);
            }
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
        console.log(">> [2] User returned to target tab - clearing targetTab")

        // Just clear the targetTab - don't interfere with the video at all
        targetTab = null;

        // If page has a playing video, set it as new targetTab and setup auto-PiP
        safeExecuteScript(currentTab, ['./scripts/check-video.js'], (results) => {
          const hasVideo = results && results[0] && results[0].result;
          console.log("Has Video:", hasVideo);
          if (hasVideo) {
            targetTab = currentTab;

            // Setup MediaSession auto-PiP on the video tab
            safeExecuteScript(targetTab, ['./scripts/trigger-auto-pip.js'], (autoResults) => {
              if (autoResults && autoResults[0]) {
                console.log("Auto-PiP setup result:", autoResults[0].result);
              }
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

  // Add tab update listener to detect when new pages load (for autoplay scenarios)
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    // Only process when the page has finished loading
    if (changeInfo.status === 'complete' && tab.url && !isRestrictedUrl(tab.url)) {
      console.log("Page loaded on tab:", tabId, "URL:", tab.url);

      // If this is the currently active tab and we don't have a target tab,
      // check for videos after a short delay to allow for autoplay
      if (tabId === currentTab && targetTab === null) {
        console.log("Checking for autoplay videos on newly loaded page");
        setTimeout(() => {
          safeExecuteScript(tabId, ['./scripts/check-video.js'], (results) => {
            const hasVideo = results && results[0] && results[0].result;
            console.log("Autoplay video check result:", hasVideo);
            if (hasVideo) {
              targetTab = tabId;
              console.log("Set targetTab for autoplay video:", targetTab);

              // Setup MediaSession auto-PiP on the video tab
              safeExecuteScript(targetTab, ['./scripts/trigger-auto-pip.js'], (autoResults) => {
                if (autoResults && autoResults[0]) {
                  console.log("Auto-PiP setup for autoplay result:", autoResults[0].result);
                }
              });
            }
          });
        }, 2000); // Wait 2 seconds for autoplay to start
      }
    }
  });
} else {
  console.error("Chrome tabs API not available");
}

if (!chrome.action) {
  console.error("Chrome action API not available");
}
