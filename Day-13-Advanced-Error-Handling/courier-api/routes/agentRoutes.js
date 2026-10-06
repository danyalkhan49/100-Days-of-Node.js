const express = require("express");
const { body, validationResult } = require("express-validator");
const Agent = require("../models/Agent");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");

const router = express.Router();

function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
}

router.post(
    "/",
    [
        body("name")
            .notEmpty()
            .withMessage("Name is required"),

        body("phone")
            .notEmpty()
            .withMessage("Phone number is required")
    ],
    handleValidation,

    catchAsync(async (req, res) => {
        const newAgent = new Agent(req.body);
        const savedAgent = await newAgent.save();

        if (!savedAgent) {
            throw new AppError("Agent could not be created", 500);
        }

        res.status(201).json({
            success: true,
            data: savedAgent
        });
    })
);

module.exports = router;