const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanupStartupFailure } = require('../utils/gracefulShutdown');

test('startup failure cleanup stops workers and closes HTTP, MongoDB, and storage', async () => {
  const calls = [];
  const startupError = new Error('synthetic startup failure');
  const server = {
    close(callback) {
      calls.push('http');
      setImmediate(callback);
    }
  };

  await assert.rejects(cleanupStartupFailure(startupError, {
    server,
    stopWorkers: [
      async () => { calls.push('worker'); }
    ],
    closeDatabase: async () => { calls.push('database'); },
    closeStorage: async () => { calls.push('storage'); },
    timeoutMs: 1_000,
    forceShutdown: () => assert.fail('startup cleanup should complete normally')
  }), (error) => error === startupError);

  assert.deepEqual(calls.sort(), ['database', 'http', 'storage', 'worker']);
});
