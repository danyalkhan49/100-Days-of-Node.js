const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true,
  },
  // Minimum budget .env (MIN_PROJECT_BUDGET) se projectRoutes mein AppError ke saath check hota hai
  budget: {
    type: Number,
    required: [true, 'Budget is required'],
  },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Completed'],
    default: 'Open',
  },
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'postedBy is required'],
  },
  assignedFreelancer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Freelancer',
    default: null,
  },
  postedOn: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Project', projectSchema);