document.addEventListener('DOMContentLoaded', async () => {
    const autoPipOnTabSwitchToggle = document.getElementById('autoPipOnTabSwitch');
    const currentSiteSelect = document.getElementById('currentSiteSelect');
    const addCurrentSiteButton = document.getElementById('addCurrentSite');
    const manualSiteInput = document.getElementById('manualSiteInput');
    const addManualSiteButton = document.getElementById('addManualSite');
    const blockedSitesList = document.getElementById('blockedSitesList');

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

    autoPipOnTabSwitchToggle.disabled = true;
    setBlocklistControlsDisabled(true);

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

        sortBlocklist(blockedSites).forEach((site) => {
            const row = document.createElement('div');
            row.className = 'site-item';

            const label = document.createElement('span');
            label.textContent = site;

            const removeButton = document.createElement('button');
            removeButton.className = 'button button-small';
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => {
                saveBlocklist(blockedSites.filter((entry) => entry !== site));
            });

            row.appendChild(label);
            row.appendChild(removeButton);
            blockedSitesList.appendChild(row);
        });
    }

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

            currentSiteSelect.innerHTML = '<option value="">Select a site</option>';
            Array.from(hosts).sort((a, b) => a.localeCompare(b)).forEach((host) => {
                const option = document.createElement('option');
                option.value = host;
                option.textContent = host;
                currentSiteSelect.appendChild(option);
            });
        } catch (_) { }
    }

    async function migrateOldSettings(syncData) {
        if (typeof syncData.autoPipEnabled !== 'boolean') return null;
        if (typeof syncData.autoPipOnTabSwitch === 'boolean') return null;

        const migration = { autoPipOnTabSwitch: syncData.autoPipEnabled };
        try {
            await chrome.storage.sync.set(migration);
            await chrome.storage.local.set(migration);
            return migration;
        } catch (_) {
            return null;
        }
    }

    async function loadSettingsWithFallback() {
        let localBlocklist = null;

        try {
            const local = await chrome.storage.local.get([
                'autoPipOnTabSwitch',
                'autoPipEnabled',
                'autoPipSiteBlocklist'
            ]);

            if (typeof local.autoPipOnTabSwitch === 'boolean') {
                autoPipOnTabSwitchToggle.checked = local.autoPipOnTabSwitch;
            } else if (typeof local.autoPipEnabled === 'boolean') {
                autoPipOnTabSwitchToggle.checked = local.autoPipEnabled;
            }

            localBlocklist = normalizeBlocklist(local.autoPipSiteBlocklist);
            if (localBlocklist) {
                blockedSites = localBlocklist;
                renderBlockedSites();
            }
        } catch (_) { }

        try {
            const result = await chrome.storage.sync.get([
                'autoPipOnTabSwitch',
                'autoPipEnabled',
                'autoPipSiteBlocklist'
            ]);

            const migrated = await migrateOldSettings(result);
            const effective = migrated || result;

            autoPipOnTabSwitchToggle.checked =
                typeof effective.autoPipOnTabSwitch === 'boolean'
                    ? effective.autoPipOnTabSwitch
                    : true;

            const syncBlocklist = normalizeBlocklist(effective.autoPipSiteBlocklist);
            const effectiveBlocklist = syncBlocklist || localBlocklist || DEFAULT_BLOCKED_SITES.slice();
            blockedSites = effectiveBlocklist;

            if (!syncBlocklist) {
                try {
                    await chrome.storage.sync.set({ autoPipSiteBlocklist: effectiveBlocklist });
                } catch (_) { }
            }

            try {
                await chrome.storage.local.set({
                    autoPipOnTabSwitch: autoPipOnTabSwitchToggle.checked,
                    autoPipSiteBlocklist: blockedSites
                });
            } catch (_) { }
        } catch (_) {
            if (autoPipOnTabSwitchToggle.checked !== true && autoPipOnTabSwitchToggle.checked !== false) {
                autoPipOnTabSwitchToggle.checked = true;
            }
            if (!blockedSites.length) {
                blockedSites = DEFAULT_BLOCKED_SITES.slice();
            }
        }

        renderBlockedSites();
        await refreshCurrentSiteOptions();
    }

    async function saveSettings() {
        const tabSwitchEnabled = autoPipOnTabSwitchToggle.checked;
        autoPipOnTabSwitchToggle.disabled = true;

        try {
            await chrome.storage.sync.set({ autoPipOnTabSwitch: tabSwitchEnabled });
            try {
                await chrome.storage.local.set({ autoPipOnTabSwitch: tabSwitchEnabled });
            } catch (_) { }
        } catch (_) {
        } finally {
            autoPipOnTabSwitchToggle.disabled = false;
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

    await loadSettingsWithFallback();
    autoPipOnTabSwitchToggle.disabled = false;
    setBlocklistControlsDisabled(false);

    autoPipOnTabSwitchToggle.addEventListener('change', saveSettings);

    addCurrentSiteButton.addEventListener('click', () => {
        const normalized = normalizeHostEntry(currentSiteSelect.value);
        if (!normalized || blockedSites.includes(normalized)) return;
        saveBlocklist([...blockedSites, normalized]);
        currentSiteSelect.value = '';
    });

    addManualSiteButton.addEventListener('click', () => {
        const normalized = normalizeHostEntry(manualSiteInput.value);
        if (!normalized || blockedSites.includes(normalized)) return;
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
        if (typeof tabSwitchChange === 'boolean') {
            autoPipOnTabSwitchToggle.checked = tabSwitchChange;
        }

        if (changes.autoPipSiteBlocklist) {
            blockedSites = normalizeBlocklist(changes.autoPipSiteBlocklist.newValue) || [];
            renderBlockedSites();
        }
    });
});
