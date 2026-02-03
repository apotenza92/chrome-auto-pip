var currentTab = 0;
var prevTab = null;
var targetTab = null;
var targetWindowId = null;
var lastFocusedWindowId = null;
var blurFallbackWindowId = null;
var blurFallbackOriginalTabId = null;
var blurFallbackTempTabId = null;
var pipActiveTab = null; // Track which tab has active PiP
var autoPipOnTabSwitch = true; // Default to enabled
var autoPipOnWindowSwitch = true; // Default to enabled
var autoPipOnAppSwitch = true; // Default to enabled
const DEFAULT_BLOCKED_SITES = [
  'meet.google.com',
  '*.zoom.us',
  'zoom.com',
  'teams.microsoft.com',
  'teams.live.com',
  '*.slack.com',
  '*.discord.com'
];
var autoPipSiteBlocklist = DEFAULT_BLOCKED_SITES.slice();
var log = []
var settingsLoaded = false;
var settingsReady = null;

function removeTabWithRetry(tabId, context, attempt = 0) {
  if (tabId == null) return;

  chrome.tabs.remove(tabId, () => {
    if (chrome.runtime.lastError) {
      const message = chrome.runtime.lastError.message || '';

      const isBusy = message.includes('Tabs cannot be edited right now');
      if (isBusy && attempt < 5) {
        setTimeout(() => {
          removeTabWithRetry(tabId, context, attempt + 1);
        }, 150 * (attempt + 1));
      }
      return;
    }
  });
}


// Helper function to check if a URL is restricted (chrome://, chrome-extension://, etc.)
function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedProtocols = ['chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-devtools:', 'moz-extension:', 'edge:', 'about:'];
  return restrictedProtocols.some(protocol => url.startsWith(protocol));
}

function normalizeHostEntry(value) {
  if (typeof value !== 'string') return null;
  let input = value.trim().toLowerCase();
  if (!input) return null;

  let wildcard = false;
  if (input.startsWith('*.')) {
    wildcard = true;
    input = input.slice(2);
  }

  let hostname = '';
  try {
    const url = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
    hostname = url.hostname.toLowerCase();
  } catch (_) {
    hostname = input.split('/')[0].split('?')[0].split('#')[0];
  }

  hostname = hostname.split(':')[0].replace(/^\.+|\.+$/g, '');
  if (!hostname) return null;
  return wildcard ? `*.${hostname}` : hostname;
}

function normalizeBlocklist(entries) {
  if (!Array.isArray(entries)) return null;
  const normalized = [];
  entries.forEach((entry) => {
    const value = normalizeHostEntry(entry);
    if (!value) return;
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  });
  return normalized;
}

function getHostnameFromUrl(url) {
  if (!url || isRestrictedUrl(url)) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

function isHostBlocked(hostname) {
  if (!hostname) return false;
  const patterns = Array.isArray(autoPipSiteBlocklist) ? autoPipSiteBlocklist : [];
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    if (!pattern || typeof pattern !== 'string') continue;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      if (!suffix) continue;
      if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return true;
    } else {
      if (hostname === pattern) return true;
      if (hostname === `www.${pattern}`) return true;
    }
  }
  return false;
}

function isAutoPipAllowedUrl(url) {
  const hostname = getHostnameFromUrl(url);
  if (!hostname) return false;
  return !isHostBlocked(hostname);
}

function isAutoPipAllowedTab(tab) {
  if (!tab || !tab.url) return false;
  return isAutoPipAllowedUrl(tab.url);
}

// Small helpers to reduce repetition
function isValidTab(tab) {
  return !!(tab && tab.url && !isRestrictedUrl(tab.url));
}

function hasAnyFrameTrue(results) {
  return Array.isArray(results) && results.some(frameResult => frameResult && frameResult.result);
}

function isAnyAutoPipEnabled() {
  return autoPipOnTabSwitch || autoPipOnWindowSwitch || autoPipOnAppSwitch;
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
      removeTabWithRetry(blurFallbackTempTabId, 'activateFallbackTab');
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
  safeExecuteScript(tabId, ['./scripts/utils.js', './scripts/site-fixes.js', './scripts/immediate-pip.js'], callback, { allowBlocked: true });
}

function injectClearAutoPiPScript(tabId, callback) {
  safeExecuteScript(tabId, ['./scripts/clear-auto-pip.js'], callback);
}

function injectDisableAutoPiPScript(tabId, callback) {
  safeExecuteScript(tabId, ['./scripts/disable-auto-pip.js'], callback, { allowBlocked: true });
}

function registerAutoPipOnAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    if (!tabs) return;
    tabs.forEach(tab => {
      if (!isValidTab(tab)) return;
      if (!isAutoPipAllowedTab(tab)) return;
      injectTriggerAutoPiP(tab.id, () => { });
    });
  });
}

function clearAutoPipOnAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    if (!tabs) return;
    tabs.forEach(tab => {
      if (isRestrictedUrl(tab.url)) return;
      injectClearAutoPiPScript(tab.id, () => { });
    });
  });
}

function applyBlocklistToAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    if (!tabs) return;
    tabs.forEach(tab => {
      if (!isValidTab(tab)) return;
      const allowed = isAutoPipAllowedTab(tab);
      if (!allowed) {
        injectDisableAutoPiPScript(tab.id, () => { });
        if (targetTab === tab.id) {
          setTargetTab(null);
        }
        if (pipActiveTab === tab.id) {
          pipActiveTab = null;
        }
        return;
      }
      if (isAnyAutoPipEnabled()) {
        injectTriggerAutoPiP(tab.id, () => { });
      }
    });
  });
}

async function migrateAutoPipSettings(syncData) {
  const hasOldSetting = typeof syncData.autoPipEnabled === 'boolean';
  const hasNewSettings =
    typeof syncData.autoPipOnTabSwitch === 'boolean' ||
    typeof syncData.autoPipOnWindowSwitch === 'boolean' ||
    typeof syncData.autoPipOnAppSwitch === 'boolean';

  if (hasOldSetting && !hasNewSettings) {
    const migrated = {
      autoPipOnTabSwitch: syncData.autoPipEnabled,
      autoPipOnWindowSwitch: syncData.autoPipEnabled,
      autoPipOnAppSwitch: syncData.autoPipEnabled
    };

    try { await chrome.storage.sync.set(migrated); } catch (_) { }
    try { await chrome.storage.local.set(migrated); } catch (_) { }
    return migrated;
  }

  return null;
}

// Helper function to load settings (local cache first, then sync authoritative)
async function loadSettings() {
  try {
    // Fast path: local cache for immediate availability
    try {
      const local = await chrome.storage.local.get([
        'autoPipOnTabSwitch',
        'autoPipOnWindowSwitch',
        'autoPipOnAppSwitch',
        'autoPipEnabled',
        'autoPipSiteBlocklist'
      ]);

      const hasLocalNew =
        typeof local.autoPipOnTabSwitch === 'boolean' ||
        typeof local.autoPipOnWindowSwitch === 'boolean' ||
        typeof local.autoPipOnAppSwitch === 'boolean';

      const localBlocklist = normalizeBlocklist(local.autoPipSiteBlocklist);
      if (localBlocklist) {
        autoPipSiteBlocklist = localBlocklist;
      }

      if (hasLocalNew) {
        if (typeof local.autoPipOnTabSwitch === 'boolean') {
          autoPipOnTabSwitch = local.autoPipOnTabSwitch;
        }
        if (typeof local.autoPipOnWindowSwitch === 'boolean') {
          autoPipOnWindowSwitch = local.autoPipOnWindowSwitch;
        }
        if (typeof local.autoPipOnAppSwitch === 'boolean') {
          autoPipOnAppSwitch = local.autoPipOnAppSwitch;
        }
      } else if (typeof local.autoPipEnabled === 'boolean') {
        autoPipOnTabSwitch = local.autoPipEnabled;
        autoPipOnWindowSwitch = local.autoPipEnabled;
        autoPipOnAppSwitch = local.autoPipEnabled;
      }
    } catch (e) {
    }

    // Authoritative: sync storage
      const result = await chrome.storage.sync.get([
        'autoPipOnTabSwitch',
        'autoPipOnWindowSwitch',
        'autoPipOnAppSwitch',
        'autoPipEnabled',
        'autoPipSiteBlocklist'
      ]);

    const migrated = await migrateAutoPipSettings(result);
    const effective = migrated || result;

      autoPipOnTabSwitch = typeof effective.autoPipOnTabSwitch === 'boolean'
        ? effective.autoPipOnTabSwitch
        : true;
    autoPipOnWindowSwitch = typeof effective.autoPipOnWindowSwitch === 'boolean'
      ? effective.autoPipOnWindowSwitch
      : true;
      autoPipOnAppSwitch = typeof effective.autoPipOnAppSwitch === 'boolean'
        ? effective.autoPipOnAppSwitch
        : true;

      const syncBlocklist = normalizeBlocklist(effective.autoPipSiteBlocklist);
      const localBlocklist = normalizeBlocklist(autoPipSiteBlocklist);
      const effectiveBlocklist = syncBlocklist || localBlocklist || DEFAULT_BLOCKED_SITES.slice();
      autoPipSiteBlocklist = effectiveBlocklist;

      if (!syncBlocklist) {
        try { await chrome.storage.sync.set({ autoPipSiteBlocklist: effectiveBlocklist }); } catch (_) { }
      }

    // Mirror to local cache (best-effort)
      try {
        await chrome.storage.local.set({
          autoPipOnTabSwitch,
          autoPipOnWindowSwitch,
          autoPipOnAppSwitch,
          autoPipSiteBlocklist
        });
      } catch (_) { }
  } catch (error) {
    // If sync is unavailable, ensure we have a sensible default and cache it
    autoPipOnTabSwitch = true;
    autoPipOnWindowSwitch = true;
    autoPipOnAppSwitch = true;
    autoPipSiteBlocklist = DEFAULT_BLOCKED_SITES.slice();
    try {
      await chrome.storage.local.set({
        autoPipOnTabSwitch,
        autoPipOnWindowSwitch,
        autoPipOnAppSwitch,
        autoPipSiteBlocklist
      });
    } catch (_) { }
  } finally {
    settingsLoaded = true;
    applyBlocklistToAllTabs();
  }
}

// Load settings on startup
settingsReady = loadSettings();

// Also refresh settings when the service worker wakes up with browser startup
if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    loadSettings();
    // If tab switching is enabled, re-register handlers on all tabs at startup
    setTimeout(() => {
      if (!autoPipOnTabSwitch) return;
      registerAutoPipOnAllTabs();
    }, 300);
  });
}

// Set default settings on first install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      await chrome.storage.sync.set({
        autoPipOnTabSwitch: true,
        autoPipOnWindowSwitch: true,
        autoPipOnAppSwitch: true,
        autoPipSiteBlocklist: DEFAULT_BLOCKED_SITES.slice()
      });
      autoPipOnTabSwitch = true;
      autoPipOnWindowSwitch = true;
      autoPipOnAppSwitch = true;
      autoPipSiteBlocklist = DEFAULT_BLOCKED_SITES.slice();
    } catch (error) { }
    return;
  }

  if (details.reason === 'update') {
    try {
      await chrome.storage.sync.remove(['pipSize', 'pipSizeCustom', 'displayInfo']);
    } catch (_) { }
    try {
      await chrome.storage.local.remove(['pipSize', 'pipSizeCustom', 'displayInfo']);
    } catch (_) { }
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    let autoPipSettingsChanged = false;
    const previousTabSwitch = autoPipOnTabSwitch;

    if (changes.autoPipOnTabSwitch) {
      autoPipOnTabSwitch = changes.autoPipOnTabSwitch.newValue !== false;
      autoPipSettingsChanged = true;
      try { chrome.storage.local.set({ autoPipOnTabSwitch }); } catch (_) { }
    }

    if (changes.autoPipOnWindowSwitch) {
      autoPipOnWindowSwitch = changes.autoPipOnWindowSwitch.newValue !== false;
      autoPipSettingsChanged = true;
      try { chrome.storage.local.set({ autoPipOnWindowSwitch }); } catch (_) { }
    }

    if (changes.autoPipOnAppSwitch) {
      autoPipOnAppSwitch = changes.autoPipOnAppSwitch.newValue !== false;
      autoPipSettingsChanged = true;
      try { chrome.storage.local.set({ autoPipOnAppSwitch }); } catch (_) { }
    }

    if (!autoPipSettingsChanged && changes.autoPipEnabled) {
      const migratedValue = changes.autoPipEnabled.newValue !== false;
      autoPipOnTabSwitch = migratedValue;
      autoPipOnWindowSwitch = migratedValue;
      autoPipOnAppSwitch = migratedValue;
      autoPipSettingsChanged = true;
      try {
        chrome.storage.sync.set({
          autoPipOnTabSwitch: migratedValue,
          autoPipOnWindowSwitch: migratedValue,
          autoPipOnAppSwitch: migratedValue
        });
      } catch (_) { }
      try {
        chrome.storage.local.set({
          autoPipOnTabSwitch: migratedValue,
          autoPipOnWindowSwitch: migratedValue,
          autoPipOnAppSwitch: migratedValue
        });
      } catch (_) { }
    }

    if (autoPipSettingsChanged) {
      const anyEnabled = isAnyAutoPipEnabled();

      if (!anyEnabled) {
        clearAutoPipOnAllTabs();
        setTargetTab(null);
        pipActiveTab = null;
      } else if (changes.autoPipOnTabSwitch || previousTabSwitch !== autoPipOnTabSwitch) {
        if (autoPipOnTabSwitch) {
          registerAutoPipOnAllTabs();

          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
              const activeTab = tabs[0];
              if (isValidTab(activeTab)) {
                injectCheckVideoScript(activeTab.id, (results) => {
                  const hasVideo = hasAnyFrameTrue(results);
                  if (hasVideo) {
                    setTargetTab(activeTab.id);
                    currentTab = activeTab.id;
                    injectTriggerAutoPiP(targetTab, () => { });
                  }
                });
              }
            }
          });
        } else {
          clearAutoPipOnAllTabs();
        }
      }
    }

    if (changes.autoPipSiteBlocklist) {
      const nextBlocklist = normalizeBlocklist(changes.autoPipSiteBlocklist.newValue) || [];
      autoPipSiteBlocklist = nextBlocklist;
      try { chrome.storage.local.set({ autoPipSiteBlocklist }); } catch (_) { }
      applyBlocklistToAllTabs();
    }

  }
});

// Helper function to safely execute scripts with error handling
function safeExecuteScript(tabId, files, callback, options = null) {
  const allowBlocked = options && options.allowBlocked === true;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      if (callback) callback(null);
      return;
    }

    if (isRestrictedUrl(tab.url)) {
      if (callback) callback(null);
      return;
    }

    const runInjection = () => {
      if (!allowBlocked && !isAutoPipAllowedUrl(tab.url)) {
        if (callback) callback(null);
        return;
      }

      const execute = (target, onDone) => {
        chrome.scripting.executeScript({
          target,
          files: files
        }, (results) => {
          if (chrome.runtime.lastError) {
            onDone(null, chrome.runtime.lastError);
            return;
          }
          onDone(results, null);
        });
      };

      execute({ tabId: tabId, allFrames: true }, (results, err) => {
        if (!err) {
          if (callback) callback(results);
          return;
        }

        execute({ tabId: tabId, frameIds: [0] }, (fallbackResults, fallbackErr) => {
          if (fallbackErr) {
            if (callback) callback(null);
            return;
          }
          if (callback) callback(fallbackResults);
        });
      });
    };

    if (!allowBlocked && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['autoPipSiteBlocklist'], (data) => {
        const localBlocklist = normalizeBlocklist(data && data.autoPipSiteBlocklist);
        if (localBlocklist) {
          autoPipSiteBlocklist = localBlocklist;
        }
        runInjection();
      });
      return;
    }
    runInjection();
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

    // Only setup auto-PiP for future tab switches if tab switching is enabled
    if (autoPipOnTabSwitch) {
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

    chrome.tabs.get(currentTab, (activeTab) => {
      if (chrome.runtime.lastError || !activeTab) return;
      currentTab = activeTab.id;

      if (!isAutoPipAllowedTab(activeTab)) {
        injectDisableAutoPiPScript(currentTab, () => { });
        if (targetTab === currentTab) {
          setTargetTab(null);
        }
        if (pipActiveTab === currentTab) {
          pipActiveTab = null;
        }
        return;
      }

      // Check for playing videos and set target if we don't have one
      if (targetTab === null && isAnyAutoPipEnabled()) {
        injectCheckVideoScript(currentTab, (results) => {
          const hasVideo = hasAnyFrameTrue(results);
          if (hasVideo) {
            setTargetTab(currentTab);
            if (autoPipOnTabSwitch) {
              injectTriggerAutoPiP(targetTab, (autoResults) => { });
            }
          }
          checkAndActivatePiP();
        });
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
            if (!autoPipOnTabSwitch) {
              injectClearAutoPiPScript(currentTab, () => { });
            }
            // After exiting, check for video and re-register handlers
            injectCheckVideoScript(currentTab, (results) => {
              const hasVideo = hasAnyFrameTrue(results);
              if (hasVideo) {
                setTargetTab(currentTab);
                if (autoPipOnTabSwitch) {
                  injectTriggerAutoPiP(targetTab, (autoResults) => { });
                }
              }
            });
          });

          prevTab = tab.tabId;
          return;
        }

        // Auto-PiP triggers automatically via MediaSession when leaving video tab
        if (targetTab != null && currentTab != targetTab && autoPipOnTabSwitch) {
          pipActiveTab = targetTab;
        }

        prevTab = tab.tabId;
      }
    });
  });

  // Handle tab updates to detect when new pages load
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    // Inject MediaSession setup early on active tabs while loading
    if (changeInfo.status === 'loading' && tab && tab.active && tab.url && !isRestrictedUrl(tab.url) && autoPipOnTabSwitch) {
      if (!isAutoPipAllowedTab(tab)) {
        injectDisableAutoPiPScript(tabId, () => { });
        return;
      }
      injectTriggerAutoPiP(tabId, (autoResults) => { });
    }

    // When page finishes loading, check for videos
    if (changeInfo.status === 'complete' && tab.url && !isRestrictedUrl(tab.url)) {
      if (!isAutoPipAllowedTab(tab)) {
        injectDisableAutoPiPScript(tabId, () => { });
        return;
      }
      if (tabId === currentTab && targetTab === null && isAnyAutoPipEnabled()) {
        setTimeout(() => {
          injectCheckVideoScript(tabId, (results) => {
            const hasVideo = hasAnyFrameTrue(results);
            if (hasVideo) {
              setTargetTab(tabId);
              if (autoPipOnTabSwitch) {
                injectTriggerAutoPiP(targetTab, (autoResults) => { });
              }
            }
          });
        }, 2000); // Wait 2 seconds for autoplay to start
      }
    }
  });

  // Listen for content-script notifications when a video starts playing
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message.type === 'auto_pip_blocklist_updated') {
        const nextBlocklist = normalizeBlocklist(message.blocklist) || [];
        autoPipSiteBlocklist = nextBlocklist;
        try { chrome.storage.local.set({ autoPipSiteBlocklist }); } catch (_) { }
        applyBlocklistToAllTabs();
        return;
      }
      if (!message || !sender || !sender.tab) return;
      if (message.type === 'auto_pip_video_playing') {
        const senderTabId = sender.tab.id;
        if (!isAutoPipAllowedTab(sender.tab)) {
          return;
        }
        if (isAnyAutoPipEnabled()) {
          if (senderTabId === currentTab || targetTab === null) {
            setTargetTab(senderTabId);
            if (autoPipOnTabSwitch) {
              injectTriggerAutoPiP(targetTab, (autoResults) => { });
            }
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
  });

  // Cleanup about:blank fallback when user activates another tab
  chrome.tabs.onActivated.addListener((activeInfo) => {
    if (blurFallbackWindowId == null || blurFallbackTempTabId == null) return;
    if (activeInfo.windowId !== blurFallbackWindowId) return;
    if (activeInfo.tabId === blurFallbackTempTabId) return;

    const tempTabId = blurFallbackTempTabId;
    removeTabWithRetry(tempTabId, 'onActivated');
    clearBlurFallback();
  });
}

// Track window focus changes for auto-PiP on window blur
if (typeof chrome !== 'undefined' && chrome.windows) {
  chrome.windows.getLastFocused({}, (window) => {
    if (!chrome.runtime.lastError && window) {
      lastFocusedWindowId = window.id;
    }
  });

  function handleWindowFocusChanged(windowId) {
    const previousWindowId = lastFocusedWindowId;
    lastFocusedWindowId = windowId;

    const isNone = chrome.windows.WINDOW_ID_NONE;
    if (previousWindowId === isNone && windowId === isNone) {
      return;
    }

    const returningFromNone = previousWindowId === isNone && windowId !== isNone;
    const movedToNone = windowId === isNone;
    const movedToWindow =
      previousWindowId != null &&
      previousWindowId !== isNone &&
      windowId !== isNone &&
      windowId !== previousWindowId;
    const shouldHandleAppSwitch = movedToNone && autoPipOnAppSwitch;
    const shouldHandleWindowSwitch = movedToWindow && autoPipOnWindowSwitch;
    const windowLostFocus = !returningFromNone && (shouldHandleAppSwitch || shouldHandleWindowSwitch);

    if (windowLostFocus) {
      chrome.tabs.query({ active: true, windowId: previousWindowId }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const activeTab = tabs[0];
        if (!isValidTab(activeTab)) return;
        if (!isAutoPipAllowedTab(activeTab)) {
          injectDisableAutoPiPScript(activeTab.id, () => { });
          if (targetTab === activeTab.id) {
            setTargetTab(null);
          }
          if (pipActiveTab === activeTab.id) {
            pipActiveTab = null;
          }
          return;
        }
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
          if (!autoPipOnTabSwitch) {
            injectClearAutoPiPScript(activeTab.id, () => { });
          }
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
            removeTabWithRetry(tempTabId, 'focusCleanup');
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
  }

  chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
}
