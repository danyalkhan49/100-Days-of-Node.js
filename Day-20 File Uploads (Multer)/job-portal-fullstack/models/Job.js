const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true },
        company: { type: String, required: true, trim: true },
        location: { type: String, required: true, trim: true },
        jobType: {
            type: String,
            enum: ['Full-time', 'Part-time', 'Internship'],
            default: 'Full-time',
        },
        salary: { type: Number, min: 0 },
        deadline: { type: Date },
        status: { type: String, enum: ['Open', 'Closed'], default: 'Open' },
        postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Job', jobSchema);
