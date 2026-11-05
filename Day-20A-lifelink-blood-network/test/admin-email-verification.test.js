const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const HospitalAuditLog = require('../models/HospitalAuditLog');
const AdminAuditLog = require('../models/AdminAuditLog');
const limiters = require('../middleware/rateLimiters');
const inAppNotifications = require('../utils/inAppNotifications');
const errorHandler = require('../middleware/errorHandler');

const adminId = '507f1f77bcf86cd799439011';
const targetId = '507f1f77bcf86cd799439012';
const jwtSecret = 'lifelink-admin-email-verification-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;
const originalFindById = User.findById;
const originalFindOne = User.findOne;
const originalUpdateOne = User.updateOne;
const originalAuditCreate = AdminAuditLog.create;
const originalAdminAuditSave = AdminAuditLog.prototype.save;
const originalHospitalAuditSave = HospitalAuditLog.prototype.save;
const originalHospitalAuditDeleteOne = HospitalAuditLog.collection.deleteOne;
const originalHospitalCreate = Hospital.create;
const originalHospitalDeleteOne = Hospital.deleteOne;
const originalMongoClient = mongoose.connection.client;
const originalLoginLimiter = limiters.loginLimiter;
const originalDispatchInAppNotification = inAppNotifications.dispatchInAppNotification;
const fixtures = new Map();
let auditRecords = [];
let inAppDispatches = [];
let failAudit = false;
let verificationUpdateTrace = [];

function makeUser(id, role, overrides = {}) {
  return {
    _id: id,
    role,
    isActive: true,
    authVersion: 0,
    emailVerified: false,
    emailVerifiedAt: null,
    emailVerificationMethod: null,
    emailVerificationToken: crypto.createHash('sha256').update('pending-token').digest('hex'),
    emailVerificationExpires: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides
  };
}

User.findById = (id) => {
  const query = {
    select() { return this; },
    session() { return this; },
    then(resolve, reject) {
      return Promise.resolve(fixtures.get(String(id)) || null).then(resolve, reject);
    }
  };
  return query;
};

User.findOne = (filter) => ({
  select: async () => Array.from(fixtures.values()).find((user) =>
    user.email === filter.email && (filter.isActive !== true || user.isActive === true)
  ) || null
});

User.updateOne = async (filter, update) => {
  const user = fixtures.get(String(filter._id));
  if ((user && filter.emailVerificationMethod !== undefined) ||
      (update.$set && update.$set.emailVerificationMethod)) {
    verificationUpdateTrace.push({
      filterMethod: filter.emailVerificationMethod,
      setMethod: update.$set && update.$set.emailVerificationMethod,
      currentMethod: user && user.emailVerificationMethod
    });
  }
  if (!user || (filter.emailVerified !== undefined && user.emailVerified !== filter.emailVerified) ||
      (filter.isActive !== undefined && user.isActive !== filter.isActive) ||
      (filter.emailVerificationMethod !== undefined &&
        user.emailVerificationMethod !== filter.emailVerificationMethod) ||
      (filter.emailVerifiedAt !== undefined &&
        user.emailVerifiedAt.getTime() !== filter.emailVerifiedAt.getTime())) {
    return { matchedCount: 0 };
  }
  if (update.$set) Object.assign(user, update.$set);
  if (update.$unset) {
    for (const field of Object.keys(update.$unset)) delete user[field];
  }
  return { matchedCount: 1 };
};

AdminAuditLog.create = async (record) => {
  if (failAudit) throw new Error('test audit failure');
  auditRecords.push(record);
  return record;
};

process.env.JWT_SECRET = jwtSecret;
fixtures.set(adminId, makeUser(adminId, 'admin'));
fixtures.set(targetId, makeUser(targetId, 'requester', {
  email: 'manual-verify@example.invalid'
}));
limiters.loginLimiter = (_req, _res, next) => next();
inAppNotifications.dispatchInAppNotification = (work, label) => {
  inAppDispatches.push({ work, label });
};

const app = express();
app.use(express.json());
app.use('/admin', require('../routes/adminRoutes'));
app.use('/auth', require('../routes/authRoutes'));
app.use(errorHandler);

let server;
let baseUrl;

async function request(path, { userId, role, method = 'PATCH', body } = {}) {
  const headers = {};
  if (userId) {
    headers.Authorization = `Bearer ${jwt.sign({
      id: userId,
      role,
      authVersion: 0
    }, jwtSecret)}`;
  }
  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

test('admin email verification is protected, audited, and invalidates outstanding links', async (t) => {
  fixtures.get(targetId).password = await bcrypt.hash('TestPassword123!', 4);
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
    User.findOne = originalFindOne;
    User.updateOne = originalUpdateOne;
    AdminAuditLog.create = originalAuditCreate;
    AdminAuditLog.prototype.save = originalAdminAuditSave;
    HospitalAuditLog.prototype.save = originalHospitalAuditSave;
    HospitalAuditLog.collection.deleteOne = originalHospitalAuditDeleteOne;
    Hospital.create = originalHospitalCreate;
    Hospital.deleteOne = originalHospitalDeleteOne;
    mongoose.connection.client = originalMongoClient;
    limiters.loginLimiter = originalLoginLimiter;
    inAppNotifications.dispatchInAppNotification = originalDispatchInAppNotification;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  await t.test('rejects unauthenticated and non-admin callers', async () => {
    const unauthenticated = await request(`/admin/users/${targetId}/email-verification`);
    assert.equal(unauthenticated.status, 401);

    fixtures.set('507f1f77bcf86cd799439013', makeUser('507f1f77bcf86cd799439013', 'requester'));
    const forbidden = await request(`/admin/users/${targetId}/email-verification`, {
      userId: '507f1f77bcf86cd799439013',
      role: 'requester'
    });
    assert.equal(forbidden.status, 403);
  });

  await t.test('returns not found and rejects duplicate manual verification', async () => {
    const missing = await request('/admin/users/507f1f77bcf86cd799439014/email-verification', {
      userId: adminId,
      role: 'admin'
    });
    assert.equal(missing.status, 404);

    const target = fixtures.get(targetId);
    target.emailVerified = true;
    const duplicate = await request(`/admin/users/${targetId}/email-verification`, {
      userId: adminId,
      role: 'admin'
    });
    assert.equal(duplicate.status, 409);
    target.emailVerified = false;
  });

  await t.test('admin verifies account, records method/time, invalidates the link and writes audit', async () => {
    const target = fixtures.get(targetId);
    const token = target.emailVerificationToken;
    const loginBefore = await request('/auth/login', {
      method: 'POST',
      body: { email: target.email, password: 'TestPassword123!' }
    });
    assert.equal(loginBefore.status, 403);

    const result = await request(`/admin/users/${targetId}/email-verification`, {
      userId: adminId,
      role: 'admin'
    });

    assert.equal(result.status, 200);
    assert.equal(target.emailVerified, true);
    assert.equal(target.emailVerificationMethod, 'admin');
    assert.ok(target.emailVerifiedAt instanceof Date);
    assert.equal(target.emailVerificationToken, undefined);
    assert.equal(target.emailVerificationExpires, undefined);
    assert.equal(result.body.data.emailVerificationToken, undefined);
    assert.equal(auditRecords.length, 1);
    assert.equal(auditRecords[0].action, 'verification-decision');
    assert.equal(auditRecords[0].targetType, 'user');
    assert.equal(auditRecords[0].metadata.verificationMethod, 'admin');
    assert.ok(inAppDispatches.some((item) => item.label === 'Admin email verification'));
    assert.equal(token.length, 64);

    const loginAfter = await request('/auth/login', {
      method: 'POST',
      body: { email: target.email, password: 'TestPassword123!' }
    });
    assert.equal(loginAfter.status, 200);
    assert.ok(loginAfter.body.token);
  });

  await t.test('restores prior unverified state if audit persistence fails', async () => {
    const rollbackId = '507f1f77bcf86cd799439015';
    const rollbackUser = makeUser(rollbackId, 'requester');
    fixtures.set(rollbackId, rollbackUser);
    verificationUpdateTrace = [];
    failAudit = true;
    try {
      const originalConsoleError = console.error;
      console.error = () => {};
      let result;
      try {
        result = await request(`/admin/users/${rollbackId}/email-verification`, {
          userId: adminId,
          role: 'admin'
        });
      } finally {
        console.error = originalConsoleError;
      }
      assert.equal(result.status, 500);
      assert.equal(rollbackUser.emailVerified, false);
      assert.deepEqual(verificationUpdateTrace.map((entry) => entry.setMethod), ['admin', null]);
      assert.equal(rollbackUser.emailVerificationMethod, null);
      assert.equal(rollbackUser.emailVerificationToken, crypto.createHash('sha256').update('pending-token').digest('hex'));
      assert.ok(rollbackUser.emailVerificationExpires instanceof Date);
    } finally {
      failAudit = false;
    }
  });

  await t.test('partial admin-audit cleanup failure logs only safe rollback metadata', async () => {
    const cleanupError = new Error('synthetic cleanup message with fake credential');
    cleanupError.name = 'synthetic-cleanup-name-secret';
    cleanupError.code = 'synthetic-cleanup-code-secret';
    cleanupError.stack = 'synthetic-cleanup-stack-secret';
    cleanupError.cause = { message: 'synthetic-cleanup-nested-secret' };
    const auditSaveError = new Error('synthetic audit save failure');
    const originalConsoleError = console.error;
    const loggedRecords = [];

    mongoose.connection.client = undefined;
    Hospital.create = async (data) => ({
      ...data,
      _id: new mongoose.Types.ObjectId(),
      updatedAt: new Date()
    });
    Hospital.deleteOne = async () => ({ deletedCount: 1 });
    HospitalAuditLog.prototype.save = async function saveHospitalAudit() { return this; };
    AdminAuditLog.prototype.save = async () => { throw auditSaveError; };
    HospitalAuditLog.collection.deleteOne = async () => { throw cleanupError; };
    console.error = (record) => loggedRecords.push(String(record));

    try {
      const result = await request('/admin/hospitals', {
        userId: adminId,
        role: 'admin',
        method: 'POST',
        body: {
          name: 'Synthetic Hospital',
          city: 'Synthetic City',
          address: 'Synthetic Address',
          contactNumber: '0000000000'
        }
      });

      assert.equal(result.status, 500);
      const rollbackRecord = loggedRecords
        .map((record) => JSON.parse(record))
        .find((record) => record.event === 'rollback_failure');
      assert.deepEqual(rollbackRecord, {
        event: 'rollback_failure',
        operation: 'admin_audit_partial_write_cleanup',
        failureCount: 1,
        errors: [{ errorType: 'Error' }]
      });
      const output = loggedRecords.join('\n');
      for (const sensitive of [
        'synthetic cleanup message',
        'synthetic-cleanup-name-secret',
        'synthetic-cleanup-code-secret',
        'synthetic-cleanup-stack-secret',
        'synthetic-cleanup-nested-secret',
        'synthetic audit save failure'
      ]) {
        assert.equal(output.includes(sensitive), false);
      }
    } finally {
      console.error = originalConsoleError;
      AdminAuditLog.prototype.save = originalAdminAuditSave;
      HospitalAuditLog.prototype.save = originalHospitalAuditSave;
      HospitalAuditLog.collection.deleteOne = originalHospitalAuditDeleteOne;
      Hospital.create = originalHospitalCreate;
      Hospital.deleteOne = originalHospitalDeleteOne;
      mongoose.connection.client = originalMongoClient;
    }
  });
});
