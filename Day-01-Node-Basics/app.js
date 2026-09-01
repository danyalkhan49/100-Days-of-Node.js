// console.log("Hello Node.js");
// console.log("Name: Danial Khan");
// console.log("Course: Software Engineering");
// console.log("Date " + new Date());

// console.log("typeof window:", typeof window);
// console.log("typeof document:", typeof document);
// console.log("typeof process:", typeof process);

// console.log("Trying to access window directly...");
// try {
//   console.log("window value:", window);
// } catch (error) {
//   console.log("window access error:", error.message);
// }

// console.log("Trying to access document directly...");
// try {
//   console.log("document value:", document);
// } catch (error) {
//   console.log("document access error:", error.message);
// }

// console.log("Accessing process...");
// console.log("process version:", process.version);
// console.log("process platform:", process.platform);

// console.log("Difference summary:");
// console.log("In Node.js, window and document are not available, but process is available.");
// console.log("In a browser, window and document are available, and process is usually not the same Node.js process object.");


// console.log("Start");
// setTimeout(() => {
//   console.log("After 2 seconds");
// }, 2000);
// console.log("End");


// console.log("Program Started");

// for (let i = 1; i <= 3; i++) {
//     setTimeout(() => {
//         console.log(`After ${i} Second`);
//     }, i * 1000);
// }
// console.log("Program finished");


// const process = require('process');
// console.log("Node version: " , process.version);
// console.log("Node platform: " , process.platform);
// console.log("Node Architecture: " , process.arch);
// console.log("Process ID: " , process.pid);
// console.log("Current Directory: " , process.cwd());


// const process = require('process');
// const args = process.argv.slice(2);
// const name = args[0] || '';
// const age = args[1] || '';

// console.log('Name: ' + name);
// console.log('Age: ' + age);
// console.log('Concept: process.argv');


// console.log("Create buffer");
// const message = 'Hello World';
// const buffer = Buffer.from(message, 'utf8');
// console.log('Buffer:', buffer);
// const converted = buffer.toString('utf8');
// console.log('Converted String:', converted);

// const path = require('path');
// const os = require('os');
// console.log(__dirname);
// console.log(__filename);

// const filepath = path.join("Project", "Node", "data", "users.txt");
// console.log("File Path is:", filepath);
// console.log("Directory name:", path.dirname(filepath));
// console.log("Base name:", path.basename(filepath));
// console.log("Extension:", path.extname(filepath));
// console.log("File name:", path.basename(filepath, path.extname(filepath)));

// console.log("Platform: " , os.platform());
// console.log("Architecture: " , os.arch());
// console.log("CPU Count: " , os.cpus().length);
// console.log("Free memory: " , os.freemem());
// console.log("Total Memory: " , os.totalmem());
// console.log("Hostname: " , os.hostname());
// console.log("Home Directory: " , os.homedir());



// const EventEmitter = require ("events");
// const emitter = new EventEmitter();

// // emitter.on("login", () => {
// //   console.log("User Logged In");
// // });

// // emitter.emit("login");




// const loginListener = () => {
//     console.log("The user is login in to the system ");
// };

// const logoutListener = () => {
//     console.log("The user is logout from the system");
// };

// function purchaseListener() {
//     console.log("The user can purchase products");
// }


// emitter.on("login", loginListener);
// emitter.on("logout", logoutListener);
// emitter.on("purchase", purchaseListener);

// emitter.emit("login");
// emitter.emit("logout");
// emitter.emit("purchase");

// emitter.removeListener("logout", logoutListener);
// console.log("removed successfully");


const express = require("express");
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  next();
});

app.get("/", (req, res) => {
  console.log("Request method:", req.method);
  res.send("Welcome to the code of daniel khan");
});

app.post("/", (req, res) => {
  console.log("Request method:", req.method);
  res.send("POST request received");
});

app.get("/about", (req, res) => {
  console.log("Request method:", req.method);
  res.send("About Page");
});

app.get("/contact", (req, res) => {
  console.log("Request method:", req.method);
  res.send("Contact page");
});

app.get("/users", (req, res) => {
  console.log("Request method:", req.method);
  res.send("Users page");
});

app.get("/products", (req, res) => {
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const url = new URL(fullUrl);
  const pathname = url.pathname;
  const id = url.searchParams.get("id");
  const name = url.searchParams.get("name");

  console.log("pathname:", pathname);
  console.log("id:", id);
  console.log("name:", name);

  res.send(`pathname: ${pathname}\nid: ${id}\nname: ${name}`);
});

app.get("/success", (req, res) => {
  console.log("Request method:", req.method);
  res.status(200).send("Success");
});

app.get("/notfound", (req, res) => {
  console.log("Request method:", req.method);
  res.status(404).send("Not Found");
});

app.get("/servererror", (req, res) => {
  console.log("Request method:", req.method);
  res.status(500).send("Server Error");
});

app.listen(3000, () => {
  console.log("Server listening on port 3000");
});