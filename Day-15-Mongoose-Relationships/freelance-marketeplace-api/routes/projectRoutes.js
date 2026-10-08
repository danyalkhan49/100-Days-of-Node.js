const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const Project = require('../models/Project');
const Client = require('../models/Client');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const handleValidation = require('../utils/handleValidation');

const SORT_FIELDS = ['postedOn', 'budget', 'title', 'status', 'category'];
const STATUSES = ['Open', 'In Progress', 'Completed'];
router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('budget').isFloat().withMessage('Budget must be a number').toFloat(),
    body('postedBy').isMongoId().withMessage('postedBy must be a valid client ID'),
  ],
  handleValidation,
  catchAsync(async (req, res) => {
    const { title, description, category, budget, postedBy } = req.body;

    const minBudget = Number(process.env.MIN_PROJECT_BUDGET);
    if (budget < minBudget) {
      throw new AppError(`Budget must be at least Rs. ${minBudget}`, 400);
    }

    const client = await Client.findById(postedBy);
    if (!client) throw new AppError('Client (postedBy) not found', 404);

    const project = await Project.create({ title, description, category, budget, postedBy });
    res.status(201).json({ success: true, data: project });
  })
);

// GET /projects  (pagination + sorting + search + filters)
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100').toInt(),
    query('sortBy').optional().isIn(SORT_FIELDS).withMessage(`sortBy must be one of: ${SORT_FIELDS.join(', ')}`),
    query('order').optional().isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
    query('status').optional().isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
    query('category').optional().isString(),
    query('search').optional().isString(),
    query('minBudget').optional().isFloat({ min: 0 }).withMessage('minBudget must be a number').toFloat(),
    query('maxBudget').optional().isFloat({ min: 0 }).withMessage('maxBudget must be a number').toFloat(),
  ],
  handleValidation,
  catchAsync(async (req, res) => {
    const { category, status, search, minBudget, maxBudget } = req.query;
    const filter = {};

    if (category) filter.category = category;
    if (status) filter.status = status;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.title = { $regex: escaped, $options: 'i' };
    }
    if (minBudget !== undefined || maxBudget !== undefined) {
      filter.budget = {};
      if (minBudget !== undefined) filter.budget.$gte = minBudget;
      if (maxBudget !== undefined) filter.budget.$lte = maxBudget;
    }

    const page = req.query.page || 1;
    const limit = req.query.limit || 5; // SRS default: 5
    const sortBy = req.query.sortBy || 'postedOn';
    const order = req.query.order || 'desc';

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Project.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: projects,
    });
  })
);

// GET /projects/stats/summary  (/:id se PEHLE declare hona zaroori hai)
router.get(
  '/stats/summary',
  catchAsync(async (req, res) => {
    const [result] = await Project.aggregate([
      {
        $group: {
          _id: null,
          totalProjects: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'Open'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
          averageBudget: { $avg: '$budget' },
        },
      },
      { $project: { _id: 0 } },
    ]);

    res.status(200).json({
      success: true,
      data: result || { totalProjects: 0, open: 0, inProgress: 0, completed: 0, averageBudget: 0 },
    });
  })
);

// GET /projects/:id  (populated)
router.get(
  '/:id',
  [param('id').isMongoId().withMessage('Invalid project ID format')],
  handleValidation,
  catchAsync(async (req, res) => {
    const project = await Project.findById(req.params.id)
      .populate('postedBy', 'name email')
      .populate('assignedFreelancer', 'name email');
    if (!project) throw new AppError('Project not found', 404);
    res.status(200).json({ success: true, data: project });
  })
);

// PUT /projects/:id/complete  (FR-D8)
router.put(
  '/:id/complete',
  [param('id').isMongoId().withMessage('Invalid project ID format')],
  handleValidation,
  catchAsync(async (req, res) => {
    const project = await Project.findById(req.params.id);
    if (!project) throw new AppError('Project not found', 404);
    if (project.status !== 'In Progress') {
      throw new AppError('Only a project that is "In Progress" can be marked as Completed', 409);
    }
    project.status = 'Completed';
    await project.save();
    res.status(200).json({ success: true, data: project });
  })
);

module.exports = router;