const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const AppError = require('../AppError');

const PURPOSES = {
  avatar: {
    resourceType: 'image',
    prefix: 'lifelink/avatars'
  },
  prescription: {
    resourceType: 'raw',
    prefix: 'lifelink/prescriptions'
  }
};

function getPurpose(purpose) {
  const config = PURPOSES[purpose];
  if (!config) {
    throw new AppError('Cloudinary storage is not available for this file purpose.', 400);
  }
  return config;
}

function createCloudinaryProvider({
  client = cloudinary,
  isConfigured = () => Boolean(process.env.CLOUDINARY_URL)
} = {}) {
  function assertConfigured() {
    if (!isConfigured()) {
      throw new AppError('Cloudinary storage is not configured.', 503);
    }
  }

  function upload({ buffer, purpose }) {
    assertConfigured();
    const config = getPurpose(purpose);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new AppError('Cloudinary storage requires a non-empty file buffer.', 400);
    }

    const publicId = `${config.prefix}/${crypto.randomBytes(32).toString('hex')}`;
    const options = {
      public_id: publicId,
      resource_type: config.resourceType,
      type: 'authenticated',
      overwrite: false,
      unique_filename: false,
      use_filename: false
    };

    return new Promise((resolve, reject) => {
      let stream;
      try {
        stream = client.uploader.upload_stream(options, (error, result) => {
          if (error) return reject(error);
          if (!result || result.public_id !== publicId) {
            return reject(new Error('Cloudinary returned an unexpected asset identifier.'));
          }
          resolve({
            provider: 'cloudinary',
            publicId: result.public_id,
            resourceType: result.resource_type,
            bytes: result.bytes,
            format: result.format
          });
        });
        stream.end(buffer);
      } catch (error) {
        reject(error);
      }
    });
  }

  function remove({ publicId, purpose }) {
    assertConfigured();
    const config = getPurpose(purpose);
    const expectedPrefix = `${config.prefix}/`;
    if (typeof publicId !== 'string' ||
        !publicId.startsWith(expectedPrefix) ||
        !/^[a-f\d]{64}$/i.test(publicId.slice(expectedPrefix.length))) {
      throw new AppError('Cloudinary asset reference is invalid.', 400);
    }

    return client.uploader.destroy(publicId, {
      resource_type: config.resourceType,
      type: 'authenticated',
      invalidate: true
    });
  }

  return { upload, remove };
}

module.exports = { createCloudinaryProvider };
