const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const accountEmail = require('../utils/accountEmail');
const limiters = require('../middleware/rateLimiters');
const errorHandler = require('../middleware/errorHandler');
const restrictTo = require('../middleware/restrictTo');

const originalEmailMethods = {
  sendPasswordResetEmail: accountEmail.sendPasswordResetEmail,
  sendVerificationEmail: accountEmail.sendVerificationEmail
};
const originalLimiters = {
  loginLimiter: limiters.loginLimiter,
  signupLimiter: limiters.signupLimiter,
  forgotPasswordLimiter: limiters.forgotPasswordLimiter,
  resetPasswordLimiter: limiters.resetPasswordLimiter,
  verificationEmailLimiter: limiters.verificationEmailLimiter
};

let findOneImpl = async () => null;
let findByIdImpl = async () => null;
let createImpl = async () => {
  throw new Error('Unexpected User.create call');
};
let updateOneImpl = async () => ({ matchedCount: 0 });

User.findOne = (filter) => ({
  select: () => findOneImpl(filter)
});
User.findById = (id) => ({
  select: () => findByIdImpl(id)
});
User.create = (data) => createImpl(data);
User.updateOne = (...args) => updateOneImpl(...args);

let verificationEmailCount = 0;
const passThrough = (_req, _res, next) => next();
for (const name of Object.keys(originalLimiters)) {
  limiters[name] = passThrough;
}
accountEmail.sendVerificationEmail = async () => {
  verificationEmailCount += 1;
};
accountEmail.sendPasswordResetEmail = async () => {};

const app = express();
app.use(express.json());
app.use('/auth', require('../routes/authRoutes'));
app.use(errorHandler);

const userId = '507f1f77bcf86cd799439011';
const jwtSecret = 'lifelink-unit-test-secret';
let baseUrl;
let server;

async function request(path, { method = 'POST', body, headers = {} } = {}) {
  const options = { method, headers: { ...headers } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

function tokenFor(payload, options) {
  return jwt.sign(payload, jwtSecret, options);
}

test('authentication and authorization', async (t) => {
  const originalSecret = process.env.JWT_SECRET;
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
    for (const [name, limiter] of Object.entries(originalLimiters)) {
      limiters[name] = limiter;
    }
    accountEmail.sendPasswordResetEmail = originalEmailMethods.sendPasswordResetEmail;
    accountEmail.sendVerificationEmail = originalEmailMethods.sendVerificationEmail;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  const password = 'ValidPass123!';
  const passwordHash = await bcrypt.hash(password, 4);
  const activeVerifiedUser = {
    _id: userId,
    name: 'Test Donor',
    email: 'donor@example.com',
    password: passwordHash,
    role: 'donor',
    isActive: true,
    emailVerified: true,
    authVersion: 2
  };

  await t.test('login returns a signed token for a verified active account', async () => {
    findOneImpl = async () => activeVerifiedUser;
    const result = await request('/auth/login', {
      body: { email: 'DONOR@example.com', password }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.role, 'donor');
    assert.equal(result.body.name, 'Test Donor');
    assert.equal(jwt.verify(result.body.token, jwtSecret).id, userId);
  });

  await t.test('login rejects an incorrect password and nonexistent account', async () => {
    findOneImpl = async () => activeVerifiedUser;
    const wrongPassword = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password: 'WrongPass123!' }
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.body.error, 'Invalid email or password.');

    findOneImpl = async () => null;
    const missingAccount = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password }
    });
    assert.equal(missingAccount.status, 401);
    assert.equal(missingAccount.body.error, 'Invalid email or password.');
  });

  await t.test('login rejects inactive accounts, including admins', async () => {
    findOneImpl = async () => ({ ...activeVerifiedUser, isActive: false });
    const inactive = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password }
    });
    assert.equal(inactive.status, 401);

    findOneImpl = async () => ({
      ...activeVerifiedUser,
      role: 'admin',
      emailVerified: false,
      isActive: false
    });
    const inactiveAdmin = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password }
    });
    assert.equal(inactiveAdmin.status, 401);
  });

  await t.test('unverified normal users remain blocked even when requesting the admin role', async () => {
    findOneImpl = async () => ({ ...activeVerifiedUser, emailVerified: false });
    const unverified = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password, role: 'admin' }
    });
    assert.equal(unverified.status, 403);

    findOneImpl = async () => ({
      ...activeVerifiedUser,
      role: 'requester',
      emailVerified: false
    });
    const unverifiedRequester = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password }
    });
    assert.equal(unverifiedRequester.status, 403);
  });

  await t.test('active unverified admins can log in without changing verification status', async () => {
    const unverifiedAdminAccount = {
      ...activeVerifiedUser,
      role: 'admin',
      emailVerified: false
    };
    findOneImpl = async () => unverifiedAdminAccount;
    const unverifiedAdmin = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password, role: 'donor' }
    });
    assert.equal(unverifiedAdmin.status, 200);
    assert.equal(unverifiedAdmin.body.role, 'admin');
    assert.equal(jwt.verify(unverifiedAdmin.body.token, jwtSecret).id, userId);
    assert.equal(unverifiedAdminAccount.emailVerified, false);
  });

  await t.test('verified admins and verified normal users can log in', async () => {
    findOneImpl = async () => ({
      ...activeVerifiedUser,
      role: 'admin',
      emailVerified: true
    });
    const verifiedAdmin = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password }
    });
    assert.equal(verifiedAdmin.status, 200);
    assert.equal(verifiedAdmin.body.role, 'admin');

    findOneImpl = async () => ({
      ...activeVerifiedUser,
      role: 'requester',
      emailVerified: true
    });
    const verifiedRequester = await request('/auth/login', {
      body: { email: activeVerifiedUser.email, password }
    });
    assert.equal(verifiedRequester.status, 200);
    assert.equal(verifiedRequester.body.role, 'requester');
  });

  await t.test('login rejects missing credentials and malformed JSON', async () => {
    const missing = await request('/auth/login', { body: { password } });
    assert.equal(missing.status, 400);

    const malformed = await request('/auth/login', { body: '{' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, 'Invalid JSON in request body');
  });

  await t.test('signup validates required fields, role, terms, and donor blood group', async () => {
    const missing = await request('/auth/signup', { body: {} });
    assert.equal(missing.status, 400);

    const validBase = {
      name: 'Test Donor',
      email: 'new@example.com',
      password,
      phone: '03001234567',
      city: 'Lahore',
      role: 'requester',
      acceptTerms: true
    };
    const invalidEmail = await request('/auth/signup', {
      body: { ...validBase, email: 'not-an-email' }
    });
    assert.equal(invalidEmail.status, 400);

    const invalidRole = await request('/auth/signup', {
      body: { ...validBase, role: 'admin' }
    });
    assert.equal(invalidRole.status, 400);

    const termsNotAccepted = await request('/auth/signup', {
      body: { ...validBase, acceptTerms: false }
    });
    assert.equal(termsNotAccepted.status, 400);

    const missingBloodGroup = await request('/auth/signup', {
      body: { ...validBase, role: 'donor' }
    });
    assert.equal(missingBloodGroup.status, 400);
  });

  await t.test('signup enforces password length and UTF-8 byte limit', async () => {
    const validBase = {
      name: 'Test Requester',
      email: 'new@example.com',
      phone: '03001234567',
      city: 'Lahore',
      role: 'requester',
      acceptTerms: true
    };
    const tooShort = await request('/auth/signup', {
      body: { ...validBase, password: 'short' }
    });
    assert.equal(tooShort.status, 400);

    const tooManyBytes = await request('/auth/signup', {
      body: { ...validBase, password: `${'a'.repeat(71)}é` }
    });
    assert.equal(tooManyBytes.status, 400);
  });

  await t.test('signup stores a password hash and uses mocked verification email delivery', async () => {
    let createdUser;
    const emailCountBefore = verificationEmailCount;
    createImpl = async (data) => {
      createdUser = data;
      return {
        _id: userId,
        name: data.name,
        email: data.email,
        role: data.role,
        emailVerified: data.emailVerified
      };
    };
    const result = await request('/auth/signup', {
      body: {
        name: 'Test Requester',
        email: 'NEW@example.com',
        password,
        phone: '03001234567',
        city: 'Lahore',
        role: 'requester',
        acceptTerms: true
      }
    });
    assert.equal(result.status, 201);
    assert.equal(createdUser.email, 'new@example.com');
    assert.notEqual(createdUser.password, password);
    assert.equal(await bcrypt.compare(password, createdUser.password), true);
    assert.equal(verificationEmailCount, emailCountBefore + 1);
    assert.equal(result.body.data.emailVerified, false);
  });

  await t.test('signup reports duplicate database records as conflict', async () => {
    createImpl = async () => {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    };
    const result = await request('/auth/signup', {
      body: {
        name: 'Test Requester',
        email: 'duplicate@example.com',
        password,
        phone: '03001234567',
        city: 'Lahore',
        role: 'requester',
        acceptTerms: true
      }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'Duplicate value: already exists');
  });

  await t.test('protected password change rejects missing and invalid bearer tokens', async () => {
    const missing = await request('/auth/change-password', {
      method: 'PUT',
      body: { currentPassword: password, newPassword: 'AnotherPass123!' }
    });
    assert.equal(missing.status, 401);

    const invalid = await request('/auth/change-password', {
      method: 'PUT',
      headers: { Authorization: 'Bearer invalid-token' },
      body: { currentPassword: password, newPassword: 'AnotherPass123!' }
    });
    assert.equal(invalid.status, 401);
  });

  await t.test('protected password change rejects malformed claims and expired tokens', async () => {
    const malformedClaim = await request('/auth/change-password', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenFor({ id: 'not-an-object-id', authVersion: 2 })}`
      },
      body: { currentPassword: password, newPassword: 'AnotherPass123!' }
    });
    assert.equal(malformedClaim.status, 401);

    const expired = await request('/auth/change-password', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokenFor({ id: userId, authVersion: 2 }, { expiresIn: -1 })}`
      },
      body: { currentPassword: password, newPassword: 'AnotherPass123!' }
    });
    assert.equal(expired.status, 401);
  });

  await t.test('protected route rejects stale sessions and unavailable users', async () => {
    findByIdImpl = async () => ({ ...activeVerifiedUser, authVersion: 3 });
    const stale = await request('/auth/change-password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenFor({ id: userId, authVersion: 2 })}` },
      body: { currentPassword: password, newPassword: 'AnotherPass123!' }
    });
    assert.equal(stale.status, 401);

    findByIdImpl = async () => null;
    const missingUser = await request('/auth/change-password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenFor({ id: userId, authVersion: 2 })}` },
      body: { currentPassword: password, newPassword: 'AnotherPass123!' }
    });
    assert.equal(missingUser.status, 401);
  });

  await t.test('protected route forwards database lookup errors', async () => {
    findByIdImpl = async () => {
      throw new Error('simulated database failure');
    };
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const result = await request('/auth/change-password', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tokenFor({ id: userId, authVersion: 2 })}` },
        body: { currentPassword: password, newPassword: 'AnotherPass123!' }
      });
      assert.equal(result.status, 500);
      assert.equal(result.body.error, 'Something went wrong on the server');
    } finally {
      console.error = originalConsoleError;
    }
  });

  await t.test('valid protected request changes password and increments authVersion', async () => {
    findByIdImpl = async () => activeVerifiedUser;
    let updateArguments;
    updateOneImpl = async (...args) => {
      updateArguments = args;
      return { matchedCount: 1 };
    };
    const result = await request('/auth/change-password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenFor({ id: userId, authVersion: 2 })}` },
      body: { currentPassword: password, newPassword: 'AnotherPass123!' }
    });
    assert.equal(result.status, 200);
    assert.equal(updateArguments[1].$inc.authVersion, 1);
    assert.equal(await bcrypt.compare('AnotherPass123!', updateArguments[1].$set.password), true);
  });

  await t.test('restrictTo requires authentication and rejects disallowed roles', async () => {
    const invoke = (user) => new Promise((resolve) => {
      restrictTo('admin')({ user }, {}, (error) => resolve(error || null));
    });
    const unauthenticated = await invoke(undefined);
    assert.equal(unauthenticated.statusCode, 401);

    const forbidden = await invoke({ role: 'requester' });
    assert.equal(forbidden.statusCode, 403);
  });

  await t.test('restrictTo permits an allowed role in either role representation', async () => {
    const invoke = (user) => new Promise((resolve) => {
      restrictTo('admin')({ user }, {}, (error) => resolve(error || null));
    });
    assert.equal(await invoke({ role: 'admin' }), null);
    assert.equal(await invoke({ role: 'requester', roles: ['requester', 'admin'] }), null);
  });
});
