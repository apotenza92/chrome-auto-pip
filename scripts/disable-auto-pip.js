(function disableAutoPiP() {
    'use strict';

    const videoLib = window.AutoPipContent && window.AutoPipContent.video;
    const pip = window.AutoPipContent && window.AutoPipContent.pip;
    const path = 'cleanup';

    try { window.__auto_pip_disabled__ = true; } catch (_) { }
    try { window.__auto_pip_blocked__ = true; } catch (_) { }
    try { window.__auto_pip_registered__ = false; } catch (_) { }
    try {
        window.postMessage({
            source: 'chrome-auto-pip-v2-isolated',
            type: 'disable_auto_pip'
        }, '*');
    } catch (_) { }

    try {
        if (typeof window.__auto_pip_cleanup_owned__ === 'function') {
            window.__auto_pip_cleanup_owned__();
        } else if (pip && typeof pip.cleanupOwnedAutoPiP === 'function') {
            pip.cleanupOwnedAutoPiP();
        }
        return {
            ok: true,
            status: 'success',
            reason: 'extension_owned_state_removed',
            path,
            video: videoLib ? videoLib.state(null) : null
        };
    } catch (error) {
        return {
            ok: false,
            status: 'failed',
            reason: 'cleanup_failed',
            path,
            message: error && error.message ? error.message : String(error),
            video: videoLib ? videoLib.state(null) : null
        };
    }
})();
