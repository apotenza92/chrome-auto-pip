(function checkVideo() {
    'use strict';

    const videoLib = window.AutoPipContent && window.AutoPipContent.video;
    const path = 'check';

    try {
        if (!videoLib) {
            return { ok: false, status: 'failed', reason: 'missing_video_lib', path };
        }

        const videos = videoLib.findVideos({
            deep: true,
            minReadyState: 1,
            visibleOnly: true,
            playingFirst: true,
            includeDisabled: true
        });
        const video = videos.find(videoLib.isPlaying) || null;

        if (!video) {
            return videoLib.result(false, 'skipped', 'no_playing_video', path, null);
        }

        return videoLib.result(true, 'success', 'playing_video_found', path, video);
    } catch (error) {
        return {
            ok: false,
            status: 'failed',
            reason: 'check_failed',
            path,
            message: error && error.message ? error.message : String(error),
            video: null
        };
    }
})();
