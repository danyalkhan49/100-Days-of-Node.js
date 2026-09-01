const express = require("express");
const app = express();
const PORT = 3000;
const prices = {
    apple: 50,
    banana: 20,
    milk: 80
};
app.get("/price/:item", (req, res) => {
    const item = req.params.item;
    if (prices[item]) {
        res.send(`Price of ${item} is Rs. ${prices[item]}`);
    } else {
        res.send("Item not found");
    }
});
app.get("/bill/:item/:quantity", (req, res) => {
    const item = req.params.item;
    const quantity = Number(req.params.quantity);
    if (!prices[item]) {
        return res.send("Item not found");
    }
    const total = prices[item] * quantity;
    if (total > 200) {
        const discount = total * 0.10;
        const finalPrice = total - discount;
        res.send(`${quantity} ${item}(s) cost Rs. ${total}. After 10% discount: Rs. ${finalPrice}`);
    } else {
        res.send(`${quantity} ${item}(s) will cost Rs. ${total}. No discount applied.`);
    }
});
app.get("/cart", (req, res) => {
    const items = Object.keys(req.query);
    let total = 0;
    let details = [];
    for (const item of items) {
        if (!prices[item]) {
            return res.send(`Item not found: ${item}`);
        }
        const quantity = Number(req.query[item]);
        const cost = prices[item] * quantity;
        total += cost;
        details.push(`${item}: ${quantity} × Rs. ${prices[item]} = Rs. ${cost}`);
    }
    if (total >= 200) {
        const discount = total * 0.10;
        const finalTotal = total - discount;
        res.send(`${details.join("<br>")}<br><br>Total: Rs. ${total}<br>After 10% discount: Rs. ${finalTotal}`);
    } else {
        res.send(`${details.join("<br>")}<br><br>Total: Rs. ${total}<br>No discount applied.`);
    }
});
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});