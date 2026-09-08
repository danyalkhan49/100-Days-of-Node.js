🚀 Day 7 of My Node.js Learning Journey!

A full week in, and today was a big one — I connected my first Node.js app to a real database. Here's what I learned:

🔹 Why databases? — Until now, all my data was living only in RAM. Restart the server, and everything's gone. Real apps need data that survives restarts, crashes, and scale — that's what a database is for.

🔹 MongoDB — A NoSQL database that stores data as documents (JSON-like), instead of tables and rows. It pairs naturally with JavaScript since JS objects already look like JSON.

🔹 Mongoose — A library that sits on top of MongoDB and makes working with it much easier, letting you define the exact shape of your data using a Schema.

🔹 Connecting to the database:
const mongoose = require('mongoose');  mongoose.connect('mongodb://127.0.0.1:27017/myFirstDatabase')   .then(() => console.log('Connected to MongoDB!'))   .catch((err) => console.log('Connection error:', err)); 

🔹 Schema & Model:
const bookSchema = new mongoose.Schema({   title: String,   author: String,   available: { type: Boolean, default: true } });  const Book = mongoose.model('Book', bookSchema); 

 

🔹 Saving real data — Used async/await for the first time to save a document to the database:

 

const newBook = new Book({ title: "The Alchemist", author: "Paulo Coelho" }); await newBook.save(); 

Verified it worked by checking mongosh directly — and there it was, sitting permanently in the database. That "it's actually saved!" moment hit different. 💻🔥

This is where things start feeling like real backend development. Excited for more CRUD operations next!