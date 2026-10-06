const mongoose = require("mongoose");

const agentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    assignedParcels: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model("Agent", agentSchema);