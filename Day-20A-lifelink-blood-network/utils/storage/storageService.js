const crypto = require('crypto');

const PURPOSE_PREFIXES = Object.freeze({
  avatar: 'avatars/',
  prescription: 'prescriptions/',
  identityDocument: 'identity-documents/'
});
const LIST_PURPOSES = Object.freeze({
  avatars: 'avatar',
  prescriptions: 'prescription',
  'identity-documents': 'identityDocument'
});

const KEY_PATTERN = /^(avatars|prescriptions|identity-documents)\/[a-f\d]{64}$/i;
const CHECKSUM_PATTERN = /^[a-f\d]{64}$/i;

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function validateKey(key, purpose) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new TypeError('Storage key must use an approved prefix and an opaque hexadecimal identifier.');
  }
  if (purpose && !key.startsWith(PURPOSE_PREFIXES[purpose])) {
    throw new TypeError(`Storage key does not match the ${purpose} purpose.`);
  }
  return key;
}

function validatePurpose(purpose) {
  if (!Object.prototype.hasOwnProperty.call(PURPOSE_PREFIXES, purpose)) {
    throw new TypeError('Storage purpose must be avatar, prescription, or identityDocument.');
  }
}

function validateLegacyFilename(purpose, filename) {
  validatePurpose(purpose);
  const patterns = {
    avatar: /^[a-f\d]{32}\.(?:jpe?g|png|webp)$/i,
    prescription: /^[a-f\d]{32}\.(?:pdf|jpe?g|png)$/i,
    identityDocument: /^[a-f\d]{64}\.enc$/i
  };
  if (typeof filename !== 'string' || !patterns[purpose].test(filename)) {
    throw new TypeError(`Invalid legacy ${purpose} filename.`);
  }
  return filename;
}

function validateBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError('Storage requires a non-empty Buffer.');
  }
}

function validateChecksum(value, name = 'checksumSha256') {
  if (typeof value !== 'string' || !CHECKSUM_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a 64-character SHA-256 hexadecimal digest.`);
  }
}

function createStorageService(provider) {
  for (const method of ['upload', 'download', 'delete', 'exists']) {
    if (!provider || typeof provider[method] !== 'function') {
      throw new TypeError(`Storage provider must implement ${method}().`);
    }
  }

  async function upload({ purpose, body, contentType, checksumSha256 }) {
    validatePurpose(purpose);
    validateBuffer(body);
    if (typeof contentType !== 'string' || !contentType.trim()) {
      throw new TypeError('contentType is required.');
    }

    const actualChecksum = checksum(body);
    if (checksumSha256 !== undefined) {
      validateChecksum(checksumSha256);
      if (checksumSha256.toLowerCase() !== actualChecksum) {
        throw new Error('Upload checksum does not match the provided body.');
      }
    }

    const key = `${PURPOSE_PREFIXES[purpose]}${crypto.randomBytes(32).toString('hex')}`;
    await provider.upload({
      key,
      body,
      contentType: contentType.trim(),
      checksumSha256: actualChecksum
    });

    return {
      key,
      purpose,
      contentType: contentType.trim(),
      checksumSha256: actualChecksum,
      size: body.length
    };
  }

  async function download({ key, checksumSha256 }) {
    validateKey(key);
    if (checksumSha256 !== undefined) validateChecksum(checksumSha256);

    const object = await provider.download({ key });
    validateBuffer(object && object.body);
    const actualChecksum = checksum(object.body);
    const storedChecksum = object.checksumSha256;

    if (storedChecksum !== undefined) {
      validateChecksum(storedChecksum, 'stored checksumSha256');
      if (storedChecksum.toLowerCase() !== actualChecksum) {
        throw new Error('Downloaded object checksum does not match its stored checksum.');
      }
    }
    if (checksumSha256 !== undefined &&
        checksumSha256.toLowerCase() !== actualChecksum) {
      throw new Error('Downloaded object checksum does not match the expected checksum.');
    }

    return {
      body: object.body,
      contentType: object.contentType,
      checksumSha256: actualChecksum,
      size: object.body.length
    };
  }

  async function remove({ key }) {
    validateKey(key);
    return provider.delete({ key });
  }

  async function exists({ key }) {
    validateKey(key);
    return provider.exists({ key });
  }

  async function verify({ key, checksumSha256 }) {
    validateKey(key);
    validateChecksum(checksumSha256);
    if (!await provider.exists({ key })) {
      return { exists: false, verified: false };
    }

    await download({ key, checksumSha256 });
    return { exists: true, verified: true, checksumSha256: checksumSha256.toLowerCase() };
  }

  async function downloadLegacy({ purpose, filename, contentType }) {
    validateLegacyFilename(purpose, filename);
    if (!provider.downloadLegacy) {
      throw new Error('Storage provider does not support legacy local-file reads.');
    }
    const object = await provider.downloadLegacy({ purpose, filename, contentType });
    validateBuffer(object && object.body);
    return {
      body: object.body,
      contentType: object.contentType || contentType,
      checksumSha256: checksum(object.body),
      size: object.body.length
    };
  }

  async function deleteLegacy({ purpose, filename }) {
    validateLegacyFilename(purpose, filename);
    if (!provider.deleteLegacy) {
      throw new Error('Storage provider does not support legacy local-file deletion.');
    }
    return provider.deleteLegacy({ purpose, filename });
  }

  async function existsLegacy({ purpose, filename }) {
    validateLegacyFilename(purpose, filename);
    if (!provider.existsLegacy) {
      throw new Error('Storage provider does not support legacy local-file checks.');
    }
    return provider.existsLegacy({ purpose, filename });
  }

  async function verifyLegacy({ purpose, filename, checksumSha256, contentType }) {
    validateChecksum(checksumSha256);
    if (!await existsLegacy({ purpose, filename })) {
      return { exists: false, verified: false };
    }
    const object = await downloadLegacy({ purpose, filename, contentType });
    if (object.checksumSha256 !== checksumSha256.toLowerCase()) {
      throw new Error('Legacy file checksum does not match the expected checksum.');
    }
    return { exists: true, verified: true, checksumSha256: object.checksumSha256 };
  }

  const service = {
    upload,
    download,
    delete: remove,
    exists,
    verify,
    downloadLegacy,
    deleteLegacy,
    existsLegacy,
    verifyLegacy
  };
  if (typeof provider.list === 'function') {
    service.list = async ({ purpose, continuationToken, maxKeys }) => {
      const providerPurpose = LIST_PURPOSES[purpose] || purpose;
      validatePurpose(providerPurpose);
      const page = await provider.list({
        purpose: providerPurpose,
        continuationToken,
        maxKeys
      });
      if (!page || !Array.isArray(page.objects)) {
        throw new TypeError('Storage provider returned an invalid object listing.');
      }
      const objects = page.objects.map((object) => {
        validateKey(object && object.key, providerPurpose);
        return {
          key: object.key,
          lastModified: object.lastModified
        };
      });
      if (page.nextContinuationToken !== undefined &&
          page.nextContinuationToken !== null &&
          (typeof page.nextContinuationToken !== 'string' || !page.nextContinuationToken)) {
        throw new TypeError('Storage provider returned an invalid continuation token.');
      }
      return {
        objects,
        nextContinuationToken: page.nextContinuationToken || null
      };
    };
  }

  return Object.freeze(service);
}

module.exports = {
  PURPOSE_PREFIXES,
  checksum,
  createStorageService,
  validateKey,
  validateLegacyFilename,
  validatePurpose
};
