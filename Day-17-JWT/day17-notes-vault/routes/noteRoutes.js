const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const protect = require('../middleware/protect');

router.post('/', protect, async (req, res) => {
    try {
        const { title, content } = req.body;

        const note = new Note({
            title,
            content,
            owner: req.user.id
        });

        const savedNote = await note.save();

        res.status(201).json({
            success: true,
            data: savedNote
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/', protect, async (req, res) => {
    try {
        const notes = await Note.find({ owner: req.user.id });

        res.status(200).json({
            success: true,
            data: notes
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

router.get('/:id', protect, async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) {
            return res.status(404).json({
                success: false,
                error: 'Note not found'
            });
        }

        if (note.owner.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: "You don't have permission to view this note"
            });
        }

        res.status(200).json({
            success: true,
            data: note
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

router.delete('/:id', protect, async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) {
            return res.status(404).json({
                success: false,
                error: 'Note not found'
            });
        }

        if (note.owner.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: "You don't have permission to delete this note"
            });
        }

        await Note.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: 'Note deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;