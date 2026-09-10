# 🚀Day 8 of My Node.js Learning Journey

Today I covered **Update & Delete operations** with Mongoose — the "U" and "D" of CRUD. Here's what I learned:

🔹 **Why updates matter** — Data in real apps constantly changes — a grade gets updated, a book gets returned, a status flips. Mongoose gives you several clean ways to handle this.

🔹 **findOneAndUpdate()** — The most common way to update a document:

```js
const updatedStudent = await Student.findOneAndUpdate(
  { name: "Ali" },
  { grade: "A+" },
  { new: true } // without this, you get the OLD data back, not the updated one
);
```

🔹 **findByIdAndUpdate()** — Same idea, but when you already have the document's unique `_id`.

🔹 **updateMany()** — Update several documents at once based on a condition:

```js
await Student.updateMany({ grade: "C" }, { grade: "D" });
```

🔹 **Deleting documents** — `findOneAndDelete()`, `findByIdAndDelete()`, and `deleteMany()` for bulk deletes. ⚠️ Learned the hard way (in theory!) that `deleteMany({})` with an empty filter wipes out the **entire** collection — definitely a "measure twice, cut once" situation.

🔹 **More query operators** — Added `$lt`, `$gte`, `$lte`, `$ne`, and `$in` to my toolkit alongside `$gt`.

🔹 **A safety pattern worth remembering:**

```js
const student = await Student.findOneAndUpdate({ name: "XYZ" }, { grade: "A" }, { new: true });
if (!student) {
  console.log("Student not found!");
}
```

Mongoose returns `null` instead of crashing when nothing matches — so always check before assuming the update worked.

CRUD is finally starting to feel complete — Create, Read, Update, Delete, all connected to a real database now. 💻🔥

🔗 Full code series:https://github.com/danyalkhan49/100-Days-of-Node.js
