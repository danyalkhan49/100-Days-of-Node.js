const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const readline = require('readline');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_ERRORS = {
  INVALID_EMAIL: 'Enter a valid email address.',
  ACCOUNT_NOT_FOUND: 'No existing account matches that email; no account was changed.',
  NOT_ADMIN: 'The matching account is not an admin; no account was changed.',
  ACCOUNT_INACTIVE: 'The admin account is inactive; no account was changed.',
  ACCOUNT_CHANGED: 'The account changed during verification; no success was assumed. Check its status and retry if needed.',
  CONFIRMATION_FAILED: 'Database confirmation failed; the admin account is not confirmed as verified.'
};

function safeError(code) {
  const error = new Error(SAFE_ERRORS[code]);
  error.code = code;
  return error;
}

function promptForEmail() {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    terminal.question('Existing admin account email: ', (email) => {
      terminal.close();
      resolve(email.trim().toLowerCase());
    });
  });
}

async function main() {
  const email = await promptForEmail();
  if (!EMAIL_PATTERN.test(email)) {
    throw safeError('INVALID_EMAIL');
  }

  await connectDB();
  const account = await User.findOne({ email }).select('_id role isActive emailVerified');
  if (!account) {
    throw safeError('ACCOUNT_NOT_FOUND');
  }
  if (account.role !== 'admin') {
    throw safeError('NOT_ADMIN');
  }
  if (account.isActive === false) {
    throw safeError('ACCOUNT_INACTIVE');
  }

  if (!account.emailVerified) {
    const verifiedAt = new Date();
    const result = await User.updateOne(
      { _id: account._id, role: 'admin', isActive: { $ne: false }, emailVerified: false },
      {
        $set: {
          emailVerified: true,
          emailVerifiedAt: verifiedAt,
          emailVerificationMethod: 'admin'
        },
        $unset: {
          emailVerificationToken: 1,
          emailVerificationExpires: 1
        }
      }
    );
    if (result.matchedCount !== 1) {
      throw safeError('ACCOUNT_CHANGED');
    }
  }

  const confirmed = await User.findOne({ _id: account._id })
    .select('role isActive emailVerified emailVerifiedAt emailVerificationMethod');
  if (!confirmed || confirmed.role !== 'admin' || confirmed.isActive === false || !confirmed.emailVerified) {
    throw safeError('CONFIRMATION_FAILED');
  }

  console.log('Database confirmed: the existing active admin account is email verified.');
  if (confirmed.emailVerificationMethod === 'admin' && confirmed.emailVerifiedAt) {
    console.log('Verification method: admin; verification timestamp is recorded.');
  }
}

main()
  .catch((error) => {
    if (SAFE_ERRORS[error.code]) console.error(SAFE_ERRORS[error.code]);
    else console.error('Admin verification failed because of a database or configuration error. Check server configuration and logs.');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
