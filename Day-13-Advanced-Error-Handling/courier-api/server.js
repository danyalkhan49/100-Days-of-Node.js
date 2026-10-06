require("dotenv").config();

const express = require("express");
const app = express();
const connectDB = require("./config/db");

const parcelRoutes = require("./routes/parcelRoutes");
const agentRoutes = require("./routes/agentRoutes");

app.use(express.json());

connectDB();

app.use("/parcels", parcelRoutes);
app.use("/agents", agentRoutes);

// 404 handler for unmatched routes
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        error: `Route ${req.originalUrl} not found`
    });
});

// Global error handler
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || "Something went wrong on our end!";

    console.error(err.stack);

    res.status(statusCode).json({
        success: false,
        error: message
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Courier API running on http://localhost:${PORT}`);
});