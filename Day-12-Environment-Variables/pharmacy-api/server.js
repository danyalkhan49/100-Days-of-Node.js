require('dotenv').config();
const express = require('express');
const app = express();
const connectDB = require('./config/db');
const medicineRoutes = require('./routes/medicineRoutes');

app.use(express.json());
connectDB();

app.use('/medicines', medicineRoutes);

const PORT = process.env.PORT || 8700;
app.listen(PORT, () => {
  console.log(`Pharmacy API running on http://localhost:${PORT}`);
});