const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const AdminAuditLog = require('../models/AdminAuditLog');
const accountEmail = require('../utils/accountEmail');
const monitoring = require('../utils/monitoring');

const adminId = '507f1f77bcf86cd799439011';
const targetId = '507f1f77bcf86cd799439012';
const jwtSecret = 'synthetic-admin-password-reset-logging-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;
const originalFindById = User.findById;
const originalUpdateOne = User.updateOne;
const originalAuditCreate = AdminAuditLog.create;
const originalAuditUpdateOne = AdminAuditLog.updateOne;
const originalSendPasswordResetEmail = accountEmail.sendPasswordResetEmail;
const originalCaptureException = monitoring.captureException;
const fixtures = new Map([
  [adminId, { _id: adminId, role: 'admin', isActive: true, authVersion: 0 }],
  [targetId, {
    _id: targetId,
    email: 'synthetic-user@example.invalid',
    emailVerified: true,
    isActive: true
  }]
]);
const cleanupError = new Error('synthetic-cleanup-message-secret');
cleanupError.name = 'synthetic-cleanup-name-secret';
cleanupError.code = 'synthetic-cleanup-code-secret';
cleanupError.stack = 'synthetic-cleanup-stack-secret';
cleanupError.cause = { details: 'synthetic-cleanup-nested-secret' };
const deliveryError = new Error('synthetic-delivery-message-secret');
deliveryError.name = 'synthetic-delivery-name-secret';
deliveryError.code = 'synthetic-delivery-code-secret';
deliveryError.stack = 'synthetic-delivery-stack-secret';
deliveryError.cause = { details: 'synthetic-delivery-nested-secret' };

User.findById = (id) => ({
  select() { return this; },
  then(resolve, reject) {
    return Promise.resolve(fixtures.get(String(id)) || null).then(resolve, reject);
  }
});
User.updateOne = async (filter, update) => {
  if (update.$set && update.$set.passwordResetToken) {
    Object.assign(fixtures.get(String(filter._id)), update.$set);
  }
  if (update.$unset) {
    for (const field of Object.keys(update.$unset)) delete fixtures.get(String(filter._id))[field];
  }
  return { matchedCount: 1 };
};
AdminAuditLog.create = async () => ({ _id: new mongoose.Types.ObjectId() });
AdminAuditLog.updateOne = async () => { throw cleanupError; };
accountEmail.sendPasswordResetEmail = async () => { throw deliveryError; };
monitoring.captureException = () => {};

const errorHandler = require('../middleware/errorHandler');
const app = express();
app.use(express.json());
app.use('/admin', require('../routes/adminRoutes'));
app.use(errorHandler);

test('admin password-reset failures log sanitized details and preserve the 503 response', async (t) => {
  process.env.JWT_SECRET = jwtSecret;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
    AdminAuditLog.create = originalAuditCreate;
    AdminAuditLog.updateOne = originalAuditUpdateOne;
    accountEmail.sendPasswordResetEmail = originalSendPasswordResetEmail;
    monitoring.captureException = originalCaptureException;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  const token = jwt.sign({ id: adminId, role: 'admin', authVersion: 0 }, jwtSecret);
  const loggedRecords = [];
  const originalConsoleError = console.error;
  console.error = (record) => loggedRecords.push(String(record));
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${server.address().port}/admin/users/${targetId}/password-reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'The password reset email could not be sent.'
  });
  assert.equal(fixtures.get(targetId).passwordResetToken, undefined);
  assert.equal(loggedRecords.length, 2);
  const parsedRecords = loggedRecords.map((record) => JSON.parse(record));
  assert.deepEqual(parsedRecords[0], {
    event: 'rollback_failure',
    operation: 'admin_password_reset_delivery_cleanup',
    failureCount: 1,
    errors: [{ errorType: 'Error' }]
  });
  assert.deepEqual(parsedRecords[1], {
    event: 'unexpected_server_error',
    errorType: 'Error'
  });

  const output = loggedRecords.join('\n');
  for (const sensitive of [
    'synthetic-cleanup-message-secret',
    'synthetic-cleanup-name-secret',
    'synthetic-cleanup-code-secret',
    'synthetic-cleanup-stack-secret',
    'synthetic-cleanup-nested-secret',
    'synthetic-delivery-message-secret',
    'synthetic-delivery-name-secret',
    'synthetic-delivery-code-secret',
    'synthetic-delivery-stack-secret',
    'synthetic-delivery-nested-secret'
  ]) {
    assert.equal(output.includes(sensitive), false);
  }
});
