// Register browser-facing auto-PiP behaviour in the page's main world.

(function pageAutoPiP() {
    'use strict';

    if (!('mediaSession' in navigator)) return false;

    const state = window.__auto_pip_page_state__ || {
        registered: false,
        refreshTimer: null,
        observer: null
    };
    window.__auto_pip_page_state__ = state;
    window.__auto_pip_page_disabled__ = false;

    const isDisabled = () => window.__auto_pip_page_disabled__ === true;
    let hiddenAttemptToken = 0;

    function isPlaying(video) {
        return !!video && !video.paused && !video.ended && video.readyState >= 2;
    }

    function collectVideos(root, videos) {
        if (!root) return;
        try {
            if (root instanceof HTMLVideoElement) {
                videos.push(root);
            }
        } catch (_) { }

        let elements = [];
        try {
            elements = root.querySelectorAll ? Array.from(root.querySelectorAll('video, *')) : [];
        } catch (_) {
            elements = [];
        }

        elements.forEach((element) => {
            try {
                if (element instanceof HTMLVideoElement) {
                    videos.push(element);
                }
            } catch (_) { }
            try {
                if (element.shadowRoot) {
                    collectVideos(element.shadowRoot, videos);
                }
            } catch (_) { }
        });
    }

    function findVideos() {
        const videos = [];
        collectVideos(document, videos);
        return Array.from(new Set(videos))
            .filter(video => video.readyState >= 1 && !video.disablePictureInPicture)
            .sort((a, b) => Number(isPlaying(b)) - Number(isPlaying(a)));
    }

    function updateVideos() {
        if (isDisabled()) return [];
        const videos = findVideos();
        videos.forEach((video) => {
            try {
                video.setAttribute('autopictureinpicture', '');
                video.setAttribute('data-auto-pip-managed', '');
            } catch (_) { }
        });
        return videos;
    }

    async function enterPictureInPicture() {
        if (isDisabled() || document.pictureInPictureElement) return false;
        const videos = updateVideos();
        const video = videos.find(isPlaying) || videos[0];
        if (!video || typeof video.requestPictureInPicture !== 'function') {
            return false;
        }
        try {
            await video.requestPictureInPicture();
            return true;
        } catch (_) { }
        return false;
    }

    function attemptHiddenPictureInPicture() {
        const token = hiddenAttemptToken + 1;
        hiddenAttemptToken = token;

        [0, 100, 250, 500, 1000].forEach((delay) => {
            setTimeout(() => {
                if (hiddenAttemptToken !== token) return;
                if (document.visibilityState !== 'hidden') return;
                if (document.pictureInPictureElement) return;
                enterPictureInPicture();
            }, delay);
        });
    }

    function updatePlaybackState() {
        if (isDisabled()) return;
        const videos = updateVideos();
        try {
            navigator.mediaSession.playbackState = videos.some(isPlaying) ? 'playing' : 'paused';
        } catch (_) { }
    }

    function registerHandler() {
        if (isDisabled()) return;
        try {
            navigator.mediaSession.setActionHandler('enterpictureinpicture', enterPictureInPicture);
        } catch (_) { }
        updatePlaybackState();
    }

    function scheduleRefresh() {
        if (state.refreshTimer != null) return;
        state.refreshTimer = setTimeout(() => {
            state.refreshTimer = null;
            registerHandler();
        }, 100);
    }

    if (!state.registered) {
        ['play', 'playing', 'pause', 'loadedmetadata', 'loadeddata', 'canplay'].forEach((eventName) => {
            document.addEventListener(eventName, (event) => {
                if (event.target instanceof HTMLVideoElement) {
                    scheduleRefresh();
                }
            }, true);
        });

        document.addEventListener('visibilitychange', () => {
            registerHandler();
            if (document.visibilityState === 'hidden') {
                attemptHiddenPictureInPicture();
            } else {
                hiddenAttemptToken += 1;
            }
        }, true);

        try {
            state.observer = new MutationObserver(scheduleRefresh);
            state.observer.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true
            });
        } catch (_) { }

        state.registered = true;
    }

    registerHandler();
    return true;
})();
