const AppError = require('./AppError');
const { logOperationFailure } = require('./safeErrorLogger');

function normalizePakistanPhone(value) {
  if (typeof value !== 'string') throw new AppError('Phone number must be a string.', 400);
  const compact = value.trim().replace(/[\s()-]/g, '');
  let normalized;
  if (/^03\d{9}$/.test(compact)) normalized = `+92${compact.slice(1)}`;
  else if (/^923\d{9}$/.test(compact)) normalized = `+${compact}`;
  else if (/^\+923\d{9}$/.test(compact)) normalized = compact;
  else throw new AppError('Enter a valid Pakistani mobile number, such as 03XXXXXXXXX or +923XXXXXXXXX.', 400);
  return normalized;
}

async function sendVerificationCode(phone, code) {
  return sendPhoneMessage(phone, `Your LifeLink verification code is ${code}. It expires in 5 minutes.`);
}

async function sendPhoneMessage(phone, message, { fetchImpl = global.fetch } = {}) {
  const provider = process.env.SMS_PROVIDER;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = provider === 'twilio-whatsapp'
    ? process.env.TWILIO_WHATSAPP_FROM
    : process.env.TWILIO_FROM_NUMBER;

  if (!['twilio', 'twilio-whatsapp'].includes(provider) || !accountSid || !authToken || !from) {
    throw new AppError(
      'Phone verification is not configured. Set SMS_PROVIDER (twilio or twilio-whatsapp), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and the matching TWILIO_FROM_NUMBER or TWILIO_WHATSAPP_FROM.',
      503
    );
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams({
    To: provider === 'twilio-whatsapp' ? `whatsapp:${phone}` : phone,
    From: provider === 'twilio-whatsapp' ? `whatsapp:${from.replace(/^whatsapp:/, '')}` : from,
    Body: message
  });
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form,
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    const safeError = new AppError('Phone provider request failed.', 503);
    safeError.code = 'SMS_PROVIDER_FAILURE';
    logOperationFailure('sms_provider_delivery', safeError);
    throw new AppError('The phone verification message could not be sent. Please try again later.', 503);
  }
  if (!response.ok) {
    const safeError = new AppError('Phone provider rejected the request.', 503);
    safeError.code = 'SMS_PROVIDER_REJECTED';
    logOperationFailure('sms_provider_rejection', safeError);
    throw new AppError('The phone verification message could not be sent. Check the provider configuration and try again.', 503);
  }
}

module.exports = { normalizePakistanPhone, sendVerificationCode, sendPhoneMessage };
