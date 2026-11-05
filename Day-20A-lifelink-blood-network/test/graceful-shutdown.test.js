const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGracefulShutdown } = require('../utils/gracefulShutdown');

function fakeServer({ closeCallback = true } = {}) {
  const calls = [];
  return {
    calls,
    close(callback) {
      calls.push('close');
      if (closeCallback) setImmediate(callback);
    },
    closeAllConnections() {
      calls.push('closeAllConnections');
    }
  };
}

test('graceful shutdown stops accepting requests, workers, database, and storage once', async () => {
  const events = [];
  const server = fakeServer();
  const shutdown = createGracefulShutdown({
    server,
    stopWorkers: [
      async () => { events.push('worker-1'); },
      async () => { events.push('worker-2'); }
    ],
    closeDatabase: async () => { events.push('database'); },
    closeStorage: async () => { events.push('storage'); },
    timeoutMs: 1000,
    forceShutdown: () => { throw new Error('forced shutdown should not run'); },
    removeSignalHandlers: () => events.push('remove-handlers')
  });

  const firstShutdown = shutdown.shutdown();
  const secondShutdown = shutdown.shutdown();
  assert.strictEqual(secondShutdown, firstShutdown);
  await firstShutdown;

  assert.deepEqual(server.calls, ['close']);
  assert.deepEqual(events.sort(), [
    'database',
    'remove-handlers',
    'storage',
    'worker-1',
    'worker-2'
  ]);
});

test('shutdown waits for in-flight workers before closing MongoDB and storage', async () => {
  const events = [];
  let releaseWorker;
  const workerInFlight = new Promise((resolve) => { releaseWorker = resolve; });
  const server = fakeServer();
  const shutdown = createGracefulShutdown({
    server,
    stopWorkers: [async () => {
      events.push('worker-stop-start');
      await workerInFlight;
      events.push('worker-stop-done');
    }],
    closeDatabase: async () => { events.push('database'); },
    closeStorage: async () => { events.push('storage'); },
    timeoutMs: 1000,
    forceShutdown: () => { throw new Error('forced shutdown should not run'); }
  });

  const pendingShutdown = shutdown.shutdown();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['worker-stop-start']);
  releaseWorker();
  await pendingShutdown;
  assert.deepEqual(events, ['worker-stop-start', 'worker-stop-done', 'database', 'storage']);
});

test('shutdown forces remaining HTTP connections closed at its deadline', async () => {
  const server = fakeServer({ closeCallback: false });
  const events = [];
  const shutdown = createGracefulShutdown({
    server,
    stopWorkers: [() => new Promise(() => {})],
    closeDatabase: async () => { events.push('database'); },
    closeStorage: async () => { events.push('storage'); },
    timeoutMs: 10,
    forceShutdown: () => events.push('forced')
  });

  await shutdown.shutdown();

  assert.deepEqual(server.calls, ['close', 'closeAllConnections']);
  assert.deepEqual(events, ['forced']);
});

test('shutdown continues closing resources when a worker stop rejects', async () => {
  const events = [];
  const warnings = [];
  const shutdown = createGracefulShutdown({
    server: fakeServer(),
    stopWorkers: [async () => { throw new Error('synthetic failure'); }],
    closeDatabase: async () => { events.push('database'); },
    closeStorage: async () => { events.push('storage'); },
    timeoutMs: 1000,
    forceShutdown: () => { throw new Error('forced shutdown should not run'); },
    logger: { error: (message) => warnings.push(message) }
  });

  await shutdown.shutdown();

  assert.deepEqual(events, ['database', 'storage']);
  assert.deepEqual(warnings, ['Graceful shutdown failed while stopping background worker.']);
});

test('shutdown marks the application unavailable synchronously before closing resources', async () => {
  const lifecycle = { started: true, shuttingDown: false };
  const shutdown = createGracefulShutdown({
    server: fakeServer(),
    stopWorkers: [],
    closeDatabase: async () => {},
    closeStorage: async () => {},
    timeoutMs: 1000,
    forceShutdown: () => { throw new Error('forced shutdown should not run'); },
    onShutdownStart: () => {
      lifecycle.shuttingDown = true;
    }
  });

  const pendingShutdown = shutdown.shutdown();
  assert.equal(lifecycle.shuttingDown, true);
  await pendingShutdown;
});
