const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

router.post('/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Email is already registered'
            });
        }

        const hashPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashPassword });
        await newUser.save();

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: { id: newUser._id, name: newUser.name, email: newUser.email }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Something went wrong'
        });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const findUser = await User.findOne({ email });
        if (!findUser) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const isMatch = await bcrypt.compare(password, findUser.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const token = jwt.sign(
            { id: findUser._id, name: findUser.name },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({
            success: true,
            message: 'Login successful',
            token
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

module.exports = router;