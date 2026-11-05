const express = require('express');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');
const { supportLimiter } = require('../middleware/rateLimiters');
const SupportTicket = require('../models/SupportTicket');

const router = express.Router();
const CATEGORIES = new Set([
  'Technical Issue',
  'Report a User or Request',
  'Donation Help',
  'Account Problem',
  'Other'
]);
const STATUSES = new Set(['Open', 'In Progress', 'Resolved']);
const PAGE_LIMIT_MAX = 100;
const TICKET_FIELDS = new Set(['name', 'email', 'phone', 'category', 'message', 'website']);

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
}

function readBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reject('Request body must be a JSON object.');
  }
  if (Object.keys(body).some((key) => !TICKET_FIELDS.has(key))) {
    reject('The request contains unsupported fields.');
  }
  return body;
}

function optionalText(body, field, maximum) {
  if (body[field] === undefined) return '';
  if (typeof body[field] !== 'string' || body[field].trim().length > maximum) {
    reject(`${field} must be a string no more than ${maximum} characters.`);
  }
  return body[field].trim();
}

function parsePagination(query) {
  function parse(value, name, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      reject(`${name} must be a positive integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) reject(`${name} must be a positive integer.`);
    return parsed;
  }

  const page = parse(query.page, 'page', 1);
  const limit = parse(query.limit, 'limit', 10);
  if (limit > PAGE_LIMIT_MAX) reject(`limit must not exceed ${PAGE_LIMIT_MAX}.`);
  if (!Number.isSafeInteger((page - 1) * limit)) reject('Pagination values are too large.');
  return { page, limit };
}

function paginationPayload(page, limit, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

function optionalAuthentication(req, res, next) {
  if (!req.headers.authorization) return next();
  return protect(req, res, next);
}

router.post('/tickets', supportLimiter, optionalAuthentication, catchAsync(async (req, res) => {
  const body = readBody(req.body);
  const honeypot = optionalText(body, 'website', 300);
  if (honeypot) {
    return res.status(201).json({
      success: true,
      message: 'Your support request has been received.'
    });
  }

  const name = optionalText(body, 'name', 100);
  const email = optionalText(body, 'email', 254).toLowerCase();
  const phone = optionalText(body, 'phone', 30);
  const category = body.category;
  const message = typeof body.message === 'string' ? body.message.trim() : null;

  if (!CATEGORIES.has(category)) reject('Select a valid support category.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) reject('Provide a valid email address.');
  if (phone && (!/^[+()\d.\-\s]+$/.test(phone) || (phone.match(/\d/g) || []).length < 7)) {
    reject('Provide a valid phone number.');
  }
  if (!req.user && !email && !phone) {
    reject('Provide an email address or phone number so support can respond.');
  }
  if (typeof message !== 'string' || message.length < 10 || message.length > 5000) {
    reject('message must be between 10 and 5000 characters.');
  }

  await SupportTicket.create({
    user: req.user ? req.user.id : null,
    name,
    email,
    phone,
    category,
    message
  });

  res.status(201).json({
    success: true,
    message: 'Your support request has been received.'
  });
}));

router.get('/tickets/mine', protect, catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filter = { user: req.user.id };
  const [total, data] = await Promise.all([
    SupportTicket.countDocuments(filter),
    SupportTicket.find(filter)
      .select('name email phone category message status adminReply repliedAt resolvedAt createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.set('Cache-Control', 'no-store, private');
  res.status(200).json({
    success: true,
    data,
    pagination: paginationPayload(page, limit, total)
  });
}));

router.get('/admin/tickets', protect, restrictTo('admin'), catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filter = {};
  if (req.query.status !== undefined && req.query.status !== '') {
    if (typeof req.query.status !== 'string' || !STATUSES.has(req.query.status)) {
      reject('status is invalid.');
    }
    filter.status = req.query.status;
  }
  if (req.query.category !== undefined && req.query.category !== '') {
    if (typeof req.query.category !== 'string' || !CATEGORIES.has(req.query.category)) {
      reject('category is invalid.');
    }
    filter.category = req.query.category;
  }
  const [total, data] = await Promise.all([
    SupportTicket.countDocuments(filter),
    SupportTicket.find(filter)
      .select('user name email phone category message status adminReply repliedBy repliedAt resolvedAt createdAt updatedAt')
      .populate('repliedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.set('Cache-Control', 'no-store, private');
  res.status(200).json({
    success: true,
    data,
    pagination: paginationPayload(page, limit, total)
  });
}));

router.patch('/admin/tickets/:id', protect, restrictTo('admin'), catchAsync(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) reject('Invalid ticket ID.');
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reject('Request body must be a JSON object.');
  }
  const allowedFields = new Set(['status', 'reply']);
  if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowedFields.has(key))) {
    reject('Provide only a status and/or reply.');
  }

  const update = {};
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) reject('status is invalid.');
    update.status = body.status;
    update.resolvedAt = body.status === 'Resolved' ? new Date() : null;
  }
  if (body.reply !== undefined) {
    if (typeof body.reply !== 'string' || !body.reply.trim() || body.reply.trim().length > 5000) {
      reject('reply is required and must be no more than 5000 characters.');
    }
    update.adminReply = body.reply.trim();
    update.repliedBy = req.user.id;
    update.repliedAt = new Date();
  }

  const ticket = await SupportTicket.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true, runValidators: true }
  ).select('user name email phone category message status adminReply repliedBy repliedAt resolvedAt createdAt updatedAt');
  if (!ticket) reject('Support ticket not found.', 404);
  res.set('Cache-Control', 'no-store, private');
  res.status(200).json({ success: true, data: ticket });
}));

module.exports = router;
