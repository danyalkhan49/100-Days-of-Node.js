const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  name: {
    type: String,
    trim: true,
    maxlength: 100,
    default: ''
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 254,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    maxlength: 30,
    default: ''
  },
  category: {
    type: String,
    enum: ['Technical Issue', 'Report a User or Request', 'Donation Help', 'Account Problem', 'Other'],
    required: true
  },
  message: {
    type: String,
    trim: true,
    minlength: 10,
    maxlength: 5000,
    required: true
  },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Resolved'],
    default: 'Open',
    required: true
  },
  adminReply: {
    type: String,
    trim: true,
    maxlength: 5000,
    default: ''
  },
  repliedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  repliedAt: {
    type: Date,
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

supportTicketSchema.index({ status: 1, category: 1, createdAt: -1 });
supportTicketSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
