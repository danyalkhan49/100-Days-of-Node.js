const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../utils/jwtSecret');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/User');
const {
  loginLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  verificationEmailLimiter,
  verificationResendLimiters
} = require('../middleware/rateLimiters');
const {
  createAccountMailTransporter,
  getEmailFailureMessage,
  sendPasswordResetEmail,
  sendVerificationEmail
} = require('../utils/accountEmail');
const { logOperationFailure, logRollbackFailure } = require('../utils/safeErrorLogger');
const { normalizePakistanPhone } = require('../utils/phoneProvider');
const protect = require('../middleware/protect');
const {
  createInAppNotification,
  dispatchInAppNotification
} = require('../utils/inAppNotifications');

const router = express.Router();
const USER_ROLES = new Set(['donor', 'requester']);
const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TERMS_VERSION = '1.0';
const PRIVACY_VERSION = '1.0';

function readBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Request body must be a JSON object.', 400);
  }
  return body;
}

function readRequiredString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new AppError(`${field} is required and must be no more than ${maxLength} characters.`, 400);
  }
  return value.trim();
}

function createToken(user) {
  return jwt.sign({ id: String(user._id), authVersion: user.authVersion || 0 }, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d'
  });
}

router.post('/signup', signupLimiter, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const name = readRequiredString(body.name, 'name', 80);
  const email = readRequiredString(body.email, 'email', 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const phone = normalizePakistanPhone(readRequiredString(body.phone, 'phone', 30));
  const city = readRequiredString(body.city, 'city', 80);
  const role = body.role;
  if (body.acceptTerms !== true) {
    throw new AppError('You must accept the Terms & Conditions and Privacy Policy.', 400);
  }

  if (!EMAIL_PATTERN.test(email)) throw new AppError('email must be a valid email address.', 400);
  if (password.length < 8 || password.length > 72 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new AppError('password must be 8-72 characters and no more than 72 UTF-8 bytes.', 400);
  }
  if (!USER_ROLES.has(role)) {
    throw new AppError('role must be donor or requester.', 400);
  }

  const rawVerificationToken = crypto.randomBytes(32).toString('hex');
  const hashedVerificationToken = crypto.createHash('sha256').update(rawVerificationToken).digest('hex');
  const userData = {
    name,
    email,
    password: await bcrypt.hash(password, 10),
    phone,
    city,
    role,
    emailVerified: false,
    emailVerificationToken: hashedVerificationToken,
    emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    termsAcceptedAt: new Date(),
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION
  };
  if (role === 'donor') {
    if (!BLOOD_GROUPS.has(body.bloodGroup)) {
      throw new AppError('A valid bloodGroup is required for donor accounts.', 400);
    }
    userData.bloodGroup = body.bloodGroup;
  }

  const user = await User.create(userData);
  try {
    await sendVerificationEmail(user.email, rawVerificationToken);
  } catch (error) {
    logOperationFailure('email_registration_verification', error);
    throw new AppError(
      `Your account was created, but verification email delivery failed. ${getEmailFailureMessage(error)} Use resend verification after the email service is fixed.`,
      503
    );
  }
  res.status(201).json({
    success: true,
    message: 'Account created. Check your email for the verification link.',
    data: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified
    }
  });
}));

router.post('/login', loginLimiter, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const email = readRequiredString(body.email, 'email', 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!EMAIL_PATTERN.test(email) || password.length === 0 ||
      password.length > 72 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new AppError('Invalid email or password.', 401);
  }

  const user = await User.findOne({ email }).select('+password');
  if (!user || user.isActive === false || !await bcrypt.compare(password, user.password)) {
    throw new AppError('Invalid email or password.', 401);
  }
  if (!user.emailVerified && user.role !== 'admin') {
    throw new AppError('Verify your email address before signing in. Use the resend verification option if needed.', 403);
  }

  res.status(200).json({
    success: true,
    token: createToken(user),
    role: user.role,
    name: user.name
  });
}));

router.post('/verify-email', verificationEmailLimiter, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const token = body.token;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new AppError('This verification link is invalid or has expired.', 400);
  }
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const verifiedAt = new Date();
  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: verifiedAt },
    emailVerified: false,
    isActive: true
  }).select('_id');
  if (!user) {
    throw new AppError('This verification link is invalid, expired, or already used.', 400);
  }
  const result = await User.updateOne(
    {
      _id: user._id,
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: verifiedAt },
      emailVerified: false,
      isActive: true
    },
    {
      $set: {
        emailVerified: true,
        emailVerifiedAt: verifiedAt,
        emailVerificationMethod: 'email'
      },
      $unset: { emailVerificationToken: 1, emailVerificationExpires: 1 }
    }
  );
  if (result.matchedCount !== 1) {
    throw new AppError('This verification link is invalid, expired, or already used.', 400);
  }
  dispatchInAppNotification(() => createInAppNotification({
    eventKey: `email-verification:${user._id}`,
    recipient: user._id,
    title: 'Email verified',
    message: 'Your email address has been verified successfully.',
    type: 'verification-update'
  }), 'Email verification');
  res.status(200).json({ success: true, message: 'Email verified successfully.' });
}));

router.post('/resend-verification', ...verificationResendLimiters, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const email = readRequiredString(body.email, 'email', 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new AppError('Enter a valid email address.', 400);
  const user = await User.findOne({ email, isActive: true })
    .select('_id email emailVerified +emailVerificationToken +emailVerificationExpires');
  if (!user) {
    console.info('Verification resend skipped: no matching active account.');
  } else if (user.emailVerified) {
    console.info('Verification resend skipped: account already verified.');
  } else {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const result = await User.updateOne(
      { _id: user._id, emailVerified: false, isActive: true },
      {
        $set: {
          emailVerificationToken: hashedToken,
          emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      }
    );
    if (result.matchedCount === 1) {
      try {
        await sendVerificationEmail(user.email, rawToken);
        console.info('Verification email accepted by SMTP server.');
      } catch (error) {
        const restore = {};
        const valuesToRestore = {};
        const fieldsToClear = {};
        if (user.emailVerificationToken) valuesToRestore.emailVerificationToken = user.emailVerificationToken;
        else fieldsToClear.emailVerificationToken = 1;
        if (user.emailVerificationExpires) valuesToRestore.emailVerificationExpires = user.emailVerificationExpires;
        else fieldsToClear.emailVerificationExpires = 1;
        if (Object.keys(valuesToRestore).length) restore.$set = valuesToRestore;
        if (Object.keys(fieldsToClear).length) restore.$unset = fieldsToClear;
        try {
          await User.updateOne(
            { _id: user._id, emailVerificationToken: hashedToken, emailVerified: false, isActive: true },
            restore
          );
        } catch (restoreError) {
          logRollbackFailure('email_verification_resend_cleanup', restoreError);
        }
        logOperationFailure('email_verification_resend', error);
        throw new AppError(getEmailFailureMessage(error), 503);
      }
    } else {
      console.info('Verification resend skipped: account state changed before token update.');
    }
  }
  res.status(200).json({
    success: true,
    message: 'If an active unverified account matches that email, a verification link has been sent.'
  });
}));

router.post('/forgot-password', forgotPasswordLimiter, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const email = readRequiredString(body.email, 'email', 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new AppError('Enter a valid email address.', 400);

  createAccountMailTransporter();
  const user = await User.findOne({ email, isActive: true }).select('_id email');
  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000);
    await User.updateOne(
      { _id: user._id, isActive: true },
      { $set: { passwordResetToken: hashedToken, passwordResetExpires: expires } }
    );

    try {
      await sendPasswordResetEmail(user.email, rawToken);
    } catch (error) {
      try {
        await User.updateOne(
          { _id: user._id, passwordResetToken: hashedToken },
          { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
        );
      } catch (cleanupError) {
        logRollbackFailure('email_password_reset_cleanup', cleanupError);
      }
      logOperationFailure('email_password_reset', error);
    }
  }

  res.status(200).json({
    success: true,
    message: 'If an active account matches that email, a password reset link has been sent.'
  });
}));

router.post('/reset-password', resetPasswordLimiter, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const token = body.token;
  const password = body.password;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new AppError('This password reset link is invalid or has expired.', 400);
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 72 ||
      Buffer.byteLength(password, 'utf8') > 72) {
    throw new AppError('password must be 8-72 characters and no more than 72 UTF-8 bytes.', 400);
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await User.updateOne(
    {
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
      isActive: true
    },
    {
      $set: { password: hashedPassword },
      $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
      $inc: { authVersion: 1 }
    },
    { runValidators: true }
  );
  if (result.matchedCount !== 1) {
    throw new AppError('This password reset link is invalid or has expired.', 400);
  }

  res.status(200).json({
    success: true,
    message: 'Your password has been reset. Sign in with your new password.'
  });
}));

router.put('/change-password', protect, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (Object.keys(body).some((key) => !['currentPassword', 'newPassword'].includes(key))) {
    throw new AppError('Only currentPassword and newPassword are supported.', 400);
  }
  if (!currentPassword || currentPassword.length > 72 || Buffer.byteLength(currentPassword, 'utf8') > 72) {
    throw new AppError('Enter your current password.', 400);
  }
  if (newPassword.length < 8 || newPassword.length > 72 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    throw new AppError('newPassword must be 8-72 characters and no more than 72 UTF-8 bytes.', 400);
  }

  const user = await User.findById(req.user.id).select('+password authVersion isActive');
  if (!user || user.isActive === false || !await bcrypt.compare(currentPassword, user.password)) {
    throw new AppError('Current password is incorrect.', 401);
  }
  if (await bcrypt.compare(newPassword, user.password)) {
    throw new AppError('Choose a new password that is different from your current password.', 400);
  }
  const password = await bcrypt.hash(newPassword, 10);
  const result = await User.updateOne(
    {
      _id: user._id,
      isActive: true,
      $or: [
        { authVersion: user.authVersion || 0 },
        { authVersion: { $exists: false } }
      ]
    },
    { $set: { password }, $inc: { authVersion: 1 } },
    { runValidators: true }
  );
  if (result.matchedCount !== 1) {
    throw new AppError('Your account changed while updating the password. Sign in again and retry.', 409);
  }

  res.status(200).json({
    success: true,
    message: 'Your password has been changed. Sign in again with your new password.'
  });
}));

module.exports = router;
