// Site-specific fixes registry for Auto-PiP

(function () {
    try {
        if (!Array.isArray(window.__auto_pip_site_fixes__)) {
            window.__auto_pip_site_fixes__ = [];
        }

        // Twitch
        window.__auto_pip_site_fixes__.push({
            test: /(^|\.)twitch\.tv$/,
            chainMediaSession: true,
            visibilityHiddenAttemptOnce: true,
            deferChildUntilVideo: true
        });
    } catch (_) { }
})();


