const express = require('express');
const { body, query } = require('express-validator');
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const handleValidation = require('../utils/handleValidation');

const router = express.Router();

// server.js mein: app.use('/menu', menuRoutes)

// POST /menu
router.post(
    '/',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('price').isFloat({ gt: 0 }).withMessage('Price must be positive'),
        body('restaurant').isMongoId().withMessage('Restaurant must be a valid Mongo ID'),
        body('isAvailable').optional().isBoolean().withMessage('isAvailable must be true or false')
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const { name, price, restaurant, isAvailable } = req.body;

        const existingRestaurant = await Restaurant.findById(restaurant);
        if (!existingRestaurant) {
            throw new AppError('Restaurant not found', 404);
        }

        const menuItem = await MenuItem.create({
            name,
            price: Number(price),
            restaurant,
            ...(isAvailable !== undefined && { isAvailable })
        });

        res.status(201).json({
            success: true,
            data: menuItem
        });
    })
);

// GET /menu?restaurant=:id
router.get(
    '/',
    [query('restaurant').isMongoId().withMessage('Restaurant must be a valid Mongo ID')],
    handleValidation,
    catchAsync(async (req, res) => {
        const menuItems = await MenuItem.find({ restaurant: req.query.restaurant });

        res.status(200).json({
            success: true,
            data: menuItems
        });
    })
);

module.exports = router;