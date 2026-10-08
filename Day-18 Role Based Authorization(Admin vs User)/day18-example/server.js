require('dotenv').config();

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());

const connectDB = require('./config/db');
const User = require('./models/User');
const protect = require('./middleware/protect');
const restrictTo = require('./middleware/restrictTo');

connectDB();

// ---- Signup (role hamesha "user" — client se nahi liya) ----
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ success: false, error: "Email already registered" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = new User({ name, email, password: hashedPassword });  // role khud "user" ban jayega (default)
  await newUser.save();

  res.status(201).json({ success: true, data: { id: newUser._id, name: newUser.name, role: newUser.role } });
});

// ---- Login (token mein role bhi shamil) ----
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ success: false, error: "Invalid email or password" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ success: false, error: "Invalid email or password" });
  }

  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

  res.status(200).json({ success: true, token, role: user.role });
});

// ---- Route 1: Koi Bhi Logged-In User Access Kar Sakta Hai ----
app.get('/my-profile', protect, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.status(200).json({ success: true, data: user });
});

// ---- Route 2: SIRF Admin Access Kar Sakta Hai ----
app.get('/all-users', protect, restrictTo('admin'), async (req, res) => {
  const users = await User.find().select('-password');
  res.status(200).json({ success: true, data: users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});