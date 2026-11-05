const fs = require('fs');
const path = require('path');
const {
  checksum,
  validateKey,
  validateLegacyFilename
} = require('./storageService');

function isMissing(error) {
  return error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative));
}

function assertWithinRoot(root, target) {
  if (!isWithinRoot(root, target)) {
    throw new Error('Resolved storage path escapes its configured root.');
  }
}

function isRegularFile(stats) {
  return stats.isFile() && !stats.isSymbolicLink();
}

function assertRegularFile(stats) {
  if (stats.isSymbolicLink()) {
    throw new Error('Symbolic links are not allowed in local storage.');
  }
  if (!stats.isFile()) {
    throw new Error('Local storage target must be a regular file.');
  }
}

function sameFileIdentity(left, right) {
  return left.ino === 0 || right.ino === 0 ||
    (left.dev === right.dev && left.ino === right.ino);
}

function createLocalFileProvider({ rootDirectory, legacyRoots = {} }) {
  if (typeof rootDirectory !== 'string' || !rootDirectory.trim()) {
    throw new TypeError('rootDirectory is required.');
  }
  if (!legacyRoots || typeof legacyRoots !== 'object' || Array.isArray(legacyRoots)) {
    throw new TypeError('legacyRoots must map storage purposes to local directories.');
  }

  const configuredRoot = path.resolve(rootDirectory);
  const configuredLegacyRoots = Object.fromEntries(
    Object.entries(legacyRoots).map(([purpose, directory]) => {
      if (typeof directory !== 'string' || !directory.trim()) {
        throw new TypeError(`A local legacy directory is required for ${purpose}.`);
      }
      return [purpose, path.resolve(directory)];
    })
  );

  // Keep these roots writable only by the service account. Path-based Node APIs
  // cannot eliminate parent-directory replacement races on Windows.
  function getLexicalTarget(rootDirectory, key) {
    const target = path.resolve(rootDirectory, ...key.split('/'));
    assertWithinRoot(rootDirectory, target);
    return target;
  }

  async function getCanonicalRoot(directory, create) {
    if (create) await fs.promises.mkdir(directory, { recursive: true });
    let rootStats;
    try {
      rootStats = await fs.promises.lstat(directory);
    } catch (error) {
      if (!create && isMissing(error)) return null;
      throw error;
    }
    if (rootStats.isSymbolicLink()) {
      throw new Error('Symbolic links are not allowed for local storage roots.');
    }
    if (!rootStats.isDirectory()) {
      throw new Error('Local storage root must be a directory.');
    }
    return fs.promises.realpath(directory);
  }

  async function ensureDirectories(root, targetDirectory) {
    assertWithinRoot(root, targetDirectory);
    const relativeDirectory = path.relative(root, targetDirectory);
    let current = root;
    for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        await fs.promises.mkdir(current);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const stats = await fs.promises.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error('Symbolic links are not allowed in local storage.');
      }
      if (!stats.isDirectory()) {
        throw new Error('Local storage parent path must contain only directories.');
      }
      const realDirectory = await fs.promises.realpath(current);
      assertWithinRoot(root, realDirectory);
    }
  }

  async function inspectTarget(rootDirectory, key) {
    const canonicalRoot = await getCanonicalRoot(rootDirectory, false);
    if (!canonicalRoot) return null;

    const lexicalTarget = getLexicalTarget(rootDirectory, key);
    const relativeTarget = path.relative(rootDirectory, lexicalTarget);
    const target = path.resolve(canonicalRoot, relativeTarget);
    assertWithinRoot(canonicalRoot, target);
    const parent = path.dirname(target);
    assertWithinRoot(canonicalRoot, parent);

    let parentPath = canonicalRoot;
    const relativeParent = path.relative(canonicalRoot, parent);
    for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
      parentPath = path.join(parentPath, segment);
      let parentStats;
      try {
        parentStats = await fs.promises.lstat(parentPath);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      if (parentStats.isSymbolicLink()) {
        throw new Error('Symbolic links are not allowed in local storage.');
      }
      if (!parentStats.isDirectory()) {
        throw new Error('Local storage parent path must contain only directories.');
      }
      assertWithinRoot(canonicalRoot, await fs.promises.realpath(parentPath));
    }

    let stats;
    try {
      stats = await fs.promises.lstat(target);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    assertRegularFile(stats);
    const realTarget = await fs.promises.realpath(target);
    assertWithinRoot(canonicalRoot, realTarget);
    return { target: realTarget, stats, root: canonicalRoot };
  }

  async function openRegularFile(rootDirectory, key) {
    const inspected = await inspectTarget(rootDirectory, key);
    if (!inspected) return null;

    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const handle = await fs.promises.open(
      inspected.target,
      fs.constants.O_RDONLY | noFollow
    );
    try {
      const openedStats = await handle.stat();
      assertRegularFile(openedStats);
      if (!sameFileIdentity(inspected.stats, openedStats)) {
        throw new Error('Local storage file changed while it was being opened.');
      }
      const afterOpen = await inspectTarget(rootDirectory, key);
      if (!afterOpen || !sameFileIdentity(afterOpen.stats, openedStats)) {
        throw new Error('Local storage file changed while it was being opened.');
      }
      return { handle, stats: openedStats };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async function readLocalFile(rootDirectory, key, missingMessage) {
    const opened = await openRegularFile(rootDirectory, key);
    if (!opened) {
      const error = new Error(missingMessage);
      error.code = 'ENOENT';
      throw error;
    }
    try {
      const body = await opened.handle.readFile();
      return {
        body,
        checksumSha256: checksum(body),
        size: body.length
      };
    } finally {
      await opened.handle.close();
    }
  }

  async function upload({ key, body, contentType, checksumSha256 }) {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new TypeError('Storage requires a non-empty Buffer.');
    }
    validateKey(key);
    const root = await getCanonicalRoot(configuredRoot, true);
    validateKey(key);
    const lexicalTarget = getLexicalTarget(configuredRoot, key);
    const target = path.resolve(root, path.relative(configuredRoot, lexicalTarget));
    assertWithinRoot(root, target);
    await ensureDirectories(root, path.dirname(target));

    const actualChecksum = checksum(body);
    if (checksumSha256 && checksumSha256.toLowerCase() !== actualChecksum) {
      throw new Error('Upload checksum does not match the provided body.');
    }

    const handle = await fs.promises.open(
      target,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    try {
      assertRegularFile(await handle.stat());
      await handle.writeFile(body);
    } finally {
      await handle.close();
    }
    return { key, contentType, checksumSha256: actualChecksum, size: body.length };
  }

  async function resolveExisting(key) {
    validateKey(key);
    return inspectTarget(configuredRoot, key);
  }

  async function resolveLegacyExisting(purpose, filename) {
    validateLegacyFilename(purpose, filename);
    const legacyRoot = configuredLegacyRoots[purpose];
    if (!legacyRoot) {
      throw new Error(`No legacy local directory is configured for ${purpose}.`);
    }
    return inspectTarget(legacyRoot, filename);
  }

  async function download({ key }) {
    const file = await readLocalFile(configuredRoot, key, 'Stored object was not found.');
    return {
      body: file.body,
      contentType: undefined,
      checksumSha256: file.checksumSha256,
      size: file.size
    };
  }

  async function remove({ key }) {
    const resolved = await resolveExisting(key);
    if (!resolved) return;
    await fs.promises.unlink(resolved.target);
  }

  async function exists({ key }) {
    return Boolean(await resolveExisting(key));
  }

  async function downloadLegacy({ purpose, filename, contentType }) {
    const legacyRoot = configuredLegacyRoots[purpose];
    if (!legacyRoot) {
      throw new Error(`No legacy local directory is configured for ${purpose}.`);
    }
    const file = await readLocalFile(legacyRoot, filename, 'Legacy file was not found.');
    return {
      body: file.body,
      contentType,
      checksumSha256: file.checksumSha256,
      size: file.size
    };
  }

  async function deleteLegacy({ purpose, filename }) {
    const resolved = await resolveLegacyExisting(purpose, filename);
    if (!resolved) return;
    await fs.promises.unlink(resolved.target);
  }

  async function existsLegacy({ purpose, filename }) {
    return Boolean(await resolveLegacyExisting(purpose, filename));
  }

  return Object.freeze({
    upload,
    download,
    delete: remove,
    exists,
    downloadLegacy,
    deleteLegacy,
    existsLegacy
  });
}

module.exports = { createLocalFileProvider };
