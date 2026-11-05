const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const express = require('express');

const requesterId = new mongoose.Types.ObjectId();
const requestId = new mongoose.Types.ObjectId();
const pendingOffer = {
  _id: new mongoose.Types.ObjectId(),
  request: requestId,
  status: 'Pending',
  donor: { name: 'Test donor', bloodGroup: 'O-', city: 'Test city' }
};
let countFilter;
let findFilter;

const protectPath = require.resolve('../middleware/protect');
const requestModelPath = require.resolve('../models/BloodRequest');
const offerModelPath = require.resolve('../models/Offer');
const protect = (_req, _res, next) => {
  _req.user = { id: String(requesterId), role: 'requester', roles: ['requester'] };
  next();
};
protect.withOptions = () => protect;

require.cache[protectPath] = { id: protectPath, filename: protectPath, loaded: true, exports: protect };
require.cache[requestModelPath] = {
  id: requestModelPath,
  filename: requestModelPath,
  loaded: true,
  exports: {
    findById(id) {
      assert.equal(String(id), String(requestId));
      return {
        select(fields) {
          assert.equal(fields, 'requester');
          return Promise.resolve({ _id: requestId, requester: requesterId });
        }
      };
    }
  }
};
require.cache[offerModelPath] = {
  id: offerModelPath,
  filename: offerModelPath,
  loaded: true,
  exports: {
    countDocuments(filter) {
      countFilter = filter;
      return Promise.resolve(1);
    },
    find(filter) {
      findFilter = filter;
      return {
        select() { return this; },
        populate() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        lean() { return Promise.resolve([pendingOffer]); }
      };
    }
  }
};

const offerRoutes = require('../routes/offerRoutes');
const errorHandler = require('../middleware/errorHandler');

test('request owner receives pending offers for their request', async () => {
  const app = express();
  app.use('/offers', offerRoutes);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/offers/request/${requestId}?page=1&limit=10`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].status, 'Pending');
    assert.equal(body.pagination.total, 1);
    assert.deepEqual(countFilter, { request: requestId });
    assert.deepEqual(findFilter, { request: requestId });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
