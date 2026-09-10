const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb://127.0.0.1:27017/day8_practice';

async function updateStudentGrade(){
    const updatedStudent = await Student.findOneAndUpdate(
         { name: "Ali" },
         { grade: "A+" },
         {new : true}
    )

    
       
    
    console.log("Updated Student is " , updatedStudent);
}