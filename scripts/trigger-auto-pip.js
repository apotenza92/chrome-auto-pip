// Function to trigger automatic PiP via MediaSession API (Chrome 134+)
function triggerAutoPiP() {

    // Register in all frames; action only fires in the frame owning the active media session

    // Check if MediaSession API is supported
    if (!('mediaSession' in navigator)) {
        return false;
    }

    // (moved) Child-frame defer is handled below after registerAll is defined

    // Avoid double-registering listeners on reinjection
    if (window.__auto_pip_registered__) {
        return true;
    }

    // Small helpers
    function getActiveSiteFix() {
        try {
            const fixes = Array.isArray(window.__auto_pip_site_fixes__) ? window.__auto_pip_site_fixes__ : [];
            const host = window.location && window.location.hostname;
            for (let i = 0; i < fixes.length; i++) {
                const fix = fixes[i];
                try { if (fix && fix.test && fix.test.test(host)) return fix; } catch (_) { }
            }
        } catch (_) { }
        return null;
    }
    const ACTIVE_FIX = getActiveSiteFix();
    const CHAIN_MEDIA_SESSION = !!(ACTIVE_FIX && ACTIVE_FIX.chainMediaSession === true);
    const HIDDEN_ATTEMPT_ONCE = !!(ACTIVE_FIX && ACTIVE_FIX.visibilityHiddenAttemptOnce === true);
    const DEFER_CHILD_UNTIL_VIDEO = !!(ACTIVE_FIX && ACTIVE_FIX.deferChildUntilVideo === true);
    const byPaintedAreaDesc = (a, b) => {
        const ar = a.getClientRects()[0] || { width: 0, height: 0 };
        const br = b.getClientRects()[0] || { width: 0, height: 0 };
        return (br.width * br.height) - (ar.width * ar.height);
    };

    const isPlaying = v => v.currentTime > 0 && !v.paused && !v.ended;

    // Helper: deep video discovery (includes open shadow roots)
    const findEligibleVideos = () => {
        const collectVideosDeep = (root) => {
            const found = [];
            try { found.push(...root.querySelectorAll('video')); } catch (_) { }
            try {
                const all = root.querySelectorAll('*');
                for (let i = 0; i < all.length; i++) {
                    const el = all[i];
                    if (el && el.shadowRoot) {
                        try { found.push(...collectVideosDeep(el.shadowRoot)); } catch (_) { }
                    }
                }
            } catch (_) { }
            return found;
        };

        const list = collectVideosDeep(document)
            .filter(v => !!v)
            .filter(v => typeof v.readyState === 'number' && v.readyState >= 1)
            .filter(v => {
                const r = v.getClientRects()[0];
                return r && r.width > 0 && r.height > 0;
            });

        // Sort by painted area, playing videos first
        const playing = list.filter(v => isPlaying(v)).sort(byPaintedAreaDesc);
        const rest = list.filter(v => !isPlaying(v)).sort(byPaintedAreaDesc);
        return playing.concat(rest);
    };

    // Register MediaSession action handler for automatic PiP regardless of current playback state
    try {

        const setEnterPiPHandler = () => {
            try {
                const ensureEnterPiP = async () => {
                    const candidates = findEligibleVideos();
                    if (candidates.length === 0) return;
                    if (document.pictureInPictureElement) return;
                    const videoToUse = candidates[0];
                    try {
                        const hadDisableAttr = videoToUse.hasAttribute("disablePictureInPicture");
                        if (hadDisableAttr) {
                            videoToUse.removeAttribute("disablePictureInPicture");
                        }
                        await videoToUse.requestPictureInPicture();
                        videoToUse.setAttribute('__pip__', true);
                        videoToUse.addEventListener('leavepictureinpicture', event => {
                            videoToUse.removeAttribute('__pip__');
                            if (hadDisableAttr) {
                                videoToUse.setAttribute('disablePictureInPicture', '');
                            }
                        }, { once: true });
                    } catch (pipError) {
                    }
                };

                try {
                    if (CHAIN_MEDIA_SESSION && !navigator.mediaSession.__auto_pip_patched__) {
                        const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
                        navigator.mediaSession.setActionHandler = function (action, handler) {
                            if (action === "enterpictureinpicture") {
                                const combined = async (...args) => {
                                    try { if (typeof handler === 'function') { await handler(...args); } } catch (_) { }
                                    try { await ensureEnterPiP(); } catch (_) { }
                                };
                                return original(action, combined);
                            }
                            return original(action, handler);
                        };
                        navigator.mediaSession.__auto_pip_patched__ = true;
                    }
                } catch (_) { }

                navigator.mediaSession.setActionHandler("enterpictureinpicture", ensureEnterPiP);
                // Clean implementation: no extra activation listeners
            } catch (e) {
            }
        };

        const registerAll = () => {
            setEnterPiPHandler();

            // Provide baseline metadata so the page is recognized as a media session early
            navigator.mediaSession.metadata = new MediaMetadata({
                title: document.title || 'Video Content',
                artist: window.location.hostname,
                album: 'Auto-PiP Extension',
                artwork: [
                    {
                        src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="%23FF0000"/><text x="48" y="56" text-anchor="middle" fill="white" font-size="24">📺</text></svg>',
                        sizes: '96x96',
                        type: 'image/svg+xml'
                    }
                ]
            });

            // Keep playbackState loosely in sync across any videos on the page
            const updatePlaybackStateFromAnyVideo = () => {
                const candidates = findEligibleVideos();
                const state = candidates.length > 0 && isPlaying(candidates[0]) ? 'playing' : 'paused';
                navigator.mediaSession.playbackState = state;

                // Notify background once when playback starts so it can set targetTab immediately
                if (state === 'playing') {
                    try {
                        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                            chrome.runtime.sendMessage({ type: 'auto_pip_video_playing' });
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            };

            // Listen for play/pause events bubbling from any video
            document.addEventListener('play', (e) => {
                if (e.target && e.target.tagName === 'VIDEO') {
                    updatePlaybackStateFromAnyVideo();
                    setEnterPiPHandler();
                }
            }, true);
            document.addEventListener('pause', (e) => {
                if (e.target && e.target.tagName === 'VIDEO') {
                    updatePlaybackStateFromAnyVideo();
                    setEnterPiPHandler();
                }
            }, true);
            document.addEventListener('loadedmetadata', (e) => {
                if (e.target && e.target.tagName === 'VIDEO') {
                    updatePlaybackStateFromAnyVideo();
                    setEnterPiPHandler();
                }
            }, true);

            // Initial state
            updatePlaybackStateFromAnyVideo();

            try {
                if (HIDDEN_ATTEMPT_ONCE) {
                    document.addEventListener('visibilitychange', async () => {
                        if (document.visibilityState !== 'hidden') return;
                        if (document.pictureInPictureElement) return;
                        const candidates = findEligibleVideos();
                        if (candidates.length === 0) return;
                        const video = candidates[0];
                        try {
                            const hadDisableAttr = video.hasAttribute('disablePictureInPicture');
                            if (hadDisableAttr) video.removeAttribute('disablePictureInPicture');
                            await video.requestPictureInPicture();
                            video.setAttribute('__pip__', true);
                            video.addEventListener('leavepictureinpicture', () => {
                                video.removeAttribute('__pip__');
                                if (hadDisableAttr) video.setAttribute('disablePictureInPicture', '');
                            }, { once: true });
                        } catch (_) { }
                    }, true);
                }
            } catch (_) { }

            // Mark as fully registered
            window.__auto_pip_registered__ = true;
            return true;
        };
        // In child frames, defer until a <video> exists (deep scan) to avoid premature no-op registration
        try {
            if (DEFER_CHILD_UNTIL_VIDEO) {
                const isChild = !!(window.top && window.top !== window);
                const hasDeepVideo = (function () {
                    const stack = [document];
                    while (stack.length) {
                        const root = stack.pop();
                        try { if (root.querySelector && root.querySelector('video')) return true; } catch (_) { }
                        try {
                            const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
                            for (let i = 0; i < all.length; i++) {
                                const el = all[i];
                                if (el && el.shadowRoot) stack.push(el.shadowRoot);
                            }
                        } catch (_) { }
                    }
                    return false;
                })();
                if (isChild && !hasDeepVideo) {
                    const observer = new MutationObserver(() => {
                        const nowHasVideo = (function () {
                            const stack = [document];
                            while (stack.length) {
                                const root = stack.pop();
                                try { if (root.querySelector && root.querySelector('video')) return true; } catch (_) { }
                                try {
                                    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
                                    for (let i = 0; i < all.length; i++) {
                                        const el = all[i];
                                        if (el && el.shadowRoot) stack.push(el.shadowRoot);
                                    }
                                } catch (_) { }
                            }
                            return false;
                        })();
                        if (nowHasVideo) {
                            try { observer.disconnect(); } catch (_) { }
                            registerAll();
                        }
                    });
                    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
                    return true;
                }
            }
        } catch (_) { }

        // Always register immediately when appropriate frame has/owns media
        registerAll();

    } catch (error) {
        return false;
    }
}

// Execute the function
triggerAutoPiP(); 