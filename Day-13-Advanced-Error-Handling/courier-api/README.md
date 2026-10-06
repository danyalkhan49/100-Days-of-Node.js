 # Day 13: Advanced Error Handling

🚀 **Day 13 of My Node.js Learning Journey!**

Today's practice: building a **Wallet Balance API**, using a proper reusable error-handling pattern with **AppError** and **catchAsync**. Here's what I learned — and more importantly, *why* it matters:

🔹 **Why this pattern exists** — Up until now, every risky route needed its own try/catch block to avoid crashing. That's repetitive and easy to forget. Instead:
- **AppError** is a custom error class that carries a message *and* a status code together, so any error can describe exactly what went wrong and what HTTP status it deserves.
- **catchAsync** is a wrapper function that automatically catches errors inside `async` routes and forwards them to the error handler — no manual try/catch needed in every single route.

```js
app.post('/wallet/withdraw', catchAsync(async (req, res) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    throw new AppError("Amount must be greater than 0", 400);
  }
  if (amount > wallet.balance) {
    throw new AppError("Insufficient balance", 400);
  }

  wallet.balance -= amount;
  res.status(200).json({ success: true, message: "Withdrawal successful", data: wallet });
}));
```

🔹 **The real benefit** — Business rules like "amount must be positive" or "can't withdraw more than the balance" are expressed as simple `throw` statements. No nested if/else for error responses, no repeated `res.status(400).json(...)` scattered everywhere. The global error-handling middleware catches everything in one place:

```js
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({ success: false, error: err.message || "Something went wrong!" });
});
```

🔹 **Why this scales** — As an API grows to dozens of routes, this pattern keeps error handling **consistent**, **centralized**, and **DRY** (no repeated code). It's exactly the kind of structure real production codebases use — and honestly, once you see it, going back to scattered try/catch blocks feels painful.

Tested deposit/withdraw with valid amounts, negative amounts, and over-withdrawals — all handled cleanly through the same reusable pattern. 💻🔥