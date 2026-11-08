const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  createBackupService,
  safeEnvironmentName,
  archivePattern
} = require('../scripts/backupDatabase');

function fakeFs(overrides = {}) {
  return {
    promises: {
      readdir: async () => [],
      stat: async () => ({ mtimeMs: 0, isFile: () => true, mode: 0o700 }),
      unlink: async () => {},
      rm: async () => {},
      chmod: async () => {},
      ...overrides
    },
    createReadStream: () => Readable.from([])
  };
}

function createRunHarness({ existing = [], failLinkTarget, failLockClose = false, failRmPath, childMode = 'success' } = {}) {
  const files = new Map(existing.map(([file, data]) => [file, Buffer.from(data)]));
  const removed = [];
  let resolveSpawned;
  const spawned = new Promise((resolve) => { resolveSpawned = resolve; });
  const fsImpl = {
    promises: {
      realpath: async (target) => target,
      mkdir: async () => {},
      stat: async (file) => files.has(file)
        ? { isFile: () => true, size: files.get(file).length, mtimeMs: 0 }
        : { isFile: () => false, size: 0, mtimeMs: 0, mode: 0o40700 },
      open: async (file) => {
        files.set(file, Buffer.from('lock'));
        return {
        writeFile: async () => {},
        sync: async () => {},
        close: async () => {
          if (failLockClose) throw new Error('SYNTHETIC_CLOSE_FAILURE');
        }
        };
      },
      writeFile: async (file, data) => { files.set(file, Buffer.from(data)); },
      link: async (source, destination) => {
        if (destination === failLinkTarget || files.has(destination)) {
          throw Object.assign(new Error('SYNTHETIC_LINK_FAILURE'), { code: 'EEXIST' });
        }
        files.set(destination, Buffer.from(files.get(source)));
      },
      unlink: async (file) => { files.delete(file); },
      rm: async (file) => {
        removed.push(file);
        if (file === failRmPath) throw new Error('SYNTHETIC_REMOVE_FAILURE');
        files.delete(file);
      },
      readdir: async () => [],
      chmod: async () => {},
      readFile: async (file) => files.get(file).toString('utf8')
    },
    createReadStream: (file) => Readable.from([files.get(file)])
  };
  const service = createBackupService({
    fsImpl,
    env: { MONGO_URI: 'mongodb://synthetic.invalid/lifelink', BACKUP_ENVIRONMENT: 'staging' },
    logger: { info() {}, error() {} },
    now: () => new Date('2026-11-06T00:00:00.000Z'),
    pid: 123,
    platform: 'linux',
    projectRoot: 'project',
    defaultDirectory: 'backup-dir',
    timeoutMs: 5,
    spawnImpl: (executable, args) => {
      const child = new EventEmitter();
      child.kill = () => {};
      resolveSpawned({ child, archivePath: args[args.indexOf('--archive') + 1] });
      const finish = (code) => {
        if (code === 0) files.set(args[args.indexOf('--archive') + 1], Buffer.from('synthetic archive'));
        child.emit('close', code);
      };
      if (childMode === 'success') queueMicrotask(() => finish(0));
      if (childMode === 'spawn-error') queueMicrotask(() => {
        child.emit('error', new Error('SYNTHETIC_SPAWN_ERROR'));
        child.emit('close', -1);
      });
      if (childMode === 'nonzero') queueMicrotask(() => finish(7));
      return child;
    }
  });
  return { service, files, removed, spawned };
}

function expectedArchivePaths() {
  const directory = path.resolve('backup-dir');
  const archive = path.join(directory, 'lifelink-staging-2026-11-06T00-00-00.000Z.archive.gz');
  return { archive, checksum: `${archive}.sha256`, lock: path.join(directory, '.backup.lock') };
}

test('backup temporary cleanup attempts every removal and emits only fixed safe metadata', async () => {
  const attempted = [];
  const records = [];
  const fsImpl = fakeFs({
    rm: async (file) => {
      attempted.push(file);
      if (file === 'config') throw Object.assign(new Error('FAKE_SECRET_IN_MESSAGE'), { code: 'FAKE_CODE' });
    }
  });
  const service = createBackupService({ fsImpl, logger: { error: (record) => records.push(record) } });
  await service.cleanupTemporaryFiles({
    configPath: 'config', temporaryPath: 'archive.part', checksumTemporaryPath: 'sum.part',
    finalPath: 'final', checksumPath: 'final.sha256', lockPath: 'lock',
    lock: { close: async () => attempted.push('close') },
    archiveOwned: true, checksumOwned: true, removeOwnedPublications: true
  });

  assert.deepEqual(attempted, ['config', 'archive.part', 'sum.part', 'final', 'final.sha256', 'close', 'lock']);
  assert.equal(records.length, 1);
  assert.deepEqual(JSON.parse(records[0]), {
    event: 'backup_operation_failure', operation: 'cleanup', resource: 'config'
  });
  assert.doesNotMatch(records.join(' '), /FAKE_SECRET|FAKE_CODE/);
});

test('a mongodump timeout waits for close before rejecting so cleanup cannot race the child', async () => {
  const child = new EventEmitter();
  child.killCalls = 0;
  child.kill = () => { child.killCalls += 1; };
  const service = createBackupService({
    spawnImpl: () => child,
    env: {},
    timeoutMs: 5
  });
  let settled = false;
  const result = service.runMongoDump('config', 'archive').finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(child.killCalls, 1);
  assert.equal(settled, false);
  child.emit('close', null);
  await assert.rejects(result, /timed out/);
  assert.equal(settled, true);
});

test('archive publish collision preserves the existing archive and checksum', async () => {
  const { archive, checksum } = expectedArchivePaths();
  const harness = createRunHarness({ existing: [[archive, 'previous archive'], [checksum, 'previous checksum']] });
  await assert.rejects(harness.service.run());
  assert.equal(harness.files.get(archive).toString(), 'previous archive');
  assert.equal(harness.files.get(checksum).toString(), 'previous checksum');
});

test('checksum publish collision removes only this run archive and preserves prior files', async () => {
  const { archive, checksum } = expectedArchivePaths();
  const olderArchive = path.join(path.dirname(archive), 'lifelink-staging-2026-11-05T00-00-00.000Z.archive.gz');
  const harness = createRunHarness({
    existing: [[checksum, 'previous checksum'], [olderArchive, 'older archive']],
    failLinkTarget: checksum
  });
  await assert.rejects(harness.service.run());
  assert.equal(harness.files.has(archive), false);
  assert.equal(harness.files.get(checksum).toString(), 'previous checksum');
  assert.equal(harness.files.get(olderArchive).toString(), 'older archive');
});

test('successful child close publishes the archive and checksum', async () => {
  const { archive, checksum, lock } = expectedArchivePaths();
  const harness = createRunHarness();
  await harness.service.run();
  assert.equal(harness.files.get(archive).toString(), 'synthetic archive');
  assert.equal(await harness.service.verifyChecksum(archive), true);
  assert.equal(harness.files.has(checksum), true);
  assert.equal(harness.files.has(lock), false);
});

test('child spawn error waits for close and fails without publishing an archive', async () => {
  const { archive, lock } = expectedArchivePaths();
  const harness = createRunHarness({ childMode: 'spawn-error' });
  await assert.rejects(harness.service.run(), /could not be started/);
  assert.equal(harness.files.has(archive), false);
  assert.equal(harness.files.has(lock), false);
});

test('nonzero child close fails without publishing an archive', async () => {
  const { archive, lock } = expectedArchivePaths();
  const harness = createRunHarness({ childMode: 'nonzero' });
  await assert.rejects(harness.service.run(), /mongodump failed/);
  assert.equal(harness.files.has(archive), false);
  assert.equal(harness.files.has(lock), false);
});

test('timeout cleanup starts only after the child close event', async () => {
  const { lock } = expectedArchivePaths();
  const harness = createRunHarness({ childMode: 'wait' });
  const run = harness.service.run();
  const { child } = await harness.spawned;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(harness.files.has(lock), true);
  assert.equal(harness.removed.includes(lock), false);
  assert.equal(harness.removed.some((file) => file.includes('.mongodump-')), false);
  child.emit('close', null);
  await assert.rejects(run, /timed out/);
  assert.equal(harness.files.has(lock), false);
  assert.equal(harness.removed.some((file) => file.includes('.mongodump-')), true);
});

test('lock close failure preserves the lock while unrelated cleanup continues', async () => {
  const records = [];
  const calls = [];
  const fsImpl = fakeFs({
    rm: async (file) => {
      calls.push(file);
      if (file === 'config') throw new Error('SYNTHETIC_REMOVE_FAILURE');
    }
  });
  const service = createBackupService({ fsImpl, logger: { error: (record) => records.push(record) } });
  await service.cleanupTemporaryFiles({
    configPath: 'config', temporaryPath: 'partial.archive', checksumTemporaryPath: 'partial.sha256',
    lockPath: 'lock', lock: { close: async () => { throw new Error('SYNTHETIC_CLOSE_FAILURE'); } }
  });
  assert.deepEqual(calls, ['config', 'partial.archive', 'partial.sha256']);
  assert.equal(calls.includes('lock'), false);
  assert.deepEqual(records.map((record) => JSON.parse(record).resource), ['config', 'lock_close']);
  assert.doesNotMatch(records.join(' '), /SYNTHETIC/);
});

test('environment-scoped retention never removes another environment archive', async () => {
  const removed = [];
  const files = [
    'lifelink-staging-2020-01-01T00-00-00.000Z.archive.gz',
    'lifelink-production-2020-01-01T00-00-00.000Z.archive.gz',
    'lifelink-staging-2020-01-01T00-00-00.000Z.archive.gz.sha256',
    'unrelated.archive.gz'
  ];
  const fsImpl = fakeFs({
    readdir: async () => files.map((name) => ({ name, isFile: () => true })),
    stat: async () => ({ mtimeMs: 0 }),
    unlink: async (file) => removed.push(file),
    rm: async (file) => removed.push(file)
  });
  const service = createBackupService({
    fsImpl,
    env: { BACKUP_ENVIRONMENT: 'staging', BACKUP_RETENTION_DAYS: '1' },
    now: () => new Date('2026-11-06T00:00:00.000Z')
  });
  await service.removeExpiredBackups('backup-dir');

  assert.deepEqual(removed, [
    path.join('backup-dir', 'lifelink-staging-2020-01-01T00-00-00.000Z.archive.gz'),
    path.join('backup-dir', 'lifelink-staging-2020-01-01T00-00-00.000Z.archive.gz.sha256')
  ]);
  assert.equal(archivePattern('production').test(files[0]), false);
});

test('backup environment names are constrained and archive patterns isolate environments', () => {
  assert.equal(safeEnvironmentName({ NODE_ENV: 'Staging' }), 'staging');
  assert.throws(() => safeEnvironmentName({ BACKUP_ENVIRONMENT: '../secret' }), /environment label/);
  assert.equal(archivePattern('staging').test('lifelink-production-2026-01-01T00-00-00.000Z.archive.gz'), false);
});

test('POSIX backup directory permissions are checked and archive files are restricted', async () => {
  const calls = [];
  const restrictive = createBackupService({
    fsImpl: fakeFs({ stat: async () => ({ mode: 0o40700 }), chmod: async (...args) => calls.push(args) }),
    platform: 'linux'
  });
  await restrictive.validateDirectoryPermissions('backup-dir');
  await restrictive.secureFilePermissions('archive.part');
  assert.deepEqual(calls, [['archive.part', 0o600]]);

  const permissive = createBackupService({
    fsImpl: fakeFs({ stat: async () => ({ mode: 0o40755 }) }),
    platform: 'linux'
  });
  await assert.rejects(permissive.validateDirectoryPermissions('backup-dir'), /permissions/);

  const windows = createBackupService({ fsImpl: fakeFs(), platform: 'win32' });
  await windows.validateDirectoryPermissions('backup-dir');
  await windows.secureFilePermissions('archive.part');
});

test('archive SHA-256 checksum is generated and verified against the named archive', async () => {
  const data = Buffer.from('synthetic archive bytes');
  const checksum = crypto.createHash('sha256').update(data).digest('hex');
  let sidecar = `${checksum}  test.archive.gz\n`;
  const fsImpl = {
    ...fakeFs(),
    promises: {
      readFile: async () => sidecar
    },
    createReadStream: () => Readable.from([data])
  };
  const service = createBackupService({ fsImpl });
  assert.equal(await service.createChecksum('test.archive.gz'), checksum);
  assert.equal(await service.verifyChecksum('test.archive.gz'), true);
  sidecar = `${checksum}  other.archive.gz\n`;
  assert.equal(await service.verifyChecksum('test.archive.gz'), false);
  sidecar = `${'0'.repeat(64)}  test.archive.gz\n`;
  assert.equal(await service.verifyChecksum('test.archive.gz'), false);
});
