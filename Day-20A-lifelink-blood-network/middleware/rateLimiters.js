const crypto = require('crypto');
const mongoose = require('mongoose');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const RATE_LIMIT_COLLECTION = 'rate_limit_hits';
let indexPromise;

function positiveIntegerSetting(name, fallback, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}.`);
  }
  return Number(raw);
}

const verificationResendLimit = 30;
const verificationResendWindowSeconds = positiveIntegerSetting(
  'VERIFY_RESEND_WINDOW_SECONDS',
  1800,
  604800
);
const verificationResendCooldownSeconds = positiveIntegerSetting(
  'VERIFY_RESEND_COOLDOWN_SECONDS',
  60,
  86400
);

if (verificationResendCooldownSeconds >= verificationResendWindowSeconds) {
  throw new Error('VERIFY_RESEND_COOLDOWN_SECONDS must be shorter than VERIFY_RESEND_WINDOW_SECONDS.');
}

class MongoRateLimitStore {
  constructor(name) {
    this.prefix = `lifelink:${name}:`;
    this.localKeys = false;
    this.windowMs = 0;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  storageKey(key) {
    return this.prefix + crypto.createHash('sha256').update(key).digest('hex');
  }

  async ensureIndex() {
    if (!indexPromise) {
      indexPromise = mongoose.connection
        .collection(RATE_LIMIT_COLLECTION)
        .createIndex({ resetTime: 1 }, { expireAfterSeconds: 0 })
        .catch((error) => {
          indexPromise = null;
          throw error;
        });
    }
    await indexPromise;
  }

  async increment(key) {
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) {
      throw new Error('Rate-limit window must be a positive number.');
    }
    await this.ensureIndex();

    const now = new Date();
    const resetTime = new Date(now.getTime() + this.windowMs);
    const activeWindow = { $gt: [{ $ifNull: ['$resetTime', new Date(0)] }, now] };
    const collection = mongoose.connection.collection(RATE_LIMIT_COLLECTION);
    const id = this.storageKey(key);
    const update = [{
      $set: {
        totalHits: {
          $cond: [
            activeWindow,
            { $add: [{ $ifNull: ['$totalHits', 0] }, 1] },
            1
          ]
        },
        resetTime: { $cond: [activeWindow, '$resetTime', resetTime] }
      }
    }];
    try {
      await collection.updateOne({ _id: id }, update, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      await collection.updateOne({ _id: id }, update);
    }

    const record = await collection.findOne({ _id: id }, { projection: { totalHits: 1, resetTime: 1 } });
    if (!record) throw new Error('Rate-limit counter could not be read after incrementing.');
    return { totalHits: record.totalHits, resetTime: record.resetTime };
  }

  async get(key) {
    const record = await mongoose.connection.collection(RATE_LIMIT_COLLECTION).findOne(
      { _id: this.storageKey(key) },
      { projection: { totalHits: 1, resetTime: 1 } }
    );
    return record && record.resetTime > new Date()
      ? { totalHits: record.totalHits, resetTime: record.resetTime }
      : undefined;
  }

  async decrement(key) {
    await mongoose.connection.collection(RATE_LIMIT_COLLECTION).updateOne(
      { _id: this.storageKey(key), resetTime: { $gt: new Date() }, totalHits: { $gt: 0 } },
      { $inc: { totalHits: -1 } }
    );
  }

  async resetKey(key) {
    await mongoose.connection.collection(RATE_LIMIT_COLLECTION).deleteOne({ _id: this.storageKey(key) });
  }

  async resetAll() {
    await mongoose.connection.collection(RATE_LIMIT_COLLECTION).deleteMany({
      _id: { $regex: `^${this.prefix}` }
    });
  }
}

const commonOptions = {
  standardHeaders: true,
  legacyHeaders: false
};

function getRetryAfterSeconds(req, windowMs) {
  const resetTime = req.rateLimit && req.rateLimit.resetTime;
  const remainingMs = resetTime instanceof Date
    ? resetTime.getTime() - Date.now()
    : windowMs;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function verificationAccountKey(req) {
  const email = req.body && typeof req.body.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : '';
  if (!email) return `ip:${req.ip}`;
  return `account:${crypto.createHash('sha256').update(email).digest('hex')}`;
}

function uploadAccountKey(req) {
  if (req.user && typeof req.user.id === 'string' && req.user.id.length > 0) {
    return `user:${req.user.id}`;
  }
  return `ip:${ipKeyGenerator(req.ip)}`;
}

function createLimiter(name, options) {
  const { handler: customHandler, ...limiterOptions } = options;
  return rateLimit({
    ...commonOptions,
    ...limiterOptions,
    handler: customHandler || ((_req, res) => {
      res.status(429).json(limiterOptions.message || {
        success: false,
        error: 'Too many requests. Please try again later.'
      });
    }),
    store: new MongoRateLimitStore(name)
  });
}

function createUploadLimiter(name, limit, message) {
  return createLimiter(name, {
    windowMs: 60 * 60 * 1000,
    limit,
    keyGenerator: uploadAccountKey,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, error: message }
  });
}

const avatarUploadLimiter = createUploadLimiter(
  'avatar-upload',
  10,
  'Too many avatar uploads. Try again later.'
);

const prescriptionUploadLimiter = createUploadLimiter(
  'prescription-upload',
  5,
  'Too many prescription uploads. Try again later.'
);

const loginLimiter = createLimiter('login', {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: {
    success: false,
    error: 'Too many login attempts. Try again after 15 minutes.'
  }
});

const signupLimiter = createLimiter('signup', {
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: {
    success: false,
    error: 'Too many account creation attempts. Try again later.'
  }
});

const forgotPasswordLimiter = createLimiter('forgot-password', {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: {
    success: false,
    error: 'Too many password reset requests. Try again later.'
  }
});

const resetPasswordLimiter = createLimiter('reset-password', {
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: {
    success: false,
    error: 'Too many password reset attempts. Try again later.'
  }
});

const verificationEmailLimiter = createLimiter('verification-token', {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: {
    success: false,
    error: 'Too many email verification attempts. Try again later.'
  }
});

function createVerificationResendLimiter(name, windowSeconds, limit, messageForRetry) {
  return createLimiter(name, {
    windowMs: windowSeconds * 1000,
    limit,
    keyGenerator: verificationAccountKey,
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res) => {
      const retryAfterSeconds = getRetryAfterSeconds(req, windowSeconds * 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: messageForRetry(retryAfterSeconds),
        retryAfterSeconds
      });
    }
  });
}

const verificationResendCooldownLimiter = createVerificationResendLimiter(
  'verification-resend-cooldown',
  verificationResendCooldownSeconds,
  1,
  (seconds) => `Please wait ${seconds} seconds before requesting another verification email.`
);

const verificationResendQuotaLimiter = createVerificationResendLimiter(
  'verification-resend-quota',
  verificationResendWindowSeconds,
  verificationResendLimit,
  (seconds) => {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `You have reached the verification email limit. Try again in ${minutes} minutes.`;
  }
);

const verificationResendLimiters = [
  verificationResendCooldownLimiter,
  verificationResendQuotaLimiter
];

const phoneOtpSendLimiter = createLimiter('phone-otp-send', {
  windowMs: 60 * 60 * 1000,
  limit: 3,
  message: {
    success: false,
    error: 'Too many phone verification messages. Try again later.'
  }
});

const phoneOtpVerifyLimiter = createLimiter('phone-otp-verify', {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: {
    success: false,
    error: 'Too many phone verification attempts. Try again later.'
  }
});

const identityDocumentUploadLimiter = createUploadLimiter(
  'identity-document-upload',
  3,
  'Too many identity document uploads. Try again later.'
);

const reviewLimiter = createLimiter('review', {
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: {
    success: false,
    error: 'Too many reviews submitted. Try again later.'
  }
});

const reportLimiter = createLimiter('report', {
  windowMs: 60 * 60 * 1000,
  limit: 20,
  message: {
    success: false,
    error: 'Too many reports. Try again later.'
  }
});

const supportLimiter = createLimiter('support-submission', {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: {
    success: false,
    error: 'Too many support requests. Try again later.'
  }
});

const telemetryLimiter = createLimiter('telemetry', {
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: {
    success: false,
    error: 'Too many telemetry events.'
  }
});

module.exports = {
  loginLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  verificationEmailLimiter,
  verificationResendLimiters,
  phoneOtpSendLimiter,
  phoneOtpVerifyLimiter,
  avatarUploadLimiter,
  prescriptionUploadLimiter,
  identityDocumentUploadLimiter,
  reviewLimiter,
  reportLimiter,
  supportLimiter,
  telemetryLimiter
};
