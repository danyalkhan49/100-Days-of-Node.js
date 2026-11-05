const mongoose = require('mongoose');

const identityVerificationAuditLogSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: {
    type: String,
    enum: ['document-downloaded', 'verified', 'rejected'],
    required: true
  },
  note: { type: String, maxlength: 500, default: '' }
}, { timestamps: true });

identityVerificationAuditLogSchema.index({ targetUser: 1, createdAt: -1 });
identityVerificationAuditLogSchema.index({ admin: 1, createdAt: -1 });

module.exports = mongoose.model('IdentityVerificationAuditLog', identityVerificationAuditLogSchema);
