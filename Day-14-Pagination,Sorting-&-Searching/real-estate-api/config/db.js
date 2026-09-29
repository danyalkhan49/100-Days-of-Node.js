const mongoose = require('mongoose');
function connectDB(){
    mongoose.connect(process.env.MONGO_URI)
    .then(()=>{
        console.log('mongoose connected successfully');
    })
    .catch((err)=>{
        console.log('server error : ' , err);
    });
}
module.exports = connectDB;