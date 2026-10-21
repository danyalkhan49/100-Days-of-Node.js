const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const handleValidation = require('./middleware/handleValidation');

const protect = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication token required' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secretKey');
        req.user = decoded;
        return next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

router.post(
    '/doctors',
    protect,
    [
        body('userId').isMongoId().withMessage('A valid userId is required')
    ],
    handleValidation,
    async (req, res) => {
        try {
            if (req.user?.role !== 'admin') {
                return res.status(403).json({ message: 'Admin access required' });
            }

            const user = await User.findById(req.body.userId);
            if (!user || user.role !== 'doctor') {
                return res.status(404).json({ message: 'Doctor user not found' });
            }

            const existingDoctor = await Doctor.findOne({ user: user._id });
            if (existingDoctor) {
                return res.status(409).json({ message: 'A doctor profile already exists for this user' });
            }

            const doctor = await Doctor.create({ user: user._id });
            return res.status(201).json(doctor);
        } catch (err) {
            return res.status(500).json({ message: 'Failed to create doctor profile' });
        }
    }
);

router.get('/doctors', async (req, res) => {
    try {
        const filter = {};

        if (req.query.specialization) {
            filter.specialization = req.query.specialization;
        }

        const doctors = await Doctor.find(filter)
            .populate('user', 'name email role')
            .lean();

        return res.status(200).json(doctors);
    } catch (err) {
        return res.status(500).json({ message: 'Failed to fetch doctors' });
    }
});

router.get('/doctors/:id', async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id).populate('user', 'name email role');

        if (!doctor) {
            return res.status(404).json({ message: 'Doctor not found' });
        }

        return res.status(200).json(doctor);
    } catch (err) {
        return res.status(500).json({ message: 'Failed to fetch doctor' });
    }
});

module.exports = router;