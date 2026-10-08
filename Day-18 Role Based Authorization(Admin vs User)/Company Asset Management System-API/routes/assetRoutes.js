const express = require('express');
const router = express.Router();
const Asset = require('../models/Asset');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');

router.get('/', protect, async (_req, res) => {
    try {
        const assets = await Asset.find();
        return res.status(200).json({
            success: true,
            data: assets
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            err: 'Failed to retrieve assets'
        });
    }
});

router.post('/', protect, restrictTo('admin'), async (req, res) => {
    try {
        const { name, category, serialNumber, status } = req.body;

        if (!name || !category || !serialNumber) {
            return res.status(400).json({
                success: false,
                err: 'Name, category, and serial number are required'
            });
        }

        const asset = await Asset.create({
            name,
            category,
            serialNumber,
            status: status || 'Available',
            requestedBy: null
        });

        return res.status(201).json({
            success: true,
            data: asset
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            err: err.message
        });
    }
});

router.put('/:id/request', protect, async (req, res) => {
    try {
        const asset = await Asset.findById(req.params.id);

        if (!asset) {
            return res.status(404).json({
                success: false,
                err: 'Asset not found'
            });
        }

        if (asset.status !== 'Available') {
            return res.status(400).json({
                success: false,
                err: 'Asset is not available for request'
            });
        }

        asset.status = 'Requested';
        asset.requestedBy = req.user.id;
        await asset.save();

        return res.status(200).json({
            success: true,
            data: asset
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            err: err.message
        });
    }
});

router.put('/:id/approve', protect, restrictTo('admin'), async (req, res) => {
    try {
        const asset = await Asset.findById(req.params.id);

        if (!asset) {
            return res.status(404).json({
                success: false,
                err: 'Asset not found'
            });
        }

        if (asset.status !== 'Requested') {
            return res.status(400).json({
                success: false,
                err: 'No pending request for this asset'
            });
        }

        asset.status = 'Assigned';
        asset.assignedTo = asset.requestedBy;
        asset.requestedBy = null;
        asset.approvedBy = req.user.id;
        await asset.save();

        return res.status(200).json({
            success: true,
            data: asset
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            err: err.message
        });
    }
});

router.delete('/:id', protect, restrictTo('admin'), async (req, res) => {
    try {
        const asset = await Asset.findByIdAndDelete(req.params.id);

        if (!asset) {
            return res.status(404).json({
                success: false,
                err: 'Asset not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: asset
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            err: err.message
        });
    }
});

module.exports = router;