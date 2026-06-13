(function initDebug(root) {
  'use strict';

  const AutoPip = root.AutoPip;
  const { DEBUG_LOG_LIMIT, DEFAULT_ACTION_TITLE, BLOCKED_ACTION_TITLE, STORAGE_KEYS } = AutoPip.constants;
  const { getHostnameFromUrl } = AutoPip.urlRules;

  function debugLog(source, event, details = {}) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get([
        STORAGE_KEYS.autoPipDebugEnabled,
        STORAGE_KEYS.autoPipDebugLog,
        STORAGE_KEYS.autoPipDebugText
      ], (data) => {
        if (!data || data[STORAGE_KEYS.autoPipDebugEnabled] !== true) return;
        const log = Array.isArray(data && data[STORAGE_KEYS.autoPipDebugLog])
          ? data[STORAGE_KEYS.autoPipDebugLog]
          : [];
        const entry = {
          at: new Date().toISOString(),
          source,
          event,
          details
        };
        log.push(entry);
        const line = `AUTO_PIP_DEBUG ${entry.at} ${source} ${event} ${JSON.stringify(details)}`;
        const text = typeof data[STORAGE_KEYS.autoPipDebugText] === 'string'
          ? data[STORAGE_KEYS.autoPipDebugText]
          : '';
        const lines = text ? text.split('\n') : [];
        lines.push(line);
        chrome.storage.local.set({
          [STORAGE_KEYS.autoPipDebugLog]: log.slice(-DEBUG_LOG_LIMIT),
          [STORAGE_KEYS.autoPipDebugText]: lines.slice(-DEBUG_LOG_LIMIT).join('\n')
        });
      });
    } catch (_) { }
  }

  function getBlockerHost(details, tab) {
    if (details && details.hostname) return details.hostname;
    const url = details && details.url ? details.url : tab && tab.url;
    return getHostnameFromUrl(url);
  }

  function setNativeAutoPipBlocker(tab, details = {}) {
    if (!tab || tab.id == null || !chrome.action || !chrome.storage || !chrome.storage.local) return;

    const blocker = {
      at: new Date().toISOString(),
      tabId: tab.id,
      url: details.url || tab.url || null,
      hostname: getBlockerHost(details, tab),
      reason: details.reason || 'native_auto_pip_not_fired',
      likelyReason: details.likelyReason || 'site_auto_pip_permission_or_media_engagement',
      hasPlaying: details.hasPlaying === true,
      playbackState: details.playbackState || null,
      pictureInPictureEnabled: details.pictureInPictureEnabled === true,
      topFrame: details.topFrame === true,
      playingMutedCount: Number(details.playingMutedCount || 0),
      playingAudibleCandidateCount: Number(details.playingAudibleCandidateCount || 0),
      autoPipAttrCount: Number(details.autoPipAttrCount || 0),
      ownedAttrCount: Number(details.ownedAttrCount || 0),
      addedAutoPipAttrCount: Number(details.addedAutoPipAttrCount || 0)
    };

    try { chrome.storage.local.set({ [STORAGE_KEYS.autoPipLatestBlocker]: blocker }); } catch (_) { }

    try {
      chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#d97706' });
      chrome.action.setTitle({ tabId: tab.id, title: BLOCKED_ACTION_TITLE });
    } catch (_) { }

    debugLog('background', 'native_auto_pip_blocker_set', blocker);
  }

  function clearNativeAutoPipBlocker(tabId, reason = 'clear') {
    if (tabId == null || !chrome.action) return;
    try { chrome.action.setBadgeText({ tabId, text: '' }); } catch (_) { }
    try { chrome.action.setTitle({ tabId, title: DEFAULT_ACTION_TITLE }); } catch (_) { }

    try {
      chrome.storage.local.get([STORAGE_KEYS.autoPipLatestBlocker], (data) => {
        const blocker = data && data[STORAGE_KEYS.autoPipLatestBlocker];
        if (!blocker || blocker.tabId === tabId) {
          chrome.storage.local.remove([STORAGE_KEYS.autoPipLatestBlocker]);
        }
      });
    } catch (_) { }

    debugLog('background', 'native_auto_pip_blocker_cleared', { tabId, reason });
  }

  AutoPip.debug = {
    debugLog,
    setNativeAutoPipBlocker,
    clearNativeAutoPipBlocker
  };

  Object.assign(root, AutoPip.debug);
})(globalThis);
