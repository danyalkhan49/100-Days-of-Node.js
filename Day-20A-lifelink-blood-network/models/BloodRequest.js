const mongoose = require('mongoose');

const prescriptionStorageSchema = new mongoose.Schema({
    provider: {
        type: String,
        enum: ['r2'],
        required: true
    },
    key: {
        type: String,
        required: true,
        match: /^prescriptions\/[a-f\d]{64}$/
    },
    checksumSha256: {
        type: String,
        required: true,
        match: /^[a-f\d]{64}$/i
    },
    size: {
        type: Number,
        required: true,
        min: 0,
        validate: {
            validator: Number.isSafeInteger,
            message: 'size must be a non-negative integer.'
        }
    }
}, { _id: false });

const bloodRequestSchema = new mongoose.Schema(
    {
        requester: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        patientName: {
            type: String,
            required: true,
            trim: true
        },
        bloodGroup: {
            type: String,
            required: true,
            enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
        },
        unitsNeeded: {
            type: Number,
            required: true,
            min: 1,
            max: 10
        },
        unitsFulfilled: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator(value) {
                    return value <= this.unitsNeeded;
                },
                message: 'Units fulfilled cannot exceed units needed'
            }
        },
        hospital: {
            type: String,
            required: true,
            trim: true
        },
        city: {
            type: String,
            required: true,
            trim: true
        },
        urgency: {
            type: String,
            enum: ['Critical', 'Urgent', 'Normal'],
            default: 'Normal'
        },
        neededBy: {
            type: Date,
            required: true,
            validate: {
                validator(value) {
                    return value > new Date();
                },
                message: 'Needed-by date must be in the future'
            }
        },
        note: {
            type: String,
            trim: true,
            maxlength: 300
        },
        prescription: {
            type: String,
            default: null
        },
        prescriptionStorage: {
            type: prescriptionStorageSchema,
            select: false,
            default: undefined
        },
        status: {
            type: String,
            enum: ['Open', 'Fulfilled', 'Closed'],
            default: 'Open'
        },
        acceptanceSequence: {
            type: Number,
            default: 0,
            min: 0,
            select: false
        }
    },
    { timestamps: true }
);

bloodRequestSchema.index({ city: 1, status: 1, bloodGroup: 1 });
bloodRequestSchema.index({ status: 1, neededBy: 1 });

module.exports = mongoose.model('BloodRequest', bloodRequestSchema);