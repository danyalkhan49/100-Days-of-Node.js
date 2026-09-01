const express = require('express');
const app = express();
app.use(express.json());
const books = {
  B1: { title: 'Harry Potter', available: true },
  B2: { title: 'Atomic Habits', available: true },
  B3: { title: '1984', available: false }
};
const members = {
  M1: { name: 'Danyal', booksIssued: [], fine: 0 },
  M2: { name: 'Sara', booksIssued: [], fine: 0 }
};
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});
function checkMember(req, res, next) {
  const memberId = req.params.memberId;
  const member = members[memberId];

  if (!member) {
    return res.status(404).send('Member not found');
  }
  req.member = member;
  next();
}
function checkBook(req, res, next) {
  const bookId = req.params.bookId;
  const book = books[bookId];
  if (!book) {
    return res.status(404).send('Book not found');
  }
  req.book = book;
  next();
}
app.get('/book' , (req , res) =>{
    res.json(books);
})
app.get('/issue/:bookId/:memberId', checkBook, checkMember, (req, res) => {
    const { bookId, memberId } = req.params;
    const book = req.book;
    const member = req.member;

    if (book.available === false) {
        return res.send('Book already issued to someone else');
    }

    if (member.booksIssued.length >= 3) {
        return res.send('Cannot issue: member already has 3 books (limit reached)');
    }

    book.available = false;
    member.booksIssued.push({
        bookId,
        issueDate: new Date()
    });
    return res.send(`${book.title} issued to ${member.name}`);
});
app.get('/return/:bookId/:memberId', checkBook, checkMember, (req, res) => {
    const { bookId } = req.params;
    const book = req.book;
    const member = req.member;
    const issuedBookIndex = member.booksIssued.findIndex(item => item.bookId === bookId);
    if (issuedBookIndex === -1) {
        return res.send('This member did not issue this book');
    }
    const issuedBook = member.booksIssued[issuedBookIndex];
    const issueDate = new Date(issuedBook.issueDate);
    const today = new Date();
    const daysPassed = Math.ceil((today - issueDate) / (1000 * 60 * 60 * 24));

    let fine = 0;
    if (daysPassed > 7) {
        fine = (daysPassed - 7) * 10;
        member.fine += fine;
    }

    book.available = true;
    member.booksIssued.splice(issuedBookIndex, 1);

    if (fine === 0) {
        return res.send('Book returned. No fine.');
    }

    return res.send(`Book returned. Fine: Rs. ${fine}`);
});

app.get('/member/:memberId/status',checkMember , (req,res) =>{
    const member = req.member;

    res.json({
      name: member.name,
      booksIssued: member.booksIssued.map(issuedBook => ({
        bookId: issuedBook.bookId,
        title: books[issuedBook.bookId].title
      })),
      totalBooksIssued: member.booksIssued.length,
      fine: member.fine
    });
});


function checkAdmin(req, res, next) {
    if (req.query.key !== 'admin123') {
        return res.status(403).send('Access Denied');
    }

    next();
}
app.get('/admin/report', checkAdmin, (req, res) => {
    const totalBooks = Object.keys(books).length;
    const issuedBooks = Object.values(books).filter(book => !book.available).length;
    const availableBooks = totalBooks - issuedBooks;
    const totalFines = Object.values(members).reduce((sum, member) => sum + member.fine, 0);

    res.json({
        totalBooks,
        issuedBooks,
        availableBooks,
        totalFines
    });
});



const PORT = 8500;
app.listen(PORT , ()=>{
    console.log(`The code is running properly means good love u so much`)
})