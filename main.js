var currentTab = 0;
var prevTab = null;
var targetTab = null;
var targetWindowId = null;
var lastFocusedWindowId = null;
var blurFallbackWindowId = null;
var blurFallbackOriginalTabId = null;
var blurFallbackTempTabId = null;
var pipActiveTab = null; // Track which tab has active PiP
var autoPipEnabled = true; // Default to enabled
var log = []
var settingsLoaded = false;
var settingsReady = null;
var displayInfo = null;


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

function updateTargetWindow(tabId) {
  if (tabId == null) {
    targetWindowId = null;
    return;
  }
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    targetWindowId = tab.windowId;
  });
}

function setTargetTab(tabId) {
  targetTab = tabId;
  updateTargetWindow(tabId);
}

function clearBlurFallback() {
  blurFallbackWindowId = null;
  blurFallbackOriginalTabId = null;
  blurFallbackTempTabId = null;
}

function activateFallbackTab(windowId, originalTabId) {
  if (windowId == null || originalTabId == null) return;

  blurFallbackWindowId = windowId;
  blurFallbackOriginalTabId = originalTabId;

  const createBlankTab = (index) => {
    if (blurFallbackTempTabId != null) {
      chrome.tabs.remove(blurFallbackTempTabId, () => { });
      blurFallbackTempTabId = null;
    }

    const createOptions = { windowId, url: 'about:blank', active: true };
    if (typeof index === 'number') {
      createOptions.index = index;
    }

    chrome.tabs.create(createOptions, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      blurFallbackTempTabId = tab.id;
    });
  };

  chrome.tabs.get(originalTabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      createBlankTab();
      return;
    }

    const nextIndex = typeof tab.index === 'number' ? tab.index + 1 : undefined;
    createBlankTab(nextIndex);
  });
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

function injectCheckPlayingScript(tabId, callback) {
  injectWithUtils(tabId, ['./scripts/check-playing.js'], callback);
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
      const local = await chrome.storage.local.get(['autoPipEnabled', 'pipSize', 'pipSizeCustom']);
      if (typeof local.autoPipEnabled === 'boolean') {
        autoPipEnabled = local.autoPipEnabled;
      }
    } catch (e) {
    }

    // Authoritative: sync storage
    const result = await chrome.storage.sync.get(['autoPipEnabled', 'pipSize', 'pipSizeCustom']);
    autoPipEnabled = result.autoPipEnabled !== false; // Default to enabled
    // pipSize doesn't need to be stored globally since content scripts read it directly
    // Mirror to local cache (best-effort)
    try { await chrome.storage.local.set({ autoPipEnabled, pipSize: result.pipSize || 80, pipSizeCustom: result.pipSizeCustom === true }); } catch (_) { }
  } catch (error) {
    // If sync is unavailable, ensure we have a sensible default and cache it
    autoPipEnabled = true; // Default to enabled
    try { await chrome.storage.local.set({ autoPipEnabled, pipSize: 80, pipSizeCustom: false }); } catch (_) { }
  } finally {
    settingsLoaded = true;
  }
}

// Load display info (native resolution if available)
async function loadDisplayInfo() {
  try {
    if (!chrome.system || !chrome.system.display) return;

    chrome.system.display.getInfo((displays) => {
      if (!Array.isArray(displays) || displays.length === 0) return;

      const primary = displays.find(d => d.isPrimary) || displays[0];
      const nativeMode = Array.isArray(primary.modes)
        ? primary.modes.find(m => m.isNative)
        : null;

      displayInfo = {
        boundsWidth: primary.bounds?.width,
        boundsHeight: primary.bounds?.height,
        scaleFactor: primary.scaleFactor,
        nativeWidth: nativeMode?.width || primary.bounds?.width,
        nativeHeight: nativeMode?.height || primary.bounds?.height
      };

      try { chrome.storage.local.set({ displayInfo }); } catch (_) { }
    });
  } catch (_) {
    // ignore
  }
}

// Load settings on startup
settingsReady = loadSettings();
loadDisplayInfo();

// Also refresh settings when the service worker wakes up with browser startup
if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    loadSettings();
    loadDisplayInfo();
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

// Refresh display info on display changes
if (chrome.system && chrome.system.display && chrome.system.display.onDisplayChanged) {
  chrome.system.display.onDisplayChanged.addListener(() => {
    loadDisplayInfo();
  });
}

// Set default settings on first install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      await chrome.storage.sync.set({ autoPipEnabled: true, pipSize: 80, pipSizeCustom: false });
      autoPipEnabled = true;
    } catch (error) { }
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    let settingsChanged = false;
    
    if (changes.autoPipEnabled) {
      const newValue = changes.autoPipEnabled.newValue;
      const oldValue = changes.autoPipEnabled.oldValue;
      autoPipEnabled = newValue;
      settingsChanged = true;
      
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
        setTargetTab(null);
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
                  setTargetTab(activeTab.id);
                  currentTab = activeTab.id;
                  injectTriggerAutoPiP(targetTab, (autoResults) => { });
                }
              });
            }
          }
        });
      }
    }

    if (changes.pipSize) {
      // Mirror pipSize to local cache
      try { chrome.storage.local.set({ pipSize: changes.pipSize.newValue }); } catch (_) { }
      settingsChanged = true;

      const newSize = changes.pipSize.newValue;
      if (Number.isFinite(newSize)) {
        const displayInfoSnapshot = displayInfo || null;
        chrome.tabs.query({}, (tabs) => {
          if (!tabs) return;
          tabs.forEach(tab => {
            if (!isValidTab(tab)) return;
            try {
              chrome.tabs.sendMessage(tab.id, {
                type: 'auto_pip_resize',
                pipSize: newSize,
                displayInfo: displayInfoSnapshot
              }, () => {
                if (chrome.runtime.lastError) {
                  // ignore tabs without listener
                }
              });
            } catch (_) { }
          });
        });
      }
    }

    if (changes.pipSizeCustom) {
      // Mirror pipSizeCustom to local cache
      try { chrome.storage.local.set({ pipSizeCustom: changes.pipSizeCustom.newValue }); } catch (_) { }
      settingsChanged = true;
    }

    // If any settings changed, re-register handlers on target tab to pick up new settings
    if (settingsChanged && targetTab) {
      injectTriggerAutoPiP(targetTab, () => { });
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

    const executeInTarget = (target) => {
      chrome.scripting.executeScript({
        target,
        files: files
      }, (results) => {
        if (chrome.runtime.lastError) {
          if (callback) callback(null);
          return;
        }
        if (callback) callback(results);
      });
    };

    if (chrome.webNavigation && chrome.webNavigation.getAllFrames) {
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        if (chrome.runtime.lastError || !Array.isArray(frames)) {
          executeInTarget({ tabId: tabId, frameIds: [0] });
          return;
        }

        const frameIds = frames
          .filter(frame => frame && frame.url && !isRestrictedUrl(frame.url))
          .map(frame => frame.frameId);

        if (frameIds.length === 0) {
          if (callback) callback(null);
          return;
        }

        executeInTarget({ tabId: tabId, frameIds });
      });
      return;
    }

    executeInTarget({ tabId: tabId, frameIds: [0] });
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
          setTargetTab(tab.id);
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
          setTargetTab(currentTab);
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
              setTargetTab(currentTab);
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
              setTargetTab(tabId);
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
            setTargetTab(senderTabId);
            injectTriggerAutoPiP(targetTab, (autoResults) => { });
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
  });
}

// Track window focus changes for auto-PiP on window blur
if (typeof chrome !== 'undefined' && chrome.windows) {
  chrome.windows.getLastFocused({}, (window) => {
    if (!chrome.runtime.lastError && window) {
      lastFocusedWindowId = window.id;
    }
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    const previousWindowId = lastFocusedWindowId;
    lastFocusedWindowId = windowId;

    if (!autoPipEnabled) return;

    const isNone = chrome.windows.WINDOW_ID_NONE;
    if (previousWindowId === isNone && windowId === isNone) {
      return;
    }

    const returningFromNone = previousWindowId === isNone && windowId !== isNone;
    const windowLostFocus =
      !returningFromNone &&
      previousWindowId != null &&
      previousWindowId !== isNone &&
      (windowId === isNone || windowId !== previousWindowId);

    if (windowLostFocus) {
      chrome.tabs.query({ active: true, windowId: previousWindowId }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const activeTab = tabs[0];
        if (!isValidTab(activeTab)) return;
        if (targetTab && activeTab.id !== targetTab) return;

        injectCheckPlayingScript(activeTab.id, (results) => {
          const isPlaying = hasAnyFrameTrue(results);
          if (!isPlaying) return;

          if (targetTab == null) {
            setTargetTab(activeTab.id);
          }

          injectTriggerAutoPiP(activeTab.id, () => {
            pipActiveTab = targetTab || activeTab.id;
            activateFallbackTab(previousWindowId, activeTab.id);
          });
        });
      });
    }

    const returningToTargetWindow = targetTab != null && windowId === targetWindowId && pipActiveTab === targetTab;
    if (returningToTargetWindow) {
      chrome.tabs.query({ active: true, windowId }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const activeTab = tabs[0];
        if (!isValidTab(activeTab)) return;
        if (activeTab.id !== targetTab) return;
        injectExitPiPScript(activeTab.id, () => {
          pipActiveTab = null;
        });
      });
    }

    if (blurFallbackWindowId === windowId && blurFallbackOriginalTabId != null) {
      chrome.tabs.query({ active: true, windowId }, (tabs) => {
        const activeTab = tabs && tabs.length > 0 ? tabs[0] : null;
        const activeTabId = activeTab ? activeTab.id : null;
        const tempTabId = blurFallbackTempTabId;
        const shouldRestoreOriginal = tempTabId != null && activeTabId === tempTabId;

        const cleanupFallback = () => {
          if (tempTabId != null) {
            chrome.tabs.remove(tempTabId, () => { });
          }
          clearBlurFallback();
        };

        if (shouldRestoreOriginal) {
          chrome.tabs.update(blurFallbackOriginalTabId, { active: true }, () => {
            cleanupFallback();
          });
          return;
        }

        cleanupFallback();
      });
    }
  });
}
