// --- [ FUNCTION: Get Video ] --- //
function hasPlayingVideo() {
  const allVideos = Array.from(document.querySelectorAll('video'));

  const videos = allVideos
    .filter(video => {
      // More lenient readyState check - allow videos that are still loading metadata
      const pass = video.readyState >= 1; // HAVE_METADATA or higher
      return pass;
    })
    .filter(video => {
      // ONLY consider videos that are actively playing for automatic PiP
      const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
      return isPlaying;
    })
    .sort((v1, v2) => {
      const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
      const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
      return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
    });

  if (videos.length === 0) return false;
  return true;
}

hasPlayingVideo();