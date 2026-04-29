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

    const video = (isPlaying && videos.find(isPlaying)) || videos[0];
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
