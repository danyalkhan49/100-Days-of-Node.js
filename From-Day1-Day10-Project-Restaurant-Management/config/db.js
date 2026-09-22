const mongoose = require("mongoose");

async function ConnectDB() {
    try {
        await mongoose.connect("mongodb://127.0.0.1:27017/RestaurantDB");

        console.log("Database is successfully connected");
    } catch (error) {
        console.log("Database connection error:", error.message);
    }
}

module.exports = ConnectDB;