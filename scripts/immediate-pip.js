// Function to immediately request PiP when icon is clicked
function immediatelyRequestPiP() {
    console.log("=== IMMEDIATE PIP REQUEST ===");

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
        console.log("❌ No suitable video found for immediate PiP");
        return false;
    }

    const video = videos[0];
    console.log("🎥 Found video for immediate PiP:", video);

    // Start video if paused
    if (video.paused && video.readyState >= 3) {
        console.log("▶️ Starting paused video for PiP");
        video.play();
    }

    // Request PiP immediately (this has user gesture context from icon click)
    video.requestPictureInPicture().then(() => {
        video.setAttribute('__pip__', true);
        video.addEventListener('leavepictureinpicture', event => {
            video.removeAttribute('__pip__');
            console.log("📺 Left immediate PiP mode");
        }, { once: true });
        console.log("✅ Immediate PiP activated successfully!");
        return true;
    }).catch(error => {
        console.error("❌ Immediate PiP request failed:", error);
        return false;
    });
}

// Execute the function
immediatelyRequestPiP(); 