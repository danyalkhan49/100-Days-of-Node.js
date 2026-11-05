const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/User');
const StorageCleanupJob = require('../models/StorageCleanupJob');
const BloodRequest = require('../models/BloodRequest');
const Offer = require('../models/Offer');
const Report = require('../models/Report');
const AdminAuditLog = require('../models/AdminAuditLog');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/accountEmail');
const Hospital = require('../models/Hospital');
const HospitalAuditLog = require('../models/HospitalAuditLog');
const IdentityVerificationAuditLog = require('../models/IdentityVerificationAuditLog');
const Review = require('../models/Review');
const { readIdentityDocument } = require('../utils/identityDocumentStorage');
const { enqueueStorageCleanupJob } = require('../utils/storageCleanupQueue');
const { enqueuePrescriptionCleanup } = require('../utils/prescriptionStorage');
const { logRollbackFailure, logUnexpectedError } = require('../utils/safeErrorLogger');
const {
  createInAppNotification,
  dispatchInAppNotification
} = require('../utils/inAppNotifications');
const { notifyRequestCanceled } = require('../utils/notifications');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');
const validateObjectId = require('../middleware/validateObjectId');

const router = express.Router();
const prescriptionDirectory = path.resolve(__dirname, '../uploads/prescriptions');
const USER_ROLES = new Set(['donor', 'requester', 'admin']);
const REQUEST_STATUSES = new Set(['Open', 'Fulfilled', 'Closed']);
const OFFER_STATUSES = new Set(['Pending', 'Accepted', 'Declined', 'Completed', 'Canceled']);
const PAGE_LIMIT_MAX = 100;
const USER_SORT_FIELDS = new Set(['createdAt', 'name', 'role', 'city']);
const REPORT_STATUSES = new Set(['Pending', 'Under Review', 'Resolved', 'Rejected']);
const REPORT_TYPES = new Set(['user', 'request']);
const HOSPITAL_BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

router.use(protect, restrictTo('admin'));

function transactionsSupported() {
  const topology = mongoose.connection.client &&
    mongoose.connection.client.topology &&
    mongoose.connection.client.topology.description;
  return Boolean(topology && ['ReplicaSetWithPrimary', 'Sharded'].includes(topology.type));
}

async function withAuditedChange({
  description,
  mutate,
  audit,
  rollback,
  useTransaction = true,
  requireTransaction = false
}) {
  const transactionAvailable = transactionsSupported();
  if (requireTransaction && !transactionAvailable) {
    throw new AppError(
      'This operation requires MongoDB transactions. Configure MongoDB as a replica set or use a sharded deployment.',
      503
    );
  }
  if (useTransaction && transactionAvailable) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const change = await mutate(session);
        await audit(change.result, session);
        result = change.result;
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  const change = await mutate(null);
  try {
    await audit(change.result, null);
  } catch (error) {
    try {
      if (!await rollback(change.result, change.previous)) {
        throw new Error('The previous state was not restored.');
      }
    } catch (rollbackError) {
      logRollbackFailure('admin_audit_change', rollbackError);
      throw new Error(`The ${description} change and its audit record could not be completed consistently.`);
    }
    throw error;
  }
  return change.result;
}

async function createAuditRecord(Model, data, session) {
  if (session) {
    await Model.create([data], { session });
    return;
  }
  await Model.create(data);
}

async function createAuditRecords(records, session) {
  const saved = [];
  try {
    for (const { Model, data } of records) {
      const document = new Model(data);
      await document.save(session ? { session } : undefined);
      saved.push({ Model, id: document._id });
    }
  } catch (error) {
    if (!session) {
      try {
        await Promise.all(saved.map(({ Model, id }) => Model.collection.deleteOne({ _id: id })));
      } catch (cleanupError) {
        logRollbackFailure('admin_audit_partial_write_cleanup', cleanupError);
        throw new Error('The admin audit records could not be completed consistently.');
      }
    }
    throw error;
  }
}

function adminAuditData(req, { action, targetType, targetId, metadata, targetUser }) {
  const data = {
    admin: req.user.id,
    action,
    targetType,
    targetId,
    requestId: typeof req.id === 'string' && req.id.length <= 128 ? req.id : undefined,
    metadata
  };
  if (targetUser) data.targetUser = targetUser;
  return data;
}

function prescriptionPath(filename) {
  if (typeof filename !== 'string' || !filename || path.basename(filename) !== filename) {
    throw new AppError('Stored prescription filename is invalid.', 500);
  }
  const filePath = path.resolve(prescriptionDirectory, filename);
  if (!filePath.startsWith(`${prescriptionDirectory}${path.sep}`)) {
    throw new AppError('Stored prescription filename is invalid.', 500);
  }
  return filePath;
}

async function unlinkIfPresent(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
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

function countMap(results) {
  return Object.fromEntries(results.map((item) => [item._id, item.count]));
}

function aggregateCounts(model, match, fieldName) {
  return model.aggregate([
    ...(match ? [{ $match: match }] : []),
    { $group: { _id: `$${fieldName}`, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
}

function validateHospitalInput(body, { creating = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) reject('Request body must be a JSON object.');
  const allowed = new Set(['name', 'city', 'address', 'contactNumber', 'website', 'operatingHours', 'bloodGroups', 'latitude', 'longitude']);
  if (Object.keys(body).some((key) => !allowed.has(key))) reject('The request contains unsupported hospital fields.');
  const data = {};
  const requiredFields = new Set(['name', 'city', 'address', 'contactNumber']);
  for (const [field, maximum] of Object.entries({
    name: 120, city: 80, address: 300, contactNumber: 30, website: 300, operatingHours: 300
  })) {
    if (body[field] === undefined) {
      if (creating && requiredFields.has(field)) reject(`${field} is required and must be no more than ${maximum} characters.`);
      continue;
    }
    if (typeof body[field] !== 'string' || body[field].trim().length > maximum ||
        (requiredFields.has(field) && !body[field].trim())) reject(`${field} is required and must be no more than ${maximum} characters.`);
    data[field] = body[field].trim();
  }
  if (data.website) {
    let website;
    try { website = new URL(data.website); } catch { reject('website must be a valid HTTP or HTTPS URL.'); }
    if (!['http:', 'https:'].includes(website.protocol) || website.username || website.password) {
      reject('website must be a valid HTTP or HTTPS URL without credentials.');
    }
  }
  if (body.bloodGroups !== undefined) {
    if (!Array.isArray(body.bloodGroups) || body.bloodGroups.some((group) => !HOSPITAL_BLOOD_GROUPS.has(group)) ||
        new Set(body.bloodGroups).size !== body.bloodGroups.length) {
      reject('bloodGroups must be a unique array of supported blood groups.');
    }
    data.bloodGroups = body.bloodGroups;
    data.inventoryVerified = false;
    data.inventoryVerifiedAt = null;
  }
  const hasLatitude = body.latitude !== undefined;
  const hasLongitude = body.longitude !== undefined;
  if (hasLatitude !== hasLongitude) reject('latitude and longitude must be provided together.');
  if (hasLatitude) {
    if (typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) ||
        body.latitude < -90 || body.latitude > 90 || typeof body.longitude !== 'number' ||
        !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) {
      reject('Provide a valid latitude and longitude.');
    }
    data.location = { type: 'Point', coordinates: [body.longitude, body.latitude] };
  }
  return data;
}

router.get('/dashboard', catchAsync(async (_req, res) => {
  const [usersByRole, requestsByStatus, offersByStatus, openRequestsByBloodGroup] = await Promise.all([
    aggregateCounts(User, null, 'role'),
    aggregateCounts(BloodRequest, null, 'status'),
    aggregateCounts(Offer, null, 'status'),
    aggregateCounts(BloodRequest, { status: 'Open' }, 'bloodGroup')
  ]);
  const bloodGroupDemand = openRequestsByBloodGroup.map((item) => ({
    bloodGroup: item._id,
    count: item.count
  }));
  const mostDemanded = bloodGroupDemand.reduce(
    (current, item) => !current || item.count > current.count ? item : current,
    null
  );

  res.status(200).json({
    success: true,
    data: {
      usersByRole: countMap(usersByRole),
      requestsByStatus: countMap(requestsByStatus),
      offersByStatus: countMap(offersByStatus),
      completedDonations: countMap(offersByStatus).Completed || 0,
      openRequestsByBloodGroup: bloodGroupDemand,
      mostDemandedBloodGroup: mostDemanded
    }
  });
}));

router.get('/audit-logs', catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filters = {};
  const filterConditions = [];
  const actionValues = new Set(AdminAuditLog.schema.path('action').enumValues);
  if (req.query.action !== undefined && req.query.action !== '') {
    if (typeof req.query.action !== 'string' || !actionValues.has(req.query.action)) {
      reject('action is invalid.');
    }
    filters.action = req.query.action;
  }
  if (req.query.targetType !== undefined && req.query.targetType !== '') {
    if (typeof req.query.targetType !== 'string' ||
        !['user', 'request', 'offer', 'report', 'review', 'identity-verification', 'hospital'].includes(req.query.targetType)) {
      reject('targetType is invalid.');
    }
    if (req.query.targetType === 'user') {
      filterConditions.push({
        $or: [
          { targetType: 'user' },
          { targetType: { $exists: false }, action: 'password-reset-email' }
        ]
      });
    } else {
      filters.targetType = req.query.targetType;
    }
  }
  if (req.query.targetId !== undefined && req.query.targetId !== '') {
    if (typeof req.query.targetId !== 'string' || !mongoose.isValidObjectId(req.query.targetId)) {
      reject('targetId must be a valid ID.');
    }
    filterConditions.push({ $or: [
      { targetId: req.query.targetId },
      { targetUser: req.query.targetId }
    ] });
  }
  if (req.query.admin !== undefined && req.query.admin !== '') {
    if (typeof req.query.admin !== 'string' || !mongoose.isValidObjectId(req.query.admin)) {
      reject('admin must be a valid ID.');
    }
    filters.admin = req.query.admin;
  }
  if (req.query.requestId !== undefined && req.query.requestId !== '') {
    if (typeof req.query.requestId !== 'string' || req.query.requestId.length > 128) {
      reject('requestId must be a string of no more than 128 characters.');
    }
    filters.requestId = req.query.requestId;
  }
  const createdAt = {};
  for (const [parameter, operator] of [['from', '$gte'], ['to', '$lte']]) {
    if (req.query[parameter] !== undefined && req.query[parameter] !== '') {
      if (typeof req.query[parameter] !== 'string' || Number.isNaN(Date.parse(req.query[parameter]))) {
        reject(`${parameter} must be a valid date.`);
      }
      const date = new Date(req.query[parameter]);
      if (operator === '$lte' && /^\d{4}-\d{2}-\d{2}$/.test(req.query[parameter])) {
        date.setUTCHours(23, 59, 59, 999);
      }
      createdAt[operator] = date;
    }
  }
  if (createdAt.$gte && createdAt.$lte && createdAt.$gte > createdAt.$lte) {
    reject('from must not be later than to.');
  }
  if (Object.keys(createdAt).length) filters.createdAt = createdAt;
  if (req.query.search !== undefined && req.query.search !== '') {
    if (typeof req.query.search !== 'string' || req.query.search.length > 100) {
      reject('search must be a string of no more than 100 characters.');
    }
    const escaped = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escaped, 'i');
    const matchingAdmins = await User.find({ name: expression }).select('_id').limit(100).lean();
    const searchFilters = [
      { action: expression },
      { targetType: expression },
      { requestId: expression },
      { admin: { $in: matchingAdmins.map((user) => user._id) } }
    ];
    if (mongoose.isValidObjectId(req.query.search)) {
      searchFilters.push({ targetId: req.query.search }, { targetUser: req.query.search });
    }
    filterConditions.push({ $or: searchFilters });
  }
  if (filterConditions.length) filters.$and = filterConditions;

  const [total, data] = await Promise.all([
    AdminAuditLog.countDocuments(filters),
    AdminAuditLog.find(filters)
      .select('admin action targetType targetId targetUser requestId metadata deliveryStatus createdAt')
      .populate('admin', 'name')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({ success: true, data, pagination: paginationPayload(page, limit, total) });
}));

router.get('/users', catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filters = {};

  if (req.query.role !== undefined && req.query.role !== '') {
    if (typeof req.query.role !== 'string' || !USER_ROLES.has(req.query.role)) {
      reject('role is invalid.');
    }
    filters.role = req.query.role;
  }
  if (req.query.isActive !== undefined && req.query.isActive !== '') {
    if (req.query.isActive !== 'true' && req.query.isActive !== 'false') {
      reject('isActive must be true or false.');
    }
    filters.isActive = req.query.isActive === 'true';
  }
  if (req.query.search !== undefined && req.query.search !== '') {
    if (typeof req.query.search !== 'string') reject('search must be a string.');
    const safeSearch = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filters.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { email: { $regex: safeSearch, $options: 'i' } }
    ];
  }

  const sortBy = req.query.sortBy === undefined ? 'createdAt' : req.query.sortBy;
  const order = req.query.order === undefined ? 'desc' : req.query.order;
  if (typeof sortBy !== 'string' || !USER_SORT_FIELDS.has(sortBy)) {
    reject('sortBy is not supported.');
  }
  if (typeof order !== 'string' || !['asc', 'desc'].includes(order.toLowerCase())) {
    reject('order must be asc or desc.');
  }

  const [total, data] = await Promise.all([
    User.countDocuments(filters),
    User.find(filters)
      .select('name role bloodGroup city isActive emailVerified emailVerifiedAt emailVerificationMethod createdAt')
      .sort({ [sortBy]: order.toLowerCase() === 'asc' ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({
    success: true,
    data,
    pagination: paginationPayload(page, limit, total)
  });
}));

router.patch('/users/:id/email-verification', validateObjectId, catchAsync(async (req, res) => {
  const verifiedAt = new Date();
  const data = await withAuditedChange({
    description: 'user email verification',
    mutate: async (session) => {
      let userQuery = User.findById(req.params.id)
        .select('emailVerified emailVerifiedAt emailVerificationMethod isActive +emailVerificationToken +emailVerificationExpires');
      if (session) userQuery = userQuery.session(session);
      const user = await userQuery;
      if (!user) reject('User not found.', 404);
      if (user.emailVerified) reject('This account email is already verified.', 409);
      if (user.isActive === false) reject('A deactivated account cannot be verified.', 409);

      const previous = {
        emailVerifiedAt: user.emailVerifiedAt || null,
        emailVerificationMethod: user.emailVerificationMethod || null,
        emailVerificationToken: user.emailVerificationToken,
        emailVerificationExpires: user.emailVerificationExpires
      };
      const update = await User.updateOne(
        { _id: user._id, emailVerified: false, isActive: true },
        {
          $set: {
            emailVerified: true,
            emailVerifiedAt: verifiedAt,
            emailVerificationMethod: 'admin'
          },
          $unset: { emailVerificationToken: 1, emailVerificationExpires: 1 }
        },
        session ? { session } : undefined
      );
      if (update.matchedCount !== 1) {
        reject('The account changed before it could be verified. Reload the user list and try again.', 409);
      }

      return {
        result: {
          id: String(user._id),
          emailVerified: true,
          emailVerifiedAt: verifiedAt,
          emailVerificationMethod: 'admin'
        },
        previous
      };
    },
    audit: (user, session) => createAuditRecord(AdminAuditLog, adminAuditData(req, {
      action: 'verification-decision',
      targetType: 'user',
      targetId: user.id,
      metadata: {
        status: 'Verified',
        previousStatus: 'Unverified',
        verificationMethod: 'admin'
      }
    }), session),
    rollback: async (user, previous) => {
      const restore = {
        $set: {
          emailVerified: false,
          emailVerifiedAt: previous.emailVerifiedAt,
          emailVerificationMethod: previous.emailVerificationMethod
        },
        $unset: {}
      };
      if (previous.emailVerificationToken) {
        restore.$set.emailVerificationToken = previous.emailVerificationToken;
      } else {
        restore.$unset.emailVerificationToken = 1;
      }
      if (previous.emailVerificationExpires) {
        restore.$set.emailVerificationExpires = previous.emailVerificationExpires;
      } else {
        restore.$unset.emailVerificationExpires = 1;
      }
      const restored = await User.updateOne(
        {
          _id: user.id,
          emailVerified: true,
          emailVerificationMethod: 'admin',
          emailVerifiedAt: verifiedAt
        },
        restore
      );
      return restored.matchedCount === 1;
    }
  });
  dispatchInAppNotification(() => createInAppNotification({
    eventKey: `admin-email-verification:${data.id}`,
    recipient: data.id,
    title: 'Email verification updated',
    message: 'An administrator verified your email address.',
    type: 'verification-update'
  }), 'Admin email verification');
  res.status(200).json({ success: true, data });
}));

router.patch('/users/:id/deactivate', validateObjectId, catchAsync(async (req, res) => {
  const data = await withAuditedChange({
    description: 'user deactivation',
    mutate: async (session) => {
      let userQuery = User.findById(req.params.id);
      if (session) userQuery = userQuery.session(session);
      const user = await userQuery;
      if (!user) reject('User not found.', 404);
      if (String(user._id) === String(req.user.id)) {
        reject('You cannot deactivate your own account.', 400);
      }
      if (user.role === 'admin') {
        reject('You cannot deactivate another admin account.', 403);
      }

      const wasActive = user.isActive;
      let offersQuery = Offer.find({ donor: user._id, status: { $in: ['Pending', 'Accepted'] } })
        .select('_id status');
      if (session) offersQuery = offersQuery.session(session);
      const previousOffers = user.role === 'donor' ? await offersQuery.lean() : [];
      user.isActive = false;
      await user.save({ validateModifiedOnly: true, ...(session ? { session } : {}) });

      try {
        if (user.role === 'donor') {
          const result = await Offer.updateMany(
            { donor: user._id, status: { $in: ['Pending', 'Accepted'] } },
            { $set: { status: 'Canceled' } },
            { runValidators: true, ...(session ? { session } : {}) }
          );
          if (result.acknowledged === false) throw new Error('Offer cancellation was not acknowledged.');
        }
      } catch (error) {
        if (!session) {
          try {
            await User.updateOne({ _id: user._id, isActive: false }, { $set: { isActive: wasActive } });
            if (previousOffers.length) {
              await Offer.bulkWrite(previousOffers.map((offer) => ({
                updateOne: {
                  filter: { _id: offer._id, status: 'Canceled' },
                  update: { $set: { status: offer.status } }
                }
              })));
            }
          } catch (rollbackError) {
            logRollbackFailure('admin_user_deactivation', rollbackError);
            throw new Error('User deactivation failed and its previous state could not be restored.');
          }
        }
        throw error;
      }

      let dataQuery = User.findById(user._id)
        .select('name role bloodGroup city isActive createdAt');
      if (session) dataQuery = dataQuery.session(session);
      const result = await dataQuery.lean();
      return { result, previous: { wasActive, offers: previousOffers } };
    },
    audit: (user, session) => createAuditRecord(AdminAuditLog, adminAuditData(req, {
      action: 'user-deactivated',
      targetType: 'user',
      targetId: user._id
    }), session),
    rollback: async (user, previous) => {
      const result = await User.updateOne(
        { _id: user._id, isActive: false },
        { $set: { isActive: previous.wasActive } }
      );
      if (previous.offers.length) {
        await Offer.bulkWrite(previous.offers.map((offer) => ({
          updateOne: {
            filter: { _id: offer._id, status: 'Canceled' },
            update: { $set: { status: offer.status } }
          }
        })));
      }
      return result.matchedCount === 1;
    }
  });
  res.status(200).json({ success: true, message: 'User deactivated.', data });
}));

router.get('/requests', catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filters = {};
  if (req.query.status !== undefined && req.query.status !== '') {
    if (typeof req.query.status !== 'string' || !REQUEST_STATUSES.has(req.query.status)) {
      reject('status is invalid.');
    }
    filters.status = req.query.status;
  }

  const [total, data] = await Promise.all([
    BloodRequest.countDocuments(filters),
    BloodRequest.find(filters)
      .select('-prescription -__v')
      .populate('requester', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({
    success: true,
    data,
    pagination: paginationPayload(page, limit, total)
  });
}));

router.patch('/requests/:id/close', validateObjectId, catchAsync(async (req, res) => {
  const outcome = await withAuditedChange({
    description: 'request closure',
    mutate: async (session) => {
      let requestQuery = BloodRequest.findById(req.params.id);
      if (session) requestQuery = requestQuery.session(session);
      const request = await requestQuery;
      if (!request) reject('Blood request not found.', 404);
      if (request.status !== 'Open') reject('Only open blood requests can be closed.', 400);

      let offersQuery = Offer.find({
        request: request._id,
        status: { $in: ['Pending', 'Accepted'] }
      }).select('_id status donor');
      if (session) offersQuery = offersQuery.session(session);
      const eligibleOffers = await offersQuery.lean();
      let updatedQuery = BloodRequest.findOneAndUpdate(
        { _id: request._id, status: 'Open' },
        { $set: { status: 'Closed' } },
        { new: true, runValidators: true, ...(session ? { session } : {}) }
      )
        .select('-prescription')
        .populate('requester', 'name');
      const data = await updatedQuery.lean();
      if (!data) reject('Only open blood requests can be closed.', 400);

      try {
        const result = await Offer.updateMany(
          { request: request._id, status: { $in: ['Pending', 'Accepted'] } },
          { $set: { status: 'Canceled' } },
          session ? { session } : {}
        );
        if (result.acknowledged === false) throw new Error('Offer cancellation was not acknowledged.');
      } catch (error) {
        if (!session) {
          const rollbackErrors = [];
          try {
            if (eligibleOffers.length) {
              await Offer.bulkWrite(eligibleOffers.map((offer) => ({
                updateOne: {
                  filter: { _id: offer._id, status: 'Canceled' },
                  update: { $set: { status: offer.status } }
                }
              })));
            }
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
          try {
            const rollback = await BloodRequest.updateOne(
              { _id: request._id, status: 'Closed' },
              { $set: { status: 'Open' } }
            );
            if (rollback.matchedCount !== 1) throw new Error('The request status could not be restored.');
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
          if (rollbackErrors.length) {
            logRollbackFailure('admin_request_closure', rollbackErrors);
            throw new Error('Closing the blood request failed and its previous state could not be fully restored.');
          }
        }
        throw error;
      }
      return {
        result: {
          id: request._id,
          requesterId: request.requester,
          data,
          affectedOffers: eligibleOffers.length,
          offers: eligibleOffers
        },
        previous: { offers: eligibleOffers }
      };
    },
    audit: (request, session) => createAuditRecord(AdminAuditLog, adminAuditData(req, {
      action: 'request-closed',
      targetType: 'request',
      targetId: request.id,
      metadata: {
        status: 'Closed',
        previousStatus: 'Open',
        affectedOffers: request.affectedOffers
      }
    }), session),
    rollback: async (request, previous) => {
      if (previous.offers.length) {
        await Offer.bulkWrite(previous.offers.map((offer) => ({
          updateOne: {
            filter: { _id: offer._id, status: 'Canceled' },
            update: { $set: { status: offer.status } }
          }
        })));
      }
      const result = await BloodRequest.updateOne(
        { _id: request.id, status: 'Closed' },
        { $set: { status: 'Open' } }
      );
      return result.matchedCount === 1;
    }
  });
  notifyRequestCanceled({
    requestId: outcome.id,
    requesterId: outcome.requesterId,
    offers: outcome.offers
  });
  res.status(200).json({ success: true, message: 'Blood request closed successfully.', data: outcome.data });
}));

router.delete('/requests/:id', validateObjectId, catchAsync(async (req, res) => {
  const deletion = await withAuditedChange({
    description: 'request deletion',
    requireTransaction: true,
    mutate: async (session) => {
      const requestQuery = BloodRequest.findById(req.params.id)
        .select('+prescriptionStorage')
        .session(session);
      const request = await requestQuery.lean();
      if (!request) reject('Blood request not found.', 404);
      const relatedOffers = await Offer.find({ request: request._id })
        .session(session)
        .lean();
      const offerIds = relatedOffers.map((offer) => offer._id);
      const relatedReviews = offerIds.length
        ? await Review.find({ offer: { $in: offerIds } })
          .session(session)
          .lean()
        : [];
      const reviewsResult = await Review.deleteMany(
        { offer: { $in: offerIds } },
        { session }
      );
      if (reviewsResult.acknowledged === false) throw new Error('Review deletion was not acknowledged.');
      const offersResult = await Offer.deleteMany(
        { request: request._id },
        { session }
      );
      if (offersResult.acknowledged === false) throw new Error('Offer deletion was not acknowledged.');
      const result = await BloodRequest.deleteOne({ _id: request._id }, { session });
      if (result.deletedCount !== 1) reject('Blood request not found.', 404);
      await enqueuePrescriptionCleanup(
        request,
        (target, jobSession) =>
          enqueueStorageCleanupJob(StorageCleanupJob, target, jobSession),
        session
      );

      return {
        result: {
          id: request._id,
          previousStatus: request.status,
          affectedOffers: relatedOffers.length,
          affectedReviews: relatedReviews.length,
          prescription: request.prescription,
          prescriptionStorage: request.prescriptionStorage
        },
        previous: { request, offers: relatedOffers, reviews: relatedReviews }
      };
    },
    audit: (result, session) => createAuditRecord(AdminAuditLog, adminAuditData(req, {
      action: 'request-deleted',
      targetType: 'request',
      targetId: result.id,
      metadata: {
        previousStatus: result.previousStatus,
        affectedOffers: result.affectedOffers,
        affectedReviews: result.affectedReviews
      }
    }), session)
  });
  let cleanupWarning = false;
  if (deletion.prescription && !deletion.prescriptionStorage) {
    try {
      await unlinkIfPresent(prescriptionPath(deletion.prescription));
    } catch (_error) {
      cleanupWarning = true;
      console.error('Deleted request local prescription could not be removed.');
    }
  }
  res.status(200).json({
    success: true,
    message: cleanupWarning
      ? 'Blood request deleted; local prescription cleanup needs attention.'
      : 'Blood request and associated resources deleted successfully.'
  });
}));

router.post('/users/:id/password-reset', validateObjectId, catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id).select('_id email emailVerified isActive');
  if (!user || user.isActive === false) reject('User not found.', 404);
  if (!user.emailVerified) reject('A verified email address is required for password reset.', 400);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + 30 * 60 * 1000);
  const audit = await AdminAuditLog.create({
    ...adminAuditData(req, {
      action: 'password-reset-email',
      targetType: 'user',
      targetId: user._id,
      targetUser: user._id
    }),
    deliveryStatus: 'Pending'
  });
  const resetSaved = await User.updateOne(
    { _id: user._id, emailVerified: true, isActive: true },
    { $set: { passwordResetToken: hashedToken, passwordResetExpires: expires } }
  );
  if (resetSaved.matchedCount !== 1) {
    await AdminAuditLog.updateOne({ _id: audit._id }, { $set: { deliveryStatus: 'Failed' } });
    reject('User not found or no longer eligible for password reset.', 404);
  }

  try {
    await sendPasswordResetEmail(user.email, rawToken);
    await AdminAuditLog.updateOne(
      { _id: audit._id },
      { $set: { deliveryStatus: 'Sent' } }
    );
  } catch (error) {
    try {
      await User.updateOne(
        { _id: user._id, passwordResetToken: hashedToken },
        { $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
      );
      await AdminAuditLog.updateOne(
        { _id: audit._id },
        { $set: { deliveryStatus: 'Failed' } }
      );
    } catch (auditError) {
      logRollbackFailure('admin_password_reset_delivery_cleanup', auditError);
    }
    logUnexpectedError(error, req);
    throw new AppError('The password reset email could not be sent.', 503);
  }
  res.status(200).json({ success: true, message: 'Password reset email sent.' });
}));

router.get('/reports', catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filters = {};
  if (req.query.status !== undefined && req.query.status !== '') {
    if (typeof req.query.status !== 'string' || !REPORT_STATUSES.has(req.query.status)) {
      reject('status is invalid.');
    }
    filters.status = req.query.status;
  }
  if (req.query.reportType !== undefined && req.query.reportType !== '') {
    if (typeof req.query.reportType !== 'string' || !REPORT_TYPES.has(req.query.reportType)) {
      reject('reportType is invalid.');
    }
    filters.reportType = req.query.reportType;
  }
  if (req.query.search !== undefined && req.query.search !== '') {
    if (typeof req.query.search !== 'string' || req.query.search.length > 100) {
      reject('search must be a string of no more than 100 characters.');
    }
    const escaped = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const [users, requests] = await Promise.all([
      User.find({ name: { $regex: escaped, $options: 'i' } }).select('_id').limit(100).lean(),
      BloodRequest.find({ $or: [
        { patientName: { $regex: escaped, $options: 'i' } },
        { hospital: { $regex: escaped, $options: 'i' } }
      ] }).select('_id').limit(100).lean()
    ]);
    filters.$or = [
      { reason: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } },
      { adminNote: { $regex: escaped, $options: 'i' } },
      { reporter: { $in: users.map((item) => item._id) } },
      { reportedUser: { $in: users.map((item) => item._id) } },
      { bloodRequest: { $in: requests.map((item) => item._id) } }
    ];
  }

  const [total, data] = await Promise.all([
    Report.countDocuments(filters),
    Report.find(filters)
      .select('-dedupeKey')
      .populate('reporter', 'name role')
      .populate('reportedUser', 'name role city')
      .populate('bloodRequest', 'patientName bloodGroup hospital city status')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({
    success: true,
    data,
    pagination: paginationPayload(page, limit, total)
  });
}));

router.get('/reviews', catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filters = {};
  if (req.query.status !== undefined && req.query.status !== '') {
    if (typeof req.query.status !== 'string' || !['Pending', 'Published', 'Rejected'].includes(req.query.status)) {
      reject('status is invalid.');
    }
    filters.status = req.query.status;
  }
  const [total, data] = await Promise.all([
    Review.countDocuments(filters),
    Review.find(filters)
      .populate('reviewer', 'name role')
      .populate('reviewee', 'name role')
      .populate({
        path: 'offer',
        select: 'request',
        populate: { path: 'request', select: 'patientName city bloodGroup' }
      })
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({ success: true, data, pagination: paginationPayload(page, limit, total) });
}));

router.patch('/reviews/:id', validateObjectId, catchAsync(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['status', 'adminNote'].includes(key)) ||
      !['Published', 'Rejected'].includes(body.status)) {
    reject('status must be Published or Rejected; only adminNote is additionally supported.');
  }
  if (body.adminNote !== undefined &&
      (typeof body.adminNote !== 'string' || body.adminNote.trim().length > 500)) {
    reject('adminNote must be no more than 500 characters.');
  }
  if (body.status === 'Rejected' && (!body.adminNote || !body.adminNote.trim())) {
    reject('Provide a moderation note when rejecting a review.');
  }
  const reviewedAt = new Date();
  const review = await withAuditedChange({
    description: 'review moderation',
    mutate: async (session) => {
      let previousQuery = Review.findById(req.params.id);
      if (session) previousQuery = previousQuery.session(session);
      const previous = await previousQuery.lean();
      if (!previous) reject('Review not found.', 404);
      const updated = await Review.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status: body.status,
            reviewedBy: req.user.id,
            reviewedAt,
            adminNote: typeof body.adminNote === 'string' ? body.adminNote.trim() : ''
          }
        },
        { new: true, runValidators: true, ...(session ? { session } : {}) }
      );
      if (!updated) reject('Review not found.', 404);
      return { result: { review: updated, previousStatus: previous.status }, previous };
    },
    audit: (updated, session) => createAuditRecord(AdminAuditLog, adminAuditData(req, {
      action: 'review-moderated',
      targetType: 'review',
      targetId: updated.review._id,
      metadata: { status: body.status, previousStatus: updated.previousStatus }
    }), session),
    rollback: async (updated, previous) => {
      const result = await Review.updateOne(
        { _id: updated.review._id, status: body.status, reviewedBy: req.user.id, reviewedAt },
        {
          $set: {
            status: previous.status,
            reviewedBy: previous.reviewedBy,
            reviewedAt: previous.reviewedAt,
            adminNote: previous.adminNote
          }
        }
      );
      return result.matchedCount === 1;
    }
  });
  res.status(200).json({
    success: true,
    message: 'Review moderation saved.',
    data: { id: review.review._id, status: review.review.status }
  });
}));

router.get('/reports/:id', validateObjectId, catchAsync(async (req, res) => {
  const report = await Report.findById(req.params.id)
    .select('-dedupeKey')
    .populate('reporter', 'name role')
    .populate('reportedUser', 'name role city isActive')
    .populate('bloodRequest', 'patientName bloodGroup hospital city urgency status neededBy')
    .populate('reviewedBy', 'name')
    .lean();
  if (!report) reject('Report not found.', 404);
  res.status(200).json({ success: true, data: report });
}));

router.get('/hospitals', catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filters = {};
  if (req.query.status !== undefined && req.query.status !== '') {
    if (typeof req.query.status !== 'string' || !['Pending', 'Verified', 'Rejected'].includes(req.query.status)) {
      reject('status is invalid.');
    }
    filters.verificationStatus = req.query.status;
  }
  if (req.query.isActive !== undefined && req.query.isActive !== '') {
    if (!['true', 'false'].includes(req.query.isActive)) reject('isActive must be true or false.');
    filters.isActive = req.query.isActive === 'true';
  }
  const [total, data] = await Promise.all([
    Hospital.countDocuments(filters),
    Hospital.find(filters)
      .select('-__v')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({ success: true, data, pagination: paginationPayload(page, limit, total) });
}));

router.get('/identity-verifications', catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filters = { identityVerificationStatus: { $in: ['Pending', 'Verified', 'Rejected'] } };
  if (req.query.status !== undefined && req.query.status !== '') {
    if (typeof req.query.status !== 'string' || !['Pending', 'Verified', 'Rejected'].includes(req.query.status)) {
      reject('status is invalid.');
    }
    filters.identityVerificationStatus = req.query.status;
  }
  const [total, data] = await Promise.all([
    User.countDocuments(filters),
    User.find(filters)
      .select('name email city role identityVerificationStatus identityDocumentUploadedAt identityReviewNote')
      .sort({ identityDocumentUploadedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({ success: true, data, pagination: paginationPayload(page, limit, total) });
}));

router.get('/users/:id/identity-document', validateObjectId, catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('+identityDocument +identityDocumentMimeType +identityDocumentStorage identityVerificationStatus');
  if (!user || !user.identityDocument || !user.identityDocumentMimeType) {
    reject('Identity document not found.', 404);
  }
  const contents = await readIdentityDocument({
    filename: user.identityDocument,
    metadata: user.identityDocumentStorage,
    storageRuntime: req.app.locals.storage
  });
  await createAuditRecords([
    {
      Model: IdentityVerificationAuditLog,
      data: { admin: req.user.id, targetUser: user._id, action: 'document-downloaded' }
    },
    {
      Model: AdminAuditLog,
      data: adminAuditData(req, {
        action: 'identity-document-downloaded',
        targetType: 'identity-verification',
        targetId: user._id
      })
    }
  ]);
  const extension = user.identityDocumentMimeType === 'application/pdf'
    ? 'pdf'
    : user.identityDocumentMimeType === 'image/png' ? 'png' : 'jpg';
  res.set({
    'Cache-Control': 'no-store, private',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  res.type(user.identityDocumentMimeType)
    .attachment(`lifelink-identity-document.${extension}`)
    .send(contents);
}));

router.patch('/users/:id/identity-verification', validateObjectId, catchAsync(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['status', 'adminNote'].includes(key)) ||
      !['Verified', 'Rejected'].includes(body.status)) {
    reject('status must be Verified or Rejected; only adminNote is additionally supported.');
  }
  if (body.adminNote !== undefined &&
      (typeof body.adminNote !== 'string' || body.adminNote.trim().length > 500)) {
    reject('adminNote must be no more than 500 characters.');
  }
  if (body.status === 'Rejected' && (!body.adminNote || !body.adminNote.trim())) {
    reject('Provide a review note when rejecting an identity document.');
  }
  const note = typeof body.adminNote === 'string' ? body.adminNote.trim() : '';
  const reviewedAt = new Date();
  const data = await withAuditedChange({
    description: 'identity verification',
    mutate: async (session) => {
      let userQuery = User.findById(req.params.id)
        .select('+identityDocument +identityReviewedBy +identityReviewedAt');
      if (session) userQuery = userQuery.session(session);
      const user = await userQuery;
      if (!user || !user.identityDocument) reject('Identity document not found.', 404);
      if (body.status === 'Verified' && !user.identityDocumentConsentAt) {
        reject('The user has not recorded consent for identity document review.', 409);
      }
      let downloadQuery = IdentityVerificationAuditLog.exists({
        admin: req.user.id,
        targetUser: user._id,
        action: 'document-downloaded',
        createdAt: { $gte: user.identityDocumentUploadedAt }
      });
      if (session) downloadQuery = downloadQuery.session(session);
      if (!await downloadQuery) {
        reject('Download and manually review the current document before recording a decision.', 409);
      }

      const previous = {
        identityVerificationStatus: user.identityVerificationStatus,
        identityReviewedBy: user.identityReviewedBy,
        identityReviewedAt: user.identityReviewedAt,
        identityReviewNote: user.identityReviewNote
      };
      const updated = await User.findOneAndUpdate(
        {
          _id: user._id,
          identityDocument: user.identityDocument,
          identityDocumentUploadedAt: user.identityDocumentUploadedAt,
          updatedAt: user.updatedAt
        },
        {
          $set: {
            identityVerificationStatus: body.status,
            identityReviewedBy: req.user.id,
            identityReviewedAt: reviewedAt,
            identityReviewNote: note
          }
        },
        { new: true, runValidators: true, ...(session ? { session } : {}) }
      ).select('+identityReviewedAt');
      if (!updated) reject('Identity document changed during review. Refresh and try again.', 409);
      return { result: updated, previous };
    },
    audit: (user, session) => createAuditRecords([
      {
        Model: IdentityVerificationAuditLog,
        data: {
          admin: req.user.id,
          targetUser: user._id,
          action: body.status === 'Verified' ? 'verified' : 'rejected',
          note
        }
      },
      {
        Model: AdminAuditLog,
        data: adminAuditData(req, {
          action: 'verification-decision',
          targetType: 'identity-verification',
          targetId: user._id,
          metadata: { status: body.status }
        })
      }
    ], session),
    rollback: async (user, previous) => {
      const result = await User.updateOne(
        {
          _id: user._id,
          identityVerificationStatus: body.status,
          identityReviewedBy: req.user.id,
          identityReviewedAt: reviewedAt,
          updatedAt: user.updatedAt
        },
        { $set: previous }
      );
      return result.matchedCount === 1;
    }
  });
  const identityStatus = body.status;
  dispatchInAppNotification(() => createInAppNotification({
    eventKey: `identity-verification:${data._id}:${reviewedAt.getTime()}`,
    recipient: data._id,
    title: 'Identity verification updated',
    message: identityStatus === 'Verified'
      ? 'Your identity verification was approved.'
      : 'Your identity verification was declined. Sign in to review the status.',
    type: 'verification-update'
  }), 'Identity verification');
  res.status(200).json({
    success: true,
    message: `Identity document ${body.status.toLowerCase()}.`,
    data: {
      identityVerificationStatus: data.identityVerificationStatus,
      identityReviewedAt: data.identityReviewedAt
    }
  });
}));

router.get('/hospitals/:id/audit', validateObjectId, catchAsync(async (req, res) => {
  const hospitalExists = await Hospital.exists({ _id: req.params.id });
  if (!hospitalExists) reject('Hospital or blood bank not found.', 404);
  const { page, limit } = parsePagination(req.query);
  const [total, data] = await Promise.all([
    HospitalAuditLog.countDocuments({ hospital: req.params.id }),
    HospitalAuditLog.find({ hospital: req.params.id })
      .populate('admin', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  res.status(200).json({ success: true, data, pagination: paginationPayload(page, limit, total) });
}));

router.post('/hospitals', catchAsync(async (req, res) => {
  const data = validateHospitalInput(req.body, { creating: true });
  const hospital = await withAuditedChange({
    description: 'hospital creation',
    mutate: async (session) => {
      const created = session
        ? (await Hospital.create([data], { session }))[0]
        : await Hospital.create(data);
      return { result: created, previous: null };
    },
    audit: (created, session) => createAuditRecords([
      {
        Model: HospitalAuditLog,
        data: { admin: req.user.id, hospital: created._id, action: 'created' }
      },
      {
        Model: AdminAuditLog,
        data: adminAuditData(req, {
          action: 'hospital-created',
          targetType: 'hospital',
          targetId: created._id
        })
      }
    ], session),
    rollback: async (created) => {
      const result = await Hospital.deleteOne({ _id: created._id, updatedAt: created.updatedAt });
      return result.deletedCount === 1;
    }
  });
  res.status(201).json({ success: true, data: hospital });
}));

router.patch('/hospitals/:id', validateObjectId, catchAsync(async (req, res) => {
  const updates = validateHospitalInput(req.body);
  if (!Object.keys(updates).length) reject('Provide at least one hospital field to update.');
  const hospital = await withAuditedChange({
    description: 'hospital update',
    mutate: async (session) => {
      let previousQuery = Hospital.findOne({ _id: req.params.id, isActive: true });
      if (session) previousQuery = previousQuery.session(session);
      const previous = await previousQuery.lean();
      if (!previous) reject('Hospital or blood bank not found.', 404);
      const updated = await Hospital.findOneAndUpdate(
        { _id: req.params.id, isActive: true, updatedAt: previous.updatedAt },
        {
          $set: {
            ...updates,
            verificationStatus: 'Pending',
            reviewedBy: null,
            reviewedAt: null
          }
        },
        { new: true, runValidators: true, ...(session ? { session } : {}) }
      );
      if (!updated) reject('Hospital or blood bank not found.', 404);
      return { result: updated, previous };
    },
    audit: (updated, session) => createAuditRecords([
      {
        Model: HospitalAuditLog,
        data: { admin: req.user.id, hospital: updated._id, action: 'updated' }
      },
      {
        Model: AdminAuditLog,
        data: adminAuditData(req, {
          action: 'hospital-updated',
          targetType: 'hospital',
          targetId: updated._id,
          metadata: {
            changedFields: Object.keys(updates).flatMap((field) =>
              field === 'location' ? ['latitude', 'longitude'] : [field])
          }
        })
      }
    ], session),
    rollback: async (updated, previous) => {
      const result = await Hospital.replaceOne(
        { _id: updated._id, updatedAt: updated.updatedAt },
        previous,
        { runValidators: true }
      );
      return result.matchedCount === 1;
    }
  });
  res.status(200).json({ success: true, data: hospital });
}));

router.patch('/hospitals/:id/verification', validateObjectId, catchAsync(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['status', 'inventoryVerified'].includes(key)) ||
      !['Verified', 'Rejected'].includes(body.status)) {
    reject('status must be Verified or Rejected; only inventoryVerified is additionally supported.');
  }
  if (body.inventoryVerified !== undefined && typeof body.inventoryVerified !== 'boolean') {
    reject('inventoryVerified must be a boolean.');
  }
  const reviewedAt = new Date();
  const hospital = await withAuditedChange({
    description: 'hospital verification',
    mutate: async (session) => {
      let previousQuery = Hospital.findOne({ _id: req.params.id, isActive: true });
      if (session) previousQuery = previousQuery.session(session);
      const previous = await previousQuery.lean();
      if (!previous) reject('Hospital or blood bank not found.', 404);
      const updated = await Hospital.findOneAndUpdate(
        { _id: req.params.id, isActive: true, updatedAt: previous.updatedAt },
        {
          $set: {
            verificationStatus: body.status,
            reviewedBy: req.user.id,
            reviewedAt,
            inventoryVerified: body.status === 'Verified' && body.inventoryVerified === true,
            inventoryVerifiedAt: body.status === 'Verified' && body.inventoryVerified === true ? reviewedAt : null
          }
        },
        { new: true, runValidators: true, ...(session ? { session } : {}) }
      );
      if (!updated) reject('Hospital or blood bank not found.', 404);
      return { result: updated, previous };
    },
    audit: (updated, session) => createAuditRecords([
      {
        Model: HospitalAuditLog,
        data: {
          admin: req.user.id,
          hospital: updated._id,
          action: body.status === 'Verified' ? 'verified' : 'rejected'
        }
      },
      {
        Model: AdminAuditLog,
        data: adminAuditData(req, {
          action: 'verification-decision',
          targetType: 'hospital',
          targetId: updated._id,
          metadata: {
            status: body.status,
            inventoryVerified: body.inventoryVerified === true
          }
        })
      }
    ], session),
    rollback: async (updated, previous) => {
      const result = await Hospital.replaceOne(
        { _id: updated._id, updatedAt: updated.updatedAt },
        previous,
        { runValidators: true }
      );
      return result.matchedCount === 1;
    }
  });
  res.status(200).json({ success: true, data: hospital });
}));

router.delete('/hospitals/:id', validateObjectId, catchAsync(async (req, res) => {
  await withAuditedChange({
    description: 'hospital removal',
    mutate: async (session) => {
      let previousQuery = Hospital.findOne({ _id: req.params.id, isActive: true });
      if (session) previousQuery = previousQuery.session(session);
      const previous = await previousQuery.lean();
      if (!previous) reject('Hospital or blood bank not found.', 404);
      const removed = await Hospital.findOneAndUpdate(
        { _id: req.params.id, isActive: true, updatedAt: previous.updatedAt },
        { $set: { isActive: false } },
        { new: true, ...(session ? { session } : {}) }
      );
      if (!removed) reject('Hospital or blood bank not found.', 404);
      return { result: removed, previous };
    },
    audit: (removed, session) => createAuditRecords([
      {
        Model: HospitalAuditLog,
        data: { admin: req.user.id, hospital: removed._id, action: 'deleted' }
      },
      {
        Model: AdminAuditLog,
        data: adminAuditData(req, {
          action: 'hospital-removed',
          targetType: 'hospital',
          targetId: removed._id
        })
      }
    ], session),
    rollback: async (removed, previous) => {
      const result = await Hospital.replaceOne(
        { _id: removed._id, updatedAt: removed.updatedAt },
        previous,
        { runValidators: true }
      );
      return result.matchedCount === 1;
    }
  });
  res.status(200).json({ success: true, message: 'Hospital directory entry removed.' });
}));

router.patch('/reports/:id', validateObjectId, catchAsync(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) reject('Request body must be a JSON object.');
  if (!REPORT_STATUSES.has(body.status)) reject('status is invalid.');
  if (body.adminNote !== undefined &&
      (typeof body.adminNote !== 'string' || body.adminNote.trim().length > 1000)) {
    reject('adminNote must be no more than 1000 characters.');
  }
  const reviewedAt = new Date();
  const updates = {
    status: body.status,
    reviewedBy: req.user.id,
    reviewedAt
  };
  if (body.adminNote !== undefined) updates.adminNote = body.adminNote.trim();
  const report = await withAuditedChange({
    description: 'report review',
    mutate: async (session) => {
      let previousQuery = Report.findById(req.params.id).select('status reviewedBy reviewedAt adminNote');
      if (session) previousQuery = previousQuery.session(session);
      const previous = await previousQuery.lean();
      if (!previous) reject('Report not found.', 404);
      let updatedQuery = Report.findByIdAndUpdate(req.params.id, updates, {
        new: true,
        runValidators: true,
        ...(session ? { session } : {})
      })
        .select('-dedupeKey')
        .populate('reporter', 'name role')
        .populate('reportedUser', 'name role city')
        .populate('bloodRequest', 'patientName bloodGroup hospital city status')
        .populate('reviewedBy', 'name');
      if (session) updatedQuery = updatedQuery.session(session);
      const updated = await updatedQuery.lean();
      if (!updated) reject('Report not found.', 404);
      return { result: { report: updated, previousStatus: previous.status }, previous };
    },
    audit: (updated, session) => createAuditRecord(AdminAuditLog, adminAuditData(req, {
      action: 'report-reviewed',
      targetType: 'report',
      targetId: updated.report._id,
      metadata: { status: body.status, previousStatus: updated.previousStatus }
    }), session),
    rollback: async (updated, previous) => {
      const rollbackUpdate = {
        status: previous.status,
        reviewedBy: previous.reviewedBy,
        reviewedAt: previous.reviewedAt
      };
      if (body.adminNote !== undefined) rollbackUpdate.adminNote = previous.adminNote;
      const result = await Report.updateOne(
        { _id: updated.report._id, status: body.status, reviewedBy: req.user.id, reviewedAt },
        { $set: rollbackUpdate }
      );
      return result.matchedCount === 1;
    }
  });
  res.status(200).json({ success: true, message: 'Report updated.', data: report.report });
}));

module.exports = router;
