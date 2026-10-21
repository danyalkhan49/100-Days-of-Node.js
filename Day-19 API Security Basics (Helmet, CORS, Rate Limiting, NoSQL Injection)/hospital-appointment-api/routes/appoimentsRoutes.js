const express = require('express')
const Appointment = require('../models/Appointment')
const Doctor = require('../models/Doctor')
const { protect } = require('../middleware/authMiddleware')

const router = express.Router()

const requireRole = (...roles) => (req, res, next) => {
	if (!req.user || !roles.includes(String(req.user.role).toLowerCase())) {
		return res.status(403).json({ message: 'Forbidden' })
	}
	next()
}

const handleError = (res, error) => {
	console.error(error)
	return res.status(500).json({ message: 'Server error' })
}

router.post('/', protect, requireRole('patient'), async (req, res) => {
	try {
		const { doctor: doctorId, date, timeSlot, reason } = req.body
		const doctor = await Doctor.findById(doctorId)
		if (!doctor || !doctor.isAvailable) {
			return res.status(404).json({ message: 'Doctor not found or unavailable' })
		}
		if (!Array.isArray(doctor.availableSlots) || !doctor.availableSlots.includes(timeSlot)) {
			return res.status(400).json({ message: 'Time slot is not available' })
		}

		const appointmentDate = new Date(date)
		if (Number.isNaN(appointmentDate.getTime())) {
			return res.status(400).json({ message: 'Invalid appointment date' })
		}
		const dayStart = new Date(appointmentDate)
		dayStart.setHours(0, 0, 0, 0)
		const dayEnd = new Date(dayStart)
		dayEnd.setDate(dayEnd.getDate() + 1)

		const alreadyBooked = await Appointment.exists({
			doctor: doctor._id,
			date: { $gte: dayStart, $lt: dayEnd },
			timeSlot,
			status: { $in: ['Pending', 'Confirmed'] },
		})
		if (alreadyBooked) return res.status(409).json({ message: 'This time slot is already booked' })

		const maxAppointments = Number(process.env.MAX_APPOINTMENTS_PER_DAY)
		const patientAppointments = await Appointment.countDocuments({
			patient: req.user.id,
			date: { $gte: dayStart, $lt: dayEnd },
		})
		if (Number.isFinite(maxAppointments) && maxAppointments > 0 && patientAppointments >= maxAppointments) {
			return res.status(400).json({ message: 'Daily appointment limit reached' })
		}

		const today = new Date()
		today.setHours(0, 0, 0, 0)
		if (dayStart < today) return res.status(400).json({ message: 'Appointment date cannot be in the past' })

		const appointment = await Appointment.create({
			patient: req.user.id,
			doctor: doctor._id,
			date: appointmentDate,
			timeSlot,
			reason,
		})
		return res.status(201).json(appointment)
	} catch (error) {
		return handleError(res, error)
	}
})

router.get('/my', protect, requireRole('patient'), async (req, res) => {
	try {
		const appointments = await Appointment.find({ patient: req.user.id })
			.populate('doctor', 'name specialization')
		return res.json(appointments)
	} catch (error) {
		return handleError(res, error)
	}
})

router.get('/doctor', protect, requireRole('doctor'), async (req, res) => {
	try {
		const doctor = await Doctor.findOne({ user: req.user.id })
		if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' })
		const appointments = await Appointment.find({ doctor: doctor._id })
			.populate('patient', 'name email')
		return res.json(appointments)
	} catch (error) {
		return handleError(res, error)
	}
})

router.get('/', protect, requireRole('admin'), async (req, res) => {
	try {
		const appointments = await Appointment.find()
			.populate('doctor', 'name specialization')
			.populate('patient', 'name email')
		return res.json(appointments)
	} catch (error) {
		return handleError(res, error)
	}
})

const findDoctorAppointment = async (id, userId) => {
	const doctor = await Doctor.findOne({ user: userId })
	if (!doctor) return { error: 'profile' }
	const appointment = await Appointment.findById(id)
	if (!appointment) return { error: 'not-found' }
	if (String(appointment.doctor) !== String(doctor._id)) return { error: 'forbidden' }
	return { appointment }
}

const doctorStatusRoute = (nextStatus, requiredStatus) => async (req, res) => {
	try {
		const result = await findDoctorAppointment(req.params.id, req.user.id)
		if (result.error === 'profile') return res.status(404).json({ message: 'Doctor profile not found' })
		if (result.error === 'not-found') return res.status(404).json({ message: 'Appointment not found' })
		if (result.error === 'forbidden') return res.status(403).json({ message: 'You cannot modify this appointment' })
		if (result.appointment.status !== requiredStatus) {
			return res.status(400).json({ message: `Only ${requiredStatus.toLowerCase()} appointments can be ${nextStatus.toLowerCase()}` })
		}
		result.appointment.status = nextStatus
		await result.appointment.save()
		return res.json(result.appointment)
	} catch (error) {
		return handleError(res, error)
	}
}

router.put('/:id/confirm', protect, requireRole('doctor'), doctorStatusRoute('Confirmed', 'Pending'))
router.put('/:id/complete', protect, requireRole('doctor'), doctorStatusRoute('Completed', 'Confirmed'))

router.put('/:id/cancel', protect, async (req, res) => {
	try {
		const role = String(req.user && req.user.role).toLowerCase()
		if (!['patient', 'admin'].includes(role)) return res.status(403).json({ message: 'Forbidden' })
		const appointment = await Appointment.findById(req.params.id)
		if (!appointment) return res.status(404).json({ message: 'Appointment not found' })
		if (role === 'patient' && String(appointment.patient) !== String(req.user.id)) {
			return res.status(403).json({ message: 'You cannot cancel this appointment' })
		}
		if (['Completed', 'Cancelled'].includes(appointment.status)) {
			return res.status(400).json({ message: 'This appointment cannot be cancelled' })
		}
		appointment.status = 'Cancelled'
		await appointment.save()
		return res.json(appointment)
	} catch (error) {
		return handleError(res, error)
	}
})

module.exports = router