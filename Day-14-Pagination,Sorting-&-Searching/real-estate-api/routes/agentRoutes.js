const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const Agent = require('../models/Agent');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
}

router.post('/' ,
    [
        body('name').notEmpty().withMessage('Name must be required'),
        body('number').notEmpty().withMessage('Phone must be required')
    ],
    handleValidation,
    catchAsync (async (req , res)=>{
        const agent = new Agent(req.body);
        const saveAgent = await agent.save();
        res.status(201).json({
            success : true ,
            data : saveAgent
        });
    })
)

router.get('/' , catchAsync (async (req , res)=>{
    const getAllAgent = await Agent.find();
    if (!getAllAgent || getAllAgent.length === 0) {
        throw new AppError('No agents found', 404);
    }

    res.status(200).json({
        success: true,
        data: getAllAgent
    });
}))

router.get('/:id' ,
    [
        param('id').isMongoId().withMessage('id must be required')
    ],
    handleValidation,
    catchAsync(async (req , res)=>{
        const findId = Agent.find(req.params.id);
        if(!findId){
            throw new AppError(
            'Agent not Found',
            404
            )
        }
        res.status(200).json({
            success : true ,
            data : findId
        });
}));

module.exports = router ;
