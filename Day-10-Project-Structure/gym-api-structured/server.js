const express = require('express');
const app = express();
const connectDB = require('./config/db');
const memberRoutes = require('./routes/memberRoutes');

app.use(express.json());
connectDB();

app.use('/members', memberRoutes);

app.listen(7800, () => {
  console.log('Server running on http://localhost:7800');
});