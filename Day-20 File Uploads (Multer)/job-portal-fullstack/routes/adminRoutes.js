const express = require('express');
const User = require('../models/User');
const Job = require('../models/Job');
const Application = require('../models/Application');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const router = express.Router();
router.use(protect, restrictTo('admin'));

router.get('/stats', catchAsync(async (req, res) => {
    const [users, jobseekers, employers, jobs, openJobs, applications] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: 'jobseeker' }),
        User.countDocuments({ role: 'employer' }),
        Job.countDocuments(),
        Job.countDocuments({ status: 'Open' }),
        Application.countDocuments(),
    ]);
    res.json({ success: true, data: { users, jobseekers, employers, jobs, openJobs, applications } });
}));

router.get('/users', catchAsync(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const filter = req.query.role ? { role: req.query.role } : {};

    const [users, total] = await Promise.all([
        User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        User.countDocuments(filter),
    ]);
    res.json({ success: true, data: users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.delete('/users/:id', catchAsync(async (req, res) => {
    if (String(req.params.id) === String(req.user._id)) throw new AppError('You cannot delete your own account', 400);
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError('User not found', 404);

    const jobs = await Job.find({ postedBy: user._id }).select('_id');
    await Application.deleteMany({ $or: [{ applicant: user._id }, { job: { $in: jobs.map((j) => j._id) } }] });
    await Job.deleteMany({ postedBy: user._id });
    await user.deleteOne();
    res.json({ success: true, message: 'User deleted' });
}));

module.exports = router;
