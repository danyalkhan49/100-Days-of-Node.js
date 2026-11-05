const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../utils/jwtSecret');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const User = require('../models/User');
const { rolesForAccount } = require('../utils/roles');

function authenticate(req, _res, next, options = {}) {
  const authorization = req.headers.authorization;
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+(.+)$/i)
    : null;

  if (!match) {
    return next(new AppError('You are not logged in. Please log in to continue.', 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(match[1], getJwtSecret());
  } catch (error) {
    return next(error);
  }

  if (
    !decoded ||
    typeof decoded.id !== 'string' ||
    !mongoose.Types.ObjectId.isValid(decoded.id) ||
    (decoded.authVersion !== undefined &&
      (!Number.isSafeInteger(decoded.authVersion) || decoded.authVersion < 0))
  ) {
    return next(new AppError('Invalid authentication token.', 401));
  }

  User.findById(decoded.id)
    .select('role isActive authVersion')
    .then((user) => {
      if (!user || user.isActive === false) {
        return next(new AppError(
          options.unavailableMessage || 'Your account is not available.',
          options.unavailableStatusCode || 401
        ));
      }
      if ((decoded.authVersion || 0) !== (user.authVersion || 0)) {
        return next(new AppError('Your session has expired. Please log in again.', 401));
      }

      req.user = {
        ...decoded,
        id: String(user._id),
        role: user.role,
        roles: rolesForAccount(user.role)
      };
      next();
    })
    .catch(next);
}

function protect(req, res, next) {
  return authenticate(req, res, next);
}

protect.withOptions = (options) => (req, res, next) =>
  authenticate(req, res, next, options);

module.exports = protect;
