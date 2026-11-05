const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

function createGracefulShutdown({
  server,
  stopWorkers = [],
  closeDatabase,
  closeStorage,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  forceShutdown = () => process.exit(1),
  logger = console,
  onShutdownStart,
  removeSignalHandlers
}) {
  if (!Array.isArray(stopWorkers) ||
      typeof closeDatabase !== 'function' ||
      typeof closeStorage !== 'function' ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      typeof forceShutdown !== 'function') {
    throw new TypeError('Graceful shutdown dependencies are invalid.');
  }

  let shutdownPromise;

  function logFailure(resource) {
    if (logger && typeof logger.error === 'function') {
      logger.error(`Graceful shutdown failed while stopping ${resource}.`);
    }
  }

  async function stopResource(resource, close) {
    try {
      await close();
    } catch {
      logFailure(resource);
    }
  }

  function closeHttpServer() {
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') logFailure('HTTP server');
          resolve();
        });
      } catch {
        logFailure('HTTP server');
        resolve();
      }
    });
  }

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;

    if (typeof onShutdownStart === 'function') {
      try {
        onShutdownStart();
      } catch {
        logFailure('shutdown state');
      }
    }

    shutdownPromise = (async () => {
      let timeout;
      const deadline = new Promise((resolve) => {
        timeout = setTimeout(() => {
          if (server && typeof server.closeAllConnections === 'function') {
            try {
              server.closeAllConnections();
            } catch {
              logFailure('HTTP connections');
            }
          }
          forceShutdown();
          resolve();
        }, timeoutMs);
      });

      const shutdownWork = (async () => {
        const workerStops = stopWorkers.map((stopWorker) =>
          stopResource('background worker', stopWorker)
        );
        await Promise.all([closeHttpServer(), ...workerStops]);
        await stopResource('MongoDB', closeDatabase);
        await stopResource('storage client', closeStorage);
        if (typeof removeSignalHandlers === 'function') {
          await stopResource('signal handlers', removeSignalHandlers);
        }
      })();

      try {
        await Promise.race([shutdownWork, deadline]);
      } finally {
        clearTimeout(timeout);
      }
    })();

    return shutdownPromise;
  }

  return Object.freeze({ shutdown });
}

async function cleanupStartupFailure(startupError, options) {
  const shutdown = createGracefulShutdown(options);
  await shutdown.shutdown();
  throw startupError;
}

module.exports = {
  createGracefulShutdown,
  cleanupStartupFailure,
  DEFAULT_SHUTDOWN_TIMEOUT_MS
};
