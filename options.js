// Options page JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    const autoPipOnTabSwitchToggle = document.getElementById('autoPipOnTabSwitch');
    const autoPipOnWindowSwitchToggle = document.getElementById('autoPipOnWindowSwitch');
    const autoPipOnAppSwitchToggle = document.getElementById('autoPipOnAppSwitch');
    const currentSiteSelect = document.getElementById('currentSiteSelect');
    const addCurrentSiteButton = document.getElementById('addCurrentSite');
    const manualSiteInput = document.getElementById('manualSiteInput');
    const addManualSiteButton = document.getElementById('addManualSite');
    const blockedSitesList = document.getElementById('blockedSitesList');

    // Prevent user interaction until we load
    autoPipOnTabSwitchToggle.disabled = true;
    autoPipOnWindowSwitchToggle.disabled = true;
    autoPipOnAppSwitchToggle.disabled = true;
    currentSiteSelect.disabled = true;
    addCurrentSiteButton.disabled = true;
    manualSiteInput.disabled = true;
    addManualSiteButton.disabled = true;

    const DEFAULT_BLOCKED_SITES = [
        'meet.google.com',
        '*.zoom.us',
        'zoom.com',
        'teams.microsoft.com',
        'teams.live.com',
        '*.slack.com',
        '*.discord.com'
    ];
    let blockedSites = DEFAULT_BLOCKED_SITES.slice();

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

    function sortBlocklist(entries) {
        return entries.slice().sort((a, b) => a.localeCompare(b));
    }

    function setBlocklistControlsDisabled(disabled) {
        currentSiteSelect.disabled = disabled;
        addCurrentSiteButton.disabled = disabled;
        manualSiteInput.disabled = disabled;
        addManualSiteButton.disabled = disabled;
    }

    function renderBlockedSites() {
        blockedSitesList.innerHTML = '';

        if (!blockedSites.length) {
            const empty = document.createElement('div');
            empty.className = 'site-item';
            const label = document.createElement('span');
            label.textContent = 'No sites disabled';
            empty.appendChild(label);
            blockedSitesList.appendChild(empty);
            return;
        }

        const sorted = sortBlocklist(blockedSites);
        sorted.forEach((site) => {
            const row = document.createElement('div');
            row.className = 'site-item';

            const label = document.createElement('span');
            label.textContent = site;

            const removeButton = document.createElement('button');
            removeButton.className = 'button button-small';
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => {
                const next = blockedSites.filter((entry) => entry !== site);
                saveBlocklist(next);
            });

            row.appendChild(label);
            row.appendChild(removeButton);
            blockedSitesList.appendChild(row);
        });
    }

    function isRestrictedUrl(url) {
        if (!url) return true;
        const restrictedProtocols = ['chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-devtools:', 'moz-extension:', 'edge:', 'about:'];
        return restrictedProtocols.some(protocol => url.startsWith(protocol));
    }

    async function refreshCurrentSiteOptions() {
        try {
            const tabs = await new Promise(resolve => {
                chrome.tabs.query({}, resolve);
            });

            const hosts = new Set();
            (tabs || []).forEach((tab) => {
                if (!tab || !tab.url || isRestrictedUrl(tab.url)) return;
                try {
                    const host = new URL(tab.url).hostname.toLowerCase();
                    if (host) hosts.add(host);
                } catch (_) { }
            });

            const sortedHosts = Array.from(hosts).sort((a, b) => a.localeCompare(b));
            currentSiteSelect.innerHTML = '<option value="">Select a site</option>';
            sortedHosts.forEach((host) => {
                const option = document.createElement('option');
                option.value = host;
                option.textContent = host;
                currentSiteSelect.appendChild(option);
            });
        } catch (_) {
        }
    }

    async function saveBlocklist(next) {
        blockedSites = next;
        renderBlockedSites();
        setBlocklistControlsDisabled(true);
        try {
            await chrome.storage.sync.set({ autoPipSiteBlocklist: blockedSites });
            try { await chrome.storage.local.set({ autoPipSiteBlocklist: blockedSites }); } catch (_) { }
            try { chrome.runtime.sendMessage({ type: 'auto_pip_blocklist_updated', blocklist: blockedSites }); } catch (_) { }
        } catch (_) {
        } finally {
            setBlocklistControlsDisabled(false);
        }
    }

    async function migrateOldSettings(syncData, localData) {
        // Check if old autoPipEnabled exists and new settings don't
        const hasOldSetting = typeof syncData.autoPipEnabled === 'boolean';
        const hasNewSettings = 
            typeof syncData.autoPipOnTabSwitch === 'boolean' ||
            typeof syncData.autoPipOnWindowSwitch === 'boolean' ||
            typeof syncData.autoPipOnAppSwitch === 'boolean';

        if (hasOldSetting && !hasNewSettings) {
            // Migrate old setting to all three new settings
            const oldValue = syncData.autoPipEnabled;
            const migration = {
                autoPipOnTabSwitch: oldValue,
                autoPipOnWindowSwitch: oldValue,
                autoPipOnAppSwitch: oldValue
            };
            
            try {
                await chrome.storage.sync.set(migration);
                await chrome.storage.local.set(migration);
                console.log('[Auto PiP] Migrated old autoPipEnabled setting to new separate settings');
                return migration;
            } catch (e) {
                console.error('[Auto PiP] Failed to migrate settings:', e);
            }
        }
        return null;
    }

    async function loadSettingsWithFallback() {
        // Try fast local cache first
        try {
            const local = await chrome.storage.local.get([
                'autoPipOnTabSwitch', 'autoPipOnWindowSwitch', 'autoPipOnAppSwitch',
                'autoPipEnabled', 'autoPipSiteBlocklist'
            ]);
            
            // Try to migrate if needed
            const sync = await chrome.storage.sync.get([
                'autoPipEnabled',
                'autoPipOnTabSwitch',
                'autoPipOnWindowSwitch',
                'autoPipOnAppSwitch',
                'autoPipSiteBlocklist'
            ]);
            const migrated = await migrateOldSettings(sync, local);
            
            if (migrated) {
                autoPipOnTabSwitchToggle.checked = migrated.autoPipOnTabSwitch;
                autoPipOnWindowSwitchToggle.checked = migrated.autoPipOnWindowSwitch;
                autoPipOnAppSwitchToggle.checked = migrated.autoPipOnAppSwitch;
            } else {
                // Defaults for fresh installs: tab switch on, window/app switch off
                autoPipOnTabSwitchToggle.checked = typeof sync.autoPipOnTabSwitch === 'boolean' ? sync.autoPipOnTabSwitch : true;
                autoPipOnWindowSwitchToggle.checked = typeof sync.autoPipOnWindowSwitch === 'boolean' ? sync.autoPipOnWindowSwitch : false;
                autoPipOnAppSwitchToggle.checked = typeof sync.autoPipOnAppSwitch === 'boolean' ? sync.autoPipOnAppSwitch : false;
            }
            
            const localBlocklist = normalizeBlocklist(local.autoPipSiteBlocklist);
            if (localBlocklist) {
                blockedSites = localBlocklist;
                renderBlockedSites();
            }
        } catch (_) {
            // ignore
        }

        // Then authoritative sync storage
        try {
            const result = await chrome.storage.sync.get([
                'autoPipOnTabSwitch', 'autoPipOnWindowSwitch', 'autoPipOnAppSwitch',
                'autoPipEnabled', 'autoPipSiteBlocklist'
            ]);
            
            // Try migration again if needed
            const migrated = await migrateOldSettings(result, {});
            
            if (migrated) {
                autoPipOnTabSwitchToggle.checked = migrated.autoPipOnTabSwitch;
                autoPipOnWindowSwitchToggle.checked = migrated.autoPipOnWindowSwitch;
                autoPipOnAppSwitchToggle.checked = migrated.autoPipOnAppSwitch;
            } else {
                // Defaults for fresh installs: tab switch on, window/app switch off
                autoPipOnTabSwitchToggle.checked = typeof result.autoPipOnTabSwitch === 'boolean' ? result.autoPipOnTabSwitch : true;
                autoPipOnWindowSwitchToggle.checked = typeof result.autoPipOnWindowSwitch === 'boolean' ? result.autoPipOnWindowSwitch : false;
                autoPipOnAppSwitchToggle.checked = typeof result.autoPipOnAppSwitch === 'boolean' ? result.autoPipOnAppSwitch : false;
            }
            
            const syncBlocklist = normalizeBlocklist(result.autoPipSiteBlocklist);
            const localBlocklist = normalizeBlocklist(blockedSites);
            const effectiveBlocklist = syncBlocklist || localBlocklist || DEFAULT_BLOCKED_SITES.slice();
            blockedSites = effectiveBlocklist;
            renderBlockedSites();

            if (!syncBlocklist) {
                try {
                    await chrome.storage.sync.set({ autoPipSiteBlocklist: effectiveBlocklist });
                } catch (_) { }
            }

            // Keep local cache in sync for fast startup
            try { 
                await chrome.storage.local.set({ 
                    autoPipOnTabSwitch: autoPipOnTabSwitchToggle.checked,
                    autoPipOnWindowSwitch: autoPipOnWindowSwitchToggle.checked,
                    autoPipOnAppSwitch: autoPipOnAppSwitchToggle.checked,
                    autoPipSiteBlocklist: blockedSites
                }); 
            } catch (_) { }
        } catch (_) {
            // If sync is unavailable, ensure we have sensible defaults
            if (autoPipOnTabSwitchToggle.checked !== true && autoPipOnTabSwitchToggle.checked !== false) {
                autoPipOnTabSwitchToggle.checked = true;
            }
            if (autoPipOnWindowSwitchToggle.checked !== true && autoPipOnWindowSwitchToggle.checked !== false) {
                autoPipOnWindowSwitchToggle.checked = false;
            }
            if (autoPipOnAppSwitchToggle.checked !== true && autoPipOnAppSwitchToggle.checked !== false) {
                autoPipOnAppSwitchToggle.checked = false;
            }
            if (!blockedSites.length) {
                blockedSites = DEFAULT_BLOCKED_SITES.slice();
                renderBlockedSites();
            }
        }

        renderBlockedSites();
        await refreshCurrentSiteOptions();
    }

    await loadSettingsWithFallback();
    autoPipOnTabSwitchToggle.disabled = false;
    autoPipOnWindowSwitchToggle.disabled = false;
    autoPipOnAppSwitchToggle.disabled = false;
    setBlocklistControlsDisabled(false);

    async function saveSettings() {
        const tabSwitchEnabled = autoPipOnTabSwitchToggle.checked;
        const windowSwitchEnabled = autoPipOnWindowSwitchToggle.checked;
        const appSwitchEnabled = autoPipOnAppSwitchToggle.checked;

        // Disable controls while saving
        autoPipOnTabSwitchToggle.disabled = true;
        autoPipOnWindowSwitchToggle.disabled = true;
        autoPipOnAppSwitchToggle.disabled = true;

        try {
            // Write to sync (authoritative)
            await chrome.storage.sync.set({ 
                autoPipOnTabSwitch: tabSwitchEnabled,
                autoPipOnWindowSwitch: windowSwitchEnabled,
                autoPipOnAppSwitch: appSwitchEnabled
            });
            // Mirror to local cache (best-effort)
            try { 
                await chrome.storage.local.set({ 
                    autoPipOnTabSwitch: tabSwitchEnabled,
                    autoPipOnWindowSwitch: windowSwitchEnabled,
                    autoPipOnAppSwitch: appSwitchEnabled
                }); 
            } catch (_) { }

        } catch (error) {
        } finally {
            autoPipOnTabSwitchToggle.disabled = false;
            autoPipOnWindowSwitchToggle.disabled = false;
            autoPipOnAppSwitchToggle.disabled = false;
        }
    }

    // Save settings when changed
    autoPipOnTabSwitchToggle.addEventListener('change', saveSettings);
    autoPipOnWindowSwitchToggle.addEventListener('change', saveSettings);
    autoPipOnAppSwitchToggle.addEventListener('change', saveSettings);

    addCurrentSiteButton.addEventListener('click', () => {
        const selected = currentSiteSelect.value;
        const normalized = normalizeHostEntry(selected);
        if (!normalized) return;
        if (blockedSites.includes(normalized)) return;
        saveBlocklist([...blockedSites, normalized]);
        currentSiteSelect.value = '';
    });

    addManualSiteButton.addEventListener('click', () => {
        const normalized = normalizeHostEntry(manualSiteInput.value);
        if (!normalized) return;
        if (blockedSites.includes(normalized)) return;
        saveBlocklist([...blockedSites, normalized]);
        manualSiteInput.value = '';
    });

    manualSiteInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addManualSiteButton.click();
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'sync') return;
        
        const tabSwitchChange = changes.autoPipOnTabSwitch ? changes.autoPipOnTabSwitch.newValue : undefined;
        const windowSwitchChange = changes.autoPipOnWindowSwitch ? changes.autoPipOnWindowSwitch.newValue : undefined;
        const appSwitchChange = changes.autoPipOnAppSwitch ? changes.autoPipOnAppSwitch.newValue : undefined;

        if (typeof tabSwitchChange === 'boolean') {
            autoPipOnTabSwitchToggle.checked = tabSwitchChange;
        }
        
        if (typeof windowSwitchChange === 'boolean') {
            autoPipOnWindowSwitchToggle.checked = windowSwitchChange;
        }
        
        if (typeof appSwitchChange === 'boolean') {
            autoPipOnAppSwitchToggle.checked = appSwitchChange;
        }

        if (changes.autoPipSiteBlocklist) {
            const nextBlocklist = normalizeBlocklist(changes.autoPipSiteBlocklist.newValue) || [];
            blockedSites = nextBlocklist;
            renderBlockedSites();
        }
    });
});
