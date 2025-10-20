// --- [ FUNCTION: Get Video ] --- //
function hasPlayingVideo() {
  try {
    const allVideos = Array.from(document.querySelectorAll('video'));

    if (!allVideos || allVideos.length === 0) {
      return false;
    }

    // Candidates that are PiP-eligible and at least have metadata ready
    const candidates = allVideos
      .filter((video) => typeof video.readyState === 'number' && video.readyState >= 1)
      // Allow videos even if disablePictureInPicture is set; we can temporarily remove it when requesting PiP
      .filter((video) => !!video)
      .filter((video) => {
        const rect = video.getClientRects()[0];
        return rect && rect.width > 0 && rect.height > 0; // visible area
      });

    if (candidates.length === 0) {
      return false;
    }

    // If any are actively playing, that's a strong signal
    const anyPlaying = candidates.some((video) => video.currentTime > 0 && !video.paused && !video.ended);
    if (anyPlaying) {
      return true;
    }

    // Lenient behavior per recent PR: accept presence of a visible, PiP-eligible video with metadata
    return true;
  } catch (_) {
    return false;
  }
}

hasPlayingVideo();