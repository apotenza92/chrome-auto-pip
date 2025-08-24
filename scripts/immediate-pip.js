// Function to immediately request PiP when icon is clicked
async function immediatelyRequestPiP() {


    // Check if PiP is active on current tab
    if (document.pictureInPictureElement) {

        try {
            document.exitPictureInPicture();

            return "toggled_off";
        } catch (error) {

            return false;
        }
    }

    // Also check for local PiP markers on current tab
    const pipVideo = document.querySelector('[__pip__]');
    if (pipVideo) {

        pipVideo.removeAttribute('__pip__');

        return "toggled_off";
    }

    // No PiP active on current tab, proceed with activation


    // Find any video that can support PiP (both playing and paused for manual activation)
    const videos = Array.from(document.querySelectorAll('video'))
        .filter(video => video.readyState >= 2)
        .filter(video => video.disablePictureInPicture == false)
        .filter(video => {
            // For manual activation, include both playing and paused videos
            const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
            const isPaused = video.currentTime > 0 && video.paused && !video.ended;
            const hasContent = video.readyState >= 2 && video.duration > 0 && !video.ended;

            const pass = isPlaying || isPaused || hasContent;

            isPlaying,
                isPaused,
                hasContent,
                pass,
                currentTime: video.currentTime,
                    paused: video.paused,
                        ended: video.ended
        });
    return pass;
})
        .sort((v1, v2) => {
    const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
    const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
    return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
});

if (videos.length === 0) {

    return false;
}

const video = videos[0];

paused: video.paused,
    currentTime: video.currentTime,
        duration: video.duration
    });

// Request PiP immediately (works with both playing and paused videos)
video.requestPictureInPicture().then(() => {
    video.setAttribute('__pip__', true);
    video.addEventListener('leavepictureinpicture', event => {
        video.removeAttribute('__pip__');

    }, { once: true });

    return true;
}).catch(error => {

    return false;
});
}

// Execute the function
immediatelyRequestPiP(); 