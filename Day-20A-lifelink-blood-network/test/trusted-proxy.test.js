const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { configureTrustedProxy, parseTrustedProxyHops } = require('../utils/trustedProxy');

test('trusted proxy parsing preserves the unset default and accepts supported hop counts', () => {
  assert.equal(parseTrustedProxyHops(undefined), undefined);
  const app = express();
  assert.equal(configureTrustedProxy(app, undefined), undefined);
  assert.equal(app.get('trust proxy'), false);
  for (let hops = 1; hops <= 10; hops += 1) {
    assert.equal(parseTrustedProxyHops(String(hops)), hops);
  }
});

test('trusted proxy parsing rejects malformed, fractional, and out-of-range values', () => {
  for (const value of ['', '0', '11', '1.5', '-1', 'abc', ' 1', '1 ']) {
    assert.throws(() => parseTrustedProxyHops(value), {
      message: 'TRUST_PROXY_HOPS must be an integer from 1 to 10.'
    });
  }
});

test('Express uses configured trusted hops for client IP and protocol forwarded headers', async (t) => {
  const app = express();
  configureTrustedProxy(app, '1');
  app.get('/', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`, {
    headers: {
      'X-Forwarded-For': '198.51.100.20, 203.0.113.30',
      'X-Forwarded-Proto': 'https, http'
    }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ip: '203.0.113.30', protocol: 'https' });
});

test('Express ignores forwarded headers when proxy trust is unset', async (t) => {
  const app = express();
  configureTrustedProxy(app, undefined);
  app.get('/', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
    headers: { 'X-Forwarded-For': '198.51.100.20', 'X-Forwarded-Proto': 'https' }
  });
  assert.deepEqual(await response.json(), { ip: '127.0.0.1', protocol: 'http' });
});
