const express = require('express');
const { body, param } = require('express-validator');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const handleValidation = require('../utils/handleValidation');

const router = express.Router();

// server.js mein: app.use('/orders', orderRoutes)

const ORDER_STATUSES = ['Placed', 'Preparing', 'Out for Delivery', 'Delivered'];

// POST /orders
router.post(
    '/',
    [
        body('user').isMongoId().withMessage('User must be a valid Mongo ID'),
        body('restaurant').isMongoId().withMessage('Restaurant must be a valid Mongo ID'),
        body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
        body('items.*.menuItem').isMongoId().withMessage('Each menuItem must be a valid Mongo ID'),
        body('items.*.quantity').isInt({ min: 1 }).withMessage('Each quantity must be a positive whole number')
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const { user, restaurant, items } = req.body;

        const existingUser = await User.findById(user);
        if (!existingUser) {
            throw new AppError('User not found', 404);
        }

        const existingRestaurant = await Restaurant.findById(restaurant);
        if (!existingRestaurant) {
            throw new AppError('Restaurant not found', 404);
        }

        // Saare menu items ek hi query mein
        const menuItemIds = items.map((item) => item.menuItem);
        const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });
        const menuItemMap = new Map(menuItems.map((m) => [String(m._id), m]));

        const orderItems = [];
        let subtotal = 0;

        for (const item of items) {
            const menuItem = menuItemMap.get(String(item.menuItem));

            if (!menuItem) {
                throw new AppError('Menu item not found', 404);
            }
            if (String(menuItem.restaurant) !== String(restaurant)) {
                throw new AppError('Item does not belong to this restaurant', 400);
            }
            if (!menuItem.isAvailable) {
                throw new AppError(`${menuItem.name} is currently unavailable`, 400);
            }

            const quantity = Number(item.quantity);
            // Price hamesha DB se, client ka bheja hua price ignore
            subtotal += menuItem.price * quantity;
            orderItems.push({ menuItem: menuItem._id, quantity, price: menuItem.price });
        }

        const minimumOrderAmount = Number(process.env.MIN_ORDER_AMOUNT) || 0;
        if (subtotal < minimumOrderAmount) {
            throw new AppError(`Minimum order amount is Rs. ${minimumOrderAmount}`, 400);
        }

        const deliveryFee = Number(process.env.DELIVERY_FEE) || 0;

        const order = await Order.create({
            user,
            restaurant,
            items: orderItems,
            subtotal,
            deliveryFee,
            totalAmount: subtotal + deliveryFee
        });

        res.status(201).json({
            success: true,
            data: order
        });
    })
);

// GET /orders/:id
router.get(
    '/:id',
    [param('id').isMongoId().withMessage('Invalid order ID')],
    handleValidation,
    catchAsync(async (req, res) => {
        const order = await Order.findById(req.params.id)
            .populate('user', 'name email')
            .populate('restaurant', 'name')
            .populate('items.menuItem', 'name price');

        if (!order) {
            throw new AppError('Order not found', 404);
        }

        res.status(200).json({
            success: true,
            data: order
        });
    })
);

// PUT /orders/:id/status
router.put(
    '/:id/status',
    [
        param('id').isMongoId().withMessage('Invalid order ID'),
        body('status').isIn(ORDER_STATUSES).withMessage(`Status must be one of: ${ORDER_STATUSES.join(', ')}`)
    ],
    handleValidation,
    catchAsync(async (req, res) => {
        const order = await Order.findById(req.params.id);
        if (!order) {
            throw new AppError('Order not found', 404);
        }

        const currentIndex = ORDER_STATUSES.indexOf(order.status);
        const requestedIndex = ORDER_STATUSES.indexOf(req.body.status);

        if (requestedIndex !== currentIndex + 1) {
            const next = ORDER_STATUSES[currentIndex + 1];
            throw new AppError(
                next
                    ? `Invalid status change. "${order.status}" can only move to "${next}"`
                    : `Order is already "${order.status}" and cannot be changed`,
                400
            );
        }

        order.status = req.body.status;
        await order.save();

        res.status(200).json({
            success: true,
            data: order
        });
    })
);

module.exports = router;