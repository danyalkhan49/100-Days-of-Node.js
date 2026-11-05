
const bloodCompatibility = {
  "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  "O+": ["O+", "A+", "B+", "AB+"],
  "A-": ["A-", "A+", "AB-", "AB+"],
  "A+": ["A+", "AB+"],
  "B-": ["B-", "B+", "AB-", "AB+"],
  "B+": ["B+", "AB+"],
  "AB-": ["AB-", "AB+"],
  "AB+": ["AB+"],
};

const canDonate = (donorGroup, patientGroup) => {
  if (!donorGroup || !patientGroup) {
    return false;
  }

  return (
    bloodCompatibility[donorGroup]?.includes(patientGroup) ?? false
  );
};

const getCompatibleDonors = (patientGroup) => {
  if (!bloodCompatibility[patientGroup]) {
    return [];
  }

  return Object.keys(bloodCompatibility).filter((donorGroup) =>
    canDonate(donorGroup, patientGroup)
  );
};

const checkDonorEligibility = (
  lastDonationDate,
  minimumDays = Number(process.env.DONATION_GAP_DAYS || 90)
) => {
  if (!Number.isFinite(minimumDays) || minimumDays < 0) {
    throw new Error("Invalid DONATION_GAP_DAYS configuration");
  }

  if (!lastDonationDate) {
    return {
      eligible: true,
      daysRemaining: 0,
      eligibleDate: null,
    };
  }

  const lastDonation = new Date(lastDonationDate);

  if (Number.isNaN(lastDonation.getTime())) {
    return {
      eligible: false,
      daysRemaining: null,
      eligibleDate: null,
      message: "Invalid last donation date",
    };
  }

  const eligibleDate = new Date(lastDonation);
  eligibleDate.setDate(eligibleDate.getDate() + minimumDays);

  const now = new Date();
  const eligible = now >= eligibleDate;

  const daysRemaining = eligible
    ? 0
    : Math.ceil((eligibleDate.getTime() - now.getTime()) / 86400000);

  return {
    eligible,
    daysRemaining,
    eligibleDate,
    message: eligible
      ? "Donor is eligible"
      : `Donor will be eligible after ${daysRemaining} day(s)`,
  };
};

module.exports = {
  bloodCompatibility,
  canDonate,
  getCompatibleDonors,
  checkDonorEligibility,
};
