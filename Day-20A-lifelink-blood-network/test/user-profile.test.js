const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const errorHandler = require('../middleware/errorHandler');
const originalUserUpdateOne = User.updateOne;
const originalCollection = mongoose.connection.collection;
const rateLimitRecords = new Map();
mongoose.connection.collection = () => ({
  createIndex: async () => 'resetTime_1',
  updateOne: async (filter, update) => {
    const now = new Date();
    const existing = rateLimitRecords.get(filter._id);
    const active = existing && existing.resetTime > now;
    const requestedResetTime = update[0].$set.resetTime.$cond[2];
    rateLimitRecords.set(filter._id, {
      totalHits: active ? existing.totalHits + 1 : 1,
      resetTime: active ? existing.resetTime : requestedResetTime
    });
    return { upsertedCount: active ? 0 : 1 };
  },
  findOne: async (filter) => rateLimitRecords.get(filter._id) || null
});

const userId = '507f1f77bcf86cd799439011';
const jwtSecret = 'lifelink-profile-unit-test-secret';
const nativeFetch = global.fetch;
let findByIdImpl = async () => null;
let findByIdAndUpdateImpl = async () => null;
let updateCalls = [];
let updateOneImpl = async () => ({ matchedCount: 1 });
let updateOneCalls = [];
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
User.updateOne = (...args) => {
  updateOneCalls.push(args);
  return updateOneImpl(...args);
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

function mockProviderFetch(providerFetch) {
  global.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:')
    ? nativeFetch(url, options)
    : providerFetch(url, options);
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
    rateLimitRecords.clear();
    updateCalls = [];
    updateOneCalls = [];
    updateOneImpl = async () => ({ matchedCount: 1 });
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
    User.updateOne = originalUserUpdateOne;
    mongoose.connection.collection = originalCollection;
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

  const phoneEnvKeys = [
    'PHONE_OTP_SECRET', 'SMS_PROVIDER', 'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'
  ];
  const originalPhoneEnv = Object.fromEntries(phoneEnvKeys.map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const phoneSecret = 'synthetic-phone-otp-test-secret';
  process.env.PHONE_OTP_SECRET = phoneSecret;
  process.env.SMS_PROVIDER = 'twilio';
  process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-id';
  process.env.TWILIO_AUTH_TOKEN = 'synthetic-provider-token';
  process.env.TWILIO_FROM_NUMBER = '+15005550006';

  t.after(() => {
    global.fetch = originalFetch;
    for (const key of phoneEnvKeys) {
      if (originalPhoneEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalPhoneEnv[key];
    }
  });

  await t.test('phone OTP routes require authentication', async () => {
    const send = await request('/users/me/phone-otp', { method: 'POST' });
    const verify = await request('/users/me/verify-phone', { method: 'POST', body: { code: '271904' } });
    assert.equal(send.status, 401);
    assert.equal(verify.status, 401);
  });

  await t.test('authenticated unverified phone can request an OTP through mocked provider transport', async () => {
    const phoneUser = { ...donor, phoneVerified: false, phoneVerificationSentAt: null };
    findByIdImpl = async () => phoneUser;
    let capturedForm;
    mockProviderFetch(async (_url, options) => {
      capturedForm = new URLSearchParams(options.body);
      return { ok: true, status: 201 };
    });
    const result = await request('/users/me/phone-otp', { method: 'POST', token: tokenFor() });
    assert.equal(result.status, 200);
    assert.equal(result.body.expiresInSeconds, 300);
    assert.equal(result.body.resendAfterSeconds, 60);
    assert.match(capturedForm.get('Body'), /\b\d{6}\b/);
    const sentCode = capturedForm.get('Body').match(/\b(\d{6})\b/)[1];
    assert.notEqual(updateOneCalls[0][1].$set.phoneVerificationHash, sentCode);
    assert.equal(updateOneCalls[0][1].$set.phoneVerificationAttempts, 0);
    assert.equal(updateOneCalls[0][1].$set.phone, donor.phone);
  });

  await t.test('OTP request without provider configuration returns the existing generic 503 and cleans stored challenge', async () => {
    const phoneUser = { ...donor, phoneVerified: false, phoneVerificationSentAt: null };
    findByIdImpl = async () => phoneUser;
    for (const key of ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']) {
      delete process.env[key];
    }
    let fetchCalled = false;
    mockProviderFetch(async () => { fetchCalled = true; throw new Error('mock should not be called'); });
    const result = await request('/users/me/phone-otp', { method: 'POST', token: tokenFor() });
    assert.equal(result.status, 503);
    assert.equal(result.body.error, 'Phone verification is not configured. Set SMS_PROVIDER (twilio or twilio-whatsapp), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and the matching TWILIO_FROM_NUMBER or TWILIO_WHATSAPP_FROM.');
    assert.equal(fetchCalled, false);
    assert.equal(updateOneCalls.length, 2);
    assert.ok(updateOneCalls[1][1].$unset.phoneVerificationHash);
  });

  await t.test('OTP verification accepts a valid unexpired HMAC challenge and clears it', async () => {
    const code = '271904';
    const phoneUser = {
      ...donor,
      phoneVerified: false,
      phoneVerificationHash: require('node:crypto').createHmac('sha256', phoneSecret)
        .update(`${userId}:${donor.phone}:${code}`).digest('hex'),
      phoneVerificationExpires: new Date(Date.now() + 60_000),
      phoneVerificationAttempts: 0
    };
    findByIdImpl = async () => phoneUser;
    const result = await request('/users/me/verify-phone', {
      method: 'POST', token: tokenFor(), body: { code }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.message, 'Phone number verified successfully.');
    assert.equal(updateOneCalls.length, 1);
    assert.equal(updateOneCalls[0][1].$set.phoneVerified, true);
    assert.ok(updateOneCalls[0][1].$unset.phoneVerificationHash);
  });

  await t.test('incorrect and expired OTP challenges are rejected without revealing challenge data', async () => {
    const crypto = require('node:crypto');
    const code = '271904';
    findByIdImpl = async () => ({
      ...donor,
      phoneVerified: false,
      phoneVerificationHash: crypto.createHmac('sha256', phoneSecret)
        .update(`${userId}:${donor.phone}:${code}`).digest('hex'),
      phoneVerificationExpires: new Date(Date.now() + 60_000),
      phoneVerificationAttempts: 0
    });
    const incorrect = await request('/users/me/verify-phone', {
      method: 'POST', token: tokenFor(), body: { code: '111111' }
    });
    assert.equal(incorrect.status, 400);
    assert.equal(incorrect.body.error, 'The verification code is incorrect.');
    assert.equal(updateOneCalls[0][1].$inc.phoneVerificationAttempts, 1);

    updateOneCalls = [];
    findByIdImpl = async () => ({
      ...donor,
      phoneVerified: false,
      phoneVerificationHash: 'a'.repeat(64),
      phoneVerificationExpires: new Date(Date.now() - 1_000),
      phoneVerificationAttempts: 0
    });
    const expired = await request('/users/me/verify-phone', {
      method: 'POST', token: tokenFor(), body: { code }
    });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.error, 'This verification code is invalid or expired. Request a new code.');
    assert.equal(updateOneCalls.length, 0);
  });

  await t.test('verified phones cannot request another OTP', async () => {
    findByIdImpl = async () => donor;
    const result = await request('/users/me/phone-otp', { method: 'POST', token: tokenFor() });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'This phone number is already verified.');
    assert.equal(updateOneCalls.length, 0);
  });

  await t.test('phone OTP send route enforces its three-message rate limit', async () => {
    findByIdImpl = async () => ({ ...donor, phoneVerified: false, phoneVerificationSentAt: null });
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-id';
    process.env.TWILIO_AUTH_TOKEN = 'synthetic-provider-token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    let providerCalls = 0;
    mockProviderFetch(async () => {
      providerCalls += 1;
      return { ok: true, status: 201 };
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const allowed = await request('/users/me/phone-otp', { method: 'POST', token: tokenFor() });
      assert.equal(allowed.status, 200);
    }
    const limited = await request('/users/me/phone-otp', { method: 'POST', token: tokenFor() });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'Too many phone verification messages. Try again later.');
    assert.equal(providerCalls, 3);
  });

  await t.test('OTP delivery cleanup failures log only fixed safe metadata and preserve the generic 503', async () => {
    const phoneUser = { ...donor, phoneVerified: false, phoneVerificationSentAt: null };
    findByIdImpl = async () => phoneUser;
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-id';
    process.env.TWILIO_AUTH_TOKEN = 'synthetic-provider-token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    const providerError = new Error('synthetic recipient token and provider response');
    providerError.name = 'SensitiveProviderName';
    providerError.code = 'synthetic-provider-code';
    providerError.stack = 'synthetic stack with fake credential';
    providerError.cause = { password: 'synthetic nested password' };
    mockProviderFetch(async () => { throw providerError; });
    updateOneImpl = async (_filter, update) => {
      if (update.$unset) {
        const cleanupError = new Error('synthetic cleanup credential in message');
        cleanupError.code = 'synthetic-cleanup-code';
        throw cleanupError;
      }
      return { matchedCount: 1 };
    };
    const originalConsoleError = console.error;
    const records = [];
    console.error = (record) => records.push(record);
    try {
      const result = await request('/users/me/phone-otp', { method: 'POST', token: tokenFor() });
      assert.equal(result.status, 503);
      assert.match(result.body.error, /verification message could not be sent/i);
      assert.ok(records.some((record) => JSON.parse(record).operation === 'phone_otp_delivery_cleanup'));
      for (const sensitive of [
        'recipient token', 'provider response', 'SensitiveProviderName', 'synthetic-provider-code',
        'fake credential', 'nested password', 'cleanup credential', 'synthetic-cleanup-code',
        donor.phone
      ]) assert.equal(records.join('\n').includes(sensitive), false);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
