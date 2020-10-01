# Allserver

Multi-transport and multi-protocol simple RPC server and (optional) client. Boilerplate-less. Opinionated. Minimalistic.

Think HTTP, gRPC, GraphQL, WebSockets, Lambda, inter-process, unix sockets, etc Remote Procedure Calls using exactly the same client and server code.

Should be used in (micro)services where NodeJS is able to run - your computer, Docker, k8s, virtual machines, serverless functions (Lambdas, Google Cloud Functions, Azure Functions, etc), RaspberryPI, you name it.

Superpowers the Allserver gives you:

- Call gRPC server methods from browser/curl/Postman.
- Convert your HTTP server to gRPC with a single line change.
- Call any transport/protocol server methods with exactly the same client-side code.
- Stop writing `try-catch` when calling a remote procedure.
- And moar!

### Quick example

This is how your code would look like in all execution environments using any communication protocol out there.

Server side:

```js
const procedures = {
  sayHello: ({ name }) => "Hello " + name,
};
require("allserver").Allserver({ procedures }).start();
```

Client side:

```js
const AllserverClient = require("allserver/Client");
const client = AllserverClient({ uri: process.env.REMOTE_SERVER_URI });

const { success, code, sayHello } = await client.sayHello({ name: "Joe" });

if (success) {
  // "Hello Joe"
  console.log(sayHello);
} else {
  // something like "ALLSERVER_PROCEDURE_UNREACHABLE"
  console.error(code);
}
```

Or use your own client library, e.g. `fetch` for HTTP or `@grpc/grpc-js` for gRPC.

## Why Allserver exists?

There are loads of developer video presentations where people rant about how things are complex and how we must do extra effort to simplify things. Allserver is about simplicity and developer experience.

Problems I had:

- **Error handling while calling remote procedures are exhausting.**
  - Firstly, I wrap the HTTP call in a `try-catch`. Then, I always had to analise: the status code, then detect the response body content type - text or json, then analyse the body for the actual error. I got very much annoyed by this repetitive boilerplate code.
- **REST route naming is not clear enough.**
  - What is this route for - `/user`? You need to read the docs! I want it to be as simple and clear as calling a JS function/method - `createUser()`, or `updateUser()`, or `getUser()`, or `removeUser()`, or `findUsers()`, etc.
- **The HTTP methods are a pain point of any REST API.**
  - Is it `POST` or `PUT` or `PATCH`? What if a route removes a permission to a file from a user, should it be `DELETE` or `POST`? I know it should be `POST`, but it's confusing to call `POST` when I need to REMOVE something. Protocol-level methods are never enough.
- **The HTTP status codes are never enough and overly confusing.**
  - If a `user` record in the database is readonly, and you are trying to modify it, a typical server would reply `400 Bad Request`. However, the request is perfectly fine. It's the user state (data) is not fine.
- **The GraphQL has great DX and tooling, but it's not a good fit for microservices.**
  - It adds too much complexity and is performance unfriendly (slow).
- **Performance scaling**
  - When a performance scaling was needed I had to rewrite an entire service and client source code in multiple projects to a more performant network protocol implementation. This was a significant and avoidable time waste in my opinion.
- **HTTP monitoring tools show business errors as alarms.**
  - I was trying to check if a user with email `bla@example.com` exists. REST reply is HTTP `404`. Whereas, I don't want that alarm. That's not an error, but a regular true/false check. I want to monitor only the "route not found" errors with ease.

When calling a remote procedure I want something which:

- Does not throw exceptions client-side no matter what.
- Can be easily mapped to any language, any protocol. Especially to upstream GraphQL mutations.
- Is simple to read in the source code, just like a method/function call. Without thinking of protocol-level details for every damn call.
- Allows me to test gRPC server from my browser/Postman/curl (via HTTP!) by a simple one line config change.
- Does not bring tons of npm dependencies with it.

Also, the main driving force was my vast experience splitting monolith servers onto (micro)services. Here is how I do it with much success.

- Firstly, I refactor a function to return object of the `{success,code,message,...}` shape, and to never throw.
- Then, I move the function over to a microservice.
- Done.

Ideas are taken from multiple places.

- [slack.com HTTP RPC API](https://api.slack.com/web) - always return object of a same shape - `{ok:Boolean, error:String}`.
- [GoLang error handling](https://blog.golang.org/error-handling-and-go) - always return two things from a function call - the result and the error.
- [GraphQL introspection](https://graphql.org/learn/introspection/) - introspection API out of the box by default.

## Core principles

1. **Always choose DX (Developer Experience) over everything else**
   - Otherwise, Allserver won't differ from all the other alternatives.
1. **Switching between data protocols must be as easy as changing single config value**
   - Common example is when you want to convert your (micro)service from HTTP to gRPC.
   - Or if you want to call the gRPC server you are developing but don't have the gRPC client, so you use [Postman](https://www.postman.com/downloads/), `curl` or a browser (HTTP) for that.
   - Or you are moving the procedure/function/method to another (micro)service employing different communication protocol and infrastructure. E.g. when migrating from a monolith to serverless architecture.
1. **Calling procedures client side must be as easy as a regular function call**
   - `const { success, user } = await client.updateUser({ id: 622, firstName: "Hui" })`
   - Hence, the next core principle...
1. **Exceptions should be never thrown**
   - The object of the following shape must always be returned: `success,code,message,...`.
   - Although, this should be configurable (use `neverThrow: false`).
1. **Procedures (aka routes, aka methods, aka handlers) must always return same shaped interface regardless of everything**
   - This makes your (micro)service protocol agnostic.
   - HTTP server must always return `{success:Boolean, code:String, message:String}`.
   - Same for gRPC - `message Reply { bool success = 1; string code = 2; string message = 3; }`.
   - Same for other protocols.
1. **Protocol-level things must NOT be used for business-level logic (i.e. no REST)**
   - This makes your (micro)service protocol agnostic.
   - E.g. the HTTP status codes must be used for protocol-level errors only.
1. **All procedures must accept single argument - JavaScript options object**
   - This makes your (micro)service protocol agnostic.
1. **Procedures introspection (aka programmatic discovery) should work out of the box**
   - This allows `AllserverClient` to know nothing about the remote server when your code starts to run.

## Usage

### HTTP protocol

#### Server

The default `HttpTransport` is using the [`micro`](http://npmjs.com/package/micro) npm module as an optional dependency.

```shell script
npm i allserver micro
```

#### Client

Optionally, you can use Allserver's built-in client:

```shell script
npm i allserver node-fetch
```

Or do HTTP requests using any module you like.

### gRPC protocol

#### Server

The default `GrpcTransport` is using the standard the [`@grpc/grpc-js`](https://www.npmjs.com/package/@grpc/grpc-js) npm module as an optional dependency.

```shell script
npm i allserver @grpc/grpc-js @grpc/proto-loader
```

Note, with gRPC server and client you'd need to have your own `.proto` file. See code example below.

#### Client

Optionally, you can use Allserver's built-in client:

```shell script
npm i allserver @grpc/grpc-js @grpc/proto-loader
```

Or do gRPC requests using any module you like.

## Code examples

### Procedures

(aka routes, aka schema, aka handlers, aka functions, aka methods)

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

Using the `procedures` declared above.

```js
const { Allserver } = require("allserver");

Allserver({ procedures }).start();
```

The above code starts an HTTP server on port `process.env.PORT` if no transport was specified.

Here is the same server but more explicit:

```js
const { Allserver, HttpTransport } = require("allserver");

Allserver({
  procedures,
  transport: HttpTransport({ port: process.env.PORT }),
}).start();
```

### HTTP server in AWS Lambda

Doesn't require a dedicated client transport. Use the HTTP client below.

NB: not yet tested in production.

```js
const { Allserver, LambdaTransport } = require("allserver");

exports.handler = Allserver({
  procedures,
  transport: LambdaTransport(),
}).start();
```

Or, if you want each individual procedure to be the Lambda handler, pass `mapProceduresToExports: true`.

```js
const { Allserver, LambdaTransport } = require("allserver");

// Note! No `handler` here.
exports = Allserver({
  procedures,
  transport: LambdaTransport({ mapProceduresToExports: true }),
}).start();
```

### HTTP client side

#### Using built-in client

You'd need to install `node-fetch` optional dependency.

```shell script
npm i allserver node-fetch
```

Note, that this code is **same** as the gRPC client code example below!

```js
const { AllserverClient } = require("allserver");
// or
const AllserverClient = require("allserver/Client");

const client = AllserverClient({ uri: "http://localhost:4000" });

const { success, code, message, user } = await client.updateUser({
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
```

The `AllserverClient` will issue `HTTP POST` request to this URL: `http://localhost:4000/updateUser`.
The path of the URL is dynamically taken straight from the `client.updateUser` calling code using the ES6 [`Proxy`](https://stackoverflow.com/a/20147219/188475) class. In other words, `AllserverClient` intercepts non-existent property access.

#### Using any HTTP client (axios in this example)

It's a regular HTTP `POST` call with JSON request and response. URI is `/updateUser`.

```js
import axios from "axios";

const response = await axios.post("http://localhost:4000/updateUser", {
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
const { success, code, message, user } = response.data;
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

Yeah. This is a mutating call using `HTTP GET`. That's by design, and I love it. Allserver is an RPC server, not a website server! So we are free to do whatever we want here.

### HTTP limitations

1. Sub-routes are not available. E.g. you can't have `/users/updateUser`. (Yet.)

### gRPC server side

Note that we are reusing the `procedures` from the example above.

Make sure all the methods in your `.proto` file reply at least three properties: `success, code, message`. Otherwise, the server won't start and will throw an error.

Also, for now, you need to add these [mandatory declarations](https://github.com/flash-oss/allserver/blob/master/mandatory.proto) to your `.proto` file.

```js
const { Allserver, GrpcTransport } = require("allserver");

Allserver({
  procedures,
  transport: GrpcTransport({
    protoFile: __dirname + "/allserver_example.proto",
    port: 50051,
  }),
}).start();
```

### gRPC client side

#### Using built-in client

Note, that this code is **same** as the HTTP client code example above!

```js
const { AllserverClient } = require("allserver");
// or
const AllserverClient = require("allserver/Client");

const client = AllserverClient({ uri: "grpc://localhost:50051" });

const { success, code, message, user } = await client.updateUser({
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
```

The `protoFile` is automatically taken from the server side via the `introspect()` call.

##### Providing proto file and/or credentials yourself

```js
const { AllserverClient, GrpcClientTransport } = require("allserver");
// or
const AllserverClient = require("allserver/Client");

const client = AllserverClient({
  transport: GrpcClientTransport({
    uri: "grpc://localhost:50051",
    protoFile: __dirname + "/my-proto-file.proto",
    credentials: require("@grpc/grpc-js").credentials.createSsl(/* ... */),
  }),
});

const { success, code, message, user } = await client.updateUser({
  id: "123412341234123412341234",
  firstName: "Fred",
  lastName: "Flinstone",
});
```

#### Using any gPRS client (official module in this example)

```js
const packageDefinition = require("@grpc/proto-loader").loadSync(
  __dirname + "/allserver_example.proto"
);

const grpc = require("@grpc/grpc-js");
const proto = grpc.loadPackageDefinition(packageDefinition);
var client = new proto.MyService(
  "localhost:50051",
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

### gRPC limitations

1. Only [**unary**](https://grpc.io/docs/what-is-grpc/core-concepts/#unary-rpc) RPC. No streaming of any kind is available. By design.
1. All the reply `message` definitions must have `bool success = 1; string code = 2; string message = 3;`. Otherwise, server won't start. By design.
1. You can't have `import` statements in your `.proto` file. (Yet.)
1. Your server-side `.proto` file must include Allserver's [mandatory declarations](https://github.com/flash-oss/allserver/blob/master/mandatory.proto). (Yet.)

## FAQ

### What happens if I call a procedure but remote server does not reply?

If using `AllserverClient` you'll get this result, no exceptions thrown client-side by default:

```json
{
  "success": false,
  "code": "ALLSERVER_PROCEDURE_UNREACHABLE",
  "message": "Couldn't reach remote procedure: procedureName"
}
```

If using your own client module then you'll get your module default behaviour; typically an exception is thrown.

### What happens if I call a procedure which does not exist?

If using `AllserverClient` you'll get this result, no exceptions thrown client-side by default:

```json
{
  "success": false,
  "code": "ALLSERVER_PROCEDURE_NOT_FOUND",
  "message": "Procedure not found: procedureName"
}
```

If using your own client module then you'll get your module default behaviour; typically an exception is thrown.

### What happens if I call a procedure which throws?

You'll get a normal reply, no exceptions thrown client-side, but the `success` field will be `false`.

```json
{
  "success": false,
  "code": "ALLSERVER_PROCEDURE_ERROR",
  "message": "`'undefined' in not a function` in: procedureName"
}
```

### The Allserver logs to console. How to change that?

In case of internal errors the server would dump the full stack trace to the stderr using its `logger` property (defaults to `console`). Replace the Allserver's logger like this:

```js
const allserver = Allserver({ procedures, logger: new MyShinyLogger() });
// or
Allserver = Allserver.defaults({ logger: new MyShinyLogger() });
const allserver = Allserver({ procedures });
```

### Can I add a middleware?

You can add only **one** pre-middleware, as well as **one** post-middleware.

```js
const allserver = Allserver({
  procedures,
  before(ctx) {
    console.log(ctx.procedureName, ctx.procedure, ctx.arg);
  },
  after(ctx) {
    console.log(ctx.procedureName, ctx.procedure, ctx.arg);
    console.log(ctx.introspection, ctx.result, ctx.error);
  },
});
```

### How to add Auth?

#### Server side

Server side you do it yourself via the `before` pre-middleware. See above.

Allserver does not (yet) standardise how the "bad auth" replies should look and feel. That's a discussion we need to take. Refer to the **Core principles** above for insights.

#### Client side

This largely depends on the protocol and controlled by the so called "ClientTransport".

##### HTTP

```js
const { AllserverClient, HttpClientTransport } = require("allserver");

const client = AllserverClient({
  transport: HttpClientTransport({
    uri: "http://my-server:4000",
    headers: { authorization: "Basic my-token" },
  }),
});
```

##### gRPC

```js
const { AllserverClient, GrpcClientTransport } = require("allserver");

const client = AllserverClient({
  transport: GrpcClientTransport({
    uri: "grpc://my-server:50051",
    creadentials: require("@grpc/grpc-js").credentials.createSsl(/* ... */),
  }),
});
```

##### My authorisation is not supported. What should I do?

If something more sophisticated is needed - the "Client Transport" can have `before` and `after` middlewares.

```js
const { AllserverClient, HttpClientTransport } = require("allserver");

const client = AllserverClient({
  transport: HttpClientTransport({
    uri: "http://my-server:4000",
    before(ctx) {
      console.log(ctx.procedureName, ctx.arg);
      ctx.http.mode = "cors";
      ctx.http.credentials = "include";
      ctx.http.headers.authorization = "Basic my-token";
    },
    after(ctx) {
      if (ctx.error) console.error(ctx.error) else console.log(ctx.result);
    },
  }),
});
```

Alternatively, you can "inherit" transports:

```js
const { AllserverClient, HttpClientTransport } = require("allserver");

const MyHttpTransportWithAuth = HttpClientTransport.methods({
  before(ctx) {
    ctx.http.mode = "cors";
    ctx.http.credentials = "include";
    ctx.http.headers.authorization = "Basic my-token";
  },
});

const client = AllserverClient({
  transport: MyHttpTransportWithAuth({ uri: "http://my-server:4000" }),
});
```
