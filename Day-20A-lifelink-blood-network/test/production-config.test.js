const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validateProductionConfig } = require('../scripts/checkProductionConfig');
const { getFrontendBaseUrl } = require('../utils/accountEmail');

function validProductionEnvironment() {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'synthetic-production-test-secret-with-more-than-32-bytes',
    MONGO_URI: 'mongodb://example.invalid/lifelink?replicaSet=test-rs',
    CLOUDFLARE_R2_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_R2_ACCESS_KEY_ID: 'synthetic-access-key',
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'synthetic-secret-key-for-tests',
    CLOUDFLARE_R2_BUCKET: 'lifelink-test-bucket',
    FRONTEND_URL: 'https://lifelink.example.invalid'
  };
}

test('production preflight accepts complete configuration', () => {
  assert.deepEqual(validateProductionConfig(validProductionEnvironment()), []);
});

test('production preflight requires a valid HTTPS FRONTEND_URL', () => {
  const cases = [
    ['missing', undefined],
    ['empty', ''],
    ['malformed', 'https://[invalid'],
    ['HTTP', 'http://lifelink.example.invalid']
  ];
  for (const [description, frontendUrl] of cases) {
    const env = validProductionEnvironment();
    if (frontendUrl === undefined) delete env.FRONTEND_URL;
    else env.FRONTEND_URL = frontendUrl;
    assert.ok(
      validateProductionConfig(env).some((error) => error.startsWith('FRONTEND_URL')),
      `expected ${description} FRONTEND_URL to fail`
    );
  }

  const validUrl = validProductionEnvironment();
  assert.deepEqual(validateProductionConfig(validUrl), []);
});

test('production preflight continues to reject missing or invalid R2 configuration', () => {
  const missing = validProductionEnvironment();
  delete missing.CLOUDFLARE_R2_ACCOUNT_ID;
  assert.ok(validateProductionConfig(missing).some((error) => error.includes('Cloudflare R2')));

  const invalid = { ...validProductionEnvironment(), CLOUDFLARE_R2_BUCKET: 'invalid bucket' };
  assert.ok(validateProductionConfig(invalid).some((error) => error.includes('Cloudflare R2')));
});

test('production preflight preserves URL rejection for credentials, query, and fragment', () => {
  for (const frontendUrl of [
    'https://user:pass@lifelink.example.invalid',
    'https://lifelink.example.invalid/?token=synthetic',
    'https://lifelink.example.invalid/#synthetic'
  ]) {
    const env = { ...validProductionEnvironment(), FRONTEND_URL: frontendUrl };
    assert.ok(validateProductionConfig(env).some((error) => error.startsWith('FRONTEND_URL')));
  }
});

test('production preflight requires NODE_ENV to be exactly production', () => {
  for (const value of [undefined, 'development', 'Production', ' production ']) {
    const env = validProductionEnvironment();
    if (value === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = value;
    assert.ok(validateProductionConfig(env).includes('NODE_ENV must be exactly production.'));
  }
});

test('production preflight validates required and configured production settings without echoing values', () => {
  const env = validProductionEnvironment();
  env.JWT_SECRET = 'synthetic-preflight-secret';
  env.MONGO_URI = 'synthetic-mongo-uri-with-password';
  env.CLOUDFLARE_R2_BUCKET = 'bad bucket';
  env.FRONTEND_URL = 'http://lifelink.example.invalid';
  env.TRUST_PROXY_HOPS = '1.5';
  env.ID_DOCUMENT_ENCRYPTION_KEY = 'invalid-test-key';
  env.PORT = '70000';
  const errors = validateProductionConfig(env).join('\n');
  assert.match(errors, /JWT_SECRET/);
  assert.match(errors, /MONGO_URI/);
  assert.match(errors, /Cloudflare R2/);
  assert.match(errors, /FRONTEND_URL/);
  assert.match(errors, /TRUST_PROXY_HOPS/);
  assert.match(errors, /ID_DOCUMENT_ENCRYPTION_KEY/);
  assert.match(errors, /PORT/);
  for (const value of [env.JWT_SECRET, env.MONGO_URI, env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    env.CLOUDFLARE_R2_SECRET_ACCESS_KEY, env.ID_DOCUMENT_ENCRYPTION_KEY]) {
    assert.equal(errors.includes(value), false);
  }
});

test('production preflight CLI returns non-zero for an incorrect environment without printing values', () => {
  const script = path.join(__dirname, '..', 'scripts', 'checkProductionConfig.js');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { NODE_ENV: 'development', JWT_SECRET: 'synthetic-private-fixture' }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NODE_ENV must be exactly production/);
  assert.equal(`${result.stdout}${result.stderr}`.includes('synthetic-private-fixture'), false);
});

test('production email URL requires HTTPS while development and test may use HTTP', () => {
  const original = { NODE_ENV: process.env.NODE_ENV, FRONTEND_URL: process.env.FRONTEND_URL };
  try {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    assert.throws(() => getFrontendBaseUrl(), { code: 'EMAIL_FRONTEND_URL_CONFIG' });
    process.env.FRONTEND_URL = 'https://lifelink.example.invalid/app';
    assert.equal(getFrontendBaseUrl().origin, 'https://lifelink.example.invalid');
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    assert.equal(getFrontendBaseUrl().origin, 'http://localhost:3000');
  } finally {
    if (original.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.NODE_ENV;
    if (original.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original.FRONTEND_URL;
  }
});
