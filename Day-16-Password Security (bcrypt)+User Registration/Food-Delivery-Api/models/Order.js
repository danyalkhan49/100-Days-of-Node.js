const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    menuItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
    },
    price: {
      type: Number,
      required: true,
      min: 0, // order ke waqt ka price snapshot
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true,
  },
  items: {
    type: [orderItemSchema],
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.length > 0,
      message: 'Order must contain at least one item',
    },
  },
  subtotal: {
    type: Number,
    default: 0,
  },
  deliveryFee: {
    type: Number,
    default: () => Number(process.env.DELIVERY_FEE) || 0,
  },
  totalAmount: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['Placed', 'Preparing', 'Out for Delivery', 'Delivered'],
    default: 'Placed',
  },
  placedOn: {
    type: Date,
    default: Date.now,
  },
});

orderSchema.pre('validate', function () {
  this.subtotal = (this.items || []).reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  this.totalAmount = this.subtotal + this.deliveryFee;
});

module.exports = mongoose.model('Order', orderSchema);