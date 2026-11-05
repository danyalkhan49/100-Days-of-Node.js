const multer = require('multer');
const AppError = require('../utils/AppError');
const { captureException } = require('../utils/monitoring');
const { logUnexpectedError } = require('../utils/safeErrorLogger');

module.exports = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
    return res.status(400).json({ success: false, error: msg });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON in request body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }

  if (err.code === 11000) {
    return res.status(409).json({ success: false, error: 'Duplicate value: already exists' });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: `Invalid value for ${err.path}` });
  }
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({ msg: e.message }));
    return res.status(400).json({ success: false, errors });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, error: 'Invalid or expired token. Please login again' });
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) captureException(err, req);
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }

  captureException(err, req);
  logUnexpectedError(err, req);
  res.status(500).json({ success: false, error: 'Something went wrong on the server' });
};
