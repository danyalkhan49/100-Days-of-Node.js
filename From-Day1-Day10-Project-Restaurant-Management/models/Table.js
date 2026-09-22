
const mongoose = require("mongoose");

const TableSchema = new mongoose.Schema({
    tableNumber: {
        type: Number,
        required: true,
        unique: true
    },

    capacity: {
        type: Number,
        required: true
    },

    status: {
        type: String,
        enum: ["Free", "Occupied", "Reserved"],
        default: "Free"
    }
});

const Table = mongoose.model("Table", TableSchema);

module.exports = Table;
