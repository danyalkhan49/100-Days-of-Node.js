const express = require('express');
const Job = require('../models/Job');
const Application = require('../models/Application');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const router = express.Router();

const EDITABLE_FIELDS = ['title', 'description', 'company', 'location', 'jobType', 'salary', 'deadline', 'status'];
const pick = (source, fields) =>
    fields.reduce((acc, f) => (source[f] !== undefined ? { ...acc, [f]: source[f] } : acc), {});

// Public: list + search + filter + sort + pagination
router.get('/', catchAsync(async (req, res) => {
    const { search, location, jobType, minSalary, maxSalary, sort = 'createdAt', order = 'desc' } = req.query;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const filter = {};

    if (search) {
        const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = ['title', 'company', 'location', 'description'].map((field) => ({
            [field]: { $regex: escaped, $options: 'i' },
        }));
    }
    if (location) filter.location = { $regex: String(location).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (jobType) filter.jobType = jobType;
    if (req.query.status) filter.status = req.query.status;

    if (minSalary || maxSalary) {
        filter.salary = {};
        if (minSalary && Number.isFinite(Number(minSalary))) filter.salary.$gte = Number(minSalary);
        if (maxSalary && Number.isFinite(Number(maxSalary))) filter.salary.$lte = Number(maxSalary);
        if (!Object.keys(filter.salary).length) delete filter.salary;
    }

    const sortField = ['createdAt', 'title', 'salary'].includes(sort) ? sort : 'createdAt';
    const sortOrder = String(order).toLowerCase() === 'asc' ? 1 : -1;

    const [jobs, total] = await Promise.all([
        Job.find(filter)
            .sort({ [sortField]: sortOrder })
            .skip((page - 1) * limit)
            .limit(limit),
        Job.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        results: jobs.length,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        data: jobs,
    });
}));

// Employer: own jobs (must be before '/:id')
router.get('/my', protect, restrictTo('employer'), catchAsync(async (req, res) => {
    const jobs = await Job.find({ postedBy: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, results: jobs.length, data: jobs });
}));

router.get('/:id', catchAsync(async (req, res) => {
    const job = await Job.findById(req.params.id);
    if (!job) throw new AppError('Job not found', 404);
    res.status(200).json({ success: true, data: job });
}));

// Employer: create job
router.post('/', protect, restrictTo('employer'), catchAsync(async (req, res) => {
    const required = ['title', 'description', 'company', 'location'];
    const missing = required.find((f) => typeof req.body[f] !== 'string' || !req.body[f].trim());
    if (missing) throw new AppError(`${missing} is required`, 400);

    const data = pick(req.body, EDITABLE_FIELDS);
    delete data.status;
    const job = await Job.create({ ...data, postedBy: req.user._id });
    res.status(201).json({ success: true, message: 'Job created successfully', data: job });
}));

const findOwnedJob = async (req) => {
    const job = await Job.findById(req.params.id);
    if (!job) throw new AppError('Job not found', 404);
    if (String(job.postedBy) !== String(req.user._id)) {
        throw new AppError('Only the employer who posted this job can manage it', 403);
    }
    return job;
};

router.put('/:id/close', protect, restrictTo('employer'), catchAsync(async (req, res) => {
    const job = await findOwnedJob(req);
    job.status = 'Closed';
    await job.save();
    res.status(200).json({ success: true, message: 'Job closed successfully', data: job });
}));

router.put('/:id', protect, restrictTo('employer'), catchAsync(async (req, res) => {
    const job = await findOwnedJob(req);
    Object.assign(job, pick(req.body, EDITABLE_FIELDS));
    await job.save();
    res.status(200).json({ success: true, message: 'Job updated successfully', data: job });
}));

// Owner employer or admin
router.delete('/:id', protect, restrictTo('employer', 'admin'), catchAsync(async (req, res) => {
    const job = await Job.findById(req.params.id);
    if (!job) throw new AppError('Job not found', 404);

    const isOwner = String(job.postedBy) === String(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
        throw new AppError('Only the job owner or an admin can delete this job', 403);
    }

    await Application.deleteMany({ job: job._id });
    await job.deleteOne();
    res.status(200).json({ success: true, message: 'Job deleted successfully' });
}));

module.exports = router;
