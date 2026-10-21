const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const User = require('../models/User');

const router = express.Router();
const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    handler: (req, res) => res.status(429).json({
        success: false,
        error: 'Too many login attempts. Try again later.'
    })
});

function handleValidation(_req, res, next) {
    const errors = validationResult(req)
    if(!errors.isEmpty()){
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
        })
    }
    next();

}

router.post(
    '/signup',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').isEmail().withMessage('Email must be in a valid format'),
        body('password')
            .isString()
            .isLength({ min: 6 })
            .withMessage('Password must be at least 6 characters long')
    ],
    handleValidation,
    async (req, res) => {

        try {
            const { name, email, password } = req.body;
            const existingUser = await User.findOne({ email });

            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    err: 'User already registered'
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const savedUser = await new User({
                name,
                email,
                password: hashedPassword
            }).save();

            return res.status(201).json({ success: true, data: savedUser });
        } catch (err) {
            return res.status(500).json({ success: false, err: err.message });
        }
    }
);


router.post(
    '/login',
    loginLimiter,
    [
        body('email').isEmail().notEmpty().withMessage('email must be required'),
        body('password').notEmpty().withMessage('password must be required , minimum latter is 6')
    ],
    handleValidation,
    async (req, res) => {
        try {
            const { email, password } = req.body;
            const user = await User.findOne({ email });

            if (!user || !(await bcrypt.compare(password, user.password))) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid email or password'
                });
            }

            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
            return res.json({ success: true, token });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
);
module.exports = router;