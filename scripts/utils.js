// Shared utilities for Auto-PiP extension
// Attach to window so all content scripts can access them

(function () {
    'use strict';

    // Avoid re-initialization
    if (window.__auto_pip_utils__) return;

    // --- [ Video Sorting ] --- //
    function byPaintedAreaDesc(a, b) {
        const ar = a.getClientRects()[0] || { width: 0, height: 0 };
        const br = b.getClientRects()[0] || { width: 0, height: 0 };
        return (br.width * br.height) - (ar.width * ar.height);
    }

    // --- [ Video State Helpers ] --- //
    function isPlaying(video) {
        return video.currentTime > 0 && !video.paused && !video.ended;
    }

    function isVisible(video) {
        const rect = video.getClientRects()[0];
        return rect && rect.width > 0 && rect.height > 0;
    }

    // --- [ Video Discovery ] --- //
    // Deep video discovery including shadow DOM
    function collectVideosDeep(root) {
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
    }

    // Find all videos on page (including shadow DOM)
    function findAllVideos(options = {}) {
        const {
            deep = false,           // Search shadow DOM
            minReadyState = 1,      // Minimum readyState (1=HAVE_METADATA, 2=HAVE_CURRENT_DATA)
            visibleOnly = false,    // Only visible videos
            playingFirst = false,   // Sort playing videos before paused
            checkDisabled = false   // Filter out disablePictureInPicture
        } = options;

        let videos = deep
            ? collectVideosDeep(document)
            : Array.from(document.querySelectorAll('video'));

        // Filter by readyState
        videos = videos.filter(v => v && typeof v.readyState === 'number' && v.readyState >= minReadyState);

        // Filter by visibility
        if (visibleOnly) {
            videos = videos.filter(isVisible);
        }

        // Filter by disablePictureInPicture attribute
        if (checkDisabled) {
            videos = videos.filter(v => v.disablePictureInPicture === false);
        }

        // Sort by painted area (largest first)
        videos.sort(byPaintedAreaDesc);

        // Optionally prioritize playing videos
        if (playingFirst) {
            const playing = videos.filter(isPlaying);
            const rest = videos.filter(v => !isPlaying(v));
            videos = playing.concat(rest);
        }

        return videos;
    }

    // --- [ PiP Helpers ] --- //
    async function requestPiP(video) {
        const hadDisableAttr = video.hasAttribute('disablePictureInPicture');
        if (hadDisableAttr) {
            video.removeAttribute('disablePictureInPicture');
        }

        await video.requestPictureInPicture();
        video.setAttribute('__pip__', 'true');

        video.addEventListener('leavepictureinpicture', () => {
            video.removeAttribute('__pip__');
            if (hadDisableAttr) {
                video.setAttribute('disablePictureInPicture', '');
            }
        }, { once: true });

        return true;
    }

    async function exitPiP() {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        }
        const pipVideo = document.querySelector('[__pip__]');
        if (pipVideo) {
            pipVideo.removeAttribute('__pip__');
        }
    }

    // --- [ Site Fixes Helper ] --- //
    function getActiveSiteFix() {
        try {
            const fixes = Array.isArray(window.__auto_pip_site_fixes__) ? window.__auto_pip_site_fixes__ : [];
            const host = window.location && window.location.hostname;
            for (let i = 0; i < fixes.length; i++) {
                const fix = fixes[i];
                try {
                    if (fix && fix.test && fix.test.test(host)) return fix;
                } catch (_) { }
            }
        } catch (_) { }
        return null;
    }

    // --- [ Export ] --- //
    window.__auto_pip_utils__ = {
        byPaintedAreaDesc,
        isPlaying,
        isVisible,
        collectVideosDeep,
        findAllVideos,
        requestPiP,
        exitPiP,
        getActiveSiteFix
    };
})();

