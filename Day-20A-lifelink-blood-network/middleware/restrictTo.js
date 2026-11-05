const AppError = require('../utils/AppError');

const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new AppError('You are not logged in. Please log in to continue.', 401)
      );
    }

    const userRoles = Array.isArray(req.user.roles)
      ? req.user.roles
      : [req.user.role];

    if (!userRoles.some((role) => allowedRoles.includes(role))) {
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }

    next();
  };
};

module.exports = restrictTo;
