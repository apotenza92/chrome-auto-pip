'use strict';

const WINDOW_ID_NONE = -1;

function buildVerdict(checks) {
  const failed = checks.filter((c) => !c.passed);
  return {
    ok: failed.length === 0,
    checks,
    failedChecks: failed.map((c) => c.name),
    summary: failed.length === 0
      ? `All ${checks.length} checks passed`
      : `${failed.length}/${checks.length} failed: ${failed.map((c) => c.name).join(', ')}`
  };
}

function judgeWindowScenario({ appliedSettings, beforePlay, primedFlags, afterState, targetWindowId, logEntries, pipResult }) {
  const events = Array.isArray(logEntries) ? logEntries : [];

  const sawCandidate = events.some((e) =>
    e && (e.event === 'windowFocusChangedWindowSwitchCandidate' || e.event === 'windowFocusChangedWindowSwitchViaNone')
  );
  const sawPlayback = events.some((e) =>
    e && e.event === 'windowLostFocusPlaybackResult' && e.details && e.details.isPlaying === true
  );
  const sawTrigger = events.some((e) =>
    e && e.event === 'windowLostFocusTriggerInjected'
  );

  return buildVerdict([
    {
      name: 'settingsApplied',
      passed: !!(appliedSettings && appliedSettings.autoPipOnWindowSwitch === true),
      evidence: appliedSettings
    },
    {
      name: 'videoPlaying',
      passed: !!(beforePlay && (beforePlay.videoPlaying === true || (beforePlay.video && beforePlay.video.paused === false))),
      evidence: beforePlay
    },
    {
      name: 'tabRegistered',
      passed: !!(primedFlags && primedFlags.registered === true),
      evidence: primedFlags
    },
    {
      name: 'focusChanged',
      passed: !!(
        afterState && (
          afterState.lastFocusedWindowId === targetWindowId ||
          afterState.lastFocusedNormalWindowId === targetWindowId
        )
      ),
      evidence: {
        lastFocusedWindowId: afterState && afterState.lastFocusedWindowId,
        lastFocusedNormalWindowId: afterState && afterState.lastFocusedNormalWindowId,
        expected: targetWindowId
      }
    },
    {
      name: 'candidateDetected',
      passed: sawCandidate,
      evidence: { sawCandidate }
    },
    {
      name: 'playbackConfirmed',
      passed: sawPlayback,
      evidence: { sawPlayback }
    },
    {
      name: 'triggerInjected',
      passed: sawTrigger,
      evidence: { sawTrigger }
    },
    {
      name: 'pipActivated',
      passed: !!(pipResult && pipResult.pip === true),
      evidence: pipResult
    }
  ]);
}

function judgeAppScenario({ appliedSettings, beforePlay, primedFlags, afterState, logEntries, pipResult, platform, appInstance, finalForeground }) {
  const events = Array.isArray(logEntries) ? logEntries : [];

  const sawCandidate = events.some((e) =>
    e && e.event === 'windowFocusChangedAppSwitchCandidate'
  );
  const sawDebounce = events.some((e) =>
    e && e.event === 'appSwitchDebounceFired'
  );
  const sawTrigger = events.some((e) =>
    e && e.event === 'windowLostFocusTriggerInjected'
  );

  const baseChecks = [
    {
      name: 'settingsApplied',
      passed: !!(appliedSettings && appliedSettings.autoPipOnAppSwitch === true),
      evidence: appliedSettings
    },
    {
      name: 'videoPlaying',
      passed: !!(beforePlay && (beforePlay.videoPlaying === true || (beforePlay.video && beforePlay.video.paused === false))),
      evidence: beforePlay
    },
    {
      name: 'tabRegistered',
      passed: !!(primedFlags && primedFlags.registered === true),
      evidence: primedFlags
    }
  ];

  const measurementChecks = [
    {
      name: 'focusLostToApp',
      passed: !!(afterState && afterState.lastFocusedWindowId === WINDOW_ID_NONE),
      evidence: { lastFocusedWindowId: afterState && afterState.lastFocusedWindowId }
    },
    {
      name: 'candidateDetected',
      passed: sawCandidate,
      evidence: { sawCandidate }
    },
    {
      name: 'debounceFired',
      passed: sawDebounce,
      evidence: { sawDebounce }
    },
    {
      name: 'triggerInjected',
      passed: sawTrigger,
      evidence: { sawTrigger }
    },
    {
      name: 'pipActivated',
      passed: !!(pipResult && pipResult.pip === true),
      evidence: pipResult
    }
  ];

  if (platform === 'linux') {
    const executionChecks = [
      ...baseChecks,
      {
        name: 'appLaunched',
        passed: !!(appInstance && appInstance.ok),
        evidence: appInstance
      },
      {
        name: 'appSurfaced',
        passed: !!(
          (appInstance && appInstance.editorWindow && appInstance.editorWindow.id) ||
          (finalForeground && finalForeground.title)
        ),
        evidence: {
          editorWindow: appInstance && appInstance.editorWindow,
          finalForeground
        }
      }
    ];

    const hardFailures = executionChecks.filter((check) => !check.passed);
    const observedMeasurements = measurementChecks.filter((check) => check.passed).map((check) => check.name);
    const unobservedMeasurements = measurementChecks.filter((check) => !check.passed).map((check) => check.name);

    return {
      ok: hardFailures.length === 0,
      checks: [
        ...executionChecks,
        ...measurementChecks.map((check) => ({ ...check, advisory: true }))
      ],
      failedChecks: hardFailures.map((check) => check.name),
      summary: hardFailures.length === 0
        ? (
          observedMeasurements.length > 0
            ? `Linux app-switch scenario executed; observed ${observedMeasurements.join(', ')}; unobserved: ${unobservedMeasurements.join(', ') || 'none'}`
            : 'Linux app-switch scenario executed successfully, but Linux did not expose app-switch focus/debug/PiP measurements in this run'
        )
        : `${hardFailures.length}/${executionChecks.length} required checks failed: ${hardFailures.map((check) => check.name).join(', ')}`,
      observedMeasurements,
      unobservedMeasurements
    };
  }

  return buildVerdict([
    ...baseChecks,
    ...measurementChecks
  ]);
}

function summarizeLog(logEntries) {
  const interesting = (Array.isArray(logEntries) ? logEntries : []).filter((entry) => {
    const event = entry && entry.event;
    return typeof event === 'string' && (
      event.includes('windowFocusChanged') ||
      event.includes('windowLostFocus') ||
      event.includes('appSwitch') ||
      event.includes('fallback') ||
      event.includes('primeActiveTab')
    );
  });

  return interesting.slice(-20);
}

module.exports = { buildVerdict, judgeWindowScenario, judgeAppScenario, summarizeLog };
