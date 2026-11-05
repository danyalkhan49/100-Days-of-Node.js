const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scrubEvent } = require('../utils/monitoring');

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
