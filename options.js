// Options page JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    const autoPipToggle = document.getElementById('autoPipEnabled');
    const status = document.getElementById('status');

    // Prevent user interaction until we load
    autoPipToggle.disabled = true;

    async function loadSettingWithFallback() {
        // Try fast local cache first
        try {
            const local = await chrome.storage.local.get(['autoPipEnabled']);
            if (typeof local.autoPipEnabled === 'boolean') {
                autoPipToggle.checked = local.autoPipEnabled;
            }
        } catch (_) {
            // ignore
        }

        // Then authoritative sync storage (default enabled)
        try {
            const result = await chrome.storage.sync.get(['autoPipEnabled']);
            const enabled = result.autoPipEnabled !== false;
            autoPipToggle.checked = enabled;

            // Keep local cache in sync for fast startup
            try { await chrome.storage.local.set({ autoPipEnabled: enabled }); } catch (_) { }
        } catch (_) {
            // If sync is unavailable, ensure we have a sensible default
            if (autoPipToggle.checked !== true && autoPipToggle.checked !== false) {
                autoPipToggle.checked = true;
            }
        }
    }

    await loadSettingWithFallback();
    autoPipToggle.disabled = false;

    // Save setting when changed
    autoPipToggle.addEventListener('change', async () => {
        const isEnabled = autoPipToggle.checked;
        autoPipToggle.disabled = true; // prevent rapid toggles while saving
        try {
            // Write to sync (authoritative)
            await chrome.storage.sync.set({ autoPipEnabled: isEnabled });
            // Mirror to local cache (best-effort)
            try { await chrome.storage.local.set({ autoPipEnabled: isEnabled }); } catch (_) { }

            status.textContent = 'Settings saved!';
            status.style.color = '#10b981';
            status.classList.add('show');
            setTimeout(() => { status.classList.remove('show'); }, 2000);
        } catch (error) {
            status.textContent = 'Error saving settings. Please try again.';
            status.style.color = '#ef4444';
            status.classList.add('show');
            setTimeout(() => { status.classList.remove('show'); }, 3000);
        } finally {
            autoPipToggle.disabled = false;
        }
    });
});