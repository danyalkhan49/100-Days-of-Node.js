require('dotenv').config();

const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_URL = process.env.HEALTHCHECK_URL ||
  `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}${process.env.HEALTHCHECK_PATH || '/health'}`;

function parseBody(raw) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isHealthyResponse(statusCode, body) {
  if (!(statusCode >= 200 && statusCode < 400)) {
    return false;
  }

  if (!body) {
    return true;
  }

  if (typeof body === 'string') {
    const normalized = body.trim().toLowerCase();
    return ['ok', 'healthy', 'up', 'running', 'success', 'ready'].includes(normalized);
  }

  if (typeof body === 'object' && !Array.isArray(body)) {
    const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
    const healthIndicators = [
      body.ok === true,
      body.healthy === true,
      ['ok', 'healthy', 'up', 'running', 'success', 'ready'].includes(status),
      typeof body.platform === 'string',
      typeof body.uptimeMinutes === 'number',
      typeof body.uptime === 'number',
      typeof body.uptimeSeconds === 'number',
      typeof body.totalMemoryGB === 'number',
      typeof body.freeMemoryGB === 'number',
      typeof body.dbConnectionState === 'number',
      typeof body.databaseState === 'number',
      typeof body.mongooseConnectionState === 'number',
      typeof body.readyState === 'number'
    ];

    return healthIndicators.some(Boolean);
  }

  return true;
}

function request(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        'User-Agent': 'lifelink-healthcheck/1.0'
      }
    };

    const req = client.request(requestOptions, (res) => {
      let raw = '';

      res.on('data', (chunk) => {
        raw += chunk;
      });

      res.on('end', () => {
        const body = parseBody(raw);

        if (res.statusCode >= 200 && res.statusCode < 400) {
          if (!body || isHealthyResponse(res.statusCode, body)) {
            resolve({
              ok: true,
              statusCode: res.statusCode,
              body
            });
            return;
          }

          reject(new Error(`Health check failed: unexpected response body (${res.statusCode}) ${raw}`));
          return;
        }

        reject(new Error(`Health check failed with HTTP status ${res.statusCode}: ${raw}`));
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Health check timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const targetUrl = DEFAULT_URL;

  try {
    const result = await request(targetUrl);
    console.log(`Health check passed: ${targetUrl} (${result.statusCode})`);
    process.exitCode = 0;
  } catch (error) {
    console.error(`Health check failed: ${targetUrl}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
