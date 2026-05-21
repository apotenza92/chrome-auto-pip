// Disable extension-managed main-world Auto-PiP state without touching site MediaSession handlers.

(function pageDisableAutoPiP() {
    'use strict';

    try {
        if (typeof window.__auto_pip_page_disable__ === 'function') {
            return window.__auto_pip_page_disable__({
                clearMediaSession: false,
                disconnectObserver: false
            });
        }
    } catch (_) { }

    window.__auto_pip_page_disabled__ = true;

    try {
        document.querySelectorAll('video[data-auto-pip-managed], video[autopictureinpicture]').forEach((video) => {
            video.removeAttribute('autopictureinpicture');
            video.removeAttribute('data-auto-pip-managed');
        });
    } catch (_) { }

    return true;
})();
