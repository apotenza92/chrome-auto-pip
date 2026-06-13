(function initSettingsLib(root) {
    'use strict';

    const AutoPipContent = root.AutoPipContent || {};
    root.AutoPipContent = AutoPipContent;

    const DEFAULT_BLOCKED_SITES = [
        'meet.google.com',
        '*.zoom.us',
        'zoom.com',
        'teams.microsoft.com',
        'teams.live.com',
        '*.slack.com',
        '*.discord.com'
    ];

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
            if (!normalized.includes(value)) normalized.push(value);
        });
        return normalized;
    }

    function isHostBlocked(hostname, patterns) {
        if (!hostname || !Array.isArray(patterns)) return false;
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            if (!pattern || typeof pattern !== 'string') continue;
            if (pattern.startsWith('*.')) {
                const suffix = pattern.slice(2);
                if (!suffix) continue;
                if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return true;
            } else if (hostname === pattern || hostname === `www.${pattern}`) {
                return true;
            }
        }
        return false;
    }

    const readStorage = (area) => new Promise(resolve => {
        try {
            area.get(['autoPipOnTabSwitch', 'autoPipSiteBlocklist'], (data) => resolve(data || null));
        } catch (_) {
            resolve(null);
        }
    });

    async function getSettings() {
        if (typeof chrome === 'undefined' || !chrome.storage) {
            return {
                autoPipOnTabSwitch: true,
                autoPipSiteBlocklist: DEFAULT_BLOCKED_SITES
            };
        }
        const local = await readStorage(chrome.storage.local);
        if (local && (typeof local.autoPipOnTabSwitch === 'boolean' || Array.isArray(local.autoPipSiteBlocklist))) {
            return {
                autoPipOnTabSwitch: typeof local.autoPipOnTabSwitch === 'boolean' ? local.autoPipOnTabSwitch : true,
                autoPipSiteBlocklist: normalizeBlocklist(local.autoPipSiteBlocklist) || DEFAULT_BLOCKED_SITES
            };
        }
        const sync = await readStorage(chrome.storage.sync);
        return {
            autoPipOnTabSwitch: sync && typeof sync.autoPipOnTabSwitch === 'boolean'
                ? sync.autoPipOnTabSwitch
                : true,
            autoPipSiteBlocklist: normalizeBlocklist(sync && sync.autoPipSiteBlocklist) || DEFAULT_BLOCKED_SITES
        };
    }

    function hostname() {
        try {
            return new URL(location.href).hostname.toLowerCase();
        } catch (_) {
            return null;
        }
    }

    AutoPipContent.settings = {
        DEFAULT_BLOCKED_SITES,
        normalizeHostEntry,
        normalizeBlocklist,
        isHostBlocked,
        getSettings,
        hostname
    };
})(window);
