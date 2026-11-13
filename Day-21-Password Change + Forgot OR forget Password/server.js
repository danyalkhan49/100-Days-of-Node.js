require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const User = require('./models/User');
const protect = require('./middleware/protect');

const app = express();
app.use(express.json({ limit: '10kb' }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB!'))
  .catch((err) => console.log('Connection error:', err));

const catchAsync = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const isStr = (v) => typeof v === 'string';  
const makeToken = (user) =>
jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

app.post('/auth/signup', catchAsync(async (req, res) => {
  const { name, email, password } = req.body;

  if (![name, email, password].every(isStr) || password.length < 6) {
    return res.status(400).json({ success: false, error: 'name, email, password (min 6 chars) are required' });
  }
  if (await User.findOne({ email })) {
    return res.status(409).json({ success: false, error: 'Email already registered' });
  }
  const hashed = await bcrypt.hash(password, 10);
  await User.create({ name, email, password: hashed });

  res.status(201).json({ success: true, message: 'Registered' });
}));


app.put('/auth/change-password',protect,catchAsync,async(req,res)=>{
app.put('/auth/change-password', protect, catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (![currentPassword, newPassword].every(isStr) || newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'currentPassword and newPassword (min 6 chars) are required'
    });
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, message: 'New password must be different' });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.passwordChangedAt = Date.now() - 1000;
  await user.save();

  res.status(200).json({ success: true, token: makeToken(user) });
}));
})
