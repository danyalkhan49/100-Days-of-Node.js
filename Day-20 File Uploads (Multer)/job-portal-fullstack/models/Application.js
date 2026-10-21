const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    coverLetter: { type: String, maxlength: 500, default: '' },
    resume: { type: String, required: true },
    status: {
        type: String,
        enum: ['Applied', 'Shortlisted', 'Rejected', 'Hired'],
        default: 'Applied',
    },
    appliedAt: { type: Date, default: Date.now },
});

// One application per jobseeker per job
applicationSchema.index({ job: 1, applicant: 1 }, { unique: true });

module.exports = mongoose.model('Application', applicationSchema);
