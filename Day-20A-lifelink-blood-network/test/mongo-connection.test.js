const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createMongoConnector,
  validateMongoUri,
  MAX_CONNECTION_ATTEMPTS,
  SERVER_SELECTION_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS
} = require('../config/db');

const replicaSetUri = 'mongodb://synthetic-user:synthetic-password@localhost:27017/lifelink_test?replicaSet=rs0';

function fakeMongoClient({
  connect = async () => {},
  readyState = 1,
  topologyType = 'ReplicaSetWithPrimary'
} = {}) {
  return {
    calls: [],
    connection: {
      readyState,
      client: {
        topology: {
          description: { type: topologyType }
        }
      }
    },
    async connect(uri, options) {
      this.calls.push({ uri, options });
      await connect(uri, options);
    }
  };
}

test('MongoDB URI validation rejects missing and malformed values without echoing them', () => {
  assert.throws(() => validateMongoUri(undefined), /MONGO_URI is not configured/);
  assert.throws(
    () => validateMongoUri('mongodb://username:secret@'),
    (error) => {
      assert.match(error.message, /valid MongoDB connection URI/);
      assert.doesNotMatch(error.message, /secret|username/);
      return true;
    }
  );
  assert.equal(validateMongoUri(` ${replicaSetUri} `), replicaSetUri);
});

test('MongoDB connector uses bounded timeouts and accepts a replica-set connection', async () => {
  const client = fakeMongoClient();
  const connection = await createMongoConnector({ mongooseClient: client })(replicaSetUri);

  assert.strictEqual(connection, client.connection);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].options, {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS
  });
  assert.equal(SERVER_SELECTION_TIMEOUT_MS, 5_000);
  assert.equal(CONNECT_TIMEOUT_MS, 5_000);
});

test('MongoDB connector applies configured DNS servers before connecting', async () => {
  const previous = process.env.MONGO_DNS_SERVERS;
  process.env.MONGO_DNS_SERVERS = '1.1.1.1, 8.8.8.8';
  const calls = [];
  const client = fakeMongoClient({
    connect: async () => { calls.push('connect'); }
  });
  try {
    await createMongoConnector({
      mongooseClient: client,
      dnsModule: { setServers: (servers) => calls.push(servers) }
    })(replicaSetUri);
    assert.deepEqual(calls, [['1.1.1.1', '8.8.8.8'], 'connect']);
  } finally {
    if (previous === undefined) delete process.env.MONGO_DNS_SERVERS;
    else process.env.MONGO_DNS_SERVERS = previous;
  }
});

test('MongoDB connector preserves default DNS behavior when no override is configured', async () => {
  const previous = process.env.MONGO_DNS_SERVERS;
  delete process.env.MONGO_DNS_SERVERS;
  let setServersCalled = false;
  try {
    await createMongoConnector({
      mongooseClient: fakeMongoClient(),
      dnsModule: { setServers: () => { setServersCalled = true; } }
    })(replicaSetUri);
    assert.equal(setServersCalled, false);
  } finally {
    if (previous !== undefined) process.env.MONGO_DNS_SERVERS = previous;
  }
});

test('MongoDB connector rejects an invalid DNS override without connecting', async () => {
  const previous = process.env.MONGO_DNS_SERVERS;
  process.env.MONGO_DNS_SERVERS = '1.1.1.1,,8.8.8.8';
  const client = fakeMongoClient();
  try {
    await assert.rejects(
      createMongoConnector({ mongooseClient: client })(replicaSetUri),
      /MONGO_DNS_SERVERS must be a comma-separated list/
    );
    assert.equal(client.calls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.MONGO_DNS_SERVERS;
    else process.env.MONGO_DNS_SERVERS = previous;
  }
});

test('MongoDB connection failures retry a bounded number of times with bounded backoff', async () => {
  const delays = [];
  const client = fakeMongoClient({
    connect: async () => {
      throw new Error(`Authentication failed for ${replicaSetUri}`);
    }
  });
  const connect = createMongoConnector({
    mongooseClient: client,
    sleep: async (milliseconds) => { delays.push(milliseconds); }
  });

  await assert.rejects(connect(replicaSetUri), (error) => {
    assert.match(error.message, /failed after 3 attempts/);
    assert.doesNotMatch(error.message, /synthetic-user|synthetic-password|mongodb:\/\//);
    return true;
  });
  assert.equal(client.calls.length, MAX_CONNECTION_ATTEMPTS);
  assert.deepEqual(delays, [250, 500]);
});

test('MongoDB connector fails startup for a standalone topology without retrying', async () => {
  const client = fakeMongoClient({ topologyType: 'Single' });
  const delays = [];
  const connect = createMongoConnector({
    mongooseClient: client,
    sleep: async (milliseconds) => { delays.push(milliseconds); }
  });

  await assert.rejects(connect(replicaSetUri), /replica set or sharded deployment/);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(delays, []);
});
