
# 🚀 Day 2 of My Node.js Learning Journey

Today's focus was on one of the most important concepts in Node.js — Modules. Here's what I learned:

🔹 Why Modules? — As projects grow, keeping everything in one file becomes messy and hard to manage. Breaking code into smaller, focused files (modules) makes it easier to read, maintain, and collaborate on.

🔹 module.exports — Learned how to "export" a function, variable, or object from one file so it can be used in another:

```js
function add(a, b) {
  return a + b;
}
module.exports = add;
```

🔹 require() — This is how you "import" whatever was exported from another file:

```js
const add = require('./math.js');
console.log(add(2, 3)); // 5
```

🔹 Exporting multiple things — When a file needs to share more than one function/variable, wrapping them in an object does the job:

```js
module.exports = { add, subtract };
```

Small concept, but it's the foundation of how real Node.js apps are structured. Loving the process of breaking things down and understanding *why* things work, not just *how*. 💻
