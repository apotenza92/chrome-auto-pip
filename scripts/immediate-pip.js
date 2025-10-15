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
        .filter(v => v.readyState >= 2)
        .filter(v => {
            const isPlaying = v.currentTime > 0 && !v.paused && !v.ended;
            const isPaused = v.currentTime > 0 && v.paused && !v.ended;
            const hasContent = v.readyState >= 2 && v.duration > 0 && !v.ended;
            return isPlaying || isPaused || hasContent;
        })
        .sort((a, b) => {
            const ar = a.getClientRects()[0] || { width: 0, height: 0 };
            const br = b.getClientRects()[0] || { width: 0, height: 0 };
            return (br.width * br.height) - (ar.width * ar.height);
        });

    if (videos.length === 0) return false;

    const video = videos[0];
    // Request PiP immediately (works with both playing and paused videos)

    try {
        const hadDisableAttr = video.hasAttribute("disablePictureInPicture");
        if (hadDisableAttr) {
            video.removeAttribute("disablePictureInPicture");
        }
        await video.requestPictureInPicture();
        video.setAttribute('__pip__', true);
        video.addEventListener('leavepictureinpicture', () => {
            video.removeAttribute('__pip__');
            if (hadDisableAttr) {
                video.setAttribute('disablePictureInPicture', '');
            }
        }, { once: true });
        return true;
    } catch (e) {
        return false;
    }
})();


