'use strict';

const { expectPoll, sleep } = require('./helpers');
const { getPlatformAdapter } = require('./platform');

function getVideoStateScript() {
  return () => {
    const video = document.querySelector('video');
    const pipEvents = window.__autoPipVerifierEvents || null;
    return {
      pip: !!document.pictureInPictureElement,
      videoExists: !!video,
      videoPlaying: video ? (!video.paused && video.currentTime > 0) : false,
      autoPipAttr: video ? video.hasAttribute('autopictureinpicture') : false,
      registered: window.__auto_pip_registered__ === true,
      title: document.title,
      hidden: document.visibilityState,
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
      currentTime: video ? video.currentTime : null,
      paused: video ? video.paused : null,
      readyState: video ? video.readyState : null,
      pipEventCount: pipEvents ? pipEvents.enterCount || 0 : 0,
      leavePipEventCount: pipEvents ? pipEvents.leaveCount || 0 : 0,
      pipEvents
    };
  };
}

function installPiPEventObserverScript() {
  return (hostClockAnchor = null) => {
    const pagePerfAnchorMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : null;
    const hostEpochAnchorMs = hostClockAnchor && Number.isFinite(Number(hostClockAnchor.hostNowEpochMs))
      ? Number(hostClockAnchor.hostNowEpochMs)
      : null;
    const clockSource = hostEpochAnchorMs != null && pagePerfAnchorMs != null
      ? hostClockAnchor.source || 'host-stage-monotonic'
      : 'guest-wall-clock';
    const nowIso = () => {
      if (hostEpochAnchorMs != null && pagePerfAnchorMs != null && typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return new Date(hostEpochAnchorMs + (performance.now() - pagePerfAnchorMs)).toISOString();
      }
      return new Date().toISOString();
    };
    const guestNowIso = () => new Date().toISOString();

    if (window.__autoPipVerifierObserverInstalled) {
      return window.__autoPipVerifierEvents || { installed: true, enterCount: 0, leaveCount: 0, events: [] };
    }

    const state = window.__autoPipVerifierEvents = window.__autoPipVerifierEvents || {
      installedAt: nowIso(),
      guestInstalledAt: guestNowIso(),
      clockSource,
      hostClockAnchor: hostClockAnchor || null,
      enterCount: 0,
      leaveCount: 0,
      events: []
    };

    const pushEvent = (type, extra = {}) => {
      state.events.push({ type, at: nowIso(), guestAt: guestNowIso(), clockSource, ...extra });
      if (state.events.length > 20) {
        state.events.shift();
      }
    };

    document.addEventListener('visibilitychange', () => {
      pushEvent('visibilitychange', { visibilityState: document.visibilityState, hidden: document.hidden });
    }, true);
    window.addEventListener('focus', () => pushEvent('window-focus'), true);
    window.addEventListener('blur', () => pushEvent('window-blur'), true);

    const attachVideoListeners = () => {
      const video = document.querySelector('video');
      if (!video || video.__autoPipVerifierListenersAttached) return;
      video.__autoPipVerifierListenersAttached = true;

      video.addEventListener('enterpictureinpicture', () => {
        state.enterCount += 1;
        pushEvent('enterpictureinpicture');
      });
      video.addEventListener('leavepictureinpicture', () => {
        state.leaveCount += 1;
        pushEvent('leavepictureinpicture');
      });
    };

    attachVideoListeners();
    const observer = new MutationObserver(() => attachVideoListeners());
    observer.observe(document.documentElement || document.body || document, { childList: true, subtree: true });

    window.__autoPipVerifierObserverInstalled = true;
    pushEvent('observer-installed');
    return state;
  };
}

function resetPiPEventObserverScript() {
  return () => {
    const previous = window.__autoPipVerifierEvents || null;
    window.__autoPipVerifierEvents = {
      installedAt: previous && previous.installedAt ? previous.installedAt : new Date().toISOString(),
      guestInstalledAt: previous && previous.guestInstalledAt ? previous.guestInstalledAt : new Date().toISOString(),
      clockSource: previous && previous.clockSource ? previous.clockSource : 'guest-wall-clock',
      hostClockAnchor: previous && previous.hostClockAnchor ? previous.hostClockAnchor : null,
      resetAt: previous && previous.clockSource === 'host-stage-monotonic' ? previous.installedAt : new Date().toISOString(),
      guestResetAt: new Date().toISOString(),
      enterCount: 0,
      leaveCount: 0,
      events: []
    };
    return window.__autoPipVerifierEvents;
  };
}

function getPiPObserverStateScript() {
  return () => window.__autoPipVerifierEvents || null;
}

async function verifyPipActivated(page, timeoutMs = 15000) {
  const result = await expectPoll(
    () => page.evaluate(getVideoStateScript()),
    (state) => !!(state && (state.pip === true || state.pipEventCount > 0)),
    timeoutMs,
    500
  );

  return {
    pip: !!(result && (result.pip || result.pipEventCount > 0)),
    method: 'playwright-focus',
    ...result
  };
}

async function verifyPipWithOsFallback(page, windowTitle, timeoutMs = 15000) {
  // First try: check if Playwright-driven focus already triggered PiP
  const playwrightResult = await verifyPipActivated(page, 5000);
  if (playwrightResult.pip) {
    return playwrightResult;
  }

  // Fallback: use OS-level focus switch via PowerShell AppActivate
  // This is needed when Playwright's chrome.windows.update doesn't trigger
  // real OS-level visibility changes in the VM
  if (windowTitle) {
    const adapter = getPlatformAdapter();
    if (adapter && adapter.focusWindow) {
      await adapter.focusWindow(windowTitle).catch(() => null);
      await sleep(500);
    }
  }

  const osResult = await expectPoll(
    () => page.evaluate(getVideoStateScript()),
    (state) => !!(state && (state.pip === true || state.pipEventCount > 0)),
    timeoutMs,
    500
  );

  return {
    pip: !!(osResult && (osResult.pip || osResult.pipEventCount > 0)),
    method: 'os-focus-fallback',
    ...osResult
  };
}

module.exports = { getVideoStateScript, installPiPEventObserverScript, resetPiPEventObserverScript, getPiPObserverStateScript, verifyPipActivated, verifyPipWithOsFallback };
