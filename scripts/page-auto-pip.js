// Browser-facing MediaSession Auto-PiP handler. Runs in the page's main world.

(function pageAutoPiP() {
    'use strict';

    if (!('mediaSession' in navigator)) return { ok: false, reason: 'no_media_session' };

    const OWNED_ATTR = 'data-auto-pip-managed';
    const ADDED_AUTOPIP_ATTR = 'data-auto-pip-added-autopictureinpicture';
    const COMPAT_ATTR = 'data-auto-pip-compat-requested';
    const LAST_PLAYING_ATTR = 'data-auto-pip-last-playing-at';
    const NATIVE_MISS_CHECK_MS = 900;
    const REARM_DELAY_MS = 100;
    const LISTENER_VERSION = 6;

    const state = window.__auto_pip_page_state__ || {
        listenersRegistered: false,
        hasPlaying: false,
        observer: null,
        videos: new Set(),
        refreshTimer: null,
        lastRegistrationLog: '',
        lastUserGestureAt: 0,
        compatAttemptToken: 0,
        nativeMissToken: 0,
        nativeMissTimer: null,
        nativeMissReported: false,
        rearmTimer: null,
        listenerVersion: 0
    };
    window.__auto_pip_page_state__ = state;
    if (!(state.videos instanceof Set)) {
        state.videos = new Set();
    }

    function debugLog(event, details = {}) {
        try {
            window.postMessage({
                source: 'chrome-auto-pip-v2-page',
                event,
                details: {
                    url: location.href,
                    visibilityState: document.visibilityState,
                    ...details
                }
            }, '*');
        } catch (_) { }
    }

    function isDisabled() {
        return window.__auto_pip_page_disabled__ === true;
    }

    function isPlaying(video) {
        return !!video && !video.paused && !video.ended && video.readyState >= 2;
    }

    function getHostname() {
        try {
            return new URL(location.href).hostname.toLowerCase();
        } catch (_) {
            return null;
        }
    }

    function collectVideos(root, videos) {
        if (!root) return;
        try {
            if (root instanceof HTMLVideoElement) videos.add(root);
        } catch (_) { }
        try {
            if (root.querySelectorAll) {
                root.querySelectorAll('video').forEach(video => videos.add(video));
            }
        } catch (_) { }
        try {
            if (!root.querySelectorAll) return;
            root.querySelectorAll('*').forEach((element) => {
                if (element && element.shadowRoot) {
                    collectVideos(element.shadowRoot, videos);
                }
            });
        } catch (_) { }
    }

    function rememberVideo(video) {
        if (!video) return;
        try {
            if (video instanceof HTMLVideoElement) {
                state.videos.add(video);
            }
        } catch (_) { }
    }

    function getVideos() {
        collectVideos(document, state.videos);
        Array.from(state.videos).forEach((video) => {
            try {
                if (!video || !video.isConnected) state.videos.delete(video);
            } catch (_) { }
        });
        return Array.from(state.videos)
            .filter(video => video && video.readyState >= 1)
            .sort((a, b) => Number(isPlaying(b)) - Number(isPlaying(a)));
    }

    function getVideoStats(videos) {
        const stats = {
            videoCount: videos.length,
            hasPlaying: videos.some(isPlaying),
            autoPipAttrCount: 0,
            ownedAttrCount: 0,
            addedAutoPipAttrCount: 0,
            playbackState: null,
            pictureInPictureEnabled: null,
            topFrame: null,
            playingMutedCount: 0,
            playingAudibleCandidateCount: 0
        };

        videos.forEach((video) => {
            try {
                if (video.hasAttribute('autopictureinpicture')) stats.autoPipAttrCount += 1;
                if (video.hasAttribute(OWNED_ATTR)) stats.ownedAttrCount += 1;
                if (video.hasAttribute(ADDED_AUTOPIP_ATTR)) stats.addedAutoPipAttrCount += 1;
                if (isPlaying(video) && video.muted) stats.playingMutedCount += 1;
                if (isPlaying(video) && !video.muted && Number(video.volume) > 0) {
                    stats.playingAudibleCandidateCount += 1;
                }
            } catch (_) { }
        });

        try { stats.playbackState = navigator.mediaSession.playbackState; } catch (_) { }
        try { stats.pictureInPictureEnabled = document.pictureInPictureEnabled === true; } catch (_) { }
        try { stats.topFrame = window.top === window; } catch (_) { }
        return stats;
    }

    function logRegistration(stats, options = {}) {
        const signature = [
            document.visibilityState,
            stats.videoCount,
            stats.hasPlaying,
            stats.autoPipAttrCount,
            stats.ownedAttrCount,
            stats.addedAutoPipAttrCount,
            stats.playbackState,
            stats.playingMutedCount,
            stats.playingAudibleCandidateCount
        ].join('|');

        if (options.force === true || signature !== state.lastRegistrationLog) {
            state.lastRegistrationLog = signature;
            debugLog('page_registration_updated', stats);
        }
    }

    function cleanupVideo(video) {
        if (!video) return;
        try {
            if (video.hasAttribute(ADDED_AUTOPIP_ATTR)) {
                video.removeAttribute('autopictureinpicture');
            }
            video.removeAttribute(ADDED_AUTOPIP_ATTR);
            video.removeAttribute(OWNED_ATTR);
            video.removeAttribute(COMPAT_ATTR);
        } catch (_) { }
    }

    function disarmVideoForRearm(video) {
        if (!video) return false;
        try {
            const wasManaged = video.hasAttribute(OWNED_ATTR) || video.hasAttribute(ADDED_AUTOPIP_ATTR);
            if (!wasManaged) return false;
            if (video.hasAttribute(ADDED_AUTOPIP_ATTR)) {
                video.removeAttribute('autopictureinpicture');
                video.removeAttribute(ADDED_AUTOPIP_ATTR);
            }
            video.removeAttribute(OWNED_ATTR);
            video.removeAttribute(COMPAT_ATTR);
            return true;
        } catch (_) {
            return false;
        }
    }

    function scheduleAutoPiPRearm(reason) {
        if (document.visibilityState !== 'visible' || isDisabled()) return;
        const videos = getVideos();
        const disarmedCount = videos.reduce((count, video) => (
            disarmVideoForRearm(video) ? count + 1 : count
        ), 0);
        if (disarmedCount === 0) return;
        debugLog('page_autopip_rearm_scheduled', { reason, disarmedCount });
        if (state.rearmTimer) {
            try { clearTimeout(state.rearmTimer); } catch (_) { }
        }
        state.rearmTimer = setTimeout(() => {
            state.rearmTimer = null;
            if (document.visibilityState !== 'visible' || isDisabled()) return;
            updateRegistration({ forceLog: true });
            debugLog('page_autopip_rearmed', { reason });
        }, REARM_DELAY_MS);
    }

    function syncVideo(video) {
        if (!video) return;
        if (isPlaying(video) && !isDisabled()) {
            try { video.setAttribute(LAST_PLAYING_ATTR, String(Date.now())); } catch (_) { }
            try {
                if (!video.hasAttribute('autopictureinpicture')) {
                    video.setAttribute('autopictureinpicture', '');
                    video.setAttribute(ADDED_AUTOPIP_ATTR, '');
                    debugLog('page_autopip_attr_added', {
                        readyState: video.readyState,
                        currentTime: video.currentTime
                    });
                }
                video.setAttribute(OWNED_ATTR, '');
            } catch (_) { }
            return;
        }

        if (video.hasAttribute(OWNED_ATTR) || video.hasAttribute(ADDED_AUTOPIP_ATTR)) {
            cleanupVideo(video);
        }
    }

    function notifyPiPState(inPictureInPicture) {
        debugLog('page_pip_state_changed', {
            inPictureInPicture: inPictureInPicture === true
        });
    }

    function attachPiPStateBridge(video) {
        if (!video || video.__autoPipPageStateBridgeVersion === LISTENER_VERSION) return;
        video.__autoPipPageStateBridgeVersion = LISTENER_VERSION;
        try {
            video.addEventListener('enterpictureinpicture', () => notifyPiPState(true));
            video.addEventListener('leavepictureinpicture', () => {
                notifyPiPState(false);
                scheduleAutoPiPRearm('leavepictureinpicture');
            });
        } catch (_) { }
    }

    function updateRegistration(options = {}) {
        if (isDisabled()) {
            getVideos().forEach(cleanupVideo);
            state.registered = false;
            clearNativeMissWatch('disabled');
            return false;
        }

        const videos = getVideos();
        videos.forEach(syncVideo);
        videos.forEach(attachPiPStateBridge);
        const hasPlaying = videos.some(isPlaying);
        try {
            navigator.mediaSession.playbackState = hasPlaying ? 'playing' : 'paused';
            navigator.mediaSession.setActionHandler('enterpictureinpicture', enterPictureInPicture);
        } catch (_) { }

        state.hasPlaying = hasPlaying;
        const stats = getVideoStats(videos);
        logRegistration(stats, { force: options.forceLog === true });
        if (!hasPlaying || document.visibilityState === 'visible') {
            clearNativeMissWatch(hasPlaying ? 'visible' : 'not_playing');
        }
        return hasPlaying;
    }

    async function enterPictureInPicture() {
        debugLog('page_enterpictureinpicture_start');
        if (isDisabled()) {
            debugLog('page_enterpictureinpicture_disabled');
            return false;
        }
        if (document.pictureInPictureElement) {
            debugLog('page_enterpictureinpicture_already_active');
            return true;
        }

        const video = getVideos().find(isPlaying);
        if (!video || typeof video.requestPictureInPicture !== 'function') {
            debugLog('page_enterpictureinpicture_no_video');
            return false;
        }

        try {
            syncVideo(video);
            attachPiPStateBridge(video);
            await video.requestPictureInPicture();
            debugLog('page_enterpictureinpicture_success', {
                readyState: video.readyState,
                currentTime: video.currentTime
            });
            return true;
        } catch (error) {
            debugLog('page_enterpictureinpicture_failed', {
                message: error && error.message ? error.message : String(error),
                userActivation: getUserActivationState()
            });
            return false;
        }
    }

    function noteUserGesture(event) {
        state.lastUserGestureAt = Date.now();
        debugLog('page_user_gesture', {
            type: event && event.type ? event.type : null
        });
    }

    function attemptCompatibilityPictureInPicture() {
        const token = (state.compatAttemptToken || 0) + 1;
        state.compatAttemptToken = token;

        (async () => {
            if (state.compatAttemptToken !== token) return;
            if (isDisabled()) return;
            if (document.visibilityState !== 'hidden') return;
            if (document.pictureInPictureElement) {
                debugLog('page_compat_auto_pip_skip', { reason: 'already_active' });
                return;
            }

            const lastGestureAt = state.lastUserGestureAt || 0;
            const gestureAgeMs = lastGestureAt ? Date.now() - lastGestureAt : null;
            const userActivation = getUserActivationState();
            if (!userActivation.isActive) {
                debugLog('page_compat_auto_pip_skip', {
                    reason: 'no_active_user_activation',
                    gestureAgeMs,
                    userActivation
                });
                return;
            }

            debugLog('page_compat_auto_pip_attempt', {
                gestureAgeMs,
                userActivation
            });
            const result = await enterPictureInPicture();
            debugLog('page_compat_auto_pip_result', {
                ok: result === true,
                userActivation: getUserActivationState()
            });
            if (result !== true) {
                debugLog('page_auto_pip_browser_blocked', {
                    reason: 'request_requires_user_gesture_after_tab_switch',
                    likelyNativeGate: 'site_auto_pip_permission_or_media_engagement',
                    userActivation: getUserActivationState()
                });
            }
        })();
    }

    function clearNativeMissWatch(reason) {
        const shouldLogClear = !!state.nativeMissTimer || state.nativeMissReported === true;
        state.nativeMissToken = (state.nativeMissToken || 0) + 1;
        if (state.nativeMissTimer) {
            try { clearTimeout(state.nativeMissTimer); } catch (_) { }
            state.nativeMissTimer = null;
        }
        if (shouldLogClear) {
            state.nativeMissReported = false;
            debugLog('page_native_auto_pip_clear', { reason });
        }
    }

    function scheduleNativeMissWatch() {
        const videos = getVideos();
        const stats = getVideoStats(videos);
        if (!stats.hasPlaying || document.visibilityState !== 'hidden') return;
        if (document.pictureInPictureElement) {
            clearNativeMissWatch('already_active');
            return;
        }

        const token = (state.nativeMissToken || 0) + 1;
        state.nativeMissToken = token;
        if (state.nativeMissTimer) {
            try { clearTimeout(state.nativeMissTimer); } catch (_) { }
        }

        state.nativeMissTimer = setTimeout(() => {
            state.nativeMissTimer = null;
            if (state.nativeMissToken !== token) return;
            if (document.visibilityState !== 'hidden') return;
            if (document.pictureInPictureElement) {
                clearNativeMissWatch('already_active');
                return;
            }

            const latestVideos = getVideos();
            const latestStats = getVideoStats(latestVideos);
            if (!latestStats.hasPlaying) {
                clearNativeMissWatch('not_playing');
                return;
            }

            state.nativeMissReported = true;
            debugLog('page_native_auto_pip_not_fired', {
                hostname: getHostname(),
                reason: 'native_auto_pip_not_fired',
                likelyReason: 'site_auto_pip_permission_or_media_engagement',
                ...latestStats
            });
        }, NATIVE_MISS_CHECK_MS);
    }

    function getUserActivationState() {
        try {
            if (!navigator.userActivation) {
                return { isActive: false, hasBeenActive: false, available: false };
            }
            return {
                isActive: navigator.userActivation.isActive === true,
                hasBeenActive: navigator.userActivation.hasBeenActive === true,
                available: true
            };
        } catch (_) {
            return { isActive: false, hasBeenActive: false, available: false };
        }
    }

    function scheduleRefresh() {
        if (state.refreshTimer) return;
        state.refreshTimer = setTimeout(() => {
            state.refreshTimer = null;
            updateRegistration();
        }, 100);
    }

    window.__auto_pip_page_disable__ = () => {
        window.__auto_pip_page_disabled__ = true;
        getVideos().forEach(cleanupVideo);
        try {
            navigator.mediaSession.playbackState = 'none';
        } catch (_) { }
        state.registered = false;
        state.hasPlaying = false;
        debugLog('page_disabled');
        return true;
    };

    if (!window.__auto_pip_page_disable_listener__) {
        window.addEventListener('message', (event) => {
            const data = event && event.data;
            if (!data || data.source !== 'chrome-auto-pip-v2-isolated') return;
            if (data.type === 'disable_auto_pip') {
                window.__auto_pip_page_disable__();
            }
        });
        window.__auto_pip_page_disable_listener__ = true;
    }

    window.__auto_pip_page_disabled__ = false;

    if (state.listenerVersion !== LISTENER_VERSION) {
        if (state.observer) {
            try { state.observer.disconnect(); } catch (_) { }
            state.observer = null;
        }

        ['play', 'playing', 'pause', 'volumechange', 'loadedmetadata', 'loadeddata', 'canplay'].forEach((eventName) => {
            document.addEventListener(eventName, (event) => {
                rememberVideo(event.target);
                scheduleRefresh();
            }, true);
        });

        document.addEventListener('visibilitychange', () => {
            const visibleAfterNativeMiss = document.visibilityState === 'visible' &&
                state.nativeMissReported === true;

            debugLog('page_visibility_changed', { visibleAfterNativeMiss });

            if (document.visibilityState === 'hidden') {
                updateRegistration({ forceLog: true });
                attemptCompatibilityPictureInPicture();
                scheduleNativeMissWatch();
            } else {
                state.compatAttemptToken = (state.compatAttemptToken || 0) + 1;
                clearNativeMissWatch('visible');
                updateRegistration({ forceLog: true });
                if (visibleAfterNativeMiss) {
                    scheduleAutoPiPRearm('visible_after_native_miss');
                }
            }
        }, true);

        ['pointerdown', 'click', 'keydown'].forEach((eventName) => {
            document.addEventListener(eventName, noteUserGesture, true);
        });

        try {
            state.observer = new MutationObserver(scheduleRefresh);
            state.observer.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true
            });
        } catch (_) { }

        state.listenersRegistered = true;
        state.listenerVersion = LISTENER_VERSION;
        debugLog('page_listeners_registered', { listenerVersion: LISTENER_VERSION });
    }

    return { ok: true, hasPlaying: updateRegistration({ forceLog: true }) };
})();
