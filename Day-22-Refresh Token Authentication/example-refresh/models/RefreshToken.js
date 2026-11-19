const mongoose = require('mongoose');
const refreshTokenSchema = new mongoose.Schema({
    user:{
        type: mongoose.Schema.Types.objectId,
        ref: User,
        required: true
    },
    tokenHash:{
        type:String,
        required:true,
        unique:true
    },
    expireAt:{
        type:Date,
        required:true
    },
    userAgent:String,

})
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('RefreshToken', refreshTokenSchema);