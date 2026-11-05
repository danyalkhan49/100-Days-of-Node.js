const express = require('express');
const AppError = require('../utils/AppError');
const { captureFrontendSignal } = require('../utils/monitoring');
const { telemetryLimiter } = require('../middleware/rateLimiters');
const mongoose = require('mongoose');
const { applicationLifecycle, createHealthHandlers } = require('../utils/healthChecks');

const router = express.Router();
const healthHandlers = createHealthHandlers({
  connection: mongoose.connection,
  lifecycle: applicationLifecycle
});

router.post('/client-error', telemetryLimiter, (req, res, next) => {
  const { eventType, page } = req.body || {};
  if (!['error', 'unhandledrejection'].includes(eventType) ||
      typeof page !== 'string' || !/^\/[a-z0-9._/-]{0,100}$/i.test(page)) {
    return next(new AppError('Invalid client error event.', 400));
  }
  if (!captureFrontendSignal({ eventType, page, requestId: req.id })) {
    return res.status(503).json({ success: false, error: 'Error monitoring is not configured.' });
  }
  return res.status(202).json({ success: true });
});

router.get('/health', healthHandlers.readiness);

module.exports = router;
