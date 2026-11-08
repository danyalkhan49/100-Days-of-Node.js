const SAFE_ERROR_TYPES = new Set([
  'AppError',
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'MongoServerError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError'
]);

const SAFE_ERROR_CODES = new Set([
  'EAUTH',
  'ECONNECTION',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ESOCKET',
  'ETIMEDOUT',
  'EMAIL_FRONTEND_URL_CONFIG',
  'EMAIL_PROVIDER_REJECTED',
  'EMAIL_SMTP_CONFIG',
  'MONGO_UNSUPPORTED_TOPOLOGY',
  'MissingNotificationPayload',
  'NotificationChannelUnavailable',
  'ReminderNoLongerApplicable',
  'RequestNoLongerOpen',
  'SMS_PROVIDER_FAILURE',
  'SMS_PROVIDER_REJECTED'
]);

const SAFE_STARTUP_STAGES = new Set([
  'production_config',
  'staging_config',
  'jwt_initialization',
  'monitoring_initialization',
  'port_validation',
  'proxy_configuration',
  'healthcheck_validation',
  'route_registration',
  'mongodb_connection',
  'storage_initialization',
  'background_workers',
  'http_server_binding'
]);

const SAFE_PRODUCTION_CONFIG_CHECKS = new Set([
  'NODE_ENV',
  'JWT_SECRET',
  'MONGO_URI',
  'R2_CONFIGURATION',
  'PORT',
  'FRONTEND_URL',
  'ID_DOCUMENT_ENCRYPTION_KEY',
  'TRUST_PROXY_HOPS'
]);

const SAFE_ROLLBACK_OPERATIONS = new Set([
  'admin_audit_change',
  'admin_audit_partial_write_cleanup',
  'admin_password_reset_delivery_cleanup',
  'admin_user_deactivation',
  'admin_request_closure',
  'request_prescription_restore',
  'email_verification_resend_cleanup',
  'email_password_reset_cleanup',
  'phone_otp_delivery_cleanup'
]);

const SAFE_OPERATION_IDENTIFIERS = new Set([
  'email_registration_verification',
  'email_verification_resend',
  'email_password_reset',
  'sms_provider_delivery',
  'sms_provider_rejection',
  'notification_delivery',
  'notification_retry_worker',
  'notification_critical_worker',
  'notification_reminder_worker',
  'notification_dispatch',
  'http_server_error',
  'server_startup_error'
]);

function readErrorField(error, field) {
  try {
    return error && error[field];
  } catch {
    return undefined;
  }
}

function safeRequestId(value) {
  return typeof value === 'string' && /^[a-z\d_-]{1,64}$/i.test(value)
    ? value
    : undefined;
}

function safeErrorMetadata(error) {
  const name = readErrorField(error, 'name');
  const rawStatusCode = readErrorField(error, 'statusCode');
  const rawCode = readErrorField(error, 'code');
  const type = SAFE_ERROR_TYPES.has(name) ? name : 'Error';
  const statusCode = Number.isInteger(rawStatusCode) &&
    rawStatusCode >= 400 && rawStatusCode <= 599
    ? rawStatusCode
    : undefined;
  const code = SAFE_ERROR_CODES.has(rawCode) ? rawCode : undefined;
  const startupStage = readErrorField(error, 'startupStage');
  const rawConfigIssues = readErrorField(error, 'productionConfigIssues');
  const productionConfigIssues = Array.isArray(rawConfigIssues)
    ? [...new Set(rawConfigIssues.filter((issue) => SAFE_PRODUCTION_CONFIG_CHECKS.has(issue)))].sort()
    : [];
  return {
    errorType: type,
    ...(code ? { code } : {}),
    ...(statusCode ? { statusCode } : {}),
    ...(SAFE_STARTUP_STAGES.has(startupStage) ? { startupStage } : {}),
    ...(productionConfigIssues.length ? { productionConfigIssues } : {}),
    ...safeCauseMetadata(error)
  };
}

function safeCauseMetadata(error) {
  let cause = readErrorField(error, 'cause');

  for (let depth = 0; depth < 3 && cause; depth += 1) {
    const name = readErrorField(cause, 'name');
    const rawCode = readErrorField(cause, 'code');
    const type = SAFE_ERROR_TYPES.has(name) ? name : undefined;
    const code = SAFE_ERROR_CODES.has(rawCode) ? rawCode : undefined;

    if ((type && type !== 'Error') || code) {
      return {
        ...(type && type !== 'Error' ? { causeErrorType: type } : {}),
        ...(code ? { causeCode: code } : {})
      };
    }

    cause = readErrorField(cause, 'cause');
  }

  return {};
}

function logOperationFailure(operation, error, logger = console) {
  const safeOperation = SAFE_OPERATION_IDENTIFIERS.has(operation) ? operation : 'unknown';
  logger.error(JSON.stringify({
    event: 'operation_failure',
    operation: safeOperation,
    ...safeErrorMetadata(error)
  }));
}

function createSafeErrorLogRecord(error, request) {
  const metadata = safeErrorMetadata(error);
  const requestId = safeRequestId(request && request.id);

  return {
    event: 'unexpected_server_error',
    ...metadata,
    ...(requestId ? { requestId } : {})
  };
}

function logUnexpectedError(error, request, logger = console) {
  logger.error(JSON.stringify(createSafeErrorLogRecord(error, request)));
}

function createSafeRollbackLogRecord(operation, errors) {
  const safeOperation = SAFE_ROLLBACK_OPERATIONS.has(operation) ? operation : 'unknown';
  const failures = Array.isArray(errors) ? errors : [errors];
  const loggedFailures = failures.slice(0, 10).map(safeErrorMetadata);
  return {
    event: 'rollback_failure',
    operation: safeOperation,
    failureCount: failures.length,
    errors: loggedFailures,
    ...(failures.length > loggedFailures.length ? { truncated: true } : {})
  };
}

function logRollbackFailure(operation, errors, logger = console) {
  logger.error(JSON.stringify(createSafeRollbackLogRecord(operation, errors)));
}

module.exports = {
  createSafeErrorLogRecord,
  createSafeRollbackLogRecord,
  logOperationFailure,
  logRollbackFailure,
  logUnexpectedError,
  safeErrorMetadata
};
