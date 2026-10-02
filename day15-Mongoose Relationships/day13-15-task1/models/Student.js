const mongoose = require('mongoose');
const express = require('express');
const app = express();
const Course = require('./Course');

const studentSchema = new mongoose.Schema({
    name : String ,
    email : String,
    enrolledCourse : {
        type: mongoose.Schema.Types.ObjectId,
        ref : 'course'
    }
});

module.exports = mongoose.model('Student', studentSchema);
const Student = mongoose.model('Student', studentSchema);
module.exports = Student;

app.post('/students' , async(req , res)=>{
    try{
        const student = new Student({
            name : req.body.name ,
            email: req.body.email
        });
        const newStudent = await student.save();
        res.status(200).json({
            success: true , 
            data : newStudent ,
            message : 'New Student Saved Successfully'
        });
    }
    catch(err){
        res.status(500).json({
            success : false ,
            message : 'Server Error',
            err : err.message
        });
    }
});

app.put('/students/:id/enroll/:courseId' , async (req , res)=>{
    try{
        const student = await Student.findById(req.params.id);
        if(!student){
            return res.status(404).json({
                success: false,
                message: 'Student not Found'
            });
        }

        const course = await Course.findById(req.params.courseId);
        if(!course){
            return res.status(404).json({
                success: false,
                message: 'Course not Found'
            });
        }

        if(course.seatsAvailable <= 0){
            return res.status(400).json({
                success: false,
                message: 'No seats available'
            });
        }

        student.enrolledCourse = course._id;
        await student.save();

        course.seatsAvailable -= 1;
        await course.save();

        return res.status(200).json({
            success: true,
            data: student,
            message: 'Student enrolled successfully'
        });
    }
    catch(err){
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            err: err.message
        });
    }
});

app.get('/students/:id', async(req , res)=>{
    try {
        const student = await Student.findById(req.params.id).populate('enrolledCourse', 'title instructor');

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: student
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Server Error',
            err: err.message
        });
    }
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log('Server is properly working')
});