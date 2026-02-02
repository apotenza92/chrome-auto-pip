// Disable Auto-PiP behavior on this page without clearing MediaSession

(function disableAutoPiP() {
    'use strict';

    try {
        window.__auto_pip_disabled__ = true;
    } catch (_) { }

    try {
        window.__auto_pip_blocked__ = true;
    } catch (_) { }

    try {
        window.__auto_pip_registered__ = false;
    } catch (_) { }

    const disableVideo = (video) => {
        if (!video) return;
        if (!video.hasAttribute('data-auto-pip-managed')) return;
        try { video.removeAttribute('autopictureinpicture'); } catch (_) { }
        try { video.removeAttribute('data-auto-pip-managed'); } catch (_) { }
    };

    const disableAllVideos = (root) => {
        if (!root || !root.querySelectorAll) return;
        try {
            root.querySelectorAll('video').forEach(disableVideo);
        } catch (_) { }
    };

    try {
        disableAllVideos(document);

        const allElements = document.querySelectorAll('*');
        allElements.forEach(el => {
            if (!el.shadowRoot) return;
            try {
                disableAllVideos(el.shadowRoot);
            } catch (_) { }
        });
    } catch (_) { }

    return true;

    return true;
})();
