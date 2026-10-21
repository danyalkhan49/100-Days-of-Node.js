const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const User = require('../models/User');
const protect = require('../middleware/protect');
const handleValidation = require('../middleware/handleValidation');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

const router = express.Router();

const signToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRE || '7d',
    });

const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, role: user.role });

router.post(
    '/signup',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').trim().isEmail().withMessage('Email must be in a valid format'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
        // admin cannot be self-assigned
        body('role').optional().isIn(['jobseeker', 'employer']).withMessage('Role must be jobseeker or employer'),
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const { name, password, role } = req.body;
        const email = req.body.email.toLowerCase();

        if (await User.findOne({ email })) {
            throw new AppError('A user with this email already exists', 409);
        }

        const user = await User.create({
            name,
            email,
            password: await bcrypt.hash(password, 10),
            role: role || 'jobseeker',
        });

        res.status(201).json({
            success: true,
            message: 'New user registered successfully',
            token: signToken(user._id),
            user: publicUser(user),
        });
    })
);

router.post(
    '/login',
    [
        body('email').trim().isEmail().withMessage('Email must be in a valid format'),
        body('password').notEmpty().withMessage('Password is required'),
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const user = await User.findOne({ email: req.body.email.toLowerCase() }).select('+password');
        const isMatch = user ? await bcrypt.compare(req.body.password, user.password) : false;

        if (!isMatch) throw new AppError('Invalid email or password', 401);

        res.status(200).json({ success: true, token: signToken(user._id), user: publicUser(user) });
    })
);

router.get('/me', protect, (req, res) => {
    res.status(200).json({ success: true, user: publicUser(req.user) });
});

module.exports = router;
