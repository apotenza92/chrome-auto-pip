var currentTab = 0;
var prevTab = null;
var targetTab = null;
var log = []

// Wait for Chrome APIs to be available
if (typeof chrome !== 'undefined' && chrome.action) {
  // Handle extension icon click to manually activate PiP
  chrome.action.onClicked.addListener(async (tab) => {
    console.log("Extension icon clicked, attempting to activate PiP on tab:", tab.id);

    // First setup MediaSession auto-PiP for future tab switches
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['./scripts/trigger-auto-pip.js']
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
            files: ['./scripts/immediate-pip.js']
          }, (pipResults) => {
            if (pipResults && pipResults[0]) {
              console.log("Immediate PiP activation result:", pipResults[0].result);
            }
          });
        }
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
      chrome.scripting.executeScript({ target: { tabId: currentTab }, files: ['./scripts/check-video.js'] }, (results) => {
        console.log("Has Video:", results[0].result);
        if (results[0].result) {
          targetTab = currentTab;
          console.log(">> [1] Set targetTab to:", targetTab);

          // Setup MediaSession auto-PiP on the video tab
          chrome.scripting.executeScript({
            target: { tabId: targetTab },
            files: ['./scripts/trigger-auto-pip.js']
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
              files: ['./scripts/trigger-auto-pip.js']
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
} else {
  console.error("Chrome tabs API not available");
}

if (!chrome.action) {
  console.error("Chrome action API not available");
}
