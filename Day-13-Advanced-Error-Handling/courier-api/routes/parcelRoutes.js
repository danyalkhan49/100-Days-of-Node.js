const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const Parcel = require('../models/Parcel');
const Agent = require('../models/Agent');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
}

router.post(
    '/',
    [
        body('senderName').notEmpty().withMessage('senderName is required'),
        body('receiverName').notEmpty().withMessage('receiverName is required'),
        body('receiverAddress').notEmpty().withMessage('receiverAddress is required'),
        body('weightKg').isFloat({ min: 0.1 }).withMessage('Weight must be a number greater than or equal to 0.1'),
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const maxWeight = Number(process.env.MAX_WEIGHT_KG);

        if (Number(req.body.weightKg) > maxWeight) {
            throw new AppError(
                `Parcel weight exceeds maximum limit of ${maxWeight}kg`,
                400
            );
        }

        const newParcel = new Parcel(req.body);
        await newParcel.save();

        res.status(201).json({
            success: true,
            data: newParcel,
        });
    })
);

router.get(
    '/stats/summary',
    catchAsync(async (req, res) => {
        const [total, delivered, inTransit, pending] = await Promise.all([
            Parcel.countDocuments(),
            Parcel.countDocuments({ status: 'Delivered' }),
            Parcel.countDocuments({ status: 'In Transit' }),
            Parcel.countDocuments({ status: 'Pending' }),
        ]);

        res.status(200).json({
            success: true,
            data: {
                total,
                delivered,
                inTransit,
                pending,
            },
        });
    })
);

router.get(
    '/:id',
    [
        param('id').isMongoId().withMessage('ID is required')
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const getAllParcel = await Parcel.findById(req.params.id);
        if (!getAllParcel) {
            throw new AppError('Parcel not found', 404);
        }
        res.status(200).json({
            success: true,
            data: getAllParcel
        });
    })
);

router.put('/:id/assign-agent',
    [
        param('id').isMongoId().withMessage('ID is required'),
        body('agentName').notEmpty().withMessage('Agent name is required')
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const findParcel = await Parcel.findById(req.params.id);
        const findOne = await Agent.findOne({ name: req.body.agentName });

        if (!findParcel) {
            throw new AppError('Parcel not found', 404);
        } else if (!findOne) {
            throw new AppError('Agent not found', 404);
        } else if (findOne.isAvailable === false) {
            throw new AppError('Agent is currently unavailable', 409);
        }

        findParcel.agentAssigned = findOne.name;
        findParcel.status = 'Picked Up';
        await findParcel.save();

        res.status(200).json({
            success: true,
            data: findParcel
        });
    })
);

router.put('/:id/status',
    [
        param('id').isMongoId().withMessage('ID is required'),
        body('status').isIn(['Pending', 'Picked Up', 'In Transit', 'Delivered'])
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const findAndUpdate = await Parcel.findByIdAndUpdate(
            req.params.id,
            { status: req.body.status },
            { new: true, runValidators: true }
        );

        if (!findAndUpdate) {
            throw new AppError('Parcel not found', 404);
        }

        res.status(200).json({
            success: true,
            data: findAndUpdate
        });
    })
);

module.exports = router;