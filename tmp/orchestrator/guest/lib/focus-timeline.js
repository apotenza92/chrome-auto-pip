'use strict';

const { getPlatformAdapter } = require('./platform');
const { findLikelyPiPWindows } = require('./powershell');
const { getPiPObserverStateScript } = require('./pip-verifier');

function getPageFocusStateScript() {
  return () => ({
    title: document.title,
    visibilityState: document.visibilityState,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
    hidden: document.hidden,
    pictureInPicture: !!document.pictureInPictureElement
  });
}

async function captureFocusSnapshot(session, page, label) {
  const adapter = getPlatformAdapter();
  const foreground = adapter.getForegroundWindow
    ? await adapter.getForegroundWindow().catch((error) => ({ error: error.message }))
    : null;
  const backgroundState = await session.getBackgroundState().catch((error) => ({ error: error.message }));
  const pageState = page
    ? await page.evaluate(getPageFocusStateScript()).catch((error) => ({ error: error.message }))
    : null;
  const pageEvents = page
    ? await page.evaluate(getPiPObserverStateScript()).catch((error) => ({ error: error.message }))
    : null;
  const debugLog = await session.getDebugLog().catch(() => []);
  const allWindows = adapter.listTopLevelWindows
    ? await adapter.listTopLevelWindows().catch(() => [])
    : [];
  const likelyPiPWindows = adapter.key === 'windows'
    ? findLikelyPiPWindows(allWindows)
    : [];

  return {
    at: new Date().toISOString(),
    label,
    foreground,
    backgroundState,
    pageState,
    pageEvents,
    likelyPiPWindows,
    debugLogLength: Array.isArray(debugLog) ? debugLog.length : null,
    latestDebugEvents: Array.isArray(debugLog) ? debugLog.slice(-8) : []
  };
}

module.exports = {
  captureFocusSnapshot,
  getPageFocusStateScript
};
