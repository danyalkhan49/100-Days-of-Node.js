function createDriver({
    name = "",
    phone = "",
    vehicleNumber = "",
    vehicle = {},
    available = false
} = {}) {
    return {
        name: name,
        phone: phone,
        vehicleNumber: vehicleNumber,
        vehicle: vehicle,
        available: available
    };
}

function isDriverAvailable(available = false) {
    if (available === true) {
        return "Driver is available.";
    }

    return "Driver is currently busy.";
}

module.exports = {
    createDriver,
    isDriverAvailable
};