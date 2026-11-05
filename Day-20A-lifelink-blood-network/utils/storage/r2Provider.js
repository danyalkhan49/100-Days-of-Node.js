const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const {
  PURPOSE_PREFIXES,
  checksum,
  validateKey,
  validatePurpose
} = require('./storageService');

function isNotFound(error) {
  if (error && error.name === 'NoSuchBucket') return false;
  return Boolean(error && (
    error.name === 'NotFound' ||
    error.name === 'NoSuchKey' ||
    error.$metadata && error.$metadata.httpStatusCode === 404
  ));
}

async function bodyToBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body && typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new TypeError('R2 returned an unsupported object body.');
}

function createR2Provider({ client, bucket }) {
  if (!client || typeof client.send !== 'function') {
    throw new TypeError('An injected S3-compatible client is required.');
  }
  if (typeof bucket !== 'string' || !bucket.trim()) {
    throw new TypeError('An R2 bucket name is required.');
  }

  const bucketName = bucket.trim();

  async function upload({ key, body, contentType, checksumSha256 }) {
    validateKey(key);
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new TypeError('Storage requires a non-empty Buffer.');
    }
    const actualChecksum = checksum(body);
    if (checksumSha256 && checksumSha256.toLowerCase() !== actualChecksum) {
      throw new Error('Upload checksum does not match the provided body.');
    }

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: { sha256: actualChecksum }
    }));

    return {
      key,
      contentType,
      checksumSha256: actualChecksum,
      size: body.length
    };
  }

  async function download({ key }) {
    validateKey(key);
    const result = await client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    }));
    const body = await bodyToBuffer(result.Body);
    const actualChecksum = checksum(body);
    const storedChecksum = result.Metadata && result.Metadata.sha256;
    if (storedChecksum && storedChecksum.toLowerCase() !== actualChecksum) {
      throw new Error('R2 object checksum does not match its stored metadata.');
    }

    return {
      body,
      contentType: result.ContentType,
      checksumSha256: storedChecksum || actualChecksum,
      size: body.length
    };
  }

  async function remove({ key }) {
    validateKey(key);
    await client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key
    }));
  }

  async function exists({ key }) {
    validateKey(key);
    try {
      await client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async function list({ purpose, continuationToken, maxKeys = 100 }) {
    validatePurpose(purpose);
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 1000) {
      throw new TypeError('maxKeys must be an integer from 1 to 1000.');
    }
    if (continuationToken !== undefined &&
        (typeof continuationToken !== 'string' || !continuationToken)) {
      throw new TypeError('continuationToken must be a non-empty string when provided.');
    }

    const result = await client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: PURPOSE_PREFIXES[purpose],
      MaxKeys: maxKeys,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {})
    }));
    const objects = (result.Contents || [])
      .filter((object) => typeof object.Key === 'string')
      .filter((object) =>
        /^(avatars|prescriptions|identity-documents)\/[a-f\d]{64}$/i.test(object.Key) &&
        object.Key.startsWith(PURPOSE_PREFIXES[purpose])
      )
      .map((object) => ({
        key: object.Key,
        lastModified: object.LastModified
      }));

    if (result.IsTruncated && typeof result.NextContinuationToken !== 'string') {
      throw new Error('R2 returned a truncated object listing without a continuation token.');
    }

    return {
      objects,
      nextContinuationToken: result.IsTruncated ? result.NextContinuationToken : null
    };
  }

  return Object.freeze({ upload, download, delete: remove, exists, list });
}

module.exports = { createR2Provider };
