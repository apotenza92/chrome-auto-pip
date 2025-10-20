function checkpip() {
  function byPaintedAreaDesc(a, b) {
    const ar = a.getClientRects()[0] || { width: 0, height: 0 };
    const br = b.getClientRects()[0] || { width: 0, height: 0 };
    return (br.width * br.height) - (ar.width * ar.height);
  }

  function getEligibleVideos() {
    return Array.from(document.querySelectorAll('video'))
      .filter(video => video.readyState >= 2) // HAVE_CURRENT_DATA or higher (ready to play)
      .filter(video => video.disablePictureInPicture == false)
      .filter(video => {
        // Check if video is currently playing OR if it's ready to play and not explicitly paused
        const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;
        const isReadyToPlay = video.readyState >= 3 && !video.ended && video.duration > 0;
        return isPlaying || isReadyToPlay;
      })
      .sort(byPaintedAreaDesc);
  }

  const videos = getEligibleVideos();
  let pipCount = 0;
  videos.forEach(video => { if (video.hasAttribute('__pip__')) pipCount++; });
  if (pipCount > 0) return true; // has pip
  else return false; // no pip found
}

checkpip();