const BloodRequest = require('../models/BloodRequest');
const Offer = require('../models/Offer');
const { withRequiredTransaction } = require('./requiredTransaction');

const BATCH_SIZE = 500;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function expireRequests(now = new Date()) {
  let closedCount = 0;

  while (true) {
    const expiredRequests = await BloodRequest.find({
      status: 'Open',
      neededBy: { $lt: now }
    })
      .select('_id')
      .sort({ neededBy: 1 })
      .limit(BATCH_SIZE)
      .lean();
    if (expiredRequests.length === 0) return closedCount;

    const requestIds = expiredRequests.map((request) => request._id);
    const modifiedCount = await withRequiredTransaction(async (session) => {
      const expiredFilter = {
        _id: { $in: requestIds },
        status: 'Open',
        neededBy: { $lt: now }
      };
      const canceledOffers = await Offer.updateMany(
        { request: { $in: requestIds }, status: { $in: ['Pending', 'Accepted'] } },
        { $set: { status: 'Canceled' } },
        { session }
      );
      if (canceledOffers.acknowledged === false) {
        throw new Error('Pending and accepted offers for expired requests could not be canceled.');
      }

      const closedRequests = await BloodRequest.updateMany(
        expiredFilter,
        { $set: { status: 'Closed' } },
        { session }
      );
      if (closedRequests.acknowledged === false) {
        throw new Error('Expired requests could not be closed.');
      }
      return closedRequests.modifiedCount;
    });
    closedCount += modifiedCount;
    if (expiredRequests.length < BATCH_SIZE) return closedCount;
  }
}

function startRequestExpiryCleanup({
  expire = expireRequests,
  intervalMs = CLEANUP_INTERVAL_MS,
  setTimer = setInterval,
  clearTimer = clearInterval,
  logger = console
} = {}) {
  let running = false;
  let activeCleanup = Promise.resolve();
  const cleanup = async () => {
    if (running) return;
    running = true;
    activeCleanup = (async () => {
      try {
        const count = await expire();
        if (count > 0 && logger && typeof logger.info === 'function') {
          logger.info(`Closed ${count} expired blood request(s).`);
        }
      } catch (error) {
        if (logger && typeof logger.error === 'function') {
          logger.error('Scheduled request expiry cleanup failed.', error);
        }
      } finally {
        running = false;
      }
    })();
    await activeCleanup;
  };

  void cleanup();
  const timer = setTimer(cleanup, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return async () => {
    clearTimer(timer);
    await activeCleanup;
  };
}

module.exports = { expireRequests, startRequestExpiryCleanup };
