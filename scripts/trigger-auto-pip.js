// Function to trigger automatic PiP via MediaSession API (Chrome 134+)
function triggerAutoPiP() {
    console.log("=== AUTO-PIP ATTEMPT START ===");

    // Check if MediaSession API is supported
    if (!('mediaSession' in navigator)) {
        console.log("❌ MediaSession API not supported");
        return false;
    }

    // Find the main video element
    const videos = Array.from(document.querySelectorAll('video'))
        .filter(video => video.readyState >= 2)
        .filter(video => video.disablePictureInPicture == false)
        .filter(video => {
            const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
            const isReadyToPlay = video.readyState >= 3 && !video.ended && video.duration > 0;
            return isPlaying || isReadyToPlay;
        })
        .sort((v1, v2) => {
            const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
            const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
            return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
        });

    if (videos.length === 0) {
        console.log("❌ No suitable video found for auto-PiP");
        return false;
    }

    const video = videos[0];

    // Log Chrome's auto-PiP eligibility requirements
    console.log("📊 Auto-PiP Eligibility Check:");
    console.log("  ✓ Video found:", video.tagName);
    console.log("  ✓ Video playing:", !video.paused);
    console.log("  ✓ Video audible:", !video.muted && video.volume > 0);
    console.log("  ✓ Video currentTime:", video.currentTime);
    console.log("  ✓ Video duration:", video.duration);
    console.log("  ✓ Video readyState:", video.readyState);
    console.log("  ✓ Page visible:", !document.hidden);
    console.log("  ✓ Top frame:", window === window.top);

    try {
        // Register MediaSession action handler for automatic PiP
        navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
            console.log("🚀 Auto-PiP triggered by tab switch!");

            // Ensure video is playing for PiP
            if (video.paused && video.readyState >= 3) {
                console.log("▶️ Starting paused video for PiP");
                await video.play();
            }

            // Request PiP - this should work without user gesture!
            try {
                await video.requestPictureInPicture();
                video.setAttribute('__pip__', true);
                video.addEventListener('leavepictureinpicture', event => {
                    video.removeAttribute('__pip__');
                    console.log("📺 Left auto-PiP mode");
                }, { once: true });
                console.log("✅ Auto-PiP activated successfully!");
            } catch (pipError) {
                console.error("❌ Auto-PiP request failed:", pipError);
                throw pipError;
            }
        });

        console.log("✅ MediaSession auto-PiP handler registered");

        // Set comprehensive media metadata to help Chrome recognize this as a media session
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

        // Set additional MediaSession playback state to help with eligibility
        navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';

        // Add playback event listeners to keep MediaSession in sync
        video.addEventListener('play', () => {
            navigator.mediaSession.playbackState = 'playing';
            console.log("📻 MediaSession: playing");
        });
        video.addEventListener('pause', () => {
            navigator.mediaSession.playbackState = 'paused';
            console.log("📻 MediaSession: paused");
        });

        console.log("📻 MediaSession metadata and state configured");
        console.log("=== AUTO-PIP SETUP COMPLETE ===");
        return true;
    } catch (error) {
        console.error("❌ MediaSession setup failed:", error);
        return false;
    }
}

// Execute the function
triggerAutoPiP(); 