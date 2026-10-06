const mongoose = require('mongoose');

const parcelSchema = new mongoose.Schema({
    senderName: {
        type: String,
        required: true
    },
    receiverName: {
        type: String,
        required: true
    },
    receiverAddress: {
        type: String,
        required: true
    },
    weightKg: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ["Pending", "Picked Up", "In Transit", "Delivered"],
        default: "Pending"
    },
    agentAssigned: {
        type: String,
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Parcel", parcelSchema);