// Ensure PiP is active without toggling it off if it already exists.

(async () => {
    'use strict';

    const utils = window.__auto_pip_utils__ || {};
    const { findAllVideos, requestPiP, isPlaying } = utils;

    if (document.pictureInPictureElement) {
        return 'already_active';
    }

    let videos;
    if (findAllVideos) {
        videos = findAllVideos({
                deep: true,
                minReadyState: 2,
                visibleOnly: false,
                playingFirst: true
            }).filter(v => v.readyState >= 2 && !v.ended && !v.disablePictureInPicture);
    } else {
        videos = Array.from(document.querySelectorAll('video'))
            .filter(v => v.readyState >= 2 && !v.ended && !v.disablePictureInPicture);
    }

    if (videos.length === 0) return false;

    const wasRecentlyPlaying = (video) => {
        const lastPlayingAt = Number(video.getAttribute('data-auto-pip-last-playing-at') || 0);
        const userPausedAt = Number(video.getAttribute('data-auto-pip-user-paused-at') || 0);
        if (userPausedAt && (!lastPlayingAt || userPausedAt >= lastPlayingAt)) return false;
        if (lastPlayingAt && (Date.now() - lastPlayingAt) <= 10000) return true;
        return video.currentTime > 0 && video.readyState >= 2 && !video.ended;
    };

    const video = isPlaying
        ? videos.find(isPlaying)
        : videos.find(v => (!v.paused && !v.ended && v.readyState >= 2) || wasRecentlyPlaying(v));
    if (!video) return false;

    try {
        if (requestPiP) {
            await requestPiP(video);
        } else {
            await video.requestPictureInPicture();
        }
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            message: error && error.message ? error.message : String(error)
        };
    }
})();
