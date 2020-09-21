# Allserver

Node.js opinionated RPC (Remote Procedure Call) server which aims to minimise both server-side and client-side code.

Multi protocol (only HTTP and gRPC for now) - same client and server side code works for any data protocol out there (HTTP, gRPC, WebSockets, in-memory, etc).

## Why Allserver exists?

There are loads of developer video presentations where people rant about how things are complex and how we must do extra effort to simplify things. Allserver is about simplicity and developer experience.

Problems I had:

- The HTTP status codes were never enough as error explanation. I always had to analise - firstly the status code, then detect the response body content type (text or json), then analyse the actual error. I got very much annoyed by this repetitive boilerplate code.
- Server side HTTP routing via slash `/` is not simple enough. What this route is for `/user`? You need to read the docs! I want it to be as simple and clear as calling a JS function/method.
- HTTP methods are a pain point of any REST API. Is it POST or PUT or PATCH? Should it be DELETE or POST when I remove a permission to a file from a user? I know it should be POST, but it's confusing to call POST when I need to do REMOVE. Protocol-level methods are never enough.
- The GraphQL is not a good fit for microservices, - adds much complexity, performance unfriendly (slow).
- When performance scaling was needed I had to rewrite an entire service and client codes to more performant network protocol implementation. This was a significant and avoidable time waste in my opinion.
- HTTP monitoring tools were alarming errors when I was trying to check if user with email `bla@example.com` exists (REST reply HTTP 404). Whereas, I don't want that alarm. That's not an error. I want to monitor only the "route not found" errors.

I wanted something which:

- Does not throw exceptions client-side when server-side throws. I got tired of `try-catch`-ing everything.
- Can be easily mapped to any language, any protocol. Especially to GraphQL mutations.
- Is simple to read in code, just like a method/function call. Without thinking of protocol-level details for every damn call.
- Allows me to test gRPC server from my browser/Postman/curl (via HTTP!) by a simple one line config change.
- Does not bring tons of npm dependencies with it.

Ideas are taken from multiple places.

- [slack.com HTTP RPC API](https://api.slack.com/web) - always return object of a same shape.
- [GoLang error handling](https://blog.golang.org/error-handling-and-go) - always return two things from a function call - the result and the error.

Also, the main driving force was my vast experience splitting monolith servers onto (micro)services. Here is how I do it with much success.

- Firstly, I select and refactor a number of functions to return object of the shape `{success,code,message,...}` and to never throw.
- Then, I move these functions over to a microservice.
- Done.

## Core principles

1. **Switching between data protocols must be as easy as changing single config value**
   - Common example is when you want to convert your (micro)service from HTTP to gRPC.
   - Or if you want to call the gRPC server you are developing but don't have the gRPC client, so you use [Postman](https://www.postman.com/downloads/), `curl` or a browser (HTTP) for that.
1. **Protocol-level things must NOT be used for business-level logic (i.e. no REST)**
   - This makes your (micro)service protocol agnostic.
   - The HTTP status codes must be used for protocol-level errors only.
     - `404` only if route not found. Never else.
     - `400` only if request structure is malformed. Never else.
     - `401`/`403` if bad auth.
     - the `200` status code will **always** be returned if the route was found, including unexpected exceptions.
   - gRPC and other protocols should expect the server to reply protocol-level errors if procedure was not found, or the data is malformed. Otherwise, returns the object of the same shape otherwise.
1. **Procedures (aka routes, aka methods, aka handlers) must always return same shaped interface regardless of everything**
   - HTTP server must always return `{success:Boolean, code:String, message:String}`.
   - Same for gRPC - `message Reply { bool success = 1; string code = 2; string message = 3; }`.
   - Same for other protocols.
1. **Calling procedures client side must be as easy as regular function call**
   - `const { success, user } = await updateUser({ id: 622, firstName: "Hui" })`
1. **All procedures must accept single argument - JavaScript options object**
1. **Procedures introspection (aka programmatic discovery) should work out of the box**
   - TODO: not sure about that one as yet.

## Usage

### HTTP protocol

The default `HttpTransport` is using the [`micro`](http://npmjs.com/package/micro) npm module.

```shell script
npm i allserver micro
```

### gRPC protocol

The default `GrpcTransport` is using the standard the [`@grpc/grpc-js`](https://www.npmjs.com/package/@grpc/grpc-js) npm module.

```shell script
npm i allserver @grpc/grpc-js @grpc/proto-loader
```

Note, with gRPC server and client you'd need to have your own `.proto` file and load it using the [`@grpc/proto-loader`](https://www.npmjs.com/package/@grpc/proto-loader). See code example below.

## Code examples

### Procedures (aka routes, aka schema, aka handlers)

These are you business logic functions. They are exactly the same for all the network protocols out there. They wouldn't need to change if you suddenly need to move them to another (micro)service or expose via a GraphQL API.

```js
const procedures = {
  async updateUser({ id, firstName, lastName }) {
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
```

### HTTP server side

```js
const { Allserver } = require("allserver");
Allserver({ procedures }).start();
```

The above code starts a HTTP server on port `process.env.PORT` if no transport was specified.

Here is the same server but more explicit:

```js
const { Allserver, HttpTransport } = require("allserver");
Allserver({
  procedures,
  transport: HttpTransport({ port: process.env.PORT }),
}).start();
```

### HTTP client side

It's a regular HTTP `POST` call with JSON request and response. URI is `/updateUser`.

```js
import axios from "axios";

const firstName = "Fred";
const lastName = "Flinstone";

const response = await axios.post("updateUser", {
  id: "123412341234123412341234",
  firstName,
  lastName,
});
const { success, code, message, user } = response.data;

if (success) {
  if (code === "NO_CHANGES") {
    console.log("User name was already:", firstName, lastName);
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

Alternatively, you can call the same API using `GET` request with search params (query): `http://example.com/updateUser?id=123412341234123412341234&firstName=Fred&lastName=Flinstone`

```js
const response = await axios.get("updateUser", {
  params: {
    id: "123412341234123412341234",
    firstName,
    lastName,
  },
});
```

### gRPC server side

Note that we are reusing the `procedures` from the HTTP example above.

Make sure all the methods in your `.proto` file reply al least three properties: success, code, message. Otherwise, the server won't start and throw an error.

```js
const packageDefinition = require("@grpc/proto-loader").loadSync(
  __dirname + "/allserver_example.proto"
);

const { Allserver, GrpcTransport } = require("allserver");

Allserver({
  procedures,
  transport: GrpcTransport({ packageDefinition }),
}).start();
```

### gRPC client side

Note, that `packageDefinition` should be created same way as we did for the server side above.

```js
const grpc = require("@grpc/grpc-js");
const proto = grpc.loadPackageDefinition(packageDefinition).allserver_example;
var client = new proto.MyService(
  "localhost:4000",
  grpc.credentials.createInsecure()
);

// Promisifying because official gRPC modules do not support Promises async/await.
const { promisify } = require("util");
for (const k in client)
  if (typeof client[k] === "function")
    client[k] = promisify(client[k].bind(client));

const data = await client.updateUser({
  id: "123412341234123412341234",
  firstName,
  lastName,
});

const { success, code, message, user } = data;
```

## FAQ

### What happens if a procedure does not exist?

You'll get protocol-level "not found" error reply.

### What happens if a procedure throws?

You'll get a normal reply, but the `status` field will be `false`.

```json
{
  "success": false,
  "code": "PROCEDURE_ERROR",
  "message": "..."
}
```

Also, server would dump the full stack trace to the stderr using its `logger` property (defaults to `console`).

### Can I add a middleware?

You can add only **one** pre-middleware, but also **one** post-middleware.
