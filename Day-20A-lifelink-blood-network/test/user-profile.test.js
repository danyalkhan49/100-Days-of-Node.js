const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const errorHandler = require('../middleware/errorHandler');

const userId = '507f1f77bcf86cd799439011';
const jwtSecret = 'lifelink-profile-unit-test-secret';
let findByIdImpl = async () => null;
let findByIdAndUpdateImpl = async () => null;
let updateCalls = [];
let selections = [];
let baseUrl;
let server;

function createQuery(callback) {
  let result;
  const execute = () => {
    if (!result) result = Promise.resolve().then(callback);
    return result;
  };
  return {
    select(selection) {
      selections.push(selection);
      return this;
    },
    lean() {
      return execute();
    },
    then(resolve, reject) {
      return execute().then(resolve, reject);
    }
  };
}

User.findById = (id) => createQuery(() => findByIdImpl(id));
User.findByIdAndUpdate = (...args) => {
  updateCalls.push(args);
  return createQuery(() => findByIdAndUpdateImpl(...args));
};

const app = express();
app.use(express.json());
app.use('/users', require('../routes/userRoutes'));
app.use(errorHandler);

function tokenFor(role = 'donor', authVersion = 0) {
  return jwt.sign({ id: userId, authVersion }, jwtSecret, { expiresIn: '1h' });
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  const options = { method, headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

test('user management profile routes', async (t) => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = jwtSecret;
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.beforeEach(() => {
    updateCalls = [];
    selections = [];
    findByIdImpl = async () => null;
    findByIdAndUpdateImpl = async () => null;
  });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  const donor = {
    _id: userId,
    name: 'Sam Donor',
    email: 'sam@example.com',
    password: 'must-not-be-selected',
    role: 'donor',
    isActive: true,
    authVersion: 0,
    phone: '+923001234567',
    phoneVerified: true,
    city: 'Lahore',
    isAvailable: true,
    bloodGroup: 'O+'
  };

  await t.test('profile endpoints require authentication', async () => {
    const profile = await request('/users/me');
    assert.equal(profile.status, 401);

    const update = await request('/users/me', {
      method: 'PUT',
      body: { name: 'Changed' }
    });
    assert.equal(update.status, 401);

    const invalidToken = await request('/users/me', {
      token: 'invalid-token'
    });
    assert.equal(invalidToken.status, 401);
  });

  await t.test('GET profile returns the authenticated user without password or authVersion', async () => {
    findByIdImpl = async () => {
      const { password, authVersion, ...profile } = donor;
      return profile;
    };
    const result = await request('/users/me', { token: tokenFor() });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.name, donor.name);
    assert.equal(result.body.data.email, donor.email);
    assert.equal(Object.hasOwn(result.body.data, 'password'), false);
    assert.equal(Object.hasOwn(result.body.data, 'authVersion'), false);
    assert.ok(selections.includes('-password -authVersion'));
  });

  await t.test('GET profile returns not found when the account no longer exists', async () => {
    let lookupCount = 0;
    findByIdImpl = async () => ++lookupCount === 1 ? donor : null;
    const result = await request('/users/me', { token: tokenFor() });
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'User not found.');
  });

  await t.test('PUT profile trims fields, normalizes phone, and clears old phone verification', async () => {
    findByIdImpl = async () => donor;
    findByIdAndUpdateImpl = async (_id, update) => ({
      _id: userId,
      ...donor,
      ...update.$set
    });
    const result = await request('/users/me', {
      method: 'PUT',
      token: tokenFor(),
      body: {
        name: '  Sam Updated  ',
        phone: '03009876543',
        city: '  Karachi  '
      }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.name, 'Sam Updated');
    assert.equal(result.body.data.phone, '+923009876543');
    assert.equal(result.body.data.city, 'Karachi');
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0][1].$set.phoneVerified, false);
    assert.deepEqual(Object.keys(updateCalls[0][1].$unset).sort(), [
      'phoneVerificationAttempts',
      'phoneVerificationExpires',
      'phoneVerificationHash',
      'phoneVerificationSentAt'
    ]);
  });

  await t.test('PUT profile accepts a phone formatting change without invalidating the same number', async () => {
    findByIdImpl = async () => donor;
    findByIdAndUpdateImpl = async (_id, update) => ({
      _id: userId,
      ...donor,
      ...update.$set
    });
    const result = await request('/users/me', {
      method: 'PUT',
      token: tokenFor(),
      body: { phone: '03001234567' }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.phone, donor.phone);
    assert.equal(updateCalls[0][1].$set.phoneVerified, undefined);
    assert.equal(updateCalls[0][1].$unset, undefined);
  });

  await t.test('PUT profile accepts maximum name and city lengths', async () => {
    findByIdImpl = async () => donor;
    findByIdAndUpdateImpl = async (_id, update) => ({
      _id: userId,
      ...donor,
      ...update.$set
    });
    const name = 'n'.repeat(80);
    const city = 'c'.repeat(80);
    const result = await request('/users/me', {
      method: 'PUT',
      token: tokenFor(),
      body: { name, city }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.name.length, 80);
    assert.equal(result.body.data.city.length, 80);
  });

  await t.test('PUT profile allows donors to change availability and rejects it for requesters', async () => {
    findByIdImpl = async () => donor;
    findByIdAndUpdateImpl = async (_id, update) => ({
      _id: userId,
      ...donor,
      ...update.$set
    });
    const allowed = await request('/users/me', {
      method: 'PUT',
      token: tokenFor('donor'),
      body: { isAvailable: false }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.data.isAvailable, false);

    findByIdImpl = async () => ({ ...donor, role: 'requester' });
    const forbidden = await request('/users/me', {
      method: 'PUT',
      token: tokenFor('requester'),
      body: { isAvailable: false }
    });
    assert.equal(forbidden.status, 400);
  });

  await t.test('PUT profile rejects missing, empty, unsupported, or invalid fields', async () => {
    findByIdImpl = async () => donor;
    const token = tokenFor();
    const cases = [
      { body: {}, expected: 400 },
      { body: { name: '   ' }, expected: 400 },
      { body: { isAvailable: 'false' }, expected: 400 },
      { body: { email: 'attacker@example.com' }, expected: 400 },
      { body: { phone: 'not-a-phone' }, expected: 400 },
      { body: { name: 'n'.repeat(81) }, expected: 400 },
      { body: { city: 'c'.repeat(81) }, expected: 400 },
      { body: { phone: '0'.repeat(31) }, expected: 400 }
    ];
    for (const { body, expected } of cases) {
      const result = await request('/users/me', { method: 'PUT', token, body });
      assert.equal(result.status, expected, JSON.stringify(body));
    }
    assert.equal(updateCalls.length, 0);
  });

  await t.test('PUT profile returns not found for missing user or failed update', async () => {
    let lookupCount = 0;
    findByIdImpl = async () => ++lookupCount === 1 ? donor : null;
    const missingAccount = await request('/users/me', {
      method: 'PUT',
      token: tokenFor(),
      body: { name: 'Changed' }
    });
    assert.equal(missingAccount.status, 404);

    findByIdImpl = async () => donor;
    findByIdAndUpdateImpl = async () => null;
    const failedUpdate = await request('/users/me', {
      method: 'PUT',
      token: tokenFor(),
      body: { name: 'Changed' }
    });
    assert.equal(failedUpdate.status, 404);
  });

  await t.test('PUT profile forwards database errors', async () => {
    findByIdImpl = async () => {
      throw new Error('simulated profile lookup failure');
    };
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const result = await request('/users/me', {
        method: 'PUT',
        token: tokenFor(),
        body: { name: 'Changed' }
      });
      assert.equal(result.status, 500);
      assert.equal(result.body.error, 'Something went wrong on the server');
    } finally {
      console.error = originalConsoleError;
    }
  });
});
