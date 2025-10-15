// --- [ FUNCTION: Get Video ] --- //
function getVideos() {
  const allVideos = Array.from(document.querySelectorAll('video'));

  const videos = allVideos
    .filter(video => {
      const pass = video.readyState >= 2;
      return pass;
    })
    .filter(video => {
      const pass = video.disablePictureInPicture == false;
      return pass;
    })
    .filter(video => {
      const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
      const isReadyToPlay = video.readyState >= 3 && !video.ended && video.duration > 0;
      const pass = isPlaying || isReadyToPlay;
      return pass;
    })
    .sort((v1, v2) => {
      const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
      const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
      return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
    });

  if (videos.length === 0) return null;
  return videos[0];
}

// --- [ FUNCTION: Req PiP Player ] --- //
async function requestPictureInPicture(video) {
  // Don't start paused videos - respect user's pause action
  if (video.paused) {
    return false;
  }

  try {
    const hadDisableAttr = video.hasAttribute('disablePictureInPicture');
    if (hadDisableAttr) {
      video.removeAttribute('disablePictureInPicture');
    }
    await video.requestPictureInPicture();
    video.setAttribute('__pip__', true);
    video.addEventListener('leavepictureinpicture', event => {
      video.removeAttribute('__pip__');
      if (hadDisableAttr) {
        video.setAttribute('disablePictureInPicture', '');
      }
    }, { once: true });
    new ResizeObserver(maybeUpdatePictureInPictureVideo).observe(video);
    return true;
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      return 'user_gesture_required';
    } else {
      return false;
    }
  }
}

// --- [ FUNCTION: Update PiP Video ] --- //
function maybeUpdatePictureInPictureVideo(entries, observer) {
  const observedVideo = entries[0].target;
  if (!document.querySelector('[__pip__]')) {
    observer.unobserve(observedVideo);
    return "Update";
  }
  const video = getVideos();
  if (video && !video.hasAttribute('__pip__')) {
    observer.unobserve(observedVideo);
    requestPictureInPicture(video);
  }
}

// --- [ FUNCTION: Exit PiP ] --- //
function exitPictureInPicture() {
  try {
    if (!document.pictureInPictureElement) return false;
    document.exitPictureInPicture().then(() => { })
  }
  catch (error) { }
  return true;
}

// --- [ FUNCTION: Setup MediaSession for Auto-PiP ] --- //
function setupAutoPiPSupport() {
  try {
    // Register MediaSession action handler for automatic PiP
    navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
      const video = getVideos();
      if (video) {
        // Don't start paused videos - respect user's pause action
        if (video.paused) {
          return false;
        }

        // Request PiP - only for playing videos
        await video.requestPictureInPicture();
        video.setAttribute('__pip__', true);
        video.addEventListener('leavepictureinpicture', event => {
          video.removeAttribute('__pip__');
        }, { once: true });
        new ResizeObserver(maybeUpdatePictureInPictureVideo).observe(video);
        return true;
      }
    });

    return true;
  } catch (error) {
    return false;
  }
}

// --- [ EXECUTE ] --- //
(async () => {
  // Get Video
  const video = getVideos();
  if (!video) {
    return false;
  }

  // Setup MediaSession for automatic PiP (Chrome 134+)
  const autoPiPSupported = setupAutoPiPSupport();

  // Exit PiP (if already in PiP)
  if (video.hasAttribute('__pip__')) {
    exitPictureInPicture();
    return "Exit";
  }

  // Request PiP (fallback for older Chrome versions)
  try {
    const pipResult = await requestPictureInPicture(video);
    return pipResult;
  } catch (error) {
    return false;
  }
})()