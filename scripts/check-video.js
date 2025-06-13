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
      const pass = video.disablePictureInPicture == false;
      console.log(`Video PiP enabled filter: ${pass} (disablePictureInPicture: ${video.disablePictureInPicture})`);
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
  console.log("=== VIDEO DETECTION END ===");

  if (videos.length === 0) return false;
  return true;
}

hasPlayingVideo();