const { test } = require('node:test');
const assert = require('node:assert/strict');
const monitoring = require('../utils/monitoring');
const Sentry = require('@sentry/node');
const { scrubEvent } = monitoring;

test('scrubber removes all request headers while preserving safe request diagnostics', () => {
  const event = {
    request: {
      method: 'POST',
      url: 'https://lifelink.example/api/profile',
      headers: {
        Authorization: 'Bearer synthetic-jwt-token',
        Cookie: 'session=synthetic-cookie',
        'Set-Cookie': 'session=synthetic-set-cookie',
        'X-Api-Key': 'synthetic-api-key',
        'X-Internal-Header': 'synthetic-private-header'
      }
    }
  };

  assert.strictEqual(scrubEvent(event), event);
  assert.deepEqual(event.request.headers, {});
  assert.equal(event.request.method, 'POST');
  assert.equal(event.request.url, 'https://lifelink.example/api/profile');
});

test('scrubber removes request bodies, cookies, and query strings independently', () => {
  const event = {
    request: {
      data: {
        password: 'synthetic-password',
        token: 'synthetic-body-token',
        identityDocument: 'synthetic-identity-document'
      },
      cookies: { session: 'synthetic-request-cookie' },
      query_string: 'api_key=synthetic-query-key'
    }
  };

  scrubEvent(event);

  assert.equal(Object.hasOwn(event.request, 'data'), false);
  assert.equal(Object.hasOwn(event.request, 'cookies'), false);
  assert.equal(Object.hasOwn(event.request, 'query_string'), false);
  assert.equal(JSON.stringify(event).includes('synthetic-'), false);
});

test('scrubber removes sensitive URL query and fragment while preserving the safe URL', () => {
  const event = {
    request: {
      url: 'https://lifelink.example/api/reset?token=synthetic-url-token&password=synthetic-url-password#synthetic-fragment'
    }
  };

  scrubEvent(event);

  assert.equal(event.request.url, 'https://lifelink.example/api/reset');
  assert.equal(JSON.stringify(event).includes('synthetic-'), false);
});

test('scrubber redacts event and exception messages and strips stack locals and context', () => {
  const event = {
    message: 'synthetic-event-error-message',
    exception: {
      values: [{
        type: 'Error',
        value: 'synthetic-exception-message',
        stacktrace: {
          frames: [{
            filename: 'src/profile.js',
            function: 'updateProfile',
            lineno: 42,
            vars: { password: 'synthetic-stack-password' },
            context_line: 'synthetic-stack-context',
            pre_context: ['synthetic-stack-pre-context'],
            post_context: ['synthetic-stack-post-context']
          }]
        }
      }]
    }
  };

  scrubEvent(event);

  assert.equal(event.message, '[redacted]');
  const exception = event.exception.values[0];
  assert.equal(exception.value, '[redacted]');
  assert.equal(exception.type, 'Error');
  const frame = exception.stacktrace.frames[0];
  assert.equal(frame.filename, 'src/profile.js');
  assert.equal(frame.function, 'updateProfile');
  assert.equal(frame.lineno, 42);
  for (const field of ['vars', 'context_line', 'pre_context', 'post_context']) {
    assert.equal(Object.hasOwn(frame, field), false);
  }
  assert.equal(JSON.stringify(event).includes('synthetic-'), false);
});

test('scrubber removes malicious exception types and error tags while retaining safe diagnostics', () => {
  const event = {
    message: 'synthetic provider response with credential',
    exception: {
      values: [{
        type: 'synthetic-api-key-and-token',
        value: 'synthetic SMTP password and raw provider response',
        stacktrace: {
          frames: [{
            filename: 'src/routes/profile.js',
            function: 'updateProfile',
            vars: { authorization: 'synthetic-bearer-token' }
          }]
        }
      }]
    },
    tags: {
      'error.type': 'synthetic-private-key',
      'http.method': 'POST',
      'http.route': '/api/profile',
      'request.id': 'request_123',
      'user.email': 'synthetic-user@example.invalid'
    }
  };

  scrubEvent(event);

  assert.equal(event.message, '[redacted]');
  assert.equal(event.exception.values[0].type, 'Error');
  assert.equal(event.exception.values[0].value, '[redacted]');
  assert.deepEqual(event.tags, {
    'error.type': 'Error',
    'http.method': 'POST',
    'http.route': '/api/profile',
    'request.id': 'request_123'
  });
  assert.equal(Object.hasOwn(event.exception.values[0].stacktrace.frames[0], 'vars'), false);
  assert.equal(JSON.stringify(event).includes('synthetic-'), false);
});

test('scrubber independently removes event extra data, contexts, user, and breadcrumbs', () => {
  const event = {
    extra: { nested: { apiKey: 'synthetic-extra-key' } },
    contexts: { identity: { document: 'synthetic-context-document' } },
    user: { email: 'synthetic-user-email', id: 'synthetic-user-id' },
    breadcrumbs: [{ message: 'synthetic-breadcrumb-message' }]
  };

  scrubEvent(event);

  for (const field of ['extra', 'contexts', 'user', 'breadcrumbs']) {
    assert.equal(Object.hasOwn(event, field), false, `${field} should be removed`);
  }
  assert.equal(JSON.stringify(event).includes('synthetic-'), false);
});

test('scrubber retains only explicitly safe event tags and preserves their values', () => {
  const event = {
    tags: {
      'error.type': 'TypeError',
      'http.method': 'POST',
      'http.route': '/api/profile',
      'request.id': 'request_123',
      'frontend.page': 'profile',
      authorization: 'synthetic-tag-token',
      'user.email': 'synthetic-tag-email',
      custom: 'synthetic-custom-tag'
    }
  };

  scrubEvent(event);

  assert.deepEqual(event.tags, {
    'error.type': 'TypeError',
    'http.method': 'POST',
    'http.route': '/api/profile',
    'request.id': 'request_123',
    'frontend.page': 'profile'
  });
  assert.equal(JSON.stringify(event).includes('synthetic-'), false);
});

test('captureException maps arbitrary error names to a safe category and retains known categories', () => {
  const original = {
    dsn: process.env.SENTRY_DSN,
    init: Sentry.init,
    withScope: Sentry.withScope,
    captureException: Sentry.captureException
  };
  const tags = [];
  const captured = [];
  const error = new Error('synthetic message with provider credentials');
  error.name = 'synthetic-private-key-and-token';
  error.code = 'synthetic-provider-response';
  error.stack = 'synthetic stack with SMTP password';
  error.response = { authorization: 'synthetic-bearer-token' };

  try {
    process.env.SENTRY_DSN = 'https://synthetic.invalid/123';
    Sentry.init = () => {};
    Sentry.withScope = (callback) => callback({
      setTag(key, value) { tags.push([key, value]); }
    });
    Sentry.captureException = (capturedError) => captured.push(capturedError);
    monitoring.initializeMonitoring();
    monitoring.captureException(error, {
      method: 'POST',
      path: '/api/profile',
      id: 'request_123'
    });
    monitoring.captureException(new TypeError('synthetic ordinary diagnostic'));
  } finally {
    if (original.dsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = original.dsn;
    Sentry.init = original.init;
    Sentry.withScope = original.withScope;
    Sentry.captureException = original.captureException;
  }

  assert.deepEqual(tags.filter(([key]) => key === 'error.type').map(([, value]) => value), [
    'Error',
    'TypeError'
  ]);
  assert.deepEqual(tags.slice(1, 4), [
    ['http.method', 'POST'],
    ['http.route', '/api/profile'],
    ['request.id', 'request_123']
  ]);
  assert.equal(captured.length, 2);
  assert.strictEqual(captured[0], error);
  assert.equal(JSON.stringify(tags).includes('synthetic-'), false);
  assert.equal(JSON.stringify(tags).includes('SMTP password'), false);
});
