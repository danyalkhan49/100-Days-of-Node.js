const { getJwtSecret } = require('./jwtSecret');
const { MAX_STAGING_PRESCRIPTION_MB, parseMaxPrescriptionMb } = require('./uploadLimits');

const HTTPS_FRONTEND_ERROR =
  'FRONTEND_URL must be a valid HTTPS URL without credentials, query, or fragment.';
const HTTPS_ALLOWED_ORIGIN_ERROR =
  'ALLOWED_ORIGIN must contain valid HTTPS origins and include the FRONTEND_URL origin.';

function isStagingEnvironment(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'staging';
}

function validateStagingConfig(env = process.env) {
  const errors = [];
  if (env.NODE_ENV !== 'staging') errors.push('NODE_ENV must be exactly staging.');

  try {
    getJwtSecret(env);
  } catch {
    errors.push('JWT_SECRET is missing or invalid for staging.');
  }

  let frontendUrl;
  if (typeof env.FRONTEND_URL !== 'string' || !env.FRONTEND_URL.trim()) {
    errors.push(HTTPS_FRONTEND_ERROR);
  } else {
    try {
      frontendUrl = new URL(env.FRONTEND_URL);
      if (frontendUrl.protocol !== 'https:' || frontendUrl.username || frontendUrl.password ||
          frontendUrl.search || frontendUrl.hash) throw new Error();
    } catch {
      frontendUrl = undefined;
      errors.push(HTTPS_FRONTEND_ERROR);
    }
  }

  const origins = typeof env.ALLOWED_ORIGIN === 'string'
    ? env.ALLOWED_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];
  let validOrigins = origins.length > 0;
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:' || parsed.origin !== origin) validOrigins = false;
    } catch {
      validOrigins = false;
    }
  }
  if (!validOrigins || !frontendUrl || !origins.includes(frontendUrl.origin)) {
    errors.push(HTTPS_ALLOWED_ORIGIN_ERROR);
  }

  try {
    const maxPrescriptionMb = parseMaxPrescriptionMb(env.MAX_PRESCRIPTION_MB);
    if (maxPrescriptionMb > MAX_STAGING_PRESCRIPTION_MB) {
      errors.push(`MAX_PRESCRIPTION_MB must not exceed ${MAX_STAGING_PRESCRIPTION_MB} in staging.`);
    }
  } catch {
    errors.push('MAX_PRESCRIPTION_MB must be a positive integer in staging.');
  }

  return errors;
}

function assertStagingConfigForStartup(env = process.env) {
  if (!isStagingEnvironment(env)) return;
  const errors = validateStagingConfig(env);
  if (errors.length) throw new Error(`Staging configuration check failed: ${errors.join(' ')}`);
}

module.exports = {
  assertStagingConfigForStartup,
  isStagingEnvironment,
  validateStagingConfig
};
