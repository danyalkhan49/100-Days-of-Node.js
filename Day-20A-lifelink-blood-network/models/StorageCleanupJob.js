const mongoose = require('mongoose');

const PURPOSE_PREFIXES = Object.freeze({
  avatars: 'avatars/',
  prescriptions: 'prescriptions/',
  'identity-documents': 'identity-documents/'
});
const KEY_PATTERN = /^(avatars|prescriptions|identity-documents)\/[a-f\d]{64}$/i;

const storageCleanupJobSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    enum: ['r2'],
    required: true
  },
  key: {
    type: String,
    required: true,
    match: KEY_PATTERN
  },
  purpose: {
    type: String,
    enum: Object.keys(PURPOSE_PREFIXES),
    required: true,
    validate: {
      validator(value) {
        return typeof this.key === 'string' &&
          this.key.startsWith(PURPOSE_PREFIXES[value]);
      },
      message: 'Cleanup purpose must match the storage key prefix.'
    }
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    required: true
  },
  attempts: {
    type: Number,
    min: 0,
    default: 0,
    validate: {
      validator: Number.isSafeInteger,
      message: 'attempts must be a non-negative integer.'
    }
  },
  nextAttemptAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  lastAttemptAt: {
    type: Date,
    default: null
  },
  leaseUntil: {
    type: Date,
    default: null
  },
  leaseToken: {
    type: String,
    default: null,
    select: false
  },
  lastErrorCode: {
    type: String,
    enum: [
      null,
      'OBJECT_STILL_REFERENCED',
      'STORAGE_UNAVAILABLE',
      'OBJECT_NOT_FOUND',
      'STORAGE_ERROR',
      'REFERENCE_CHECK_FAILED',
      'WORKER_ERROR'
    ],
    default: null
  }
}, { timestamps: true });

storageCleanupJobSchema.index({ provider: 1, key: 1 }, { unique: true });
storageCleanupJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
storageCleanupJobSchema.index({ status: 1, leaseUntil: 1 });

module.exports = mongoose.model('StorageCleanupJob', storageCleanupJobSchema);
