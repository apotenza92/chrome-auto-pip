// Register browser-facing auto-PiP behaviour in the page's main world.

(function pageAutoPiP() {
    'use strict';

    if (!('mediaSession' in navigator)) return false;

    const state = window.__auto_pip_page_state__ || {
        registered: false,
        refreshTimer: null,
        observer: null,
        videos: new Set(),
        videoCachePrimed: false
    };
    window.__auto_pip_page_state__ = state;
    if (!(state.videos instanceof Set)) {
        state.videos = new Set();
    }
    window.__auto_pip_page_disabled__ = false;

    const isDisabled = () => window.__auto_pip_page_disabled__ === true;
    let hiddenAttemptToken = 0;

    function isPlaying(video) {
        return !!video && !video.paused && !video.ended && video.readyState >= 2;
    }

    function collectVideos(root, videos, includeShadowRoots) {
        if (!root) return;
        try {
            if (root instanceof HTMLVideoElement) {
                videos.add(root);
            }
        } catch (_) { }

        try {
            if (root.querySelectorAll) {
                root.querySelectorAll('video').forEach(video => videos.add(video));
            }
        } catch (_) { }

        if (!includeShadowRoots) return;

        try {
            if (!root.querySelectorAll) return;
            root.querySelectorAll('*').forEach((element) => {
                try {
                    if (element.shadowRoot) {
                        collectVideos(element.shadowRoot, videos, true);
                    }
                } catch (_) { }
            });
        } catch (_) { }
    }

    function mutationAddsVideo(mutations) {
        let found = false;
        mutations.forEach((mutation) => {
            if (found) return;
            mutation.addedNodes.forEach((node) => {
                if (found || !node) return;
                try {
                    if (node instanceof HTMLVideoElement) {
                        state.videos.add(node);
                        found = true;
                        return;
                    }
                } catch (_) { }
                try {
                    if (node.querySelectorAll) {
                        const videos = node.querySelectorAll('video');
                        videos.forEach(video => state.videos.add(video));
                        if (videos.length > 0) {
                            found = true;
                        }
                    }
                } catch (_) { }
                try {
                    if (node.shadowRoot) {
                        collectVideos(node.shadowRoot, state.videos, true);
                        found = true;
                    }
                } catch (_) { }
            });
        });
        return found;
    }

    function primeVideoCache() {
        if (state.videoCachePrimed) return;
        collectVideos(document, state.videos, true);
        state.videoCachePrimed = true;
    }

    function rememberVideo(video) {
        if (!video) return;
        try {
            if (video instanceof HTMLVideoElement) {
                state.videos.add(video);
            }
        } catch (_) { }
    }

    function pruneVideoCache() {
        Array.from(state.videos).forEach((video) => {
            try {
                if (!video || !video.isConnected) {
                    state.videos.delete(video);
                }
            } catch (_) { }
        });
    }

    function findVideos() {
        primeVideoCache();
        pruneVideoCache();
        return Array.from(state.videos)
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
                    rememberVideo(event.target);
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
            state.observer = new MutationObserver((mutations) => {
                if (mutationAddsVideo(mutations)) {
                    scheduleRefresh();
                }
            });
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
