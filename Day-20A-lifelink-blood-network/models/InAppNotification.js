const mongoose = require('mongoose');

const inAppNotificationSchema = new mongoose.Schema({
  eventKey: {
    type: String,
    required: true,
    maxlength: 180
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 120
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  type: {
    type: String,
    enum: [
      'new-request',
      'offer-submitted',
      'offer-accepted',
      'offer-declined',
      'donation-completed',
      'request-fulfilled',
      'request-canceled',
      'account-update',
      'verification-update',
      'eligibility-reminder',
      'admin-announcement'
    ],
    required: true
  },
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BloodRequest',
    default: null
  },
  offer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Offer',
    default: null
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

inAppNotificationSchema.index({ eventKey: 1, recipient: 1 }, { unique: true });
inAppNotificationSchema.index({ recipient: 1, createdAt: -1 });
inAppNotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('InAppNotification', inAppNotificationSchema);
