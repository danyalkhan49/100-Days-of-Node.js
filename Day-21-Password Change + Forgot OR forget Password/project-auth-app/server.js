require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const bcrypt = require('bcrypt');
const User = require('./models/User');
const protect = require('./middleware/protect');

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB!'))
  .catch((err) => console.log('Connection error:', err));

// ===== PAGES =====
app.get('/', (req, res) => res.redirect('/login'));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.listen(process.env.PORT, () => {
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});


app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (
            typeof name !== 'string' ||
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            password.length < 6
        ) {
            return res.status(400).json({
                success: false,
                error: 'Invalid name, email, or password'
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: cleanEmail });
        if (user) {
            return res.status(409).json({
                success: false,
                message: 'Email already registered'
            });
        }

        const hashed = await bcrypt.hash(password, 10);
        await User.create({ name, email: cleanEmail, password: hashed });

        return res.status(201).json({ success: true, message: 'Registered' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Something went wrong' });
    }
});


app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'email and password required'
            });
        }

        const user = await User.findOne({ email: email.trim().toLowerCase() });
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        return res.status(200).json({ success: true, token });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Something went wrong' });
    }
});

app.get('api/users/me' , async(req,res)=>{
    try{
        const user = await User.findById(req.user.id).select('-password');
        if(!user){
            res.status(402).json({
                success: false,
                err: 'user not found'
            })

        }
        res.status(200).json({
            success: true,
            data: user
        })

    }
    catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
})

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({ success: false, error: 'Something went wrong' });
});