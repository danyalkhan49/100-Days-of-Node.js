const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

const originalCollection = mongoose.connection.collection;
const records = new Map();
mongoose.connection.collection = () => ({
  createIndex: async () => 'resetTime_1',
  updateOne: async (filter, update, options) => {
    const now = new Date();
    const existing = records.get(filter._id);
    const active = existing && existing.resetTime > now;
    const requestedResetTime = update[0].$set.resetTime.$cond[2];
    records.set(filter._id, {
      totalHits: active ? existing.totalHits + 1 : 1,
      resetTime: active ? existing.resetTime : requestedResetTime
    });
    return { upsertedCount: options && options.upsert ? 1 : 0 };
  },
  findOne: async (filter) => records.get(filter._id) || null
});

const {
  loginLimiter,
  verificationEmailLimiter,
  verificationResendLimiters,
  phoneOtpSendLimiter,
  phoneOtpVerifyLimiter
} = require('../middleware/rateLimiters');

function createServer(limiter) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/limited', limiter, (_req, res) => res.status(200).json({ success: true }));
  return app.listen(0, '127.0.0.1');
}

async function post(url, { email, ip } = {}) {
  const headers = {};
  if (email) headers['Content-Type'] = 'application/json';
  if (ip) headers['X-Forwarded-For'] = ip;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    ...(email ? { body: JSON.stringify({ email }) } : {})
  });
  return {
    status: response.status,
    body: await response.json(),
    retryAfter: response.headers.get('Retry-After')
  };
}

test('rate limit responses identify the limited action', async (t) => {
  const cases = [
    {
      limiter: loginLimiter,
      limit: 10,
      expectedMessage: 'Too many login attempts. Try again after 15 minutes.'
    },
    {
      limiter: verificationEmailLimiter,
      limit: 5,
      expectedMessage: 'Too many email verification attempts. Try again later.'
    },
    {
      limiter: phoneOtpSendLimiter,
      limit: 3,
      expectedMessage: 'Too many phone verification messages. Try again later.'
    },
    {
      limiter: phoneOtpVerifyLimiter,
      limit: 10,
      expectedMessage: 'Too many phone verification attempts. Try again later.'
    }
  ];

  t.after(() => {
    mongoose.connection.collection = originalCollection;
  });

  for (const { limiter, limit, expectedMessage } of cases) {
    await t.test(expectedMessage, async (subtest) => {
      const server = createServer(limiter);
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      subtest.after(async () => {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      });

      const url = `http://127.0.0.1:${server.address().port}/limited`;
      for (let attempt = 0; attempt < limit; attempt += 1) {
        const allowed = await post(url);
        assert.equal(allowed.status, 200);
      }

      const limited = await post(url);
      assert.equal(limited.status, 429);
      assert.equal(limited.body.success, false);
      assert.equal(limited.body.error, expectedMessage);
    });
  }

  await t.test('verification resend cooldown is account-based across client IPs', async (subtest) => {
    const server = createServer(verificationResendLimiters);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    subtest.after(async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    });

    const url = `http://127.0.0.1:${server.address().port}/limited`;
    const first = await post(url, { email: 'Cooldown-Member@Example.Invalid', ip: '192.0.2.10' });
    assert.equal(first.status, 200);

    const limited = await post(url, { email: 'cooldown-member@example.invalid', ip: '192.0.2.11' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.success, false);
    assert.match(limited.body.error, /wait \d+ seconds/i);
    assert.ok(Number(limited.body.retryAfterSeconds) > 0);
    assert.ok(Number(limited.body.retryAfterSeconds) <= 60);
    assert.equal(limited.retryAfter, String(limited.body.retryAfterSeconds));
  });

  await t.test('verification resend quota allows 30 requests per account across client IPs', async (subtest) => {
    const server = createServer(verificationResendLimiters[1]);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    subtest.after(async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    });

    const url = `http://127.0.0.1:${server.address().port}/limited`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const allowed = await post(url, {
        email: 'quota-member@example.invalid',
        ip: `192.0.2.${attempt + 20}`
      });
      assert.equal(allowed.status, 200);
    }

    const limited = await post(url, {
      email: 'quota-member@example.invalid',
      ip: '198.51.100.10'
    });
    assert.equal(limited.status, 429);
    assert.match(limited.body.error, /verification email limit/i);
    assert.match(limited.body.error, /try again in \d+ minutes/i);
    assert.ok(Number(limited.body.retryAfterSeconds) > 0);
    assert.equal(limited.retryAfter, String(limited.body.retryAfterSeconds));
  });
});
