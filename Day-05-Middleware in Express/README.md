# 🚀 Day 5 of My Node.js Learning Journey

Today's topic was **Middleware** in Express — a concept that's used in almost every real-world backend. Here's what I learned:

🔹 **What is Middleware?** — Functions that run *between* the request and the final response. They're used to check things, process data, or log requests before a route sends anything back — like "gatekeepers" that sit in the middle.

🔹 **Basic structure:**

```js
app.use((req, res, next) => {
  console.log(`${req.method} request made to: ${req.url}`);
  next(); // essential! moves the request forward
});
```

🔹 **The `next()` trap** — Learned the hard way (well, in theory 😄) that forgetting to call `next()` leaves the request stuck forever — the browser just keeps loading. Classic beginner mistake to watch out for.

🔹 **`express.json()`** — A built-in middleware that parses incoming JSON data from the request body. Without it, `req.body` is just `undefined`:

```js
app.use(express.json());
```

🔹 **Route-specific middleware** — Middleware doesn't have to run on every route. It can be attached to just one:

```js
app.get('/vote/:age', checkAge, (req, res) => {
  res.send('You can vote!');
});
```

Middleware really clicked for me today — it's basically how Express handles logging, authentication, validation, and so much more under the hood. 💻🔥
