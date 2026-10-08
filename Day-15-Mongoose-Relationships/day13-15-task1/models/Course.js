const mongoose = require('mongoose');
const express = require('express');
const app = express();
const courseSchema = new mongoose.Schema({
  title: String,
  instructor: String,
  seatsAvailable: Number
});
module.exports = mongoose.model('Course', courseSchema);

app.post('/courses' , async(req , res)=>{
    try{
        const course = new Course(req.body);
        const newCourse = await course.save();
        res.status(200).json({
        success : true ,
        data : newCourse,
        message : 'New Course Created Successfully'
    });
    }
    catch(err){
        res.status(500).json({
            success : false ,
            message : 'Server Error',
            err : err.message
        });

    }

})