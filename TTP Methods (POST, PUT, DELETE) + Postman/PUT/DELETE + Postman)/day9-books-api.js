const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());   // zaroori hai req.body use karne ke liye

mongoose.connect('mongodb://127.0.0.1:27017/booksApiDB')
  .then(() => console.log('Connected to MongoDB!'))
  .catch((err) => console.log('Connection error:', err));

const bookSchema = new mongoose.Schema({
  title: String,
  author: String,
  available: { type: Boolean, default: true }
});

const Book = mongoose.model('Book', bookSchema);

app.get('/books', async (req, res) => {
  const books = await Book.find();
  res.status(200).json({ success: true, data: books });
});

app.use('/books' , async (req , res) =>{
    try{
        const newBook = new Book(req.body);
        const savedBook = await newBook.saved();
        res.status(201).json({
            success : true ,
            data : savedBook
        });

    }
    catch(err){
      res.status(500).json({
      success: false,
      message: error.message
    });

    }
});

app.put('/books/:id' , async (req , res) =>{
    try{
        const updateBook = await Book.findByIdAndUpdate(
            req.params.id ,
            req.body ,
            {
                new : true ,

            }

        );
        if(!updateBook){
            return res.status(404).json({
                success : false , 
                err : "Book is not found"
            });

        }




    }
    catch(err){
      res.status(500).json({
      success: false,
      error: error.message
    });

    }

});

app.delete('/books/:id' , async (req , res )=>{
    try{
        const deletedBook = await Book.findByIdAndDelete(req.params.id);
        if (!deletedBook) {
      return res.status(404).json({
        success: false,
        error: "Book not found"
      });
    }
    res.status(200).json({
      success: true,
      message: "Book deleted"
    });
}
    catch(err){
      res.status(500).json({
      success: false,
      error: error.message
    });

    }


});


app.listen(7500, () => {
  console.log('Server running on http://localhost:7500');
});