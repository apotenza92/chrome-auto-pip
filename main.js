var currentTab = 0;
var prevTab = null;
var targetTab = null;
var pipActiveTab = null;
var autoPipOnTabSwitch = true;

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
var settingsLoaded = false;
var settingsReady = null;

function isRestrictedUrl(url) {
  if (!url) return true;
  const restrictedProtocols = [
    'chrome:',
    'chrome-extension:',
    'chrome-search:',
    'chrome-devtools:',
    'moz-extension:',
    'edge:',
    'about:'
  ];
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

function isValidTab(tab) {
  return !!(tab && tab.url && !isRestrictedUrl(tab.url));
}

function hasAnyFrameTrue(results) {
  return Array.isArray(results) && results.some(frameResult => frameResult && frameResult.result);
}

function setTargetTab(tabId) {
  targetTab = tabId == null ? null : tabId;
}

function getAutoPiPContentSettingApi() {
  return chrome && chrome.contentSettings && chrome.contentSettings.autoPictureInPicture
    ? chrome.contentSettings.autoPictureInPicture
    : null;
}

function getPrimaryPatternForUrl(url) {
  if (!url || isRestrictedUrl(url)) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch (_) {
    return null;
  }
}

function ensureAutoPiPAllowedForTab(tabId, callback) {
  const done = typeof callback === 'function' ? callback : () => { };
  const api = getAutoPiPContentSettingApi();
  if (!api) {
    done({ ok: false, reason: 'contentSettingsUnavailable' });
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) {
      done({ ok: false, reason: 'tabUnavailable' });
      return;
    }

    const primaryPattern = getPrimaryPatternForUrl(tab.url);
    if (!primaryPattern) {
      done({ ok: false, reason: 'invalidPattern', url: tab.url });
      return;
    }

    api.set({ primaryPattern, setting: 'allow', scope: 'regular' }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        done({ ok: false, reason: error.message, primaryPattern });
        return;
      }
      done({ ok: true, primaryPattern });
    });
  });
}

function safeExecuteScript(tabId, files, callback, options = null) {
  const allowBlocked = options && options.allowBlocked === true;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
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
        chrome.scripting.executeScript({ target, files }, (results) => {
          if (chrome.runtime.lastError) {
            onDone(null, chrome.runtime.lastError);
            return;
          }
          onDone(results, null);
        });
      };

      execute({ tabId, allFrames: true }, (results, err) => {
        if (!err) {
          if (callback) callback(results);
          return;
        }

        execute({ tabId, frameIds: [0] }, (fallbackResults, fallbackErr) => {
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

function injectWithUtils(tabId, scripts, callback) {
  safeExecuteScript(tabId, ['./scripts/utils.js', './scripts/site-fixes.js', ...scripts], callback);
}

function injectTriggerAutoPiP(tabId, callback) {
  ensureAutoPiPAllowedForTab(tabId, () => {
    injectWithUtils(tabId, ['./scripts/trigger-auto-pip.js'], callback);
  });
}

function injectCheckVideoScript(tabId, callback) {
  injectWithUtils(tabId, ['./scripts/check-video.js'], callback);
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

function registerTabForAutoPip(tabId, callback) {
  if (tabId == null || !autoPipOnTabSwitch) {
    if (callback) callback(null);
    return;
  }
  injectTriggerAutoPiP(tabId, callback);
}

function registerAutoPipOnAllTabs() {
  if (!autoPipOnTabSwitch) return;
  chrome.tabs.query({}, (tabs) => {
    if (!tabs) return;
    tabs.forEach(tab => {
      if (!isValidTab(tab)) return;
      if (!isAutoPipAllowedTab(tab)) return;
      registerTabForAutoPip(tab.id, () => { });
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
        if (targetTab === tab.id) setTargetTab(null);
        if (pipActiveTab === tab.id) pipActiveTab = null;
        return;
      }
      if (autoPipOnTabSwitch) {
        registerTabForAutoPip(tab.id, () => { });
      }
    });
  });
}

async function migrateAutoPipSettings(syncData) {
  const hasOldSetting = typeof syncData.autoPipEnabled === 'boolean';
  const hasTabSwitchSetting = typeof syncData.autoPipOnTabSwitch === 'boolean';

  if (hasOldSetting && !hasTabSwitchSetting) {
    const migrated = { autoPipOnTabSwitch: syncData.autoPipEnabled };
    try { await chrome.storage.sync.set(migrated); } catch (_) { }
    try { await chrome.storage.local.set(migrated); } catch (_) { }
    return migrated;
  }

  return null;
}

async function loadSettings() {
  try {
    try {
      const local = await chrome.storage.local.get([
        'autoPipOnTabSwitch',
        'autoPipEnabled',
        'autoPipSiteBlocklist'
      ]);

      const localBlocklist = normalizeBlocklist(local.autoPipSiteBlocklist);
      if (localBlocklist) {
        autoPipSiteBlocklist = localBlocklist;
      }

      if (typeof local.autoPipOnTabSwitch === 'boolean') {
        autoPipOnTabSwitch = local.autoPipOnTabSwitch;
      } else if (typeof local.autoPipEnabled === 'boolean') {
        autoPipOnTabSwitch = local.autoPipEnabled;
      }
    } catch (_) { }

    const result = await chrome.storage.sync.get([
      'autoPipOnTabSwitch',
      'autoPipEnabled',
      'autoPipSiteBlocklist'
    ]);

    const migrated = await migrateAutoPipSettings(result);
    const effective = migrated || result;

    autoPipOnTabSwitch = typeof effective.autoPipOnTabSwitch === 'boolean'
      ? effective.autoPipOnTabSwitch
      : true;

    const syncBlocklist = normalizeBlocklist(effective.autoPipSiteBlocklist);
    const localBlocklist = normalizeBlocklist(autoPipSiteBlocklist);
    const effectiveBlocklist = syncBlocklist || localBlocklist || DEFAULT_BLOCKED_SITES.slice();
    autoPipSiteBlocklist = effectiveBlocklist;

    if (!syncBlocklist) {
      try { await chrome.storage.sync.set({ autoPipSiteBlocklist: effectiveBlocklist }); } catch (_) { }
    }

    try {
      await chrome.storage.local.set({
        autoPipOnTabSwitch,
        autoPipSiteBlocklist
      });
    } catch (_) { }
  } catch (_) {
    autoPipOnTabSwitch = true;
    autoPipSiteBlocklist = DEFAULT_BLOCKED_SITES.slice();
    try {
      await chrome.storage.local.set({
        autoPipOnTabSwitch,
        autoPipSiteBlocklist
      });
    } catch (_) { }
  } finally {
    settingsLoaded = true;
    applyBlocklistToAllTabs();
  }
}

settingsReady = loadSettings();

if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    loadSettings();
    setTimeout(() => {
      registerAutoPipOnAllTabs();
    }, 300);
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      await chrome.storage.sync.set({
        autoPipOnTabSwitch: true,
        autoPipSiteBlocklist: DEFAULT_BLOCKED_SITES.slice()
      });
      autoPipOnTabSwitch = true;
      autoPipSiteBlocklist = DEFAULT_BLOCKED_SITES.slice();
    } catch (_) { }
    return;
  }

  if (details.reason === 'update') {
    try {
      await chrome.storage.sync.remove([
        'pipSize',
        'pipSizeCustom',
        'displayInfo'
      ]);
    } catch (_) { }
    try {
      await chrome.storage.local.remove([
        'pipSize',
        'pipSizeCustom',
        'displayInfo'
      ]);
    } catch (_) { }
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'sync') return;

  if (changes.autoPipOnTabSwitch || changes.autoPipEnabled) {
    const nextValue = changes.autoPipOnTabSwitch
      ? changes.autoPipOnTabSwitch.newValue !== false
      : changes.autoPipEnabled.newValue !== false;

    autoPipOnTabSwitch = nextValue;
    try { chrome.storage.local.set({ autoPipOnTabSwitch }); } catch (_) { }

    if (autoPipOnTabSwitch) {
      registerAutoPipOnAllTabs();
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs && tabs.length > 0 ? tabs[0] : null;
        if (!isValidTab(activeTab) || !isAutoPipAllowedTab(activeTab)) return;
        injectCheckVideoScript(activeTab.id, (results) => {
          if (!hasAnyFrameTrue(results)) return;
          setTargetTab(activeTab.id);
          currentTab = activeTab.id;
          registerTabForAutoPip(activeTab.id, () => { });
        });
      });
    } else {
      clearAutoPipOnAllTabs();
      setTargetTab(null);
      pipActiveTab = null;
    }
  }

  if (changes.autoPipSiteBlocklist) {
    const nextBlocklist = normalizeBlocklist(changes.autoPipSiteBlocklist.newValue) || [];
    autoPipSiteBlocklist = nextBlocklist;
    try { chrome.storage.local.set({ autoPipSiteBlocklist }); } catch (_) { }
    applyBlocklistToAllTabs();
  }
});

if (typeof chrome !== 'undefined' && chrome.action) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || isRestrictedUrl(tab.url)) return;

    if (pipActiveTab && pipActiveTab !== tab.id) {
      injectExitPiPScript(pipActiveTab, () => {
        pipActiveTab = null;
      });
      return;
    }

    injectImmediatePiPScript(tab.id, (pipResults) => {
      const frameValues = Array.isArray(pipResults)
        ? pipResults.map(r => r && r.result)
        : [];

      const toggledOff = frameValues.includes('toggled_off');
      const activated = frameValues.includes(true);

      if (toggledOff) {
        pipActiveTab = null;
      } else if (activated) {
        pipActiveTab = tab.id;
      }
    });

    if (autoPipOnTabSwitch) {
      registerTabForAutoPip(tab.id, (results) => {
        if (hasAnyFrameTrue(results)) {
          setTargetTab(tab.id);
        }
      });
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onActivated.addListener((tab) => {
    currentTab = tab.tabId;

    chrome.tabs.get(currentTab, (activeTab) => {
      if (chrome.runtime.lastError || !activeTab) return;
      currentTab = activeTab.id;

      if (!isAutoPipAllowedTab(activeTab)) {
        injectDisableAutoPiPScript(currentTab, () => { });
        if (targetTab === currentTab) setTargetTab(null);
        if (pipActiveTab === currentTab) pipActiveTab = null;
        return;
      }

      const checkAndActivatePiP = () => {
        if (currentTab === targetTab) {
          if (pipActiveTab === targetTab) {
            pipActiveTab = null;
          }

          injectExitPiPScript(currentTab, () => {
            if (!autoPipOnTabSwitch) {
              injectClearAutoPiPScript(currentTab, () => { });
            }
            injectCheckVideoScript(currentTab, (results) => {
              if (!hasAnyFrameTrue(results)) return;
              setTargetTab(currentTab);
              registerTabForAutoPip(currentTab, () => { });
            });
          });

          prevTab = tab.tabId;
          return;
        }

        if (targetTab != null && currentTab !== targetTab && autoPipOnTabSwitch) {
          pipActiveTab = targetTab;
        }

        prevTab = tab.tabId;
      };

      if (targetTab === null && autoPipOnTabSwitch) {
        injectCheckVideoScript(currentTab, (results) => {
          if (hasAnyFrameTrue(results)) {
            setTargetTab(currentTab);
            registerTabForAutoPip(currentTab, () => { });
          }
          checkAndActivatePiP();
        });
      } else {
        checkAndActivatePiP();
      }
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab || !tab.url || isRestrictedUrl(tab.url)) return;

    if (!isAutoPipAllowedTab(tab)) {
      injectDisableAutoPiPScript(tabId, () => { });
      return;
    }

    if (changeInfo.status === 'loading' && tab.active && autoPipOnTabSwitch) {
      registerTabForAutoPip(tabId, () => { });
      return;
    }

    if (changeInfo.status === 'complete' && tab.active && autoPipOnTabSwitch) {
      setTimeout(() => {
        injectCheckVideoScript(tabId, (results) => {
          if (!hasAnyFrameTrue(results)) return;
          setTargetTab(tabId);
          registerTabForAutoPip(tabId, () => { });
        });
      }, 500);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message && message.type === 'auto_pip_set_switch_modes') {
        const nextSettings = {
          autoPipOnTabSwitch: message.autoPipOnTabSwitch !== false
        };
        autoPipOnTabSwitch = nextSettings.autoPipOnTabSwitch;
        Promise.allSettled([
          chrome.storage.sync.set(nextSettings),
          chrome.storage.local.set(nextSettings)
        ]).then(() => {
          sendResponse({ ok: true, settings: nextSettings });
        });
        return true;
      }

      if (message && message.type === 'auto_pip_prime_active_tab') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const candidateTab = tabs && tabs.length > 0 ? tabs[0] : null;
          if (!isValidTab(candidateTab) || !isAutoPipAllowedTab(candidateTab)) {
            sendResponse({ ok: false, reason: 'invalid_active_tab' });
            return;
          }

          injectCheckVideoScript(candidateTab.id, (results) => {
            if (!hasAnyFrameTrue(results)) {
              sendResponse({ ok: false, reason: 'no_video_tab_candidate' });
              return;
            }

            setTargetTab(candidateTab.id);
            registerTabForAutoPip(candidateTab.id, () => {
              sendResponse({ ok: true, tabId: candidateTab.id, targetTab });
            });
          });
        });
        return true;
      }

      if (message && message.type === 'auto_pip_blocklist_updated') {
        const nextBlocklist = normalizeBlocklist(message.blocklist) || [];
        autoPipSiteBlocklist = nextBlocklist;
        try { chrome.storage.local.set({ autoPipSiteBlocklist }); } catch (_) { }
        applyBlocklistToAllTabs();
        return;
      }

      if (message && message.type === 'auto_pip_pip_state_changed' && sender && sender.tab) {
        const senderTabId = sender.tab.id;
        if (message.inPictureInPicture === true) {
          pipActiveTab = senderTabId;
        } else if (pipActiveTab === senderTabId) {
          pipActiveTab = null;
        }
        sendResponse({ ok: true });
        return true;
      }

      if (!message || !sender || !sender.tab) return;
      if (message.type === 'auto_pip_video_playing') {
        const senderTabId = sender.tab.id;
        if (!isAutoPipAllowedTab(sender.tab) || !autoPipOnTabSwitch) return;
        if (senderTabId === currentTab || targetTab === null) {
          setTargetTab(senderTabId);
          registerTabForAutoPip(senderTabId, () => { });
        }
      }
    } catch (_) {
      // Ignore transient extension lifecycle errors.
    }
  });
}
