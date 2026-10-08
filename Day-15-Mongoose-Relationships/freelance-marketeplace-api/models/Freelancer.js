const mongoose = require('mongoose');

const freelancerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
  },
  skills: {
    type: [String],
    default: [],
  },
  hourlyRate: {
    type: Number,
    required: [true, 'Hourly rate is required'],
    validate: {
      validator: (v) => v > 0,
      message: 'Hourly rate must be a positive number',
    },
  },
  // Limit .env se check hoti hai (bidRoutes), model mein hardcode nahi
  activeBidsCount: {
    type: Number,
    default: 0,
    min: [0, 'Active bids count cannot be negative'],
  },
});

module.exports = mongoose.model('Freelancer', freelancerSchema);