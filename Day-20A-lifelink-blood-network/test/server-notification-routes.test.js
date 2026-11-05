const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const InAppNotification = require('../models/InAppNotification');
const { app, registerRoutes } = require('../server');

const userId = '507f1f77bcf86cd799439011';
const jwtSecret = 'lifelink-server-notification-routes-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;
const originalUserFindById = User.findById;
const originalCountDocuments = InAppNotification.countDocuments;
const originalFind = InAppNotification.find;

test('server mounts authenticated notification inbox routes at both supported prefixes', async (t) => {
  process.env.JWT_SECRET = jwtSecret;
  User.findById = (id) => ({
    select() {
      return this;
    },
    then(resolve, reject) {
      const user = String(id) === userId
        ? { _id: userId, role: 'requester', isActive: true, authVersion: 0 }
        : null;
      return Promise.resolve(user).then(resolve, reject);
    }
  });
  InAppNotification.countDocuments = async (filter) => {
    assert.equal(String(filter.recipient), userId);
    return 0;
  };
  InAppNotification.find = (filter) => {
    assert.equal(String(filter.recipient), userId);
    const query = {
      select() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      lean() { return Promise.resolve([]); }
    };
    return query;
  };

  registerRoutes();
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1');
    listeningServer.once('listening', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    User.findById = originalUserFindById;
    InAppNotification.countDocuments = originalCountDocuments;
    InAppNotification.find = originalFind;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ id: userId, authVersion: 0 }, jwtSecret, { expiresIn: '1m' });
  const get = async (path, withToken = true) => {
    const headers = { Accept: 'application/json' };
    if (withToken) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, { headers });
    return { status: response.status, body: await response.json() };
  };

  const unauthenticated = await get('/notifications/inbox', false);
  assert.equal(unauthenticated.status, 401);

  for (const prefix of ['/notifications', '/api/notifications']) {
    const inbox = await get(`${prefix}/inbox`);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.success, true);
    assert.deepEqual(inbox.body.data, []);

    const unreadCount = await get(`${prefix}/inbox/unread-count`);
    assert.equal(unreadCount.status, 200);
    assert.deepEqual(unreadCount.body.data, { count: 0 });
  }
});
