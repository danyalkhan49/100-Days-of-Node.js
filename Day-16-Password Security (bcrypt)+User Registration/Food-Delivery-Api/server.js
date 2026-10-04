require('dotenv').config();

const express = require('express');
const connectDB = require('./config/db');
const AppError = require('./utils/AppError');

const authRoutes = require('./routes/authRoutes');
const menuRoutes = require('./routes/menuRoutes');
const restaurantRoutes = require('./routes/restaurantRoutes');
const orderRoutes = require('./routes/orderRoutes');

const app = express();

app.use(express.json());
connectDB();

// SRS ke mutabiq base URL: http://localhost:9900 (koi /api prefix nahi)
app.use('/auth', authRoutes);
app.use('/menu', menuRoutes);
app.use('/restaurants', restaurantRoutes);
app.use('/orders', orderRoutes);

// Ghalat URL ke liye 404
app.use((req, _res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
});

// Global error handler, response hamesha { success: false, error }
app.use((err, _req, res, _next) => {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Something went wrong on our end!';

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err.code === 11000) {
    statusCode = 400;
    message = 'Duplicate value: this record already exists';
  }

  if (statusCode >= 500) {
    console.error(err.stack);
  }

  res.status(statusCode).json({ success: false, error: message });
});

const PORT = process.env.PORT || 9900;
app.listen(PORT, () => {
  console.log(`Food Delivery API running on http://localhost:${PORT}`);
});