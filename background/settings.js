(function initSettings(root) {
  'use strict';

  const AutoPip = root.AutoPip;
  const { DEFAULT_BLOCKED_SITES, STORAGE_KEYS } = AutoPip.constants;
  const { normalizeBlocklist } = AutoPip.urlRules;
  const { debugLog } = AutoPip.debug;

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
    const state = AutoPip.state;
    try {
      try {
        const local = await chrome.storage.local.get([
          STORAGE_KEYS.autoPipOnTabSwitch,
          STORAGE_KEYS.autoPipEnabled,
          STORAGE_KEYS.autoPipSiteBlocklist
        ]);

        const localBlocklist = normalizeBlocklist(local.autoPipSiteBlocklist);
        if (localBlocklist) state.autoPipSiteBlocklist = localBlocklist;

        if (typeof local.autoPipOnTabSwitch === 'boolean') {
          state.autoPipOnTabSwitch = local.autoPipOnTabSwitch;
        } else if (typeof local.autoPipEnabled === 'boolean') {
          state.autoPipOnTabSwitch = local.autoPipEnabled;
        }
      } catch (_) { }

      const result = await chrome.storage.sync.get([
        STORAGE_KEYS.autoPipOnTabSwitch,
        STORAGE_KEYS.autoPipEnabled,
        STORAGE_KEYS.autoPipSiteBlocklist
      ]);

      const migrated = await migrateAutoPipSettings(result);
      const effective = migrated || result;

      state.autoPipOnTabSwitch = typeof effective.autoPipOnTabSwitch === 'boolean'
        ? effective.autoPipOnTabSwitch
        : true;

      const syncBlocklist = normalizeBlocklist(effective.autoPipSiteBlocklist);
      const localBlocklist = normalizeBlocklist(state.autoPipSiteBlocklist);
      const effectiveBlocklist = syncBlocklist || localBlocklist || DEFAULT_BLOCKED_SITES.slice();
      state.autoPipSiteBlocklist = effectiveBlocklist;

      if (!syncBlocklist) {
        try { await chrome.storage.sync.set({ autoPipSiteBlocklist: effectiveBlocklist }); } catch (_) { }
      }

      try {
        await chrome.storage.local.set({
          autoPipOnTabSwitch: state.autoPipOnTabSwitch,
          autoPipSiteBlocklist: state.autoPipSiteBlocklist
        });
      } catch (_) { }
    } catch (_) {
      state.autoPipOnTabSwitch = true;
      state.autoPipSiteBlocklist = DEFAULT_BLOCKED_SITES.slice();
      try {
        await chrome.storage.local.set({
          autoPipOnTabSwitch: state.autoPipOnTabSwitch,
          autoPipSiteBlocklist: state.autoPipSiteBlocklist
        });
      } catch (_) { }
    } finally {
      state.settingsLoaded = true;
      debugLog('background', 'settings_loaded', {
        autoPipOnTabSwitch: state.autoPipOnTabSwitch,
        blocklistCount: Array.isArray(state.autoPipSiteBlocklist) ? state.autoPipSiteBlocklist.length : 0
      });
      if (AutoPip.tabSwitch && AutoPip.tabSwitch.applyBlocklistToOpenTabs) {
        AutoPip.tabSwitch.applyBlocklistToOpenTabs();
      }
    }
  }

  function applyAutoPipOnTabSwitchSetting(nextValue, options = {}) {
    if (typeof nextValue !== 'boolean') return;

    const state = AutoPip.state;
    const changed = state.autoPipOnTabSwitch !== nextValue;
    state.autoPipOnTabSwitch = nextValue;
    debugLog('background', 'setting_changed', {
      autoPipOnTabSwitch: state.autoPipOnTabSwitch,
      changed,
      mirrorLocal: options.mirrorLocal === true
    });

    if (options.mirrorLocal === true) {
      try { chrome.storage.local.set({ autoPipOnTabSwitch: state.autoPipOnTabSwitch }); } catch (_) { }
    }

    if (state.autoPipOnTabSwitch) {
      if (changed) {
        AutoPip.tabSwitch.registerAllowedTabs();
      } else {
        AutoPip.tabSwitch.primeActiveTabForAutoPip();
      }
      return;
    }

    AutoPip.tabSwitch.cleanupAutoPipOnAllTabs();
    AutoPip.tabSwitch.setTargetTab(null);
    state.pipActiveTab = null;
    try { chrome.storage.local.remove([STORAGE_KEYS.autoPipLatestBlocker]); } catch (_) { }
    if (changed) state.prevTab = null;
  }

  function handleStorageChanged(changes, namespace) {
    if (namespace !== 'sync' && namespace !== 'local') return;
    const changedKeys = Object.keys(changes || {}).filter(key =>
      key !== STORAGE_KEYS.autoPipDebugLog &&
      key !== STORAGE_KEYS.autoPipDebugText &&
      key !== STORAGE_KEYS.autoPipDebugEnabled &&
      key !== STORAGE_KEYS.autoPipLatestBlocker
    );
    if (changedKeys.length === 0) return;
    debugLog('background', 'storage_changed', { namespace, keys: changedKeys });

    if (changes.autoPipOnTabSwitch || changes.autoPipEnabled) {
      const nextValue = changes.autoPipOnTabSwitch && typeof changes.autoPipOnTabSwitch.newValue === 'boolean'
        ? changes.autoPipOnTabSwitch.newValue
        : changes.autoPipEnabled && typeof changes.autoPipEnabled.newValue === 'boolean'
          ? changes.autoPipEnabled.newValue
          : null;

      applyAutoPipOnTabSwitchSetting(nextValue, {
        mirrorLocal: namespace === 'sync'
      });
    }

    if (changes.autoPipSiteBlocklist) {
      const nextBlocklist = normalizeBlocklist(changes.autoPipSiteBlocklist.newValue) || [];
      AutoPip.state.autoPipSiteBlocklist = nextBlocklist;
      if (namespace === 'sync') {
        try { chrome.storage.local.set({ autoPipSiteBlocklist: AutoPip.state.autoPipSiteBlocklist }); } catch (_) { }
      }
      AutoPip.tabSwitch.applyBlocklistToOpenTabs();
    }
  }

  AutoPip.settings = {
    migrateAutoPipSettings,
    loadSettings,
    applyAutoPipOnTabSwitchSetting,
    handleStorageChanged
  };

  root.loadSettings = loadSettings;
  root.migrateAutoPipSettings = migrateAutoPipSettings;
  root.applyAutoPipOnTabSwitchSetting = applyAutoPipOnTabSwitchSetting;
})(globalThis);
