const { createCustomer } = require("./customer");
const { calculateSubtotal } = require("./order");
const getDeliveryStatus = require("./delivery");

// Customer
const customer = createCustomer("Ali", "Islamabad");

// Order information
const productName = "Burger";
const price = 1000;
const quantity = 5;
const deliveryCharges = 200;
const status = "shipped";

// Calculate total
const total = calculateSubtotal(
    price,
    quantity,
    deliveryCharges,
    productName
);

// Delivery status
const deliveryMessage = getDeliveryStatus(status);

console.log("\n===== DELIVERY ORDER =====");

console.log(`Customer: ${customer.name}`);
console.log(`City: ${customer.city}`);
console.log(`Product: ${productName}`);
console.log(`Final Total: Rs. ${total}`);
console.log(`Status: ${deliveryMessage}`);