const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({

    title: {
        type: String,
        required: true
    },

    company: {
        type: String,
        required: true
    },

    location: {
        type: String,
        required: true
    },

    jobType: {
        type: String,
        required: true,
        enum: ["Full-time", "Part-time", "Internship"]
    },

    salary: {
        type: Number,
        required: true
    },

    postedOn: {
        type: Date,
        default: Date.now
    }

});

module.exports = mongoose.model("Job", jobSchema);