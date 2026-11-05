const mongoose = require('mongoose');

function createStorageMetadataSchema(prefix) {
    return new mongoose.Schema({
        provider: {
            type: String,
            enum: ['r2'],
            required: true
        },
        key: {
            type: String,
            required: true,
            match: new RegExp(`^${prefix}/[a-f\\d]{64}$`)
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
}

const geoPointSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point'
    },
    coordinates: {
        type: [Number],
        required: true,
        validate: {
            validator(value) {
                return Array.isArray(value) && value.length === 2 &&
                    Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
                    Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
            },
            message: 'location must contain valid longitude and latitude coordinates.'
        }
    }
}, { _id: false });

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true
    },
    password: {
        type: String,
        required: true,
        minlength: 8,
        select: false
    },
    passwordResetToken: {
        type: String,
        select: false
    },
    passwordResetExpires: {
        type: Date,
        select: false
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    emailVerifiedAt: {
        type: Date,
        default: null
    },
    emailVerificationMethod: {
        type: String,
        enum: ['email', 'admin'],
        default: null
    },
    emailVerificationToken: {
        type: String,
        select: false
    },
    emailVerificationExpires: {
        type: Date,
        select: false
    },
    phoneVerified: {
        type: Boolean,
        default: false
    },
    identityVerificationStatus: {
        type: String,
        enum: ['NotSubmitted', 'Pending', 'Verified', 'Rejected'],
        default: 'NotSubmitted'
    },
    identityDocument: {
        type: String,
        select: false,
        default: null
    },
    identityDocumentStorage: {
        type: createStorageMetadataSchema('identity-documents'),
        select: false,
        default: undefined
    },
    identityDocumentMimeType: {
        type: String,
        enum: ['application/pdf', 'image/jpeg', 'image/png'],
        select: false,
        default: null
    },
    identityDocumentUploadedAt: {
        type: Date,
        default: null
    },
    identityDocumentConsentAt: {
        type: Date,
        default: null
    },
    identityReviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        select: false,
        default: null
    },
    identityReviewedAt: {
        type: Date,
        select: false,
        default: null
    },
    identityReviewNote: {
        type: String,
        maxlength: 500,
        default: ''
    },
    location: {
        type: geoPointSchema,
        select: false,
        default: undefined
    },
    notificationPreferences: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: false },
        whatsapp: { type: Boolean, default: false },
        reminders: { type: Boolean, default: true }
    },
    lastActiveAt: {
        type: Date,
        select: false
    },
    phoneVerificationHash: {
        type: String,
        select: false
    },
    phoneVerificationExpires: {
        type: Date,
        select: false
    },
    phoneVerificationAttempts: {
        type: Number,
        default: 0,
        select: false
    },
    phoneVerificationSentAt: {
        type: Date,
        select: false
    },
    termsAcceptedAt: {
        type: Date
    },
    termsVersion: {
        type: String
    },
    privacyVersion: {
        type: String
    },
    authVersion: {
        type: Number,
        default: 0,
        min: 0
    },
    requestCreationSequence: {
        type: Number,
        default: 0,
        min: 0,
        select: false
    },
    offerCreationSequence: {
        type: Number,
        default: 0,
        min: 0,
        select: false
    },
    role: {
        type: String,
        enum: ['donor', 'requester', 'admin'],
        default: 'donor'
    },
    phone: {
        type: String,
        required: true,
        trim: true,
        maxlength: 30
    },
    city: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80
    },
    bloodGroup: {
        type: String,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
        required() {
            return this.role === 'donor';
        }
    },
    lastDonationDate: {
        type: Date,
        default: null
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    avatar: {
        type: String,
        default: null
    },
    avatarStorage: {
        type: createStorageMetadataSchema('avatars'),
        select: false,
        default: undefined
    }
}, {
    timestamps: true
});

userSchema.index({ passwordResetToken: 1 }, { unique: true, sparse: true });
userSchema.index({ emailVerificationToken: 1 }, { unique: true, sparse: true });
userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);