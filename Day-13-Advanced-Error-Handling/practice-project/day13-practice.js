const express = require('express');
const app = express();
app.use(express.json());
const AppError = require('./AppError');
const catchAsync = require('./catchAsync');   

let wallet = { balance: 1000 };   

app.get('/wallet' , catchAsync (async(req , res)=>{
    res.status.json({success : true , data : wallet});
}));

app.post('/wallet/deposit' , catchAsync(async(req , res)=>{
    const depositAmount = Number(req.params.amount);
    if(!depositAmount || depositAmount <= 0){
        throw new AppError(
            "Amount must be greater than 0",
            404
        ) 
    }
    wallet.balance += depositAmount;
    res.status(200).json({
        success : true ,
        message : 'Deposit successful',
        data : wallet
    });
}));

app.post('/wallet/withdraw'  , catchAsync (async (req , res)=>{
    const withdrawAmount = Number(req.params.amount);
    if(!withdrawAmount || withdrawAmount <=0){
        throw new AppError(
            'Amount must be greater then 0' ,
            404
        );
    }
    else if(withdrawAmount > wallet.balance){
        throw new AppError(
            "Insufficient balance",
            400 
        );


    }
        wallet.balance -= withdrawAmount ;
        res.status(200).json({
            success : true ,
            message : 'withdrawal successful' ,
            data : wallet
        });
}));

app.use((err , req , res , next)=>{
    const statusCode = err.statusCode || 500 
    const message = err.message || 'Something went wrong on our end!'
    console.error(err.stack);
  res.status(statusCode).json({ success: false, error: message });
});

app.listen(4600, () => {
  console.log('Server running on http://localhost:4600');
  
});

