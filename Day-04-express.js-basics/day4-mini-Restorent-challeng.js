const express = require('express');

const app = express();
const menu = {
    biryani: 250,
    karahi: 400,
    tea: 30
};
app.get("/menu/:dish", (req, res) => {

    const dish = req.params.dish;
    if (menu[dish]) {

        res.send(`Price of ${dish} is Rs. ${menu[dish]}`);

    }
    else {

        res.send("Dish not found");

    }
});
app.get("/order/:dish/:table", (req, res) => {

    const dish = req.params.dish;
    const table = Number(req.params.table);
    if (!menu[dish]) {

        return res.send("Dish not found");

    }
    const dishPrice = menu[dish];

    res.send(
        `Table ${table} ordered ${dish} for Rs. ${dishPrice}`
    );
});
app.get("/order/:dish/:table/:plates", (req, res) => {

    const dish = req.params.dish;
    const table = Number(req.params.table);
    const plates = Number(req.params.plates);
    if (!menu[dish]) {

        return res.send("Dish not found");

    }
    const dishPrice = menu[dish];
    const total = plates * dishPrice;
    if (total > 500) {

        const serviceCharge = total * 0.05;

        const finalTotal = total + serviceCharge;

        res.send(
            `Table ${table} ordered ${plates} plate(s) of ${dish}. ` +
            `Total: Rs. ${total} + Rs. ${serviceCharge} service charge = Rs. ${finalTotal}`
        );

    }
    else {

        res.send(
            `Table ${table} ordered ${plates} plate(s) of ${dish}. ` +
            `Total: Rs. ${total} (no service charge)`
        );

    }
});

app.get("/fullorder/:table", (req, res) => {

    const table = Number(req.params.table);
    const orders = req.query;

    // Get item names
    const items = Object.keys(orders);

    // Total bill
    let total = 0;

    // Store individual item details
    let details = [];


    // Loop through all ordered items
    for (const item of items) {

        // Check if dish exists
        if (!menu[item]) {

            return res.send(`Dish not found: ${item}`);

        }

        // Convert quantity from string to number
        const quantity = Number(orders[item]);

        // Calculate individual cost
        const cost = menu[item] * quantity;

        // Add cost to total
        total += cost;

        // Store details
        details.push(
            `${item}: ${quantity} plate(s) = Rs. ${cost}`
        );
    }
    if (total >= 500) {

        const serviceCharge = total * 0.05;

        const finalTotal = total + serviceCharge;

        res.send(
            `Table ${table}<br>` +
            `${details.join("<br>")}<br>` +
            `Total: Rs. ${total}<br>` +
            `5% service charge: Rs. ${serviceCharge}<br>` +
            `Final Total: Rs. ${finalTotal}`
        );

    }
    else {

        res.send(
            `Table ${table}<br>` +
            `${details.join("<br>")}<br>` +
            `Total: Rs. ${total}<br>` +
            `No service charge`
        );

    }
});
const PORT = 7000;

app.listen(PORT, () => {

    console.log(`Server is running on port ${PORT}`);

});