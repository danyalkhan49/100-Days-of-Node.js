const mongoose = require('mongoose');
const SessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    tokenHash: {
        type: String,
        unique: true
    },
    deviceName: {
        type: String,
        required: true
    },
    userAgent: {
        type: String,
        required: true
    },
    lastUsedAt: {
        type: Date,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true
    }
});

SessionSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

module.exports = mongoose.model('Session', SessionSchema);
