const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const { createAvatarDeliveryHandler, createAvatarUploadHandler } = require('../utils/avatarStorage');
const { createR2Provider } = require('../utils/storage/r2Provider');
const { createStorageService } = require('../utils/storage/storageService');

const avatarBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const filename = '0123456789abcdef0123456789abcdef.png';
const cleanupJobs = [];
const validOptions = {
  validateAvatar: async () => {},
  enqueueCleanup: async (target) => cleanupJobs.push(target),
  withRequiredTransaction: async (operation) => operation(null)
};

class FakeS3Client {
  constructor() {
    this.objects = new Map();
    this.commands = [];
    this.failPut = false;
    this.getError = null;
  }

  async send(command) {
    this.commands.push(command);
    const key = command.input.Key;
    if (command instanceof PutObjectCommand) {
      if (this.failPut) throw new Error('Synthetic R2 upload failure');
      this.objects.set(key, {
        body: Buffer.from(command.input.Body),
        contentType: command.input.ContentType,
        metadata: command.input.Metadata
      });
      return {};
    }
    if (command instanceof GetObjectCommand) {
      if (this.getError) throw this.getError;
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error('Missing object'), { name: 'NoSuchKey' });
      return {
        Body: object.body,
        ContentType: object.contentType,
        Metadata: object.metadata
      };
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  }
}

function createR2Runtime(client = new FakeS3Client()) {
  return {
    client,
    runtime: {
      status: { r2: { available: true } },
      r2Storage: createStorageService(createR2Provider({
        client,
        bucket: 'lifelink-private-test'
      }))
    }
  };
}

function createUserModel(initialUser = { _id: 'synthetic-user', avatar: null }) {
  const records = new Map([[String(initialUser._id), { ...initialUser }]]);
  let saveError = null;
  let lookupCount = 0;
  let findError = null;
  const model = {
    findById(id) {
      return {
        select: async () => {
          const record = records.get(String(id));
          if (!record) return null;
          return {
            ...record,
            async save() {
              if (saveError) throw saveError;
              records.set(String(id), {
                _id: this._id,
                avatar: this.avatar,
                avatarStorage: this.avatarStorage
              });
            }
          };
        }
      };
    },
    async exists(filter) {
      return [...records.values()].some((record) =>
        record.avatarStorage && record.avatarStorage.key === filter['avatarStorage.key']
      ) ? { _id: 'synthetic-user' } : null;
    },
    find(filter) {
      lookupCount += 1;
      return {
        select() {
          return {
            lean: async () => {
              if (findError) throw findError;
              return [...records.values()].filter((record) =>
                record.avatar === filter.avatar
              );
            }
          };
        }
      };
    },
    get records() {
      return records;
    },
    setSaveError(error) {
      saveError = error;
    },
    setFindError(error) {
      findError = error;
    },
    get lookupCount() {
      return lookupCount;
    }
  };
  return model;
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    set(headers) {
      Object.assign(this.headers, headers);
      return this;
    },
    type(contentType) {
      this.headers['Content-Type'] = contentType;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    }
  };
}

function createUploadRequest(file, runtime) {
  return {
    file,
    user: { id: 'synthetic-user' },
    app: { locals: { storage: runtime } }
  };
}

async function createTempDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lifelink-avatar-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('R2 unavailable uses local upload and stores no R2 metadata', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  const filePath = path.join(avatarDirectory, filename);
  await fs.writeFile(filePath, avatarBytes);
  const User = createUserModel();
  const handler = createAvatarUploadHandler({
    ...validOptions,
    User,
    avatarDirectory,
    getStorage: () => ({ status: { r2: { available: false } } })
  });
  const res = createResponse();
  let nextError;

  await handler(createUploadRequest({
    path: filePath,
    filename,
    originalname: 'avatar.png',
    mimetype: 'image/png'
  }), res, (error) => { nextError = error; });

  assert.equal(nextError, undefined);
  assert.deepEqual(res.body, {
    success: true,
    message: 'Avatar uploaded successfully.',
    avatar: filename
  });
  const stored = User.records.get('synthetic-user');
  assert.equal(stored.avatar, filename);
  assert.equal(stored.avatarStorage, undefined);
  assert.equal((await fs.readFile(filePath)).equals(avatarBytes), true);
});

test('production NODE_ENV variants fail closed and remove the staged avatar', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });
  const avatarDirectory = await createTempDirectory(t);
  const User = createUserModel();

  for (const nodeEnv of ['production', 'Production', ' production ']) {
    process.env.NODE_ENV = nodeEnv;
    const filePath = path.join(avatarDirectory, filename);
    await fs.writeFile(filePath, avatarBytes);
    const handler = createAvatarUploadHandler({
      ...validOptions,
      User,
      avatarDirectory,
      getStorage: () => ({ status: { r2: { available: false } } })
    });
    let nextError;

    await handler(createUploadRequest({
      path: filePath,
      filename,
      originalname: 'avatar.png',
      mimetype: 'image/png'
    }), createResponse(), (error) => { nextError = error; });

    assert.equal(nextError.statusCode, 503, `NODE_ENV=${JSON.stringify(nodeEnv)}`);
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  }
});

test('avatar temporary-file cleanup failure is logged and returned without filesystem details', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });
  process.env.NODE_ENV = ' Production ';
  const avatarDirectory = await createTempDirectory(t);
  const filePath = path.join(avatarDirectory, filename);
  await fs.writeFile(filePath, avatarBytes);
  const warnings = [];
  const handler = createAvatarUploadHandler({
    ...validOptions,
    User: createUserModel(),
    avatarDirectory,
    getStorage: () => ({ status: { r2: { available: false } } }),
    unlink: async () => { throw new Error(`synthetic unlink failure: ${filePath}`); },
    logger: { warn: (message) => warnings.push(message) }
  });
  let nextError;

  await handler(createUploadRequest({
    path: filePath,
    filename,
    originalname: 'avatar.png',
    mimetype: 'image/png'
  }), createResponse(), (error) => { nextError = error; });

  assert.equal(nextError.statusCode, 500);
  assert.equal(nextError.message, 'Upload failed and temporary file cleanup could not be completed.');
  assert.equal(nextError.message.includes(filePath), false);
  assert.deepEqual(warnings, ['Failed to remove a temporary avatar upload.']);
  assert.equal((await fs.readFile(filePath)).equals(avatarBytes), true);
});

test('R2 upload saves opaque avatar metadata and preserves the response contract', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  const filePath = path.join(avatarDirectory, filename);
  await fs.writeFile(filePath, avatarBytes);
  const User = createUserModel();
  const { runtime, client } = createR2Runtime();
  const handler = createAvatarUploadHandler({
    ...validOptions,
    User,
    avatarDirectory,
    getStorage: () => runtime
  });
  const res = createResponse();
  let nextError;

  await handler(createUploadRequest({
    path: filePath,
    filename,
    originalname: 'avatar.png',
    mimetype: 'image/png'
  }), res, (error) => { nextError = error; });

  const stored = User.records.get('synthetic-user');
  assert.equal(nextError, undefined);
  assert.match(stored.avatarStorage.key, /^avatars\/[a-f\d]{64}$/);
  assert.equal(stored.avatar, filename);
  assert.equal(stored.avatarStorage.provider, 'r2');
  assert.equal(stored.avatarStorage.checksumSha256, crypto.createHash('sha256').update(avatarBytes).digest('hex'));
  assert.equal(stored.avatarStorage.size, avatarBytes.length);
  assert.deepEqual(res.body, {
    success: true,
    message: 'Avatar uploaded successfully.',
    avatar: filename
  });
  assert.equal(JSON.stringify(res.body).includes('avatarStorage'), false);
  assert.equal(JSON.stringify(res.body).includes('cloudflarestorage.com'), false);
  assert.equal(client.objects.has(stored.avatarStorage.key), true);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});

test('R2 upload failure leaves the database unchanged', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  const filePath = path.join(avatarDirectory, filename);
  await fs.writeFile(filePath, avatarBytes);
  const prior = { _id: 'synthetic-user', avatar: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg' };
  const User = createUserModel(prior);
  const { runtime, client } = createR2Runtime();
  client.failPut = true;
  const handler = createAvatarUploadHandler({
    ...validOptions,
    User,
    avatarDirectory,
    getStorage: () => runtime
  });
  let nextError;

  await handler(createUploadRequest({
    path: filePath,
    filename,
    originalname: 'avatar.png',
    mimetype: 'image/png'
  }), createResponse(), (error) => { nextError = error; });

  assert.match(nextError.message, /Synthetic R2 upload failure/);
  assert.deepEqual(User.records.get('synthetic-user'), prior);
  assert.equal(client.commands.filter((command) => command instanceof DeleteObjectCommand).length, 0);
});

test('database update failure queues cleanup of only the new unreferenced object', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  const filePath = path.join(avatarDirectory, filename);
  await fs.writeFile(filePath, avatarBytes);
  const prior = { _id: 'synthetic-user', avatar: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg' };
  const User = createUserModel(prior);
  User.setSaveError(new Error('Synthetic database update failure'));
  const { runtime, client } = createR2Runtime();
  const handler = createAvatarUploadHandler({
    ...validOptions,
    User,
    avatarDirectory,
    getStorage: () => runtime
  });
  let nextError;

  await handler(createUploadRequest({
    path: filePath,
    filename,
    originalname: 'avatar.png',
    mimetype: 'image/png'
  }), createResponse(), (error) => { nextError = error; });

  assert.match(nextError.message, /Synthetic database update failure/);
  assert.deepEqual(User.records.get('synthetic-user'), prior);
  assert.equal(client.objects.size, 1);
  const uploadedKey = [...client.objects.keys()][0];
  assert.ok(cleanupJobs.some((job) =>
    job.purpose === 'avatars' && job.key === uploadedKey
  ));
  assert.equal(client.commands.filter((command) => command instanceof DeleteObjectCommand).length, 0);
});

test('replacement durably queues only the prior R2 avatar after saving the new reference', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  const filePath = path.join(avatarDirectory, filename);
  await fs.writeFile(filePath, avatarBytes);
  const { runtime, client } = createR2Runtime();
  const previous = await runtime.r2Storage.upload({
    purpose: 'avatar',
    body: Buffer.from('previous synthetic avatar'),
    contentType: 'image/png'
  });
  const User = createUserModel({
    _id: 'synthetic-user',
    avatar: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
    avatarStorage: {
      provider: 'r2',
      key: previous.key,
      checksumSha256: previous.checksumSha256,
      size: previous.size
    }
  });
  const handler = createAvatarUploadHandler({
    ...validOptions,
    User,
    avatarDirectory,
    getStorage: () => runtime
  });

  await handler(createUploadRequest({
    path: filePath,
    filename,
    originalname: 'avatar.png',
    mimetype: 'image/png'
  }), createResponse(), (error) => { throw error; });

  const currentKey = User.records.get('synthetic-user').avatarStorage.key;
  assert.notEqual(currentKey, previous.key);
  assert.equal(client.objects.has(previous.key), true);
  assert.equal(client.objects.has(currentKey), true);
  assert.ok(cleanupJobs.some((job) =>
    job.purpose === 'avatars' && job.key === previous.key
  ));

  const referencedKey = await runtime.r2Storage.upload({
    purpose: 'avatar',
    body: Buffer.from('shared synthetic avatar'),
    contentType: 'image/png'
  });
  const secondFilename = 'fedcba9876543210fedcba9876543210.png';
  const secondPath = path.join(avatarDirectory, secondFilename);
  await fs.writeFile(secondPath, avatarBytes);
  const currentUser = User.records.get('synthetic-user');
  currentUser.avatarStorage = {
    provider: 'r2',
    key: referencedKey.key,
    checksumSha256: referencedKey.checksumSha256,
    size: referencedKey.size
  };
  User.records.set('synthetic-user', currentUser);
  User.records.set('other-synthetic-user', {
    _id: 'other-synthetic-user',
    avatar: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
    avatarStorage: {
      provider: 'r2',
      key: referencedKey.key,
      checksumSha256: referencedKey.checksumSha256,
      size: referencedKey.size
    }
  });
  await handler(createUploadRequest({
    path: secondPath,
    filename: secondFilename,
    originalname: 'avatar.png',
    mimetype: 'image/png'
  }), createResponse(), (error) => { throw error; });
  assert.equal(client.objects.has(referencedKey.key), true);
});

async function startAvatarTestServer(t, avatarDirectory, handler) {
  const app = express();
  app.get('/uploads/avatars/:filename', handler);
  app.use('/uploads/avatars', express.static(avatarDirectory));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}/uploads/avatars`;
}

test('legacy local avatars continue serving at the existing URL after metadata lookup falls through', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  await fs.writeFile(path.join(avatarDirectory, filename), avatarBytes);
  const User = createUserModel();
  const baseUrl = await startAvatarTestServer(
    t,
    avatarDirectory,
    createAvatarDeliveryHandler({ User, getStorage: () => null })
  );

  const response = await fetch(`${baseUrl}/${filename}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), avatarBytes);
  assert.equal(User.lookupCount, 1);
});

test('R2-backed avatar takes precedence over same-name local content', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  await fs.writeFile(path.join(avatarDirectory, filename), Buffer.from('stale local avatar'));
  const { runtime, client } = createR2Runtime();
  const uploaded = await runtime.r2Storage.upload({
    purpose: 'avatar',
    body: avatarBytes,
    contentType: 'image/png'
  });
  const metadata = {
    provider: 'r2',
    key: uploaded.key,
    checksumSha256: uploaded.checksumSha256,
    size: uploaded.size
  };
  const User = createUserModel({
    _id: 'synthetic-user',
    avatar: filename,
    avatarStorage: metadata
  });
  const baseUrl = await startAvatarTestServer(
    t,
    avatarDirectory,
    createAvatarDeliveryHandler({ User, getStorage: () => runtime })
  );

  const response = await fetch(`${baseUrl}/${filename}`);
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control'), /public/);
  assert.deepEqual(body, avatarBytes);
  assert.equal(response.url.includes('cloudflarestorage.com'), false);
  assert.equal(body.toString().includes('avatarStorage'), false);
});

test('missing R2 objects and R2 read errors never fall back to same-name local content', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  await fs.writeFile(path.join(avatarDirectory, filename), Buffer.from('stale local avatar'));
  const { runtime, client } = createR2Runtime();
  const User = createUserModel({
    _id: 'synthetic-user',
    avatar: filename,
    avatarStorage: {
      provider: 'r2',
      key: `avatars/${'a'.repeat(64)}`,
      checksumSha256: 'b'.repeat(64),
      size: avatarBytes.length
    }
  });
  const baseUrl = await startAvatarTestServer(
    t,
    avatarDirectory,
    createAvatarDeliveryHandler({ User, getStorage: () => runtime })
  );

  const missingResponse = await fetch(`${baseUrl}/${filename}`);
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.headers.get('location'), null);

  client.getError = new Error('Synthetic R2 read failure');
  const failingApp = express();
  failingApp.get('/uploads/avatars/:filename',
    createAvatarDeliveryHandler({ User, getStorage: () => runtime }),
    (_req, res) => res.status(599).send('static fallback reached'));
  failingApp.use('/uploads/avatars', express.static(avatarDirectory));
  failingApp.use((error, _req, res, _next) => {
    res.status(500).send(error.message);
  });
  const server = http.createServer(failingApp);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const errorResponse = await fetch(`http://127.0.0.1:${server.address().port}/uploads/avatars/${filename}`);
  const errorBody = await errorResponse.text();
  assert.notEqual(errorResponse.status, 200);
  assert.notEqual(errorBody, 'stale local avatar');
  assert.notEqual(errorBody, 'static fallback reached');
});

test('invalid avatar filenames and traversal are rejected before metadata lookup', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  const { runtime } = createR2Runtime();
  const User = createUserModel();
  const baseUrl = await startAvatarTestServer(
    t,
    avatarDirectory,
    createAvatarDeliveryHandler({ User, getStorage: () => runtime })
  );
  const traversalResponse = await fetch(`${baseUrl}/..%5csecret.png`);
  assert.equal(traversalResponse.status, 400);
  assert.equal(User.lookupCount, 0);
});

test('duplicate filenames with R2 metadata are rejected as ambiguous', async (t) => {
  const avatarDirectory = await createTempDirectory(t);
  const { runtime } = createR2Runtime();
  const User = createUserModel({
    _id: 'synthetic-user',
    avatar: filename,
    avatarStorage: {
      provider: 'r2',
      key: `avatars/${'a'.repeat(64)}`,
      checksumSha256: 'b'.repeat(64),
      size: avatarBytes.length
    }
  });
  User.records.set('second-synthetic-user', {
    _id: 'second-synthetic-user',
    avatar: filename,
    avatarStorage: {
      provider: 'r2',
      key: `avatars/${'c'.repeat(64)}`,
      checksumSha256: 'd'.repeat(64),
      size: avatarBytes.length
    }
  });
  const baseUrl = await startAvatarTestServer(
    t,
    avatarDirectory,
    createAvatarDeliveryHandler({ User, getStorage: () => runtime })
  );
  const response = await fetch(`${baseUrl}/${filename}`);
  assert.equal(response.status, 404);
});
