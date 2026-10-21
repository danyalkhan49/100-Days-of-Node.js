require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const connectDB = require('./config/db');
const AppError = require('./utils/AppError');

const authRoutes = require('./routes/authRoutes');
const jobRoutes = require('./routes/jobRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const adminRoutes = require('./routes/adminRoutes');

if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is missing in .env');
    process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors({ origin: process.env.CLIENT_URL || true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, _res, next) => next(new AppError(`Route not found: ${req.originalUrl}`, 404)));

app.use((err, _req, res, _next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message;

    if (err instanceof multer.MulterError) {
        statusCode = 400;
        message = err.code === 'LIMIT_FILE_SIZE' ? 'Resume file is too large' : err.message;
    } else if (err.code === 11000) {
        statusCode = 409;
        message = 'That record already exists';
    } else if (err.name === 'ValidationError') {
        statusCode = 400;
    } else if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid ID or value';
    }

    if (statusCode >= 500) {
        console.error(err);
        message = 'Internal server error';
    }

    res.status(statusCode).json({
        success: false,
        err: message,
        message,
        ...(err.details && { details: err.details }),
    });
});

connectDB()
    .then(() => app.listen(PORT, () => console.log(`Job portal running on http://localhost:${PORT}`)))
    .catch((error) => {
        console.error('Failed to connect to MongoDB:', error.message);
        process.exit(1);
    });
