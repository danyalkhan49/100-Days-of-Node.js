const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
    name:{
        type:String,
        unique: true,
        trim: true,
        required: true
    },
    email:{
        type:String,
        unique: true,
        trim: true,
        required: true

    },
    password:{
        type:String,
        unique: true,
        required: true,
        lowerCase: true

    }
});

module.exports = mongoose.model('User ' , userSchema);
