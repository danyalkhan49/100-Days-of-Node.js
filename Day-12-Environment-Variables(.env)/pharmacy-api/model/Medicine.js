const mongoose = require('mongoose');
const medicineSchema = new mongoose.Schema({
    name :{
        type : String,
        required : true 

    } , 
    category :{
        type : String ,
    },
    price : {
        type : Number ,
        required : true
    },
    stockQuantity : {
        type : Number
    } ,
    expiryDate :{
        type : Date

    }  ,
    isAvailable :{
        type : Boolean ,
        default : true

    } 
});
const Medicine = mongoose.model('Medicine' , medicineSchema);
module.exports = Medicine ;