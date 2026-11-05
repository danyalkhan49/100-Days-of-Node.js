const mongoose = require('mongoose');
const AppError = require('./AppError');

const TRANSACTION_OPTIONS = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary'
};

function transactionsSupported(connection = mongoose.connection) {
  const topology = connection.client &&
    connection.client.topology &&
    connection.client.topology.description;
  return Boolean(topology && ['ReplicaSetWithPrimary', 'Sharded'].includes(topology.type));
}

async function withRequiredTransaction(operation) {
  if (!transactionsSupported()) {
    throw new AppError(
      'This operation requires MongoDB transactions. Configure MongoDB as a replica set or use a sharded deployment.',
      503
    );
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    }, TRANSACTION_OPTIONS);
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { transactionsSupported, withRequiredTransaction };
