(async () => {
    'use strict';

    const videoLib = window.AutoPipContent && window.AutoPipContent.video;
    const pip = window.AutoPipContent && window.AutoPipContent.pip;
    const path = 'cleanup';

    try {
        if (!pip) {
            return { ok: false, exited: false, status: 'failed', reason: 'missing_pip_lib', path };
        }

        const pipElement = document.pictureInPictureElement;
        const result = await pip.exitOwned();
        return {
            ok: result.reason !== 'pip_not_extension_managed',
            exited: result.exited === true,
            status: result.exited ? 'success' : 'skipped',
            reason: result.reason,
            path,
            video: videoLib ? videoLib.state(pipElement) : null
        };
    } catch (error) {
        return {
            ok: false,
            exited: false,
            status: 'failed',
            reason: 'exit_failed',
            path,
            message: error && error.message ? error.message : String(error),
            video: null
        };
    }
})();
