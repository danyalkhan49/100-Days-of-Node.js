function calculateFare(distance, pricePerKm, vehicleType) {
    const normalizedVehicleType = String(vehicleType || '').toLowerCase();

    const multiplier =
        normalizedVehicleType === 'premium' || normalizedVehicleType === 'luxury' ? 1.5 :
        normalizedVehicleType === 'bike' || normalizedVehicleType === 'jeep' ? 1.3 :
        1;

    const fare = distance * pricePerKm * multiplier;
    return fare;
}

function calculateVehicleCharge(fare, vehicleType) {
    const vehicleCharge = fare * vehicleType;
    return vehicleCharge;
}

function calculateFinalFare(fare, vehicleType) {
    const vehicleCharge = calculateVehicleCharge(fare, vehicleType);
    const finalFare = fare + vehicleCharge;
    return finalFare;
}

module.exports = {
    calculateFare,
    calculateVehicleCharge,
    calculateFinalFare
};