// --- [ FUNCTION: Get Video ] --- //
function hasPlayingVideo() {
  console.log("=== VIDEO DETECTION START ===");

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
      autoplay: video.autoplay,
      muted: video.muted,
      src: video.src || video.currentSrc || 'no src'
    });
  });

  const videos = allVideos
    .filter(video => {
      // More lenient readyState check - allow videos that are still loading metadata
      const pass = video.readyState >= 1; // HAVE_METADATA or higher
      console.log(`Video readyState filter (>=1): ${pass} (readyState: ${video.readyState})`);
      return pass;
    })
    .filter(video => {
      const pass = video.disablePictureInPicture == false;
      console.log(`Video PiP enabled filter: ${pass} (disablePictureInPicture: ${video.disablePictureInPicture})`);
      return pass;
    })
    .filter(video => {
      const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
      const isReadyToPlay = video.readyState >= 3 && !video.ended && video.duration > 0;
      // Check for autoplay videos that might be paused but have autoplay attribute
      const hasAutoplay = video.autoplay && !video.ended;
      // Check for videos with sufficient metadata that could be played
      const hasPlayableContent = video.readyState >= 2 && video.duration > 0 && !video.ended;

      const pass = isPlaying || isReadyToPlay || hasAutoplay || hasPlayableContent;
      console.log(`Video playback filter:`, {
        isPlaying,
        isReadyToPlay,
        hasAutoplay,
        hasPlayableContent,
        pass,
        currentTime: video.currentTime,
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        duration: video.duration,
        autoplay: video.autoplay
      });
      return pass;
    })
    .sort((v1, v2) => {
      const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
      const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
      return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
    });

  console.log(`Final filtered videos count: ${videos.length}`);

  // Also log some additional page information that might help with debugging
  console.log("Page info:", {
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    hidden: document.hidden
  });

  console.log("=== VIDEO DETECTION END ===");

  if (videos.length === 0) return false;
  return true;
}

hasPlayingVideo();