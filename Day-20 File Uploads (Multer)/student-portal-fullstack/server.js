require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const connectDB = require('./config/db');
const authRoutes = require("./routes/authRoutes");
const userRoutes = require('./routes/userRoutes');

const app = express();

app.use(helmet());
app.use(rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

connectDB();

app.use('/auth', authRoutes);
app.use('/users', userRoutes);

app.use((err, req, res, next) => {
	if (err instanceof multer.MulterError) {
		const message = err.code === 'LIMIT_FILE_SIZE'
			? 'File size limit exceeded'
			: err.message;
		return res.status(400).json({ success: false, error: message });
	}

	const statusCode = err.statusCode || 500;
	return res.status(statusCode).json({
		success: false,
		error: err.message || 'Internal server error',
	});
});
