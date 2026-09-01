function calculateSubtotal(price, quantity, deliveryCharges, productName) {
    const subtotal = price * quantity;
    const total = subtotal + deliveryCharges;

    console.log(`Product Name: ${productName}`);
    console.log(`Price: Rs. ${price}`);
    console.log(`Quantity: ${quantity}`);
    console.log(`Subtotal: Rs. ${subtotal}`);
    console.log(`Delivery Charges: Rs. ${deliveryCharges}`);
    console.log(`Total Bill: Rs. ${total}`);

    return total;
}

module.exports = {
    calculateSubtotal
};