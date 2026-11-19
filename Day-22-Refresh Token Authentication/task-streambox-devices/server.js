require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const Session = require('./models/Session');
const User = require('./models/User');
const protect = require('./middleware/protect');


mongoose.connect(process.env.MONGO_URI)
.then(()=>{
    console.log('mongoose connected successfully');
})
.catch((err)=>{
    console.log('Connection error' , err);
})



const catchAsync  = (fn)=>(req , res , next)=>fn(req, res , next).catch(next);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const isStr = (v) => typeof v === 'string';

const app = express();
app.use(express.json({limit: '10KB'}));
app.use(cookieParser())


const REFRESH_DAYS = 7;


const cookieOption = {
    httpOnly : true,
    secure: process.env.NODE_ENV === 'production',
    sameSite : 'strict',
    path: '/auth',
  maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000
}



function signAccessToken(UserId){
    return jwt.sign({id:UserId},process.env.JWT_SECRET,{
    expiresIn: process.env.ACCESS_EXPIRES || '30m'
    }
    )

}

async function issueRefreshToken(req, res, UserId, deviceName){
    const token = crypto.randomBytes(45).toString('hex');

    await Session.create({
    user: UserId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000),
    userAgent: req.headers['user-agent'],
    deviceName,
    lastUsedAt: new Date()
    })
    res.cookie('refreshToken', token, cookieOption);
}


app.post(
    '/auth/signup',
    catchAsync(async (req, res) => {
        const { name, email, password } = req.body;

        if (!isStr(name) || !name.trim() ||
            !isStr(email) || !email.trim() ||
            !isStr(password) || password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'name, email, password (min 6 chars) are required'
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        if (await User.findOne({ email: cleanEmail })) {
            return res.status(409).json({
                success: false,
                error: 'Email already registered'
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        await User.create({
            name: name.trim(),
            email: cleanEmail,
            passwordHash
        });

        return res.status(201).json({
            success: true,
            message: 'Signup successful'
        });
    })
);

app.post('/auth/login', catchAsync(async (req, res) => {
    const body = req.body || {};
    const { email, password } = body;
    const user = typeof email === 'string'
        ? await User.findOne({ email: email.trim().toLowerCase() })
        : null;

    if (!user || typeof password !== 'string' ||
        !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({
            success: false,
            error: 'Invalid email or password'
        });
    }

    const deviceName = typeof body.deviceName === 'string' && body.deviceName.trim()
        ? body.deviceName.trim().slice(0, 30)
        : 'Unknown device';

    await issueRefreshToken(req, res, user._id, deviceName);
    return res.status(200).json({
        success: true,
        accessToken: signAccessToken(user._id)
    });
}));

app.post('/auth/refresh', catchAsync(async (req, res) => {
    const token = req.cookies.refreshToken;
    const clearRefreshCookie = () => res.clearCookie('refreshToken', {
        httpOnly: cookieOption.httpOnly,
        secure: cookieOption.secure,
        sameSite: cookieOption.sameSite,
        path: cookieOption.path
    });

    if (!token) {
        return res.status(401).json({ success: false, error: 'Refresh token required' });
    }

    const session = await Session.findOneAndDelete({ tokenHash: sha256(token) });
    if (!session || session.expiresAt <= new Date()) {
        clearRefreshCookie();
        return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(session.user);
    if (!user) {
        clearRefreshCookie();
        return res.status(401).json({ success: false, error: 'User not found' });
    }

    await issueRefreshToken(req, res, user._id, session.deviceName);
    return res.status(200).json({ success: true, accessToken: signAccessToken(user._id) });
}));

app.post('/auth/logout', catchAsync(async (req, res) => {
    const token = req.cookies.refreshToken;
    if (token) await Session.findOneAndDelete({ tokenHash: sha256(token) });
    res.clearCookie('refreshToken', {
        httpOnly: cookieOption.httpOnly,
        secure: cookieOption.secure,
        sameSite: cookieOption.sameSite,
        path: cookieOption.path
    });
    return res.status(200).json({ success: true });
}));

app.get('/auth/sessions', protect, catchAsync(async (req, res) => {
    const token = req.cookies.refreshToken;
    const currentTokenHash = token ? sha256(token) : null;
    const sessions = await Session.find({ user: req.user.id })
        .sort({ lastUsedAt: -1 })
        .select('_id deviceName lastUsedAt tokenHash');

    const data = sessions.map((session) => ({
        id: session._id,
        deviceName: session.deviceName,
        lastUsedAt: session.lastUsedAt,
        isCurrent: currentTokenHash !== null && session.tokenHash === currentTokenHash
    }));
    return res.status(200).json({ success: true, data });
}));

app.delete('/auth/sessions/:id', protect, catchAsync(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid session id' });
    }

    const session = await Session.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }
    return res.status(200).json({ success: true, message: 'Device logged out' });
}));

app.post('/auth/logout-all', protect, catchAsync(async (req, res) => {
    await Session.deleteMany({ user: req.user.id });
    res.clearCookie('refreshToken', {
        httpOnly: cookieOption.httpOnly,
        secure: cookieOption.secure,
        sameSite: cookieOption.sameSite,
        path: cookieOption.path
    });
    return res.status(200).json({ success: true });
}));

app.get('/videos', protect, (req, res) => {
    return res.status(200).json({ success: true, data: ['Money Heist', 'Dark', 'Narcos'] });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});