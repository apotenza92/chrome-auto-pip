(function initMessages(root) {
  'use strict';

  const AutoPip = root.AutoPip;
  const { DEFAULT_BLOCKED_SITES } = AutoPip.constants;
  const { debugLog, setNativeAutoPipBlocker, clearNativeAutoPipBlocker } = AutoPip.debug;
  const { normalizeBlocklist, isValidTab, isAutoPipAllowedTab } = AutoPip.urlRules;
  const { injectCheckVideoScript, registerTabForAutoPip, hasAnyFrameTrue } = AutoPip.inject;

  function handleRuntimeInstalled(details) {
    debugLog('background', 'runtime_installed', { reason: details && details.reason });
    if (details.reason === 'install') {
      (async () => {
        try {
          await chrome.storage.sync.clear();
          await chrome.storage.local.clear();
          await chrome.storage.sync.set({
            autoPipOnTabSwitch: true,
            autoPipSiteBlocklist: DEFAULT_BLOCKED_SITES.slice()
          });
          AutoPip.state.autoPipOnTabSwitch = true;
          AutoPip.state.autoPipSiteBlocklist = DEFAULT_BLOCKED_SITES.slice();
        } catch (_) { }
      })();
      return;
    }

    if (details.reason === 'update') {
      (async () => {
        try {
          await chrome.storage.sync.remove([
            'pipSize',
            'pipSizeCustom',
            'displayInfo',
            'autoPipOnWindowSwitch',
            'autoPipOnAppSwitch'
          ]);
        } catch (_) { }
        try {
          await chrome.storage.local.remove([
            'pipSize',
            'pipSizeCustom',
            'displayInfo',
            'autoPipOnWindowSwitch',
            'autoPipOnAppSwitch'
          ]);
        } catch (_) { }
      })();
    }
  }

  function handleDebugMessage(message, sender, sendResponse) {
    const event = message.event || 'unknown';
    const details = message.details || {};
    debugLog(message.source || 'content', event, {
      tabId: sender && sender.tab ? sender.tab.id : null,
      url: sender && sender.tab ? sender.tab.url : null,
      ...details
    });

    if (sender && sender.tab) {
      if (event === 'page_pip_state_changed') {
        const senderTabId = sender.tab.id;
        if (details.inPictureInPicture === true) {
          AutoPip.state.pipActiveTab = senderTabId;
          clearNativeAutoPipBlocker(senderTabId, 'page_pip_entered');
        } else if (AutoPip.state.pipActiveTab === senderTabId) {
          AutoPip.state.pipActiveTab = null;
        }
      } else if (event === 'page_native_auto_pip_not_fired') {
        setNativeAutoPipBlocker(sender.tab, details);
      } else if (
        event === 'page_native_auto_pip_clear' ||
        event === 'page_enterpictureinpicture_success' ||
        event === 'page_enterpictureinpicture_already_active' ||
        event === 'enterpictureinpicture_handler_success' ||
        (event === 'page_registration_updated' && details.hasPlaying === false)
      ) {
        clearNativeAutoPipBlocker(sender.tab.id, event);
      }

      if (
        (event === 'page_registration_updated' || event === 'registration_updated') &&
        details.hasPlaying === true
      ) {
        AutoPip.tabSwitch.handleVideoPlayingMessage(sender.tab);
      }
    }

    sendResponse({ ok: true });
    return true;
  }

  function handleMessage(message, sender, sendResponse) {
    try {
      if (message && message.type === 'auto_pip_set_switch_modes') {
        const nextSettings = {
          autoPipOnTabSwitch: message.autoPipOnTabSwitch !== false
        };
        AutoPip.settings.applyAutoPipOnTabSwitchSetting(nextSettings.autoPipOnTabSwitch);
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

            AutoPip.tabSwitch.setTargetTab(candidateTab.id);
            registerTabForAutoPip(candidateTab.id, () => {
              sendResponse({ ok: true, tabId: candidateTab.id, targetTab: AutoPip.state.targetTab });
            });
          });
        });
        return true;
      }

      if (message && message.type === 'auto_pip_blocklist_updated') {
        const nextBlocklist = normalizeBlocklist(message.blocklist) || [];
        AutoPip.state.autoPipSiteBlocklist = nextBlocklist;
        try { chrome.storage.local.set({ autoPipSiteBlocklist: AutoPip.state.autoPipSiteBlocklist }); } catch (_) { }
        AutoPip.tabSwitch.applyBlocklistToOpenTabs();
        return;
      }

      if (message && message.type === 'auto_pip_pip_state_changed' && sender && sender.tab) {
        const senderTabId = sender.tab.id;
        if (message.inPictureInPicture === true) {
          AutoPip.state.pipActiveTab = senderTabId;
          clearNativeAutoPipBlocker(senderTabId, 'pip_entered');
        } else if (AutoPip.state.pipActiveTab === senderTabId) {
          AutoPip.state.pipActiveTab = null;
        }
        debugLog('background', 'pip_state_changed', {
          tabId: senderTabId,
          inPictureInPicture: message.inPictureInPicture === true
        });
        sendResponse({ ok: true });
        return true;
      }

      if (message && message.type === 'auto_pip_debug_log') {
        return handleDebugMessage(message, sender, sendResponse);
      }

      if (!message || !sender || !sender.tab) return;
      if (message.type === 'auto_pip_video_playing') {
        AutoPip.tabSwitch.handleVideoPlayingMessage(sender.tab);
      }
    } catch (_) {
      // Ignore transient extension lifecycle errors.
    }
  }

  function initRuntimeListeners() {
    if (chrome.runtime && chrome.runtime.onStartup) {
      chrome.runtime.onStartup.addListener(() => {
        debugLog('background', 'runtime_startup');
        AutoPip.state.settingsReady = AutoPip.settings.loadSettings();
      });
    }

    chrome.runtime.onInstalled.addListener(handleRuntimeInstalled);
    chrome.storage.onChanged.addListener(AutoPip.settings.handleStorageChanged);
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  AutoPip.messages = {
    handleRuntimeInstalled,
    handleMessage,
    initRuntimeListeners
  };
})(globalThis);
