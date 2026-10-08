const express = require("express");
const router = express.Router();
const Staff = require("../models/Staff");


// FR-C1: Add Staff
router.post("/", async (req, res) => {
    try {
        const newStaffMember = new Staff(req.body);

        const savedMember = await newStaffMember.save();

        return res.status(201).json({
            success: true,
            data: savedMember
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-C2: Get All Staff + Optional Role Filter
router.get("/", async (req, res) => {
    try {
        const filter = {};

        if (req.query.role) {
            filter.role = req.query.role;
        }

        const getAllStaff = await Staff.find(filter);

        res.status(200).json({
            success: true,
            data: getAllStaff
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-C3: Update Staff
router.put("/:id", async (req, res) => {
    try {
        const updateStaff = await Staff.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        if (!updateStaff) {
            return res.status(404).json({
                success: false,
                error: "Staff member not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: updateStaff
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-C4: Deactivate Staff
router.put("/:id/deactivate", async (req, res) => {
    try {
        const deactivateStaff = await Staff.findByIdAndUpdate(
            req.params.id,
            {
                isActive: false
            },
            {
                new: true
            }
        );

        if (!deactivateStaff) {
            return res.status(404).json({
                success: false,
                error: "Staff member not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: deactivateStaff
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-C5: Permanently Delete Staff
router.delete("/:id", async (req, res) => {
    try {
        const deleteStaff = await Staff.findByIdAndDelete(req.params.id);

        if (!deleteStaff) {
            return res.status(404).json({
                success: false,
                error: "Staff member not found"
            });
        }

        res.status(200).json({
            success: true,
            data: deleteStaff
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


module.exports = router;

