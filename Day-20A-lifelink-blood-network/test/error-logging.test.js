const { test } = require('node:test');
const assert = require('node:assert/strict');
const monitoring = require('../utils/monitoring');
const { logOperationFailure, logRollbackFailure } = require('../utils/safeErrorLogger');
const { sendPhoneMessage } = require('../utils/phoneProvider');
const { dispatchNotification } = require('../utils/notifications');
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

test('operation failures include only allowlisted startup phases', () => {
  const records = [];
  const logger = { error: (record) => records.push(record) };
  const error = new Error('synthetic secret must not appear');
  error.startupStage = 'mongodb_connection';
  logOperationFailure('server_startup_error', error, logger);
  assert.deepEqual(JSON.parse(records[0]), {
    event: 'operation_failure',
    operation: 'server_startup_error',
    errorType: 'Error',
    startupStage: 'mongodb_connection'
  });

  error.startupStage = 'synthetic-password';
  logOperationFailure('server_startup_error', error, logger);
  assert.equal(Object.hasOwn(JSON.parse(records[1]), 'startupStage'), false);
  assert.equal(records.join('\n').includes('synthetic secret'), false);
  assert.equal(records.join('\n').includes('synthetic-password'), false);
});

test('production config failures log failed check names without config values', () => {
  const records = [];
  const error = new Error('synthetic secret must not appear');
  error.productionConfigIssues = ['MONGO_URI', 'JWT_SECRET', 'synthetic-secret-value'];
  logOperationFailure('server_startup_error', error, {
    error(record) { records.push(record); }
  });
  assert.deepEqual(JSON.parse(records[0]), {
    event: 'operation_failure',
    operation: 'server_startup_error',
    errorType: 'Error',
    productionConfigIssues: ['JWT_SECRET', 'MONGO_URI']
  });
  assert.equal(records.join('\n').includes('synthetic'), false);
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

test('phone OTP cleanup rollback uses its fixed operation ID and excludes error contents', () => {
  const records = [];
  const error = new Error('synthetic OTP and database credential');
  error.name = 'synthetic-sensitive-error-name';
  error.code = 'synthetic-sensitive-error-code';
  error.stack = 'synthetic stack with token';
  error.cause = { message: 'synthetic nested provider response' };

  logRollbackFailure('phone_otp_delivery_cleanup', error, {
    error(record) { records.push(record); }
  });

  assert.deepEqual(JSON.parse(records[0]), {
    event: 'rollback_failure',
    operation: 'phone_otp_delivery_cleanup',
    failureCount: 1,
    errors: [{ errorType: 'Error' }]
  });
  for (const sensitive of [
    'synthetic OTP', 'database credential', 'sensitive-error-name',
    'sensitive-error-code', 'token', 'nested provider response'
  ]) {
    assert.equal(records.join('\n').includes(sensitive), false);
  }
});

test('operation logger keeps only fixed operation IDs and allowlisted error metadata', () => {
  const records = [];
  const error = new Error('synthetic SMTP password and bearer token');
  error.name = 'synthetic-provider-credential';
  error.code = 'synthetic-api-key-value';
  error.statusCode = 503;
  error.stack = 'synthetic private key in stack';
  error.cause = { message: 'synthetic nested secret' };
  error.response = { authorization: 'synthetic provider token' };

  logOperationFailure('email_registration_verification', error, {
    error(record) { records.push(record); }
  });
  logOperationFailure('synthetic-secret-operation-name', error, {
    error(record) { records.push(record); }
  });

  assert.deepEqual(records.map((record) => JSON.parse(record)), [
    {
      event: 'operation_failure',
      operation: 'email_registration_verification',
      errorType: 'Error',
      statusCode: 503
    },
    {
      event: 'operation_failure',
      operation: 'unknown',
      errorType: 'Error',
      statusCode: 503
    }
  ]);
  for (const sensitive of [
    'SMTP password', 'bearer token', 'provider-credential', 'api-key',
    'private key', 'nested secret', 'authorization', 'provider token',
    'synthetic-secret-operation-name'
  ]) {
    assert.equal(records.join('\n').includes(sensitive), false);
  }
});

test('SMS provider failures log safe metadata and keep the existing generic 503 behavior', async () => {
  const envKeys = [
    'SMS_PROVIDER',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER'
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const originalError = console.error;
  const records = [];
  process.env.SMS_PROVIDER = 'twilio';
  process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-id';
  process.env.TWILIO_AUTH_TOKEN = 'synthetic-provider-token';
  process.env.TWILIO_FROM_NUMBER = '+15005550006';
  const providerError = new Error('synthetic provider password and response body');
  providerError.name = 'synthetic-credential-name';
  providerError.code = 'synthetic-provider-code';
  providerError.stack = 'synthetic stack with private key';
  providerError.cause = { token: 'synthetic-nested-token' };
  global.fetch = async () => { throw providerError; };
  console.error = (record) => records.push(record);

  try {
    await assert.rejects(sendPhoneMessage('+923001234567', 'synthetic OTP value'), (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.message, 'The phone verification message could not be sent. Please try again later.');
      return true;
    });
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }

  assert.deepEqual(JSON.parse(records[0]), {
    event: 'operation_failure',
    operation: 'sms_provider_delivery',
    errorType: 'Error',
    code: 'SMS_PROVIDER_FAILURE',
    statusCode: 503
  });
  for (const sensitive of [
    'provider password', 'response body', 'credential-name', 'provider-code',
    'private key', 'nested-token', 'synthetic-account-id', 'provider-token',
    '+923001234567', 'synthetic OTP value'
  ]) {
    assert.equal(records.join('\n').includes(sensitive), false);
  }
});

test('SMS provider sends SMS and WhatsApp requests through an injected mock transport', async () => {
  const envKeys = [
    'SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER', 'TWILIO_WHATSAPP_FROM'
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const requests = [];
  try {
    process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-id';
    process.env.TWILIO_AUTH_TOKEN = 'synthetic-provider-token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+15005550006';

    for (const scenario of [
      { provider: 'twilio', expectedTo: '+923001234567', expectedFrom: '+15005550006' },
      { provider: 'twilio-whatsapp', expectedTo: 'whatsapp:+923001234567', expectedFrom: 'whatsapp:+15005550006' }
    ]) {
      process.env.SMS_PROVIDER = scenario.provider;
      await sendPhoneMessage('+923001234567', 'synthetic message body', {
        fetchImpl: async (url, options) => {
          requests.push({ url, options });
          return { ok: true, status: 201 };
        }
      });
      const sent = requests.at(-1);
      assert.match(sent.url, /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/synthetic-account-id\/Messages\.json$/);
      assert.equal(sent.options.method, 'POST');
      const form = new URLSearchParams(sent.options.body);
      assert.equal(form.get('To'), scenario.expectedTo);
      assert.equal(form.get('From'), scenario.expectedFrom);
      assert.equal(form.get('Body'), 'synthetic message body');
      assert.match(sent.options.headers.Authorization, /^Basic /);
      assert.equal(sent.options.signal.aborted, false);
    }
    assert.equal(requests.length, 2);
  } finally {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});

test('SMS provider missing configuration and malformed or rejected responses retain generic 503 behavior', async () => {
  const envKeys = [
    'SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalError = console.error;
  const records = [];
  console.error = (record) => records.push(record);
  try {
    for (const key of envKeys) delete process.env[key];
    await assert.rejects(sendPhoneMessage('+923001234567', 'synthetic OTP', {
      fetchImpl: async () => { throw new Error('must not make a request'); }
    }), (error) => error.statusCode === 503 && /not configured/.test(error.message));

    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-id';
    process.env.TWILIO_AUTH_TOKEN = 'synthetic-provider-token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    for (const response of [{}, { ok: false, status: 401 }]) {
      await assert.rejects(sendPhoneMessage('+923001234567', 'synthetic OTP', {
        fetchImpl: async () => response
      }), (error) => error.statusCode === 503 && /could not be sent/.test(error.message));
    }

    assert.deepEqual(records.map((record) => JSON.parse(record).operation), [
      'sms_provider_rejection', 'sms_provider_rejection'
    ]);
    assert.equal(records.join('\n').includes('synthetic-account-id'), false);
    assert.equal(records.join('\n').includes('+923001234567'), false);
    assert.equal(records.join('\n').includes('synthetic OTP'), false);
  } finally {
    console.error = originalError;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});

test('SMS provider abort failures are sanitized and remain generic service-unavailable errors', async () => {
  const envKeys = ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalError = console.error;
  const records = [];
  const abortError = new Error('synthetic timeout token');
  abortError.name = 'TimeoutError';
  abortError.code = 'synthetic-provider-secret';
  abortError.stack = 'synthetic stack with private credential';
  console.error = (record) => records.push(record);
  try {
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-id';
    process.env.TWILIO_AUTH_TOKEN = 'synthetic-provider-token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    await assert.rejects(sendPhoneMessage('+923001234567', 'synthetic OTP', {
      fetchImpl: async () => { throw abortError; }
    }), (error) => error.statusCode === 503 && /could not be sent/.test(error.message));
    assert.deepEqual(JSON.parse(records[0]), {
      event: 'operation_failure',
      operation: 'sms_provider_delivery',
      errorType: 'Error',
      code: 'SMS_PROVIDER_FAILURE',
      statusCode: 503
    });
    for (const sensitive of [
      'timeout token', 'TimeoutError', 'synthetic-provider-secret',
      'private credential', 'synthetic-account-id', 'synthetic-provider-token',
      '+923001234567', 'synthetic OTP'
    ]) assert.equal(records.join('\n').includes(sensitive), false);
  } finally {
    console.error = originalError;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});

test('notification dispatch logs a fixed operation and excludes provider error contents', async () => {
  const originalError = console.error;
  const records = [];
  console.error = (record) => records.push(record);
  const error = new Error('synthetic recipient address and service token');
  error.name = 'synthetic-provider-name';
  error.code = 'synthetic-provider-code';
  error.stack = 'synthetic provider stack';
  error.details = { phone: 'synthetic-phone-number', token: 'synthetic-token' };

  try {
    dispatchNotification(() => Promise.reject(error), 'synthetic-dynamic-label');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(JSON.parse(records[0]), {
    event: 'operation_failure',
    operation: 'notification_dispatch',
    errorType: 'Error'
  });
  for (const sensitive of [
    'recipient address', 'service token', 'provider-name', 'provider-code',
    'provider stack', 'synthetic-phone-number', 'synthetic-token', 'dynamic-label'
  ]) {
    assert.equal(records.join('\n').includes(sensitive), false);
  }
});
