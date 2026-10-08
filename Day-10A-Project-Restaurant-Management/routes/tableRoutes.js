const express = require("express");
const router = express.Router();
const Table = require("../models/Table");


// FR-B1: Create Table
router.post("/", async (req, res) => {
    try {
        const addTable = new Table(req.body);

        const savedTable = await addTable.save();

        res.status(201).json({
            success: true,
            data: savedTable
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-B2: Get All Tables + Optional Status Filter
router.get("/", async (req, res) => {
    try {
        const filter = {};

        if (req.query.status) {
            filter.status = req.query.status;
        }

        const tables = await Table.find(filter);

        res.status(200).json({
            success: true,
            data: tables
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-B3: Update Table Status
router.put("/:id", async (req, res) => {
    try {
        const updatedTable = await Table.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        if (!updatedTable) {
            return res.status(404).json({
                success: false,
                error: "Table not found"
            });
        }

        res.status(200).json({
            success: true,
            data: updatedTable
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


// FR-B4: Delete Table
router.delete("/:id", async (req, res) => {
    try {
        const deletedTable = await Table.findByIdAndDelete(req.params.id);

        if (!deletedTable) {
            return res.status(404).json({
                success: false,
                error: "Table not found"
            });
        }

        res.status(200).json({
            success: true,
            data: deletedTable
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


module.exports = router;

