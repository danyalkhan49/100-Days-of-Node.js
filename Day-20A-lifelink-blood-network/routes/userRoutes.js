const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const express = require('express');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');
const validateObjectId = require('../middleware/validateObjectId');
const uploadAvatar = require('../middleware/uploadAvatar');
const User = require('../models/User');
const StorageCleanupJob = require('../models/StorageCleanupJob');
const Block = require('../models/Block');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { normalizePakistanPhone, sendVerificationCode } = require('../utils/phoneProvider');
const { logRollbackFailure } = require('../utils/safeErrorLogger');
const {
  phoneOtpSendLimiter,
  phoneOtpVerifyLimiter,
  avatarUploadLimiter,
  identityDocumentUploadLimiter
} = require('../middleware/rateLimiters');
const Offer = require('../models/Offer');
const { checkDonorEligibility } = require('../utils/bloodCompatibility');
const uploadIdentityDocument = require('../middleware/uploadIdentityDocument');
const { createAvatarUploadHandler } = require('../utils/avatarStorage');
const { withRequiredTransaction } = require('../utils/requiredTransaction');
const { enqueueStorageCleanupJob } = require('../utils/storageCleanupQueue');
const {
  createIdentityDocumentUploadHandler,
  createIdentityDocumentWithdrawalHandler
} = require('../utils/identityDocumentStorage');

const router = express.Router();

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
}

function readBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reject('Request body must be a JSON object.');
  }
  return body;
}

const avatarDirectory = path.resolve(__dirname, '../public/uploads/avatars');

async function validateAvatar(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const contents = await fs.promises.readFile(file.path);
  const isValid = {
    '.jpg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    '.jpeg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    '.png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    '.webp': (buffer) => buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }[extension];
  if (!isValid || !isValid(contents)) {
    reject('The uploaded file content does not match an allowed image type.');
  }
}

router.get('/me', protect, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id).select('-password -authVersion').lean();
  if (!user) reject('User not found.', 404);
  res.status(200).json({ success: true, data: user });
}));

router.put('/me', protect, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const allowedFields = new Set(['name', 'phone', 'city', 'isAvailable']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    reject('The request contains unsupported profile fields.');
  }

  const updates = {};
  for (const field of ['name', 'phone', 'city']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      if (typeof body[field] !== 'string' || !body[field].trim()) {
        reject(`${field} must be a non-empty string.`);
      }
      const maxLength = field === 'name' ? 80 : field === 'city' ? 80 : 30;
      if (body[field].trim().length > maxLength) {
        reject(`${field} must be no more than ${maxLength} characters.`);
      }
      updates[field] = field === 'phone'
        ? normalizePakistanPhone(body[field])
        : body[field].trim();
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isAvailable')) {
    if (req.user.role !== 'donor' || typeof body.isAvailable !== 'boolean') {
      reject('isAvailable is only editable as a boolean by donors.');
    }
    updates.isAvailable = body.isAvailable;
  }
  if (Object.keys(updates).length === 0) reject('No valid fields provided for update.');

  const existingUser = await User.findById(req.user.id).select('phone');
  if (!existingUser) reject('User not found.', 404);
  if (Object.prototype.hasOwnProperty.call(updates, 'phone')) {
    if (existingUser.phone !== updates.phone) {
      updates.phoneVerified = false;
      updates.$unset = {
        phoneVerificationHash: 1,
        phoneVerificationExpires: 1,
        phoneVerificationAttempts: 1,
        phoneVerificationSentAt: 1
      };
    }
  }
  const { $unset, ...setUpdates } = updates;
  const user = await User.findByIdAndUpdate(req.user.id, {
    $set: setUpdates,
    ...($unset ? { $unset } : {})
  }, {
    new: true,
    runValidators: true
  }).select('-password');
  if (!user) reject('User not found.', 404);
  res.status(200).json({ success: true, data: user });
}));

router.put('/me/location', protect, catchAsync(async (req, res) => {
  if (req.user.role !== 'donor') reject('Only donors can save a search location.', 403);
  const body = readBody(req.body);
  if (Object.keys(body).some((key) => !['latitude', 'longitude'].includes(key))) {
    reject('Only latitude and longitude are supported.');
  }
  const { latitude, longitude } = body;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    reject('Provide a valid latitude and longitude.');
  }
  const result = await User.updateOne(
    { _id: req.user.id, role: 'donor' },
    { $set: { location: { type: 'Point', coordinates: [longitude, latitude] } } },
    { runValidators: true }
  );
  if (result.matchedCount !== 1) reject('Donor account not found.', 404);
  res.status(200).json({ success: true, message: 'Search location saved privately.' });
}));

router.delete('/me/location', protect, catchAsync(async (req, res) => {
  const result = await User.updateOne(
    { _id: req.user.id, role: 'donor' },
    { $unset: { location: 1 } }
  );
  if (result.matchedCount !== 1) reject('Donor account not found.', 404);
  res.status(200).json({ success: true, message: 'Saved search location removed.' });
}));

router.get('/me/donations', protect, catchAsync(async (req, res) => {
  if (req.user.role !== 'donor') reject('Donation history is available to donor accounts.', 403);
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
  if (!Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      !Number.isSafeInteger((page - 1) * limit)) {
    reject('page and limit must be safe positive integers; limit must not exceed 50.');
  }
  const filter = { donor: new mongoose.Types.ObjectId(req.user.id), status: 'Completed' };
  const [totalDonations, historyIds, donor] = await Promise.all([
    Offer.countDocuments(filter),
    Offer.aggregate([
      { $match: filter },
      { $addFields: { effectiveCompletedAt: { $ifNull: ['$completedAt', '$updatedAt'] } } },
      { $sort: { effectiveCompletedAt: -1, _id: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $project: { _id: 1 } }
    ]),
    User.findById(req.user.id).select('lastDonationDate').lean()
  ]);
  if (!donor) reject('User not found.', 404);
  const historyOffers = historyIds.length
    ? await Offer.find({ _id: { $in: historyIds.map((item) => item._id) } })
      .select('completedAt updatedAt request')
      .populate('request', 'bloodGroup city')
      .lean()
    : [];
  const historyById = new Map(historyOffers.map((item) => [String(item._id), item]));
  const history = historyIds.map((item) => historyById.get(String(item._id))).filter(Boolean);
  const lastDonationDate = donor.lastDonationDate ||
    (history[0] && (history[0].completedAt || history[0].updatedAt)) ||
    null;
  const badgeDefinitions = [
    [1, 'First Donation'],
    [5, '5 Donations'],
    [10, '10 Donations'],
    [25, '25 Donations']
  ];
  const data = {
    totalDonations,
    lastDonationDate,
    eligibility: checkDonorEligibility(lastDonationDate),
    badges: badgeDefinitions.filter(([count]) => totalDonations >= count).map(([, badge]) => badge),
    history: history.map((item) => ({
      completedAt: item.completedAt || item.updatedAt,
      request: item.request
        ? { bloodGroup: item.request.bloodGroup, city: item.request.city }
        : null
    })),
    pagination: { page, limit, total: totalDonations, totalPages: Math.ceil(totalDonations / limit) }
  };
  res.status(200).json({ success: true, data });
}));

router.post('/me/phone-otp', protect, phoneOtpSendLimiter, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id)
    .select('phone phoneVerified +phoneVerificationSentAt');
  if (!user) reject('User not found.', 404);
  if (user.phoneVerified) reject('This phone number is already verified.', 400);

  const phone = normalizePakistanPhone(user.phone);
  const now = new Date();
  const resendAfter = 60 * 1000;
  if (user.phoneVerificationSentAt && now - user.phoneVerificationSentAt < resendAfter) {
    res.set('Retry-After', String(Math.ceil((resendAfter - (now - user.phoneVerificationSentAt)) / 1000)));
    reject('Wait before requesting another verification code.', 429);
  }

  const secret = process.env.PHONE_OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('PHONE_OTP_SECRET or JWT_SECRET must be configured for phone verification.');
  const code = String(crypto.randomInt(100000, 1000000));
  const otpHash = crypto.createHmac('sha256', secret)
    .update(`${user._id}:${phone}:${code}`)
    .digest('hex');
  const result = await User.updateOne(
    {
      _id: user._id,
      phoneVerified: false,
      $or: [
        { phoneVerificationSentAt: { $exists: false } },
        { phoneVerificationSentAt: { $lte: new Date(now.getTime() - resendAfter) } }
      ]
    },
    {
      $set: {
        phone,
        phoneVerificationHash: otpHash,
        phoneVerificationExpires: new Date(now.getTime() + 5 * 60 * 1000),
        phoneVerificationAttempts: 0,
        phoneVerificationSentAt: now
      }
    }
  );
  if (result.matchedCount !== 1) reject('Wait before requesting another verification code.', 429);

  try {
    await sendVerificationCode(phone, code);
  } catch (error) {
    try {
      await User.updateOne(
        { _id: user._id, phoneVerificationHash: otpHash },
        {
          $unset: {
            phoneVerificationHash: 1,
            phoneVerificationExpires: 1,
            phoneVerificationAttempts: 1,
            phoneVerificationSentAt: 1
          }
        }
      );
    } catch (cleanupError) {
      logRollbackFailure('phone_otp_delivery_cleanup', cleanupError);
    }
    throw error;
  }

  res.status(200).json({
    success: true,
    message: 'A verification code has been sent to your phone.',
    expiresInSeconds: 300,
    resendAfterSeconds: 60
  });
}));

router.post('/me/verify-phone', protect, phoneOtpVerifyLimiter, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
    reject('Enter the six-digit verification code.');
  }
  const user = await User.findById(req.user.id)
    .select('+phoneVerificationHash +phoneVerificationExpires +phoneVerificationAttempts phone phoneVerified');
  if (!user) reject('User not found.', 404);
  if (user.phoneVerified) reject('This phone number is already verified.', 400);
  const now = new Date();
  if (!user.phoneVerificationHash || !user.phoneVerificationExpires ||
      user.phoneVerificationExpires <= now || user.phoneVerificationAttempts >= 5) {
    reject('This verification code is invalid or expired. Request a new code.', 400);
  }

  const secret = process.env.PHONE_OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('PHONE_OTP_SECRET or JWT_SECRET must be configured for phone verification.');
  const phone = normalizePakistanPhone(user.phone);
  const expected = crypto.createHmac('sha256', secret)
    .update(`${user._id}:${phone}:${body.code}`)
    .digest();
  const actual = Buffer.from(user.phoneVerificationHash, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    const attempt = await User.updateOne(
      {
        _id: user._id,
        phoneVerificationHash: user.phoneVerificationHash,
        phoneVerificationExpires: { $gt: now },
        phoneVerificationAttempts: { $lt: 5 }
      },
      { $inc: { phoneVerificationAttempts: 1 } }
    );
    reject(
      attempt.matchedCount === 1
        ? 'The verification code is incorrect.'
        : 'This verification code is invalid or expired. Request a new code.',
      400
    );
  }

  const verified = await User.updateOne(
    {
      _id: user._id,
      phoneVerificationHash: user.phoneVerificationHash,
      phoneVerificationExpires: { $gt: now },
      phoneVerificationAttempts: { $lt: 5 },
      phoneVerified: false
    },
    {
      $set: { phoneVerified: true },
      $unset: {
        phoneVerificationHash: 1,
        phoneVerificationExpires: 1,
        phoneVerificationAttempts: 1,
        phoneVerificationSentAt: 1
      }
    }
  );
  if (verified.matchedCount !== 1) reject('This verification code is invalid or expired. Request a new code.', 400);
  res.status(200).json({ success: true, message: 'Phone number verified successfully.' });
}));

router.get('/me/blocks', protect, catchAsync(async (req, res) => {
  const blocks = await Block.find({ blocker: req.user.id })
    .populate('blocked', 'name role')
    .sort({ createdAt: -1 })
    .lean();
  res.status(200).json({
    success: true,
    data: blocks.filter((block) => block.blocked).map((block) => ({
      id: String(block._id),
      user: {
        id: String(block.blocked._id),
        name: block.blocked.name,
        role: block.blocked.role
      },
      createdAt: block.createdAt
    }))
  });
}));

router.post('/:id/block', protect, validateObjectId, catchAsync(async (req, res) => {
  if (String(req.params.id) === String(req.user.id)) reject('You cannot block yourself.', 400);
  const user = await User.findOne({ _id: req.params.id, isActive: true }).select('_id');
  if (!user) reject('User not found.', 404);
  try {
    await Block.create({ blocker: req.user.id, blocked: user._id });
  } catch (error) {
    if (error.code === 11000) reject('This user is already blocked.', 409);
    throw error;
  }
  res.status(201).json({ success: true, message: 'User blocked.' });
}));

router.delete('/:id/block', protect, validateObjectId, catchAsync(async (req, res) => {
  const result = await Block.deleteOne({ blocker: req.user.id, blocked: req.params.id });
  if (result.deletedCount !== 1) reject('This user is not in your blocked list.', 404);
  res.status(200).json({ success: true, message: 'User unblocked.' });
}));

router.post(
  '/me/identity-document',
  protect,
  restrictTo('donor', 'requester'),
  identityDocumentUploadLimiter,
  uploadIdentityDocument,
  catchAsync(createIdentityDocumentUploadHandler({
    User,
    StorageCleanupJob,
    enqueueCleanup: (target, session) =>
      enqueueStorageCleanupJob(StorageCleanupJob, target, session),
    withRequiredTransaction,
    getStorage: (req) => req.app.locals.storage
  }))
);

router.delete(
  '/me/identity-document',
  protect,
  catchAsync(createIdentityDocumentWithdrawalHandler({
    User,
    enqueueCleanup: (target, session) =>
      enqueueStorageCleanupJob(StorageCleanupJob, target, session),
    withRequiredTransaction
  }))
);

router.post(
  '/me/avatar',
  protect,
  avatarUploadLimiter,
  uploadAvatar.single('avatar'),
  createAvatarUploadHandler({
    User,
    getStorage: (req) => req.app.locals.storage,
    avatarDirectory,
    validateAvatar,
    enqueueCleanup: (target, session) =>
      enqueueStorageCleanupJob(StorageCleanupJob, target, session),
    withRequiredTransaction
  })
);

module.exports = router;
