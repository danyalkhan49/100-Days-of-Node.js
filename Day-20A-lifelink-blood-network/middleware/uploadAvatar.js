const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const AppError = require('../utils/AppError');

const avatarDirectory = path.resolve(__dirname, '../public/uploads/avatars');
const configuredLimit = Number(process.env.MAX_AVATAR_MB || 2);
if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1) {
  throw new Error('MAX_AVATAR_MB must be a positive integer.');
}

fs.mkdirSync(avatarDirectory, { recursive: true });

const allowedTypes = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);

module.exports = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, avatarDirectory),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      callback(null, `${crypto.randomBytes(16).toString('hex')}${extension}`);
    }
  }),
  limits: {
    fileSize: configuredLimit * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (allowedTypes.get(extension) !== file.mimetype) {
      return callback(new AppError('Only JPG, PNG, and WEBP image files are allowed.', 400));
    }
    callback(null, true);
  }
});
