const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const list = errors.array();
        const error = new AppError(list[0].msg, 400);
        error.details = list.map((e) => ({ field: e.path, message: e.msg }));
        return next(error);
    }
    next();
}

module.exports = handleValidation;
