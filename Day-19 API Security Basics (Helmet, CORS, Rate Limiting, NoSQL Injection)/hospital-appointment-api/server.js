const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigin = process.env.ALLOWED_ORIGIN;

// Apply security headers before the remaining middleware and routes.
app.use(helmet());
app.use(cors({
    origin(origin, callback) {
        if (!origin || origin === allowedOrigin) return callback(null, !origin ? false : true);
        return callback(new Error('Origin not allowed by CORS'));
    },
}));

app.use(express.json({ limit: '10kb' }));

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});
app.use('/auth/login', loginLimiter);


const isString = (field) => body(field).isString();
const isMongoId = (field) => param(field).isMongoId();
const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return next();
};
app.locals.validators = { isString, isMongoId, validateRequest };

app.listen(PORT, () => {
    console.log('Server is running on', PORT);
});

