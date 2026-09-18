const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());

mongoose.connect('mongodb://127.0.0.1:27017/gymDB')
  .then(() => console.log('Connected to MongoDB!'))
  .catch((err) => console.log('Connection error:', err));

  const memberSchema = new mongoose.Schema({
  name: String,
  age: Number,
  plan: String,              // "Basic", "Standard", "Premium"
  monthlyFee: Number,
  isActive: { type: Boolean, default: true },
  joinedOn: { type: Date, default: Date.now }
});

const Member = mongoose.model('Member', memberSchema);


app.post('/members' , async (req , res) =>{
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

app.get('/members' , async (req , res) =>{
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

app.get('/members/:id' , async (req , res)=>{
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

app.put('/members/:id' , async (req , res)=>{
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

app.put('/members/:id/deactivate', async (req, res) => {
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

app.delete('members/:id' , async (req , res)=>{
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
app.get("/members/stats/summary", async (req, res) => {
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

app.listen(7800, () => {
  console.log('Server running on http://localhost:7800');
});