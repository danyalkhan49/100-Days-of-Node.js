function processPayment(amount, method) {
    if (amount <= 0) {
        return "Invalid amount.";
    }

    if (method === "cash") {
        return "Payment successful through Cash.";
    } else if (method === "card") {
        return "Payment successful through Card.";
    } else if (method === "wallet") {
        return "Payment successful through Wallet.";
    } else {
        return "Invalid payment method.";
    }
}

function applyDiscount(amount, discountPercentage) {
    const validAmount = Number(amount);
    const validDiscount = Number(discountPercentage);

    if (isNaN(validAmount) || validAmount <= 0) {
        return 0;
    }

    if (isNaN(validDiscount) || validDiscount < 0) {
        return validAmount;
    }

    const discount = Math.min(validDiscount, 100);
    const discountedAmount = validAmount - (validAmount * discount) / 100;

    return discountedAmount;
}

module.exports = {
    applyDiscount,
    processPayment
};