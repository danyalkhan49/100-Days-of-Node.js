const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const transactions = require('../utils/requiredTransaction');
const notifications = require('../utils/notifications');
const errorHandler = require('../middleware/errorHandler');

const requesterId = '507f1f77bcf86cd799439011';
const donorId = '507f1f77bcf86cd799439012';
const adminId = '507f1f77bcf86cd799439014';
const jwtSecret = 'lifelink-request-creation-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;
const originalMaxRequests = process.env.MAX_REQUESTS_PER_REQUESTER;
const originalMaxPrescriptionMb = process.env.MAX_PRESCRIPTION_MB;
const originalUserFindById = User.findById;
const originalUserUpdateOne = User.updateOne;
const originalRequestCountDocuments = BloodRequest.countDocuments;
const originalRequestCreate = BloodRequest.create;
const originalWithRequiredTransaction = transactions.withRequiredTransaction;
const originalDispatchNotification = notifications.dispatchNotification;
const originalNotifyMatchingDonors = notifications.notifyMatchingDonors;

let server;
let baseUrl;
let existingRequests;
let createdRequests;
let sequenceUpdates;
let dispatchedNotifications;
let allowRequester;

function installMocks() {
  existingRequests = 0;
  createdRequests = [];
  sequenceUpdates = [];
  dispatchedNotifications = [];
  allowAccounts = true;
  const usersById = {
    [requesterId]: { _id: requesterId, role: 'requester', isActive: true, authVersion: 0 },
    [donorId]: { _id: donorId, role: 'donor', isActive: true, authVersion: 0 },
    [adminId]: { _id: adminId, role: 'admin', isActive: true, authVersion: 0 }
  };
  User.findById = (id) => ({
    select() {
      return this;
    },
    then(resolve, reject) {
      const user = allowAccounts ? usersById[String(id)] || null : null;
      return Promise.resolve(user).then(resolve, reject);
    }
  });
  User.updateOne = async (filter, update) => {
    sequenceUpdates.push({ filter, update });
    const user = usersById[String(filter._id)];
    const allowedRoles = filter.role && filter.role.$in;
    return {
      matchedCount: allowAccounts && user && allowedRoles.includes(user.role) ? 1 : 0
    };
  };
  BloodRequest.countDocuments = (filter) => ({
    session(session) {
      assert.equal(session, testSession);
      assert.ok([requesterId, donorId].includes(String(filter.requester)));
      return Promise.resolve(existingRequests);
    }
  });
  BloodRequest.create = async (documents, options) => {
    assert.equal(options.session, testSession);
    createdRequests.push(documents[0]);
    return [{
      ...documents[0],
      _id: '507f1f77bcf86cd799439013',
      status: 'Open',
      unitsFulfilled: 0,
      toObject() {
        return { ...this };
      }
    }];
  };
}

const testSession = {};
transactions.withRequiredTransaction = async (operation) => operation(testSession);
notifications.dispatchNotification = (work, label) => {
  dispatchedNotifications.push({ work, label });
};
notifications.notifyMatchingDonors = async (request) => {
  dispatchedNotifications.push({ request, label: 'matching-donors' });
};
installMocks();

process.env.MAX_REQUESTS_PER_REQUESTER = '2';
process.env.MAX_PRESCRIPTION_MB = '5';
const app = express();
app.use(express.json());
app.use('/requests', require('../routes/requestRoutes'));
app.use(errorHandler);

function tokenFor(id = requesterId) {
  return jwt.sign({ id, authVersion: 0 }, jwtSecret, { expiresIn: '1h' });
}

async function postRequest(body, token = tokenFor()) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/requests`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function validRequest() {
  return {
    patientName: 'Test patient',
    bloodGroup: 'O+',
    unitsNeeded: 2,
    hospital: 'Test hospital',
    city: 'Lahore',
    urgency: 'Urgent',
    neededBy: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    note: 'Please contact the hospital.'
  };
}

test('authenticated blood request creation reuses protected route and matching-donor notification workflow', async (t) => {
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
    User.findById = originalUserFindById;
    User.updateOne = originalUserUpdateOne;
    BloodRequest.countDocuments = originalRequestCountDocuments;
    BloodRequest.create = originalRequestCreate;
    transactions.withRequiredTransaction = originalWithRequiredTransaction;
    notifications.dispatchNotification = originalDispatchNotification;
    notifications.notifyMatchingDonors = originalNotifyMatchingDonors;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalMaxRequests === undefined) delete process.env.MAX_REQUESTS_PER_REQUESTER;
    else process.env.MAX_REQUESTS_PER_REQUESTER = originalMaxRequests;
    if (originalMaxPrescriptionMb === undefined) delete process.env.MAX_PRESCRIPTION_MB;
    else process.env.MAX_PRESCRIPTION_MB = originalMaxPrescriptionMb;
  });

  await t.test('rejects guests and keeps admin access separate', async () => {
    const guest = await postRequest(validRequest(), null);
    assert.equal(guest.status, 401);

    const admin = await postRequest(validRequest(), tokenFor(adminId));
    assert.equal(admin.status, 403);
    assert.equal(createdRequests.length, 0);
  });

  await t.test('validates required and supported form values before persistence', async () => {
    for (const body of [
      { ...validRequest(), patientName: '' },
      { ...validRequest(), bloodGroup: 'X+' },
      { ...validRequest(), unitsNeeded: 11 },
      { ...validRequest(), neededBy: new Date(Date.now() - 1000).toISOString() }
    ]) {
      const result = await postRequest(body);
      assert.equal(result.status, 400);
    }
    assert.equal(createdRequests.length, 0);
  });

  await t.test('existing requester creates a request and identity is derived from authentication', async () => {
    const body = { ...validRequest(), requester: adminId };
    const result = await postRequest(body);

    assert.equal(result.status, 201);
    assert.equal(createdRequests.length, 1);
    assert.equal(String(createdRequests[0].requester), requesterId);
    assert.equal(result.body.data.requester, requesterId);
    assert.equal(sequenceUpdates.length, 1);
    assert.equal(dispatchedNotifications.length, 1);
    assert.equal(dispatchedNotifications[0].label, 'New request');
    await dispatchedNotifications[0].work();
    assert.equal(dispatchedNotifications[1].label, 'matching-donors');
    assert.equal(dispatchedNotifications[1].request._id, result.body.data._id);
  });

  await t.test('existing donor can create a request while retaining the stored donor role', async () => {
    const result = await postRequest(validRequest(), tokenFor(donorId));

    assert.equal(result.status, 201);
    assert.equal(createdRequests.length, 1);
    assert.equal(String(createdRequests[0].requester), donorId);
    assert.deepEqual(sequenceUpdates[0].filter.role.$in, ['donor', 'requester']);
    assert.equal(dispatchedNotifications.length, 1);
    assert.equal(dispatchedNotifications[0].label, 'New request');
  });

  await t.test('enforces the configured open-request limit', async () => {
    existingRequests = 2;
    const result = await postRequest(validRequest());

    assert.equal(result.status, 400);
    assert.match(result.body.error, /no more than 2 open blood requests/);
    assert.equal(createdRequests.length, 0);
    assert.equal(dispatchedNotifications.length, 0);
  });

  await t.test('subsequent submissions at a one-request limit cannot create duplicates', async () => {
    process.env.MAX_REQUESTS_PER_REQUESTER = '1';
    const first = await postRequest(validRequest());
    existingRequests = 1;
    const repeated = await postRequest(validRequest());

    assert.equal(first.status, 201);
    assert.equal(repeated.status, 400);
    assert.equal(createdRequests.length, 1);
    assert.equal(dispatchedNotifications.length, 1);
  });
});
