const mongoose = require("mongoose");

const MenuItemSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true
    },

    category: {
        type: String,
        required: true
    },

    price: {
        type: Number,
        required: true
    },

    isAvailable: {
        type: Boolean,
        default: true
    },

    addedOn: {
        type: Date,
        default: Date.now
    }

});

const MenuItem = mongoose.model("MenuItem", MenuItemSchema);

module.exports = MenuItem;