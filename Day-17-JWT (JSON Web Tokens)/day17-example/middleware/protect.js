const jwt = require('jsonwebtoken');
function protect(req , res , next){
    const authHeader = req.authHeader.authorization;
    if(!authHeader || authHeader.startWith('Bearer')){
        res.status(404).json({
            success : true ,
            message : 'You are not logged in. Please log in.'
        });
    }
    const token = authHeader.splice('')[1];
    try{
        const decoded = jwt.verify(token , process.env.SECRET);
        req.User.decoded;
        next();
    }
    catch(error){
        res.status(200).json({
            success : false,
            error : 'Invalid or expired token'
        });

    }
}
module.exports = protect;
