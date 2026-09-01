function createCustomer({name, city, phone}) {
    return {
        name: name,
        city: city,
        phone: phone
    };
}

module.exports = {
    createCustomer
};