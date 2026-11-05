const mongoose = require('mongoose');

const storageReconciliationStateSchema = new mongoose.Schema({
  _id: {
    type: String,
    enum: ['avatars', 'prescriptions', 'identity-documents'],
    required: true
  },
  continuationToken: {
    type: String,
    default: null,
    select: false
  },
  status: {
    type: String,
    enum: ['active', 'failed'],
    default: 'active',
    required: true,
    select: false
  },
  attempts: {
    type: Number,
    min: 0,
    default: 0,
    validate: {
      validator: Number.isSafeInteger,
      message: 'attempts must be a non-negative integer.'
    },
    select: false
  },
  lastErrorCode: {
    type: String,
    enum: [
      null,
      'LIST_FAILED',
      'REFERENCE_CHECK_FAILED',
      'QUEUE_FAILED',
      'CURSOR_UPDATE_FAILED'
    ],
    default: null,
    select: false
  },
  nextAttemptAt: {
    type: Date,
    default: Date.now,
    required: true,
    select: false
  },
  leaseUntil: {
    type: Date,
    default: null,
    select: false
  },
  leaseToken: {
    type: String,
    default: null,
    select: false
  }
}, { timestamps: true });

storageReconciliationStateSchema.index({ leaseUntil: 1 });

module.exports = mongoose.model(
  'StorageReconciliationState',
  storageReconciliationStateSchema
);
