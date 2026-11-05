const path = require('path');
const dotenv = require('dotenv');

function loadProjectEnvironment(envPath = path.join(__dirname, '.env')) {
  return dotenv.config({ path: envPath });
}

if (require.main === module) loadProjectEnvironment();

const crypto = require('crypto');
const { initializeMonitoring } = require('./utils/monitoring');
const { getJwtSecret } = require('./utils/jwtSecret');
const { configureTrustedProxy } = require('./utils/trustedProxy');
const { assertProductionConfigForStartup } = require('./utils/productionConfig');
const { assertStagingConfigForStartup } = require('./utils/stagingConfig');

const mongoose = require('mongoose');
const express = require('express');
const connectDB = require('./config/db');
const { initializeStorage } = require('./config/storage');
const StorageCleanupJob = require('./models/StorageCleanupJob');
const StorageReconciliationState = require('./models/StorageReconciliationState');
const User = require('./models/User');
const BloodRequest = require('./models/BloodRequest');
const { startStorageCleanupWorker } = require('./utils/storageCleanupWorker');
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const { startRequestExpiryCleanup } = require('./utils/requestExpiry');
const {
  createGracefulShutdown,
  cleanupStartupFailure,
  DEFAULT_SHUTDOWN_TIMEOUT_MS
} = require('./utils/gracefulShutdown');
const {
  applicationLifecycle,
  createHealthHandlers
} = require('./utils/healthChecks');
const {
  startCriticalNotificationWorker,
  startEligibilityReminderWorker,
  startNotificationRetryWorker
} = require('./utils/notifications');

const app = express();
const publicDirectory = path.join(__dirname, 'public');
const healthcheckPath = process.env.HEALTHCHECK_PATH || '/health';
const healthHandlers = createHealthHandlers({
  connection: mongoose.connection,
  lifecycle: applicationLifecycle
});
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('ALLOWED_ORIGIN must contain valid HTTP or HTTPS origins.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('ALLOWED_ORIGIN must contain valid HTTP or HTTPS origins.');
    }
    return parsed.origin;
  });
let routesRegistered = false;

app.use(logger);
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
});
app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)'
  });
  next();
});
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (!origin) return next();

  let requestOrigin;
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    return res.status(403).json({ success: false, error: 'Origin is not allowed.' });
  }
  const sameOrigin = requestOrigin === `${req.protocol}://${req.get('host')}`;
  if (!sameOrigin && !allowedOrigins.includes(requestOrigin)) {
    return res.status(403).json({ success: false, error: 'Origin is not allowed.' });
  }

  res.vary('Origin');
  res.set('Access-Control-Allow-Origin', requestOrigin);
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Accept,Authorization,Content-Type');
  res.set('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use('/uploads/avatars', require('./routes/avatarRoutes'));
app.use(
  express.static(publicDirectory, {
    dotfiles: 'ignore',
    index: false
  })
);

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDirectory, 'index.html'));
});

app.get('/live', healthHandlers.liveness);
app.get('/ready', healthHandlers.readiness);
app.get(healthcheckPath, healthHandlers.readiness);

function registerRoutes() {
  if (routesRegistered) return;

  const routes = [
    [['/api/system'], './routes/systemRoutes'],
    [['/api/auth', '/auth'], './routes/authRoutes'],
    [['/api/users', '/users'], './routes/userRoutes'],
    [['/api/donors', '/donors'], './routes/donorRoutes'],
    [['/api/requests', '/requests'], './routes/requestRoutes'],
    [['/api/offers', '/offers'], './routes/offerRoutes'],
    [['/api/reports', '/reports'], './routes/reportRoutes'],
    [['/api/support', '/support'], './routes/supportRoutes'],
    [['/api/notifications', '/notifications'], './routes/notificationRoutes'],
    [['/api/hospitals', '/hospitals'], './routes/hospitalRoutes'],
    [['/api/reviews', '/reviews'], './routes/reviewRoutes'],
    [['/api/admin', '/admin'], './routes/adminRoutes']
  ];

  for (const [prefixes, routePath] of routes) {
    const router = require(routePath);
    if (typeof router !== 'function') {
      throw new TypeError(`${routePath} must export an Express router`);
    }

    for (const prefix of prefixes) app.use(prefix, router);
  }

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found' });
  });

  app.use(errorHandler);
  routesRegistered = true;
}

async function startServer() {
  assertProductionConfigForStartup();
  assertStagingConfigForStartup();
  getJwtSecret();
  initializeMonitoring();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  configureTrustedProxy(app);

  if (!healthcheckPath.startsWith('/')) {
    throw new Error('HEALTHCHECK_PATH must start with /');
  }

  const stopWorkers = [];
  let storageRuntime;
  let server;
  try {
    registerRoutes();
    await connectDB();
    console.log('MongoDB connected successfully');
    storageRuntime = initializeStorage();
    app.locals.storage = storageRuntime;
    stopWorkers.push(startRequestExpiryCleanup());
    stopWorkers.push(startCriticalNotificationWorker());
    stopWorkers.push(startEligibilityReminderWorker());
    stopWorkers.push(startNotificationRetryWorker());
    stopWorkers.push(startStorageCleanupWorker({
      StorageCleanupJob,
      StorageReconciliationState,
      User,
      BloodRequest,
      getStorage: () => storageRuntime
    }));

    server = await new Promise((resolve, reject) => {
      const listeningServer = app.listen(port);
      server = listeningServer;
      const onError = (error) => {
        listeningServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        listeningServer.off('error', onError);
        console.log(`LifeLink is available at http://localhost:${port}`);
        resolve(listeningServer);
      };
      listeningServer.once('error', onError);
      listeningServer.once('listening', onListening);
    });
  } catch (error) {
    await cleanupStartupFailure(error, {
      server,
      stopWorkers,
      closeDatabase: () => mongoose.disconnect(),
      closeStorage: () => storageRuntime && storageRuntime.close(),
      timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
      onShutdownStart: () => {
        applicationLifecycle.started = false;
        applicationLifecycle.shuttingDown = true;
      }
    });
  }
  server.on('error', (error) => console.error('HTTP server error:', error.message));
  const shutdown = createGracefulShutdown({
    server,
    stopWorkers,
    closeDatabase: () => mongoose.disconnect(),
    closeStorage: () => storageRuntime && storageRuntime.close(),
    timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
    forceShutdown: () => process.exit(1),
    onShutdownStart: () => {
      applicationLifecycle.shuttingDown = true;
    },
    removeSignalHandlers: () => {
      process.off('SIGTERM', handleSignal);
      process.off('SIGINT', handleSignal);
    }
  });
  const handleSignal = () => {
    void shutdown.shutdown();
  };
  server.once('close', () => {
    applicationLifecycle.started = false;
    applicationLifecycle.shuttingDown = true;
  });
  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);
  applicationLifecycle.started = true;
  applicationLifecycle.shuttingDown = false;
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Server startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, registerRoutes, startServer, loadProjectEnvironment };
