const mongoose = require('mongoose');
function connectDB(){
    mongoose.connect('mongodb://127.0.0.1:27017/FoodDeliveryApi')
    .then(()=>{
        console.log('mongoose connected Successfully');
    })
    .catch((err)=>{
        console.log('connection Error' , err);
    })
}
module.exports = connectDB;