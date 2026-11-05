const mongoose = require('mongoose');
const express = require('express');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const BloodRequest = require('../models/BloodRequest');
const Offer = require('../models/Offer');
const Review = require('../models/Review');
const User = require('../models/User');
const protect = require('../middleware/protect');
const { hasRole } = require('../utils/roles');
const validateObjectId = require('../middleware/validateObjectId');
const reviewLimiter = require('../middleware/rateLimiters').reviewLimiter;

const router = express.Router();
const PAGE_LIMIT = 50;

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
}

function pageValues(query) {
  function parse(value, name, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      reject(`${name} must be a positive integer.`);
    }
    return Number(value);
  }
  const page = parse(query.page, 'page', 1);
  const limit = parse(query.limit, 'limit', 20);
  if (limit > PAGE_LIMIT || !Number.isSafeInteger((page - 1) * limit)) reject(`limit must not exceed ${PAGE_LIMIT}.`);
  return { page, limit };
}

router.get('/users/:id', validateObjectId, catchAsync(async (req, res) => {
  const [user, total, aggregate, reviews] = await Promise.all([
    User.findOne({ _id: req.params.id, isActive: true }).select('_id'),
    Review.countDocuments({ reviewee: req.params.id, status: 'Published' }),
    Review.aggregate([
      { $match: { reviewee: new mongoose.Types.ObjectId(req.params.id), status: 'Published' } },
      { $group: { _id: null, average: { $avg: '$rating' } } }
    ]),
    Review.find({ reviewee: req.params.id, status: 'Published' })
      .select('rating comment createdAt')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
  ]);
  if (!user) reject('User not found.', 404);
  res.status(200).json({
    success: true,
    data: {
      averageRating: aggregate.length ? Math.round(aggregate[0].average * 10) / 10 : null,
      reviewCount: total,
      reviews: reviews.map((review) => ({
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt
      }))
    }
  });
}));

router.use(protect);

router.get('/eligible-offers', catchAsync(async (req, res) => {
  if (!['donor', 'requester'].includes(req.user.role)) reject('Reviews are available to donors and requesters.', 403);
  const { page, limit } = pageValues(req.query);
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const filters = [];
  if (hasRole(req.user, 'donor')) filters.push({ donor: userId });
  if (hasRole(req.user, 'requester')) {
    const requestIds = await BloodRequest.distinct('_id', { requester: userId });
    filters.push({ request: { $in: requestIds } });
  }
  const filter = { $or: filters, status: 'Completed' };

  const [total, offerIds] = await Promise.all([
    Offer.countDocuments(filter),
    Offer.aggregate([
      { $match: filter },
      { $addFields: { effectiveCompletedAt: { $ifNull: ['$completedAt', '$updatedAt'] } } },
      { $sort: { effectiveCompletedAt: -1, _id: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $project: { _id: 1 } }
    ])
  ]);
  const fetchedOffers = offerIds.length
    ? await Offer.find({ _id: { $in: offerIds.map((item) => item._id) } })
      .select('_id donor request completedAt updatedAt')
      .populate('donor', 'name')
      .populate({
        path: 'request',
        select: 'patientName city requester',
        populate: { path: 'requester', select: 'name' }
      })
      .lean()
    : [];
  const offersById = new Map(fetchedOffers.map((offer) => [String(offer._id), offer]));
  const offers = offerIds.map((item) => offersById.get(String(item._id))).filter(Boolean);
  const existing = offers.length
    ? await Review.find({ reviewer: req.user.id, offer: { $in: offers.map((offer) => offer._id) } })
      .select('offer rating comment status')
      .lean()
    : [];
  const reviewByOffer = new Map(existing.map((review) => [String(review.offer), review]));
  const data = offers.filter((offer) => offer.request && offer.donor && offer.request.requester).map((offer) => {
    const isDonor = String(offer.donor._id) === String(req.user.id);
    const otherUser = isDonor ? offer.request.requester : offer.donor;
    const review = reviewByOffer.get(String(offer._id));
    return {
      offerId: offer._id,
      completedAt: offer.completedAt || offer.updatedAt,
      patientName: offer.request.patientName,
      city: offer.request.city,
      reviewee: { id: otherUser._id, name: otherUser.name },
      review: review ? { rating: review.rating, comment: review.comment, status: review.status } : null
    };
  });
  res.status(200).json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
}));

router.post('/:offerId', reviewLimiter, validateObjectId, catchAsync(async (req, res) => {
  if (!['donor', 'requester'].includes(req.user.role)) reject('Reviews are available to donors and requesters.', 403);
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['rating', 'comment'].includes(key))) {
    reject('Only rating and comment fields are accepted.');
  }
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) reject('rating must be an integer from 1 to 5.');
  if (body.comment !== undefined && (typeof body.comment !== 'string' || body.comment.trim().length > 500)) {
    reject('comment must be a string of no more than 500 characters.');
  }
  const offer = await Offer.findOne({ _id: req.params.offerId, status: 'Completed' }).select('donor request');
  if (!offer) reject('Only completed donations can be reviewed.', 404);
  const request = await BloodRequest.findById(offer.request).select('requester');
  if (!request) reject('Blood request not found.', 404);
  const reviewerId = String(req.user.id);
  const isDonor = String(offer.donor) === reviewerId && hasRole(req.user, 'donor');
  const isRequester = String(request.requester) === reviewerId && hasRole(req.user, 'requester');
  if (!isDonor && !isRequester) reject('Only a donor or requester involved in this completed offer can review it.', 403);
  const reviewee = isDonor ? request.requester : offer.donor;
  if (String(reviewee) === reviewerId) reject('You cannot review your own account.', 400);
  const reviewData = {
    reviewee,
    rating: body.rating,
    comment: body.comment === undefined ? '' : body.comment.trim()
  };
  const resubmitted = await Review.findOneAndUpdate(
    { offer: offer._id, reviewer: req.user.id, status: 'Rejected' },
    {
      $set: {
        ...reviewData,
        status: 'Pending',
        reviewedBy: null,
        reviewedAt: null,
        adminNote: ''
      }
    },
    { new: true, runValidators: true }
  );
  if (resubmitted) {
    res.status(200).json({
      success: true,
      message: 'Updated review submitted for administrator moderation.',
      data: { id: resubmitted._id, status: resubmitted.status }
    });
    return;
  }
  try {
    const review = await Review.create({
      offer: offer._id,
      reviewer: req.user.id,
      ...reviewData
    });
    res.status(201).json({
      success: true,
      message: 'Review submitted for administrator moderation.',
      data: { id: review._id, status: review.status }
    });
  } catch (error) {
    if (error.code === 11000) reject('You have already reviewed this completed offer.', 409);
    throw error;
  }
}));

module.exports = router;
