// Options page JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    const autoPipToggle = document.getElementById('autoPipEnabled');
    const status = document.getElementById('status');

    // Load current setting
    try {
        const result = await chrome.storage.sync.get(['autoPipEnabled']);
        // Default to enabled if not set
        autoPipToggle.checked = result.autoPipEnabled !== false;
        console.log('Loaded auto-PiP setting:', autoPipToggle.checked);
    } catch (error) {
        console.error('Error loading settings:', error);
        autoPipToggle.checked = true; // Default to enabled
    }

    // Save setting when changed
    autoPipToggle.addEventListener('change', async () => {
        try {
            await chrome.storage.sync.set({
                autoPipEnabled: autoPipToggle.checked
            });

            console.log('Saved auto-PiP setting:', autoPipToggle.checked);

            // Show status message
            status.classList.add('show');
            setTimeout(() => {
                status.classList.remove('show');
            }, 2000);

        } catch (error) {
            console.error('Error saving settings:', error);
        }
    });
}); 