const crypto = require('crypto');
const PURPOSES = Object.freeze(['avatars', 'prescriptions', 'identity-documents']);
const { enqueueStorageCleanupJob } = require('./storageCleanupQueue');
const SAFE_ERROR_CODES = new Set([
  'OBJECT_STILL_REFERENCED',
  'STORAGE_UNAVAILABLE',
  'OBJECT_NOT_FOUND',
  'STORAGE_ERROR',
  'WORKER_ERROR'
]);

function safeErrorCode(error) {
  if (error && (error.name === 'NoSuchKey' || error.name === 'NotFound' ||
      error.$metadata && error.$metadata.httpStatusCode === 404)) {
    return 'OBJECT_NOT_FOUND';
  }
  if (error && error.$metadata && error.$metadata.httpStatusCode >= 500) {
    return 'STORAGE_UNAVAILABLE';
  }
  return 'STORAGE_ERROR';
}

function logSafe(logger, message, fields = {}) {
  if (logger && typeof logger.warn === 'function') logger.warn(message, fields);
}

function createStorageCleanupWorker({
  StorageCleanupJob,
  StorageReconciliationState,
  User,
  BloodRequest,
  getStorage,
  logger = console,
  batchSize = 10,
  leaseMs = 60_000,
  baseDelayMs = 30_000,
  maxDelayMs = 60 * 60 * 1000,
  referenceRetryDelayMs = 60_000,
  maxAttempts = 8,
  reconciliationGraceMs = 24 * 60 * 60 * 1000,
  reconciliationPageSize = 100,
  reconciliationMaxAttempts = maxAttempts
}) {
  if (!StorageCleanupJob || typeof StorageCleanupJob.findOneAndUpdate !== 'function' ||
      typeof StorageCleanupJob.updateOne !== 'function' ||
      !StorageReconciliationState ||
      typeof StorageReconciliationState.findOneAndUpdate !== 'function' ||
      typeof StorageReconciliationState.updateOne !== 'function' ||
      !User || typeof User.exists !== 'function' ||
      !BloodRequest || typeof BloodRequest.exists !== 'function' ||
      typeof getStorage !== 'function') {
    throw new TypeError('Storage cleanup worker dependencies are incomplete.');
  }
  for (const [name, value] of Object.entries({
    batchSize,
    leaseMs,
    baseDelayMs,
    maxDelayMs,
    referenceRetryDelayMs,
    maxAttempts,
    reconciliationPageSize,
    reconciliationMaxAttempts
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }
  if (!Number.isSafeInteger(reconciliationGraceMs) || reconciliationGraceMs < 0) {
    throw new TypeError('reconciliationGraceMs must be a non-negative safe integer.');
  }

  async function hasLiveReference(key) {
    if (await User.exists({ 'avatarStorage.key': key })) return true;
    if (await BloodRequest.exists({ 'prescriptionStorage.key': key })) return true;
    return Boolean(await User.exists({ 'identityDocumentStorage.key': key }));
  }

  const reconciliationBlockedPurposes = new Set();

  async function updateJob(job, update) {
    await StorageCleanupJob.updateOne(
      {
        _id: job._id,
        status: 'processing',
        leaseToken: job.leaseToken
      },
      update
    );
  }

  async function scheduleFailure(job, code, message) {
    const attempts = job.attempts + 1;
    const failed = attempts >= maxAttempts;
    const delay = Math.min(baseDelayMs * (2 ** Math.min(attempts - 1, 30)), maxDelayMs);
    await updateJob(job, {
      $set: {
        status: failed ? 'failed' : 'pending',
        attempts,
        nextAttemptAt: new Date(Date.now() + delay),
        leaseUntil: null,
        leaseToken: null,
        lastErrorCode: code
      }
    });
    logSafe(logger, message, {
      purpose: job.purpose,
      attempts,
      errorCode: code
    });
  }

  async function claimNext(now) {
    const query = StorageCleanupJob.findOneAndUpdate(
      {
        $or: [
          { status: 'pending', nextAttemptAt: { $lte: now } },
          { status: 'processing', leaseUntil: { $lte: now } }
        ]
      },
      {
        $set: {
          status: 'processing',
          lastAttemptAt: now,
          leaseUntil: new Date(now.getTime() + leaseMs),
          leaseToken: crypto.randomUUID()
        }
      },
      { sort: { nextAttemptAt: 1, createdAt: 1 }, new: true }
    );
    if (query && typeof query.select === 'function') query.select('+leaseToken');
    return query;
  }

  async function processJob(job, storage) {
    let referenced;
    try {
      referenced = await hasLiveReference(job.key);
    } catch {
      await scheduleFailure(
        job,
        'REFERENCE_CHECK_FAILED',
        'Storage cleanup reference check failed.'
      );
      return;
    }

    if (referenced) {
      await updateJob(job, {
        $set: {
          status: 'pending',
          nextAttemptAt: new Date(Date.now() + referenceRetryDelayMs),
          leaseUntil: null,
          leaseToken: null,
          lastErrorCode: 'OBJECT_STILL_REFERENCED'
        }
      });
      return;
    }

    try {
      if (await storage.exists({ key: job.key })) {
        await storage.delete({ key: job.key });
      }
      await updateJob(job, {
        $set: {
          status: 'completed',
          leaseUntil: null,
          leaseToken: null,
          lastErrorCode: null
        }
      });
    } catch (error) {
      const code = safeErrorCode(error);
      if (code === 'OBJECT_NOT_FOUND') {
        await updateJob(job, {
          $set: {
            status: 'completed',
            leaseUntil: null,
            leaseToken: null,
            lastErrorCode: null
          }
        });
        return;
      }
      await scheduleFailure(
        job,
        SAFE_ERROR_CODES.has(code) ? code : 'WORKER_ERROR',
        'Storage cleanup attempt failed.'
      );
    }
  }

  async function reconcileOrphans(storage, now) {
    if (typeof storage.list !== 'function') return;
    const olderThan = now.getTime() - reconciliationGraceMs;
    for (const purpose of PURPOSES) {
      if (reconciliationBlockedPurposes.has(purpose)) continue;
      const leaseToken = crypto.randomUUID();
      let state;
      try {
        const query = StorageReconciliationState.findOneAndUpdate(
          {
            _id: purpose,
            status: { $ne: 'failed' },
            $and: [
              {
                $or: [
                  { nextAttemptAt: { $lte: new Date() } },
                  { nextAttemptAt: null },
                  { nextAttemptAt: { $exists: false } }
                ]
              },
              {
                $or: [
                  { leaseUntil: null },
                  { leaseUntil: { $lte: new Date() } },
                  { leaseUntil: { $exists: false } }
                ]
              }
            ]
          },
          {
            $set: {
              status: 'active',
              leaseUntil: new Date(Date.now() + leaseMs),
              leaseToken
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        if (query && typeof query.select === 'function') {
          query.select(
            '+continuationToken +leaseToken +attempts +status +lastErrorCode +nextAttemptAt'
          );
        }
        state = await query;
      } catch (error) {
        if (error.code === 11000) continue;
        throw error;
      }
      if (!state || state.leaseToken !== leaseToken) continue;

      let failureCode = 'LIST_FAILED';
      try {
        const page = await storage.list({
          purpose,
          continuationToken: state.continuationToken || undefined,
          maxKeys: reconciliationPageSize
        });

        for (const object of page.objects) {
          if (!(object.lastModified instanceof Date) ||
              !Number.isFinite(object.lastModified.getTime()) ||
              object.lastModified.getTime() > olderThan) continue;
          failureCode = 'REFERENCE_CHECK_FAILED';
          if (await hasLiveReference(object.key)) continue;
          failureCode = 'QUEUE_FAILED';
          await enqueueStorageCleanupJob(StorageCleanupJob, {
            purpose,
            key: object.key
          });
        }

        failureCode = 'CURSOR_UPDATE_FAILED';
        const result = await StorageReconciliationState.updateOne(
          { _id: purpose, leaseToken },
          {
            $set: {
              continuationToken: page.nextContinuationToken || null,
              status: 'active',
              attempts: 0,
              lastErrorCode: null,
              nextAttemptAt: new Date(),
              leaseUntil: null,
              leaseToken: null
            }
          }
        );
        if (result.matchedCount !== 1) {
          throw new Error('Reconciliation lease was lost before cursor update.');
        }
      } catch (error) {
        const attempts = state.attempts + 1;
        const failed = attempts >= reconciliationMaxAttempts;
        const delay = Math.min(
          baseDelayMs * (2 ** Math.min(attempts - 1, 30)),
          maxDelayMs
        );
        let retryResult;
        try {
          retryResult = await StorageReconciliationState.updateOne(
            { _id: purpose, leaseToken },
            {
              $set: {
                status: failed ? 'failed' : 'active',
                attempts,
                lastErrorCode: failureCode,
                nextAttemptAt: new Date(Date.now() + delay),
                leaseUntil: null,
                leaseToken: null
              }
            }
          );
        } catch {
          reconciliationBlockedPurposes.add(purpose);
          logSafe(logger, 'Storage reconciliation retry state could not be saved.', {
            purpose,
            errorCode: 'RETRY_STATE_WRITE_FAILED'
          });
          throw new Error('Reconciliation retry state could not be saved.');
        }
        if (retryResult.matchedCount !== 1) {
          reconciliationBlockedPurposes.add(purpose);
          logSafe(logger, 'Storage reconciliation retry state could not be saved.', {
            purpose,
            errorCode: 'RETRY_STATE_WRITE_FAILED'
          });
          throw new Error('Reconciliation retry state could not be saved.');
        }
        logSafe(logger, 'Storage reconciliation page failed.', {
          purpose,
          attempts,
          errorCode: failureCode
        });
        throw error;
      }
    }
  }

  async function runOnce() {
    const runtime = getStorage();
    if (!runtime || !runtime.status || !runtime.status.r2 ||
        !runtime.status.r2.available || !runtime.r2Storage) {
      return { processed: 0, available: false };
    }

    const storage = runtime.r2Storage;
    const now = new Date();
    let processed = 0;
    for (; processed < batchSize; processed += 1) {
      const job = await claimNext(new Date());
      if (!job) break;
      await processJob(job, storage);
    }
    await reconcileOrphans(storage, now);
    return { processed, available: true };
  }

  return Object.freeze({ runOnce });
}

let activeWorker;

function startStorageCleanupWorker(options) {
  if (activeWorker) return activeWorker.stop;
  const {
    intervalMs = 60_000,
    logger = console,
    ...workerOptions
  } = options || {};
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new TypeError('intervalMs must be a positive safe integer.');
  }

  const worker = createStorageCleanupWorker({ ...workerOptions, logger });
  let stopped = false;
  let running = false;
  let activeRun = Promise.resolve();
  const run = () => {
    if (stopped || running) return;
    running = true;
    activeRun = worker.runOnce()
      .catch(() => logSafe(logger, 'Storage cleanup worker iteration failed.'))
      .finally(() => {
        running = false;
        activeRun = Promise.resolve();
      });
  };
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    await activeRun;
    if (activeWorker && activeWorker.stop === stop) activeWorker = null;
  };
  activeWorker = { stop };
  return stop;
}

module.exports = { createStorageCleanupWorker, startStorageCleanupWorker };
