const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Restaurant name is required'],
    trim: true,
  },
  cuisine: {
    type: String,
    required: [true, 'Cuisine is required'], // e.g. "Fast Food", "Desi", "Chinese"
    trim: true,
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  isOpen: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model('Restaurant', restaurantSchema);