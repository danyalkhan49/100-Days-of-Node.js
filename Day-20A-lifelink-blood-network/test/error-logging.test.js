const { test } = require('node:test');
const assert = require('node:assert/strict');
const monitoring = require('../utils/monitoring');
const { logRollbackFailure } = require('../utils/safeErrorLogger');
const originalCaptureException = monitoring.captureException;
const capturedErrors = [];
monitoring.captureException = (error, request) => capturedErrors.push({ error, request });
const errorHandler = require('../middleware/errorHandler');
monitoring.captureException = originalCaptureException;

function invokeErrorHandler(error, request = {}) {
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  errorHandler(error, request, response, () => {});
  return { response };
}

test('unexpected errors log only allowlisted metadata and preserve the generic response', () => {
  const previousError = console.error;
  const records = [];
  console.error = (record) => records.push(record);
  const error = new Error('provider failure: synthetic-password-value');
  error.code = 'EMAIL_PROVIDER_REJECTED';
  error.statusCode = 503;
  error.stack = 'Error: stack synthetic-token-value';
  error.config = { credentials: 'synthetic-r2-secret-value' };
  capturedErrors.length = 0;

  let response;
  try {
    ({ response } = invokeErrorHandler(error, {
      id: 'request_123-safe',
      headers: { authorization: 'synthetic-jwt-token' },
      cookies: { session: 'synthetic-cookie-value' },
      body: { password: 'synthetic-request-password' }
    }));
  } finally {
    console.error = previousError;
  }

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    success: false,
    error: 'Something went wrong on the server'
  });
  assert.equal(records.length, 1);
  const record = JSON.parse(records[0]);
  assert.deepEqual(record, {
    event: 'unexpected_server_error',
    errorType: 'Error',
    code: 'EMAIL_PROVIDER_REJECTED',
    statusCode: 503,
    requestId: 'request_123-safe'
  });
  const output = records.join('\n');
  for (const sensitive of [
    'synthetic-password-value',
    'synthetic-token-value',
    'synthetic-r2-secret-value',
    'synthetic-jwt-token',
    'synthetic-cookie-value',
    'synthetic-request-password',
    'provider failure',
    'stack'
  ]) {
    assert.equal(output.includes(sensitive), false);
  }
  assert.equal(capturedErrors.length, 1);
  assert.strictEqual(capturedErrors[0].error, error);
});

test('unexpected error logger excludes unsafe codes, names, statuses, and request identifiers', () => {
  const previousError = console.error;
  const records = [];
  console.error = (record) => records.push(record);
  const error = new Error('synthetic-twilio-token');
  error.name = 'synthetic-private-key-value';
  error.code = 'synthetic-access-key-value';
  error.statusCode = 700;

  try {
    invokeErrorHandler(error, { id: 'synthetic cookie value' });
  } finally {
    console.error = previousError;
  }

  assert.deepEqual(JSON.parse(records[0]), {
    event: 'unexpected_server_error',
    errorType: 'Error'
  });
  for (const sensitive of [
    'synthetic-twilio-token',
    'synthetic-private-key-value',
    'synthetic-access-key-value',
    'synthetic cookie value'
  ]) {
    assert.equal(records.join('\n').includes(sensitive), false);
  }
});

test('rollback logger keeps fixed operation metadata and excludes unsafe error properties', () => {
  const records = [];
  const error = new Error('synthetic MongoDB URI and password');
  error.code = 'synthetic-private-provider-credential';
  error.statusCode = 503;
  error.stack = 'stack with synthetic JWT token';
  error.cause = { message: 'synthetic R2 secret' };
  error.config = { headers: { authorization: 'synthetic bearer token' } };

  logRollbackFailure('admin_user_deactivation', [error], {
    error(record) { records.push(record); }
  });

  assert.equal(records.length, 1);
  assert.deepEqual(JSON.parse(records[0]), {
    event: 'rollback_failure',
    operation: 'admin_user_deactivation',
    failureCount: 1,
    errors: [{ errorType: 'Error', statusCode: 503 }]
  });
  for (const sensitive of [
    'MongoDB URI', 'password', 'private-provider-credential', 'JWT token',
    'R2 secret', 'authorization', 'bearer token', 'stack'
  ]) {
    assert.equal(records.join('\n').includes(sensitive), false);
  }
});

test('rollback logger rejects dynamic operation labels and caps logged error details', () => {
  const records = [];
  const errors = Array.from({ length: 12 }, () => new TypeError('synthetic secret'));

  logRollbackFailure('synthetic-sensitive-operation', errors, {
    error(record) { records.push(record); }
  });

  assert.deepEqual(JSON.parse(records[0]), {
    event: 'rollback_failure',
    operation: 'unknown',
    failureCount: 12,
    errors: Array.from({ length: 10 }, () => ({ errorType: 'TypeError' })),
    truncated: true
  });
  assert.equal(records[0].includes('synthetic-sensitive-operation'), false);
  assert.equal(records[0].includes('synthetic secret'), false);
});
