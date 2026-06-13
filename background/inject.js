(function initInject(root) {
  'use strict';

  const AutoPip = root.AutoPip;
  const { INJECTION_POLICIES } = AutoPip.constants;
  const { debugLog } = AutoPip.debug;
  const {
    isRestrictedUrl,
    isValidTab,
    isAutoPipAllowedUrl,
    normalizeBlocklist
  } = AutoPip.urlRules;

  function getFrameResultValues(results) {
    return Array.isArray(results)
      ? results.map(frameResult => frameResult && frameResult.result)
      : [];
  }

  function isPositiveResult(result) {
    if (!result) return false;
    if (result === true || result === 'already_active' || result === 'toggled_off') return true;
    if (typeof result !== 'object') return false;
    if (result.ok === false) return false;
    if (result.exited === true) return true;
    if (result.ok === true) return true;
    return false;
  }

  function hasAnyFrameTrue(results) {
    return getFrameResultValues(results).some(isPositiveResult);
  }

  function hasExitedPiP(results) {
    return getFrameResultValues(results).some(result =>
      result === 'exited' ||
      !!(result && typeof result === 'object' && result.exited === true)
    );
  }

  function getFirstObjectResult(results) {
    const values = getFrameResultValues(results).filter(result => result && typeof result === 'object');
    return values.find(result => result.ok === true) || values[0] || null;
  }

  function normalizePolicy(options) {
    if (options && options.policy) return options.policy;
    if (options && options.allFrames === false) return INJECTION_POLICIES.topFrameOnly;
    if (options && options.allFrames === true) return INJECTION_POLICIES.allFrames;
    return INJECTION_POLICIES.allFrames;
  }

  function executeScriptTarget(tabId, files, target, options, callback) {
    const injection = { target, files };
    if (options && options.world) injection.world = options.world;
    chrome.scripting.executeScript(injection, (results) => {
      if (chrome.runtime.lastError) {
        callback(null, chrome.runtime.lastError);
        return;
      }
      callback(results, null);
    });
  }

  function runWithPolicy(tabId, files, options, callback) {
    const policy = normalizePolicy(options);
    const topFrameTarget = { tabId, frameIds: [0] };
    const allFramesTarget = { tabId, allFrames: true };

    if (policy === INJECTION_POLICIES.topFrameOnly) {
      executeScriptTarget(tabId, files, topFrameTarget, options, (results, err) => {
        if (!err) return callback(results);
        executeScriptTarget(tabId, files, topFrameTarget, options, (fallbackResults, fallbackErr) => {
          callback(fallbackErr ? null : fallbackResults);
        });
      });
      return;
    }

    if (policy === INJECTION_POLICIES.topFrameThenAllFrames) {
      executeScriptTarget(tabId, files, topFrameTarget, options, (results, err) => {
        if (!err && hasAnyFrameTrue(results)) {
          callback(results);
          return;
        }
        executeScriptTarget(tabId, files, allFramesTarget, options, (allResults, allErr) => {
          callback(allErr ? results : allResults);
        });
      });
      return;
    }

    executeScriptTarget(tabId, files, allFramesTarget, options, (results, err) => {
      if (!err) {
        callback(results);
        return;
      }
      executeScriptTarget(tabId, files, topFrameTarget, options, (fallbackResults, fallbackErr) => {
        callback(fallbackErr ? null : fallbackResults);
      });
    });
  }

  function safeExecuteScript(tabId, files, callback, options = null) {
    const allowBlocked = options && options.allowBlocked === true;
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || isRestrictedUrl(tab.url)) {
        if (callback) callback(null);
        return;
      }

      const runInjection = () => {
        if (!allowBlocked && !isAutoPipAllowedUrl(tab.url)) {
          if (callback) callback(null);
          return;
        }
        runWithPolicy(tabId, files, options || {}, (results) => {
          if (callback) callback(results);
        });
      };

      if (!allowBlocked && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['autoPipSiteBlocklist'], (data) => {
          const localBlocklist = normalizeBlocklist(data && data.autoPipSiteBlocklist);
          if (localBlocklist) AutoPip.state.autoPipSiteBlocklist = localBlocklist;
          runInjection();
        });
        return;
      }

      runInjection();
    });
  }

  function injectWithLib(tabId, scripts, callback, options = null) {
    safeExecuteScript(tabId, [
      './scripts/lib/video.js',
      './scripts/lib/pip.js',
      ...scripts
    ], callback, options);
  }

  function injectWithSettings(tabId, scripts, callback, options = null) {
    safeExecuteScript(tabId, [
      './scripts/lib/settings.js',
      ...scripts
    ], callback, options);
  }

  function injectPageAutoPiPScript(tabId, callback) {
    safeExecuteScript(tabId, ['./scripts/page-auto-pip.js'], callback, {
      policy: INJECTION_POLICIES.topFrameOnly,
      world: 'MAIN'
    });
  }

  function injectTriggerAutoPiP(tabId, callback) {
    injectWithSettings(tabId, ['./scripts/trigger-auto-pip.js'], (results) => {
      if (!hasAnyFrameTrue(results)) {
        if (callback) callback(results);
        return;
      }
      injectPageAutoPiPScript(tabId, () => {
        if (callback) callback(results);
      });
    }, { policy: INJECTION_POLICIES.topFrameOnly });
  }

  function injectCheckVideoScript(tabId, callback) {
    injectWithLib(tabId, ['./scripts/check-video.js'], callback, {
      policy: INJECTION_POLICIES.topFrameOnly
    });
  }

  function injectExitPiPScript(tabId, callback) {
    injectWithLib(tabId, ['./scripts/exit-pip.js'], callback, {
      allowBlocked: true,
      policy: INJECTION_POLICIES.topFrameOnly,
      world: 'MAIN'
    });
  }

  function injectImmediatePiPScript(tabId, callback) {
    injectWithLib(tabId, ['./scripts/immediate-pip.js'], callback, {
      allowBlocked: true,
      policy: INJECTION_POLICIES.allFrames
    });
  }

  function injectRequestPlayingPiPScript(tabId, callback) {
    injectWithLib(tabId, ['./scripts/request-playing-pip.js'], callback, {
      policy: INJECTION_POLICIES.topFrameThenAllFrames
    });
  }

  function injectDisableAutoPiPScript(tabId, callback) {
    injectWithLib(tabId, ['./scripts/disable-auto-pip.js'], callback, {
      allowBlocked: true,
      policy: INJECTION_POLICIES.allFrames
    });
  }

  function injectDisableAndExitAutoPiPScript(tabId, callback) {
    injectExitPiPScript(tabId, () => {
      injectDisableAutoPiPScript(tabId, callback);
    });
  }

  function registerTabForAutoPip(tabId, callback) {
    if (tabId == null || !AutoPip.state.autoPipOnTabSwitch) {
      debugLog('background', 'register_skip', { tabId, autoPipOnTabSwitch: AutoPip.state.autoPipOnTabSwitch });
      if (callback) callback(null);
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !isValidTab(tab) || !AutoPip.urlRules.isAutoPipAllowedTab(tab)) {
        debugLog('background', 'register_skip_invalid', { tabId });
        if (callback) callback(null);
        return;
      }

      debugLog('background', 'register_tab', { tabId, url: tab.url });
      injectTriggerAutoPiP(tabId, callback);
    });
  }

  AutoPip.inject = {
    safeExecuteScript,
    injectWithLib,
    injectWithSettings,
    injectPageAutoPiPScript,
    injectTriggerAutoPiP,
    injectCheckVideoScript,
    injectExitPiPScript,
    injectImmediatePiPScript,
    injectRequestPlayingPiPScript,
    injectDisableAutoPiPScript,
    injectDisableAndExitAutoPiPScript,
    registerTabForAutoPip,
    getFrameResultValues,
    getFirstObjectResult,
    hasAnyFrameTrue,
    hasExitedPiP
  };

  Object.assign(root, AutoPip.inject);
})(globalThis);
