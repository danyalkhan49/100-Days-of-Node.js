require('dotenv').config();

const express = require('express');
const app = express();
const connectDB = require('./config/db');
const propertyRoutes = require('./routes/propertyRoutes');
const agentRoutes = require('./routes/agentRoutes');

app.use(express.json());
connectDB();

app.use('/properties', propertyRoutes);
app.use('/agents', agentRoutes);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Something went wrong on our end!";
  console.error(err.stack);
  res.status(statusCode).json({ success: false, error: message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Real Estate API running on http://localhost:${PORT}`);
});
