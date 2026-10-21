const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const Feedback = require('../models/Feedback');
const protect = require('../middleware/protect');

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

const feedbackLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 3,
    message: {
        success: false,
        error: "You are sending feedback too fast. Please wait."
    }
});

router.post('/', protect, feedbackLimiter,
    [
        body('message').isString().trim().isLength({ min: 5, max: 300 }).withMessage('Message must be between 5 and 300 characters'),
        body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be a number from 1 to 5')
    ],
    handleValidation,
    async (req, res) => {
        try {
            const { message, rating } = req.body;
            const feedback = new Feedback({
                message,
                rating,
                student: req.user.id
            });

            const savedFeedback = await feedback.save();

            res.status(201).json({
                success: true,
                data: savedFeedback
            });
        } catch (err) {
            res.status(500).json({
                success: false,
                error: 'Failed to submit feedback.'
            });
        }
    }
);

router.get('/', protect, async (req, res) => {
    try {
        const feedback = await Feedback.find({ student: req.user.id });
        res.status(200).json({
            success: true,
            data: feedback
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch feedback.'
        });
    }
});

module.exports = router;