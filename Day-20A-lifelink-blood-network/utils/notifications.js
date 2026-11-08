const crypto = require('crypto');
const Block = require('../models/Block');
const BloodRequest = require('../models/BloodRequest');
const Notification = require('../models/Notification');
const NotificationDispatch = require('../models/NotificationDispatch');
const ScheduledTask = require('../models/ScheduledTask');
const User = require('../models/User');
const { getCompatibleDonors, checkDonorEligibility } = require('./bloodCompatibility');
const { sendNotificationEmail } = require('./accountEmail');
const { normalizePakistanPhone, sendPhoneMessage } = require('./phoneProvider');
const { logOperationFailure, safeErrorMetadata } = require('./safeErrorLogger');
const { createInAppNotification, dispatchInAppNotification } = require('./inAppNotifications');

const CRITICAL_BATCH_SIZE = 100;
const CRITICAL_BATCH_DELAY_MS = 30 * 1000;
const CRITICAL_LEASE_MS = 60 * 1000;
const CRITICAL_WORKER_INTERVAL_MS = 5 * 1000;
const NOTIFICATION_RETRY_BATCH_SIZE = 25;
const NOTIFICATION_RETRY_INTERVAL_MS = 5 * 1000;
const NOTIFICATION_SENDING_LEASE_MS = 60 * 1000;
const MAX_NOTIFICATION_ATTEMPTS = 5;
const REMINDER_TASK_NAME = 'eligibility-reminders';
const REMINDER_INTERVAL_MS = 60 * 1000;
const REMINDER_LEASE_MS = 5 * 60 * 1000;
const REMINDER_BATCH_SIZE = 100;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function claimableNotificationFilter(now) {
  const staleSendingAt = new Date(now.getTime() - NOTIFICATION_SENDING_LEASE_MS);
  return {
    $or: [
      { status: 'Pending' },
      {
        status: 'Failed',
        attempts: { $lt: MAX_NOTIFICATION_ATTEMPTS },
        nextAttemptAt: { $ne: null, $lte: now }
      },
      {
        status: 'Sending',
        $or: [
          { sendingAt: { $lte: staleSendingAt } },
          { sendingAt: null },
          { sendingAt: { $exists: false } }
        ],
        $and: [{
          $or: [
            { attempts: { $lt: MAX_NOTIFICATION_ATTEMPTS } },
            { attempts: { $exists: false } }
          ]
        }]
      }
    ]
  };
}

async function claimNotification(additionalFilter = {}) {
  const now = new Date();
  return Notification.findOneAndUpdate(
    { $and: [claimableNotificationFilter(now), additionalFilter] },
    {
      $set: { status: 'Sending', sendingAt: now },
      $inc: { attempts: 1 },
      $unset: { failureCode: 1, nextAttemptAt: 1 }
    },
    { new: true, sort: { createdAt: 1 } }
  ).select('+messageSubject +messageText');
}

async function recordNotificationFailure(record, error, retryable = true) {
  const attempts = record.attempts || 1;
  const safeFailure = safeErrorMetadata(error);
  const nextAttemptAt = retryable && attempts < MAX_NOTIFICATION_ATTEMPTS
    ? new Date(Date.now() + Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** (attempts - 1))))
    : null;
  const update = {
    $set: {
      status: 'Failed',
      sendingAt: null,
      nextAttemptAt,
      failureCode: safeFailure.code || safeFailure.errorType
    }
  };
  if (!nextAttemptAt) update.$unset = { messageSubject: 1, messageText: 1 };
  await Notification.updateOne(
    { _id: record._id, status: 'Sending', sendingAt: record.sendingAt },
    update
  );
  logOperationFailure('notification_delivery', error);
}

async function deliverNotificationRecord(record) {
  try {
    if (!record.messageSubject || typeof record.messageText !== 'string') {
      const error = new Error('Stored notification payload is unavailable.');
      error.code = 'MissingNotificationPayload';
      await recordNotificationFailure(record, error, false);
      return;
    }

    const user = await User.findById(record.recipient)
      .select('email emailVerified phone phoneVerified notificationPreferences isActive lastDonationDate')
      .lean();
    const preferences = user && user.notificationPreferences || {};
    const channelEnabled = user && user.isActive !== false &&
      !(record.notificationType === 'eligibility-reminder' && preferences.reminders === false) && (
      record.channel === 'email'
        ? Boolean(user.email && user.emailVerified && preferences.email !== false)
        : record.channel === 'sms'
          ? Boolean(user.phone && user.phoneVerified && preferences.sms === true && process.env.SMS_PROVIDER === 'twilio')
          : Boolean(user.phone && user.phoneVerified && preferences.whatsapp === true && process.env.SMS_PROVIDER === 'twilio-whatsapp')
    );
    if (!channelEnabled) {
      const error = new Error('Recipient is no longer eligible for this notification channel.');
      error.code = 'NotificationChannelUnavailable';
      await recordNotificationFailure(record, error, false);
      return;
    }
    if (record.notificationType === 'new-request') {
      const request = await BloodRequest.findOne({
        _id: record.request,
        status: 'Open',
        neededBy: { $gt: new Date() }
      }).select('_id').lean();
      if (!request) {
        const error = new Error('The blood request is no longer open.');
        error.code = 'RequestNoLongerOpen';
        await recordNotificationFailure(record, error, false);
        return;
      }
    }
    if (record.notificationType === 'eligibility-reminder' &&
        !checkDonorEligibility(user.lastDonationDate).eligible) {
      const error = new Error('The donor is no longer eligible for a reminder.');
      error.code = 'ReminderNoLongerApplicable';
      await recordNotificationFailure(record, error, false);
      return;
    }

    if (record.channel === 'email') {
      await sendNotificationEmail(user.email, {
        subject: record.messageSubject,
        text: record.messageText
      });
    } else {
      await sendPhoneMessage(normalizePakistanPhone(user.phone), record.messageText);
    }

    await Notification.updateOne(
      { _id: record._id, status: 'Sending', sendingAt: record.sendingAt },
      {
        $set: { status: 'Sent', sentAt: new Date(), sendingAt: null },
        $unset: { failureCode: 1, nextAttemptAt: 1, messageSubject: 1, messageText: 1 }
      }
    );
  } catch (error) {
    await recordNotificationFailure(record, error);
  }
}

async function processNotificationQueue() {
  const staleSendingAt = new Date(Date.now() - NOTIFICATION_SENDING_LEASE_MS);
  await Notification.updateMany(
    {
      status: 'Sending',
      attempts: { $gte: MAX_NOTIFICATION_ATTEMPTS },
      $or: [
        { sendingAt: { $lte: staleSendingAt } },
        { sendingAt: null },
        { sendingAt: { $exists: false } }
      ]
    },
    {
      $set: {
        status: 'Failed',
        sendingAt: null,
        nextAttemptAt: null,
        failureCode: 'MaxAttemptsExceeded'
      },
      $unset: { messageSubject: 1, messageText: 1 }
    }
  );
  for (let count = 0; count < NOTIFICATION_RETRY_BATCH_SIZE; count += 1) {
    const record = await claimNotification();
    if (!record) return;
    await deliverNotificationRecord(record);
  }
}

async function deliver({ eventKey, user, notificationType, requestId, offerId, subject, text }) {
  const preferences = user.notificationPreferences || {};
  if (notificationType === 'eligibility-reminder' && preferences.reminders === false) return;

  const inboxMessages = {
    'new-request': {
      title: 'A compatible blood request is open',
      message: 'A compatible request is open near you. Sign in to review its details.',
      type: 'new-request'
    },
    'offer-accepted': {
      title: 'Your offer was accepted',
      message: 'Your offer was accepted. Sign in to coordinate the next steps.',
      type: 'offer-accepted'
    },
    'donation-completed': {
      title: 'Donation update',
      message: 'A donation related to your LifeLink account was marked complete.',
      type: 'donation-completed'
    },
    'eligibility-reminder': {
      title: 'Donation eligibility reminder',
      message: 'Based on the donation date you provided, you may now be eligible. Confirm with qualified medical professionals.',
      type: 'eligibility-reminder'
    }
  };
  const inboxMessage = inboxMessages[notificationType];
  if (inboxMessage) {
    dispatchInAppNotification(() => createInAppNotification({
      eventKey: `${eventKey}:${user._id}`,
      recipient: user._id,
      ...inboxMessage,
      request: requestId || null,
      offer: offerId || null
    }), `${notificationType} inbox`);
  }

  const channels = [];
  if (preferences.email !== false && user.emailVerified && user.email) channels.push('email');
  if (preferences.sms === true && user.phoneVerified && process.env.SMS_PROVIDER === 'twilio') channels.push('sms');
  if (preferences.whatsapp === true && user.phoneVerified && process.env.SMS_PROVIDER === 'twilio-whatsapp') {
    channels.push('whatsapp');
  }

  for (const channel of channels) {
    try {
      await Notification.create({
        eventKey,
        recipient: user._id,
        notificationType,
        channel,
        request: requestId || null,
        offer: offerId || null,
        messageSubject: subject,
        messageText: text,
        status: 'Pending'
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const record = await claimNotification({
      eventKey,
      recipient: user._id,
      channel
    });
    if (record) await deliverNotificationRecord(record);
  }
}

function startNotificationRetryWorker() {
  let running = false;
  let activeTick = Promise.resolve();
  const tick = () => {
    if (running) return activeTick;
    running = true;
    activeTick = (async () => {
      try {
        await processNotificationQueue();
      } catch (error) {
        logOperationFailure('notification_retry_worker', error);
      } finally {
        running = false;
      }
    })();
    return activeTick;
  };
  void tick();
  const timer = setInterval(tick, NOTIFICATION_RETRY_INTERVAL_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await activeTick;
  };
}

async function notifyMatchingDonors(request) {
  if (!request || request.urgency === 'Critical') return;
  const compatible = getCompatibleDonors(request.bloodGroup);
  if (!compatible.length) return;
  const minimumDays = Number(process.env.DONATION_GAP_DAYS || 90);
  if (!Number.isFinite(minimumDays) || minimumDays < 0) throw new Error('Invalid DONATION_GAP_DAYS configuration.');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - minimumDays);
  const candidates = await User.find({
    role: 'donor',
    isActive: true,
    isAvailable: true,
    city: request.city,
    bloodGroup: { $in: compatible },
    $or: [
      { lastDonationDate: { $exists: false } },
      { lastDonationDate: null },
      { lastDonationDate: { $lte: cutoff } }
    ]
  }).select('email emailVerified phone phoneVerified notificationPreferences bloodGroup lastDonationDate').lean();
  if (!candidates.length) return;

  const blocked = await Block.find({
    $or: [
      { blocker: request.requester, blocked: { $in: candidates.map((user) => user._id) } },
      { blocked: request.requester, blocker: { $in: candidates.map((user) => user._id) } }
    ]
  }).select('blocker blocked').lean();
  const excluded = new Set(blocked.map((item) =>
    String(item.blocker) === String(request.requester) ? String(item.blocked) : String(item.blocker)
  ));
  const subject = 'A compatible blood request is open near you';
  const text = `A ${request.bloodGroup} blood request in ${request.city} needs donors. Sign in to LifeLink to review the request. Confirm donation eligibility with qualified medical professionals.`;
  for (const donor of candidates) {
    if (excluded.has(String(donor._id)) || !checkDonorEligibility(donor.lastDonationDate).eligible) continue;
    await deliver({
      eventKey: `new-request:${request._id}`,
      user: donor,
      notificationType: 'new-request',
      requestId: request._id,
      subject,
      text
    });
  }
}

async function scheduleCriticalRequest(request) {
  if (!request || !request._id || request.urgency !== 'Critical') return;
  try {
    await NotificationDispatch.create({ request: request._id });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

async function processCriticalBatch() {
  const now = new Date();
  const claimToken = crypto.randomUUID();
  const dispatch = await NotificationDispatch.findOneAndUpdate(
    {
      $or: [
        { status: 'Scheduled', nextBatchAt: { $lte: now } },
        { status: 'Processing', leaseExpiresAt: { $lte: now } }
      ]
    },
    {
      $set: {
        status: 'Processing',
        claimToken,
        leaseExpiresAt: new Date(now.getTime() + CRITICAL_LEASE_MS)
      }
    },
    { new: true, sort: { nextBatchAt: 1, createdAt: 1 } }
  );
  if (!dispatch) return false;

  try {
    const request = await BloodRequest.findOne({
      _id: dispatch.request,
      status: 'Open',
      urgency: 'Critical',
      neededBy: { $gt: now }
    }).select('_id requester bloodGroup city status').lean();
    if (!request) {
      await NotificationDispatch.updateOne(
        { _id: dispatch._id, status: 'Processing', claimToken },
        { $set: { status: 'Complete', claimToken: null, leaseExpiresAt: null } }
      );
      return true;
    }

    const compatible = getCompatibleDonors(request.bloodGroup);
    if (!compatible.length) {
      await NotificationDispatch.updateOne(
        { _id: dispatch._id, status: 'Processing', claimToken },
        { $set: { status: 'Complete', claimToken: null, leaseExpiresAt: null } }
      );
      return true;
    }
    const minimumDays = Number(process.env.DONATION_GAP_DAYS || 90);
    if (!Number.isFinite(minimumDays) || minimumDays < 0) throw new Error('Invalid DONATION_GAP_DAYS configuration.');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - minimumDays);
    const donorFilter = {
      role: 'donor',
      isActive: true,
      isAvailable: true,
      city: request.city,
      bloodGroup: { $in: compatible },
      $or: [
        { lastDonationDate: { $exists: false } },
        { lastDonationDate: null },
        { lastDonationDate: { $lte: cutoff } }
      ]
    };
    if (dispatch.cursor) donorFilter._id = { $gt: dispatch.cursor };
    const candidates = await User.find(donorFilter)
      .select('email emailVerified phone phoneVerified notificationPreferences bloodGroup lastDonationDate')
      .sort({ _id: 1 })
      .limit(CRITICAL_BATCH_SIZE)
      .lean();

    const blocked = candidates.length
      ? await Block.find({
        $or: [
          { blocker: request.requester, blocked: { $in: candidates.map((user) => user._id) } },
          { blocked: request.requester, blocker: { $in: candidates.map((user) => user._id) } }
        ]
      }).select('blocker blocked').lean()
      : [];
    const excluded = new Set(blocked.map((item) =>
      String(item.blocker) === String(request.requester) ? String(item.blocked) : String(item.blocker)
    ));
    const text = `A critical ${request.bloodGroup} blood request in ${request.city} needs donors. Sign in to LifeLink to review the request. Confirm donation eligibility with qualified medical professionals.`;
    for (const donor of candidates) {
      if (excluded.has(String(donor._id)) || !checkDonorEligibility(donor.lastDonationDate).eligible) continue;
      await deliver({
        eventKey: `new-request:${request._id}`,
        user: donor,
        notificationType: 'new-request',
        requestId: request._id,
        subject: 'A critical blood request needs attention',
        text
      });
    }

    const lastCandidate = candidates.length ? candidates[candidates.length - 1]._id : dispatch.cursor;
    const finished = candidates.length < CRITICAL_BATCH_SIZE;
    await NotificationDispatch.updateOne(
      { _id: dispatch._id, status: 'Processing', claimToken },
      {
        $set: {
          status: finished ? 'Complete' : 'Scheduled',
          cursor: lastCandidate,
          nextBatchAt: new Date(Date.now() + CRITICAL_BATCH_DELAY_MS),
          claimToken: null,
          leaseExpiresAt: null,
          lastFailureCode: null
        }
      }
    );
    return true;
  } catch (error) {
    const safeFailure = safeErrorMetadata(error);
    await NotificationDispatch.updateOne(
      { _id: dispatch._id, status: 'Processing', claimToken },
      {
        $set: {
          status: 'Scheduled',
          nextBatchAt: new Date(Date.now() + CRITICAL_BATCH_DELAY_MS),
          claimToken: null,
          leaseExpiresAt: null,
          lastFailureCode: safeFailure.code || safeFailure.errorType
        }
      }
    );
    throw error;
  }
}

function startCriticalNotificationWorker() {
  let running = false;
  let activeTick = Promise.resolve();
  const tick = () => {
    if (running) return activeTick;
    running = true;
    activeTick = (async () => {
      try {
        await processCriticalBatch();
      } catch (error) {
        logOperationFailure('notification_critical_worker', error);
      } finally {
        running = false;
      }
    })();
    return activeTick;
  };
  void tick();
  const timer = setInterval(tick, CRITICAL_WORKER_INTERVAL_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await activeTick;
  };
}

async function notifyEligibleDonors(now = new Date(), lastRunAt = null) {
  const minimumDays = Number(process.env.DONATION_GAP_DAYS || 90);
  if (!Number.isFinite(minimumDays) || minimumDays < 0) throw new Error('Invalid DONATION_GAP_DAYS configuration.');
  const eligibleSince = new Date(now);
  eligibleSince.setDate(eligibleSince.getDate() - minimumDays);
  const previousRun = lastRunAt ? new Date(lastRunAt) : new Date(now.getTime() - ONE_DAY_MS);
  const eligibleAfter = new Date(previousRun);
  eligibleAfter.setDate(eligibleAfter.getDate() - minimumDays);
  const filters = {
    role: 'donor',
    isActive: true,
    lastDonationDate: { $gt: eligibleAfter, $lte: eligibleSince },
    'notificationPreferences.reminders': { $ne: false }
  };
  let cursor = null;
  while (true) {
    if (cursor) filters._id = { $gt: cursor };
    const candidates = await User.find(filters)
      .select('email emailVerified phone phoneVerified notificationPreferences lastDonationDate')
      .sort({ _id: 1 })
      .limit(REMINDER_BATCH_SIZE)
      .lean();
    if (!candidates.length) return;
    for (const donor of candidates) {
      if (!checkDonorEligibility(donor.lastDonationDate).eligible) continue;
      const donationDay = new Date(donor.lastDonationDate).toISOString().slice(0, 10);
      await deliver({
        eventKey: `eligibility-reminder:${donor._id}:${donationDay}`,
        user: donor,
        notificationType: 'eligibility-reminder',
        subject: 'A donation eligibility reminder',
        text: 'Based on the donation date you provided, you may now be eligible to donate again. Confirm your eligibility with qualified medical professionals before donating.'
      });
    }
    cursor = candidates[candidates.length - 1]._id;
    if (candidates.length < REMINDER_BATCH_SIZE) return;
  }
}

async function processEligibilityReminderTask() {
  const now = new Date();
  try {
    await ScheduledTask.updateOne(
      { name: REMINDER_TASK_NAME },
      { $setOnInsert: { nextRunAt: now } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const claimToken = crypto.randomUUID();
  const task = await ScheduledTask.findOneAndUpdate(
    {
      name: REMINDER_TASK_NAME,
      $or: [
        { claimToken: null, nextRunAt: { $lte: now } },
        { leaseExpiresAt: { $lte: now } }
      ]
    },
    { $set: { claimToken, leaseExpiresAt: new Date(now.getTime() + REMINDER_LEASE_MS) } },
    { new: true }
  );
  if (!task) return false;

  try {
    await notifyEligibleDonors(now, task.lastRunAt);
    await ScheduledTask.updateOne(
      { _id: task._id, claimToken },
      {
        $set: {
          nextRunAt: new Date(Date.now() + ONE_DAY_MS),
          lastRunAt: now,
          claimToken: null,
          leaseExpiresAt: null
        }
      }
    );
    return true;
  } catch (error) {
    await ScheduledTask.updateOne(
      { _id: task._id, claimToken },
      {
        $set: {
          nextRunAt: new Date(Date.now() + 5 * 60 * 1000),
          claimToken: null,
          leaseExpiresAt: null
        }
      }
    );
    throw error;
  }
}

function startEligibilityReminderWorker() {
  let running = false;
  let activeTick = Promise.resolve();
  const tick = () => {
    if (running) return activeTick;
    running = true;
    activeTick = (async () => {
      try {
        await processEligibilityReminderTask();
      } catch (error) {
        logOperationFailure('notification_reminder_worker', error);
      } finally {
        running = false;
      }
    })();
    return activeTick;
  };
  void tick();
  const timer = setInterval(tick, REMINDER_INTERVAL_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await activeTick;
  };
}

async function notifyOfferAccepted({ offerId, requestId, donorId, city }) {
  const user = await User.findOne({ _id: donorId, isActive: true })
    .select('email emailVerified phone phoneVerified notificationPreferences')
    .lean();
  if (!user) return;
  await deliver({
    eventKey: `offer-accepted:${offerId}`,
    user,
    notificationType: 'offer-accepted',
    requestId,
    offerId,
    subject: 'Your LifeLink offer was accepted',
    text: `Your offer for a blood request in ${city} was accepted. Sign in to LifeLink to coordinate safely.`
  });
}

async function notifyDonationCompleted({
  offerId,
  requestId,
  donorId,
  requesterId,
  city,
  requestFulfilled = false
}) {
  const users = await User.find({
    _id: { $in: [donorId, requesterId] },
    isActive: true
  }).select('email emailVerified phone phoneVerified notificationPreferences').lean();
  for (const user of users) {
    const isDonor = String(user._id) === String(donorId);
    await deliver({
      eventKey: `donation-completed:${offerId}:${user._id}`,
      user,
      notificationType: 'donation-completed',
      requestId,
      offerId,
      subject: isDonor ? 'Thank you for donating' : 'Donation update',
      text: isDonor
        ? 'Thank you for donating. Please consult qualified healthcare professionals about your next donation eligibility.'
        : `A donation offer for the blood request in ${city} was marked complete.`
    });
  }
  if (requestFulfilled) {
    dispatchInAppNotification(() => createInAppNotification({
      eventKey: `request-fulfilled:${requestId}:${requesterId}`,
      recipient: requesterId,
      title: 'Blood request fulfilled',
      message: 'Your blood request has been fulfilled. Thank you for using LifeLink.',
      type: 'request-fulfilled',
      request: requestId
    }), 'Request fulfillment');
  }
}

function notifyRequestCanceled({ requestId, requesterId, offers }) {
  if (requesterId) {
    dispatchInAppNotification(() => createInAppNotification({
      eventKey: `request-canceled:${requestId}:${requesterId}`,
      recipient: requesterId,
      title: 'Blood request closed',
      message: 'Your blood request has been closed.',
      type: 'request-canceled',
      request: requestId
    }), 'Request closure');
  }
  for (const offer of offers) {
    dispatchInAppNotification(() => createInAppNotification({
      eventKey: `request-canceled:${requestId}:${offer._id}:${offer.donor}`,
      recipient: offer.donor,
      title: 'Blood request closed',
      message: 'A request you offered to help with has been closed. Your offer is no longer active.',
      type: 'request-canceled',
      request: requestId,
      offer: offer._id
    }), 'Request closure');
  }
}

function dispatchNotification(work, _label) {
  Promise.resolve().then(work).catch((error) => {
    logOperationFailure('notification_dispatch', error);
  });
}

module.exports = {
  dispatchNotification,
  notifyMatchingDonors,
  scheduleCriticalRequest,
  startCriticalNotificationWorker,
  startNotificationRetryWorker,
  startEligibilityReminderWorker,
  processCriticalBatch,
  processNotificationQueue,
  processEligibilityReminderTask,
  notifyEligibleDonors,
  notifyOfferAccepted,
  notifyDonationCompleted,
  notifyRequestCanceled
};
