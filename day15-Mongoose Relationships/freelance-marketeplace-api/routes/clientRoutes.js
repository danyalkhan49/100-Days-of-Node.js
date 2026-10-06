const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const Client = require('../models/Client');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const handleValidation = require('../utils/handleValidation');


router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('A valid email is required'),
  ],
  handleValidation,
  catchAsync(async (req, res) => {
    const { name, email, company } = req.body;
    const client = await Client.create({ name, email, company });
    res.status(201).json({ success: true, data: client });
  })
);

router.get(
  '/',
  catchAsync(async (req, res) => {
    const clients = await Client.find();
    res.status(200).json({ success: true, data: clients });
  })
);

router.get(
  '/:id',
  [param('id').isMongoId().withMessage('A valid client ID is required')],
  handleValidation,
  catchAsync(async (req, res) => {
    const client = await Client.findById(req.params.id).populate('projects');
    if (!client) throw new AppError('Client not found', 404);
    res.status(200).json({ success: true, data: client });
  })
);

module.exports = router;