const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const Offer = require('../models/Offer');
const InAppNotification = require('../models/InAppNotification');
const notifications = require('../utils/notifications');
const errorHandler = require('../middleware/errorHandler');
const { expireRequests } = require('../utils/requestExpiry');

const testUri = process.env.LIFELINK_TEST_MONGO_URI;
const jwtSecret = 'lifelink-request-offer-concurrency-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;
const originalMaxRequests = process.env.MAX_REQUESTS_PER_REQUESTER;
const originalMaxOffers = process.env.MAX_ACTIVE_OFFERS;
const originalMaxPrescriptionMb = process.env.MAX_PRESCRIPTION_MB;
const originalDispatchNotification = notifications.dispatchNotification;
const fixtureIds = { users: [], requests: [], offers: [] };
let server;
let baseUrl;
let runId;

function assertIsolatedLoopbackTestUri(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('LIFELINK_TEST_MONGO_URI must be a valid isolated MongoDB test URI.');
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) ||
      !/(?:^|_)test$/i.test(database)) {
    throw new Error('Concurrency tests only connect to a loopback MongoDB database whose name ends in test.');
  }
}

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), authVersion: user.authVersion || 0 }, jwtSecret, {
    expiresIn: '1h'
  });
}

async function postJson(path, user, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenFor(user)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function putJson(path, user) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenFor(user)}` }
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(path, user) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: ['Bearer', tokenFor(user)].join(' ') }
  });
  return { status: response.status, body: await response.json() };
}

async function createUser(role, index) {
  const user = await User.create({
    name: `Concurrency ${role} ${index}`,
    email: `${runId}-${role}-${index}@example.invalid`,
    password: 'TestPassword123!',
    phone: `+923001${String(index).padStart(6, '0')}`,
    city: 'Lahore',
    role,
    isActive: true,
    emailVerified: true,
    ...(role === 'donor' ? { bloodGroup: 'O-', isAvailable: true } : {})
  });
  fixtureIds.users.push(user._id);
  return user;
}

async function createRequest(requester, unitsNeeded = 1) {
  const request = await BloodRequest.create({
    requester: requester._id,
    patientName: 'Concurrency test patient',
    bloodGroup: 'O-',
    unitsNeeded,
    hospital: 'Test hospital',
    city: 'Lahore',
    neededBy: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  fixtureIds.requests.push(request._id);
  return request;
}

async function createOffer(request, donor, status = 'Pending') {
  const offer = await Offer.create({
    request: request._id,
    donor: donor._id,
    status
  });
  fixtureIds.offers.push(offer._id);
  return offer;
}

function requestBody() {
  return {
    patientName: 'Concurrency test patient',
    bloodGroup: 'O-',
    unitsNeeded: 1,
    hospital: 'Test hospital',
    city: 'Lahore',
    neededBy: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
}

test('request and offer concurrency integration scenarios', {
  skip: !testUri && 'Set LIFELINK_TEST_MONGO_URI to an isolated loopback replica-set test database.'
}, async (t) => {
  assertIsolatedLoopbackTestUri(testUri);
  try {
    await mongoose.connect(testUri, { serverSelectionTimeoutMS: 3000 });
  } catch {
    throw new Error('Could not connect to the isolated concurrency test database; URI details were omitted.');
  }
  const topology = mongoose.connection.client.topology.description.type;
  if (!['ReplicaSetWithPrimary', 'Sharded'].includes(topology)) {
    await mongoose.disconnect();
    t.skip('The isolated concurrency test database must support transactions.');
    return;
  }

  process.env.JWT_SECRET = jwtSecret;
  process.env.MAX_REQUESTS_PER_REQUESTER = '2';
  process.env.MAX_ACTIVE_OFFERS = '2';
  process.env.MAX_PRESCRIPTION_MB = '5';
  notifications.dispatchNotification = () => {};
  runId = new mongoose.Types.ObjectId().toString();

  const app = express();
  app.use(express.json());
  app.use('/api/requests', require('../routes/requestRoutes'));
  app.use('/api/offers', require('../routes/offerRoutes'));
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await Offer.deleteMany({ _id: { $in: fixtureIds.offers } });
    await InAppNotification.deleteMany({ recipient: { $in: fixtureIds.users } });
    await BloodRequest.deleteMany({ _id: { $in: fixtureIds.requests } });
    await User.deleteMany({ _id: { $in: fixtureIds.users } });
    await mongoose.disconnect();
    notifications.dispatchNotification = originalDispatchNotification;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalMaxRequests === undefined) delete process.env.MAX_REQUESTS_PER_REQUESTER;
    else process.env.MAX_REQUESTS_PER_REQUESTER = originalMaxRequests;
    if (originalMaxOffers === undefined) delete process.env.MAX_ACTIVE_OFFERS;
    else process.env.MAX_ACTIVE_OFFERS = originalMaxOffers;
    if (originalMaxPrescriptionMb === undefined) delete process.env.MAX_PRESCRIPTION_MB;
    else process.env.MAX_PRESCRIPTION_MB = originalMaxPrescriptionMb;
  });

  await Promise.all([User.init(), BloodRequest.init(), Offer.init(), InAppNotification.init()]);

  await t.test('simultaneous request creation cannot exceed the requester limit', async () => {
    const requester = await createUser('requester', 1);
    await createRequest(requester);

    const results = await Promise.all([
      postJson('/api/requests', requester, requestBody()),
      postJson('/api/requests', requester, requestBody())
    ]);

    assert.deepEqual(results.map((result) => result.status).sort(), [201, 400]);
    assert.equal(await BloodRequest.countDocuments({
      requester: requester._id,
      status: 'Open',
      neededBy: { $gte: new Date() }
    }), 2);
    const updatedRequester = await User.findById(requester._id).select('+requestCreationSequence');
    assert.equal(updatedRequester.requestCreationSequence, 1);
  });

  await t.test('simultaneous offer submissions cannot exceed the donor active-offer limit', async () => {
    const requester = await createUser('requester', 2);
    const donor = await createUser('donor', 3);
    const existingRequest = await createRequest(requester);
    const targetRequests = [await createRequest(requester), await createRequest(requester)];
    await createOffer(existingRequest, donor);

    const results = await Promise.all(targetRequests.map((request) =>
      postJson('/api/offers', donor, { request: String(request._id) })
    ));

    assert.deepEqual(results.map((result) => result.status).sort(), [201, 400]);
    assert.equal(await Offer.countDocuments({
      donor: donor._id,
      status: { $in: ['Pending', 'Accepted'] }
    }), 2);
    const updatedDonor = await User.findById(donor._id).select('+offerCreationSequence');
    assert.equal(updatedDonor.offerCreationSequence, 1);
  });

  await t.test('simultaneous duplicate offer submissions create only one offer', async () => {
    const requester = await createUser('requester', 4);
    const donor = await createUser('donor', 5);
    const request = await createRequest(requester);

    const results = await Promise.all([
      postJson('/api/offers', donor, { request: String(request._id) }),
      postJson('/api/offers', donor, { request: String(request._id) })
    ]);

    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(await Offer.countDocuments({ request: request._id, donor: donor._id }), 1);
    const updatedDonor = await User.findById(donor._id).select('+offerCreationSequence');
    assert.equal(updatedDonor.offerCreationSequence, 1);
  });

  await t.test('accepted offers keep capacity while canceled offers release it', async () => {
    const requester = await createUser('requester', 18);
    const donor = await createUser('donor', 19);
    const requests = [
      await createRequest(requester),
      await createRequest(requester),
      await createRequest(requester)
    ];
    const firstOffer = await postJson('/api/offers', donor, {
      request: String(requests[0]._id)
    });
    const secondOffer = await postJson('/api/offers', donor, {
      request: String(requests[1]._id)
    });
    assert.equal(firstOffer.status, 201);
    assert.equal(secondOffer.status, 201);

    const accepted = await putJson(
      `/api/offers/${firstOffer.body.data._id}/accept`,
      requester
    );
    assert.equal(accepted.status, 200);
    const atCapacity = await postJson('/api/offers', donor, {
      request: String(requests[2]._id)
    });
    assert.equal(atCapacity.status, 400);

    const canceled = await putJson(
      `/api/offers/${secondOffer.body.data._id}/cancel`,
      donor
    );
    assert.equal(canceled.status, 200);
    assert.equal(canceled.body.data.status, 'Canceled');
    const afterRelease = await postJson('/api/offers', donor, {
      request: String(requests[2]._id)
    });
    assert.equal(afterRelease.status, 201);
    assert.equal(await Offer.countDocuments({
      donor: donor._id,
      status: { $in: ['Pending', 'Accepted'] }
    }), 2);
  });

  await t.test('concurrent acceptances allocate the final unit to only one donor', async () => {
    const requester = await createUser('requester', 6);
    const request = await createRequest(requester, 1);
    const offers = [];
    for (const index of [7, 8]) {
      const donor = await createUser('donor', index);
      offers.push(await createOffer(request, donor));
    }

    const results = await Promise.all(offers.map((offer) =>
      putJson(`/api/offers/${offer._id}/accept`, requester)
    ));

    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    assert.equal(await Offer.countDocuments({ request: request._id, status: 'Accepted' }), 1);
    const updatedRequest = await BloodRequest.findById(request._id).select('+acceptanceSequence');
    assert.equal(updatedRequest.acceptanceSequence, 1);
  });

  await t.test('concurrent acceptances cannot exceed multiple remaining units', async () => {
    const requester = await createUser('requester', 9);
    const request = await createRequest(requester, 2);
    const offers = [];
    for (const index of [10, 11, 12]) {
      const donor = await createUser('donor', index);
      offers.push(await createOffer(request, donor));
    }

    const results = await Promise.all(offers.map((offer) =>
      putJson(`/api/offers/${offer._id}/accept`, requester)
    ));

    assert.deepEqual(results.map((result) => result.status).sort(), [200, 200, 409]);
    assert.equal(await Offer.countDocuments({ request: request._id, status: 'Accepted' }), 2);
    const updatedRequest = await BloodRequest.findById(request._id).select('+acceptanceSequence');
    assert.equal(updatedRequest.acceptanceSequence, 2);
  });

  await t.test('only the request owner can accept or decline pending offers', async () => {
    const requester = await createUser('requester', 20);
    const otherRequester = await createUser('requester', 21);
    const donor = await createUser('donor', 22);
    const request = await createRequest(requester);
    const offer = await createOffer(request, donor);

    const deniedAccept = await putJson(`/api/offers/${offer._id}/accept`, otherRequester);
    const deniedDecline = await putJson(`/api/offers/${offer._id}/decline`, otherRequester);
    assert.equal(deniedAccept.status, 403);
    assert.equal(deniedDecline.status, 403);
    assert.equal((await Offer.findById(offer._id)).status, 'Pending');

    const pendingContact = await getJson(`/api/offers/${offer._id}/contact`, donor);
    assert.equal(pendingContact.status, 403);

    const accepted = await putJson(`/api/offers/${offer._id}/accept`, requester);
    assert.equal(accepted.status, 200);
    const contact = await getJson(`/api/offers/${offer._id}/contact`, requester);
    assert.equal(contact.status, 200);
    assert.equal(contact.body.data.phone, donor.phone);

    const repeatAccept = await putJson(`/api/offers/${offer._id}/accept`, requester);
    const declineAccepted = await putJson(`/api/offers/${offer._id}/decline`, requester);
    assert.equal(repeatAccept.status, 400);
    assert.equal(declineAccepted.status, 400);
  });

  await t.test('request closure transaction cancels pending and accepted offers', async () => {
    const requester = await createUser('requester', 23);
    const pendingDonor = await createUser('donor', 24);
    const acceptedDonor = await createUser('donor', 25);
    const request = await createRequest(requester, 2);
    const pending = await createOffer(request, pendingDonor);
    const accepted = await createOffer(request, acceptedDonor, 'Accepted');

    const result = await putJson(`/api/requests/${request._id}/close`, requester);

    assert.equal(result.status, 200);
    assert.equal((await BloodRequest.findById(request._id)).status, 'Closed');
    assert.deepEqual(
      (await Offer.find({ _id: { $in: [pending._id, accepted._id] } }).distinct('status')).sort(),
      ['Canceled']
    );
  });

  await t.test('hourly expiry cleanup transaction closes requests and cancels offers', async () => {
    const requester = await createUser('requester', 26);
    const pendingDonor = await createUser('donor', 27);
    const acceptedDonor = await createUser('donor', 28);
    const request = await createRequest(requester, 2);
    const pending = await createOffer(request, pendingDonor);
    const accepted = await createOffer(request, acceptedDonor, 'Accepted');
    await BloodRequest.updateOne(
      { _id: request._id },
      { $set: { neededBy: new Date(Date.now() - 1000) } }
    );

    const closedCount = await expireRequests();

    assert.equal(closedCount, 1);
    assert.equal((await BloodRequest.findById(request._id)).status, 'Closed');
    assert.equal((await Offer.findById(pending._id)).status, 'Canceled');
    assert.equal((await Offer.findById(accepted._id)).status, 'Canceled');
  });

  await t.test('acceptance rejects insufficient remaining units without partial changes', async () => {
    const requester = await createUser('requester', 13);
    const request = await createRequest(requester, 2);
    request.unitsFulfilled = 1;
    await request.save();
    const acceptedDonor = await createUser('donor', 14);
    const pendingDonor = await createUser('donor', 15);
    await createOffer(request, acceptedDonor, 'Accepted');
    const pendingOffer = await createOffer(request, pendingDonor);

    const result = await putJson(`/api/offers/${pendingOffer._id}/accept`, requester);

    assert.equal(result.status, 409);
    assert.equal(await Offer.countDocuments({ request: request._id, status: 'Accepted' }), 1);
    assert.equal((await Offer.findById(pendingOffer._id)).status, 'Pending');
    const updatedRequest = await BloodRequest.findById(request._id).select('+acceptanceSequence');
    assert.equal(updatedRequest.acceptanceSequence, 0);
    assert.equal(updatedRequest.unitsFulfilled, 1);
  });

  await t.test('successful request and offer workflows remain available', async () => {
    const requester = await createUser('requester', 16);
    const donor = await createUser('donor', 17);
    const requestResult = await postJson('/api/requests', requester, requestBody());
    assert.equal(requestResult.status, 201);
    assert.equal(Object.hasOwn(requestResult.body.data, 'acceptanceSequence'), false);

    const offerResult = await postJson('/api/offers', donor, {
      request: String(requestResult.body.data._id),
      message: 'Available to donate'
    });
    assert.equal(offerResult.status, 201);

    const acceptance = await putJson(
      `/api/offers/${offerResult.body.data._id}/accept`,
      requester
    );
    assert.equal(acceptance.status, 200);
    assert.equal(acceptance.body.data.status, 'Accepted');
    assert.equal(
      await Offer.countDocuments({
        request: requestResult.body.data._id,
        donor: donor._id,
        status: 'Accepted'
      }),
      1
    );
    const submittedNotice = await InAppNotification.findOne({
      recipient: requester._id,
      offer: offerResult.body.data._id,
      type: 'offer-submitted'
    }).lean();
    assert.ok(submittedNotice);
    const acceptedNotice = await InAppNotification.findOne({
      recipient: donor._id,
      offer: offerResult.body.data._id,
      type: 'offer-accepted'
    }).lean();
    assert.ok(acceptedNotice);
  });
});
