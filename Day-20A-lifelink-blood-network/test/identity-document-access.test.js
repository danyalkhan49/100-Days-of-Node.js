const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AdminAuditLog = require('../models/AdminAuditLog');
const IdentityVerificationAuditLog = require('../models/IdentityVerificationAuditLog');
const identityDocuments = require('../utils/identityDocuments');
const errorHandler = require('../middleware/errorHandler');

const adminId = '507f1f77bcf86cd799439011';
const requesterId = '507f1f77bcf86cd799439012';
const targetId = '507f1f77bcf86cd799439013';
const jwtSecret = 'lifelink-identity-document-access-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;
const originalFindById = User.findById;
const originalAuditSave = AdminAuditLog.prototype.save;
const originalIdentityAuditSave = IdentityVerificationAuditLog.prototype.save;
const originalReadEncryptedDocument = identityDocuments.readEncryptedDocument;
const documentContents = Buffer.from('mocked decrypted identity document');
const audits = [];
let documentReadCount = 0;
let baseUrl;
let server;

function queryFor(value) {
  return {
    select() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    }
  };
}

User.findById = (id) => {
  const records = {
    [adminId]: { _id: adminId, role: 'admin', isActive: true, authVersion: 0 },
    [requesterId]: { _id: requesterId, role: 'requester', isActive: true, authVersion: 0 },
    [targetId]: {
      _id: targetId,
      identityDocument: 'a'.repeat(64) + '.enc',
      identityDocumentMimeType: 'application/pdf',
      identityVerificationStatus: 'Pending'
    }
  };
  return queryFor(records[String(id)] || null);
};

identityDocuments.readEncryptedDocument = async () => {
  documentReadCount += 1;
  return Buffer.from(documentContents);
};

AdminAuditLog.prototype.save = async function saveAudit() {
  audits.push(this.toObject());
  return this;
};
IdentityVerificationAuditLog.prototype.save = AdminAuditLog.prototype.save;

const app = express();
app.use(express.json());
app.use('/admin', require('../routes/adminRoutes'));
app.use(errorHandler);

function tokenFor(id, role) {
  return jwt.sign({ id, role, authVersion: 0 }, jwtSecret, { expiresIn: '1h' });
}

async function requestDocument(targetUserId, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(
    `${baseUrl}/admin/users/${targetUserId}/identity-document`,
    { headers }
  );
  return { response, body: Buffer.from(await response.arrayBuffer()) };
}

test('identity document download requires admin role from the stored account', async (t) => {
  process.env.JWT_SECRET = jwtSecret;
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    User.findById = originalFindById;
    AdminAuditLog.prototype.save = originalAuditSave;
    IdentityVerificationAuditLog.prototype.save = originalIdentityAuditSave;
    identityDocuments.readEncryptedDocument = originalReadEncryptedDocument;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  await t.test('rejects unauthenticated document download', async () => {
    const result = await requestDocument(targetId);
    assert.equal(result.response.status, 401);
    assert.equal(documentReadCount, 0);
  });

  await t.test('a normal user cannot download another user document, even with admin role in JWT', async () => {
    const result = await requestDocument(
      targetId,
      tokenFor(requesterId, 'admin')
    );
    assert.equal(result.response.status, 403);
    assert.equal(documentReadCount, 0);
  });

  await t.test('authorized database admin receives a private, audited document response', async () => {
    const result = await requestDocument(targetId, tokenFor(adminId, 'requester'));
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, documentContents);
    assert.equal(result.response.headers.get('cache-control'), 'no-store, private');
    assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(result.response.headers.get('content-disposition'), /attachment/);
    assert.equal(documentReadCount, 1);
    assert.equal(audits.length, 2);
    assert.ok(audits.some((audit) => audit.action === 'identity-document-downloaded'));
    assert.ok(audits.some((audit) => audit.action === 'document-downloaded'));
  });
});
