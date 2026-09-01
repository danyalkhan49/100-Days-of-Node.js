const express = require('express');
const app = express();

app.get('/' , (req , res) =>{
  res.send("Welcome to my Express server!");

});

app.get('/about' , (req , res) =>{
  res.send("This server is built with Express.js by Danyal.");
});

app.get('/user/:name' , (req , res) =>{
  res.send('Hello ${req.params.name} , Welcome to the site.');

});

app.get('/add/:num1/:num2' , (req , res) =>{
  const sum = parseInt(req.params.num1) + parseInt(req.params.num2);
  res.send(`The sum of ${req.params.num1} and ${req.params.num2} is ${sum}`);
});

app.use((req, res) =>{
   res.statusCode = 404;
  res.send('404 - Page not found');
});


const PORT = 5000 ; 
app.listen(PORT  , () =>{
  console.log("Server running on http://localhost:5000");

});