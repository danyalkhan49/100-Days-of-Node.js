const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
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
  notificationType: {
    type: String,
    enum: ['new-request', 'offer-accepted', 'donation-completed', 'eligibility-reminder'],
    required: true
  },
  channel: {
    type: String,
    enum: ['email', 'sms', 'whatsapp'],
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
  status: {
    type: String,
    enum: ['Pending', 'Sending', 'Sent', 'Delivered', 'Failed'],
    default: 'Pending'
  },
  messageSubject: {
    type: String,
    maxlength: 200,
    select: false
  },
  messageText: {
    type: String,
    maxlength: 2000,
    select: false
  },
  attempts: {
    type: Number,
    min: 0,
    default: 0
  },
  nextAttemptAt: {
    type: Date,
    default: null
  },
  sendingAt: {
    type: Date,
    default: null
  },
  failureCode: {
    type: String,
    maxlength: 80,
    default: null
  },
  sentAt: {
    type: Date,
    default: null
  },
  deliveredAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

notificationSchema.index({ eventKey: 1, recipient: 1, channel: 1 }, { unique: true });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ status: 1, createdAt: 1 });
notificationSchema.index({ status: 1, nextAttemptAt: 1, sendingAt: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
