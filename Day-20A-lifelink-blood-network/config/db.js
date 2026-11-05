const mongoose = require('mongoose');
const dns = require('node:dns');
const ConnectionString = require('mongodb-connection-string-url').default;
const { transactionsSupported } = require('../utils/requiredTransaction');

const MAX_CONNECTION_ATTEMPTS = 3;
const SERVER_SELECTION_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;
const INITIAL_RETRY_DELAY_MS = 250;

function validateMongoUri(uri) {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error('MONGO_URI is not configured.');
  }

  try {
    const parsed = new ConnectionString(uri.trim());
    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) ||
        !Array.isArray(parsed.hosts) ||
        parsed.hosts.length === 0 ||
        parsed.hosts.some((host) => !host) ||
        (parsed.protocol === 'mongodb+srv:' && parsed.hosts.length !== 1)) {
      throw new Error('Invalid MongoDB URI structure.');
    }
  } catch {
    throw new Error('MONGO_URI must be a valid MongoDB connection URI.');
  }

  return uri.trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function configureMongoDnsServers(value, dnsModule = dns) {
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('MONGO_DNS_SERVERS must be a comma-separated list of DNS server IP addresses.');
  }

  const servers = value.split(',').map((server) => server.trim());
  if (servers.some((server) => !server)) {
    throw new Error('MONGO_DNS_SERVERS must be a comma-separated list of DNS server IP addresses.');
  }

  try {
    dnsModule.setServers(servers);
  } catch {
    throw new Error('MONGO_DNS_SERVERS must be a comma-separated list of DNS server IP addresses.');
  }
}

function createMongoConnector({
  mongooseClient = mongoose,
  sleep = delay,
  dnsModule = dns
} = {}) {
  return async function connectDB(uri = process.env.MONGO_URI) {
    const validatedUri = validateMongoUri(uri);
    configureMongoDnsServers(process.env.MONGO_DNS_SERVERS, dnsModule);

    for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt += 1) {
      try {
        await mongooseClient.connect(validatedUri, {
          serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
          connectTimeoutMS: CONNECT_TIMEOUT_MS
        });

        const connection = mongooseClient.connection;
        if (connection.readyState !== 1) {
          throw new Error('MongoDB connection did not reach the connected state.');
        }
        if (!transactionsSupported(connection)) {
          const error = new Error(
            'MongoDB must use a replica set or sharded deployment to support transactions.'
          );
          error.code = 'MONGO_UNSUPPORTED_TOPOLOGY';
          throw error;
        }

        return connection;
      } catch (error) {
        if (error && error.code === 'MONGO_UNSUPPORTED_TOPOLOGY') throw error;
        if (attempt === MAX_CONNECTION_ATTEMPTS) {
          throw new Error(
            `MongoDB connection failed after ${MAX_CONNECTION_ATTEMPTS} attempts. ` +
            'Check MongoDB availability and network configuration.',
            { cause: error }
          );
        }

        await sleep(INITIAL_RETRY_DELAY_MS * (2 ** (attempt - 1)));
      }
    }
  };
}

const connectDB = createMongoConnector();

module.exports = connectDB;
module.exports.createMongoConnector = createMongoConnector;
module.exports.validateMongoUri = validateMongoUri;
module.exports.configureMongoDnsServers = configureMongoDnsServers;
module.exports.MAX_CONNECTION_ATTEMPTS = MAX_CONNECTION_ATTEMPTS;
module.exports.SERVER_SELECTION_TIMEOUT_MS = SERVER_SELECTION_TIMEOUT_MS;
module.exports.CONNECT_TIMEOUT_MS = CONNECT_TIMEOUT_MS;
