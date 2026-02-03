// Immediately request PiP when extension icon is clicked
// Works with both playing AND paused videos (manual activation)

(async () => {
    'use strict';

    const utils = window.__auto_pip_utils__ || {};
    const { findAllVideos, requestPiP, exitPiP } = utils;

    // If PiP already active, exit it (toggle behavior)
    if (document.pictureInPictureElement) {
        try {
            if (exitPiP) {
                await exitPiP();
            } else {
                await document.exitPictureInPicture();
            }
            return 'toggled_off';
        } catch (_) {
            return false;
        }
    }

    // Also check for local PiP marker
    const pipVideo = document.querySelector('[__pip__]');
    if (pipVideo) {
        pipVideo.removeAttribute('__pip__');
        return 'toggled_off';
    }

    // Find candidate videos (more permissive for manual activation - includes paused)
    let videos;
    if (findAllVideos) {
        videos = findAllVideos({
            deep: false,
            minReadyState: 2,
            visibleOnly: false,
            playingFirst: false
        }).filter(v => {
            const isPlaying = v.currentTime > 0 && !v.paused && !v.ended;
            const isPaused = v.currentTime > 0 && v.paused && !v.ended;
            const hasContent = v.readyState >= 2 && v.duration > 0 && !v.ended;
            return isPlaying || isPaused || hasContent;
        });
    } else {
        // Fallback
        videos = Array.from(document.querySelectorAll('video'))
            .filter(v => v.readyState >= 2);
    }

    if (videos.length === 0) return false;

    const video = videos[0];
    try {
        if (requestPiP) {
            await requestPiP(video);
        } else {
            await video.requestPictureInPicture();
        }
        return true;
    } catch (_) {
        return false;
    }
})();
