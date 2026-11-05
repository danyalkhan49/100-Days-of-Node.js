const nodemailer = require('nodemailer');
const AppError = require('./AppError');

function emailConfigError(message, code) {
  const error = new AppError(message, 503);
  error.code = code;
  return error;
}

function getSMTPConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const rawPort = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASS;
  const validHost = typeof host === 'string' && host.length <= 253 &&
    host.split('.').every((label) =>
      label.length > 0 && label.length <= 63 &&
      /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
    );
  const validUser = typeof user === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user);
  const port = rawPort && /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;

  if (!validHost || !validUser || typeof password !== 'string' || !password.trim() ||
      ![465, 587].includes(port)) {
    throw emailConfigError(
      'Email delivery is not configured. Set SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, and SMTP_PASS.',
      'EMAIL_SMTP_CONFIG'
    );
  }

  return {
    host,
    port,
    secure: port === 465,
    ...(port === 587 ? { requireTLS: true } : {}),
    user,
    password
  };
}

function getFrontendBaseUrl() {
  const configuredUrl = process.env.FRONTEND_URL;
  if (!configuredUrl) {
    throw emailConfigError('Email delivery is not configured. Set FRONTEND_URL and SMTP settings.', 'EMAIL_FRONTEND_URL_CONFIG');
  }

  let frontendUrl;
  try {
    frontendUrl = new URL(configuredUrl);
  } catch {
    throw emailConfigError('Email delivery is not configured. FRONTEND_URL must be a valid HTTP or HTTPS URL.', 'EMAIL_FRONTEND_URL_CONFIG');
  }
  if (!['http:', 'https:'].includes(frontendUrl.protocol) ||
      frontendUrl.username || frontendUrl.password || frontendUrl.search || frontendUrl.hash) {
    throw emailConfigError('Email delivery is not configured. FRONTEND_URL must be an HTTP or HTTPS URL without credentials, query, or fragment.', 'EMAIL_FRONTEND_URL_CONFIG');
  }
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' &&
      frontendUrl.protocol !== 'https:') {
    throw emailConfigError('Email delivery is not configured. FRONTEND_URL must use HTTPS in production.', 'EMAIL_FRONTEND_URL_CONFIG');
  }
  return frontendUrl;
}

function createTransporter(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.requireTLS ? { requireTLS: config.requireTLS } : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: { user: config.user, pass: config.password }
  });
}

function createAccountMailTransporter() {
  return createTransporter(getSMTPConfig());
}

function makeLink(page, token) {
  const frontendUrl = getFrontendBaseUrl();
  frontendUrl.pathname = `${frontendUrl.pathname.replace(/\/+$/, '')}/${page}`;
  frontendUrl.hash = `token=${encodeURIComponent(token)}`;
  return frontendUrl.toString();
}

async function sendAccountEmail({ to, subject, text, html }) {
  const config = getSMTPConfig();
  const transporter = createTransporter(config);
  return transporter.sendMail({ from: config.user, to, subject, text, html });
}

async function sendNotificationEmail(email, { subject, text }) {
  const result = await sendAccountEmail({ to: email, subject, text });
  if (!result.accepted || result.accepted.length === 0) {
    throw new AppError('Email provider did not accept the notification.', 503);
  }
  return result;
}

async function sendPasswordResetEmail(email, token) {
  const link = makeLink('reset-password.html', token);
  await sendAccountEmail({
    to: email,
    subject: 'Reset your LifeLink password',
    text: `We received a request to reset your LifeLink password. Use this link within 30 minutes:\n\n${link}\n\nIf you did not request this, you can ignore this message.`,
    html: `<p>We received a request to reset your LifeLink password.</p><p><a href="${link}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this message.</p>`
  });
}

async function sendVerificationEmail(email, token) {
  const link = makeLink('verify-email.html', token);
  const result = await sendAccountEmail({
    to: email,
    subject: 'Verify your LifeLink email',
    text: `Verify your LifeLink email address within 24 hours:\n\n${link}\n\nIf you did not create this account, you can ignore this message.`,
    html: `<p>Verify your LifeLink email address.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this message.</p>`
  });
  const accepted = Array.isArray(result.accepted) && result.accepted.some((recipient) =>
    String(recipient).trim().toLowerCase() === email.trim().toLowerCase()
  );
  if (!accepted) {
    const error = new AppError('Email provider did not accept the verification message.', 503);
    error.code = 'EMAIL_PROVIDER_REJECTED';
    throw error;
  }
  return result;
}

function getEmailFailureDetails(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const command = typeof error?.command === 'string' ? error.command.toUpperCase() : '';
  let category = 'unexpected';

  if (code === 'EMAIL_FRONTEND_URL_CONFIG') category = 'verification_url_configuration';
  else if (code === 'EMAIL_SMTP_CONFIG') category = 'smtp_configuration';
  else if (code === 'EMAIL_PROVIDER_REJECTED') category = 'provider_rejection';
  else if (code === 'EAUTH') category = 'smtp_authentication';
  else if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code)) category = 'smtp_connection';
  else if (command.includes('MAIL FROM') && [550, 553].includes(Number(error?.responseCode))) category = 'invalid_sender';
  else if (command.includes('RCPT TO') && [550, 551, 553, 554].includes(Number(error?.responseCode))) category = 'invalid_recipient';
  else if (Number(error?.responseCode) >= 400) category = 'provider_rejection';

  return {
    category,
    ...(code && /^[A-Z0-9_]{1,40}$/.test(code) ? { code } : {}),
    ...(Number.isInteger(error?.responseCode) ? { responseCode: error.responseCode } : {})
  };
}

function getEmailFailureMessage(error) {
  const { category } = getEmailFailureDetails(error);
  const messages = {
    verification_url_configuration: 'Verification email links are not configured. Ask the site administrator to set FRONTEND_URL.',
    smtp_configuration: 'Email delivery is not configured. Ask the site administrator to check the Gmail email settings.',
    smtp_authentication: 'The email service could not authenticate. Please try again later or contact support.',
    smtp_connection: 'The email service is temporarily unreachable. Please try again later.',
    invalid_sender: 'The email sender configuration is invalid. Please contact support.',
    invalid_recipient: 'The email provider rejected this address. Check the address and try again.',
    provider_rejection: 'The email provider rejected the message. Please try again later.',
    unexpected: 'The verification email could not be sent. Please try again later.'
  };
  return messages[category];
}

module.exports = {
  createAccountMailTransporter,
  getEmailFailureDetails,
  getEmailFailureMessage,
  getFrontendBaseUrl,
  getSMTPConfig,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendNotificationEmail
};
