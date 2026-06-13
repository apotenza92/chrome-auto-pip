(async () => {
    'use strict';

    const videoLib = window.AutoPipContent && window.AutoPipContent.video;
    const pip = window.AutoPipContent && window.AutoPipContent.pip;
    const path = 'tab_leave_compat';

    try {
        if (!videoLib || !pip) {
            return { ok: false, status: 'failed', reason: 'missing_content_lib', path };
        }

        if (window.__auto_pip_disabled__ === true || window.__auto_pip_blocked__ === true) {
            return videoLib.result(false, 'skipped', 'disabled_or_blocked', path, null);
        }

        if (document.pictureInPictureElement) {
            return videoLib.result(true, 'already_active', 'already_active', path, document.pictureInPictureElement);
        }

        const candidates = videoLib.findVideos({
            deep: true,
            minReadyState: 2,
            visibleOnly: false,
            playingFirst: true,
            includeDisabled: true
        }).filter(video =>
            videoLib.isPlaying(video) &&
            typeof video.requestPictureInPicture === 'function'
        );

        const video = candidates[0] || null;
        if (!video) {
            return videoLib.result(false, 'skipped', 'no_playing_video', path, null);
        }

        await pip.request(video, {
            allowDisablePictureInPictureOverride: true,
            ensureAutoPipAttr: true,
            compat: true
        });
        return videoLib.result(true, 'success', 'requested_picture_in_picture', path, video);
    } catch (error) {
        return {
            ok: false,
            status: 'failed',
            reason: 'request_failed',
            path,
            message: error && error.message ? error.message : String(error),
            name: error && error.name ? error.name : null,
            video: null
        };
    }
})();
