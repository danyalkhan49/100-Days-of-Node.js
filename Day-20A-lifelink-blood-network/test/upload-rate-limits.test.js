const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

const records = new Map();
const originalCollection = mongoose.connection.collection;
const originalFindById = User.findById;

mongoose.connection.collection = () => ({
  createIndex: async () => 'resetTime_1',
  updateOne: async (filter, _update, _options) => {
    const now = new Date();
    const current = records.get(filter._id);
    if (current && current.resetTime > now) current.totalHits += 1;
    else records.set(filter._id, {
      totalHits: 1,
      resetTime: new Date(now.getTime() + 60 * 60 * 1000)
    });
    return { acknowledged: true };
  },
  findOne: async (filter) => {
    const record = records.get(filter._id);
    return record && record.resetTime > new Date() ? record : null;
  }
});

const {
  avatarUploadLimiter,
  prescriptionUploadLimiter,
  identityDocumentUploadLimiter
} = require('../middleware/rateLimiters');
const protect = require('../middleware/protect');

function createServer(limiter, { authenticated = false, onUpload = () => {} } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  if (authenticated) app.use(protect);
  else {
    app.use((req, _res, next) => {
      if (req.get('x-test-user')) req.user = { id: req.get('x-test-user') };
      next();
    });
  }
  app.post('/upload', limiter, (_req, res) => {
    onUpload();
    res.status(200).json({ success: true });
  });
  const server = app.listen(0, '127.0.0.1');
  return server;
}

async function listen(server) {
  if (server.listening) return;
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function post(server, { user, ip } = {}) {
  const headers = {};
  if (user) headers['X-Test-User'] = user;
  if (ip) headers['X-Forwarded-For'] = ip;
  const result = await fetch(`http://127.0.0.1:${server.address().port}/upload`, {
    method: 'POST',
    headers
  });
  return { status: result.status, body: await result.json() };
}

test('avatar upload limiter counts authenticated user across client IPs', async (t) => {
  const server = createServer(avatarUploadLimiter);
  await listen(server);
  t.after(() => close(server));

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await post(server, {
      user: 'synthetic-user-avatar',
      ip: `192.0.2.${attempt + 1}`
    })).status, 200);
  }
  const limited = await post(server, {
    user: 'synthetic-user-avatar',
    ip: '198.51.100.10'
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, {
    success: false,
    error: 'Too many avatar uploads. Try again later.'
  });
});

test('prescription and identity upload limits are distinct and per authenticated user', async (t) => {
  const cases = [
    {
      limiter: prescriptionUploadLimiter,
      limit: 5,
      user: 'synthetic-prescription-user',
      message: 'Too many prescription uploads. Try again later.'
    },
    {
      limiter: identityDocumentUploadLimiter,
      limit: 3,
      user: 'synthetic-identity-user',
      message: 'Too many identity document uploads. Try again later.'
    }
  ];

  for (const entry of cases) {
    await t.test(entry.message, async (subtest) => {
      const server = createServer(entry.limiter);
      await listen(server);
      subtest.after(() => close(server));

      for (let attempt = 0; attempt < entry.limit; attempt += 1) {
        assert.equal((await post(server, { user: entry.user })).status, 200);
      }
      const limited = await post(server, { user: entry.user });
      assert.equal(limited.status, 429);
      assert.deepEqual(limited.body, { success: false, error: entry.message });

      const otherUser = await post(server, { user: `${entry.user}-other` });
      assert.equal(otherUser.status, 200);
    });
  }
});

test('unauthenticated IP fallback uses normalized IPv6 client addresses', async (t) => {
  const server = createServer(avatarUploadLimiter);
  await listen(server);
  t.after(() => close(server));

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const address = `2001:db8:abcd:12::${attempt}`;
    assert.equal((await post(server, { ip: address })).status, 200);
  }
  const limited = await post(server, { ip: '2001:db8:abcd:12::ff' });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, {
    success: false,
    error: 'Too many avatar uploads. Try again later.'
  });
});

test('authentication rejects upload requests before upload processing', async (t) => {
  const secret = 'synthetic-upload-auth-test-secret';
  const previousJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  User.findById = (id) => ({
    select() {
      return Promise.resolve({
        _id: id,
        role: 'requester',
        isActive: true,
        authVersion: 0
      });
    }
  });
  t.after(() => {
    User.findById = originalFindById;
    mongoose.connection.collection = originalCollection;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });

  let uploadProcessingCalls = 0;
  const server = createServer(avatarUploadLimiter, {
    authenticated: true,
    onUpload: () => { uploadProcessingCalls += 1; }
  });
  await listen(server);
  t.after(() => close(server));

  const unauthorized = await fetch(`http://127.0.0.1:${server.address().port}/upload`, {
    method: 'POST'
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(uploadProcessingCalls, 0);

  const token = jwt.sign({ id: '507f1f77bcf86cd799439011', authVersion: 0 }, secret);
  const authenticated = await fetch(`http://127.0.0.1:${server.address().port}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(authenticated.status, 200);
  assert.equal(uploadProcessingCalls, 1);
});
