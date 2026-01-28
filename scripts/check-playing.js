// Check if page has a playing video

(function hasPlayingVideo() {
    'use strict';

    const utils = window.__auto_pip_utils__ || {};
    const { findAllVideos, isPlaying } = utils;

    try {
        let candidates;
        if (findAllVideos) {
            candidates = findAllVideos({
                deep: false,
                minReadyState: 1,
                visibleOnly: true,
                playingFirst: true
            });
        } else {
            candidates = Array.from(document.querySelectorAll('video'))
                .filter(v => v.readyState >= 1)
                .filter(v => {
                    const rect = v.getClientRects()[0];
                    return rect && rect.width > 0 && rect.height > 0;
                });
        }

        if (!candidates || candidates.length === 0) return false;

        const checkPlaying = (v) => {
            const basicPlaying = !v.paused && !v.ended && v.readyState >= 2;
            if (isPlaying) return isPlaying(v) || basicPlaying;
            return basicPlaying || (v.currentTime > 0 && !v.paused && !v.ended);
        };
        return candidates.some(checkPlaying);
    } catch (_) {
        return false;
    }
})();
