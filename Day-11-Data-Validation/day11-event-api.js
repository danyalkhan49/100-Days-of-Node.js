const express = require('express')
const {body ,params  , query , validationResult} = require('express-validator');
const app = express();
app.use(express.json());

let registrations = [] ;
let idCounter = 1 ;

function handleValidation(req , res , next ){
    const errors = validationResult();
    if(!errors.isEmpty()){
         return res.status(404).json({
            success : false ,
            err : errors.array
        });
    }
    next();
}

app.post('/register' ,
    [
        body("name").isEmpty().withMessage("Name Required"),
        body("email").isEmail().withMessage("Enter the correct Email"),
        body("age").isInt({min : 10 , max : 80}).withMessage("Age must be between 10 and 80"),
        body("eventName").isEmpty().withMessage("Event name is required "),
        body("ticketType").isIn(['General', 'VIP' , 'Student']).withMessage('Ticket type must be General, VIP, or Student')

    ],
    handleValidation,
    (req , res)=>{
        const newRegistration = {id : count++ , ...req.body};
        registrations.push(newRegistration);
        res.status(200).json({
            success : true ,
            data : newRegistration ,
            message : "Register Successfully"
        });

    }

 );

 app.get('/registrations' , 
    [
        query('ticketType').optional().isInt(['General', 'VIP', 'Student']).withMessage('Invalid ticket type filter')
    ],
    handleValidation,
    (req , res)=>{
        req.query.ticketType = 'VIP'
        const ticketType = req.query.TicketType ;
        if(!ticketType){
            res.status.json(registrations);
        }
        const filteredRegistrations = registrations.filter(
            (r) => r.ticketType === ticketType
        );
        res.json(filteredRegistrations);
    }
    

 );

 app.get('/registrations/:id' , 
    [
        body("id").isInt().withMessage("ID Required and also must be a number")
    ],
    handleValidation ,
    (req , res)=>{
        const id = Number(req.params.id)
        const registration = registrations.findById((r)=> r.id === id);
        if(!registration){
           return res.status(404).json({
            success : false , 
            err : "Registration not found"
            });
        }
        else{
            res.status(200).json({
                success : true , 
                data : registration 
            });
        }
    }
 );
app.put('/registrations' , 
    [
        body("id").isInt().withMessage("ID Required and also must be a number") ,
        body("ticketType").optional().isInt(['General', 'VIP', 'Student']).withMessage("Invalid ticket type"),
        body("age").isInt({min : 10 , max : 80}).withMessage('Age must be between 10 and 80')

    ],
    handleValidation , 
    (req , res)=>{
        const index = registrations.findIndex(r => r.id === Number(req.body.id));
        if(!index === -1){
            return res.status(404).json({
                success : false , 
                err : "Registration not found"
            });
        }
        else{
            registrations[index] = { ... registrations[index] , ...req.body};
             return res.status(200).json({
                success : true ,
                data : registrations[index]
            });
        }
    }
);

app.delete('/registrations/:id' , 
    [
        body("id").isInt().withMessage("ID Required and also must be a number")

    ],
    registrations ,
    (req , res)=>{
        const index = registrations.findIndex (r => r.id  === Number(req.params.id));
        if(!index === -1){
            
        }
    }  
);
app.listen(9200, () => {
  console.log('Server running on http://localhost:9200');
});

