(function initConstants(root) {
  'use strict';

  const AutoPip = root.AutoPip || {};
  root.AutoPip = AutoPip;

  AutoPip.constants = {
    DEFAULT_BLOCKED_SITES: [
      'meet.google.com',
      '*.zoom.us',
      'zoom.com',
      'teams.microsoft.com',
      'teams.live.com',
      '*.slack.com',
      '*.discord.com'
    ],
    DEBUG_LOG_LIMIT: 250,
    VIDEO_PLAYING_MESSAGE_THROTTLE_MS: 2000,
    DEFAULT_ACTION_TITLE: 'Picture-in-Picture',
    BLOCKED_ACTION_TITLE: 'Auto PiP blocked. Allow Automatic Picture-in-Picture for this site.',
    STORAGE_KEYS: {
      autoPipOnTabSwitch: 'autoPipOnTabSwitch',
      autoPipEnabled: 'autoPipEnabled',
      autoPipSiteBlocklist: 'autoPipSiteBlocklist',
      autoPipDebugEnabled: 'autoPipDebugEnabled',
      autoPipDebugLog: 'autoPipDebugLog',
      autoPipDebugText: 'autoPipDebugText',
      autoPipLatestBlocker: 'autoPipLatestBlocker'
    },
    MARKERS: {
      owned: 'data-auto-pip-managed',
      addedAutoPip: 'data-auto-pip-added-autopictureinpicture',
      compatRequested: 'data-auto-pip-compat-requested',
      pip: '__pip__'
    },
    PATHS: {
      native: 'native',
      manual: 'manual',
      tabLeaveCompat: 'tab_leave_compat',
      cleanup: 'cleanup',
      check: 'check'
    },
    INJECTION_POLICIES: {
      topFrameOnly: 'topFrameOnly',
      allFrames: 'allFrames',
      topFrameThenAllFrames: 'topFrameThenAllFrames'
    }
  };

  AutoPip.state = AutoPip.state || {
    currentTab: 0,
    prevTab: null,
    targetTab: null,
    pipActiveTab: null,
    autoPipOnTabSwitch: true,
    autoPipSiteBlocklist: AutoPip.constants.DEFAULT_BLOCKED_SITES.slice(),
    settingsLoaded: false,
    settingsReady: null,
    lastVideoPlayingTargetedAtByTab: {}
  };

  const defineStateAlias = (name) => {
    try {
      if (Object.prototype.hasOwnProperty.call(root, name)) return;
      Object.defineProperty(root, name, {
        configurable: true,
        get() {
          return AutoPip.state[name];
        },
        set(value) {
          AutoPip.state[name] = value;
        }
      });
    } catch (_) { }
  };

  [
    'currentTab',
    'prevTab',
    'targetTab',
    'pipActiveTab',
    'autoPipOnTabSwitch',
    'autoPipSiteBlocklist',
    'settingsLoaded',
    'settingsReady',
    'lastVideoPlayingTargetedAtByTab'
  ].forEach(defineStateAlias);
})(globalThis);
