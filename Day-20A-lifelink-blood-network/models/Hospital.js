const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], default: 'Point', required: true },
  coordinates: {
    type: [Number],
    required: true,
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length === 2 &&
          Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
          Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
      },
      message: 'location must contain valid longitude and latitude.'
    }
  }
}, { _id: false });

const hospitalSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  city: { type: String, required: true, trim: true, maxlength: 80 },
  address: { type: String, required: true, trim: true, maxlength: 300 },
  contactNumber: { type: String, required: true, trim: true, maxlength: 30 },
  website: { type: String, trim: true, maxlength: 300, default: '' },
  operatingHours: { type: String, trim: true, maxlength: 300, default: '' },
  bloodGroups: {
    type: [{ type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] }],
    default: []
  },
  inventoryVerified: { type: Boolean, default: false },
  inventoryVerifiedAt: { type: Date, default: null },
  verificationStatus: {
    type: String,
    enum: ['Pending', 'Verified', 'Rejected'],
    default: 'Pending'
  },
  isActive: { type: Boolean, default: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  location: { type: pointSchema, default: undefined }
}, { timestamps: true });

hospitalSchema.index({ city: 1, name: 1 });
hospitalSchema.index({ location: '2dsphere' });
hospitalSchema.index({ verificationStatus: 1, inventoryVerified: 1, bloodGroups: 1 });

module.exports = mongoose.model('Hospital', hospitalSchema);
