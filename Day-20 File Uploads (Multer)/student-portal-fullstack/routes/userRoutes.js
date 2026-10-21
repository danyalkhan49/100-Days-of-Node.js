const express = require('express');
const router = express.Router();
const User = require('../models/User');
const protect = require('../middleware/protect')
const upload = require('../middleware/upload');

router.get('/users/me', protect, async (req, res) => {
    try {
        const userId = req.user && (req.user._id || req.user.id);
        if (!userId) {
            return res.status(401).json({
                success: false,
                err: 'Unauthorized'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                err: 'User not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: user
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            err: err.message
        });
    }
});

router.post('/users/avatar', protect, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                err: 'Please upload an avatar'
            });
        }

        const userId = req.user && (req.user._id || req.user.id);
        if (!userId) {
            return res.status(401).json({
                success: false,
                err: 'Unauthorized'
            });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { avatar: req.file.path || req.file.filename },
            { new: true, runValidators: true }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                err: 'User not found'
            });
        }

        return res.status(200).json({ success: true, data: user });
    } catch (err) {
        return res.status(500).json({
            success: false,
            err: err.message
        });
    }
});

module.exports = router;