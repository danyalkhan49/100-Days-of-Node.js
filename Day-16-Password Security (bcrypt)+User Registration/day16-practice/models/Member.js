const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    membershipType: {
      type: String,
      enum: ['Basic', 'Premium'],
      default: 'Basic',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Member', memberSchema);