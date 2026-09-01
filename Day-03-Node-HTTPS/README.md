
# Day 3: Building My First HTTP Server in Node.js

Today I built my first HTTP server with Node.js, and it felt like a real milestone in my backend learning journey. I finally understood how a browser and a server communicate.

## What I learned

1. What is a server?
A server is a program that listens for requests from clients, such as a browser, and sends back a response. In simple terms, when you visit a website, your browser sends a request to a server, and the server returns HTML, JSON, or other data.

2. Node's built-in `http` module
Node.js makes it easy to create a web server without installing any extra packages.

```js
const http = require('http');

const server = http.createServer((req, res) => {
  res.end('Hello from my server!');
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

This creates a server that listens on port `3000` and responds with the message `Hello from my server!`.

 3.Understanding `req` and `res`

- `req` stands for request.It contains information from the client, such as the URL, HTTP method, headers,and sometimes data.
- `res` stands for response. It is the server's way of sending information back to the client.

 4.Ports
A port is like a door number for a server. If the server is listening on `3000`, then the browser connects to:

```txt
http://localhost:3000
```

5.Basic routing with `req.url`
Using `req.url`, I was able to serve different content depending on the page the user requested.

```js
if (req.url === '/') {
  res.end('Home Page');
} else if (req.url === '/about') {
  res.end('About Page');
} else {
  res.end('404 - Page not found');
}
```

This was my first introduction to routing, and it made the idea of handling different pages much clearer.

Final thoughts
Seeing my own server respond in the browser for the very first time was an amazing feeling. It made backend development feel much more real and exciting.
