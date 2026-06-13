(function initUrlRules(root) {
  'use strict';

  const AutoPip = root.AutoPip;

  function isRestrictedUrl(url) {
    if (!url) return true;
    const restrictedProtocols = [
      'chrome:',
      'chrome-extension:',
      'chrome-search:',
      'chrome-devtools:',
      'moz-extension:',
      'edge:',
      'about:'
    ];
    return restrictedProtocols.some(protocol => url.startsWith(protocol));
  }

  function normalizeHostEntry(value) {
    if (typeof value !== 'string') return null;
    let input = value.trim().toLowerCase();
    if (!input) return null;

    let wildcard = false;
    if (input.startsWith('*.')) {
      wildcard = true;
      input = input.slice(2);
    }

    let hostname = '';
    try {
      const url = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
      hostname = url.hostname.toLowerCase();
    } catch (_) {
      hostname = input.split('/')[0].split('?')[0].split('#')[0];
    }

    hostname = hostname.split(':')[0].replace(/^\.+|\.+$/g, '');
    if (!hostname) return null;
    return wildcard ? `*.${hostname}` : hostname;
  }

  function normalizeBlocklist(entries) {
    if (!Array.isArray(entries)) return null;
    const normalized = [];
    entries.forEach((entry) => {
      const value = normalizeHostEntry(entry);
      if (!value) return;
      if (!normalized.includes(value)) normalized.push(value);
    });
    return normalized;
  }

  function getHostnameFromUrl(url) {
    if (!url || isRestrictedUrl(url)) return null;
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_) {
      return null;
    }
  }

  function isHostBlocked(hostname, patterns = AutoPip.state.autoPipSiteBlocklist) {
    if (!hostname) return false;
    const blocklist = Array.isArray(patterns) ? patterns : [];
    for (let i = 0; i < blocklist.length; i++) {
      const pattern = blocklist[i];
      if (!pattern || typeof pattern !== 'string') continue;
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2);
        if (!suffix) continue;
        if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return true;
      } else if (hostname === pattern || hostname === `www.${pattern}`) {
        return true;
      }
    }
    return false;
  }

  function isAutoPipAllowedUrl(url, patterns = AutoPip.state.autoPipSiteBlocklist) {
    const hostname = getHostnameFromUrl(url);
    if (!hostname) return false;
    return !isHostBlocked(hostname, patterns);
  }

  function isAutoPipAllowedTab(tab, patterns = AutoPip.state.autoPipSiteBlocklist) {
    if (!tab || !tab.url) return false;
    return isAutoPipAllowedUrl(tab.url, patterns);
  }

  function isValidTab(tab) {
    return !!(tab && tab.url && !isRestrictedUrl(tab.url));
  }

  AutoPip.urlRules = {
    isRestrictedUrl,
    normalizeHostEntry,
    normalizeBlocklist,
    getHostnameFromUrl,
    isHostBlocked,
    isAutoPipAllowedUrl,
    isAutoPipAllowedTab,
    isValidTab
  };

  Object.assign(root, AutoPip.urlRules);
})(globalThis);
