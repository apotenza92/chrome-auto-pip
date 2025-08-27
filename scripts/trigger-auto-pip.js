// Function to trigger automatic PiP via MediaSession API (Chrome 134+)
function triggerAutoPiP() {
    // Check if MediaSession API is supported
    if (!('mediaSession' in navigator)) {
        return false;
    }

    // Avoid double-registering listeners on reinjection
    if (window.__auto_pip_registered__) {
        return true;
    }
    window.__auto_pip_registered__ = true;

    // Helper: find currently playing videos (best-first)
    const findCurrentlyPlayingVideos = () => {
        return Array.from(document.querySelectorAll('video'))
            .filter(video => video.currentTime > 0 && !video.paused && !video.ended)
            .sort((v1, v2) => {
                const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
                const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
                return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
            });
    };

    // Register MediaSession action handler for automatic PiP regardless of current playback state
    try {
        navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
            const currentlyPlayingVideos = findCurrentlyPlayingVideos();
            if (currentlyPlayingVideos.length === 0) {
                return;
            }

            const videoToUse = currentlyPlayingVideos[0];
            try {
                if(videoToUse.hasAttribute("disablePictureInPicture")) {
                    videoToUse.removeAttribute("disablePictureInPicture");
                }
                await videoToUse.requestPictureInPicture();
                videoToUse.setAttribute('__pip__', true);
                videoToUse.addEventListener('leavepictureinpicture', event => {
                    videoToUse.removeAttribute('__pip__');

                }, { once: true });

            } catch (pipError) {
                // TODO: Handle PiP request errors: Maybe Log?
            }
        });

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
            const playing = findCurrentlyPlayingVideos();
            const state = playing.length > 0 ? 'playing' : 'paused';
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
            if (e.target && e.target.tagName === 'VIDEO') updatePlaybackStateFromAnyVideo();
        }, true);
        document.addEventListener('pause', (e) => {
            if (e.target && e.target.tagName === 'VIDEO') updatePlaybackStateFromAnyVideo();
        }, true);
        document.addEventListener('loadedmetadata', (e) => {
            if (e.target && e.target.tagName === 'VIDEO') updatePlaybackStateFromAnyVideo();
        }, true);

        // Initial state
        updatePlaybackStateFromAnyVideo();
        return true;
    } catch (error) {
        return false;
    }
}

// Execute the function
triggerAutoPiP(); 