const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const {
  createIdentityDocumentUploadHandler,
  createIdentityDocumentWithdrawalHandler,
  readIdentityDocument
} = require('../utils/identityDocumentStorage');
const { createR2Provider } = require('../utils/storage/r2Provider');
const { createStorageService } = require('../utils/storage/storageService');
const identityDocuments = require('../utils/identityDocuments');

const plaintext = Buffer.from('%PDF-1.7 synthetic identity document');
const syntheticKey = crypto.randomBytes(32).toString('hex');
const previousEncryptionKey = process.env.ID_DOCUMENT_ENCRYPTION_KEY;

class FakeS3Client {
  constructor() {
    this.objects = new Map();
    this.commands = [];
    this.failPut = null;
    this.failGet = null;
  }

  async send(command) {
    this.commands.push(command);
    const key = command.input.Key;
    if (command instanceof PutObjectCommand) {
      if (this.failPut) throw this.failPut;
      this.objects.set(key, {
        body: Buffer.from(command.input.Body),
        contentType: command.input.ContentType,
        metadata: command.input.Metadata
      });
      return {};
    }
    if (command instanceof GetObjectCommand) {
      if (this.failGet) throw this.failGet;
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error('Missing object'), { name: 'NoSuchKey' });
      return {
        Body: object.body,
        ContentType: object.contentType,
        Metadata: object.metadata
      };
    }
    if (command instanceof HeadObjectCommand) {
      if (!this.objects.has(key)) {
        throw Object.assign(new Error('Missing object'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 }
        });
      }
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  }
}

function createRuntime(client = new FakeS3Client()) {
  return {
    client,
    runtime: {
      status: { r2: { available: true } },
      r2Storage: createStorageService(
        createR2Provider({ client, bucket: 'lifelink-identity-test' })
      )
    }
  };
}

function createUserModel(initial = {}, onUpdate = () => {}) {
  const record = {
    _id: 'synthetic-user',
    identityDocument: null,
    identityDocumentStorage: undefined,
    ...initial
  };
  let updateError = null;
  const model = {
    record,
    findById() {
      return {
        select: async () => ({ ...record })
      };
    },
    async findOneAndUpdate(filter, update) {
      onUpdate();
      if (updateError) throw updateError;
      if (filter.identityDocument !== (record.identityDocument || null)) return null;
      Object.assign(record, update.$set || {});
      for (const field of Object.keys(update.$unset || {})) delete record[field];
      return { ...record };
    },
    failUpdate(error) {
      updateError = error;
    }
  };
  return model;
}

function response() {
  return {
    code: null,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function transaction(operation) {
  return operation({ syntheticSession: true });
}

async function createTempDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lifelink-identity-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('identity R2 upload stores verified AES-GCM ciphertext and only safe response fields', async (t) => {
  process.env.ID_DOCUMENT_ENCRYPTION_KEY = syntheticKey;
  t.after(() => {
    if (previousEncryptionKey === undefined) delete process.env.ID_DOCUMENT_ENCRYPTION_KEY;
    else process.env.ID_DOCUMENT_ENCRYPTION_KEY = previousEncryptionKey;
  });
  const { runtime, client } = createRuntime();
  let commandCountWhenSaved;
  const User = createUserModel({}, () => {
    commandCountWhenSaved = client.commands.length;
  });
  const queued = [];
  const handler = createIdentityDocumentUploadHandler({
    User,
    StorageCleanupJob: {},
    enqueueCleanup: async (target) => queued.push(target),
    withRequiredTransaction: transaction,
    getStorage: () => runtime
  });
  const res = response();

  await handler({
    file: { originalname: 'synthetic.pdf', buffer: plaintext },
    body: { consent: 'true' },
    user: { id: 'synthetic-user' }
  }, res);

  const stored = User.record;
  const key = stored.identityDocumentStorage.key;
  const encrypted = client.objects.get(key).body;
  assert.match(key, /^identity-documents\/[a-f\d]{64}$/);
  assert.notDeepEqual(encrypted, plaintext);
  assert.deepEqual(identityDocuments.decryptDocument(encrypted), plaintext);
  assert.equal(stored.identityDocumentStorage.provider, 'r2');
  assert.equal(stored.identityDocumentStorage.checksumSha256, crypto.createHash('sha256').update(encrypted).digest('hex'));
  assert.equal(stored.identityDocumentStorage.size, encrypted.length);
  assert.equal(stored.identityDocumentMimeType, 'application/pdf');
  assert.equal(commandCountWhenSaved, 3);
  assert.ok(client.commands[0] instanceof PutObjectCommand);
  assert.ok(client.commands[1] instanceof HeadObjectCommand);
  assert.ok(client.commands[2] instanceof GetObjectCommand);
  assert.equal(JSON.stringify(res.body).includes('identityDocumentStorage'), false);
  assert.equal(JSON.stringify(res.body).includes(key), false);
  assert.deepEqual(queued, []);
});

test('local fallback keeps encrypted files isolated and writes no R2 metadata', async (t) => {
  process.env.ID_DOCUMENT_ENCRYPTION_KEY = syntheticKey;
  t.after(() => {
    if (previousEncryptionKey === undefined) delete process.env.ID_DOCUMENT_ENCRYPTION_KEY;
    else process.env.ID_DOCUMENT_ENCRYPTION_KEY = previousEncryptionKey;
  });
  const directory = await createTempDirectory(t);
  const User = createUserModel();
  const unavailable = { status: { r2: { available: false } } };
  const handler = createIdentityDocumentUploadHandler({
    User,
    StorageCleanupJob: {},
    enqueueCleanup: async () => {},
    withRequiredTransaction: transaction,
    getStorage: () => unavailable,
    saveLocal: (buffer) => identityDocuments.saveEncryptedDocument(buffer, directory),
    removeLocal: (filename) => identityDocuments.removeEncryptedDocument(filename, directory)
  });

  await handler({
    file: { originalname: 'synthetic.pdf', buffer: plaintext },
    body: { consent: 'true' },
    user: { id: 'synthetic-user' }
  }, response());

  assert.equal(User.record.identityDocumentStorage, undefined);
  const ciphertext = await fs.readFile(path.join(directory, User.record.identityDocument));
  assert.notDeepEqual(ciphertext, plaintext);
  assert.deepEqual(identityDocuments.decryptDocument(ciphertext), plaintext);
});

test('production NODE_ENV variants fail closed before identity documents use local storage', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });
  const User = createUserModel();
  let localSaveCalls = 0;
  const handler = createIdentityDocumentUploadHandler({
    User,
    StorageCleanupJob: {},
    enqueueCleanup: async () => {},
    withRequiredTransaction: transaction,
    getStorage: () => ({ status: { r2: { available: false } } }),
    saveLocal: async () => {
      localSaveCalls += 1;
      return 'synthetic-local.enc';
    }
  });

  for (const nodeEnv of ['production', 'Production', ' production ']) {
    process.env.NODE_ENV = nodeEnv;
    await assert.rejects(handler({
      file: { originalname: 'synthetic.pdf', buffer: plaintext },
      body: { consent: 'true' },
      user: { id: 'synthetic-user' }
    }, response()), (error) => {
      assert.equal(error.statusCode, 503, `NODE_ENV=${JSON.stringify(nodeEnv)}`);
      return true;
    });
  }

  assert.equal(localSaveCalls, 0);
  assert.equal(User.record.identityDocument, null);
});

test('R2 upload and database failures preserve existing references and enqueue only the new object', async (t) => {
  process.env.ID_DOCUMENT_ENCRYPTION_KEY = syntheticKey;
  t.after(() => {
    if (previousEncryptionKey === undefined) delete process.env.ID_DOCUMENT_ENCRYPTION_KEY;
    else process.env.ID_DOCUMENT_ENCRYPTION_KEY = previousEncryptionKey;
  });
  const old = {
    identityDocument: `${'a'.repeat(64)}.enc`,
    identityDocumentMimeType: 'application/pdf'
  };
  const User = createUserModel(old);
  const { runtime, client } = createRuntime();
  const queued = [];
  const handler = createIdentityDocumentUploadHandler({
    User,
    StorageCleanupJob: {},
    enqueueCleanup: async (target) => queued.push(target),
    withRequiredTransaction: transaction,
    getStorage: () => runtime
  });
  User.failUpdate(new Error('Synthetic database update failure'));

  await assert.rejects(handler({
    file: { originalname: 'synthetic.pdf', buffer: plaintext },
    body: { consent: 'true' },
    user: { id: 'synthetic-user' }
  }, response()), /Synthetic database update failure/);

  assert.equal(User.record.identityDocument, old.identityDocument);
  assert.equal(User.record.identityDocumentStorage, undefined);
  assert.equal(client.objects.size, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].purpose, 'identity-documents');
  assert.ok(client.objects.has(queued[0].key));

  const failingClient = new FakeS3Client();
  failingClient.failPut = new Error('Synthetic R2 upload failure');
  const failingRuntime = createRuntime(failingClient).runtime;
  const preservedUser = createUserModel(old);
  const failingHandler = createIdentityDocumentUploadHandler({
    User: preservedUser,
    StorageCleanupJob: {},
    enqueueCleanup: async () => {},
    withRequiredTransaction: transaction,
    getStorage: () => failingRuntime
  });
  await assert.rejects(failingHandler({
    file: { originalname: 'synthetic.pdf', buffer: plaintext },
    body: { consent: 'true' },
    user: { id: 'synthetic-user' }
  }, response()), /Synthetic R2 upload failure/);
  assert.equal(preservedUser.record.identityDocument, old.identityDocument);
});

test('identity replacement commits the old-key cleanup job with the new reference', async (t) => {
  process.env.ID_DOCUMENT_ENCRYPTION_KEY = syntheticKey;
  t.after(() => {
    if (previousEncryptionKey === undefined) delete process.env.ID_DOCUMENT_ENCRYPTION_KEY;
    else process.env.ID_DOCUMENT_ENCRYPTION_KEY = previousEncryptionKey;
  });
  const { runtime, client } = createRuntime();
  const oldKey = `identity-documents/${'f'.repeat(64)}`;
  const oldMetadata = {
    provider: 'r2',
    key: oldKey,
    checksumSha256: 'a'.repeat(64),
    size: 77
  };
  const User = createUserModel({
    identityDocument: `${'b'.repeat(64)}.enc`,
    identityDocumentStorage: oldMetadata
  });
  const queued = [];
  const handler = createIdentityDocumentUploadHandler({
    User,
    StorageCleanupJob: {},
    enqueueCleanup: async (target, session) => queued.push({ target, session }),
    withRequiredTransaction: transaction,
    getStorage: () => runtime
  });
  const res = response();

  await handler({
    file: { originalname: 'synthetic.pdf', buffer: plaintext },
    body: { consent: 'true' },
    user: { id: 'synthetic-user' }
  }, res);

  const current = User.record.identityDocumentStorage;
  assert.notEqual(current.key, oldKey);
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0], {
    target: { purpose: 'identity-documents', key: oldKey },
    session: { syntheticSession: true }
  });
  assert.equal(client.objects.has(current.key), true);
  assert.equal(JSON.stringify(res.body).includes(current.key), false);
});

test('admin document reads verify R2 ciphertext before decrypting and never fall back locally', async () => {
  process.env.ID_DOCUMENT_ENCRYPTION_KEY = syntheticKey;
  try {
    const { runtime } = createRuntime();
    const ciphertext = identityDocuments.encryptDocument(plaintext);
    const uploaded = await runtime.r2Storage.upload({
      purpose: 'identityDocument',
      body: ciphertext,
      contentType: 'application/octet-stream'
    });
    const metadata = {
      provider: 'r2',
      key: uploaded.key,
      checksumSha256: uploaded.checksumSha256,
      size: uploaded.size
    };
    let localReads = 0;
    assert.deepEqual(await readIdentityDocument({
      filename: 'synthetic.enc',
      metadata,
      storageRuntime: runtime,
      readLocal: async () => {
        localReads += 1;
        throw new Error('Local fallback must not run.');
      }
    }), plaintext);
    assert.equal(localReads, 0);

    await assert.rejects(readIdentityDocument({
      filename: 'synthetic.enc',
      metadata: { ...metadata, checksumSha256: '0'.repeat(64) },
      storageRuntime: runtime,
      readLocal: async () => {
        localReads += 1;
        throw new Error('Local fallback must not run.');
      }
    }));
    assert.equal(localReads, 0);

    await assert.rejects(readIdentityDocument({
      filename: 'synthetic.enc',
      metadata: {
        ...metadata,
        key: `identity-documents/${'c'.repeat(64)}`
      },
      storageRuntime: runtime,
      readLocal: async () => {
        localReads += 1;
        throw new Error('Local fallback must not run.');
      }
    }));
    assert.equal(localReads, 0);
  } finally {
    if (previousEncryptionKey === undefined) delete process.env.ID_DOCUMENT_ENCRYPTION_KEY;
    else process.env.ID_DOCUMENT_ENCRYPTION_KEY = previousEncryptionKey;
  }
});

test('identity withdrawal queues R2 cleanup with the cleared database reference', async () => {
  const oldKey = `identity-documents/${'c'.repeat(64)}`;
  const User = createUserModel({
    identityDocument: `${'d'.repeat(64)}.enc`,
    identityDocumentStorage: {
      provider: 'r2',
      key: oldKey,
      checksumSha256: 'e'.repeat(64),
      size: 99
    }
  });
  const queued = [];
  const handler = createIdentityDocumentWithdrawalHandler({
    User,
    enqueueCleanup: async (target, session) => queued.push({ target, session }),
    withRequiredTransaction: transaction
  });
  const res = response();

  await handler({ user: { id: 'synthetic-user' } }, res);

  assert.equal(User.record.identityDocument, undefined);
  assert.equal(User.record.identityDocumentStorage, undefined);
  assert.deepEqual(queued, [{
    target: { purpose: 'identity-documents', key: oldKey },
    session: { syntheticSession: true }
  }]);
  assert.equal(res.body.success, true);
});
