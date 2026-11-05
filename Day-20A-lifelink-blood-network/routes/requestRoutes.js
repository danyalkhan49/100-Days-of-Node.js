const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const BloodRequest = require('../models/BloodRequest');
const StorageCleanupJob = require('../models/StorageCleanupJob');
const Offer = require('../models/Offer');
const Review = require('../models/Review');
const User = require('../models/User');
const { withRequiredTransaction } = require('../utils/requiredTransaction');
const { logRollbackFailure } = require('../utils/safeErrorLogger');
const { enqueueStorageCleanupJob } = require('../utils/storageCleanupQueue');
const { prescriptionUploadLimiter } = require('../middleware/rateLimiters');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');
const { canDonate } = require('../utils/bloodCompatibility');
const { hasRole } = require('../utils/roles');
const validateObjectId = require('../middleware/validateObjectId');
const uploadPrescription = require('../middleware/uploadPrescription');
const {
  canAccessPrescription,
  createPrescriptionUploadHandler,
  enqueuePrescriptionCleanup,
  hasPrescriptionStorage,
  moveLegacyPrescriptionToQuarantine,
  sendLegacyPrescription,
  sendR2Prescription
} = require('../utils/prescriptionStorage');
const {
  dispatchNotification,
  notifyMatchingDonors,
  scheduleCriticalRequest,
  notifyRequestCanceled
} = require('../utils/notifications');

const router = express.Router();
const optionalProtect = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return protect(req, res, next);
};
const uploadDirectory = path.resolve(__dirname, '../uploads/prescriptions');
const bloodGroups = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const urgencies = new Set(['Critical', 'Urgent', 'Normal']);
const requestStatuses = new Set(['Open', 'Fulfilled', 'Closed']);
const listSortFields = new Set(['neededBy', 'createdAt', 'urgency']);
const allowedCreateFields = new Set([
  'patientName',
  'bloodGroup',
  'unitsNeeded',
  'hospital',
  'city',
  'urgency',
  'neededBy',
  'note'
]);
const allowedUpdateFields = new Set(['hospital', 'city', 'urgency', 'neededBy', 'note']);
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 100;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
}

function readBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reject('Request body must be a JSON object.');
  }
  return body;
}

function readString(value, field, { required = false, maxLength } = {}) {
  if (typeof value !== 'string') {
    reject(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    reject(`${field} is required.`);
  }
  if (maxLength !== undefined && normalized.length > maxLength) {
    reject(`${field} must be no more than ${maxLength} characters.`);
  }
  return normalized;
}

function readNeededBy(value) {
  const stringValue = readString(value, 'neededBy', { required: true });
  const date = new Date(stringValue);
  const now = Date.now();
  if (
    Number.isNaN(date.getTime()) ||
    date.getTime() <= now ||
    date.getTime() > now + 30 * DAY_IN_MS
  ) {
    reject('neededBy must be a future date within the next 30 days.');
  }
  return date;
}

function validateCreateBody(req, _res, next) {
  try {
    const body = readBody(req.body);
    const values = {};

    for (const field of allowedCreateFields) {
      if (hasOwn(body, field)) {
        values[field] = body[field];
      }
    }

    for (const field of ['patientName', 'hospital', 'city']) {
      values[field] = readString(values[field], field, { required: true });
    }

    values.bloodGroup = readString(values.bloodGroup, 'bloodGroup', { required: true });
    if (!bloodGroups.has(values.bloodGroup)) {
      reject('bloodGroup must be one of the eight supported blood groups.');
    }
    if (!Number.isInteger(values.unitsNeeded) || values.unitsNeeded < 1 || values.unitsNeeded > 10) {
      reject('unitsNeeded must be an integer between 1 and 10.');
    }
    if (hasOwn(values, 'urgency')) {
      values.urgency = readString(values.urgency, 'urgency', { required: true });
      if (!urgencies.has(values.urgency)) {
        reject('urgency must be Critical, Urgent, or Normal.');
      }
    }
    values.neededBy = readNeededBy(values.neededBy);

    if (hasOwn(values, 'note')) {
      values.note = readString(values.note, 'note', { maxLength: 300 });
    }

    req.validatedRequest = values;
    next();
  } catch (error) {
    next(error);
  }
}

function readPagination(query, defaultLimit = 5) {
  function readPositiveInteger(value, name, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      reject(`${name} must be a positive integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      reject(`${name} must be a positive integer.`);
    }
    return parsed;
  }

  const page = readPositiveInteger(query.page, 'page', 1);
  const limit = readPositiveInteger(query.limit, 'limit', defaultLimit);
  if (limit > MAX_PAGE_SIZE) {
    reject(`limit must not exceed ${MAX_PAGE_SIZE}.`);
  }
  if (!Number.isSafeInteger((page - 1) * limit)) {
    reject('Pagination values are too large.');
  }
  return { page, limit };
}

function readOptionalQueryString(query, name) {
  const value = query[name];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') {
    reject(`${name} must be a string.`);
  }
  return value;
}

function readSort(query, defaultSortBy = 'neededBy', defaultOrder = 'asc') {
  const sortBy = readOptionalQueryString(query, 'sortBy') || defaultSortBy;
  const rawOrder = readOptionalQueryString(query, 'order') || defaultOrder;
  const order = rawOrder.toLowerCase();

  if (!listSortFields.has(sortBy)) {
    reject('sortBy is not supported.');
  }
  if (order !== 'asc' && order !== 'desc') {
    reject('order must be asc or desc.');
  }
  return { sortBy, sortOrder: order === 'asc' ? 1 : -1 };
}

function addCommonFilters(query, filters, { includePatientName = false } = {}) {
  const bloodGroup = readOptionalQueryString(query, 'bloodGroup');
  const city = readOptionalQueryString(query, 'city');
  const urgency = readOptionalQueryString(query, 'urgency');
  const search = readOptionalQueryString(query, 'search');

  if (bloodGroup) {
    if (!bloodGroups.has(bloodGroup)) reject('bloodGroup is invalid.');
    filters.bloodGroup = bloodGroup;
  }
  if (city !== undefined) filters.city = city;
  if (urgency) {
    if (!urgencies.has(urgency)) reject('urgency is invalid.');
    filters.urgency = urgency;
  }
  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filters.$or = [{ hospital: { $regex: escapedSearch, $options: 'i' } }];
    if (includePatientName) {
      filters.$or.push({ patientName: { $regex: escapedSearch, $options: 'i' } });
    }
  }
}

function paginationPayload(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit)
  };
}

function getMaxOpenRequests() {
  const configuredLimit = process.env.MAX_REQUESTS_PER_REQUESTER || process.env.MAX_OPEN_REQUESTS;
  const value = Number(configuredLimit);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('MAX_REQUESTS_PER_REQUESTER or MAX_OPEN_REQUESTS must be a positive integer.');
  }
  return value;
}

function prescriptionPath(filename) {
  if (typeof filename !== 'string' || filename.length === 0 || path.basename(filename) !== filename) {
    throw new AppError('Stored prescription filename is invalid.', 500);
  }
  const resolvedPath = path.resolve(uploadDirectory, filename);
  if (!resolvedPath.startsWith(`${uploadDirectory}${path.sep}`)) {
    throw new AppError('Stored prescription filename is invalid.', 500);
  }
  return resolvedPath;
}

async function unlinkIfPresent(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function validatePrescriptionContents(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const contents = await fs.promises.readFile(file.path);
  const matches = {
    '.pdf': contents.subarray(0, 5).toString('ascii') === '%PDF-',
    '.jpg': contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff,
    '.jpeg': contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff,
    '.png': contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  };

  if (!matches[extension]) {
    reject('The uploaded file content does not match an allowed prescription type.');
  }
  return contents;
}

async function movePrescriptionToQuarantine(filename) {
  if (!filename) return null;

  const sourcePath = prescriptionPath(filename);
  const quarantinePath = path.join(uploadDirectory, `${crypto.randomBytes(16).toString('hex')}.deleting`);
  try {
    await fs.promises.rename(sourcePath, quarantinePath);
    return { sourcePath, quarantinePath };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

router.get('/', optionalProtect, catchAsync(async (req, res) => {
  const { page, limit } = readPagination(req.query);
  const { sortBy, sortOrder } = readSort(req.query);
  const filters = {
    status: 'Open',
    neededBy: { $gte: new Date() }
  };
  addCommonFilters(req.query, filters);

  if (hasRole(req.user, 'donor')) {
    const donor = await User.findById(req.user.id).select('role bloodGroup').lean();
    const compatibleGroups = Array.from(bloodGroups).filter((group) =>
      canDonate(donor && donor.bloodGroup, group)
    );
    if (filters.bloodGroup) {
      if (!compatibleGroups.includes(filters.bloodGroup)) filters.bloodGroup = { $in: [] };
    } else {
      filters.bloodGroup = { $in: compatibleGroups };
    }
  }

  const [result] = await BloodRequest.aggregate([
    { $match: filters },
    {
      $lookup: {
        from: Offer.collection.name,
        let: { requestId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$request', '$$requestId'] },
                  { $eq: ['$status', 'Accepted'] }
                ]
              }
            }
          },
          { $count: 'count' }
        ],
        as: 'acceptedOfferCount'
      }
    },
    {
      $match: {
        $expr: {
          $lt: [
            {
              $add: [
                { $ifNull: ['$unitsFulfilled', 0] },
                { $ifNull: [{ $arrayElemAt: ['$acceptedOfferCount.count', 0] }, 0] }
              ]
            },
            '$unitsNeeded'
          ]
        }
      }
    },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $sort: { [sortBy]: sortOrder } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: { prescription: 0, patientName: 0, requester: 0, acceptedOfferCount: 0 } }
        ]
      }
    }
  ]);
  const data = result ? result.data : [];
  const total = result && result.metadata.length ? result.metadata[0].total : 0;

  res.status(200).json({
    success: true,
    data,
    pagination: paginationPayload(page, limit, total)
  });
}));

router.get('/my', protect, restrictTo('requester'), catchAsync(async (req, res) => {
  const { page, limit } = readPagination(req.query);
  const { sortBy, sortOrder } = readSort(req.query, 'createdAt', 'desc');
  const filters = { requester: req.user.id };
  addCommonFilters(req.query, filters, { includePatientName: true });

  const status = readOptionalQueryString(req.query, 'status');
  if (status) {
    if (!requestStatuses.has(status)) reject('status is invalid.');
    filters.status = status;
  }

  const [total, requests] = await Promise.all([
    BloodRequest.countDocuments(filters),
    BloodRequest.find(filters)
      .populate('requester', 'name')
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  const requestIds = requests.map((request) => request._id);
  const offerCounts = requestIds.length
    ? await Offer.aggregate([
      { $match: { request: { $in: requestIds } } },
      {
        $group: {
          _id: '$request',
          offerCount: { $sum: 1 },
          pendingOfferCount: {
            $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] }
          }
        }
      }
    ])
    : [];
  const countByRequest = new Map(offerCounts.map((item) => [String(item._id), item]));

  const data = requests.map((request) => {
    const counts = countByRequest.get(String(request._id));
    return {
      ...request,
      offerCount: counts ? counts.offerCount : 0,
      pendingOfferCount: counts ? counts.pendingOfferCount : 0
    };
  });

  res.status(200).json({
    success: true,
    data,
    pagination: paginationPayload(page, limit, total)
  });
}));

router.get('/:id', validateObjectId, catchAsync(async (req, res) => {
  const data = await BloodRequest.findOne({
    _id: req.params.id,
    status: 'Open',
    neededBy: { $gte: new Date() }
  })
    .select('-prescription -patientName -requester')
    .lean();
  if (!data) reject('Blood request not found.', 404);

  res.status(200).json({ success: true, data });
}));

router.post(
  '/',
  protect,
  restrictTo('requester'),
  validateCreateBody,
  catchAsync(async (req, res) => {
    const maxOpenRequests = getMaxOpenRequests();
    const now = new Date();
    const data = await withRequiredTransaction(async (session) => {
      const requester = await User.updateOne(
        { _id: req.user.id, role: { $in: ['donor', 'requester'] }, isActive: { $ne: false } },
        { $inc: { requestCreationSequence: 1 } },
        { session }
      );
      if (requester.matchedCount !== 1) reject('Your requester account is not available.', 403);

      const existingRequests = await BloodRequest.countDocuments({
        requester: req.user.id,
        status: 'Open',
        neededBy: { $gte: now }
      }).session(session);
      if (existingRequests >= maxOpenRequests) {
        reject(`You can have no more than ${maxOpenRequests} open blood requests.`, 400);
      }

      const [created] = await BloodRequest.create([{
        ...req.validatedRequest,
        requester: req.user.id
      }], { session });
      return created;
    });
    const responseData = data.toObject();
    delete responseData.acceptanceSequence;
    const request = responseData;
    if (request.urgency === 'Critical') {
      dispatchNotification(() => scheduleCriticalRequest(request), 'Critical request');
    } else {
      dispatchNotification(() => notifyMatchingDonors(request), 'New request');
    }
    res.status(201).json({ success: true, data: responseData });
  })
);

const prepareRequestUpdate = catchAsync(async (req, _res, next) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) reject('Blood request not found.', 404);
  if (String(request.requester) !== String(req.user.id)) {
    reject('You do not own this blood request.', 403);
  }
  if (request.status !== 'Open') {
    reject('Only open blood requests can be edited.', 409);
  }
  if (await Offer.countDocuments({ request: request._id })) {
    reject('A blood request cannot be edited after an offer has been made.', 409);
  }

  const body = readBody(req.body);
  const updates = {};
  for (const field of allowedUpdateFields) {
    if (!hasOwn(body, field)) continue;

    if (field === 'neededBy') {
      updates.neededBy = readNeededBy(body.neededBy);
    } else if (field === 'urgency') {
      if (!urgencies.has(body.urgency)) reject('urgency must be Critical, Urgent, or Normal.');
      updates.urgency = readString(body.urgency, 'urgency', { required: true });
      if (!urgencies.has(updates.urgency)) {
        reject('urgency must be Critical, Urgent, or Normal.');
      }
    } else if (field === 'note') {
      updates.note = readString(body.note, 'note', { maxLength: 300 });
    } else {
      updates[field] = readString(body[field], field, { required: true });
    }
  }
  if (Object.keys(updates).length === 0) {
    reject('Provide at least one editable field.');
  }

  req.bloodRequest = request;
  req.validatedRequestUpdates = updates;
  next();
});

router.put(
  '/:id',
  protect,
  restrictTo('requester'),
  validateObjectId,
  prepareRequestUpdate,
  catchAsync(async (req, res) => {
    Object.assign(req.bloodRequest, req.validatedRequestUpdates);
    const data = await req.bloodRequest.save({ validateModifiedOnly: true });
    await data.populate('requester', 'name');
    const responseData = data.toObject();
    delete responseData.prescription;
    if (responseData.urgency === 'Critical') {
      dispatchNotification(() => scheduleCriticalRequest(responseData), 'Critical request');
    }
    res.status(200).json({
      success: true,
      message: 'Blood request updated successfully.',
      data: responseData
    });
  })
);

const closeRequest = catchAsync(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id);
  if (!request) reject('Blood request not found.', 404);

  const isOwner = String(request.requester) === String(req.user.id);
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) {
    reject('You do not have permission to close this blood request.', 403);
  }
  if (request.status !== 'Open') {
    reject('Only open blood requests can be closed.', 400);
  }

  const { data, eligibleOffers } = await withRequiredTransaction(async (session) => {
    const offers = await Offer.find({
      request: request._id,
      status: { $in: ['Pending', 'Accepted'] }
    }).select('_id status donor').session(session).lean();
    const updatedRequest = await BloodRequest.findOneAndUpdate(
      { _id: request._id, status: 'Open' },
      { $set: { status: 'Closed' } },
      { new: true, runValidators: true, session }
    ).select('-prescription').populate('requester', 'name').lean();
    if (!updatedRequest) reject('Only open blood requests can be closed.', 400);

    const result = await Offer.updateMany(
      { request: request._id, status: { $in: ['Pending', 'Accepted'] } },
      { $set: { status: 'Canceled' } },
      { session }
    );
    if (result.acknowledged === false) {
      throw new Error('Offer cancellation was not acknowledged.');
    }
    return { data: updatedRequest, eligibleOffers: offers };
  });

  notifyRequestCanceled({
    requestId: request._id,
    requesterId: request.requester,
    offers: eligibleOffers
  });
  res.status(200).json({
    success: true,
    message: 'Blood request closed successfully.',
    data
  });
});

router
  .route('/:id/close')
  .patch(protect, validateObjectId, closeRequest)
  .put(protect, validateObjectId, closeRequest);

router.delete(
  '/:id',
  protect,
  restrictTo('admin'),
  validateObjectId,
  catchAsync(async (req, res) => {
    const request = await BloodRequest.findById(req.params.id).select('+prescriptionStorage');
    if (!request) reject('Blood request not found.', 404);

    const movedPrescription = await moveLegacyPrescriptionToQuarantine(
      request,
      movePrescriptionToQuarantine
    );
    try {
      await withRequiredTransaction(async (session) => {
        const relatedOffers = await Offer.find({ request: request._id })
          .select('_id')
          .session(session)
          .lean();
        const offerIds = relatedOffers.map((offer) => offer._id);
        const reviewsResult = await Review.deleteMany(
          { offer: { $in: offerIds } },
          { session }
        );
        if (reviewsResult.acknowledged === false) {
          throw new Error('Review deletion was not acknowledged.');
        }
        const offersResult = await Offer.deleteMany({ request: request._id }, { session });
        if (offersResult.acknowledged === false) {
          throw new Error('Offer deletion was not acknowledged.');
        }
        const result = await BloodRequest.deleteOne({ _id: request._id }, { session });
        if (result.deletedCount !== 1) reject('Blood request not found.', 404);
        await enqueuePrescriptionCleanup(
          request,
          (target, jobSession) =>
            enqueueStorageCleanupJob(StorageCleanupJob, target, jobSession),
          session
        );
      });
    } catch (error) {
      const rollbackErrors = [];
      try {
        if (movedPrescription) {
          await fs.promises.rename(movedPrescription.quarantinePath, movedPrescription.sourcePath);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      if (rollbackErrors.length) {
        logRollbackFailure('request_prescription_restore', rollbackErrors);
        throw new Error('Request deletion failed and its previous state could not be fully restored.');
      }
      throw error;
    }

    if (movedPrescription) {
      await unlinkIfPresent(movedPrescription.quarantinePath);
    }

    res.status(200).json({
      success: true,
      message: 'Blood request and associated resources deleted successfully.'
    });
  })
);

router.post(
  '/:id/prescription',
  protect,
  restrictTo('requester'),
  validateObjectId,
  prescriptionUploadLimiter,
  uploadPrescription,
  createPrescriptionUploadHandler({
    BloodRequest,
    getStorage: (req) => req.app.locals.storage,
    uploadDirectory,
    validateContents: validatePrescriptionContents,
    enqueueCleanup: (target, session) =>
      enqueueStorageCleanupJob(StorageCleanupJob, target, session),
    withRequiredTransaction
  })
);

router.get(
  '/:id/prescription',
  protect,
  validateObjectId,
  catchAsync(async (req, res, next) => {
    const request = await BloodRequest.findById(req.params.id).select('+prescriptionStorage');
    if (!request) reject('Blood request not found.', 404);
    if (!request.prescription) reject('Prescription not found.', 404);

    if (!await canAccessPrescription({ request, user: req.user, Offer })) {
      reject('You do not have permission to download this prescription.', 403);
    }

    if (hasPrescriptionStorage(request)) {
      return sendR2Prescription({
        request,
        storageRuntime: req.app.locals.storage,
        res
      });
    }

    return sendLegacyPrescription({
      filename: request.prescription,
      directory: uploadDirectory,
      res,
      next
    });
  })
);

module.exports = router;
