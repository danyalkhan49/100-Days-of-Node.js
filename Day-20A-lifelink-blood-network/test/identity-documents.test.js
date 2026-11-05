const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const identityDocuments = require('../utils/identityDocuments');
const uploadIdentityDocument = require('../middleware/uploadIdentityDocument');
const errorHandler = require('../middleware/errorHandler');

const originalEncryptionKey = process.env.ID_DOCUMENT_ENCRYPTION_KEY;

const uploadApp = express();
uploadApp.post('/upload', uploadIdentityDocument, (_req, res) => {
  res.status(200).json({ success: true });
});
uploadApp.use(errorHandler);

let server;
let baseUrl;

async function uploadFile(name, contents) {
  const form = new FormData();
  form.append('identityDocument', new Blob([contents]), name);
  const response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json() };
}

test('identity document encryption, validation, and upload middleware', async (t) => {
  const key = crypto.randomBytes(32).toString('hex');
  process.env.ID_DOCUMENT_ENCRYPTION_KEY = key;
  server = uploadApp.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (originalEncryptionKey === undefined) delete process.env.ID_DOCUMENT_ENCRYPTION_KEY;
    else process.env.ID_DOCUMENT_ENCRYPTION_KEY = originalEncryptionKey;
  });

  await t.test('rejects missing and malformed encryption keys', () => {
    delete process.env.ID_DOCUMENT_ENCRYPTION_KEY;
    assert.throws(
      () => identityDocuments.getEncryptionKey(),
      (error) => error.statusCode === 503 && error.code === undefined
    );

    for (const invalidKey of ['a'.repeat(62), 'g'.repeat(64), 'a'.repeat(64) + '00']) {
      process.env.ID_DOCUMENT_ENCRYPTION_KEY = invalidKey;
      assert.throws(
        () => identityDocuments.getEncryptionKey(),
        (error) => error.statusCode === 503
      );
    }
    process.env.ID_DOCUMENT_ENCRYPTION_KEY = key;
    assert.equal(identityDocuments.getEncryptionKey().length, 32);
  });

  await t.test('encrypts and decrypts binary document content using AES-256-GCM', () => {
    const contents = Buffer.from([0, 1, 2, 255, 10, 13]);
    const encrypted = identityDocuments.encryptDocument(contents);
    assert.notDeepEqual(encrypted, contents);
    assert.deepEqual(identityDocuments.decryptDocument(encrypted), contents);
    assert.equal(encrypted.subarray(0, 5).toString('ascii'), 'LLID1');
  });

  await t.test('rejects tampered documents and documents encrypted with another key', () => {
    const encrypted = identityDocuments.encryptDocument(Buffer.from('private document bytes'));
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(
      () => identityDocuments.decryptDocument(tampered),
      (error) => error.statusCode === 500 &&
        /could not be authenticated or is corrupted/i.test(error.message) &&
        !error.message.includes(key)
    );

    const originalKey = process.env.ID_DOCUMENT_ENCRYPTION_KEY;
    process.env.ID_DOCUMENT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    try {
      assert.throws(
        () => identityDocuments.decryptDocument(encrypted),
        (error) => error.statusCode === 500 &&
          /could not be authenticated or is corrupted/i.test(error.message)
      );
    } finally {
      process.env.ID_DOCUMENT_ENCRYPTION_KEY = originalKey;
    }
  });

  await t.test('rejects malformed encrypted headers and unsafe stored filenames', async () => {
    assert.throws(
      () => identityDocuments.decryptDocument(Buffer.from('not an encrypted document')),
      (error) => error.statusCode === 500
    );
    await assert.rejects(
      identityDocuments.readEncryptedDocument('..\\private.pdf'),
      (error) => error.statusCode === 500 && /reference is invalid/i.test(error.message)
    );
  });

  await t.test('validates document extension and file signature', () => {
    assert.equal(
      identityDocuments.getDocumentType('identity.pdf', Buffer.from('%PDF-1.7')).mimeType,
      'application/pdf'
    );
    assert.throws(
      () => identityDocuments.getDocumentType('identity.pdf', Buffer.from('not a PDF')),
      (error) => error.statusCode === 400
    );
    assert.throws(
      () => identityDocuments.getDocumentType('identity.exe', Buffer.from('%PDF-1.7')),
      (error) => error.statusCode === 400
    );
    assert.throws(
      () => identityDocuments.getDocumentType('identity.png', Buffer.alloc(0)),
      (error) => error.statusCode === 400
    );
  });

  await t.test('rejects unsupported upload types and uploads over 5 MB', async () => {
    const unsupported = await uploadFile('identity.exe', Buffer.from('file'));
    assert.equal(unsupported.status, 400);
    assert.match(unsupported.body.error, /only PDF, JPG, JPEG, and PNG/i);

    const oversized = await uploadFile('identity.pdf', Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.equal(oversized.status, 400);
    assert.match(oversized.body.error, /exceeds the 5MB size limit/i);
  });
});
