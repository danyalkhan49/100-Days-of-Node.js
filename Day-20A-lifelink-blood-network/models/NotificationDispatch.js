const mongoose = require('mongoose');

const notificationDispatchSchema = new mongoose.Schema({
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BloodRequest',
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['Scheduled', 'Processing', 'Complete'],
    default: 'Scheduled',
    required: true
  },
  cursor: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  nextBatchAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  claimToken: {
    type: String,
    default: null
  },
  leaseExpiresAt: {
    type: Date,
    default: null
  },
  lastFailureCode: {
    type: String,
    maxlength: 80,
    default: null
  }
}, { timestamps: true });

notificationDispatchSchema.index({ status: 1, nextBatchAt: 1, leaseExpiresAt: 1 });

module.exports = mongoose.model('NotificationDispatch', notificationDispatchSchema);
