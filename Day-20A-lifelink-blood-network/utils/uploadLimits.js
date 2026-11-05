const MAX_STAGING_PRESCRIPTION_MB = 3;

function parseMaxPrescriptionMb(value) {
  const maxPrescriptionMb = Number(value);
  if (!Number.isSafeInteger(maxPrescriptionMb) || maxPrescriptionMb < 1) {
    throw new Error('MAX_PRESCRIPTION_MB must be a positive integer.');
  }
  return maxPrescriptionMb;
}

module.exports = { MAX_STAGING_PRESCRIPTION_MB, parseMaxPrescriptionMb };
