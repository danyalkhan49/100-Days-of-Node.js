const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { canDonate, checkDonorEligibility } = require('../utils/bloodCompatibility');
const BloodRequest = require('../models/BloodRequest');
const Offer = require('../models/Offer');
const User = require('../models/User');
const Block = require('../models/Block');
const Report = require('../models/Report');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');
const validateObjectId = require('../middleware/validateObjectId');
const offerLimiter = require('../middleware/offerLimiter');
const { dispatchNotification, notifyOfferAccepted, notifyDonationCompleted } = require('../utils/notifications');
const {
  createInAppNotification,
  dispatchInAppNotification
} = require('../utils/inAppNotifications');
const {
  transactionsSupported,
  withRequiredTransaction
} = require('../utils/requiredTransaction');
const { hasRole } = require('../utils/roles');

const router = express.Router();
const protectOfferDonor = protect.withOptions({
  unavailableStatusCode: 400,
  unavailableMessage: 'A valid, active donor account is required.'
});
const OFFER_STATUSES = new Set(['Pending', 'Accepted', 'Declined', 'Completed', 'Canceled']);
const PAGE_LIMIT_MAX = 100;
const REQUEST_POPULATION = 'patientName hospital city urgency status neededBy';
const DONOR_POPULATION = 'name bloodGroup city avatar lastDonationDate';

function reject(message, statusCode = 400) {
  throw new AppError(message, statusCode);
}

function pagination(query, defaultLimit = 10) {
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
  const limit = parse(query.limit, 'limit', defaultLimit);
  if (limit > PAGE_LIMIT_MAX) reject(`limit must not exceed ${PAGE_LIMIT_MAX}.`);
  if (!Number.isSafeInteger((page - 1) * limit)) reject('Pagination values are too large.');
  return { page, limit };
}

function paginationPayload(page, limit, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

function hasBothCompletionConfirmations(offer) {
  const completion = offer.completion || {};
  return Boolean(completion.donorConfirmedAt && completion.requesterConfirmedAt);
}

function validateStatus(value) {
  if (!OFFER_STATUSES.has(value)) reject('Offer status is invalid.');
  return value;
}

function maxActiveOffers() {
  const maximum = Number(process.env.MAX_ACTIVE_OFFERS);
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new Error('MAX_ACTIVE_OFFERS must be a positive integer.');
  }
  return maximum;
}

async function performCompletion(offerId, requesterId, session) {
  const options = session ? { session } : {};
  const offer = await Offer.findById(offerId).session(session || null);
  if (!offer) reject('Offer not found.', 404);
  const request = await BloodRequest.findById(offer.request).session(session || null);
  if (!request) reject('Blood request not found.', 404);
  if (String(request.requester) !== String(requesterId)) {
    reject('You do not own this blood request.', 403);
  }
  if (offer.status !== 'Accepted') reject('Only accepted offers can be completed.', 400);
  if (!hasBothCompletionConfirmations(offer)) {
    reject('Both the donor and requester must confirm before a donation can be completed.', 409);
  }

  const now = new Date();
  const claimedOffer = await Offer.findOneAndUpdate(
    {
      _id: offer._id,
      status: 'Accepted',
      'completion.donorConfirmedAt': { $exists: true, $ne: null },
      'completion.requesterConfirmedAt': { $exists: true, $ne: null }
    },
    { $set: { status: 'Completed', completedAt: now } },
    { new: true, runValidators: true, ...options }
  );
  if (!claimedOffer) reject('Only accepted offers can be completed.', 400);

  const updatedRequest = await BloodRequest.findOneAndUpdate(
    {
      _id: request._id,
      status: 'Open',
      $expr: { $lt: ['$unitsFulfilled', '$unitsNeeded'] }
    },
    { $inc: { unitsFulfilled: 1 } },
    { new: true, runValidators: true, ...options }
  );
  if (!updatedRequest) reject('This request has already been fulfilled.', 400);

  const donorResult = await User.updateOne(
    { _id: offer.donor, role: 'donor' },
    { $set: { lastDonationDate: now } },
    options
  );
  if (donorResult.matchedCount !== 1) reject('Offer donor was not found.', 404);

  const fulfilled = updatedRequest.unitsFulfilled >= updatedRequest.unitsNeeded;
  if (fulfilled) {
    const requestResult = await BloodRequest.updateOne(
      { _id: request._id, status: 'Open', unitsFulfilled: { $gte: updatedRequest.unitsNeeded } },
      { $set: { status: 'Fulfilled' } },
      options
    );
    if (requestResult.matchedCount !== 1) {
      reject('This request has already been fulfilled.', 400);
    }
    const offersResult = await Offer.updateMany(
      { request: request._id, status: { $in: ['Pending', 'Accepted'] } },
      { $set: { status: 'Canceled' } },
      options
    );
    if (offersResult.acknowledged === false) {
      throw new Error('Remaining offers could not be canceled.');
    }
    updatedRequest.status = 'Fulfilled';
  }

  return {
    offer: claimedOffer.toObject ? claimedOffer.toObject() : claimedOffer,
    request: {
      _id: updatedRequest._id,
      status: updatedRequest.status,
      unitsNeeded: updatedRequest.unitsNeeded,
      unitsFulfilled: updatedRequest.unitsFulfilled
    }
  };
}

async function completeDonation(offerId, requesterId) {
  return withRequiredTransaction((session) =>
    performCompletion(offerId, requesterId, session)
  );
}

async function confirmDonationCompletion(offerId, user, body) {
  if (body !== undefined &&
      (!body || typeof body !== 'object' || Array.isArray(body) ||
       Object.keys(body).some((key) => key !== 'note'))) {
    reject('Only an optional note is supported.');
  }
  if (body && body.note !== undefined &&
      (typeof body.note !== 'string' || body.note.trim().length > 300)) {
    reject('note must be a string of no more than 300 characters.');
  }
  const note = body && typeof body.note === 'string' ? body.note.trim() : '';
  const offer = await Offer.findById(offerId).select('donor request status completion');
  if (!offer) reject('Offer not found.', 404);
  const request = await BloodRequest.findById(offer.request).select('requester city');
  if (!request) reject('Blood request not found.', 404);

  const isDonor = user.role === 'donor' && String(offer.donor) === String(user.id);
  const isRequester = hasRole(user, 'requester') && String(request.requester) === String(user.id);
  if (!isDonor && !isRequester) reject('Only participants in this offer can confirm its completion.', 403);
  if (offer.status === 'Completed') {
    return { message: 'This donation is already complete.', data: offer, notification: null };
  }
  if (offer.status !== 'Accepted') reject('Only accepted offers can be confirmed as complete.', 400);

  const confirmationField = isDonor ? 'donorConfirmedAt' : 'requesterConfirmedAt';
  const noteField = isDonor ? 'donorNote' : 'requesterNote';
  let confirmedOffer = offer;
  if (!(offer.completion && offer.completion[confirmationField])) {
    confirmedOffer = await Offer.findOneAndUpdate(
      { _id: offer._id, status: 'Accepted', [`completion.${confirmationField}`]: null },
      { $set: { [`completion.${confirmationField}`]: new Date(), [`completion.${noteField}`]: note } },
      { new: true, runValidators: true }
    );
    if (!confirmedOffer) {
      confirmedOffer = await Offer.findById(offer._id).select('donor request status completion');
      if (!confirmedOffer) reject('Offer not found.', 404);
      if (confirmedOffer.status === 'Completed') {
        return { message: 'This donation is already complete.', data: confirmedOffer, notification: null };
      }
      if (confirmedOffer.status !== 'Accepted' ||
          !(confirmedOffer.completion && confirmedOffer.completion[confirmationField])) {
        reject('The confirmation could not be recorded. Refresh and try again.', 409);
      }
    }
  }
  confirmedOffer = await Offer.findById(offer._id).select('donor request status completion');
  if (!confirmedOffer) reject('Offer not found.', 404);
  if (confirmedOffer.status === 'Completed') {
    return { message: 'This donation is already complete.', data: confirmedOffer, notification: null };
  }
  if (!hasBothCompletionConfirmations(confirmedOffer)) {
    return {
      message: isDonor
        ? 'Your confirmation was recorded. The requester must also confirm.'
        : 'Your confirmation was recorded. The donor must also confirm.',
      data: confirmedOffer,
      notification: null
    };
  }

  try {
    const data = await completeDonation(offer._id, request.requester);
    return {
      message: 'Both participants confirmed. The donation is complete.',
      data,
      notification: {
        offerId: offer._id,
        requestId: request._id,
        donorId: offer.donor,
        requesterId: request.requester,
        city: request.city,
        requestFulfilled: data.request.status === 'Fulfilled'
      }
    };
  } catch (error) {
    const latestOffer = await Offer.findById(offer._id).select('status');
    if (latestOffer && latestOffer.status === 'Completed') {
      return {
        message: 'Both participants confirmed. The donation is complete.',
        data: latestOffer,
        notification: null
      };
    }
    throw error;
  }
}

const prepareOfferDonor = catchAsync(async (req, _res, next) => {
  const donor = await User.findById(req.user.id)
    .select('role isActive isAvailable bloodGroup lastDonationDate');
  if (!donor || donor.role !== 'donor' || donor.isActive === false) {
    reject('A valid, active donor account is required.', 400);
  }
  if (donor.isAvailable !== true) {
    reject('A valid, available donor account is required.', 400);
  }

  const eligibility = checkDonorEligibility(donor.lastDonationDate);
  if (!eligibility.eligible) {
    const remaining = eligibility.daysRemaining;
    reject(
      remaining === null
        ? 'Your last donation date is invalid. Contact support.'
        : `You are not eligible to donate yet. Please wait ${remaining} more day(s).`,
      400
    );
  }
  req.offerDonor = donor;
  next();
});

router.post(
  '/',
  protectOfferDonor,
  restrictTo('donor'),
  prepareOfferDonor,
  offerLimiter,
  catchAsync(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      reject('Request body must be a JSON object.');
    }
    const requestId = req.body.request;
    if (typeof requestId !== 'string' || !mongoose.Types.ObjectId.isValid(requestId)) {
      reject('request must be a valid request ID.');
    }
    if (req.body.message !== undefined &&
      (typeof req.body.message !== 'string' || req.body.message.trim().length > 200)) {
      reject('message must be a string of no more than 200 characters.');
    }

    const donor = req.offerDonor;

    const request = await BloodRequest.findById(requestId);
    if (!request) reject('Blood request not found.', 404);
    if (request.status !== 'Open') reject('Offers can only be made on open requests.', 409);
    if (request.neededBy <= new Date()) reject('This blood request has expired.', 400);
    if (!canDonate(donor.bloodGroup, request.bloodGroup)) {
      reject('Your blood group is not compatible with this request.', 400);
    }
    if (String(request.requester) === String(donor._id)) {
      reject('You cannot make an offer on your own blood request.', 403);
    }
    const maximum = maxActiveOffers();
    let data;
    try {
      data = await withRequiredTransaction(async (session) => {
        const donorClaim = await User.updateOne(
          { _id: donor._id, role: 'donor', isActive: { $ne: false } },
          { $inc: { offerCreationSequence: 1 } },
          { session }
        );
        if (donorClaim.matchedCount !== 1) reject('A valid, available donor account is required.', 403);

        const currentRequest = await BloodRequest.findOne({
          _id: request._id,
          status: 'Open',
          neededBy: { $gt: new Date() }
        }).session(session);
        if (!currentRequest) reject('Offers can only be made on open, non-expired requests.', 409);

        if (await Offer.findOne({ request: request._id, donor: donor._id }).session(session)) {
          reject('You have already submitted an offer for this request.', 409);
        }

        if (await Block.exists({
          $or: [
            { blocker: donor._id, blocked: request.requester },
            { blocker: request.requester, blocked: donor._id }
          ]
        }).session(session)) {
          reject('Offers are unavailable between these accounts.', 403);
        }

        const acceptedOffers = await Offer.countDocuments({
          request: request._id,
          status: 'Accepted'
        }).session(session);
        if (acceptedOffers + currentRequest.unitsFulfilled >= currentRequest.unitsNeeded) {
          reject('Aur donors ki zaroorat nahi', 409);
        }

        const activeOffers = await Offer.countDocuments({
          donor: donor._id,
          status: { $in: ['Pending', 'Accepted'] }
        }).session(session);
        if (activeOffers >= maximum) {
          reject(`You cannot have more than ${maximum} pending or accepted offers.`, 400);
        }

        const [created] = await Offer.create([{
          request: request._id,
          donor: donor._id,
          ...(req.body.message === undefined ? {} : { message: req.body.message.trim() })
        }], { session });
        await createInAppNotification({
          eventKey: `offer-submitted:${created._id}:${request.requester}`,
          recipient: request.requester,
          title: 'A donor made an offer',
          message: 'A donor submitted an offer for your blood request. Sign in to review it.',
          type: 'offer-submitted',
          request: request._id,
          offer: created._id
        }, session);
        return created;
      });
    } catch (error) {
      if (error.code === 11000) {
        reject('You have already submitted an offer for this request.', 409);
      }
      throw error;
    }
    res.status(201).json({ success: true, data });
  })
);

router.get('/my', protect, restrictTo('donor'), catchAsync(async (req, res) => {
  const { page, limit } = pagination(req.query);
  const filters = { donor: req.user.id };
  const status = req.query.status;
  if (status !== undefined && status !== '') {
    if (typeof status !== 'string') reject('status must be a string.');
    filters.status = validateStatus(status);
  }

  const [total, data] = await Promise.all([
    Offer.countDocuments(filters),
    Offer.find(filters)
      .select('-__v')
      .populate('request', REQUEST_POPULATION)
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

router.get('/request/:id', protect, validateObjectId, catchAsync(async (req, res) => {
  const request = await BloodRequest.findById(req.params.id).select('requester');
  if (!request) reject('Blood request not found.', 404);
  if (String(request.requester) !== String(req.user.id) && req.user.role !== 'admin') {
    reject('You do not have permission to view offers for this request.', 403);
  }

  const { page, limit } = pagination(req.query);
  const filters = { request: request._id };
  const status = req.query.status;
  if (status !== undefined && status !== '') {
    if (typeof status !== 'string') reject('status must be a string.');
    filters.status = validateStatus(status);
  }
  const [total, data] = await Promise.all([
    Offer.countDocuments(filters),
    Offer.find(filters)
      .select('-__v')
      .populate('donor', DONOR_POPULATION)
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

router.put('/:id/accept', protect, restrictTo('requester'), validateObjectId, catchAsync(async (req, res) => {
  let data;
  let request;
  await withRequiredTransaction(async (session) => {
    const offer = await Offer.findById(req.params.id).session(session);
    if (!offer) reject('Offer not found.', 404);
    request = await BloodRequest.findById(offer.request).session(session);
    if (!request) reject('Blood request not found.', 404);
    if (String(request.requester) !== String(req.user.id)) {
      reject('You do not own this blood request.', 403);
    }
    if (request.status !== 'Open' || request.neededBy <= new Date()) {
      reject('Offers can only be accepted for open, non-expired requests.', 409);
    }
    if (offer.status !== 'Pending') reject('Only pending offers can be accepted.', 400);

    const claim = await BloodRequest.updateOne(
      { _id: request._id, status: 'Open', neededBy: { $gt: new Date() } },
      { $inc: { acceptanceSequence: 1 } },
      { session }
    );
    if (claim.matchedCount !== 1) {
      reject('Offers can only be accepted for open, non-expired requests.', 409);
    }

    const acceptedCount = await Offer.countDocuments({
      request: request._id,
      status: 'Accepted'
    }).session(session);
    if (acceptedCount + request.unitsFulfilled >= request.unitsNeeded) {
      reject('Aur donors ki zaroorat nahi', 409);
    }

    data = await Offer.findOneAndUpdate(
      { _id: offer._id, request: request._id, status: 'Pending' },
      { $set: { status: 'Accepted' } },
      { new: true, runValidators: true, session }
    ).select('-__v');
    if (!data) reject('Only pending offers can be accepted.', 400);
    await createInAppNotification({
      eventKey: `offer-accepted:${data._id}:${data.donor}`,
      recipient: data.donor,
      title: 'Your offer was accepted',
      message: 'Your offer was accepted. Sign in to coordinate the next steps.',
      type: 'offer-accepted',
      request: request._id,
      offer: data._id
    }, session);
  });
  dispatchNotification(() => notifyOfferAccepted({
    offerId: data._id,
    requestId: request._id,
    donorId: data.donor,
    city: request.city
  }), 'Offer accepted');
  res.status(200).json({ success: true, data });
}));

router.put('/:id/decline', protect, restrictTo('requester'), validateObjectId, catchAsync(async (req, res) => {
  const offer = await Offer.findById(req.params.id);
  if (!offer) reject('Offer not found.', 404);
  const request = await BloodRequest.findById(offer.request);
  if (!request) reject('Blood request not found.', 404);
  if (String(request.requester) !== String(req.user.id)) {
    reject('You do not own this blood request.', 403);
  }
  if (offer.status !== 'Pending') reject('Only pending offers can be declined.', 400);

  const data = await Offer.findOneAndUpdate(
    { _id: offer._id, status: 'Pending' },
    { $set: { status: 'Declined' } },
    { new: true, runValidators: true }
  ).select('-__v');
  if (!data) reject('Only pending offers can be declined.', 400);
  dispatchInAppNotification(() => createInAppNotification({
    eventKey: `offer-declined:${data._id}:${data.donor}`,
    recipient: data.donor,
    title: 'Your offer was declined',
    message: 'Your offer was declined. You can review other open requests in LifeLink.',
    type: 'offer-declined',
    request: request._id,
    offer: data._id
  }), 'Offer decline');
  res.status(200).json({ success: true, message: 'Offer declined.', data });
}));

async function handleCompletionConfirmation(req, res) {
  const result = await confirmDonationCompletion(req.params.id, req.user, req.body);
  if (result.notification) {
    dispatchNotification(() => notifyDonationCompleted(result.notification), 'Donation completed');
  }
  res.status(200).json({ success: true, message: result.message, data: result.data });
}

router.put(
  '/:id/confirm-completion',
  protect,
  restrictTo('donor', 'requester'),
  validateObjectId,
  catchAsync(handleCompletionConfirmation)
);

router.put(
  '/:id/complete',
  protect,
  restrictTo('requester'),
  validateObjectId,
  catchAsync(handleCompletionConfirmation)
);

router.patch('/:id/requester-outcome', protect, restrictTo('requester'), validateObjectId, catchAsync(async (req, res) => {
  const body = req.body;
  const outcomes = new Set(['Confirmed', 'Did Not Happen', 'Problem']);
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['outcome', 'note'].includes(key)) ||
      !outcomes.has(body.outcome)) {
    reject('outcome must be Confirmed, Did Not Happen, or Problem; only note is additionally supported.');
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.trim().length > 500)) {
    reject('note must be no more than 500 characters.');
  }

  const offer = await Offer.findById(req.params.id).select('request status completion');
  if (!offer) reject('Offer not found.', 404);
  if (offer.status !== 'Completed') reject('Only completed donations can receive a requester outcome.', 409);
  const request = await BloodRequest.findById(offer.request).select('requester');
  if (!request) reject('Blood request not found.', 404);
  if (String(request.requester) !== String(req.user.id)) {
    reject('Only the requester associated with this donation can submit its outcome.', 403);
  }
  if (offer.completion && offer.completion.requesterOutcome) {
    reject('You have already submitted an outcome for this donation.', 409);
  }

  const submittedAt = new Date();
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const update = {
    $set: {
      'completion.requesterOutcome': body.outcome,
      'completion.requesterOutcomeNote': note,
      'completion.requesterOutcomeAt': submittedAt
    }
  };
  const filter = {
    _id: offer._id,
    status: 'Completed',
    'completion.requesterOutcome': null
  };
  const problemReport = body.outcome === 'Problem' ? {
    reporter: req.user.id,
    reportType: 'request',
    bloodRequest: request._id,
    reason: 'other',
    description: `Donation problem for offer ${offer._id}.${note ? ` Requester note: ${note}` : ''}`,
    dedupeKey: crypto.createHash('sha256')
      .update(`${req.user.id}:${request._id}:donation:${offer._id}`)
      .digest('hex')
  } : null;

  let savedOffer;
  if (transactionsSupported()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        savedOffer = await Offer.findOneAndUpdate(filter, update, {
          new: true,
          runValidators: true,
          session
        });
        if (!savedOffer) reject('An outcome has already been submitted for this donation.', 409);
        if (problemReport) await Report.create([problemReport], { session });
      });
    } finally {
      await session.endSession();
    }
  } else {
    const createdReport = problemReport ? await Report.create(problemReport) : null;
    try {
      savedOffer = await Offer.findOneAndUpdate(filter, update, { new: true, runValidators: true });
      if (!savedOffer) reject('An outcome has already been submitted for this donation.', 409);
    } catch (error) {
      if (createdReport) {
        try {
          await Report.deleteOne({ _id: createdReport._id });
        } catch (cleanupError) {
          console.error('Failed to remove a donation problem report after outcome submission failed.', {
            code: cleanupError.code || cleanupError.name || 'CleanupError'
          });
          throw new Error('The donation outcome failed and its problem report could not be rolled back.');
        }
      }
      throw error;
    }
  }

  res.status(200).json({
    success: true,
    message: body.outcome === 'Problem'
      ? 'Your concern was recorded and sent to the administrator review queue.'
      : 'Your donation outcome was recorded.',
    data: {
      outcome: savedOffer.completion.requesterOutcome,
      recordedAt: savedOffer.completion.requesterOutcomeAt
    }
  });
}));

router.put('/:id/cancel', protect, restrictTo('donor'), validateObjectId, catchAsync(async (req, res) => {
  const offer = await Offer.findById(req.params.id);
  if (!offer) reject('Offer not found.', 404);
  if (String(offer.donor) !== String(req.user.id)) {
    reject('You do not own this offer.', 403);
  }
  if (!['Pending', 'Accepted'].includes(offer.status)) {
    reject('This offer cannot be canceled in its current status.', 400);
  }

  const data = await Offer.findOneAndUpdate(
    { _id: offer._id, status: { $in: ['Pending', 'Accepted'] } },
    { $set: { status: 'Canceled' } },
    { new: true, runValidators: true }
  ).select('-__v');
  if (!data) reject('This offer cannot be canceled in its current status.', 400);
  res.status(200).json({ success: true, message: 'Offer canceled.', data });
}));

router.get('/:id/contact', protect, validateObjectId, catchAsync(async (req, res) => {
  const offer = await Offer.findById(req.params.id)
    .populate('request', 'requester');
  if (!offer || !offer.request) reject('Offer not found.', 404);

  const isDonor = String(offer.donor) === String(req.user.id);
  const isRequester = String(offer.request.requester) === String(req.user.id);
  if (!isDonor && !isRequester) reject('You do not have permission to view this contact.', 403);
  if (offer.status !== 'Accepted') reject('Contact details are available only for accepted offers.', 403);

  const contactId = isDonor ? offer.request.requester : offer.donor;
  if (await Block.exists({
    $or: [
      { blocker: offer.donor, blocked: offer.request.requester },
      { blocker: offer.request.requester, blocked: offer.donor }
    ]
  })) {
    reject('Contact details are unavailable between these accounts.', 403);
  }
  const contact = await User.findById(contactId).select('name phone');
  if (!contact) reject('Contact user not found.', 404);
  res.status(200).json({
    success: true,
    data: { name: contact.name, phone: contact.phone }
  });
}));

module.exports = router;
