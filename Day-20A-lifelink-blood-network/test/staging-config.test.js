const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertStagingConfigForStartup,
  validateStagingConfig
} = require('../utils/stagingConfig');
const { getJwtSecret } = require('../utils/jwtSecret');
const { MAX_STAGING_PRESCRIPTION_MB } = require('../utils/uploadLimits');

function validStagingEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'staging',
    JWT_SECRET: 'synthetic-staging-secret-with-at-least-32-bytes',
    FRONTEND_URL: 'https://lifelink-staging.example.invalid/app',
    ALLOWED_ORIGIN: 'https://lifelink-staging.example.invalid',
    MAX_PRESCRIPTION_MB: String(MAX_STAGING_PRESCRIPTION_MB),
    ...overrides
  };
}

test('staging preflight accepts valid secure configuration without requiring R2', () => {
  assert.deepEqual(validateStagingConfig(validStagingEnvironment()), []);
  assert.doesNotThrow(() => assertStagingConfigForStartup(validStagingEnvironment()));
});

test('staging requires an exact staging mode, a strong JWT secret, and rejects known placeholders', () => {
  const cases = [
    [{ NODE_ENV: 'development' }, /NODE_ENV/],
    [{ NODE_ENV: ' Staging ' }, /NODE_ENV/],
    [{ JWT_SECRET: '' }, /JWT_SECRET/],
    [{ JWT_SECRET: 'short' }, /JWT_SECRET/],
    [{ JWT_SECRET: 'replace-with-a-long-random-development-secret' }, /JWT_SECRET/],
    [{ JWT_SECRET: 'lifelink-identity-document-access-test-secret' }, /JWT_SECRET/]
  ];
  for (const [overrides, expected] of cases) {
    const errors = validateStagingConfig(validStagingEnvironment(overrides)).join('\n');
    assert.match(errors, expected);
  }
});

test('staging requires a valid HTTPS frontend URL without credentials, query, or fragment', () => {
  for (const frontendUrl of [
    undefined,
    '',
    'not a URL',
    'http://lifelink-staging.example.invalid',
    'https://user:password@lifelink-staging.example.invalid',
    'https://lifelink-staging.example.invalid/?token=synthetic',
    'https://lifelink-staging.example.invalid/#synthetic'
  ]) {
    const environment = validStagingEnvironment();
    if (frontendUrl === undefined) delete environment.FRONTEND_URL;
    else environment.FRONTEND_URL = frontendUrl;
    assert.ok(validateStagingConfig(environment).some((error) => error.startsWith('FRONTEND_URL')));
  }
});

test('staging requires HTTPS ALLOWED_ORIGIN to contain the exact frontend origin', () => {
  for (const allowedOrigin of [
    undefined,
    '',
    'not a URL',
    'http://lifelink-staging.example.invalid',
    'https://other.example.invalid',
    'https://lifelink-staging.example.invalid/'
  ]) {
    const environment = validStagingEnvironment();
    if (allowedOrigin === undefined) delete environment.ALLOWED_ORIGIN;
    else environment.ALLOWED_ORIGIN = allowedOrigin;
    assert.ok(validateStagingConfig(environment).some((error) => error.startsWith('ALLOWED_ORIGIN')));
  }
});

test('staging validates the shared prescription limit and enforces the existing 3 MB example cap', () => {
  assert.equal(MAX_STAGING_PRESCRIPTION_MB, 3);
  for (const value of [undefined, '', '0', '1.5', '4', 'invalid']) {
    const environment = validStagingEnvironment();
    if (value === undefined) delete environment.MAX_PRESCRIPTION_MB;
    else environment.MAX_PRESCRIPTION_MB = value;
    assert.ok(validateStagingConfig(environment).some((error) => error.startsWith('MAX_PRESCRIPTION_MB')));
  }
  for (const value of ['1', '2', '3']) {
    assert.deepEqual(validateStagingConfig(validStagingEnvironment({ MAX_PRESCRIPTION_MB: value })), []);
  }
});

test('staging validation is skipped in development and test, which retain short-secret compatibility', () => {
  assert.doesNotThrow(() => assertStagingConfigForStartup({ NODE_ENV: 'development' }));
  assert.doesNotThrow(() => assertStagingConfigForStartup({ NODE_ENV: 'test' }));
  assert.equal(getJwtSecret({ NODE_ENV: 'development', JWT_SECRET: 'short' }), 'short');
  assert.equal(getJwtSecret({ NODE_ENV: 'test', JWT_SECRET: 'short' }), 'short');
});
