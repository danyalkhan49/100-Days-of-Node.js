const mongoose = require('mongoose');

const scheduledTaskSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, maxlength: 100 },
  nextRunAt: { type: Date, required: true, default: Date.now },
  lastRunAt: { type: Date, default: null },
  claimToken: { type: String, default: null },
  leaseExpiresAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('ScheduledTask', scheduledTaskSchema);
