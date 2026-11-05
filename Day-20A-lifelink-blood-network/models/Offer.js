const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
    {
        request: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'BloodRequest',
            required: true
        },
        donor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        message: {
            type: String,
            trim: true,
            maxlength: 200
        },
        status: {
            type: String,
            enum: ['Pending', 'Accepted', 'Declined', 'Completed', 'Canceled'],
            default: 'Pending'
        },
        completedAt: {
            type: Date,
            default: null
        },
        completion: {
            donorConfirmedAt: { type: Date, default: null },
            requesterConfirmedAt: { type: Date, default: null },
            donorNote: { type: String, trim: true, maxlength: 300, default: '' },
            requesterNote: { type: String, trim: true, maxlength: 300, default: '' },
            requesterOutcome: {
                type: String,
                enum: ['Confirmed', 'Did Not Happen', 'Problem'],
                default: null
            },
            requesterOutcomeNote: { type: String, trim: true, maxlength: 500, default: '' },
            requesterOutcomeAt: { type: Date, default: null }
        }
    },
    { timestamps: true }
);

offerSchema.index({ request: 1, donor: 1 }, { unique: true });

module.exports = mongoose.model('Offer', offerSchema);