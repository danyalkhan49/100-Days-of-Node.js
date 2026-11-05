const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AppError = require('./AppError');

const storageDirectory = path.resolve(__dirname, '../uploads/identity-documents');
const magic = Buffer.from('LLID1');
const headerLength = magic.length + 12 + 16;
const documentTypes = {
  '.pdf': {
    mimeType: 'application/pdf',
    matches(buffer) { return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-'; }
  },
  '.jpg': {
    mimeType: 'image/jpeg',
    matches(buffer) { return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff; }
  },
  '.jpeg': {
    mimeType: 'image/jpeg',
    matches(buffer) { return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff; }
  },
  '.png': {
    mimeType: 'image/png',
    matches(buffer) {
      return buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  }
};

function getEncryptionKey() {
  const value = process.env.ID_DOCUMENT_ENCRYPTION_KEY;
  if (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value)) {
    throw new AppError('Identity document storage is not configured. Set ID_DOCUMENT_ENCRYPTION_KEY to a secret 32-byte hexadecimal key.', 503);
  }
  const key = Buffer.from(value, 'hex');
  if (key.length !== 32) {
    throw new AppError('Identity document storage is not configured. Set ID_DOCUMENT_ENCRYPTION_KEY to a secret 32-byte hexadecimal key.', 503);
  }
  return key;
}

function getDocumentType(originalName, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError('Identity document upload is invalid.', 400);
  }
  const extension = path.extname(originalName || '').toLowerCase();
  const type = documentTypes[extension];
  if (!type || !type.matches(buffer)) {
    throw new AppError('The file content does not match an allowed PDF, JPG, JPEG, or PNG document.', 400);
  }
  return { extension, mimeType: type.mimeType };
}

function encryptDocument(buffer, key = getEncryptionKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]);
}

function decryptDocument(encrypted, key = getEncryptionKey()) {
  if (!Buffer.isBuffer(encrypted) || encrypted.length < headerLength ||
      !encrypted.subarray(0, magic.length).equals(magic)) {
    throw new AppError('Stored identity document is invalid.', 500);
  }
  const ivStart = magic.length;
  const tagStart = ivStart + 12;
  const ciphertextStart = tagStart + 16;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, encrypted.subarray(ivStart, tagStart));
    decipher.setAuthTag(encrypted.subarray(tagStart, ciphertextStart));
    return Buffer.concat([
      decipher.update(encrypted.subarray(ciphertextStart)),
      decipher.final()
    ]);
  } catch {
    throw new AppError('Stored identity document could not be authenticated or is corrupted.', 500);
  }
}

function safeDocumentPath(filename, directory = storageDirectory) {
  if (typeof filename !== 'string' || !/^[a-f\d]{64}\.enc$/i.test(filename)) {
    throw new AppError('Stored identity document reference is invalid.', 500);
  }
  return path.join(directory, filename);
}

async function saveEncryptedDocument(buffer, directory = storageDirectory) {
  const key = getEncryptionKey();
  const filename = `${crypto.randomBytes(32).toString('hex')}.enc`;
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.promises.writeFile(safeDocumentPath(filename, directory), encryptDocument(buffer, key), {
      flag: 'wx',
      mode: 0o600
    });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      try {
        await fs.promises.unlink(safeDocumentPath(filename, directory));
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          throw new Error('Identity document write failed and its partial encrypted file could not be removed.');
        }
      }
    }
    throw error;
  }
  return filename;
}

async function readEncryptedDocument(filename, directory = storageDirectory) {
  const key = getEncryptionKey();
  let contents;
  try {
    contents = await fs.promises.readFile(safeDocumentPath(filename, directory));
  } catch (error) {
    if (error.code === 'ENOENT') throw new AppError('Identity document file was not found.', 404);
    throw error;
  }
  return decryptDocument(contents, key);
}

async function removeEncryptedDocument(filename, directory = storageDirectory) {
  try {
    await fs.promises.unlink(safeDocumentPath(filename, directory));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  getDocumentType,
  getEncryptionKey,
  encryptDocument,
  decryptDocument,
  saveEncryptedDocument,
  readEncryptedDocument,
  removeEncryptedDocument
};
