const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 10;
const requestsByDonor = new Map();

module.exports = (req, res, next) => {
  const donorId = req.user && req.user.id;
  if (!donorId) {
    return res.status(401).json({
      success: false,
      error: 'You are not logged in. Please log in to continue.'
    });
  }

  const now = Date.now();
  const recentRequests = (requestsByDonor.get(donorId) || [])
    .filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recentRequests.length >= MAX_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - recentRequests[0])) / 1000));
    requestsByDonor.set(donorId, recentRequests);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: 'You have submitted too many offers. Try again after the rate limit resets.'
    });
  }

  recentRequests.push(now);
  requestsByDonor.set(donorId, recentRequests);
  next();
};
