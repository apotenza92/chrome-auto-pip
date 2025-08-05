var currentTab = 0;
var prevTab = null;
var targetTab = null;
var pipActiveTab = null; // Track which tab has active PiP
var autoPipEnabled = true; // Default to enabled
var log = []

// Helper function to check if a URL is restricted (chrome://, chrome-extension://, etc.)
function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedProtocols = ['chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-devtools:', 'moz-extension:', 'edge:', 'about:'];
  return restrictedProtocols.some(protocol => url.startsWith(protocol));
}

// Helper function to load settings
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['autoPipEnabled']);
    autoPipEnabled = result.autoPipEnabled !== false; // Default to enabled
    console.log('Loaded auto-PiP setting:', autoPipEnabled);
  } catch (error) {
    console.error('Error loading settings:', error);
    autoPipEnabled = true; // Default to enabled
  }
}

// Load settings on startup
loadSettings();

// Set default settings on first install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('Extension installed - setting default auto-PiP to enabled');
    try {
      await chrome.storage.sync.set({ autoPipEnabled: true });
      autoPipEnabled = true;
      console.log('Default auto-PiP setting saved');
    } catch (error) {
      console.error('Error setting default auto-PiP setting:', error);
    }
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.autoPipEnabled) {
    const newValue = changes.autoPipEnabled.newValue;
    const oldValue = changes.autoPipEnabled.oldValue;
    autoPipEnabled = newValue;
    console.log('Auto-PiP setting changed from', oldValue, 'to', newValue);

    // If auto-PiP was disabled, clear MediaSession handlers on ALL tabs
    if (!newValue) {
      console.log('Auto-PiP disabled - clearing MediaSession handlers on all tabs');
      console.log('Current targetTab:', targetTab);
      console.log('Current pipActiveTab:', pipActiveTab);

      // Clear MediaSession handlers on ALL tabs to ensure complete cleanup
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          // Skip restricted URLs
          if (isRestrictedUrl(tab.url)) return;
          
                     console.log(`Clearing MediaSession handlers on tab ${tab.id}: ${tab.url}`);
           safeExecuteScript(tab.id, ['./scripts/clear-auto-pip.js'], (results) => {
             if (results && results.length > 0) {
               if (results.some(frameResult => {frameResult.success})) {
                 console.log(`✅ MediaSession handlers cleared on tab ${tab.id}`);
               } else {
                 console.log(`❌ Failed to clear MediaSession handlers on tab ${tab.id}: ${results[0].reason}`);
               }
             } else {
               console.log(`❌ Failed to execute clear script on tab ${tab.id}`);
             }
           });
        });
      });

      targetTab = null;
      pipActiveTab = null;
    } else if (newValue && oldValue === false) {
      // If auto-PiP was re-enabled, check the current tab for videos
      console.log('Auto-PiP re-enabled - checking current tab for videos');
      
      // Get the current active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          const activeTab = tabs[0];
          if (activeTab.url && !isRestrictedUrl(activeTab.url)) {
            safeExecuteScript(activeTab.id, ['./scripts/check-video.js'], (results) => {
              const hasVideo = results?.some(frameResult => frameResult && frameResult.result);
              console.log("Current tab has video:", hasVideo);
              if (hasVideo) {
                targetTab = activeTab.id;
                currentTab = activeTab.id;
                console.log("Set targetTab for current tab:", targetTab);

                // Setup MediaSession auto-PiP on the current tab
                safeExecuteScript(targetTab, ['./scripts/trigger-auto-pip.js'], (autoResults) => {
                  if (autoResults?.some(frameResult => frameResult && frameResult.result)) {
                    console.log("Auto-PiP re-enabled setup result:", autoResults[0].result);
                  }
                });
              }
            });
          }
        }
      });
    }
  }
});

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
      target: { tabId: tabId, allFrames: true },
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
    console.log("Current pipActiveTab:", pipActiveTab);
    console.log("Current targetTab:", targetTab);
    console.log("Auto-PiP enabled:", autoPipEnabled);

    if (isRestrictedUrl(tab.url)) {
      console.log("Cannot activate PiP on restricted URL:", tab.url);
      return;
    }

    // Check if PiP is active on a different tab
    if (pipActiveTab && pipActiveTab !== tab.id) {
      console.log("PiP is active on tab", pipActiveTab, "- deactivating it first");
      safeExecuteScript(pipActiveTab, ['./scripts/pip.js'], (results) => {
        const result = results?.some(frameResult => frameResult && frameResult.result)
        if (result) {
          console.log("Cross-tab PiP deactivation result:", result);
        }
        pipActiveTab = null;
      });
      return;
    }

    // STEP 1: Try immediate PiP on current tab (works with both playing and paused videos)
    // This always happens regardless of auto-PiP setting - manual activation should always work
    safeExecuteScript(tab.id, ['./scripts/immediate-pip.js'], (pipResults) => {
      const result = pipResults?.some(frameResult => frameResult && frameResult.result)
      if (result) {
        console.log("Immediate PiP activation result:", result);

        if (result === true) {
          // PiP was activated
          pipActiveTab = tab.id;
          console.log("Set pipActiveTab to:", pipActiveTab);
        } else if (result === "toggled_off") {
          // PiP was deactivated
          pipActiveTab = null;
          console.log("Cleared pipActiveTab");
        }
      }
    });

    // STEP 2: Only setup auto-PiP for future tab switches if auto-PiP is enabled
    // This prevents manual activation from re-enabling auto-PiP when it's disabled
    if (autoPipEnabled) {
      console.log("Auto-PiP enabled - setting up MediaSession handlers for future tab switches");
      safeExecuteScript(tab.id, ['./scripts/trigger-auto-pip.js'], (results) => {
        const result = results?.some(frameResult => frameResult && frameResult.result)
        if (result) {
          console.log("MediaSession setup result:", result);
          // Set this as the target tab for future auto-switching
          targetTab = tab.id;
          console.log("Set targetTab to:", targetTab);
        } else {
          console.log("MediaSession setup failed or returned false (no playing videos for auto-PiP)");
        }
      });
    } else {
      console.log("Auto-PiP disabled - skipping MediaSession setup for manual activation");
    }
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
    console.log("Auto-PiP enabled:", autoPipEnabled);

    // --- [1] : Check for playing videos *(set target)  ---
    if (targetTab === null && autoPipEnabled) {
      console.log(">> [1] Check PiP For:", currentTab, "(auto-PiP enabled)")
      safeExecuteScript(currentTab, ['./scripts/check-video.js'], (results) => {
        const hasVideo = results?.some(frameResult => frameResult && frameResult.result);
        console.log("Has Video:", hasVideo);
        if (hasVideo) {
          targetTab = currentTab;
          console.log(">> [1] Set targetTab to:", targetTab);

          // Setup MediaSession auto-PiP on the video tab
          safeExecuteScript(targetTab, ['./scripts/trigger-auto-pip.js'], (autoResults) => {
            const autoResult = autoResults?.some(frameResult => frameResult && frameResult.result)
            if (autoResult) {
              console.log("Auto-PiP setup result:", autoResult);
            }
          });
        }

        // After video detection, check if we need to activate PiP
        checkAndActivatePiP();
      });
    } else if (targetTab === null && !autoPipEnabled) {
      console.log(">> [1] Auto-PiP disabled - skipping video detection");
      checkAndActivatePiP();
    } else {
      // If we already have a targetTab, proceed to check PiP conditions
      checkAndActivatePiP();
    }

    function checkAndActivatePiP() {
      // --- [2] : Exit PiP *(if user is in target tab)  ---
      if (currentTab === targetTab) {
        console.log(">> [2] User returned to target tab - clearing targetTab")

        // Clear PiP tracking since user returned to the video tab
        if (pipActiveTab === targetTab) {
          pipActiveTab = null;
          console.log("Cleared pipActiveTab (user returned to video tab)");
        }

        // Just clear the targetTab - don't interfere with the video at all
        targetTab = null;

        // If page has a playing video, set it as new targetTab and setup auto-PiP
        safeExecuteScript(currentTab, ['./scripts/check-video.js'], (results) => {
          const hasVideo = results?.some(frameResult => frameResult && frameResult.result);
          console.log("Has Video:", hasVideo);
          if (hasVideo) {
            targetTab = currentTab;

            // Setup MediaSession auto-PiP on the video tab
            safeExecuteScript(targetTab, ['./scripts/trigger-auto-pip.js'], (autoResults) => {
              const autoResult = autoResults?.some(frameResult => frameResult && frameResult.result);
              if (autoResult) {
                console.log("Auto-PiP setup result:", autoResult);
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
      console.log("  autoPipEnabled:", autoPipEnabled);

      if (targetTab != null && currentTab != targetTab && autoPipEnabled) {
        console.log(">> [3] Conditions met - MediaSession should trigger auto-PiP");
        // Track that PiP should be active on the target tab
        pipActiveTab = targetTab;
        console.log("Set pipActiveTab to:", pipActiveTab, "(auto-PiP)");
        // No manual action needed - MediaSession API handles this automatically
      } else if (!autoPipEnabled) {
        console.log(">> [3] Auto-PiP is disabled - skipping");
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
      // check for videos after a short delay to allow for autoplay (only if auto-PiP is enabled)
      if (tabId === currentTab && targetTab === null && autoPipEnabled) {
        console.log("Checking for autoplay videos on newly loaded page (auto-PiP enabled)");
        setTimeout(() => {
          safeExecuteScript(tabId, ['./scripts/check-video.js'], (results) => {
            const hasVideo = results?.some(frameResult => frameResult && frameResult.result);
            console.log("Autoplay video check result:", hasVideo);
            if (hasVideo) {
              targetTab = tabId;
              console.log("Set targetTab for autoplay video:", targetTab);

              // Setup MediaSession auto-PiP on the video tab
              safeExecuteScript(targetTab, ['./scripts/trigger-auto-pip.js'], (autoResults) => {
                const autoResult = autoResults?.some(frameResult => frameResult && frameResult.result);
                if (autoResult) {
                  console.log("Auto-PiP setup for autoplay result:", autoResult);
                }
              });
            }
          });
        }, 2000); // Wait 2 seconds for autoplay to start
      } else if (tabId === currentTab && targetTab === null && !autoPipEnabled) {
        console.log("Auto-PiP disabled - skipping autoplay video check");
      }
    }
  });
} else {
  console.error("Chrome tabs API not available");
}

if (!chrome.action) {
  console.error("Chrome action API not available");
}
