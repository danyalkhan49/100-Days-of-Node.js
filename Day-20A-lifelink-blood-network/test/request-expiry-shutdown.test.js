const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startRequestExpiryCleanup } = require('../utils/requestExpiry');

test('request expiry stop clears its timer and waits for active cleanup', async () => {
  let releaseCleanup;
  let timerCallback;
  let clearedTimer;
  let cleanupCalls = 0;
  const cleanupInFlight = new Promise((resolve) => { releaseCleanup = resolve; });
  const timer = { unref() {} };
  const stop = startRequestExpiryCleanup({
    expire: async () => {
      cleanupCalls += 1;
      await cleanupInFlight;
      return 0;
    },
    setTimer(callback) {
      timerCallback = callback;
      return timer;
    },
    clearTimer(value) {
      clearedTimer = value;
    },
    logger: { info() {}, error() {} }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanupCalls, 1);
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  assert.strictEqual(clearedTimer, timer);
  assert.equal(typeof timerCallback, 'function');

  releaseCleanup();
  await stopping;
  assert.equal(stopped, true);
});
