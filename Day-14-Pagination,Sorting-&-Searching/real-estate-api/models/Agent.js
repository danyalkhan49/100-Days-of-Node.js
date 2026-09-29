const mongoose = require('mongoose');
const agentSchema = new mongoose.Schema({
    name : {
        type : String ,
        required : true
    },
        phone : {
        type : String ,
        required : true
    },
        experienceYears : {
        type : String ,
        default : 0
    },
        activeListings : {
        type : Number ,
        default : 0
    }

});

module.exports = mongoose.model('Agent' , agentSchema )