// Check if PiP is currently active on this page

(function checkPiP() {
    'use strict';

    const utils = window.__auto_pip_utils__ || {};
    const { findAllVideos } = utils;

    let videos;
    if (findAllVideos) {
        videos = findAllVideos({
            deep: false,
            minReadyState: 2,
            visibleOnly: false,
            checkDisabled: true,
            playingFirst: false
        }).filter(v => {
            const isPlaying = v.currentTime > 0 && !v.paused && !v.ended;
            const isReadyToPlay = v.readyState >= 3 && !v.ended && v.duration > 0;
            return isPlaying || isReadyToPlay;
        });
    } else {
        // Fallback
        videos = Array.from(document.querySelectorAll('video'))
            .filter(v => v.readyState >= 2)
            .filter(v => v.disablePictureInPicture === false);
    }

    // Check if any video has the PiP marker
    return videos.some(v => v.hasAttribute('__pip__'));
})();
