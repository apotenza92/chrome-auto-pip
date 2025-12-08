var currentTab = 0;
var prevTab = null;
var targetTab = null;
var pipActiveTab = null; // Track which tab has active PiP
var autoPipEnabled = true; // Default to enabled
var log = []
var settingsLoaded = false;
var settingsReady = null;

// Helper function to check if a URL is restricted (chrome://, chrome-extension://, etc.)
function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedProtocols = ['chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-devtools:', 'moz-extension:', 'edge:', 'about:'];
  return restrictedProtocols.some(protocol => url.startsWith(protocol));
}

// Small helpers to reduce repetition
function isValidTab(tab) {
  return !!(tab && tab.url && !isRestrictedUrl(tab.url));
}

function hasAnyFrameTrue(results) {
  return Array.isArray(results) && results.some(frameResult => frameResult && frameResult.result);
}

// Script injection helpers - always inject utils.js first for shared functionality
function injectWithUtils(tabId, scripts, callback) {
  safeExecuteScript(tabId, ['./scripts/utils.js', './scripts/site-fixes.js', ...scripts], callback);
}

function injectTriggerAutoPiP(tabId, callback) {
  injectWithUtils(tabId, ['./scripts/trigger-auto-pip.js'], callback);
}

function injectCheckVideoScript(tabId, callback) {
  injectWithUtils(tabId, ['./scripts/check-video.js'], callback);
}

function injectExitPiPScript(tabId, callback) {
  injectWithUtils(tabId, ['./scripts/exit-pip.js'], callback);
}

function injectImmediatePiPScript(tabId, callback) {
  injectWithUtils(tabId, ['./scripts/immediate-pip.js'], callback);
}

function injectClearAutoPiPScript(tabId, callback) {
  safeExecuteScript(tabId, ['./scripts/clear-auto-pip.js'], callback);
}

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
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (isRestrictedUrl(tab.url)) return;
          injectClearAutoPiPScript(tab.id, (results) => { });
        });
      });
      targetTab = null;
      pipActiveTab = null;
    } else if (newValue && oldValue === false) {
      // If auto-PiP was re-enabled, re-register on ALL tabs
      chrome.tabs.query({}, (tabs) => {
        if (!tabs) return;
        tabs.forEach(tab => {
          if (!isValidTab(tab)) return;
          injectTriggerAutoPiP(tab.id, () => { });
        });
      });

      // Get the current active tab and check for videos
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          const activeTab = tabs[0];
          if (isValidTab(activeTab)) {
            injectCheckVideoScript(activeTab.id, (results) => {
              const hasVideo = hasAnyFrameTrue(results);
              if (hasVideo) {
                targetTab = activeTab.id;
                currentTab = activeTab.id;
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

// Handle extension icon click to manually activate PiP
if (typeof chrome !== 'undefined' && chrome.action) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (isRestrictedUrl(tab.url)) {
      return;
    }

    // Check if PiP is active on a different tab - exit it there first
    if (pipActiveTab && pipActiveTab !== tab.id) {
      injectExitPiPScript(pipActiveTab, (results) => {
        pipActiveTab = null;
      });
      return;
    }

    // Try immediate PiP on current tab (works with both playing and paused videos)
    // This always happens regardless of auto-PiP setting - manual activation should always work
    injectImmediatePiPScript(tab.id, (pipResults) => {
      const frameValues = Array.isArray(pipResults)
        ? pipResults.map(r => r && r.result)
        : [];

      const toggledOff = frameValues.includes("toggled_off");
      const activated = frameValues.includes(true);

      if (toggledOff) {
        pipActiveTab = null;
      } else if (activated) {
        pipActiveTab = tab.id;
      }
    });

    // Only setup auto-PiP for future tab switches if auto-PiP is enabled
    if (autoPipEnabled) {
      injectTriggerAutoPiP(tab.id, (results) => {
        const result = hasAnyFrameTrue(results);
        if (result) {
          targetTab = tab.id;
        }
      });
    }
  });
}

// Handle tab activation
if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onActivated.addListener(function (tab) {
    currentTab = tab.tabId;

    // Check for playing videos and set target if we don't have one
    if (targetTab === null && autoPipEnabled) {
      injectCheckVideoScript(currentTab, (results) => {
        const hasVideo = hasAnyFrameTrue(results);
        if (hasVideo) {
          targetTab = currentTab;
          injectTriggerAutoPiP(targetTab, (autoResults) => { });
        }
        checkAndActivatePiP();
      });
    } else if (targetTab === null && !autoPipEnabled) {
      checkAndActivatePiP();
    } else {
      checkAndActivatePiP();
    }

    function checkAndActivatePiP() {
      // Exit PiP if user returned to the target tab
      if (currentTab === targetTab) {
        if (pipActiveTab === targetTab) {
          pipActiveTab = null;
        }

        // First: Exit PiP and clear registration flag
        // Then: Re-register MediaSession handlers for next tab switch
        injectExitPiPScript(currentTab, () => {
          // After exiting, check for video and re-register handlers
          injectCheckVideoScript(currentTab, (results) => {
            const hasVideo = hasAnyFrameTrue(results);
            if (hasVideo) {
              targetTab = currentTab;
              injectTriggerAutoPiP(targetTab, (autoResults) => { });
            }
          });
        });

        prevTab = tab.tabId;
        return;
      }

      // Auto-PiP triggers automatically via MediaSession when leaving video tab
      if (targetTab != null && currentTab != targetTab && autoPipEnabled) {
        pipActiveTab = targetTab;
      }

      prevTab = tab.tabId;
    }
  });

  // Handle tab updates to detect when new pages load
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    // Inject MediaSession setup early on active tabs while loading
    if (changeInfo.status === 'loading' && tab && tab.active && tab.url && !isRestrictedUrl(tab.url) && autoPipEnabled) {
      injectTriggerAutoPiP(tabId, (autoResults) => { });
    }

    // When page finishes loading, check for videos
    if (changeInfo.status === 'complete' && tab.url && !isRestrictedUrl(tab.url)) {
      if (tabId === currentTab && targetTab === null && autoPipEnabled) {
        setTimeout(() => {
          injectCheckVideoScript(tabId, (results) => {
            const hasVideo = hasAnyFrameTrue(results);
            if (hasVideo) {
              targetTab = tabId;
              injectTriggerAutoPiP(targetTab, (autoResults) => { });
            }
          });
        }, 2000); // Wait 2 seconds for autoplay to start
      }
    }
  });

  // Listen for content-script notifications when a video starts playing
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || !sender || !sender.tab) return;
      if (message.type === 'auto_pip_video_playing') {
        const senderTabId = sender.tab.id;
        if (autoPipEnabled) {
          if (senderTabId === currentTab || targetTab === null) {
            targetTab = senderTabId;
            injectTriggerAutoPiP(targetTab, (autoResults) => { });
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
  });
}
