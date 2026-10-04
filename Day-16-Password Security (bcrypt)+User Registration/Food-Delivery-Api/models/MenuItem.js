const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Menu item name is required'],
    trim: true,
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    validate: {
      validator: (value) => value > 0, // positive, 0 allowed nahi
      message: 'Price must be a positive number',
    },
  },
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant is required'],
  },
  isAvailable: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model('MenuItem', menuItemSchema);