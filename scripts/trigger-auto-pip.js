// Isolated-world bridge for settings, page-agent debug forwarding, and lazy arming.

(async function triggerAutoPiPBridge() {
    'use strict';

    const settingsLib = window.AutoPipContent && window.AutoPipContent.settings;
    const pip = window.AutoPipContent && window.AutoPipContent.pip;
    const path = 'native';

    const debugLog = (event, details = {}) => {
        try {
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
            chrome.runtime.sendMessage({
                type: 'auto_pip_debug_log',
                source: 'content:auto',
                event,
                details: {
                    url: location.href,
                    visibilityState: document.visibilityState,
                    ...details
                }
            }, () => {
                try { void chrome.runtime.lastError; } catch (_) { }
            });
        } catch (_) { }
    };

    if (!window.__auto_pip_page_debug_listener__) {
        window.addEventListener('message', (event) => {
            const data = event && event.data;
            if (!data || data.source !== 'chrome-auto-pip-v2-page') return;
            debugLog(data.event || 'page_unknown', data.details || {});
        });
        window.__auto_pip_page_debug_listener__ = true;
    }

    if (!settingsLib) {
        debugLog('bridge_failed', { reason: 'missing_settings_lib' });
        return { ok: false, status: 'failed', reason: 'missing_settings_lib', path };
    }

    let settings = null;
    try {
        settings = await settingsLib.getSettings();
    } catch (_) {
        settings = {
            autoPipOnTabSwitch: true,
            autoPipSiteBlocklist: settingsLib.DEFAULT_BLOCKED_SITES
        };
    }

    const hostname = settingsLib.hostname();
    const blocked = hostname
        ? settingsLib.isHostBlocked(hostname, settings.autoPipSiteBlocklist)
        : false;

    debugLog('settings_read', {
        autoPipOnTabSwitch: settings.autoPipOnTabSwitch,
        blocklistCount: Array.isArray(settings.autoPipSiteBlocklist) ? settings.autoPipSiteBlocklist.length : 0
    });
    debugLog('host_checked', { hostname, blocked });

    if (settings.autoPipOnTabSwitch === false || blocked) {
        window.__auto_pip_disabled__ = true;
        window.__auto_pip_blocked__ = blocked;
        window.__auto_pip_registered__ = false;
        try {
            window.postMessage({
                source: 'chrome-auto-pip-v2-isolated',
                type: 'disable_auto_pip'
            }, '*');
        } catch (_) { }
        try {
            if (pip && typeof pip.cleanupOwnedAutoPiP === 'function') pip.cleanupOwnedAutoPiP();
        } catch (_) { }
        debugLog(blocked ? 'blocked_by_site' : 'disabled_by_setting');
        return {
            ok: false,
            status: 'skipped',
            reason: blocked ? 'blocked_by_site' : 'disabled_by_setting',
            path
        };
    }

    window.__auto_pip_disabled__ = false;
    window.__auto_pip_blocked__ = false;
    window.__auto_pip_registered__ = true;

    if (!('mediaSession' in navigator)) {
        window.__auto_pip_registered__ = false;
        debugLog('no_media_session');
        return { ok: false, status: 'skipped', reason: 'no_media_session', path };
    }

    debugLog('bridge_armed', { path });
    return { ok: true, status: 'armed', reason: 'settings_allow_auto_pip', path };
})();
