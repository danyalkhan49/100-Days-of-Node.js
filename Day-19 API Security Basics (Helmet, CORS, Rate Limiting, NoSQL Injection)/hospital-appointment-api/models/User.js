const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true
    },
    password: {
        type: String,
        required: true,
        trim: true
    },
    role: {
        type: String,
        enum: ['patient', 'doctor', 'admin'],
        default: 'patient'
    }
});

const doctorSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    specialization: {
        type: String,
        enum: ['Cardiologist', 'Dentist']
    },
    consultationFee: {
        type: Number,
        required: true
    },
    availableSlots: {
        type: [String],
        enum: ['10:00', '11:00', '12:00'],
        default: ['10:00', '11:00', '12:00']
    },
    isAvailable: {
        type: Boolean,
        default: true
    }
});

const appointmentSchema = new mongoose.Schema({
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    doctor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Doctor',
        required: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    timeSlot: {
        type: String,
        enum: ['10:00', '11:00', '12:00'],
        required: true
    },
    reason: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: ['Pending', 'Confirmed', 'Completed', 'Cancelled'],
        default: 'Pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const User = mongoose.model('User', userSchema);
const Doctor = mongoose.model('Doctor', doctorSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);

module.exports = { User, Doctor, Appointment };
