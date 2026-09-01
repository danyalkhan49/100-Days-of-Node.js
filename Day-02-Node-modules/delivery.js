function getDeliveryStatus(status) {

    if (status === "pending") {
        return "Order is waiting for pickup.";
    } 
    
    else if (status === "shipped") {
        return "Order is on the way.";
    } 
    
    else if (status === "delivered") {
        return "Order has been delivered.";
    } 
    
    else {
        return "Invalid delivery status.";
    }
}

module.exports = getDeliveryStatus;