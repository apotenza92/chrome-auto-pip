// Trigger automatic PiP via MediaSession API (Chrome 134+)

(async function triggerAutoPiP() {
    'use strict';

    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[auto-pip]', ...args);

    log('trigger-auto-pip.js injected', { url: location.href, isChild: window.top !== window });

    const getHostname = () => {
        try {
            return new URL(location.href).hostname.toLowerCase();
        } catch (_) {
            return null;
        }
    };

    const isHostBlocked = (hostname, patterns) => {
        if (!hostname || !Array.isArray(patterns)) return false;
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            if (!pattern || typeof pattern !== 'string') continue;
            if (pattern.startsWith('*.')) {
                const suffix = pattern.slice(2);
                if (!suffix) continue;
                if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return true;
            } else {
                if (hostname === pattern) return true;
                if (hostname === `www.${pattern}`) return true;
            }
        }
        return false;
    };

    const getBlocklist = async () => {
        if (!chrome?.storage) return [];
        const readStorage = (area) => new Promise(resolve => {
            try {
                area.get(['autoPipSiteBlocklist'], (data) => resolve(data?.autoPipSiteBlocklist));
            } catch (_) {
                resolve(null);
            }
        });

        const local = await readStorage(chrome.storage.local);
        if (Array.isArray(local)) return local;
        const sync = await readStorage(chrome.storage.sync);
        return Array.isArray(sync) ? sync : [];
    };

    const hostname = getHostname();
    if (hostname) {
        try {
            const blocklist = await getBlocklist();
            if (isHostBlocked(hostname, blocklist)) {
                window.__auto_pip_blocked__ = true;
            } else {
                window.__auto_pip_blocked__ = false;
            }
        } catch (_) { }
    }

    // Require MediaSession API
    if (!('mediaSession' in navigator)) {
        log('MediaSession API not supported');
        return false;
    }

    // Respect blocked flag for per-site disables
    if (window.__auto_pip_blocked__ === true) {
        log('Auto-PiP blocked for this site, aborting');
        return false;
    }

    // Clear the disabled flag since we're being (re-)enabled
    window.__auto_pip_disabled__ = false;

    // Avoid double-registering on reinjection
    if (window.__auto_pip_registered__) {
        log('Already registered, skipping');
        return true;
    }

    // Helper to check if auto-PiP is currently disabled
    function isDisabled() {
        return window.__auto_pip_disabled__ === true || window.__auto_pip_blocked__ === true;
    }

    // Get shared utilities (injected before this script)
    const utils = window.__auto_pip_utils__ || {};
    const { findAllVideos, isPlaying, requestPiP, supportsDocumentPiP, requestDocumentPiP, loadPiPSettings, calculatePiPDimensions, getActiveSiteFix } = utils;

    // Get site-specific fix configuration
    const ACTIVE_FIX = getActiveSiteFix ? getActiveSiteFix() : null;
    const CHAIN_MEDIA_SESSION = !!(ACTIVE_FIX && ACTIVE_FIX.chainMediaSession);
    const HIDDEN_ATTEMPT_ONCE = !!(ACTIVE_FIX && ACTIVE_FIX.visibilityHiddenAttemptOnce);
    const DEFER_CHILD_UNTIL_VIDEO = !!(ACTIVE_FIX && ACTIVE_FIX.deferChildUntilVideo);

    // Find best video for PiP (deep search, visible, playing first)
    function getEligibleVideos() {
        let videos;
        if (findAllVideos) {
            videos = findAllVideos({
                deep: true,
                minReadyState: 1,
                visibleOnly: true,
                playingFirst: true
            });
        } else {
            videos = Array.from(document.querySelectorAll('video'))
                .filter(v => v.readyState >= 1);
        }
        
        // Add autopictureinpicture attribute to eligible videos
        // This tells Chrome to auto-PiP when the tab becomes hidden
        // Only add if auto-PiP is not disabled
        if (!isDisabled()) {
            videos.forEach(v => {
                if (!v.hasAttribute('autopictureinpicture')) {
                    v.setAttribute('autopictureinpicture', '');
                    v.setAttribute('data-auto-pip-managed', '');
                    log('Added autopictureinpicture attribute to video');
                }
            });
        }
        
        return videos;
    }

    // Main registration function
    function registerAll() {
        log('registerAll() called');

        // Handler for enterPiP action
        const ensureEnterPiP = async () => {
            log('ensureEnterPiP triggered!');
            
            // Check if auto-PiP has been disabled
            if (isDisabled()) {
                log('Auto-PiP is disabled, aborting');
                return;
            }
            
            const candidates = getEligibleVideos();
            log('Found candidates:', candidates.length, candidates.map(v => ({ paused: v.paused, readyState: v.readyState })));
            
            if (candidates.length === 0) {
                log('No candidates, aborting');
                return;
            }
            if (document.pictureInPictureElement) {
                log('Already in PiP, aborting');
                return;
            }

            const video = candidates[0];
            try {
                log('Requesting PiP for video', { paused: video.paused, src: video.src?.substring(0, 50) });
                
                // Load settings for Document PiP
                let settings = { pipSize: 25 };
                if (utils.loadPiPSettings) {
                    settings = await utils.loadPiPSettings();
                }

                // Use Document PiP if supported and we have settings
                if (utils.supportsDocumentPiP && utils.requestDocumentPiP && settings.pipSize) {
                    const intrinsicRatio = video.videoWidth && video.videoHeight
                        ? (video.videoWidth / video.videoHeight)
                        : null;
                    const rect = video.getBoundingClientRect();
                    const fallbackRatio = rect.width && rect.height ? (rect.width / rect.height) : null;
                    const aspectRatio = intrinsicRatio || fallbackRatio || (16 / 9);

                    const { width, height } = utils.calculatePiPDimensions(
                        settings.pipSize,
                        aspectRatio,
                        settings.displayInfo
                    );
                    await utils.requestDocumentPiP(video, { width, height, displayInfo: settings.displayInfo || null });
                    log('Document PiP request successful');
                } else {
                    // Fallback to standard PiP
                    if (requestPiP) {
                        await requestPiP(video);
                    } else {
                        await video.requestPictureInPicture();
                    }
                    log('Standard PiP request successful');
                }
            } catch (err) {
                log('PiP request failed:', err.message);
            }
        };

        // Site-specific: Chain MediaSession handler (e.g., Twitch)
        if (CHAIN_MEDIA_SESSION && !navigator.mediaSession.__auto_pip_patched__) {
            log('Patching MediaSession.setActionHandler for chaining');
            try {
                const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
                navigator.mediaSession.setActionHandler = function (action, handler) {
                    log('setActionHandler called:', action, typeof handler);
                    if (action === 'enterpictureinpicture') {
                        const combined = async (...args) => {
                            log('Chained enterpictureinpicture handler called');
                            try { if (typeof handler === 'function') await handler(...args); } catch (_) { }
                            try { await ensureEnterPiP(); } catch (_) { }
                        };
                        return original(action, combined);
                    }
                    return original(action, handler);
                };
                navigator.mediaSession.__auto_pip_patched__ = true;
            } catch (_) { }
        }

        // Register the enterPiP handler
        log('Registering enterpictureinpicture handler');
        navigator.mediaSession.setActionHandler('enterpictureinpicture', ensureEnterPiP);

        // Provide baseline metadata for media session recognition
        navigator.mediaSession.metadata = new MediaMetadata({
            title: document.title || 'Video Content',
            artist: window.location.hostname,
            album: 'Auto-PiP Extension',
            artwork: [{
                src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="%23FF0000"/><text x="48" y="56" text-anchor="middle" fill="white" font-size="24">📺</text></svg>',
                sizes: '96x96',
                type: 'image/svg+xml'
            }]
        });

        // Sync playbackState with video state
        function updatePlaybackState() {
            // Check if auto-PiP has been disabled
            if (isDisabled()) {
                log('updatePlaybackState: Auto-PiP is disabled, skipping');
                return;
            }
            
            const candidates = getEligibleVideos();
            const hasPlaying = candidates.length > 0 && isPlaying && isPlaying(candidates[0]);
            const newState = hasPlaying ? 'playing' : 'paused';
            log('updatePlaybackState:', newState, 'candidates:', candidates.length);
            navigator.mediaSession.playbackState = newState;

            // Notify background when playback starts
            if (hasPlaying) {
                try {
                    if (chrome?.runtime?.sendMessage) {
                        chrome.runtime.sendMessage({ type: 'auto_pip_video_playing' });
                    }
                } catch (_) { }
            }
        }

        // Listen for video events
        ['play', 'pause', 'loadedmetadata'].forEach(eventType => {
            document.addEventListener(eventType, (e) => {
                if (e.target?.tagName === 'VIDEO') {
                    log('Video event:', eventType);
                    
                    // Check if auto-PiP has been disabled
                    if (isDisabled()) {
                        log('Auto-PiP is disabled, ignoring video event');
                        return;
                    }
                    
                    // Ensure autopictureinpicture attribute is set
                    if (!e.target.hasAttribute('autopictureinpicture')) {
                        e.target.setAttribute('autopictureinpicture', '');
                        log('Added autopictureinpicture on', eventType);
                    }
                    updatePlaybackState();
                }
            }, true);
        });

        // Manage MediaSession on visibility changes
        document.addEventListener('visibilitychange', () => {
            log('visibilitychange:', document.visibilityState);
            
            // Check if auto-PiP has been disabled - if so, don't do anything
            if (isDisabled()) {
                log('Auto-PiP is disabled, ignoring visibility change');
                return;
            }
            
            if (document.visibilityState === 'visible') {
                // Tab became visible - refresh MediaSession state
                log('Tab became visible, refreshing MediaSession state');
                setTimeout(() => {
                    // Re-check disabled state after timeout
                    if (isDisabled()) {
                        log('Auto-PiP disabled during timeout, aborting refresh');
                        return;
                    }
                    updatePlaybackState();
                    // Re-register our handler in case it was overwritten
                    navigator.mediaSession.setActionHandler('enterpictureinpicture', ensureEnterPiP);
                    log('MediaSession refreshed on visibility');
                }, 100);
            } else if (document.visibilityState === 'hidden') {
                // Tab becoming hidden - ensure MediaSession is properly set for auto-PiP
                log('Tab becoming hidden, ensuring MediaSession is ready');
                const candidates = getEligibleVideos();
                if (candidates.length > 0 && isPlaying && isPlaying(candidates[0])) {
                    navigator.mediaSession.playbackState = 'playing';
                    navigator.mediaSession.setActionHandler('enterpictureinpicture', ensureEnterPiP);
                    log('MediaSession set to playing before hide, handler registered');
                }
            }
        }, true);

        updatePlaybackState();

        // Site-specific: Fallback visibility-based PiP attempt (e.g., Twitch)
        // Note: With autopictureinpicture attribute, browser should handle this automatically
        // This fallback is only for cases where the browser's auto-PiP doesn't trigger
        if (HIDDEN_ATTEMPT_ONCE) {
            log('Setting up visibility-based PiP fallback');
            let lastUserGestureTime = Date.now(); // Track when we last had a user gesture
            
            // Track user gestures so we know if we can request PiP
            const trackGesture = () => {
                lastUserGestureTime = Date.now();
                log('User gesture detected');
            };
            document.addEventListener('click', trackGesture, true);
            document.addEventListener('keydown', trackGesture, true);
            
            document.addEventListener('visibilitychange', async () => {
                // Check if auto-PiP has been disabled
                if (isDisabled()) {
                    log('Auto-PiP is disabled, ignoring visibility fallback');
                    return;
                }
                
                if (document.visibilityState !== 'hidden') return;
                if (document.pictureInPictureElement) return;

                const candidates = getEligibleVideos();
                if (candidates.length === 0) return;
                
                // Ensure autopictureinpicture is set - browser should handle auto-PiP
                const video = candidates[0];
                if (!video.hasAttribute('autopictureinpicture')) {
                    video.setAttribute('autopictureinpicture', '');
                }
                
                // Only try manual fallback if we have a recent user gesture (within 5 seconds)
                const timeSinceGesture = Date.now() - lastUserGestureTime;
                if (timeSinceGesture < 5000) {
                    log('Visibility fallback - attempting with recent user gesture');
                    try {
                        if (requestPiP) {
                            await requestPiP(video);
                        } else {
                            await video.requestPictureInPicture();
                        }
                        log('Visibility fallback PiP successful');
                    } catch (err) {
                        log('Visibility fallback PiP failed:', err.message);
                    }
                } else {
                    log('No recent user gesture, relying on autopictureinpicture attribute');
                }
            }, true);
        }

        window.__auto_pip_registered__ = true;
        log('Registration complete');
        return true;
    }

    // Site-specific: Defer registration in child frames until video exists (e.g., Twitch)
    if (DEFER_CHILD_UNTIL_VIDEO) {
        const isChildFrame = window.top !== window;

        // Deep video detection including shadow DOM
        const hasDeepVideo = () => {
            const stack = [document];
            while (stack.length) {
                const root = stack.pop();
                try {
                    if (root.querySelector && root.querySelector('video')) return true;
                } catch (_) { }
                try {
                    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
                    for (let i = 0; i < all.length; i++) {
                        const el = all[i];
                        if (el && el.shadowRoot) stack.push(el.shadowRoot);
                    }
                } catch (_) { }
            }
            return false;
        };

        if (isChildFrame && !hasDeepVideo()) {
            const observer = new MutationObserver(() => {
                if (hasDeepVideo()) {
                    observer.disconnect();
                    registerAll();
                }
            });
            observer.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true
            });
            return true;
        }
    }

    // Register immediately
    return registerAll();
})();
