'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expectPoll(getValue, predicate, timeoutMs = 10000, intervalMs = 250) {
  const startedAt = Date.now();
  let lastValue;
  while ((Date.now() - startedAt) < timeoutMs) {
    lastValue = await getValue();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await sleep(intervalMs);
  }
  return lastValue;
}

function toDataUrl(title, bodyText) {
  return `data:text/html,<title>${encodeURIComponent(title)}</title><body style="font-family:sans-serif;padding:24px">${encodeURIComponent(bodyText)}</body>`;
}

function scaleTimeout(baseMs, scale) {
  return Math.round(baseMs * (scale || 1));
}

function withTimeout(task, timeoutMs, label = 'operation') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(() => (typeof task === 'function' ? task() : task))
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

module.exports = { sleep, expectPoll, toDataUrl, scaleTimeout, withTimeout };
