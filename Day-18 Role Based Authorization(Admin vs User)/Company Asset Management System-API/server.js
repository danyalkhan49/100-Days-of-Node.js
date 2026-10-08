require("dotenv").config();

const express = require("express");
const app = express();

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const assetRoutes = require("./routes/assetRoutes");

app.use(express.json());
connectDB();

app.use("/auth", authRoutes);
app.use("/assets", assetRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, err: "Route not found" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});