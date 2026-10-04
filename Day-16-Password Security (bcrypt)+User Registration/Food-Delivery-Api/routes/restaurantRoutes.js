const express = require('express');
const { body, param } = require('express-validator');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const handleValidation = require('../utils/handleValidation');

const router = express.Router();

// server.js mein: app.use('/restaurants', restaurantRoutes)

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// POST /restaurants
router.post(
    '/',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('cuisine').trim().notEmpty().withMessage('Cuisine is required')
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const { name, cuisine } = req.body;

        const restaurant = await Restaurant.create({ name, cuisine });

        res.status(201).json({
            success: true,
            data: restaurant
        });
    })
);

// GET /restaurants?page&limit&sortBy&order&search&cuisine
router.get(
    '/',
    catchAsync(async (req, res) => {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
        const skip = (page - 1) * limit;

        const allowedSortFields = ['name', 'cuisine', 'rating'];
        const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'name';
        const sortOrder = req.query.order === 'desc' ? -1 : 1;

        const filter = {};
        if (req.query.cuisine) {
            filter.cuisine = { $regex: `^${escapeRegex(req.query.cuisine)}$`, $options: 'i' };
        }
        if (req.query.search) {
            filter.name = { $regex: escapeRegex(req.query.search), $options: 'i' };
        }

        const [restaurants, total] = await Promise.all([
            Restaurant.find(filter).sort({ [sortBy]: sortOrder }).skip(skip).limit(limit),
            Restaurant.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            data: restaurants,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
        });
    })
);

// GET /restaurants/:id  (menu items ke sath)
router.get(
    '/:id',
    [param('id').isMongoId().withMessage('Invalid restaurant ID')],
    handleValidation,
    catchAsync(async (req, res) => {
        const restaurant = await Restaurant.findById(req.params.id);
        if (!restaurant) {
            throw new AppError('Restaurant not found', 404);
        }

        // Reverse lookup: restaurant menu IDs store nahi karta, isliye MenuItem se find karte hain
        const menuItems = await MenuItem.find({ restaurant: req.params.id });

        res.status(200).json({
            success: true,
            data: { ...restaurant.toObject(), menuItems }
        });
    })
);

module.exports = router;