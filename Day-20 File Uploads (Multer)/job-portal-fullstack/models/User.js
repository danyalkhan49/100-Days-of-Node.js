const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 100 },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: { type: String, required: true, select: false },
        role: { type: String, enum: ['jobseeker', 'employer', 'admin'], default: 'jobseeker' },
    },
    { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
