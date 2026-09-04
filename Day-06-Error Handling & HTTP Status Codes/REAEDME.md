# 🚀 Day 6 of My Node.js Learning Journey

 Today's topic: Error Handling & HTTP Status Codes — something every real-world API absolutely needs to get right. Here's what I learned:

🔹 Why status codes matter — Just sending a text message back isn't enough. Frontend apps rely on status codes to instantly know if a request succeeded or failed, without parsing the whole response.

🔹 Common status codes:
200 OK — everything worked

201 Created — a new resource was successfully created

400 Bad Request — client sent invalid/missing data

401 Unauthorized — not logged in

403 Forbidden — logged in, but no permission

404 Not Found — resource doesn't exist

500 Internal Server Error — something broke on the server

res.status(404).send('Book not found')

🔹 try/catch for risky code — Wrapping code that might fail (like JSON.parse) in a try/catch block prevents the entire server from crashing:

try {   const data = JSON.parse(req.query.data);   res.json(data); } catch (error) {   res.status(400).json({ error: 'Invalid JSON provided' }); }

🔹 Express's special error-handling middleware — Recognized by its 4 parameters (err first), and always placed at the very end of all routes:

app.use((err, req, res, next) => {   console.error(err.stack);   res.status(500).json({ error: 'Something went wrong on our end!' }); });

🔹 Consistent response format — Learned the value of keeping a predictable structure for success and error responses:

res.status(200).json({ success: true, data: {...} }); res.status(400).json({ success: false, error: "Invalid quantity" });
