const multer = require('multer');
const AppError = require('../utils/AppError');

const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return callback(new AppError('Only PDF, JPG, JPEG, and PNG identity documents are allowed.', 400));
    }
    callback(null, true);
  }
}).single('identityDocument');

module.exports = (req, res, next) => {
  upload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'Identity document exceeds the 5MB size limit.' });
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ success: false, error: 'Upload one file using the identityDocument field.' });
    }
    next(error);
  });
};
