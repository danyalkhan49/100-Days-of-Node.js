const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const Bid = require('../models/Bid');
const Project = require('../models/Project');
const Freelancer = require('../models/Freelancer');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const handleValidation = require('../utils/handleValidation');
router.post(
  '/',
  [
    body('projectId').isMongoId().withMessage('A valid projectId is required'),
    body('freelancerId').isMongoId().withMessage('A valid freelancerId is required'),
    body('bidAmount').isFloat({ gt: 0 }).withMessage('Bid amount must be a positive number').toFloat(),
    body('deliveryDays').isFloat({ gt: 0 }).withMessage('Delivery days must be a positive number').toFloat(),
  ],
  handleValidation,
  catchAsync(async (req, res) => {
    const { projectId, freelancerId, bidAmount, deliveryDays } = req.body;

    const project = await Project.findById(projectId);
    if (!project) throw new AppError('Project not found', 404);

    const freelancer = await Freelancer.findById(freelancerId);
    if (!freelancer) throw new AppError('Freelancer not found', 404);
    if (project.status !== 'Open') {
      throw new AppError('Project is not open for bids', 409);
    }
    const maxActiveBids = Number(process.env.MAX_ACTIVE_BIDS_PER_FREELANCER);
    if (freelancer.activeBidsCount >= maxActiveBids) {
      throw new AppError(`Maximum active bids (${maxActiveBids}) reached`, 400);
    }

    const bid = await Bid.create({
      project: project._id,
      freelancer: freelancer._id,
      bidAmount,
      deliveryDays,
    });

    await Freelancer.updateOne({ _id: freelancer._id }, { $inc: { activeBidsCount: 1 } });

    res.status(201).json({ success: true, data: bid });
  })
);
router.get(
  '/project/:projectId',
  [param('projectId').isMongoId().withMessage('Invalid project ID format')],
  handleValidation,
  catchAsync(async (req, res) => {
    const project = await Project.findById(req.params.projectId);
    if (!project) throw new AppError('Project not found', 404);

    const bids = await Bid.find({ project: project._id }).populate('freelancer', 'name email hourlyRate skills');
    res.status(200).json({ success: true, data: bids });
  })
);
router.put(
  '/:id/accept',
  [
    param('id').isMongoId().withMessage('Invalid bid ID format'),
    body('projectId').isMongoId().withMessage('A valid projectId is required'),
  ],
  handleValidation,
  catchAsync(async (req, res) => {
    const bid = await Bid.findById(req.params.id);
    if (!bid) throw new AppError('Bid not found', 404);
    if (bid.project.toString() !== req.body.projectId) {
      throw new AppError('Bid does not belong to the specified project', 400);
    }

    const project = await Project.findById(bid.project);
    if (!project) throw new AppError('Project not found', 404);

    if (project.status !== 'Open') {
      throw new AppError('Project is no longer open', 409);
    }
    if (bid.status !== 'Pending') {
      throw new AppError(`Bid is already ${bid.status}`, 409);
    }
    bid.status = 'Accepted';
    await bid.save();
    project.status = 'In Progress';
    project.assignedFreelancer = bid.freelancer;
    await project.save();

    await Bid.updateMany(
      { project: project._id, status: 'Pending', _id: { $ne: bid._id } },
      { $set: { status: 'Rejected' } }
    );

    await Freelancer.updateOne(
      { _id: bid.freelancer, activeBidsCount: { $gt: 0 } },
      { $inc: { activeBidsCount: -1 } }
    );

    res.status(200).json({ success: true, data: { bid, project } });
  })
);

module.exports = router;