const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    tableNumber: {
        type: Number,
        required: true
    },

    items: [
        {
            menuItemName: {
                type: String,
                required: true
            },

            quantity: {
                type: Number,
                required: true
            },

            price: {
                type: Number,
                required: true
            }
        }
    ],

    totalAmount: {
        type: Number,
        required: true
    },

    status: {
        type: String,
        enum: ["Pending", "Preparing", "Served", "Paid"],
        default: "Pending"
    },

    waiterAssigned: {
        type: String,
        required: true
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;

