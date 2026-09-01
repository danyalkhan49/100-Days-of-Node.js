const http = require('http');
const server = http.createServer((req , res)=>{
    if(req.url ==='/'){
        res.end("Welcome to my server homepage!");
    }
    else if(req.url === '/about'){
        res.end("This is the about page. My name is Danyal.");
    }
    else if(req.url === '/contact'){
        res.end("Contact me at: daniyalkhaniii49gmail@.com");
    }
    else {
        res.end("404 - Page not found");
    }

});

server.listen(4000,()=>{
    console.log("Server running on http://localhost:4000");
})