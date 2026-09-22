const express = require("express");
const router = express.Router();
const MenuItem = require("../models/MenuItem");

// FR-A1: Create Menu Item
router.post("/", async (req, res) => {
    try {
        const newItem = new MenuItem(req.body);

        const savedItem = await newItem.save();

        res.status(201).json({
            success: true,
            data: savedItem
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-A2 + FR-A3: Get All Menu Items + Category Filter
router.get("/", async (req, res) => {
    try {
        const filter = {};

        if (req.query.category) {
            filter.category = req.query.category;
        }

        const menuItems = await MenuItem.find(filter);

        res.status(200).json({
            success: true,
            data: menuItems
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-A4: Get Single Menu Item
router.get("/:id", async (req, res) => {
    try {
        const menuItem = await MenuItem.findById(req.params.id);

        if (!menuItem) {
            return res.status(404).json({
                success: false,
                error: "Menu item not found"
            });
        }

        res.status(200).json({
            success: true,
            data: menuItem
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-A5: Update Menu Item
router.put("/:id", async (req, res) => {
    try {
        const updatedItem = await MenuItem.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        if (!updatedItem) {
            return res.status(404).json({
                success: false,
                error: "Menu item not found"
            });
        }

        res.status(200).json({
            success: true,
            data: updatedItem
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-A7: Toggle Menu Item Availability
router.put("/:id/toggle-availability", async (req, res) => {
    try {
        const menuItem = await MenuItem.findById(req.params.id);

        if (!menuItem) {
            return res.status(404).json({
                success: false,
                error: "Menu item not found"
            });
        }

        menuItem.isAvailable = !menuItem.isAvailable;

        await menuItem.save();

        res.status(200).json({
            success: true,
            data: menuItem
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-A6: Delete Menu Item
router.delete("/:id", async (req, res) => {
    try {
        const deletedItem = await MenuItem.findByIdAndDelete(req.params.id);

        if (!deletedItem) {
            return res.status(404).json({
                success: false,
                error: "Menu item not found"
            });
        }

        res.status(200).json({
            success: true,
            data: deletedItem
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

module.exports = router;

