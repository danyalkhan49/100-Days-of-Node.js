const mongoose = require('mongoose');
function connectDB(){
    mongoose.connect(process.env.MONGO_URI)
    .then(()=>{
        console.log('mongoose connected successfully')
    })
    .catch((err)=>{
        console.log('DataBase connection error' , err)
    })
}

module.export = connectDB;