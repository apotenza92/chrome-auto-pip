importScripts(
  './background/constants.js',
  './background/url-rules.js',
  './background/debug.js',
  './background/inject.js',
  './background/tab-switch.js',
  './background/settings.js',
  './background/messages.js'
);

(function initBackground() {
  'use strict';

  const AutoPip = globalThis.AutoPip;

  AutoPip.state.settingsReady = AutoPip.settings.loadSettings();
  AutoPip.messages.initRuntimeListeners();
  AutoPip.tabSwitch.initTabListeners();
})();
