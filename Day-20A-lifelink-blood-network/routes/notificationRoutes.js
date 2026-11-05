const express = require('express');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const Notification = require('../models/Notification');
const InAppNotification = require('../models/InAppNotification');
const User = require('../models/User');
const protect = require('../middleware/protect');
const validateObjectId = require('../middleware/validateObjectId');

const router = express.Router();
const PAGE_LIMIT = 50;

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
}

function readPage(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) reject(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) reject(`${name} must be a positive integer.`);
  return parsed;
}

router.use(protect);

router.get('/inbox/unread-count', catchAsync(async (req, res) => {
  const count = await InAppNotification.countDocuments({
    recipient: req.user.id,
    isRead: false
  });
  res.status(200).json({ success: true, data: { count } });
}));

router.get('/inbox', catchAsync(async (req, res) => {
  const page = readPage(req.query.page, 'page', 1);
  const limit = readPage(req.query.limit, 'limit', 20);
  if (limit > PAGE_LIMIT || !Number.isSafeInteger((page - 1) * limit)) {
    reject(`limit must not exceed ${PAGE_LIMIT}.`);
  }
  const filter = { recipient: req.user.id };
  const [total, data] = await Promise.all([
    InAppNotification.countDocuments(filter),
    InAppNotification.find(filter)
      .select('title message type request offer isRead readAt createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}));

router.patch('/inbox/read-all', catchAsync(async (req, res) => {
  const result = await InAppNotification.updateMany(
    { recipient: req.user.id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  res.status(200).json({
    success: true,
    data: { modifiedCount: result.modifiedCount || 0 }
  });
}));

router.patch('/inbox/:id/read', validateObjectId, catchAsync(async (req, res) => {
  const data = await InAppNotification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user.id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true, runValidators: true }
  ).select('title message type request offer isRead readAt createdAt');
  if (!data) {
    const owned = await InAppNotification.exists({
      _id: req.params.id,
      recipient: req.user.id
    });
    if (!owned) reject('Notification not found.', 404);
    const alreadyRead = await InAppNotification.findOne({
      _id: req.params.id,
      recipient: req.user.id
    }).select('title message type request offer isRead readAt createdAt');
    res.status(200).json({ success: true, data: alreadyRead });
    return;
  }
  res.status(200).json({ success: true, data });
}));

router.delete('/inbox/:id', validateObjectId, catchAsync(async (req, res) => {
  const result = await InAppNotification.deleteOne({
    _id: req.params.id,
    recipient: req.user.id
  });
  if (result.deletedCount !== 1) reject('Notification not found.', 404);
  res.status(200).json({ success: true, message: 'Notification deleted.' });
}));

router.get('/', catchAsync(async (req, res) => {
  const page = readPage(req.query.page, 'page', 1);
  const limit = readPage(req.query.limit, 'limit', 20);
  if (limit > PAGE_LIMIT || !Number.isSafeInteger((page - 1) * limit)) {
    reject(`limit must not exceed ${PAGE_LIMIT}.`);
  }
  const [total, data] = await Promise.all([
    Notification.countDocuments({ recipient: req.user.id }),
    Notification.find({ recipient: req.user.id })
      .select('notificationType channel status request offer createdAt sentAt deliveredAt')
      .populate('request', 'bloodGroup city urgency status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}));

router.get('/preferences', catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id).select('notificationPreferences').lean();
  if (!user) reject('User not found.', 404);
  res.status(200).json({
    success: true,
    data: user.notificationPreferences || { email: true, sms: false, whatsapp: false, reminders: true }
  });
}));

router.patch('/preferences', catchAsync(async (req, res) => {
  const body = req.body;
  const allowed = new Set(['email', 'sms', 'whatsapp', 'reminders']);
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowed.has(key))) {
    reject('Provide one or more supported notification preferences.');
  }
  const updates = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== 'boolean') reject(`${key} must be a boolean.`);
    updates[`notificationPreferences.${key}`] = value;
  }
  const result = await User.findByIdAndUpdate(
    req.user.id,
    { $set: updates },
    { new: true, runValidators: true }
  ).select('notificationPreferences').lean();
  if (!result) reject('User not found.', 404);
  res.status(200).json({ success: true, data: result.notificationPreferences });
}));

module.exports = router;
