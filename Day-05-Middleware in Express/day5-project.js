const express = require('express');
const app = express();

const employees = {
  "E101": { name: "Danyal", role: "Developer", checkedIn: false },
  "E102": { name: "Ali", role: "Manager", checkedIn: false },
  "E103": { name: "Sara", role: "Developer", checkedIn: false }
};

app.use((req, res, next) => {
    const dateTime = new Date().toLocaleString();
    console.log(`[${dateTime}] ${req.method} ${req.url}`);

    next();
});

function checkEmployee(req, res, next) {
    const id = req.params.id;
    if (!employees[id]) {
        return res.send('Employee ID not found');
    }

    next();
}

app.get('/checkin/:id', checkEmployee, (req, res) => {
    const id = req.params.id;
    const employee = employees[id];

    if (employee.checkedIn) {
        return res.send(`${employee.name} is already checked in!`);
    }

    employee.checkedIn = true;
    res.send(`${employee.name} checked in successfully at ${new Date().toLocaleString()}.`);
});

app.get('/checkout/:id', checkEmployee, (req, res) => {
    const id = req.params.id;
    const employee = employees[id];

    if (!employee.checkedIn) {
        return res.send(`${employee.name} is not checked in!`);
    }

    employee.checkedIn = false;
    res.send(`${employee.name} checked out successfully at ${new Date().toLocaleString()}.`);
});

app.get("/employee/:id", checkEmployee, (req, res) => {

    const id = req.params.id;

    res.json(employees[id]);

});

app.get('/status/:id' , checkManager , (req, res) =>{
    res.json(employees)

});

function checkManager(req , res , next){
    const id = req.params.id ;
    const employee = employees[id];
    if(employee.role !== "Manager" ){
        return res.send(`Access Denied: Managers only.`);
    }
    next();
}


const PORT = 7000 ;
app.listen(PORT , ()=>{
    console.log("The project is executing properly");
});