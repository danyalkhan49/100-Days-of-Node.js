
# 🚀 Day 4 of My Node.js Learning Journey

Today I leveled up from raw Node.js to using a framework — **Express.js**. Here's what I learned:

🔹 **Why Express?** — With the raw `http` module, adding more routes means more `if/else` chains, which gets messy fast. Express handles routing (and much more) in a clean, scalable way — which is why most real-world Node backends use it.

🔹 **Installing Express** — It's an external package, so it needs npm:

npm install express

🔹 **A basic Express server:**

```js
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Welcome to my server homepage!');
});

app.listen(4000, () => {
  console.log('Server running on http://localhost:4000');
});
```

🔹 **Clean, readable routes** — Instead of one big if/else block, every route gets its own function:

```js
app.get('/about', (req, res) => {
  res.send('About Page');
});
```

🔹 **Dynamic routes with parameters** — Learned how to capture values directly from the URL:

```js
app.get('/user/:name', (req, res) => {
  res.send(`Hello, ${req.params.name}!`);
});
```

Visiting `/user/Danyal` returns `"Hello, Danyal!"` — such a simple but powerful concept for building dynamic APIs.

The difference between raw `http` and Express is night and day. Excited to build more with this! 💻🔥

🔗 Full code series: [add your GitHub repo link here]
