const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const accountEmail = require('../utils/accountEmail');
const inAppNotifications = require('../utils/inAppNotifications');
const limiters = require('../middleware/rateLimiters');
const errorHandler = require('../middleware/errorHandler');

const userId = '507f1f77bcf86cd799439011';
const jwtSecret = 'lifelink-email-verification-test-secret';
const envKeys = [
  'FRONTEND_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'JWT_SECRET'
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalCreateTransport = nodemailer.createTransport;
const limiterNames = [
  'loginLimiter',
  'signupLimiter',
  'forgotPasswordLimiter',
  'verificationEmailLimiter'
];
const originalLimiters = Object.fromEntries(
  limiterNames.map((name) => [name, limiters[name]])
);
const originalVerificationResendLimiters = limiters.verificationResendLimiters;
const originalDispatchInAppNotification = inAppNotifications.dispatchInAppNotification;

let storedUser;
let capturedMessages = [];
let transportOptions = [];
let inboxDispatches = [];
let mockedSendMail = async (message) => {
  capturedMessages.push(message);
  return { accepted: [message.to] };
};
inAppNotifications.dispatchInAppNotification = (work, label) => {
  inboxDispatches.push({ work, label });
};
let baseUrl;
let server;

for (const name of limiterNames) {
  limiters[name] = (_req, _res, next) => next();
}
limiters.verificationResendLimiters = [
  (_req, _res, next) => next(),
  (_req, _res, next) => next()
];

nodemailer.createTransport = (options) => {
  transportOptions.push(options);
  return {
    sendMail: (message) => mockedSendMail(message)
  };
};

User.create = async (data) => {
  storedUser = { ...data, _id: userId, isActive: true, authVersion: 0 };
  return storedUser;
};
User.findOne = (filter) => ({
  select: async () => {
    if (!storedUser) return null;
    if (filter.email && storedUser.email !== filter.email) return null;
    if (filter.emailVerificationToken &&
        storedUser.emailVerificationToken !== filter.emailVerificationToken) return null;
    if (filter.emailVerified !== undefined && storedUser.emailVerified !== filter.emailVerified) return null;
    if (filter.isActive === true && storedUser.isActive !== true) return null;
    const expiresAfter = filter.emailVerificationExpires && filter.emailVerificationExpires.$gt;
    if (expiresAfter && !(storedUser.emailVerificationExpires > expiresAfter)) return null;
    return { ...storedUser };
  }
});
User.updateOne = async (filter, update) => {
  if (!storedUser || (filter._id && String(filter._id) !== String(storedUser._id))) {
    return { matchedCount: 0 };
  }
  if (filter.emailVerificationToken &&
      storedUser.emailVerificationToken !== filter.emailVerificationToken) {
    return { matchedCount: 0 };
  }
  if (filter.emailVerified !== undefined && storedUser.emailVerified !== filter.emailVerified) {
    return { matchedCount: 0 };
  }
  if (filter.isActive !== undefined && storedUser.isActive !== filter.isActive) {
    return { matchedCount: 0 };
  }
  const expiry = filter.emailVerificationExpires && filter.emailVerificationExpires.$gt;
  if (expiry && !(storedUser.emailVerificationExpires > expiry)) {
    return { matchedCount: 0 };
  }
  if (update.$set) Object.assign(storedUser, update.$set);
  if (update.$unset) {
    for (const field of Object.keys(update.$unset)) delete storedUser[field];
  }
  return { matchedCount: 1 };
};

const app = express();
app.use(express.json());
app.use('/auth', require('../routes/authRoutes'));
app.use(errorHandler);

function extractToken(message) {
  const match = message.text.match(/verify-email\.html#token=([a-f0-9]{64})/i);
  assert.ok(match, 'verification email must contain a 64-character token link');
  return match[1];
}

async function request(path, { method = 'POST', body } = {}) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

function signupBody(email) {
  return {
    name: 'Test Requester',
    email,
    password: 'TestPassword123!',
    phone: '03001234567',
    city: 'Lahore',
    role: 'requester',
    acceptTerms: true
  };
}

test('email verification flow', async (t) => {
  process.env.JWT_SECRET = jwtSecret;
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_USER = 'lifelink-test@example.invalid';
  process.env.SMTP_PASS = 'mock-app-password';

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
    nodemailer.createTransport = originalCreateTransport;
    inAppNotifications.dispatchInAppNotification = originalDispatchInAppNotification;
    for (const [name, limiter] of Object.entries(originalLimiters)) {
      limiters[name] = limiter;
    }
    limiters.verificationResendLimiters = originalVerificationResendLimiters;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  await t.test('missing FRONTEND_URL produces an explicit configuration error', async () => {
    delete process.env.FRONTEND_URL;
    assert.throws(
      () => accountEmail.getFrontendBaseUrl(),
      (error) => error.code === 'EMAIL_FRONTEND_URL_CONFIG' && error.statusCode === 503
    );

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const result = await request('/auth/signup', {
        body: signupBody('missing-url@example.invalid')
      });
      assert.equal(result.status, 503);
      assert.match(result.body.error, /set FRONTEND_URL/i);
      assert.equal(storedUser.emailVerified, false);
      assert.equal(typeof storedUser.emailVerificationToken, 'string');
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(capturedMessages.length, 0);
  });

  await t.test('valid frontend URL creates a frontend verification link without real delivery', async () => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    const rawToken = 'a'.repeat(64);
    await accountEmail.sendVerificationEmail('member@example.invalid', rawToken);
    const message = capturedMessages.at(-1);
    const expectedLink = `http://localhost:3000/verify-email.html#token=${rawToken}`;
    assert.match(message.text, new RegExp(expectedLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(message.html.includes(`href="${expectedLink}"`));
    assert.equal(message.to, 'member@example.invalid');
    assert.equal(message.from, 'lifelink-test@example.invalid');
    assert.equal(transportOptions.at(-1).host, 'smtp.gmail.com');
    assert.equal(transportOptions.at(-1).port, 465);
    assert.equal(transportOptions.at(-1).secure, true);
    assert.equal(transportOptions.at(-1).auth.user, 'lifelink-test@example.invalid');
    assert.equal(transportOptions.at(-1).auth.pass, 'mock-app-password');
  });

  await t.test('missing and invalid SMTP configuration is rejected without transport creation', () => {
    const original = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASS
    };
    const invalidConfigs = [
      { SMTP_HOST: 'smtp gmail.com' },
      { SMTP_USER: 'not-an-email' },
      { SMTP_PORT: '2525' }
    ];
    try {
      delete process.env.SMTP_PASS;
      assert.throws(
        () => accountEmail.createAccountMailTransporter(),
        (error) => error.code === 'EMAIL_SMTP_CONFIG' && error.statusCode === 503
      );
      for (const config of invalidConfigs) {
        Object.assign(process.env, {
          SMTP_HOST: original.host,
          SMTP_PORT: original.port,
          SMTP_USER: original.user,
          SMTP_PASS: original.password,
          ...config
        });
        assert.throws(
          () => accountEmail.createAccountMailTransporter(),
          (error) => error.code === 'EMAIL_SMTP_CONFIG' && error.statusCode === 503
        );
      }
    } finally {
      process.env.SMTP_HOST = original.host;
      process.env.SMTP_PORT = original.port;
      process.env.SMTP_USER = original.user;
      process.env.SMTP_PASS = original.password;
    }
    assert.equal(transportOptions.length, 1);
  });

  await t.test('configured Gmail SMTP uses the selected TLS mode and SMTP_USER as sender', async () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'mock-user@example.com';
    process.env.SMTP_PASS = 'mock-app-password';
    accountEmail.createAccountMailTransporter();
    assert.equal(transportOptions.at(-1).auth.user, 'mock-user@example.com');
    assert.equal(transportOptions.at(-1).auth.pass, 'mock-app-password');
    assert.equal(transportOptions.at(-1).host, 'smtp.gmail.com');
    assert.equal(transportOptions.at(-1).port, 587);
    assert.equal(transportOptions.at(-1).secure, false);
    assert.equal(transportOptions.at(-1).requireTLS, true);

    await accountEmail.sendNotificationEmail('recipient@example.invalid', {
      subject: 'Notification test',
      text: 'Mocked notification'
    });
    assert.equal(capturedMessages.at(-1).from, 'mock-user@example.com');
    assert.equal(capturedMessages.at(-1).to, 'recipient@example.invalid');
  });

  await t.test('signup stores only a hashed, expiring token and emails the raw token', async () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'lifelink-test@example.invalid';
    process.env.SMTP_PASS = 'mock-app-password';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    capturedMessages = [];
    const result = await request('/auth/signup', {
      body: signupBody('new-member@example.invalid')
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.data.emailVerified, false);
    const rawToken = extractToken(capturedMessages.at(-1));
    assert.equal(storedUser.emailVerified, false);
    assert.equal(storedUser.emailVerificationToken, crypto.createHash('sha256').update(rawToken).digest('hex'));
    assert.notEqual(storedUser.emailVerificationToken, rawToken);
    assert.ok(storedUser.emailVerificationExpires > new Date());
    assert.equal(storedUser.email, 'new-member@example.invalid');
  });

  await t.test('unverified login is blocked; invalid and expired tokens cannot verify', async () => {
    const rawToken = extractToken(capturedMessages.at(-1));
    const login = await request('/auth/login', {
      body: { email: storedUser.email, password: 'TestPassword123!' }
    });
    assert.equal(login.status, 403);

    const malformed = await request('/auth/verify-email', { body: { token: 'bad-token' } });
    assert.equal(malformed.status, 400);

    const originalExpiry = storedUser.emailVerificationExpires;
    storedUser.emailVerificationExpires = new Date(Date.now() - 1000);
    const expired = await request('/auth/verify-email', { body: { token: rawToken } });
    assert.equal(expired.status, 400);
    assert.equal(storedUser.emailVerified, false);
    storedUser.emailVerificationExpires = originalExpiry;
  });

  await t.test('resend reports SMTP authentication failure and restores the previous token', async () => {
    const signup = await request('/auth/signup', {
      body: signupBody('smtp-failure@example.invalid')
    });
    assert.equal(signup.status, 201);
    const priorTokenHash = storedUser.emailVerificationToken;
    const priorExpiry = storedUser.emailVerificationExpires;
    mockedSendMail = async () => {
      const error = new Error('redacted SMTP auth failure');
      error.code = 'EAUTH';
      throw error;
    };

    const originalConsoleError = console.error;
    const errorLogs = [];
    console.error = (...args) => errorLogs.push(args);
    let response;
    try {
      response = await request('/auth/resend-verification', {
        body: { email: storedUser.email }
      });
    } finally {
      console.error = originalConsoleError;
      mockedSendMail = async (message) => {
        capturedMessages.push(message);
        return { accepted: [message.to] };
      };
    }

    assert.equal(response.status, 503);
    assert.match(response.body.error, /could not authenticate/i);
    assert.equal(storedUser.emailVerificationToken, priorTokenHash);
    assert.equal(storedUser.emailVerificationExpires, priorExpiry);
    assert.equal(JSON.stringify(errorLogs).includes('redacted SMTP auth failure'), false);
    assert.equal(JSON.stringify(errorLogs).includes('smtp-failure@example.invalid'), false);
  });

  await t.test('valid token verifies the account once and then allows login', async () => {
    const rawToken = extractToken(capturedMessages.at(-1));
    const verified = await request('/auth/verify-email', { body: { token: rawToken } });
    assert.equal(verified.status, 200);
    assert.equal(storedUser.emailVerified, true);
    assert.ok(storedUser.emailVerifiedAt instanceof Date);
    assert.equal(storedUser.emailVerificationMethod, 'email');
    assert.equal(storedUser.emailVerificationToken, undefined);
    assert.equal(storedUser.emailVerificationExpires, undefined);
    assert.ok(inboxDispatches.some((item) => item.label === 'Email verification'));

    const replay = await request('/auth/verify-email', { body: { token: rawToken } });
    assert.equal(replay.status, 400);

    const login = await request('/auth/login', {
      body: { email: storedUser.email, password: 'TestPassword123!' }
    });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);
  });

  await t.test('resend rotates tokens, keeps unknown-account responses generic, and verifies only the latest link', async () => {
    const signup = await request('/auth/signup', {
      body: signupBody('resend-member@example.invalid')
    });
    assert.equal(signup.status, 201);
    const messageCount = capturedMessages.length;

    const firstResend = await request('/auth/resend-verification', {
      body: { email: storedUser.email }
    });
    assert.equal(firstResend.status, 200);
    assert.equal(capturedMessages.length, messageCount + 1);
    const firstToken = extractToken(capturedMessages.at(-1));
    const firstHash = storedUser.emailVerificationToken;

    const secondResend = await request('/auth/resend-verification', {
      body: { email: storedUser.email }
    });
    assert.equal(secondResend.status, 200);
    assert.equal(capturedMessages.length, messageCount + 2);
    const secondToken = extractToken(capturedMessages.at(-1));
    assert.notEqual(storedUser.emailVerificationToken, firstHash);
    assert.notEqual(secondToken, firstToken);

    const stale = await request('/auth/verify-email', { body: { token: firstToken } });
    assert.equal(stale.status, 400);
    const current = await request('/auth/verify-email', { body: { token: secondToken } });
    assert.equal(current.status, 200);

    const afterCount = capturedMessages.length;
    const originalConsoleInfo = console.info;
    const infoMessages = [];
    console.info = (message) => infoMessages.push(message);
    let unknown;
    try {
      unknown = await request('/auth/resend-verification', {
        body: { email: 'unknown@example.invalid' }
      });
    } finally {
      console.info = originalConsoleInfo;
    }
    assert.equal(unknown.status, 200);
    assert.equal(capturedMessages.length, afterCount);
    assert.match(unknown.body.message, /if an active unverified account/i);
    assert.ok(infoMessages.includes('Verification resend skipped: no matching active account.'));
    assert.equal(infoMessages.some((message) => message.includes('@')), false);
  });

  await t.test('verification transport failure is reported without leaking the SMTP error', async () => {
    mockedSendMail = async () => {
      const error = new Error('redacted SMTP transport failure');
      error.code = 'ECONNECTION';
      throw error;
    };
    try {
      await assert.rejects(
        accountEmail.sendVerificationEmail('member@example.invalid', 'b'.repeat(64)),
        (error) => error.code === 'ECONNECTION'
      );
    } finally {
      mockedSendMail = async (message) => {
        capturedMessages.push(message);
        return { accepted: [message.to] };
      };
    }
  });

  await t.test('password reset email contains a reset link and transport failures reject', async () => {
    process.env.FRONTEND_URL = 'https://lifelink.example';
    await accountEmail.sendPasswordResetEmail('member@example.invalid', 'c'.repeat(64));
    const message = capturedMessages.at(-1);
    assert.equal(message.from, process.env.SMTP_USER);
    assert.equal(message.to, 'member@example.invalid');
    assert.match(message.subject, /reset your lifelink password/i);
    assert.match(message.text, /reset-password\.html#token=c{64}/);
    assert.match(message.html, /reset-password\.html#token=c{64}/);

    mockedSendMail = async () => {
      const error = new Error('redacted SMTP transport failure');
      error.code = 'ECONNECTION';
      throw error;
    };
    try {
      await assert.rejects(
        accountEmail.sendPasswordResetEmail('member@example.invalid', 'd'.repeat(64)),
        (error) => error.code === 'ECONNECTION'
      );
    } finally {
      mockedSendMail = async (nextMessage) => {
        capturedMessages.push(nextMessage);
        return { accepted: [nextMessage.to] };
      };
    }
  });

  await t.test('forgot-password sends the password reset message through mocked SMTP', async () => {
    const signup = await request('/auth/signup', {
      body: signupBody('forgot-password@example.invalid')
    });
    assert.equal(signup.status, 201);
    capturedMessages = [];

    const response = await request('/auth/forgot-password', {
      body: { email: 'forgot-password@example.invalid' }
    });

    assert.equal(response.status, 200);
    assert.match(response.body.message, /if an active account matches/i);
    assert.equal(capturedMessages.length, 1);
    assert.equal(capturedMessages[0].to, 'forgot-password@example.invalid');
    assert.match(capturedMessages[0].subject, /reset your lifelink password/i);
    assert.match(capturedMessages[0].text, /reset-password\.html#token=[a-f0-9]{64}/);
    assert.equal(typeof storedUser.passwordResetToken, 'string');
    assert.equal(storedUser.passwordResetToken.length, 64);
    assert.ok(storedUser.passwordResetExpires > new Date());
  });
});
