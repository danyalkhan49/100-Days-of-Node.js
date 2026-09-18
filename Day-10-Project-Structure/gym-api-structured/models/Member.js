const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  name: String,
  age: Number,
  plan: String,
  monthlyFee: Number,
  isActive: { type: Boolean, default: true },
  joinedOn: { type: Date, default: Date.now }
});

const Member = mongoose.model('Member', memberSchema);

module.exports = Member;