const fs = require('fs');
const path = require('path');
const AppError = require('./AppError');

const PRESCRIPTION_KEY_PATTERN = /^prescriptions\/[a-f\d]{64}$/i;
const PRESCRIPTION_CHECKSUM_PATTERN = /^[a-f\d]{64}$/i;
const PRESCRIPTION_FILENAME_PATTERN = /^[a-f\d]{32}\.(?:pdf|jpe?g|png)$/i;
const PRESCRIPTION_CONTENT_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
});

function hasPrescriptionStorage(request) {
  return request.prescriptionStorage !== undefined && request.prescriptionStorage !== null;
}

async function enqueuePrescriptionCleanup(request, enqueueCleanup, session) {
  if (!hasPrescriptionStorage(request)) return false;
  if (!request.prescriptionStorage ||
      request.prescriptionStorage.provider !== 'r2' ||
      typeof enqueueCleanup !== 'function') {
    throw new AppError('Stored prescription cleanup metadata is invalid.', 500);
  }
  await enqueueCleanup({
    purpose: 'prescriptions',
    key: request.prescriptionStorage.key
  }, session);
  return true;
}

async function moveLegacyPrescriptionToQuarantine(request, moveToQuarantine) {
  if (hasPrescriptionStorage(request) || !request.prescription) return null;
  return moveToQuarantine(request.prescription);
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
    safeWarning(logger, 'Failed to remove a temporary prescription upload.');
    return false;
  }
}

function createPrescriptionUploadHandler({
  BloodRequest,
  getStorage,
  uploadDirectory,
  validateContents,
  enqueueCleanup,
  withRequiredTransaction,
  unlink = fs.promises.unlink,
  logger = console
}) {
  if (!BloodRequest || typeof BloodRequest.findById !== 'function' ||
      typeof BloodRequest.exists !== 'function' ||
      typeof getStorage !== 'function' ||
      typeof uploadDirectory !== 'string' ||
      typeof validateContents !== 'function' ||
      typeof enqueueCleanup !== 'function' ||
      typeof withRequiredTransaction !== 'function') {
    throw new TypeError('Prescription upload dependencies are incomplete.');
  }

  return async function uploadPrescription(req, res, next) {
    if (!req.file) return next(new AppError('Prescription file is required.', 400));

    let uploadedObject = null;
    let saved = false;
    let r2Storage = null;
    try {
      const request = await BloodRequest.findById(req.params.id).select('+prescriptionStorage');
      if (!request) throw new AppError('Blood request not found.', 404);
      if (String(request.requester) !== String(req.user.id)) {
        throw new AppError('You do not own this blood request.', 403);
      }

      const body = await validateContents(req.file);
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new TypeError('Prescription validation must return a non-empty Buffer.');
      }
      const previousPrescription = request.prescription;
      const previousStorage = request.prescriptionStorage && {
        provider: request.prescriptionStorage.provider,
        key: request.prescriptionStorage.key
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
        throw new AppError('Production prescription uploads require a valid Cloudflare R2 configuration.', 503);
      }

      request.prescription = req.file.filename;
      if (r2Available) {
        r2Storage = storageRuntime.r2Storage;
        if (!r2Storage) throw new Error('R2 storage is marked available but is not initialized.');
        uploadedObject = await r2Storage.upload({
          purpose: 'prescription',
          body,
          contentType: req.file.mimetype
        });
        if (!/^prescriptions\/[a-f\d]{64}$/i.test(uploadedObject.key || '')) {
          throw new Error('Uploaded prescription object key is invalid.');
        }
        if (!await r2Storage.exists({ key: uploadedObject.key })) {
          throw new Error('Uploaded prescription object could not be verified.');
        }
        const downloaded = await r2Storage.download({
          key: uploadedObject.key,
          checksumSha256: uploadedObject.checksumSha256
        });
        if (downloaded.checksumSha256.toLowerCase() !== uploadedObject.checksumSha256.toLowerCase() ||
            downloaded.size !== body.length ||
            uploadedObject.size !== body.length) {
          throw new Error('Uploaded prescription verification failed.');
        }
        request.prescriptionStorage = {
          provider: 'r2',
          key: uploadedObject.key,
          checksumSha256: uploadedObject.checksumSha256,
          size: uploadedObject.size
        };
      } else {
        request.prescriptionStorage = undefined;
      }

      if (previousStorage && previousStorage.provider === 'r2') {
        await withRequiredTransaction(async (session) => {
          await request.save({ validateModifiedOnly: true, session });
          await enqueueCleanup({
            purpose: 'prescriptions',
            key: previousStorage.key
          }, session);
        });
      } else {
        await request.save({ validateModifiedOnly: true });
      }
      saved = true;

      if (r2Available) {
        await removeUpload(req.file, logger);
      }

      if (previousPrescription && !previousStorage) {
        const previousPath = path.resolve(uploadDirectory, previousPrescription);
        const relative = path.relative(uploadDirectory, previousPath);
        if (path.basename(previousPrescription) === previousPrescription &&
            relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative) && previousPath !== req.file.path) {
          try {
            await fs.promises.unlink(previousPath);
          } catch (error) {
            if (error.code !== 'ENOENT') {
              safeWarning(logger, 'Failed to remove a replaced local prescription.');
            }
          }
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Prescription uploaded successfully.',
        prescription: req.file.filename
      });
    } catch (error) {
      if (uploadedObject && r2Storage && !saved) {
        try {
          await enqueueCleanup({
            purpose: 'prescriptions',
            key: uploadedObject.key
          });
        } catch (_cleanupError) {
          safeWarning(logger, 'An unreferenced R2 prescription could not be queued for cleanup; bucket reconciliation will retry.');
        }
      }
      if (!saved && !await removeUpload(req.file, logger, unlink)) {
        return next(new AppError('Upload failed and temporary file cleanup could not be completed.', 500));
      }
      return next(error);
    }
  };
}

async function canAccessPrescription({ request, user, Offer }) {
  if (user.role === 'admin' || String(request.requester) === String(user.id)) return true;
  if (user.role !== 'donor') return false;
  return Boolean(await Offer.exists({
    request: request._id,
    donor: user.id,
    status: 'Accepted'
  }));
}

function validatePrescriptionStorage(metadata) {
  if (!metadata || metadata.provider !== 'r2' ||
      !PRESCRIPTION_KEY_PATTERN.test(metadata.key || '') ||
      !PRESCRIPTION_CHECKSUM_PATTERN.test(metadata.checksumSha256 || '') ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0) {
    throw new AppError('Stored prescription metadata is invalid.', 500);
  }
}

async function sendR2Prescription({ request, storageRuntime, res }) {
  const metadata = request.prescriptionStorage;
  validatePrescriptionStorage(metadata);
  if (!storageRuntime ||
      !storageRuntime.status ||
      !storageRuntime.status.r2 ||
      !storageRuntime.status.r2.available ||
      !storageRuntime.r2Storage) {
    throw new AppError('Prescription storage is temporarily unavailable.', 503);
  }

  if (!PRESCRIPTION_FILENAME_PATTERN.test(request.prescription)) {
    throw new AppError('Stored prescription filename is invalid.', 500);
  }
  const extension = path.extname(request.prescription).toLowerCase();
  const contentType = PRESCRIPTION_CONTENT_TYPES[extension];
  if (!contentType || path.basename(request.prescription) !== request.prescription) {
    throw new AppError('Stored prescription filename is invalid.', 500);
  }
  let object;
  try {
    object = await storageRuntime.r2Storage.download({
      key: metadata.key,
      checksumSha256: metadata.checksumSha256
    });
  } catch (error) {
    if (error && (
      error.name === 'NoSuchKey' ||
      error.name === 'NotFound' ||
      error.$metadata && error.$metadata.httpStatusCode === 404
    )) {
      throw new AppError('Prescription file not found.', 404);
    }
    throw error;
  }
  if (object.checksumSha256.toLowerCase() !== metadata.checksumSha256.toLowerCase() ||
      object.size !== metadata.size) {
    throw new AppError('Stored prescription could not be verified.', 500);
  }

  return res.type(contentType)
    .attachment(request.prescription)
    .set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    .send(object.body);
}

async function sendLegacyPrescription({ filename, directory, res, next }) {
  if (typeof filename !== 'string' || !filename ||
      path.basename(filename) !== filename) {
    throw new AppError('Stored prescription filename is invalid.', 500);
  }
  const filePath = path.resolve(directory, filename);
  const relative = path.relative(directory, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) || relative === '') {
    throw new AppError('Stored prescription filename is invalid.', 500);
  }

  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch (error) {
    if (error.code === 'ENOENT') throw new AppError('Prescription file not found.', 404);
    throw error;
  }
  return res.download(filePath, path.basename(filePath), (error) => {
    if (error) next(error);
  });
}

module.exports = {
  canAccessPrescription,
  createPrescriptionUploadHandler,
  enqueuePrescriptionCleanup,
  hasPrescriptionStorage,
  moveLegacyPrescriptionToQuarantine,
  sendLegacyPrescription,
  sendR2Prescription
};
