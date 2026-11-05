const applicationLifecycle = {
  started: false,
  shuttingDown: false
};

function createHealthHandlers({
  connection,
  lifecycle = applicationLifecycle
} = {}) {
  if (!connection || typeof lifecycle.started !== 'boolean' ||
      typeof lifecycle.shuttingDown !== 'boolean') {
    throw new TypeError('Health check dependencies are invalid.');
  }

  function liveness(_req, res) {
    return res.status(200).json({ status: 'ok' });
  }

  function readiness(_req, res) {
    const ready = lifecycle.started &&
      !lifecycle.shuttingDown &&
      connection.readyState === 1;
    return res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable'
    });
  }

  return Object.freeze({ liveness, readiness });
}

module.exports = { applicationLifecycle, createHealthHandlers };
