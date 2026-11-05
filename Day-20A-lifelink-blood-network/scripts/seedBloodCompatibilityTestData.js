const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');

const TEST_DATABASE_NAME = 'lifelink_blood_compatibility_test';
const TEST_DATABASE_URI = `mongodb://127.0.0.1:27017/${TEST_DATABASE_NAME}`;
const CREDENTIALS_PATH = path.resolve(__dirname, '..', '.env.blood-compatibility-test');
const TEMP_CREDENTIALS_PATH = `${CREDENTIALS_PATH}.tmp`;
const TEST_GROUPS = [
  { bloodGroup: 'O-', slug: 'o-minus', variable: 'O_NEG' },
  { bloodGroup: 'O+', slug: 'o-plus', variable: 'O_POS' },
  { bloodGroup: 'A-', slug: 'a-minus', variable: 'A_NEG' },
  { bloodGroup: 'A+', slug: 'a-plus', variable: 'A_POS' },
  { bloodGroup: 'B-', slug: 'b-minus', variable: 'B_NEG' },
  { bloodGroup: 'B+', slug: 'b-plus', variable: 'B_POS' },
  { bloodGroup: 'AB-', slug: 'ab-minus', variable: 'AB_NEG' },
  { bloodGroup: 'AB+', slug: 'ab-plus', variable: 'AB_POS' }
];

function credentialsContents(password, users, requests) {
  const lines = [
    '# TEST ONLY. Ignored by Git. Never commit or reuse these credentials.',
    `TEST_DATABASE_NAME=${TEST_DATABASE_NAME}`,
    `TEST_SHARED_PASSWORD=${password}`
  ];

  for (const group of TEST_GROUPS) {
    const donor = users.find((user) => user.role === 'donor' && user.bloodGroup === group.bloodGroup);
    const requester = users.find((user) => user.role === 'requester' && user.bloodGroup === group.bloodGroup);
    const request = requests.find((item) => item.bloodGroup === group.bloodGroup);
    lines.push(
      `TEST_DONOR_${group.variable}_EMAIL=${donor.email}`,
      `TEST_REQUESTER_${group.variable}_EMAIL=${requester.email}`,
      `TEST_REQUEST_${group.variable}_ID=${request._id}`
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  if (fs.existsSync(CREDENTIALS_PATH) || fs.existsSync(TEMP_CREDENTIALS_PATH)) {
    throw new Error('A test credential file already exists; refusing to overwrite it.');
  }

  await mongoose.connect(TEST_DATABASE_URI, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false
  });
  if (mongoose.connection.name !== TEST_DATABASE_NAME) {
    throw new Error('Connected database name did not match the fixed test database.');
  }

  const existingCollections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const allowedCollections = new Set([
    User.collection.collectionName,
    BloodRequest.collection.collectionName
  ]);
  for (const collection of existingCollections) {
    const count = await mongoose.connection.db.collection(collection.name).countDocuments();
    if (!allowedCollections.has(collection.name) || count !== 0) {
      throw new Error('The isolated test database contains unexpected data; no records were changed.');
    }
  }

  const now = new Date();
  const password = crypto.randomBytes(24).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 10);
  const users = [];
  const requesterByGroup = new Map();

  for (const group of TEST_GROUPS) {
    for (const role of ['requester', 'donor']) {
      const email = `test-${role}-${group.slug}@compatibility.invalid`;
      const user = new User({
        name: `TEST ${role === 'donor' ? 'Donor' : 'Requester'} ${group.bloodGroup}`,
        email,
        password: passwordHash,
        phone: `TEST-NO-SMS-${role}-${group.slug}`,
        city: 'TEST Compatibility',
        role,
        bloodGroup: group.bloodGroup,
        emailVerified: true,
        emailVerifiedAt: now,
        emailVerificationMethod: null,
        phoneVerified: false,
        isActive: true,
        isAvailable: true,
        notificationPreferences: {
          email: false,
          sms: false,
          whatsapp: false,
          reminders: false
        },
        termsAcceptedAt: now,
        termsVersion: '1.0',
        privacyVersion: '1.0'
      });
      await user.validate();
      users.push(user);
      if (role === 'requester') requesterByGroup.set(group.bloodGroup, user);
    }
  }

  const requests = TEST_GROUPS.map((group) => new BloodRequest({
    requester: requesterByGroup.get(group.bloodGroup)._id,
    patientName: `TEST Patient ${group.bloodGroup}`,
    bloodGroup: group.bloodGroup,
    unitsNeeded: 1,
    hospital: 'TEST Blood Bank - Do Not Contact',
    city: 'TEST Compatibility',
    urgency: 'Normal',
    neededBy: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    note: 'TEST DATA ONLY. Not for medical use.',
    unitsFulfilled: 0,
    status: 'Open'
  }));
  await Promise.all(requests.map((request) => request.validate()));

  fs.writeFileSync(
    TEMP_CREDENTIALS_PATH,
    credentialsContents(password, users, requests),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );

  try {
    await User.insertMany(users, { ordered: true });
    await BloodRequest.insertMany(requests, { ordered: true });
    fs.renameSync(TEMP_CREDENTIALS_PATH, CREDENTIALS_PATH);
  } catch (error) {
    if (fs.existsSync(TEMP_CREDENTIALS_PATH)) fs.unlinkSync(TEMP_CREDENTIALS_PATH);
    throw error;
  }

  console.log(`Created ${users.length} TEST accounts and ${requests.length} TEST open blood requests.`);
  console.log(`Isolated database: ${TEST_DATABASE_NAME}`);
  console.log('Email, SMS, and WhatsApp notification preferences are disabled; no notification services were called.');
  console.log('Login credentials were written to .env.blood-compatibility-test and were not printed.');
}

main()
  .catch((error) => {
    const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
      ? error.code
      : error.name || 'SeedError';
    console.error(
      `Blood compatibility test data setup failed (${code}). Only the fixed local test database is used; inspect it before retrying.`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
