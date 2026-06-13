// Compatibility facade for older command scripts and tests.

(function exposeAutoPipUtils(root) {
    'use strict';

    if (root.__auto_pip_utils__) return;

    const content = root.AutoPipContent || {};
    const video = content.video || {};
    const pip = content.pip || {};

    root.__auto_pip_utils__ = {
        byPaintedAreaDesc: video.byPaintedAreaDesc,
        isPlaying: video.isPlaying,
        isVisible: video.isVisible,
        collectVideosDeep: video.collectVideosDeep,
        findAllVideos: video.findVideos,
        requestPiP: pip.request,
        exitPiP: async () => {
            const result = await pip.exitOwned();
            return result && result.exited === true;
        }
    };
})(window);
