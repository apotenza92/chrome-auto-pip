// Exit PiP when returning to the tab if the PiP window is showing
(async () => {
    try {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
            const pipVideo = document.querySelector('[__pip__]');
            if (pipVideo) {
                pipVideo.removeAttribute('__pip__');
            }
            return true;
        }
        // Also clear local marker if present
        const pipVideo = document.querySelector('[__pip__]');
        if (pipVideo) {
            pipVideo.removeAttribute('__pip__');
            return true;
        }
        return false;
    } catch (_) {
        return false;
    }
})();


