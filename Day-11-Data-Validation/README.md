🚀 **Day 11 of My Node.js Learning Journey!**

Starting a new arc — after completing my Restaurant Management System project, I'm now going deeper (Day 11-20) into concepts that make an API truly production-ready. Today's topic: **Data Validation**. Here's what I learned:

🔹 **The problem** — Without validation, anything a client sends gets saved straight to the database — empty names, negative prices, wrong data types. That's how corrupt data quietly breaks an app down the line.

🔹 **Manual validation** — Understood the concept first by writing checks by hand:

```js
if (typeof price !== 'number' || price <= 0) {
  return res.status(400).json({ error: "Price must be a positive number" });
}
```

Useful for understanding *why* validation matters, but repetitive across every route.

🔹 **express-validator** — The industry-standard way to handle this cleanly:

```js
body('name').notEmpty().withMessage('Name is required'),
body('price').isFloat({ min: 1 }).withMessage('Price must be a positive number'),
body('category').isIn(['Starter', 'Main Course', 'Dessert', 'Beverage'])
```

🔹 **Useful validators** — `isEmail()`, `isInt({ min, max })`, `isLength({ min })`, `isMobilePhone()`, and especially `isMongoId()` — which prevents a route from crashing when someone passes a badly-formatted ID.

🔹 **Turning validation into reusable middleware** — Instead of repeating `validationResult(req)` in every route, wrapped it into one clean function:

```js
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
}
```

Applied this directly to my Restaurant API's menu routes — the difference in reliability is huge. This is exactly the kind of detail that separates a working demo from a real, trustworthy API. 💻🔥
