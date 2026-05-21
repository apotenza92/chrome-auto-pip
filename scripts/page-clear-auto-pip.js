// Clear main-world auto-PiP registration and attributes.

(function pageClearAutoPiP() {
    'use strict';

    try {
        if (typeof window.__auto_pip_page_disable__ === 'function') {
            return window.__auto_pip_page_disable__({
                clearMediaSession: true,
                disconnectObserver: true
            });
        }
    } catch (_) { }

    window.__auto_pip_page_disabled__ = true;

    try {
        if (document.pictureInPictureElement && typeof document.exitPictureInPicture === 'function') {
            document.exitPictureInPicture().catch(() => { });
        }
    } catch (_) { }

    try {
        if (navigator.mediaSession) {
            navigator.mediaSession.setActionHandler('enterpictureinpicture', null);
            navigator.mediaSession.playbackState = 'none';
        }
    } catch (_) { }

    try {
        document.querySelectorAll('video[data-auto-pip-managed], video[autopictureinpicture]').forEach((video) => {
            video.removeAttribute('autopictureinpicture');
            video.removeAttribute('data-auto-pip-managed');
        });
    } catch (_) { }

    return true;
})();
