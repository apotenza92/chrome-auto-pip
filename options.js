// Options page JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    const autoPipToggle = document.getElementById('autoPipEnabled');
    const pipSizeSelect = document.getElementById('pipSize');
    const pipSizeSetting = document.getElementById('pipSizeSetting');
    const status = document.getElementById('status');

    // Prevent user interaction until we load
    autoPipToggle.disabled = true;
    pipSizeSelect.disabled = true;

    const allowedSizes = ['5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80'];

    function normalizePipSize(value) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return 25;
        return Math.min(80, Math.max(5, parsed));
    }

    function syncCustomSizeOption(size, customActive) {
        const value = size.toString();
        const existing = pipSizeSelect.querySelector('option[data-custom="true"]');
        const shouldShowCustom = !!customActive || !allowedSizes.includes(value);

        if (!shouldShowCustom) {
            if (existing) {
                existing.remove();
            }
            return null;
        }

        const label = 'Custom (manually resized)';
        const customValue = `custom:${value}`;
        if (existing) {
            existing.value = customValue;
            existing.textContent = label;
            return existing;
        }

        const option = document.createElement('option');
        option.value = customValue;
        option.textContent = label;
        option.dataset.custom = 'true';
        pipSizeSelect.appendChild(option);
        return option;
    }

    function applySizeSelection(size, customActive) {
        const customOption = syncCustomSizeOption(size, customActive);
        const value = size.toString();
        const shouldShowCustom = !!customActive || !allowedSizes.includes(value);

        if (shouldShowCustom && customOption) {
            pipSizeSelect.value = customOption.value;
        } else {
            pipSizeSelect.value = value;
        }
    }

    function getSelectedSize() {
        const selectedOption = pipSizeSelect.options[pipSizeSelect.selectedIndex];
        if (!selectedOption) return 25;
        const isCustom = selectedOption.dataset.custom === 'true';
        const rawValue = isCustom
            ? selectedOption.value.replace('custom:', '')
            : selectedOption.value;
        return normalizePipSize(rawValue);
    }

    async function loadSettingsWithFallback() {
        // Try fast local cache first
        try {
            const local = await chrome.storage.local.get(['autoPipEnabled', 'pipSize', 'pipSizeCustom']);
            if (typeof local.autoPipEnabled === 'boolean') {
                autoPipToggle.checked = local.autoPipEnabled;
            }
            if (typeof local.pipSize === 'number') {
                const size = normalizePipSize(local.pipSize);
                applySizeSelection(size, local.pipSizeCustom === true);
            }
        } catch (_) {
            // ignore
        }

        // Then authoritative sync storage
        try {
            const result = await chrome.storage.sync.get(['autoPipEnabled', 'pipSize', 'pipSizeCustom']);
            const enabled = result.autoPipEnabled !== false;
            const size = normalizePipSize(result.pipSize || 25);
            const customActive = result.pipSizeCustom === true;

            autoPipToggle.checked = enabled;
            applySizeSelection(size, customActive);

            // Keep local cache in sync for fast startup
            try { await chrome.storage.local.set({ autoPipEnabled: enabled, pipSize: size, pipSizeCustom: customActive }); } catch (_) { }
        } catch (_) {
            // If sync is unavailable, ensure we have sensible defaults
            if (autoPipToggle.checked !== true && autoPipToggle.checked !== false) {
                autoPipToggle.checked = true;
            }
            if (!pipSizeSelect.value) {
                pipSizeSelect.value = '25';
            }
        }

        // Check if Document PiP is supported and hide size setting if not
        if (!('documentPictureInPicture' in window)) {
            pipSizeSetting.style.display = 'none';
        }
    }

    await loadSettingsWithFallback();
    autoPipToggle.disabled = false;
    pipSizeSelect.disabled = false;

    async function saveSettings() {
        const isEnabled = autoPipToggle.checked;
        const selectedOption = pipSizeSelect.options[pipSizeSelect.selectedIndex];
        const customSelected = selectedOption && selectedOption.dataset.custom === 'true';
        const selectedValue = selectedOption ? selectedOption.value : pipSizeSelect.value;
        const rawSize = customSelected
            ? parseInt(selectedValue.replace('custom:', ''), 10)
            : parseInt(selectedValue, 10);
        const size = normalizePipSize(rawSize);
        const isPreset = allowedSizes.includes(size.toString());
        const pipSizeCustom = customSelected || !isPreset;

        applySizeSelection(size, pipSizeCustom);

        // Disable controls while saving
        autoPipToggle.disabled = true;
        pipSizeSelect.disabled = true;

        try {
            // Write to sync (authoritative)
            await chrome.storage.sync.set({ autoPipEnabled: isEnabled, pipSize: size, pipSizeCustom });
            // Mirror to local cache (best-effort)
            try { await chrome.storage.local.set({ autoPipEnabled: isEnabled, pipSize: size, pipSizeCustom }); } catch (_) { }

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
            pipSizeSelect.disabled = false;
        }
    }

    // Save settings when changed
    autoPipToggle.addEventListener('change', saveSettings);
    pipSizeSelect.addEventListener('change', saveSettings);

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'sync') return;
        const sizeChange = changes.pipSize ? changes.pipSize.newValue : undefined;
        const customChange = changes.pipSizeCustom ? changes.pipSizeCustom.newValue : undefined;
        const enabledChange = changes.autoPipEnabled ? changes.autoPipEnabled.newValue : undefined;

        if (typeof enabledChange === 'boolean') {
            autoPipToggle.checked = enabledChange;
        }

        if (typeof sizeChange === 'number' || typeof customChange === 'boolean') {
            const size = normalizePipSize(
                typeof sizeChange === 'number' ? sizeChange : getSelectedSize()
            );
            const customActive = typeof customChange === 'boolean'
                ? customChange
                : (pipSizeSelect.options[pipSizeSelect.selectedIndex]?.dataset.custom === 'true');
            applySizeSelection(size, customActive);
        }
    });
});
