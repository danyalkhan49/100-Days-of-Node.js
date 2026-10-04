require("dotenv").config();
const express = require('express');
const bcrypt = require('bcrypt');
const app = express();

app.use(express.json());

const connectDB = require("./config/db");
const Member = require('./models/Member');
connectDB();

app.post('/signup', async (req, res) => {
    try {
        const { name, email, password, membershipType } = req.body;

        const existingUser = await Member.findOne({ email });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'Email already registered'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new Member({
            name,
            email,
            password: hashedPassword,
            membershipType
        });

        await newUser.save();

        return res.status(201).json({
            success: true,
            data: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                membershipType: newUser.membershipType
            },
            message: 'User created successfully'
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Something went wrong',
            error: err.message
        });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const member = await Member.findOne({ email });
        if (!member) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        const isMatch = await bcrypt.compare(password, member.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                name: member.name,
                email: member.email,
                membershipType: member.membershipType
            }
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Something went wrong',
            error: err.message
        });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});