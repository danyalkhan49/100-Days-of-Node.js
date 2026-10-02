require('dotenv').config(); 
const express = require('express');
const connectDB = require('./config/db');
const AppError = require('./utils/AppError');

const clientRoutes = require('./routes/clientRoutes');
const freelancerRoutes = require('./routes/freelancerRoutes');
const projectRoutes = require('./routes/projectRoutes');
const bidRoutes = require('./routes/bidRoutes');

const app = express();

app.use(express.json());

app.use('/clients', clientRoutes);
app.use('/freelancers', freelancerRoutes);
app.use('/projects', projectRoutes);
app.use('/bids', bidRoutes);

app.use((req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
});

app.use((err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  } else if (err.code === 11000) {
    statusCode = 409;
    message = `Duplicate value for: ${Object.keys(err.keyValue || {}).join(', ')}`;
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Invalid JSON in request body';
  }

  if (statusCode === 500) {
    console.error('UNEXPECTED ERROR:', err);
    message = 'Internal Server Error';
  }

  res.status(statusCode).json({ success: false, error: message });
});

const PORT = process.env.PORT || 9700;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});