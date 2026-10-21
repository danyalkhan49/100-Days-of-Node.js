const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: errors.array()
        });
    }
    next();
}

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        success: false,
        error: "Too many login attempts. Try again later."
    }
});

router.post('/signup',
    [
        body('name').isString().trim().notEmpty().withMessage('Name required for signup'),
        body('email').isString().isEmail().normalizeEmail().withMessage('Valid email required for signup'),
        body('password').isString().isLength({ min: 6, max: 72 }).withMessage('Password must be between 6 and 72 characters')
    ],
    handleValidation,
    async (req, res) => {
        try {
            const { name, email, password } = req.body;
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    error: 'The email is already registered'
                });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            const user = new User({ name, email, password: hashedPassword });
            await user.save();
            res.status(201).json({
                success: true,
                id: user._id,
                email: user.email
            });
        } catch (err) {
            res.status(500).json({
                success: false,
                error: 'Signup failed. Please try again.'
            });
        }
    }
);

router.post('/login', loginLimiter,
    [
        body('email').isString().isEmail().normalizeEmail().withMessage('Valid email required for login'),
        body('password').isString().notEmpty().withMessage('Password required for login')
    ],
    handleValidation,
    async (req, res) => {
        try {
            const { email, password } = req.body;
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid email or password'
                });
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid email or password'
                });
            }
            const token = jwt.sign(
                { id: user._id },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            return res.status(200).json({
                success: true,
                token
            });
        } catch (err) {
            res.status(500).json({
                success: false,
                error: 'Login failed. Please try again.'
            });
        }
    }
);

module.exports = router;