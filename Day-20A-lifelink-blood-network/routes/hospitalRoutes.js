const express = require('express');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const Hospital = require('../models/Hospital');
const validateObjectId = require('../middleware/validateObjectId');

const router = express.Router();
const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const MAX_LIMIT = 50;

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
}

function regex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function positiveInt(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    reject(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function parseCoordinates(query) {
  const hasLatitude = query.latitude !== undefined;
  const hasLongitude = query.longitude !== undefined;
  if (hasLatitude !== hasLongitude) reject('latitude and longitude must be provided together.');
  if (!hasLatitude) return null;
  const latitude = Number(query.latitude);
  const longitude = Number(query.longitude);
  if (typeof query.latitude !== 'string' || typeof query.longitude !== 'string' ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    reject('latitude and longitude must be valid decimal coordinates.');
  }
  return [longitude, latitude];
}

function publicHospital(item) {
  const data = item.toObject ? item.toObject() : { ...item };
  if (data.verificationStatus !== 'Verified' || data.inventoryVerified !== true) {
    data.bloodGroups = [];
    data.inventoryVerifiedAt = null;
  }
  delete data.__v;
  delete data.isActive;
  delete data.reviewedBy;
  delete data.reviewedAt;
  delete data.updatedAt;
  return data;
}

router.get('/', catchAsync(async (req, res) => {
  const page = positiveInt(req.query.page, 'page', 1);
  const limit = positiveInt(req.query.limit, 'limit', 10);
  if (limit > MAX_LIMIT || !Number.isSafeInteger((page - 1) * limit)) reject(`limit must not exceed ${MAX_LIMIT}.`);
  const coordinates = parseCoordinates(req.query);
  if (req.query.radiusKm !== undefined && typeof req.query.radiusKm !== 'string') reject('radiusKm must be a decimal number.');
  const radiusKm = req.query.radiusKm === undefined ? 10 : Number(req.query.radiusKm);
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 100) reject('radiusKm must be between 1 and 100.');

  const filters = { isActive: true, verificationStatus: { $in: ['Pending', 'Verified'] } };
  for (const field of ['city', 'search']) {
    if (req.query[field] === undefined || req.query[field] === '') continue;
    if (typeof req.query[field] !== 'string' || req.query[field].length > 100) reject(`${field} must be a string of no more than 100 characters.`);
  }
  if (req.query.city) filters.city = { $regex: `^${regex(req.query.city.trim())}$`, $options: 'i' };
  if (req.query.search) filters.name = { $regex: regex(req.query.search.trim()), $options: 'i' };
  if (req.query.bloodGroup) {
    if (typeof req.query.bloodGroup !== 'string' || !BLOOD_GROUPS.has(req.query.bloodGroup)) reject('bloodGroup is invalid.');
    filters.verificationStatus = 'Verified';
    filters.inventoryVerified = true;
    filters.bloodGroups = req.query.bloodGroup;
  }

  let total;
  let items;
  if (coordinates) {
    const [result] = await Hospital.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates },
          key: 'location',
          distanceField: 'distanceMeters',
          maxDistance: radiusKm * 1000,
          spherical: true,
          query: filters
        }
      },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: { name: 1, city: 1, address: 1, contactNumber: 1, website: 1, operatingHours: 1, bloodGroups: 1, inventoryVerified: 1, inventoryVerifiedAt: 1, verificationStatus: 1, location: 1, distanceMeters: 1 } }
          ],
          count: [{ $count: 'total' }]
        }
      }
    ]);
    items = result ? result.data : [];
    total = result && result.count.length ? result.count[0].total : 0;
  } else {
    [total, items] = await Promise.all([
      Hospital.countDocuments(filters),
      Hospital.find(filters)
        .select('-__v')
        .sort({ verificationStatus: 1, name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);
  }
  const data = items.map((item) => {
    const hospital = publicHospital(item);
    if (Number.isFinite(item.distanceMeters)) hospital.distanceKm = Math.round(item.distanceMeters / 100) / 10;
    return hospital;
  });
  res.status(200).json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}));

router.get('/:id', validateObjectId, catchAsync(async (req, res) => {
  const hospital = await Hospital.findOne({
    _id: req.params.id,
    isActive: true,
    verificationStatus: { $in: ['Pending', 'Verified'] }
  }).select('-__v').lean();
  if (!hospital) reject('Hospital or blood bank not found.', 404);
  res.status(200).json({ success: true, data: publicHospital(hospital) });
}));

module.exports = router;
