// Function to clear MediaSession auto-PiP handlers
function clearAutoPiPHandlers() {
    console.log("=== CLEARING AUTO-PIP HANDLERS ===");

    try {
        // Check if MediaSession API is supported
        if (!('mediaSession' in navigator)) {
            console.log("MediaSession API not supported - nothing to clear");
            return { success: true, reason: "MediaSession API not supported" };
        }

        // Clear the enterpictureinpicture action handler
        navigator.mediaSession.setActionHandler("enterpictureinpicture", null);
        console.log("✅ MediaSession enterpictureinpicture handler cleared");

        // Also clear any metadata to fully disconnect
        navigator.mediaSession.metadata = null;
        console.log("✅ MediaSession metadata cleared");

        // Reset playback state
        navigator.mediaSession.playbackState = "none";
        console.log("✅ MediaSession playback state reset");

        // Clear other common action handlers that might interfere
        const actionHandlersToClear = ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward"];
        actionHandlersToClear.forEach(action => {
            try {
                navigator.mediaSession.setActionHandler(action, null);
            } catch (e) {
                // Ignore errors for unsupported actions
            }
        });
        console.log("✅ Additional MediaSession handlers cleared");

        console.log("=== AUTO-PIP HANDLERS CLEARED SUCCESSFULLY ===");
        return { success: true, reason: "All handlers cleared" };
    } catch (error) {
        console.error("❌ Error clearing MediaSession handlers:", error);
        return { success: false, reason: error.message };
    }
}

// Execute the function
clearAutoPiPHandlers(); 