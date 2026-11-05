const Sentry = require('@sentry/node');

let initialized = false;

function scrubEvent(event) {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    event.request.headers = {};
    if (event.request.url) {
      try {
        const url = new URL(event.request.url);
        url.search = '';
        url.hash = '';
        event.request.url = url.toString();
      } catch {
        event.request.url = '[invalid-url]';
      }
    }
  }
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.contexts;
  if (event.message) event.message = '[redacted]';
  if (event.exception && Array.isArray(event.exception.values)) {
    for (const value of event.exception.values) {
      value.value = '[redacted]';
      if (value.stacktrace && Array.isArray(value.stacktrace.frames)) {
        for (const frame of value.stacktrace.frames) {
          delete frame.vars;
          delete frame.context_line;
          delete frame.pre_context;
          delete frame.post_context;
        }
      }
    }
  }
  if (event.tags) {
    const allowedTags = ['error.type', 'http.method', 'http.route', 'request.id', 'frontend.page'];
    event.tags = Object.fromEntries(
      Object.entries(event.tags).filter(([key]) => allowedTags.includes(key))
    );
  }
  return event;
}

function initializeMonitoring() {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    beforeSend: scrubEvent
  });
  initialized = true;
}

function captureException(error, req) {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    scope.setTag('error.type', error && error.name ? error.name : 'Error');
    if (req) {
      scope.setTag('http.method', req.method);
      scope.setTag('http.route', req.route && req.route.path
        ? `${req.baseUrl || ''}${req.route.path}`
        : req.path);
      if (req.id) scope.setTag('request.id', req.id);
    }
    Sentry.captureException(error);
  });
}

function captureFrontendSignal({ eventType, page, requestId }) {
  if (!initialized) return false;
  Sentry.withScope((scope) => {
    scope.setTag('error.type', eventType);
    scope.setTag('frontend.page', page);
    if (requestId) scope.setTag('request.id', requestId);
    Sentry.captureMessage('frontend.runtime_error', 'error');
  });
  return true;
}

module.exports = { initializeMonitoring, captureException, captureFrontendSignal, scrubEvent };
