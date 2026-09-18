
# 🚀Day-9 of My Node.js Learning Journey
Today was all about building a proper Books API — using full CRUD with correct HTTP methods. Here's what I practiced:
🔹 POST — Adding a new book to the collection, with validation to make sure required fields (title, author) aren't missing:
app.post('/books', (req, res) => {
  if (!title || !author) {
    return res.status(400).json({ error: "Title and author are required" });
  }
  // ...create and return the new book
});
🔹 PUT — Updating an existing book by ID, only changing the fields that were actually sent:
app.put('/books/:id', (req, res) => {
  // find book, update only provided fields, return updated data
});
🔹 DELETE — Removing a book from the collection and confirming what was deleted:
app.delete('/books/:id', (req, res) => {
  // find and remove the book, return the deleted item
});
🔹 Testing with Postman/Thunder Client — A good reminder that POST/PUT/DELETE requests can't be tested directly in the browser like GET requests can. Using Postman to send proper request bodies made everything click.
This one really tied together everything from the past few days — routing, status codes, and now full CRUD with correct HTTP semantics. Starting to feel like a real API! 💻🔥

📌 Alongside daily practice, I've also been building real backend projects to apply these concepts:
🏋️ Gym Management Backend — [add a short one-line description]
📚 Books Management Backend — [add a short one-line description]
