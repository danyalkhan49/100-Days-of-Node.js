const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BACKUP_DIRECTORY = path.join(os.homedir(), '.lifelink', 'backups');
const MAX_RUNTIME_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function logSafeFailure(logger, operation, resource) {
  logger.error(JSON.stringify({
    event: 'backup_operation_failure',
    operation,
    ...(resource ? { resource } : {})
  }));
}

function safeEnvironmentName(env) {
  const value = env.BACKUP_ENVIRONMENT || env.NODE_ENV || 'local';
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value)) {
    throw new Error('BACKUP_ENVIRONMENT must be a short alphanumeric environment label.');
  }
  return value.toLowerCase();
}

function archivePattern(environment) {
  const escaped = environment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^lifelink-${escaped}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.\\d{3}Z\\.archive\\.gz$`);
}

function createBackupService({
  fsImpl = fs,
  spawnImpl = spawn,
  env = process.env,
  logger = console,
  now = () => new Date(),
  pid = process.pid,
  platform = process.platform,
  projectRoot = PROJECT_ROOT,
  defaultDirectory = DEFAULT_BACKUP_DIRECTORY,
  timeoutMs = MAX_RUNTIME_MS
} = {}) {
  async function canonicalPath(target) {
    let current = path.resolve(target);
    const missingSegments = [];
    while (true) {
      try {
        return path.resolve(await fsImpl.promises.realpath(current), ...missingSegments.reverse());
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        missingSegments.unshift(path.basename(current));
        current = parent;
      }
    }
  }

  async function backupDirectory() {
    const directory = path.resolve(env.DATABASE_BACKUP_DIR || defaultDirectory);
    const [backupPath, protectedDirectories] = await Promise.all([
      canonicalPath(directory),
      Promise.all([
        path.join(projectRoot, 'public'),
        path.join(projectRoot, 'uploads')
      ].map(canonicalPath))
    ]);
    if (protectedDirectories.some((protectedPath) => {
      const relative = path.relative(protectedPath, backupPath);
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    })) {
      throw new Error('DATABASE_BACKUP_DIR must not be public, uploads, or inside either directory.');
    }
    return directory;
  }

  async function validateDirectoryPermissions(directory) {
    if (platform === 'win32') return;
    const stats = await fsImpl.promises.stat(directory);
    if ((stats.mode & 0o077) !== 0) {
      throw new Error('Backup directory permissions must be restricted to its owner.');
    }
  }

  async function secureFilePermissions(filePath) {
    if (platform !== 'win32') await fsImpl.promises.chmod(filePath, 0o600);
  }

  function runMongoDump(configPath, archivePath) {
    const executable = env.MONGODUMP_PATH || 'mongodump';
    return new Promise((resolve, reject) => {
      let child;
      let timer;
      let timedOut = false;
      let spawnError;
      let settled = false;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      try {
        child = spawnImpl(executable, ['--config', configPath, '--archive', archivePath, '--gzip'], {
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch {
        finish(new Error('mongodump could not be started.'));
        return;
      }

      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // Wait for close before allowing archive cleanup or lock release.
        }
      }, timeoutMs);

      child.once('error', () => {
        spawnError = new Error('mongodump could not be started.');
      });
      child.once('close', (code) => {
        if (timedOut) finish(new Error('mongodump timed out.'));
        else if (spawnError) finish(spawnError);
        else if (code === 0) finish();
        else finish(new Error('mongodump failed.'));
      });
    });
  }

  async function createChecksum(archivePath) {
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const stream = fsImpl.createReadStream(archivePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.once('error', reject);
      stream.once('end', resolve);
    });
    return hash.digest('hex');
  }

  async function verifyChecksum(archivePath) {
    const checksumPath = `${archivePath}.sha256`;
    const contents = await fsImpl.promises.readFile(checksumPath, 'utf8');
    const expected = /^([a-f0-9]{64})  ([^\r\n]+)\r?\n?$/i.exec(contents);
    if (!expected || expected[2] !== path.basename(archivePath)) return false;
    return (await createChecksum(archivePath)) === expected[1].toLowerCase();
  }

  async function removeExpiredBackups(directory, environment = safeEnvironmentName(env)) {
    const configuredRetention = Number(env.BACKUP_RETENTION_DAYS || 14);
    if (!Number.isInteger(configuredRetention) || configuredRetention < 1 || configuredRetention > 3650) {
      throw new Error('BACKUP_RETENTION_DAYS must be an integer from 1 to 3650.');
    }
    const cutoff = now().getTime() - configuredRetention * DAY_MS;
    const pattern = archivePattern(environment);
    const entries = await fsImpl.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      const filePath = path.join(directory, entry.name);
      const stats = await fsImpl.promises.stat(filePath);
      if (stats.mtimeMs < cutoff) {
        await fsImpl.promises.unlink(filePath);
        await fsImpl.promises.rm(`${filePath}.sha256`, { force: true });
      }
    }
  }

  async function publishFileNoReplace(sourcePath, destinationPath, onPublished = () => {}) {
    await fsImpl.promises.link(sourcePath, destinationPath);
    onPublished();
    await fsImpl.promises.unlink(sourcePath);
  }

  async function cleanupTemporaryFiles({
    configPath,
    temporaryPath,
    checksumTemporaryPath,
    finalPath,
    checksumPath,
    lockPath,
    lock,
    archiveOwned = false,
    checksumOwned = false,
    removeOwnedPublications = false
  }) {
    const cleanup = [
      ['config', () => fsImpl.promises.rm(configPath, { force: true })],
      ['partial_archive', () => fsImpl.promises.rm(temporaryPath, { force: true })],
      ['partial_checksum', () => fsImpl.promises.rm(checksumTemporaryPath, { force: true })]
    ];
    if (removeOwnedPublications) {
      if (archiveOwned) cleanup.push(['incomplete_archive', () => fsImpl.promises.rm(finalPath, { force: true })]);
      if (checksumOwned) cleanup.push(['incomplete_checksum', () => fsImpl.promises.rm(checksumPath, { force: true })]);
    }
    for (const [resource, action] of cleanup) {
      try {
        await action();
      } catch {
        logSafeFailure(logger, 'cleanup', resource);
      }
    }

    let lockClosed = !lock;
    if (lock) {
      try {
        await lock.close();
        lockClosed = true;
      } catch {
        logSafeFailure(logger, 'cleanup', 'lock_close');
      }
    }
    if (lockClosed) {
      try {
        await fsImpl.promises.rm(lockPath, { force: true });
      } catch {
        logSafeFailure(logger, 'cleanup', 'lock_file');
      }
    }
  }

  async function run() {
    const uri = env.MONGO_URI;
    if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
      throw new Error('MONGO_URI must contain a MongoDB connection URI.');
    }

    const environment = safeEnvironmentName(env);
    const directory = await backupDirectory();
    await fsImpl.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    await validateDirectoryPermissions(directory);
    const lockPath = path.join(directory, '.backup.lock');
    let lock;
    try {
      lock = await fsImpl.promises.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Another backup appears to be running; inspect .backup.lock before retrying.');
      throw new Error('Backup lock could not be created.');
    }

    const timestamp = now().toISOString().replace(/:/g, '-');
    const finalPath = path.join(directory, `lifelink-${environment}-${timestamp}.archive.gz`);
    const temporaryPath = `${finalPath}.part`;
    const checksumPath = `${finalPath}.sha256`;
    const checksumTemporaryPath = `${checksumPath}.part`;
    const configPath = path.join(directory, `.mongodump-${pid}-${now().getTime()}.yaml`);
    let archiveOwned = false;
    let checksumOwned = false;
    let published = false;
    try {
      await lock.writeFile(JSON.stringify({ pid, startedAt: now().toISOString() }));
      await lock.sync();
      await fsImpl.promises.writeFile(configPath, `uri: ${JSON.stringify(uri)}\n`, { flag: 'wx', mode: 0o600 });
      await runMongoDump(configPath, temporaryPath);
      const archiveStats = await fsImpl.promises.stat(temporaryPath);
      if (!archiveStats.isFile() || archiveStats.size === 0) throw new Error('mongodump produced an empty archive.');
      await secureFilePermissions(temporaryPath);
      const digest = await createChecksum(temporaryPath);
      await fsImpl.promises.writeFile(checksumTemporaryPath, `${digest}  ${path.basename(finalPath)}\n`, { flag: 'wx', mode: 0o600 });
      await secureFilePermissions(checksumTemporaryPath);
      await publishFileNoReplace(temporaryPath, finalPath, () => { archiveOwned = true; });
      await publishFileNoReplace(checksumTemporaryPath, checksumPath, () => { checksumOwned = true; });
      published = true;
      await removeExpiredBackups(directory, environment);
      logger.info(`Database backup completed: ${path.basename(finalPath)} (${archiveStats.size} bytes).`);
    } catch (error) {
      throw error;
    } finally {
      await cleanupTemporaryFiles({
        configPath,
        temporaryPath,
        checksumTemporaryPath,
        finalPath,
        checksumPath,
        lockPath,
        lock,
        archiveOwned,
        checksumOwned,
        removeOwnedPublications: !published
      });
    }
  }

  return { run, runMongoDump, removeExpiredBackups, cleanupTemporaryFiles, createChecksum, verifyChecksum, backupDirectory, validateDirectoryPermissions, secureFilePermissions, publishFileNoReplace };
}

async function main() {
  require('dotenv').config();
  await createBackupService().run();
}

if (require.main === module) {
  main().catch(() => {
    logSafeFailure(console, 'backup', 'database');
    process.exitCode = 1;
  });
}

module.exports = {
  createBackupService,
  safeEnvironmentName,
  archivePattern
};
