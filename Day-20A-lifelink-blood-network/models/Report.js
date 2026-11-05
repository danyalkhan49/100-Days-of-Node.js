const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reportType: {
    type: String,
    enum: ['user', 'request'],
    required: true
  },
  reportedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  bloodRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BloodRequest',
    default: null
  },
  reason: {
    type: String,
    enum: ['fake-account', 'fraud', 'harassment', 'spam', 'misleading', 'other'],
    required: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  status: {
    type: String,
    enum: ['Pending', 'Under Review', 'Resolved', 'Rejected'],
    default: 'Pending'
  },
  adminNote: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  dedupeKey: {
    type: String,
    required: true,
    unique: true,
    select: false
  }
}, { timestamps: true });

reportSchema.index({ status: 1, reportType: 1, createdAt: -1 });
reportSchema.index({ reportedUser: 1, createdAt: -1 });
reportSchema.index({ bloodRequest: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
