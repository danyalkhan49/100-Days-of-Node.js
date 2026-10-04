const express = require('express');
const bcrypt = require('bcrypt');
const { body } = require('express-validator');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const handleValidation = require('../utils/handleValidation');

const router = express.Router();

// server.js mein: app.use('/auth', authRoutes)

// POST /auth/signup
router.post(
    '/signup',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').isEmail().withMessage('A valid email is required'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('address').trim().notEmpty().withMessage('Address is required')
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const { name, email, password, address } = req.body;
        const normalizedEmail = email.toLowerCase();

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            throw new AppError('Email already exists', 400);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await User.create({
            name,
            email: normalizedEmail,
            password: hashedPassword,
            address
        });

        res.status(201).json({
            success: true,
            data: { id: newUser._id, name: newUser.name, email: newUser.email }
        });
    })
);

// POST /auth/login
router.post(
    '/login',
    [
        body('email').isEmail().withMessage('A valid email is required'),
        body('password').notEmpty().withMessage('Password is required')
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const { email, password } = req.body;

        // password model mein select:false hai, isliye yahan explicitly mangwana parta hai
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

        // Email galat ho ya password galat, dono surat mein same message (FR-A4)
        const isMatch = user ? await bcrypt.compare(password, user.password) : false;
        if (!isMatch) {
            throw new AppError('Invalid email or password', 401);
        }

        res.status(200).json({
            success: true,
            data: { id: user._id, name: user.name, email: user.email }
        });
    })
);

module.exports = router;