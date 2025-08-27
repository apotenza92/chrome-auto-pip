// Options page JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    const autoPipToggle = document.getElementById('autoPipEnabled');
    const status = document.getElementById('status');

    // Load current setting
    try {
        const result = await chrome.storage.sync.get(['autoPipEnabled']);
        // Default to enabled if not set
        autoPipToggle.checked = result.autoPipEnabled !== false;

    } catch (error) {

        autoPipToggle.checked = true; // Default to enabled
    }

    // Save setting when changed
    autoPipToggle.addEventListener('change', async () => {
        try {
            const isEnabled = autoPipToggle.checked;

            await chrome.storage.sync.set({
                autoPipEnabled: isEnabled
            });



            status.classList.add('show');
            setTimeout(() => {
                status.classList.remove('show');
            }, 3000);

        } catch (error) {

            status.textContent = 'Error saving settings. Please try again.';
            status.style.color = '#ef4444';
            status.classList.add('show');
            setTimeout(() => {
                status.classList.remove('show');
            }, 3000);
        }
    });
}); 