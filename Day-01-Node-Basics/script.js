// Question Number 1 Answer
let customer_name = "Danial";
const shop_name = "Dani_bytes";

// Question Number 2 Answer
const user = "dani";
const age = 18;
if (age >= 18) {
    console.log("User Allowed");
} else {
    console.log("User not Allowed");
}

// Question Number 3 Answer
for (let i = 1; i <= 10; i++) {
    if (i % 2 === 0) {
        console.log(i);
    }
}

// Question Number 4 Answer
function add(a, b) {
    return a + b;
}

const sum = add(5, 3);
console.log(sum);

// Question Number 5 Answer
const array = ["apple", "banana", "mango", "orange"];
console.log(array[3]);
console.log(array.length);


// Question Number 6 Answer
const student = {
    name: "Danial khan",
    age: 21,
    marks: 85
};
if (student.marks > 40) {
    console.log(student.name + " is Pass");
} else {
    console.log("The user is Fail");
}

// Question Number 7 Answer

let cart = [
    {name: "Shoes", price: 2000},
    {name: "Bag", price: 3000},
    {name: "Shirt", price: 1500}
];
function getTotal(){
    let total = 0;
    for(let i=0 ; i<cart.length ; i++){
        total += cart[i].price ;

    }
    return total ;
}
console.log(getTotal());




// Question Number 8 Answer

const numberList = [12,7,9,22,15,30,3];

function oddEven(){
    for(let i = 0 ; i < numberList.length ; i++){
        if(numberList[i] % 2 === 0){
            console.log(numberList[i] + " is even");
        } else {
            console.log(numberList[i] + " is odd");
        }
    }
}

oddEven();




// Question Number 9 Answer
const passwords = ["abc123", "pak1234", "xyz789"];
let userEnterPassword = ""; // replace with actual input
let userTry = 0; // number of attempts
if (passwords.includes(userEnterPassword)) {
    console.log("Login Successful");
} else {
    userTry++;
    if (userTry >= 3) {
        console.log("Account Locked");
    } else {
        console.log("Password does not match");
    }
}




// Question Number 10 Answer
let books = [
  { title: "JS Basics", author: "Ali", available: true },
  { title: "Python Guide", author: "Sara", available: false },
  { title: "Web Design", author: "Hamza", available: true },
  { title: "Data Science", author: "Zara", available: false }
];

function issueBook(bookTitle){
    for (let i = 0; i < books.length; i++) {
        if (books[i].title === bookTitle) {
            if (!books[i].available) {
                console.log("Book is not available: " + bookTitle);
                return;
            }
            books[i].available = false;
            console.log("The book is issued: " + bookTitle);
            return;
        }
    }
    console.log("Book not found");
}


// Question Number 11 Answer

let cart = [
  { name: "Laptop", price: 80000, quantity: 1 },
  { name: "Mouse", price: 1500, quantity: 2 },
  { name: "Keyboard", price: 3000, quantity: 1 }
];

function calculateBill(cart){
    let total = 0;
    let discount_Price = 0;
    let final_Bill = 0;
    
    for(let i = 0; i< cart.length ; i++){
        total += cart[i].price * cart[i].quantity
        console.log("sum of the product:" + total)
    }
    
    if(total > 50000){
       discount_Price = total * 10 / 100
       console.log("Discount: " + discount_Price)
    }
    
    final_Bill = total - discount_Price;
    console.log("Final Bill after discount is: " + final_Bill)
}


// Question Number 12 Answer
let students = [
  { name: "Bilal", attendance: [1, 1, 0, 1, 1, 1, 0] },
  { name: "Fatima", attendance: [1, 1, 1, 1, 1, 1, 1] },
  { name: "Usman", attendance: [0, 0, 1, 0, 1, 0, 0] }
];

function checkAttendance(students) {
    for (let i = 0; i < students.length; i++) {
        let totalPresent = 0;
        let attendance = students[i].attendance;
        for (let j = 0; j < attendance.length; j++) {
            if (attendance[j] === 1) {
                totalPresent++;
            }
        }
        console.log(students[i].name + " present days: " + totalPresent);
    }
}

checkAttendance(students);



// Question Number 13 Answer

let accounts = [
  { accountNo: 101, name: "Ahmed", balance: 5000 },
  { accountNo: 102, name: "Sana", balance: 2000 },
  { accountNo: 103, name: "Kamran", balance: 10000 }
];

function withdraw(accountNo, amount){
    for (let i = 0; i < accounts.length; i++) {
        if (accounts[i].accountNo === accountNo) {
            let balance = accounts[i].balance;
            if (amount <= balance) {
                accounts[i].balance = balance - amount;
                console.log("Withdrawal Successful");
                console.log("Withdraw Amount: " + amount);
                console.log("Updated balance is: " + accounts[i].balance);
            } else {
                console.log("Insufficient balance");
            }
            return;
        }
    }
    console.log("Account not found");
}

function deposit(accountNo, amount){
    for (let i = 0; i < accounts.length; i++) {
        if (accounts[i].accountNo === accountNo) {
            accounts[i].balance += amount;
            console.log("Deposit Successful");
            console.log("Deposit Amount: " + amount);
            console.log("Updated balance is: " + accounts[i].balance);
            return;
        }
    }
    console.log("Account not found");
}


// Question Number 14 Answer
let bookings = [
  { customer: "Ali", seatsRequested: 5 },
  { customer: "Zara", seatsRequested: 20 },
  { customer: "Hamza", seatsRequested: 30 }
];

function bookSeats(bookings){
    let availableSeats = 50;
    let bookingSeat = 0;
    for (let i = 0; i < bookings.length; i++) {
        let requestedSeats = bookings[i].seatsRequested;
        if (requestedSeats <= availableSeats) {
            availableSeats -= requestedSeats;
            console.log("Booking successful for " + bookings[i].customer + ": " + requestedSeats + " seats");
        } else {
            console.log("Booking failed for " + bookings[i].customer + ": not enough seats");
        }
    }

}


// Question Number 15 Answer
let students = [
  { name: "Bilal", marks: { math: 85, science: 78, english: 92 } },
  { name: "Sara", marks: { math: 45, science: 38, english: 55 } },
  { name: "Usman", marks: { math: 90, science: 88, english: 85 } }
];

 function calculateGrade(students){
    for (let i = 0; i < students.length; i++) {
        let average = (students[i].marks.math + students[i].marks.science + students[i].marks.english) / 3;
        let grade;

        if (average >= 80) {
            grade = "Grade A";
        } else if (average >= 60) {
            grade = "Grade B";
        } else if (average >= 40) {
            grade = "Grade C";
        } else {
            grade = "Grade F";
        }

        console.log(students[i].name + "'s average is " + average.toFixed(2) + ": " + grade);
    }
 }




// Question Number 15 Answer

 function getUserData() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      let success = true; // ya false kar ke test karo
      if (success) {
        resolve({ name: "Ahmed", age: 25 });
      } else {
        reject("Error: User not found");
      }
    }, 2000);
  });
}

async function fetchUser() {
  try {
    const user = await getUserData();
    console.log(`User Found: ${user.name}, Age: ${user.age}`);
  } catch (error) {
    console.log(`Error occurred: ${error}`);
  }
}


