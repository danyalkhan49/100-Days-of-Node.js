const mongoose = require('mongoose');

const hospitalAuditLogSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  action: { type: String, enum: ['created', 'updated', 'verified', 'rejected', 'deleted'], required: true }
}, { timestamps: true });

hospitalAuditLogSchema.index({ hospital: 1, createdAt: -1 });
hospitalAuditLogSchema.index({ admin: 1, createdAt: -1 });

module.exports = mongoose.model('HospitalAuditLog', hospitalAuditLogSchema);
