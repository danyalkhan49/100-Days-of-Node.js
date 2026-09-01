function getRideStatus(status) {
    if (status === "requested") {
        return "Ride request has been sent.";
    }
    else if (status === "accepted") {
        return "Driver has accepted your ride.";
    }
    else if (status === "arrived") {
        return "Driver has arrived at your location.";
    }
    else if (status === "stated") {
        return "Your ride has started.";
    }
    else if (status === "completed") {
        return "Ride completed successfully.";
    }
    else if (status === "cancelled") {
        return "Ride has been cancelled.";
    }
    else if (status === "wrong") {
        return "Invalid ride status.";
    }
}

module.exports = {
    getRideStatus
};