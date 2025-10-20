var currentTab = 0;
var prevTab = null;
var targetTab = null;
var pipActiveTab = null; // Track which tab has active PiP
var autoPipEnabled = true; // Default to enabled
var log = []
var settingsLoaded = false;
var settingsReady = null;
// removed delayed exit behavior per user request

// Helper function to check if a URL is restricted (chrome://, chrome-extension://, etc.)
function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedProtocols = ['chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-devtools:', 'moz-extension:', 'edge:', 'about:'];
  return restrictedProtocols.some(protocol => url.startsWith(protocol));
}

// Small helpers to reduce repetition (no behavior changes)
function isValidTab(tab) {
  return !!(tab && tab.url && !isRestrictedUrl(tab.url));
}

function hasAnyFrameTrue(results) {
  return Array.isArray(results) && results.some(frameResult => frameResult && frameResult.result);
}

function injectTriggerAutoPiP(tabId, callback) {
  safeExecuteScript(tabId, ['./scripts/trigger-auto-pip.js'], callback);
}

function injectCheckVideoScript(tabId, callback) {
  safeExecuteScript(tabId, ['./scripts/check-video.js'], callback);
}

function injectExitPiPScript(tabId, callback) {
  safeExecuteScript(tabId, ['./scripts/exit-pip.js'], callback);
}

function injectImmediatePiPScript(tabId, callback) {
  safeExecuteScript(tabId, ['./scripts/immediate-pip.js'], callback);
}

function injectClearAutoPiPScript(tabId, callback) {
  safeExecuteScript(tabId, ['./scripts/clear-auto-pip.js'], callback);
}

// Background logging (service worker only)
// no background logs

// Helper function to load settings (local cache first, then sync authoritative)
async function loadSettings() {
  try {
    // Fast path: local cache for immediate availability
    try {
      const local = await chrome.storage.local.get(['autoPipEnabled']);
      if (typeof local.autoPipEnabled === 'boolean') {
        autoPipEnabled = local.autoPipEnabled;
      }
    } catch (e) {
    }

    // Authoritative: sync storage
    const result = await chrome.storage.sync.get(['autoPipEnabled']);
    autoPipEnabled = result.autoPipEnabled !== false; // Default to enabled
    // Mirror to local cache (best-effort)
    try { await chrome.storage.local.set({ autoPipEnabled }); } catch (_) { }
  } catch (error) {
    // If sync is unavailable, ensure we have a sensible default and cache it
    autoPipEnabled = true; // Default to enabled
    try { await chrome.storage.local.set({ autoPipEnabled }); } catch (_) { }
  } finally {
    settingsLoaded = true;
  }
}

// Load settings on startup
settingsReady = loadSettings();

// Also refresh settings when the service worker wakes up with browser startup
if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    loadSettings();
    // If enabled, re-register handlers on all tabs at startup
    setTimeout(() => {
      if (!autoPipEnabled) return;
      chrome.tabs.query({}, (tabs) => {
        if (!tabs) return;
        tabs.forEach(tab => {
          if (!isValidTab(tab)) return;
          injectTriggerAutoPiP(tab.id, () => { });

        });
      });
    }, 300);
  });
}

// Set default settings on first install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      await chrome.storage.sync.set({ autoPipEnabled: true });
      autoPipEnabled = true;
    } catch (error) { }
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.autoPipEnabled) {
    const newValue = changes.autoPipEnabled.newValue;
    const oldValue = changes.autoPipEnabled.oldValue;
    autoPipEnabled = newValue;
    // Mirror to local cache to keep fast path consistent
    try { chrome.storage.local.set({ autoPipEnabled: newValue }); } catch (_) { }

    // If auto-PiP was disabled, clear MediaSession handlers on ALL tabs
    if (!newValue) {
      // Clear MediaSession handlers on ALL tabs to ensure complete cleanup
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          // Skip restricted URLs
          if (isRestrictedUrl(tab.url)) return;
          injectClearAutoPiPScript(tab.id, (results) => { });

        });
      });

      targetTab = null;
      pipActiveTab = null;
    } else if (newValue && oldValue === false) {
      // If auto-PiP was re-enabled, check the current tab for videos
      // Re-register MediaSession handlers on ALL tabs so existing pages work without refresh
      chrome.tabs.query({}, (tabs) => {
        if (!tabs) return;
        tabs.forEach(tab => {
          if (!isValidTab(tab)) return;
          injectTriggerAutoPiP(tab.id, () => { });
        });
      });

      // Get the current active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          const activeTab = tabs[0];
          if (isValidTab(activeTab)) {
            injectCheckVideoScript(activeTab.id, (results) => {
              const hasVideo = hasAnyFrameTrue(results);
              if (hasVideo) {
                targetTab = activeTab.id;
                currentTab = activeTab.id;

                // Setup MediaSession auto-PiP on the current tab
                injectTriggerAutoPiP(targetTab, (autoResults) => { });

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
      if (callback) callback(null);
      return;
    }

    if (isRestrictedUrl(tab.url)) {
      if (callback) callback(null);
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: files
    }, (results) => {
      if (chrome.runtime.lastError) {
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
    if (isRestrictedUrl(tab.url)) {
      return;
    }


    // Check if PiP is active on a different tab
    if (pipActiveTab && pipActiveTab !== tab.id) {
      safeExecuteScript(pipActiveTab, ['./scripts/pip.js'], (results) => {
        pipActiveTab = null;
      });
      return;
    }

    // STEP 1: Try immediate PiP on current tab (works with both playing and paused videos)
    // This always happens regardless of auto-PiP setting - manual activation should always work
    injectImmediatePiPScript(tab.id, (pipResults) => {
      const frameValues = Array.isArray(pipResults)
        ? pipResults.map(r => r && r.result)
        : [];

      const toggledOff = frameValues.includes("toggled_off");
      const activated = frameValues.includes(true);

      if (toggledOff) {
        // PiP was deactivated in some frame
        pipActiveTab = null;
      } else if (activated) {
        // PiP was activated in some frame
        pipActiveTab = tab.id;
      }
    });

    // STEP 2: Only setup auto-PiP for future tab switches if auto-PiP is enabled
    // This prevents manual activation from re-enabling auto-PiP when it's disabled
    if (autoPipEnabled) {
      injectTriggerAutoPiP(tab.id, (results) => {
        const result = hasAnyFrameTrue(results)
        if (result) {
          // Set this as the target tab for future auto-switching
          targetTab = tab.id;

        }
      });
    }
  });

  // No keyboard shortcuts (removed per user request)
}

// Handle tab activation
if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onActivated.addListener(function (tab) {
    currentTab = tab.tabId;


    // --- [1] : Check for playing videos *(set target)  ---
    if (targetTab === null && autoPipEnabled) {
      injectCheckVideoScript(currentTab, (results) => {
        const hasVideo = hasAnyFrameTrue(results);
        if (hasVideo) {
          targetTab = currentTab;
          // Setup MediaSession auto-PiP on the video tab
          injectTriggerAutoPiP(targetTab, (autoResults) => { });

        }

        // After video detection, check if we need to activate PiP
        checkAndActivatePiP();
      });
    } else if (targetTab === null && !autoPipEnabled) {
      checkAndActivatePiP();
    } else {
      // If we already have a targetTab, proceed to check PiP conditions
      checkAndActivatePiP();
    }

    function checkAndActivatePiP() {
      // --- [2] : Exit PiP *(if user is in target tab)  ---
      if (currentTab === targetTab) {

        // Clear PiP tracking since user returned to the video tab
        if (pipActiveTab === targetTab) {
          pipActiveTab = null;
        }

        // Keep targetTab so a fast switch away re-triggers PiP without needing another click
        // (Do not clear targetTab here)

        // If page has a playing video, (re)affirm targetTab and setup auto-PiP
        injectCheckVideoScript(currentTab, (results) => {
          const hasVideo = hasAnyFrameTrue(results);
          if (hasVideo) {
            targetTab = currentTab;

            // Setup MediaSession auto-PiP on the video tab
            injectTriggerAutoPiP(targetTab, (autoResults) => { });

          }
        });

        // Ensure PiP exits on return-to-tab to restore inline playback
        injectExitPiPScript(currentTab, () => { });

        // Log and exit - don't continue to section [3]
        prevTab = tab.tabId;
        return;
      }

      // --- [3] : Auto-PiP should trigger automatically via MediaSession  ---

      if (targetTab != null && currentTab != targetTab && autoPipEnabled) {
        // Track that PiP should be active on the target tab
        pipActiveTab = targetTab;
        // No manual action needed - MediaSession API handles this automatically
      }

      // --- [ Update ] ---
      prevTab = tab.tabId;
    }
  });

  // Add tab update listener to detect when new pages load (for autoplay scenarios)
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    // Inject MediaSession setup as early as possible on active tabs while loading
    if (changeInfo.status === 'loading' && tab && tab.active && tab.url && !isRestrictedUrl(tab.url) && autoPipEnabled) {
      safeExecuteScript(tabId, ['./scripts/site-fixes.js'], () => {
        injectTriggerAutoPiP(tabId, (autoResults) => { });
      });

    }

    // Only process when the page has finished loading
    if (changeInfo.status === 'complete' && tab.url && !isRestrictedUrl(tab.url)) {

      // If this is the currently active tab and we don't have a target tab,
      // check for videos after a short delay to allow for autoplay (only if auto-PiP is enabled)
      if (tabId === currentTab && targetTab === null && autoPipEnabled) {
        setTimeout(() => {
          safeExecuteScript(tabId, ['./scripts/site-fixes.js'], () => {
            injectCheckVideoScript(tabId, (results) => {
              const hasVideo = hasAnyFrameTrue(results);
              if (hasVideo) {
                targetTab = tabId;

                // Setup MediaSession auto-PiP on the video tab
                injectTriggerAutoPiP(targetTab, (autoResults) => { });

              }
            });
          });
        }, 2000); // Wait 2 seconds for autoplay to start
      }

      // No overlay injection
    }
  });

  // Listen for content-script notifications when a video starts playing
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || !sender || !sender.tab) return;
      if (message.type === 'auto_pip_video_playing') {
        const senderTabId = sender.tab.id;
        if (autoPipEnabled) {
          // Prefer setting target when the user is on that tab (most common case)
          if (senderTabId === currentTab || targetTab === null) {
            targetTab = senderTabId;

            // Ensure MediaSession auto-PiP is registered (idempotent)
            injectTriggerAutoPiP(targetTab, (autoResults) => { });

          }
        }
      }
    } catch (e) {
      // TODO: Handle errors
    }
  });
}