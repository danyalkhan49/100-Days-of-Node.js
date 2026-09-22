const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const MenuItem = require("../models/MenuItem");
const Table = require("../models/Table");


// FR-D1, D2, D3, D4: Place Order
router.post("/", async (req, res) => {
    try {
        const { tableNumber, items, waiterAssigned } = req.body;

        // Check table exists
        const table = await Table.findOne({ tableNumber });

        if (!table) {
            return res.status(404).json({
                success: false,
                error: "Table not found"
            });
        }

        // Validate items
        if (!items || items.length === 0) {
            return res.status(400).json({
                success: false,
                error: "Order must contain at least one item"
            });
        }

        const orderItems = [];
        let totalAmount = 0;

        for (const item of items) {
            const menuItem = await MenuItem.findOne({
                name: item.menuItemName
            });

            // Check menu item exists
            if (!menuItem) {
                return res.status(404).json({
                    success: false,
                    error: `Menu item not found: ${item.menuItemName}`
                });
            }

            // Check menu item availability
            if (!menuItem.isAvailable) {
                return res.status(409).json({
                    success: false,
                    error: `Menu item is unavailable: ${item.menuItemName}`
                });
            }

            // Validate quantity
            if (!item.quantity || item.quantity <= 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid quantity for: ${item.menuItemName}`
                });
            }

            // Use CURRENT menu price
            const itemTotal = menuItem.price * item.quantity;

            totalAmount += itemTotal;

            orderItems.push({
                menuItemName: menuItem.name,
                quantity: item.quantity,
                price: menuItem.price
            });
        }

        // Create order
        const newOrder = new Order({
            tableNumber,
            items: orderItems,
            totalAmount,
            waiterAssigned
        });

        const savedOrder = await newOrder.save();

        // Set table as Occupied
        table.status = "Occupied";
        await table.save();

        res.status(201).json({
            success: true,
            data: savedOrder
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// FR-D5: Get All Orders + Optional Status Filter
router.get("/", async (req, res) => {
    try {
        const filter = {};

        if (req.query.status) {
            filter.status = req.query.status;
        }

        const orders = await Order.find(filter);

        res.status(200).json({
            success: true,
            data: orders
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// FR-E1: Summary Statistics
router.get("/stats/summary", async (req, res) => {
    try {
        // Total orders
        const totalOrders = await Order.countDocuments();

        // Revenue from Paid orders
        const revenueResult = await Order.aggregate([
            {
                $match: {
                    status: "Paid"
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: {
                        $sum: "$totalAmount"
                    }
                }
            }
        ]);

        const totalRevenue =
            revenueResult.length > 0
                ? revenueResult[0].totalRevenue
                : 0;

        // Table occupancy
        const occupiedTables = await Table.countDocuments({
            status: "Occupied"
        });

        const freeTables = await Table.countDocuments({
            status: "Free"
        });

        res.status(200).json({
            success: true,
            data: {
                totalOrders,
                totalRevenue,
                occupiedTables,
                freeTables
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// FR-E2: Top 3 Best-Selling Items
router.get("/stats/top-items", async (req, res) => {
    try {
        const topItems = await Order.aggregate([
            {
                $unwind: "$items"
            },
            {
                $group: {
                    _id: "$items.menuItemName",
                    totalQuantity: {
                        $sum: "$items.quantity"
                    }
                }
            },
            {
                $sort: {
                    totalQuantity: -1
                }
            },
            {
                $limit: 3
            }
        ]);

        res.status(200).json({
            success: true,
            data: topItems
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// FR-D6: Get Single Order
router.get("/:id", async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({
                success: false,
                error: "Order not found"
            });
        }

        res.status(200).json({
            success: true,
            data: order
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// FR-D7 + D8: Update Order Status
router.put("/:id/status", async (req, res) => {
    try {
        const { status } = req.body;

        const updatedOrder = await Order.findByIdAndUpdate(
            req.params.id,
            { status },
            {
                new: true,
                runValidators: true
            }
        );

        if (!updatedOrder) {
            return res.status(404).json({
                success: false,
                error: "Order not found"
            });
        }

        // If order is Paid, free the table
        if (status === "Paid") {
            await Table.findOneAndUpdate(
                { tableNumber: updatedOrder.tableNumber },
                { status: "Free" }
            );
        }

        res.status(200).json({
            success: true,
            data: updatedOrder
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// FR-D9: Cancel/Delete Order
router.delete("/:id", async (req, res) => {
    try {
        const deletedOrder = await Order.findByIdAndDelete(
            req.params.id
        );

        if (!deletedOrder) {
            return res.status(404).json({
                success: false,
                error: "Order not found"
            });
        }

        res.status(200).json({
            success: true,
            data: deletedOrder
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


module.exports = router;
