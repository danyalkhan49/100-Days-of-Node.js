const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const {
  checksum,
  createStorageService
} = require('../utils/storage/storageService');
const { createR2Provider } = require('../utils/storage/r2Provider');

class FakeS3Client {
  constructor() {
    this.objects = new Map();
    this.commands = [];
  }

  async send(command) {
    this.commands.push(command);
    const { Bucket, Key } = command.input;
    const objectId = `${Bucket}/${Key}`;

    if (command instanceof PutObjectCommand) {
      this.objects.set(objectId, {
        body: Buffer.from(command.input.Body),
        contentType: command.input.ContentType,
        metadata: command.input.Metadata
      });
      return {};
    }

    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(objectId);
      if (!object) throw Object.assign(new Error('Missing object'), { name: 'NoSuchKey' });
      return {
        Body: object.body,
        ContentType: object.contentType,
        Metadata: object.metadata
      };
    }

    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(objectId);
      if (!object) {
        throw Object.assign(new Error('Missing object'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 }
        });
      }
      return { ContentType: object.contentType, Metadata: object.metadata };
    }

    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(objectId);
      return {};
    }

    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  }
}

test('R2 provider uses injected fake client for the full storage contract', async () => {
  const client = new FakeS3Client();
  const storage = createStorageService(
    createR2Provider({ client, bucket: 'lifelink-test-private' })
  );
  const body = Buffer.from('synthetic encrypted identity bytes');
  const uploaded = await storage.upload({
    purpose: 'identityDocument',
    body,
    contentType: 'application/octet-stream'
  });

  assert.match(uploaded.key, /^identity-documents\/[a-f\d]{64}$/);
  assert.equal(uploaded.checksumSha256, checksum(body));
  assert.equal(await storage.exists({ key: uploaded.key }), true);
  assert.deepEqual(await storage.verify({
    key: uploaded.key,
    checksumSha256: checksum(body)
  }), {
    exists: true,
    verified: true,
    checksumSha256: checksum(body)
  });

  const downloaded = await storage.download({
    key: uploaded.key,
    checksumSha256: checksum(body)
  });
  assert.deepEqual(downloaded.body, body);
  assert.equal(downloaded.contentType, 'application/octet-stream');
  assert.equal(downloaded.checksumSha256, checksum(body));
  assert.deepEqual(client.objects.get(`lifelink-test-private/${uploaded.key}`).body, body);

  await storage.delete({ key: uploaded.key });
  await storage.delete({ key: uploaded.key });
  assert.equal(await storage.exists({ key: uploaded.key }), false);
  assert.deepEqual(await storage.verify({
    key: uploaded.key,
    checksumSha256: checksum(body)
  }), { exists: false, verified: false });
  assert.ok(client.commands.some((command) => command instanceof PutObjectCommand));
  assert.ok(client.commands.some((command) => command instanceof GetObjectCommand));
  assert.ok(client.commands.some((command) => command instanceof HeadObjectCommand));
  assert.ok(client.commands.some((command) => command instanceof DeleteObjectCommand));
});

test('storage service rejects unsupported purposes and mismatched checksums', async () => {
  const client = new FakeS3Client();
  const storage = createStorageService(
    createR2Provider({ client, bucket: 'lifelink-test-private' })
  );
  const body = Buffer.from('synthetic avatar');

  await assert.rejects(
    storage.upload({ purpose: 'unknown', body, contentType: 'image/png' }),
    /purpose/
  );
  await assert.rejects(
    storage.upload({
      purpose: 'avatar',
      body,
      contentType: 'image/png',
      checksumSha256: '0'.repeat(64)
    }),
    /checksum/
  );
  assert.equal(client.commands.length, 0);
});

test('storage service rejects invalid keys and detects downloaded checksum mismatch', async () => {
  const client = new FakeS3Client();
  const storage = createStorageService(
    createR2Provider({ client, bucket: 'lifelink-test-private' })
  );
  const uploaded = await storage.upload({
    purpose: 'prescription',
    body: Buffer.from('synthetic prescription'),
    contentType: 'application/pdf'
  });

  await assert.rejects(
    storage.download({ key: 'prescriptions/../private' }),
    /Storage key/
  );
  await assert.rejects(
    storage.verify({ key: uploaded.key, checksumSha256: '0'.repeat(64) }),
    /expected checksum/
  );
});
