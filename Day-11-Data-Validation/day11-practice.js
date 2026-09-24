const express = require('express');
const { body, validationResult } = require('express-validator');
const app = express();

app.use(express.json());


app.post('/signup', 
    [
        body("name").notEmpty().withMessage("Name is Required"),
        body("Email").isEmail().withMessage("Enter the correct email"),
        body("age").isInt({min : 13 , max : 100}).withMessage("Age must be between 13 and 100"),
        body("password").isLength({min : 6 }).withMessage("Password must be at least 6 characters long")
    ],
    (req , res )=>{
        const errors = validationResult(req);
        if(!errors.isEmpty()){
            return res.status(404).json({
                success : false , 
                err : errors.array()
            });
        }
        res.status(200).json({
            success : true ,
            message: "Signup successful",
            data : req.body 
        });
    }

);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});