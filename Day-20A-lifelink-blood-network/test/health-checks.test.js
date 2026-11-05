const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHealthHandlers } = require('../utils/healthChecks');

function response() {
  return {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('liveness reports process health without depending on startup or MongoDB', () => {
  const lifecycle = { started: false, shuttingDown: true };
  const handlers = createHealthHandlers({
    connection: { readyState: 0 },
    lifecycle
  });
  const res = response();

  handlers.liveness({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('readiness stays unavailable until startup is complete and MongoDB is connected', () => {
  const lifecycle = { started: false, shuttingDown: false };
  const connection = { readyState: 1 };
  const handlers = createHealthHandlers({ connection, lifecycle });

  const beforeStartup = response();
  handlers.readiness({}, beforeStartup);
  assert.equal(beforeStartup.statusCode, 503);
  assert.deepEqual(beforeStartup.body, { status: 'unavailable' });

  lifecycle.started = true;
  const ready = response();
  handlers.readiness({}, ready);
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.body, { status: 'ok' });

  connection.readyState = 0;
  const disconnected = response();
  handlers.readiness({}, disconnected);
  assert.equal(disconnected.statusCode, 503);
  assert.deepEqual(disconnected.body, { status: 'unavailable' });
});

test('readiness becomes unavailable as soon as shutdown begins', () => {
  const lifecycle = { started: true, shuttingDown: false };
  const handlers = createHealthHandlers({
    connection: { readyState: 1 },
    lifecycle
  });

  const ready = response();
  handlers.readiness({}, ready);
  assert.equal(ready.statusCode, 200);

  lifecycle.shuttingDown = true;
  const shuttingDown = response();
  handlers.readiness({}, shuttingDown);
  assert.equal(shuttingDown.statusCode, 503);
  assert.deepEqual(shuttingDown.body, { status: 'unavailable' });
});

test('health responses expose only a minimal status field', () => {
  const handlers = createHealthHandlers({
    connection: { readyState: 1 },
    lifecycle: { started: true, shuttingDown: false }
  });
  const live = response();
  const ready = response();

  handlers.liveness({}, live);
  handlers.readiness({}, ready);

  for (const result of [live, ready]) {
    assert.deepEqual(Object.keys(result.body), ['status']);
    const serialized = JSON.stringify(result.body);
    assert.doesNotMatch(serialized, /mongo|connection|string|secret|stack|r2/i);
  }
});
