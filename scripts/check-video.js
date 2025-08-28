(() => {
  try {
    const videos = Array.from(document.querySelectorAll('video'))
      .filter(v => v && v.disablePictureInPicture == false)
      .filter(v => v.currentTime > 0 && !v.paused && !v.ended);
    return videos.length > 0;
  } catch (e) {
    return false;
  }
})();