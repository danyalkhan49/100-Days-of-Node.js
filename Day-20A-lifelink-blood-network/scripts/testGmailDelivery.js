const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const readline = require('readline');
const {
  createAccountMailTransporter,
  getEmailFailureDetails
} = require('../utils/accountEmail');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ask(question) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const recipient = (await ask('Test recipient email address: ')).toLowerCase();
  if (!EMAIL_PATTERN.test(recipient)) {
    throw new Error('Enter a valid recipient email address.');
  }
  const confirmation = await ask('Send one plain-text SMTP test email to this address? Type yes to continue: ');
  if (confirmation.toLowerCase() !== 'yes') {
    console.log('Email test cancelled; no message was sent.');
    return;
  }

  const transporter = createAccountMailTransporter();
  await transporter.verify();
  const result = await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: recipient,
    subject: 'LifeLink email delivery test',
    text: 'This is a test of the LifeLink email delivery configuration. It does not contain a verification link.'
  });
  const accepted = Array.isArray(result.accepted) && result.accepted.some((address) =>
    String(address).trim().toLowerCase() === recipient
  );
  if (!accepted) {
    const error = new Error('The email provider did not accept the test message.');
    error.code = 'EMAIL_PROVIDER_REJECTED';
    throw error;
  }

  console.log('Gmail SMTP accepted the test message. Check the recipient inbox and spam folder.');
  console.log('This confirms provider acceptance only, not inbox delivery.');
}

main()
  .catch((error) => {
    const details = getEmailFailureDetails(error);
    if (error.code === 'EMAIL_SMTP_CONFIG') {
      console.error('Email test failed: configure SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS in the project .env.');
    } else if (error.code === 'EAUTH') {
      console.error('Email test failed: Gmail SMTP authentication failed. Check the Gmail address and App Password.');
    } else {
      const code = details.code ? ` (${details.code})` : '';
      console.error(`Email test failed: ${details.category}${code}. No credentials or message contents were logged.`);
    }
    process.exitCode = 1;
  })
