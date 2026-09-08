const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: String,
  author: String,
  available: {
    type: Boolean,
    default: true
  },
  addedOn: {
    type: Date,
    default: Date.now
  }
});

const Book = mongoose.model('Book', bookSchema);

async function addBook() {
  const newBook = new Book({
    title: 'The Alchemist',
    author: 'Paulo Celo'
  });

  await newBook.save();
  console.log('Book saved!');
}

async function main() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/myFirstDatabase');
    console.log('Connected to MongoDB!');
    await addBook();
  } catch (err) {
    console.log('Connection error:', err);
  }
}

main();