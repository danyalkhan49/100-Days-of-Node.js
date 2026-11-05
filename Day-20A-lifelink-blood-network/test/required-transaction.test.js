const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transactionsSupported, withRequiredTransaction } = require('../utils/requiredTransaction');

test('concurrency-sensitive operations reject unsupported transaction topologies', async () => {
  if (transactionsSupported()) {
    return;
  }

  await assert.rejects(
    withRequiredTransaction(async () => {
      assert.fail('The transaction callback must not run without transaction support.');
    }),
    (error) => error.statusCode === 503 &&
      /requires MongoDB transactions/i.test(error.message) &&
      /replica set|sharded deployment/i.test(error.message)
  );
});
