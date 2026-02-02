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

    let activeDocumentPiP = null;
    let suppressManualSaveUntil = 0;

    function getVideoAspectRatio(video) {
        if (!video) return null;
        if (video.videoWidth && video.videoHeight) {
            return video.videoWidth / video.videoHeight;
        }
        try {
            const rect = video.getBoundingClientRect();
            if (rect && rect.width && rect.height) {
                return rect.width / rect.height;
            }
        } catch (_) {
            // ignore
        }
        return null;
    }

    function setActiveDocumentPiP(pipWindow, video, displayInfo) {
        activeDocumentPiP = { pipWindow, video, displayInfo };
    }

    function clearActiveDocumentPiP(pipWindow) {
        if (!activeDocumentPiP) return;
        if (pipWindow && activeDocumentPiP.pipWindow !== pipWindow) return;
        activeDocumentPiP = null;
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

    // --- [ Document PiP Helpers ] --- //
    function supportsDocumentPiP() {
        return 'documentPictureInPicture' in window;
    }

    async function requestDocumentPiP(video, options = {}) {
        if (!supportsDocumentPiP()) {
            throw new Error('Document Picture-in-Picture not supported');
        }

        const hadDisableAttr = video.hasAttribute('disablePictureInPicture');
        if (hadDisableAttr) {
            video.removeAttribute('disablePictureInPicture');
        }

        // Store original parent and sibling for restoration
        const originalParent = video.parentNode;
        const originalNextSibling = video.nextSibling;
        const originalControls = video.controls;
        const originalStyles = {
            width: video.style.width,
            height: video.style.height,
            maxWidth: video.style.maxWidth,
            maxHeight: video.style.maxHeight,
            objectFit: video.style.objectFit,
            transform: video.style.transform
        };
        
        let { width = 400, height = 225, displayInfo: displayInfoFromOptions = null } = options;

        // Ensure minimum dimensions
        width = Math.max(width, 200);
        height = Math.max(height, 150);

        try {
            const pipWindow = await documentPictureInPicture.requestWindow({
                width,
                height
            });

            suppressManualSaveUntil = Date.now() + 1000;

            setActiveDocumentPiP(pipWindow, video, displayInfoFromOptions || null);

            try {
                if (pipWindow && typeof pipWindow.resizeTo === 'function') {
                    pipWindow.resizeTo(width, height);
                }
            } catch (_) {
                // ignore resize failures
            }

            let maxInnerWidth = 0;
            let maxInnerHeight = 0;
            let resizeSaveTimer = null;
            let lastSavedPercent = null;
            let resizePollTimer = null;
            let lastInnerWidth = 0;
            let lastInnerHeight = 0;
            const screenWidth = window.screen ? window.screen.width : 0;
            const screenHeight = window.screen ? window.screen.height : 0;
            const dpr = window.devicePixelRatio || 1;

            try {
                const requestedPct = screenWidth ? ((width / screenWidth) * 100).toFixed(1) : 'n/a';

                console.log(
                    '[auto-pip] Document PiP requested',
                    JSON.stringify({
                        requested: { width, height, percentOfScreenWidth: requestedPct },
                        screen: { width: screenWidth, height: screenHeight },
                        displayInfo: displayInfoFromOptions || null,
                        devicePixelRatio: dpr,
                        pipWindow: pipWindow ? {
                            innerWidth: pipWindow.innerWidth,
                            innerHeight: pipWindow.innerHeight,
                            outerWidth: pipWindow.outerWidth,
                            outerHeight: pipWindow.outerHeight
                        } : null
                    })
                );
            } catch (_) {
                // ignore logging failures
            }

            function logPipSize(label) {
                try {
                    const innerWidth = pipWindow.innerWidth;
                    const innerHeight = pipWindow.innerHeight;
                    const actualPct = screenWidth ? ((innerWidth / screenWidth) * 100).toFixed(1) : 'n/a';
                    const videoRect = video.getBoundingClientRect();

                    if (innerWidth > maxInnerWidth || innerHeight > maxInnerHeight) {
                        maxInnerWidth = Math.max(maxInnerWidth, innerWidth);
                        maxInnerHeight = Math.max(maxInnerHeight, innerHeight);
                    }

                    console.log(
                        `[auto-pip] Document PiP ${label}`,
                        JSON.stringify({
                            innerWidth,
                            innerHeight,
                            outerWidth: pipWindow.outerWidth,
                            outerHeight: pipWindow.outerHeight,
                            actualPercentOfScreenWidth: actualPct,
                            maxInnerWidth,
                            maxInnerHeight,
                            maxPercentOfScreenWidth: screenWidth
                                ? ((maxInnerWidth / screenWidth) * 100).toFixed(1)
                                : 'n/a',
                            videoRect: {
                                width: Math.round(videoRect.width),
                                height: Math.round(videoRect.height)
                            }
                        })
                    );
                } catch (_) {
                    // ignore
                }
            }

                function scheduleManualSizeSave() {
                    try {
                        if (!chrome || !chrome.storage || !screenWidth) return;
                        if (Date.now() < suppressManualSaveUntil) return;
                        const innerWidth = pipWindow.innerWidth;
                    const percent = Math.round((innerWidth / screenWidth) * 100);
                    const clamped = Math.min(80, Math.max(5, percent));

                    if (clamped === lastSavedPercent) return;
                    lastSavedPercent = clamped;

                    if (resizeSaveTimer) {
                        clearTimeout(resizeSaveTimer);
                    }

                    resizeSaveTimer = setTimeout(async () => {
                        try {
                            await chrome.storage.sync.set({ pipSize: clamped, pipSizeCustom: true });
                            try { await chrome.storage.local.set({ pipSize: clamped, pipSizeCustom: true }); } catch (_) { }
                        } catch (_) {
                            // ignore
                        }
                    }, 250);
                } catch (_) {
                    // ignore
                }
            }

            function recordSizeChange(label) {
                logPipSize(label);
                scheduleManualSizeSave();
            }

            setTimeout(() => {
                lastInnerWidth = pipWindow.innerWidth;
                lastInnerHeight = pipWindow.innerHeight;
                logPipSize('actual size');
            }, 150);

            try {
                if (pipWindow && typeof pipWindow.addEventListener === 'function') {
                    pipWindow.addEventListener('resize', () => {
                        recordSizeChange('resized');
                    }, { passive: true });
                }
            } catch (_) {
                // ignore
            }

            try {
                if (!resizePollTimer) {
                    resizePollTimer = setInterval(() => {
                        try {
                            const innerWidth = pipWindow.innerWidth;
                            const innerHeight = pipWindow.innerHeight;
                            if (Math.abs(innerWidth - lastInnerWidth) >= 2 || Math.abs(innerHeight - lastInnerHeight) >= 2) {
                                lastInnerWidth = innerWidth;
                                lastInnerHeight = innerHeight;
                                recordSizeChange('resized');
                            }
                        } catch (_) {
                            // ignore
                        }
                    }, 300);
                    console.log('[auto-pip] Document PiP size monitor started');
                }
            } catch (_) {
                // ignore
            }

            // Move video to PiP window
            pipWindow.document.body.appendChild(video);
            video.setAttribute('__document_pip__', 'true');
            video.controls = true;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.maxWidth = 'none';
            video.style.maxHeight = 'none';
            video.style.objectFit = 'cover';
            video.style.transform = 'none';

            // Style the PiP window
            const style = pipWindow.document.createElement('style');
            style.textContent = `
                body { 
                    margin: 0; 
                    padding: 0; 
                    background: black; 
                    overflow: hidden; 
                    display: flex;
                    align-items: stretch;
                    justify-content: stretch;
                    height: 100vh;
                    width: 100vw;
                }
                video { 
                    width: 100%; 
                    height: 100%; 
                    object-fit: cover; 
                    display: block;
                }
            `;
            pipWindow.document.head.appendChild(style);

            // Handle window close - return video to original location
            pipWindow.addEventListener('pagehide', () => {
                if (resizePollTimer) {
                    clearInterval(resizePollTimer);
                    resizePollTimer = null;
                }
                clearActiveDocumentPiP(pipWindow);
                if (originalParent) {
                    if (originalNextSibling) {
                        originalParent.insertBefore(video, originalNextSibling);
                    } else {
                        originalParent.appendChild(video);
                    }
                }
                video.removeAttribute('__document_pip__');
                video.controls = originalControls;
                video.style.width = originalStyles.width;
                video.style.height = originalStyles.height;
                video.style.maxWidth = originalStyles.maxWidth;
                video.style.maxHeight = originalStyles.maxHeight;
                video.style.objectFit = originalStyles.objectFit;
                video.style.transform = originalStyles.transform;
                if (hadDisableAttr) {
                    video.setAttribute('disablePictureInPicture', '');
                }
            }, { once: true });

            return pipWindow;

        } catch (error) {
            // If PiP fails, ensure disablePictureInPicture is restored
            if (hadDisableAttr) {
                video.setAttribute('disablePictureInPicture', '');
            }
            video.controls = originalControls;
            video.style.width = originalStyles.width;
            video.style.height = originalStyles.height;
            video.style.maxWidth = originalStyles.maxWidth;
            video.style.maxHeight = originalStyles.maxHeight;
            video.style.objectFit = originalStyles.objectFit;
            video.style.transform = originalStyles.transform;
            throw error;
        }
    }

    async function exitPiP() {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        }
        const pipVideo = document.querySelector('[__pip__]');
        if (pipVideo) {
            pipVideo.removeAttribute('__pip__');
        }

        // Check for Document PiP video
        const docPipVideo = document.querySelector('[__document_pip__]');
        if (docPipVideo) {
            docPipVideo.removeAttribute('__document_pip__');
            // Note: For Document PiP, the video has already been moved back
            // to its original position by the pagehide handler
        }

        clearActiveDocumentPiP();
    }

    // --- [ Settings Helpers ] --- //
    function normalizePipSize(value) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return 25;
        return Math.min(80, Math.max(5, parsed));
    }

    async function loadPiPSettings() {
        try {
            const result = await chrome.storage.sync.get(['pipSize']);
            let local = {};
            try { local = await chrome.storage.local.get(['displayInfo']); } catch (_) { }
            return {
                pipSize: normalizePipSize(result.pipSize || 25), // Default 25%
                displayInfo: local.displayInfo || null
            };
        } catch (error) {
            return { pipSize: 25, displayInfo: null };
        }
    }

    function calculatePiPDimensions(pipSizePercent, aspectRatio, displayInfo) {
        const baseWidth = displayInfo && typeof displayInfo.nativeWidth === 'number'
            ? displayInfo.nativeWidth
            : window.screen.width;
        const width = Math.round(baseWidth * (pipSizePercent / 100));
        const height = Math.round(width / (aspectRatio || 16 / 9));
        return { width, height };
    }

    function resizeActiveDocumentPiP(pipSizePercent, displayInfoOverride) {
        try {
            if (!Number.isFinite(pipSizePercent)) return false;
            if (!activeDocumentPiP || !activeDocumentPiP.pipWindow || !activeDocumentPiP.video) return false;

            const aspectRatio = getVideoAspectRatio(activeDocumentPiP.video) || (16 / 9);
            const displayInfo = displayInfoOverride || activeDocumentPiP.displayInfo || null;
            const { width, height } = calculatePiPDimensions(pipSizePercent, aspectRatio, displayInfo);

            if (activeDocumentPiP.pipWindow && typeof activeDocumentPiP.pipWindow.resizeTo === 'function') {
                suppressManualSaveUntil = Date.now() + 1000;
                activeDocumentPiP.pipWindow.resizeTo(width, height);
                return true;
            }
        } catch (_) {
            // ignore
        }
        return false;
    }

    function registerResizeMessageHandler() {
        if (window.__auto_pip_resize_listener__) return;
        window.__auto_pip_resize_listener__ = true;

        try {
            if (!chrome || !chrome.runtime || !chrome.runtime.onMessage) return;
            chrome.runtime.onMessage.addListener((message) => {
                if (!message || message.type !== 'auto_pip_resize') return;
                resizeActiveDocumentPiP(message.pipSize, message.displayInfo || null);
            });
        } catch (_) {
            // ignore
        }
    }

    registerResizeMessageHandler();

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
        requestDocumentPiP,
        supportsDocumentPiP,
        exitPiP,
        getActiveSiteFix,
        loadPiPSettings,
        calculatePiPDimensions
    };
})();
