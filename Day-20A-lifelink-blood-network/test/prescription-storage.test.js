const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const {
  canAccessPrescription,
  createPrescriptionUploadHandler,
  enqueuePrescriptionCleanup,
  hasPrescriptionStorage,
  moveLegacyPrescriptionToQuarantine,
  sendLegacyPrescription,
  sendR2Prescription
} = require('../utils/prescriptionStorage');
const { createR2Provider } = require('../utils/storage/r2Provider');
const { createStorageService } = require('../utils/storage/storageService');

const pdfBytes = Buffer.from('%PDF-synthetic prescription');
const filename = '0123456789abcdef0123456789abcdef.pdf';

class FakeS3Client {
  constructor() {
    this.objects = new Map();
    this.commands = [];
    this.failPut = false;
    this.failGet = null;
  }

  async send(command) {
    this.commands.push(command);
    const key = command.input.Key;
    if (command instanceof PutObjectCommand) {
      if (this.failPut) throw new Error('Synthetic R2 upload failure');
      this.objects.set(key, {
        body: Buffer.from(command.input.Body),
        contentType: command.input.ContentType,
        metadata: command.input.Metadata
      });
      return {};
    }
    if (command instanceof GetObjectCommand) {
      if (this.failGet) throw this.failGet;
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error('Missing object'), { name: 'NoSuchKey' });
      return {
        Body: object.body,
        ContentType: object.contentType,
        Metadata: object.metadata
      };
    }
    if (command instanceof HeadObjectCommand) {
      if (!this.objects.has(key)) {
        throw Object.assign(new Error('Missing object'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 }
        });
      }
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  }
}

function createR2Runtime(client = new FakeS3Client()) {
  return {
    client,
    runtime: {
      status: { r2: { available: true } },
      r2Storage: createStorageService(createR2Provider({
        client,
        bucket: 'lifelink-private-test'
      }))
    }
  };
}

function createBloodRequestModel(initial = {
  _id: 'synthetic-request',
  requester: 'synthetic-requester',
  prescription: null
}, onSave = () => {}) {
  const records = new Map([[String(initial._id), { ...initial }]]);
  const events = [];
  let saveError = null;
  const model = {
    findById(id) {
      return {
        select: async () => {
          const record = records.get(String(id));
          if (!record) return null;
          return {
            ...record,
            async save() {
              events.push('save');
              onSave();
              if (saveError) throw saveError;
              records.set(String(id), {
                _id: this._id,
                requester: this.requester,
                prescription: this.prescription,
                prescriptionStorage: this.prescriptionStorage
              });
            }
          };
        }
      };
    },
    async exists(filter) {
      events.push('reference-check');
      return [...records.values()].some((record) =>
        record.prescriptionStorage &&
        record.prescriptionStorage.key === filter['prescriptionStorage.key']
      ) ? { _id: 'synthetic-request' } : null;
    },
    records,
    events,
    setSaveError(error) {
      saveError = error;
    }
  };
  return model;
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    type(contentType) {
      this.headers['Content-Type'] = contentType;
      return this;
    },
    attachment(filenameValue) {
      this.headers['Content-Disposition'] = `attachment; filename="${filenameValue}"`;
      return this;
    },
    set(headers) {
      Object.assign(this.headers, headers);
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    }
  };
}

async function createTempDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lifelink-prescription-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function makeHandler({
  BloodRequest,
  runtime,
  uploadDirectory,
  validateContents = async () => pdfBytes,
  cleanupJobs = []
}) {
  return createPrescriptionUploadHandler({
    BloodRequest,
    getStorage: () => runtime,
    uploadDirectory,
    validateContents,
    enqueueCleanup: async (target) => cleanupJobs.push(target),
    withRequiredTransaction: async (operation) => operation(null)
  });
}

function makeRequest(filePath, requester = 'synthetic-requester') {
  return {
    params: { id: 'synthetic-request' },
    user: { id: requester, role: 'requester' },
    file: {
      path: filePath,
      filename,
      originalname: 'medical-record.pdf',
      mimetype: 'application/pdf'
    }
  };
}

test('R2 upload verifies existence, checksum and size before saving prescription metadata', async (t) => {
  const uploadDirectory = await createTempDirectory(t);
  const filePath = path.join(uploadDirectory, filename);
  await fs.writeFile(filePath, pdfBytes);
  const { runtime, client } = createR2Runtime();
  let commandCountWhenSaved;
  const BloodRequest = createBloodRequestModel(undefined, () => {
    commandCountWhenSaved = client.commands.length;
  });
  const handler = makeHandler({ BloodRequest, runtime, uploadDirectory });
  const res = createResponse();
  let nextError;

  await handler(makeRequest(filePath), res, (error) => { nextError = error; });

  const stored = BloodRequest.records.get('synthetic-request');
  assert.equal(nextError, undefined);
  assert.match(stored.prescriptionStorage.key, /^prescriptions\/[a-f\d]{64}$/);
  assert.equal(stored.prescription, filename);
  assert.equal(stored.prescriptionStorage.provider, 'r2');
  assert.equal(stored.prescriptionStorage.checksumSha256, crypto.createHash('sha256').update(pdfBytes).digest('hex'));
  assert.equal(stored.prescriptionStorage.size, pdfBytes.length);
  assert.ok(client.commands.findIndex((command) => command instanceof HeadObjectCommand) <
    client.commands.findIndex((command) => command instanceof GetObjectCommand));
  assert.ok(commandCountWhenSaved >= 3);
  assert.deepEqual(res.body, {
    success: true,
    message: 'Prescription uploaded successfully.',
    prescription: filename
  });
  assert.equal(JSON.stringify(res.body).includes('prescriptionStorage'), false);
  assert.equal(client.objects.has(stored.prescriptionStorage.key), true);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});

test('R2 unavailable preserves local upload and stores no R2 metadata', async (t) => {
  const uploadDirectory = await createTempDirectory(t);
  const filePath = path.join(uploadDirectory, filename);
  await fs.writeFile(filePath, pdfBytes);
  const BloodRequest = createBloodRequestModel();
  const runtime = { status: { r2: { available: false } } };
  const res = createResponse();
  let nextError;

  await makeHandler({ BloodRequest, runtime, uploadDirectory })(
    makeRequest(filePath),
    res,
    (error) => { nextError = error; }
  );

  assert.equal(nextError, undefined);
  assert.equal(BloodRequest.records.get('synthetic-request').prescription, filename);
  assert.equal(BloodRequest.records.get('synthetic-request').prescriptionStorage, undefined);
  assert.equal((await fs.readFile(filePath)).equals(pdfBytes), true);
  assert.deepEqual(res.body, {
    success: true,
    message: 'Prescription uploaded successfully.',
    prescription: filename
  });
});

test('production NODE_ENV variants fail closed and remove the staged prescription', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });
  const uploadDirectory = await createTempDirectory(t);
  const BloodRequest = createBloodRequestModel();

  for (const nodeEnv of ['production', 'Production', ' production ']) {
    process.env.NODE_ENV = nodeEnv;
    const filePath = path.join(uploadDirectory, filename);
    await fs.writeFile(filePath, pdfBytes);
    let nextError;

    await makeHandler({
      BloodRequest,
      runtime: { status: { r2: { available: false } } },
      uploadDirectory
    })(makeRequest(filePath), createResponse(), (error) => { nextError = error; });

    assert.equal(nextError.statusCode, 503, `NODE_ENV=${JSON.stringify(nodeEnv)}`);
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  }
});

test('prescription temporary-file cleanup failure is logged and returned without filesystem details', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });
  process.env.NODE_ENV = 'production';
  const uploadDirectory = await createTempDirectory(t);
  const filePath = path.join(uploadDirectory, filename);
  await fs.writeFile(filePath, pdfBytes);
  const warnings = [];
  const handler = createPrescriptionUploadHandler({
    BloodRequest: createBloodRequestModel(),
    getStorage: () => ({ status: { r2: { available: false } } }),
    uploadDirectory,
    validateContents: async () => pdfBytes,
    enqueueCleanup: async () => {},
    withRequiredTransaction: async (operation) => operation(null),
    unlink: async () => { throw new Error(`synthetic unlink failure: ${filePath}`); },
    logger: { warn: (message) => warnings.push(message) }
  });
  let nextError;

  await handler(makeRequest(filePath), createResponse(), (error) => { nextError = error; });

  assert.equal(nextError.statusCode, 500);
  assert.equal(nextError.message, 'Upload failed and temporary file cleanup could not be completed.');
  assert.equal(nextError.message.includes(filePath), false);
  assert.deepEqual(warnings, ['Failed to remove a temporary prescription upload.']);
  assert.equal((await fs.readFile(filePath)).equals(pdfBytes), true);
});

test('R2 upload failure leaves the existing request reference unchanged', async (t) => {
  const uploadDirectory = await createTempDirectory(t);
  const filePath = path.join(uploadDirectory, filename);
  await fs.writeFile(filePath, pdfBytes);
  const previous = {
    _id: 'synthetic-request',
    requester: 'synthetic-requester',
    prescription: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf'
  };
  const BloodRequest = createBloodRequestModel(previous);
  const { runtime, client } = createR2Runtime();
  client.failPut = true;
  let nextError;

  await makeHandler({ BloodRequest, runtime, uploadDirectory })(
    makeRequest(filePath),
    createResponse(),
    (error) => { nextError = error; }
  );

  assert.match(nextError.message, /Synthetic R2 upload failure/);
  assert.deepEqual(BloodRequest.records.get('synthetic-request'), previous);
  assert.equal(client.commands.filter((command) => command instanceof DeleteObjectCommand).length, 0);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});

test('database save failure queues cleanup of only the newly uploaded R2 object', async (t) => {
  const uploadDirectory = await createTempDirectory(t);
  const filePath = path.join(uploadDirectory, filename);
  await fs.writeFile(filePath, pdfBytes);
  const previous = {
    _id: 'synthetic-request',
    requester: 'synthetic-requester',
    prescription: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf'
  };
  const BloodRequest = createBloodRequestModel(previous);
  BloodRequest.setSaveError(new Error('Synthetic database save failure'));
  const { runtime, client } = createR2Runtime();
  const cleanupJobs = [];
  let nextError;

  await makeHandler({ BloodRequest, runtime, uploadDirectory, cleanupJobs })(
    makeRequest(filePath),
    createResponse(),
    (error) => { nextError = error; }
  );

  assert.match(nextError.message, /Synthetic database save failure/);
  assert.deepEqual(BloodRequest.records.get('synthetic-request'), previous);
  assert.equal(client.objects.size, 1);
  const uploadedKey = [...client.objects.keys()][0];
  assert.ok(cleanupJobs.some((job) =>
    job.purpose === 'prescriptions' && job.key === uploadedKey
  ));
  assert.equal(client.commands.filter((command) => command instanceof DeleteObjectCommand).length, 0);
});

test('successful replacement queues the old R2 object after saving the new reference', async (t) => {
  const uploadDirectory = await createTempDirectory(t);
  const filePath = path.join(uploadDirectory, filename);
  await fs.writeFile(filePath, pdfBytes);
  const { runtime, client } = createR2Runtime();
  const oldObject = await runtime.r2Storage.upload({
    purpose: 'prescription',
    body: Buffer.from('%PDF-old synthetic'),
    contentType: 'application/pdf'
  });
  const BloodRequest = createBloodRequestModel({
    _id: 'synthetic-request',
    requester: 'synthetic-requester',
    prescription: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf',
    prescriptionStorage: {
      provider: 'r2',
      key: oldObject.key,
      checksumSha256: oldObject.checksumSha256,
      size: oldObject.size
    }
  });
  const cleanupJobs = [];
  await makeHandler({ BloodRequest, runtime, uploadDirectory, cleanupJobs })(
    makeRequest(filePath),
    createResponse(),
    (error) => { throw error; }
  );

  assert.equal(BloodRequest.events.includes('reference-check'), false);
  assert.equal(client.objects.has(oldObject.key), true);
  assert.ok(cleanupJobs.some((job) =>
    job.purpose === 'prescriptions' && job.key === oldObject.key
  ));
  const newKey = BloodRequest.records.get('synthetic-request').prescriptionStorage.key;
  assert.equal(client.objects.has(newKey), true);

  const sharedObject = await runtime.r2Storage.upload({
    purpose: 'prescription',
    body: Buffer.from('%PDF-shared synthetic'),
    contentType: 'application/pdf'
  });
  BloodRequest.records.set('synthetic-request', {
    ...BloodRequest.records.get('synthetic-request'),
    prescriptionStorage: {
      provider: 'r2',
      key: sharedObject.key,
      checksumSha256: sharedObject.checksumSha256,
      size: sharedObject.size
    }
  });
  BloodRequest.records.set('other-request', {
    _id: 'other-request',
    requester: 'other-user',
    prescriptionStorage: {
      provider: 'r2',
      key: sharedObject.key,
      checksumSha256: sharedObject.checksumSha256,
      size: sharedObject.size
    }
  });
  const secondFile = path.join(uploadDirectory, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf');
  await fs.writeFile(secondFile, pdfBytes);
  const secondRequest = makeRequest(secondFile);
  secondRequest.file.filename = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf';
  await makeHandler({ BloodRequest, runtime, uploadDirectory })(
    secondRequest,
    createResponse(),
    (error) => { throw error; }
  );
  assert.equal(client.objects.has(sharedObject.key), true);
});

test('authorization permits only the requester, admin, or donor with accepted offer', async () => {
  const request = { _id: 'request-1', requester: 'requester-1' };
  const acceptedOffer = { exists: async () => true };
  const noOffer = { exists: async () => false };

  assert.equal(await canAccessPrescription({
    request, user: { id: 'requester-1', role: 'requester' }, Offer: noOffer
  }), true);
  assert.equal(await canAccessPrescription({
    request, user: { id: 'admin-1', role: 'admin' }, Offer: noOffer
  }), true);
  assert.equal(await canAccessPrescription({
    request, user: { id: 'donor-1', role: 'donor' }, Offer: acceptedOffer
  }), true);
  assert.equal(await canAccessPrescription({
    request, user: { id: 'donor-1', role: 'donor' }, Offer: noOffer
  }), false);
  assert.equal(await canAccessPrescription({
    request, user: { id: 'other-user', role: 'requester' }, Offer: acceptedOffer
  }), false);
});

test('legacy local prescription references are distinguished from R2 references', async () => {
  assert.equal(hasPrescriptionStorage({ prescription: filename }), false);
  assert.equal(hasPrescriptionStorage({
    prescription: filename,
    prescriptionStorage: { provider: 'r2' }
  }), true);
});

test('request deletion never passes an R2-backed prescription to local quarantine', async () => {
  let quarantineCalls = 0;
  const request = {
    prescription: filename,
    prescriptionStorage: {
      provider: 'r2',
      key: `prescriptions/${'a'.repeat(64)}`
    }
  };
  const moved = await moveLegacyPrescriptionToQuarantine(request, async () => {
    quarantineCalls += 1;
    throw new Error('R2 object must not be used as a local path.');
  });
  assert.equal(moved, null);
  assert.equal(quarantineCalls, 0);

  await moveLegacyPrescriptionToQuarantine(
    { prescription: filename },
    async (legacyFilename) => {
      assert.equal(legacyFilename, filename);
      quarantineCalls += 1;
      return { quarantinePath: 'synthetic-quarantine-path' };
    }
  );
  assert.equal(quarantineCalls, 1);
});

test('request and admin deletion queue only R2 prescription keys', async () => {
  const jobs = [];
  const metadata = {
    provider: 'r2',
    key: `prescriptions/${'a'.repeat(64)}`
  };
  const enqueue = async (target, session) => jobs.push({ target, session });

  assert.equal(await enqueuePrescriptionCleanup({
    prescriptionStorage: metadata
  }, enqueue, { syntheticSession: true }), true);
  assert.equal(await enqueuePrescriptionCleanup({
    prescription: filename
  }, enqueue), false);
  assert.deepEqual(jobs, [{
    target: { purpose: 'prescriptions', key: metadata.key },
    session: { syntheticSession: true }
  }]);
  await assert.rejects(enqueuePrescriptionCleanup({
    prescriptionStorage: { provider: 'unknown', key: metadata.key }
  }, enqueue), /metadata is invalid/);
});

test('legacy local prescription download preserves its filename and bytes', async (t) => {
  const uploadDirectory = await createTempDirectory(t);
  const filePath = path.join(uploadDirectory, filename);
  await fs.writeFile(filePath, pdfBytes);
  const res = {
    download(pathValue, name, callback) {
      this.filePath = pathValue;
      this.filename = name;
      this.callback = callback;
      return this;
    }
  };
  await sendLegacyPrescription({
    filename,
    directory: uploadDirectory,
    res,
    next: (error) => { throw error; }
  });

  assert.equal(res.filePath, filePath);
  assert.equal(res.filename, filename);
  assert.deepEqual(await fs.readFile(res.filePath), pdfBytes);
});

test('R2 prescription download sends private attachment after authorization and hides metadata', async () => {
  const { runtime } = createR2Runtime();
  const uploaded = await runtime.r2Storage.upload({
    purpose: 'prescription',
    body: pdfBytes,
    contentType: 'application/pdf'
  });
  const request = {
    prescription: filename,
    prescriptionStorage: {
      provider: 'r2',
      key: uploaded.key,
      checksumSha256: uploaded.checksumSha256,
      size: uploaded.size
    }
  };
  assert.equal(await canAccessPrescription({
    request: { _id: 'request-1', requester: 'owner' },
    user: { id: 'owner', role: 'requester' },
    Offer: { exists: async () => false }
  }), true);
  const res = createResponse();

  await sendR2Prescription({ request, storageRuntime: runtime, res });

  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.headers['Content-Disposition'], `attachment; filename="${filename}"`);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(res.body, pdfBytes);
  assert.equal(JSON.stringify(res.body).includes(uploaded.key), false);
});

test('missing R2 object and wrong key prefix fail without local fallback', async () => {
  const { runtime } = createR2Runtime();
  const request = {
    prescription: filename,
    prescriptionStorage: {
      provider: 'r2',
      key: `prescriptions/${'a'.repeat(64)}`,
      checksumSha256: 'b'.repeat(64),
      size: pdfBytes.length
    }
  };
  const res = createResponse();

  await assert.rejects(
    sendR2Prescription({ request, storageRuntime: runtime, res }),
    (error) => error.statusCode === 404
  );
  await assert.rejects(
    sendR2Prescription({
      request: {
        ...request,
        prescriptionStorage: {
          ...request.prescriptionStorage,
          key: `avatars/${'a'.repeat(64)}`
        }
      },
      storageRuntime: runtime,
      res
    }),
    /metadata is invalid/
  );
});

test('R2 unavailable or read errors fail closed for R2-backed prescriptions', async () => {
  const { runtime, client } = createR2Runtime();
  const request = {
    prescription: filename,
    prescriptionStorage: {
      provider: 'r2',
      key: `prescriptions/${'a'.repeat(64)}`,
      checksumSha256: 'b'.repeat(64),
      size: pdfBytes.length
    }
  };
  const unavailableRuntime = { status: { r2: { available: false } } };
  await assert.rejects(
    sendR2Prescription({ request, storageRuntime: unavailableRuntime, res: createResponse() }),
    (error) => error.statusCode === 503
  );

  client.failGet = new Error('Synthetic R2 read failure');
  await assert.rejects(
    sendR2Prescription({ request, storageRuntime: runtime, res: createResponse() }),
    /Synthetic R2 read failure/
  );
});
