const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { parseMaxPrescriptionMb } = require('../utils/uploadLimits');

const uploadDirectory = path.resolve(__dirname, '../uploads/prescriptions');
const maxPrescriptionMb = parseMaxPrescriptionMb(process.env.MAX_PRESCRIPTION_MB);
const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

fs.mkdirSync(uploadDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDirectory),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      callback(null, `${crypto.randomBytes(16).toString('hex')}${extension}`);
    }
  }),
  limits: {
    fileSize: maxPrescriptionMb * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return callback(new Error('Only PDF, JPG, JPEG, and PNG prescriptions are allowed.'));
    }
    callback(null, true);
  }
}).single('prescription');

module.exports = (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      const finishErrorResponse = async () => {
        if (req.file && req.file.path) {
          try {
            await fs.promises.unlink(req.file.path);
          } catch (cleanupError) {
            if (cleanupError.code !== 'ENOENT') throw cleanupError;
          }
        }

        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: `Prescription file exceeds the ${maxPrescriptionMb}MB size limit.`
          });
        }
        if (error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            message: 'Unexpected file field. Upload one prescription using the prescription field.'
          });
        }
        return res.status(400).json({
          success: false,
          message: error.message || 'Invalid prescription file.'
        });
      };

      finishErrorResponse().catch(next);
      return;
    }

    next();
  });
};
