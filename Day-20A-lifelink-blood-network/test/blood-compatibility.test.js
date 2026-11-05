const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const Offer = require('../models/Offer');
const Block = require('../models/Block');
const Review = require('../models/Review');
const InAppNotification = require('../models/InAppNotification');
const transactions = require('../utils/requiredTransaction');
const errorHandler = require('../middleware/errorHandler');
const { bloodCompatibility, canDonate, getCompatibleDonors } = require('../utils/bloodCompatibility');

const bloodGroups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const expectedDonorRecipients = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+']
};
const jwtSecret = 'lifelink-blood-compatibility-test-secret';
const requesterId = '507f1f77bcf86cd799439011';
const donorId = '507f1f77bcf86cd799439012';
const requestId = '507f1f77bcf86cd799439013';
const originalJwtSecret = process.env.JWT_SECRET;
const originalMaxOffers = process.env.MAX_ACTIVE_OFFERS;
const originalMaxPrescriptionMb = process.env.MAX_PRESCRIPTION_MB;
process.env.MAX_PRESCRIPTION_MB = '5';
const originalMethods = {
  userFindById: User.findById,
  userFind: User.find,
  userCountDocuments: User.countDocuments,
  blockFind: Block.find,
  blockExists: Block.exists,
  bloodRequestFindById: BloodRequest.findById,
  bloodRequestFindOne: BloodRequest.findOne,
  bloodRequestAggregate: BloodRequest.aggregate,
  userUpdateOne: User.updateOne,
  offerExists: Offer.exists,
  offerFindOne: Offer.findOne,
  offerCountDocuments: Offer.countDocuments,
  offerCreate: Offer.create,
  offerAggregate: Offer.aggregate,
  reviewAggregate: Review.aggregate,
  inAppNotificationCreate: InAppNotification.create,
  withRequiredTransaction: transactions.withRequiredTransaction
};

let authenticatedUser;
let currentRequest;
let userFilters = [];
let createdOffers = [];
let existingOffer = false;
let acceptedOfferCount = 0;
let activeOfferCount = 0;
let requestAggregationPipeline;

function createQuery(getValue) {
  let result;
  const execute = () => {
    if (!result) result = Promise.resolve().then(getValue);
    return result;
  };
  return {
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    session() { return this; },
    lean() { return execute(); },
    then(resolve, reject) { return execute().then(resolve, reject); }
  };
}

const donors = bloodGroups.map((bloodGroup, index) => ({
  _id: `donor-${index}`,
  name: `Donor ${bloodGroup}`,
  bloodGroup,
  city: 'Test City',
  isActive: true,
  isAvailable: true
}));

function matchesSearchFilters(donor, filters) {
  return (!filters.bloodGroup || filters.bloodGroup.$in.includes(donor.bloodGroup)) &&
    filters.role === 'donor' && filters.isActive === true && filters.isAvailable === true;
}

function installMocks() {
  User.findById = (id) => createQuery(() =>
    authenticatedUser && String(authenticatedUser._id) === String(id)
      ? authenticatedUser
      : null
  );
  User.countDocuments = async (filters) =>
    donors.filter((donor) => matchesSearchFilters(donor, filters)).length;
  User.find = (filters) => {
    userFilters.push(filters);
    return createQuery(() => donors.filter((donor) => matchesSearchFilters(donor, filters)));
  };
  Block.find = () => createQuery(() => []);
  Block.exists = () => createQuery(() => false);
  BloodRequest.findById = (id) => createQuery(() =>
    currentRequest && String(currentRequest._id) === String(id) ? currentRequest : null
  );
  BloodRequest.findOne = () => createQuery(() => currentRequest);
  BloodRequest.aggregate = async (pipeline) => {
    requestAggregationPipeline = pipeline;
    return [{ metadata: [{ total: 1 }], data: [{ _id: requestId, bloodGroup: 'A+' }] }];
  };
  User.updateOne = async () => ({ matchedCount: 1 });
  Offer.exists = async () => false;
  Offer.findOne = () => createQuery(() => existingOffer ? { _id: 'existing-offer' } : null);
  Offer.countDocuments = (filters) => createQuery(() =>
    filters.status === 'Accepted' ? acceptedOfferCount : activeOfferCount
  );
  Offer.create = async (documents) => {
    const data = Array.isArray(documents) ? documents[0] : documents;
    createdOffers.push(data);
    return [{ _id: 'created-offer', status: 'Pending', ...data }];
  };
  Offer.aggregate = async () => [];
  Review.aggregate = async () => [];
  InAppNotification.create = async (documents) => documents;
  transactions.withRequiredTransaction = async (operation) => operation({});
}

installMocks();

const app = express();
app.use(express.json());
app.use('/donors', require('../routes/donorRoutes'));
app.use('/offers', require('../routes/offerRoutes'));
app.use('/requests', require('../routes/requestRoutes'));
app.use(errorHandler);

let server;
let baseUrl;

function tokenFor(id) {
  return jwt.sign({ id, authVersion: 0 }, jwtSecret, { expiresIn: '1h' });
}

async function request(path, { userId, body, method = 'GET' } = {}) {
  const headers = {};
  const options = { method, headers };
  if (userId) headers.Authorization = `Bearer ${tokenFor(userId)}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

test('standard ABO/RhD red-cell compatibility matrix', async (t) => {
  for (const donorGroup of bloodGroups) {
    await t.test(`${donorGroup} donor combinations`, async (donorTest) => {
      for (const recipientGroup of bloodGroups) {
        await donorTest.test(`${donorGroup} to ${recipientGroup}`, () => {
          assert.equal(
            canDonate(donorGroup, recipientGroup),
            expectedDonorRecipients[donorGroup].includes(recipientGroup)
          );
        });
      }

    });
  }

  await t.test('compatible donor lists are the inverse of the configured matrix', () => {
    for (const recipientGroup of bloodGroups) {
      const expectedDonors = Object.keys(expectedDonorRecipients).filter((donorGroup) =>
        expectedDonorRecipients[donorGroup].includes(recipientGroup)
      );
      assert.deepEqual(getCompatibleDonors(recipientGroup), expectedDonors);
      assert.deepEqual(bloodCompatibility[recipientGroup], expectedDonorRecipients[recipientGroup]);
    }
  });

  await t.test('missing and unknown blood groups are rejected safely', () => {
    assert.equal(canDonate(undefined, 'O+'), false);
    assert.equal(canDonate('O+', null), false);
    assert.equal(canDonate('X+', 'O+'), false);
    assert.equal(canDonate('O+', 'X+'), false);
    assert.deepEqual(getCompatibleDonors(undefined), []);
    assert.deepEqual(getCompatibleDonors('X+'), []);
  });
});

test('donor search filters using compatible donor groups for every recipient group', async (t) => {
  process.env.JWT_SECRET = jwtSecret;
  authenticatedUser = {
    _id: requesterId,
    role: 'requester',
    isActive: true,
    authVersion: 0
  };
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
    User.findById = originalMethods.userFindById;
    User.find = originalMethods.userFind;
    User.countDocuments = originalMethods.userCountDocuments;
    Block.find = originalMethods.blockFind;
    Block.exists = originalMethods.blockExists;
    BloodRequest.findById = originalMethods.bloodRequestFindById;
    BloodRequest.findOne = originalMethods.bloodRequestFindOne;
    BloodRequest.aggregate = originalMethods.bloodRequestAggregate;
    User.updateOne = originalMethods.userUpdateOne;
    Offer.exists = originalMethods.offerExists;
    Offer.findOne = originalMethods.offerFindOne;
    Offer.countDocuments = originalMethods.offerCountDocuments;
    Offer.create = originalMethods.offerCreate;
    Offer.aggregate = originalMethods.offerAggregate;
    Review.aggregate = originalMethods.reviewAggregate;
    InAppNotification.create = originalMethods.inAppNotificationCreate;
    transactions.withRequiredTransaction = originalMethods.withRequiredTransaction;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalMaxOffers === undefined) delete process.env.MAX_ACTIVE_OFFERS;
    else process.env.MAX_ACTIVE_OFFERS = originalMaxOffers;
    if (originalMaxPrescriptionMb === undefined) delete process.env.MAX_PRESCRIPTION_MB;
    else process.env.MAX_PRESCRIPTION_MB = originalMaxPrescriptionMb;
  });

  await t.test('unauthenticated and invalid-group searches are rejected', async () => {
    const unauthenticated = await request('/donors?bloodGroup=O%2B');
    assert.equal(unauthenticated.status, 401);

    const invalid = await request('/donors?bloodGroup=X%2B', { userId: requesterId });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'Invalid blood group.');
  });

  for (const recipientGroup of bloodGroups) {
    await t.test(`search for ${recipientGroup} recipients`, async () => {
      userFilters = [];
      const query = new URLSearchParams({ bloodGroup: recipientGroup, limit: '100' });
      const result = await request(`/donors?${query}`, { userId: requesterId });
      const expectedDonors = Object.keys(expectedDonorRecipients).filter((donorGroup) =>
        expectedDonorRecipients[donorGroup].includes(recipientGroup)
      );

      assert.equal(result.status, 200);
      assert.equal(userFilters.length, 1);
      assert.deepEqual(userFilters[0].bloodGroup, { $in: expectedDonors });
      assert.deepEqual(
        result.body.data.map((donor) => donor.bloodGroup).sort(),
        [...expectedDonors].sort()
      );
    });
  }

  await t.test('public request board filters donor blood groups and remaining capacity', async () => {
    authenticatedUser = {
      _id: donorId,
      role: 'donor',
      isActive: true,
      authVersion: 0,
      bloodGroup: 'O+'
    };
    const result = await request('/requests', { userId: donorId });

    assert.equal(result.status, 200);
    assert.deepEqual(
      requestAggregationPipeline[0].$match.bloodGroup.$in.sort(),
      ['A+', 'AB+', 'B+', 'O+']
    );
    assert.ok(requestAggregationPipeline.some((stage) => stage.$lookup));
    assert.ok(requestAggregationPipeline.some((stage) =>
      stage.$match && stage.$match.$expr && stage.$match.$expr.$lt
    ));
  });
});

test('offer creation rejects incompatible blood groups before persistence', async (t) => {
  installMocks();
  process.env.JWT_SECRET = jwtSecret;
  process.env.MAX_ACTIVE_OFFERS = '3';
  authenticatedUser = {
    _id: donorId,
    role: 'donor',
    isActive: true,
    authVersion: 0,
    isAvailable: true,
    bloodGroup: 'AB+'
  };
  currentRequest = {
    _id: requestId,
    requester: requesterId,
    bloodGroup: 'O-',
    status: 'Open',
    neededBy: new Date(Date.now() + 60 * 60 * 1000),
    unitsNeeded: 2,
    unitsFulfilled: 0
  };
  createdOffers = [];
  existingOffer = false;
  acceptedOfferCount = 0;
  activeOfferCount = 0;
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
    User.findById = originalMethods.userFindById;
    User.find = originalMethods.userFind;
    User.countDocuments = originalMethods.userCountDocuments;
    Block.find = originalMethods.blockFind;
    Block.exists = originalMethods.blockExists;
    BloodRequest.findById = originalMethods.bloodRequestFindById;
    BloodRequest.findOne = originalMethods.bloodRequestFindOne;
    BloodRequest.aggregate = originalMethods.bloodRequestAggregate;
    Offer.exists = originalMethods.offerExists;
    Offer.findOne = originalMethods.offerFindOne;
    Offer.countDocuments = originalMethods.offerCountDocuments;
    Offer.create = originalMethods.offerCreate;
    Offer.aggregate = originalMethods.offerAggregate;
    Review.aggregate = originalMethods.reviewAggregate;
    InAppNotification.create = originalMethods.inAppNotificationCreate;
    transactions.withRequiredTransaction = originalMethods.withRequiredTransaction;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalMaxOffers === undefined) delete process.env.MAX_ACTIVE_OFFERS;
    else process.env.MAX_ACTIVE_OFFERS = originalMaxOffers;
  });

  await t.test('unauthenticated and missing-request offers are rejected', async () => {
    const unauthenticated = await request('/offers', { method: 'POST', body: { request: requestId } });
    assert.equal(unauthenticated.status, 401);

    const missing = await request('/offers', { method: 'POST', userId: donorId, body: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'request must be a valid request ID.');
  });

  await t.test('incompatible donor offer returns 400 and creates no offer', async () => {
    const result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Your blood group is not compatible with this request.');
    assert.equal(createdOffers.length, 0);
  });

  await t.test('non-donor roles cannot submit offers', async () => {
    authenticatedUser.role = 'requester';
    const result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 403);
    authenticatedUser.role = 'donor';
  });

  await t.test('compatible donor offer continues through creation', async () => {
    authenticatedUser.bloodGroup = 'O-';
    currentRequest.bloodGroup = 'AB+';
    Offer.create = async (documents) => {
      const data = documents[0];
      createdOffers.push(data);
      return [{ _id: 'created-offer', status: 'Pending', ...data }];
    };
    const result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(createdOffers.length, 1);
    assert.equal(createdOffers[0].donor, donorId);
    assert.equal(createdOffers[0].request, requestId);
  });

  await t.test('inactive and ineligible donors are rejected before request validation', async () => {
    authenticatedUser.isActive = false;
    let result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: {}
    });
    assert.equal(result.status, 400);

    authenticatedUser.isActive = true;
    authenticatedUser.lastDonationDate = new Date();
    result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: {}
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /wait \d+ more day/);
    delete authenticatedUser.lastDonationDate;
  });

  await t.test('missing, closed, and expired requests return required statuses', async () => {
    currentRequest = null;
    let result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 404);

    currentRequest = {
      _id: requestId,
      requester: requesterId,
      bloodGroup: 'AB+',
      status: 'Closed',
      neededBy: new Date(Date.now() + 60 * 60 * 1000),
      unitsNeeded: 2,
      unitsFulfilled: 0
    };
    result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 409);

    currentRequest.status = 'Open';
    currentRequest.neededBy = new Date(Date.now() - 1000);
    result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 400);
  });

  await t.test('duplicate offer is rejected before the active-offer limit', async () => {
    currentRequest = {
      _id: requestId,
      requester: requesterId,
      bloodGroup: 'AB+',
      status: 'Open',
      neededBy: new Date(Date.now() + 60 * 60 * 1000),
      unitsNeeded: 2,
      unitsFulfilled: 0
    };
    existingOffer = true;
    activeOfferCount = 3;
    const result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /already submitted/);
  });

  await t.test('capacity and active-offer limits are enforced', async () => {
    existingOffer = false;
    activeOfferCount = 0;
    acceptedOfferCount = 1;
    currentRequest.unitsNeeded = 1;
    let result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'Aur donors ki zaroorat nahi');

    acceptedOfferCount = 0;
    currentRequest.unitsNeeded = 2;
    activeOfferCount = 3;
    result = await request('/offers', {
      method: 'POST',
      userId: donorId,
      body: { request: requestId }
    });
    assert.equal(result.status, 400);
  });
});
