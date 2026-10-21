require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");

const app = express();

// 1. Connect to MongoDB
connectDB();

// 2. Secure HTTP headers
app.use(helmet());

// 3. Allow only the configured frontend origin
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN,
  methods: ["GET", "POST"]
}));

// 4. Limit request body size
app.use(express.json({ limit: "5kb" }));

// 5. Global rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    error: "Too many requests. Please try again after 15 minutes."
  }
});

app.use(limiter);

// 6. Routes
app.use("/auth", authRoutes);
app.use("/feedback", feedbackRoutes);

// 7. Start server
const PORT = process.env.PORT || 7400;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});