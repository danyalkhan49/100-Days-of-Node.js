const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema({

    title: {
        type: String,
        required: true
    },

    city: {
        type: String,
        required: true
    },

    propertyType: {
        type: String,
        enum: ["House", "Apartment", "Plot"],
        required: true
    },

    price: {
        type: Number,
        required: true
    },

    areaMarla: {
        type: Number,
        required: true
    },

    status: {
        type: String,
        enum: ["Available", "Sold"],
        default: "Available"
    },

    agentAssigned: {
        type: String
    },

    isFeatured: {
        type: Boolean,
        default: false
    },

    postedOn: {
        type: Date,
        default: Date.now
    }

});

module.exports = mongoose.model("Property", propertySchema);