require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BACKUP_DIRECTORY = path.join(os.homedir(), '.lifelink', 'backups');
const BACKUP_NAME_PATTERN = /^lifelink-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.archive\.gz$/;
const MAX_RUNTIME_MS = 15 * 60 * 1000;

function logFailure(message, error) {
  const code = error && error.code ? ` (${error.code})` : '';
  const detail = error && error.message ? `: ${error.message}` : '';
  console.error(`${message}${detail}${code}`);
}

async function canonicalPath(target) {
  let current = path.resolve(target);
  const missingSegments = [];
  while (true) {
    try {
      return path.resolve(await fs.promises.realpath(current), ...missingSegments.reverse());
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
  const configured = process.env.DATABASE_BACKUP_DIR;
  const directory = path.resolve(configured || DEFAULT_BACKUP_DIRECTORY);
  const [backupPath, protectedDirectories] = await Promise.all([
    canonicalPath(directory),
    Promise.all([
      path.join(PROJECT_ROOT, 'public'),
      path.join(PROJECT_ROOT, 'uploads')
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

function runMongoDump(configPath, archivePath) {
  const executable = process.env.MONGODUMP_PATH || 'mongodump';
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--config', configPath, '--archive', archivePath, '--gzip'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('mongodump timed out.'));
    }, MAX_RUNTIME_MS);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`mongodump exited with status ${code}.`));
    });
  });
}

async function removeExpiredBackups(directory) {
  const configuredRetention = Number(process.env.BACKUP_RETENTION_DAYS || 14);
  if (!Number.isInteger(configuredRetention) || configuredRetention < 1 || configuredRetention > 3650) {
    throw new Error('BACKUP_RETENTION_DAYS must be an integer from 1 to 3650.');
  }
  const cutoff = Date.now() - configuredRetention * 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !BACKUP_NAME_PATTERN.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const stats = await fs.promises.stat(filePath);
    if (stats.mtimeMs < cutoff) await fs.promises.unlink(filePath);
  }
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('MONGO_URI must contain a MongoDB connection URI.');
  }

  const directory = await backupDirectory();
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, '.backup.lock');
  let lock;
  try {
    lock = await fs.promises.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another backup appears to be running; inspect .backup.lock before retrying.');
    throw error;
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const finalPath = path.join(directory, `lifelink-${timestamp}.archive.gz`);
  const temporaryPath = `${finalPath}.part`;
  const configPath = path.join(directory, `.mongodump-${process.pid}-${Date.now()}.yaml`);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await lock.sync();
    await fs.promises.writeFile(configPath, `uri: ${JSON.stringify(uri)}\n`, { flag: 'wx', mode: 0o600 });
    await runMongoDump(configPath, temporaryPath);
    const archiveStats = await fs.promises.stat(temporaryPath);
    if (!archiveStats.isFile() || archiveStats.size === 0) throw new Error('mongodump produced an empty archive.');
    await fs.promises.rename(temporaryPath, finalPath);
    await removeExpiredBackups(directory);
    console.info(`Database backup completed: ${path.basename(finalPath)} (${archiveStats.size} bytes).`);
  } finally {
    await fs.promises.rm(configPath, { force: true });
    await fs.promises.rm(temporaryPath, { force: true });
    await lock.close();
    await fs.promises.rm(lockPath, { force: true });
  }
}

main().catch((error) => {
  logFailure('Database backup failed.', error);
  process.exitCode = 1;
});
