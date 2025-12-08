// Check if page has a playing or eligible video

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
                playingFirst: false
            });
        } else {
            // Fallback
            candidates = Array.from(document.querySelectorAll('video'))
                .filter(v => v.readyState >= 1)
                .filter(v => {
                    const rect = v.getClientRects()[0];
                    return rect && rect.width > 0 && rect.height > 0;
                });
        }

        if (candidates.length === 0) return false;

        // If any are actively playing, that's a strong signal
        const checkPlaying = isPlaying || (v => v.currentTime > 0 && !v.paused && !v.ended);
        if (candidates.some(checkPlaying)) return true;

        // Lenient: accept presence of a visible, eligible video with metadata
        return true;
    } catch (_) {
        return false;
    }
})();
