const mongoose = require('mongoose');

function connectDB() {
    mongoose
        .connect(process.env.MONGO_URI)
        .then(() => {
            console.log('MongoDB connected successfully');
        })
        .catch((err) => {
            console.error('MongoDB connection error:', err.message);
            process.exit(1); 
        });
}

module.exports = connectDB;