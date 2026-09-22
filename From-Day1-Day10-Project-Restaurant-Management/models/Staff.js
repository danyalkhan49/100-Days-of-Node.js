const mongoose = require("mongoose");

const StaffSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },

    role: {
        type: String,
        enum: ["Waiter", "Chef", "Manager"]
    },

    shift: {
        type: String,
        enum: ["Morning", "Evening", "Night"]
    },

    isActive: {
        type: Boolean,
        default: true
    }
});

const Staff = mongoose.model("Staff", StaffSchema);

module.exports = Staff;

