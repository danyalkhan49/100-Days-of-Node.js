const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', required: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, trim: true, maxlength: 500, default: '' },
  status: {
    type: String,
    enum: ['Pending', 'Published', 'Rejected'],
    default: 'Pending',
    required: true
  },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  adminNote: { type: String, maxlength: 500, default: '' }
}, { timestamps: true });

reviewSchema.index({ offer: 1, reviewer: 1 }, { unique: true });
reviewSchema.index({ reviewee: 1, status: 1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
