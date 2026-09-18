const express = require('express');
const router = express.Router();
const Member = require('../models/Member');



router.post('/' , async (req , res) =>{
    try{
        const newMember  = new Member(req.body);
        const savedMember = await newMember.save();
        res.status(201).json({
            success : true , 
            data : savedMember
        });
    }
    catch(err){
        res.status(500).json({
            success : false , 
            err : err.message
        });
    }
});

router.get('/' , async (req , res) =>{
    try{
        let members ;
        if(req.query.plan){
            members = await Member.find({
                plan: req.query.plan
            });
        }
        else{
            members = await Member.find();
        }
        res.status(201).json({
             success: true,
             data: members
        });

    }
    catch(err){
        res.status(500).json({
            success : false , 
            err : err.message
        });
    }
});

router.get('/:id' , async (req , res)=>{
    try{
        const findMember = await Member.findById();

          if(!findMember){
                res.status(200).json({
                    succuss : true ,
                    data : members
                });
            }
            else{
                res.status(404).json({
                    success : false , 
                    err : "Member not found"
                });
            }
    }
    catch(err){
        res.status(500).json({
            success : false , 
            err : err.message 
        });

    }
});

router.put('/:id' , async (req , res)=>{
    try{
        const updateMember = await Member.findByIdAndUpdate(
            req.params.id ,
            req.body ,
            {
                new : true ,
            }
        );
        if(!updateMember){
            res.status(404).json({
                success : false ,
                err : "Member is not found"
            });
        }
    }
    catch(err){
        res.status().json({
            success : false , 
            err : err.message
        });
    }
});

router.put('/:id/deactivate', async (req, res) => {
    try{
        const deactivateMember = await Member.findByIdAndUpdate();
        req.params.id ,
        {
            isActive : true , 
            new : true 
        }
        if(!deactivateMember){
            res.status(404).json({
                success : false ,
                error: "Member not found"
            });
        }
        else{
            res.status(200).json({
                success : true , 
                data : deactivateMember
            });
      
        }
    }
   catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.delete('/:id' , async (req , res)=>{
    try{
        const deleteMember = await Member.findByIdAndUpdate(req.params.id )
        if(!deleteMember){
            res.status(404).json({
                success : false ,
                err : "Member not found"
            });
    }
    else{
        res.status(200).json({
        success: true,
        message: "Member removed"
    });
    }
    }
   
    catch(err){
        res.status(500).json({
      success: false,
      err : err.message
    });

    }

});
router.get("/stats/summary", async (req, res) => {
  try {
    const stats = await Member.aggregate([
      {
        $group: {
          _id: null,

          totalMembers: {
            $sum: 1
          },

          activeMembers: {
            $sum: {
              $cond: ["$active", 1, 0]
            }
          },

          totalMonthlyRevenue: {
            $sum: {
              $cond: ["$active", "$monthlyFee", 0]
            }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: stats[0]
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


module.exports = router;