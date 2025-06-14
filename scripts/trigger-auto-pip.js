// Function to trigger automatic PiP via MediaSession API (Chrome 134+)
function triggerAutoPiP() {
    console.log("=== AUTO-PIP ATTEMPT START ===");

    // Check if MediaSession API is supported
    if (!('mediaSession' in navigator)) {
        console.log("❌ MediaSession API not supported");
        return false;
    }

    // Find the main video element with improved detection for autoplay
    const videos = Array.from(document.querySelectorAll('video'))
        .filter(video => video.readyState >= 1) // More lenient - allow HAVE_METADATA
        .filter(video => video.disablePictureInPicture == false)
        .filter(video => {
            const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
            const isReadyToPlay = video.readyState >= 3 && !video.ended && video.duration > 0;
            // Check for autoplay videos that might be paused but have autoplay attribute
            const hasAutoplay = video.autoplay && !video.ended;
            // Check for videos with sufficient metadata that could be played
            const hasPlayableContent = video.readyState >= 2 && video.duration > 0 && !video.ended;

            return isPlaying || isReadyToPlay || hasAutoplay || hasPlayableContent;
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
    console.log("  ✓ Video autoplay:", video.autoplay);
    console.log("  ✓ Video currentTime:", video.currentTime);
    console.log("  ✓ Video duration:", video.duration);
    console.log("  ✓ Video readyState:", video.readyState);
    console.log("  ✓ Page visible:", !document.hidden);
    console.log("  ✓ Top frame:", window === window.top);

    try {
        // Register MediaSession action handler for automatic PiP
        navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
            console.log("🚀 Auto-PiP triggered by tab switch!");

            // For autoplay videos, we might need to wait a bit for them to start
            let videoToUse = video;

            // If the video has autoplay but isn't playing, try to find a playing one or start it
            if (video.autoplay && video.paused && video.readyState >= 2) {
                console.log("⏯️ Autoplay video is paused, attempting to start");
                try {
                    await video.play();
                    console.log("✅ Successfully started autoplay video");
                } catch (playError) {
                    console.log("⚠️ Could not start autoplay video:", playError.message);
                    // Try to find another video that's already playing
                    const playingVideos = Array.from(document.querySelectorAll('video'))
                        .filter(v => !v.paused && v.currentTime > 0 && !v.ended);
                    if (playingVideos.length > 0) {
                        videoToUse = playingVideos[0];
                        console.log("🔄 Using already playing video instead");
                    }
                }
            }

            // Ensure video is playing for PiP
            if (videoToUse.paused && videoToUse.readyState >= 3) {
                console.log("▶️ Starting paused video for PiP");
                try {
                    await videoToUse.play();
                } catch (playError) {
                    console.log("⚠️ Could not start video for PiP:", playError.message);
                }
            }

            // Request PiP - this should work without user gesture!
            try {
                await videoToUse.requestPictureInPicture();
                videoToUse.setAttribute('__pip__', true);
                videoToUse.addEventListener('leavepictureinpicture', event => {
                    videoToUse.removeAttribute('__pip__');
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
        const updatePlaybackState = () => {
            navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';
            console.log("📻 MediaSession state updated:", video.paused ? 'paused' : 'playing');
        };

        video.addEventListener('play', updatePlaybackState);
        video.addEventListener('pause', updatePlaybackState);
        video.addEventListener('loadedmetadata', updatePlaybackState);
        video.addEventListener('canplay', updatePlaybackState);

        // For autoplay videos, also listen for when they actually start playing
        if (video.autoplay) {
            video.addEventListener('playing', () => {
                console.log("📻 Autoplay video started playing");
                updatePlaybackState();
            });
        }

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