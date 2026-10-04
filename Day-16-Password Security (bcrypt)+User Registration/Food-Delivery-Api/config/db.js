const mongoose = require('mongoose');
function connectDB(){
    mongoose.connect('http:/127.0.0.1:21727/FoodDeliveryApi')
    .then(()=>{
        console.log('mongoose connected Successfully');
    })
    .catch((err)=>{
        console.log('connection Error' , err);
    })
}
module.exports = connectDB();