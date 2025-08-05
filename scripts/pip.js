// --- [ FUNCTION: Get Video ] --- //
function getVideos() {
  console.log("=== PIP getVideos() START ===");

  const allVideos = Array.from(document.querySelectorAll('video'));
  console.log(`Found ${allVideos.length} video elements on page`);

  allVideos.forEach((video, index) => {
    console.log(`Video ${index}:`, {
      readyState: video.readyState,
      currentTime: video.currentTime,
      paused: video.paused,
      ended: video.ended,
      duration: video.duration,
      disablePictureInPicture: video.disablePictureInPicture,
      src: video.src || video.currentSrc || 'no src'
    });
  });

  const videos = allVideos
    .filter(video => {
      const pass = video.readyState >= 2;
      console.log(`Video readyState filter (>=2): ${pass} (readyState: ${video.readyState})`);
      return pass;
    })
    .filter(video => {
      const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
      const isReadyToPlay = video.readyState >= 3 && !video.ended && video.duration > 0;
      const pass = isPlaying || isReadyToPlay;
      console.log(`Video playback filter:`, {
        isPlaying,
        isReadyToPlay,
        pass,
        currentTime: video.currentTime,
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        duration: video.duration
      });
      return pass;
    })
    .sort((v1, v2) => {
      const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
      const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
      return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
    });

  console.log(`Final filtered videos count: ${videos.length}`);
  console.log("=== PIP getVideos() END ===");

  if (videos.length === 0) return null;
  return videos[0];
}

// --- [ FUNCTION: Req PiP Player ] --- //
async function requestPictureInPicture(video) {
  console.log("requestPictureInPicture called with video:", {
    paused: video.paused,
    readyState: video.readyState,
    currentTime: video.currentTime
  });

  // Don't start paused videos - respect user's pause action
  if (video.paused) {
    console.log("Video is paused - skipping PiP (respecting user's pause action)");
    return false;
  }

  console.log("Attempting to request Picture-in-Picture...");
  try {
    await video.requestPictureInPicture();
    console.log("Picture-in-Picture request successful");
    video.setAttribute('__pip__', true);
    video.addEventListener('leavepictureinpicture', event => {
      video.removeAttribute('__pip__');
      console.log("Left Picture-in-Picture mode");
    }, { once: true });
    new ResizeObserver(maybeUpdatePictureInPictureVideo).observe(video);
    return true;
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      console.log("PiP requires user gesture - will show prompt on current tab");
      return 'user_gesture_required';
    } else {
      console.error("Picture-in-Picture request failed:", error);
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
      console.log("Auto-PiP triggered by MediaSession API");
      const video = getVideos();
      if (video) {
        // Don't start paused videos - respect user's pause action
        if (video.paused) {
          console.log("Video is paused - skipping auto-PiP");
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

    console.log("MediaSession auto-PiP support registered");
    return true;
  } catch (error) {
    console.log("MediaSession enterpictureinpicture action not supported:", error);
    return false;
  }
}

// --- [ EXECUTE ] --- //
(async () => {
  console.log("=== PIP SCRIPT START ===");

  // Get Video
  const video = getVideos();
  console.log("getVideos() result:", video);

  if (!video) {
    console.log("No video found on page, returning false");
    return false;
  }

  console.log("Video found:", {
    tagName: video.tagName,
    readyState: video.readyState,
    currentTime: video.currentTime,
    paused: video.paused,
    duration: video.duration,
    hasPipAttribute: video.hasAttribute('__pip__')
  });

  // Setup MediaSession for automatic PiP (Chrome 134+)
  const autoPiPSupported = setupAutoPiPSupport();
  if (autoPiPSupported) {
    console.log("Auto-PiP will be available via MediaSession API");
  }

  // Exit PiP (if already in PiP)
  if (video.hasAttribute('__pip__')) {
    console.log("Video already in PiP, exiting PiP");
    exitPictureInPicture();
    return "Exit";
  }

  // Request PiP (fallback for older Chrome versions)
  console.log("Requesting PiP...");
  try {
    const pipResult = await requestPictureInPicture(video);
    console.log("PiP request result:", pipResult);
    return pipResult;
  } catch (error) {
    console.error("PiP request failed:", error);
    return false;
  }
})()