const fs = require('fs');
const path = require('path');
const express = require('express');
const Application = require('../models/Application');
const Job = require('../models/Job');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');
const upload = require('../middleware/upload');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const router = express.Router();
const STATUSES = ['Applied', 'Shortlisted', 'Rejected', 'Hired'];
const removeFile = (filePath) => filePath && fs.unlink(filePath, () => {});

router.use(protect);

// Jobseeker: apply with resume (form field "resume", plus "jobId")
router.post('/', restrictTo('jobseeker'), upload.single('resume'), catchAsync(async (req, res) => {
    try {
        if (!req.file) throw new AppError('A resume file (PDF, DOC or DOCX) is required', 400);

        const job = await Job.findById(req.body.jobId || req.body.job);
        if (!job) throw new AppError('Job not found', 404);
        if (job.status !== 'Open') throw new AppError('This job is closed', 400);
        if (job.deadline && job.deadline < new Date()) throw new AppError('The deadline for this job has passed', 400);

        const dailyLimit = Number(process.env.MAX_APPLICATIONS_PER_DAY) || 0;
        if (dailyLimit > 0) {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const count = await Application.countDocuments({ applicant: req.user._id, appliedAt: { $gte: since } });
            if (count >= dailyLimit) throw new AppError(`You can apply to at most ${dailyLimit} jobs per day`, 429);
        }

        const application = await Application.create({
            job: job._id,
            applicant: req.user._id,
            coverLetter: req.body.coverLetter || '',
            resume: req.file.path,
        });
        res.status(201).json({ success: true, data: application });
    } catch (err) {
        removeFile(req.file && req.file.path);
        if (err.code === 11000) throw new AppError('You have already applied for this job', 409);
        throw err;
    }
}));

// Jobseeker: my applications
router.get('/my', restrictTo('jobseeker'), catchAsync(async (req, res) => {
    const applications = await Application.find({ applicant: req.user._id })
        .populate('job', 'title company location status')
        .sort({ appliedAt: -1 });
    res.json({ success: true, results: applications.length, data: applications });
}));

// Employer: applicants of one of my jobs
router.get('/job/:jobId', restrictTo('employer'), catchAsync(async (req, res) => {
    const job = await Job.findById(req.params.jobId);
    if (!job) throw new AppError('Job not found', 404);
    if (String(job.postedBy) !== String(req.user._id)) throw new AppError('Not the job owner', 403);

    const applications = await Application.find({ job: job._id })
        .populate('applicant', 'name email')
        .sort({ appliedAt: -1 });
    res.json({ success: true, results: applications.length, data: applications });
}));

// Employer: change status
router.put('/:id/status', restrictTo('employer'), catchAsync(async (req, res) => {
    const application = await Application.findById(req.params.id);
    if (!application) throw new AppError('Application not found', 404);

    const job = await Job.findById(application.job);
    if (!job || String(job.postedBy) !== String(req.user._id)) throw new AppError('Not the job owner', 403);

    if (!STATUSES.includes(req.body.status)) {
        throw new AppError(`Status must be one of: ${STATUSES.join(', ')}`, 400);
    }
    application.status = req.body.status;
    await application.save();
    res.json({ success: true, data: application });
}));

// Resume download: applicant, owning employer, or admin
router.get('/:id/resume', catchAsync(async (req, res) => {
    const application = await Application.findById(req.params.id);
    if (!application) throw new AppError('Application not found', 404);

    const job = await Job.findById(application.job);
    const isApplicant = String(application.applicant) === String(req.user._id);
    const isOwner = job && req.user.role === 'employer' && String(job.postedBy) === String(req.user._id);
    if (!isApplicant && !isOwner && req.user.role !== 'admin') {
        throw new AppError('Not allowed to download this resume', 403);
    }

    if (!application.resume || !fs.existsSync(application.resume)) throw new AppError('Resume not found', 404);
    res.download(application.resume, path.basename(application.resume));
}));

// Jobseeker: withdraw own application
router.delete('/:id', restrictTo('jobseeker'), catchAsync(async (req, res) => {
    const application = await Application.findById(req.params.id);
    if (!application) throw new AppError('Application not found', 404);
    if (String(application.applicant) !== String(req.user._id)) {
        throw new AppError('You can only withdraw your own application', 403);
    }
    removeFile(application.resume);
    await application.deleteOne();
    res.json({ success: true, message: 'Application withdrawn' });
}));

module.exports = router;
