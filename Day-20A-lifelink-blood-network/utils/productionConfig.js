const { validateMongoUri } = require('../config/db');
const { getR2Configuration } = require('../config/storage');
const { getJwtSecret } = require('./jwtSecret');
const { parseTrustedProxyHops } = require('./trustedProxy');

function validateProductionConfig(env = process.env) {
  const errors = [];
  if (env.NODE_ENV !== 'production') {
    errors.push('NODE_ENV must be exactly production.');
  }
  try { getJwtSecret(env); } catch { errors.push('JWT_SECRET is missing or invalid for production.'); }
  try { validateMongoUri(env.MONGO_URI); } catch { errors.push('MONGO_URI is missing or invalid.'); }
  if (!getR2Configuration(env)) errors.push('Cloudflare R2 production configuration is missing or invalid.');

  if (env.PORT !== undefined && env.PORT !== '') {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('PORT must be an integer between 1 and 65535.');
    }
  }

  if (typeof env.FRONTEND_URL !== 'string' || !env.FRONTEND_URL.trim()) {
    errors.push('FRONTEND_URL must be a valid HTTPS URL without credentials, query, or fragment.');
  } else {
    try {
      const frontendUrl = new URL(env.FRONTEND_URL);
      if (frontendUrl.protocol !== 'https:' || frontendUrl.username || frontendUrl.password ||
          frontendUrl.search || frontendUrl.hash) throw new Error();
    } catch {
      errors.push('FRONTEND_URL must be a valid HTTPS URL without credentials, query, or fragment.');
    }
  }

  if (env.ID_DOCUMENT_ENCRYPTION_KEY !== undefined &&
      (typeof env.ID_DOCUMENT_ENCRYPTION_KEY !== 'string' ||
       !/^[a-f\d]{64}$/i.test(env.ID_DOCUMENT_ENCRYPTION_KEY))) {
    errors.push('ID_DOCUMENT_ENCRYPTION_KEY must be 64 hexadecimal characters when configured.');
  }
  if (env.TRUST_PROXY_HOPS !== undefined) {
    try { parseTrustedProxyHops(env.TRUST_PROXY_HOPS); }
    catch { errors.push('TRUST_PROXY_HOPS must be an integer from 1 to 10.'); }
  }
  return errors;
}

function assertProductionConfigForStartup(env = process.env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'production') return;
  const errors = validateProductionConfig(env);
  if (errors.length) {
    throw new Error(`Production configuration check failed: ${errors.join(' ')}`);
  }
}

module.exports = { assertProductionConfigForStartup, validateProductionConfig };
