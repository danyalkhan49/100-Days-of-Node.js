const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const handleValidation = require('./middleware/handleValidation');

router.post('/auth/signup',
    [
        body('name').isString().withMessage('Name must be a string'),
        body('email').isEmail().withMessage('Please provide a valid email address').isString().withMessage('Email must be a string'),
        body('password').isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
    ],
    handleValidation,
    async(req , res)=>{
        try{
            const { name, email, password } = req.body;
            const existingUser = await User.findOne({ email });
            if(existingUser){
                return res.status(409).json({
                    success: false,
                    error: 'Email already registered'
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = await User.create({
                name,
                email,
                password: hashedPassword,
                role: 'patient'
            });

            res.status(201).json({
                success: true,
                data:{
                    name: newUser.name,
                    email: newUser.email,
                    role: newUser.role
                }
            });
        }
        catch(err){
            res.status(500).json({
                success: false,
                err: err.message
            });

        }
    
    }

)



const loginRateLimit = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5
});

router.post('/auth/login', loginRateLimit, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        return res.status(200).json({ success: true, token });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});