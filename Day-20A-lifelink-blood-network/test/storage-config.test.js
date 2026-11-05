const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const {
  createStorageRuntime,
  initializeStorage
} = require('../config/storage');
const { createLocalFileProvider } = require('../utils/storage/localFileProvider');
const { createStorageService } = require('../utils/storage/storageService');

const syntheticEnvironment = Object.freeze({
  CLOUDFLARE_R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_R2_ACCESS_KEY_ID: 'SYNTHETIC_ACCESS_KEY_ID',
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'SYNTHETIC_SECRET_ACCESS_KEY',
  CLOUDFLARE_R2_BUCKET: 'lifelink-private-test'
});

test('missing R2 configuration disables R2 and leaves local storage available', (t) => {
  const runtime = createStorageRuntime({ env: {} });
  t.after(() => runtime.close());

  assert.deepEqual(runtime.status, {
    local: { available: true },
    r2: {
      available: false,
      required: false,
      reason: 'incomplete-or-invalid-configuration'
    }
  });
  assert.equal(typeof runtime.localStorage.upload, 'function');
  assert.equal(runtime.r2Storage, null);
});

test('partial or invalid R2 configuration disables R2 without creating a client', (t) => {
  let clientConstructions = 0;
  class UnexpectedS3Client {
    constructor() {
      clientConstructions += 1;
    }
  }

  const runtime = createStorageRuntime({
    env: { CLOUDFLARE_R2_ACCOUNT_ID: syntheticEnvironment.CLOUDFLARE_R2_ACCOUNT_ID },
    S3ClientConstructor: UnexpectedS3Client
  });
  t.after(() => runtime.close());

  assert.equal(runtime.status.r2.available, false);
  assert.equal(runtime.r2Storage, null);
  assert.equal(clientConstructions, 0);

  const invalidRuntime = createStorageRuntime({
    env: { ...syntheticEnvironment, CLOUDFLARE_R2_BUCKET: 'INVALID_BUCKET' },
    S3ClientConstructor: UnexpectedS3Client
  });
  t.after(() => invalidRuntime.close());
  assert.equal(invalidRuntime.status.r2.available, false);
  assert.equal(clientConstructions, 0);
});

test('complete synthetic configuration creates one R2 service without network calls or secret status', (t) => {
  let options;
  let clientConstructions = 0;
  let sendCalls = 0;
  const loggedMessages = [];
  const originalConsoleMethods = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  for (const method of Object.keys(originalConsoleMethods)) {
    console[method] = (...args) => loggedMessages.push(args.join(' '));
  }
  t.after(() => {
    Object.assign(console, originalConsoleMethods);
  });

  class FakeS3Client {
    constructor(clientOptions) {
      options = clientOptions;
      clientConstructions += 1;
    }

    async send() {
      sendCalls += 1;
      throw new Error('Network calls are not expected in this test.');
    }
  }

  const runtime = createStorageRuntime({
    env: syntheticEnvironment,
    S3ClientConstructor: FakeS3Client
  });
  t.after(() => runtime.close());

  assert.deepEqual(options, {
    endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    region: 'auto',
    credentials: {
      accessKeyId: syntheticEnvironment.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: syntheticEnvironment.CLOUDFLARE_R2_SECRET_ACCESS_KEY
    }
  });
  assert.equal(runtime.status.r2.available, true);
  assert.equal(typeof runtime.r2Storage.upload, 'function');
  assert.equal(clientConstructions, 1);
  assert.equal(sendCalls, 0);

  const status = JSON.stringify(runtime.status);
  assert.equal(status.includes(syntheticEnvironment.CLOUDFLARE_R2_ACCESS_KEY_ID), false);
  assert.equal(status.includes(syntheticEnvironment.CLOUDFLARE_R2_SECRET_ACCESS_KEY), false);
  assert.deepEqual(loggedMessages, []);
});

test('complete synthetic configuration constructs the AWS SDK client without sending a request', (t) => {
  const runtime = createStorageRuntime({ env: syntheticEnvironment });
  t.after(() => runtime.close());

  assert.equal(runtime.status.r2.available, true);
  assert.equal(typeof runtime.r2Storage.download, 'function');
});

test('staging always uses disposable local storage and never constructs an R2 client', (t) => {
  let clientConstructions = 0;
  class UnexpectedS3Client {
    constructor() {
      clientConstructions += 1;
      throw new Error('Staging must not initialize R2.');
    }
  }

  const runtime = createStorageRuntime({
    env: { NODE_ENV: 'staging', ...syntheticEnvironment },
    S3ClientConstructor: UnexpectedS3Client,
    projectRoot: path.join(os.tmpdir(), 'lifelink-staging-storage-root')
  });
  t.after(() => runtime.close());

  assert.deepEqual(runtime.status, {
    local: { available: true, disposable: true },
    r2: { available: false, required: false, reason: 'staging-local-only' }
  });
  assert.equal(runtime.productionRequired, false);
  assert.equal(runtime.r2Storage, null);
  assert.equal(typeof runtime.localStorage.upload, 'function');
  assert.equal(clientConstructions, 0);
});

test('development and test preserve optional R2 initialization behavior', (t) => {
  let clientConstructions = 0;
  class FakeS3Client {
    constructor() { clientConstructions += 1; }
    async send() {}
    destroy() {}
  }

  for (const NODE_ENV of ['development', 'test']) {
    const runtime = createStorageRuntime({
      env: { NODE_ENV, ...syntheticEnvironment },
      S3ClientConstructor: FakeS3Client
    });
    t.after(() => runtime.close());
    assert.equal(runtime.status.r2.available, true);
    assert.deepEqual(runtime.status.local, { available: true });
    assert.equal(runtime.productionRequired, false);
  }
  assert.equal(clientConstructions, 2);
});

test('initializeStorage reuses the same runtime and client on repeated initialization', (t) => {
  let clientConstructions = 0;
  class FakeS3Client {
    constructor() {
      clientConstructions += 1;
    }

    async send() {}

    destroy() {}
  }

  const first = initializeStorage({
    env: syntheticEnvironment,
    S3ClientConstructor: FakeS3Client
  });
  const second = initializeStorage({
    env: {},
    S3ClientConstructor: FakeS3Client
  });
  t.after(() => first.close());

  assert.strictEqual(second, first);
  assert.equal(first.status.r2.available, true);
  assert.equal(clientConstructions, 1);
});

test('local provider still uploads and reads using an isolated temporary directory', async (t) => {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'lifelink-storage-config-'));
  t.after(() => fs.rm(rootDirectory, { recursive: true, force: true }));
  const storage = createStorageService(createLocalFileProvider({ rootDirectory }));
  const body = Buffer.from('synthetic local file');

  const uploaded = await storage.upload({
    purpose: 'avatar',
    body,
    contentType: 'image/png'
  });

  assert.deepEqual((await storage.download({ key: uploaded.key })).body, body);
});
