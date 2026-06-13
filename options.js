document.addEventListener('DOMContentLoaded', async () => {
    const autoPipOnTabSwitchToggle = document.getElementById('autoPipOnTabSwitch');
    const currentSiteSelect = document.getElementById('currentSiteSelect');
    const addCurrentSiteButton = document.getElementById('addCurrentSite');
    const manualSiteInput = document.getElementById('manualSiteInput');
    const addManualSiteButton = document.getElementById('addManualSite');
    const blockedSitesList = document.getElementById('blockedSitesList');
    const autoPipBlockerStatus = document.getElementById('autoPipBlockerStatus');
    const autoPipDebugEnabledToggle = document.getElementById('autoPipDebugEnabled');
    const downloadDebugLogButton = document.getElementById('downloadDebugLog');

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
    autoPipDebugEnabledToggle.disabled = true;
    downloadDebugLogButton.disabled = true;
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

    function renderAutoPipBlocker(blocker) {
        if (!autoPipBlockerStatus) return;
        autoPipBlockerStatus.innerHTML = '';
        if (!blocker || typeof blocker !== 'object') {
            autoPipBlockerStatus.style.display = 'none';
            return;
        }

        const title = document.createElement('strong');
        title.textContent = 'Auto PiP was blocked by the browser.';
        const message = document.createElement('div');
        const host = blocker.hostname || 'this site';
        message.textContent = `Open the site information menu for ${host} and set Automatic picture-in-picture to Allow.`;
        const details = document.createElement('div');
        details.textContent = `Playback: audible candidates ${Number(blocker.playingAudibleCandidateCount || 0)}, muted playing videos ${Number(blocker.playingMutedCount || 0)}.`;

        autoPipBlockerStatus.appendChild(title);
        autoPipBlockerStatus.appendChild(message);
        autoPipBlockerStatus.appendChild(details);
        autoPipBlockerStatus.style.display = 'block';
    }

    function renderDebugControls() {
        downloadDebugLogButton.disabled = !autoPipDebugEnabledToggle.checked;
    }

    function getDebugLogText(data) {
        const log = Array.isArray(data.autoPipDebugLog) ? data.autoPipDebugLog : [];
        const text = typeof data.autoPipDebugText === 'string' ? data.autoPipDebugText : '';
        const blocker = data.autoPipLatestBlocker || null;
        const manifest = chrome.runtime.getManifest();

        return [
            'Chrome Auto PiP debug log',
            `Extension version: ${manifest.version || 'unknown'}`,
            `Generated at: ${new Date().toISOString()}`,
            `Debug logging enabled: ${data.autoPipDebugEnabled === true ? 'yes' : 'no'}`,
            `User agent: ${navigator.userAgent}`,
            '',
            'Latest blocker:',
            blocker ? JSON.stringify(blocker, null, 2) : 'None recorded.',
            '',
            'Events:',
            text || log.map(entry => JSON.stringify(entry)).join('\n') || 'No debug events recorded.'
        ].join('\n');
    }

    function getDebugLogFilename(data) {
        const manifest = chrome.runtime.getManifest();
        const version = String(manifest.version || 'unknown').replace(/[^a-z0-9.-]+/gi, '-');
        const blocker = data.autoPipLatestBlocker || null;
        const host = blocker && blocker.hostname
            ? String(blocker.hostname).replace(/[^a-z0-9.-]+/gi, '-')
            : 'general';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `chrome-auto-pip-debug-${version}-${host}-${stamp}.txt`;
    }

    async function downloadDebugLog() {
        const data = await chrome.storage.local.get([
            'autoPipDebugEnabled',
            'autoPipDebugLog',
            'autoPipDebugText',
            'autoPipLatestBlocker'
        ]);
        const blob = new Blob([getDebugLogText(data)], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = getDebugLogFilename(data);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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
                'autoPipSiteBlocklist',
                'autoPipDebugEnabled',
                'autoPipLatestBlocker'
            ]);

            autoPipDebugEnabledToggle.checked = local.autoPipDebugEnabled === true;
            renderDebugControls();
            renderAutoPipBlocker(local.autoPipLatestBlocker);

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
                    autoPipSiteBlocklist: blockedSites,
                    autoPipDebugEnabled: autoPipDebugEnabledToggle.checked
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
            await Promise.allSettled([
                chrome.storage.sync.set({ autoPipOnTabSwitch: tabSwitchEnabled }),
                chrome.storage.local.set({ autoPipOnTabSwitch: tabSwitchEnabled })
            ]);
            try {
                chrome.runtime.sendMessage({
                    type: 'auto_pip_set_switch_modes',
                    autoPipOnTabSwitch: tabSwitchEnabled
                });
            } catch (_) { }
        } finally {
            autoPipOnTabSwitchToggle.disabled = false;
        }
    }

    async function saveDebugSetting() {
        const enabled = autoPipDebugEnabledToggle.checked;
        autoPipDebugEnabledToggle.disabled = true;

        try {
            await chrome.storage.local.set({
                autoPipDebugEnabled: enabled,
                autoPipDebugLog: [],
                autoPipDebugText: ''
            });
            renderDebugControls();
        } finally {
            autoPipDebugEnabledToggle.disabled = false;
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
    autoPipDebugEnabledToggle.disabled = false;
    renderDebugControls();
    setBlocklistControlsDisabled(false);

    autoPipOnTabSwitchToggle.addEventListener('change', saveSettings);
    autoPipDebugEnabledToggle.addEventListener('change', saveDebugSetting);
    downloadDebugLogButton.addEventListener('click', downloadDebugLog);

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
        if (namespace === 'local' && changes.autoPipLatestBlocker) {
            renderAutoPipBlocker(changes.autoPipLatestBlocker.newValue);
        }

        if (namespace === 'local' && changes.autoPipDebugEnabled) {
            autoPipDebugEnabledToggle.checked = changes.autoPipDebugEnabled.newValue === true;
            renderDebugControls();
        }

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
