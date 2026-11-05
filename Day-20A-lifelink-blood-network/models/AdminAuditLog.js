const mongoose = require('mongoose');

const auditActions = [
  'password-reset-email',
  'user-deactivated',
  'request-closed',
  'request-deleted',
  'offer-moderated',
  'report-reviewed',
  'review-moderated',
  'verification-decision',
  'identity-document-downloaded',
  'hospital-created',
  'hospital-updated',
  'hospital-removed'
];

const metadataSchema = new mongoose.Schema({
  status: { type: String, maxlength: 40 },
  previousStatus: { type: String, maxlength: 40 },
  verificationMethod: { type: String, enum: ['email', 'admin'] },
  inventoryVerified: Boolean,
  affectedOffers: { type: Number, min: 0 },
  affectedReviews: { type: Number, min: 0 },
  changedFields: [{
    type: String,
    enum: ['name', 'city', 'address', 'contactNumber', 'website', 'operatingHours', 'bloodGroups', 'latitude', 'longitude']
  }]
}, { _id: false, strict: 'throw' });

const adminAuditLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true
  },
  action: {
    type: String,
    enum: auditActions,
    required: true,
    immutable: true
  },
  targetType: {
    type: String,
    enum: ['user', 'request', 'offer', 'report', 'review', 'identity-verification', 'hospital'],
    immutable: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    immutable: true
  },
  requestId: {
    type: String,
    maxlength: 128,
    immutable: true
  },
  metadata: {
    type: metadataSchema,
    immutable: true
  },
  // Retained for compatibility with existing password-reset audit documents.
  targetUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    immutable: true
  },
  deliveryStatus: {
    type: String,
    enum: ['Pending', 'Sent', 'Failed'],
    default() {
      return this.action === 'password-reset-email' ? 'Pending' : undefined;
    }
  }
}, { timestamps: true, strict: true });

adminAuditLogSchema.index({ targetUser: 1, createdAt: -1 });
adminAuditLogSchema.index({ admin: 1, createdAt: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1 });
adminAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
adminAuditLogSchema.index({ requestId: 1 });

function restrictLegacyDeliveryUpdate() {
  const update = this.getUpdate() || {};
  const keys = Object.keys(update);
  const set = update.$set || {};
  const allowedFields = {
    $set: new Set(['deliveryStatus', 'updatedAt']),
    $setOnInsert: new Set(['createdAt'])
  };
  const allowed = Object.keys(set).includes('deliveryStatus') &&
    keys.every((operator) => allowedFields[operator] &&
      Object.keys(update[operator]).every((field) => allowedFields[operator].has(field)));
  if (!allowed) throw new Error('Admin audit records are immutable.');
  this.setQuery({ ...this.getQuery(), action: 'password-reset-email' });
}

adminAuditLogSchema.pre('save', function rejectAuditMutation() {
  if (this.isNew) return;
  const allowedPaths = new Set(['deliveryStatus', 'updatedAt']);
  const modified = this.modifiedPaths();
  if (this.action === 'password-reset-email' &&
      modified.every((field) => allowedPaths.has(field))) return;
  throw new Error('Admin audit records are immutable.');
});

adminAuditLogSchema.pre('updateOne', restrictLegacyDeliveryUpdate);
adminAuditLogSchema.pre('updateMany', restrictLegacyDeliveryUpdate);
adminAuditLogSchema.pre('findOneAndUpdate', restrictLegacyDeliveryUpdate);
for (const operation of ['replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  adminAuditLogSchema.pre(operation, function rejectAuditDeletion() {
    throw new Error('Admin audit records cannot be changed or deleted.');
  });
}

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
