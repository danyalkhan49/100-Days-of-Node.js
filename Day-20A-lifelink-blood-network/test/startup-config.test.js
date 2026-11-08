const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkdtempSync, rmSync, writeFileSync } = fs;
const { getJwtSecret } = require('../utils/jwtSecret');
const { assertProductionConfigForStartup } = require('../utils/productionConfig');

const productionConfigKeys = [
  'NODE_ENV', 'JWT_SECRET', 'MONGO_URI', 'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET', 'FRONTEND_URL', 'TRUST_PROXY_HOPS',
  'ID_DOCUMENT_ENCRYPTION_KEY', 'PORT', 'ALLOWED_ORIGIN', 'MAX_PRESCRIPTION_MB'
];

const stagingConfigKeys = [
  'NODE_ENV', 'JWT_SECRET', 'FRONTEND_URL', 'ALLOWED_ORIGIN',
  'MAX_PRESCRIPTION_MB', 'MONGO_URI', 'PORT', 'TRUST_PROXY_HOPS'
];

function setSyntheticProductionEnvironment(overrides = {}) {
  const previous = Object.fromEntries(productionConfigKeys.map((key) => [key, process.env[key]]));
  const values = {
    NODE_ENV: 'production',
    JWT_SECRET: 'synthetic-startup-test-secret-with-more-than-32-bytes',
    MONGO_URI: 'mongodb://example.invalid/lifelink?replicaSet=test-rs',
    CLOUDFLARE_R2_ACCOUNT_ID: 'b'.repeat(32),
    CLOUDFLARE_R2_ACCESS_KEY_ID: 'synthetic-access-key',
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'synthetic-r2-secret-for-tests',
    CLOUDFLARE_R2_BUCKET: 'lifelink-test-bucket',
    FRONTEND_URL: 'https://lifelink.example.invalid',
    ...overrides
  };
  for (const key of productionConfigKeys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return () => {
    for (const key of productionConfigKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

function setSyntheticStagingEnvironment(overrides = {}) {
  const previous = Object.fromEntries(stagingConfigKeys.map((key) => [key, process.env[key]]));
  const values = {
    NODE_ENV: 'staging',
    JWT_SECRET: 'synthetic-staging-startup-secret-with-more-than-32-bytes',
    FRONTEND_URL: 'https://lifelink-staging.example.invalid/app',
    ALLOWED_ORIGIN: 'https://lifelink-staging.example.invalid',
    MAX_PRESCRIPTION_MB: '3',
    MONGO_URI: 'mongodb://example.invalid/lifelink_staging?replicaSet=test-rs',
    ...overrides
  };
  for (const key of stagingConfigKeys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return () => {
    for (const key of stagingConfigKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

test('production JWT secret validation rejects missing and weak secrets without exposing them', () => {
  assert.throws(
    () => getJwtSecret({ NODE_ENV: 'production' }),
    { message: 'JWT_SECRET must be at least 32 UTF-8 bytes and cannot be a known placeholder in production.' }
  );
  assert.throws(
    () => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'short-development-secret' }),
    { message: 'JWT_SECRET must be at least 32 UTF-8 bytes and cannot be a known placeholder in production.' }
  );
});

test('production JWT secret validation rejects documented and known test placeholders', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const match = example.match(/^JWT_SECRET=(.+)$/m);
  assert.ok(match);
  assert.throws(
    () => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: match[1] }),
    { message: 'JWT_SECRET must be at least 32 UTF-8 bytes and cannot be a known placeholder in production.' }
  );
  assert.throws(
    () => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'lifelink-identity-document-access-test-secret' }),
    { message: 'JWT_SECRET must be at least 32 UTF-8 bytes and cannot be a known placeholder in production.' }
  );
});

test('production accepts strong UTF-8 secrets while development and test keep short secret compatibility', () => {
  const strongSecret = Buffer.alloc(32, 0x5a).toString('hex');
  assert.equal(getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: strongSecret }).length, 64);
  assert.equal(getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'é'.repeat(16) }).length, 16);
  assert.equal(getJwtSecret({ NODE_ENV: 'development', JWT_SECRET: 'short' }).length, 5);
  assert.equal(getJwtSecret({ NODE_ENV: 'test', JWT_SECRET: 'short' }).length, 5);
});

test('server startup rejects missing and weak production JWT secrets before connecting', async () => {
  const { startServer } = require('../server');
  const restore = setSyntheticProductionEnvironment();
  try {
    delete process.env.JWT_SECRET;
    await assert.rejects(startServer(), (error) => {
      assert.match(error.message, /Production configuration check failed:.*JWT_SECRET/);
      return true;
    });

    process.env.JWT_SECRET = 'short-production-secret';
    await assert.rejects(startServer(), (error) => {
      assert.match(error.message, /Production configuration check failed:.*JWT_SECRET/);
      return true;
    });
  } finally {
    restore();
  }
});

test('production startup validates frontend, JWT, MongoDB, and R2 before DB or HTTP startup', async () => {
  const { app } = require('../server');
  const mongoose = require('mongoose');
  const originalConnect = mongoose.connect;
  const originalListen = app.listen;
  let connectionAttempts = 0;
  let listenerAttempts = 0;
  mongoose.connect = async () => { connectionAttempts += 1; };
  app.listen = () => { listenerAttempts += 1; throw new Error('unexpected HTTP listener startup'); };

  const invalidConfigurations = [
    [{ FRONTEND_URL: undefined }, /FRONTEND_URL/],
    [{ JWT_SECRET: 'synthetic-weak-secret' }, /JWT_SECRET/],
    [{ MONGO_URI: 'synthetic-invalid-mongo-value' }, /MONGO_URI/],
    [{ CLOUDFLARE_R2_BUCKET: undefined }, /Cloudflare R2/],
    [{ CLOUDFLARE_R2_BUCKET: 'invalid bucket' }, /Cloudflare R2/]
  ];
  try {
    for (const [overrides, expected] of invalidConfigurations) {
      const restore = setSyntheticProductionEnvironment(overrides);
      try {
        await assert.rejects(require('../server').startServer(), (error) => {
          assert.match(error.message, expected);
          return true;
        });
      } finally {
        restore();
      }
    }
    assert.equal(connectionAttempts, 0);
    assert.equal(listenerAttempts, 0);
  } finally {
    mongoose.connect = originalConnect;
    app.listen = originalListen;
  }
});

test('staging startup rejects invalid staging configuration before DB or HTTP startup', async () => {
  const { app, startServer } = require('../server');
  const mongoose = require('mongoose');
  const originalConnect = mongoose.connect;
  const originalListen = app.listen;
  let connectionAttempts = 0;
  let listenerAttempts = 0;
  mongoose.connect = async () => { connectionAttempts += 1; };
  app.listen = () => { listenerAttempts += 1; throw new Error('unexpected HTTP listener startup'); };

  const invalidConfigurations = [
    [{ JWT_SECRET: 'short' }, /JWT_SECRET/],
    [{ FRONTEND_URL: 'http://lifelink-staging.example.invalid' }, /FRONTEND_URL/],
    [{ ALLOWED_ORIGIN: 'https://other.example.invalid' }, /ALLOWED_ORIGIN/],
    [{ MAX_PRESCRIPTION_MB: '4' }, /MAX_PRESCRIPTION_MB/]
  ];
  try {
    for (const [overrides, expected] of invalidConfigurations) {
      const restore = setSyntheticStagingEnvironment(overrides);
      try {
        await assert.rejects(startServer(), (error) => {
          assert.match(error.message, new RegExp(`Staging configuration check failed:.*${expected.source}`));
          return true;
        });
      } finally {
        restore();
      }
    }
    assert.equal(connectionAttempts, 0);
    assert.equal(listenerAttempts, 0);
  } finally {
    mongoose.connect = originalConnect;
    app.listen = originalListen;
  }
});

test('startup preflight is production-only; explicit CLI preflight rejects missing NODE_ENV', () => {
  assert.doesNotThrow(() => assertProductionConfigForStartup({ NODE_ENV: 'development' }));
  assert.doesNotThrow(() => assertProductionConfigForStartup({ NODE_ENV: 'test' }));
  assert.doesNotThrow(() => assertProductionConfigForStartup({ JWT_SECRET: 'synthetic-local-test-secret' }));

  const script = path.join(__dirname, '..', 'scripts', 'checkProductionConfig.js');
  const result = require('node:child_process').spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {}
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NODE_ENV must be exactly production/);
});

test('direct node server.js execution cannot bypass production validation', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'lifelink-startup-preload-'));
  const preloadPath = path.join(tempDirectory, 'stub-dotenv.js');
  writeFileSync(preloadPath,
    "const Module = require('node:module');\n" +
    "const originalLoad = Module._load;\n" +
    "Module._load = function(request, parent, isMain) {\n" +
    "  if (request === 'dotenv') return { config: () => ({}) };\n" +
    "  return originalLoad.call(this, request, parent, isMain);\n" +
    "};\n",
    'utf8'
  );

  try {
    const result = require('node:child_process').spawnSync(
      process.execPath,
      ['--require', preloadPath, serverPath],
      {
        encoding: 'utf8',
        env: { NODE_ENV: 'production', PATH: process.env.PATH }
      }
    );
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /"event":"operation_failure"/);
    assert.match(`${result.stdout}${result.stderr}`, /"operation":"server_startup_error"/);
    assert.match(`${result.stdout}${result.stderr}`, /"startupStage":"production_config"/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Production configuration check failed/);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('direct node server.js execution cannot bypass staging validation', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'lifelink-staging-startup-preload-'));
  const preloadPath = path.join(tempDirectory, 'stub-dotenv.js');
  writeFileSync(preloadPath,
    "const Module = require('node:module');\n" +
    "const originalLoad = Module._load;\n" +
    "Module._load = function(request, parent, isMain) {\n" +
    "  if (request === 'dotenv') return { config: () => ({}) };\n" +
    "  return originalLoad.call(this, request, parent, isMain);\n" +
    "};\n",
    'utf8'
  );

  try {
    const result = require('node:child_process').spawnSync(
      process.execPath,
      ['--require', preloadPath, serverPath],
      {
        encoding: 'utf8',
        env: { NODE_ENV: 'staging', PATH: process.env.PATH }
      }
    );
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /"event":"operation_failure"/);
    assert.match(`${result.stdout}${result.stderr}`, /"operation":"server_startup_error"/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Staging configuration check failed|JWT_SECRET/);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('server environment loader reads an explicit environment file outside the project directory', () => {
  const projectDirectory = path.resolve(__dirname, '..');
  const serverPath = path.join(projectDirectory, 'server.js');
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'lifelink-env-test-'));
  const envPath = path.join(tempDirectory, 'test.env');
  const expectedFrontendUrl = 'https://test.example.invalid';
  writeFileSync(envPath, `FRONTEND_URL=${expectedFrontendUrl}\n`, 'utf8');

  try {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        'const server = require(process.argv[1]); server.loadProjectEnvironment(process.argv[2]); ' +
          'process.stdout.write(process.env.FRONTEND_URL || "")',
        serverPath,
        envPath
      ],
      {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        env: Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key !== 'FRONTEND_URL')
        )
      }
    );

    assert.equal(output, expectedFrontendUrl);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
