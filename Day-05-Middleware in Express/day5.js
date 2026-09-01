const express = require('express');
const app = express();

app.use((req, res, next) => {
    console.log('[GET] /home requested ');
  next();
});

app.get('/', (req, res) => {
  res.send('HOMEPAGE');
})

app.get('/home', (req, res) => {
  res.send('Home page');
})


function checkAge(req , res , next){
    if(req.params.age < 18){
        return res.send(`Sorry, you must be 18+ to enter`);

    }
    next();

}

app.get('/club/:age' , checkAge  , (req , res) =>{
   return  res.send(`Welcome to the club!`);
    

});


app.get('/secure/:password' ,checkPassword , databaseCheck , (req , res) =>{
      res.send("Access Granted! Welcome, Admin.");
    
})


function checkPassword(req , res , next){
    if(req.params.password !== "admin123"){
        return res.send("Access Denied: Wrong password!");
    }
    next();

}

function databaseCheck(req , res , next){
     console.log("Checking database... (simulated)");

     next();

}

app.listen(3000, () => {
  console.log('Server running on port 3000');
 

});

