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
  'MongoNetworkTimeoutError'
]);

const SAFE_ERROR_CODES = new Set([
  'EMAIL_FRONTEND_URL_CONFIG',
  'EMAIL_PROVIDER_REJECTED',
  'EMAIL_SMTP_CONFIG',
  'MONGO_UNSUPPORTED_TOPOLOGY',
  'MissingNotificationPayload',
  'NotificationChannelUnavailable',
  'ReminderNoLongerApplicable',
  'RequestNoLongerOpen'
]);

const SAFE_ROLLBACK_OPERATIONS = new Set([
  'admin_audit_change',
  'admin_audit_partial_write_cleanup',
  'admin_password_reset_delivery_cleanup',
  'admin_user_deactivation',
  'admin_request_closure',
  'request_prescription_restore'
]);

function safeRequestId(value) {
  return typeof value === 'string' && /^[a-z\d_-]{1,64}$/i.test(value)
    ? value
    : undefined;
}

function safeErrorMetadata(error) {
  const type = error && SAFE_ERROR_TYPES.has(error.name) ? error.name : 'Error';
  const statusCode = error && Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode
    : undefined;
  const code = error && SAFE_ERROR_CODES.has(error.code) ? error.code : undefined;
  return {
    errorType: type,
    ...(code ? { code } : {}),
    ...(statusCode ? { statusCode } : {})
  };
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
  logRollbackFailure,
  logUnexpectedError
};
