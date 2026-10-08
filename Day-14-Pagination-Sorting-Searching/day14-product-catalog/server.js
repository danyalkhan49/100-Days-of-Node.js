const express = require('express');
const app = express();
const connectDB = require('./config/db');
const jobRoutes = require('./routes/jobRoutes');

app.use(express.json());
connectDB();

app.use('/jobs', jobRoutes);

app.listen(5300, () => {
  console.log('Server running on http://localhost:5300');
});