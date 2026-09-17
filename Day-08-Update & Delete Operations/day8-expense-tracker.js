const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/day8-expenseTrackerDB')
  .then(() => console.log('Connected to MongoDB!'))
  .catch((err) => console.log('Connection Error', err));

const expenseSchema = new mongoose.Schema({
    title: String,
    amount: Number,
    category: String,
    createdAt: { type: Date, default: Date.now }
});

const Expense = mongoose.model('expense', expenseSchema);

async function addExpenses() {
    try {
        const expenses = [
            { title: 'Lunch', amount: 2000, category: 'Food' },
            { title: 'Fuel', amount: 4000, category: 'Transport' },
            { title: 'Dinner', amount: 2500, category: 'Food' },
            { title: 'Shoes', amount: 10000, category: 'Shopping' },
            { title: 'Train Ticket', amount: 5000, category: 'Transport' },
            { title: 'Groceries', amount: 2000, category: 'Shopping' }
        ];

        const result = await Expense.insertMany(expenses);
        console.log('Expenses added successfully');
        console.log(result);
    } catch (error) {
        console.error('Error adding expenses:', error.message);
    }
}

async function getExpensesByCategory(categoryName) {
    try {
        const categoryExpenses = await Expense.find({ category: categoryName });

        if (categoryExpenses.length === 0) {
            console.log(`No expenses found for category: ${categoryName}.`);
        } else {
            console.log('Category find successfully!');
            console.log(categoryExpenses);
        }
    } catch (error) {
        console.log('Invalid category', error.message);
    }
}

async function getExpensesAboveAmount(minAmount) {
    try {
        const aboveAmount = await Expense.find({ amount: { $gt: minAmount } });

        if (aboveAmount.length === 0) {
            console.log(`No expenses found above ${minAmount}.`);
        } else {
            console.log(`Expenses above ${minAmount}:`);
            console.log(aboveAmount);
        }
    } catch (error) {
        console.error('Error fetching expenses above amount:', error.message);
    }
}

async function updateExpenseAmount(expenseTitle, newAmount) {
    try {
        const updated = await Expense.findOneAndUpdate(
            { title: expenseTitle },
            { amount: newAmount },
            { new: true }
        );

        if (!updated) {
            console.log('Expense not found!');
        } else {
            console.log('Expense updated successfully:');
            console.log(updated);
        }
    } catch (error) {
        console.error('Error updating expense:', error.message);
    }
}

async function deleteExpense(expenseTitle) {
    try {
        const deleted = await Expense.findOneAndDelete({ title: expenseTitle });

        if (!deleted) {
            console.log('Expense not found, nothing deleted.');
        } else {
            console.log(`Deleted: ${deleted.title}`);
        }
    } catch (error) {
        console.error('Error deleting expense:', error.message);
    }
}

async function getTotalSpent() {
    try {
        const allExpenses = await Expense.find();
        const total = allExpenses.reduce((sum, expense) => sum + expense.amount, 0);

        console.log(`Total spent: Rs. ${total}`);
    } catch (error) {
        console.error('Error calculating total spent:', error.message);
    }
}

async function run() {
    await addExpenses();

    console.log('--- Food Expenses ---');
    await getExpensesByCategory('Food');

    console.log('--- Expenses above Rs. 500 ---');
    await getExpensesAboveAmount(500);

    console.log('--- Updating an expense ---');
    await updateExpenseAmount('Lunch', 999);

    console.log('--- Deleting an expense ---');
    await deleteExpense('Shoes');

    console.log('--- Total Spent ---');
    await getTotalSpent();
}

mongoose.connection.once('open', () => {
    run();
});