const fs = require('fs');
const path = require('path');
const AppError = require('./AppError');

const AVATAR_FILENAME_PATTERN = /^[a-f\d]{32}\.(?:jpe?g|png|webp)$/i;
const AVATAR_KEY_PATTERN = /^avatars\/[a-f\d]{64}$/i;
const AVATAR_CONTENT_TYPES = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
});

function safeAvatarPath(directory, filename) {
  if (typeof filename !== 'string' || !AVATAR_FILENAME_PATTERN.test(filename)) return null;
  const resolved = path.resolve(directory, filename);
  const relative = path.relative(directory, resolved);
  if (relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      relative === '') {
    return null;
  }
  return resolved;
}

function safeWarning(logger, message) {
  if (logger && typeof logger.warn === 'function') logger.warn(message);
}

async function removeUpload(file, logger, unlink = fs.promises.unlink) {
  if (!file || !file.path) return true;
  try {
    await unlink(file.path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    safeWarning(logger, 'Failed to remove a temporary avatar upload.');
    return false;
  }
}

function createAvatarUploadHandler({
  User,
  getStorage,
  avatarDirectory,
  validateAvatar,
  enqueueCleanup,
  withRequiredTransaction,
  readFile = fs.promises.readFile,
  unlink = fs.promises.unlink,
  logger = console
}) {
  if (!User || typeof User.findById !== 'function' || typeof User.exists !== 'function') {
    throw new TypeError('Avatar upload requires a User model with findById() and exists().');
  }
  if (typeof getStorage !== 'function' ||
      typeof avatarDirectory !== 'string' ||
      typeof validateAvatar !== 'function' ||
      typeof enqueueCleanup !== 'function' ||
      typeof withRequiredTransaction !== 'function') {
    throw new TypeError('Avatar upload dependencies are incomplete.');
  }

  return async function uploadAvatar(req, res, next) {
    const file = req.file;
    if (!file) return next(new AppError('Avatar file is required.', 400));

    let uploadedObject = null;
    let saved = false;
    let r2Storage = null;
    try {
      await validateAvatar(file);
      const user = await User.findById(req.user.id).select('+avatarStorage');
      if (!user) throw new AppError('User not found.', 404);

      const previousAvatarPath = user.avatar ? safeAvatarPath(avatarDirectory, user.avatar) : null;
      if (user.avatar && !previousAvatarPath) {
        throw new AppError('Stored avatar filename is invalid.', 500);
      }
      const previousAvatarStorage = user.avatarStorage && {
        provider: user.avatarStorage.provider,
        key: user.avatarStorage.key
      };

      const storageRuntime = getStorage(req);
      const productionRequired = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
      const r2Available = Boolean(
        storageRuntime &&
        storageRuntime.status &&
        storageRuntime.status.r2 &&
        storageRuntime.status.r2.available
      );

      if (productionRequired && !r2Available) {
        throw new AppError('Production avatar uploads require a valid Cloudflare R2 configuration.', 503);
      }

      if (r2Available) {
        r2Storage = storageRuntime.r2Storage;
        if (!r2Storage) throw new Error('R2 storage is marked available but is not initialized.');

        const body = await readFile(file.path);
        uploadedObject = await r2Storage.upload({
          purpose: 'avatar',
          body,
          contentType: file.mimetype
        });
        const downloaded = await r2Storage.download({
          key: uploadedObject.key,
          checksumSha256: uploadedObject.checksumSha256
        });
        if (downloaded.checksumSha256 !== uploadedObject.checksumSha256 ||
            downloaded.size !== body.length ||
            uploadedObject.size !== body.length) {
          throw new Error('Uploaded avatar verification failed.');
        }

        user.avatar = file.filename;
        user.avatarStorage = {
          provider: 'r2',
          key: uploadedObject.key,
          checksumSha256: uploadedObject.checksumSha256,
          size: uploadedObject.size
        };
      } else {
        user.avatar = file.filename;
        user.avatarStorage = undefined;
      }

      if (previousAvatarStorage && previousAvatarStorage.provider === 'r2') {
        await withRequiredTransaction(async (session) => {
          await user.save({ validateModifiedOnly: true, session });
          await enqueueCleanup({
            purpose: 'avatars',
            key: previousAvatarStorage.key
          }, session);
        });
      } else {
        await user.save({ validateModifiedOnly: true });
      }
      saved = true;

      if (r2Available) {
        try {
          await fs.promises.unlink(file.path);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            safeWarning(logger, 'Failed to remove a staged avatar after its R2 upload.');
          }
        }
      }

      if (previousAvatarPath && !previousAvatarStorage && previousAvatarPath !== file.path) {
        try {
          await fs.promises.unlink(previousAvatarPath);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            safeWarning(logger, 'Failed to remove a replaced local avatar.');
          }
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Avatar uploaded successfully.',
        avatar: file.filename
      });
    } catch (error) {
      if (uploadedObject && r2Storage && !saved) {
        try {
          await enqueueCleanup({ purpose: 'avatars', key: uploadedObject.key });
        } catch (_cleanupError) {
          safeWarning(logger, 'An unreferenced R2 avatar could not be queued for cleanup; bucket reconciliation will retry.');
        }
      }
      if (!saved && !await removeUpload(file, logger, unlink)) {
        return next(new AppError('Upload failed and temporary file cleanup could not be completed.', 500));
      }
      return next(error);
    }
  };
}

function isMissingObject(error) {
  return Boolean(error && (
    error.name === 'NoSuchKey' ||
    error.name === 'NotFound' ||
    error.$metadata && error.$metadata.httpStatusCode === 404
  ));
}

function createAvatarDeliveryHandler({ User, getStorage }) {
  if (!User || typeof User.find !== 'function' || typeof getStorage !== 'function') {
    throw new TypeError('Avatar delivery requires a User model and storage resolver.');
  }

  return async function deliverAvatar(req, res, next) {
    const filename = req.params.filename;
    if (!AVATAR_FILENAME_PATTERN.test(filename || '')) {
      return res.status(400).end();
    }

    try {
      const users = await User.find({ avatar: filename })
        .select('avatar +avatarStorage')
        .lean();
      const r2Users = users.filter((user) => user.avatarStorage !== undefined &&
        user.avatarStorage !== null);
      if (r2Users.length === 0) return next();
      if (users.length !== 1 || r2Users.length !== 1) return res.status(404).end();

      const metadata = r2Users[0].avatarStorage;
      if (metadata.provider !== 'r2' ||
          !AVATAR_KEY_PATTERN.test(metadata.key || '') ||
          !/^[a-f\d]{64}$/i.test(metadata.checksumSha256 || '') ||
          !Number.isSafeInteger(metadata.size) ||
          metadata.size < 0) {
        return res.status(404).end();
      }

      const storageRuntime = getStorage(req);
      if (!storageRuntime ||
          !storageRuntime.status ||
          !storageRuntime.status.r2 ||
          !storageRuntime.status.r2.available ||
          !storageRuntime.r2Storage) {
        return res.status(503).end();
      }

      const object = await storageRuntime.r2Storage.download({
        key: metadata.key,
        checksumSha256: metadata.checksumSha256
      });
      if (object.checksumSha256.toLowerCase() !== metadata.checksumSha256.toLowerCase() ||
          object.size !== metadata.size) {
        return res.status(404).end();
      }

      const contentType = AVATAR_CONTENT_TYPES[path.extname(filename).toLowerCase()];
      if (!contentType) return res.status(404).end();
      res.set({
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.type(contentType).send(object.body);
    } catch (error) {
      if (isMissingObject(error)) return res.status(404).end();
      return next(error);
    }
  };
}

module.exports = {
  createAvatarDeliveryHandler,
  createAvatarUploadHandler,
  safeAvatarPath
};
