const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Block = require('../models/Block');
const InAppNotification = require('../models/InAppNotification');
const errorHandler = require('../middleware/errorHandler');
const { createInAppNotification } = require('../utils/inAppNotifications');
const notifications = require('../utils/notifications');

const userId = '507f1f77bcf86cd799439011';
const otherUserId = '507f1f77bcf86cd799439012';
const jwtSecret = 'lifelink-in-app-notifications-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;
const originalUserMethods = {
  findById: User.findById,
  find: User.find
};
const originalBlockFind = Block.find;
const originalNotificationMethods = {
  countDocuments: InAppNotification.countDocuments,
  find: InAppNotification.find,
  findOneAndUpdate: InAppNotification.findOneAndUpdate,
  updateMany: InAppNotification.updateMany,
  exists: InAppNotification.exists,
  findOne: InAppNotification.findOne,
  deleteOne: InAppNotification.deleteOne,
  create: InAppNotification.create
};

let server;
let baseUrl;
let records;
let capturedFilters;
let capturedUpdates;
let createdRecords;
let testUser;

function makeQuery(value) {
  const query = {
    sort() { return this; },
    skip(value) { query.skipValue = value; return this; },
    limit(value) { query.limitValue = value; return this; },
    select() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
  };
  return query;
}

function tokenFor(id = userId) {
  return jwt.sign({ id, authVersion: 0 }, jwtSecret, { expiresIn: '1h' });
}

async function request(path, { method = 'GET', token = tokenFor(), body } = {}) {
  const headers = {};
  const options = { method, headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

function installMocks() {
  records = [];
  capturedFilters = [];
  capturedUpdates = [];
  createdRecords = [];
  testUser = { _id: userId, role: 'requester', isActive: true, authVersion: 0 };

  User.findById = (id) => {
    const user = String(id) === userId ? testUser : null;
    return {
      select() { return this; },
      then(resolve, reject) { return Promise.resolve(user).then(resolve, reject); }
    };
  };
  User.find = () => ({
    select() { return this; },
    lean() {
      return Promise.resolve([{
        _id: new mongoose.Types.ObjectId(),
        emailVerified: false,
        phoneVerified: false,
        notificationPreferences: { email: false, sms: false, whatsapp: false },
        bloodGroup: 'O-',
        lastDonationDate: null
      }]);
    }
  });
  Block.find = () => ({
    select() { return this; },
    lean() { return Promise.resolve([]); }
  });

  InAppNotification.countDocuments = async (filter) => {
    capturedFilters.push(filter);
    return filter.isRead === false ? records.filter((item) =>
      item.recipient === filter.recipient && !item.isRead
    ).length : records.filter((item) => item.recipient === filter.recipient).length;
  };
  InAppNotification.find = (filter) => {
    capturedFilters.push(filter);
    const query = makeQuery(records.filter((item) => item.recipient === filter.recipient));
    const originalSkip = query.skip;
    const originalLimit = query.limit;
    query.skip = function (value) { originalSkip.call(this, value); return this; };
    query.limit = function (value) { originalLimit.call(this, value); return this; };
    query.lean = function () {
      return Promise.resolve(records.filter((item) => item.recipient === filter.recipient)
        .slice(query.skipValue || 0, (query.skipValue || 0) + (query.limitValue || 20)));
    };
    return query;
  };
  InAppNotification.findOneAndUpdate = (filter, update) => {
    capturedFilters.push(filter);
    capturedUpdates.push(update);
    const item = records.find((record) =>
      record._id === String(filter._id) &&
      record.recipient === filter.recipient &&
      (filter.isRead === undefined || record.isRead === filter.isRead)
    );
    if (item && update.$set) Object.assign(item, update.$set);
    return { select: () => Promise.resolve(item || null) };
  };
  InAppNotification.updateMany = async (filter, update) => {
    capturedFilters.push(filter);
    capturedUpdates.push(update);
    let modifiedCount = 0;
    for (const item of records) {
      if (item.recipient === filter.recipient && item.isRead === filter.isRead) {
        Object.assign(item, update.$set);
        modifiedCount += 1;
      }
    }
    return { modifiedCount };
  };
  InAppNotification.exists = async (filter) => {
    capturedFilters.push(filter);
    return records.find((item) =>
      item._id === String(filter._id) && item.recipient === filter.recipient
    ) || null;
  };
  InAppNotification.findOne = (filter) => {
    capturedFilters.push(filter);
    const item = records.find((record) =>
      record._id === String(filter._id) && record.recipient === filter.recipient
    );
    return { select: () => Promise.resolve(item || null) };
  };
  InAppNotification.deleteOne = async (filter) => {
    capturedFilters.push(filter);
    const index = records.findIndex((item) =>
      item._id === String(filter._id) && item.recipient === filter.recipient
    );
    if (index < 0) return { deletedCount: 0 };
    records.splice(index, 1);
    return { deletedCount: 1 };
  };
  InAppNotification.create = async (documents, options) => {
    createdRecords.push({ documents, options });
    const data = documents[0];
    if (createdRecords.some((entry) => entry !== createdRecords.at(-1) &&
        entry.documents[0].eventKey === data.eventKey &&
        String(entry.documents[0].recipient) === String(data.recipient))) {
      const error = new Error('duplicate');
      error.code = 11000;
      throw error;
    }
    const record = { ...data, _id: new mongoose.Types.ObjectId() };
    records.push(record);
    return [record];
  };
}

const app = express();
app.use(express.json());
app.use('/notifications', require('../routes/notificationRoutes'));
app.use(errorHandler);

test('authenticated in-app notification inbox and triggers', async (t) => {
  process.env.JWT_SECRET = jwtSecret;
  installMocks();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.beforeEach(installMocks);
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    User.findById = originalUserMethods.findById;
    User.find = originalUserMethods.find;
    Block.find = originalBlockFind;
    for (const [name, method] of Object.entries(originalNotificationMethods)) {
      InAppNotification[name] = method;
    }
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  await t.test('requires a valid authenticated user', async () => {
    const result = await request('/notifications/inbox', { token: null });
    assert.equal(result.status, 401);
  });

  await t.test('lists only owned notices and enforces bounded pagination', async () => {
    records = [
      { _id: 'notice-1', recipient: userId, title: 'First', isRead: false },
      { _id: 'notice-2', recipient: otherUserId, title: 'Private', isRead: false },
      { _id: 'notice-3', recipient: userId, title: 'Second', isRead: true }
    ];
    const result = await request('/notifications/inbox?page=2&limit=1');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].title, 'Second');
    assert.deepEqual(capturedFilters[0], { recipient: userId });
    assert.equal(await request('/notifications/inbox?limit=51').then((r) => r.status), 400);
  });

  await t.test('returns unread count scoped to the current user', async () => {
    records = [
      { recipient: userId, isRead: false },
      { recipient: userId, isRead: true },
      { recipient: otherUserId, isRead: false }
    ];
    const result = await request('/notifications/inbox/unread-count');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.count, 1);
    assert.deepEqual(capturedFilters[0], { recipient: userId, isRead: false });
  });

  await t.test('marks an owned notice as read and does not expose another account notice', async () => {
    records = [{ _id: otherUserId, recipient: otherUserId, isRead: false }];
    const denied = await request(`/notifications/inbox/${otherUserId}/read`, { method: 'PATCH' });
    assert.equal(denied.status, 404);
    assert.equal(capturedFilters[0].recipient, userId);

    records = [{ _id: userId, recipient: userId, isRead: false }];
    const updated = await request(`/notifications/inbox/${userId}/read`, { method: 'PATCH' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.isRead, true);
    assert.equal(capturedUpdates[0].$set.isRead, true);
  });

  await t.test('marks all owned notices as read and deletes only an owned notice', async () => {
    records = [
      { _id: userId, recipient: userId, isRead: false },
      { _id: otherUserId, recipient: otherUserId, isRead: false }
    ];
    const allRead = await request('/notifications/inbox/read-all', { method: 'PATCH' });
    assert.equal(allRead.status, 200);
    assert.equal(allRead.body.data.modifiedCount, 1);
    assert.equal(capturedFilters[0].recipient, userId);

    const denied = await request(`/notifications/inbox/${otherUserId}`, { method: 'DELETE' });
    assert.equal(denied.status, 404);
    const removed = await request(`/notifications/inbox/${userId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(records.length, 1);
  });

  await t.test('deduplicates event creation and forwards transaction sessions', async () => {
    const session = { id: 'transaction-session' };
    const payload = {
      eventKey: 'offer-submitted:one',
      recipient: userId,
      title: 'Offer received',
      message: 'A donor made an offer.',
      type: 'offer-submitted'
    };
    assert.ok(await createInAppNotification(payload, session));
    assert.equal(createdRecords[0].options.session, session);
    assert.equal(await createInAppNotification(payload), null);
    assert.equal(createdRecords.length, 2);
  });

  await t.test('new compatible requests create an inbox notice independent of email preferences', async () => {
    const donorId = new mongoose.Types.ObjectId();
    User.find = () => ({
      select() {
        return {
          lean: async () => [{
            _id: donorId,
            emailVerified: false,
            phoneVerified: false,
            notificationPreferences: { email: false, sms: false, whatsapp: false },
            bloodGroup: 'O-',
            lastDonationDate: null
          }]
        };
      }
    });
    Block.find = () => ({ select() { return { lean: async () => [] }; } });

    const requestId = new mongoose.Types.ObjectId();
    await notifications.notifyMatchingDonors({
      _id: requestId,
      requester: otherUserId,
      urgency: 'Normal',
      bloodGroup: 'O-',
      city: 'Lahore'
    });
    await new Promise((resolve) => setImmediate(resolve));
    const notice = createdRecords.flatMap((entry) => entry.documents)
      .find((item) => item.type === 'new-request');
    assert.ok(notice);
    assert.equal(String(notice.recipient), String(donorId));
    assert.equal(String(notice.request), String(requestId));
  });

  await t.test('completion and request closure create the corresponding event notices', async () => {
    const requestId = new mongoose.Types.ObjectId();
    const offerId = new mongoose.Types.ObjectId();
    await notifications.notifyDonationCompleted({
      offerId,
      requestId,
      donorId: userId,
      requesterId: otherUserId,
      city: 'Lahore',
      requestFulfilled: true
    });
    notifications.notifyRequestCanceled({
      requestId,
      requesterId: userId,
      offers: [{ _id: offerId, donor: otherUserId }]
    });
    await new Promise((resolve) => setImmediate(resolve));
    const noticeTypes = createdRecords.flatMap((entry) => entry.documents)
      .map((item) => item.type);
    assert.ok(noticeTypes.includes('donation-completed'));
    assert.ok(noticeTypes.includes('request-fulfilled'));
    assert.equal(noticeTypes.filter((type) => type === 'request-canceled').length, 2);
  });
});
