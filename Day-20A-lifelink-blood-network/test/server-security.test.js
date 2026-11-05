const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const previousAllowedOrigin = process.env.ALLOWED_ORIGIN;
process.env.ALLOWED_ORIGIN = 'https://allowed.example.invalid';
const { app } = require('../server');

test('CORS permits configured origins and returns the existing global security headers', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    if (previousAllowedOrigin === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = previousAllowedOrigin;
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/live`, {
    headers: { Origin: 'https://allowed.example.invalid' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://allowed.example.invalid');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(self)');
  assert.equal(response.headers.get('strict-transport-security'), null);
});

test('CORS rejects disallowed origins and allows same-origin or requests without Origin', async () => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const rejected = await fetch(`${base}/live`, { headers: { Origin: 'https://other.example.invalid' } });
    assert.equal(rejected.status, 403);
    assert.deepEqual(await rejected.json(), { success: false, error: 'Origin is not allowed.' });

    const sameOrigin = await fetch(`${base}/live`, { headers: { Origin: base } });
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.headers.get('access-control-allow-origin'), base);

    const noOrigin = await fetch(`${base}/live`);
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
