const express = require("express");
const ConnectDB = require("./config/db");
const menuRoutes = require("./routes/menuRoutes");
const tableRoutes = require("./routes/tableRoutes");
const staffRoutes = require("./routes/staffRoutes");
const orderRoutes = require("./routes/orderRoutes");

const logger = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");


const app = express();

ConnectDB();

app.use(express.json());

app.use(logger);

app.use("/menu", menuRoutes);
app.use("/tables", tableRoutes);
app.use("/staff", staffRoutes);
app.use("/orders", orderRoutes);


app.use(errorHandler);


const PORT = 8600;

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

