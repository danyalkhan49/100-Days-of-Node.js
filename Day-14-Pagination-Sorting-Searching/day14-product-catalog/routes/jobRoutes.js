const express = require('express');
const router = express.Router();
const Job = require('../models/Job');

router.post('/' , async (req , res)=>{
    const job = new Job(req.body);
    const savedJob = await job.save();
    return res.status(201).json({
        success : true ,
        data : savedJob 
    });
})

router.get('/' , async(req , res)=>{
    try{
        const page = Number(req.query.page) || 1 ;
        const limit = Number(req.query.limit) || 5;
        const skip = (page - 1 ) * limit ;
        const sortBy = req.query.sortBy || 'postedOn' ;
        const order = req.query.order || 'dec'
        const sortOrder = order === 'asc'  ? -1 : 1 ;

    const filter = {};
    if (req.query.search) {
      filter.title = {
        $regex: req.query.search,
        $options: "i"
      };
    }
    if(req.query.location){
        filter.location = req.query.location;
    }
    if (req.query.jobType) {
      filter.jobType = req.query.jobType;
    }
        res.status(201).json({
            success : true ,
            page ,
            limit ,
            data : job
        });

        const job = await job.find(filter)
        .sort({[sortBy] : sortOrder})
        .skip(skip)
        .limit(limit)


    }
    catch(err){
        res.status(500).json({
            success : false ,
            err : err.message
        });

    }

});
