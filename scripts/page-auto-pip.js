// Register browser-facing auto-PiP behaviour in the page's main world.

(function pageAutoPiP() {
    'use strict';

    if (!('mediaSession' in navigator)) return false;

    const state = window.__auto_pip_page_state__ || {
        registered: false,
        refreshTimer: null,
        observer: null,
        videos: new Set(),
        videoCachePrimed: false,
        lastDeepScanAt: 0,
        refreshDueAt: 0,
        lastMutationVideoCheckAt: 0,
        heartbeatTimer: null,
        lastHeartbeatAt: Date.now(),
        heartbeatMessageListenerRegistered: false
    };
    window.__auto_pip_page_state__ = state;
    if (!(state.videos instanceof Set)) {
        state.videos = new Set();
    }
    window.__auto_pip_page_disabled__ = false;

    const isDisabled = () => window.__auto_pip_page_disabled__ === true;
    const DEEP_RESCAN_THROTTLE_MS = 1000;
    const MUTATION_VIDEO_CHECK_THROTTLE_MS = 1000;
    const REFRESH_DELAY_MS = 100;
    const GENERIC_MUTATION_REFRESH_DELAY_MS = 1000;
    const HEARTBEAT_CHECK_MS = 1000;
    const HEARTBEAT_STALE_MS = 4000;
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

    function primeVideoCache(force) {
        const now = Date.now();
        if (
            state.videoCachePrimed &&
            !force &&
            (now - (state.lastDeepScanAt || 0)) < DEEP_RESCAN_THROTTLE_MS
        ) {
            return;
        }
        collectVideos(document, state.videos, true);
        state.videoCachePrimed = true;
        state.lastDeepScanAt = now;
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

    function removeManagedVideoAttributes() {
        const disableVideo = (video) => {
            if (!video) return;
            try {
                if (
                    video.hasAttribute('data-auto-pip-managed') ||
                    video.hasAttribute('autopictureinpicture')
                ) {
                    video.removeAttribute('autopictureinpicture');
                    video.removeAttribute('data-auto-pip-managed');
                }
            } catch (_) { }
        };

        try {
            document.querySelectorAll('video[data-auto-pip-managed], video[autopictureinpicture]')
                .forEach(disableVideo);
        } catch (_) { }

        try {
            document.querySelectorAll('*').forEach((element) => {
                if (!element.shadowRoot || !element.shadowRoot.querySelectorAll) return;
                try {
                    element.shadowRoot
                        .querySelectorAll('video[data-auto-pip-managed], video[autopictureinpicture]')
                        .forEach(disableVideo);
                } catch (_) { }
            });
        } catch (_) { }
    }

    function exitManagedPictureInPicture() {
        const attempts = [0, 100, 300, 700, 1500];
        attempts.forEach((delay) => {
            setTimeout(() => {
                let pipElement = null;
                try {
                    pipElement = document.pictureInPictureElement;
                } catch (_) { }
                if (!pipElement) return;

                let extensionManaged = true;
                try {
                    extensionManaged = pipElement.hasAttribute('data-auto-pip-managed') ||
                        pipElement.hasAttribute('autopictureinpicture') ||
                        window.__auto_pip_page_disabled__ === true;
                } catch (_) { }
                if (!extensionManaged) return;

                try {
                    if (typeof document.exitPictureInPicture === 'function') {
                        document.exitPictureInPicture().catch(() => { });
                    }
                } catch (_) { }
            }, delay);
        });
    }

    function disablePageAutoPiP(options = {}) {
        window.__auto_pip_page_disabled__ = true;
        hiddenAttemptToken += 1;

        if (state.refreshTimer != null) {
            try { clearTimeout(state.refreshTimer); } catch (_) { }
            state.refreshTimer = null;
            state.refreshDueAt = 0;
        }

        if (options.disconnectObserver === true && state.observer) {
            try { state.observer.disconnect(); } catch (_) { }
            state.observer = null;
            state.registered = false;
        }

        exitManagedPictureInPicture();
        removeManagedVideoAttributes();
        exitManagedPictureInPicture();

        if (options.clearMediaSession === true) {
            try {
                navigator.mediaSession.setActionHandler('enterpictureinpicture', null);
            } catch (_) { }
            try {
                navigator.mediaSession.playbackState = 'none';
            } catch (_) { }
        }

        return true;
    }

    window.__auto_pip_page_disable__ = disablePageAutoPiP;

    function noteHeartbeat() {
        state.lastHeartbeatAt = Date.now();
    }

    noteHeartbeat();

    if (state.heartbeatMessageListenerRegistered !== true) {
        window.addEventListener('message', (event) => {
            const data = event && event.data;
            if (!data || data.source !== 'chrome-auto-pip') return;
            if (data.type === 'auto_pip_extension_heartbeat') {
                noteHeartbeat();
            }
            if (data.type === 'auto_pip_extension_disabled') {
                disablePageAutoPiP({
                    clearMediaSession: true,
                    disconnectObserver: true
                });
            }
        }, false);
        state.heartbeatMessageListenerRegistered = true;
    }

    if (state.heartbeatTimer == null) {
        state.heartbeatTimer = setInterval(() => {
            if (isDisabled()) return;
            if ((Date.now() - (state.lastHeartbeatAt || 0)) <= HEARTBEAT_STALE_MS) return;
            disablePageAutoPiP({
                clearMediaSession: true,
                disconnectObserver: true
            });
        }, HEARTBEAT_CHECK_MS);
    }

    function findVideos(options = {}) {
        primeVideoCache(options.forceScan === true);
        pruneVideoCache();
        return Array.from(state.videos)
            .filter(video => video.readyState >= 1 && !video.disablePictureInPicture)
            .sort((a, b) => Number(isPlaying(b)) - Number(isPlaying(a)));
    }

    function syncAutoPiPAttribute(video) {
        if (!video) return;
        try {
            if (isPlaying(video)) {
                video.setAttribute('data-auto-pip-last-playing-at', String(Date.now()));
                video.setAttribute('autopictureinpicture', '');
                video.setAttribute('data-auto-pip-managed', '');
                return;
            }
            if (video.hasAttribute('data-auto-pip-managed')) {
                video.removeAttribute('autopictureinpicture');
                video.removeAttribute('data-auto-pip-managed');
            }
        } catch (_) { }
    }

    function updateVideos(options = {}) {
        if (isDisabled()) return [];
        const videos = findVideos(options);
        videos.forEach(syncAutoPiPAttribute);
        return videos;
    }

    async function enterPictureInPicture(options = {}) {
        if (isDisabled() || document.pictureInPictureElement) return false;
        const videos = updateVideos(options);
        const video = videos.find(isPlaying);
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

        [0, 100, 250, 500, 1000, 2000, 4000, 7000].forEach((delay) => {
            setTimeout(() => {
                if (hiddenAttemptToken !== token) return;
                if (document.visibilityState !== 'hidden') return;
                if (document.pictureInPictureElement) return;
                enterPictureInPicture({ forceScan: true });
            }, delay);
        });
    }

    function updatePlaybackState(options = {}) {
        if (isDisabled()) return;
        const videos = updateVideos(options);
        try {
            navigator.mediaSession.playbackState = videos.some(isPlaying) ? 'playing' : 'paused';
        } catch (_) { }
    }

    function registerHandler(options = {}) {
        if (isDisabled()) return;
        try {
            navigator.mediaSession.setActionHandler('enterpictureinpicture', enterPictureInPicture);
        } catch (_) { }
        updatePlaybackState(options);
    }

    function scheduleRefresh(delay = REFRESH_DELAY_MS) {
        const dueAt = Date.now() + delay;
        if (state.refreshTimer != null) {
            if (dueAt >= (state.refreshDueAt || 0)) return;
            clearTimeout(state.refreshTimer);
        }
        state.refreshDueAt = dueAt;
        state.refreshTimer = setTimeout(() => {
            state.refreshTimer = null;
            state.refreshDueAt = 0;
            registerHandler();
        }, delay);
    }

    if (!state.registered) {
        ['play', 'playing', 'pause', 'loadedmetadata', 'loadeddata', 'canplay'].forEach((eventName) => {
            document.addEventListener(eventName, (event) => {
                if (event.target instanceof HTMLVideoElement) {
                    rememberVideo(event.target);
                    if (eventName === 'pause' && document.visibilityState === 'visible') {
                        try { event.target.setAttribute('data-auto-pip-user-paused-at', String(Date.now())); } catch (_) { }
                    }
                    if (eventName === 'pause') {
                        syncAutoPiPAttribute(event.target);
                    }
                    scheduleRefresh();
                }
            }, true);
        });

        document.addEventListener('visibilitychange', () => {
            registerHandler({ forceScan: true });
            if (document.visibilityState === 'hidden') {
                attemptHiddenPictureInPicture();
            } else {
                hiddenAttemptToken += 1;
            }
        }, true);

        try {
            state.observer = new MutationObserver((mutations) => {
                const now = Date.now();
                const canCheckForVideos = (now - (state.lastMutationVideoCheckAt || 0)) >= MUTATION_VIDEO_CHECK_THROTTLE_MS;
                if (canCheckForVideos) {
                    state.lastMutationVideoCheckAt = now;
                }
                if (canCheckForVideos && mutationAddsVideo(mutations)) {
                    scheduleRefresh();
                    return;
                }
                // Some players create video early, then wire source/shadow state
                // through surrounding DOM churn. Rescan, but keep it throttled.
                scheduleRefresh(GENERIC_MUTATION_REFRESH_DELAY_MS);
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
