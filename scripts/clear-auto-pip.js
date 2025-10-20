// Function to clear MediaSession auto-PiP handlers
function clearAutoPiPHandlers() {
    try {
        // Check if MediaSession API is supported
        if (!('mediaSession' in navigator)) {
            return { success: true, reason: "MediaSession API not supported" };
        }

        // Clear the enterpictureinpicture action handler
        navigator.mediaSession.setActionHandler("enterpictureinpicture", null);

        // Also clear any metadata to fully disconnect
        navigator.mediaSession.metadata = null;

        // Reset playback state
        navigator.mediaSession.playbackState = "none";

        // Clear other common action handlers that might interfere
        const actionHandlersToClear = ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward"];
        actionHandlersToClear.forEach(action => {
            try {
                navigator.mediaSession.setActionHandler(action, null);
            } catch (e) {
                // Ignore errors for unsupported actions
            }
        });

        // Also clear any in-page flags so re-registration on re-enable will run
        try {
            if (typeof window !== 'undefined') {
                try { delete window.__auto_pip_registered__; } catch (_) { window.__auto_pip_registered__ = false; }
            }
        } catch (_) { }

        // If we patched MediaSession to chain handlers, remove that marker too
        try {
            if (navigator.mediaSession && navigator.mediaSession.__auto_pip_patched__) {
                try { delete navigator.mediaSession.__auto_pip_patched__; } catch (_) { navigator.mediaSession.__auto_pip_patched__ = false; }
            }
        } catch (_) { }

        return { success: true, reason: "All handlers cleared" };
    } catch (error) {
        return { success: false, reason: error.message };
    }
}

// Execute the function
clearAutoPiPHandlers(); 