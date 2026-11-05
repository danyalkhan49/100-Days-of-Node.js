const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  checksum,
  createStorageService
} = require('../utils/storage/storageService');
const { createLocalFileProvider } = require('../utils/storage/localFileProvider');

async function createTemporaryDirectory(t, prefix) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function createTemporaryStorage(t) {
  const rootDirectory = await createTemporaryDirectory(t, 'lifelink-storage-test-');
  return createStorageService(createLocalFileProvider({ rootDirectory }));
}

test('local provider uploads, downloads, verifies, and idempotently deletes in temp storage', async (t) => {
  const storage = await createTemporaryStorage(t);
  const body = Buffer.from('synthetic local prescription');
  const uploaded = await storage.upload({
    purpose: 'prescription',
    body,
    contentType: 'application/pdf'
  });

  assert.match(uploaded.key, /^prescriptions\/[a-f\d]{64}$/);
  assert.equal(await storage.exists({ key: uploaded.key }), true);
  assert.deepEqual(await storage.verify({
    key: uploaded.key,
    checksumSha256: checksum(body)
  }), {
    exists: true,
    verified: true,
    checksumSha256: checksum(body)
  });

  const downloaded = await storage.download({
    key: uploaded.key,
    checksumSha256: checksum(body)
  });
  assert.deepEqual(downloaded.body, body);
  assert.equal(downloaded.checksumSha256, checksum(body));

  await storage.delete({ key: uploaded.key });
  await storage.delete({ key: uploaded.key });
  assert.equal(await storage.exists({ key: uploaded.key }), false);
});

test('local provider confines paths and rejects unapproved prefixes', async (t) => {
  const storage = await createTemporaryStorage(t);

  await assert.rejects(
    storage.download({ key: 'avatars/../../outside' }),
    /Storage key/
  );
  await assert.rejects(
    storage.delete({ key: 'other/0000000000000000000000000000000000000000000000000000000000000000' }),
    /Storage key/
  );
  assert.equal(await storage.exists({
    key: `avatars/${'a'.repeat(64)}`
  }), false);
});

test('local provider reports missing object downloads as not found', async (t) => {
  const storage = await createTemporaryStorage(t);
  const key = `avatars/${'d'.repeat(64)}`;

  await assert.rejects(
    storage.download({ key }),
    (error) => error.code === 'ENOENT'
  );
  assert.equal(await storage.exists({ key }), false);
  await storage.delete({ key });
});

test('local provider reads, verifies, and deletes legacy files from configured temp roots', async (t) => {
  const rootDirectory = await createTemporaryDirectory(t, 'lifelink-storage-legacy-');
  const avatarDirectory = path.join(rootDirectory, 'legacy-avatars');
  await fs.promises.mkdir(avatarDirectory, { recursive: true });
  const filename = `${'c'.repeat(32)}.png`;
  const body = Buffer.from('synthetic legacy avatar');
  await fs.promises.writeFile(path.join(avatarDirectory, filename), body);

  const storage = createStorageService(createLocalFileProvider({
    rootDirectory: path.join(rootDirectory, 'new-objects'),
    legacyRoots: { avatar: avatarDirectory }
  }));
  assert.equal(await storage.existsLegacy({ purpose: 'avatar', filename }), true);
  assert.deepEqual(await storage.verifyLegacy({
    purpose: 'avatar',
    filename,
    checksumSha256: checksum(body),
    contentType: 'image/png'
  }), {
    exists: true,
    verified: true,
    checksumSha256: checksum(body)
  });
  assert.deepEqual((await storage.downloadLegacy({
    purpose: 'avatar',
    filename,
    contentType: 'image/png'
  })).body, body);

  await storage.deleteLegacy({ purpose: 'avatar', filename });
  await storage.deleteLegacy({ purpose: 'avatar', filename });
  assert.equal(await storage.existsLegacy({ purpose: 'avatar', filename }), false);
});

test('local provider reports missing legacy downloads as not found', async (t) => {
  const rootDirectory = await createTemporaryDirectory(t, 'lifelink-storage-missing-legacy-');
  const legacyDirectory = path.join(rootDirectory, 'legacy-prescriptions');
  const storage = createStorageService(createLocalFileProvider({
    rootDirectory: path.join(rootDirectory, 'new-objects'),
    legacyRoots: { prescription: legacyDirectory }
  }));
  const filename = `${'e'.repeat(32)}.pdf`;

  await assert.rejects(
    storage.downloadLegacy({ purpose: 'prescription', filename }),
    (error) => error.code === 'ENOENT'
  );
  assert.equal(await storage.existsLegacy({ purpose: 'prescription', filename }), false);
  await storage.deleteLegacy({ purpose: 'prescription', filename });
});

test('directories at valid object keys are rejected and never recursively deleted', async (t) => {
  const key = `avatars/${'f'.repeat(64)}`;
  const rootDirectory = await createTemporaryDirectory(t, 'lifelink-storage-directory-');
  const isolatedStorage = createStorageService(createLocalFileProvider({ rootDirectory }));
  const objectDirectory = path.join(rootDirectory, ...key.split('/'));
  await fs.promises.mkdir(objectDirectory, { recursive: true });
  const child = path.join(objectDirectory, 'keep.txt');
  await fs.promises.writeFile(child, 'synthetic directory contents');

  await assert.rejects(isolatedStorage.exists({ key }), /regular file/);
  await assert.rejects(isolatedStorage.download({ key }), /regular file/);
  await assert.rejects(isolatedStorage.delete({ key }), /regular file/);
  assert.equal(await fs.promises.readFile(child, 'utf8'), 'synthetic directory contents');
});

test('directories at valid legacy filenames are rejected and never recursively deleted', async (t) => {
  const rootDirectory = await createTemporaryDirectory(t, 'lifelink-storage-legacy-directory-');
  const legacyDirectory = path.join(rootDirectory, 'legacy-avatars');
  const filename = `${'1'.repeat(32)}.png`;
  const targetDirectory = path.join(legacyDirectory, filename);
  await fs.promises.mkdir(targetDirectory, { recursive: true });
  const child = path.join(targetDirectory, 'keep.txt');
  await fs.promises.writeFile(child, 'synthetic legacy directory contents');

  const storage = createStorageService(createLocalFileProvider({
    rootDirectory: path.join(rootDirectory, 'new-objects'),
    legacyRoots: { avatar: legacyDirectory }
  }));
  await assert.rejects(
    storage.existsLegacy({ purpose: 'avatar', filename }),
    /regular file/
  );
  await assert.rejects(
    storage.downloadLegacy({ purpose: 'avatar', filename }),
    /regular file/
  );
  await assert.rejects(
    storage.deleteLegacy({ purpose: 'avatar', filename }),
    /regular file/
  );
  assert.equal(await fs.promises.readFile(child, 'utf8'), 'synthetic legacy directory contents');
});

test('local provider verifies the file remains under its configured root', async (t) => {
  const rootDirectory = await createTemporaryDirectory(t, 'lifelink-storage-root-');
  const outsideDirectory = await createTemporaryDirectory(t, 'lifelink-storage-outside-');

  const key = `avatars/${'b'.repeat(64)}`;
  const outsideFile = path.join(outsideDirectory, 'outside');
  await fs.promises.writeFile(outsideFile, Buffer.from('synthetic outside data'));
  await fs.promises.mkdir(path.join(rootDirectory, 'avatars'), { recursive: true });
  const storage = createStorageService(createLocalFileProvider({ rootDirectory }));

  try {
    await fs.promises.symlink(
      outsideFile,
      path.join(rootDirectory, ...key.split('/')),
      'file'
    );
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Platform does not permit creating the symlink needed for this test.');
      return;
    }
    throw error;
  }

  await assert.rejects(storage.download({ key }), /Symbolic links/);
  await assert.rejects(storage.delete({ key }), /Symbolic links/);
  assert.equal(await fs.promises.readFile(outsideFile, 'utf8'), 'synthetic outside data');
});

test('legacy symlinks are rejected for reads and deletes without changing the outside sentinel', async (t) => {
  const rootDirectory = await createTemporaryDirectory(t, 'lifelink-storage-legacy-link-');
  const legacyDirectory = path.join(rootDirectory, 'legacy-avatars');
  const outsideDirectory = await createTemporaryDirectory(t, 'lifelink-storage-sentinel-');
  await fs.promises.mkdir(legacyDirectory, { recursive: true });
  const filename = `${'2'.repeat(32)}.png`;
  const outsideFile = path.join(outsideDirectory, 'sentinel.png');
  const sentinel = Buffer.from('synthetic outside sentinel');
  await fs.promises.writeFile(outsideFile, sentinel);

  try {
    await fs.promises.symlink(outsideFile, path.join(legacyDirectory, filename), 'file');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Platform permissions deny creation of the symlink needed for this test.');
      return;
    }
    throw error;
  }

  const storage = createStorageService(createLocalFileProvider({
    rootDirectory: path.join(rootDirectory, 'new-objects'),
    legacyRoots: { avatar: legacyDirectory }
  }));
  await assert.rejects(
    storage.downloadLegacy({ purpose: 'avatar', filename }),
    /Symbolic links/
  );
  await assert.rejects(
    storage.deleteLegacy({ purpose: 'avatar', filename }),
    /Symbolic links/
  );
  assert.deepEqual(await fs.promises.readFile(outsideFile), sentinel);
});

test('temporary cleanup removes only the exact registered directory', async (t) => {
  const temporaryDirectory = await createTemporaryDirectory(t, 'lifelink-cleanup-target-');
  const sentinelDirectory = await createTemporaryDirectory(t, 'lifelink-cleanup-sentinel-');
  const sentinelFile = path.join(sentinelDirectory, 'keep.txt');
  await fs.promises.writeFile(sentinelFile, 'must remain');
  await fs.promises.writeFile(path.join(temporaryDirectory, 'remove.txt'), 'temporary');

  await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  assert.equal(await fs.promises.access(temporaryDirectory).then(
    () => true,
    () => false
  ), false);
  assert.equal(await fs.promises.readFile(sentinelFile, 'utf8'), 'must remain');
});
