const path = require('path');
const { S3Client } = require('@aws-sdk/client-s3');
const { createLocalFileProvider } = require('../utils/storage/localFileProvider');
const { createR2Provider } = require('../utils/storage/r2Provider');
const { createStorageService } = require('../utils/storage/storageService');
const { isStagingEnvironment } = require('../utils/stagingConfig');

const R2_ENVIRONMENT_VARIABLES = Object.freeze([
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET'
]);

function isProductionEnvironment(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function isNonEmptyEnvironmentValue(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function getR2Configuration(env = process.env) {
  const [accountId, accessKeyId, secretAccessKey, bucket] =
    R2_ENVIRONMENT_VARIABLES.map((name) => env[name]);

  if (!R2_ENVIRONMENT_VARIABLES.every((name) => isNonEmptyEnvironmentValue(env[name])) ||
      !/^[a-f\d]{32}$/i.test(accountId) ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    return null;
  }

  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    bucket,
    credentials: { accessKeyId, secretAccessKey }
  };
}

function createStorageRuntime({
  env = process.env,
  S3ClientConstructor = S3Client,
  projectRoot = path.resolve(__dirname, '..')
} = {}) {
  const runtimeEnv = env || process.env;
  const productionRequired = isProductionEnvironment(runtimeEnv);
  const stagingLocalOnly = isStagingEnvironment(runtimeEnv);
  const localProvider = createLocalFileProvider({
    rootDirectory: path.join(projectRoot, 'uploads', 'storage'),
    legacyRoots: {
      avatar: path.join(projectRoot, 'public', 'uploads', 'avatars'),
      prescription: path.join(projectRoot, 'uploads', 'prescriptions'),
      identityDocument: path.join(projectRoot, 'uploads', 'identity-documents')
    }
  });
  const localStorage = createStorageService(localProvider);
  const configuration = stagingLocalOnly ? null : getR2Configuration(runtimeEnv);
  let client = null;
  let r2Storage = null;

  if (configuration) {
    client = new S3ClientConstructor({
      endpoint: configuration.endpoint,
      region: configuration.region,
      credentials: configuration.credentials
    });
    r2Storage = createStorageService(
      createR2Provider({ client, bucket: configuration.bucket })
    );
  }

  const r2Status = Object.freeze({
    available: Boolean(r2Storage),
    required: productionRequired,
    ...(r2Storage ? {} : {
      reason: productionRequired
        ? 'production-r2-required'
        : stagingLocalOnly
          ? 'staging-local-only'
          : 'incomplete-or-invalid-configuration'
    })
  });

  let closed = false;
  return Object.freeze({
    status: Object.freeze({
      local: Object.freeze({
        available: true,
        ...(stagingLocalOnly ? { disposable: true } : {})
      }),
      r2: r2Status
    }),
    localStorage,
    r2Storage,
    productionRequired,
    isR2Available: Boolean(r2Storage),
    assertProductionReady() {
      if (productionRequired && !r2Storage) {
        const error = new Error('Production storage requires valid Cloudflare R2 configuration.');
        error.statusCode = 503;
        throw error;
      }
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      if (client && typeof client.destroy === 'function') client.destroy();
    }
  });
}

let initializedRuntime;

function initializeStorage(options) {
  if (!initializedRuntime) {
    initializedRuntime = createStorageRuntime(options);
  }
  return initializedRuntime;
}

module.exports = { createStorageRuntime, getR2Configuration, initializeStorage, isProductionEnvironment };
