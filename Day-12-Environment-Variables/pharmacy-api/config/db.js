const mongoose = require('mongoose');
function connectDB(){
    mongoose.connect(process.env.MONGO_URI)
    .then(()=>{
        console.log("The MongoDB is connected Successfully");
    })
    .catch((err)=>{
        console.log('Connection error:', err);
    });
}
module.exports = connectDB ;
