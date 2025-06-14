// Function to clear MediaSession auto-PiP handlers
function clearAutoPiPHandlers() {
    console.log("=== CLEARING AUTO-PIP HANDLERS ===");

    try {
        // Check if MediaSession API is supported
        if (!('mediaSession' in navigator)) {
            console.log("MediaSession API not supported");
            return false;
        }

        // Clear the enterpictureinpicture action handler
        navigator.mediaSession.setActionHandler("enterpictureinpicture", null);
        console.log("✅ MediaSession enterpictureinpicture handler cleared");

        // Also clear any metadata to fully disconnect
        navigator.mediaSession.metadata = null;
        console.log("✅ MediaSession metadata cleared");

        return true;
    } catch (error) {
        console.error("❌ Error clearing MediaSession handlers:", error);
        return false;
    }
}

// Execute the function
clearAutoPiPHandlers(); 