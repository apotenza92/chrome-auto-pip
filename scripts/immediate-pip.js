// Function to immediately request PiP when icon is clicked
(async () => {
    // If PiP already active on this tab, exit it
    if (document.pictureInPictureElement) {
        try {
            await document.exitPictureInPicture();
            return "toggled_off";
        } catch (e) {
            return false;
        }
    }

    // Also clear local PiP marker if present
    const pipVideo = document.querySelector('[__pip__]');
    if (pipVideo) {
        pipVideo.removeAttribute('__pip__');
        return "toggled_off";
    }

    // Find a suitable video (manual: allow playing or paused with content)
    const videos = Array.from(document.querySelectorAll('video'))
<<<<<<< HEAD
        .filter(video => video.readyState >= 2)
        .filter(video => {
            // For manual activation, include both playing and paused videos
            const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
            const isPaused = video.currentTime > 0 && video.paused && !video.ended;
            const hasContent = video.readyState >= 2 && video.duration > 0 && !video.ended;

            const pass = isPlaying || isPaused || hasContent;
            console.log(`Manual PiP video check:`, {
                isPlaying,
                isPaused,
                hasContent,
                pass,
                currentTime: video.currentTime,
                paused: video.paused,
                ended: video.ended
            });
            return pass;
=======
        .filter(v => v.readyState >= 2)
        .filter(v => v.disablePictureInPicture == false)
        .filter(v => {
            const isPlaying = v.currentTime > 0 && !v.paused && !v.ended;
            const isPaused = v.currentTime > 0 && v.paused && !v.ended;
            const hasContent = v.readyState >= 2 && v.duration > 0 && !v.ended;
            return isPlaying || isPaused || hasContent;
>>>>>>> 110258d2fe1bf70f96f11ff02e131be8e9953b14
        })
        .sort((a, b) => {
            const ar = a.getClientRects()[0] || { width: 0, height: 0 };
            const br = b.getClientRects()[0] || { width: 0, height: 0 };
            return (br.width * br.height) - (ar.width * ar.height);
        });

    if (videos.length === 0) return false;

    const video = videos[0];
<<<<<<< HEAD
    console.log("🎥 Found video for manual PiP:", {
        paused: video.paused,
        currentTime: video.currentTime,
        duration: video.duration
    });

    // Request PiP immediately (works with both playing and paused videos)
    if(video.hasAttribute("disablePictureInPicture")) {
        video.removeAttribute("disablePictureInPicture");
    }
    video.requestPictureInPicture().then(() => {
=======
    try {
        await video.requestPictureInPicture();
>>>>>>> 110258d2fe1bf70f96f11ff02e131be8e9953b14
        video.setAttribute('__pip__', true);
        video.addEventListener('leavepictureinpicture', () => {
            video.removeAttribute('__pip__');
        }, { once: true });
        return true;
    } catch (e) {
        return false;
    }
})();


