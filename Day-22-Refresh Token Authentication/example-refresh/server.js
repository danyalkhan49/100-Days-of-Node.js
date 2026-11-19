require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const User = require('./models/User');
const RefreshToken = require('./models/RefreshToken');
const protect = require('./middleware/protect');

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());                   

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB!'))
  .catch((err) => console.log('Connection error:', err));

const catchAsync = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const isStr = (v) => typeof v === 'string';

const REFRESH_DAYS = 7;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/auth',
  maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000
};

function signAccessToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.ACCESS_EXPIRES || '15m'
  });
}
async function issueRefreshToken(req, res, userId) {
  const token = crypto.randomBytes(40).toString('hex');

  await RefreshToken.create({
    user: userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000),
    userAgent: req.headers['user-agent']
  });

  res.cookie('refreshToken', token, cookieOptions);
}

app.post('/auth/signup', catchAsync(async (req, res) => {
  const { name, email, password } = req.body;

  if (![name, email, password].every(isStr) || password.length < 6) {
    return res.status(400).json({ success: false, error: 'name, email, password (min 6 chars) are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (await User.findOne({ email: cleanEmail })) {
    return res.status(409).json({ success: false, error: 'Email already registered' });
  }

  await User.create({ name, email: cleanEmail, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ success: true, message: 'Registered' });
}));

app.post('/auth/login', catchAsync(async (req, res) => {
  const { email, password } = req.body;

  if (!isStr(email) || !isStr(password)) {
    return res.status(400).json({ success: false, error: 'email and password required' });
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  const ok = user && (await bcrypt.compare(password, user.password));
  if (!ok) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  await issueRefreshToken(req, res, user._id);           // cookie set
  res.status(200).json({ success: true, accessToken: signAccessToken(user._id) });
}));

app.post('/auth/refresh', catchAsync(async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) {
    return res.status(401).json({ success: false, error: 'No refresh token' });
  }

  const stored = await RefreshToken.findOneAndDelete({ tokenHash: sha256(token) });

  if (!stored || stored.expiresAt < Date.now()) {
    res.clearCookie('refreshToken', { path: '/auth' });
    return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
  }

  const user = await User.findById(stored.user);
  if (!user) {
    res.clearCookie('refreshToken', { path: '/auth' });
    return res.status(401).json({ success: false, error: 'User no longer exists' });
  }

  await issueRefreshToken(req, res, user._id);           // naya refresh token
  res.status(200).json({ success: true, accessToken: signAccessToken(user._id) });
}));

app.post('/auth/logout', catchAsync(async (req, res) => {
  const token = req.cookies.refreshToken;
  if (token) {
    await RefreshToken.deleteOne({ tokenHash: sha256(token) });
  }
  res.clearCookie('refreshToken', { path: '/auth' });
  res.status(200).json({ success: true, message: 'Logged out' });
}));

app.post('/auth/logout-all', protect, catchAsync(async (req, res) => {
  await RefreshToken.deleteMany({ user: req.user.id });
  res.clearCookie('refreshToken', { path: '/auth' });
  res.status(200).json({ success: true, message: 'Logged out from all devices' });
}));

app.get('/users/me', protect, catchAsync(async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.status(200).json({ success: true, data: user });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({ success: false, error: 'Something went wrong' });
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});

