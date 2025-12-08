// Exit PiP when returning to the video tab

(async () => {
    'use strict';

    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[auto-pip][exit]', ...args);

    log('exit-pip.js injected', { hasPiPElement: !!document.pictureInPictureElement });

    const utils = window.__auto_pip_utils__ || {};
    const { exitPiP } = utils;

    try {
        if (exitPiP) {
            log('Using utils.exitPiP()');
            await exitPiP();
        } else if (document.pictureInPictureElement) {
            log('Fallback: exiting PiP directly');
            await document.exitPictureInPicture();
            const pipVideo = document.querySelector('[__pip__]');
            if (pipVideo) {
                pipVideo.removeAttribute('__pip__');
            }
        } else {
            const pipVideo = document.querySelector('[__pip__]');
            if (pipVideo) {
                log('Clearing orphaned PiP marker');
                pipVideo.removeAttribute('__pip__');
            }
        }

        // Clear registration flag so we re-register MediaSession handlers
        // when user switches away again (sites like Twitch may overwrite handlers on focus)
        log('Clearing __auto_pip_registered__ flag, was:', window.__auto_pip_registered__);
        try {
            window.__auto_pip_registered__ = false;
        } catch (_) { }

        log('Exit complete');
        return true;
    } catch (err) {
        log('Exit failed:', err.message);
        return false;
    }
})();
