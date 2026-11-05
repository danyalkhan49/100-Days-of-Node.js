const crypto = require('crypto');
const express = require('express');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const Block = require('../models/Block');
const BloodRequest = require('../models/BloodRequest');
const Report = require('../models/Report');
const User = require('../models/User');
const protect = require('../middleware/protect');
const { reportLimiter } = require('../middleware/rateLimiters');

const router = express.Router();
const REASONS = new Set(['fake-account', 'fraud', 'harassment', 'spam', 'misleading', 'other']);
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
}

function readBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) reject('Request body must be a JSON object.');
  return body;
}

function duplicateKey(reporter, target) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${reporter}:${target}:${day}`).digest('hex');
}

async function submitReport({ req, reportType, target }) {
  const body = readBody(req.body);
  if (!REASONS.has(body.reason)) reject('Select a valid report reason.');
  const description = body.description === undefined ? '' : body.description;
  if (typeof description !== 'string' || description.trim().length > 1000) {
    reject('description must be no more than 1000 characters.');
  }
  const dedupeKey = duplicateKey(req.user.id, `${reportType}:${target}`);
  const duplicate = await Report.exists({
    reporter: req.user.id,
    reportType,
    ...(reportType === 'user' ? { reportedUser: target } : { bloodRequest: target }),
    createdAt: { $gte: new Date(Date.now() - REPORT_WINDOW_MS) }
  });
  if (duplicate) reject('You have already reported this item recently.', 409);

  try {
    const report = await Report.create({
      reporter: req.user.id,
      reportType,
      ...(reportType === 'user' ? { reportedUser: target } : { bloodRequest: target }),
      reason: body.reason,
      description: description.trim(),
      dedupeKey
    });
    return report;
  } catch (error) {
    if (error.code === 11000) reject('You have already reported this item recently.', 409);
    throw error;
  }
}

router.post('/users/:id', protect, reportLimiter, catchAsync(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) reject('Invalid user ID.', 400);
  if (String(req.params.id) === String(req.user.id)) reject('You cannot report yourself.', 400);
  const target = await User.findOne({ _id: req.params.id, isActive: true }).select('_id');
  if (!target) reject('User not found.', 404);
  await submitReport({ req, reportType: 'user', target: target._id });
  res.status(201).json({ success: true, message: 'Your report was submitted for review.' });
}));

router.post('/requests/:id', protect, reportLimiter, catchAsync(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) reject('Invalid request ID.', 400);
  const target = await BloodRequest.findById(req.params.id).select('_id');
  if (!target) reject('Blood request not found.', 404);
  await submitReport({ req, reportType: 'request', target: target._id });
  res.status(201).json({ success: true, message: 'Your report was submitted for review.' });
}));

router.post('/users/:id/block', protect, catchAsync(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) reject('Invalid user ID.', 400);
  if (String(req.params.id) === String(req.user.id)) reject('You cannot block yourself.', 400);
  const target = await User.findOne({ _id: req.params.id, isActive: true }).select('_id');
  if (!target) reject('User not found.', 404);
  try {
    await Block.create({ blocker: req.user.id, blocked: target._id });
  } catch (error) {
    if (error.code === 11000) reject('This user is already blocked.', 409);
    throw error;
  }
  res.status(201).json({ success: true, message: 'User blocked.' });
}));

router.delete('/users/:id/block', protect, catchAsync(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) reject('Invalid user ID.', 400);
  const result = await Block.deleteOne({ blocker: req.user.id, blocked: req.params.id });
  if (result.deletedCount !== 1) reject('This user is not in your blocked list.', 404);
  res.status(200).json({ success: true, message: 'User unblocked.' });
}));

module.exports = router;
