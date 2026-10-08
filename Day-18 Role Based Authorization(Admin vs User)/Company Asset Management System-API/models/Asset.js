const mongoose = require('mongoose');
const assetSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
      unique: true,
    },
    category: {
      type: String,
      trim: true,
      required: true,
    },
    status: {
      type: String,
      enum: ['Available', 'Requested', 'Assigned'],
      default: 'Available',
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Asset', assetSchema);