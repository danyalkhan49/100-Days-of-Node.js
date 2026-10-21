const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');
const AppError = require('../utils/AppError');

const uploadDirectory = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const maxSizeMb = Number(process.env.MAX_RESUME_SIZE_MB) || 5;

// Resume files only: PDF / DOC / DOCX
const allowedFileTypes = new Map([
    ['application/pdf', new Set(['.pdf'])],
    ['application/msword', new Set(['.doc'])],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['.docx'])],
]);

const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDirectory),
    filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, `${randomUUID()}${extension}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const validExtensions = allowedFileTypes.get(file.mimetype);
        if (!validExtensions || !validExtensions.has(extension)) {
            return callback(new AppError('Resume must be a PDF, DOC or DOCX file', 400));
        }
        callback(null, true);
    },
});

module.exports = upload;
