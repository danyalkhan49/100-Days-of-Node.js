const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const Medicine = require('../model/Medicine');

function handleValidation(req , res , next){
    const error = validationResult(req);
    if(!error.isEmpty()){
        return res.status(400).json({
            success : false , 
            error : error.array()
        });
    }
    next();
}

router.post('/' , 
    [
        body("name").trim().notEmpty().withMessage("Name is Required"),
        body("price").isFloat({min : 1}).withMessage("Price is in number"),
        body("stockQuantity").isInt({min : 0}).withMessage("stockQuantity is in number"),
        body("category").trim().notEmpty().withMessage("category is Required")
    ],
    handleValidation ,
    async (req , res)=>{
        try {
            const medicine = new Medicine(req.body);
            const addMedicine = await medicine.save();
            return res.status(201).json({
                success : true ,
                data : addMedicine ,
                message : 'Medicine is added successfully'
            });
        } catch (err) {
            return res.status(500).json({
                success: false,
                message: "Server error",
                error: err.message
            });
        }
    }
);

router.get('/' , 
    [
        query("category").optional().isString().withMessage("category must be in string")
    ],
    handleValidation ,
    async (req , res)=>{
        try{
           let medicines ;
           if(req.query.category){
                medicines = await Medicine.find({
                category : req.query.category
           });

           }
           else{
            medicines = await Medicine.find()
           }
           res.status(200).json({
            success : true ,
            data : medicines
           });

        }
        catch(err){
                res.status(500).json({
                message: "Server error",
                error: err.message
            });

        }
    }

);

router.get("/alerts/low-stock", async (req, res) => {

    try {
        const threshold = Number(process.env.LOW_STOCK_THRESHOLD);
        if (!Number.isFinite(threshold) || threshold < 0) {
            return res.status(500).json({
                success: false,
                message: "Invalid LOW_STOCK_THRESHOLD configuration"
            });
        }
        const lowStockItems = await Medicine.find({
            stockQuantity: { $lt: threshold }
        });
        res.status(200).json({
            success: true,
            threshold: threshold,
            lowStockItems: lowStockItems
        });

    }
    catch (error){
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });

    }
});

router.get('/:id' , 
    [
      param('id').isMongoId().withMessage("Invalid ID Format")
    ],
    handleValidation,
    async (req , res)=>{
        try{
        const findMedicine = await Medicine.findById(req.params.id);
        if(!findMedicine){
            return res.status(404).json({
            success : false ,
            err : "Your ID is not hare"
            });
        }
        res.status(200).json({
            success : true ,
            data : findMedicine
        });
    }
    catch(err){
        res.status(500).json({
            success : false ,
            err : err.message
        });
    } 
    }
)

router.put('/:id' , 
    [
        param('id').isMongoId().withMessage('Invalid ID Format'),
            body('price').optional().isFloat({gt : 0}).withMessage("Price must be a positive number"),
        body('stockQuantity').optional().isInt({min : 0}).withMessage('Stock quantity must be 0 or greater')
    ],
    handleValidation,
    async (req , res)=>{
        try{
            const medicine = await Medicine.findByIdAndUpdate(
                req.params.id,
                req.body,
                { new: true, runValidators: true }
            );
            if(!medicine){
                return res.status(404).json({
                success : false ,
                message: "Medicine not found"
                });
            }
            else{
                res.status(200).json({
                    success : true ,
                    data : medicine
                });
            }

        }
        catch(err){
            res.status(500).json({
                success : false ,
                message : 'server error' ,
                err : err.message
            });

        }
    }
)

router.delete('/:id' , 
    [
        param('id').isMongoId().withMessage('Invalid ID format')
    ],
    handleValidation,
    async (req , res)=>{
        try{
            const deleteMedicine = await Medicine.findByIdAndDelete(req.params.id);
            if(!deleteMedicine){
                return res.status(404).json({
                    success : false ,
                    message : "Medicine not found"
                });
            }
            res.status(200).json({
                success : true ,
                data : deleteMedicine
            });

        }
        catch(err){
            res.status(500).json({
                success : false , 
                message : 'server error' ,
                err : err.message
            });

        }
    }
);

module.exports = router;