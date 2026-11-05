const crypto = require('crypto');

const PURPOSE_NAMES = Object.freeze({
  avatars: 'avatars',
  prescriptions: 'prescriptions',
  'identity-documents': 'identityDocument'
});
const KEY_PATTERN = /^(avatars|prescriptions|identity-documents)\/[a-f\d]{64}$/i;

function cleanupJobId(key) {
  return crypto.createHash('sha256').update(`r2\n${key}`).digest('hex');
}

function validateCleanupTarget({ purpose, key }) {
  if (!Object.prototype.hasOwnProperty.call(PURPOSE_NAMES, purpose) ||
      typeof key !== 'string' ||
      !KEY_PATTERN.test(key) ||
      !key.startsWith(`${purpose}/`)) {
    throw new TypeError('Storage cleanup target is invalid.');
  }
  return { provider: 'r2', purpose, key };
}

async function enqueueStorageCleanupJob(StorageCleanupJob, target, session) {
  if (!StorageCleanupJob || typeof StorageCleanupJob.findOneAndUpdate !== 'function') {
    throw new TypeError('Storage cleanup queue model is required.');
  }
  const validated = validateCleanupTarget(target);
  const now = new Date();
  const id = cleanupJobId(validated.key);
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) options.session = session;
  try {
    return await StorageCleanupJob.findOneAndUpdate(
      { _id: id },
      {
        $setOnInsert: {
          _id: id,
          ...validated,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: now,
          lastAttemptAt: null,
          leaseUntil: null,
          leaseToken: null,
          lastErrorCode: null
        }
      },
      options
    );
  } catch (error) {
    if (error.code !== 11000 || session ||
        typeof StorageCleanupJob.findOne !== 'function') {
      throw error;
    }
    const existing = await StorageCleanupJob.findOne({
      _id: id
    });
    if (!existing) throw error;
    return existing;
  }
}

module.exports = { cleanupJobId, enqueueStorageCleanupJob, validateCleanupTarget };
