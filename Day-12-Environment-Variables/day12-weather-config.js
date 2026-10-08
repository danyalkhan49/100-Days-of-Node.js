require('dotenv').config();
const express = require('express');
const app = express();

const PORT = Number(process.env.PORT) || 3000;
const CITY_NAME = process.env.CITY_NAME || 'Islamabad';
const TEMP_THRESHOLD = Number(process.env.TEMP_THRESHOLD);
const ALERT_MESSAGE = process.env.ALERT_MESSAGE || 'SomeThing is going wrong';

app.get('/check-temp/:currentTemp', (req, res) => {
    const currentTemp = Number(req.params.currentTemp);

    if (Number.isNaN(currentTemp)) {
        return res.status(400).json({
            success: false,
            error: 'currentTemp must be a number'
        });
    }

    const message = currentTemp >= TEMP_THRESHOLD
        ? ALERT_MESSAGE
        : 'Temperature is normal.';

    res.status(200).send(
        `${CITY_NAME}: ${message} (Current: ${currentTemp}°C)`
    );
});

app.listen(PORT, () => {
    console.log(`${CITY_NAME} Weather server running on port ${PORT}`);
});