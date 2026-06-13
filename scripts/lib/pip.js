(function initPiPLib(root) {
    'use strict';

    const AutoPipContent = root.AutoPipContent || {};
    root.AutoPipContent = AutoPipContent;

    const MARKERS = AutoPipContent.markers || {
        owned: 'data-auto-pip-managed',
        addedAutoPip: 'data-auto-pip-added-autopictureinpicture',
        compatRequested: 'data-auto-pip-compat-requested',
        pip: '__pip__'
    };
    AutoPipContent.markers = MARKERS;

    function isExtensionManaged(video) {
        if (!video) return false;
        try {
            return video.hasAttribute(MARKERS.pip) ||
                video.hasAttribute(MARKERS.owned) ||
                video.hasAttribute(MARKERS.addedAutoPip) ||
                video.hasAttribute(MARKERS.compatRequested);
        } catch (_) {
            return false;
        }
    }

    function markOwned(video, options = {}) {
        if (!video) return;
        try {
            video.setAttribute(MARKERS.owned, '');
            if (options.compat === true) video.setAttribute(MARKERS.compatRequested, String(Date.now()));
            if (options.ensureAutoPipAttr === true && !video.hasAttribute('autopictureinpicture')) {
                video.setAttribute('autopictureinpicture', '');
                video.setAttribute(MARKERS.addedAutoPip, '');
            }
        } catch (_) { }
    }

    function cleanupVideo(video) {
        if (!video) return;
        try {
            if (video.hasAttribute(MARKERS.addedAutoPip)) {
                video.removeAttribute('autopictureinpicture');
            }
            video.removeAttribute(MARKERS.addedAutoPip);
            video.removeAttribute(MARKERS.owned);
            video.removeAttribute(MARKERS.compatRequested);
            video.removeAttribute(MARKERS.pip);
        } catch (_) { }
    }

    function cleanupOwnedAutoPiP(rootNode = document) {
        const cleanupRoot = (candidateRoot) => {
            if (!candidateRoot || !candidateRoot.querySelectorAll) return;
            try {
                candidateRoot
                    .querySelectorAll(`video[${MARKERS.owned}], video[${MARKERS.addedAutoPip}], video[${MARKERS.compatRequested}], video[${MARKERS.pip}]`)
                    .forEach(cleanupVideo);
            } catch (_) { }
        };

        cleanupRoot(rootNode);
        try {
            rootNode.querySelectorAll('*').forEach((element) => {
                if (element && element.shadowRoot) cleanupRoot(element.shadowRoot);
            });
        } catch (_) { }
    }

    async function request(video, options = {}) {
        const hadDisableAttr = video.hasAttribute('disablePictureInPicture');
        if (hadDisableAttr && options.allowDisablePictureInPictureOverride === true) {
            video.removeAttribute('disablePictureInPicture');
        }

        markOwned(video, {
            compat: options.compat === true,
            ensureAutoPipAttr: options.ensureAutoPipAttr === true
        });

        try {
            await video.requestPictureInPicture();
            video.setAttribute(MARKERS.pip, 'true');
            video.addEventListener('leavepictureinpicture', () => {
                try { video.removeAttribute(MARKERS.pip); } catch (_) { }
                if (hadDisableAttr && options.allowDisablePictureInPictureOverride === true) {
                    try { video.setAttribute('disablePictureInPicture', ''); } catch (_) { }
                }
            }, { once: true });
            return true;
        } catch (error) {
            if (hadDisableAttr && options.allowDisablePictureInPictureOverride === true) {
                try { video.setAttribute('disablePictureInPicture', ''); } catch (_) { }
            }
            throw error;
        }
    }

    async function exitOwned() {
        const pipElement = document.pictureInPictureElement;
        if (pipElement && isExtensionManaged(pipElement)) {
            await document.exitPictureInPicture();
            cleanupVideo(pipElement);
            try { root.__auto_pip_registered__ = false; } catch (_) { }
            return { exited: true, reason: 'exited_owned_pip' };
        }
        if (pipElement) {
            return { exited: false, reason: 'pip_not_extension_managed' };
        }

        const stale = document.querySelector(`[${MARKERS.pip}]`);
        if (stale) {
            cleanupVideo(stale);
            try { root.__auto_pip_registered__ = false; } catch (_) { }
            return { exited: false, reason: 'stale_marker_removed' };
        }

        return { exited: false, reason: 'no_active_pip' };
    }

    AutoPipContent.pip = {
        isExtensionManaged,
        markOwned,
        cleanupVideo,
        cleanupOwnedAutoPiP,
        request,
        exitOwned
    };
})(window);
