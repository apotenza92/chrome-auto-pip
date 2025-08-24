// --- [ FUNCTION: Get Video ] --- //
function hasPlayingVideo() {


  const allVideos = Array.from(document.querySelectorAll('video'));


  allVideos.forEach((video, index) => {

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

    return pass;
  })
  .filter(video => {
    const pass = video.disablePictureInPicture == false;

    return pass;
  })
  .filter(video => {
    // ONLY consider videos that are actively playing for automatic PiP
    const isPlaying = video.currentTime > 0 && !video.paused && !video.ended;


    isPlaying,
      currentTime: video.currentTime,
        paused: video.paused,
          ended: video.ended,
            readyState: video.readyState,
              duration: video.duration,
                autoplay: video.autoplay
  });
return isPlaying;
    })
    .sort((v1, v2) => {
  const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
  const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
  return ((v2Rect.width * v2Rect.height) - (v1Rect.width * v1Rect.height));
});



// Also log some additional page information that might help with debugging

url: window.location.href,
  title: document.title,
    readyState: document.readyState,
      hidden: document.hidden
  });



if (videos.length === 0) return false;
return true;
}

hasPlayingVideo();