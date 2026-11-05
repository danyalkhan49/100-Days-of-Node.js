const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DeleteObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');
const { createR2Provider } = require('../utils/storage/r2Provider');
const { createStorageService } = require('../utils/storage/storageService');
const { cleanupJobId, validateCleanupTarget, enqueueStorageCleanupJob } =
  require('../utils/storageCleanupQueue');
const {
  createStorageCleanupWorker,
  startStorageCleanupWorker
} = require('../utils/storageCleanupWorker');
const StorageCleanupJob = require('../models/StorageCleanupJob');
const StorageReconciliationState = require('../models/StorageReconciliationState');

class FakeCleanupJobs {
  constructor(jobs = []) {
    this.jobs = new Map(jobs.map((job, index) => [
      job._id || `job-${index}`,
      { _id: job._id || `job-${index}`, attempts: 0, ...job }
    ]));
    this.sequence = this.jobs.size;
    this.claimCalls = 0;
  }

  async findOneAndUpdate(filter, update) {
    if (filter._id && update.$setOnInsert) {
      const existing = [...this.jobs.values()].find((job) =>
        job._id === filter._id
      );
      if (existing) return { ...existing };
      const job = {
        _id: filter._id,
        ...update.$setOnInsert
      };
      this.jobs.set(job._id, job);
      return { ...job };
    }

    this.claimCalls += 1;
    const now = new Date();
    const due = [...this.jobs.values()]
      .filter((job) =>
        job.status === 'pending' && job.nextAttemptAt <= now ||
        job.status === 'processing' && job.leaseUntil <= now
      )
      .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt);
    const job = due[0];
    if (!job) return null;
    Object.assign(job, update.$set);
    return { ...job };
  }

  async updateOne(filter, update) {
    const job = this.jobs.get(filter._id);
    if (!job || job.status !== filter.status ||
        job.leaseToken !== filter.leaseToken) return { matchedCount: 0 };
    Object.assign(job, update.$set || {});
    for (const [field, value] of Object.entries(update.$inc || {})) {
      job[field] = (job[field] || 0) + value;
    }
    return { matchedCount: 1 };
  }
}

class FakeReconciliationState {
  constructor() {
    this.states = new Map();
    this.failNextUpdate = false;
  }

  async findOneAndUpdate(filter, update) {
    const state = this.states.get(filter._id);
    if (state && state.status === 'failed') return null;
    if (state && state.nextAttemptAt && state.nextAttemptAt > new Date()) return null;
    if (state && state.leaseUntil && state.leaseUntil > new Date()) return null;
    const claimed = state || {
      _id: filter._id,
      continuationToken: null,
      status: 'active',
      attempts: 0,
      lastErrorCode: null,
      nextAttemptAt: new Date(0),
      leaseUntil: null,
      leaseToken: null
    };
    Object.assign(claimed, update.$set);
    this.states.set(filter._id, claimed);
    return { ...claimed };
  }

  async updateOne(filter, update) {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('synthetic database unavailable');
    }
    const state = this.states.get(filter._id);
    if (!state || state.leaseToken !== filter.leaseToken) return { matchedCount: 0 };
    Object.assign(state, update.$set || {});
    return { matchedCount: 1 };
  }
}

class FakeR2Storage {
  constructor() {
    this.objects = new Map();
    this.deleted = [];
    this.deleteError = null;
    this.listError = null;
    this.listCalls = [];
  }

  async exists({ key }) {
    return this.objects.has(key);
  }

  async delete({ key }) {
    if (this.deleteError) throw this.deleteError;
    this.deleted.push(key);
    this.objects.delete(key);
  }

  async list({ purpose, continuationToken, maxKeys = 100 }) {
    this.listCalls.push({ purpose, continuationToken });
    if (this.listError) throw this.listError;
    const entries = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(`${purpose}/`))
      .sort(([left], [right]) => left.localeCompare(right))
      .filter(([key]) => !continuationToken || key > continuationToken);
    const page = entries.slice(0, maxKeys);
    const next = entries.length > maxKeys
      ? page[page.length - 1][0]
      : null;
    return {
      objects: page.map(([key, object]) => ({
        key,
        lastModified: object.lastModified
      })),
      nextContinuationToken: next
    };
  }
}

function referenceModels(references = {}) {
  const User = {
    async exists(filter) {
      const avatarKey = filter['avatarStorage.key'];
      const identityKey = filter['identityDocumentStorage.key'];
      return references.avatars && references.avatars.has(avatarKey) ||
        references.identities && references.identities.has(identityKey)
        ? { _id: 'synthetic-user' }
        : null;
    }
  };
  const BloodRequest = {
    async exists(filter) {
      const key = filter['prescriptionStorage.key'];
      return references.requests && references.requests.has(key)
        ? { _id: 'synthetic-request' }
        : null;
    }
  };
  return { User, BloodRequest };
}

function runtime(storage) {
  return { status: { r2: { available: true } }, r2Storage: storage };
}

function jobFor(key, overrides = {}) {
  const purpose = key.split('/')[0];
  return {
    provider: 'r2',
    key,
    purpose,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date(0),
    lastAttemptAt: null,
    leaseUntil: null,
    ...overrides
  };
}

test('cleanup target validation accepts only approved prefixes and opaque keys', async () => {
  assert.deepEqual(validateCleanupTarget({
    purpose: 'avatars',
    key: `avatars/${'a'.repeat(64)}`
  }), {
    provider: 'r2',
    purpose: 'avatars',
    key: `avatars/${'a'.repeat(64)}`
  });
  for (const target of [
    { purpose: 'avatars', key: `prescriptions/${'a'.repeat(64)}` },
    { purpose: 'avatars', key: 'avatars/../secret' },
    { purpose: 'identity-documents', key: `identity-documents/${'f'.repeat(64)}/..` },
    { purpose: 'other', key: `other/${'b'.repeat(64)}` }
  ]) {
    assert.throws(() => validateCleanupTarget(target), /invalid/);
  }

  const jobs = new FakeCleanupJobs();
  const first = await enqueueStorageCleanupJob(jobs, {
    purpose: 'prescriptions',
    key: `prescriptions/${'c'.repeat(64)}`
  });
  const duplicate = await enqueueStorageCleanupJob(jobs, {
    purpose: 'prescriptions',
    key: `prescriptions/${'c'.repeat(64)}`
  });
  assert.equal(first._id, duplicate._id);
  assert.equal(first._id, cleanupJobId(`prescriptions/${'c'.repeat(64)}`));
  assert.equal(jobs.jobs.size, 1);
});

test('cleanup job schema validates purpose prefixes, provider and retry fields offline', async () => {
  const valid = new StorageCleanupJob({
    _id: 'synthetic-cleanup-job',
    provider: 'r2',
    purpose: 'avatars',
    key: `avatars/${'a'.repeat(64)}`
  });
  await assert.doesNotReject(valid.validate());

  const invalid = new StorageCleanupJob({
    _id: 'synthetic-invalid-job',
    provider: 'local',
    purpose: 'avatars',
    key: `prescriptions/${'b'.repeat(64)}`,
    attempts: -1
  });
  await assert.rejects(invalid.validate());

  const reconciliationState = new StorageReconciliationState({
    _id: 'avatars'
  });
  await assert.doesNotReject(reconciliationState.validate());
  await assert.rejects(new StorageReconciliationState({
    _id: 'unexpected'
  }).validate());
  await assert.rejects(new StorageReconciliationState({
    _id: 'avatars',
    attempts: -1,
    status: 'retrying'
  }).validate());
  const referenceFailure = new StorageCleanupJob({
    _id: 'synthetic-reference-failure',
    provider: 'r2',
    purpose: 'avatars',
    key: `avatars/${'c'.repeat(64)}`,
    lastErrorCode: 'REFERENCE_CHECK_FAILED'
  });
  await assert.doesNotReject(referenceFailure.validate());
});

test('worker deletes an unreferenced due object and marks its job complete', async () => {
  const key = `avatars/${'1'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([jobFor(key)]);
  const storage = new FakeR2Storage();
  storage.objects.set(key, { lastModified: new Date() });
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    reconciliationGraceMs: 100_000_000
  });

  const result = await worker.runOnce();

  assert.equal(result.processed, 1);
  assert.deepEqual(storage.deleted, [key]);
  assert.equal([...jobs.jobs.values()][0].status, 'completed');
});

test('atomic claims prevent two workers from processing the same due job', async () => {
  const key = `prescriptions/${'2'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([jobFor(key)]);
  const storage = new FakeR2Storage();
  storage.objects.set(key, { lastModified: new Date() });
  const { User, BloodRequest } = referenceModels();
  let existenceChecks = 0;
  const originalExists = storage.exists.bind(storage);
  storage.exists = async (input) => {
    existenceChecks += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return originalExists(input);
  };
  const options = {
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    reconciliationGraceMs: 100_000_000
  };
  const results = await Promise.all([
    createStorageCleanupWorker(options).runOnce(),
    createStorageCleanupWorker(options).runOnce()
  ]);

  assert.equal(results[0].processed + results[1].processed, 1);
  assert.equal(existenceChecks, 1);
  assert.deepEqual(storage.deleted, [key]);
});

test('live avatar, prescription, or identity references block deletion', async (t) => {
  const cases = [
    ['avatars', 'avatars'],
    ['prescriptions', 'requests'],
    ['identity-documents', 'identities']
  ];
  for (const [purpose, collection] of cases) {
    await t.test(purpose, async () => {
      const key = `${purpose}/${'3'.repeat(64)}`;
      const jobs = new FakeCleanupJobs([jobFor(key)]);
      const storage = new FakeR2Storage();
      storage.objects.set(key, { lastModified: new Date() });
      const references = {
        avatars: new Set(),
        identities: new Set(),
        requests: new Set()
      };
      references[collection].add(key);
      const { User, BloodRequest } = referenceModels(references);
      const worker = createStorageCleanupWorker({
        StorageCleanupJob: jobs,
        StorageReconciliationState: new FakeReconciliationState(),
        User,
        BloodRequest,
        getStorage: () => runtime(storage),
        maxDelayMs: 5,
        reconciliationGraceMs: 100_000_000
      });

      await worker.runOnce();

      assert.deepEqual(storage.deleted, []);
      assert.equal([...jobs.jobs.values()][0].status, 'pending');
      assert.equal([...jobs.jobs.values()][0].lastErrorCode, 'OBJECT_STILL_REFERENCED');
    });
  }
});

test('already-missing R2 objects complete safely without a delete call', async () => {
  const key = `identity-documents/${'4'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([jobFor(key)]);
  const storage = new FakeR2Storage();
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage)
  });

  await worker.runOnce();

  assert.equal([...jobs.jobs.values()][0].status, 'completed');
  assert.deepEqual(storage.deleted, []);
});

test('a concurrent not-found delete is treated as completed idempotent cleanup', async () => {
  const key = `avatars/${'4'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([jobFor(key)]);
  const storage = new FakeR2Storage();
  storage.objects.set(key, { lastModified: new Date() });
  storage.deleteError = Object.assign(new Error('object disappeared'), {
    name: 'NoSuchKey',
    $metadata: { httpStatusCode: 404 }
  });
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage)
  });

  await worker.runOnce();

  const job = [...jobs.jobs.values()][0];
  assert.equal(job.status, 'completed');
  assert.equal(job.attempts, 0);
  assert.equal(job.lastErrorCode, null);
});

test('failed deletion uses bounded exponential backoff and eventually exhausts retries', async () => {
  const key = `avatars/${'5'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([jobFor(key)]);
  const storage = new FakeR2Storage();
  storage.objects.set(key, { lastModified: new Date() });
  storage.deleteError = new Error('synthetic secret token must not be logged');
  const { User, BloodRequest } = referenceModels();
  const logged = [];
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    logger: { warn: (...args) => logged.push(args) },
    baseDelayMs: 10,
    maxDelayMs: 20,
    maxAttempts: 1,
    reconciliationGraceMs: 100_000_000
  });

  await worker.runOnce();

  const job = [...jobs.jobs.values()][0];
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 1);
  assert.equal(job.lastErrorCode, 'STORAGE_ERROR');
  assert.ok(job.nextAttemptAt > new Date());
  assert.equal(JSON.stringify(logged).includes('secret token'), false);
  assert.equal(JSON.stringify(logged).includes(key), false);
});

test('database reference-check failures use bounded retries and never delete objects', async () => {
  const key = `avatars/${'d'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([jobFor(key)]);
  const deletions = [];
  const storage = {
    async exists() {
      return true;
    },
    async delete({ key: objectKey }) {
      deletions.push(objectKey);
    }
  };
  const User = {
    async exists() {
      throw new Error('synthetic database failure');
    }
  };
  const BloodRequest = {
    async exists() {
      return null;
    }
  };
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    logger: { warn() {} },
    baseDelayMs: 1,
    maxDelayMs: 2,
    maxAttempts: 2,
    batchSize: 1
  });
  const job = [...jobs.jobs.values()][0];

  await worker.runOnce();
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 1);
  assert.equal(job.lastErrorCode, 'REFERENCE_CHECK_FAILED');
  job.nextAttemptAt = new Date(0);

  await worker.runOnce();

  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 2);
  assert.deepEqual(deletions, []);
});

test('retry delays grow exponentially but never exceed the configured cap', async () => {
  const key = `prescriptions/${'5'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([jobFor(key)]);
  const storage = new FakeR2Storage();
  storage.objects.set(key, { lastModified: new Date() });
  storage.deleteError = new Error('synthetic failure');
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    logger: { warn() {} },
    baseDelayMs: 20,
    maxDelayMs: 25,
    maxAttempts: 4,
    reconciliationGraceMs: 100_000_000
  });
  const job = [...jobs.jobs.values()][0];

  await worker.runOnce();
  const firstDelay = job.nextAttemptAt.getTime() - Date.now();
  assert.ok(firstDelay > 0 && firstDelay <= 25);
  assert.equal(job.attempts, 1);

  job.nextAttemptAt = new Date(0);
  await worker.runOnce();
  const secondDelay = job.nextAttemptAt.getTime() - Date.now();
  assert.ok(secondDelay > 0 && secondDelay <= 25);
  assert.equal(job.attempts, 2);

  job.nextAttemptAt = new Date(0);
  storage.deleteError = null;
  await worker.runOnce();
  assert.equal(job.status, 'completed');
  assert.equal(job.attempts, 2);
});

test('stale processing leases are recoverable and completed jobs are not reclaimed', async () => {
  const staleKey = `prescriptions/${'6'.repeat(64)}`;
  const doneKey = `avatars/${'7'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([
    jobFor(staleKey, {
      _id: 'stale',
      status: 'processing',
      leaseUntil: new Date(0)
    }),
    jobFor(doneKey, {
      _id: 'done',
      status: 'completed'
    })
  ]);
  const storage = new FakeR2Storage();
  storage.objects.set(staleKey, { lastModified: new Date() });
  storage.objects.set(doneKey, { lastModified: new Date() });
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    reconciliationGraceMs: 100_000_000
  });

  await worker.runOnce();

  assert.equal(jobs.jobs.get('stale').status, 'completed');
  assert.equal(jobs.jobs.get('done').status, 'completed');
  assert.deepEqual(storage.deleted, [staleKey]);
});

test('R2 unavailable leaves cleanup jobs pending without storage operations', async () => {
  const key = `avatars/${'8'.repeat(64)}`;
  const jobs = new FakeCleanupJobs([jobFor(key)]);
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => ({ status: { r2: { available: false } } })
  });

  const result = await worker.runOnce();

  assert.deepEqual(result, { processed: 0, available: false });
  assert.equal(jobs.jobs.get('job-0').status, 'pending');
});

test('worker startup is idempotent and performs no immediate cleanup request', async () => {
  const jobs = new FakeCleanupJobs();
  const storage = new FakeR2Storage();
  const { User, BloodRequest } = referenceModels();
  const options = {
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    intervalMs: 60_000
  };
  const stop = startStorageCleanupWorker(options);

  assert.equal(startStorageCleanupWorker(options), stop);
  assert.equal(jobs.claimCalls, 0);
  await stop();
});

test('bucket reconciliation queues only old, unreferenced opaque objects', async () => {
  const oldKey = `identity-documents/${'9'.repeat(64)}`;
  const referencedKey = `avatars/${'a'.repeat(64)}`;
  const jobs = new FakeCleanupJobs();
  const storage = new FakeR2Storage();
  storage.objects.set(oldKey, { lastModified: new Date(0) });
  storage.objects.set(referencedKey, { lastModified: new Date(0) });
  const references = {
    avatars: new Set([referencedKey]),
    identities: new Set(),
    requests: new Set()
  };
  const { User, BloodRequest } = referenceModels(references);
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: new FakeReconciliationState(),
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    reconciliationGraceMs: 1
  });

  await worker.runOnce();

  assert.equal(jobs.jobs.size, 1);
  assert.equal([...jobs.jobs.values()][0].key, oldKey);
  assert.equal([...jobs.jobs.values()][0].status, 'pending');
});

test('bucket reconciliation resumes its durable page cursor after worker restart', async () => {
  const firstKey = `avatars/${'b'.repeat(64)}`;
  const secondKey = `avatars/${'c'.repeat(64)}`;
  const jobs = new FakeCleanupJobs();
  const state = new FakeReconciliationState();
  const storage = new FakeR2Storage();
  storage.objects.set(firstKey, { lastModified: new Date(0) });
  storage.objects.set(secondKey, { lastModified: new Date(0) });
  const { User, BloodRequest } = referenceModels();
  const options = {
    StorageCleanupJob: jobs,
    StorageReconciliationState: state,
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    reconciliationGraceMs: 1,
    reconciliationPageSize: 1
  };

  await createStorageCleanupWorker(options).runOnce();
  assert.equal(state.states.get('avatars').continuationToken, firstKey);
  await createStorageCleanupWorker(options).runOnce();

  assert.deepEqual(
    [...jobs.jobs.values()]
      .filter((job) => job.purpose === 'avatars')
      .map((job) => job.key)
      .sort(),
    [firstKey, secondKey].sort()
  );
});

test('reconciliation page failure records attempts and preserves the cursor', async () => {
  const jobs = new FakeCleanupJobs();
  const state = new FakeReconciliationState();
  state.states.set('avatars', {
    _id: 'avatars',
    continuationToken: 'persisted-cursor',
    status: 'active',
    attempts: 2,
    lastErrorCode: null,
    nextAttemptAt: new Date(0),
    leaseUntil: null,
    leaseToken: null
  });
  const storage = new FakeR2Storage();
  storage.listError = new Error('synthetic listing failure');
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: state,
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    logger: { warn() {} },
    baseDelayMs: 1,
    maxDelayMs: 10,
    reconciliationGraceMs: 1
  });

  await assert.rejects(worker.runOnce(), /synthetic listing failure/);

  const reconciliation = state.states.get('avatars');
  assert.equal(reconciliation.attempts, 3);
  assert.equal(reconciliation.lastErrorCode, 'LIST_FAILED');
  assert.equal(reconciliation.continuationToken, 'persisted-cursor');
  assert.equal(reconciliation.status, 'active');
  assert.equal(reconciliation.leaseToken, null);
});

test('reconciliation backoff is exponential and capped', async () => {
  const state = new FakeReconciliationState();
  const storage = new FakeR2Storage();
  storage.listError = new Error('synthetic listing failure');
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: new FakeCleanupJobs(),
    StorageReconciliationState: state,
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    logger: { warn() {} },
    baseDelayMs: 5,
    maxDelayMs: 12,
    reconciliationGraceMs: 1
  });

  const delays = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await assert.rejects(worker.runOnce(), /synthetic listing failure/);
    const reconciliation = state.states.get('avatars');
    assert.equal(reconciliation.attempts, attempt);
    delays.push(reconciliation.nextAttemptAt.getTime() - Date.now());
    reconciliation.nextAttemptAt = new Date(0);
  }

  assert.ok(delays[0] > 0 && delays[0] <= 5);
  assert.ok(delays[1] > delays[0] && delays[1] <= 10);
  assert.ok(delays[2] > delays[1] && delays[2] <= 12);
});

test('reconciliation reaches a terminal failed state at its attempt limit', async () => {
  const state = new FakeReconciliationState();
  const storage = new FakeR2Storage();
  storage.listError = new Error('synthetic listing failure');
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: new FakeCleanupJobs(),
    StorageReconciliationState: state,
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    logger: { warn() {} },
    baseDelayMs: 1,
    maxDelayMs: 2,
    reconciliationMaxAttempts: 2,
    reconciliationGraceMs: 1
  });

  await assert.rejects(worker.runOnce(), /synthetic listing failure/);
  state.states.get('avatars').nextAttemptAt = new Date(0);
  await assert.rejects(worker.runOnce(), /synthetic listing failure/);
  const callsAtFailure = storage.listCalls.length;
  storage.listError = null;
  await worker.runOnce();

  assert.equal(state.states.get('avatars').status, 'failed');
  assert.equal(state.states.get('avatars').attempts, 2);
  assert.equal(storage.listCalls.length, callsAtFailure + 2);
});

test('successful reconciliation page resets attempts and clears the error', async () => {
  const state = new FakeReconciliationState();
  state.states.set('avatars', {
    _id: 'avatars',
    continuationToken: 'old-cursor',
    status: 'active',
    attempts: 3,
    lastErrorCode: 'LIST_FAILED',
    nextAttemptAt: new Date(0),
    leaseUntil: null,
    leaseToken: null
  });
  const storage = new FakeR2Storage();
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: new FakeCleanupJobs(),
    StorageReconciliationState: state,
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    reconciliationGraceMs: 1
  });

  await worker.runOnce();

  const reconciliation = state.states.get('avatars');
  assert.equal(reconciliation.attempts, 0);
  assert.equal(reconciliation.lastErrorCode, null);
  assert.equal(reconciliation.continuationToken, null);
  assert.equal(reconciliation.status, 'active');
});

test('reference-query failure fails closed and leaves the page cursor unchanged', async () => {
  const key = `avatars/${'e'.repeat(64)}`;
  const state = new FakeReconciliationState();
  state.states.set('avatars', {
    _id: 'avatars',
    continuationToken: 'avatars/',
    status: 'active',
    attempts: 0,
    lastErrorCode: null,
    nextAttemptAt: new Date(0),
    leaseUntil: null,
    leaseToken: null
  });
  const jobs = new FakeCleanupJobs();
  const storage = new FakeR2Storage();
  storage.objects.set(key, { lastModified: new Date(0) });
  const User = {
    async exists() {
      throw new Error('synthetic database failure');
    }
  };
  const BloodRequest = {
    async exists() {
      return null;
    }
  };
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: jobs,
    StorageReconciliationState: state,
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    logger: { warn() {} },
    reconciliationGraceMs: 1
  });

  await assert.rejects(worker.runOnce(), /synthetic database failure/);

  assert.deepEqual(storage.deleted, []);
  assert.equal(jobs.jobs.size, 0);
  assert.equal(state.states.get('avatars').continuationToken, 'avatars/');
  assert.equal(state.states.get('avatars').attempts, 1);
  assert.equal(state.states.get('avatars').lastErrorCode, 'REFERENCE_CHECK_FAILED');
});

test('retry-state write failure blocks repeated reconciliation in this worker process', async () => {
  const state = new FakeReconciliationState();
  state.failNextUpdate = true;
  const storage = new FakeR2Storage();
  storage.listError = new Error('synthetic listing failure');
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: new FakeCleanupJobs(),
    StorageReconciliationState: state,
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    logger: { warn() {} },
    reconciliationGraceMs: 1
  });

  await assert.rejects(worker.runOnce(), /retry state could not be saved/);
  const avatarListCalls = storage.listCalls.filter(({ purpose }) => purpose === 'avatars').length;
  storage.listError = null;
  await worker.runOnce();

  assert.equal(
    storage.listCalls.filter(({ purpose }) => purpose === 'avatars').length,
    avatarListCalls
  );
  assert.equal(state.states.get('avatars').continuationToken, null);
});

test('expired reconciliation leases are reclaimed safely', async () => {
  const state = new FakeReconciliationState();
  state.states.set('avatars', {
    _id: 'avatars',
    continuationToken: 'lease-cursor',
    status: 'active',
    attempts: 1,
    lastErrorCode: null,
    nextAttemptAt: new Date(0),
    leaseUntil: new Date(0),
    leaseToken: 'expired-lease'
  });
  const storage = new FakeR2Storage();
  const { User, BloodRequest } = referenceModels();
  const worker = createStorageCleanupWorker({
    StorageCleanupJob: new FakeCleanupJobs(),
    StorageReconciliationState: state,
    User,
    BloodRequest,
    getStorage: () => runtime(storage),
    reconciliationGraceMs: 1
  });

  await worker.runOnce();

  assert.equal(storage.listCalls[0].purpose, 'avatars');
  assert.equal(storage.listCalls[0].continuationToken, 'lease-cursor');
  assert.equal(state.states.get('avatars').leaseToken, null);
  assert.equal(state.states.get('avatars').attempts, 0);
});

test('R2 provider lists only approved-purpose opaque object keys using fake S3', async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command);
      if (!(command instanceof ListObjectsV2Command)) {
        throw new Error('Unexpected S3 command.');
      }
      return {
        IsTruncated: false,
        Contents: [
          { Key: `prescriptions/${'b'.repeat(64)}`, LastModified: new Date(0) },
          { Key: 'prescriptions/../private', LastModified: new Date(0) }
        ]
      };
    }
  };
  const storage = createStorageService(
    createR2Provider({ client, bucket: 'lifelink-cleanup-test' })
  );

  const page = await storage.list({ purpose: 'prescriptions', maxKeys: 10 });

  assert.deepEqual(page.objects.map((object) => object.key), [
    `prescriptions/${'b'.repeat(64)}`
  ]);
  assert.equal(commands[0].input.Prefix, 'prescriptions/');
  assert.equal(commands[0].input.MaxKeys, 10);
});
