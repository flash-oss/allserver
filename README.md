# Allserver

Node.js opinionated RPC (Remote Procedure Call) server which aims to minimise both server and client-side code.

Multi protocol (only HTTP and gRPC for now) - same client and server side code works for any data protocol out there (HTTP, gRPC, WebSockets, in-memory, etc).

## Core principles

1. **Switching between data protocols must be as easy as changing single config value**
   - Common example is when you want to convert your (micro)service from HTTP to gRPC.
   - Or if you want to call the gRPC server you are developing but don't have the gRPC client, so you use `curl` or a browser (HTTP) for that.
1. **Protocol-level things must NOT be used for business-level logic (i.e. no REST)**
   - This makes your (micro)service protocol agnostic.
   - The HTTP status codes must be used for protocol-level errors only.
     - `404` only if route not found. Never else.
     - `400` only if request is malformed. Never else.
     - `401`/`403` if bad auth.
     - etc.
     - if route was found the `200` status code will **always** be returned, including unexpected exceptions.
   - gRPC and other protocols should expect the server to "throw" if procedure was not found, or the data is malformed. Otherwise, returns the object of the same shape.
1. **Server must always return same shaped interface regardless of everything**
   - HTTP server must always return `{success:Boolean, code:String, message:String}`.
   - Same for gRPC and other protocols.
1. **Calling procedures client side must be as easy as regular function call**
1. **All procedures must accept single argument - JavaScript options object**
1. **Procedures introspection (aka programmatic discovery) should work out of the box**

## Code examples

Server side code example:

```js
const procedures = {
  user: {
    async update({ id, firstName, lastName }) {
      const db = await require("my-database").db("users");

      const user = await db.find({ id });
      if (!user) {
        return {
          success: false,
          code: "USER_ID_NOT_FOUND",
          message: `User ID ${id} not found`,
        };
      }
      if (user.isReadOnly()) {
        return {
          success: false,
          code: "USER_IS_READONLY",
          message: `User ${id} can't be modified`,
        };
      }
      if (user.firstName === firstName && user.lastName === lastName) {
        return {
          success: true, // NOTE! We return TRUE here,
          code: "NO_CHANGES", // but we also tell the client side code that nothing was changed.
          message: `User ${id} already have that data`,
        };
      }

      await user.update({ firstName, lastName });
      return { success: true, code: "UPDATED", user };
    },
  },

  health() {}, // will return `{"success":true,"code":"SUCCESS","message":"Success"}`

  async reconnectDb() {
    const myDb = require("my-database");
    const now = Date.now(); // milliseconds
    await myDb.diconnect();
    await myDb.connect();
    const took = Date.now() - now;
    return took; // will return `{"reconnectDb":25,"success":true,"code":"SUCCESS","message":"Success"}`
  },
};

const Allserver = require("Allserver");
Allserver({ procedures }).start();
```

The above starts a HTTP server on port `process.env.PORT` if no network protocol specified.

Client side:

```js
import axios from "axios";

const firstName = "Fred";
const lastName = "Flinstone";

const { success, code, message, user } = await axios.post("user.update", {
  id: "123412341234123412341234",
  firstName,
  lastName,
});

if (success) {
  if (code === "NO_CHANGES") {
    console.log("User name was already", firstName, lastName);
  } else {
    console.log("User name was updated");
  }
} else {
  if (code === "USER_IS_READONLY") {
    console.error("You can't edit this user");
  } else {
    console.error("Unexpected error.", code, message);
  }
}
```

### What happens if a procedure does not exist?

You'll get this: `{"success":false,"code":"NOT_FOUND","message":"Procedure NAME not found"}` 

### What happens if a procedure throws?

You'll get this: `{"success":false,"code":"PROCEDURE_ERROR","message":...}`
And the full stack trace in the console (stderr).

### Can I add a middleware?

You can add only one pre-middleware, but also one post-middleware.

# How did I end up with this idea of allserver?

There are loads of developer video presentations where people rant about how things are complex and how we must do extra effort to simplify things. I am all-in into development simplification.

Problems I had:

- The HTTP status codes were never enough as error explanation. I always had to analise - firstly the status code, then the response body. I got very much annoyed by this repetitive code.
- Server side HTTP routing via slash `/` is not simple enough. I want it to be as simple as calling a JS function/method.
- The GraphQL is not a good fit for microservices, - adds much complexity, performance unfriendly consistently replying quite slow, calling a GraphQL mutation is not trivial enough (yet).
- When performance scaling was needed I had to rewrite an entire service and client code to more performant network protocol implementation. This was a significant time waste at times.
- HTTP monitoring tools were alarming errors when I was trying to check if user exists (Rest reply HTTP 404), whereas I don't want that. That's not an error. I want to monitor only the "route not found" errors.

Ideas are taken from multiple places.

- [slack.com HTTP RPC API](https://api.slack.com/web) - always return object of the same shape.
- [GoLang error handling](https://blog.golang.org/error-handling-and-go) - always return two things from a function call - the result and the error.
- JavaScript - dynamic property access.
- [GraphQL introspection](https://graphql.org/learn/introspection/) - client side should be able to validate its query before calling the server.

Also, the main driving force was my vast experience splitting monolith servers onto (micro)services. Here is how I do it with much success.

- Firstly, I select and refactor a number of functions to return object of the shape `{success,code,message,...}` and to never throw.
- Then, I move these functions over to a microservice.
- Done.
