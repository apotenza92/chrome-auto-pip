// Disable extension-managed main-world Auto-PiP state without touching site MediaSession handlers.

(function pageDisableAutoPiP() {
    'use strict';

    window.__auto_pip_page_disabled__ = true;

    try {
        document.querySelectorAll('video[data-auto-pip-managed], video[autopictureinpicture]').forEach((video) => {
            video.removeAttribute('autopictureinpicture');
            video.removeAttribute('data-auto-pip-managed');
        });
    } catch (_) { }

    return true;
})();
