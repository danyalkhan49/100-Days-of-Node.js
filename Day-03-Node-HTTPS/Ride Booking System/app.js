const { createCustomer } = require("./customer");
const { createDriver, isDriverAvailable } = require("./driver");
const { getRideStatus } = require("./status");
const { processPayment, applyDiscount } = require("./payment");
const http = require('http');
const {
    calculateFare,
    calculateVehicleCharge,
    calculateFinalFare,
} = require("./ride");

const customer = createCustomer({
    name: "Danial Khan",
    city: "Islamabad",
    phone: "03177748890",
});
console.log("Customer created:", customer);

const driver = createDriver({
    name: "Danial Khan",
    phone: "03177748890",
    vehicleNumber: "ABC-123",
    vehicle: "car",
    available: true,
});
console.log("Driver created:", driver);
console.log("Driver available:", isDriverAvailable(driver.available));

const status = "accepted";
console.log("Status:", getRideStatus(status));

const distance = 10;
const pricePerKm = 50;
const baseFare = calculateFare(distance, pricePerKm, driver.vehicle);
const fare = calculateFinalFare(baseFare, 0.1); // 0.1 = 10% extra vehicle charge on top of fare
const amount = applyDiscount(fare, 0);
const method = "cash";

console.log("Fare:", amount);
console.log("Payment:", processPayment(amount, method));

const ride = {
    customer,
    driver,
    pickup: "Islamabad",
    dropoff: "Rawalpindi",
    distance,
    status,
    fare: amount,
    paymentMethod: method,
};

if (driver.available) {
    console.log("Ride booked:", ride);
} else {
    console.log("No driver is available for this ride.");
}

