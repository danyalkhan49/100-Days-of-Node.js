const crypto = require('crypto');
const AppError = require('./AppError');
const {
  decryptDocument,
  encryptDocument,
  getDocumentType,
  readEncryptedDocument,
  removeEncryptedDocument,
  saveEncryptedDocument
} = require('./identityDocuments');

const IDENTITY_KEY_PATTERN = /^identity-documents\/[a-f\d]{64}$/;
const CHECKSUM_PATTERN = /^[a-f\d]{64}$/i;

function isR2IdentityMetadata(metadata) {
  return metadata !== undefined && metadata !== null;
}

function validateIdentityMetadata(metadata) {
  if (!metadata || metadata.provider !== 'r2' ||
      !IDENTITY_KEY_PATTERN.test(metadata.key || '') ||
      !CHECKSUM_PATTERN.test(metadata.checksumSha256 || '') ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0) {
    throw new AppError('Stored identity document metadata is invalid.', 500);
  }
}

async function readIdentityDocument({
  filename,
  metadata,
  storageRuntime,
  readLocal = readEncryptedDocument
}) {
  if (!isR2IdentityMetadata(metadata)) return readLocal(filename);
  validateIdentityMetadata(metadata);

  if (!storageRuntime ||
      !storageRuntime.status ||
      !storageRuntime.status.r2 ||
      !storageRuntime.status.r2.available ||
      !storageRuntime.r2Storage) {
    throw new AppError('Identity document storage is temporarily unavailable.', 503);
  }

  const encrypted = await storageRuntime.r2Storage.download({
    key: metadata.key,
    checksumSha256: metadata.checksumSha256
  });
  if (encrypted.checksumSha256.toLowerCase() !== metadata.checksumSha256.toLowerCase() ||
      encrypted.size !== metadata.size) {
    throw new AppError('Stored identity document could not be verified.', 500);
  }
  return decryptDocument(encrypted.body);
}

function createIdentityDocumentUploadHandler({
  User,
  StorageCleanupJob,
  enqueueCleanup,
  withRequiredTransaction,
  getStorage,
  getType = getDocumentType,
  encrypt = encryptDocument,
  saveLocal = saveEncryptedDocument,
  removeLocal = removeEncryptedDocument
}) {
  if (!User || typeof User.findById !== 'function' ||
      typeof User.findOneAndUpdate !== 'function' ||
      !StorageCleanupJob ||
      typeof enqueueCleanup !== 'function' ||
      typeof withRequiredTransaction !== 'function' ||
      typeof getStorage !== 'function' ||
      typeof getType !== 'function' ||
      typeof encrypt !== 'function' ||
      typeof saveLocal !== 'function' ||
      typeof removeLocal !== 'function') {
    throw new TypeError('Identity document upload dependencies are incomplete.');
  }

  return async function uploadIdentityDocument(req, res) {
    if (!req.file) throw new AppError('Identity document file is required.', 400);
    if (req.body.consent !== 'true') {
      throw new AppError('Consent is required before uploading an identity document.', 400);
    }

    const documentType = getType(req.file.originalname, req.file.buffer);
    const user = await User.findById(req.user.id)
      .select('+identityDocument +identityDocumentMimeType +identityDocumentStorage');
    if (!user) throw new AppError('User not found.', 404);

    const previousDocument = user.identityDocument;
    const previousStorage = user.identityDocumentStorage && {
      provider: user.identityDocumentStorage.provider,
      key: user.identityDocumentStorage.key
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
      throw new AppError('Production identity document uploads require a valid Cloudflare R2 configuration.', 503);
    }
    let filename;
    let uploadedObject = null;
    let storageMetadata;
    let now;

    try {
      if (r2Available) {
        const r2Storage = storageRuntime.r2Storage;
        if (!r2Storage) throw new Error('R2 storage is marked available but is not initialized.');
        const ciphertext = encrypt(req.file.buffer);
        filename = `${crypto.randomBytes(32).toString('hex')}.enc`;
        uploadedObject = await r2Storage.upload({
          purpose: 'identityDocument',
          body: ciphertext,
          contentType: 'application/octet-stream'
        });
        if (!IDENTITY_KEY_PATTERN.test(uploadedObject.key || '') ||
            !await r2Storage.exists({ key: uploadedObject.key })) {
          throw new Error('Uploaded identity document could not be verified.');
        }
        const verified = await r2Storage.download({
          key: uploadedObject.key,
          checksumSha256: uploadedObject.checksumSha256
        });
        if (!Buffer.isBuffer(verified.body) ||
            verified.checksumSha256 !== uploadedObject.checksumSha256 ||
            verified.size !== ciphertext.length ||
            uploadedObject.size !== ciphertext.length) {
          throw new Error('Uploaded identity document verification failed.');
        }
        storageMetadata = {
          provider: 'r2',
          key: uploadedObject.key,
          checksumSha256: uploadedObject.checksumSha256,
          size: uploadedObject.size
        };
      } else {
        filename = await saveLocal(req.file.buffer);
      }

      now = new Date();
      const update = {
        $set: {
          identityDocument: filename,
          identityDocumentMimeType: documentType.mimeType,
          identityDocumentUploadedAt: now,
          identityDocumentConsentAt: now,
          identityVerificationStatus: 'Pending',
          identityReviewedBy: null,
          identityReviewedAt: null,
          identityReviewNote: '',
          ...(storageMetadata ? { identityDocumentStorage: storageMetadata } : {})
        },
        ...(!storageMetadata ? { $unset: { identityDocumentStorage: 1 } } : {})
      };
      const saveReference = async (session) => {
        const updated = await User.findOneAndUpdate(
          { _id: user._id, identityDocument: previousDocument || null },
          update,
          { new: true, runValidators: true, ...(session ? { session } : {}) }
        );
        if (!updated) {
          throw new AppError('Identity document changed during upload. Refresh the page and try again.', 409);
        }
        if (previousStorage && previousStorage.provider === 'r2') {
          await enqueueCleanup({
            purpose: 'identity-documents',
            key: previousStorage.key
          }, session);
        }
      };

      if (previousStorage && previousStorage.provider === 'r2') {
        await withRequiredTransaction(saveReference);
      } else {
        await saveReference(null);
      }
    } catch (error) {
      if (uploadedObject) {
        try {
          await enqueueCleanup({
            purpose: 'identity-documents',
            key: uploadedObject.key
          });
        } catch (_cleanupError) {
          console.error('An unreferenced R2 identity document could not be queued; bucket reconciliation will retry.');
        }
      } else if (filename) {
        try {
          await removeLocal(filename);
        } catch (cleanupError) {
          console.error('Failed to remove an unsaved encrypted identity document.',
            cleanupError.code || cleanupError.name);
          throw new Error('Identity document could not be saved and the encrypted upload could not be removed.');
        }
      }
      throw error;
    }

    let cleanupWarning = false;
    if (previousDocument && previousDocument !== filename &&
        !(previousStorage && previousStorage.provider === 'r2')) {
      try {
        await removeLocal(previousDocument);
      } catch (error) {
        cleanupWarning = true;
        console.error('Failed to remove a replaced encrypted identity document.', {
          code: error.code || error.name || 'StorageError'
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: cleanupWarning
        ? 'Identity document submitted for review. An older encrypted copy requires administrator cleanup.'
        : 'Identity document submitted for administrator review.',
      data: {
        identityVerificationStatus: 'Pending',
        identityDocumentUploadedAt: now
      }
    });
  };
}

function createIdentityDocumentWithdrawalHandler({
  User,
  enqueueCleanup,
  withRequiredTransaction,
  removeLocal = removeEncryptedDocument
}) {
  if (!User || typeof User.findById !== 'function' ||
      typeof User.findOneAndUpdate !== 'function' ||
      typeof enqueueCleanup !== 'function' ||
      typeof withRequiredTransaction !== 'function' ||
      typeof removeLocal !== 'function') {
    throw new TypeError('Identity document withdrawal dependencies are incomplete.');
  }

  return async function withdrawIdentityDocument(req, res) {
    const user = await User.findById(req.user.id)
      .select('+identityDocument +identityDocumentStorage');
    if (!user) throw new AppError('User not found.', 404);
    if (!user.identityDocument) {
      throw new AppError('No identity document is stored for this account.', 404);
    }

    const filename = user.identityDocument;
    const storageMetadata = user.identityDocumentStorage && {
      provider: user.identityDocumentStorage.provider,
      key: user.identityDocumentStorage.key
    };
    const update = {
      $set: {
        identityVerificationStatus: 'NotSubmitted',
        identityDocumentUploadedAt: null,
        identityDocumentConsentAt: null,
        identityReviewedBy: null,
        identityReviewedAt: null,
        identityReviewNote: ''
      },
      $unset: {
        identityDocument: 1,
        identityDocumentMimeType: 1,
        identityDocumentStorage: 1
      }
    };
    const removeReference = async (session) => {
      const result = await User.findOneAndUpdate(
        { _id: user._id, identityDocument: filename },
        update,
        { new: true, runValidators: true, ...(session ? { session } : {}) }
      );
      if (!result) {
        throw new AppError('Identity document changed during removal. Please refresh and try again.', 409);
      }
      if (storageMetadata && storageMetadata.provider === 'r2') {
        await enqueueCleanup({
          purpose: 'identity-documents',
          key: storageMetadata.key
        }, session);
      }
    };

    if (storageMetadata && storageMetadata.provider === 'r2') {
      await withRequiredTransaction(removeReference);
    } else {
      await removeReference(null);
      try {
        await removeLocal(filename);
      } catch (error) {
        console.error('Failed to remove a withdrawn encrypted identity document.', {
          code: error.code || error.name || 'StorageError'
        });
        throw new AppError('The document was removed from your account, but its encrypted file could not be deleted. Contact the service administrator.', 500);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Identity document and verification consent were removed.'
    });
  };
}

module.exports = {
  createIdentityDocumentUploadHandler,
  createIdentityDocumentWithdrawalHandler,
  isR2IdentityMetadata,
  readIdentityDocument
};
