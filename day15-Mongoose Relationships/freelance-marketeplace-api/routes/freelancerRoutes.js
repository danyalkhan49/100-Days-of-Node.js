const express = require('express');
const router = express.Router();
const { body, param} = require('express-validator');
const Freelancer = require('../models/Freelancer');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const handleValidation = require('../utils/handleValidation');

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('A valid email is required'),
    body('hourlyRate')
      .isFloat({ gt: 0 })
      .withMessage('Hourly rate must be a positive number')
      .toFloat(),
    body('skills').optional().isArray().withMessage('Skills must be an array of strings'),
  ],
  handleValidation,
  catchAsync(async (req, res) => {
    // Sirf allowed fields (activeBidsCount client se set nahi hona chahiye)
    const { name, email, skills, hourlyRate } = req.body;
    const freelancer = await Freelancer.create({ name, email, skills, hourlyRate });
    res.status(201).json({ success: true, data: freelancer });
  })
);

router.get(
  '/',
  catchAsync(async (req, res) => {
    const filter = {};
    if (typeof req.query.skills === 'string' && req.query.skills.trim()) {
      filter.skills = req.query.skills.trim();
    }
    const freelancers = await Freelancer.find(filter);
    res.status(200).json({ success: true, data: freelancers });
  })
);

router.get(
  '/:id',
  [param('id').isMongoId().withMessage('A valid freelancer ID is required')],
  handleValidation,
  catchAsync(async (req, res) => {
    const freelancer = await Freelancer.findById(req.params.id);
    if (!freelancer) throw new AppError('Freelancer not found', 404);
    res.status(200).json({ success: true, data: freelancer });
  })
);

module.exports = router;