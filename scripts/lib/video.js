(function initVideoLib(root) {
    'use strict';

    const AutoPipContent = root.AutoPipContent || {};
    root.AutoPipContent = AutoPipContent;

    const MARKERS = AutoPipContent.markers || {
        owned: 'data-auto-pip-managed',
        addedAutoPip: 'data-auto-pip-added-autopictureinpicture',
        compatRequested: 'data-auto-pip-compat-requested',
        pip: '__pip__'
    };
    AutoPipContent.markers = MARKERS;

    function paintedArea(video) {
        try {
            const rect = video.getClientRects()[0];
            return rect ? Number(rect.width) * Number(rect.height) : 0;
        } catch (_) {
            return 0;
        }
    }

    function byPaintedAreaDesc(a, b) {
        return paintedArea(b) - paintedArea(a);
    }

    function isPlaying(video) {
        return !!video &&
            video.paused === false &&
            video.ended === false &&
            Number(video.readyState) >= 2;
    }

    function isPausedCandidate(video) {
        return !!video &&
            video.paused === true &&
            video.ended === false &&
            Number(video.readyState) >= 2 &&
            Number(video.duration || 0) > 0;
    }

    function isVisible(video) {
        try {
            const rect = video.getClientRects()[0];
            return !!(rect && rect.width > 0 && rect.height > 0);
        } catch (_) {
            return false;
        }
    }

    function collectVideosDeep(rootNode, output = []) {
        if (!rootNode) return output;
        try {
            if (rootNode instanceof HTMLVideoElement) output.push(rootNode);
        } catch (_) { }
        try {
            if (rootNode.querySelectorAll) {
                rootNode.querySelectorAll('video').forEach(video => output.push(video));
            }
        } catch (_) { }
        try {
            if (!rootNode.querySelectorAll) return output;
            rootNode.querySelectorAll('*').forEach((element) => {
                if (element && element.shadowRoot) collectVideosDeep(element.shadowRoot, output);
            });
        } catch (_) { }
        return output;
    }

    function findVideos(options = {}) {
        const {
            deep = true,
            minReadyState = 1,
            visibleOnly = false,
            playingFirst = false,
            includeDisabled = true
        } = options;

        let videos = deep
            ? collectVideosDeep(document, [])
            : Array.from(document.querySelectorAll('video'));

        videos = videos
            .filter(video => video && typeof video.readyState === 'number' && video.readyState >= minReadyState)
            .filter(video => includeDisabled || video.disablePictureInPicture !== true)
            .filter(video => !visibleOnly || isVisible(video));

        videos.sort(byPaintedAreaDesc);

        if (playingFirst) {
            const playing = videos.filter(isPlaying);
            const rest = videos.filter(video => !isPlaying(video));
            return playing.concat(rest);
        }

        return videos;
    }

    function state(video) {
        if (!video) {
            return {
                hasVideo: false,
                path: null,
                topFrame: (() => {
                    try { return root.top === root; } catch (_) { return false; }
                })(),
                visibilityState: document.visibilityState,
                pictureInPictureEnabled: document.pictureInPictureEnabled === true
            };
        }

        return {
            hasVideo: true,
            topFrame: (() => {
                try { return root.top === root; } catch (_) { return false; }
            })(),
            visibilityState: document.visibilityState,
            pictureInPictureEnabled: document.pictureInPictureEnabled === true,
            paused: video.paused === true,
            ended: video.ended === true,
            muted: video.muted === true,
            volume: Number(video.volume),
            readyState: Number(video.readyState),
            currentTime: Number(video.currentTime),
            duration: Number(video.duration || 0),
            disablePictureInPicture: video.disablePictureInPicture === true,
            autoPipArmed: video.hasAttribute('autopictureinpicture'),
            ownedAutoPip: video.hasAttribute(MARKERS.owned),
            addedAutoPipAttr: video.hasAttribute(MARKERS.addedAutoPip),
            compatRequested: video.hasAttribute(MARKERS.compatRequested),
            width: (() => {
                try {
                    const rect = video.getClientRects()[0];
                    return rect ? Number(rect.width) : 0;
                } catch (_) { return 0; }
            })(),
            height: (() => {
                try {
                    const rect = video.getClientRects()[0];
                    return rect ? Number(rect.height) : 0;
                } catch (_) { return 0; }
            })()
        };
    }

    function result(ok, status, reason, path, video, extra = {}) {
        return {
            ok: ok === true,
            status,
            reason,
            path,
            video: state(video),
            ...extra
        };
    }

    AutoPipContent.video = {
        paintedArea,
        byPaintedAreaDesc,
        isPlaying,
        isPausedCandidate,
        isVisible,
        collectVideosDeep,
        findVideos,
        state,
        result
    };
})(window);
