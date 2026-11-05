const EXAMPLE_PLACEHOLDER = 'replace-with-a-long-random-development-secret';
const PRODUCTION_SECRET_ERROR =
  'JWT_SECRET must be at least 32 UTF-8 bytes and cannot be a known placeholder in production.';

function isProductionEnvironment(env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function requiresStrongSecret(env) {
  const environment = String(env.NODE_ENV || '').trim().toLowerCase();
  return environment === 'production' || environment === 'staging';
}

function isKnownDevelopmentPlaceholder(secret) {
  const normalized = secret.trim().toLowerCase();
  return normalized === EXAMPLE_PLACEHOLDER ||
    /^lifelink-[a-z0-9-]+-(?:unit-)?test-secret$/.test(normalized) ||
    /^synthetic-[a-z0-9-]+-test-secret$/.test(normalized);
}

function getJwtSecret(env = process.env) {
  const secret = env.JWT_SECRET;
  const production = isProductionEnvironment(env);
  const strongSecretRequired = requiresStrongSecret(env);

  if (typeof secret !== 'string' || !secret.trim()) {
    throw new Error(production
      ? PRODUCTION_SECRET_ERROR
      : 'JWT_SECRET is not configured.');
  }

  if (strongSecretRequired && (
    Buffer.byteLength(secret, 'utf8') < 32 ||
    isKnownDevelopmentPlaceholder(secret)
  )) {
    throw new Error(production
      ? PRODUCTION_SECRET_ERROR
      : 'JWT_SECRET must be at least 32 UTF-8 bytes and cannot be a known placeholder in staging.');
  }

  return secret;
}

module.exports = { getJwtSecret };
