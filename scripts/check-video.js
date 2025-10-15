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
      try {
        console.debug('[auto-pip][check-video] No candidates found', {
          url: window.location.href,
          title: document.title,
          totalVideos: allVideos.length
        });
      } catch (_) { }
      return false;
    }

    // If any are actively playing, that's a strong signal
    const anyPlaying = candidates.some((video) => video.currentTime > 0 && !video.paused && !video.ended);
    if (anyPlaying) {
      try {
        const playingCount = candidates.filter((v) => v.currentTime > 0 && !v.paused && !v.ended).length;
        console.debug('[auto-pip][check-video] Playing candidates detected', { count: playingCount });
      } catch (_) { }
      return true;
    }

    // Lenient behavior per recent PR: accept presence of a visible, PiP-eligible video with metadata
    try {
      const debug = candidates.slice(0, 3).map(v => ({
        readyState: v.readyState,
        paused: v.paused,
        ended: v.ended,
        duration: v.duration,
        disablePictureInPicture: v.disablePictureInPicture,
        hasAttr: v.hasAttribute && v.hasAttribute('disablePictureInPicture')
      }));
      console.debug('[auto-pip][check-video] Lenient accept: visible metadata candidates', { count: candidates.length, debug });
    } catch (_) { }
    return true;
  } catch (_) {
    return false;
  }
}

hasPlayingVideo();