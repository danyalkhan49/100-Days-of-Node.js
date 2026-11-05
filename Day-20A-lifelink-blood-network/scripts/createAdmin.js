require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const connectDB = require('../config/db');
const User = require('../models/User');
const { getEmailFailureDetails, sendVerificationEmail } = require('../utils/accountEmail');

async function main() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_PHONE, ADMIN_CITY } = process.env;
  if (![ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_PHONE, ADMIN_CITY].every(Boolean)) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_PHONE, and ADMIN_CITY before running this script.');
  }
  if (ADMIN_PASSWORD.length < 8 || ADMIN_PASSWORD.length > 72 ||
      Buffer.byteLength(ADMIN_PASSWORD, 'utf8') > 72) {
    throw new Error('ADMIN_PASSWORD must be 8-72 characters and no more than 72 UTF-8 bytes.');
  }

  await connectDB();
  const email = ADMIN_EMAIL.trim().toLowerCase();
  if (await User.exists({ email })) {
    throw new Error('An account with ADMIN_EMAIL already exists.');
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  await User.create({
    name: ADMIN_NAME.trim(),
    email,
    password: await bcrypt.hash(ADMIN_PASSWORD, 10),
    phone: ADMIN_PHONE.trim(),
    city: ADMIN_CITY.trim(),
    role: 'admin',
    isActive: true,
    emailVerified: false,
    emailVerificationToken: hashedToken,
    emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  try {
    await sendVerificationEmail(email, rawToken);
    console.info('Administrator verification email accepted by SMTP server.');
  } catch (error) {
    console.error('Administrator verification email delivery failed.', getEmailFailureDetails(error));
    throw new Error('The administrator account was created but must be verified before sign-in. Configure email delivery and use resend verification.');
  }
  console.log(`Administrator account created for ${email}. Verify its email before signing in.`);
}

main()
  .catch((error) => {
    console.error('Admin account creation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const mongoose = require('mongoose');
    await mongoose.disconnect();
  });